export type CliErrorCode =
  | "busy"
  | "cancelled"
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
