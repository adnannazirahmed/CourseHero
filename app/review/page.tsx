import Link from "next/link";
import { getLocalUser } from "@/lib/auth";
import { getDueReviews } from "@/lib/reviews";
import { AppHeader } from "@/components/AppHeader";
import { ReviewClient } from "@/components/ReviewClient";
import { ArrowLeft, Check, Target } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const user = getLocalUser();
  const reviews = getDueReviews(user.id, 30).map((review) => ({ ...review }));

  return (
    <>
      <AppHeader user={user} />
      <main className="app-main">
        <div className="app-wrap" style={{ maxWidth: 780 }}>
          <Link href="/dashboard" className="btn btn-ghost btn-sm" style={{ paddingLeft: 0, marginBottom: 18 }}>
            <ArrowLeft size={14} /> Back to dashboard
          </Link>
          <div className="page-head">
            <div>
              <span className="page-eyebrow">Adaptive review</span>
              <h1 className="page-title">Make it <em>stick.</em></h1>
              <p className="page-sub">Questions you missed come back at useful intervals.</p>
            </div>
            <span className="pill"><Target size={12} /> {reviews.length} due</span>
          </div>

          {reviews.length ? (
            <ReviewClient reviews={reviews} />
          ) : (
            <div className="review-card review-finished">
              <span className="kicker"><Check size={12} /> All clear</span>
              <h1>Nothing due right now.</h1>
              <p>Answer quizzes in your courses and any misses will appear here on a review schedule.</p>
              <Link href="/courses" className="btn btn-primary">Open your courses</Link>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
