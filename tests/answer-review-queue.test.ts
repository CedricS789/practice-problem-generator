import assert from "node:assert/strict";
import test from "node:test";

import {
  AnswerReviewQueue,
  type AnswerReviewExecutionJob,
  type AnswerReviewQueueEvent,
  type AnswerReviewQueueJob,
} from "../src/answer-review-queue";
import type {
  AnswerReviewInput,
  AnswerReviewOutputV1,
} from "../src/answer-review";
import { CliJobCoordinator } from "../src/cli/coordinator";
import { CliProviderError } from "../src/cli/errors";

function input(requestId: string): AnswerReviewInput {
  return {
    requestId,
    exerciseTitle: "Alpha initiation",
    exerciseType: "short-answer",
    prompt: "State alpha.",
    submittedAnswer: "Alpha is the initiating quantity.",
    groundedAnswer: "Alpha is the initiating quantity.",
    criteria: [{ id: "criterion-1", text: "Identify alpha." }],
    segments: [{
      id: "segment-1",
      headingPath: ["Alpha mechanism"],
      text: "Alpha is the initiating quantity.",
    }],
  };
}

function output(requestId: string): AnswerReviewOutputV1 {
  return {
    schemaVersion: 1,
    requestId,
    verdict: "correct",
    feedback: "The required idea is stated accurately.",
    criterionResults: [{
      criterionId: "criterion-1",
      state: "met",
      feedback: "Alpha is identified accurately.",
      sourceSegmentIds: ["segment-1"],
    }],
  };
}

function job(
  requestId: string,
  provider: AnswerReviewQueueJob["provider"] = "codex",
): AnswerReviewQueueJob {
  return {
    input: input(requestId),
    provider,
    reasoningEffort: "high",
    timeoutMs: 120_000,
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("queue is FIFO, serial, and exposes delayed terminal results", async () => {
  const releases = new Map<string, ReturnType<typeof deferred<AnswerReviewOutputV1>>>();
  const started: string[] = [];
  let concurrent = 0;
  let maximumConcurrent = 0;
  const events: AnswerReviewQueueEvent[] = [];
  const queue = new AnswerReviewQueue({
    executor: async (request) => {
      started.push(request.input.requestId);
      concurrent += 1;
      maximumConcurrent = Math.max(maximumConcurrent, concurrent);
      const release = deferred<AnswerReviewOutputV1>();
      releases.set(request.input.requestId, release);
      try {
        return await release.promise;
      } finally {
        concurrent -= 1;
      }
    },
  });
  queue.subscribe((event) => events.push(event));

  queue.enqueue(job("request-1"));
  queue.enqueue(job("request-2"));
  await Promise.resolve();
  assert.deepEqual(started, ["request-1"]);
  assert.equal(queue.get("request-1")?.state, "running");
  assert.equal(queue.get("request-2")?.state, "queued");

  releases.get("request-1")?.resolve(output("request-1"));
  await waitFor(() => started.length === 2);
  assert.deepEqual(started, ["request-1", "request-2"]);
  releases.get("request-2")?.resolve(output("request-2"));
  await queue.whenIdle();

  assert.equal(maximumConcurrent, 1);
  assert.equal(queue.get("request-1")?.output?.verdict, "correct");
  assert.equal(queue.get("request-2")?.state, "completed");
  assert.deepEqual(
    events.filter((event) => event.terminal).map((event) => [
      event.requestId,
      event.output?.verdict,
    ]),
    [["request-1", "correct"], ["request-2", "correct"]],
  );
});

test("enqueue is idempotent by request ID and rejects conflicting reuse", async () => {
  let calls = 0;
  const queue = new AnswerReviewQueue({
    executor: async (request) => {
      calls += 1;
      return output(request.input.requestId);
    },
  });
  queue.enqueue(job("request-idempotent"));
  queue.enqueue(job("request-idempotent"));
  await queue.whenIdle();
  assert.equal(calls, 1);
  assert.throws(
    () => queue.enqueue({ ...job("request-idempotent"), provider: "claude" }),
    /reused with different content/u,
  );
  assert.equal(queue.forget("request-idempotent"), true);
  assert.equal(queue.get("request-idempotent"), undefined);
  assert.equal(queue.forget("request-idempotent"), false);
});

test("retryable failures retry once with the same provider and reasoning", async () => {
  const executions: AnswerReviewExecutionJob[] = [];
  const queue = new AnswerReviewQueue({
    retryDelayMs: 0,
    executor: async (request) => {
      executions.push(request);
      if (request.attempt === 1) {
        throw new CliProviderError("timeout", "Synthetic timeout.");
      }
      return output(request.input.requestId);
    },
  });
  queue.enqueue(job("request-retry", "claude"));
  await queue.whenIdle();

  assert.deepEqual(executions.map((entry) => ({
    attempt: entry.attempt,
    provider: entry.provider,
    reasoning: entry.reasoningEffort,
  })), [
    { attempt: 1, provider: "claude", reasoning: "high" },
    { attempt: 2, provider: "claude", reasoning: "high" },
  ]);
  assert.equal(queue.get("request-retry")?.state, "completed");
});

test("busy work waits without consuming an attempt or switching provider", async () => {
  let calls = 0;
  let waits = 0;
  const queue = new AnswerReviewQueue({
    waitUntilAvailable: async () => {
      waits += 1;
    },
    executor: async (request) => {
      calls += 1;
      if (calls === 1) throw new CliProviderError("busy", "Foreground job active.");
      return output(request.input.requestId);
    },
  });
  queue.enqueue(job("request-busy", "agy"));
  await queue.whenIdle();
  assert.equal(waits, 1);
  assert.equal(calls, 2);
  assert.equal(queue.get("request-busy")?.attempts, 1);
  assert.equal(queue.get("request-busy")?.job.provider, "agy");
});

test("non-retryable failure is terminal and includes a sanitized queue error", async () => {
  const events: AnswerReviewQueueEvent[] = [];
  const queue = new AnswerReviewQueue({
    executor: async () => {
      throw new CliProviderError(
        "missing-executable",
        "Claude is not installed or is not available on PATH.",
        { detail: "private stderr must not be persisted" },
      );
    },
  });
  queue.subscribe((event) => events.push(event));
  queue.enqueue(job("request-missing", "claude"));
  await queue.whenIdle();

  const terminal = events.find((event) => event.terminal);
  assert.equal(terminal?.requestId, "request-missing");
  assert.equal(terminal?.state, "failed");
  assert.equal(terminal?.error?.code, "missing-executable");
  assert.equal(terminal?.error?.retryable, false);
  assert.doesNotMatch(JSON.stringify(terminal?.error), /private stderr/u);
});

test("targeted queue cancellation does not stop the next review", async () => {
  const started: string[] = [];
  const queue = new AnswerReviewQueue({
    executor: async (request, signal) => {
      started.push(request.input.requestId);
      if (request.input.requestId === "request-cancel") {
        return await new Promise<AnswerReviewOutputV1>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new CliProviderError("cancelled", "Cancelled."));
          }, { once: true });
        });
      }
      return output(request.input.requestId);
    },
  });
  queue.enqueue(job("request-cancel"));
  queue.enqueue(job("request-after"));
  await waitFor(() => queue.get("request-cancel")?.state === "running");
  assert.equal(queue.cancel("request-cancel"), true);
  await queue.whenIdle();
  assert.equal(queue.get("request-cancel")?.state, "cancelled");
  assert.equal(queue.get("request-after")?.state, "completed");
  assert.deepEqual(started, ["request-cancel", "request-after"]);
});

test("coordinator owns jobs by identity and cancellation is targeted", async () => {
  const coordinator = new CliJobCoordinator();
  let reviewAborted = false;
  const running = coordinator.runExclusive(
    "codex",
    async (signal) => await new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        reviewAborted = true;
        reject(new CliProviderError("cancelled", "Review cancelled."));
      }, { once: true });
    }),
    undefined,
    { id: "review-job-1", kind: "answer-review", provider: "codex" },
  );
  assert.deepEqual(coordinator.activeJob, {
    id: "review-job-1",
    kind: "answer-review",
    provider: "codex",
  });
  assert.equal(coordinator.cancel("generation-job-1"), false);
  assert.equal(reviewAborted, false);

  await assert.rejects(
    coordinator.runExclusive(
      "claude",
      async () => undefined,
      undefined,
      { id: "generation-job-1", kind: "generation", provider: "claude" },
    ),
    (error: unknown) =>
      error instanceof CliProviderError && error.code === "busy",
  );
  assert.equal(coordinator.cancel("review-job-1"), true);
  await assert.rejects(running, /cancelled/iu);
  assert.equal(reviewAborted, true);
  await coordinator.whenIdle();
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for condition.");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
