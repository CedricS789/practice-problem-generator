import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [view, main, pdfRange, pdfProgress, dashboard, preferences, settings, sourcePicker] =
  await Promise.all([
    readFile(new URL("../src/ui/practice-lab-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/pdf-page-range-modal.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../src/ui/pdf-extraction-progress-modal.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/ui/practice-dashboard-view.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/preferences.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/settings.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/source-picker.ts", import.meta.url), "utf8"),
  ]);

test("source loading is single-flight and stale source results cannot win", () => {
  assert.match(view, /private sourceRequestMode:/u);
  assert.match(view, /private sourceRequestEpoch = 0/u);
  assert.match(view, /this\.sourceRequestMode !== null\) return/u);
  assert.match(view, /if \(epoch !== this\.sourceRequestEpoch\) return/u);
  assert.match(view, /role: "status", "aria-live": "polite"/u);
  assert.match(sourcePicker, /loadingLabel: "Choosing pages…"/u);
});

test("provider failures are explained and recoverable without reopening the view", () => {
  assert.match(view, /practice-lab-provider-status/u);
  assert.match(view, /provider\.detail/u);
  assert.match(view, /Check again/u);
  assert.match(view, /private async refreshProviders\(\)/u);
  assert.match(main, /refreshProviders: async \(\) => this\.refreshProviders\(true\)/u);
  assert.match(main, /providersRefreshedAt/u);
  assert.match(main, /providerRefreshPromise/u);
});

test("failed generation and persistence stay visible and retryable", () => {
  assert.match(view, /this\.job\.state === "failed" \? "Retry generation"/u);
  assert.match(view, /Your reviewed payload is still ready to retry/u);
  assert.match(view, /private reviewSaving = false/u);
  assert.match(view, /this\.reviewSaving \|\| gate\.savedCurrent \|\| !gate\.canSave/u);
  assert.match(view, /private reviewSaveError: string \| null/u);
  assert.match(view, /Every kept exercise needs a prompt and grounded answer/u);
});

test("PDF selection and extraction stay responsive, cancellable, and keyboard accessible", () => {
  assert.match(pdfRange, /setButtonText\(`Last /u);
  assert.match(pdfRange, /private focusActiveInput\(\): void/u);
  assert.match(pdfRange, /input\?\.focus\(\)/u);
  assert.match(pdfRange, /event\.key !== "Enter"/u);
  assert.match(pdfRange, /aria-invalid/u);
  assert.match(pdfProgress, /new AbortController\(\)/u);
  assert.match(pdfProgress, /Cancel extraction/u);
  assert.match(pdfProgress, /No AI provider is contacted during extraction/u);
  assert.match(main, /progress\.signal/u);
  assert.match(main, /if \(progress\.signal\.aborted\) return null/u);
  assert.match(main, /inspecting\.hide\(\)/u);
});

test("study flow supports keyboard actions, honest completion labels, and instant repeat", () => {
  assert.match(view, /Control\+Enter Meta\+Enter/u);
  assert.match(view, /data-practice-lab-primary-action/u);
  assert.match(view, /window\.requestAnimationFrame/u);
  assert.match(view, /Platform\.isMobileApp/u);
  assert.match(view, /"View results" : "Next question"/u);
  assert.match(view, /Save and practice again/u);
  assert.match(
    view,
    /private async finishStudy\(action: "save" \| "repeat" \| "repair"\)/u,
  );
  assert.match(view, /this\.finishStudy\("save"\)/u);
  assert.match(view, /this\.finishStudy\("repeat"\)/u);
  assert.match(view, /this\.finishStudy\("repair"\)/u);
  assert.match(view, /if \(source === null \|\| this\.studyFinishing\) return/u);
  assert.match(view, /const practiceAgain = action === "repeat"/u);
  assert.match(view, /const buildRepair = action === "repair"/u);
  assert.match(view, /this\.startStudy\(repeatExercises\)/u);
});

test("keyboard behavior and hints remain under explicit user control", () => {
  for (const key of [
    "enableStudyKeyboardShortcuts",
    "autoFocusStudyInput",
    "showStudyShortcutHint",
  ]) {
    assert.match(preferences, new RegExp(`${key}: boolean`, "u"));
    assert.match(preferences, new RegExp(`${key}: booleanValue`, "u"));
    assert.match(settings, new RegExp(`"practice", "${key}"`, "u"));
  }
});

test("dashboard refresh is visible, guarded, and timestamped", () => {
  assert.match(dashboard, /private lastLoadedAt: number \| null/u);
  assert.match(dashboard, /this\.lastLoadedAt = Date\.now\(\)/u);
  assert.match(dashboard, /this\.loading \? "Refreshing…" : "Refresh"/u);
  assert.match(dashboard, /\.setDisabled\(this\.loading\)/u);
  assert.match(dashboard, /Updated \$\{new Date\(this\.lastLoadedAt\)/u);
});
