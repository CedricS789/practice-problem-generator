import type { ReasoningEffortV1 } from "./model";

export const MAX_MODEL_ID_LENGTH = 120;
export const DEFAULT_AGY_MODEL = "gemini-3.6-flash-medium";
export const LEGACY_DEFAULT_AGY_MODEL = "gemini-3.6-flash-low";
export const AUTOMATIC_MODEL_CHOICE = ":practice-lab-automatic";
export const CUSTOM_MODEL_CHOICE = ":practice-lab-custom";

export type ModelProviderId = "codex" | "claude" | "agy";

export interface ModelCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly defaultReasoningEffort?: ReasoningEffortV1;
  readonly supportedReasoningEfforts?: readonly ReasoningEffortV1[];
}

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const AGY_REASONING_SUFFIX = /-(low|medium|high)$/u;

const CODEX_FALLBACK_MODELS: readonly ModelCatalogEntry[] = [
  codexModel("gpt-5.6-sol", ["low", "medium", "high", "xhigh", "max", "ultra"], "low"),
  codexModel("gpt-5.6-terra", ["low", "medium", "high", "xhigh", "max", "ultra"], "medium"),
  codexModel("gpt-5.6-luna", ["low", "medium", "high", "xhigh", "max"], "medium"),
  codexModel("gpt-5.5", ["low", "medium", "high", "xhigh"], "medium"),
  codexModel("gpt-5.2", ["low", "medium", "high", "xhigh"], "medium"),
];

const CLAUDE_FALLBACK_MODELS: readonly ModelCatalogEntry[] = [
  { id: "sonnet", label: "Sonnet (rolling alias)" },
  { id: "opus", label: "Opus (rolling alias)" },
  { id: "fable", label: "Fable (rolling alias)" },
];

const AGY_FALLBACK_MODELS: readonly ModelCatalogEntry[] = [
  ...agyFamily("gemini-3.7-flash"),
  ...agyFamily("gemini-3.6-flash"),
  ...agyFamily("gemini-3.5-flash"),
  {
    id: "gemini-3.1-pro-high",
    label: "gemini-3.1-pro-high",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "high"],
  },
  {
    id: "gemini-3.1-pro-low",
    label: "gemini-3.1-pro-low",
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: ["low", "high"],
  },
  { id: "claude-sonnet-4-6", label: "claude-sonnet-4-6" },
  { id: "claude-opus-4-6-thinking", label: "claude-opus-4-6-thinking" },
  {
    id: "gpt-oss-120b-medium",
    label: "gpt-oss-120b-medium",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
  },
];

function codexModel(
  id: string,
  supportedReasoningEfforts: readonly ReasoningEffortV1[],
  defaultReasoningEffort: ReasoningEffortV1,
): ModelCatalogEntry {
  return { id, label: id, supportedReasoningEfforts, defaultReasoningEffort };
}

function agyFamily(base: string): readonly ModelCatalogEntry[] {
  return (["high", "medium", "low"] as const).map((effort) => ({
    id: `${base}-${effort}`,
    label: `${base}-${effort}`,
    defaultReasoningEffort: effort,
    supportedReasoningEfforts: ["low", "medium", "high"],
  }));
}

export function modelIdProblem(value: string): string | null {
  if (value.length === 0) return null;
  if (value.length > MAX_MODEL_ID_LENGTH) {
    return `The model identifier must be ${MAX_MODEL_ID_LENGTH} characters or fewer.`;
  }
  if (!MODEL_ID_PATTERN.test(value)) {
    return "The model identifier may contain letters, numbers, dot, underscore, colon, slash, and hyphen only.";
  }
  return null;
}

export function normalizeModelId(
  value: unknown,
  fallback = "",
): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return modelIdProblem(normalized) === null ? normalized : fallback;
}

export function displayModelSelection(model: string): string {
  return model.length === 0 ? "Provider default (not pinned)" : model;
}

export function agyReasoningEffortForModel(
  model: string,
): ReasoningEffortV1 | undefined {
  return AGY_REASONING_SUFFIX.exec(model)?.[1] as ReasoningEffortV1 | undefined;
}

/**
 * Returns the locally discovered catalog when possible and a conservative
 * built-in catalog otherwise. Custom identifiers always remain available in
 * the UI, so an older saved selection is never discarded by catalog drift.
 */
export function modelsForProvider(
  provider: ModelProviderId,
  discovered: readonly ModelCatalogEntry[] = [],
): readonly ModelCatalogEntry[] {
  const fallback = provider === "codex"
    ? CODEX_FALLBACK_MODELS
    : provider === "claude" ? CLAUDE_FALLBACK_MODELS : AGY_FALLBACK_MODELS;
  const source = discovered.length > 0 ? discovered : fallback;
  const unique = new Map<string, ModelCatalogEntry>();
  for (const model of source) {
    const id = normalizeModelId(model.id);
    if (id.length === 0 || unique.has(id)) continue;
    unique.set(id, {
      ...model,
      id,
      label: model.label.trim().length > 0 ? model.label.trim() : id,
    });
  }
  return [...unique.values()];
}

export function automaticModelForProvider(
  provider: ModelProviderId,
  reasoningEffort: ReasoningEffortV1,
  models: readonly ModelCatalogEntry[] = [],
): string {
  if (provider !== "agy") return "";
  const catalog = modelsForProvider("agy", models);
  const preferred = DEFAULT_AGY_MODEL.replace(
    AGY_REASONING_SUFFIX,
    `-${reasoningEffort}`,
  );
  if (catalog.some((entry) => entry.id === preferred)) return preferred;
  return catalog.find((entry) =>
    entry.defaultReasoningEffort === reasoningEffort
    && agyReasoningEffortForModel(entry.id) === reasoningEffort)?.id ?? "";
}

export function modelPickerChoice(
  provider: ModelProviderId,
  model: string,
  _reasoningEffort: ReasoningEffortV1,
  models: readonly ModelCatalogEntry[] = [],
): string {
  if (model.length === 0) return AUTOMATIC_MODEL_CHOICE;
  return modelsForProvider(provider, models).some((entry) => entry.id === model)
    ? model
    : CUSTOM_MODEL_CHOICE;
}

export function reasoningEffortsForModel(
  providerEfforts: readonly ReasoningEffortV1[],
  model: string,
  models: readonly ModelCatalogEntry[] = [],
): readonly ReasoningEffortV1[] {
  const supported = models.find((entry) => entry.id === model)
    ?.supportedReasoningEfforts;
  if (supported === undefined || supported.length === 0) return providerEfforts;
  const intersection = providerEfforts.filter((effort) => supported.includes(effort));
  return intersection.length > 0 ? intersection : providerEfforts;
}

export function preferredReasoningEffort(
  current: ReasoningEffortV1,
  available: readonly ReasoningEffortV1[],
  model?: ModelCatalogEntry,
): ReasoningEffortV1 {
  if (available.includes(current)) return current;
  if (
    model?.defaultReasoningEffort !== undefined
    && available.includes(model.defaultReasoningEffort)
  ) {
    return model.defaultReasoningEffort;
  }
  return available.includes("medium") ? "medium" : available[0] ?? "medium";
}

export function agyModelForReasoning(
  model: string,
  reasoningEffort: ReasoningEffortV1,
  availableModels: readonly (string | ModelCatalogEntry)[] = AGY_FALLBACK_MODELS,
): string {
  const selected = model.length === 0 ? DEFAULT_AGY_MODEL : model;
  if (
    reasoningEffort !== "low"
    && reasoningEffort !== "medium"
    && reasoningEffort !== "high"
  ) {
    return selected;
  }
  if (!AGY_REASONING_SUFFIX.test(selected)) return selected;
  const aligned = selected.replace(AGY_REASONING_SUFFIX, `-${reasoningEffort}`);
  const availableIds = new Set(
    availableModels.map((entry) => typeof entry === "string" ? entry : entry.id),
  );
  return availableIds.has(aligned) ? aligned : selected;
}

export function agyModelReasoningProblem(
  model: string,
  reasoningEffort: ReasoningEffortV1,
  availableModels: readonly (string | ModelCatalogEntry)[] = AGY_FALLBACK_MODELS,
): string | null {
  if (model.length === 0) return null;
  const pinnedEffort = agyReasoningEffortForModel(model);
  if (pinnedEffort === undefined || pinnedEffort === reasoningEffort) return null;
  const aligned = agyModelForReasoning(model, reasoningEffort, availableModels);
  return aligned === model
    ? `The selected agy model pins ${pinnedEffort} reasoning. Choose ${pinnedEffort} reasoning or select another model that supports ${reasoningEffort} reasoning.`
    : `The selected agy model pins ${pinnedEffort} reasoning. Choose ${pinnedEffort} reasoning or use ${aligned} for ${reasoningEffort} reasoning.`;
}
