"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, Play, Target } from "./icons";

type Review = {
  id: string;
  lesson_id: string;
  course_id: string;
  lesson_title: string;
  course_title: string;
  question: string;
  options: string;
  answer_index: number;
  explanation: string;
  replay_seconds: number;
  interval_days: number;
  misses: number;
};

export function ReviewClient({ reviews }: { reviews: Review[] }) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<{ correct: boolean; explanation: string; replaySeconds: number; lessonId: string; courseId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(0);

  const review = reviews[index];
  if (!review) {
    return (
      <div className="review-card review-finished">
        <span className="kicker"><Check size={12} /> Review complete</span>
        <h1>You cleared the queue.</h1>
        <p>{done} review{done === 1 ? "" : "s"} done. The schedule will bring them back when they are worth revisiting.</p>
        <Link href="/dashboard" className="btn btn-primary">Back to your desk <ArrowRight size={14} /></Link>
      </div>
    );
  }

  let options: string[] = [];
  try {
    const parsed = JSON.parse(review.options);
    if (Array.isArray(parsed)) options = parsed.map(String);
  } catch {
    options = [];
  }

  async function choose(option: number) {
    if (selected !== null || busy) return;
    setSelected(option);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewId: review.id, answerIndex: option }),
      });
      const data = (await response.json()) as {
        correct?: boolean;
        explanation?: string;
        replaySeconds?: number;
        lessonId?: string;
        courseId?: string;
        error?: string;
      };
      if (!response.ok || typeof data.correct !== "boolean") {
        setError(data.error ?? "Could not save this review.");
        setSelected(null);
        return;
      }
      setResult({
        correct: data.correct,
        explanation: data.explanation ?? "",
        replaySeconds: data.replaySeconds ?? 0,
        lessonId: data.lessonId ?? review.lesson_id,
        courseId: data.courseId ?? review.course_id,
      });
      setDone((value) => value + 1);
    } catch {
      setError("Could not reach the local server.");
      setSelected(null);
    } finally {
      setBusy(false);
    }
  }

  function next() {
    setIndex((value) => value + 1);
    setSelected(null);
    setResult(null);
    setError("");
  }

  return (
    <div className="review-card">
      <div className="review-top">
        <span className="kicker"><Target size={11} /> Due review</span>
        <span className="mini-meta">{index + 1} of {reviews.length}</span>
      </div>
      <span className="review-course">{review.course_title} · {review.lesson_title}</span>
      <h1>{review.question}</h1>
      <div className="review-options">
        {options.map((option, optionIndex) => {
          let className = "option-button";
          if (selected !== null && optionIndex === review.answer_index) className += " correct";
          if (selected !== null && optionIndex === selected && optionIndex !== review.answer_index) className += " wrong";
          return (
            <button
              key={optionIndex}
              type="button"
              className={className}
              disabled={selected !== null}
              onClick={() => void choose(optionIndex)}
            >
              {String.fromCharCode(65 + optionIndex)}. {option}
            </button>
          );
        })}
      </div>

      {error ? <div className="form-error" role="alert">{error}</div> : null}

      {result ? (
        <div className={`quiz-feedback ${result.correct ? "correct" : "wrong"}`}>
          <strong>{result.correct ? "Correct — the next review moves further out." : "Not yet — this comes back tomorrow."}</strong>
          {result.explanation ? <p>{result.explanation}</p> : null}
          <div className="review-result-actions">
            <Link
              href={`/course/${result.courseId}/lesson/${result.lessonId}?t=${result.replaySeconds}`}
              className="btn btn-outline btn-sm"
            >
              <Play size={11} /> Replay the explanation
            </Link>
            <button type="button" className="btn btn-primary btn-sm" onClick={next}>
              Next review <ArrowRight size={13} />
            </button>
          </div>
        </div>
      ) : null}

      {selected === null ? (
        <p className="review-hint">Pick an answer. Wrong answers return tomorrow; correct ones move further out.</p>
      ) : null}
    </div>
  );
}
