import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const viewSource = await readFile(
  new URL("../src/ui/practice-lab-view.ts", import.meta.url),
  "utf8",
);

test("exercise-mix interactions refresh controls in place instead of rebuilding the view", () => {
  const start = viewSource.indexOf("private renderExerciseMix(");
  const end = viewSource.indexOf("private renderConfigureOutput(", start);
  assert.ok(start >= 0 && end > start);
  const implementation = viewSource.slice(start, end);
  assert.match(implementation, /addEventListener\("input"/u);
  assert.match(implementation, /refresh\(\);\s*onConfigurationChanged\(\);/u);
  assert.doesNotMatch(implementation, /this\.render\s*\(/u);
});

test("configuration changes invalidate only the preview/output region", () => {
  const start = viewSource.indexOf("const configurationChanged");
  const end = viewSource.indexOf("const form =", start);
  assert.ok(start >= 0 && end > start);
  const implementation = viewSource.slice(start, end);
  assert.match(implementation, /this\.invalidatePreview\(\)/u);
  assert.match(implementation, /refreshOutput\(\)/u);
  assert.doesNotMatch(implementation, /this\.render\s*\(/u);
});

test("slider-driven zero shares retain intent and automatically return when sliding back", () => {
  const start = viewSource.indexOf("private renderExerciseMix(");
  const end = viewSource.indexOf("private renderConfigureOutput(", start);
  assert.ok(start >= 0 && end > start);
  const implementation = viewSource.slice(start, end);
  assert.match(implementation, /const intendedTypes = new Set/u);
  assert.match(implementation, /const rememberedPercentages =/u);
  assert.match(implementation, /rebalanceExerciseTypePercentageWithIntent/u);
  assert.match(implementation, /preserveSliderIntent/u);
  assert.match(implementation, /will return automatically when you slide back/u);
});
