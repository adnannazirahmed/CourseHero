import { NextResponse } from "next/server";
import { getLocalUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET() {
  const user = getLocalUser();
  const db = getDb();

  const courses = db
    .prepare(
      `SELECT c.* FROM courses c WHERE c.owner_id = ?
       OR c.id IN (SELECT course_id FROM enrollments WHERE user_id = ?)
       OR c.id IN (
         SELECT i.course_id FROM roadmap_items i JOIN roadmaps r ON r.id = i.roadmap_id
         WHERE r.owner_id = ? OR r.id IN (SELECT roadmap_id FROM roadmap_enrollments WHERE user_id = ?)
       ) ORDER BY c.created_at DESC`,
    )
    .all(user.id, user.id, user.id, user.id);
  const lessons = db
    .prepare(
      `SELECT l.* FROM lessons l JOIN courses c ON c.id = l.course_id
       WHERE c.owner_id = ? OR c.id IN (SELECT course_id FROM enrollments WHERE user_id = ?)
       OR c.id IN (
         SELECT i.course_id FROM roadmap_items i JOIN roadmaps r ON r.id = i.roadmap_id
         WHERE r.owner_id = ? OR r.id IN (SELECT roadmap_id FROM roadmap_enrollments WHERE user_id = ?)
       )
       ORDER BY l.course_id, l.position`,
    )
    .all(user.id, user.id, user.id, user.id);
  const quizzes = db
    .prepare(
      `SELECT q.* FROM quizzes q JOIN lessons l ON l.id = q.lesson_id
       JOIN courses c ON c.id = l.course_id
       WHERE c.owner_id = ? OR c.id IN (SELECT course_id FROM enrollments WHERE user_id = ?)
       OR c.id IN (
         SELECT i.course_id FROM roadmap_items i JOIN roadmaps r ON r.id = i.roadmap_id
         WHERE r.owner_id = ? OR r.id IN (SELECT roadmap_id FROM roadmap_enrollments WHERE user_id = ?)
       )`,
    )
    .all(user.id, user.id, user.id, user.id);
  const notes = db.prepare("SELECT * FROM notes WHERE user_id = ?").all(user.id);
  const progress = db.prepare("SELECT * FROM lesson_state WHERE user_id = ?").all(user.id);
  const placements = db.prepare("SELECT * FROM placements WHERE user_id = ?").all(user.id);
  const enrollments = db.prepare("SELECT * FROM enrollments WHERE user_id = ?").all(user.id);
  const roadmaps = db
    .prepare(
      `SELECT * FROM roadmaps WHERE owner_id = ?
       OR id IN (SELECT roadmap_id FROM roadmap_enrollments WHERE user_id = ?)`,
    )
    .all(user.id, user.id);
  const roadmapItems = db.prepare(
    `SELECT i.* FROM roadmap_items i JOIN roadmaps r ON r.id = i.roadmap_id
     WHERE r.owner_id = ? OR r.id IN (SELECT roadmap_id FROM roadmap_enrollments WHERE user_id = ?)`,
  ).all(user.id, user.id);
  const roadmapEnrollments = db.prepare(
    "SELECT * FROM roadmap_enrollments WHERE user_id = ?",
  ).all(user.id);
  const activities = db.prepare("SELECT * FROM activities WHERE user_id = ?").all(user.id);

  const payload = {
    exportedAt: new Date().toISOString(),
    app: "Course Hero Local",
    version: 2,
    user: { id: user.id, name: user.name, email: user.email, created_at: user.created_at },
    courses,
    lessons,
    quizzes,
    notes,
    progress,
    placements,
    enrollments,
    roadmaps,
    roadmapItems,
    roadmapEnrollments,
    activities,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="course-hero-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
