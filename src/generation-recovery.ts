import type { GenerationDraftV1, SourceSegmentV1, VisualSourceV1 } from "./model";
import {
  sourceImportProblem,
  type PdfSourceImportV1,
} from "./source-import";
import type { CollectedSource } from "./source";
import type { GenerationConfiguration } from "./ui/contracts";

export const GENERATION_RECOVERY_CONTEXT_VERSION = 1 as const;
export const GENERATION_RECOVERY_DRAFT_VERSION = 1 as const;
export const GENERATION_RECOVERY_DRAFT_FILENAME = "generation-draft.json";
const MAX_RECOVERY_TEXT_CHARACTERS = 2_000_000;
const MAX_RECOVERY_SEGMENTS = 20_000;
const MAX_RECOVERY_VISUALS = 200;
const RECOVERY_EXERCISE_TYPES = [
  "short-answer",
  "causal-explanation",
  "application",
  "calculation",
  "cloze",
  "single-select",
  "multi-select",
  "matching",
  "ordering",
  "image-occlusion",
] as const satisfies readonly GenerationConfiguration["exerciseTypes"][number][];

export interface RecoverySourceSnapshotV1 {
  readonly mode: CollectedSource["mode"];
  readonly title: string;
  readonly path: string;
  readonly characterCount: number;
  readonly excerpt: string;
  readonly detail?: string;
  readonly submittedText: string;
  readonly sourceImport?: PdfSourceImportV1;
  readonly hash: string;
  readonly segments: readonly SourceSegmentV1[];
}

export interface GenerationRecoveryContextV1 {
  readonly schemaVersion: typeof GENERATION_RECOVERY_CONTEXT_VERSION;
  readonly jobId: string;
  readonly startedAt: string;
  readonly source: RecoverySourceSnapshotV1;
  readonly configuration: GenerationConfiguration;
  readonly prompt: string;
  readonly visuals: readonly VisualSourceV1[];
}

export interface GenerationRecoveryDraftV1 {
  readonly schemaVersion: typeof GENERATION_RECOVERY_DRAFT_VERSION;
  readonly jobId: string;
  readonly completedAt: string;
  readonly attempts: 1 | 2;
  readonly draft: GenerationDraftV1;
}

export function createGenerationRecoveryContext(input: {
  readonly jobId: string;
  readonly startedAt: string;
  readonly source: CollectedSource;
  readonly configuration: GenerationConfiguration;
  readonly prompt: string;
  readonly visuals: readonly VisualSourceV1[];
}): GenerationRecoveryContextV1 {
  const source: RecoverySourceSnapshotV1 = {
    mode: input.source.mode,
    title: input.source.title,
    path: input.source.path,
    characterCount: input.source.characterCount,
    excerpt: input.source.excerpt,
    ...(input.source.detail === undefined ? {} : { detail: input.source.detail }),
    submittedText: input.source.submittedText,
    ...(input.source.sourceImport === undefined
      ? {}
      : { sourceImport: structuredClone(input.source.sourceImport) }),
    hash: input.source.hash,
    segments: structuredClone(input.source.segments),
  };
  const context: GenerationRecoveryContextV1 = {
    schemaVersion: GENERATION_RECOVERY_CONTEXT_VERSION,
    jobId: input.jobId,
    startedAt: input.startedAt,
    source,
    configuration: structuredClone(input.configuration),
    prompt: input.prompt,
    visuals: structuredClone(input.visuals),
  };
  return parseGenerationRecoveryContext(JSON.stringify(context));
}

export function parseGenerationRecoveryContext(
  serialized: string,
): GenerationRecoveryContextV1 {
  if (serialized.length > MAX_RECOVERY_TEXT_CHARACTERS) {
    throw new Error("The interrupted-generation context is too large to recover safely.");
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error("The interrupted-generation context is malformed.");
  }
  if (!isRecord(value) || value.schemaVersion !== GENERATION_RECOVERY_CONTEXT_VERSION) {
    throw new Error("The interrupted-generation context version is unsupported.");
  }
  const jobId = safeJobId(value.jobId);
  const startedAt = safeTimestamp(value.startedAt, "start timestamp");
  const source = parseSource(value.source);
  const configuration = parseConfiguration(value.configuration);
  const prompt = safeText(value.prompt, 1, MAX_RECOVERY_TEXT_CHARACTERS, "prompt");
  const visuals = parseVisuals(value.visuals);
  const visualIds = new Set(visuals.map((visual) => visual.id));
  if (
    configuration.selectedVisualIds.some((id) => !visualIds.has(id))
    || visuals.some((visual) => !configuration.selectedVisualIds.includes(visual.id))
  ) {
    throw new Error("The interrupted generation's selected visuals do not match its approved configuration.");
  }
  return {
    schemaVersion: GENERATION_RECOVERY_CONTEXT_VERSION,
    jobId,
    startedAt,
    source,
    configuration,
    prompt,
    visuals,
  };
}

export function createGenerationRecoveryDraft(input: {
  readonly jobId: string;
  readonly attempts: 1 | 2;
  readonly draft: GenerationDraftV1;
}): GenerationRecoveryDraftV1 {
  return {
    schemaVersion: GENERATION_RECOVERY_DRAFT_VERSION,
    jobId: safeJobId(input.jobId),
    completedAt: new Date().toISOString(),
    attempts: input.attempts,
    draft: structuredClone(input.draft),
  };
}

export function parseGenerationRecoveryDraft(
  serialized: string,
): GenerationRecoveryDraftV1 {
  if (serialized.length > MAX_RECOVERY_TEXT_CHARACTERS) {
    throw new Error("The recovered draft is too large to load safely.");
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error("The recovered draft checkpoint is malformed.");
  }
  if (
    !isRecord(value)
    || value.schemaVersion !== GENERATION_RECOVERY_DRAFT_VERSION
    || (value.attempts !== 1 && value.attempts !== 2)
    || !isRecord(value.draft)
  ) {
    throw new Error("The recovered draft checkpoint is invalid.");
  }
  return {
    schemaVersion: GENERATION_RECOVERY_DRAFT_VERSION,
    jobId: safeJobId(value.jobId),
    completedAt: safeTimestamp(value.completedAt, "completion timestamp"),
    attempts: value.attempts,
    draft: structuredClone(value.draft) as unknown as GenerationDraftV1,
  };
}

function parseSource(value: unknown): RecoverySourceSnapshotV1 {
  if (!isRecord(value)) throw new Error("The interrupted generation's source snapshot is invalid.");
  const mode = value.mode;
  if (mode !== "selection" && mode !== "note" && mode !== "pdf") {
    throw new Error("The interrupted generation's source mode is invalid.");
  }
  const submittedText = safeText(
    value.submittedText,
    20,
    MAX_RECOVERY_TEXT_CHARACTERS,
    "submitted source",
  );
  const characterCount = positiveInteger(value.characterCount, "source character count");
  if (characterCount !== submittedText.length) {
    throw new Error("The interrupted generation's source character count changed.");
  }
  const hash = safeHash(value.hash, "source hash");
  const segments = parseSegments(value.segments);
  const sourceImport = value.sourceImport;
  if (mode === "pdf" && !isRecord(sourceImport)) {
    throw new Error("The interrupted PDF generation is missing page provenance.");
  }
  if (mode !== "pdf" && sourceImport !== undefined) {
    throw new Error("Only an interrupted PDF generation may contain PDF provenance.");
  }
  if (sourceImport !== undefined) {
    if (!isRecord(sourceImport)) {
      throw new Error("The interrupted PDF generation has invalid page provenance.");
    }
    const problem = sourceImportProblem(sourceImport);
    if (problem !== null) {
      throw new Error(`The interrupted PDF generation has invalid page provenance. ${problem}`);
    }
    if (sourceImport.sourceHash !== hash) {
      throw new Error("The interrupted PDF generation's source hash does not match its page provenance.");
    }
  }
  return {
    mode,
    title: safeText(value.title, 1, 500, "source title"),
    path: safeVaultPath(value.path),
    characterCount,
    excerpt: safeText(value.excerpt, 1, 2_000, "source excerpt"),
    ...(value.detail === undefined
      ? {}
      : { detail: safeText(value.detail, 1, 2_000, "source detail") }),
    submittedText,
    ...(sourceImport === undefined
      ? {}
      : { sourceImport: structuredClone(sourceImport) as unknown as PdfSourceImportV1 }),
    hash,
    segments,
  };
}

function parseSegments(value: unknown): readonly SourceSegmentV1[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RECOVERY_SEGMENTS) {
    throw new Error("The interrupted generation's source segments are invalid.");
  }
  const ids = new Set<string>();
  return value.map((entry, index) => {
    if (!isRecord(entry) || (entry.kind !== "heading" && entry.kind !== "paragraph")) {
      throw new Error(`Interrupted source segment ${index + 1} is invalid.`);
    }
    const id = safeIdentifier(entry.id, "segment ID");
    if (ids.has(id)) throw new Error("Interrupted source segment IDs must be unique.");
    ids.add(id);
    if (!Number.isInteger(entry.ordinal) || entry.ordinal !== index) {
      throw new Error("Interrupted source segment ordinals are invalid.");
    }
    if (
      !Array.isArray(entry.headingPath)
      || entry.headingPath.length > 12
      || entry.headingPath.some((part) => typeof part !== "string" || part.length > 500)
    ) {
      throw new Error("An interrupted source heading path is invalid.");
    }
    return {
      id,
      kind: entry.kind,
      ordinal: entry.ordinal,
      headingPath: entry.headingPath.map((part) => String(part)),
      text: safeText(entry.text, 1, 100_000, "segment text"),
    };
  });
}

function parseConfiguration(value: unknown): GenerationConfiguration {
  if (!isRecord(value)) throw new Error("The interrupted generation configuration is invalid.");
  const provider = value.provider;
  if (provider !== "codex" && provider !== "claude" && provider !== "agy") {
    throw new Error("The interrupted generation provider is invalid.");
  }
  const reasoningEffort = value.reasoningEffort;
  if (!isReasoningEffort(reasoningEffort)) {
    throw new Error("The interrupted generation reasoning effort is invalid.");
  }
  const difficulty = value.difficulty;
  if (difficulty !== "foundational" && difficulty !== "deep-exam" && difficulty !== "challenge") {
    throw new Error("The interrupted generation difficulty is invalid.");
  }
  if (!Array.isArray(value.exerciseTypes) || value.exerciseTypes.length === 0) {
    throw new Error("The interrupted generation exercise types are invalid.");
  }
  if (!isRecord(value.exerciseTypePercentages)) {
    throw new Error("The interrupted generation exercise mix is invalid.");
  }
  if (!Array.isArray(value.selectedVisualIds)) {
    throw new Error("The interrupted generation visual selection is invalid.");
  }
  const exerciseTypes = value.exerciseTypes.map((type) => safeExerciseType(type));
  const selectedVisualIds = value.selectedVisualIds.map((id) => safeIdentifier(id, "visual ID"));
  if (new Set(exerciseTypes).size !== exerciseTypes.length) {
    throw new Error("The interrupted generation exercise types contain duplicates.");
  }
  if (new Set(selectedVisualIds).size !== selectedVisualIds.length) {
    throw new Error("The interrupted generation visual IDs contain duplicates.");
  }
  if (Object.keys(value.exerciseTypePercentages).length !== RECOVERY_EXERCISE_TYPES.length) {
    throw new Error("The interrupted generation exercise mix is incomplete.");
  }
  const exerciseTypePercentages: Record<string, number> = {};
  for (const [key, percentage] of Object.entries(value.exerciseTypePercentages)) {
    const type = safeExerciseType(key);
    if (
      typeof percentage !== "number"
      || !Number.isInteger(percentage)
      || percentage < 0
      || percentage > 100
    ) {
      throw new Error("The interrupted generation exercise percentages are invalid.");
    }
    exerciseTypePercentages[type] = percentage;
  }
  if (Object.values(exerciseTypePercentages).reduce((sum, item) => sum + item, 0) !== 100) {
    throw new Error("The interrupted generation exercise percentages no longer total 100%.");
  }
  const enabledTypes = RECOVERY_EXERCISE_TYPES.filter(
    (type) => (exerciseTypePercentages[type] ?? 0) > 0,
  );
  if (
    enabledTypes.length !== exerciseTypes.length
    || enabledTypes.some((type) => !exerciseTypes.includes(type))
  ) {
    throw new Error("The interrupted generation's enabled exercise types do not match its percentages.");
  }
  return {
    provider,
    model: typeof value.model === "string" ? value.model.slice(0, 200) : "",
    reasoningEffort,
    focusInstructions: typeof value.focusInstructions === "string"
      ? value.focusInstructions.slice(0, 4_000)
      : "",
    quantity: boundedInteger(value.quantity, 1, 30, "quantity"),
    difficulty,
    exerciseTypes,
    exerciseTypePercentages: exerciseTypePercentages as GenerationConfiguration["exerciseTypePercentages"],
    selectedVisualIds,
  };
}

function parseVisuals(value: unknown): readonly VisualSourceV1[] {
  if (!Array.isArray(value) || value.length > MAX_RECOVERY_VISUALS) {
    throw new Error("The interrupted generation's visual sources are invalid.");
  }
  const ids = new Set<string>();
  return value.map((entry) => {
    if (!isRecord(entry)) throw new Error("An interrupted visual source is invalid.");
    const id = safeIdentifier(entry.id, "visual ID");
    if (ids.has(id)) throw new Error("Interrupted visual IDs must be unique.");
    ids.add(id);
    const kind = entry.kind;
    if (
      kind !== "image"
      && kind !== "gif-frame"
      && kind !== "video-frame"
      && kind !== "notability-region"
      && kind !== "remote-snapshot"
    ) throw new Error("An interrupted visual kind is invalid.");
    const storage = entry.storage;
    if (storage !== "source" && storage !== "practice-snapshot") {
      throw new Error("An interrupted visual storage mode is invalid.");
    }
    const mimeType = entry.mimeType;
    if (
      mimeType !== "image/png"
      && mimeType !== "image/jpeg"
      && mimeType !== "image/webp"
      && mimeType !== "image/gif"
      && mimeType !== "image/svg+xml"
    ) throw new Error("An interrupted visual MIME type is invalid.");
    return {
      id,
      kind,
      vaultPath: safeVaultPath(entry.vaultPath),
      storage,
      mimeType,
      contentHash: safeHash(entry.contentHash, "visual hash"),
      width: positiveInteger(entry.width, "visual width"),
      height: positiveInteger(entry.height, "visual height"),
      ...(typeof entry.altText === "string" ? { altText: entry.altText.slice(0, 1_000) } : {}),
      ...(typeof entry.sourceEmbed === "string" ? { sourceEmbed: entry.sourceEmbed.slice(0, 2_000) } : {}),
      ...(typeof entry.frameTimeSeconds === "number" && Number.isFinite(entry.frameTimeSeconds)
        ? { frameTimeSeconds: entry.frameTimeSeconds }
        : {}),
      ...(entry.framePosition === "first" || entry.framePosition === "middle" || entry.framePosition === "last"
        ? { framePosition: entry.framePosition }
        : {}),
      ...(typeof entry.remoteHost === "string" ? { remoteHost: entry.remoteHost.slice(0, 253) } : {}),
    };
  });
}

function safeExerciseType(value: unknown): GenerationConfiguration["exerciseTypes"][number] {
  const allowed = new Set<string>(RECOVERY_EXERCISE_TYPES);
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error("An interrupted generation exercise type is invalid.");
  }
  return value as GenerationConfiguration["exerciseTypes"][number];
}

function safeJobId(value: unknown): string {
  if (typeof value !== "string" || !/^generation-[a-f0-9-]{36}$/u.test(value)) {
    throw new Error("The interrupted generation job ID is invalid.");
  }
  return value;
}

function safeIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value)) {
    throw new Error(`The interrupted generation ${label} is invalid.`);
  }
  return value;
}

function safeVaultPath(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 2_000
    || value.startsWith("/")
    || /^[A-Za-z]:[\\/]/u.test(value)
    || value.includes("\\")
    || value.split("/").includes("..")
  ) throw new Error("An interrupted generation contains an unsafe vault path.");
  return value;
}

function safeHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`The interrupted generation ${label} is invalid.`);
  }
  return value;
}

function safeTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`The interrupted generation ${label} is invalid.`);
  }
  return value;
}

function safeText(value: unknown, minimum: number, maximum: number, label: string): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    throw new Error(`The interrupted generation ${label} is invalid.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  return boundedInteger(value, 1, Number.MAX_SAFE_INTEGER, label);
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`The interrupted generation ${label} is invalid.`);
  }
  return value as number;
}

function isReasoningEffort(value: unknown): value is GenerationConfiguration["reasoningEffort"] {
  return value === "low"
    || value === "medium"
    || value === "high"
    || value === "xhigh"
    || value === "max"
    || value === "ultra";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
