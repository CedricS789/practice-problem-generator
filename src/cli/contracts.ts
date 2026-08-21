import type { ReasoningEffortV1 } from "../model";

export type ProviderId = "codex" | "claude" | "agy";

export type CliActivityPhase =
  | "preparing"
  | "running"
  | "reasoning"
  | "tool"
  | "receiving"
  | "validating"
  | "repairing"
  | "completed"
  | "cancelled"
  | "failed";

/**
 * A deliberately bounded, provider-neutral progress update. Messages are
 * generated locally from event metadata; raw prompts, paths, structured
 * answers, and private reasoning content are never placed in this contract.
 */
export interface CliActivityEvent {
  readonly occurredAt: string;
  readonly provider: ProviderId;
  readonly phase: CliActivityPhase;
  readonly message: string;
  readonly attempt?: 1 | 2;
}

export type CliActivityListener = (event: CliActivityEvent) => void;

export type CliJobKind =
  | "generation"
  | "answer-review"
  | "provider-detection"
  | "provider-probe";

export interface CliJobIdentity {
  readonly id: string;
  readonly kind: CliJobKind;
  readonly provider: ProviderId;
}

export type VisionCapabilityState =
  | "supported"
  | "unsupported"
  | "probe-required";

export interface ProviderCapabilities {
  readonly text: true;
  readonly structuredOutput: true;
  readonly sandboxed: true;
  readonly vision: VisionCapabilityState;
  readonly reasoningEfforts: readonly ReasoningEffortV1[];
}

export interface ProviderDetection {
  readonly id: ProviderId;
  readonly available: boolean;
  readonly capabilities: ProviderCapabilities;
  readonly version?: string;
  readonly detail?: string;
}

export type MediaInput =
  | {
      /** Preferred: bytes obtained through Obsidian's Vault.readBinary API. */
      readonly bytes: ArrayBuffer | Uint8Array;
      readonly mimeType: string;
      readonly filePath?: never;
    }
  | {
      /** Desktop-only alternate for synthetic frames and explicit local tools. */
      readonly filePath: string;
      readonly mimeType?: string;
      readonly bytes?: never;
    };

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors?: readonly string[];
}

export type SourceValidationResult<T> =
  | { readonly ok: true; readonly value: T; readonly issues: readonly unknown[] }
  | { readonly ok: false; readonly issues: readonly unknown[] };

export type StructuredOutputValidator<T> = (
  value: unknown,
) => ValidationResult | SourceValidationResult<T> | boolean;

export interface StructuredGenerationRequest<T> {
  readonly prompt: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly validate: StructuredOutputValidator<T>;
  readonly model?: string;
  readonly reasoningEffort?: ReasoningEffortV1;
  readonly media?: readonly MediaInput[];
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly onActivity?: CliActivityListener;
}

export interface StructuredGenerationResult<T> {
  readonly provider: ProviderId;
  readonly value: T;
  readonly attempts: 1 | 2;
}

export interface CliProviderAdapter {
  readonly id: ProviderId;
  readonly label: string;
  readonly executable: string;

  capabilities(): ProviderCapabilities;
  detect(signal?: AbortSignal): Promise<ProviderDetection>;
  generate<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResult<T>>;
}

export interface ProcessRunRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stdin: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly onOutput?: (event: ProcessOutputEvent) => void;
}

export interface ProcessOutputEvent {
  readonly stream: "stdout" | "stderr";
  readonly text: string;
}

export interface ProcessRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface CliProcessRunner {
  run(request: ProcessRunRequest): Promise<ProcessRunResult>;
}

export interface NeutralMedia {
  readonly absolutePath: string;
  readonly filename: string;
  readonly mimeType?: string;
}

export interface CliJobWorkspace {
  readonly absolutePath: string;
  writeText(filename: string, content: string): Promise<string>;
  writeBinary(filename: string, content: Uint8Array): Promise<string>;
  copyMedia(media: readonly MediaInput[]): Promise<readonly NeutralMedia[]>;
  cleanup(): Promise<void>;
}

export interface CliJobFileSystem {
  create(): Promise<CliJobWorkspace>;
}
