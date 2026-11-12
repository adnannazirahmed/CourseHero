import { NextResponse } from "next/server";
import { getLocalUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/password";
import { slugify } from "@/lib/plan";
import { parseYouTubeUrl } from "@/lib/youtube-url";

type Row = Record<string, unknown>;

function rows(value: unknown, name: string, max: number): Row[] {
  if (!Array.isArray(value) || value.length > max || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error(`Invalid ${name} in the export.`);
  }
  return value as Row[];
}

function str(value: unknown, max = 4000): string {
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid text in the export.");
  return value;
}

function optionalStr(value: unknown, max = 4000): string {
  return value == null ? "" : str(value, max);
}

function integer(value: unknown, min = 0, max = 1_000_000): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error("Invalid number in the export.");
  }
  return value;
}

function date(value: unknown): string {
  const text = str(value, 40);
  if (!Number.isFinite(Date.parse(text))) throw new Error("Invalid date in the export.");
  return text;
}

function idMap(items: Row[], prefix: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    const oldId = str(item.id, 150);
    if (map.has(oldId)) throw new Error("Duplicate IDs in the export.");
    map.set(oldId, newId(prefix));
  }
  return map;
}

function mapped(map: Map<string, string>, value: unknown): string {
  const result = map.get(str(value, 150));
  if (!result) throw new Error("The export has a missing linked record.");
  return result;
}

export async function POST(request: Request) {
  const user = getLocalUser();
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "Choose a JSON export file." }, { status: 415 });
  }

  let source: Row;
  let courses: Row[];
  let lessons: Row[];
  let quizzes: Row[];
  let notes: Row[];
  let progress: Row[];
  let placements: Row[];
  let enrollments: Row[];
  let roadmaps: Row[];
  let roadmapItems: Row[];
  let roadmapEnrollments: Row[];
  let activities: Row[];
  let quizReviews: Row[];
  let weeklyCoach: Row[];
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("The import file is empty.");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 10_000_000) {
        await reader.cancel();
        throw new Error("The export exceeds the 10 MB import limit.");
      }
      chunks.push(value);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    source = JSON.parse(text) as Row;
    if (!source || typeof source !== "object" || Array.isArray(source) || source.app !== "Course Hero Local" || source.version !== 2) {
      throw new Error("Choose a version 2 Course Hero JSON export.");
    }
    courses = rows(source.courses, "courses", 200);
    lessons = rows(source.lessons, "lessons", 10_000);
    quizzes = rows(source.quizzes, "quizzes", 10_000);
    notes = rows(source.notes, "notes", 20_000);
    progress = rows(source.progress, "progress", 10_000);
    placements = rows(source.placements, "placements", 200);
    enrollments = rows(source.enrollments, "enrollments", 200);
    roadmaps = rows(source.roadmaps, "roadmaps", 200);
    roadmapItems = rows(source.roadmapItems, "roadmap items", 2_000);
    roadmapEnrollments = rows(source.roadmapEnrollments, "roadmap enrollments", 200);
    activities = rows(source.activities, "activities", 20_000);
    quizReviews = rows(source.quizReviews ?? [], "quiz reviews", 20_000);
    weeklyCoach = rows(source.weeklyCoach ?? [], "weekly coach", 200);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid export file." }, { status: 400 });
  }

  const db = getDb();
  try {
    const originalUser = source.user as Row;
    if (!originalUser || typeof originalUser !== "object") throw new Error("The export has no account record.");
    const originalUserId = str(originalUser.id, 150);
    const courseIds = idMap(courses, "course-");
    const lessonIds = idMap(lessons, "lesson-");
    const roadmapIds = idMap(roadmaps, "roadmap-");
    const now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const course of courses) {
        const id = mapped(courseIds, course.id);
        const title = str(course.title, 180);
        const parsed = parseYouTubeUrl(str(course.youtube_url, 2048));
        if (!parsed) throw new Error("The export contains an invalid YouTube link.");
        const videoId = parsed.videoId;
        const playlistId = videoId ? null : parsed.playlistId;
        const url = videoId
          ? `https://www.youtube.com/watch?v=${videoId}`
          : `https://www.youtube.com/playlist?list=${playlistId}`;
        const status = course.status === "ready" ? "ready" : "failed";
        const difficulty = ["beginner", "intermediate", "advanced"].includes(String(course.difficulty))
          ? String(course.difficulty)
          : "beginner";
        db.prepare(`INSERT INTO courses
          (id, owner_id, title, slug, youtube_url, youtube_id, playlist_id, author, thumbnail,
           duration_seconds, description, source, pace_minutes, target_days, course_goal, difficulty,
           status, error, visibility, added_by, popularity, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, user.id, title, slugify(title, id.slice(-8)), url, videoId, playlistId,
            optionalStr(course.author, 120), videoId ? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` : "",
            integer(course.duration_seconds), optionalStr(course.description), videoId ? "video" : "playlist",
            integer(course.pace_minutes, 1, 1440), integer(course.target_days, 1, 30),
            optionalStr(course.course_goal, 500), difficulty, status,
            status === "failed" ? "Imported unfinished build. Try again." : null,
            course.visibility === "private" ? "private" : "public",
            optionalStr(course.added_by, 80), integer(course.popularity), date(course.created_at), now);
      }
      for (const lesson of lessons) {
        const id = mapped(lessonIds, lesson.id);
        const courseId = mapped(courseIds, lesson.course_id);
        const courseVideoId = optionalStr(lesson.video_id, 11);
        if (courseVideoId && !/^[A-Za-z0-9_-]{11}$/.test(courseVideoId)) throw new Error("Invalid video ID in the export.");
        db.prepare(`INSERT INTO lessons
          (id, course_id, position, title, start_seconds, end_seconds, video_id, notes, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, courseId, integer(lesson.position), str(lesson.title, 100),
            integer(lesson.start_seconds), integer(lesson.end_seconds), courseVideoId || null,
            str(lesson.notes, 50_000), date(lesson.created_at));
      }
      for (const quiz of quizzes) {
        const options = JSON.parse(str(quiz.options, 20_000)) as unknown;
        if (!Array.isArray(options) || options.length !== 4 || options.some((item) => typeof item !== "string" || item.length > 4000)) {
          throw new Error("Invalid quiz options in the export.");
        }
        db.prepare(`INSERT INTO quizzes
          (id, lesson_id, question, options, answer_index, explanation, replay_seconds)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(newId("quiz-"), mapped(lessonIds, quiz.lesson_id), str(quiz.question, 4000),
            JSON.stringify(options), integer(quiz.answer_index, 0, 3),
            optionalStr(quiz.explanation, 4000), integer(quiz.replay_seconds));
      }
      for (const enrollment of enrollments) {
        if (str(enrollment.user_id, 150) !== originalUserId) throw new Error("The export contains another account's enrollment.");
        db.prepare(`INSERT OR IGNORE INTO enrollments (id, user_id, course_id, target_days, created_at)
          VALUES (?, ?, ?, ?, ?)`)
          .run(newId("enroll-"), user.id, mapped(courseIds, enrollment.course_id),
            enrollment.target_days == null ? null : integer(enrollment.target_days, 1, 30), date(enrollment.created_at));
      }
      for (const state of progress) {
        if (str(state.user_id, 150) !== originalUserId) throw new Error("The export contains another account's progress.");
        db.prepare(`INSERT INTO lesson_state
          (id, user_id, course_id, lesson_id, completed, watched_seconds, note_text,
           quiz_correct, quiz_answer, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(newId("state-"), user.id, mapped(courseIds, state.course_id), mapped(lessonIds, state.lesson_id),
            integer(state.completed, 0, 1), integer(state.watched_seconds, 0, 86_400),
            optionalStr(state.note_text, 20_000),
            state.quiz_correct == null ? null : integer(state.quiz_correct, 0, 1),
            state.quiz_answer == null ? null : integer(state.quiz_answer, 0, 3), date(state.updated_at));
      }
      for (const note of notes) {
        if (str(note.user_id, 150) !== originalUserId) throw new Error("The export contains another account's note.");
        db.prepare(`INSERT INTO notes (id, user_id, course_id, lesson_id, body, time_seconds, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(newId("note-"), user.id, mapped(courseIds, note.course_id),
            note.lesson_id == null ? null : mapped(lessonIds, note.lesson_id), str(note.body, 4000),
            integer(note.time_seconds, 0, 86_400), date(note.created_at));
      }
      for (const placement of placements) {
        if (str(placement.user_id, 150) !== originalUserId) throw new Error("The export contains another account's placement.");
        const skipped = JSON.parse(str(placement.skipped, 20_000)) as unknown;
        if (!Array.isArray(skipped)) throw new Error("Invalid placement data in the export.");
        const mappedSkipped = skipped
          .filter((id): id is string => typeof id === "string" && lessonIds.has(id))
          .map((id) => mapped(lessonIds, id));
        db.prepare(`INSERT INTO placements (id, user_id, course_id, skipped, score, total, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(newId("placement-"), user.id, mapped(courseIds, placement.course_id),
            JSON.stringify(mappedSkipped), integer(placement.score, 0, 100),
            integer(placement.total, 0, 100), date(placement.created_at));
      }
      for (const roadmap of roadmaps) {
        const id = mapped(roadmapIds, roadmap.id);
        const title = str(roadmap.title, 100);
        db.prepare(`INSERT INTO roadmaps (id, owner_id, title, slug, description, goal, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(id, user.id, title, slugify(title, id.slice(-8)), optionalStr(roadmap.description, 500),
            optionalStr(roadmap.goal, 500), date(roadmap.created_at));
      }
      for (const item of roadmapItems) {
        db.prepare(`INSERT INTO roadmap_items (id, roadmap_id, course_id, position) VALUES (?, ?, ?, ?)`)
          .run(newId("roadmap-item-"), mapped(roadmapIds, item.roadmap_id),
            mapped(courseIds, item.course_id), integer(item.position));
      }
      for (const enrollment of roadmapEnrollments) {
        if (str(enrollment.user_id, 150) !== originalUserId) throw new Error("The export contains another account's roadmap enrollment.");
        db.prepare(`INSERT OR IGNORE INTO roadmap_enrollments (id, roadmap_id, user_id, created_at)
          VALUES (?, ?, ?, ?)`)
          .run(newId("roadmap-enroll-"), mapped(roadmapIds, enrollment.roadmap_id), user.id, date(enrollment.created_at));
      }
      for (const activity of activities) {
        if (str(activity.user_id, 150) !== originalUserId) throw new Error("The export contains another account's activity.");
        db.prepare(`INSERT INTO activities (id, user_id, course_id, lesson_id, kind, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .run(newId("activity-"), user.id,
            activity.course_id == null ? null : mapped(courseIds, activity.course_id),
            activity.lesson_id == null ? null : lessonIds.get(str(activity.lesson_id, 150)) ?? null,
            str(activity.kind, 40), date(activity.created_at));
      }
      for (const review of quizReviews) {
        if (str(review.user_id, 150) !== originalUserId) throw new Error("The export contains another account's review.");
        const lessonId = mapped(lessonIds, review.lesson_id);
        const quiz = db.prepare("SELECT id FROM quizzes WHERE lesson_id = ?").get(lessonId) as { id: string } | undefined;
        if (!quiz) continue;
        db.prepare(`INSERT OR IGNORE INTO quiz_reviews
          (id, user_id, quiz_id, lesson_id, course_id, due_at, interval_days, misses, last_result, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(newId("review-"), user.id, quiz.id, lessonId, mapped(courseIds, review.course_id),
            date(review.due_at), integer(review.interval_days, 1, 30), integer(review.misses),
            str(review.last_result, 20), date(review.created_at), date(review.updated_at));
      }
      for (const coach of weeklyCoach) {
        if (str(coach.user_id, 150) !== originalUserId) throw new Error("The export contains another account's coach.");
        db.prepare(`INSERT OR IGNORE INTO weekly_coach
          (id, user_id, week_key, summary, actions, focus, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(newId("coach-"), user.id, str(coach.week_key, 20), str(coach.summary, 800),
            str(coach.actions, 4000), optionalStr(coach.focus, 160), date(coach.created_at));
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return NextResponse.json({ ok: true, courses: courses.length, notes: notes.length, roadmaps: roadmaps.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Import failed." }, { status: 400 });
  }
}
