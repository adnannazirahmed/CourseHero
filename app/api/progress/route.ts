import { NextResponse } from "next/server";
import { getLocalUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/password";

function canAccess(userId: string, courseId: string) {
  const db = getDb();
  const course = db
    .prepare("SELECT owner_id, visibility FROM courses WHERE id = ?")
    .get(courseId) as { owner_id: string; visibility: string } | undefined;
  if (!course) return false;
  if (course.owner_id === userId || course.visibility === "public") return true;
  return false;
}

export async function POST(request: Request) {
  const user = getLocalUser();

  let body: {
    lessonId?: string;
    completed?: boolean;
    watchedSeconds?: number;
    quizAnswer?: number;
    quizCorrect?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const db = getDb();
  const lesson = body.lessonId
    ? (db
        .prepare("SELECT id, course_id FROM lessons WHERE id = ?")
        .get(body.lessonId) as { id: string; course_id: string } | undefined)
    : undefined;
  if (!lesson || !canAccess(user.id, lesson.course_id)) {
    return NextResponse.json({ error: "Lesson not found." }, { status: 404 });
  }

  const existing = db
    .prepare("SELECT * FROM lesson_state WHERE user_id = ? AND lesson_id = ?")
    .get(user.id, lesson.id) as
    | {
        completed: number;
        watched_seconds: number;
        quiz_correct: number | null;
        quiz_answer: number | null;
      }
    | undefined;

  const now = new Date().toISOString();
  const completed = body.completed ?? Boolean(existing?.completed);
  const watched =
    typeof body.watchedSeconds === "number"
      ? Math.max(0, Math.min(86_400, Math.round(body.watchedSeconds)))
      : existing?.watched_seconds ?? 0;
  const quizAnswer =
    typeof body.quizAnswer === "number" ? body.quizAnswer : existing?.quiz_answer ?? null;
  const quizCorrect =
    typeof body.quizCorrect === "boolean" ? (body.quizCorrect ? 1 : 0) : existing?.quiz_correct ?? null;

  db.prepare(
    `INSERT INTO lesson_state (id, user_id, course_id, lesson_id, completed, watched_seconds, quiz_correct, quiz_answer, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, lesson_id) DO UPDATE SET
       completed = excluded.completed,
       watched_seconds = excluded.watched_seconds,
       quiz_correct = excluded.quiz_correct,
       quiz_answer = excluded.quiz_answer,
       updated_at = excluded.updated_at`,
  ).run(
    newId("state-"),
    user.id,
    lesson.course_id,
    lesson.id,
    completed ? 1 : 0,
    watched,
    quizCorrect,
    quizAnswer,
    now,
  );

  db.prepare(
    "INSERT OR IGNORE INTO enrollments (id, user_id, course_id, created_at) VALUES (?, ?, ?, ?)",
  ).run(newId("enroll-"), user.id, lesson.course_id, now);

  if (completed && !existing?.completed) {
    db.prepare(
      "INSERT INTO activities (id, user_id, course_id, lesson_id, kind, created_at) VALUES (?, ?, ?, ?, 'completed', ?)",
    ).run(newId("activity-"), user.id, lesson.course_id, lesson.id, now);
  }

  return NextResponse.json({ ok: true, completed });
}
