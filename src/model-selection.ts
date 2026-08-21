export const MAX_MODEL_ID_LENGTH = 120;
export const DEFAULT_AGY_MODEL = "gemini-3.6-flash-low";

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;

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
