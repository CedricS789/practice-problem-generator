import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  mainSource,
  quickViewSource,
  guidedViewSource,
  modeSwitchSource,
  sourcePickerSource,
  stylesSource,
] = await Promise.all([
  readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/practice-lab-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/learning-path-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/creation-mode-switch.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/source-picker.ts", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
]);

test("quick and guided creation use one clearly related mode vocabulary", () => {
  assert.match(quickViewSource, /Practice creation - quick set/u);
  assert.match(guidedViewSource, /Practice creation - guided path/u);
  assert.match(modeSwitchSource, /"aria-label": "Practice creation mode"/u);
  assert.match(modeSwitchSource, /label: "Quick set"/u);
  assert.match(modeSwitchSource, /label: "Guided path"/u);
  assert.match(quickViewSource, /active: "quick"/u);
  assert.match(guidedViewSource, /active: "guided"/u);
  assert.match(stylesSource, /\.practice-creation-mode-switch/u);
  assert.match(stylesSource, /\.practice-lab-view > \.practice-creation-mode-row/u);
});

test("context menus expose concise actions without an unnecessary product-name label", () => {
  assert.doesNotMatch(mainSource, /\.setIsLabel\(true\)/u);
  assert.match(mainSource, /\.setTitle\("Create practice from selection…"\)/u);
  assert.match(mainSource, /\.setTitle\("Create practice from this note…"\)/u);
  assert.match(mainSource, /\.setTitle\("Start saved practice for this note"\)/u);
  assert.match(mainSource, /\.setTitle\("Create practice from selected pages…"\)/u);
  assert.match(mainSource, /\.setTitle\("Start saved practice for this PDF"\)/u);
  assert.doesNotMatch(mainSource, /Practice Problem Generator: Build guided path from selection/u);
  assert.doesNotMatch(mainSource, /Practice Problem Generator: Build guided path from current note/u);
});

test("guided creation can always return to an empty quick set", () => {
  assert.match(
    guidedViewSource,
    /openQuickPractice: \(source: SourcePresentation \| null\)/u,
  );
  assert.match(
    guidedViewSource,
    /onQuick: \(\) => \{\s+void this\.options\.callbacks\.openQuickPractice\(this\.primary\);/u,
  );
  assert.doesNotMatch(
    guidedViewSource,
    /quickDisabled: switchBlocked \|\| this\.primary === null/u,
  );
});

test("quick and guided source stages share one selector and consistent source cards", () => {
  assert.match(quickViewSource, /renderSourceChoices\(section/u);
  assert.match(guidedViewSource, /renderSourceChoices\(container/u);
  assert.match(quickViewSource, /renderSourceSummaryCard\(section/u);
  assert.match(guidedViewSource, /renderSourceSummaryCard\(container/u);
  assert.match(sourcePickerSource, /label: "Current note"/u);
  assert.match(sourcePickerSource, /label: "Editor selection"/u);
  assert.match(sourcePickerSource, /label: "PDF pages"/u);
  assert.match(stylesSource, /\.practice-source-choice-grid/u);
  assert.match(stylesSource, /\.practice-source-summary-card/u);
});

test("guided visual defaults appear before supporting-material controls", () => {
  const sourceStart = guidedViewSource.indexOf("private renderSource(container");
  const sourceEnd = guidedViewSource.indexOf("private renderPlanningPreview", sourceStart);
  const implementation = guidedViewSource.slice(sourceStart, sourceEnd);
  assert.ok(implementation.indexOf("this.renderVisualBundleControls(section)") >= 0);
  assert.ok(
    implementation.indexOf("this.renderVisualBundleControls(section)")
      < implementation.indexOf("const supportHeading"),
  );
});

test("guided planning labels its actions and publishes live progress in place", () => {
  assert.match(
    guidedViewSource,
    /\.setIcon\("scan-eye"\)\s+\.setButtonText\(this\.busy === "preview"/u,
  );
  assert.match(
    guidedViewSource,
    /\.setIcon\("route"\)\s+\.setButtonText\(this\.busy === "blueprint"/u,
  );
  assert.match(guidedViewSource, /text: "Planner is working"/u);
  assert.match(guidedViewSource, /\.setButtonText\("Cancel planning"\)/u);
  assert.match(
    guidedViewSource,
    /this\.activity\.set\("blueprint"[\s\S]*this\.refreshBlueprintActivity\(\);/u,
  );
  assert.match(stylesSource, /\.practice-learning-path-planning-progress/u);
});

test("guided batch progress streams without rebuilding the complete workspace", () => {
  const generateStart = guidedViewSource.indexOf("private async generateAllSets()");
  const generateEnd = guidedViewSource.indexOf("private async saveLearningPath()", generateStart);
  assert.ok(generateStart >= 0 && generateEnd > generateStart);
  const generate = guidedViewSource.slice(generateStart, generateEnd);
  assert.match(generate, /this\.activity\.clear\(\)/u);
  assert.match(generate, /this\.refreshBatchProgress\(\)/u);
  assert.match(generate, /this\.refreshBatchActivity\(\)/u);
  assert.doesNotMatch(
    generate,
    /this\.statuses\.set\(setId, status\);\s*this\.render\(\)/u,
  );
  assert.match(guidedViewSource, /private batchNavigatorHost: HTMLElement \| null/u);
  assert.match(guidedViewSource, /private batchActivityHost: HTMLElement \| null/u);
});

test("guided progress navigation supports keyboard activation and honest disabled sets", () => {
  assert.match(guidedViewSource, /item\.setAttribute\("role", "button"\)/u);
  assert.match(guidedViewSource, /event\.key !== "Enter" && event\.key !== " "/u);
  assert.match(guidedViewSource, /button\.disabled = !available/u);
  assert.match(guidedViewSource, /Review opens after generation completes/u);
  assert.match(stylesSource, /\[role="button"\]/u);
});

test("mode switching reuses the current leaf and carries an approved source", () => {
  assert.match(
    mainSource,
    /switchCreationMode\([\s\S]*leaf\.setViewState\(\{[\s\S]*PRACTICE_LEARNING_PATH_VIEW_TYPE/u,
  );
  assert.match(
    mainSource,
    /switchCreationMode\([\s\S]*leaf\.setViewState\(\{ type: PRACTICE_LAB_VIEW_TYPE/u,
  );
  assert.match(mainSource, /learningPathController\.registerSource\(prepared\)/u);
});

test("recoverable quick generation is actionable where it blocks creation", () => {
  assert.match(quickViewSource, /Saved generation stopped/u);
  assert.match(quickViewSource, /Retry approved request/u);
  assert.match(quickViewSource, /Discard recovery\.\.\./u);
  assert.match(guidedViewSource, /Resolve the saved quick set first/u);
  assert.match(guidedViewSource, /Retry approved quick set/u);
  assert.match(guidedViewSource, /Discard recovery\.\.\./u);
  assert.match(guidedViewSource, /this\.quickGenerationRecovery !== null/u);
});

test("failed recovery can restart the exact approved request without reconfiguration", () => {
  assert.match(mainSource, /requestRetryInterruptedGeneration/u);
  assert.match(
    mainSource,
    /const retryPending: PendingGeneration = \{[\s\S]*source: pending\.source,[\s\S]*configuration: pending\.configuration,[\s\S]*prompt: pending\.prompt,[\s\S]*preparedVisuals: pending\.preparedVisuals/u,
  );
  assert.match(
    mainSource,
    /cancelDurableRecovery\(handle\)[\s\S]*clearGenerationRecovery\(true\)[\s\S]*this\.pendingGeneration = retryPending[\s\S]*this\.runGeneration/u,
  );
  assert.match(mainSource, /Retry interrupted generation from approved request/u);
});
