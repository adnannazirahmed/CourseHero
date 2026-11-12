import { NextResponse } from "next/server";
import { getLocalUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/password";

export async function POST(request: Request) {
  const user = getLocalUser();

  let body: { courseId?: string; skipped?: string[]; score?: number; total?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const db = getDb();
  const courseId = String(body.courseId ?? "");
  const course = db
    .prepare("SELECT id, owner_id, visibility FROM courses WHERE id = ?")
    .get(courseId) as { id: string; owner_id: string; visibility: string } | undefined;
  if (!course || (course.owner_id !== user.id && course.visibility !== "public")) {
    return NextResponse.json({ error: "Course not found." }, { status: 404 });
  }

  const lessonRows = db
    .prepare("SELECT id FROM lessons WHERE course_id = ?")
    .all(courseId) as Array<{ id: string }>;
  const validIds = new Set(lessonRows.map((row) => row.id));
  const skipped = (Array.isArray(body.skipped) ? body.skipped : [])
    .map(String)
    .filter((id) => validIds.has(id))
    .slice(0, 100);
  const score = Math.max(0, Math.min(100, Math.round(Number(body.score) || 0)));
  const total = Math.max(0, Math.min(100, Math.round(Number(body.total) || 0)));
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO placements (id, user_id, course_id, skipped, score, total, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, course_id) DO UPDATE SET
       skipped = excluded.skipped, score = excluded.score, total = excluded.total, created_at = excluded.created_at`,
  ).run(newId("placement-"), user.id, courseId, JSON.stringify(skipped), score, total, now);

  db.prepare(
    "INSERT OR IGNORE INTO enrollments (id, user_id, course_id, created_at) VALUES (?, ?, ?, ?)",
  ).run(newId("enroll-"), user.id, courseId, now);
  db.prepare(
    "INSERT INTO activities (id, user_id, course_id, lesson_id, kind, created_at) VALUES (?, ?, ?, NULL, 'placement', ?)",
  ).run(newId("activity-"), user.id, courseId, now);

  return NextResponse.json({ ok: true, skipped: skipped.length });
}
