import Link from "next/link";
import { getLocalUser } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { NewCourseForm } from "@/components/NewCourseForm";
import { ArrowLeft, Check, Clock, Sparkle } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function NewCoursePage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
  const user = getLocalUser();
  const params = await searchParams;

  return (
    <>
      <AppHeader user={user} />
      <main className="app-main">
        <div className="new-wrap">
          <Link href="/dashboard" className="btn btn-ghost btn-sm" style={{ paddingLeft: 0, marginBottom: 18 }}>
            <ArrowLeft size={14} /> Back to your desk
          </Link>
          <div className="new-card">
            <span className="kicker">New course</span>
            <h1 style={{ marginTop: 16 }}>
              Paste a link. Get a course you <em>actually finish.</em>
            </h1>
            <p>
              Choose a finish line from 1 to 30 days. Course Hero builds the lessons, study notes
              and quizzes, then spreads the work across your days — no guessing what to watch today.
            </p>
            <NewCourseForm initialUrl={params.url ?? ""} />
            <div className="new-aside">
              <p><Sparkle size={14} /> Playlists up to 20 hours are supported. Longer playlists are trimmed to the first 20 hours.</p>
              <p><Clock size={14} /> You pick the finish line. The daily plan is rebuilt from the lessons you have left.</p>
              <p><Check size={14} /> Your course, notes, quiz answers and streak are saved to this computer.</p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
