import type {
  SourceValidationResult,
  StructuredOutputValidator,
  ValidationResult,
} from "./contracts";
import { CliProviderError } from "./errors";

export interface ParsedAndValidated<T> {
  readonly value: T;
}

export function parseProviderOutput<T>(
  stdout: string,
  validate: StructuredOutputValidator<T>,
): ParsedAndValidated<T> {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    throw new CliProviderError(
      "malformed-output",
      "The CLI returned an empty response.",
    );
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(trimmed) as unknown;
  } catch (initialError) {
    envelope = parseStreamingEnvelope(trimmed);
    if (envelope === undefined) {
      throw new CliProviderError(
        "malformed-output",
        "The CLI response was not valid JSON.",
        { detail: trimmed.slice(0, 2_000), cause: initialError },
      );
    }
  }

  const value = unwrapEnvelope(envelope);
  const validation = normalizeValidation(validate(value));
  if (!validation.valid) {
    throw new CliProviderError(
      "schema-validation",
      "The CLI response did not match the required schema.",
      validation.errors === undefined
        ? {}
        : { detail: validation.errors.join("\n") },
    );
  }

  return { value: value as T };
}

function unwrapEnvelope(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!isRecord(current)) return current;
    let unwrapped = false;
    for (const key of ["structured_output", "structuredOutput"] as const) {
      if (key in current) return parseNestedJson(current[key]);
    }
    // Claude and agy print modes can nest the final result more than once.
    for (const key of ["result", "response"] as const) {
      if (!(key in current)) continue;
      current = parseNestedJson(current[key]);
      unwrapped = true;
      break;
    }
    if (!unwrapped) return current;
  }
  return current;
}

function parseNestedJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function normalizeValidation(
  result: ValidationResult | SourceValidationResult<unknown> | boolean,
): ValidationResult {
  if (typeof result === "boolean") return { valid: result };
  if ("valid" in result) return result;
  return result.ok
    ? { valid: true }
    : { valid: false, errors: result.issues.map(formatIssue) };
}

function formatIssue(issue: unknown): string {
  if (
    typeof issue === "object" &&
    issue !== null &&
    "message" in issue &&
    typeof issue.message === "string"
  ) {
    return issue.message;
  }
  return typeof issue === "string"
    ? issue
    : (JSON.stringify(issue) ?? String(issue));
}

function parseStreamingEnvelope(text: string): unknown {
  const records: unknown[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith("{")) continue;
    try {
      records.push(JSON.parse(trimmed) as unknown);
    } catch {
      // JSONL diagnostics may contain non-JSON lines; ignore them here.
    }
  }

  for (const record of [...records].reverse()) {
    if (
      isRecord(record)
      && (record.type === "result" || record.event === "result")
    ) {
      return record;
    }
  }
  for (const record of [...records].reverse()) {
    if (!isRecord(record) || record.type !== "item.completed") continue;
    const item = record.item;
    if (
      isRecord(item)
      && item.type === "agent_message"
      && typeof item.text === "string"
    ) {
      return parseNestedJson(item.text);
    }
  }
  return records.at(-1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
