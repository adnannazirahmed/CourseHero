import "server-only";
import { aiJson, getAiStatus } from "./ai";
import { getDb } from "./db";
import { newId } from "./password";
import { getDueReviewCount } from "./reviews";
import { getStreak } from "./data";

export type CoachContent = {
  summary: string;
  actions: string[];
  focus: string;
  generated: boolean;
};

function weekKey(): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - (day - 1));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export function getCachedCoach(userId: string): CoachContent | null {
  const row = getDb()
    .prepare(
      "SELECT summary, actions, focus FROM weekly_coach WHERE user_id = ? AND week_key = ?",
    )
    .get(userId, weekKey()) as
    | { summary: string; actions: string; focus: string }
    | undefined;
  if (!row) return null;
  let actions: string[] = [];
  try {
    const parsed = JSON.parse(row.actions);
    if (Array.isArray(parsed)) actions = parsed.map(String).filter(Boolean).slice(0, 4);
  } catch {
    actions = [];
  }
  return { summary: row.summary, actions, focus: row.focus, generated: true };
}

function stats(userId: string) {
  const db = getDb();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const completed = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM activities WHERE user_id = ? AND kind = 'completed' AND created_at >= ?",
      )
      .get(userId, since) as { n: number }
  ).n;
  const quiz = db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(quiz_correct), 0) AS correct
       FROM lesson_state WHERE user_id = ? AND quiz_correct IS NOT NULL AND updated_at >= ?`,
    )
    .get(userId, since) as { total: number; correct: number };
  const notes = (
    db
      .prepare("SELECT COUNT(*) AS n FROM notes WHERE user_id = ? AND created_at >= ?")
      .get(userId, since) as { n: number }
  ).n;
  const courses = db
    .prepare(
      `SELECT c.id, c.title,
        (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS total,
        (SELECT COUNT(*) FROM lesson_state s WHERE s.course_id = c.id AND s.user_id = ? AND s.completed = 1) AS done
       FROM courses c JOIN enrollments e ON e.course_id = c.id
       WHERE e.user_id = ? AND c.status = 'ready'
       ORDER BY (CAST((SELECT COUNT(*) FROM lesson_state s2 WHERE s2.course_id = c.id AND s2.user_id = ? AND s2.completed = 1) AS REAL) /
         MAX(1, (SELECT COUNT(*) FROM lessons l2 WHERE l2.course_id = c.id))) ASC
       LIMIT 3`,
    )
    .all(userId, userId, userId) as Array<{ id: string; title: string; total: number; done: number }>;
  const user = db.prepare("SELECT goal, name FROM users WHERE id = ?").get(userId) as
    | { goal: string; name: string }
    | undefined;
  return {
    completed,
    quizTotal: quiz.total,
    quizCorrect: quiz.correct,
    notes,
    due: getDueReviewCount(userId),
    streak: getStreak(userId).count,
    courses,
    goal: user?.goal ?? "",
    name: user?.name ?? "learner",
  };
}

function fallback(userId: string): CoachContent {
  const value = stats(userId);
  const accuracy = value.quizTotal ? Math.round((value.quizCorrect / value.quizTotal) * 100) : null;
  const weakest = value.courses.find((course) => course.total > course.done);
  const actions: string[] = [];
  if (value.due > 0) actions.push(`Clear ${value.due} due review${value.due === 1 ? "" : "s"}.`);
  if (weakest) actions.push(`Finish the next lesson in “${weakest.title}”.`);
  if (value.notes === 0) actions.push("Pin one note in the lesson you watch next.");
  actions.push("Pick one concept and explain it without replaying the video.");
  while (actions.length < 3) {
    actions.push("Revisit one quiz answer you got wrong and explain why.");
    if (actions.length < 3) actions.push("Write one sentence that captures what you learned.");
  }
  return {
    summary: value.completed
      ? `You completed ${value.completed} lesson${value.completed === 1 ? "" : "s"} in the last seven days${
          accuracy === null ? "" : ` with ${accuracy}% quiz accuracy`
        }. Your focus now is consistency, not starting something new.`
      : "Nothing completed in the last seven days yet. Start with one lesson today and make the next action small.",
    actions: actions.slice(0, 3),
    focus: weakest ? weakest.title : value.goal || "One lesson at a time.",
    generated: false,
  };
}

export async function generateCoach(userId: string, force = false): Promise<CoachContent> {
  if (!force) {
    const cached = getCachedCoach(userId);
    if (cached) return cached;
  }
  const value = stats(userId);
  const fallbackValue = fallback(userId);
  if (!getAiStatus().configured) {
    persist(userId, fallbackValue);
    return fallbackValue;
  }

  const result = await aiJson<{ summary?: string; actions?: unknown; focus?: string }>({
    task: "coach",
    userId,
    temperature: 0.4,
    messages: [
      {
        role: "system",
        content:
          "You are a concise, encouraging study coach. Use only the supplied local learning data. Do not invent courses, scores, or activity. Return JSON only.",
      },
      {
        role: "user",
        content: `Learner: ${value.name}
Goal: ${value.goal || "not set"}
Last 7 days: ${value.completed} lessons completed, ${value.notes} notes added, ${
          value.quizTotal ? `${value.quizCorrect}/${value.quizTotal} quiz answers correct` : "no quiz attempts"
        }.
Due reviews: ${value.due}. Streak: ${value.streak} days.
Courses and progress: ${
          value.courses.map((course) => `${course.title} (${course.done}/${course.total})`).join("; ") ||
          "no enrolled courses"
        }.

Write a weekly review with:
- summary: 2 sentences, specific and calm.
- focus: one short phrase naming the most useful focus.
- actions: exactly 3 short, concrete actions for this week.
Return JSON: {"summary":"","focus":"","actions":["","",""]}`,
      },
    ],
  });

  const actions = Array.isArray(result?.actions)
    ? result.actions.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 3)
    : [];
  const content: CoachContent =
    result?.summary && result.focus && actions.length === 3
      ? {
          summary: result.summary.trim().slice(0, 800),
          focus: result.focus.trim().slice(0, 160),
          actions,
          generated: true,
        }
      : fallbackValue;
  persist(userId, content);
  return content;
}

function persist(userId: string, content: CoachContent) {
  getDb()
    .prepare(
      `INSERT INTO weekly_coach (id, user_id, week_key, summary, actions, focus, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, week_key) DO UPDATE SET
         summary = excluded.summary, actions = excluded.actions, focus = excluded.focus, created_at = excluded.created_at`,
    )
    .run(
      newId("coach-"),
      userId,
      weekKey(),
      content.summary,
      JSON.stringify(content.actions),
      content.focus,
      new Date().toISOString(),
    );
}
