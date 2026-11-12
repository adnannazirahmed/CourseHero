import { NextResponse } from "next/server";
import { getLocalUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { startGeneration } from "@/lib/generate";
import { reserveGeneration } from "@/lib/generation-limits";
import { newId } from "@/lib/password";
import { slugify } from "@/lib/plan";
import { parseYouTubeUrl } from "@/lib/youtube-url";

export async function POST(request: Request) {
  const user = getLocalUser();

  let body: { url?: string; days?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = parseYouTubeUrl(String(body.url ?? ""));
  if (!parsed) {
    return NextResponse.json(
      { error: "Paste a YouTube video or playlist link (youtube.com/watch?v=… or /playlist?list=…)." },
      { status: 400 },
    );
  }

  const days = Math.round(Number(body.days));
  if (!Number.isFinite(days) || days < 1 || days > 30) {
    return NextResponse.json({ error: "Choose a finish line between 1 and 30 days." }, { status: 400 });
  }
  const db = getDb();
  const id = newId("course-");
  const suffix = id.replace("course-", "").slice(0, 6);
  const slug = slugify(parsed.videoId ? "youtube-course" : "youtube-playlist", suffix);
  const now = new Date().toISOString();

  const limitError = reserveGeneration(user.id, id, () => {
    db.prepare(
      `INSERT INTO courses (id, owner_id, title, slug, youtube_url, youtube_id, playlist_id, author, thumbnail, duration_seconds, description, source, pace_minutes, target_days, status, visibility, added_by, popularity, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '', '', 0, '', ?, 60, ?, 'generating', 'public', ?, 0, ?, ?)`,
    ).run(
      id,
      user.id,
      parsed.videoId ? "Building your course…" : "Building your playlist course…",
      slug,
      String(body.url).trim(),
      parsed.videoId,
      parsed.videoId ? null : parsed.playlistId,
      parsed.videoId ? "video" : "playlist",
      days,
      user.name,
      now,
      now,
    );
    db.prepare(
      "INSERT INTO enrollments (id, user_id, course_id, target_days, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(newId("enroll-"), user.id, id, days, now);
  });
  if (limitError) return NextResponse.json({ error: limitError }, { status: 429 });

  startGeneration(id);
  return NextResponse.json({ id });
}
