import type {
  CliActivityEvent,
  CliActivityListener,
  CliActivityPhase,
  ProcessOutputEvent,
  ProviderId,
} from "./contracts";
import {
  estimateTextTokens,
  type GenerationAttemptTelemetryV1,
  type GenerationTokenUsageSourceV1,
  type GenerationTokenUsageV1,
} from "../generation-telemetry";

const RECEIVE_REPORT_STEP = 512;
const MAX_PENDING_LINE_CHARACTERS = 256_000;
const TOKEN_REPORT_STEP = 256;

interface CliActivityDecoderOptions {
  readonly prompt?: string;
  readonly includesMedia?: boolean;
  readonly startedAt?: number;
}

interface ProviderTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  reasoningTokens?: number;
}

/**
 * Converts provider JSONL into a small safe activity vocabulary. It never
 * forwards raw output: provider paths, IDs, prompts, answer JSON, tool input,
 * and hidden thinking blocks therefore cannot leak into the UI activity log.
 */
export class CliActivityDecoder {
  private readonly buffers: Record<ProcessOutputEvent["stream"], string> = {
    stdout: "",
    stderr: "",
  };
  private responseCharacters = 0;
  private lastReportedCharacters = 0;
  private lastEventKey = "";
  private sawMachineEvent = false;
  private sawOpaqueOutput = false;
  private readonly startedAt: number;
  private readonly estimatedInputTokens: number;
  private readonly includesMedia: boolean;
  private providerUsage: ProviderTokenUsage = {};
  private reportedCostUsd: number | undefined;
  private providerDurationMs: number | undefined;
  private providerApiDurationMs: number | undefined;
  private lastReportedTokenTotal = -1;

  constructor(
    private readonly provider: ProviderId,
    private readonly attempt: 1 | 2,
    private readonly listener: CliActivityListener,
    options: CliActivityDecoderOptions = {},
  ) {
    this.startedAt = options.startedAt ?? Date.now();
    this.estimatedInputTokens = estimateTextTokens(options.prompt ?? "");
    this.includesMedia = options.includesMedia === true;
  }

  start(): void {
    if (this.estimatedInputTokens === 0) return;
    this.emit(
      "running",
      `Local text prompt estimate · about ${this.estimatedInputTokens.toLocaleString()} tokens. Estimates cover submitted text and visible structured output only; hidden reasoning and provider/tool overhead are not included${this.includesMedia ? "; visual tokens are not included" : ""}.`,
    );
  }

  push(event: ProcessOutputEvent): void {
    const combined = this.buffers[event.stream] + event.text;
    const lines = combined.split(/\r?\n/u);
    this.buffers[event.stream] = lines.pop() ?? "";
    if (this.buffers[event.stream].length > MAX_PENDING_LINE_CHARACTERS) {
      if (event.stream === "stdout") {
        // The final provider result is often one JSON line. Keep a bounded
        // visible-output estimate even when that line is too large to parse
        // incrementally; the process runner retains the exact output for the
        // structured-output parser independently of this safe activity view.
        this.addResponseCharacters(this.buffers[event.stream].length);
      }
      this.buffers[event.stream] = "";
      this.emit("receiving", "Receiving a large structured response…");
    }
    for (const line of lines) this.processLine(event.stream, line);
  }

  finish(): void {
    for (const stream of ["stdout", "stderr"] as const) {
      const pending = this.buffers[stream];
      this.buffers[stream] = "";
      if (pending.length > 0) this.processLine(stream, pending);
    }
    this.reportResponseCharacters(true);
    this.reportProviderMetadata(true);
  }

  telemetry(): GenerationAttemptTelemetryV1 {
    return {
      attempt: this.attempt,
      durationMs: Math.max(0, Date.now() - this.startedAt),
      tokenUsage: this.tokenUsageSnapshot(),
      ...(this.reportedCostUsd === undefined ? {} : { reportedCostUsd: this.reportedCostUsd }),
      ...(this.providerDurationMs === undefined ? {} : { providerDurationMs: this.providerDurationMs }),
      ...(this.providerApiDurationMs === undefined ? {} : { providerApiDurationMs: this.providerApiDurationMs }),
    };
  }

  private processLine(stream: ProcessOutputEvent["stream"], line: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    if (stream === "stderr") {
      if (!this.sawMachineEvent && !this.sawOpaqueOutput) {
        this.sawOpaqueOutput = true;
        this.emit("running", `${providerLabel(this.provider)} is starting…`);
      }
      return;
    }

    let value: unknown;
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      if (!this.sawOpaqueOutput) {
        this.sawOpaqueOutput = true;
        this.emit("running", `${providerLabel(this.provider)} is working…`);
      }
      return;
    }
    if (!isRecord(value)) return;
    this.sawMachineEvent = true;
    if (this.provider === "codex") {
      this.processCodex(value);
      return;
    }
    if (this.provider === "agy") {
      this.processAgy(value);
      return;
    }
    this.processStreamJson(value);
  }

  private processCodex(record: Readonly<Record<string, unknown>>): void {
    const type = stringValue(record.type);
    if (type === "thread.started") {
      this.emit("running", "Codex session started.");
      return;
    }
    if (type === "turn.started") {
      this.emit("reasoning", "Codex is reasoning over the approved source.");
      return;
    }
    if (type === "item.started" || type === "item.completed") {
      const item = recordValue(record.item);
      const itemType = stringValue(item.type);
      if (itemType === "reasoning") {
        this.emit(
          "reasoning",
          type === "item.started"
            ? "Codex reasoning is in progress."
            : "Codex completed a reasoning update.",
        );
        return;
      }
      if (itemType === "agent_message") {
        this.addResponseCharacters(stringValue(item.text).length);
        return;
      }
      if (itemType === "image_view") {
        this.emit("tool", "Codex is inspecting submitted visual media.");
        return;
      }
      if (itemType.length > 0) {
        this.emit("tool", "Codex performed a sandboxed source check.");
      }
      return;
    }
    if (type === "turn.completed") {
      this.captureProviderMetadata(record, true);
      this.emit("running", "Codex finished its provider response.");
    }
  }

  private processStreamJson(record: Readonly<Record<string, unknown>>): void {
    const provider = providerLabel(this.provider);
    const type = stringValue(record.type);
    if (type === "system") {
      const subtype = stringValue(record.subtype);
      if (subtype === "init") {
        const model = safeIdentifier(record.model);
        this.emit(
          "running",
          model === null ? `${provider} initialized.` : `${provider} initialized · ${model}.`,
        );
      } else if (subtype === "status" && stringValue(record.status) === "requesting") {
        this.emit("running", `Waiting for ${provider}'s model response.`);
      }
      return;
    }
    if (type === "stream_event") {
      this.processStreamEvent(recordValue(record.event));
      return;
    }
    if (type === "assistant") {
      const message = recordValue(record.message);
      this.captureProviderMetadata(message, false);
      this.processAssistantMessage(message);
      return;
    }
    if (type === "result") {
      this.captureProviderMetadata(record, true);
      if (record.structured_output !== undefined) {
        this.reportAbsoluteResponseSize(serializedLength(record.structured_output));
      } else {
        this.reportAbsoluteResponseSize(stringValue(record.result).length);
      }
      this.emit("running", `${provider} finished its provider response.`);
    }
  }

  private processAgy(record: Readonly<Record<string, unknown>>): void {
    const event = stringValue(record.event);
    if (event === "init") {
      const model = safeIdentifier(recordValue(record.init).model);
      this.emit(
        "running",
        model === null ? "agy initialized." : `agy initialized · ${model}.`,
      );
      return;
    }
    if (event === "step_update") {
      const update = recordValue(record.step_update);
      const stepType = stringValue(update.step_type);
      const state = stringValue(update.state);
      if (stepType === "checkpoint") {
        this.emit("reasoning", "agy reasoning is in progress.");
      } else if (stepType === "agent_response") {
        this.addResponseCharacters(stringValue(update.text_delta).length);
      } else if (stepType === "finish" && state === "DONE") {
        this.emit("running", "agy finished its provider response.");
      }
      return;
    }
    if (event !== "result") return;
    const result = recordValue(record.result);
    this.captureProviderMetadata(result, true);
    if (result.structured_output !== undefined) {
      this.reportAbsoluteResponseSize(serializedLength(result.structured_output));
    } else {
      this.reportAbsoluteResponseSize(stringValue(result.response).length);
    }
    this.emit(
      stringValue(result.status) === "SUCCESS" ? "running" : "failed",
      stringValue(result.status) === "SUCCESS"
        ? "agy finished its provider response."
        : "agy reported a provider error.",
    );
  }

  private processStreamEvent(event: Readonly<Record<string, unknown>>): void {
    const provider = providerLabel(this.provider);
    const type = stringValue(event.type);
    if (type === "message_start") {
      const message = recordValue(event.message);
      const model = safeIdentifier(message.model);
      this.captureProviderMetadata(message, true);
      this.emit(
        "reasoning",
        model === null
          ? `${provider} started reasoning.`
          : `${provider} started reasoning with ${model}.`,
      );
      return;
    }
    if (type === "message_delta") {
      this.captureProviderMetadata(event, false);
      return;
    }
    if (type === "content_block_start") {
      const block = recordValue(event.content_block);
      const blockType = stringValue(block.type);
      if (blockType === "thinking" || blockType === "reasoning") {
        this.emit("reasoning", `${provider} reasoning is in progress.`);
      } else if (blockType === "tool_use") {
        const toolName = stringValue(block.name);
        this.emit(
          "tool",
          toolName === "Read"
            ? `${provider} is inspecting submitted visual media.`
            : toolName === "StructuredOutput"
              ? `${provider} is building the structured result.`
              : `${provider} is using an allowed isolated tool.`,
        );
      }
      return;
    }
    if (type === "content_block_delta") {
      const delta = recordValue(event.delta);
      const deltaType = stringValue(delta.type);
      if (deltaType === "thinking_delta" || deltaType === "reasoning_delta") {
        this.emit("reasoning", `${provider} reasoning is in progress.`);
      } else if (deltaType === "text_delta") {
        this.addResponseCharacters(stringValue(delta.text).length);
      } else if (deltaType === "input_json_delta") {
        this.addResponseCharacters(stringValue(delta.partial_json).length);
      }
    }
  }

  private processAssistantMessage(message: Readonly<Record<string, unknown>>): void {
    if (!Array.isArray(message.content)) return;
    let visibleCharacters = 0;
    for (const item of message.content) {
      if (!isRecord(item)) continue;
      if (stringValue(item.type) === "text") {
        visibleCharacters += stringValue(item.text).length;
      } else if (stringValue(item.type) === "tool_use" && item.input !== undefined) {
        visibleCharacters += serializedLength(item.input);
      }
    }
    this.reportAbsoluteResponseSize(visibleCharacters);
  }

  private addResponseCharacters(count: number): void {
    if (count <= 0) return;
    this.responseCharacters += count;
    this.reportResponseCharacters(false);
  }

  private reportAbsoluteResponseSize(count: number): void {
    if (count <= this.responseCharacters) return;
    this.responseCharacters = count;
    this.reportResponseCharacters(false);
  }

  private reportResponseCharacters(force: boolean): void {
    if (this.responseCharacters === 0) return;
    if (
      !force
      && this.lastReportedCharacters > 0
      && this.responseCharacters - this.lastReportedCharacters < RECEIVE_REPORT_STEP
    ) {
      return;
    }
    this.lastReportedCharacters = this.responseCharacters;
    this.emit(
      "receiving",
      `Receiving the structured response · ${this.responseCharacters.toLocaleString()} characters.`,
    );
  }

  private captureProviderMetadata(
    record: Readonly<Record<string, unknown>>,
    force: boolean,
  ): void {
    const nestedUsage = firstPresentRecord(
      record.usage,
      record.usage_metadata,
      record.usageMetadata,
    );
    const parsed = this.provider === "claude"
      ? claudeTokenUsage(nestedUsage)
      : genericTokenUsage(nestedUsage);
    this.providerUsage = mergeProviderUsage(this.providerUsage, parsed);
    this.reportedCostUsd = maximumDefined(
      this.reportedCostUsd,
      metric(record.total_cost_usd),
      metric(record.cost_usd),
    );
    this.providerDurationMs = maximumDefined(
      this.providerDurationMs,
      metric(record.duration_ms),
      metric(record.durationMs),
    );
    this.providerApiDurationMs = maximumDefined(
      this.providerApiDurationMs,
      metric(record.duration_api_ms),
      metric(record.durationApiMs),
    );
    this.reportProviderMetadata(force);
  }

  private reportProviderMetadata(force: boolean): void {
    const providerTotal = (this.providerUsage.inputTokens ?? 0)
      + (this.providerUsage.outputTokens ?? 0);
    const hasReportedUsage = Object.values(this.providerUsage)
      .some((value) => value !== undefined);
    const hasReportedCost = this.reportedCostUsd !== undefined;
    if (!hasReportedUsage && !hasReportedCost) return;
    if (
      !force
      && this.lastReportedTokenTotal >= 0
      && providerTotal - this.lastReportedTokenTotal < TOKEN_REPORT_STEP
      && !hasReportedCost
    ) return;
    this.lastReportedTokenTotal = providerTotal;
    this.emit(
      "receiving",
      hasReportedCost
        ? "Provider usage and monetary cost metadata updated."
        : "Provider-reported token usage updated.",
    );
  }

  private tokenUsageSnapshot(): GenerationTokenUsageV1 {
    const providerInput = this.providerUsage.inputTokens;
    const providerOutput = this.providerUsage.outputTokens;
    const estimatedOutput = this.responseCharacters === 0
      ? 0
      : Math.max(1, Math.ceil(this.responseCharacters / 4));
    const inputTokens = providerInput ?? this.estimatedInputTokens;
    const outputTokens = providerOutput ?? estimatedOutput;
    const source: GenerationTokenUsageSourceV1 = providerInput !== undefined
      && providerOutput !== undefined
      ? "provider-reported"
      : providerInput === undefined && providerOutput === undefined
        ? "local-estimate"
        : "mixed";
    const cachedInputTokens = boundedSubset(
      this.providerUsage.cachedInputTokens,
      inputTokens,
    );
    const cacheWriteInputTokens = boundedSubset(
      this.providerUsage.cacheWriteInputTokens,
      inputTokens,
    );
    const reasoningTokens = boundedSubset(
      this.providerUsage.reasoningTokens,
      outputTokens,
    );
    return {
      inputTokens,
      outputTokens,
      source,
      inputEstimateExcludesMedia: providerInput === undefined && this.includesMedia,
      ...(cachedInputTokens === undefined
        ? {}
        : { cachedInputTokens }),
      ...(cacheWriteInputTokens === undefined
        ? {}
        : { cacheWriteInputTokens }),
      ...(reasoningTokens === undefined
        ? {}
        : { reasoningTokens }),
    };
  }

  private emit(phase: CliActivityPhase, message: string): void {
    const telemetry = this.telemetry();
    const key = `${phase}\u0000${message}\u0000${JSON.stringify(telemetry.tokenUsage)}\u0000${telemetry.reportedCostUsd ?? ""}`;
    if (key === this.lastEventKey) return;
    this.lastEventKey = key;
    const event: CliActivityEvent = {
      occurredAt: new Date().toISOString(),
      provider: this.provider,
      phase,
      message,
      attempt: this.attempt,
      telemetry,
    };
    try {
      this.listener(event);
    } catch {
      // A UI observer must never interrupt, extend, or invalidate a CLI job.
    }
  }
}

function claudeTokenUsage(
  usage: Readonly<Record<string, unknown>>,
): ProviderTokenUsage {
  const directInput = tokenMetric(usage.input_tokens, usage.inputTokens);
  const cacheRead = tokenMetric(
    usage.cache_read_input_tokens,
    usage.cached_input_tokens,
    usage.cachedInputTokens,
  );
  const cacheWrite = tokenMetric(
    usage.cache_creation_input_tokens,
    usage.cache_write_input_tokens,
    usage.cacheWriteInputTokens,
  );
  const inputTokens = directInput === undefined && cacheRead === undefined && cacheWrite === undefined
    ? undefined
    : (directInput ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0);
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...optionalToken("outputTokens", tokenMetric(usage.output_tokens, usage.outputTokens)),
    ...optionalToken("cachedInputTokens", cacheRead),
    ...optionalToken("cacheWriteInputTokens", cacheWrite),
    ...optionalToken(
      "reasoningTokens",
      tokenMetric(usage.reasoning_tokens, usage.thinking_tokens, usage.reasoningTokens),
    ),
  };
}

function genericTokenUsage(
  usage: Readonly<Record<string, unknown>>,
): ProviderTokenUsage {
  const inputDetails = firstPresentRecord(
    usage.input_tokens_details,
    usage.inputTokensDetails,
  );
  const outputDetails = firstPresentRecord(
    usage.output_tokens_details,
    usage.outputTokensDetails,
  );
  return {
    ...optionalToken(
      "inputTokens",
      tokenMetric(
        usage.input_tokens,
        usage.prompt_tokens,
        usage.inputTokens,
        usage.promptTokenCount,
      ),
    ),
    ...optionalToken(
      "outputTokens",
      tokenMetric(
        usage.output_tokens,
        usage.completion_tokens,
        usage.outputTokens,
        usage.candidatesTokenCount,
      ),
    ),
    ...optionalToken(
      "cachedInputTokens",
      tokenMetric(
        usage.cached_input_tokens,
        usage.cache_read_input_tokens,
        usage.cachedInputTokens,
        usage.cachedContentTokenCount,
        inputDetails.cached_tokens,
        inputDetails.cachedTokens,
      ),
    ),
    ...optionalToken(
      "cacheWriteInputTokens",
      tokenMetric(usage.cache_creation_input_tokens, usage.cache_write_input_tokens),
    ),
    ...optionalToken(
      "reasoningTokens",
      tokenMetric(
        usage.reasoning_tokens,
        usage.thinking_tokens,
        usage.thoughtsTokenCount,
        outputDetails.reasoning_tokens,
        outputDetails.reasoningTokens,
      ),
    ),
  };
}

function mergeProviderUsage(
  previous: ProviderTokenUsage,
  next: ProviderTokenUsage,
): ProviderTokenUsage {
  return {
    ...mergeToken("inputTokens", previous, next),
    ...mergeToken("outputTokens", previous, next),
    ...mergeToken("cachedInputTokens", previous, next),
    ...mergeToken("cacheWriteInputTokens", previous, next),
    ...mergeToken("reasoningTokens", previous, next),
  };
}

function mergeToken(
  field: keyof ProviderTokenUsage,
  previous: ProviderTokenUsage,
  next: ProviderTokenUsage,
): Partial<ProviderTokenUsage> {
  const value = maximumDefined(previous[field], next[field]);
  return value === undefined ? {} : { [field]: value };
}

function optionalToken(
  field: keyof ProviderTokenUsage,
  value: number | undefined,
): Partial<ProviderTokenUsage> {
  return value === undefined ? {} : { [field]: value };
}

function tokenMetric(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  }
  return undefined;
}

function metric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function maximumDefined(...values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length === 0 ? undefined : Math.max(...present);
}

export function publishCliActivity(
  listener: CliActivityListener | undefined,
  provider: ProviderId,
  phase: CliActivityPhase,
  message: string,
  attempt?: 1 | 2,
): void {
  if (listener === undefined) return;
  const event: CliActivityEvent = {
    occurredAt: new Date().toISOString(),
    provider,
    phase,
    message,
    ...(attempt === undefined ? {} : { attempt }),
  };
  try {
    listener(event);
  } catch {
    // Activity reporting is best-effort and cannot control provider execution.
  }
}

function providerLabel(provider: ProviderId): string {
  if (provider === "codex") return "Codex";
  return provider === "claude" ? "Claude" : "agy";
}

function safeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/u.test(trimmed)) return null;
  if (
    /^[A-Za-z]:\//u.test(trimmed)
    || trimmed.startsWith("/")
    || /(?:^|[/._-])\.\.(?:$|[/._-])/u.test(trimmed)
    || /(?:^|\/)(?:users|home|appdata|onedrive|\.obsidian)(?:\/|$)/iu.test(trimmed)
  ) return null;
  return trimmed;
}

function boundedSubset(value: number | undefined, total: number): number | undefined {
  return value !== undefined && value <= total ? value : undefined;
}

function serializedLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {};
}

function firstPresentRecord(...values: unknown[]): Readonly<Record<string, unknown>> {
  for (const value of values) {
    const record = recordValue(value);
    if (Object.keys(record).length > 0) return record;
  }
  return {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
