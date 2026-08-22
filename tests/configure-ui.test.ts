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

test("exercise mix offers in-place select-all and deselect-all controls", () => {
  const start = viewSource.indexOf("private renderExerciseMix(");
  const end = viewSource.indexOf("private renderConfigureOutput(", start);
  assert.ok(start >= 0 && end > start);
  const implementation = viewSource.slice(start, end);
  assert.match(implementation, /\.setButtonText\("Select all"\)/u);
  assert.match(implementation, /applyMix\(balanceExerciseTypes\(EXERCISE_TYPES\)\)/u);
  assert.match(implementation, /\.setButtonText\("Deselect all"\)/u);
  assert.match(implementation, /applyMix\(balanceExerciseTypes\(\[\]\)\)/u);
  assert.match(implementation, /deselectAllButton\.setDisabled\(selectedCount === 0\)/u);
  assert.doesNotMatch(implementation, /this\.render\s*\(/u);
});

test("configure uses a provider-aware model picker with an explicit custom fallback", () => {
  const start = viewSource.indexOf("const modelSetting =");
  const end = viewSource.indexOf('.setName("Number of exercises")', start);
  assert.ok(start >= 0 && end > start);
  const implementation = viewSource.slice(start, end);
  assert.match(implementation, /AUTOMATIC_MODEL_CHOICE/u);
  assert.match(implementation, /CUSTOM_MODEL_CHOICE/u);
  assert.match(implementation, /Custom model id…/u);
  assert.match(implementation, /customModelInput\.hidden/u);
  assert.match(implementation, /supportedReasoningEfforts/u);
  assert.match(implementation, /configurationChanged\(\)/u);
  assert.doesNotMatch(implementation, /this\.render\s*\(/u);
});

test("configure remembers model state per provider and records agy Automatic exactly", () => {
  assert.match(viewSource, /modelsByProvider: Record<ProviderId, string>/u);
  assert.match(viewSource, /customModelDraftsByProvider/u);
  assert.match(viewSource, /this\.modelsByProvider\[this\.provider\] = this\.model/u);
  assert.match(viewSource, /private effectiveModel\(\): string/u);
  assert.match(viewSource, /automaticModelForProvider\("agy"/u);
  assert.match(viewSource, /model: this\.effectiveModel\(\)/u);
});

test("background provider refresh defers a configure rebuild while a control is focused", () => {
  assert.match(viewSource, /deferProviderUpdateWhileFocused\(providers\)/u);
  assert.match(viewSource, /this\.contentEl\.ownerDocument\.activeElement/u);
  assert.match(viewSource, /addEventListener\("focusout"/u);
  assert.match(viewSource, /this\.renderPreservingScroll\(\)/u);
});
