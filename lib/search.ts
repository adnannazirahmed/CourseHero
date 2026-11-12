import "server-only";
import { getDb } from "./db";

export type SearchResults = {
  query: string;
  courses: Array<{ id: string; title: string; author: string; description: string }>;
  lessons: Array<{
    id: string;
    course_id: string;
    course_title: string;
    title: string;
    position: number;
    start_seconds: number;
  }>;
  notes: Array<{
    id: string;
    course_id: string;
    course_title: string;
    lesson_id: string | null;
    lesson_title: string | null;
    body: string;
    time_seconds: number;
  }>;
  transcripts: Array<{
    course_id: string;
    course_title: string;
    video_id: string;
    lesson_id: string | null;
    start_seconds: number;
    text: string;
  }>;
};

export function searchLibrary(userId: string, rawQuery: string): SearchResults {
  const query = rawQuery.trim().slice(0, 120);
  const empty: SearchResults = { query, courses: [], lessons: [], notes: [], transcripts: [] };
  if (query.length < 2) return empty;
  const db = getDb();
  const like = `%${query}%`;

  const courses = db
    .prepare(
      `SELECT id, title, author, description FROM courses
       WHERE status = 'ready' AND (visibility = 'public' OR owner_id = ?)
         AND (title LIKE ? OR description LIKE ? OR author LIKE ?)
       ORDER BY popularity DESC, created_at DESC LIMIT 12`,
    )
    .all(userId, like, like, like) as SearchResults["courses"];

  const lessons = db
    .prepare(
      `SELECT l.id, l.course_id, c.title AS course_title, l.title, l.position, l.start_seconds
       FROM lessons l JOIN courses c ON c.id = l.course_id
       WHERE c.status = 'ready' AND (c.visibility = 'public' OR c.owner_id = ?)
         AND (l.title LIKE ? OR l.notes LIKE ?)
       ORDER BY l.position ASC LIMIT 20`,
    )
    .all(userId, like, like) as SearchResults["lessons"];

  const notes = db
    .prepare(
      `SELECT n.id, n.course_id, c.title AS course_title, n.lesson_id,
              l.title AS lesson_title, n.body, n.time_seconds
       FROM notes n JOIN courses c ON c.id = n.course_id
       LEFT JOIN lessons l ON l.id = n.lesson_id
       WHERE n.user_id = ? AND n.body LIKE ?
       ORDER BY n.created_at DESC LIMIT 20`,
    )
    .all(userId, like) as SearchResults["notes"];

  const transcripts = db
    .prepare(
      `SELECT t.course_id, c.title AS course_title, t.video_id, t.start_seconds, t.text,
              (SELECT l.id FROM lessons l
               WHERE l.course_id = t.course_id
                 AND (l.video_id = t.video_id OR l.video_id IS NULL)
                 AND t.start_seconds >= l.start_seconds AND t.start_seconds <= l.end_seconds
               ORDER BY l.position ASC LIMIT 1) AS lesson_id
       FROM transcript_chunks t JOIN courses c ON c.id = t.course_id
       WHERE (c.visibility = 'public' OR c.owner_id = ?) AND t.text LIKE ?
       ORDER BY t.start_seconds ASC LIMIT 20`,
    )
    .all(userId, like) as SearchResults["transcripts"];

  return { query, courses, lessons, notes, transcripts };
}
