import { NextResponse } from "next/server";
import { getLocalUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { hasStudyData, recoverStaleGenerations, startGeneration } from "@/lib/generate";
import { reserveGeneration } from "@/lib/generation-limits";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = getLocalUser();
  const { id } = await params;
  recoverStaleGenerations();
  const db = getDb();
  const course = db
    .prepare(
      `SELECT id, title, status, error, owner_id, visibility, updated_at,
        (SELECT COUNT(*) FROM lessons l WHERE l.course_id = courses.id) AS lesson_count
       FROM courses WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string;
        title: string;
        status: string;
        error: string | null;
        owner_id: string;
        visibility: string;
        updated_at: string;
        lesson_count: number;
      }
    | undefined;
  if (!course) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (course.visibility !== "public" && course.owner_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    id: course.id,
    title: course.title,
    status: course.status,
    error: course.error,
    lessonCount: course.lesson_count,
    updatedAt: course.updated_at,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = getLocalUser();
  const { id } = await params;
  let body: { days?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const days = Math.round(Number(body.days));
  if (!Number.isFinite(days) || days < 1 || days > 30) {
    return NextResponse.json({ error: "Pick a finish line between 1 and 30 days." }, { status: 400 });
  }
  const db = getDb();
  const course = db
    .prepare("SELECT id, owner_id, visibility FROM courses WHERE id = ?")
    .get(id) as { id: string; owner_id: string; visibility: string } | undefined;
  if (!course || (course.owner_id !== user.id && course.visibility !== "public")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO enrollments (id, user_id, course_id, target_days, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, course_id) DO UPDATE SET target_days = excluded.target_days`,
  ).run(`enroll-${crypto.randomUUID()}`, user.id, id, days, now);
  return NextResponse.json({ ok: true, days });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = getLocalUser();
  const { id } = await params;
  recoverStaleGenerations();
  const db = getDb();
  const course = db
    .prepare("SELECT id, owner_id, status FROM courses WHERE id = ?")
    .get(id) as { id: string; owner_id: string; status: string } | undefined;
  if (!course || course.owner_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (course.status !== "failed") {
    return NextResponse.json({ error: "Only failed builds can be retried." }, { status: 409 });
  }
  if (hasStudyData(id)) {
    return NextResponse.json(
      { error: "This course has saved study data. Its lessons were kept; restore the previous version from a SQLite snapshot." },
      { status: 409 },
    );
  }
  const limitError = reserveGeneration(user.id, id, () => {
    db.prepare(
      "UPDATE courses SET status = 'generating', error = NULL, updated_at = ? WHERE id = ?",
    ).run(new Date().toISOString(), id);
  });
  if (limitError) return NextResponse.json({ error: limitError }, { status: 429 });
  startGeneration(id);
  return NextResponse.json({ ok: true });
}
