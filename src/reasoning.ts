import type { ReasoningEffortV1 } from "./model";

export type ReasoningProviderId = "codex" | "claude" | "agy";

export const CODEX_REASONING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const satisfies readonly ReasoningEffortV1[];

export const CLAUDE_REASONING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
] as const satisfies readonly ReasoningEffortV1[];

export const AGY_REASONING_EFFORTS = [
  "low",
  "medium",
  "high",
] as const satisfies readonly ReasoningEffortV1[];

const ALL_REASONING_EFFORTS = new Set<ReasoningEffortV1>([
  ...CODEX_REASONING_EFFORTS,
  ...CLAUDE_REASONING_EFFORTS,
  ...AGY_REASONING_EFFORTS,
]);

export function reasoningEffortsForProvider(
  provider: ReasoningProviderId,
): readonly ReasoningEffortV1[] {
  if (provider === "claude") return CLAUDE_REASONING_EFFORTS;
  if (provider === "agy") return AGY_REASONING_EFFORTS;
  return CODEX_REASONING_EFFORTS;
}

export function isReasoningEffort(value: unknown): value is ReasoningEffortV1 {
  return typeof value === "string"
    && ALL_REASONING_EFFORTS.has(value as ReasoningEffortV1);
}

export function normalizeReasoningEffort(
  provider: ReasoningProviderId,
  value: unknown,
): ReasoningEffortV1 {
  if (
    isReasoningEffort(value)
    && reasoningEffortsForProvider(provider).includes(value)
  ) {
    return value;
  }
  return "medium";
}

export function displayReasoningEffort(value: ReasoningEffortV1): string {
  if (value === "xhigh") return "Extra high";
  if (value === "max") return "Maximum";
  if (value === "ultra") return "Ultra";
  if (value === "ultracode") return "Ultracode";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function reasoningEffortDescription(provider: ReasoningProviderId): string {
  const providerLabel = provider === "agy" ? "agy" : displayProvider(provider);
  const levels = reasoningEffortsForProvider(provider)
    .map(displayReasoningEffort)
    .join(", ");
  const modelNote = provider === "codex"
    ? " An exact Codex model may support only a subset and will fail clearly rather than being silently changed."
    : provider === "agy"
      ? " agy model variants ending in low, medium, or high must match; the visible model field is updated when that reasoning choice changes."
      : "";
  return `Every reasoning level exposed by the ${providerLabel} CLI is available: ${levels}. Higher effort usually takes longer.${modelNote}`;
}

function displayProvider(provider: Exclude<ReasoningProviderId, "agy">): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}
