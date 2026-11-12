"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dailyMinutesForTarget, type PlanLesson } from "@/lib/plan";

export function TargetDaysForm({
  courseId,
  initialDays,
  remainingLessons,
}: {
  courseId: string;
  initialDays: number;
  remainingLessons: PlanLesson[];
}) {
  const router = useRouter();
  const [days, setDays] = useState(initialDays);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const estimatedMinutes = dailyMinutesForTarget(remainingLessons, days, new Set(), new Set());

  function update(value: number) {
    setDays(Math.max(1, Math.min(30, Math.round(value) || 1)));
    setMessage("");
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/courses/${courseId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ days }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not save that finish line.");
      } else {
        setMessage(`Plan updated for ${days} day${days === 1 ? "" : "s"}.`);
        router.refresh();
      }
    } catch {
      setMessage("Could not reach the local server.");
    }
    setSaving(false);
  }

  return (
    <div className="finish-form">
      <div className="day-picker">
        <button type="button" className="day-step" onClick={() => update(days - 1)} aria-label="Fewer days">
          −
        </button>
        <input
          className="day-input"
          type="number"
          min={1}
          max={30}
          value={days}
          onChange={(event) => update(Number(event.target.value))}
          aria-label="Days to finish"
        />
        <span className="day-suffix">days</span>
        <button type="button" className="day-step" onClick={() => update(days + 1)} aria-label="More days">
          +
        </button>
      </div>
      <div className="day-presets">
        {[3, 7, 14, 30].map((preset) => (
          <button
            type="button"
            key={preset}
            className={`day-preset ${days === preset ? "active" : ""}`}
            onClick={() => update(preset)}
          >
            {preset}d
          </button>
        ))}
      </div>
      <p className="field-hint">
        Longest study day: <strong>{estimatedMinutes} min</strong>. Finish within 1–30 days.
      </p>
      <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving || days === initialDays}>
        {saving ? "Saving…" : days === initialDays ? "Current finish line" : "Save finish line"}
      </button>
      {message ? <p className="form-note" style={{ textAlign: "left" }}>{message}</p> : null}
    </div>
  );
}
