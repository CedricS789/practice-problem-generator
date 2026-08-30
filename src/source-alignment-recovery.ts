import type { ProviderId } from "./cli/contracts";
import type {
  ReasoningEffortV1,
  SourceAlignmentDraftV1,
} from "./model";
import {
  buildSourceAlignmentPrompt,
  sourceAlignmentInputHash,
  validateSourceAlignmentDraft,
  type SourceAlignmentGenerationInputV1,
} from "./source-alignment-generation";

export const SOURCE_ALIGNMENT_RECOVERY_CONTEXT_VERSION = 1 as const;
export const SOURCE_ALIGNMENT_RECOVERY_RESULT_VERSION = 1 as const;
export const SOURCE_ALIGNMENT_RECOVERY_CONTEXT_FILENAME = "source-alignment-context.json";
export const SOURCE_ALIGNMENT_RECOVERY_RESULT_FILENAME = "source-alignment-result.json";
const MAX_RECOVERY_CHARACTERS = 3_000_000;

export interface SourceAlignmentRecoveryConfigurationV1 {
  readonly provider: ProviderId;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffortV1;
}

export interface SourceAlignmentRecoveryContextV1 {
  readonly schemaVersion: typeof SOURCE_ALIGNMENT_RECOVERY_CONTEXT_VERSION;
  readonly kind: "source-alignment";
  readonly jobId: string;
  readonly startedAt: string;
  readonly inputHash: string;
  readonly input: SourceAlignmentGenerationInputV1;
  readonly configuration: SourceAlignmentRecoveryConfigurationV1;
  readonly prompt: string;
}

export interface SourceAlignmentRecoveryResultV1 {
  readonly schemaVersion: typeof SOURCE_ALIGNMENT_RECOVERY_RESULT_VERSION;
  readonly kind: "source-alignment-result";
  readonly jobId: string;
  readonly completedAt: string;
  readonly attempts: 1 | 2;
  readonly draft: SourceAlignmentDraftV1;
}

export function createSourceAlignmentRecoveryContext(input: {
  readonly jobId: string;
  readonly startedAt: string;
  readonly alignmentInput: SourceAlignmentGenerationInputV1;
  readonly configuration: SourceAlignmentRecoveryConfigurationV1;
  readonly prompt: string;
}): SourceAlignmentRecoveryContextV1 {
  const context: SourceAlignmentRecoveryContextV1 = {
    schemaVersion: SOURCE_ALIGNMENT_RECOVERY_CONTEXT_VERSION,
    kind: "source-alignment",
    jobId: alignmentJobId(input.jobId),
    startedAt: timestamp(input.startedAt, "alignment start timestamp"),
    inputHash: sourceAlignmentInputHash(input.alignmentInput),
    input: structuredClone(input.alignmentInput),
    configuration: alignmentConfiguration(input.configuration),
    prompt: boundedText(input.prompt, 1, MAX_RECOVERY_CHARACTERS, "alignment prompt"),
  };
  return parseSourceAlignmentRecoveryContext(JSON.stringify(context));
}

export function parseSourceAlignmentRecoveryContext(
  serialized: string,
): SourceAlignmentRecoveryContextV1 {
  const value = parsedRecord(serialized, "course-alignment recovery context");
  if (
    value.schemaVersion !== SOURCE_ALIGNMENT_RECOVERY_CONTEXT_VERSION
    || value.kind !== "source-alignment"
    || !isRecord(value.input)
    || !isRecord(value.configuration)
  ) {
    throw new Error("The interrupted course-alignment context is invalid.");
  }
  const alignmentInput = structuredClone(value.input) as unknown as SourceAlignmentGenerationInputV1;
  const expectedPrompt = buildSourceAlignmentPrompt(alignmentInput);
  const inputHash = sourceAlignmentInputHash(alignmentInput);
  if (value.inputHash !== inputHash) {
    throw new Error("The interrupted course-alignment source payload changed.");
  }
  const prompt = boundedText(value.prompt, 1, MAX_RECOVERY_CHARACTERS, "alignment prompt");
  if (prompt !== expectedPrompt) {
    throw new Error("The interrupted course-alignment prompt no longer matches its approved sources.");
  }
  return {
    schemaVersion: SOURCE_ALIGNMENT_RECOVERY_CONTEXT_VERSION,
    kind: "source-alignment",
    jobId: alignmentJobId(value.jobId),
    startedAt: timestamp(value.startedAt, "alignment start timestamp"),
    inputHash,
    input: alignmentInput,
    configuration: alignmentConfiguration(value.configuration),
    prompt,
  };
}

export function createSourceAlignmentRecoveryResult(input: {
  readonly jobId: string;
  readonly completedAt: string;
  readonly attempts: 1 | 2;
  readonly draft: SourceAlignmentDraftV1;
  readonly alignmentInput: SourceAlignmentGenerationInputV1;
}): SourceAlignmentRecoveryResultV1 {
  const validated = validateSourceAlignmentDraft(input.draft, input.alignmentInput);
  if (!validated.valid || validated.value === undefined) {
    throw new Error(validated.errors?.join("; ") ?? "The recovered alignment draft is invalid.");
  }
  return {
    schemaVersion: SOURCE_ALIGNMENT_RECOVERY_RESULT_VERSION,
    kind: "source-alignment-result",
    jobId: alignmentJobId(input.jobId),
    completedAt: timestamp(input.completedAt, "alignment completion timestamp"),
    attempts: input.attempts,
    draft: structuredClone(validated.value),
  };
}

export function parseSourceAlignmentRecoveryResult(
  serialized: string,
  alignmentInput: SourceAlignmentGenerationInputV1,
): SourceAlignmentRecoveryResultV1 {
  const value = parsedRecord(serialized, "course-alignment recovery result");
  if (
    value.schemaVersion !== SOURCE_ALIGNMENT_RECOVERY_RESULT_VERSION
    || value.kind !== "source-alignment-result"
    || (value.attempts !== 1 && value.attempts !== 2)
  ) {
    throw new Error("The recovered course-alignment result is invalid.");
  }
  const validated = validateSourceAlignmentDraft(value.draft, alignmentInput);
  if (!validated.valid || validated.value === undefined) {
    throw new Error(validated.errors?.join("; ") ?? "The recovered alignment draft is invalid.");
  }
  return {
    schemaVersion: SOURCE_ALIGNMENT_RECOVERY_RESULT_VERSION,
    kind: "source-alignment-result",
    jobId: alignmentJobId(value.jobId),
    completedAt: timestamp(value.completedAt, "alignment completion timestamp"),
    attempts: value.attempts,
    draft: structuredClone(validated.value),
  };
}

function parsedRecord(serialized: string, label: string): Readonly<Record<string, unknown>> {
  if (serialized.length > MAX_RECOVERY_CHARACTERS) {
    throw new Error(`The interrupted ${label} is too large to recover safely.`);
  }
  try {
    const value = JSON.parse(serialized) as unknown;
    if (!isRecord(value)) throw new Error();
    return value;
  } catch {
    throw new Error(`The interrupted ${label} is malformed.`);
  }
}

function alignmentConfiguration(value: Readonly<Record<string, unknown>>): SourceAlignmentRecoveryConfigurationV1;
function alignmentConfiguration(value: SourceAlignmentRecoveryConfigurationV1): SourceAlignmentRecoveryConfigurationV1;
function alignmentConfiguration(
  value: Readonly<Record<string, unknown>> | SourceAlignmentRecoveryConfigurationV1,
): SourceAlignmentRecoveryConfigurationV1 {
  if (value.provider !== "codex" && value.provider !== "claude" && value.provider !== "agy") {
    throw new Error("The interrupted course-alignment provider is invalid.");
  }
  if (!reasoningEffort(value.reasoningEffort)) {
    throw new Error("The interrupted course-alignment reasoning effort is invalid.");
  }
  return {
    provider: value.provider,
    model: boundedText(value.model, 0, 200, "alignment model"),
    reasoningEffort: value.reasoningEffort,
  };
}

function alignmentJobId(value: unknown): string {
  if (typeof value !== "string" || !/^source-alignment-[a-f0-9-]{36}$/u.test(value)) {
    throw new Error("The interrupted course-alignment job ID is invalid.");
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`The ${label} is invalid.`);
  }
  return value;
}

function boundedText(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    throw new Error(`The ${label} is invalid.`);
  }
  return value;
}

function reasoningEffort(value: unknown): value is ReasoningEffortV1 {
  return value === "low"
    || value === "medium"
    || value === "high"
    || value === "xhigh"
    || value === "max"
    || value === "ultra"
    || value === "ultracode";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
