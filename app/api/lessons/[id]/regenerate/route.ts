import { NextResponse } from "next/server";
import { getLocalUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { regenerateLesson } from "@/lib/generate";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = getLocalUser();
  const { id } = await params;
  const lesson = getDb()
    .prepare(
      `SELECT l.course_id, c.owner_id FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ?`,
    )
    .get(id) as { course_id: string; owner_id: string } | undefined;
  if (!lesson) return NextResponse.json({ error: "Lesson not found." }, { status: 404 });
  if (lesson.owner_id !== user.id) {
    return NextResponse.json({ error: "Only the course owner can regenerate this lesson." }, { status: 403 });
  }
  try {
    const result = await regenerateLesson(lesson.course_id, id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not regenerate this lesson." },
      { status: 502 },
    );
  }
}
