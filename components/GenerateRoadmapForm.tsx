"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Sparkle } from "./icons";

export function GenerateRoadmapForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!goal.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/roadmaps/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal }),
      });
      const data = (await response.json()) as { slug?: string; error?: string };
      if (!response.ok || !data.slug) {
        setError(data.error ?? "Could not generate a roadmap.");
        return;
      }
      router.push(`/roadmap/${data.slug}`);
    } catch {
      setError("Could not reach the local server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="roadmap-create" onSubmit={submit}>
      <div className="field">
        <label htmlFor="roadmap-goal">What do you want to learn?</label>
        <textarea
          className="textarea"
          id="roadmap-goal"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="e.g. Become an AI engineer who can build and deploy a RAG app"
          maxLength={500}
          required
        />
      </div>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || goal.trim().length < 5}>
        <Sparkle size={14} /> {busy ? "Planning your path…" : "Generate my roadmap"} <ArrowRight size={14} />
      </button>
      <p className="field-hint">
        {configured
          ? "AI will choose and order courses already on this computer."
          : "AI is off. The path will be matched from your local course library."}
      </p>
    </form>
  );
}
