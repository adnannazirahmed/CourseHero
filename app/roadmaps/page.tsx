import Link from "next/link";
import { getLocalUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getCatalog } from "@/lib/data";
import { AppHeader } from "@/components/AppHeader";
import { ArrowRight, Layers, Plus } from "@/components/icons";
import { createRoadmap } from "./actions";

export const dynamic = "force-dynamic";

type RoadmapSummary = {
  id: string;
  slug: string;
  title: string;
  description: string;
  created_at: string;
  stages: number;
};

export default async function RoadmapsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = getLocalUser();
  const params = await searchParams;
  const db = getDb();
  const roadmaps = db
    .prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM roadmap_items i WHERE i.roadmap_id = r.id) AS stages
       FROM roadmaps r
       WHERE r.owner_id = ? OR r.id IN (SELECT roadmap_id FROM roadmap_enrollments WHERE user_id = ?)
       ORDER BY r.created_at DESC`,
    )
    .all(user.id, user.id) as RoadmapSummary[];
  const courses = getCatalog();

  return (
    <>
      <AppHeader user={user} />
      <main className="app-main">
        <div className="app-wrap">
          <div className="page-head">
            <div>
              <span className="page-eyebrow">Roadmaps</span>
              <h1 className="page-title">
                Your <em>roadmaps.</em>
              </h1>
              <p className="page-sub">
                Group courses into an ordered study path. Everything stays on this computer.
              </p>
            </div>
            <Link href="/courses" className="btn btn-outline">
              <Layers size={15} /> Browse courses
            </Link>
          </div>

          <div className="dash-grid">
            <div className="dash-main">
              {roadmaps.length ? (
                <div className="roadmap-grid">
                  {roadmaps.map((roadmap) => (
                    <article className="roadmap-card" key={roadmap.id}>
                      <div className="spread">
                        <span className="kicker"><Layers size={11} /> Roadmap</span>
                        <span className="mini-meta">{roadmap.stages} stages</span>
                      </div>
                      <h2>{roadmap.title}</h2>
                      <p>{roadmap.description || "A path through the courses you want to finish."}</p>
                      <div className="roadmap-stage-list">
                        {(db
                          .prepare(
                            `SELECT c.id, c.title, c.duration_seconds FROM roadmap_items i
                             JOIN courses c ON c.id = i.course_id
                             WHERE i.roadmap_id = ? ORDER BY i.position ASC LIMIT 4`,
                          )
                          .all(roadmap.id) as Array<{ id: string; title: string; duration_seconds: number }>)
                          .map((course, index) => (
                            <div className="stage-row" key={course.id}>
                              <span className="stage-num">{index + 1}</span>
                              <span className="stage-title">{course.title}</span>
                            </div>
                          ))}
                      </div>
                      <Link href={`/roadmap/${roadmap.slug}`} className="btn btn-primary btn-sm">
                        Open roadmap <ArrowRight size={13} />
                      </Link>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <h2 className="panel-title">No roadmaps yet.</h2>
                  <p>Build a path from the courses already on this computer.</p>
                  <Link href="#new-roadmap" className="btn btn-primary btn-sm">
                    <Plus size={14} /> Create your first roadmap
                  </Link>
                </div>
              )}
            </div>

            <aside className="dash-side">
              <section className="panel" id="new-roadmap">
                <div className="panel-head">
                  <h2 className="panel-title">New roadmap</h2>
                </div>
                {params.error ? <div className="form-error" style={{ marginBottom: 12 }}>{params.error}</div> : null}
                <form action={createRoadmap} className="roadmap-create">
                  <div className="field">
                    <label htmlFor="roadmap-title">Title</label>
                    <input
                      className="input"
                      id="roadmap-title"
                      name="title"
                      placeholder="AI Engineer Roadmap"
                      required
                      maxLength={100}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="roadmap-description">Description</label>
                    <textarea
                      className="textarea"
                      id="roadmap-description"
                      name="description"
                      placeholder="From Python fundamentals to production AI apps."
                      maxLength={500}
                    />
                  </div>
                  <div className="field">
                    <span className="input-label">Courses, in order</span>
                    <div className="check-list">
                      {courses.map((course) => (
                        <label className="check-row" key={course.id}>
                          <input type="checkbox" name="courseIds" value={course.id} />
                          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {course.title}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <button type="submit" className="btn btn-primary btn-block">
                    <Plus size={14} /> Create roadmap
                  </button>
                </form>
              </section>

              <section className="panel" style={{ background: "var(--surface-soft)" }}>
                <span className="page-eyebrow">Local only</span>
                <p style={{ marginTop: 8, fontSize: "0.83rem", color: "var(--ink-soft)" }}>
                  Roadmaps and progress live in the local database. Nothing is published or shared.
                </p>
              </section>
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}
