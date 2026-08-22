import type { DurableProcessHandle } from "./cli/contracts";
import {
  MAX_LEARNING_PATH_EXERCISES,
  MAX_LEARNING_PATH_SETS,
  MIN_LEARNING_PATH_SETS,
  buildPracticeSetPrompt,
  learningPathSourceBundleHash,
  practiceSetPayloadHash,
  validatePracticeSetDraft,
  type PracticeSetDraftV1,
  type PracticeSetPayloadV1,
} from "./learning-path-generation";

export const GENERATION_BATCH_RECOVERY_VERSION = 1 as const;
export const GENERATION_BATCH_RECOVERY_FILENAME = "generation-batch.json";

const MAX_BATCH_RECOVERY_CHARACTERS = 12_000_000;

export type GenerationBatchSetStatusV1 =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface ApprovedPracticeSetPayloadV1 {
  readonly setId: string;
  readonly payloadHash: string;
  /** Stored in the OS-temporary job so pending sets can resume without recomputation. */
  readonly payload: PracticeSetPayloadV1;
}

export interface GenerationBatchQueueEntryV1 {
  readonly setId: string;
  readonly payloadHash: string;
  readonly status: GenerationBatchSetStatusV1;
  readonly attempts: number;
  readonly lastError?: string;
}

export interface CompletedPracticeSetDraftV1 {
  readonly setId: string;
  readonly payloadHash: string;
  readonly completedAt: string;
  readonly attempts: 1 | 2;
  readonly draft: PracticeSetDraftV1;
}

export interface ActiveBatchGenerationV1 {
  readonly setId: string;
  readonly payloadHash: string;
  readonly handle: DurableProcessHandle;
}

export interface GenerationBatchRecoveryV1 {
  readonly schemaVersion: typeof GENERATION_BATCH_RECOVERY_VERSION;
  readonly batchId: string;
  readonly blueprintId: string;
  readonly sourceBundleHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Index of the running, failed, or next queued set. Equals queue.length when done. */
  readonly queuePosition: number;
  readonly approvedPayloads: readonly ApprovedPracticeSetPayloadV1[];
  readonly queue: readonly GenerationBatchQueueEntryV1[];
  readonly completedDrafts: readonly CompletedPracticeSetDraftV1[];
  readonly active?: ActiveBatchGenerationV1;
  readonly savedSetIds: readonly string[];
}

export function createGenerationBatchRecovery(input: {
  readonly batchId: string;
  readonly blueprintId: string;
  readonly createdAt: string;
  readonly payloads: readonly PracticeSetPayloadV1[];
}): GenerationBatchRecoveryV1 {
  const approvedPayloads = input.payloads.map((payload) => ({
    setId: payload.targetSet.id,
    payloadHash: practiceSetPayloadHash(payload),
    payload: structuredClone(payload),
  }));
  const state: GenerationBatchRecoveryV1 = {
    schemaVersion: GENERATION_BATCH_RECOVERY_VERSION,
    batchId: input.batchId,
    blueprintId: input.blueprintId,
    sourceBundleHash: learningPathSourceBundleHash(input.payloads[0]?.sources ?? []),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    queuePosition: 0,
    approvedPayloads,
    queue: approvedPayloads.map((approved) => ({
      setId: approved.setId,
      payloadHash: approved.payloadHash,
      status: "queued",
      attempts: 0,
    })),
    completedDrafts: [],
    savedSetIds: [],
  };
  return parseGenerationBatchRecovery(JSON.stringify(state));
}

export function parseGenerationBatchRecovery(
  serialized: string,
): GenerationBatchRecoveryV1 {
  if (serialized.length > MAX_BATCH_RECOVERY_CHARACTERS) {
    throw new Error("The interrupted learning-path batch is too large to recover safely.");
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error("The interrupted learning-path batch is malformed.");
  }
  const problems = generationBatchRecoveryProblems(value);
  if (problems.length > 0) throw new Error(problems.join("; "));
  return structuredClone(value as GenerationBatchRecoveryV1);
}

export function serializeGenerationBatchRecovery(
  state: GenerationBatchRecoveryV1,
): string {
  const validated = parseGenerationBatchRecovery(JSON.stringify(state));
  return JSON.stringify(validated);
}

export function nextGenerationBatchSet(
  state: GenerationBatchRecoveryV1,
): ApprovedPracticeSetPayloadV1 | undefined {
  const checked = parseGenerationBatchRecovery(JSON.stringify(state));
  if (checked.queuePosition >= checked.queue.length) return undefined;
  const queueEntry = checked.queue[checked.queuePosition];
  if (queueEntry?.status !== "queued" && queueEntry?.status !== "failed") {
    return undefined;
  }
  return checked.approvedPayloads[checked.queuePosition];
}

/** Attach the one durable provider process allowed for the current queue position. */
export function startGenerationBatchSet(
  state: GenerationBatchRecoveryV1,
  setId: string,
  handle: DurableProcessHandle,
  updatedAt: string,
): GenerationBatchRecoveryV1 {
  const checked = parseGenerationBatchRecovery(JSON.stringify(state));
  if (checked.active !== undefined) {
    throw new Error("A learning-path provider job is already active.");
  }
  const entry = checked.queue[checked.queuePosition];
  if (entry === undefined || entry.setId !== setId) {
    throw new Error("Learning-path sets must run in their approved sequential order.");
  }
  if (entry.status !== "queued" && entry.status !== "failed") {
    throw new Error(`Set ${setId} cannot start from status ${entry.status}.`);
  }
  assertDurableHandle(handle);
  const next = cloneState(checked);
  next.queue[checked.queuePosition] = {
    setId,
    payloadHash: entry.payloadHash,
    status: "running",
    attempts: entry.attempts + 1,
  };
  next.active = {
    setId,
    payloadHash: entry.payloadHash,
    handle: structuredClone(handle),
  };
  next.updatedAt = timestamp(updatedAt, "batch update timestamp");
  return parseGenerationBatchRecovery(JSON.stringify(next));
}

export function completeGenerationBatchSet(
  state: GenerationBatchRecoveryV1,
  input: {
    readonly setId: string;
    readonly draft: PracticeSetDraftV1;
    readonly attempts: 1 | 2;
    readonly completedAt: string;
  },
): GenerationBatchRecoveryV1 {
  const checked = parseGenerationBatchRecovery(JSON.stringify(state));
  const entry = checked.queue[checked.queuePosition];
  if (
    entry === undefined
    || entry.setId !== input.setId
    || entry.status !== "running"
    || checked.active?.setId !== input.setId
  ) {
    throw new Error("Only the active sequential set can be completed.");
  }
  const approved = checked.approvedPayloads[checked.queuePosition];
  if (approved === undefined || approved.payloadHash !== entry.payloadHash) {
    throw new Error("The active set no longer matches its approved payload.");
  }
  const draftResult = validatePracticeSetDraft(input.draft, approved.payload);
  if (!draftResult.valid || draftResult.value === undefined) {
    throw new Error(
      `Cannot checkpoint an invalid set draft: ${draftResult.errors?.join("; ") ?? "unknown error"}`,
    );
  }
  const next = cloneState(checked);
  next.queue[checked.queuePosition] = {
    setId: input.setId,
    payloadHash: entry.payloadHash,
    status: "completed",
    attempts: entry.attempts,
  };
  next.completedDrafts.push({
    setId: input.setId,
    payloadHash: entry.payloadHash,
    completedAt: timestamp(input.completedAt, "set completion timestamp"),
    attempts: input.attempts,
    draft: structuredClone(draftResult.value),
  });
  delete next.active;
  next.queuePosition += 1;
  next.updatedAt = input.completedAt;
  return parseGenerationBatchRecovery(JSON.stringify(next));
}

export function failGenerationBatchSet(
  state: GenerationBatchRecoveryV1,
  input: {
    readonly setId: string;
    readonly message: string;
    readonly failedAt: string;
  },
): GenerationBatchRecoveryV1 {
  const checked = parseGenerationBatchRecovery(JSON.stringify(state));
  const entry = checked.queue[checked.queuePosition];
  if (
    entry === undefined
    || entry.setId !== input.setId
    || entry.status !== "running"
    || checked.active?.setId !== input.setId
  ) {
    throw new Error("Only the active sequential set can fail.");
  }
  const message = boundedText(input.message, 1, 2_000, "batch failure message");
  const next = cloneState(checked);
  next.queue[checked.queuePosition] = {
    setId: entry.setId,
    payloadHash: entry.payloadHash,
    status: "failed",
    attempts: entry.attempts,
    lastError: message,
  };
  delete next.active;
  next.updatedAt = timestamp(input.failedAt, "batch failure timestamp");
  return parseGenerationBatchRecovery(JSON.stringify(next));
}

export function retryGenerationBatchSet(
  state: GenerationBatchRecoveryV1,
  setId: string,
  updatedAt: string,
): GenerationBatchRecoveryV1 {
  const checked = parseGenerationBatchRecovery(JSON.stringify(state));
  const entry = checked.queue[checked.queuePosition];
  if (entry?.setId !== setId || entry.status !== "failed") {
    throw new Error("Only the current failed set can be retried.");
  }
  if (entry.attempts >= 2) {
    throw new Error("This set already used its one schema-repair retry.");
  }
  const next = cloneState(checked);
  next.queue[checked.queuePosition] = {
    setId,
    payloadHash: entry.payloadHash,
    status: "queued",
    attempts: entry.attempts,
  };
  next.updatedAt = timestamp(updatedAt, "batch retry timestamp");
  return parseGenerationBatchRecovery(JSON.stringify(next));
}

/** Skip a failed or queued set while preserving every already completed draft. */
export function skipGenerationBatchSet(
  state: GenerationBatchRecoveryV1,
  setId: string,
  updatedAt: string,
): GenerationBatchRecoveryV1 {
  const checked = parseGenerationBatchRecovery(JSON.stringify(state));
  const entry = checked.queue[checked.queuePosition];
  if (
    entry?.setId !== setId
    || (entry.status !== "queued" && entry.status !== "failed")
  ) {
    throw new Error("Only the current queued or failed set can be skipped.");
  }
  const next = cloneState(checked);
  next.queue[checked.queuePosition] = {
    setId,
    payloadHash: entry.payloadHash,
    status: "cancelled",
    attempts: entry.attempts,
    ...(entry.lastError === undefined ? {} : { lastError: entry.lastError }),
  };
  next.queuePosition += 1;
  next.updatedAt = timestamp(updatedAt, "batch skip timestamp");
  return parseGenerationBatchRecovery(JSON.stringify(next));
}

export function markGenerationBatchSetSaved(
  state: GenerationBatchRecoveryV1,
  setId: string,
  updatedAt: string,
): GenerationBatchRecoveryV1 {
  const checked = parseGenerationBatchRecovery(JSON.stringify(state));
  if (!checked.completedDrafts.some((draft) => draft.setId === setId)) {
    throw new Error("Only a validated completed set can be marked saved.");
  }
  if (checked.savedSetIds.includes(setId)) return checked;
  const next = cloneState(checked);
  next.savedSetIds.push(setId);
  next.updatedAt = timestamp(updatedAt, "batch save timestamp");
  return parseGenerationBatchRecovery(JSON.stringify(next));
}

export function completedUnsavedBatchDrafts(
  state: GenerationBatchRecoveryV1,
): readonly CompletedPracticeSetDraftV1[] {
  const checked = parseGenerationBatchRecovery(JSON.stringify(state));
  const saved = new Set(checked.savedSetIds);
  return checked.completedDrafts
    .filter((draft) => !saved.has(draft.setId))
    .map((draft) => structuredClone(draft));
}

export function generationBatchIsFinished(state: GenerationBatchRecoveryV1): boolean {
  const checked = parseGenerationBatchRecovery(JSON.stringify(state));
  return checked.queuePosition === checked.queue.length && checked.active === undefined;
}

function generationBatchRecoveryProblems(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["The interrupted learning-path batch must be an object."];
  const allowed = new Set([
    "schemaVersion",
    "batchId",
    "blueprintId",
    "sourceBundleHash",
    "createdAt",
    "updatedAt",
    "queuePosition",
    "approvedPayloads",
    "queue",
    "completedDrafts",
    "active",
    "savedSetIds",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    errors.push("The interrupted learning-path batch contains an unknown field.");
  }
  if (value.schemaVersion !== GENERATION_BATCH_RECOVERY_VERSION) {
    errors.push("The interrupted learning-path batch version is unsupported.");
  }
  if (!identifier(value.batchId) || !identifier(value.blueprintId)) {
    errors.push("The interrupted learning-path batch or blueprint ID is invalid.");
  }
  if (!hash(value.sourceBundleHash)) errors.push("The source-bundle hash is invalid.");
  if (!isoTimestamp(value.createdAt) || !isoTimestamp(value.updatedAt)) {
    errors.push("The interrupted learning-path batch timestamps are invalid.");
  }
  if (!Array.isArray(value.approvedPayloads)) {
    errors.push("The interrupted batch is missing its approved set payloads.");
    return errors;
  }
  if (
    value.approvedPayloads.length < MIN_LEARNING_PATH_SETS
    || value.approvedPayloads.length > MAX_LEARNING_PATH_SETS
  ) {
    errors.push(`The interrupted batch must contain ${MIN_LEARNING_PATH_SETS}-${MAX_LEARNING_PATH_SETS} approved sets.`);
  }
  const approved: ApprovedPracticeSetPayloadV1[] = [];
  for (const [index, raw] of value.approvedPayloads.entries()) {
    if (!isRecord(raw) || !identifier(raw.setId) || !hash(raw.payloadHash) || !isRecord(raw.payload)) {
      errors.push(`Approved payload ${index + 1} is malformed.`);
      continue;
    }
    const payload = raw.payload as unknown as PracticeSetPayloadV1;
    try {
      buildPracticeSetPrompt(payload);
    } catch (error) {
      errors.push(`Approved payload ${index + 1} is invalid: ${errorMessage(error)}`);
      continue;
    }
    if (payload.targetSet.id !== raw.setId) {
      errors.push(`Approved payload ${index + 1} has a mismatched set ID.`);
    }
    if (payload.batchId !== value.batchId || payload.blueprintId !== value.blueprintId) {
      errors.push(`Approved payload ${index + 1} belongs to another batch or blueprint.`);
    }
    if (practiceSetPayloadHash(payload) !== raw.payloadHash) {
      errors.push(`Approved payload ${index + 1} no longer matches its hash.`);
    }
    if (learningPathSourceBundleHash(payload.sources) !== value.sourceBundleHash) {
      errors.push(`Approved payload ${index + 1} no longer matches the source bundle.`);
    }
    approved.push({
      setId: raw.setId,
      payloadHash: raw.payloadHash,
      payload,
    });
  }
  pushDuplicate(errors, approved.map((item) => item.setId), "Approved set IDs");
  const exerciseTotal = approved.reduce(
    (total, item) => total + item.payload.configuration.quantity,
    0,
  );
  if (exerciseTotal > MAX_LEARNING_PATH_EXERCISES) {
    errors.push(`The interrupted batch exceeds ${MAX_LEARNING_PATH_EXERCISES} approved exercises.`);
  }
  if (!Array.isArray(value.queue) || value.queue.length !== value.approvedPayloads.length) {
    errors.push("The interrupted batch queue does not match its approved payloads.");
    return errors;
  }
  const queue: GenerationBatchQueueEntryV1[] = [];
  for (const [index, raw] of value.queue.entries()) {
    if (!isRecord(raw) || !queueStatus(raw.status) || !identifier(raw.setId) || !hash(raw.payloadHash)) {
      errors.push(`Batch queue entry ${index + 1} is malformed.`);
      continue;
    }
    const allowedQueueFields = new Set(["setId", "payloadHash", "status", "attempts", "lastError"]);
    if (Object.keys(raw).some((key) => !allowedQueueFields.has(key))) {
      errors.push(`Batch queue entry ${index + 1} contains an unknown field.`);
    }
    if (!integer(raw.attempts, 0, 2)) {
      errors.push(`Batch queue entry ${index + 1} has an invalid attempt count.`);
    }
    if (raw.lastError !== undefined && !validBoundedText(raw.lastError, 1, 2_000)) {
      errors.push(`Batch queue entry ${index + 1} has an invalid error message.`);
    }
    const expected = approved[index];
    if (expected !== undefined && (raw.setId !== expected.setId || raw.payloadHash !== expected.payloadHash)) {
      errors.push(`Batch queue entry ${index + 1} no longer matches its approved payload.`);
    }
    queue.push(raw as unknown as GenerationBatchQueueEntryV1);
  }
  if (!integer(value.queuePosition, 0, value.queue.length)) {
    errors.push("The interrupted batch queue position is invalid.");
  }
  const queuePosition = typeof value.queuePosition === "number" ? value.queuePosition : 0;
  for (const [index, entry] of queue.entries()) {
    if (index < queuePosition && entry.status !== "completed" && entry.status !== "cancelled") {
      errors.push("Every set before the queue position must be completed or cancelled.");
    }
    if (index > queuePosition && entry.status !== "queued") {
      errors.push("Sets after the queue position must remain queued.");
    }
    if (index === queuePosition && entry.status === "completed") {
      errors.push("The queue position must advance past a completed set.");
    }
  }
  const running = queue.filter((entry) => entry.status === "running");
  if (running.length > 1) errors.push("Only one learning-path provider job may run at a time.");

  if (!Array.isArray(value.completedDrafts)) {
    errors.push("The interrupted batch completed-draft list is invalid.");
    return errors;
  }
  const completed: CompletedPracticeSetDraftV1[] = [];
  for (const [index, raw] of value.completedDrafts.entries()) {
    if (
      !isRecord(raw)
      || !identifier(raw.setId)
      || !hash(raw.payloadHash)
      || !isoTimestamp(raw.completedAt)
      || (raw.attempts !== 1 && raw.attempts !== 2)
      || !isRecord(raw.draft)
    ) {
      errors.push(`Completed set draft ${index + 1} is malformed.`);
      continue;
    }
    const approvedItem = approved.find((item) => item.setId === raw.setId);
    if (approvedItem === undefined || approvedItem.payloadHash !== raw.payloadHash) {
      errors.push(`Completed set draft ${index + 1} has no matching approved payload.`);
      continue;
    }
    const result = validatePracticeSetDraft(raw.draft, approvedItem.payload);
    if (!result.valid || result.value === undefined) {
      errors.push(`Completed set draft ${index + 1} is invalid: ${result.errors?.join("; ") ?? "unknown error"}`);
      continue;
    }
    const queueEntry = queue.find((entry) => entry.setId === raw.setId);
    if (queueEntry?.status !== "completed") {
      errors.push(`Completed set draft ${index + 1} is not marked completed in the queue.`);
    }
    completed.push({
      setId: raw.setId,
      payloadHash: raw.payloadHash,
      completedAt: raw.completedAt,
      attempts: raw.attempts,
      draft: result.value,
    });
  }
  pushDuplicate(errors, completed.map((draft) => draft.setId), "Completed set IDs");
  for (const entry of queue.filter((candidate) => candidate.status === "completed")) {
    if (!completed.some((draft) => draft.setId === entry.setId)) {
      errors.push(`Completed queue set ${entry.setId} is missing its validated draft.`);
    }
  }

  if (value.active !== undefined) {
    if (!isRecord(value.active) || !identifier(value.active.setId) || !hash(value.active.payloadHash)) {
      errors.push("The active batch generation is malformed.");
    } else {
      try {
        assertDurableHandle(value.active.handle);
      } catch (error) {
        errors.push(errorMessage(error));
      }
      const entry = queue[queuePosition];
      if (
        entry?.status !== "running"
        || entry.setId !== value.active.setId
        || entry.payloadHash !== value.active.payloadHash
      ) {
        errors.push("The active provider handle does not match the running queue set.");
      }
    }
  } else if (running.length > 0) {
    errors.push("A running queue set is missing its durable provider handle.");
  }
  if (value.active !== undefined && running.length !== 1) {
    errors.push("An active provider handle requires exactly one running set.");
  }

  if (!Array.isArray(value.savedSetIds) || value.savedSetIds.some((id) => !identifier(id))) {
    errors.push("The saved-set list is invalid.");
  } else {
    pushDuplicate(errors, value.savedSetIds, "Saved set IDs");
    for (const setId of value.savedSetIds) {
      if (!completed.some((draft) => draft.setId === setId)) {
        errors.push(`Saved set ${setId} has no completed draft.`);
      }
    }
  }
  return [...new Set(errors)];
}

type MutableQueueEntry = {
  setId: string;
  payloadHash: string;
  status: GenerationBatchSetStatusV1;
  attempts: number;
  lastError?: string;
};

interface MutableBatchState {
  schemaVersion: typeof GENERATION_BATCH_RECOVERY_VERSION;
  batchId: string;
  blueprintId: string;
  sourceBundleHash: string;
  createdAt: string;
  updatedAt: string;
  queuePosition: number;
  approvedPayloads: ApprovedPracticeSetPayloadV1[];
  queue: MutableQueueEntry[];
  completedDrafts: CompletedPracticeSetDraftV1[];
  active?: ActiveBatchGenerationV1;
  savedSetIds: string[];
}

function cloneState(state: GenerationBatchRecoveryV1): MutableBatchState {
  return structuredClone(state) as MutableBatchState;
}

function assertDurableHandle(value: unknown): asserts value is DurableProcessHandle {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("The active provider recovery handle version is invalid.");
  }
  if (
    typeof value.jobId !== "string"
    || !/^[a-z0-9][a-z0-9._-]{7,159}$/u.test(value.jobId)
  ) {
    throw new Error("The active provider recovery job ID is invalid.");
  }
  if (
    typeof value.workspacePath !== "string"
    || value.workspacePath.length < 3
    || value.workspacePath.length > 4_000
    || (!/^[A-Za-z]:[\\/]/u.test(value.workspacePath) && !value.workspacePath.startsWith("/"))
  ) {
    throw new Error("The active provider recovery workspace is invalid.");
  }
  if (!isoTimestamp(value.startedAt)) {
    throw new Error("The active provider recovery timestamp is invalid.");
  }
}

function boundedText(value: unknown, minimum: number, maximum: number, label: string): string {
  if (!validBoundedText(value, minimum, maximum)) throw new Error(`The ${label} is invalid.`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (!isoTimestamp(value)) throw new Error(`The ${label} is invalid.`);
  return value;
}

function validBoundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function isoTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 40
    && Number.isFinite(Date.parse(value));
}

function identifier(value: unknown): value is string {
  return typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value);
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function integer(value: unknown, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function queueStatus(value: unknown): value is GenerationBatchSetStatusV1 {
  return value === "queued"
    || value === "running"
    || value === "completed"
    || value === "failed"
    || value === "cancelled";
}

function pushDuplicate(errors: string[], values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) errors.push(`${label} must be unique.`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
