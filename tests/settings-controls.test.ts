import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [settingsSource, settingsValuesSource, mainSource, viewSource, dashboardSource, bankSource, hoverSource, studyOrderSource] = await Promise.all([
  readFile(new URL("../src/settings.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/settings-values.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/practice-lab-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/practice-dashboard-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/bank-statistics-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/hover-descriptions.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/study-order-modal.ts", import.meta.url), "utf8"),
]);

test("settings expose generation, study, view, bank, and dashboard control groups", () => {
  for (const heading of [
    "Generation defaults",
    "Study defaults",
    "Interface presets",
    "Practice Problem Generator view",
    "Practice bank statistics",
    "Dashboard",
    "Practice-bank storage",
    "Advanced runtime",
  ]) {
    assert.match(settingsSource, new RegExp(`"${heading}"`, "u"));
  }
  for (const setting of [
    "defaultFocusInstructions",
    "codexModel",
    "claudeModel",
    "agyModel",
    "visualSelectionDefault",
    "pdfDefaultPageCount",
    "pdfMaxPageCount",
    "pdfMaxExtractedCharacters",
    "pdfinfoExecutable",
    "pdftotextExecutable",
    "practiceBankStorageMode",
    "practiceBankCustomFolder",
    "practiceBankPathTemplate",
    "practiceViewLocation",
    "studyOrderDefault",
    "studyTypeSequence",
    "studyShuffleWithinTypesDefault",
    "exerciseTypePercentages",
    "dashboardActivityRangeWeeks",
    "dashboardActivityMetric",
    "dashboardWeekStart",
    "display",
    "settingsSchemaVersion",
    "DEFAULT_AI_TIMEOUT_MS",
  ]) {
    assert.match(settingsSource, new RegExp(setting, "u"));
  }
});

test("the full practice workspace defaults to a main tab with a sidebar opt-in", () => {
  assert.match(settingsSource, /practiceViewLocation: "main-tab"/u);
  assert.match(settingsSource, /setName\("Open workspace in"\)/u);
  assert.match(settingsSource, /addOption\("main-tab", "Main tab \(recommended\)"\)/u);
  assert.match(settingsSource, /addOption\("right-sidebar", "Right sidebar"\)/u);
  assert.match(mainSource, /this\.settings\.practiceViewLocation === "right-sidebar"/u);
  assert.match(
    mainSource,
    /\? this\.app\.workspace\.getRightLeaf\(false\)\s*\?\? this\.app\.workspace\.getLeaf\("tab"\)\s*: this\.app\.workspace\.getLeaf\("tab"\)/u,
  );
  assert.match(mainSource, /if \(Platform\.isMobileApp\)/u);
});

test("mobile relocates persisted practice drawer leaves into the root workspace", () => {
  assert.match(mainSource, /iterateRootLeaves\(\(candidate\) =>/u);
  assert.match(
    mainSource,
    /existingLeaves\.find\(\(candidate\) => rootLeaves\.has\(candidate\)\)/u,
  );
  assert.match(
    mainSource,
    /await drawerLeaf\.view\.prepareForWorkspaceRelocation\(\)/u,
  );
  assert.match(mainSource, /for \(const drawerLeaf of drawerLeaves\) drawerLeaf\.detach\(\)/u);
  assert.match(mainSource, /this\.app\.workspace\.requestSaveLayout\(\)/u);
  assert.match(
    viewSource,
    /public async prepareForWorkspaceRelocation\(\): Promise<void>[\s\S]*await this\.flushStudyCheckpoint\(\)/u,
  );
});

test("practice-bank storage exposes a guarded live path preview without moving existing banks", () => {
  assert.match(settingsSource, /Per-course practice folder/u);
  assert.match(settingsSource, /Custom folder and template/u);
  assert.match(
    settingsSource,
    /practiceBankPathPreview\(\s*candidate\(\),\s*undefined,\s*this\.app\.vault\.configDir/su,
  );
  assert.match(
    settingsSource,
    /practiceBankStoragePolicyProblem\(policy, this\.app\.vault\.configDir\)/u,
  );
  assert.match(settingsSource, /PRACTICE_BANK_PATH_TEMPLATE_TOKENS\.join/u);
  assert.match(settingsSource, /Existing bank files are not moved/u);
  assert.match(mainSource, /preferredPath: \(sourcePath\) => derivePracticePath/u);
  assert.match(mainSource, /locateExistingPath: async \(sourcePath\)/u);
  assert.match(mainSource, /Multiple practice banks already reference/u);
});

test("all major surfaces provide native hover descriptions for interactive controls", () => {
  assert.match(hoverSource, /button.*input.*select.*textarea.*summary.*a\[href\]/su);
  assert.match(hoverSource, /\.setting-item-description/u);
  assert.match(hoverSource, /import \{ setTooltip \} from "obsidian"/u);
  assert.match(hoverSource, /setTooltip\(control, tooltip, \{ delay: 250 \}\)/u);
  assert.match(hoverSource, /new MutationObserver/u);
  assert.match(hoverSource, /observer\.observe\(root, \{ childList: true, subtree: true \}\)/u);
  assert.match(hoverSource, /nonempty\(control\.title\)/u);
  assert.match(viewSource, /installHoverDescriptions\(this\.contentEl\)/u);
  assert.match(dashboardSource, /installHoverDescriptions\(this\.contentEl\)/u);
  assert.match(bankSource, /installHoverDescriptions\(container\)/u);
  assert.match(settingsSource, /installHoverDescriptions\(this\.containerEl\)/u);
});

test("generation and answer review expose every provider-supported reasoning choice", () => {
  assert.match(settingsSource, /defaultModelReasoningEfforts\(\)/u);
  assert.match(settingsSource, /reasoningEffortsForProvider\(this\.owner\.settings\.answerReviewProvider\)/u);
  assert.match(viewSource, /supportedReasoningEfforts\(\)/u);
  assert.match(viewSource, /reasoningEffortsForModel/u);
  assert.match(viewSource, /reasoningEffortDescription\(this\.answerReviewProvider\)/u);
});

test("generation defaults expose detected-model dropdowns and preserve custom ids", () => {
  for (const source of [settingsSource, viewSource]) {
    assert.match(source, /AUTOMATIC_MODEL_CHOICE/u);
    assert.match(source, /CUSTOM_MODEL_CHOICE/u);
    assert.match(source, /modelsForProvider/u);
    assert.match(source, /Custom model id…/u);
  }
  assert.match(settingsSource, /this\.owner\.providerPresentation\(provider\)/u);
  assert.match(viewSource, /modelCatalogDetail/u);
  assert.match(viewSource, /Only levels supported by the selected model are listed/u);
  assert.match(settingsSource, /normalizeDefaultModelReasoning\(\)/u);
  assert.match(settingsSource, /reasoningWasAdjusted/u);
  assert.match(settingsSource, /modelSettingsSaveChain/u);
  assert.match(settingsSource, /input\.addEventListener\("change"/u);
});

test("custom model ids commit atomically instead of persisting partial input", () => {
  const inputStart = settingsSource.indexOf('input.addEventListener("input"');
  const changeStart = settingsSource.indexOf(
    'input.addEventListener("change"',
    inputStart,
  );
  const changeEnd = settingsSource.indexOf(
    "private queueModelSettingsSave",
    changeStart,
  );
  assert.ok(inputStart >= 0 && changeStart > inputStart && changeEnd > changeStart);

  const inputHandler = settingsSource.slice(inputStart, changeStart);
  assert.doesNotMatch(inputHandler, /this\.owner\.settings\[key\] = value/u);
  assert.doesNotMatch(inputHandler, /queueModelSettingsSave/u);

  const changeHandler = settingsSource.slice(changeStart, changeEnd);
  assert.match(changeHandler, /this\.owner\.settings\[key\] = value/u);
  assert.match(changeHandler, /this\.queueModelSettingsSave\(\)/u);
});

test("ordinary preference saves do not restart provider detection", () => {
  assert.match(
    mainSource,
    /if \(options\.refreshProviders !== true\) return;/u,
  );
  assert.match(
    settingsSource,
    /saveSettings\(\{ refreshProviders: true \}\)/u,
  );
  assert.match(mainSource, /leaf\.view\.setDisplayPreferences\(this\.settings\.display\)/u);
});

test("defaults reach new work without changing persisted banks", () => {
  for (const property of [
    "focusInstructions: this.settings.defaultFocusInstructions",
    "visualSelectionDefault: this.settings.visualSelectionDefault",
    "studyOrderDefault: this.settings.studyOrderDefault",
    "studyTypeSequence: [...this.settings.studyTypeSequence]",
    "studyShuffleWithinTypesDefault:",
  ]) {
    assert.ok(mainSource.includes(property), `Missing default wiring: ${property}`);
  }
  assert.match(viewSource, /chooseStudyOrder\(this\.app/u);
  assert.match(viewSource, /orderStudyItems\(selectedExercises, selection\)/u);
  assert.match(viewSource, /prepareDefaultVisuals === true/u);
  assert.match(viewSource, /this\.selectAllImages\(false\)/u);
  assert.match(mainSource, /model: modelForProvider\(this\.settings, this\.settings\.provider\)/u);
  assert.match(viewSource, /Model: \$\{this\.payloadPreview\.modelLabel\}/u);
});

test("optional presentation never hides consent or repair controls", () => {
  assert.match(viewSource, /showSourcePath/u);
  assert.match(viewSource, /expandPayloadPreview/u);
  assert.match(viewSource, /showRunPoints/u);
  assert.match(viewSource, /showCompletionPerformance/u);
  assert.match(viewSource, /Preview exactly what will be sent/u);
  assert.match(viewSource, /I reviewed this exact payload/u);
  assert.match(bankSource, /requiresReviewManagement/u);
  assert.match(bankSource, /Pending and failed reviews/u);
  assert.match(bankSource, /Generation history/u);
  assert.match(bankSource, /Model provider default \(not pinned or recorded\)/u);
  assert.match(dashboardSource, /this\.renderDiagnostics\(snapshot, summary\)/u);
  assert.match(dashboardSource, /All optional dashboard sections are hidden/u);
  for (const analyticsControl of [
    "Default analytics range",
    "Default activity graph",
    "Heatmap week start",
    "Activity heatmap",
    "Weekly activity graph",
    "Weekly performance graph",
    "Answer-outcome graph",
  ]) {
    assert.ok(
      settingsSource.includes(analyticsControl),
      `Missing analytics setting: ${analyticsControl}`,
    );
  }
});

test("every study launch offers whole-question and type-aware ordering", () => {
  for (const mode of [
    "Use saved bank order",
    "Shuffle every question",
    "Shuffle type blocks",
    "Follow custom type sequence",
  ]) {
    assert.ok(studyOrderSource.includes(mode), `Missing session order mode: ${mode}`);
  }
  assert.match(studyOrderSource, /Shuffle within each type/u);
  assert.match(studyOrderSource, /Remember these defaults/u);
  assert.match(studyOrderSource, /this\.moveType\(index, index - 1\)/u);
  assert.match(studyOrderSource, /this\.moveType\(index, index \+ 1\)/u);
  assert.match(studyOrderSource, /the saved bank is never reordered/u);
  assert.match(viewSource, /updateStudyOrderDefaults\?\.\(selection\)/u);
  assert.match(settingsSource, /Default type sequence/u);
  assert.match(settingsSource, /Restore recommended sequence/u);
});

test("three-hour AI defaults migrate durably and live activity stays optional", () => {
  assert.match(settingsValuesSource, /DEFAULT_AI_TIMEOUT_MS = 3 \* 60 \* 60 \* 1_000/u);
  assert.match(settingsSource, /setPlaceholder\("180"\)/u);
  assert.match(settingsSource, /Live agent activity/u);
  assert.match(settingsSource, /LEGACY_DEFAULT_AGY_MODEL/u);
  assert.match(settingsSource, /agyModelForReasoning/u);
  assert.match(settingsSource, /Private chain-of-thought is never exposed or saved/u);
  assert.match(mainSource, /JSON\.stringify\(storedData\) !== JSON\.stringify\(this\.storedDataSnapshot\(\)\)/u);
  assert.match(mainSource, /await this\.persistStoredData\(\)/u);
  assert.doesNotMatch(mainSource, /await this\.saveData\(this\.settings\)/u);
  assert.match(viewSource, /onActivity: \(event\) => this\.publishGenerationActivity\(event\)/u);
  assert.match(viewSource, /publishAnswerReviewActivity/u);
  assert.match(viewSource, /this activity log is capped and is not saved to your vault/u);
});
