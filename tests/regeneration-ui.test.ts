import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [mainSource, viewSource, sourceModule] = await Promise.all([
  readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/practice-lab-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/source.ts", import.meta.url), "utf8"),
]);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `Missing source marker: ${start}`);
  assert.ok(endIndex > startIndex, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("saved banks route flat regeneration and learning-path management separately", () => {
  const block = sourceBetween(
    mainSource,
    "private async renderPracticeBlock(",
    "private renderReadOnlyBlock(",
  );
  assert.match(block, /text: "Regenerate \/ tweak"/u);
  assert.match(block, /regenerateBank\(bankPath, bank\)/u);
  assert.match(
    block,
    /if \(Platform\.isMobileApp\)[\s\S]*?else if \(bank\.learningPath === null\)/u,
  );
  assert.match(
    block,
    /else \{[\s\S]*?text: "Manage path"/u,
  );
  assert.match(block, /text: "Manage path"/u);
  assert.match(
    block,
    /openSavedLearningPathManager\(bankPath, bank\)/u,
  );
});

test("regeneration restores configuration but never bypasses payload approval", () => {
  const prepare = sourceBetween(
    viewSource,
    "public prepareRegeneration(",
    "public setDrafts(",
  );
  assert.match(prepare, /this\.setSource\(source\)/u);
  assert.match(prepare, /this\.setConfigurationDefaults\(defaults\)/u);
  assert.match(
    prepare,
    /this\.defaultFocusInstructions = defaultFocusInstructions/u,
    "a one-off previous focus must not replace the user's default for the next new source",
  );
  assert.match(prepare, /this\.stage = "configure"/u);
  assert.doesNotMatch(prepare, /payloadAccepted\s*=\s*true/u);
  assert.match(viewSource, /Previous practice loaded/u);
  assert.match(viewSource, /preview and approve the exact payload before generation/u);
});

test("whole-note regeneration uses current note content while selections stay bounded", () => {
  const regenerate = sourceBetween(
    mainSource,
    "private async regenerateBank(",
    "private async openView(",
  );
  assert.match(regenerate, /parseGenerationRecipeMarkdown/u);
  assert.match(regenerate, /regenerationPreset/u);
  assert.match(regenerate, /collectRegenerationSource/u);
  assert.match(regenerate, /this\.lastSource = restored\.source/u);
  assert.match(regenerate, /view\.prepareRegeneration/u);

  assert.match(
    sourceModule,
    /if \(bank\.source\.scope === "selection"\)[\s\S]*segments: bank\.segments\.map/u,
  );
  assert.match(
    sourceModule,
    /collectSourceFromFile\(\s*app,\s*file,\s*"note",\s*undefined,\s*classificationRules,\s*\)/u,
  );
  assert.match(
    sourceModule,
    /currentNoteChanged: current\.hash !== bank\.source\.hash/u,
  );
});

test("previous visuals are selected again and frame sources remain changeable", () => {
  assert.match(
    sourceModule,
    /Reusing the frame selected for the previous generation\. You can choose a different frame in Source\./u,
  );
  assert.match(sourceModule, /selected: true/u);
  assert.match(sourceModule, /frameSourcePath/u);
  assert.match(sourceModule, /restoredVisualCount/u);
});
