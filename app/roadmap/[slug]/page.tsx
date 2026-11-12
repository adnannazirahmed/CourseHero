import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocalUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getCompletedIds, getSkippedIds } from "@/lib/data";
import { formatDuration } from "@/lib/plan";
import { AppHeader } from "@/components/AppHeader";
import { ArrowLeft, ArrowRight, Check, Layers, Play } from "@/components/icons";
import { enrollInRoadmap } from "@/app/roadmaps/actions";

export const dynamic = "force-dynamic";

type RoadmapRow = {
  id: string;
  owner_id: string;
  title: string;
  slug: string;
  description: string;
  created_at: string;
};

type StageCourse = {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
  duration_seconds: number;
  target_days: number;
  position: number;
};

export default async function RoadmapPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ enrolled?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const db = getDb();
  const roadmap = db
    .prepare("SELECT * FROM roadmaps WHERE slug = ?")
    .get(slug) as RoadmapRow | undefined;
  if (!roadmap) notFound();

  const stages = db
    .prepare(
      `SELECT c.id, c.title, c.author, c.thumbnail, c.duration_seconds, c.target_days, i.position
       FROM roadmap_items i JOIN courses c ON c.id = i.course_id
       WHERE i.roadmap_id = ? ORDER BY i.position ASC`,
    )
    .all(roadmap.id) as StageCourse[];
  const user = getLocalUser();
  const enrolled = Boolean(
    db
      .prepare("SELECT id FROM roadmap_enrollments WHERE roadmap_id = ? AND user_id = ?")
      .get(roadmap.id, user.id),
  );
  const totalSeconds = stages.reduce((total, stage) => total + stage.duration_seconds, 0);

  return (
    <>
      <AppHeader user={user} />
      <main className="app-main">
        <div className="app-wrap" style={{ maxWidth: 900 }}>
          <Link
            href="/roadmaps"
            className="btn btn-ghost btn-sm"
            style={{ paddingLeft: 0, marginBottom: 18 }}
          >
            <ArrowLeft size={14} /> All roadmaps
          </Link>

          <div className="page-head">
            <div>
              <span className="page-eyebrow">Local roadmap</span>
              <h1 className="page-title">{roadmap.title}</h1>
              <p className="page-sub">
                {roadmap.description || "Courses in the order you want to study them."}
              </p>
              <div className="course-detail-meta" style={{ marginTop: 12 }}>
                <span>{stages.length} stages</span>
                <span className="dot-sep" />
                <span>{formatDuration(totalSeconds)} of video</span>
              </div>
            </div>
            {enrolled ? (
              <Link href="/dashboard" className="btn btn-primary">
                Open dashboard <ArrowRight size={14} />
              </Link>
            ) : (
              <form action={enrollInRoadmap}>
                <input type="hidden" name="slug" value={roadmap.slug} />
                <button type="submit" className="btn btn-primary">
                  Add path to dashboard <ArrowRight size={14} />
                </button>
              </form>
            )}
          </div>

          {query.enrolled ? (
            <div className="pill" style={{ marginBottom: 16 }}>
              <Check size={13} /> Added. Every course in this path is now in your dashboard.
            </div>
          ) : null}

          <section className="roadmap-card" style={{ padding: 24 }}>
            <div className="spread">
              <span className="kicker"><Layers size={11} /> Stages</span>
              <span className="mini-meta">In order</span>
            </div>
            <div className="roadmap-stage-list" style={{ marginTop: 8 }}>
              {stages.map((stage, index) => {
                const skipped = getSkippedIds(user.id, stage.id);
                const completed = getCompletedIds(user.id, stage.id);
                const lessons = db
                  .prepare("SELECT id FROM lessons WHERE course_id = ?")
                  .all(stage.id) as Array<{ id: string }>;
                const total = lessons.filter((lesson) => !skipped.has(lesson.id)).length;
                const done = lessons.filter(
                  (lesson) => !skipped.has(lesson.id) && completed.has(lesson.id),
                ).length;
                return (
                  <div className="stage-row" key={stage.id} style={{ padding: "16px 0" }}>
                    <span className="stage-num" style={{ marginTop: 2 }}>{index + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 500, fontSize: "0.95rem" }}>{stage.title}</span>
                        <span className="stage-meta">{stage.author}</span>
                      </div>
                      <div className="muted" style={{ fontSize: "0.76rem", marginTop: 3 }}>
                        {formatDuration(stage.duration_seconds)} · {stage.target_days}-day plan
                        {total > 0 ? ` · ${done}/${total} complete` : ""}
                      </div>
                      {total > 0 ? (
                        <div className="progress" style={{ maxWidth: 280, marginTop: 7 }}>
                          <span style={{ width: `${Math.round((done / total) * 100)}%` }} />
                        </div>
                      ) : null}
                    </div>
                    <Link
                      href={`/course/${stage.id}`}
                      className="btn btn-outline btn-sm"
                      style={{ flex: "none", marginTop: 2 }}
                    >
                      <Play size={12} /> Open
                    </Link>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="panel" style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <p style={{ flex: 1, fontSize: "0.86rem", color: "var(--ink-soft)" }}>
              This roadmap is stored in the local Course Hero database on this computer.
            </p>
            <Link href="/roadmaps" className="btn btn-outline btn-sm">
              Manage roadmaps
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
