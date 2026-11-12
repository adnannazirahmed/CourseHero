import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadSource(name) {
  const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
}

const { parseYouTubeUrl } = await loadSource("youtube-url");
const { dailyMinutesForTarget, planForTargetDays } = await loadSource("plan");

test("watch URLs build the video even when a playlist is present", () => {
  assert.deepEqual(parseYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890"), {
    videoId: "dQw4w9WgXcQ",
    playlistId: "PL1234567890",
  });
  assert.deepEqual(parseYouTubeUrl("https://www.youtube.com/playlist?list=PL1234567890"), {
    videoId: null,
    playlistId: "PL1234567890",
  });
  assert.equal(parseYouTubeUrl("https://www.youtube.com/playlist?list=bad"), null);
  assert.equal(parseYouTubeUrl(`https://youtube.com/playlist?list=${"A".repeat(2100)}`), null);
});

test("daily estimate reflects the longest planned study day", () => {
  const lessons = [
    { id: "a", title: "A", position: 0, start_seconds: 0, end_seconds: 3600 },
    { id: "b", title: "B", position: 1, start_seconds: 3600, end_seconds: 7200 },
  ];
  const plan = planForTargetDays(lessons, 7, new Set(), new Set());
  assert.deepEqual(plan.map((day) => day.totalSeconds / 60), [60, 60]);
  assert.equal(dailyMinutesForTarget(lessons, 7, new Set(), new Set()), 60);
});
