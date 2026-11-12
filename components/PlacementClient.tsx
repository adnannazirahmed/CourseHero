"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, Target } from "./icons";

type Question = {
  lessonId: string;
  lessonTitle: string;
  question: string;
  options: string[];
  answerIndex: number;
  replaySeconds: number;
};

export function PlacementClient({
  courseId,
  courseTitle,
  questions,
}: {
  courseId: string;
  courseTitle: string;
  questions: Question[];
}) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const question = questions[index];

  async function finish(finalScore: number, finalSkipped: string[]) {
    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch("/api/placement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          courseId,
          skipped: finalSkipped,
          score: finalScore,
          total: questions.length,
        }),
      });
      if (!response.ok) throw new Error("Could not save your placement result. Try again.");
    } catch {
      setSaveError("Could not save your placement result. Try again.");
      setSaving(false);
      return;
    }
    setSaving(false);
    setFinished(true);
  }

  function choose(option: number) {
    if (answered) return;
    setSelected(option);
    setAnswered(true);
    if (option === question.answerIndex) {
      setScore((value) => value + 1);
      setSkipped((current) => [...new Set([...current, question.lessonId])]);
    }
  }

  async function next() {
    if (!answered) {
      if (index + 1 >= questions.length) {
        await finish(score, skipped);
      } else {
        setIndex((value) => value + 1);
        setSelected(null);
        setAnswered(false);
      }
      return;
    }
    const correct = selected === question.answerIndex;
    const newScore = score;
    const newSkipped = correct ? [...new Set([...skipped, question.lessonId])] : skipped;
    if (index + 1 >= questions.length) {
      await finish(newScore, newSkipped);
    } else {
      setIndex((value) => value + 1);
      setSelected(null);
      setAnswered(false);
    }
  }

  if (finished) {
    const percent = Math.round((score / questions.length) * 100);
    return (
      <div className="placement-card placement-result">
        <span className="kicker">Placement complete</span>
        <div className="streak-number" style={{ marginTop: 20 }}>
          {score}/{questions.length}
        </div>
        <h1 style={{ marginTop: 12 }}>
          {percent >= 70 ? "You can skip the basics." : percent >= 40 ? "A shorter plan is ready." : "Start from the beginning."}
        </h1>
        <p>
          {skipped.length > 0
            ? `${skipped.length} lesson${skipped.length === 1 ? "" : "s"} marked known and removed from your plan.`
            : "No lessons were skipped. Your plan starts at lesson 1."}
        </p>
        {saving ? <p className="muted" style={{ fontSize: "0.76rem" }}>Saving your result…</p> : null}
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 24, flexWrap: "wrap" }}>
          <Link href={`/course/${courseId}`} className="btn btn-primary">
            See your plan <ArrowRight size={14} />
          </Link>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              setIndex(0);
              setSelected(null);
              setAnswered(false);
              setSkipped([]);
              setScore(0);
              setFinished(false);
            }}
          >
            Retake test
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="placement-top">
        <Link href={`/course/${courseId}`} className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }}>
          <ArrowRight size={14} style={{ transform: "rotate(180deg)" }} /> {courseTitle}
        </Link>
        <div className="placement-progress" aria-hidden="true">
          {questions.map((_, dot) => (
            <span key={dot} className={`placement-dot ${dot <= index ? "done" : ""}`} />
          ))}
        </div>
        <span className="mono muted" style={{ fontSize: "0.65rem" }}>{index + 1}/{questions.length}</span>
      </div>

      <div className="placement-card">
        <span className="kicker"><Target size={12} /> Placement test</span>
        <h1 style={{ marginTop: 16 }}>{question.question}</h1>
        <p className="placement-sub">
          From “{question.lessonTitle}”. A correct answer removes that lesson from your plan.
        </p>
        <div className="placement-options">
          {question.options.map((option, optionIndex) => {
            let className = "option-button";
            if (answered && optionIndex === question.answerIndex) className += " correct";
            if (answered && optionIndex === selected && optionIndex !== question.answerIndex) className += " wrong";
            return (
              <button
                key={optionIndex}
                type="button"
                className={className}
                disabled={answered}
                onClick={() => choose(optionIndex)}
              >
                {String.fromCharCode(65 + optionIndex)}. {option}
              </button>
            );
          })}
        </div>

        {answered ? (
          <div className={`quiz-feedback ${selected === question.answerIndex ? "correct" : "wrong"}`}>
            <strong>{selected === question.answerIndex ? "Correct — that lesson is out of your plan." : "Not quite — this lesson stays in your plan."}</strong>
            <p>
              {selected === question.answerIndex
                ? "You can still open it any time from the lesson list."
                : "You'll learn it in the course, with notes and a quiz that replays the explanation."}
            </p>
          </div>
        ) : null}

        <div className="placement-actions">
          <button type="button" className="quiz-skip" onClick={next} disabled={saving}>
            {answered ? "Skip this question" : "I'm not sure — skip"}
          </button>
          <button type="button" className="btn btn-primary" onClick={next} disabled={saving}>
            {saving ? "Saving…" : index + 1 >= questions.length ? "See my plan" : "Next question"}
            <ArrowRight size={14} />
          </button>
        </div>
        {saveError ? <div className="form-error" role="alert">{saveError}</div> : null}
        {answered && selected === question.answerIndex ? (
          <p className="muted" style={{ fontSize: "0.74rem", marginTop: 10, display: "flex", alignItems: "center", gap: 5 }}>
            <Check size={12} /> Marked known. No score to chase — only your plan changes.
          </p>
        ) : null}
      </div>
    </div>
  );
}
