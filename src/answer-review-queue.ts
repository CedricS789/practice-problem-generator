import {
  asAnswerReviewOutput,
  validateAnswerReviewOutput,
  type AnswerReviewInput,
  type AnswerReviewOutputV1,
} from "./answer-review";
import type { ReasoningEffortV1 } from "./model";
import {
  CliProviderError,
  isCliProviderError,
  type CliErrorCode,
} from "./cli/errors";
import type { ProviderId } from "./cli/contracts";

export type AnswerReviewQueueState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AnswerReviewQueueJob {
  readonly input: AnswerReviewInput;
  readonly provider: ProviderId;
  readonly reasoningEffort: ReasoningEffortV1;
  readonly timeoutMs?: number;
  /** Number of process attempts already made before this queue instance. */
  readonly attempts?: number;
}

export interface AnswerReviewExecutionJob {
  readonly input: AnswerReviewInput;
  readonly provider: ProviderId;
  readonly reasoningEffort: ReasoningEffortV1;
  readonly attempt: number;
  readonly timeoutMs?: number;
}

export type AnswerReviewExecutor = (
  job: AnswerReviewExecutionJob,
  signal: AbortSignal,
) => Promise<AnswerReviewOutputV1>;

export interface AnswerReviewQueueError {
  readonly code: CliErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export interface AnswerReviewQueueEntry {
  readonly requestId: string;
  readonly job: AnswerReviewQueueJob;
  readonly state: AnswerReviewQueueState;
  readonly attempts: number;
  readonly output?: AnswerReviewOutputV1;
  readonly error?: AnswerReviewQueueError;
}

export interface AnswerReviewQueueEvent extends AnswerReviewQueueEntry {
  readonly terminal: boolean;
}

export interface AnswerReviewQueueOptions {
  readonly executor: AnswerReviewExecutor;
  readonly waitUntilAvailable?: (signal: AbortSignal) => Promise<void>;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly busyDelayMs?: number;
}

interface MutableAnswerReviewQueueEntry {
  readonly requestId: string;
  readonly job: AnswerReviewQueueJob;
  readonly controller: AbortController;
  state: AnswerReviewQueueState;
  attempts: number;
  output?: AnswerReviewOutputV1;
  error?: AnswerReviewQueueError;
  cancelRequested: boolean;
}

const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const DEFAULT_BUSY_DELAY_MS = 100;

/**
 * Web-compatible serial queue. Desktop process access is supplied by the
 * injected executor, so this module remains safe to evaluate on mobile.
 */
export class AnswerReviewQueue {
  private readonly executor: AnswerReviewExecutor;
  private readonly waitUntilAvailable:
    | ((signal: AbortSignal) => Promise<void>)
    | undefined;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly busyDelayMs: number;
  private readonly entries = new Map<string, MutableAnswerReviewQueueEntry>();
  private readonly pending: MutableAnswerReviewQueueEntry[] = [];
  private readonly listeners = new Set<
    (event: AnswerReviewQueueEvent) => void
  >();
  private readonly idleWaiters = new Set<() => void>();
  private draining = false;
  private stopped = false;

  constructor(options: AnswerReviewQueueOptions) {
    this.executor = options.executor;
    this.waitUntilAvailable = options.waitUntilAvailable;
    this.maxRetries = normalizeNonNegativeInteger(
      options.maxRetries,
      DEFAULT_MAX_RETRIES,
    );
    this.retryDelayMs = normalizeDelay(
      options.retryDelayMs,
      DEFAULT_RETRY_DELAY_MS,
    );
    this.busyDelayMs = normalizeDelay(
      options.busyDelayMs,
      DEFAULT_BUSY_DELAY_MS,
    );
  }

  get isRunning(): boolean {
    return this.draining;
  }

  enqueue(job: AnswerReviewQueueJob): AnswerReviewQueueEntry {
    if (this.stopped) {
      throw new Error("The answer-review queue has been shut down.");
    }
    const requestId = job.input.requestId;
    const existing = this.entries.get(requestId);
    if (existing !== undefined) {
      if (!sameQueueJob(existing.job, job)) {
        throw new Error(
          `Answer-review request ${requestId} was reused with different content.`,
        );
      }
      return entrySnapshot(existing);
    }

    const entry: MutableAnswerReviewQueueEntry = {
      requestId,
      job: cloneQueueJob(job),
      controller: new AbortController(),
      state: "queued",
      attempts: normalizeNonNegativeInteger(job.attempts, 0),
      cancelRequested: false,
    };
    this.entries.set(requestId, entry);
    this.pending.push(entry);
    this.emit(entry);
    void this.drain();
    return entrySnapshot(entry);
  }

  resume(jobs: readonly AnswerReviewQueueJob[]): readonly AnswerReviewQueueEntry[] {
    return jobs.map((job) => this.enqueue(job));
  }

  get(requestId: string): AnswerReviewQueueEntry | undefined {
    const entry = this.entries.get(requestId);
    return entry === undefined ? undefined : entrySnapshot(entry);
  }

  snapshot(): readonly AnswerReviewQueueEntry[] {
    return [...this.entries.values()].map(entrySnapshot);
  }

  /** Remove an already reconciled terminal entry from the in-memory ledger. */
  forget(requestId: string): boolean {
    const entry = this.entries.get(requestId);
    if (
      entry === undefined ||
      (entry.state !== "completed" &&
        entry.state !== "failed" &&
        entry.state !== "cancelled")
    ) {
      return false;
    }
    return this.entries.delete(requestId);
  }

  subscribe(listener: (event: AnswerReviewQueueEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  cancel(requestId: string): boolean {
    const entry = this.entries.get(requestId);
    if (
      entry === undefined ||
      entry.state === "completed" ||
      entry.state === "failed" ||
      entry.state === "cancelled"
    ) {
      return false;
    }
    entry.cancelRequested = true;
    entry.controller.abort(
      new DOMException("Answer review cancelled", "AbortError"),
    );
    if (entry.state === "running") {
      return true;
    }
    this.removePending(entry);
    entry.state = "cancelled";
    entry.error = {
      code: "cancelled",
      message: "The answer review was cancelled.",
      retryable: false,
    };
    this.emit(entry);
    this.resolveIdleIfNeeded();
    return true;
  }

  retry(requestId: string): boolean {
    if (this.stopped) return false;
    const previous = this.entries.get(requestId);
    if (
      previous === undefined ||
      (previous.state !== "failed" && previous.state !== "cancelled")
    ) {
      return false;
    }
    const replacement: MutableAnswerReviewQueueEntry = {
      requestId,
      job: previous.job,
      controller: new AbortController(),
      state: "queued",
      attempts: previous.attempts,
      cancelRequested: false,
    };
    this.entries.set(requestId, replacement);
    this.pending.push(replacement);
    this.emit(replacement);
    void this.drain();
    return true;
  }

  async whenIdle(): Promise<void> {
    if (!this.draining && (this.pending.length === 0 || this.stopped)) return;
    await new Promise<void>((resolve) => {
      this.idleWaiters.add(resolve);
    });
  }

  async shutdown(): Promise<void> {
    if (this.stopped) {
      await this.whenIdle();
      return;
    }
    this.stopped = true;
    for (const entry of this.pending) {
      entry.controller.abort(
        new DOMException("Answer-review queue paused", "AbortError"),
      );
    }
    this.resolveIdleIfNeeded();
    await this.whenIdle();
  }

  private async drain(): Promise<void> {
    if (this.draining || this.stopped) return;
    this.draining = true;
    try {
      while (!this.stopped) {
        const entry = this.pending[0];
        if (entry === undefined) break;
        if (entry.cancelRequested) {
          this.finishCancelled(entry);
          continue;
        }

        entry.state = "running";
        entry.attempts += 1;
        delete entry.error;
        this.emit(entry);
        try {
          const output = await this.executor(
            executionJob(entry),
            entry.controller.signal,
          );
          const validation = validateAnswerReviewOutput(output, entry.job.input);
          if (!validation.valid) {
            throw createSchemaValidationError(validation.errors);
          }
          entry.output = asAnswerReviewOutput(output, entry.job.input);
          entry.state = "completed";
          this.removePending(entry);
          this.emit(entry);
        } catch (error) {
          if (this.stopped) {
            entry.state = "queued";
            entry.attempts = Math.max(0, entry.attempts - 1);
            break;
          }
          const normalized = normalizeQueueError(error);
          if (entry.cancelRequested || normalized.code === "cancelled") {
            this.finishCancelled(entry);
            continue;
          }
          if (normalized.code === "busy") {
            entry.attempts = Math.max(0, entry.attempts - 1);
            entry.state = "queued";
            delete entry.error;
            this.emit(entry);
            if (!(await this.waitForAvailability(entry.controller.signal))) {
              this.finishCancelled(entry);
            }
            continue;
          }
          if (
            normalized.retryable &&
            entry.attempts <= this.maxRetries
          ) {
            entry.state = "queued";
            entry.error = normalized;
            this.emit(entry);
            if (!(await waitForDelay(this.retryDelayMs, entry.controller.signal))) {
              this.finishCancelled(entry);
            }
            continue;
          }
          entry.state = "failed";
          entry.error = normalized;
          this.removePending(entry);
          this.emit(entry);
        }
      }
    } finally {
      this.draining = false;
      this.resolveIdleIfNeeded();
      if (!this.stopped && this.pending.length > 0) void this.drain();
    }
  }

  private async waitForAvailability(signal: AbortSignal): Promise<boolean> {
    try {
      if (this.waitUntilAvailable !== undefined) {
        await this.waitUntilAvailable(signal);
      } else {
        await waitForDelay(this.busyDelayMs, signal);
      }
      return !signal.aborted;
    } catch {
      return false;
    }
  }

  private finishCancelled(entry: MutableAnswerReviewQueueEntry): void {
    if (entry.state === "cancelled") return;
    this.removePending(entry);
    entry.state = "cancelled";
    entry.error = {
      code: "cancelled",
      message: "The answer review was cancelled.",
      retryable: false,
    };
    this.emit(entry);
  }

  private removePending(entry: MutableAnswerReviewQueueEntry): void {
    const index = this.pending.indexOf(entry);
    if (index >= 0) this.pending.splice(index, 1);
  }

  private emit(entry: MutableAnswerReviewQueueEntry): void {
    const snapshot = entrySnapshot(entry);
    const event: AnswerReviewQueueEvent = {
      ...snapshot,
      terminal:
        snapshot.state === "completed" ||
        snapshot.state === "failed" ||
        snapshot.state === "cancelled",
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener failures must not stop later answer reviews.
      }
    }
  }

  private resolveIdleIfNeeded(): void {
    if (this.draining || (!this.stopped && this.pending.length > 0)) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}

function executionJob(
  entry: MutableAnswerReviewQueueEntry,
): AnswerReviewExecutionJob {
  return {
    input: entry.job.input,
    provider: entry.job.provider,
    reasoningEffort: entry.job.reasoningEffort,
    attempt: entry.attempts,
    ...(entry.job.timeoutMs === undefined
      ? {}
      : { timeoutMs: entry.job.timeoutMs }),
  };
}

function entrySnapshot(
  entry: MutableAnswerReviewQueueEntry,
): AnswerReviewQueueEntry {
  return {
    requestId: entry.requestId,
    job: cloneQueueJob(entry.job),
    state: entry.state,
    attempts: entry.attempts,
    ...(entry.output === undefined
      ? {}
      : { output: structuredClone(entry.output) }),
    ...(entry.error === undefined
      ? {}
      : { error: { ...entry.error } }),
  };
}

function cloneQueueJob(job: AnswerReviewQueueJob): AnswerReviewQueueJob {
  return {
    input: structuredClone(job.input),
    provider: job.provider,
    reasoningEffort: job.reasoningEffort,
    ...(job.timeoutMs === undefined ? {} : { timeoutMs: job.timeoutMs }),
    ...(job.attempts === undefined ? {} : { attempts: job.attempts }),
  };
}

function sameQueueJob(
  left: AnswerReviewQueueJob,
  right: AnswerReviewQueueJob,
): boolean {
  return JSON.stringify({
    input: left.input,
    provider: left.provider,
    reasoningEffort: left.reasoningEffort,
    timeoutMs: left.timeoutMs,
  }) === JSON.stringify({
    input: right.input,
    provider: right.provider,
    reasoningEffort: right.reasoningEffort,
    timeoutMs: right.timeoutMs,
  });
}

function normalizeQueueError(error: unknown): AnswerReviewQueueError {
  if (isCliProviderError(error)) {
    return {
      code: error.code,
      message: error.message,
      retryable: isRetryableCode(error.code),
    };
  }
  return {
    code: "process-failed",
    message: "The AI review process failed.",
    retryable: true,
  };
}

function isRetryableCode(code: CliErrorCode): boolean {
  return code === "timeout" || code === "process-failed";
}

function createSchemaValidationError(
  errors: readonly string[] | undefined,
): CliProviderError {
  return new CliProviderError(
    "schema-validation",
    "The AI review did not match its required schema.",
    errors === undefined ? {} : { detail: errors.join("\n") },
  );
}

function waitForDelay(milliseconds: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  if (milliseconds === 0) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const finish = (completed: boolean): void => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      resolve(completed);
    };
    const cancel = (): void => {
      finish(false);
    };
    const timer = window.setTimeout(() => {
      finish(true);
    }, milliseconds);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

function normalizeDelay(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function normalizeNonNegativeInteger(
  value: number | undefined,
  fallback: number,
): number {
  return Number.isInteger(value) && (value ?? -1) >= 0 ? value ?? fallback : fallback;
}
