import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [settingsSource, mainSource, viewSource, dashboardSource, bankSource, hoverSource] = await Promise.all([
  readFile(new URL("../src/settings.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/practice-lab-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/practice-dashboard-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/bank-statistics-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/hover-descriptions.ts", import.meta.url), "utf8"),
]);

test("settings expose generation, study, view, bank, and dashboard control groups", () => {
  for (const heading of [
    "Generation defaults",
    "Study defaults",
    "Interface presets",
    "Grounded Problems view",
    "Practice bank statistics",
    "Dashboard",
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
    "studyOrderDefault",
    "exerciseTypePercentages",
    "dashboardActivityRangeWeeks",
    "dashboardActivityMetric",
    "dashboardWeekStart",
    "display",
  ]) {
    assert.match(settingsSource, new RegExp(setting, "u"));
  }
});

test("all major surfaces provide native hover descriptions for interactive controls", () => {
  assert.match(hoverSource, /button.*input.*select.*textarea.*summary.*a\[href\]/su);
  assert.match(hoverSource, /\.setting-item-description/u);
  assert.match(hoverSource, /control\.title =/u);
  assert.match(viewSource, /installHoverDescriptions\(this\.contentEl\)/u);
  assert.match(dashboardSource, /installHoverDescriptions\(this\.contentEl\)/u);
  assert.match(bankSource, /installHoverDescriptions\(container\)/u);
  assert.match(settingsSource, /installHoverDescriptions\(this\.containerEl\)/u);
});

test("generation and answer review expose every provider-supported reasoning choice", () => {
  assert.match(settingsSource, /reasoningEffortDescription\(this\.owner\.settings\.provider\)/u);
  assert.match(settingsSource, /reasoningEffortsForProvider\(this\.owner\.settings\.answerReviewProvider\)/u);
  assert.match(viewSource, /selectedProvider\?\.reasoningEfforts \?\? \[\]/u);
  assert.match(viewSource, /reasoningEffortDescription\(this\.answerReviewProvider\)/u);
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
  ]) {
    assert.ok(mainSource.includes(property), `Missing default wiring: ${property}`);
  }
  assert.match(viewSource, /orderStudyItems\(selectedExercises, "shuffle"\)/u);
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
