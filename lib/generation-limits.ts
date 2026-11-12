import "server-only";
import { getDb } from "./db";
import { newId } from "./password";

const USER_DAILY_LIMIT = 5;
const GLOBAL_DAILY_LIMIT = 20;
const ACTIVE_LIMIT = 2;

export function reserveGeneration(userId: string, courseId: string, saveCourse: () => void): string | null {
  const db = getDb();
  const now = new Date();
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  const activeSince = new Date(now.getTime() - 90_000).toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const userAttempts = db.prepare(
      "SELECT COUNT(*) AS count FROM generation_attempts WHERE user_id = ? AND created_at >= ?",
    ).get(userId, since) as { count: number };
    const allAttempts = db.prepare(
      "SELECT COUNT(*) AS count FROM generation_attempts WHERE created_at >= ?",
    ).get(since) as { count: number };
    const active = db.prepare(
      "SELECT COUNT(*) AS count FROM courses WHERE status = 'generating' AND updated_at >= ?",
    ).get(activeSince) as { count: number };
    const error = userAttempts.count >= USER_DAILY_LIMIT
      ? "You have reached the five-build daily limit. Try again tomorrow."
      : allAttempts.count >= GLOBAL_DAILY_LIMIT
        ? "This server has reached its daily build limit. Try again tomorrow."
        : active.count >= ACTIVE_LIMIT
          ? "Two courses are already being built. Try again when one finishes."
          : null;
    if (error) {
      db.exec("ROLLBACK");
      return error;
    }
    saveCourse();
    db.prepare(
      "INSERT INTO generation_attempts (id, user_id, course_id, created_at) VALUES (?, ?, ?, ?)",
    ).run(newId("attempt-"), userId, courseId, now.toISOString());
    db.exec("COMMIT");
    return null;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
