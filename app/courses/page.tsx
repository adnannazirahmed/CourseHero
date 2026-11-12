import Link from "next/link";
import { getLocalUser } from "@/lib/auth";
import { getCatalog, getCompletedIds, getLessons, getSkippedIds } from "@/lib/data";
import { AppHeader } from "@/components/AppHeader";
import { CourseCard } from "@/components/CourseCard";
import { ArrowRight, Plus } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function CoursesPage() {
  const user = getLocalUser();
  const courses = getCatalog();

  return (
    <>
      <AppHeader user={user} />
      <main className="app-main">
        <div className="app-wrap">
          <div className="page-head">
            <div>
              <span className="page-eyebrow">Course library</span>
              <h1 className="page-title">
                Your <em>courses.</em>
              </h1>
              <p className="page-sub">
                Courses built on this computer. Open one to continue where you left off.
              </p>
            </div>
            <Link href="/new" className="btn btn-primary">
              <Plus size={15} /> Build a course
            </Link>
          </div>

          <div className="catalog-tools">
            <span className="chip accent-chip">{courses.length} course{courses.length === 1 ? "" : "s"} on this computer</span>
          </div>

          {courses.length ? (
            <div className="catalog-grid">
              {courses.map((course) => {
                const lessons = getLessons(course.id);
                const completed = getCompletedIds(user.id, course.id);
                const skipped = getSkippedIds(user.id, course.id);
                const visible = lessons.filter((lesson) => !skipped.has(lesson.id));
                const done = visible.filter((lesson) => completed.has(lesson.id)).length;
                return (
                  <div key={course.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <CourseCard course={course} />
                    {done > 0 ? (
                      <div style={{ padding: "0 10px 6px" }}>
                        <div className="progress"><span style={{ width: `${Math.round((done / Math.max(1, visible.length)) * 100)}%` }} /></div>
                        <span className="muted" style={{ fontSize: "0.7rem", display: "inline-block", marginTop: 5 }}>
                          {done} of {visible.length} lessons complete
                        </span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <p>No public courses yet. Build the first one from any YouTube link.</p>
              <Link href="/new" className="btn btn-primary btn-sm">
                Paste a link <ArrowRight size={14} />
              </Link>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
