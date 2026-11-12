import { NextResponse } from "next/server";
import { aiFailureMessage, aiJson, aiText, getAiStatus } from "@/lib/ai";
import { getLocalUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  ensureCourseTranscript,
  formatChunkContext,
  getChunks,
  pickChunks,
} from "@/lib/transcripts";

type Mode = "summary" | "cheatsheet" | "flashcards" | "feedback";

export async function POST(request: Request) {
  const user = getLocalUser();
  let body: { courseId?: string; lessonId?: string; mode?: Mode; explanation?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const courseId = String(body.courseId ?? "");
  const lessonId = String(body.lessonId ?? "");
  const mode: Mode = ["summary", "cheatsheet", "flashcards", "feedback"].includes(String(body.mode))
    ? (body.mode as Mode)
    : "summary";
  if (!getAiStatus().configured) {
    return NextResponse.json({ error: aiFailureMessage() }, { status: 503 });
  }

  const db = getDb();
  const course = db
    .prepare("SELECT id, owner_id, visibility, title FROM courses WHERE id = ?")
    .get(courseId) as
    | { id: string; owner_id: string; visibility: string; title: string }
    | undefined;
  if (!course || (course.owner_id !== user.id && course.visibility !== "public")) {
    return NextResponse.json({ error: "Course not found." }, { status: 404 });
  }
  const lesson = db
    .prepare(
      `SELECT l.id, l.title, l.start_seconds, l.end_seconds, l.video_id, l.notes, c.youtube_id
       FROM lessons l JOIN courses c ON c.id = l.course_id
       WHERE l.id = ? AND l.course_id = ?`,
    )
    .get(lessonId, courseId) as
    | {
        id: string;
        title: string;
        start_seconds: number;
        end_seconds: number;
        video_id: string | null;
        notes: string;
        youtube_id: string | null;
      }
    | undefined;
  if (!lesson) return NextResponse.json({ error: "Lesson not found." }, { status: 404 });

  const videoId = lesson.video_id || lesson.youtube_id;
  await ensureCourseTranscript(courseId, videoId).catch(() => false);
  let chunks = getChunks(courseId, videoId, lesson.start_seconds, lesson.end_seconds);
  if (chunks.length === 0) chunks = getChunks(courseId, videoId);
  const context = formatChunkContext(pickChunks(chunks, lesson.title, 16), 14_000);
  const notes = db
    .prepare(
      "SELECT body FROM notes WHERE user_id = ? AND lesson_id = ? ORDER BY created_at DESC LIMIT 12",
    )
    .all(user.id, lesson.id) as Array<{ body: string }>;
  const personal = db
    .prepare("SELECT note_text FROM lesson_state WHERE user_id = ? AND lesson_id = ?")
    .get(user.id, lesson.id) as { note_text: string } | undefined;
  const source = `Course: ${course.title}
Lesson: ${lesson.title}

LESSON NOTES:
${lesson.notes.slice(0, 6000)}

LEARNER'S PINNED NOTES:
${notes.map((note) => note.body).join("\n").slice(0, 3000) || "(none)"}

LEARNER'S FREE-FORM NOTES:
${personal?.note_text?.slice(0, 3000) || "(none)"}

TRANSCRIPT:
${context || "(not available)"}`;

  if (mode === "flashcards") {
    const result = await aiJson<{ cards?: Array<{ front?: string; back?: string }> }>({
      task: "notes",
      userId: user.id,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "Create concise active-recall flashcards from the supplied lesson material. Output valid JSON only. Do not invent facts.",
        },
        {
          role: "user",
          content: `${source}\n\nCreate 6 flashcards. Each front is a question or prompt; each back is a short answer. Return {"cards":[{"front":"","back":""}]}`,
        },
      ],
    });
    const cards = (result?.cards ?? [])
      .map((card) => ({ front: String(card.front ?? "").trim(), back: String(card.back ?? "").trim() }))
      .filter((card) => card.front && card.back)
      .slice(0, 8);
    if (cards.length === 0) return NextResponse.json({ error: aiFailureMessage() }, { status: 502 });
    return NextResponse.json({ cards });
  }

  if (mode === "feedback") {
    const explanation = String(body.explanation ?? "").trim().slice(0, 4000);
    if (explanation.length < 20) {
      return NextResponse.json({ error: "Write at least a couple of sentences first." }, { status: 400 });
    }
    const text = await aiText({
      task: "notes",
      userId: user.id,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are a strict but encouraging tutor. Grade the learner's explanation only against the supplied lesson material. Point out what is missing or wrong, then give a better one-sentence explanation.",
        },
        {
          role: "user",
          content: `${source}\n\nLEARNER'S EXPLANATION:\n${explanation}\n\nGive: 1) what is right, 2) what is missing or incorrect, 3) a model explanation in 2-3 sentences.`,
        },
      ],
    });
    if (!text) return NextResponse.json({ error: aiFailureMessage() }, { status: 502 });
    return NextResponse.json({ text });
  }

  const instruction =
    mode === "cheatsheet"
      ? "Create a one-page markdown cheat sheet. Use short sections and bullets. Include timestamps where useful."
      : "Write a 150-250 word markdown summary. Start with the core idea, then the 3 most important details, then one question the learner should be able to answer.";
  const text = await aiText({
    task: "notes",
    userId: user.id,
    temperature: 0.25,
    messages: [
      {
        role: "system",
        content:
          "You turn lesson notes and transcripts into precise study material. Use only the supplied source. Never invent facts.",
      },
      { role: "user", content: `${source}\n\n${instruction}` },
    ],
  });
  if (!text) return NextResponse.json({ error: aiFailureMessage() }, { status: 502 });
  return NextResponse.json({ text });
}
