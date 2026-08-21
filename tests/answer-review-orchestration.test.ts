import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(
  new URL("../src/main.ts", import.meta.url),
  "utf8",
);

function between(start: string, end: string): string {
  const startIndex = mainSource.indexOf(start);
  const endIndex = mainSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
  return mainSource.slice(startIndex, endIndex);
}

test("terminal-before-finish is stored in the initial batch while pending races patch later", () => {
  const finish = between(
    "finishSession: async (source, session) => {",
    "private createDashboardViewOptions",
  );
  assert.match(finish, /appendFinishedSession/u);
  assert.match(finish, /result\.state\.status !== "pending"/u);
  assert.match(finish, /answerReviewQueue\?\.forget/u);
  assert.match(finish, /answerReviewTargets\.set/u);
  assert.match(finish, /flushTerminalAnswerReview/u);
  assert.ok(
    finish.indexOf('result.state.status !== "pending"')
      < finish.indexOf("answerReviewTargets.set"),
  );
});

test("restart waits for the exact provider and reasoning before queueing", () => {
  const gate = between(
    "private enqueueAnswerReviewIfReady(",
    "private queueWaitingAnswerReviews",
  );
  assert.match(gate, /canRunAnswerReview\(this\.providers, request\.provider, request\.reasoningEffort\)/u);
  assert.match(gate, /provider: request\.provider/u);
  assert.match(gate, /reasoningEffort: request\.reasoningEffort/u);
  const refresh = between("private async refreshProviders", "private async renderPracticeBlock");
  assert.match(refresh, /coordinator\.isBusy/u);
  assert.match(refresh, /coordinator\.whenIdle/u);
  assert.match(refresh, /queueWaitingAnswerReviews/u);
  const resume = between(
    "private async resumePendingAnswerReviews",
    "private async ensureCliLayer",
  );
  assert.match(resume, /requestIdCounts/u);
  assert.match(resume, /collidingRequestIds/u);
  assert.match(resume, /left .* colliding AI review/u);
});

test("an executable-setting change invalidates the old layer after an active job", () => {
  const save = between("async saveSettings", "async testAgyVisionCapability");
  assert.match(save, /activeLayer\.coordinator\.whenIdle/u);
  assert.match(save, /this\.cliLayer === activeLayer/u);
  assert.match(save, /this\.cliLayer = undefined/u);
  assert.ok(save.indexOf("whenIdle") < save.indexOf("this.refreshProviders"));
});

test("late bank writes retry, retain terminal state, and schedule a deferred retry", () => {
  const persistence = between(
    "private queueAnswerReviewPersistence(",
    "private async resumePendingAnswerReviews",
  );
  assert.match(persistence, /pendingAnswerReviewPersistence\.set/u);
  assert.match(persistence, /persistAnswerReviewStatusWithRetry/u);
  assert.match(persistence, /scheduleAnswerReviewPersistenceRetry/u);
  assert.match(persistence, /will be retried automatically/u);
  assert.match(persistence, /retryAsync/u);
  assert.match(persistence, /ANSWER_REVIEW_PERSISTENCE_RETRY_DELAYS_MS/u);
});

test("pause remains pending and retry durably requeues before starting the provider", () => {
  const handler = between(
    "private handleAnswerReviewQueueEvent",
    "private answerReviewStatuses",
  );
  assert.match(handler, /event\.state === "cancelled"/u);
  assert.match(handler, /pausedAnswerReviewIds\.has/u);
  assert.match(handler, /state: "pending"/u);

  const retry = between(
    "private async retryAnswerReview",
    "private async retryPersistedAnswerReview",
  );
  const transitionIndex = retry.indexOf("applyAiReviewStateTransition");
  const enqueueIndex = retry.indexOf("enqueueAnswerReviewIfReady");
  assert.ok(transitionIndex >= 0);
  assert.ok(enqueueIndex > transitionIndex);
  assert.match(retry, /requestHash: target\.requestHash/u);
  assert.match(retry, /attempts: previous\.attempts/u);
});
