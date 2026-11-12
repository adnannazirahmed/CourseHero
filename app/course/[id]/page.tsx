import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocalUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  ensureEnrollment,
  getCourse,
  getCourseStats,
  getRecentNotes,
} from "@/lib/data";
import { dailyMinutesForTarget, formatClock, formatDuration, planForTargetDays } from "@/lib/plan";
import { AppHeader } from "@/components/AppHeader";
import { TargetDaysForm } from "@/components/TargetDaysForm";
import { CourseGenerating } from "@/components/CourseGenerating";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Clock,
  Layers,
  Note,
  Play,
  Sparkle,
  Target,
} from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = getLocalUser();
  const course = getCourse(id);
  if (!course) notFound();
  if (course.visibility !== "public" && course.owner_id !== user.id) notFound();

  if (course.status !== "ready") {
    return (
      <>
        <AppHeader user={user} />
        <main className="app-main">
          <div className="app-wrap">
            <CourseGenerating
              courseId={course.id}
              initialStatus={course.status === "failed" ? "failed" : "generating"}
              initialError={course.error}
              initialTitle={course.title}
              isOwner={course.owner_id === user.id}
            />
          </div>
        </main>
      </>
    );
  }

  ensureEnrollment(user.id, course.id);
  const enrollment = getDb()
    .prepare("SELECT target_days, created_at FROM enrollments WHERE user_id = ? AND course_id = ?")
    .get(user.id, course.id) as { target_days: number | null; created_at: string } | undefined;
  const targetDays = Math.min(
    30,
    Math.max(1, enrollment?.target_days ?? course.target_days ?? 7),
  );
  const { lessons, skipped, completed, quizCount } = getCourseStats(user.id, course);
  const plan = planForTargetDays(lessons, targetDays, skipped, completed);
  const dailyMinutes = dailyMinutesForTarget(lessons, targetDays, skipped, completed);
  const visible = lessons.filter((lesson) => !skipped.has(lesson.id));
  const done = visible.filter((lesson) => completed.has(lesson.id)).length;
  const percent = visible.length ? Math.round((done / visible.length) * 100) : 0;
  const next = visible.find((lesson) => !completed.has(lesson.id)) ?? visible[0] ?? lessons[0];
  const placement = getDb()
    .prepare("SELECT * FROM placements WHERE user_id = ? AND course_id = ?")
    .get(user.id, course.id) as
    | { skipped: string; score: number; total: number }
    | undefined;
  const notes = getRecentNotes(user.id, 20).filter((note) => note.course_id === course.id);
  const totalSeconds = lessons.reduce(
    (total, lesson) => total + Math.max(0, lesson.end_seconds - lesson.start_seconds),
    0,
  );
  const elapsedDays = enrollment
    ? Math.max(1, Math.floor((Date.now() - Date.parse(enrollment.created_at)) / 86_400_000) + 1)
    : 1;
  const expectedDone = Math.min(visible.length, Math.ceil((visible.length * Math.min(elapsedDays, targetDays)) / targetDays));
  const paceDelta = done - expectedDone;
  const paceLabel = paceDelta >= 0 ? `${paceDelta + 1} lesson${paceDelta === 0 ? "" : "s"} ahead of pace` : `${Math.abs(paceDelta)} lesson${Math.abs(paceDelta) === 1 ? "" : "s"} behind — the plan already covers it`;

  return (
    <>
      <AppHeader user={user} />
      <main className="app-main">
        <div className="app-wrap">
          <Link href="/courses" className="btn btn-ghost btn-sm" style={{ paddingLeft: 0, marginBottom: 18 }}>
            <ArrowLeft size={14} /> All courses
          </Link>

          <section className="course-banner">
            <div className="course-cover-lg">
              {course.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={course.thumbnail} alt="" />
              ) : (
                <div className="course-thumb-fallback"><Play size={30} /></div>
              )}
            </div>
            <div>
              <span className="page-eyebrow">Course · {course.source === "playlist" ? "playlist" : "video"}</span>
              <h1 className="course-detail-title">{course.title}</h1>
              <div className="course-detail-meta">
                <span>{course.author}</span>
                <span className="dot-sep" />
                <span><Clock size={13} style={{ verticalAlign: "-2px" }} /> {formatDuration(totalSeconds || course.duration_seconds)}</span>
                <span className="dot-sep" />
                <span>{visible.length} lessons</span>
                <span className="dot-sep" />
                <span>{quizCount} quizzes</span>
                {course.difficulty ? (
                  <>
                    <span className="dot-sep" />
                    <span style={{ textTransform: "capitalize" }}>{course.difficulty}</span>
                  </>
                ) : null}
                {course.added_by ? (
                  <>
                    <span className="dot-sep" />
                    <span>added by {course.added_by}</span>
                  </>
                ) : null}
              </div>
              {course.course_goal ? (
                <p className="course-goal-line"><Sparkle size={12} /> Goal: {course.course_goal}</p>
              ) : null}
              <div className="course-actions">
                {next ? (
                  <Link
                    href={`/course/${course.id}/lesson/${next.id}?t=${next.start_seconds}`}
                    className="btn btn-primary"
                  >
                    <Play size={14} /> {done > 0 ? "Continue learning" : "Start lesson 1"}
                  </Link>
                ) : null}
                <Link href={`/course/${course.id}/placement`} className="btn btn-outline">
                  <Target size={15} /> {placement ? "Retake placement test" : "Take placement test"}
                </Link>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 13, marginTop: 22 }}>
                <div className="progress" style={{ flex: 1, maxWidth: 360 }}>
                  <span style={{ width: `${percent}%` }} />
                </div>
                <span className="mono muted" style={{ fontSize: "0.68rem" }}>
                  {done}/{visible.length} · {percent}%
                </span>
              </div>
            </div>
          </section>

          <div className="course-layout">
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <span className="page-eyebrow">Your plan</span>
                    <h2 className="panel-title" style={{ marginTop: 4 }}>
                      {plan.length ? `${targetDays}-day finish line · up to ${dailyMinutes} min/study day` : "Course complete"}
                    </h2>
                    {plan.length ? <p className="pace-note">{paceLabel}</p> : null}
                  </div>
                  {skipped.size > 0 ? (
                    <span className="pill">{skipped.size} known · skipped</span>
                  ) : null}
                </div>

                {plan.length ? (
                  <div>
                    {plan.map((day) => (
                      <div key={day.day} style={{ paddingBottom: 10 }}>
                        <div className="plan-day-head">
                          <span className="day-chip today">Day {day.day}</span>
                          <span>{formatDuration(day.totalSeconds)}</span>
                          <span>· {day.lessons.length} lessons</span>
                        </div>
                        <div className="lesson-list">
                          {day.lessons.map((lesson) => (
                            <Link
                              href={`/course/${course.id}/lesson/${lesson.id}?t=${lesson.start_seconds}`}
                              className="lesson-row"
                              key={lesson.id}
                            >
                              <span className="lesson-row-index">{String(lesson.position + 1).padStart(2, "0")}</span>
                              <span className="lesson-row-main">
                                <span className="lesson-row-title">{lesson.title}</span>
                                <span className="lesson-row-meta">
                                  {formatClock(lesson.start_seconds)} · {formatDuration(lesson.end_seconds - lesson.start_seconds)}
                                </span>
                              </span>
                              <span className="lesson-status-icon todo"><Play size={10} /></span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <p>You finished every lesson in this course. That&apos;s a real finish.</p>
                    <Link href="/new" className="btn btn-primary btn-sm">Build the next course</Link>
                  </div>
                )}
              </section>

              <section className="panel">
                <div className="panel-head">
                  <h2 className="panel-title">All lessons</h2>
                  <span className="mini-meta">{lessons.length} lessons</span>
                </div>
                <div className="lesson-list">
                  {lessons.map((lesson) => {
                    const isDone = completed.has(lesson.id);
                    const isKnown = skipped.has(lesson.id);
                    return (
                      <Link
                        href={`/course/${course.id}/lesson/${lesson.id}?t=${lesson.start_seconds}`}
                        className={`lesson-row ${isKnown ? "locked" : ""}`}
                        key={lesson.id}
                      >
                        <span className="lesson-row-index">{String(lesson.position + 1).padStart(2, "0")}</span>
                        <span className="lesson-row-main">
                          <span className="lesson-row-title">{lesson.title}</span>
                          <span className="lesson-row-meta">
                            {formatClock(lesson.start_seconds)} · {formatDuration(lesson.end_seconds - lesson.start_seconds)}
                          </span>
                        </span>
                        <span className={`lesson-status-icon ${isDone ? "done" : isKnown ? "known" : "todo"}`}>
                          {isDone ? <Check size={11} /> : isKnown ? "K" : ""}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </section>

              {notes.length ? (
                <section className="panel">
                  <div className="panel-head">
                    <h2 className="panel-title">Your notes in this course</h2>
                    <span className="mini-meta">{notes.length} pinned</span>
                  </div>
                  <div className="notes-list">
                    {notes.slice(0, 3).map((note) => (
                      <div className="note-item" key={note.id}>
                        <div className="note-item-head">
                          <Note size={12} />
                          <span className="mono">{formatClock(note.time_seconds)}</span>
                          <span>· {note.lesson_title ?? "Lesson"}</span>
                        </div>
                        <p>{note.body}</p>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>

            <aside className="course-side">
              <section className="side-cta">
                <span className="mini-meta" style={{ color: "rgba(15,22,17,0.6)" }}>Placement</span>
                <h3 style={{ marginTop: 6 }}>
                  {placement ? `${JSON.parse(placement.skipped || "[]").length} lessons marked known.` : "Skip what you already know."}
                </h3>
                <p>
                  {placement
                    ? "Your plan now starts after the lessons you proved you know. Retake it any time."
                    : "A 2-minute test finds the lessons you can skip and shortens your plan."}
                </p>
                <Link href={`/course/${course.id}/placement`} className="btn btn-primary btn-sm">
                  <Target size={13} /> {placement ? "Retake test" : "Find my starting point"}
                </Link>
              </section>

              <section className="panel finish-panel">
                <div className="panel-head">
                  <div>
                    <span className="page-eyebrow">Finish line</span>
                    <h2 className="panel-title" style={{ marginTop: 4 }}>Choose your days</h2>
                  </div>
                  <span className="pill">{targetDays}d</span>
                </div>
                <TargetDaysForm
                  courseId={course.id}
                  initialDays={targetDays}
                  remainingLessons={lessons
                    .filter((lesson) => !skipped.has(lesson.id) && !completed.has(lesson.id))
                    .map((lesson) => ({
                      id: lesson.id,
                      title: lesson.title,
                      start_seconds: lesson.start_seconds,
                      end_seconds: lesson.end_seconds,
                      position: lesson.position,
                    }))}
                />
              </section>

              <section className="panel">
                <h2 className="panel-title">Course details</h2>
                <div style={{ marginTop: 14 }} className="plan-summary">
                  <div className="plan-summary-row"><span>Creator</span><span>{course.author}</span></div>
                  <div className="plan-summary-row"><span>Length</span><span>{formatDuration(course.duration_seconds)}</span></div>
                  <div className="plan-summary-row"><span>Lessons</span><span>{lessons.length}</span></div>
                  <div className="plan-summary-row"><span>Quizzes</span><span>{quizCount}</span></div>
                  <div className="plan-summary-row"><span>Finish line</span><span>{targetDays} days</span></div>
                  <div className="plan-summary-row"><span>Longest study day</span><span>{dailyMinutes} min</span></div>
                  <div className="plan-summary-row"><span>Source</span><span>{course.source === "playlist" ? "YouTube playlist" : "YouTube video"}</span></div>
                </div>
                <div className="divider-line" />
                <div className="quick-link" style={{ padding: "4px 0", border: 0 }}>
                  <BookOpen size={14} />
                  <a href={course.youtube_url} target="_blank" rel="noreferrer" style={{ color: "var(--moss)" }}>
                    Watch the original on YouTube
                  </a>
                </div>
              </section>

              <section className="panel" style={{ background: "var(--surface-soft)" }}>
                <span className="page-eyebrow">How your plan works</span>
                <p style={{ marginTop: 8, fontSize: "0.83rem", color: "var(--ink-soft)" }}>
                  Lessons you mark done or prove you know drop out, and the remaining work is
                  respread across your finish line. You can change the days any time.
                </p>
              </section>
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}
