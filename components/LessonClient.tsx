"use client";

import Link from "next/link";
import { FormEvent, ReactNode, useState } from "react";
import { formatClock, parseClock } from "@/lib/plan";
import { ArrowLeft, ArrowRight, Check, Clock, Note, Play, Trash } from "./icons";

type LessonDTO = {
  id: string;
  position: number;
  title: string;
  start_seconds: number;
  end_seconds: number;
  video_id: string | null;
  notes: string;
};

type QuizDTO = {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  replaySeconds: number;
};

type NoteDTO = { id: string; body: string; time_seconds: number };

type SidebarLesson = {
  id: string;
  position: number;
  title: string;
  start_seconds: number;
  completed: boolean;
  known: boolean;
};

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={index}>{part.slice(1, -1)}</code>;
        }
        if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
          return <em key={index}>{part.slice(1, -1)}</em>;
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

function StudyNotes({ markdown }: { markdown: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {bullets.map((bullet, index) => (
          <li key={index}><Inline text={bullet} /></li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  markdown.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) {
      flushBullets();
      return;
    }
    if (line.startsWith("### ")) {
      flushBullets();
      blocks.push(<h3 key={index}>{line.slice(4)}</h3>);
      return;
    }
    if (line.startsWith("## ")) {
      flushBullets();
      blocks.push(<h3 key={index}>{line.slice(3)}</h3>);
      return;
    }
    if (line.startsWith("- ")) {
      bullets.push(line.slice(2));
      return;
    }
    if (line.startsWith("> ")) {
      flushBullets();
      blocks.push(<blockquote key={index}><Inline text={line.slice(2)} /></blockquote>);
      return;
    }
    flushBullets();
    blocks.push(<p key={index}><Inline text={line} /></p>);
  });
  flushBullets();
  return <div className="study-notes">{blocks}</div>;
}

export function LessonClient({
  course,
  lesson,
  quiz,
  initialStart,
  initialCompleted,
  initialNotes,
  initialPersonalNote,
  sidebarLessons,
  initialDoneCount,
  nextLesson,
}: {
  course: { id: string; title: string; youtube_id: string | null };
  lesson: LessonDTO;
  quiz: QuizDTO | null;
  initialStart: number;
  initialCompleted: boolean;
  initialNotes: NoteDTO[];
  initialPersonalNote: string;
  sidebarLessons: SidebarLesson[];
  initialDoneCount: number;
  nextLesson: { id: string; title: string; startSeconds: number } | null;
}) {
  const [startAt, setStartAt] = useState(Math.max(0, initialStart));
  const [playerKey, setPlayerKey] = useState(0);
  const [completed, setCompleted] = useState(initialCompleted);
  const [doneCount, setDoneCount] = useState(initialDoneCount);
  const [notes, setNotes] = useState(initialNotes);
  const [noteBody, setNoteBody] = useState("");
  const [noteTime, setNoteTime] = useState(formatClock(initialStart));
  const [noteBusy, setNoteBusy] = useState(false);
  const [personalNote, setPersonalNote] = useState(initialPersonalNote);
  const [savedPersonalNote, setSavedPersonalNote] = useState(initialPersonalNote);
  const [personalBusy, setPersonalBusy] = useState(false);
  const [personalStatus, setPersonalStatus] = useState("");
  const [tab, setTab] = useState<"study" | "notes">("study");
  const [selected, setSelected] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const duration = Math.max(0, lesson.end_seconds - lesson.start_seconds);
  const visibleTotal = sidebarLessons.filter((item) => !item.known).length;
  const percent = visibleTotal ? Math.round((doneCount / visibleTotal) * 100) : 0;
  const videoId = lesson.video_id || course.youtube_id;

  function replay(seconds: number) {
    setStartAt(Math.max(0, seconds));
    setPlayerKey((key) => key + 1);
    document.querySelector(".player-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function toggleComplete() {
    const next = !completed;
    setSaveError("");
    setCompleted(next);
    setDoneCount((count) => Math.max(0, count + (next ? 1 : -1)));
    try {
      const response = await fetch("/api/progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lessonId: lesson.id, completed: next }),
      });
      if (!response.ok) throw new Error("Could not save your progress. Try again.");
    } catch {
      setCompleted(!next);
      setDoneCount((count) => Math.max(0, count + (next ? -1 : 1)));
      setSaveError("Could not save your progress. Try again.");
    }
  }

  async function chooseOption(index: number) {
    if (answered || !quiz) return;
    setSelected(index);
    setAnswered(true);
    const correct = index === quiz.answerIndex;
    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch("/api/progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lessonId: lesson.id,
          quizAnswer: index,
          quizCorrect: correct,
          ...(correct ? { completed: true } : {}),
        }),
      });
      if (!response.ok) throw new Error("Could not save your answer. Try again.");
      if (correct && !completed) {
        setCompleted(true);
        setDoneCount((count) => count + 1);
      }
    } catch {
      setAnswered(false);
      setSelected(null);
      setSaveError("Could not save your answer. Please choose again.");
    }
    setSaving(false);
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = noteBody.trim();
    if (!body || noteBusy) return;
    setNoteBusy(true);
    setSaveError("");
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          courseId: course.id,
          lessonId: lesson.id,
          body,
          timeSeconds: parseClock(noteTime),
        }),
      });
      const data = (await response.json()) as { note?: NoteDTO; error?: string };
      if (response.ok && data.note) {
        setNotes((current) => [data.note as NoteDTO, ...current]);
        setNoteBody("");
      } else {
        setSaveError(data.error ?? "Could not save the note. Try again.");
      }
    } catch {
      setSaveError("Could not save the note. Try again.");
    }
    setNoteBusy(false);
  }

  async function savePersonalNote() {
    if (personalBusy) return;
    setPersonalBusy(true);
    setPersonalStatus("");
    try {
      const response = await fetch("/api/notes", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId: course.id, lessonId: lesson.id, body: personalNote }),
      });
      const data = (await response.json()) as { error?: string };
      if (response.ok) setSavedPersonalNote(personalNote);
      setPersonalStatus(response.ok ? "Saved" : data.error ?? "Could not save your notes.");
    } catch {
      setPersonalStatus("Could not reach the local server.");
    }
    setPersonalBusy(false);
  }

  async function deleteNote(id: string) {
    const previous = notes;
    setSaveError("");
    setNotes((current) => current.filter((note) => note.id !== id));
    try {
      const response = await fetch("/api/notes", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error("Could not delete the note.");
    } catch {
      setNotes(previous);
      setSaveError("Could not delete the note. Try again.");
    }
  }

  return (
    <>
      <div className="lesson-top">
        <Link href={`/course/${course.id}`} className="row" style={{ gap: 6 }}>
          <ArrowLeft size={14} /> {course.title}
        </Link>
        <span>/</span>
        <span className="lesson-crumb">Lesson {lesson.position + 1} of {sidebarLessons.length}</span>
      </div>

      <div className="learn-grid">
        <div className="lesson-page">
          <div className="player-card">
            <div className="player-frame">
              {videoId ? (
                <iframe
                  key={playerKey}
                  src={`https://www.youtube.com/embed/${videoId}?start=${startAt}&rel=0&modestbranding=1${
                    startAt > 0 ? "&autoplay=1" : ""
                  }`}
                  title={lesson.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              ) : (
                <div className="player-placeholder">
                  <Play size={30} />
                  <span>This lesson has no playable video.</span>
                </div>
              )}
            </div>
          </div>

          <div className="lesson-body">
            <div className="lesson-title-row">
              <div>
                <h1>{lesson.title}</h1>
                <div className="lesson-title-meta">
                  <span><Clock size={12} style={{ verticalAlign: "-1px" }} /> {formatClock(lesson.start_seconds)}–{formatClock(lesson.end_seconds)}</span>
                  <span>·</span>
                  <span>{Math.max(1, Math.round(duration / 60))} min</span>
                  {quiz ? (
                    <>
                      <span>·</span>
                      <span>1 quiz</span>
                    </>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                className={`complete-toggle ${completed ? "done" : ""}`}
                onClick={toggleComplete}
              >
                <Check size={14} /> {completed ? "Completed" : "Mark complete"}
              </button>
            </div>
            {saveError ? <div className="form-error" role="alert">{saveError}</div> : null}

            <div className="tabs" role="tablist" aria-label="Lesson material">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "study"}
                className={`tab ${tab === "study" ? "active" : ""}`}
                onClick={() => setTab("study")}
              >
                Study notes
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "notes"}
                className={`tab ${tab === "notes" ? "active" : ""}`}
                onClick={() => setTab("notes")}
              >
                Your notes ({notes.length})
              </button>
            </div>

            {tab === "study" ? (
              <div className="tab-panel">
                <StudyNotes markdown={lesson.notes} />
              </div>
            ) : (
              <div className="tab-panel">
                <div className="spread" style={{ marginBottom: 8 }}>
                  <h2 className="panel-title">Pinned to the moment</h2>
                  <span className="mini-meta">{notes.length} note{notes.length === 1 ? "" : "s"}</span>
                </div>
                <form className="note-form" onSubmit={addNote}>
                  <div className="note-form-row">
                    <input
                      className="input timestamp-input"
                      value={noteTime}
                      onChange={(event) => setNoteTime(event.target.value)}
                      aria-label="Timestamp (mm:ss)"
                      placeholder="0:00"
                    />
                    <input
                      className="input"
                      value={noteBody}
                      onChange={(event) => setNoteBody(event.target.value)}
                      placeholder="What do you want to remember?"
                      aria-label="Note"
                    />
                    <button type="submit" className="btn btn-primary btn-sm" disabled={noteBusy || !noteBody.trim()}>
                      {noteBusy ? "Saving…" : "Pin note"}
                    </button>
                  </div>
                  <span className="muted" style={{ fontSize: "0.72rem" }}>
                    Notes keep their timestamp. Click one and the video plays from that second.
                  </span>
                </form>
                <div style={{ marginTop: 14 }}>
                  {notes.length ? (
                    notes.map((note) => (
                      <div className="note-entry" key={note.id}>
                        <div className="note-entry-head">
                          <button
                            type="button"
                            className="timestamp-chip"
                            style={{ border: 0 }}
                            onClick={() => {
                              replay(note.time_seconds);
                              setNoteTime(formatClock(note.time_seconds));
                            }}
                          >
                            {formatClock(note.time_seconds)}
                          </button>
                          <span className="muted" style={{ fontSize: "0.7rem" }}>play from here</span>
                          <div className="note-entry-actions">
                            <button type="button" aria-label="Delete note" onClick={() => deleteNote(note.id)}>
                              <Trash size={14} />
                            </button>
                          </div>
                        </div>
                        <p className="note-entry-body">{note.body}</p>
                      </div>
                    ))
                  ) : (
                    <p className="notes-empty">
                      No notes yet. Pause at the moment that matters and pin one — it will be here
                      when you come back.
                    </p>
                  )}
                </div>
                <div className="personal-note">
                  <div className="personal-note-head">
                    <div>
                      <h2 className="panel-title">My notes</h2>
                      <p>Free-form notes for this lesson — not tied to a timestamp.</p>
                    </div>
                    <span className="mini-meta">Lesson {lesson.position + 1}</span>
                  </div>
                  <textarea
                    className="textarea personal-note-textarea"
                    value={personalNote}
                    onChange={(event) => {
                      setPersonalNote(event.target.value);
                      setPersonalStatus("");
                    }}
                    placeholder="Add your own notes here — a summary, a question, or something to try later."
                    aria-label="My notes for this lesson"
                  />
                  <div className="personal-note-actions">
                    <span className="muted">
                      {personalStatus || "Kept with this lesson on this computer."}
                    </span>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={savePersonalNote}
                      disabled={personalBusy || personalNote === savedPersonalNote}
                    >
                      {personalBusy ? "Saving…" : personalNote === savedPersonalNote ? "Saved" : "Save my notes"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {quiz ? (
              <div className="quiz-panel">
                <div className="quiz-kicker">
                  <Note size={12} /> Quiz · prove it
                </div>
                <p className="quiz-question">{quiz.question}</p>
                <div className="quiz-options">
                  {quiz.options.map((option, index) => {
                    let className = "option-button";
                    if (answered && index === quiz.answerIndex) className += " correct";
                    if (answered && index === selected && index !== quiz.answerIndex) className += " wrong";
                    return (
                      <button
                        key={index}
                        type="button"
                        className={className}
                        disabled={answered}
                        onClick={() => chooseOption(index)}
                      >
                        {String.fromCharCode(65 + index)}. {option}
                      </button>
                    );
                  })}
                </div>

                {answered ? (
                  <div className={`quiz-feedback ${selected === quiz.answerIndex ? "correct" : "wrong"}`}>
                    <strong>
                      {selected === quiz.answerIndex ? "Correct — this lesson is marked complete." : "Not quite. Replay the moment that explains it."}
                    </strong>
                    {quiz.explanation ? <p>{quiz.explanation}</p> : null}
                    {selected !== quiz.answerIndex ? (
                      <button type="button" className="replay-btn" onClick={() => replay(quiz.replaySeconds)}>
                        <Play size={9} /> Replay {formatClock(quiz.replaySeconds)}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <div className="quiz-actions">
                  {answered ? (
                    nextLesson ? (
                      <Link href={`/course/${course.id}/lesson/${nextLesson.id}?t=${nextLesson.startSeconds}`} className="btn btn-primary btn-sm">
                        Next lesson <ArrowRight size={13} />
                      </Link>
                    ) : (
                      <Link href={`/course/${course.id}`} className="btn btn-primary btn-sm">
                        Back to the course
                      </Link>
                    )
                  ) : (
                    <span className="muted" style={{ fontSize: "0.75rem" }}>
                      Pick one answer. A wrong one replays the explanation.
                    </span>
                  )}
                  {!answered ? (
                    <button type="button" className="quiz-skip" onClick={toggleComplete}>
                      Skip this question and mark the lesson done
                    </button>
                  ) : saving ? (
                    <span className="muted" style={{ fontSize: "0.72rem" }}>Saving…</span>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="quiz-panel">
                <div className="quiz-kicker"><Note size={12} /> No quiz for this lesson</div>
                <p className="muted" style={{ fontSize: "0.86rem", marginTop: 8 }}>
                  Watch the segment, add a note and mark the lesson complete when you can explain it
                  without replaying.
                </p>
              </div>
            )}

            <div className="spread" style={{ marginTop: 4, padding: "4px 2px" }}>
              {nextLesson ? (
                <Link href={`/course/${course.id}/lesson/${nextLesson.id}?t=${nextLesson.startSeconds}`} className="btn btn-outline btn-sm">
                  Next: {nextLesson.title} <ArrowRight size={13} />
                </Link>
              ) : (
                <Link href={`/course/${course.id}`} className="btn btn-outline btn-sm">
                  Finish course <ArrowRight size={13} />
                </Link>
              )}
              <span className="muted" style={{ fontSize: "0.75rem" }}>
                {completed ? "Saved to this computer." : "Progress is saved as you go."}
              </span>
            </div>
          </div>
        </div>

        <aside className="lesson-sidebar">
          <div className="side-panel">
            <div className="side-panel-head">
              <h2>Course progress</h2>
              <span className="mono" style={{ fontSize: "0.65rem", color: "var(--ink-soft)" }}>{percent}%</span>
            </div>
            <div className="side-progress">
              <div className="side-progress-label">
                <span>{doneCount} of {visibleTotal} lessons</span>
                <span>{percent}%</span>
              </div>
              <div className="progress"><span style={{ width: `${percent}%` }} /></div>
            </div>
          </div>

          <div className="side-panel">
            <div className="side-panel-head">
              <h2>Lessons</h2>
              <span className="mono" style={{ fontSize: "0.62rem", color: "var(--ink-soft)" }}>
                {lesson.position + 1}/{sidebarLessons.length}
              </span>
            </div>
            <div className="side-lessons">
              {sidebarLessons.map((item) => (
                <Link
                  key={item.id}
                  href={`/course/${course.id}/lesson/${item.id}?t=${item.start_seconds}`}
                  className={`side-lesson ${item.id === lesson.id ? "active" : ""}`}
                  style={item.known ? { opacity: 0.6 } : undefined}
                >
                  <span className="num">{String(item.position + 1).padStart(2, "0")}</span>
                  <span className="side-lesson-title">{item.title}</span>
                  {item.id === lesson.id && completed ? <Check size={12} className="side-lesson-done" /> : null}
                  {item.id !== lesson.id && item.completed ? <Check size={12} className="side-lesson-done" /> : null}
                </Link>
              ))}
            </div>
          </div>

          <div className="side-panel" style={{ background: "var(--surface-soft)" }}>
            <div className="side-panel-head">
              <h2>Keep it</h2>
            </div>
            <p style={{ fontSize: "0.8rem", color: "var(--ink-soft)", padding: "0 4px 6px" }}>
              Notes, quiz answers and completion are stored in your local Course Hero database. You can
              export everything from your dashboard.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
