import { NextResponse } from "next/server";
import { aiJson, getAiStatus } from "@/lib/ai";
import { getLocalUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  ensureCourseTranscript,
  formatChunkContext,
  getChunks,
  pickChunks,
  transcriptSeconds,
} from "@/lib/transcripts";

type HistoryItem = { role: "user" | "assistant"; content: string };

function access(userId: string, courseId: string) {
  const course = getDb()
    .prepare("SELECT id, owner_id, visibility, title FROM courses WHERE id = ?")
    .get(courseId) as
    | { id: string; owner_id: string; visibility: string; title: string }
    | undefined;
  return course && (course.owner_id === userId || course.visibility === "public") ? course : null;
}

export async function POST(request: Request) {
  const user = getLocalUser();
  let body: {
    courseId?: string;
    lessonId?: string;
    question?: string;
    history?: HistoryItem[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const courseId = String(body.courseId ?? "");
  const lessonId = String(body.lessonId ?? "");
  const question = String(body.question ?? "").trim().slice(0, 1200);
  if (!question) return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
  const course = access(user.id, courseId);
  if (!course) return NextResponse.json({ error: "Course not found." }, { status: 404 });

  const db = getDb();
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
  const selected = pickChunks(chunks, question, 12);
  const sourceContext = formatChunkContext(selected, 16_000);
  const notes = db
    .prepare(
      "SELECT body, time_seconds FROM notes WHERE user_id = ? AND lesson_id = ? ORDER BY created_at DESC LIMIT 8",
    )
    .all(user.id, lesson.id) as Array<{ body: string; time_seconds: number }>;
  const personal = db
    .prepare("SELECT note_text FROM lesson_state WHERE user_id = ? AND lesson_id = ?")
    .get(user.id, lesson.id) as { note_text: string } | undefined;
  const learnerNotes = [
    ...notes.map((note) => `[${transcriptSeconds(note.time_seconds)}] ${note.body}`),
    ...(personal?.note_text ? [personal.note_text] : []),
  ]
    .join("\n")
    .slice(0, 4000);

  const citations = selected.map((chunk) => ({
    seconds: chunk.start_seconds,
    label: transcriptSeconds(chunk.start_seconds),
    text: chunk.text.slice(0, 420),
  }));

  if (!getAiStatus().configured) {
    const best = selected.slice(0, 3);
    return NextResponse.json({
      answer: best.length
        ? `AI is not configured, so here are the closest transcript passages for “${question}”. Add AI_API_KEY and AI_MODEL to .env for a written answer.`
        : "AI is not configured, and this lesson has no transcript or study notes to search yet. Add AI_API_KEY and AI_MODEL to .env to enable the tutor.",
      citations,
      configured: false,
    });
  }

  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((item) => item && (item.role === "user" || item.role === "assistant"))
    .slice(-6)
    .map((item) => `${item.role === "user" ? "Learner" : "Tutor"}: ${String(item.content).slice(0, 700)}`)
    .join("\n");

  const result = await aiJson<{
    answer?: string;
    citationSeconds?: number[];
  }>({
    task: "tutor",
    userId: user.id,
    temperature: 0.25,
    messages: [
      {
        role: "system",
        content:
          "You are a grounded course tutor. Answer only from the supplied transcript and learner notes. If the source does not contain the answer, say so plainly. Cite timestamps as [m:ss]. Never invent facts.",
      },
      {
        role: "user",
        content: `Course: ${course.title}
Lesson: ${lesson.title}
Transcript window: ${transcriptSeconds(lesson.start_seconds)} to ${transcriptSeconds(lesson.end_seconds)}

SOURCE PASSAGES:
${sourceContext || "(no transcript available)"}

LESSON STUDY NOTES:
${lesson.notes.slice(0, 5000)}

LEARNER NOTES:
${learnerNotes || "(none)"}

${history ? `RECENT CONVERSATION:\n${history}\n` : ""}
QUESTION: ${question}

Answer in 2-5 short paragraphs. Use [m:ss] citations from the source. End with one concrete next action for the learner. Return JSON: {"answer":"","citationSeconds":[0]}`,
      },
    ],
  });

  if (!result?.answer) {
    return NextResponse.json(
      { error: "The tutor request failed. Check the terminal for the provider response and try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    answer: result.answer.trim(),
    citations,
    configured: true,
  });
}
