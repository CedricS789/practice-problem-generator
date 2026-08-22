import { exerciseTypeDistributionProblem } from "./exercise-distribution";
import { modelIdProblem } from "./model-selection";
import {
  EXERCISE_TYPES,
  type Difficulty,
  type ExerciseType,
  type ExerciseTypePercentages,
  type ProviderId,
  type ReasoningEffort,
  type SourceMode,
} from "./ui/contracts";

export const LEGACY_GENERATION_HISTORY_VERSION = 1 as const;
export const GENERATION_HISTORY_VERSION = 2 as const;
export const GENERATION_HISTORY_FRONTMATTER_KEY =
  "practice-lab-generation-history";

export interface GenerationHistoryEntryV2 {
  readonly id: string;
  readonly bankRevision: number;
  readonly generatedAt: string;
  readonly provider: ProviderId;
  readonly providerVersion?: string;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
  readonly promptVersion: string;
  readonly sourceHash: string;
  readonly sourceScope: SourceMode;
  readonly requestedQuantity: number;
  readonly draftExerciseCount: number;
  readonly savedExerciseCount: number;
  readonly difficulty: Difficulty;
  readonly focusInstructions: string;
  readonly exerciseTypePercentages: ExerciseTypePercentages;
  readonly selectedVisualCount: number;
  readonly attempts: 1 | 2;
  /** Present together for a generation owned by one learning-path set. */
  readonly batchId?: string;
  readonly blueprintId?: string;
  readonly setId?: string;
}

export type GenerationHistoryEntryDraftV2 = Omit<
  GenerationHistoryEntryV2,
  "bankRevision"
>;

export interface GenerationHistoryV2 {
  readonly schemaVersion: typeof GENERATION_HISTORY_VERSION;
  readonly entries: readonly GenerationHistoryEntryV2[];
}

/** Compatibility aliases for existing quick-generation consumers. */
export type GenerationHistoryEntryV1 = GenerationHistoryEntryV2;
export type GenerationHistoryEntryDraftV1 = GenerationHistoryEntryDraftV2;
export type GenerationHistoryV1 = GenerationHistoryV2;

export type GenerationHistoryParseResult =
  | { readonly status: "missing" }
  | { readonly status: "invalid"; readonly message: string }
  | { readonly status: "ok"; readonly history: GenerationHistoryV2 };

export function emptyGenerationHistory(): GenerationHistoryV2 {
  return { schemaVersion: GENERATION_HISTORY_VERSION, entries: [] };
}

export function appendGenerationHistory(
  history: GenerationHistoryV2,
  entry: GenerationHistoryEntryDraftV2,
  bankRevision: number,
): GenerationHistoryV2 {
  const next: GenerationHistoryEntryV2 = { ...entry, bankRevision };
  const problem = generationHistoryEntryProblem(next);
  if (problem !== null) throw new Error(problem);
  if (history.entries.some((candidate) => candidate.id === entry.id)) {
    throw new Error("The generation history already contains this job ID.");
  }
  const candidate: GenerationHistoryV2 = {
    schemaVersion: GENERATION_HISTORY_VERSION,
    entries: [...history.entries, next],
  };
  const historyProblem = generationHistoryProblem(candidate);
  if (historyProblem !== null) throw new Error(historyProblem);
  return cloneHistory(candidate);
}

export function appendGenerationHistoryBatch(
  history: GenerationHistoryV2,
  entries: readonly GenerationHistoryEntryDraftV2[],
  bankRevision: number,
): GenerationHistoryV2 {
  if (entries.length === 0) throw new Error("A generation-history batch cannot be empty.");
  let next = history;
  for (const entry of entries) {
    if (entry.batchId === undefined || entry.blueprintId === undefined || entry.setId === undefined) {
      throw new Error("Every learning-path history entry needs batch, blueprint, and set IDs.");
    }
    next = appendGenerationHistory(next, entry, bankRevision);
  }
  return next;
}

export function generationForBankRevision(
  history: GenerationHistoryV2,
  bankRevision: number,
): GenerationHistoryEntryV2 | undefined {
  return [...history.entries]
    .filter((entry) => entry.bankRevision <= bankRevision)
    .sort((left, right) => (
      right.bankRevision - left.bankRevision
      || Date.parse(right.generatedAt) - Date.parse(left.generatedAt)
      || compareText(right.id, left.id)
    ))[0];
}

export function generationForSetRevision(
  history: GenerationHistoryV2,
  setId: string,
  bankRevision: number,
): GenerationHistoryEntryV2 | undefined {
  return [...history.entries]
    .filter((entry) => entry.setId === setId && entry.bankRevision <= bankRevision)
    .sort((left, right) => (
      right.bankRevision - left.bankRevision
      || Date.parse(right.generatedAt) - Date.parse(left.generatedAt)
      || compareText(right.id, left.id)
    ))[0];
}

export function serializeGenerationHistoryFrontmatter(
  history: GenerationHistoryV2,
): string {
  const problem = generationHistoryProblem(history);
  if (problem !== null) {
    throw new Error(`Cannot serialize invalid generation history: ${problem}`);
  }
  return `${GENERATION_HISTORY_FRONTMATTER_KEY}: ${yamlString(JSON.stringify(history))}`;
}

export function parseGenerationHistoryMarkdown(
  markdown: string,
): GenerationHistoryParseResult {
  const raw = frontmatterValue(markdown, GENERATION_HISTORY_FRONTMATTER_KEY);
  if (raw === undefined) return { status: "missing" };
  try {
    const encoded = JSON.parse(raw) as unknown;
    if (typeof encoded !== "string") throw new Error("Expected a quoted JSON string.");
    const value = JSON.parse(encoded) as unknown;
    const problem = generationHistoryProblem(value);
    return problem === null
      ? { status: "ok", history: cloneHistory(value) }
      : { status: "invalid", message: problem };
  } catch {
    return {
      status: "invalid",
      message: "The saved generation history is malformed or incomplete.",
    };
  }
}

function generationHistoryProblem(value: unknown): string | null {
  if (!isRecord(value)) return "Generation history must be an object.";
  if (
    Object.keys(value).some((key) => key !== "schemaVersion" && key !== "entries")
    || (value.schemaVersion !== LEGACY_GENERATION_HISTORY_VERSION
      && value.schemaVersion !== GENERATION_HISTORY_VERSION)
    || !Array.isArray(value.entries)
  ) {
    return "The generation history version or shape is unsupported.";
  }
  const ids = new Set<string>();
  let priorRevision = -1;
  let priorEntry: GenerationHistoryEntryV2 | undefined;
  for (const [index, entry] of value.entries.entries()) {
    const problem = generationHistoryEntryProblem(
      entry,
      value.schemaVersion === GENERATION_HISTORY_VERSION,
    );
    if (problem !== null) return `Generation history entry ${index + 1}: ${problem}`;
    const typed = entry as unknown as GenerationHistoryEntryV2;
    if (ids.has(typed.id)) return "Generation history job IDs must be unique.";
    if (typed.bankRevision < priorRevision) {
      return "Generation history bank revisions must increase or remain equal within one atomic batch; they must not decrease.";
    }
    if (
      typed.bankRevision === priorRevision
      && (
        priorEntry?.batchId === undefined
        || typed.batchId === undefined
        || priorEntry.batchId !== typed.batchId
        || priorEntry.blueprintId !== typed.blueprintId
        || priorEntry.setId === typed.setId
      )
    ) {
      return "Equal bank revisions are allowed only for distinct sets in the same atomic learning-path batch.";
    }
    ids.add(typed.id);
    priorRevision = typed.bankRevision;
    priorEntry = typed;
  }
  return null;
}

function generationHistoryEntryProblem(
  value: unknown,
  allowPathOwnership = true,
): string | null {
  if (!isRecord(value)) return "the entry must be an object.";
  const allowed = new Set([
    "id", "bankRevision", "generatedAt", "provider", "providerVersion",
    "model", "reasoningEffort", "promptVersion", "sourceHash", "sourceScope",
    "requestedQuantity", "draftExerciseCount", "savedExerciseCount",
    "difficulty", "focusInstructions", "exerciseTypePercentages",
    "selectedVisualCount", "attempts", "batchId", "blueprintId", "setId",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    return "the entry contains an unknown field.";
  }
  if (!safeText(value.id, 200) || !/^[A-Za-z0-9._:-]+$/u.test(value.id)) {
    return "the job ID is invalid.";
  }
  if (!nonNegativeInteger(value.bankRevision)) return "the bank revision is invalid.";
  if (!isoDate(value.generatedAt)) return "the generation timestamp is invalid.";
  if (!provider(value.provider)) return "the provider is invalid.";
  if (value.providerVersion !== undefined && !safeText(value.providerVersion, 240)) {
    return "the provider version is invalid.";
  }
  if (typeof value.model !== "string" || modelIdProblem(value.model) !== null) {
    return "the model identifier is invalid.";
  }
  if (!reasoning(value.reasoningEffort)) return "the reasoning effort is invalid.";
  if (!safeText(value.promptVersion, 120)) return "the prompt version is invalid.";
  if (typeof value.sourceHash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value.sourceHash)) {
    return "the source hash is invalid.";
  }
  if (
    value.sourceScope !== "note"
    && value.sourceScope !== "selection"
    && value.sourceScope !== "pdf"
  ) {
    return "the source scope is invalid.";
  }
  if (!integerInRange(value.requestedQuantity, 1, 30)) return "the requested quantity is invalid.";
  if (!integerInRange(value.draftExerciseCount, 1, 30)) return "the draft count is invalid.";
  if (!integerInRange(value.savedExerciseCount, 1, 30)) return "the saved count is invalid.";
  if ((value.savedExerciseCount as number) > (value.draftExerciseCount as number)) {
    return "the saved count cannot exceed the draft count.";
  }
  if (!difficulty(value.difficulty)) return "the difficulty is invalid.";
  if (typeof value.focusInstructions !== "string" || value.focusInstructions.length > 4_000) {
    return "the focus instructions are invalid.";
  }
  const percentages = percentagesFromUnknown(value.exerciseTypePercentages);
  if (percentages === null || exerciseTypeDistributionProblem(percentages) !== null) {
    return "the exercise mix is invalid.";
  }
  if (!integerInRange(value.selectedVisualCount, 0, 1_000)) return "the visual count is invalid.";
  if (value.attempts !== 1 && value.attempts !== 2) return "the attempt count is invalid.";
  const pathIds = [value.batchId, value.blueprintId, value.setId];
  const presentPathIds = pathIds.filter((item) => item !== undefined);
  if (!allowPathOwnership && presentPathIds.length > 0) {
    return "legacy entries cannot contain learning-path ownership.";
  }
  if (presentPathIds.length !== 0 && presentPathIds.length !== pathIds.length) {
    return "batch, blueprint, and set IDs must be present together.";
  }
  if (presentPathIds.some((item) => !historyIdentifier(item))) {
    return "the batch, blueprint, or set ID is invalid.";
  }
  return null;
}

function percentagesFromUnknown(value: unknown): ExerciseTypePercentages | null {
  if (!isRecord(value)) return null;
  if (
    Object.keys(value).length !== EXERCISE_TYPES.length
    || Object.keys(value).some((key) => !EXERCISE_TYPES.includes(key as ExerciseType))
  ) return null;
  const result = Object.fromEntries(EXERCISE_TYPES.map((type) => [type, value[type]])) as Record<ExerciseType, number>;
  return EXERCISE_TYPES.every((type) => typeof result[type] === "number")
    ? result
    : null;
}

function cloneHistory(history: unknown): GenerationHistoryV2 {
  if (!isRecord(history) || !Array.isArray(history.entries)) {
    throw new Error("Generation history must be an object.");
  }
  return {
    schemaVersion: GENERATION_HISTORY_VERSION,
    entries: history.entries.map((raw) => {
      const entry = raw as GenerationHistoryEntryV2;
      return {
        ...entry,
      exerciseTypePercentages: Object.fromEntries(
        EXERCISE_TYPES.map((type) => [type, entry.exerciseTypePercentages[type]]),
      ) as Record<ExerciseType, number>,
      };
    }),
  };
}

function historyIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeText(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && [...value].every((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code > 31 && code !== 127;
    });
}

function provider(value: unknown): value is ProviderId {
  return value === "codex" || value === "claude" || value === "agy";
}

function reasoning(value: unknown): value is ReasoningEffort {
  return value === "low" || value === "medium" || value === "high"
    || value === "xhigh" || value === "max" || value === "ultra";
}

function difficulty(value: unknown): value is Difficulty {
  return value === "foundational" || value === "deep-exam" || value === "challenge";
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 0;
}

function integerInRange(value: unknown, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function isoDate(value: unknown): value is string {
  return safeText(value, 40)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    && !Number.isNaN(Date.parse(value));
}

function yamlString(value: string): string {
  return JSON.stringify(value) ?? "undefined";
}

function frontmatterValue(markdown: string, key: string): string | undefined {
  const normalized = markdown.replace(/\r\n?/gu, "\n");
  if (!normalized.startsWith("---\n")) return undefined;
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) return undefined;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escapedKey}:\\s*(.+)$`, "mu").exec(
    normalized.slice(4, end),
  )?.[1];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
