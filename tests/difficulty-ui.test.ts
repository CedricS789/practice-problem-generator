import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [selectorSource, quickSource, settingsSource, pathSource, savedSetSource] = await Promise.all([
  readFile(new URL("../src/ui/difficulty-selector.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/practice-lab-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/settings.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/learning-path-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/saved-set-generation-modal.ts", import.meta.url), "utf8"),
]);

test("difficulty selector is an accessible descriptive profile chooser", () => {
  assert.match(selectorSource, /role: "radiogroup"/u);
  assert.match(selectorSource, /type: "radio"/u);
  assert.match(selectorSource, /profile\.description/u);
  assert.match(selectorSource, /profile\.itemCalibration/u);
  assert.match(selectorSource, /practice-lab-difficulty-recommended/u);
  assert.match(selectorSource, /classList\.toggle\("is-selected", selected\)/u);
});

test("every generation surface uses the shared difficulty profiles", () => {
  for (const source of [quickSource, settingsSource, pathSource, savedSetSource]) {
    assert.match(source, /renderDifficultySelector/u);
  }
  assert.match(quickSource, /Difficulty: \$\{displayDifficulty\(this\.difficulty\)\}/u);
  assert.match(pathSource, /displayDifficulty\(configuration\.difficulty\)/u);
  assert.match(savedSetSource, /displayDifficulty\(this\.request\.configuration\.difficulty\)/u);
  assert.match(settingsSource, /settingDifficultyFromGeneration/u);
});

test("quick difficulty changes invalidate only the payload output", () => {
  const start = quickSource.indexOf("const difficultySetting =");
  const end = quickSource.indexOf("const focusSetting =", start);
  assert.ok(start >= 0 && end > start);
  const implementation = quickSource.slice(start, end);
  assert.match(implementation, /configurationChanged\(\)/u);
  assert.doesNotMatch(implementation, /this\.render\s*\(/u);
});
