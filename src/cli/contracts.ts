import type { ReasoningEffortV1 } from "../model";
import type {
  GenerationAttemptTelemetryV1,
  GenerationTelemetryV1,
} from "../generation-telemetry";

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
  /** Safe token/cost/timing metadata only; never raw provider content. */
  readonly telemetry?: GenerationAttemptTelemetryV1;
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

/**
 * A model choice discovered locally from an installed provider CLI. Only
 * display-safe catalog metadata is retained; provider prompts, paths, and
 * configuration are deliberately excluded.
 */
export interface DetectedProviderModel {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly defaultReasoningEffort?: ReasoningEffortV1;
  readonly supportedReasoningEfforts?: readonly ReasoningEffortV1[];
}

export interface DetectedModelCatalog {
  readonly models: readonly DetectedProviderModel[];
  readonly detail?: string;
}

export interface ProviderDetection {
  readonly id: ProviderId;
  readonly available: boolean;
  readonly capabilities: ProviderCapabilities;
  readonly models: readonly DetectedProviderModel[];
  readonly version?: string;
  readonly detail?: string;
  /** A non-fatal explanation when an installed provider's catalog is unavailable. */
  readonly modelCatalogDetail?: string;
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
  /**
   * Desktop-only crash recovery. The approved source stays in an isolated
   * operating-system temporary directory and the provider keeps its existing
   * ephemeral/no-persistence mode.
   */
  readonly recovery?: StructuredGenerationRecovery;
}

export interface StructuredGenerationResult<T> {
  readonly provider: ProviderId;
  readonly value: T;
  readonly attempts: 1 | 2;
  readonly telemetry?: GenerationTelemetryV1;
  readonly recoveryHandle?: DurableProcessHandle;
}

export interface DurableProcessHandle {
  readonly version: 1;
  readonly jobId: string;
  readonly workspacePath: string;
  readonly startedAt: string;
}

export type StructuredGenerationRecovery =
  | {
      readonly mode: "start";
      readonly jobId: string;
      readonly context: string;
      readonly onReady: (handle: DurableProcessHandle) => Promise<void>;
    }
  | {
      readonly mode: "resume";
      readonly handle: DurableProcessHandle;
    };

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
  readonly durable?: DurableProcessRun;
}

export type DurableProcessRun =
  | {
      readonly mode: "start";
      readonly jobId: string;
      readonly attempt: 1 | 2;
      readonly handle?: DurableProcessHandle;
      readonly onReady?: (handle: DurableProcessHandle) => Promise<void>;
    }
  | {
      readonly mode: "resume";
      readonly handle: DurableProcessHandle;
    };

export interface ProcessOutputEvent {
  readonly stream: "stdout" | "stderr";
  readonly text: string;
}

export interface ProcessRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durableAttempt?: 1 | 2;
  readonly recoveryHandle?: DurableProcessHandle;
  readonly telemetry?: GenerationAttemptTelemetryV1;
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
  /** Read a small neutral recovery sidecar; returns undefined when absent. */
  readText?(filename: string): Promise<string | undefined>;
  writeBinary(filename: string, content: Uint8Array): Promise<string>;
  copyMedia(media: readonly MediaInput[]): Promise<readonly NeutralMedia[]>;
  /** Resolve an already-created recovery file without rewriting it. */
  resolveExisting?(filename: string): Promise<string>;
  /** Reopen neutral recovery media without copying over a running CLI's input. */
  openMedia?(media: readonly MediaInput[]): Promise<readonly NeutralMedia[]>;
  cleanup(): Promise<void>;
}

export interface CliJobFileSystem {
  create(): Promise<CliJobWorkspace>;
  openRecovery?(handle: DurableProcessHandle): Promise<CliJobWorkspace>;
}
