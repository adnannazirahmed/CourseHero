import Link from "next/link";
import { getLocalUser } from "@/lib/auth";
import { searchLibrary } from "@/lib/search";
import { AppHeader } from "@/components/AppHeader";
import { ArrowLeft, ArrowRight, BookOpen, Clock, Note, Search } from "@/components/icons";
import { formatClock } from "@/lib/plan";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = getLocalUser();
  const params = await searchParams;
  const results = searchLibrary(user.id, params.q ?? "");
  const count =
    results.courses.length + results.lessons.length + results.notes.length + results.transcripts.length;

  return (
    <>
      <AppHeader user={user} />
      <main className="app-main">
        <div className="app-wrap" style={{ maxWidth: 900 }}>
          <Link href="/dashboard" className="btn btn-ghost btn-sm" style={{ paddingLeft: 0, marginBottom: 18 }}>
            <ArrowLeft size={14} /> Back to dashboard
          </Link>
          <div className="page-head">
            <div>
              <span className="page-eyebrow">Search everything</span>
              <h1 className="page-title">Find the <em>moment.</em></h1>
              <p className="page-sub">Courses, lessons, notes and transcripts on this computer.</p>
            </div>
          </div>

          <form className="search-bar" action="/search" method="get">
            <Search size={16} />
            <input
              name="q"
              defaultValue={results.query}
              placeholder="Search a concept, phrase or course…"
              aria-label="Search your library"
              autoFocus
            />
            <button type="submit" className="btn btn-primary btn-sm">Search</button>
          </form>

          {results.query.length >= 2 ? (
            <p className="search-count">{count} result{count === 1 ? "" : "s"} for “{results.query}”</p>
          ) : (
            <p className="search-count">Type at least two characters to search.</p>
          )}

          {results.courses.length ? (
            <section className="panel search-section">
              <div className="panel-head"><h2 className="panel-title">Courses</h2></div>
              <div className="lesson-list">
                {results.courses.map((course) => (
                  <Link key={course.id} href={`/course/${course.id}`} className="lesson-row">
                    <span className="lesson-status-icon todo"><BookOpen size={11} /></span>
                    <span className="lesson-row-main">
                      <span className="lesson-row-title">{course.title}</span>
                      <span className="lesson-row-meta">{course.author}</span>
                    </span>
                    <ArrowRight size={14} />
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {results.lessons.length ? (
            <section className="panel search-section">
              <div className="panel-head"><h2 className="panel-title">Lessons</h2></div>
              <div className="lesson-list">
                {results.lessons.map((lesson) => (
                  <Link
                    key={lesson.id}
                    href={`/course/${lesson.course_id}/lesson/${lesson.id}?t=${lesson.start_seconds}`}
                    className="lesson-row"
                  >
                    <span className="lesson-row-index">{String(lesson.position + 1).padStart(2, "0")}</span>
                    <span className="lesson-row-main">
                      <span className="lesson-row-title">{lesson.title}</span>
                      <span className="lesson-row-meta">{lesson.course_title}</span>
                    </span>
                    <ArrowRight size={14} />
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {results.notes.length ? (
            <section className="panel search-section">
              <div className="panel-head"><h2 className="panel-title">Your notes</h2></div>
              <div className="notes-list">
                {results.notes.map((note) => (
                  <Link
                    key={note.id}
                    href={`/course/${note.course_id}${note.lesson_id ? `/lesson/${note.lesson_id}?t=${note.time_seconds}` : ""}`}
                    className="note-item search-note"
                  >
                    <div className="note-item-head">
                      <Note size={12} />
                      <span>{note.course_title}</span>
                      <span>·</span>
                      <span className="mono">{formatClock(note.time_seconds)}</span>
                    </div>
                    <p>{note.body}</p>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {results.transcripts.length ? (
            <section className="panel search-section">
              <div className="panel-head"><h2 className="panel-title">Transcript moments</h2></div>
              <div className="transcript-results">
                {results.transcripts.map((hit, index) => (
                  <Link
                    key={`${hit.course_id}-${hit.video_id}-${hit.start_seconds}-${index}`}
                    href={`/course/${hit.course_id}`}
                    className="transcript-hit"
                  >
                    <span className="transcript-hit-head">
                      <Clock size={11} /> {formatClock(hit.start_seconds)} · {hit.course_title}
                    </span>
                    <p>{hit.text.slice(0, 280)}…</p>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </main>
    </>
  );
}
