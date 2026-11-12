import { NextResponse } from "next/server";
import { getLocalUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/password";

function canAccess(userId: string, courseId: string) {
  const db = getDb();
  const course = db
    .prepare("SELECT owner_id, visibility FROM courses WHERE id = ?")
    .get(courseId) as { owner_id: string; visibility: string } | undefined;
  return Boolean(course && (course.owner_id === userId || course.visibility === "public"));
}

export async function PATCH(request: Request) {
  const user = getLocalUser();

  let body: { courseId?: string; lessonId?: string; body?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const courseId = String(body.courseId ?? "");
  const lessonId = String(body.lessonId ?? "");
  const text = String(body.body ?? "").slice(0, 20_000);
  if (!canAccess(user.id, courseId)) {
    return NextResponse.json({ error: "Course not found." }, { status: 404 });
  }
  const db = getDb();
  const lesson = db
    .prepare("SELECT id FROM lessons WHERE id = ? AND course_id = ?")
    .get(lessonId, courseId);
  if (!lesson) return NextResponse.json({ error: "Lesson not found." }, { status: 404 });

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO lesson_state (id, user_id, course_id, lesson_id, completed, watched_seconds, note_text, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?)
     ON CONFLICT(user_id, lesson_id) DO UPDATE SET note_text = excluded.note_text, updated_at = excluded.updated_at`,
  ).run(newId("state-"), user.id, courseId, lessonId, text, now);
  db.prepare(
    "INSERT OR IGNORE INTO enrollments (id, user_id, course_id, created_at) VALUES (?, ?, ?, ?)",
  ).run(newId("enroll-"), user.id, courseId, now);

  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const user = getLocalUser();

  let body: { courseId?: string; lessonId?: string; body?: string; timeSeconds?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const text = String(body.body ?? "").trim().slice(0, 4000);
  const courseId = String(body.courseId ?? "");
  if (!text) return NextResponse.json({ error: "Write something first." }, { status: 400 });
  if (!canAccess(user.id, courseId)) {
    return NextResponse.json({ error: "Course not found." }, { status: 404 });
  }

  const db = getDb();
  const lessonId = body.lessonId || null;
  if (lessonId) {
    const lesson = db
      .prepare("SELECT id FROM lessons WHERE id = ? AND course_id = ?")
      .get(lessonId, courseId);
    if (!lesson) return NextResponse.json({ error: "Lesson not found." }, { status: 404 });
  }

  const id = newId("note-");
  const now = new Date().toISOString();
  const timeSeconds = Math.max(0, Math.min(86_400, Math.round(Number(body.timeSeconds) || 0)));
  db.prepare(
    `INSERT INTO notes (id, user_id, course_id, lesson_id, body, time_seconds, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, user.id, courseId, lessonId, text, timeSeconds, now);

  db.prepare(
    "INSERT OR IGNORE INTO enrollments (id, user_id, course_id, created_at) VALUES (?, ?, ?, ?)",
  ).run(newId("enroll-"), user.id, courseId, now);

  return NextResponse.json({
    note: { id, body: text, time_seconds: timeSeconds, created_at: now, lesson_id: lessonId },
  });
}

export async function DELETE(request: Request) {
  const user = getLocalUser();
  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const db = getDb();
  const result = db
    .prepare("DELETE FROM notes WHERE id = ? AND user_id = ?")
    .run(String(body.id ?? ""), user.id);
  return NextResponse.json({ ok: result.changes > 0 });
}
