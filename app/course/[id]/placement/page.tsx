import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocalUser } from "@/lib/auth";
import { getCourse, getLessons, getQuizzesForCourse } from "@/lib/data";
import { getDb } from "@/lib/db";
import { AppHeader } from "@/components/AppHeader";
import { PlacementClient } from "@/components/PlacementClient";
import { ArrowLeft, Target } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function PlacementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = getLocalUser();
  const course = getCourse(id);
  if (!course || course.status !== "ready") notFound();
  if (course.visibility !== "public" && course.owner_id !== user.id) notFound();

  const lessons = getLessons(course.id);
  const quizzes = getQuizzesForCourse(course.id);
  const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));

  const attempts = new Map(
    (
      getDb()
        .prepare(
          "SELECT lesson_id, quiz_correct FROM lesson_state WHERE user_id = ? AND course_id = ? AND quiz_correct IS NOT NULL",
        )
        .all(user.id, course.id) as Array<{ lesson_id: string; quiz_correct: number }>
    ).map((row) => [row.lesson_id, row.quiz_correct]),
  );
  const candidates = quizzes
    .map((quiz) => ({ quiz, lesson: lessonById.get(quiz.lesson_id) }))
    .filter((entry): entry is { quiz: (typeof quizzes)[number]; lesson: (typeof lessons)[number] } => Boolean(entry.lesson))
    .sort((a, b) => {
      const rank = (lessonId: string) => {
        const result = attempts.get(lessonId);
        return result === undefined ? 1 : result === 1 ? 2 : 0;
      };
      return rank(a.lesson.id) - rank(b.lesson.id) || a.lesson.position - b.lesson.position;
    });

  const target = Math.min(6, candidates.length);
  const selected = candidates.slice(0, target);

  const questions = selected.map(({ quiz, lesson }) => {
    let options: string[] = [];
    try {
      options = JSON.parse(quiz.options);
    } catch {
      options = [];
    }
    return {
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      question: quiz.question,
      options,
      answerIndex: quiz.answer_index,
      replaySeconds: quiz.replay_seconds,
    };
  }).filter((question) => question.options.length === 4);

  return (
    <>
      <AppHeader user={user} />
      <main className="app-main">
        <div className="placement-wrap">
          <Link href={`/course/${course.id}`} className="btn btn-ghost btn-sm" style={{ paddingLeft: 0, marginBottom: 16 }}>
            <ArrowLeft size={14} /> Back to course
          </Link>
          {questions.length >= 2 ? (
            <PlacementClient
              courseId={course.id}
              courseTitle={course.title}
              questions={questions}
            />
          ) : (
            <div className="placement-card" style={{ textAlign: "center" }}>
              <span className="kicker"><Target size={12} /> Placement test</span>
              <h1 style={{ marginTop: 16 }}>This course needs a few more quizzes.</h1>
              <p className="placement-sub">
                A placement test needs at least two quiz questions. Start the course normally — your
                plan is ready.
              </p>
              <Link href={`/course/${course.id}`} className="btn btn-primary" style={{ marginTop: 20 }}>
                Back to your plan
              </Link>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
