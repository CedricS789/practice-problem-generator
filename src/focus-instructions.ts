export const MAX_FOCUS_INSTRUCTIONS_LENGTH = 4_000;

export function focusInstructionsProblem(value: string): string | null {
  if (value.length > MAX_FOCUS_INSTRUCTIONS_LENGTH) {
    return `Focus instructions must be ${MAX_FOCUS_INSTRUCTIONS_LENGTH.toLocaleString()} characters or fewer.`;
  }
  return null;
}

export function focusInstructionsForPrompt(value: string): string {
  return value.trim().length === 0
    ? "None supplied. Use the submitted source and generation contract without an additional emphasis."
    : JSON.stringify(value);
}
