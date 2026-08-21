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
    envelope = parseLastJsonRecord(trimmed);
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
  if (!isRecord(value)) return value;

  for (const key of ["structured_output", "structuredOutput"] as const) {
    if (key in value) return parseNestedJson(value[key]);
  }

  // Claude and agy JSON print modes wrap the final text in `result`.
  if ("result" in value) return parseNestedJson(value.result);
  if ("response" in value) return parseNestedJson(value.response);
  return value;
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

function parseLastJsonRecord(text: string): unknown {
  const starts: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "{" && (index === 0 || text[index - 1] === "\n")) {
      starts.push(index);
    }
  }
  for (const start of starts.reverse()) {
    try {
      return JSON.parse(text.slice(start).trim()) as unknown;
    } catch {
      // Try the previous line-start object; CLI diagnostics can contain braces.
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
