export const GENERATION_TELEMETRY_SCHEMA_VERSION = 1 as const;

export type GenerationTokenUsageSourceV1 =
  | "provider-reported"
  | "local-estimate"
  | "mixed";

/**
 * Provider-neutral token accounting. Cached and reasoning tokens are subsets
 * of input/output totals when the provider reports them, so callers must not
 * add those fields to the total again.
 */
export interface GenerationTokenUsageV1 {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
  readonly reasoningTokens?: number;
  readonly source: GenerationTokenUsageSourceV1;
  /** True when the local prompt estimate cannot include image/video tokenization. */
  readonly inputEstimateExcludesMedia: boolean;
}

export interface GenerationAttemptTelemetryV1 {
  readonly attempt: 1 | 2;
  readonly durationMs: number;
  readonly tokenUsage: GenerationTokenUsageV1;
  readonly reportedCostUsd?: number;
  readonly providerDurationMs?: number;
  readonly providerApiDurationMs?: number;
}

export interface GenerationCostCoverageV1 {
  /** Provider attempts for which the CLI explicitly reported a monetary cost. */
  readonly reportedProviderAttempts: number;
  /** All provider attempts represented by this telemetry summary. */
  readonly totalProviderAttempts: number;
}

/** Immutable summary stored with generation provenance when available. */
export interface GenerationTelemetryV1 {
  readonly schemaVersion: typeof GENERATION_TELEMETRY_SCHEMA_VERSION;
  readonly durationMs: number;
  readonly attempts: 1 | 2;
  readonly tokenUsage: GenerationTokenUsageV1;
  /** Present only when every represented provider attempt reported a cost. */
  readonly reportedCostUsd?: number;
  /** A lower bound when only some represented provider attempts reported cost. */
  readonly partialReportedCostUsd?: number;
  readonly reportedCostCoverage?: GenerationCostCoverageV1;
  readonly providerDurationMs?: number;
  readonly providerApiDurationMs?: number;
}

export interface GenerationTelemetryTotalsV1 {
  readonly jobCount: number;
  readonly providerAttemptCount: number;
  readonly tokenUsage: GenerationTokenUsageV1;
  /** Present only when every represented provider attempt reported a cost. */
  readonly reportedCostUsd?: number;
  /** A lower bound when only some represented provider attempts reported cost. */
  readonly partialReportedCostUsd?: number;
  readonly reportedCostCoverage?: GenerationCostCoverageV1;
}

export function estimateTextTokens(text: string): number {
  const length = [...text].length;
  return length === 0 ? 0 : Math.max(1, Math.ceil(length / 4));
}

export function tokenUsageTotal(usage: GenerationTokenUsageV1): number {
  return usage.inputTokens + usage.outputTokens;
}

export function generationTelemetryFromActivity(
  events: readonly { readonly telemetry?: GenerationAttemptTelemetryV1 }[],
  durationMs?: number,
): GenerationTelemetryV1 | undefined {
  const byAttempt = new Map<1 | 2, GenerationAttemptTelemetryV1>();
  for (const event of events) {
    if (event.telemetry !== undefined) {
      byAttempt.set(event.telemetry.attempt, event.telemetry);
    }
  }
  const attempts = [...byAttempt.values()].sort((left, right) => left.attempt - right.attempt);
  if (attempts.length === 0) return undefined;
  return aggregateGenerationTelemetry(
    attempts,
    durationMs ?? attempts.reduce((total, item) => total + item.durationMs, 0),
  );
}

export function combineGenerationTelemetry(
  jobs: readonly GenerationTelemetryV1[],
): GenerationTelemetryTotalsV1 | undefined {
  if (jobs.length === 0) return undefined;
  const sources = new Set(jobs.map((job) => job.tokenUsage.source));
  const source: GenerationTokenUsageSourceV1 = sources.size === 1
    ? jobs[0]!.tokenUsage.source
    : "mixed";
  const totalProviderAttempts = jobs.reduce((total, job) => total + job.attempts, 0);
  const costParts = jobs.map(jobCostPart);
  const reportedProviderAttempts = costParts.reduce(
    (total, part) => total + part.reportedProviderAttempts,
    0,
  );
  const reportedCostSum = boundedMetric(
    costParts.reduce((total, part) => total + part.reportedCostUsd, 0),
  );
  const tokenUsage: GenerationTokenUsageV1 = {
    inputTokens: boundedWholeSum(jobs.map((job) => job.tokenUsage.inputTokens)),
    outputTokens: boundedWholeSum(jobs.map((job) => job.tokenUsage.outputTokens)),
    source,
    inputEstimateExcludesMedia: jobs.some((job) => job.tokenUsage.inputEstimateExcludesMedia),
    ...optionalJobTokenSum(jobs, "cachedInputTokens"),
    ...optionalJobTokenSum(jobs, "cacheWriteInputTokens"),
    ...optionalJobTokenSum(jobs, "reasoningTokens"),
  };
  return {
    jobCount: jobs.length,
    providerAttemptCount: totalProviderAttempts,
    tokenUsage,
    ...costSummary(reportedCostSum, reportedProviderAttempts, totalProviderAttempts),
  };
}

export function aggregateGenerationTelemetry(
  attempts: readonly GenerationAttemptTelemetryV1[],
  durationMs: number,
): GenerationTelemetryV1 {
  if (attempts.length === 0 || attempts.length > 2) {
    throw new Error("Generation telemetry needs one or two provider attempts.");
  }
  const orderedAttempts = [...attempts].sort((left, right) => left.attempt - right.attempt);
  for (const [index, attempt] of orderedAttempts.entries()) {
    const problem = generationAttemptTelemetryProblem(attempt);
    if (problem !== null) throw new Error(`Invalid generation attempt telemetry: ${problem}`);
    if (attempt.attempt !== index + 1) {
      throw new Error("Generation telemetry attempts must be unique and sequential from attempt 1.");
    }
  }
  const sources = new Set(orderedAttempts.map((item) => item.tokenUsage.source));
  const source: GenerationTokenUsageSourceV1 = sources.size === 1
    ? orderedAttempts[0]!.tokenUsage.source
    : "mixed";
  const sumOptional = (
    selector: (item: GenerationAttemptTelemetryV1) => number | undefined,
  ): number | undefined => {
    const values = orderedAttempts.map(selector).filter((value): value is number => value !== undefined);
    return values.length === 0 ? undefined : boundedMetric(values.reduce((total, value) => total + value, 0));
  };
  const tokenUsage: GenerationTokenUsageV1 = {
    inputTokens: boundedWholeSum(orderedAttempts.map((item) => item.tokenUsage.inputTokens)),
    outputTokens: boundedWholeSum(orderedAttempts.map((item) => item.tokenUsage.outputTokens)),
    source,
    inputEstimateExcludesMedia: attempts.some(
      (item) => item.tokenUsage.inputEstimateExcludesMedia,
    ),
    ...optionalTokenSum(orderedAttempts, "cachedInputTokens"),
    ...optionalTokenSum(orderedAttempts, "cacheWriteInputTokens"),
    ...optionalTokenSum(orderedAttempts, "reasoningTokens"),
  };
  const costs = orderedAttempts
    .map((item) => item.reportedCostUsd)
    .filter((value): value is number => value !== undefined);
  return {
    schemaVersion: GENERATION_TELEMETRY_SCHEMA_VERSION,
    durationMs: boundedMetric(durationMs),
    attempts: orderedAttempts.length as 1 | 2,
    tokenUsage,
    ...costSummary(
      boundedMetric(costs.reduce((total, value) => total + value, 0)),
      costs.length,
      orderedAttempts.length,
    ),
    ...optionalMetric("providerDurationMs", sumOptional((item) => item.providerDurationMs)),
    ...optionalMetric("providerApiDurationMs", sumOptional((item) => item.providerApiDurationMs)),
  };
}

export function generationTelemetryProblem(value: unknown): string | null {
  if (!isRecord(value)) return "generation telemetry must be an object.";
  const allowed = new Set([
    "schemaVersion",
    "durationMs",
    "attempts",
    "tokenUsage",
    "reportedCostUsd",
    "partialReportedCostUsd",
    "reportedCostCoverage",
    "providerDurationMs",
    "providerApiDurationMs",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    return "generation telemetry contains an unknown field.";
  }
  if (value.schemaVersion !== GENERATION_TELEMETRY_SCHEMA_VERSION) {
    return "generation telemetry uses an unsupported version.";
  }
  if (!finiteMetric(value.durationMs) || (value.attempts !== 1 && value.attempts !== 2)) {
    return "generation telemetry timing or attempt count is invalid.";
  }
  const tokenProblem = generationTokenUsageProblem(value.tokenUsage);
  if (tokenProblem !== null) return tokenProblem;
  for (const field of ["reportedCostUsd", "providerDurationMs", "providerApiDurationMs"] as const) {
    if (value[field] !== undefined && !finiteMetric(value[field])) {
      return `generation telemetry ${field} is invalid.`;
    }
  }
  if (value.partialReportedCostUsd !== undefined && !finiteMetric(value.partialReportedCostUsd)) {
    return "generation telemetry partialReportedCostUsd is invalid.";
  }
  const coverageProblem = generationCostCoverageProblem(value.reportedCostCoverage);
  if (coverageProblem !== null) return coverageProblem;
  if (value.reportedCostUsd !== undefined && value.partialReportedCostUsd !== undefined) {
    return "generation telemetry cannot contain both complete and partial monetary cost.";
  }
  if (
    value.reportedCostCoverage !== undefined
    && value.reportedCostUsd === undefined
    && value.partialReportedCostUsd === undefined
  ) return "generation cost coverage is present without monetary cost.";
  if (value.partialReportedCostUsd !== undefined) {
    if (!isRecord(value.reportedCostCoverage)) {
      return "partial generation cost is missing its provider-attempt coverage.";
    }
    const coverage = value.reportedCostCoverage as unknown as GenerationCostCoverageV1;
    if (
      coverage.reportedProviderAttempts >= value.attempts
      || coverage.totalProviderAttempts !== value.attempts
    ) {
      return "partial generation cost coverage does not match the provider attempts.";
    }
  }
  if (
    value.reportedCostUsd !== undefined
    && isRecord(value.reportedCostCoverage)
    && (
      (value.reportedCostCoverage as unknown as GenerationCostCoverageV1).reportedProviderAttempts !== value.attempts
      || (value.reportedCostCoverage as unknown as GenerationCostCoverageV1).totalProviderAttempts !== value.attempts
    )
  ) {
    return "complete generation cost coverage does not match the provider attempts.";
  }
  return null;
}

export function generationAttemptTelemetryProblem(value: unknown): string | null {
  if (!isRecord(value)) return "generation attempt telemetry must be an object.";
  const allowed = new Set([
    "attempt",
    "durationMs",
    "tokenUsage",
    "reportedCostUsd",
    "providerDurationMs",
    "providerApiDurationMs",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    return "generation attempt telemetry contains an unknown field.";
  }
  if ((value.attempt !== 1 && value.attempt !== 2) || !finiteMetric(value.durationMs)) {
    return "generation attempt number or timing is invalid.";
  }
  const tokenProblem = generationTokenUsageProblem(value.tokenUsage);
  if (tokenProblem !== null) return tokenProblem;
  for (const field of ["reportedCostUsd", "providerDurationMs", "providerApiDurationMs"] as const) {
    if (value[field] !== undefined && !finiteMetric(value[field])) {
      return `generation attempt telemetry ${field} is invalid.`;
    }
  }
  return null;
}

export function generationTokenUsageProblem(value: unknown): string | null {
  if (!isRecord(value)) return "generation token usage must be an object.";
  const allowed = new Set([
    "inputTokens",
    "outputTokens",
    "cachedInputTokens",
    "cacheWriteInputTokens",
    "reasoningTokens",
    "source",
    "inputEstimateExcludesMedia",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    return "generation token usage contains an unknown field.";
  }
  if (!wholeMetric(value.inputTokens) || !wholeMetric(value.outputTokens)) {
    return "generation input or output token usage is invalid.";
  }
  for (const field of ["cachedInputTokens", "cacheWriteInputTokens", "reasoningTokens"] as const) {
    if (value[field] !== undefined && !wholeMetric(value[field])) {
      return `generation token usage ${field} is invalid.`;
    }
  }
  if (
    typeof value.cachedInputTokens === "number"
    && value.cachedInputTokens > value.inputTokens
  ) return "cached input tokens cannot exceed total input tokens.";
  if (
    typeof value.cacheWriteInputTokens === "number"
    && value.cacheWriteInputTokens > value.inputTokens
  ) return "cache-write input tokens cannot exceed total input tokens.";
  if (
    typeof value.reasoningTokens === "number"
    && value.reasoningTokens > value.outputTokens
  ) return "reasoning tokens cannot exceed total output tokens.";
  if (
    value.source !== "provider-reported"
    && value.source !== "local-estimate"
    && value.source !== "mixed"
  ) {
    return "generation token usage source is invalid.";
  }
  if (typeof value.inputEstimateExcludesMedia !== "boolean") {
    return "generation token media-estimate metadata is invalid.";
  }
  return null;
}

export function compactTokenCount(value: number): string {
  const safe = Math.max(0, Math.round(value));
  if (safe < 1_000) return safe.toLocaleString();
  if (safe < 1_000_000) return `${trimDecimal(safe / 1_000)}k`;
  return `${trimDecimal(safe / 1_000_000)}m`;
}

export function formatTokenUsage(usage: GenerationTokenUsageV1): string {
  const estimated = usage.source === "provider-reported" ? "" : "~";
  const parts = [
    `${estimated}${compactTokenCount(usage.inputTokens)} input`,
    `${estimated}${compactTokenCount(usage.outputTokens)} output`,
  ];
  if (usage.cachedInputTokens !== undefined) {
    parts.push(`${compactTokenCount(usage.cachedInputTokens)} cached`);
  }
  if (usage.reasoningTokens !== undefined) {
    parts.push(`${compactTokenCount(usage.reasoningTokens)} reasoning`);
  }
  return parts.join(" · ");
}

export function formatReportedCost(costUsd: number | undefined): string {
  if (costUsd === undefined) return "Monetary cost not reported by CLI";
  if (costUsd < 0.01) return `< $0.01 reported`;
  return `$${costUsd.toFixed(costUsd < 1 ? 3 : 2)} reported`;
}

export function formatGenerationCost(
  telemetry: Pick<
    GenerationTelemetryV1 | GenerationTelemetryTotalsV1,
    "reportedCostUsd" | "partialReportedCostUsd" | "reportedCostCoverage"
  >,
): string {
  if (telemetry.reportedCostUsd !== undefined) {
    return formatReportedCost(telemetry.reportedCostUsd);
  }
  if (
    telemetry.partialReportedCostUsd !== undefined
    && telemetry.reportedCostCoverage !== undefined
  ) {
    const amount = formatUsd(telemetry.partialReportedCostUsd);
    const { reportedProviderAttempts, totalProviderAttempts } = telemetry.reportedCostCoverage;
    return `${amount} reported for ${reportedProviderAttempts} of ${totalProviderAttempts} attempts · partial lower bound`;
  }
  return formatReportedCost(undefined);
}

export function formatGenerationDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

function optionalTokenSum(
  attempts: readonly GenerationAttemptTelemetryV1[],
  field: "cachedInputTokens" | "cacheWriteInputTokens" | "reasoningTokens",
): Partial<GenerationTokenUsageV1> {
  const values = attempts
    .map((item) => item.tokenUsage[field])
    .filter((value): value is number => value !== undefined);
  return values.length === 0
    ? {}
    : { [field]: boundedWholeSum(values) };
}

function optionalJobTokenSum(
  jobs: readonly GenerationTelemetryV1[],
  field: "cachedInputTokens" | "cacheWriteInputTokens" | "reasoningTokens",
): Partial<GenerationTokenUsageV1> {
  const values = jobs
    .map((job) => job.tokenUsage[field])
    .filter((value): value is number => value !== undefined);
  return values.length === 0
    ? {}
    : { [field]: boundedWholeSum(values) };
}

function jobCostPart(job: GenerationTelemetryV1): {
  readonly reportedCostUsd: number;
  readonly reportedProviderAttempts: number;
} {
  if (job.reportedCostUsd !== undefined) {
    return {
      reportedCostUsd: job.reportedCostUsd,
      reportedProviderAttempts: job.reportedCostCoverage?.reportedProviderAttempts
        ?? job.attempts,
    };
  }
  return {
    reportedCostUsd: job.partialReportedCostUsd ?? 0,
    reportedProviderAttempts: job.reportedCostCoverage?.reportedProviderAttempts ?? 0,
  };
}

function costSummary(
  amountUsd: number,
  reportedProviderAttempts: number,
  totalProviderAttempts: number,
): Partial<GenerationTelemetryV1 & GenerationTelemetryTotalsV1> {
  if (reportedProviderAttempts <= 0 || totalProviderAttempts <= 0) return {};
  const reportedCostCoverage: GenerationCostCoverageV1 = {
    reportedProviderAttempts,
    totalProviderAttempts,
  };
  return reportedProviderAttempts === totalProviderAttempts
    ? { reportedCostUsd: amountUsd, reportedCostCoverage }
    : { partialReportedCostUsd: amountUsd, reportedCostCoverage };
}

function generationCostCoverageProblem(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isRecord(value)) return "generation cost coverage must be an object.";
  const allowed = new Set(["reportedProviderAttempts", "totalProviderAttempts"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    return "generation cost coverage contains an unknown field.";
  }
  if (
    !wholeMetric(value.reportedProviderAttempts)
    || !wholeMetric(value.totalProviderAttempts)
    || value.reportedProviderAttempts <= 0
    || value.totalProviderAttempts <= 0
    || value.reportedProviderAttempts > value.totalProviderAttempts
  ) return "generation cost coverage is invalid.";
  return null;
}

function optionalMetric<Key extends keyof GenerationTelemetryV1>(
  key: Key,
  value: number | undefined,
): Partial<GenerationTelemetryV1> {
  return value === undefined ? {} : { [key]: boundedMetric(value) };
}

function boundedMetric(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, value));
}

function boundedWholeSum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total = Math.min(Number.MAX_SAFE_INTEGER, total + value);
  }
  return total;
}

function formatUsd(costUsd: number): string {
  if (costUsd < 0.01) return "< $0.01";
  return `$${costUsd.toFixed(costUsd < 1 ? 3 : 2)}`;
}

function finiteMetric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function wholeMetric(value: unknown): value is number {
  return finiteMetric(value) && Number.isSafeInteger(value);
}

function trimDecimal(value: number): string {
  return value.toFixed(value < 10 ? 1 : 0).replace(/\.0$/u, "");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
