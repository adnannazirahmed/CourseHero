"use client";

import { useState } from "react";
import { ArrowRight, Sparkle } from "./icons";
import type { CoachContent } from "@/lib/coach";

export function WeeklyCoach({ initial }: { initial: CoachContent | null }) {
  const [coach, setCoach] = useState<CoachContent | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh: Boolean(coach) }),
      });
      const data = (await response.json()) as CoachContent & { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not build your review.");
        return;
      }
      setCoach(data);
    } catch {
      setError("Could not reach the local server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="coach-card">
      <div className="coach-head">
        <span className="kicker"><Sparkle size={11} /> Weekly coach</span>
        {coach ? (
          <button type="button" className="coach-refresh" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Thinking…" : "Refresh"}
          </button>
        ) : null}
      </div>

      {coach ? (
        <>
          <p className="coach-summary">{coach.summary}</p>
          <div className="coach-focus">
            <span>Focus</span>
            <strong>{coach.focus}</strong>
          </div>
          <ol className="coach-actions">
            {coach.actions.map((action, index) => (
              <li key={index}>{action}</li>
            ))}
          </ol>
          {!coach.generated ? <p className="coach-foot">Local summary · configure AI for a written coach</p> : null}
        </>
      ) : (
        <>
          <p className="coach-summary">
            Turn this week&apos;s lessons, quiz answers and due reviews into a short plan.
          </p>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Reading your week…" : "Build my weekly review"} <ArrowRight size={13} />
          </button>
        </>
      )}
      {error ? <div className="form-error" role="alert">{error}</div> : null}
    </section>
  );
}
