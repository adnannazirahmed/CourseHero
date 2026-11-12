import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const project = fileURLToPath(new URL("..", import.meta.url));
const testsDir = path.join(project, "tests");
const runtime = await fs.mkdtemp(path.join(testsDir, ".runtime-"));
const relativeDist = path.relative(project, path.join(runtime, "next"));
const dataDir = path.join(runtime, "data");
const port = 4017;
const base = `http://127.0.0.1:${port}`;
let log = "";
let server;
const env = {
  ...process.env,
  COURSEIT_DATA_DIR: dataDir,
  COURSEIT_DIST_DIR: relativeDist,
  NEXT_FONT_GOOGLE_MOCKED_RESPONSES: path.join(testsDir, "fonts.cjs"),
};

function next(args) {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", ...args], {
    cwd: project, env, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (part) => { log += String(part); });
  child.stderr.on("data", (part) => { log += String(part); });
  return child;
}

async function build() {
  const child = next(["build", "--webpack"]);
  const code = await new Promise((resolve) => child.once("exit", resolve));
  if (code !== 0) throw new Error(`Test build failed:\n${log.slice(-5000)}`);
}

function checkedFetch(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(20_000) });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Test server exited:\n${log.slice(-4000)}`);
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch { /* compiling or starting */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Test server did not start:\n${log.slice(-4000)}`);
}

try {
  await build();
  server = next(["start", "-p", String(port), "-H", "127.0.0.1"]);
  await waitForServer();
  const db = new DatabaseSync(path.join(dataDir, "courseit.db"));
  const loginPage = await checkedFetch(`${base}/login`);
  assert.equal(loginPage.status, 404);
  const coursePage = await checkedFetch(`${base}/course/course-python-ai`);
  assert.equal(coursePage.status, 200);
  assert.match(await coursePage.text(), /Longest study day/);
  const beforeResponse = await checkedFetch(`${base}/api/export`);
  assert.equal(beforeResponse.status, 200);
  const archive = await beforeResponse.json();
  assert.equal(archive.version, 2);
  assert.equal(archive.roadmapItems.length, 3);
  assert.ok(archive.activities.length >= 3);

  const malformed = structuredClone(archive);
  malformed.lessons[0].course_id = "missing-course";
  const rejected = await checkedFetch(`${base}/api/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(malformed),
  });
  assert.equal(rejected.status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM courses").get().n, archive.courses.length);

  const importResponse = await checkedFetch(`${base}/api/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(archive),
  });
  const importResult = await importResponse.json();
  assert.equal(importResponse.status, 200, JSON.stringify(importResult));
  assert.equal(importResult.courses, archive.courses.length);

  const afterResponse = await checkedFetch(`${base}/api/export`);
  const after = await afterResponse.json();
  assert.equal(after.courses.length, archive.courses.length * 2);
  assert.equal(after.notes.length, archive.notes.length * 2);
  assert.equal(after.roadmapItems.length, archive.roadmapItems.length * 2);

  const readyRetry = await checkedFetch(`${base}/api/courses/course-python-ai`, {
    method: "POST",
  });
  assert.equal(readyRetry.status, 409);

  const staleId = `course-${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO courses (id, owner_id, title, slug, youtube_url, status, created_at, updated_at)
    VALUES (?, 'user-demo', 'Stale build', ?, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'generating', ?, ?)`)
    .run(staleId, staleId, new Date().toISOString(), new Date(Date.now() - 120_000).toISOString());
  db.prepare("INSERT INTO enrollments (id, user_id, course_id, created_at) VALUES (?, 'user-demo', ?, ?)")
    .run(crypto.randomUUID(), staleId, new Date().toISOString());
  const staleResponse = await checkedFetch(`${base}/api/courses/${staleId}`);
  const stale = await staleResponse.json();
  assert.equal(stale.status, "failed");
  const dashboard = await checkedFetch(`${base}/dashboard`);
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /Builds needing attention/);

  for (let attempt = 0; attempt < 5; attempt++) {
    db.prepare("INSERT INTO generation_attempts (id, user_id, course_id, created_at) VALUES (?, 'user-demo', ?, ?)")
      .run(crypto.randomUUID(), staleId, new Date().toISOString());
  }
  const limited = await checkedFetch(`${base}/api/courses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", days: 7 }),
  });
  assert.equal(limited.status, 429);
  db.close();
  process.stdout.write("Integration checks passed: no login, export/import, retry guard, stale recovery, build quota.\n");
} finally {
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill("SIGKILL");
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Test server did not stop.")), 5000)),
    ]);
  }
  const tsconfigPath = path.join(project, "tsconfig.json");
  const tsconfig = JSON.parse(await fs.readFile(tsconfigPath, "utf8"));
  const distPrefix = relativeDist.replaceAll("\\", "/") + "/";
  tsconfig.include = tsconfig.include.filter((entry) => !entry.replaceAll("\\", "/").startsWith(distPrefix));
  await fs.writeFile(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);
  const actualTestsDir = await fs.realpath(testsDir);
  const actualRuntime = await fs.realpath(runtime);
  if (path.dirname(actualRuntime) !== actualTestsDir || !path.basename(actualRuntime).startsWith(".runtime-")) {
    throw new Error("Refusing to remove a runtime directory outside tests/.");
  }
  await fs.rm(actualRuntime, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
