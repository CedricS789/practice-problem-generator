import type {
  CliJobFileSystem,
  CliJobWorkspace,
  CliActivityListener,
  CliProcessRunner,
  CliProviderAdapter,
  DetectedModelCatalog,
  DetectedProviderModel,
  DurableProcessHandle,
  DurableProcessRun,
  NeutralMedia,
  ProcessRunResult,
  ProviderCapabilities,
  ProviderDetection,
  ProviderId,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from "./contracts";
import { CliProviderError, normalizeUnknownError } from "./errors";
import { parseProviderOutput } from "./parse";
import type { ReasoningEffortV1 } from "../model";
import { modelIdProblem } from "../model-selection";
import { DEFAULT_AI_TIMEOUT_MS } from "../settings-values";
import { CliActivityDecoder, publishCliActivity } from "./activity";

export const DEFAULT_GENERATION_TIMEOUT_MS = DEFAULT_AI_TIMEOUT_MS;
export const GENERATION_RECOVERY_CONTEXT_FILENAME = "generation-context.json";
const DETECTION_TIMEOUT_MS = 10_000;
const MODEL_CATALOG_TIMEOUT_MS = 10_000;
const MODEL_CATALOG_CACHE_MS = 10 * 60 * 1_000;

export interface PreparedInvocation {
  readonly args: readonly string[];
  readonly stdin: string;
}

export type ProviderDetectionScheduler = <T>(
  task: (signal: AbortSignal) => Promise<T>,
  callerSignal?: AbortSignal,
) => Promise<T>;

export abstract class BaseCliProviderAdapter implements CliProviderAdapter {
  abstract readonly id: ProviderId;
  abstract readonly label: string;
  abstract readonly executable: string;

  protected readonly runner: CliProcessRunner;
  protected readonly jobFileSystem: CliJobFileSystem;
  private detectionScheduler: ProviderDetectionScheduler | undefined;
  private modelCatalogCache: {
    readonly version: string;
    readonly expiresAt: number;
    readonly catalog: DetectedModelCatalog;
  } | undefined;

  constructor(runner: CliProcessRunner, jobFileSystem: CliJobFileSystem) {
    this.runner = runner;
    this.jobFileSystem = jobFileSystem;
  }

  abstract capabilities(): ProviderCapabilities;

  protected abstract discoverModels(
    signal?: AbortSignal,
  ): Promise<DetectedModelCatalog>;

  /** Installed by the provider layer so even direct adapter detection obeys it. */
  configureDetectionScheduler(scheduler: ProviderDetectionScheduler): void {
    this.detectionScheduler = scheduler;
  }

  protected abstract prepareInvocation(
    workspace: CliJobWorkspace,
    schemaPath: string,
    schemaJson: string,
    media: readonly NeutralMedia[],
    prompt: string,
    model: string,
    reasoningEffort: ReasoningEffortV1,
    timeoutMs: number,
  ): PreparedInvocation | Promise<PreparedInvocation>;

  async detect(signal?: AbortSignal): Promise<ProviderDetection> {
    if (this.detectionScheduler !== undefined) {
      return await this.detectionScheduler(
        async (jobSignal) => await this.detectDirect(jobSignal),
        signal,
      );
    }
    return await this.detectDirect(signal);
  }

  private async detectDirect(signal?: AbortSignal): Promise<ProviderDetection> {
    try {
      const result = await this.runner.run({
        executable: this.executable,
        args: ["--version"],
        cwd: ".",
        stdin: "",
        timeoutMs: DETECTION_TIMEOUT_MS,
        ...(signal === undefined ? {} : { signal }),
      });
      if (result.exitCode !== 0) {
        return {
          id: this.id,
          available: false,
          capabilities: this.capabilities(),
          models: [],
          detail: conciseFailure(result),
        };
      }
      const version = (result.stdout || result.stderr).trim().split(/\r?\n/u)[0];
      let models: readonly DetectedProviderModel[] = [];
      let modelCatalogDetail: string | undefined;
      try {
        const versionKey = version ?? "";
        const cached = this.modelCatalogCache;
        const catalog = cached !== undefined
          && cached.version === versionKey
          && cached.expiresAt > Date.now()
          ? cached.catalog
          : await this.discoverModels(signal);
        models = catalog.models;
        modelCatalogDetail = catalog.detail;
        this.modelCatalogCache = {
          version: versionKey,
          expiresAt: Date.now() + MODEL_CATALOG_CACHE_MS,
          catalog,
        };
      } catch (error) {
        const normalized = normalizeUnknownError(error, this.label);
        if (normalized.code === "cancelled") throw normalized;
        modelCatalogDetail = normalized.message;
      }
      return {
        id: this.id,
        available: true,
        capabilities: this.capabilities(),
        models,
        ...(version === undefined || version.length === 0 ? {} : { version }),
        ...(modelCatalogDetail === undefined ? {} : { modelCatalogDetail }),
      };
    } catch (error) {
      const normalized = normalizeUnknownError(error, this.label);
      if (normalized.code === "cancelled") throw normalized;
      return {
        id: this.id,
        available: false,
        capabilities: this.capabilities(),
        models: [],
        detail: normalized.message,
      };
    }
  }

  /** Runs a prompt-free, locally scoped catalog command with a short deadline. */
  protected async runModelCatalog(
    args: readonly string[],
    signal?: AbortSignal,
  ): Promise<ProcessRunResult> {
    const result = await this.runner.run({
      executable: this.executable,
      args,
      cwd: ".",
      stdin: "",
      timeoutMs: MODEL_CATALOG_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    });
    if (result.exitCode !== 0) {
      throw new CliProviderError(
        "process-failed",
        `${this.label}'s model catalog is temporarily unavailable.`,
        { provider: this.id },
      );
    }
    return result;
  }

  async generate<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResult<T>> {
    if (request.model !== undefined && modelIdProblem(request.model) !== null) {
      throw new CliProviderError(
        "unsupported-capability",
        "The selected model identifier is invalid.",
        { provider: this.id },
      );
    }
    if (
      request.reasoningEffort !== undefined &&
      !this.capabilities().reasoningEfforts.includes(request.reasoningEffort)
    ) {
      throw new CliProviderError(
        "unsupported-capability",
        `${this.label} does not support the selected reasoning effort.`,
        { provider: this.id },
      );
    }
    if (
      (request.media?.length ?? 0) > 0
      && this.capabilities().vision !== "supported"
      && request.recovery?.mode !== "resume"
    ) {
      throw new CliProviderError(
        "unsupported-capability",
        `${this.label} vision is not enabled. Choose Codex or Claude for image occlusion.`,
        { provider: this.id },
      );
    }

    let workspace: CliJobWorkspace | undefined;
    let primaryError: CliProviderError | undefined;
    let completed = false;
    let recoveryHandle = request.recovery?.mode === "resume"
      ? request.recovery.handle
      : undefined;
    const recoveryReady = request.recovery?.mode === "start"
      ? request.recovery.onReady
      : undefined;
    try {
      publishCliActivity(
        request.onActivity,
        this.id,
        "preparing",
        "Preparing an isolated AI job.",
      );
      if (request.recovery?.mode === "resume") {
        if (this.jobFileSystem.openRecovery === undefined) {
          throw new CliProviderError(
            "unsupported-capability",
            `${this.label} recovery is unavailable in this runtime.`,
            { provider: this.id },
          );
        }
        workspace = await this.jobFileSystem.openRecovery(
          request.recovery.handle,
        );
      } else {
        workspace = await this.jobFileSystem.create();
      }
      if (request.recovery?.mode === "start") {
        await workspace.writeText(
          GENERATION_RECOVERY_CONTEXT_FILENAME,
          request.recovery.context,
        );
      }
      const schemaJson = JSON.stringify(request.schema);
      const resuming = request.recovery?.mode === "resume";
      if (
        resuming
        && (workspace.resolveExisting === undefined || workspace.openMedia === undefined)
      ) {
        throw new CliProviderError(
          "unsupported-capability",
          `${this.label} recovery cannot safely reopen its isolated inputs in this runtime.`,
          { provider: this.id },
        );
      }
      // Never overwrite schema or media while the detached provider may still
      // be reading them. Resume reopens the exact neutral files already used
      // by the original invocation.
      const schemaPath = resuming
        ? await workspace.resolveExisting!("schema.json")
        : await workspace.writeText("schema.json", schemaJson);
      const media = resuming
        ? await workspace.openMedia!(request.media ?? [])
        : await workspace.copyMedia(request.media ?? []);
      let prompt = appendNeutralMediaManifest(
        request.prompt,
        media.map((item) => item.filename),
      );
      let priorFailure: CliProviderError | undefined;
      let priorOutput = "";
      const timeoutMs = request.timeoutMs ?? DEFAULT_GENERATION_TIMEOUT_MS;
      const deadline = Date.now() + timeoutMs;

      for (const attempt of [1, 2] as const) {
        if (attempt === 2) {
          prompt = createRepairPrompt(prompt, priorOutput, priorFailure);
          publishCliActivity(
            request.onActivity,
            this.id,
            "repairing",
            "The first response did not validate; requesting one structured repair.",
            attempt,
          );
        }

        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          throw new CliProviderError(
            "timeout",
            `${this.label} did not finish within ${timeoutMs} ms.`,
            { provider: this.id },
          );
        }
        const invocation = request.recovery?.mode === "resume" && attempt === 1
          ? { args: [], stdin: "" }
          : await this.prepareInvocation(
              workspace,
              schemaPath,
              schemaJson,
              media,
              prompt,
              request.model ?? "",
              request.reasoningEffort ?? "medium",
              remainingMs,
            );
        publishCliActivity(
          request.onActivity,
          this.id,
          "running",
          `${this.label} is processing the approved source.`,
          attempt,
        );
        const durable = request.recovery === undefined
          ? undefined
          : request.recovery.mode === "resume" && attempt === 1
            ? {
                mode: "resume",
                handle: request.recovery.handle,
              } satisfies DurableProcessRun
            : {
                mode: "start",
                jobId: request.recovery.mode === "start"
                  ? request.recovery.jobId
                  : request.recovery.handle.jobId,
                attempt,
                ...(recoveryHandle === undefined ? {} : { handle: recoveryHandle }),
                ...(request.recovery.mode !== "start" || attempt !== 1
                  ? {}
                  : {
                      onReady: async (handle: DurableProcessHandle): Promise<void> => {
                        recoveryHandle = handle;
                        await recoveryReady?.(handle);
                      },
                    }),
              } satisfies DurableProcessRun;
        const result = await this.runInvocation(
          workspace,
          invocation,
          remainingMs,
          request.signal,
          request.onActivity,
          attempt,
          durable,
        );
        recoveryHandle = result.recoveryHandle ?? recoveryHandle;
        const actualAttempt = result.durableAttempt ?? attempt;
        priorOutput = result.stdout;

        try {
          publishCliActivity(
            request.onActivity,
            this.id,
            "validating",
            "Validating the structured response locally.",
            actualAttempt,
          );
          const parsed = parseProviderOutput(result.stdout, request.validate);
          publishCliActivity(
            request.onActivity,
            this.id,
            "completed",
            "The structured response passed local validation.",
            actualAttempt,
          );
          completed = true;
          return {
            provider: this.id,
            value: parsed.value,
            attempts: actualAttempt,
            ...(recoveryHandle === undefined ? {} : { recoveryHandle }),
          };
        } catch (error) {
          const normalized = normalizeUnknownError(error, this.label);
          if (
            actualAttempt === 1 &&
            (normalized.code === "malformed-output" ||
              normalized.code === "schema-validation")
          ) {
            priorFailure = normalized;
            continue;
          }
          throw normalized;
        }
      }

      throw new CliProviderError(
        "schema-validation",
        `${this.label} could not produce valid structured output.`,
        { provider: this.id },
      );
    } catch (error) {
      primaryError = normalizeUnknownError(error, this.label);
      if (primaryError.code === "detached") throw primaryError;
      publishCliActivity(
        request.onActivity,
        this.id,
        primaryError.code === "cancelled" ? "cancelled" : "failed",
        primaryError.code === "cancelled"
          ? "The AI job was cancelled."
          : "The AI job stopped before producing a valid result.",
      );
      throw primaryError;
    } finally {
      const preserveRecoveryWorkspace = request.recovery !== undefined
        && (
          completed
          || (
            primaryError !== undefined
            && primaryError.code !== "cancelled"
            && primaryError.code !== "timeout"
          )
        );
      if (workspace !== undefined && !preserveRecoveryWorkspace) {
        try {
          await workspace.cleanup();
        } catch (cleanupError) {
          publishCliActivity(
            request.onActivity,
            this.id,
            "failed",
            "The isolated job could not be cleaned up safely.",
          );
          // eslint-disable-next-line no-unsafe-finally -- A leaked job can contain submitted material, so cleanup failure must win.
          throw new CliProviderError(
            "workspace-error",
            "Practice Problem Generator could not remove its isolated temporary job.",
            {
              provider: this.id,
              ...(primaryError === undefined
                ? {}
                : {
                    detail: `The job also failed with ${primaryError.code}: ${primaryError.message}`,
                  }),
              cause: cleanupError,
            },
          );
        }
      }
    }
  }

  protected async runInvocation(
    workspace: CliJobWorkspace,
    invocation: PreparedInvocation,
    timeoutMs: number,
    signal?: AbortSignal,
    onActivity?: CliActivityListener,
    attempt: 1 | 2 = 1,
    durable?: DurableProcessRun,
  ): Promise<ProcessRunResult> {
    const decoder = onActivity === undefined
      ? undefined
      : new CliActivityDecoder(this.id, attempt, onActivity);
    let streamedOutput = false;
    let result: ProcessRunResult;
    try {
      result = await this.runner.run({
        executable: this.executable,
        args: invocation.args,
        cwd: workspace.absolutePath,
        stdin: invocation.stdin,
        timeoutMs,
        ...(signal === undefined ? {} : { signal }),
        ...(durable === undefined ? {} : { durable }),
        ...(decoder === undefined
          ? {}
          : {
              onOutput: (event): void => {
                streamedOutput = true;
                decoder.push(event);
              },
            }),
      });
      if (decoder !== undefined && !streamedOutput) {
        decoder.push({ stream: "stdout", text: result.stdout });
        decoder.push({ stream: "stderr", text: result.stderr });
      }
    } finally {
      decoder?.finish();
    }

    if (result.exitCode !== 0) {
      throw new CliProviderError(
        "process-failed",
        `${this.label} exited without returning a structured result.`,
        {
          provider: this.id,
          detail: conciseFailure(result),
        },
      );
    }
    return result;
  }
}

export function appendNeutralMediaManifest(
  prompt: string,
  neutralFilenames: readonly string[],
): string {
  if (neutralFilenames.length === 0) return prompt;
  const list = neutralFilenames.map((filename) => `- ${filename}`).join("\n");
  return `${prompt}\n\nThe only attached visual media are neutral copies in the isolated job directory:\n${list}\nUse only these copies when analyzing visuals.`;
}

function createRepairPrompt(
  prompt: string,
  priorOutput: string,
  failure: CliProviderError | undefined,
): string {
  const reason = failure?.detail ?? failure?.message ?? "invalid structured output";
  const boundedOutput = priorOutput.slice(0, 40_000);
  return `${prompt}\n\nYour previous response was rejected locally (${reason}). Return a corrected response that conforms exactly to the supplied JSON Schema. Do not add prose or Markdown fences.\n\nPrevious response:\n${boundedOutput}`;
}

function conciseFailure(result: ProcessRunResult): string {
  const detail = (result.stderr || result.stdout).trim();
  return detail.length === 0
    ? `Process exited with code ${result.exitCode}.`
    : detail.slice(0, 4_000);
}
