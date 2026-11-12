"use client";

import { useState } from "react";
import { Check, Sparkle } from "./icons";

type Mode = "summary" | "cheatsheet" | "flashcards" | "feedback";
type Flashcard = { front: string; back: string };

export function AiNotesTools({
  courseId,
  lessonId,
  configured,
  canRegenerate,
  onRegenerate,
}: {
  courseId: string;
  lessonId: string;
  configured: boolean;
  canRegenerate: boolean;
  onRegenerate: () => Promise<void>;
}) {
  const [regenerating, setRegenerating] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [explanation, setExplanation] = useState("");

  async function run(nextMode: Mode) {
    if (busy) return;
    if (nextMode === "feedback" && explanation.trim().length < 20) {
      setError("Write at least a couple of sentences first.");
      return;
    }
    setMode(nextMode);
    setBusy(true);
    setError("");
    setText("");
    setCards([]);
    try {
      const response = await fetch("/api/ai/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId, lessonId, mode: nextMode, explanation }),
      });
      const data = (await response.json()) as { text?: string; cards?: Flashcard[]; error?: string };
      if (!response.ok) {
        setError(data.error ?? "The AI request failed.");
        return;
      }
      if (data.cards) setCards(data.cards);
      if (data.text) setText(data.text);
    } catch {
      setError("Could not reach the local server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-notes-tools">
      <div className="ai-notes-head">
        <span className="ai-kicker"><Sparkle size={12} /> AI study tools</span>
        <span className={`ai-status ${configured ? "on" : "off"}`}>{configured ? "AI on" : "AI off"}</span>
      </div>
      <p className="ai-notes-sub">
        Work from this lesson&apos;s notes, your notes, and the transcript.
      </p>
      <div className="ai-tool-buttons">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void run("summary")} disabled={busy}>
          Summarize
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void run("cheatsheet")} disabled={busy}>
          Cheat sheet
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void run("flashcards")} disabled={busy}>
          Flashcards
        </button>
        {canRegenerate ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy || regenerating || !configured}
            onClick={async () => {
              setRegenerating(true);
              await onRegenerate();
              setRegenerating(false);
            }}
          >
            {regenerating ? "Rebuilding…" : "Regenerate notes & quiz"}
          </button>
        ) : null}
      </div>

      {busy ? <div className="ai-thinking"><span className="typing-dot" /> Writing…</div> : null}
      {error ? <div className="form-error" role="alert">{error}</div> : null}

      {cards.length ? (
        <div className="flashcard-grid">
          {cards.map((card, index) => (
            <details className="flashcard" key={index}>
              <summary>{card.front}</summary>
              <p>{card.back}</p>
            </details>
          ))}
        </div>
      ) : null}
      {text ? (
        <div className="ai-output">
          {text.split(/\n{2,}/).map((block, index) => (
            <p key={index}>{block}</p>
          ))}
        </div>
      ) : null}

      <div className="explain-back">
        <span className="input-label">Explain it back</span>
        <textarea
          className="textarea"
          value={explanation}
          onChange={(event) => setExplanation(event.target.value)}
          placeholder="Explain this lesson in your own words. The tutor will point out what you missed."
          maxLength={4000}
        />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => void run("feedback")}
          disabled={busy || explanation.trim().length < 20}
        >
          <Check size={13} /> Grade my explanation
        </button>
      </div>
    </div>
  );
}
