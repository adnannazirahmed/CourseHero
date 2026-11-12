"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Play, Sparkle } from "./icons";

type Citation = { seconds: number; label: string; text: string };
type Message = { role: "user" | "assistant"; content: string; citations?: Citation[] };
type HistoryItem = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Explain the main idea in simpler terms.",
  "Give me a concrete example from this lesson.",
  "What should I be able to do after this?",
  "What did I probably miss?",
];

export function TutorPanel({
  courseId,
  lessonId,
  configured,
  onSeek,
}: {
  courseId: string;
  lessonId: string;
  configured: boolean;
  onSeek: (seconds: number) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function ask(text: string) {
    const value = text.trim();
    if (!value || busy) return;
    const history: HistoryItem[] = messages
      .slice(-6)
      .map((message) => ({ role: message.role, content: message.content }));
    setMessages((current) => [...current, { role: "user", content: value }]);
    setQuestion("");
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/tutor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId, lessonId, question: value, history }),
      });
      const data = (await response.json()) as {
        answer?: string;
        citations?: Citation[];
        error?: string;
      };
      if (!response.ok || !data.answer) {
        setError(data.error ?? "The tutor could not answer. Try again.");
        return;
      }
      setMessages((current) => [
        ...current,
        { role: "assistant", content: data.answer as string, citations: data.citations ?? [] },
      ]);
    } catch {
      setError("Could not reach the local server. Is it still running?");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <div className="ai-panel">
      <div className="ai-panel-head">
        <div>
          <span className="ai-kicker"><Sparkle size={12} /> Grounded tutor</span>
          <p>Answers come from this lesson&apos;s transcript and your notes. Citations jump the video.</p>
        </div>
        <span className={`ai-status ${configured ? "on" : "off"}`}>
          {configured ? "AI on" : "AI off"}
        </span>
      </div>

      {messages.length === 0 ? (
        <div className="ai-empty">
          <p className="ai-empty-title">Ask about this lesson</p>
          <div className="ai-suggestions">
            {SUGGESTIONS.map((suggestion) => (
              <button key={suggestion} type="button" onClick={() => void ask(suggestion)} disabled={busy}>
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="ai-messages">
          {messages.map((message, index) => (
            <div className={`ai-message ${message.role}`} key={`${message.role}-${index}`}>
              <span className="ai-message-role">{message.role === "user" ? "You" : "Tutor"}</span>
              <div className="ai-message-body">
                {message.content.split(/\n{2,}/).map((paragraph, paragraphIndex) => (
                  <p key={paragraphIndex}>{paragraph}</p>
                ))}
              </div>
              {message.citations?.length ? (
                <div className="ai-citations">
                  {message.citations.slice(0, 6).map((citation, citationIndex) => (
                    <button
                      key={`${citation.seconds}-${citationIndex}`}
                      type="button"
                      className="ai-citation"
                      onClick={() => onSeek(citation.seconds)}
                      title={citation.text}
                    >
                      <Play size={8} /> {citation.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {busy ? <div className="ai-thinking"><span className="typing-dot" /> Reading the lesson…</div> : null}
      {error ? <div className="form-error" role="alert">{error}</div> : null}

      <form className="ai-form" onSubmit={submit}>
        <input
          className="input"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask anything about this lesson…"
          aria-label="Ask the tutor"
          disabled={busy}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !question.trim()}>
          Ask <ArrowRight size={13} />
        </button>
      </form>
    </div>
  );
}
