import Link from "next/link";
import { getLocalUser } from "@/lib/auth";
import { getMyCourses, getPendingCourses, getRecentNotes, getStreak, getCourseStats, type CourseRow } from "@/lib/data";
import { recoverStaleGenerations } from "@/lib/generate";
import { dayKey, formatClock, formatDuration, planForTargetDays } from "@/lib/plan";
import { AppHeader } from "@/components/AppHeader";
import { ImportBackupForm } from "@/components/ImportBackupForm";
import { ArrowRight, BookOpen, Flame, Note, Play, Plus, Share, Sparkle, Target } from "@/components/icons";

export const dynamic = "force-dynamic";

type CourseProgress = {
  course: CourseRow;
  total: number;
  skipped: number;
  completed: number;
  percent: number;
  nextLessonId: string | null;
  targetDays: number;
  plan: ReturnType<typeof planForTargetDays>;
};

function progressFor(userId: string, course: CourseRow): CourseProgress {
  const { lessons, skipped, completed } = getCourseStats(userId, course);
  const targetDays = Math.min(
    30,
    Math.max(1, course.enrollment_target_days ?? course.target_days ?? 7),
  );
  const plan = planForTargetDays(lessons, targetDays, skipped, completed);
  const remaining = lessons.filter((lesson) => !skipped.has(lesson.id));
  const percent = remaining.length
    ? Math.round(([...remaining].filter((lesson) => completed.has(lesson.id)).length / remaining.length) * 100)
    : 0;
  const next = lessons.find((lesson) => !skipped.has(lesson.id) && !completed.has(lesson.id));
  return {
    course,
    total: remaining.length,
    skipped: skipped.size,
    completed: [...remaining].filter((lesson) => completed.has(lesson.id)).length,
    percent,
    nextLessonId: next?.id ?? lessons[0]?.id ?? null,
    targetDays,
    plan,
  };
}

export default async function DashboardPage() {
  const user = getLocalUser();
  recoverStaleGenerations();
  const courses = getMyCourses(user.id);
  const pendingCourses = getPendingCourses(user.id);
  const progresses = courses.map((course) => progressFor(user.id, course));
  const active = progresses.find((item) => item.plan.length > 0) ?? progresses[0];
  const today = active?.plan[0];
  const notes = getRecentNotes(user.id, 4);
  const streak = getStreak(user.id);
  const completedLessons = progresses.reduce((total, item) => total + item.completed, 0);
  const totalLessons = progresses.reduce((total, item) => total + item.total, 0);
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  const activitySet = new Set(streak.dates.map((date) => dayKey(new Date(date))));
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    return {
      key: dayKey(date),
      label: date.toLocaleDateString("en-US", { weekday: "narrow" }),
      done: activitySet.has(dayKey(date)),
      today: index === 6,
    };
  });

  return (
    <>
      <AppHeader user={user} />
      <main className="app-main">
        <div className="app-wrap">
          <section className="dash-hero" aria-labelledby="dashboard-title">
            <div className="dash-hero-copy">
              <span className="dash-hero-kicker"><Sparkle size={13} /> Your study space</span>
              <p className="dash-hero-date">{dateLabel}</p>
              <h1 id="dashboard-title">
                Make <em>today</em> count,
                <br /> {user.name.split(" ")[0] || "learner"}.
              </h1>
              <p className="dash-hero-summary">
                {user.goal || "A calm place for the courses, notes and small wins that move you forward."}
              </p>
              <div className="dash-hero-actions">
                {active && today ? (
                  <Link
                    href={`/course/${active.course.id}/lesson/${today.lessons[0].id}?t=${today.lessons[0].start_seconds}`}
                    className="btn btn-coral"
                  >
                    Continue today <ArrowRight size={15} />
                  </Link>
                ) : (
                  <Link href="/new" className="btn btn-coral">
                    Build your first course <Plus size={15} />
                  </Link>
                )}
                <Link href="/courses" className="btn btn-hero-ghost">
                  View library
                </Link>
              </div>
            </div>

            <aside className="dash-hero-focus" aria-label="Study progress overview">
              <div className="dash-focus-head">
                <span>Next up</span>
                <span className="dash-focus-status">{active ? `${active.percent}% complete` : "Ready when you are"}</span>
              </div>
              <h2>{active ? active.course.title : "Your next course starts here"}</h2>
              <p>
                {active && today
                  ? `${today.lessons.length} lesson${today.lessons.length === 1 ? "" : "s"} · ${formatDuration(today.totalSeconds)} planned for today`
                  : "Paste a YouTube link and turn it into a plan you can follow."}
              </p>
              <div className="dash-focus-progress" aria-hidden="true">
                <span style={{ width: `${active?.percent ?? 0}%` }} />
              </div>
              <div className="dash-focus-metrics">
                <div><strong>{courses.length}</strong><span>courses</span></div>
                <div><strong>{completedLessons}</strong><span>lessons done</span></div>
                <div><strong>{streak.count}</strong><span>day streak</span></div>
              </div>
              {totalLessons > 0 ? <span className="dash-focus-foot">{completedLessons} of {totalLessons} lessons complete</span> : null}
            </aside>
          </section>

          <div className="dash-grid">
            <div className="dash-main">
              {pendingCourses.length > 0 ? (
                <section className="panel">
                  <div className="panel-head"><h2 className="panel-title">Builds needing attention</h2></div>
                  <div className="lesson-list">
                    {pendingCourses.map((course) => (
                      <Link className="lesson-row" href={`/course/${course.id}`} key={course.id}>
                        <span className="lesson-row-main">
                          <span className="lesson-row-title">{course.title}</span>
                          <span className="lesson-row-meta">
                            {course.status === "failed" ? "Build failed · Open to retry" : "Building · Open for progress"}
                          </span>
                        </span>
                        <ArrowRight size={14} />
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <span className="page-eyebrow">Today</span>
                    <h2 className="panel-title" style={{ marginTop: 4 }}>
                      {today ? `${today.lessons.length} lesson${today.lessons.length === 1 ? "" : "s"} · ${formatDuration(today.totalSeconds)}` : "Nothing queued"}
                    </h2>
                  </div>
                  {active ? (
                    <Link href={`/course/${active.course.id}`} className="panel-link">
                      Open course <ArrowRight size={13} />
                    </Link>
                  ) : null}
                </div>

                {active && today ? (
                  <>
                    <div className="plan-day-head">
                      <Flame size={12} /> Day 1 of {active.targetDays} · {active.course.title}
                    </div>
                    <div className="plan-list">
                      {today.lessons.slice(0, 5).map((lesson, index) => (
                        <div className="plan-item" key={lesson.id}>
                          <span className="plan-index">{String(index + 1).padStart(2, "0")}</span>
                          <div className="plan-body">
                            <div className="plan-title">{lesson.title}</div>
                            <div className="plan-meta">
                              {formatClock(lesson.start_seconds)} · {formatDuration(lesson.end_seconds - lesson.start_seconds)}
                            </div>
                          </div>
                          <Link
                            href={`/course/${active.course.id}/lesson/${lesson.id}?t=${lesson.start_seconds}`}
                            className="plan-play"
                            aria-label={`Play ${lesson.title}`}
                          >
                            <Play size={12} />
                          </Link>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
                      <Link
                        href={`/course/${active.course.id}/lesson/${today.lessons[0].id}?t=${today.lessons[0].start_seconds}`}
                        className="btn btn-primary btn-sm"
                      >
                        Start today&apos;s plan <ArrowRight size={14} />
                      </Link>
                      <span className="muted" style={{ fontSize: "0.78rem" }}>
                        {active.completed} of {active.total} lessons complete
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="empty-state">
                    <p>
                      {courses.length
                        ? "You finished every lesson in your courses. Build the next one."
                        : "Your desk is empty. Paste a YouTube link and lesson 1 will be ready in a moment."}
                    </p>
                    <Link href="/new" className="btn btn-primary btn-sm">
                      <Plus size={14} /> Build your first course
                    </Link>
                  </div>
                )}
              </section>

              <section className="panel">
                <div className="panel-head">
                  <h2 className="panel-title">Your courses</h2>
                  <Link href="/courses" className="panel-link">All courses <ArrowRight size={13} /></Link>
                </div>
                {progresses.length ? (
                  <div className="course-tiles">
                    {progresses.slice(0, 4).map((item) => (
                      <Link href={`/course/${item.course.id}`} className="course-tile" key={item.course.id}>
                        <div className="course-tile-cover">
                          {item.course.thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={item.course.thumbnail} alt="" loading="lazy" />
                          ) : null}
                        </div>
                        <div className="course-tile-body">
                          <span className="course-tile-title">{item.course.title}</span>
                          <span className="course-tile-meta">
                            {item.completed}/{item.total} lessons · {item.percent}% · {item.targetDays}d
                          </span>
                          <div className="progress"><span style={{ width: `${item.percent}%` }} /></div>
                        </div>
                        <ArrowRight size={15} className="muted" />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <p>No courses yet. Paste a link to build one.</p>
                    <Link href="/new" className="btn btn-outline btn-sm">Paste a YouTube link</Link>
                  </div>
                )}
              </section>

              <section className="panel">
                <div className="panel-head">
                  <h2 className="panel-title">Recent notes</h2>
                  <Link href="/courses" className="panel-link">Find a lesson <ArrowRight size={13} /></Link>
                </div>
                {notes.length ? (
                  <div className="notes-list">
                    {notes.map((note) => (
                      <div className="note-item" key={note.id}>
                        <div className="note-item-head">
                          <Note size={12} />
                          <span>{note.course_title ?? "Course"}</span>
                          <span>·</span>
                          <span className="mono">{formatClock(note.time_seconds)}</span>
                        </div>
                        <p>{note.body}</p>
                        {note.lesson_id ? (
                          <Link href={`/course/${note.course_id}/lesson/${note.lesson_id}?t=${note.time_seconds}`}>
                            Play from this moment →
                          </Link>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <p>Notes you pin while watching will show up here. Each keeps its timestamp.</p>
                  </div>
                )}
              </section>
            </div>

            <aside className="dash-side">
              <section className="streak-card">
                <span className="kicker">Streak</span>
                <div className="streak-number">
                  {streak.count} <span>day{streak.count === 1 ? "" : "s"} in a row</span>
                </div>
                <div className="streak-days">
                  {week.map((day) => (
                    <span className={`streak-day ${day.done ? "done" : ""} ${day.today ? "today" : ""}`} key={day.key}>
                      {day.label}
                    </span>
                  ))}
                </div>
                <p className="streak-foot">
                  {streak.count > 0
                    ? "Show up today and keep it alive. One lesson counts."
                    : "Watch one lesson today to start your streak."}
                </p>
              </section>

              <section className="panel">
                <div className="panel-head">
                  <h2 className="panel-title">Keep going</h2>
                </div>
                <div className="quick-links">
                  <Link href="/new" className="quick-link"><Plus size={15} /> Build a new course</Link>
                  <Link href="/courses" className="quick-link"><BookOpen size={15} /> Browse all courses</Link>
                  <Link href="/roadmaps" className="quick-link"><Share size={15} /> Your roadmaps</Link>
                  <Link href="/api/export" className="quick-link"><Target size={15} /> Export a backup</Link>
                </div>
              </section>

              <section className="panel">
                <div className="panel-head"><h2 className="panel-title">Restore your learning</h2></div>
                <ImportBackupForm />
              </section>

              <section className="panel" style={{ background: "var(--surface-soft)" }}>
                <span className="page-eyebrow">Saved locally</span>
                <p style={{ marginTop: 8, fontSize: "0.84rem", color: "var(--ink-soft)" }}>
                  Your courses, notes and progress live in a SQLite database on this computer.
                  A snapshot is copied to <span className="mono">data/backups</span> every time the
                  server starts.
                </p>
              </section>
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}
