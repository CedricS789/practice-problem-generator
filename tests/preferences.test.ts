import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DISPLAY_PREFERENCES,
  displayPreset,
  hasVisibleBankOverview,
  hasVisibleDashboardOverview,
  normalizeDisplayPreferences,
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
  const input = ["a", "b", "c", "d"] as const;
  const bankOrder = orderStudyItems(input, "bank", () => 0);
  const shuffled = orderStudyItems(input, "shuffle", () => 0);
  assert.deepEqual(bankOrder, input);
  assert.deepEqual(shuffled, ["b", "c", "d", "a"]);
  assert.deepEqual(input, ["a", "b", "c", "d"]);
  assert.notEqual(bankOrder, input);
  assert.notEqual(shuffled, input);
});
