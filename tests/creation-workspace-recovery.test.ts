import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [mainSource, quickViewSource, guidedViewSource, stylesSource] = await Promise.all([
  readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/practice-lab-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/learning-path-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
]);

test("quick and guided creation use one clearly related mode vocabulary", () => {
  assert.match(quickViewSource, /Practice creation - quick set/u);
  assert.match(guidedViewSource, /Practice creation - guided path/u);
  assert.match(quickViewSource, /aria-label": "Practice creation mode"/u);
  assert.match(guidedViewSource, /aria-label": "Practice creation mode"/u);
  assert.match(quickViewSource, /text: "Quick set"/u);
  assert.match(quickViewSource, /text: "Guided path"/u);
  assert.match(guidedViewSource, /text: "Quick set"/u);
  assert.match(guidedViewSource, /text: "Guided path"/u);
  assert.match(stylesSource, /\.practice-creation-mode-switch/u);
});

test("guided creation can always return to an empty quick set", () => {
  assert.match(
    guidedViewSource,
    /openQuickPractice: \(source: SourcePresentation \| null\)/u,
  );
  assert.match(guidedViewSource, /quick\.disabled = switchBlocked;/u);
  assert.match(
    guidedViewSource,
    /if \(!quick\.disabled\) \{\s+void this\.options\.callbacks\.openQuickPractice\(this\.primary\);/u,
  );
  assert.doesNotMatch(
    guidedViewSource,
    /quick\.disabled = switchBlocked \|\| this\.primary === null/u,
  );
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
