import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [viewSource, statisticsViewSource] = await Promise.all([
  readFile(
    new URL("../src/ui/practice-lab-view.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/bank-statistics-view.ts", import.meta.url),
    "utf8",
  ),
]);

test("study mode presents a named Practice Run with immediate objective feedback", () => {
  assert.match(viewSource, /aria-label": "Practice run status"/u);
  assert.match(viewSource, /text: "Practice run"/u);
  assert.match(viewSource, /"Run points"/u);
  assert.match(viewSource, /"Answer streak"/u);
  assert.match(viewSource, /"Run rank"/u);
  assert.match(viewSource, /this\.projectedPracticeRun\(\)/u);
  assert.match(viewSource, /role: "status"/u);
});

test("completion and saved history retain derived run rank and best streak", () => {
  assert.match(viewSource, /"Best answer streak"/u);
  assert.match(viewSource, /run\.rank\.description/u);
  assert.match(statisticsViewSource, /statistics\.bestAnswerStreak/u);
  assert.match(statisticsViewSource, /session\.practiceRun\.rank/u);
  assert.match(statisticsViewSource, /session\.practiceRun\.bestStreak/u);
});
