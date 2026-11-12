"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LinkIcon } from "./icons";

export function NewCourseForm({ initialUrl = "" }: { initialUrl?: string }) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function updateDays(value: number) {
    setDays(Math.max(1, Math.min(30, Math.round(value) || 1)));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/courses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim(), days }),
      });
      const data = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !data.id) {
        setError(data.error ?? "Something went wrong. Check the link and try again.");
        setBusy(false);
        return;
      }
      router.push(`/course/${data.id}`);
    } catch {
      setError("Could not reach the local server. Is it still running?");
      setBusy(false);
    }
  }

  return (
    <form className="new-form" onSubmit={onSubmit}>
      {error ? <div className="form-error">{error}</div> : null}
      <div className="field">
        <label className="input-label" htmlFor="course-url">YouTube video or playlist</label>
        <div className="url-row">
          <div style={{ position: "relative", flex: 1 }}>
            <LinkIcon
              size={17}
              style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--ink-soft)" }}
            />
            <input
              id="course-url"
              className="url-input"
              style={{ paddingLeft: 43 }}
              placeholder="https://www.youtube.com/watch?v=…"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              disabled={busy}
              autoFocus
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Building…" : "Build course"} {!busy ? <ArrowRight size={15} /> : null}
          </button>
        </div>
      </div>

      <div className="field">
        <span className="input-label">Finish this course in</span>
        <div className="day-picker-row">
          <div className="day-picker">
            <button type="button" className="day-step" onClick={() => updateDays(days - 1)} aria-label="Fewer days">−</button>
            <input
              className="day-input"
              type="number"
              min={1}
              max={30}
              value={days}
              onChange={(event) => updateDays(Number(event.target.value))}
              disabled={busy}
              aria-label="Days to finish"
            />
            <span className="day-suffix">days</span>
            <button type="button" className="day-step" onClick={() => updateDays(days + 1)} aria-label="More days">+</button>
          </div>
          <div className="day-presets">
            {[1, 3, 7, 14, 30].map((preset) => (
              <button
                type="button"
                key={preset}
                className={`day-preset ${days === preset ? "active" : ""}`}
                onClick={() => updateDays(preset)}
                disabled={busy}
              >
                {preset}d
              </button>
            ))}
          </div>
        </div>
        <p className="field-hint">
          Pick any finish line from <strong>1 to 30 days</strong>. We&apos;ll spread the lessons across
          those days, so you know exactly what today looks like.
        </p>
      </div>

      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
        {busy ? "Planning lessons, notes and quizzes…" : "Build my course"}
      </button>
    </form>
  );
}
