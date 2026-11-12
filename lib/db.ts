import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hashPassword, newToken } from "./password";

export type DB = DatabaseSync;

const DATA_DIR = process.env.COURSEIT_DATA_DIR
  ? path.resolve(process.env.COURSEIT_DATA_DIR)
  : path.join(process.cwd(), "data");
export const DB_PATH = process.env.COURSEIT_DB
  ? path.resolve(process.env.COURSEIT_DB)
  : path.join(DATA_DIR, "courseit.db");
const BACKUP_DIR = path.join(DATA_DIR, "backups");

declare global {
  // eslint-disable-next-line no-var
  var __courseitDb: DatabaseSync | undefined;
}

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function backupExisting(db: DatabaseSync) {
  try {
    const stat = fs.statSync(DB_PATH);
    if (stat.size === 0) return;
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(BACKUP_DIR, `courseit-${stamp}.db`);
    fs.copyFileSync(DB_PATH, target);
    const backups = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("courseit-") && f.endsWith(".db"))
      .sort();
    while (backups.length > 14) {
      const oldest = backups.shift();
      if (oldest) fs.unlinkSync(path.join(BACKUP_DIR, oldest));
    }
  } catch (error) {
    console.warn("[db] backup skipped:", error);
  }
}

function migrate(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      goal TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      youtube_url TEXT NOT NULL,
      youtube_id TEXT,
      playlist_id TEXT,
      author TEXT NOT NULL DEFAULT '',
      thumbnail TEXT NOT NULL DEFAULT '',
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'video',
      pace_minutes INTEGER NOT NULL DEFAULT 60,
      target_days INTEGER NOT NULL DEFAULT 7,
      status TEXT NOT NULL DEFAULT 'generating',
      error TEXT,
      visibility TEXT NOT NULL DEFAULT 'public',
      added_by TEXT NOT NULL DEFAULT '',
      popularity INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      start_seconds INTEGER NOT NULL DEFAULT 0,
      end_seconds INTEGER NOT NULL DEFAULT 0,
      video_id TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS lessons_course_idx ON lessons(course_id, position);

    CREATE TABLE IF NOT EXISTS quizzes (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL UNIQUE REFERENCES lessons(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      options TEXT NOT NULL,
      answer_index INTEGER NOT NULL,
      explanation TEXT NOT NULL DEFAULT '',
      replay_seconds INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS enrollments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      target_days INTEGER,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, course_id)
    );

    CREATE TABLE IF NOT EXISTS lesson_state (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      completed INTEGER NOT NULL DEFAULT 0,
      watched_seconds INTEGER NOT NULL DEFAULT 0,
      note_text TEXT NOT NULL DEFAULT '',
      quiz_correct INTEGER,
      quiz_answer INTEGER,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, lesson_id)
    );
    CREATE INDEX IF NOT EXISTS lesson_state_course_idx ON lesson_state(user_id, course_id);

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      time_seconds INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notes_user_idx ON notes(user_id, created_at);

    CREATE TABLE IF NOT EXISTS placements (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      skipped TEXT NOT NULL DEFAULT '[]',
      score INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, course_id)
    );

    CREATE TABLE IF NOT EXISTS roadmaps (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roadmap_items (
      id TEXT PRIMARY KEY,
      roadmap_id TEXT NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      position INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roadmap_enrollments (
      id TEXT PRIMARY KEY,
      roadmap_id TEXT NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE(roadmap_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
      lesson_id TEXT,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS activities_user_idx ON activities(user_id, created_at);

    CREATE TABLE IF NOT EXISTS generation_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS generation_attempts_time_idx ON generation_attempts(created_at);
    CREATE INDEX IF NOT EXISTS generation_attempts_user_idx ON generation_attempts(user_id, created_at);

    CREATE TABLE IF NOT EXISTS transcripts (
      video_id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transcript_chunks (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      video_id TEXT NOT NULL,
      start_seconds INTEGER NOT NULL DEFAULT 0,
      end_seconds INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS transcript_chunks_course_idx ON transcript_chunks(course_id, start_seconds);
    CREATE INDEX IF NOT EXISTS transcript_chunks_video_idx ON transcript_chunks(course_id, video_id);

    CREATE TABLE IF NOT EXISTS quiz_reviews (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      due_at TEXT NOT NULL,
      interval_days INTEGER NOT NULL DEFAULT 1,
      misses INTEGER NOT NULL DEFAULT 0,
      last_result TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, quiz_id)
    );
    CREATE INDEX IF NOT EXISTS quiz_reviews_due_idx ON quiz_reviews(user_id, due_at);

    CREATE TABLE IF NOT EXISTS weekly_coach (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week_key TEXT NOT NULL,
      summary TEXT NOT NULL,
      actions TEXT NOT NULL DEFAULT '[]',
      focus TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE(user_id, week_key)
    );

    CREATE TABLE IF NOT EXISTS ai_usage (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      task TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ai_usage_user_idx ON ai_usage(user_id, created_at);
  `);

  const userColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (!userColumns.some((column) => column.name === "goal")) {
    db.exec("ALTER TABLE users ADD COLUMN goal TEXT NOT NULL DEFAULT ''");
  }

  // Additive migrations for databases created before the finish-line feature.
  const courseColumns = db.prepare("PRAGMA table_info(courses)").all() as Array<{ name: string }>;
  if (!courseColumns.some((column) => column.name === "target_days")) {
    db.exec("ALTER TABLE courses ADD COLUMN target_days INTEGER NOT NULL DEFAULT 7");
  }
  const enrollmentColumns = db.prepare("PRAGMA table_info(enrollments)").all() as Array<{
    name: string;
  }>;
  if (!enrollmentColumns.some((column) => column.name === "target_days")) {
    db.exec("ALTER TABLE enrollments ADD COLUMN target_days INTEGER");
  }
  const lessonStateColumns = db.prepare("PRAGMA table_info(lesson_state)").all() as Array<{
    name: string;
  }>;
  if (!lessonStateColumns.some((column) => column.name === "note_text")) {
    db.exec("ALTER TABLE lesson_state ADD COLUMN note_text TEXT NOT NULL DEFAULT ''");
  }
  if (!courseColumns.some((column) => column.name === "course_goal")) {
    db.exec("ALTER TABLE courses ADD COLUMN course_goal TEXT NOT NULL DEFAULT ''");
  }
  if (!courseColumns.some((column) => column.name === "difficulty")) {
    db.exec("ALTER TABLE courses ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'beginner'");
  }
  const roadmapColumns = db.prepare("PRAGMA table_info(roadmaps)").all() as Array<{ name: string }>;
  if (!roadmapColumns.some((column) => column.name === "goal")) {
    db.exec("ALTER TABLE roadmaps ADD COLUMN goal TEXT NOT NULL DEFAULT ''");
  }
  db.prepare("UPDATE users SET email = 'demo@coursehero.local' WHERE email = 'demo@courseit.local'").run();
}

type DemoCourse = {
  id: string;
  title: string;
  author: string;
  youtubeId: string;
  durationMinutes: number;
  popularity: number;
  addedBy: string;
  slug: string;
  targetDays: number;
  topics: string[];
};

const DEMO_COURSES: DemoCourse[] = [
  {
    id: "course-agentic-ai",
    slug: "complete-agentic-ai-course",
    title:
      "Complete Agentic AI Course In 10 Hours- Langchain, Langgraph, RAG,Vectorless RAG, Guardrails,Evals",
    author: "Krish Naik",
    youtubeId: "rV3HJ4LEZ7k",
    durationMinutes: 673,
    popularity: 255,
    addedBy: "Bhanuranjan",
    targetDays: 7,
    topics: [
      "What agents really are",
      "Tools and function calling",
      "Building a LangGraph agent",
      "RAG and vectorless RAG",
      "Guardrails for agents",
      "Evals and tracing",
    ],
  },
  {
    id: "course-python-ai",
    slug: "python-for-ai-full-beginner-course",
    title: "Python for AI - Full Beginner Course",
    author: "Dave Ebbelaar",
    youtubeId: "ygXn5nV5qFc",
    durationMinutes: 316,
    popularity: 148,
    addedBy: "ABHISHEK",
    targetDays: 5,
    topics: [
      "Python setup and notebooks",
      "Data types and control flow",
      "Functions and modules",
      "Pandas for data work",
      "Calling an LLM from Python",
      "Building a small AI app",
    ],
  },
  {
    id: "course-fullstack-ai",
    slug: "full-stack-ai-engineering-course",
    title: "Full-Stack AI Engineering Course (FastAPI, LLMs, Docker, Supabase)",
    author: "Dave Ebbelaar",
    youtubeId: "XzjSx7u9mGw",
    durationMinutes: 190,
    popularity: 94,
    addedBy: "Manish",
    targetDays: 4,
    topics: [
      "FastAPI fundamentals",
      "Serving LLMs",
      "Docker basics",
      "Supabase auth and storage",
      "Deploying the stack",
    ],
  },
  {
    id: "course-cs50-python",
    slug: "harvard-cs50-python",
    title:
      "Harvard CS50’s Introduction to Programming with Python – Full University Course",
    author: "freeCodeCamp.org",
    youtubeId: "nLRL_NcnK-4",
    durationMinutes: 958,
    popularity: 40,
    addedBy: "Durvesh",
    targetDays: 14,
    topics: [
      "Functions and variables",
      "Conditionals",
      "Loops",
      "Exceptions",
      "Libraries",
      "File I/O",
    ],
  },
  {
    id: "course-python-baraa",
    slug: "python-full-course-for-beginners",
    title: "Python Full Course for Beginners (13 Hours) – From Zero to Hero",
    author: "Data with Baraa",
    youtubeId: "Rq5gJVxz55Q",
    durationMinutes: 783,
    popularity: 27,
    addedBy: "Satendra",
    targetDays: 7,
    topics: [
      "Course roadmap and setup",
      "Variables and data types",
      "Operators and strings",
      "Lists and tuples",
      "Dictionaries and sets",
    ],
  },
  {
    id: "course-python-free",
    slug: "python-full-course-for-free",
    title: "Python Full Course for free 🐍",
    author: "Bro Code",
    youtubeId: "ix9cRaBkVe0",
    durationMinutes: 720,
    popularity: 26,
    addedBy: "Prince",
    targetDays: 6,
    topics: [
      "Getting started",
      "Variables and types",
      "User input",
      "Math functions",
      "If statements",
    ],
  },
];

function noteFor(topic: string, courseTitle: string) {
  return `### Overview

This lesson walks through **${topic}** as part of *${courseTitle}*. The instructor explains why it matters, shows a worked example, and calls out the mistakes beginners usually make.

### Key points

- Start with the smallest working example before adding abstractions.
- Pause at each demo and reproduce it yourself.
- Write down one question you still have; the next lesson usually answers it.

### Practice

Rebuild the demo without looking, then compare your version with the video. If you get stuck, replay this lesson from the point where it stopped making sense.`;
}

function seed(db: DatabaseSync) {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (existing.n > 0) return;

  const now = new Date();
  const iso = (offsetMs = 0) => new Date(now.getTime() - offsetMs).toISOString();
  const day = 86_400_000;

  const demoId = "user-demo";
  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(demoId, "Learner", "local@coursehero.local", hashPassword(newToken()), iso(30 * day));

  for (const demo of DEMO_COURSES) {
    const totalSeconds = demo.durationMinutes * 60;
    const per = Math.floor(totalSeconds / demo.topics.length);
    db.prepare(
      `INSERT INTO courses (id, owner_id, title, slug, youtube_url, youtube_id, author, thumbnail, duration_seconds, description, source, pace_minutes, target_days, status, visibility, added_by, popularity, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'video', 60, ?, 'ready', 'public', ?, ?, ?, ?)`,
    ).run(
      demo.id,
      demoId,
      demo.title,
      demo.slug,
      `https://www.youtube.com/watch?v=${demo.youtubeId}`,
      demo.youtubeId,
      demo.author,
      `https://i.ytimg.com/vi/${demo.youtubeId}/maxresdefault.jpg`,
      totalSeconds,
      `A structured study course built from ${demo.author}'s video. Lessons, notes, quizzes and a day-by-day plan.`,
      demo.targetDays,
      demo.addedBy,
      demo.popularity,
      iso(20 * day),
      iso(day),
    );

    demo.topics.forEach((topic, index) => {
      const lessonId = `lesson-${demo.id}-${index}`;
      const start = index * per;
      const end = index === demo.topics.length - 1 ? totalSeconds : (index + 1) * per;
      db.prepare(
        `INSERT INTO lessons (id, course_id, position, title, start_seconds, end_seconds, video_id, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        lessonId,
        demo.id,
        index,
        topic,
        start,
        end,
        demo.youtubeId,
        noteFor(topic, demo.title),
        iso(20 * day),
      );

      const options = demo.topics.filter((t) => t !== topic).slice(0, 3);
      const answer = index % 4;
      options.splice(answer, 0, topic);
      db.prepare(
        `INSERT INTO quizzes (id, lesson_id, question, options, answer_index, explanation, replay_seconds)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        `quiz-${lessonId}`,
        lessonId,
        `Which topic does this lesson cover?`,
        JSON.stringify(options),
        answer,
        `This lesson focuses on ${topic}. Replay the opening minute for the summary.`,
        start + 12,
      );
    });
  }

  for (const courseId of ["course-agentic-ai", "course-python-ai", "course-cs50-python"]) {
    db.prepare(
      "INSERT INTO enrollments (id, user_id, course_id, created_at) VALUES (?, ?, ?, ?)",
    ).run(`enroll-demo-${courseId}`, demoId, courseId, iso(9 * day));
  }

  // Give the demo account a believable streak and some completed lessons.
  const python = DEMO_COURSES[1];
  for (let i = 0; i < 3; i++) {
    const lessonId = `lesson-${python.id}-${i}`;
    db.prepare(
      `INSERT INTO lesson_state (id, user_id, course_id, lesson_id, completed, watched_seconds, quiz_correct, quiz_answer, updated_at)
       VALUES (?, ?, ?, ?, 1, 0, 1, 0, ?)`,
    ).run(`state-demo-${lessonId}`, demoId, python.id, lessonId, iso((2 - i) * day));
    db.prepare(
      `INSERT INTO activities (id, user_id, course_id, lesson_id, kind, created_at) VALUES (?, ?, ?, ?, 'completed', ?)`,
    ).run(`activity-demo-${lessonId}`, demoId, python.id, lessonId, iso((2 - i) * day));
  }

  const firstLesson = `lesson-${python.id}-3`;
  db.prepare(
    `INSERT INTO notes (id, user_id, course_id, lesson_id, body, time_seconds, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "note-demo-1",
    demoId,
    python.id,
    firstLesson,
    "DataFrame.groupby is the workhorse for summaries. Remember to reset_index() before plotting.",
    312,
    iso(day),
  );
  db.prepare(
    `INSERT INTO notes (id, user_id, course_id, lesson_id, body, time_seconds, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "note-demo-2",
    demoId,
    python.id,
    firstLesson,
    "Prompt templates belong in their own module so you can version them like code.",
    905,
    iso(3 * 60 * 60 * 1000),
  );

  db.prepare(
    `INSERT INTO roadmaps (id, owner_id, title, slug, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    "roadmap-ai-engineer",
    demoId,
    "AI Engineer Roadmap",
    "ai-engineer",
    "From Python fundamentals to production AI apps. Finish one course, then unlock the next stage.",
    iso(10 * day),
  );
  ["course-python-ai", "course-fullstack-ai", "course-agentic-ai"].forEach((courseId, index) => {
    db.prepare(
      "INSERT INTO roadmap_items (id, roadmap_id, course_id, position) VALUES (?, ?, ?, ?)",
    ).run(`roadmap-item-${index}`, "roadmap-ai-engineer", courseId, index);
  });
}

export function getDb(): DatabaseSync {
  if (globalThis.__courseitDb) return globalThis.__courseitDb;

  ensureDirs();
  const db = new DatabaseSync(DB_PATH);
  backupExisting(db);
  migrate(db);
  seed(db);
  globalThis.__courseitDb = db;
  return db;
}
