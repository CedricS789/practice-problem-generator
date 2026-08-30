import type { AiContextCompletionPolicyV1 } from "./model";

/** New requests require an explicit learner choice before general context is used. */
export const DEFAULT_AI_CONTEXT_COMPLETION_POLICY: AiContextCompletionPolicyV1 =
  "selected-sources-only";

/** Requests created before the policy existed allowed source-anchored completion. */
export const LEGACY_AI_CONTEXT_COMPLETION_POLICY: AiContextCompletionPolicyV1 =
  "approved-general-context";

export function isAiContextCompletionPolicy(
  value: unknown,
): value is AiContextCompletionPolicyV1 {
  return value === "selected-sources-only"
    || value === "approved-general-context";
}

export function effectiveAiContextCompletionPolicy(
  value: AiContextCompletionPolicyV1 | undefined,
): AiContextCompletionPolicyV1 {
  return value ?? LEGACY_AI_CONTEXT_COMPLETION_POLICY;
}

export function aiContextCompletionApproved(
  value: AiContextCompletionPolicyV1 | undefined,
): boolean {
  return effectiveAiContextCompletionPolicy(value) === "approved-general-context";
}
