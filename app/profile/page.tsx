import Link from "next/link";
import { getLocalUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AppHeader } from "@/components/AppHeader";
import { ArrowLeft, Check, Note } from "@/components/icons";
import { updateProfile } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    error?: string;
  }>;
}) {
  const user = getLocalUser();
  const params = await searchParams;
  const db = getDb();
  const stats = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM enrollments WHERE user_id = ?) AS courses,
        (SELECT COUNT(*) FROM lesson_state WHERE user_id = ? AND completed = 1) AS completed,
        (SELECT COUNT(*) FROM notes WHERE user_id = ?) AS notes,
        (SELECT COUNT(*) FROM roadmaps WHERE owner_id = ?) AS roadmaps`,
    )
    .get(user.id, user.id, user.id, user.id) as {
    courses: number;
    completed: number;
    notes: number;
    roadmaps: number;
  };
  const initials =
    user.name
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "L";

  return (
    <>
      <AppHeader user={user} />
      <main className="app-main">
        <div className="app-wrap" style={{ maxWidth: 900 }}>
          <Link
            href="/dashboard"
            className="btn btn-ghost btn-sm"
            style={{ paddingLeft: 0, marginBottom: 18 }}
          >
            <ArrowLeft size={14} /> Back to dashboard
          </Link>

          <div className="page-head">
            <div>
              <span className="page-eyebrow">Local profile</span>
              <h1 className="page-title">
                Your <em>profile.</em>
              </h1>
              <p className="page-sub">
                Your identity, goal and saved material on this computer.
              </p>
            </div>
          </div>

          {params.saved ? (
            <div className="profile-success">
              <Check size={14} /> Profile saved.
            </div>
          ) : null}
          {params.error ? <div className="form-error" style={{ marginBottom: 16 }}>{params.error}</div> : null}

          <section className="panel profile-panel">
            <div className="profile-identity">
              <span className="avatar profile-avatar">{initials}</span>
              <div>
                <h2>{user.name}</h2>
                <p>Local learner · no account required</p>
              </div>
            </div>

            <form action={updateProfile} className="profile-form">
              <div className="field">
                <label htmlFor="profile-name">Display name</label>
                <input
                  className="input"
                  id="profile-name"
                  name="name"
                  defaultValue={user.name}
                  placeholder="Your name"
                  maxLength={60}
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="profile-goal">Your goal</label>
                <textarea
                  className="textarea profile-goal"
                  id="profile-goal"
                  name="goal"
                  defaultValue={user.goal}
                  placeholder="What are you working toward? For example: Finish the AI Engineer Roadmap in 30 days."
                  maxLength={500}
                />
                <span className="field-hint">
                  A short reminder you can keep with your local profile. Up to 500 characters.
                </span>
              </div>

              <div className="profile-actions">
                <button type="submit" className="btn btn-primary">
                  Save profile
                </button>
                <Link href="/dashboard" className="btn btn-ghost">
                  Cancel
                </Link>
              </div>
            </form>
          </section>

          <section className="panel profile-snapshot">
            <div className="panel-head">
              <div>
                <h2 className="panel-title">Study snapshot</h2>
                <p className="profile-section-sub">Pulled from your local database.</p>
              </div>
            </div>
            <div className="profile-stats">
              <div><strong>{stats.courses}</strong><span>courses</span></div>
              <div><strong>{stats.completed}</strong><span>lessons done</span></div>
              <div><strong>{stats.notes}</strong><span>pinned notes</span></div>
              <div><strong>{stats.roadmaps}</strong><span>roadmaps</span></div>
            </div>
            <div className="profile-snapshot-foot">
              <Note size={13} /> Everything here stays on this computer.
            </div>
          </section>

          <p className="profile-credit">
            Course Hero · local build by <strong>Abhishek Kumar</strong>.
          </p>
        </div>
      </main>
    </>
  );
}
