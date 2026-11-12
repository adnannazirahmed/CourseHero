import "server-only";
import { getDb } from "./db";
import { calculateStreak } from "./plan";

export type CourseRow = {
  id: string;
  owner_id: string;
  title: string;
  slug: string;
  youtube_url: string;
  youtube_id: string | null;
  playlist_id: string | null;
  author: string;
  thumbnail: string;
  duration_seconds: number;
  description: string;
  source: string;
  pace_minutes: number;
  target_days: number;
  course_goal: string;
  difficulty: string;
  enrollment_target_days?: number | null;
  status: string;
  error: string | null;
  visibility: string;
  added_by: string;
  popularity: number;
  created_at: string;
  updated_at: string;
};

export type LessonRow = {
  id: string;
  course_id: string;
  position: number;
  title: string;
  start_seconds: number;
  end_seconds: number;
  video_id: string | null;
  notes: string;
  created_at: string;
};

export type QuizRow = {
  id: string;
  lesson_id: string;
  question: string;
  options: string;
  answer_index: number;
  explanation: string;
  replay_seconds: number;
};

export type NoteRow = {
  id: string;
  user_id: string;
  course_id: string;
  lesson_id: string | null;
  body: string;
  time_seconds: number;
  created_at: string;
  course_title?: string;
  lesson_title?: string | null;
};

export function getCourse(id: string): CourseRow | undefined {
  return getDb().prepare("SELECT * FROM courses WHERE id = ?").get(id) as CourseRow | undefined;
}

export function getCourseBySlug(slug: string): CourseRow | undefined {
  return getDb().prepare("SELECT * FROM courses WHERE slug = ?").get(slug) as CourseRow | undefined;
}

export function getLessons(courseId: string): LessonRow[] {
  return getDb()
    .prepare("SELECT * FROM lessons WHERE course_id = ? ORDER BY position ASC")
    .all(courseId) as LessonRow[];
}

export function getQuizForLesson(lessonId: string): QuizRow | undefined {
  return getDb().prepare("SELECT * FROM quizzes WHERE lesson_id = ?").get(lessonId) as
    | QuizRow
    | undefined;
}

export function getQuizzesForCourse(courseId: string): QuizRow[] {
  return getDb()
    .prepare(
      "SELECT q.* FROM quizzes q JOIN lessons l ON l.id = q.lesson_id WHERE l.course_id = ?",
    )
    .all(courseId) as QuizRow[];
}

export function getSkippedIds(userId: string, courseId: string): Set<string> {
  const row = getDb()
    .prepare("SELECT skipped FROM placements WHERE user_id = ? AND course_id = ?")
    .get(userId, courseId) as { skipped: string } | undefined;
  if (!row) return new Set();
  try {
    const ids = JSON.parse(row.skipped);
    return new Set(Array.isArray(ids) ? ids.map(String) : []);
  } catch {
    return new Set();
  }
}

export function getCompletedIds(userId: string, courseId: string): Set<string> {
  const rows = getDb()
    .prepare("SELECT lesson_id FROM lesson_state WHERE user_id = ? AND course_id = ? AND completed = 1")
    .all(userId, courseId) as Array<{ lesson_id: string }>;
  return new Set(rows.map((row) => row.lesson_id));
}

export function ensureEnrollment(userId: string, courseId: string) {
  const db = getDb();
  db.prepare(
    "INSERT OR IGNORE INTO enrollments (id, user_id, course_id, created_at) VALUES (?, ?, ?, ?)",
  ).run(`enroll-${crypto.randomUUID()}`, userId, courseId, new Date().toISOString());
}

export function getMyCourses(userId: string): CourseRow[] {
  return getDb()
    .prepare(
      `SELECT c.*, e.target_days AS enrollment_target_days FROM enrollments e JOIN courses c ON c.id = e.course_id
       WHERE e.user_id = ? AND c.status = 'ready'
       ORDER BY e.created_at DESC`,
    )
    .all(userId) as CourseRow[];
}

export function getPendingCourses(userId: string): CourseRow[] {
  return getDb()
    .prepare(
      `SELECT c.* FROM enrollments e JOIN courses c ON c.id = e.course_id
       WHERE e.user_id = ? AND c.owner_id = ? AND c.status != 'ready'
       ORDER BY c.created_at DESC`,
    )
    .all(userId, userId) as CourseRow[];
}

export function getCatalog(limit = 60): CourseRow[] {
  return getDb()
    .prepare(
      `SELECT c.* FROM courses c
       WHERE c.status = 'ready' AND c.visibility = 'public'
       ORDER BY c.popularity DESC, c.created_at DESC LIMIT ?`,
    )
    .all(limit) as CourseRow[];
}

export function getRecentNotes(userId: string, limit = 5): NoteRow[] {
  return getDb()
    .prepare(
      `SELECT n.*, c.title AS course_title, l.title AS lesson_title
       FROM notes n
       LEFT JOIN courses c ON c.id = n.course_id
       LEFT JOIN lessons l ON l.id = n.lesson_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC LIMIT ?`,
    )
    .all(userId, limit) as NoteRow[];
}

export function getStreak(userId: string): { count: number; dates: string[] } {
  const rows = getDb()
    .prepare("SELECT created_at FROM activities WHERE user_id = ? ORDER BY created_at DESC LIMIT 365")
    .all(userId) as Array<{ created_at: string }>;
  const dates = rows.map((row) => row.created_at);
  return { count: calculateStreak(dates), dates };
}

export function getCourseStats(userId: string, course: CourseRow) {
  const db = getDb();
  const lessons = getLessons(course.id);
  const skipped = getSkippedIds(userId, course.id);
  const completed = getCompletedIds(userId, course.id);
  const quizCount = (
    db
      .prepare("SELECT COUNT(*) AS n FROM quizzes q JOIN lessons l ON l.id = q.lesson_id WHERE l.course_id = ?")
      .get(course.id) as { n: number }
  ).n;
  return { lessons, skipped, completed, quizCount };
}
