"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Sparkle } from "./icons";

type Status = "generating" | "ready" | "failed";

export function CourseGenerating({
  courseId,
  initialStatus,
  initialError,
  initialTitle,
  isOwner,
}: {
  courseId: string;
  initialStatus: Status;
  initialError: string | null;
  initialTitle: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initialStatus);
  const [error, setError] = useState<string | null>(initialError);
  const [title, setTitle] = useState(initialTitle);
  const [lessonCount, setLessonCount] = useState(0);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (status !== "generating") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/courses/${courseId}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as {
          status?: Status;
          title?: string;
          error?: string | null;
          lessonCount?: number;
        };
        if (cancelled) return;
        if (data.title && data.title !== "Building your course…" && data.title !== "Building your playlist course…") {
          setTitle(data.title);
        }
        setLessonCount(data.lessonCount ?? 0);
        if (data.status === "ready") {
          router.refresh();
          return;
        }
        if (data.status === "failed") {
          setStatus("failed");
          setError(data.error ?? "We couldn't build this course.");
        }
      } catch {
        // Keep polling; the server may be busy writing lessons.
      }
    };
    void poll();
    const timer = window.setInterval(poll, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [courseId, status, router]);

  async function retry() {
    setRetrying(true);
    setError(null);
    setStatus("generating");
    try {
      const response = await fetch(`/api/courses/${courseId}`, { method: "POST" });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Could not restart generation.");
      }
      setRetrying(false);
    } catch (cause) {
      setRetrying(false);
      setStatus("failed");
      setError(cause instanceof Error ? cause.message : "Could not restart generation. Try again.");
    }
  }

  return (
    <div className="generating-card">
      {status === "generating" ? (
        <>
          <span className="kicker">Building your course</span>
          <h1 style={{ marginTop: 16 }}>{title}</h1>
          <p>
            Reading the video, splitting it into lessons, and writing study notes and quizzes.
            Lessons are ready when the build finishes.
          </p>
          <div className="spinner" />
          <div className="loading-line"><span /></div>
          <p className="mono" style={{ fontSize: "0.66rem", letterSpacing: "0.08em", marginTop: 16 }}>
            {lessonCount > 0 ? `${lessonCount} lessons written` : "Reading the transcript…"}
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 24, flexWrap: "wrap" }}>
            <Link href="/dashboard" className="btn btn-outline btn-sm">
              <ArrowLeft size={13} /> Back to your desk
            </Link>
            <Link href="/new" className="btn btn-ghost btn-sm">Build another</Link>
          </div>
        </>
      ) : (
        <>
          <span className="kicker" style={{ background: "var(--err-bg)", color: "var(--err-fg)" }}>
            Course needs attention
          </span>
          <h1 style={{ marginTop: 16 }}>{title}</h1>
          <p>
            {error ?? "We couldn't read this video. It may be private, age-restricted, or have no captions."}
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 22, flexWrap: "wrap" }}>
            {isOwner ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={retry} disabled={retrying}>
                <Sparkle size={13} /> {retrying ? "Restarting…" : "Try again"}
              </button>
            ) : null}
            <Link href="/new" className="btn btn-outline btn-sm">Paste a different link</Link>
            <Link href="/dashboard" className="btn btn-ghost btn-sm">Your desk</Link>
          </div>
          <p className="muted" style={{ fontSize: "0.78rem", marginTop: 22 }}>
            The course record is saved. Open it again to retry this build.
          </p>
        </>
      )}
    </div>
  );
}
