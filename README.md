# Course Hero Local

A local-first, self-hosted version of [Course Hero](https://www.courseit.xyz/): paste a YouTube
video or playlist, get a structured course with lessons, study notes, quizzes, a placement test,
a day-by-day plan, timestamped notes, streaks and shareable roadmaps. With an AI key it also adds a
transcript-grounded tutor, AI notes and flashcards, adaptive quiz review, goal-to-roadmap planning,
and a weekly study coach.

Everything is stored on this computer in SQLite. Courses, notes, quiz answers, progress and
streaks survive restarts and are backed up automatically.

## Run it

Requires **Node.js 22.5+** (tested on Node 24) because the app uses the built-in `node:sqlite`
module.

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:3000>. If port 3000 is already taken, Next prints the port it chose in the
terminal. You can force one with `npm run dev -- -p 3100`.

The database and schema are created automatically on first run.

There is no login. The app opens directly into a local learner profile. A new database includes
sample courses, completed lessons and pinned notes. Existing databases retain their courses and
progress. If an older database has one personal profile, the app uses it automatically. If it has
several, set `COURSEIT_LOCAL_USER_ID` to the profile ID you want to use.

## How course building works

1. Paste a YouTube video or playlist URL and choose a finish line from 1 to 30 days.
2. The server reads the public video metadata and captions.
3. It splits the video into lessons, writes study notes and adds comprehension quizzes where
   captions provide enough material.
4. Playlists are planned as one course across their videos (up to 20 hours / 24 videos for a single
   build). AI can combine or split videos into coherent lessons; the offline builder uses one
   lesson per video.
5. Lessons are ready when generation finishes. The course page polls for completion. If the server
   stops mid-build, the course appears on the dashboard and becomes retryable after 90 seconds.

A watch link that contains both `v` and `list` builds the video. Use a `/playlist?list=…` link to
build the entire playlist. Builds are limited to five attempts per local profile and 20 per server in a
rolling 24-hour period, with two builds running at once. Failed retries count toward these limits.

Videos are played in YouTube's own iframe player. Nothing is downloaded or re-uploaded.

### Optional AI layer

Without an AI key the app uses a local transcript-based lesson builder: chapter detection,
extractive study notes and cloze quizzes. The dashboard coach also falls back to a local summary,
and the tutor returns matching transcript passages. All other AI tools explain that a key is needed.

Copy `.env.example` to `.env` and fill in:

```bash
AI_API_KEY=your-key
AI_MODEL=your-model-id
AI_FAST_MODEL=optional-cheaper-model
AI_BASE_URL=https://your-openai-compatible-endpoint/v1
```

`AI_BASE_URL` defaults to `https://freebuff.com/api/v1/paid` when omitted. Both `AI_API_KEY` and
`AI_MODEL` must be set for AI to run. `AI_FAST_MODEL` is optional and is used for tutoring, notes,
review help and the weekly coach; without it those tasks use `AI_MODEL`. Keys stay on the server and
are never sent to the browser.

When AI is on, the app uses it for:

- Single-video and playlist course planning, notes and quizzes
- A lesson tutor grounded in stored transcript chunks, with clickable timestamps
- Lesson summaries, cheat sheets, flashcards and feedback on an “explain it back” answer
- A weekly study-coach review with three concrete actions
- Goal-to-roadmap generation from the local course library
- Optional regeneration of one lesson’s notes and quiz

If a provider request fails, the course builder falls back to the local builder and the other AI
features return an actionable error. Transcripts are cached in SQLite after they are fetched.

Transcript availability depends on the video: private, age-restricted, or captionless videos
cannot be turned into a full course. The UI reports the error and keeps the course record.

## Where your data lives

| What | Where |
| --- | --- |
| Database (local profile, courses, notes, progress) | `data/courseit.db` |
| Automatic snapshots (last 14, on every server start) | `data/backups/` |
| JSON export of the local profile | `GET /api/export` |
| JSON import into the local profile | Dashboard → Restore your learning |

The database runs in WAL mode with full synchronous writes. No password or session is needed to
use the app. Older databases may still contain account and session records, but the app does not
use them for access control.

Manual backup:

```bash
npm run backup
```

The backup script checkpoints the WAL and copies the database into `data/backups/` with a
timestamp, keeping the newest 14 copies. You can also simply copy `data/` while the server is
stopped.

The version 2 JSON export contains courses, lessons, quizzes, notes, progress, placements,
enrollments, roadmaps and their stages, study activity, quiz reviews and weekly-coach entries.
Import adds a copy to the signed-in local profile; it does not replace current data. The import
limit is 10 MB. Keep SQLite snapshots for full database recovery.

To override the storage location, set `COURSEIT_DATA_DIR` (or `COURSEIT_DB` for the file itself).

## Production on this computer

```bash
npm run build
npm start
```

The default `dev` and `start` commands listen only on `127.0.0.1`. There is no authentication,
so anyone who can reach the server can read and change the local learning data. Keep it bound to
this computer. YouTube access is required to fetch videos and transcripts; an optional AI provider
is contacted only when configured. There is no external database or telemetry.

## Features

- Automatic local learner profile, with sample courses on a fresh database
- YouTube video + playlist ingestion with metadata, chapters and transcripts
- AI or offline lesson planning, study notes and quizzes, with per-course goals and difficulty
- Transcript-grounded AI tutor with timestamp citations that seek the player
- AI summaries, cheat sheets, flashcards and explain-it-back feedback
- Adaptive quiz review queue with spaced intervals for missed questions
- Placement test that prioritizes weak spots and skips known lessons
- Daily plan sized to your pace, with skipped/done lessons dropping out and a pace indicator
- Lesson player with study notes, quiz replay-at-timestamp, mark complete
- Notes pinned to the second, click to replay from that moment
- Global search across courses, lessons, notes and cached transcripts
- Goal-to-roadmap generation and a weekly AI/local study coach
- Streak tracking and a dashboard with today's plan and recent notes
- Local course catalog and roadmaps
- Exportable and importable learning data, plus automatic SQLite snapshots
- Responsive layout and dark mode

## Project layout

```
app/                 pages and API routes (Next.js App Router)
components/          UI, lesson player, forms, icons
lib/db.ts            SQLite schema, seed data, startup backups
lib/ai.ts            shared OpenAI-compatible client, model routing and usage logging
lib/generate.ts      course generation (AI + offline fallback) and lesson regeneration
lib/transcripts.ts   transcript/chunk storage, retrieval and prompt context
lib/reviews.ts       spaced-review scheduling
lib/coach.ts         weekly coach data and local fallback
lib/search.ts        course, lesson, note and transcript search
lib/youtube.ts       URL parsing, metadata, chapters, transcripts, playlists
lib/plan.ts          daily plan, duration formatting, streaks
data/                your database and backups (gitignored)
```

## Notes

- This is a local reimplementation for personal/self-hosted use. It is not affiliated with
  YouTube, Google, Triggerfy or the original Course Hero.
- The “Powered by NVIDIA Nemotron” label is part of the reproduced design; local generation uses
  whichever OpenAI-compatible model you configure, or the offline builder.
- `next/font` needs network access during the first build to fetch the three font families. The
  fonts are then served from the built app; runtime does not call Google Fonts.
- Deleting `data/` while the server is stopped resets the app completely. Back up first.
