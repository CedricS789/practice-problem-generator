export type CliErrorCode =
  | "busy"
  | "cancelled"
  | "detached"
  | "timeout"
  | "missing-executable"
  | "process-failed"
  | "malformed-output"
  | "schema-validation"
  | "unsupported-capability"
  | "workspace-error";

export class CliProviderError extends Error {
  readonly code: CliErrorCode;
  readonly provider?: string;
  readonly detail?: string;

  constructor(
    code: CliErrorCode,
    message: string,
    options: {
      provider?: string;
      detail?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CliProviderError";
    this.code = code;
    if (options.provider !== undefined) this.provider = options.provider;
    if (options.detail !== undefined) this.detail = options.detail;
  }
}

export function isCliProviderError(error: unknown): error is CliProviderError {
  return error instanceof CliProviderError;
}

/**
 * Keeps the provider's actionable reason visible without dumping an entire
 * JSONL stream or a local path into an Obsidian notice or callout.
 */
export function formatCliErrorForUi(error: unknown, fallback: string): string {
  if (!isCliProviderError(error)) {
    return error instanceof Error && error.message.trim().length > 0
      ? error.message
      : fallback;
  }
  const detail = safeProviderDetail(error.detail);
  const hint = recoveryHint(error, detail);
  return [
    error.message.trim().length > 0 ? error.message : fallback,
    ...(detail === undefined ? [] : [`Details: ${detail}`]),
    ...(hint === undefined ? [] : [hint]),
  ].join(" ");
}

export function normalizeUnknownError(
  error: unknown,
  provider?: string,
): CliProviderError {
  if (isCliProviderError(error)) return error;

  if (isAbortError(error)) {
    return new CliProviderError("cancelled", "The AI job was cancelled.", {
      ...(provider === undefined ? {} : { provider }),
      cause: error,
    });
  }

  const code = getErrorCode(error);
  if (code === "ENOENT") {
    return new CliProviderError(
      "missing-executable",
      provider === undefined
        ? "The configured CLI executable was not found."
        : `${provider} is not installed or is not available on PATH.`,
      { ...(provider === undefined ? {} : { provider }), cause: error },
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  return new CliProviderError("process-failed", "The CLI process failed.", {
    ...(provider === undefined ? {} : { provider }),
    detail: message,
    cause: error,
  });
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError"
  );
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function safeProviderDetail(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let detail = value.trim();
  if (detail.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(detail);
    if (isRecord(parsed)) {
      const nested = isRecord(parsed.error) ? parsed.error : undefined;
      const message = nested === undefined ? undefined : boundedText(nested.message);
      const code = nested === undefined ? undefined : boundedText(nested.code);
      if (message !== undefined) detail = code === undefined ? message : `${message} (${code})`;
    }
  } catch {
    // Plain stderr is already the most useful provider detail.
  }
  return detail
    .replace(/[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/gu, "<local path>")
    .replace(/\/[^\s"']*practice-lab-[^\s"']*/gu, "<neutral job>")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 700);
}

function recoveryHint(
  error: CliProviderError,
  detail: string | undefined,
): string | undefined {
  const searchable = `${error.message} ${detail ?? ""}`.toLowerCase();
  if (/invalid_json_schema|invalid schema/iu.test(searchable)) {
    return "The provider rejected its structured-output contract; update or reload the plugin before retrying.";
  }
  if (/auth|sign[ -]?in|login|credential|unauthori[sz]ed/iu.test(searchable)) {
    return "Sign in to the selected CLI, then retry the unchanged approved payload.";
  }
  if (/rate.?limit|quota|usage limit|too many requests/iu.test(searchable)) {
    return "Wait for the provider limit to reset, then retry the unchanged approved payload.";
  }
  if (/context|too many tokens|prompt.*long/iu.test(searchable)) {
    return "Narrow the source or requested batch, preview the payload again, and retry.";
  }
  if (/model.*(?:not found|unsupported|unavailable|invalid)/iu.test(searchable)) {
    return "Choose Automatic model selection or another detected model, then retry.";
  }
  if (error.code === "process-failed") {
    return "The approved payload is unchanged. Retry once; if it repeats, use Check providers in settings.";
  }
  if (error.code === "malformed-output" || error.code === "schema-validation") {
    return "The provider response failed local validation; the approved payload remains ready to retry.";
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length === 0 ? undefined : text.slice(0, 700);
}
