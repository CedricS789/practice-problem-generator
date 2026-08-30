import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  mainSource,
  quickViewSource,
  guidedViewSource,
  modeSwitchSource,
  sourcePickerSource,
  sourceMaterialPickerSource,
  stylesSource,
] = await Promise.all([
  readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/practice-lab-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/learning-path-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/creation-mode-switch.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/source-picker.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/source-material-picker-modal.ts", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
]);

test("quick and guided creation use one clearly related mode vocabulary", () => {
  assert.match(quickViewSource, /Practice creation - quick set/u);
  assert.match(guidedViewSource, /Practice creation - guided path/u);
  assert.match(modeSwitchSource, /"aria-label": "Practice creation mode"/u);
  assert.match(modeSwitchSource, /label: "Quick set"/u);
  assert.match(modeSwitchSource, /label: "Guided path"/u);
  assert.match(quickViewSource, /active: activeMode/u);
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

test("source replacement guidance occupies its own row without overlapping cards", () => {
  const noteStart = stylesSource.indexOf(".practice-source-replace-note {");
  const noteEnd = stylesSource.indexOf("}", noteStart);
  assert.ok(noteStart >= 0 && noteEnd > noteStart);
  const rule = stylesSource.slice(noteStart, noteEnd);
  assert.match(rule, /margin: var\(--size-4-2\) 0 var\(--size-4-3\);/u);
  assert.doesNotMatch(rule, /calc\(-1/u);
  assert.match(
    stylesSource,
    /\.practice-source-stage > \.practice-source-replace-note \{\s+margin: 0;/u,
  );
});

test("primary source cards can replace the active source through a searchable note picker", () => {
  assert.match(sourceMaterialPickerSource, /export function chooseSourceNoteFile/u);
  assert.match(sourceMaterialPickerSource, /Search for the Markdown note to use/u);
  assert.match(sourceMaterialPickerSource, /this\.kind === "note"\s+\? extension === "md"/u);
  assert.match(mainSource, /requestNoteSource: async \(\) =>/u);
  assert.match(mainSource, /const file = await chooseSourceNoteFile\(this\.app\);/u);
  assert.match(quickViewSource, /actionLabel: "Choose another note…"/u);
  assert.match(quickViewSource, /private async requestNoteSource\(\)/u);
  assert.match(quickViewSource, /const epoch = \+\+this\.sourceRequestEpoch/u);
  assert.match(guidedViewSource, /this\.choosePrimarySource\("vault-note"\)/u);
  const chooseStart = guidedViewSource.indexOf("private async choosePrimarySource(");
  const chooseEnd = guidedViewSource.indexOf("private async addSupportingSource(", chooseStart);
  assert.ok(chooseStart >= 0 && chooseEnd > chooseStart);
  const chooseImplementation = guidedViewSource.slice(chooseStart, chooseEnd);
  assert.ok(
    chooseImplementation.indexOf("this.setPrimarySource(source)")
      < chooseImplementation.indexOf("const prepared = await prepare(source)"),
    "the selected note must appear before default GIF-frame preparation finishes",
  );
  assert.match(sourcePickerSource, /practice-source-summary-actions/u);
  assert.match(sourcePickerSource, /setIcon\(actionIcon, "replace"\)/u);
  assert.match(stylesSource, /\.practice-source-summary-actions \{/u);
  assert.match(
    stylesSource,
    /\.practice-source-summary-actions \{\s+grid-column: 2;\s+justify-content: flex-start;/u,
  );
});

test("supporting PDFs wait for their picker to close and always require bounded pages", () => {
  assert.match(sourceMaterialPickerSource, /export function chooseSourcePdfFile/u);
  assert.match(sourceMaterialPickerSource, /Search for the PDF whose pages you want to add/u);
  assert.match(sourceMaterialPickerSource, /this\.kind === "note"[\s\S]*extension === "md"[\s\S]*extension === "pdf"/u);
  assert.match(sourceMaterialPickerSource, /onChooseItem\(file: TFile\): void \{\s*this\.chosenFile = file;/u);
  assert.doesNotMatch(sourceMaterialPickerSource, /onChooseItem\(file: TFile\): void \{\s*this\.finish\(file\)/u);
  assert.match(sourceMaterialPickerSource, /window\.setTimeout\(\(\) => this\.finish\(this\.chosenFile\), 0\)/u);
  assert.match(guidedViewSource, /Add supporting note/u);
  assert.match(guidedViewSource, /Add supporting PDF pages/u);
  assert.match(guidedViewSource, /this\.addSupportingSource\("note"\)/u);
  assert.match(guidedViewSource, /this\.addSupportingSource\("pdf"\)/u);
  assert.match(guidedViewSource, /requestSupportingSource\(\s*mode,\s*pdfBudget,/u);
  assert.match(guidedViewSource, /primary and supporting PDFs share one total generation budget/u);
  assert.match(guidedViewSource, /remainingPages\.toLocaleString\(\)/u);
  assert.match(guidedViewSource, /remainingCharacters\.toLocaleString\(\)/u);
  assert.match(mainSource, /maxPages: pdfBudget\.remainingPages/u);
  assert.match(mainSource, /maxCharacters: pdfBudget\.remainingCharacters/u);
  assert.match(mainSource, /mode === "pdf"[\s\S]*chooseSourcePdfFile\(this\.app\)[\s\S]*chooseSourceNoteFile\(this\.app\)/u);
  assert.match(mainSource, /mode === "pdf"[\s\S]*this\.requestPdfSource\(file\)/u);
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

test("planning preview scrolls into view and receives focus only after it is ready", () => {
  assert.match(guidedViewSource, /private planningPreviewHost: HTMLElement \| null/u);
  assert.match(guidedViewSource, /this\.planningPreviewHost = section/u);
  assert.match(guidedViewSource, /section\.tabIndex = -1/u);
  assert.match(guidedViewSource, /if \(completed\) this\.revealPlanningPreview\(\)/u);
  assert.match(guidedViewSource, /window\.requestAnimationFrame/u);
  assert.match(guidedViewSource, /preview\.focus\(\{ preventScroll: true \}\)/u);
  assert.match(guidedViewSource, /preview\.scrollIntoView\(/u);
  assert.match(guidedViewSource, /prefers-reduced-motion: reduce/u);
  assert.match(stylesSource, /\.practice-learning-path-planning-preview \{\s+scroll-margin-block-start:/u);
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

test("guided progress navigation uses native keyboard buttons and honest disabled sets", () => {
  assert.match(guidedViewSource, /const button = container\.createEl\("button"/u);
  assert.match(guidedViewSource, /button\.addEventListener\("click"/u);
  assert.match(guidedViewSource, /button\.disabled = !available/u);
  assert.match(guidedViewSource, /Review opens after generation completes/u);
  assert.match(stylesSource, /\.practice-lab-view button:focus-visible/u);
});

test("guided creation pages navigate backward and forward once their work exists", () => {
  const navigationStart = guidedViewSource.indexOf("private renderStageNavigation(");
  const navigationEnd = guidedViewSource.indexOf("private creationPages(", navigationStart);
  assert.ok(navigationStart >= 0 && navigationEnd > navigationStart);
  const navigation = guidedViewSource.slice(navigationStart, navigationEnd);
  assert.match(navigation, /Step \$\{currentIndex \+ 1\} of \$\{pages\.length\}/u);
  assert.match(navigation, /setButtonText\("Back"\)/u);
  assert.match(navigation, /const available = this\.pageAvailable\(definition\.id\) && this\.busy === null/u);
  assert.match(navigation, /button\.addEventListener\("click", \(\) => this\.navigateToPage\(definition\.id\)\)/u);
  assert.match(navigation, /this\.pageUnavailableReason\(definition\.id, definition\.label\)/u);
  assert.match(stylesSource, /\.practice-learning-path-page-locator \{/u);
  assert.match(stylesSource, /\.practice-learning-path-page-details button:focus-visible|\.practice-lab-view button:focus-visible/u);
});

test("restoring guided tabs reads the durable workspace without starting generation", () => {
  assert.match(guidedViewSource, /readonly inspectRecoverableBatch\?: \(\) => Promise<LearningPathRecoveredBatchV1>/u);
  assert.match(mainSource, /inspectRecoverableBatch: async \(\) =>\s+this\.learningPathController\.inspectRecoverableBatch\(\)/u);
  assert.match(guidedViewSource, /this\.statuses = new Map\(result\.statuses/u);
  assert.match(guidedViewSource, /this\.generatedSets = result\.generated\.map/u);
  assert.match(guidedViewSource, /this\.stage = stage/u);
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

test("guided mode navigation happens before slow default GIF-frame preparation", () => {
  const switchStart = mainSource.indexOf("private async switchCreationMode(");
  const switchEnd = mainSource.indexOf("private async resumeLearningPathBatch()", switchStart);
  assert.ok(switchStart >= 0 && switchEnd > switchStart);
  const implementation = mainSource.slice(switchStart, switchEnd);
  const guidedViewChange = implementation.indexOf("await leaf.setViewState({");
  const framePreparation = implementation.indexOf("await this.prepareGuidedSourceVisuals(collectedSource)");
  assert.ok(guidedViewChange >= 0, "guided mode must set the current leaf view");
  assert.ok(framePreparation > guidedViewChange, "GIF preparation must not block the mode change");
  assert.match(implementation, /leaf\.view\.setPrimarySource\(guidedSource\);/u);
  assert.match(implementation, /const preparationToken = leaf\.view\.beginPrimaryVisualPreparation\(guidedSource\);/u);
  assert.match(
    implementation,
    /leaf\.view\.finishPrimaryVisualPreparation\(\s+preparationToken,\s+guidedSource,\s+preparedPresentation,/u,
  );
  assert.match(guidedViewSource, /Guided path is open\. Preparing the default GIF frames in the background/u);
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
