import { notFound } from "next/navigation";
import { getLocalUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  ensureEnrollment,
  getCompletedIds,
  getCourse,
  getLessons,
  getQuizForLesson,
  getSkippedIds,
  getCourseStats,
} from "@/lib/data";
import { AppHeader } from "@/components/AppHeader";
import { LessonClient } from "@/components/LessonClient";
import { getAiStatus } from "@/lib/ai";

export const dynamic = "force-dynamic";

export default async function LessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; lessonId: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { id, lessonId } = await params;
  const query = await searchParams;
  const user = getLocalUser();
  const course = getCourse(id);
  if (!course || course.status !== "ready") notFound();
  if (course.visibility !== "public" && course.owner_id !== user.id) notFound();

  ensureEnrollment(user.id, course.id);
  const lessons = getLessons(course.id);
  const lesson = lessons.find((item) => item.id === lessonId);
  if (!lesson) notFound();

  const { skipped, completed } = getCourseStats(user.id, course);
  const quiz = getQuizForLesson(lesson.id);
  const noteRows = getDb()
    .prepare(
      "SELECT id, body, time_seconds FROM notes WHERE user_id = ? AND course_id = ? AND lesson_id = ? ORDER BY created_at DESC",
    )
    .all(user.id, course.id, lesson.id) as Array<{ id: string; body: string; time_seconds: number }>;
  // node:sqlite returns null-prototype rows; normalize before crossing to the client.
  const notes = noteRows.map((note) => ({
    id: String(note.id),
    body: String(note.body),
    time_seconds: Number(note.time_seconds),
  }));

  const index = lessons.findIndex((item) => item.id === lesson.id);
  const next = lessons.slice(index + 1).find((item) => !skipped.has(item.id));
  const completedIds = getCompletedIds(user.id, course.id);
  const visibleLessons = lessons.filter((item) => !skipped.has(item.id));
  const doneCount = visibleLessons.filter((item) => completedIds.has(item.id)).length;

  const requestedStart = Number(query.t);
  const initialStart = Number.isFinite(requestedStart) && requestedStart > 0
    ? requestedStart
    : lesson.start_seconds;
  const personalNoteRow = getDb()
    .prepare(
      "SELECT note_text FROM lesson_state WHERE user_id = ? AND course_id = ? AND lesson_id = ?",
    )
    .get(user.id, course.id, lesson.id) as { note_text: string } | undefined;
  const initialPersonalNote = String(personalNoteRow?.note_text ?? "");

  let options: string[] = [];
  if (quiz) {
    try {
      options = JSON.parse(quiz.options);
    } catch {
      options = [];
    }
  }

  return (
    <>
      <AppHeader user={user} />
      <main className="app-main">
        <div className="app-wrap">
          <LessonClient
            course={{ id: course.id, title: course.title, youtube_id: course.youtube_id }}
            lesson={{
              id: lesson.id,
              position: lesson.position,
              title: lesson.title,
              start_seconds: lesson.start_seconds,
              end_seconds: lesson.end_seconds,
              video_id: lesson.video_id,
              notes: lesson.notes,
            }}
            quiz={
              quiz && options.length === 4
                ? {
                    question: quiz.question,
                    options,
                    answerIndex: quiz.answer_index,
                    explanation: quiz.explanation,
                    replaySeconds: quiz.replay_seconds,
                  }
                : null
            }
            initialStart={initialStart}
            initialCompleted={completed.has(lesson.id)}
            initialNotes={notes}
            initialPersonalNote={initialPersonalNote}
            sidebarLessons={lessons.map((item) => ({
              id: item.id,
              position: item.position,
              title: item.title,
              start_seconds: item.start_seconds,
              completed: completedIds.has(item.id),
              known: skipped.has(item.id),
            }))}
            initialDoneCount={doneCount}
            nextLesson={next ? { id: next.id, title: next.title, startSeconds: next.start_seconds } : null}
            aiConfigured={getAiStatus().configured}
            canRegenerate={course.owner_id === user.id}
          />
        </div>
      </main>
    </>
  );
}
