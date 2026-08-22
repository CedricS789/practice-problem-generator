import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DISPLAY_PREFERENCES,
  displayPreset,
  hasVisibleBankOverview,
  hasVisibleDashboardOverview,
  normalizeDisplayPreferences,
  normalizeStudyTypeSequence,
  orderStudyItems,
} from "../src/preferences";

test("display preferences normalize missing and malformed nested values", () => {
  const defaults = normalizeDisplayPreferences(undefined);
  assert.deepEqual(defaults, DEFAULT_DISPLAY_PREFERENCES);
  assert.notEqual(defaults, DEFAULT_DISPLAY_PREFERENCES);
  assert.notEqual(defaults.practice, DEFAULT_DISPLAY_PREFERENCES.practice);

  const normalized = normalizeDisplayPreferences({
    practice: {
      density: "compact",
      showSourcePath: false,
      showSourceExcerpt: "no",
    },
    bank: { showSessionHistory: false },
    dashboard: { showRecentSessions: false, showBankList: 0 },
  });
  assert.equal(normalized.practice.density, "compact");
  assert.equal(normalized.practice.showSourcePath, false);
  assert.equal(normalized.practice.showSourceExcerpt, true);
  assert.equal(normalized.bank.showSessionHistory, false);
  assert.equal(normalized.bank.showGenerationHistory, true);
  assert.equal(normalized.dashboard.showRecentSessions, false);
  assert.equal(normalized.dashboard.showBankList, true);
  assert.equal(normalized.dashboard.showActivityHeatmap, true);
  assert.equal(normalized.dashboard.showActivityTrend, true);
});

test("visibility presets are coherent independent copies", () => {
  const detailed = displayPreset("detailed");
  const focused = displayPreset("focused");
  const minimal = displayPreset("minimal");
  assert.equal(detailed.practice.showSourcePath, true);
  assert.equal(focused.practice.showSourcePath, false);
  assert.equal(minimal.practice.density, "compact");
  assert.equal(minimal.dashboard.showRecentSessions, false);
  assert.equal(detailed.dashboard.showActivityHeatmap, true);
  assert.equal(focused.dashboard.showPerformanceTrend, true);
  assert.equal(minimal.dashboard.showActivityHeatmap, false);
  assert.equal(minimal.dashboard.showActivityTrend, false);
  assert.equal(minimal.dashboard.showPerformanceTrend, false);
  assert.equal(minimal.dashboard.showOutcomeChart, false);
  assert.equal(minimal.bank.showSessionHistory, false);
  assert.equal(minimal.bank.showGenerationHistory, false);
  assert.equal(minimal.practice.enableStudyKeyboardShortcuts, true);
  assert.equal(minimal.practice.autoFocusStudyInput, true);
  assert.equal(minimal.practice.showStudyShortcutHint, false);
  assert.equal(detailed.practice.showAgentActivity, true);
  assert.equal(focused.practice.showAgentActivity, true);
  assert.equal(minimal.practice.showAgentActivity, false);
  detailed.practice.showSourcePath = false;
  assert.equal(displayPreset("detailed").practice.showSourcePath, true);
});

test("overview visibility helpers reflect individual metric choices", () => {
  const display = displayPreset("minimal");
  assert.equal(hasVisibleDashboardOverview(display.dashboard), true);
  assert.equal(hasVisibleBankOverview(display.bank), true);
  for (const key of Object.keys(display.dashboard) as Array<keyof typeof display.dashboard>) {
    if (key.startsWith("show") && typeof display.dashboard[key] === "boolean") {
      (display.dashboard as unknown as Record<string, boolean>)[key] = false;
    }
  }
  for (const key of Object.keys(display.bank) as Array<keyof typeof display.bank>) {
    (display.bank as unknown as Record<string, boolean>)[key] = false;
  }
  assert.equal(hasVisibleDashboardOverview(display.dashboard), false);
  assert.equal(hasVisibleBankOverview(display.bank), false);
});

test("study ordering preserves bank order or shuffles an isolated copy", () => {
  const input = [
    { id: "a", type: "short-answer" as const },
    { id: "b", type: "calculation" as const },
    { id: "c", type: "cloze" as const },
    { id: "d", type: "ordering" as const },
  ] as const;
  const bankOrder = orderStudyItems(input, {
    mode: "bank",
    typeSequence: [],
    shuffleWithinTypes: false,
  }, () => 0);
  const shuffled = orderStudyItems(input, {
    mode: "shuffle",
    typeSequence: [],
    shuffleWithinTypes: false,
  }, () => 0);
  assert.deepEqual(bankOrder, input);
  assert.deepEqual(shuffled.map((item) => item.id), ["b", "c", "d", "a"]);
  assert.deepEqual(input.map((item) => item.id), ["a", "b", "c", "d"]);
  assert.notEqual(bankOrder, input);
  assert.notEqual(shuffled, input);
});

test("custom study sequences group present types and preserve bank order inside blocks", () => {
  const input = [
    { id: "short-1", type: "short-answer" as const },
    { id: "calc-1", type: "calculation" as const },
    { id: "short-2", type: "short-answer" as const },
    { id: "cloze-1", type: "cloze" as const },
    { id: "calc-2", type: "calculation" as const },
  ] as const;
  const ordered = orderStudyItems(input, {
    mode: "type-sequence",
    typeSequence: ["calculation", "cloze", "short-answer"],
    shuffleWithinTypes: false,
  });
  assert.deepEqual(
    ordered.map((item) => item.id),
    ["calc-1", "calc-2", "cloze-1", "short-1", "short-2"],
  );
  assert.deepEqual(
    input.map((item) => item.id),
    ["short-1", "calc-1", "short-2", "cloze-1", "calc-2"],
  );
});

test("type blocks and questions within blocks can be shuffled independently", () => {
  const input = [
    { id: "short-1", type: "short-answer" as const },
    { id: "calc-1", type: "calculation" as const },
    { id: "short-2", type: "short-answer" as const },
    { id: "cloze-1", type: "cloze" as const },
    { id: "calc-2", type: "calculation" as const },
  ] as const;
  const shuffledBlocks = orderStudyItems(input, {
    mode: "shuffle-types",
    typeSequence: ["short-answer", "calculation", "cloze"],
    shuffleWithinTypes: false,
  }, () => 0);
  assert.deepEqual(
    shuffledBlocks.map((item) => item.id),
    ["calc-1", "calc-2", "cloze-1", "short-1", "short-2"],
  );

  const shuffledWithinBlocks = orderStudyItems(input, {
    mode: "type-sequence",
    typeSequence: ["calculation", "cloze", "short-answer"],
    shuffleWithinTypes: true,
  }, () => 0);
  assert.deepEqual(
    shuffledWithinBlocks.map((item) => item.id),
    ["calc-2", "calc-1", "cloze-1", "short-2", "short-1"],
  );
});

test("study type sequences normalize into one complete valid permutation", () => {
  const normalized = normalizeStudyTypeSequence([
    "calculation",
    "calculation",
    "unsupported",
    "short-answer",
  ]);
  assert.deepEqual(normalized.slice(0, 2), ["calculation", "short-answer"]);
  assert.equal(normalized.length, 10);
  assert.equal(new Set(normalized).size, 10);
  assert.equal(normalized.includes("image-occlusion"), true);
});
