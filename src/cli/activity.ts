import type {
  CliActivityEvent,
  CliActivityListener,
  CliActivityPhase,
  ProcessOutputEvent,
  ProviderId,
} from "./contracts";

const RECEIVE_REPORT_STEP = 512;
const MAX_PENDING_LINE_CHARACTERS = 256_000;

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

  constructor(
    private readonly provider: ProviderId,
    private readonly attempt: 1 | 2,
    private readonly listener: CliActivityListener,
  ) {}

  push(event: ProcessOutputEvent): void {
    const combined = this.buffers[event.stream] + event.text;
    const lines = combined.split(/\r?\n/u);
    this.buffers[event.stream] = lines.pop() ?? "";
    if (this.buffers[event.stream].length > MAX_PENDING_LINE_CHARACTERS) {
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
      this.processAssistantMessage(recordValue(record.message));
      return;
    }
    if (type === "result") {
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
      const model = safeIdentifier(recordValue(event.message).model);
      this.emit(
        "reasoning",
        model === null
          ? `${provider} started reasoning.`
          : `${provider} started reasoning with ${model}.`,
      );
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
    for (const item of message.content) {
      if (!isRecord(item)) continue;
      if (stringValue(item.type) === "text") {
        this.reportAbsoluteResponseSize(stringValue(item.text).length);
      } else if (stringValue(item.type) === "tool_use" && item.input !== undefined) {
        this.reportAbsoluteResponseSize(serializedLength(item.input));
      }
    }
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

  private emit(phase: CliActivityPhase, message: string): void {
    const key = `${phase}\u0000${message}`;
    if (key === this.lastEventKey) return;
    this.lastEventKey = key;
    const event: CliActivityEvent = {
      occurredAt: new Date().toISOString(),
      provider: this.provider,
      phase,
      message,
      attempt: this.attempt,
    };
    try {
      this.listener(event);
    } catch {
      // A UI observer must never interrupt, extend, or invalidate a CLI job.
    }
  }
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
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/u.test(trimmed) ? trimmed : null;
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

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
