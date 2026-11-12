import "server-only";
import { getDb } from "./db";
import { aiJson, getAiStatus } from "./ai";
import {
  ensureCourseTranscript,
  formatChunkContext,
  getChunks,
  pickChunks,
  saveTranscript,
} from "./transcripts";
import { slugify, formatClock } from "./plan";
import {
  fetchPlaylist,
  fetchTranscript,
  fetchVideoMeta,
  type TranscriptItem,
  type VideoMeta,
} from "./youtube";

type GeneratedQuiz = {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  replaySeconds: number;
};

type GeneratedLesson = {
  title: string;
  startSeconds: number;
  endSeconds: number;
  notes: string;
  videoId?: string;
  quiz?: GeneratedQuiz;
};

type Sentence = { text: string; offset: number; end: number };

const STOPWORDS = new Set(
  `a about above after again against all am an and any are aren't as at be because been before being below between both but by can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves also going gonna want really right just like know think thing things okay ok yeah stuff basically actually little bit lot using use used make makes made get gets got goes go going new one two three first next now see look looking say says said tell talk talking need needs way time course video lesson example examples code python react data model models learn learning understand important different something anything everything work works working`
    .split(/\s+/)
    .filter(Boolean),
);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clean(value: string) {
  return value
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*(?:music|applause|laughter)[^)]*\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sentencesFromTranscript(items: TranscriptItem[]): Sentence[] {
  const sentences: Sentence[] = [];
  let buffer = "";
  let start = 0;
  let last = 0;

  for (const item of items) {
    const text = clean(item.text);
    if (!text) continue;
    if (!buffer) start = item.offset;
    buffer = buffer ? `${buffer} ${text}` : text;
    last = item.offset + Math.max(0, item.duration);

    const endsSentence = /[.!?]$/.test(text);
    const longEnough = buffer.length > 60;
    if ((endsSentence && longEnough) || buffer.length > 230) {
      sentences.push({ text: buffer, offset: start, end: last });
      buffer = "";
    }
  }
  if (buffer.length > 20) sentences.push({ text: buffer, offset: start, end: last });
  return sentences;
}

function keywordScores(text: string): Map<string, number> {
  const scores = new Map<string, number>();
  const words = text.toLowerCase().match(/[a-z][a-z+#.-]{2,}/g) ?? [];
  for (const word of words) {
    const normalized = word.replace(/[.-]+$/g, "");
    if (normalized.length < 4 || STOPWORDS.has(normalized)) continue;
    scores.set(normalized, (scores.get(normalized) ?? 0) + 1);
  }
  return scores;
}

function topKeywords(text: string, count = 4): string[] {
  return [...keywordScores(text).entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([word]) => word);
}

function titleCase(value: string) {
  return value.replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function pickSentences(sentences: Sentence[], count: number): Sentence[] {
  if (sentences.length <= count) return sentences;
  const scores = keywordScores(sentences.map((sentence) => sentence.text).join(" "));
  return [...sentences]
    .map((sentence, index) => {
      const words = sentence.text.toLowerCase().match(/[a-z][a-z+#.-]{2,}/g) ?? [];
      const unique = new Set(words.filter((word) => !STOPWORDS.has(word)));
      const score = [...unique].reduce((total, word) => total + (scores.get(word) ?? 0), 0);
      return { sentence, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, count)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.sentence);
}

function buildNotes(title: string, sentences: Sentence[], start: number, end: number): string {
  const picks = pickSentences(sentences, 3);
  const keywords = topKeywords(sentences.map((sentence) => sentence.text).join(" "), 3);
  const bullets = picks
    .map((sentence) => `- **${formatClock(sentence.offset)}** — ${sentence.text}`)
    .join("\n");
  return `### What this lesson covers

**${title}** (${formatClock(start)}–${formatClock(end)}). The instructor works through the idea step by step, then shows it in practice.

### Key ideas

${bullets || "- Watch the segment once without pausing, then replay the part that matters."}

### Check yourself

Without replaying, explain ${keywords.length ? keywords.map((word) => `**${word}**`).join(", ") : "the main idea"} in your own words. If you cannot, replay the lesson and add a note at the moment it clicks.`;
}

function deterministicShuffle<T>(items: T[], seedText: string): T[] {
  const output = [...items];
  let seed = 0;
  for (let i = 0; i < seedText.length; i++) seed = (seed * 31 + seedText.charCodeAt(i)) % 2147483647;
  for (let i = output.length - 1; i > 0; i--) {
    seed = (seed * 48271) % 2147483647;
    const j = seed % (i + 1);
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

function makeQuiz(sentences: Sentence[], corpusKeywords: string[]): GeneratedQuiz | null {
  const candidates = sentences.filter(
    (sentence) => sentence.text.length >= 60 && sentence.text.length <= 240,
  );
  for (const sentence of candidates.slice(0, 40)) {
    const words = sentence.text.match(/[A-Za-z][A-Za-z+#.-]{4,}/g) ?? [];
    const target = words
      .filter((word) => !STOPWORDS.has(word.toLowerCase()) && !/^\d+$/.test(word))
      .sort((a, b) => b.length - a.length)[0];
    if (!target) continue;

    const blanked = sentence.text.replace(new RegExp(`\\b${escapeRegExp(target)}\\b`, "i"), "______");
    if (blanked === sentence.text) continue;

    const distractors = corpusKeywords
      .filter((word) => word.toLowerCase() !== target.toLowerCase())
      .slice(0, 12);
    if (distractors.length < 3) continue;

    const wrong = deterministicShuffle(distractors, sentence.text).slice(0, 3).map(titleCase);
    const options = deterministicShuffle([target, ...wrong], target + sentence.offset);
    const answerIndex = options.findIndex(
      (option) => option.toLowerCase() === target.toLowerCase(),
    );
    if (answerIndex === -1) continue;

    return {
      question: `Complete the idea from the lesson:\n\n“${blanked}”`,
      options,
      answerIndex,
      explanation: `At ${formatClock(sentence.offset)} the video says: “${sentence.text}”`,
      replaySeconds: sentence.offset,
    };
  }
  return null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fallbackLessons(meta: VideoMeta, transcript: TranscriptItem[]): GeneratedLesson[] {
  const duration = meta.durationSeconds || transcript.at(-1)?.offset || 0;
  const sentences = sentencesFromTranscript(transcript);
  const corpus = topKeywords(transcript.map((item) => item.text).join(" "), 30);

  if (meta.chapters.length >= 2 && duration > 0) {
    return meta.chapters
      .map((chapter, index) => {
        const start = chapter.startSeconds;
        const end =
          meta.chapters[index + 1]?.startSeconds ??
          (duration > start ? duration : start + 600);
        const range = sentences.filter(
          (sentence) => sentence.offset >= start && sentence.offset < end,
        );
        const title = chapter.title.replace(/^\d+[.)]\s*/, "").slice(0, 90);
        return {
          title,
          startSeconds: start,
          endSeconds: Math.max(start + 60, end),
          notes: buildNotes(title, range, start, end),
          quiz: makeQuiz(range, corpus) ?? undefined,
        };
      })
      .filter((lesson) => lesson.endSeconds > lesson.startSeconds);
  }

  const count = clamp(Math.round((duration || transcript.at(-1)?.offset || 600) / 480), 3, 14);
  const total = duration || transcript.at(-1)?.offset || 600;
  const windowSize = Math.max(60, Math.floor(total / count));
  const lessons: GeneratedLesson[] = [];

  for (let index = 0; index < count; index++) {
    const start = index * windowSize;
    const end = index === count - 1 ? total : (index + 1) * windowSize;
    const range = sentences.filter(
      (sentence) => sentence.offset >= start && sentence.offset < end,
    );
    if (range.length === 0 && sentences.length > 0) continue;
    const keywords = topKeywords(range.map((sentence) => sentence.text).join(" "), 3);
    const title =
      keywords.length >= 2
        ? titleCase(keywords.join(" · "))
        : index === 0
          ? `Introduction · ${meta.author}`
          : `Lesson ${index + 1} · ${meta.title}`;
    lessons.push({
      title: title.slice(0, 90),
      startSeconds: start,
      endSeconds: Math.max(start + 60, end),
      notes: buildNotes(title, range, start, end),
      quiz: makeQuiz(range, corpus) ?? undefined,
    });
  }
  return lessons;
}

function transcriptDigest(transcript: TranscriptItem[]): string {
  if (transcript.length === 0) return "";
  const lines: string[] = [];
  let nextMark = 0;
  for (const item of transcript) {
    if (item.offset < nextMark) continue;
    nextMark = item.offset + 20;
    lines.push(`[${formatClock(item.offset)}] ${clean(item.text)}`);
  }
  return lines.join("\n").slice(0, 28_000);
}

async function generateWithAI(
  meta: VideoMeta,
  transcript: TranscriptItem[],
  options: { goal?: string; difficulty?: string } = {},
): Promise<GeneratedLesson[]> {
  if (!getAiStatus().configured) return [];
  const digest = transcriptDigest(transcript);
  if (!digest && !meta.description) return [];

  const prompt = `You are the curriculum engine for Course Hero, a product that turns YouTube videos into short, finishable courses.

Video: ${meta.title}
Creator: ${meta.author}
Length: ${meta.durationSeconds ? formatClock(meta.durationSeconds) : "unknown"}
Description: ${meta.description.slice(0, 1500)}
Course goal from the learner: ${options.goal || "not specified"}
Difficulty: ${options.difficulty || "beginner"}

Transcript with timestamps:
${digest || "(transcript unavailable; use the description)"}

Split this video into ${clamp(Math.round((meta.durationSeconds || 3600) / 600), 3, 12)} sequential lessons of 5-20 minutes. Every second of the video must be covered exactly once, in order. Do not invent content that is not in the transcript.

For each lesson return:
- title: specific, 3-8 words, no "Part 1"
- startSeconds and endSeconds: integers within the video
- notes: 120-220 words of markdown study notes with a short overview, 3 key ideas as bullets, and one "Check yourself" question. Include at least one timestamp.
- quiz: one multiple-choice question testing understanding, with exactly 4 plausible options, answerIndex (0-3), a one-sentence explanation, and replaySeconds pointing at the part of the video that explains it.

Return ONLY valid JSON, no markdown fence:
{"lessons":[{"title":"","startSeconds":0,"endSeconds":600,"notes":"","quiz":{"question":"","options":["","","",""],"answerIndex":0,"explanation":"","replaySeconds":0}}]}`;

  try {
    const parsed = await aiJson<{ lessons?: Array<Record<string, unknown>> }>({
      task: "course",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "You write precise study courses from video transcripts. Output valid JSON only. Never invent facts that are not in the transcript.",
        },
        { role: "user", content: prompt },
      ],
    });
    if (!Array.isArray(parsed?.lessons)) return [];

    const duration = meta.durationSeconds || Infinity;
    return parsed.lessons
      .map((lesson): GeneratedLesson | null => {
        const title = typeof lesson.title === "string" ? lesson.title.trim() : "";
        const notes = typeof lesson.notes === "string" ? lesson.notes.trim() : "";
        if (!title || notes.length < 40) return null;
        const startSeconds = clamp(Number(lesson.startSeconds) || 0, 0, duration);
        const endSeconds = clamp(Number(lesson.endSeconds) || startSeconds + 600, startSeconds + 60, duration);
        const quizRaw = lesson.quiz as Record<string, unknown> | undefined;
        let quiz: GeneratedQuiz | undefined;
        if (quizRaw) {
          const options = Array.isArray(quizRaw.options)
            ? quizRaw.options.map((option) => String(option)).slice(0, 4)
            : [];
          const answerIndex = Number(quizRaw.answerIndex);
          if (
            typeof quizRaw.question === "string" &&
            options.length === 4 &&
            Number.isInteger(answerIndex) &&
            answerIndex >= 0 &&
            answerIndex < 4
          ) {
            quiz = {
              question: quizRaw.question,
              options,
              answerIndex,
              explanation:
                typeof quizRaw.explanation === "string" ? quizRaw.explanation : "",
              replaySeconds: clamp(
                Number(quizRaw.replaySeconds) || startSeconds,
                0,
                Math.max(0, duration === Infinity ? startSeconds + 300 : duration),
              ),
            };
          }
        }
        return { title: title.slice(0, 100), startSeconds, endSeconds, notes, quiz };
      })
      .filter((lesson): lesson is GeneratedLesson => lesson !== null)
      .sort((a, b) => a.startSeconds - b.startSeconds);
  } catch (error) {
    console.warn("[generate] AI generation failed:", error);
    return [];
  }
}

async function generateSingleVideo(
  videoId: string,
  courseId: string,
  options: { goal?: string; difficulty?: string },
): Promise<{
  meta: VideoMeta;
  lessons: GeneratedLesson[];
}> {
  const meta = await fetchVideoMeta(videoId);
  const transcript = await fetchTranscript(videoId);
  if (transcript.length === 0) {
    throw new Error("We couldn't read this video's captions. It may be unavailable, private, or age-restricted.");
  }
  saveTranscript(courseId, videoId, transcript);
  let lessons = await generateWithAI(meta, transcript, options);
  if (lessons.length < 2) lessons = fallbackLessons(meta, transcript);
  if (lessons.length === 0) {
    throw new Error("We couldn't read this video. It may be private, age-restricted, or have no captions.");
  }
  return { meta, lessons };
}

function compactDigest(transcript: TranscriptItem[], maxChars = 1800): string {
  const lines: string[] = [];
  let total = 0;
  let next = 0;
  for (const item of transcript) {
    if (item.offset < next) continue;
    next = item.offset + 35;
    const line = `[${formatClock(item.offset)}] ${clean(item.text)}`;
    if (total + line.length > maxChars) break;
    lines.push(line);
    total += line.length;
  }
  return lines.join("\n");
}

function normalizeQuiz(raw: unknown, fallbackSeconds: number): GeneratedQuiz | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const quiz = raw as Record<string, unknown>;
  const options = Array.isArray(quiz.options) ? quiz.options.map(String).slice(0, 4) : [];
  const answerIndex = Number(quiz.answerIndex);
  if (
    typeof quiz.question !== "string" ||
    options.length !== 4 ||
    !Number.isInteger(answerIndex) ||
    answerIndex < 0 ||
    answerIndex > 3
  ) {
    return undefined;
  }
  return {
    question: quiz.question,
    options,
    answerIndex,
    explanation: typeof quiz.explanation === "string" ? quiz.explanation : "",
    replaySeconds: Math.max(0, Number(quiz.replaySeconds) || fallbackSeconds),
  };
}

async function generatePlaylistCourse(
  playlistId: string,
  courseId: string,
  options: { goal?: string; difficulty?: string },
): Promise<{ meta: VideoMeta; lessons: GeneratedLesson[] }> {
  const playlist = await fetchPlaylist(playlistId);
  if (playlist.videos.length === 0) {
    throw new Error("We couldn't read this playlist. Make sure the link is public.");
  }

  const videos: Array<{ videoId: string; title: string; durationSeconds: number }> = [];
  let total = 0;
  for (const video of playlist.videos) {
    const duration = video.durationSeconds || 600;
    if (total + duration > 20 * 3600) break;
    videos.push({ ...video, durationSeconds: duration });
    total += duration;
    if (videos.length >= 24) break;
  }
  if (videos.length === 0) {
    throw new Error("The first playlist video exceeds the 20-hour course limit.");
  }

  const videoData: Array<{
    videoId: string;
    title: string;
    durationSeconds: number;
    cursor: number;
    transcript: TranscriptItem[];
  }> = [];
  let cursor = 0;
  for (const video of videos) {
    const transcript = await fetchTranscript(video.videoId).catch(() => []);
    if (transcript.length) saveTranscript(courseId, video.videoId, transcript);
    videoData.push({ ...video, cursor, transcript });
    cursor += video.durationSeconds;
  }

  let lessons: GeneratedLesson[] = [];
  if (getAiStatus().configured) {
    const playlistContext = videoData
      .map((video, index) => {
        const digest = compactDigest(video.transcript);
        return `VIDEO ${index}: ${video.title} (${Math.round(video.durationSeconds / 60)} min)
${digest || "(no transcript available)"}`;
      })
      .join("\n\n")
      .slice(0, 26_000);

    const parsed = await aiJson<{ lessons?: Array<Record<string, unknown>> }>({
      task: "playlist",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "You design one coherent course from a YouTube playlist. Output valid JSON only. Never invent facts that are not in the supplied transcripts.",
        },
        {
          role: "user",
          content: `Playlist: ${playlist.title}
Creator: ${playlist.author}
Learner goal: ${options.goal || "not specified"}
Difficulty: ${options.difficulty || "beginner"}

${playlistContext}

Create 4-14 lessons that cover the playlist in order. Each lesson must belong to one video. Do not split a single video into more than 3 lessons. Skip intro/housekeeping material. For each lesson return:
- videoIndex: the VIDEO number above
- title: specific, 3-8 words
- startSeconds and endSeconds: relative to that video, integers
- notes: 120-220 words of markdown study notes with an overview, 3 key ideas as bullets, and one "Check yourself" question
- quiz: exactly 4 options, answerIndex 0-3, explanation, replaySeconds relative to that video

Return ONLY JSON: {"lessons":[{"videoIndex":0,"title":"","startSeconds":0,"endSeconds":600,"notes":"","quiz":{"question":"","options":["","","",""],"answerIndex":0,"explanation":"","replaySeconds":0}}]}`,
        },
      ],
    });

    if (Array.isArray(parsed?.lessons)) {
      lessons = parsed.lessons
        .map((raw): GeneratedLesson | null => {
          const videoIndex = Math.round(Number(raw.videoIndex));
          const video = videoData[videoIndex];
          if (!video) return null;
          const title = typeof raw.title === "string" ? raw.title.trim() : "";
          const notes = typeof raw.notes === "string" ? raw.notes.trim() : "";
          if (!title || notes.length < 40) return null;
          const localStart = clamp(Number(raw.startSeconds) || 0, 0, video.durationSeconds);
          const localEnd = clamp(
            Number(raw.endSeconds) || localStart + 600,
            localStart + 60,
            video.durationSeconds || localStart + 600,
          );
          return {
            title: title.slice(0, 100),
            startSeconds: video.cursor + localStart,
            endSeconds: video.cursor + localEnd,
            videoId: video.videoId,
            notes,
            quiz: normalizeQuiz(raw.quiz, localStart),
          };
        })
        .filter((lesson): lesson is GeneratedLesson => lesson !== null)
        .sort((a, b) => a.startSeconds - b.startSeconds);
    }
  }

  if (lessons.length < 2) {
    lessons = [];
    for (let index = 0; index < videoData.length; index++) {
      const video = videoData[index];
      const range = sentencesFromTranscript(video.transcript);
      const corpus = topKeywords(video.transcript.map((item) => item.text).join(" "), 24);
      const notes = range.length
        ? buildNotes(video.title, range, 0, video.durationSeconds)
        : `### What this lesson covers

**${video.title}** — part ${index + 1} of the playlist.

Watch this video end to end, then add a note with the moment that matters most. The next lesson builds on it.

### While you watch

- Note the one idea you would explain to a friend.
- Replay any demo once before moving on.`;
      lessons.push({
        title: video.title.slice(0, 100),
        startSeconds: video.cursor,
        endSeconds: video.cursor + video.durationSeconds,
        videoId: video.videoId,
        notes,
        quiz: makeQuiz(range, corpus) ?? undefined,
      });
    }
  }

  return {
    meta: {
      videoId: "",
      title: playlist.title,
      author: playlist.author,
      thumbnail: playlist.thumbnail,
      durationSeconds: total,
      description: `${videos.length} videos from ${playlist.author}, planned as one course.`,
      chapters: [],
    },
    lessons,
  };
}

function persistLessons(courseId: string, lessons: GeneratedLesson[]) {
  const db = getDb();
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    if (hasStudyData(courseId)) {
      throw new Error("This course already has learner progress. Its lessons were kept to protect notes and answers.");
    }
    db.prepare("DELETE FROM lessons WHERE course_id = ?").run(courseId);
    const insertLesson = db.prepare(
      `INSERT INTO lessons (id, course_id, position, title, start_seconds, end_seconds, video_id, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertQuiz = db.prepare(
      `INSERT INTO quizzes (id, lesson_id, question, options, answer_index, explanation, replay_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    lessons.forEach((lesson, index) => {
      const lessonId = `lesson-${crypto.randomUUID()}`;
      insertLesson.run(
        lessonId,
        courseId,
        index,
        lesson.title,
        Math.round(lesson.startSeconds),
        Math.round(lesson.endSeconds),
        lesson.videoId ?? null,
        lesson.notes,
        now,
      );
      if (lesson.quiz) {
        insertQuiz.run(
          `quiz-${crypto.randomUUID()}`,
          lessonId,
          lesson.quiz.question,
          JSON.stringify(lesson.quiz.options),
          lesson.quiz.answerIndex,
          lesson.quiz.explanation,
          Math.round(lesson.quiz.replaySeconds),
        );
      }
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function hasStudyData(courseId: string): boolean {
  const db = getDb();
  const row = db.prepare(`
    SELECT (
      (SELECT COUNT(*) FROM lesson_state WHERE course_id = ?) +
      (SELECT COUNT(*) FROM notes WHERE course_id = ? AND lesson_id IS NOT NULL) +
      (SELECT COUNT(*) FROM placements WHERE course_id = ?) +
      (SELECT COUNT(*) FROM activities WHERE course_id = ? AND lesson_id IS NOT NULL)
    ) AS count
  `).get(courseId, courseId, courseId, courseId) as { count: number };
  return row.count > 0;
}

export async function generateCourse(courseId: string) {
  const db = getDb();
  const course = db.prepare("SELECT * FROM courses WHERE id = ?").get(courseId) as
    | {
        id: string;
        youtube_id: string | null;
        playlist_id: string | null;
        slug: string;
        course_goal: string;
        difficulty: string;
      }
    | undefined;
  if (!course) return;

  db.prepare(
    "UPDATE courses SET status = 'generating', error = NULL, updated_at = ? WHERE id = ?",
  ).run(new Date().toISOString(), courseId);

  try {
    const result = course.youtube_id
      ? await generateSingleVideo(course.youtube_id, courseId, {
          goal: course.course_goal,
          difficulty: course.difficulty,
        })
      : course.playlist_id
        ? await generatePlaylistCourse(course.playlist_id, courseId, {
            goal: course.course_goal,
            difficulty: course.difficulty,
          })
        : null;
    if (!result) throw new Error("No YouTube video or playlist found.");

    const { meta, lessons } = result;
    persistLessons(courseId, lessons);

    const suffix = courseId.replace(/^course-/, "").slice(0, 6);
    let slug = slugify(meta.title, suffix);
    const clash = db
      .prepare("SELECT id FROM courses WHERE slug = ? AND id != ?")
      .get(slug, courseId) as { id: string } | undefined;
    if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 5)}`;

    const totalSeconds =
      meta.durationSeconds || Math.max(0, ...lessons.map((lesson) => lesson.endSeconds));

    db.prepare(
      `UPDATE courses SET title = ?, slug = ?, author = ?, thumbnail = ?, duration_seconds = ?,
       description = ?, status = 'ready', error = NULL, updated_at = ? WHERE id = ?`,
    ).run(
      meta.title,
      slug,
      meta.author,
      meta.thumbnail,
      totalSeconds,
      meta.description.slice(0, 4000),
      new Date().toISOString(),
      courseId,
    );
  } catch (error) {
    console.error("[generate] failed", courseId, error);
    db.prepare(
      "UPDATE courses SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
    ).run(
      error instanceof Error ? error.message : "Course generation failed. Please try again.",
      new Date().toISOString(),
      courseId,
    );
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __courseitJobs: Set<string> | undefined;
}

export function recoverStaleGenerations() {
  const db = getDb();
  const cutoff = new Date(Date.now() - 90_000).toISOString();
  const stale = db.prepare(
    "SELECT id FROM courses WHERE status = 'generating' AND updated_at < ?",
  ).all(cutoff) as Array<{ id: string }>;
  const activeJobs = globalThis.__courseitJobs;
  for (const course of stale) {
    if (activeJobs?.has(course.id)) continue;
    db.prepare(
      "UPDATE courses SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'generating'",
    ).run("The server stopped before this build finished. Try again to resume.", new Date().toISOString(), course.id);
  }
}

export async function regenerateLesson(courseId: string, lessonId: string) {
  const db = getDb();
  const lesson = db
    .prepare(
      `SELECT l.id, l.title, l.start_seconds, l.end_seconds, l.video_id, c.youtube_id, c.title AS course_title,
              c.course_goal, c.difficulty
       FROM lessons l JOIN courses c ON c.id = l.course_id
       WHERE l.id = ? AND l.course_id = ?`,
    )
    .get(lessonId, courseId) as
    | {
        id: string;
        title: string;
        start_seconds: number;
        end_seconds: number;
        video_id: string | null;
        youtube_id: string | null;
        course_title: string;
        course_goal: string;
        difficulty: string;
      }
    | undefined;
  if (!lesson) throw new Error("Lesson not found.");
  if (!getAiStatus().configured) throw new Error("AI is not configured. Add AI_API_KEY and AI_MODEL to .env, then restart.");
  const videoId = lesson.video_id || lesson.youtube_id;
  if (!videoId) throw new Error("This lesson has no video to regenerate from.");
  await ensureCourseTranscript(courseId, videoId);
  let chunks = getChunks(courseId, videoId, lesson.start_seconds, lesson.end_seconds);
  if (chunks.length === 0) chunks = getChunks(courseId, videoId);
  const context = formatChunkContext(pickChunks(chunks, lesson.title, 24), 22_000);
  if (!context) throw new Error("No transcript is available for this lesson yet.");

  const parsed = await aiJson<{
    title?: string;
    notes?: string;
    quiz?: { question?: string; options?: string[]; answerIndex?: number; explanation?: string; replaySeconds?: number };
  }>({
    task: "lesson",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content:
          "You rewrite one lesson from a course using only the supplied transcript. Output valid JSON only. Never invent facts.",
      },
      {
        role: "user",
        content: `Course: ${lesson.course_title}
Lesson: ${lesson.title}
Learner goal: ${lesson.course_goal || "not specified"}
Difficulty: ${lesson.difficulty || "beginner"}

Transcript for this lesson:
${context}

Rewrite this lesson. Keep the same topic. Return 120-220 words of markdown study notes with an overview, 3 key ideas, and one "Check yourself" question. Add one quiz with exactly 4 options and a replay timestamp relative to the lesson.
JSON: {"title":"","notes":"","quiz":{"question":"","options":["","","",""],"answerIndex":0,"explanation":"","replaySeconds":0}}`,
      },
    ],
  });

  const notes = typeof parsed?.notes === "string" ? parsed.notes.trim() : "";
  if (notes.length < 40) throw new Error("The AI did not return usable notes. Try again.");
  const title = typeof parsed?.title === "string" && parsed.title.trim() ? parsed.title.trim().slice(0, 100) : lesson.title;
  const quiz = normalizeQuiz(parsed?.quiz, 0);
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE lessons SET title = ?, notes = ? WHERE id = ?").run(title, notes, lesson.id);
    if (quiz) {
      db.prepare("DELETE FROM quizzes WHERE lesson_id = ?").run(lesson.id);
      db.prepare(
        `INSERT INTO quizzes (id, lesson_id, question, options, answer_index, explanation, replay_seconds)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        `quiz-${crypto.randomUUID()}`,
        lesson.id,
        quiz.question,
        JSON.stringify(quiz.options),
        quiz.answerIndex,
        quiz.explanation,
        Math.round(quiz.replaySeconds),
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { title, notes, quiz: quiz ?? null, updatedAt: now };
}

export function startGeneration(courseId: string) {
  const jobs = (globalThis.__courseitJobs ??= new Set<string>());
  if (jobs.has(courseId)) return;
  jobs.add(courseId);
  const heartbeat = setInterval(() => {
    try {
      getDb().prepare(
        "UPDATE courses SET updated_at = ? WHERE id = ? AND status = 'generating'",
      ).run(new Date().toISOString(), courseId);
    } catch (error) {
      console.error("[generate] heartbeat failed", courseId, error);
    }
  }, 20_000);
  heartbeat.unref();
  void generateCourse(courseId).catch((error) => {
    console.error("[generate] unexpected failure", courseId, error);
    getDb().prepare(
      "UPDATE courses SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
    ).run("Course generation stopped unexpectedly. Try again.", new Date().toISOString(), courseId);
  }).finally(() => {
    clearInterval(heartbeat);
    jobs.delete(courseId);
  });
}
