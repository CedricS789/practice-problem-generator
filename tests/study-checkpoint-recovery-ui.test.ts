import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(
  new URL("../src/main.ts", import.meta.url),
  "utf8",
);

function sourceBetween(start: string, end: string): string {
  const startIndex = mainSource.indexOf(start);
  const endIndex = mainSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source boundary: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source boundary: ${end}`);
  return mainSource.slice(startIndex, endIndex);
}

test("blocked study starts resolve once and continue after explicit discard", () => {
  const start = sourceBetween(
    "private async performBankStudyStart",
    "private async chooseAndStartPracticeSet",
  );
  assert.match(
    start,
    /restoreStudyCheckpoint\([\s\S]*\{ path, bank: currentBank \},[\s\S]*false/u,
  );
  assert.match(start, /if \(recovery\.status === "resumed"\) return/u);
  assert.match(
    start,
    /await this\.requestDiscardStudyCheckpointAndStart\([\s\S]*if \(!discarded\) return/u,
  );
  assert.doesNotMatch(start, /A saved practice session already exists/u);
});

test("rapid repeated clicks share one complete bank-start operation", () => {
  const wrapper = sourceBetween(
    "private async startBankStudy",
    "private async performBankStudyStart",
  );
  assert.match(wrapper, /const running = this\.bankStudyStartTask/u);
  assert.match(wrapper, /if \(running !== undefined\) \{[\s\S]*await running;[\s\S]*return;/u);
  assert.match(wrapper, /this\.bankStudyStartTask = task/u);
  assert.match(wrapper, /this\.bankStudyStartTask === task/u);
});

test("saved-bank actions explain whether they resume or resolve a checkpoint", () => {
  const bank = sourceBetween(
    "private async renderPracticeBlock",
    "private renderReadOnlyBlock",
  );
  assert.match(bank, /Resume where you stopped/u);
  assert.match(bank, /Another saved session must be resolved/u);
  assert.match(bank, /"Resume session"/u);
  assert.match(bank, /"Resolve saved session…"/u);
  assert.match(bank, /role: "status"/u);
});

test("checkpoint recovery follows identity-safe renames and exposes resume", () => {
  const events = sourceBetween(
    "private registerDashboardRefreshEvents",
    "private scheduleDashboardRefresh",
  );
  assert.match(events, /vault\.on\("rename"/u);
  assert.match(events, /followStudyCheckpointBankRename/u);
  assert.match(events, /bank\.bankId !== checkpoint\.bankId/u);
  assert.match(events, /rebaseLatestStudySessionCheckpointBankPath\([\s\S]*checkpoint,[\s\S]*this\.studyCheckpoint,[\s\S]*file\.path/u);
  assert.match(events, /if \(latest\.status !== "rebased"\) return/u);
  assert.match(mainSource, /id: "resume-saved-practice-session"/u);
});

test("a restored checkpoint preserves skipped questions and moved merge paths", () => {
  const progress = sourceBetween(
    "function studyProgressFromCheckpoint",
    "function answerReviewRequestFromStored",
  );
  const merging = sourceBetween(
    "private async resumeMergingStudyCheckpoint",
    "private async requestDiscardStudyCheckpoint",
  );
  assert.match(progress, /skippedExerciseIds: \[\.\.\.\(checkpoint\.skippedExerciseIds \?\? \[\]\)\]/u);
  assert.match(merging, /appendFinishedSession\([\s\S]*bankPath,/u);
  assert.match(merging, /this\.activeBank = \{ path: bankPath, bank: saved \}/u);
});
