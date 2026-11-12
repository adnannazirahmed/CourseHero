import "server-only";
import { getDb } from "./db";
import { newId } from "./password";

export type DueReview = {
  id: string;
  quiz_id: string;
  lesson_id: string;
  course_id: string;
  due_at: string;
  interval_days: number;
  misses: number;
  last_result: string;
  lesson_title: string;
  course_title: string;
  question: string;
  options: string;
  answer_index: number;
  explanation: string;
  replay_seconds: number;
};

function nextDue(days: number): string {
  return new Date(Date.now() + Math.max(1, days) * 86_400_000).toISOString();
}

export function recordQuizAttempt(userId: string, lessonId: string, correct: boolean) {
  const db = getDb();
  const quiz = db
    .prepare(
      `SELECT q.id, q.lesson_id, l.course_id, r.id AS review_id, r.interval_days, r.misses
       FROM quizzes q JOIN lessons l ON l.id = q.lesson_id
       LEFT JOIN quiz_reviews r ON r.quiz_id = q.id AND r.user_id = ?
       WHERE q.lesson_id = ?`,
    )
    .get(userId, lessonId) as
    | {
        id: string;
        lesson_id: string;
        course_id: string;
        review_id: string | null;
        interval_days: number | null;
        misses: number | null;
      }
    | undefined;
  if (!quiz) return;

  const now = new Date().toISOString();
  if (!quiz.review_id) {
    const interval = correct ? 2 : 1;
    db.prepare(
      `INSERT INTO quiz_reviews
       (id, user_id, quiz_id, lesson_id, course_id, due_at, interval_days, misses, last_result, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId("review-"),
      userId,
      quiz.id,
      quiz.lesson_id,
      quiz.course_id,
      correct ? nextDue(interval) : now,
      interval,
      correct ? 0 : 1,
      correct ? "correct" : "wrong",
      now,
      now,
    );
    return;
  }

  if (correct) {
    const interval = Math.min(30, Math.max(2, (quiz.interval_days ?? 1) * 2));
    db.prepare(
      "UPDATE quiz_reviews SET due_at = ?, interval_days = ?, last_result = 'correct', updated_at = ? WHERE id = ?",
    ).run(nextDue(interval), interval, now, quiz.review_id);
  } else {
    db.prepare(
      "UPDATE quiz_reviews SET due_at = ?, interval_days = 1, misses = misses + 1, last_result = 'wrong', updated_at = ? WHERE id = ?",
    ).run(now, now, quiz.review_id);
  }
}

export function getDueReviews(userId: string, limit = 30): DueReview[] {
  return getDb()
    .prepare(
      `SELECT r.id, r.quiz_id, r.lesson_id, r.course_id, r.due_at, r.interval_days, r.misses, r.last_result,
              l.title AS lesson_title, c.title AS course_title,
              q.question, q.options, q.answer_index, q.explanation, q.replay_seconds
       FROM quiz_reviews r
       JOIN quizzes q ON q.id = r.quiz_id
       JOIN lessons l ON l.id = r.lesson_id
       JOIN courses c ON c.id = r.course_id
       WHERE r.user_id = ? AND r.due_at <= ?
       ORDER BY r.due_at ASC LIMIT ?`,
    )
    .all(userId, new Date().toISOString(), limit) as DueReview[];
}

export function getDueReviewCount(userId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM quiz_reviews WHERE user_id = ? AND due_at <= ?")
    .get(userId, new Date().toISOString()) as { n: number };
  return row.n;
}

export function answerReview(
  userId: string,
  reviewId: string,
  answerIndex: number,
): { correct: boolean; explanation: string; replaySeconds: number; lessonId: string; courseId: string } | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT r.id, r.quiz_id, r.lesson_id, r.course_id, r.interval_days, q.answer_index, q.explanation, q.replay_seconds
       FROM quiz_reviews r JOIN quizzes q ON q.id = r.quiz_id
       WHERE r.id = ? AND r.user_id = ?`,
    )
    .get(reviewId, userId) as
    | {
        id: string;
        quiz_id: string;
        lesson_id: string;
        course_id: string;
        interval_days: number;
        answer_index: number;
        explanation: string;
        replay_seconds: number;
      }
    | undefined;
  if (!row) return null;

  const correct = answerIndex === row.answer_index;
  const now = new Date().toISOString();
  if (correct) {
    const interval = Math.min(30, Math.max(2, (row.interval_days || 1) * 2));
    db.prepare(
      "UPDATE quiz_reviews SET due_at = ?, interval_days = ?, last_result = 'correct', updated_at = ? WHERE id = ?",
    ).run(nextDue(interval), interval, now, row.id);
  } else {
    db.prepare(
      "UPDATE quiz_reviews SET due_at = ?, interval_days = 1, misses = misses + 1, last_result = 'wrong', updated_at = ? WHERE id = ?",
    ).run(now, now, row.id);
  }
  db.prepare(
    "INSERT INTO activities (id, user_id, course_id, lesson_id, kind, created_at) VALUES (?, ?, ?, ?, 'review', ?)",
  ).run(newId("activity-"), userId, row.course_id, row.lesson_id, now);

  return {
    correct,
    explanation: row.explanation,
    replaySeconds: row.replay_seconds,
    lessonId: row.lesson_id,
    courseId: row.course_id,
  };
}
