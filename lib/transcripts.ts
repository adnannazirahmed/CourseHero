import "server-only";
import { getDb } from "./db";
import { newId } from "./password";
import { fetchTranscript, type TranscriptItem } from "./youtube";

export type TranscriptChunk = {
  id: string;
  course_id: string;
  video_id: string;
  start_seconds: number;
  end_seconds: number;
  text: string;
};

function buildChunks(items: TranscriptItem[]): Array<{
  start_seconds: number;
  end_seconds: number;
  text: string;
}> {
  const chunks: Array<{ start_seconds: number; end_seconds: number; text: string }> = [];
  let start = 0;
  let end = 0;
  let buffer = "";

  for (const item of items) {
    if (!buffer) start = item.offset;
    buffer = buffer ? `${buffer} ${item.text}` : item.text;
    end = Math.max(end, item.offset + Math.max(0, item.duration));
    if (buffer.length >= 900) {
      chunks.push({ start_seconds: start, end_seconds: Math.max(start + 5, end), text: buffer.trim() });
      buffer = "";
    }
  }
  if (buffer.trim()) {
    chunks.push({ start_seconds: start, end_seconds: Math.max(start + 5, end), text: buffer.trim() });
  }
  return chunks;
}

export function saveTranscript(courseId: string, videoId: string, items: TranscriptItem[]) {
  if (!videoId || items.length === 0) return;
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO transcripts (video_id, content, created_at) VALUES (?, ?, ?)
     ON CONFLICT(video_id) DO UPDATE SET content = excluded.content, created_at = excluded.created_at`,
  ).run(videoId, JSON.stringify(items), now);
  db.prepare("DELETE FROM transcript_chunks WHERE course_id = ? AND video_id = ?").run(courseId, videoId);
  const insert = db.prepare(
    `INSERT INTO transcript_chunks (id, course_id, video_id, start_seconds, end_seconds, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const chunk of buildChunks(items)) {
    insert.run(newId("chunk-"), courseId, videoId, chunk.start_seconds, chunk.end_seconds, chunk.text, now);
  }
}

export async function ensureCourseTranscript(courseId: string, videoId: string | null): Promise<boolean> {
  if (!videoId) return false;
  const db = getDb();
  const existing = db
    .prepare("SELECT COUNT(*) AS n FROM transcript_chunks WHERE course_id = ? AND video_id = ?")
    .get(courseId, videoId) as { n: number };
  if (existing.n > 0) return true;

  const cached = db.prepare("SELECT content FROM transcripts WHERE video_id = ?").get(videoId) as
    | { content: string }
    | undefined;
  if (cached) {
    try {
      const items = JSON.parse(cached.content) as TranscriptItem[];
      if (Array.isArray(items) && items.length > 0) {
        saveTranscript(courseId, videoId, items);
        return true;
      }
    } catch {
      // Fetch below.
    }
  }

  const items = await fetchTranscript(videoId);
  if (items.length === 0) return false;
  saveTranscript(courseId, videoId, items);
  return true;
}

export function getChunks(
  courseId: string,
  videoId?: string | null,
  startSeconds?: number,
  endSeconds?: number,
): TranscriptChunk[] {
  const db = getDb();
  const conditions = ["course_id = ?"];
  const values: Array<string | number> = [courseId];
  if (videoId) {
    conditions.push("video_id = ?");
    values.push(videoId);
  }
  if (typeof startSeconds === "number") {
    conditions.push("end_seconds >= ?");
    values.push(startSeconds);
  }
  if (typeof endSeconds === "number") {
    conditions.push("start_seconds <= ?");
    values.push(endSeconds);
  }
  return db
    .prepare(
      `SELECT id, course_id, video_id, start_seconds, end_seconds, text
       FROM transcript_chunks WHERE ${conditions.join(" AND ")} ORDER BY start_seconds ASC`,
    )
    .all(...values) as TranscriptChunk[];
}

function terms(value: string): string[] {
  return [
    ...new Set(
      value
        .toLowerCase()
        .match(/[a-z][a-z0-9+#.-]{2,}/g)
        ?.filter((word) => word.length > 2) ?? [],
    ),
  ].slice(0, 24);
}

export function pickChunks(
  chunks: TranscriptChunk[],
  query: string,
  limit = 10,
): TranscriptChunk[] {
  if (chunks.length <= limit) return chunks;
  const words = terms(query);
  return [...chunks]
    .map((chunk, index) => {
      const text = chunk.text.toLowerCase();
      let score = 0;
      for (const word of words) {
        if (text.includes(word)) score += word.length >= 6 ? 3 : 1;
      }
      return { chunk, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .sort((a, b) => a.chunk.start_seconds - b.chunk.start_seconds)
    .map((entry) => entry.chunk);
}

export function formatChunkContext(chunks: TranscriptChunk[], maxChars = 18_000): string {
  let total = 0;
  const lines: string[] = [];
  for (const chunk of chunks) {
    const line = `[${transcriptSeconds(chunk.start_seconds)}] ${chunk.text}`;
    if (total + line.length > maxChars) break;
    lines.push(line);
    total += line.length;
  }
  return lines.join("\n");
}

export function transcriptSeconds(value: number): string {
  const seconds = Math.max(0, Math.round(value));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}
