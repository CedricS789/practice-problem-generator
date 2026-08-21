import { BaseCliProviderAdapter, type PreparedInvocation } from "./base-adapter";
import type {
  CliJobFileSystem,
  CliJobWorkspace,
  CliProcessRunner,
  NeutralMedia,
  ProviderCapabilities,
} from "./contracts";
import { CliProviderError, normalizeUnknownError } from "./errors";
import { parseProviderOutput } from "./parse";
import type { ReasoningEffortV1 } from "../model";
import { AGY_REASONING_EFFORTS } from "../reasoning";
import { DEFAULT_AGY_MODEL } from "../model-selection";

const PROBE_TIMEOUT_MS = 90_000;
const RED_PIXEL_PNG = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0,
  1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 1, 115, 82,
  71, 66, 0, 174, 206, 28, 233, 0, 0, 0, 4, 103, 65, 77, 65, 0, 0, 177,
  143, 11, 252, 97, 5, 0, 0, 0, 9, 112, 72, 89, 115, 0, 0, 14, 195, 0, 0,
  14, 195, 1, 199, 111, 168, 100, 0, 0, 0, 13, 73, 68, 65, 84, 24, 87, 99,
  248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 166, 92, 155, 93, 0, 0, 0, 0,
  73, 69, 78, 68, 174, 66, 96, 130,
]);

export interface AgyVisionProbeResult {
  readonly passed: boolean;
  readonly detail: string;
}

export class AgyCliProviderAdapter extends BaseCliProviderAdapter {
  readonly id = "agy" as const;
  readonly label = "agy";
  readonly executable: string;
  private visionProbePassed = false;
  private visionProbeAttempted = false;

  constructor(
    runner: CliProcessRunner,
    jobFileSystem: CliJobFileSystem,
    executable = "agy",
  ) {
    super(runner, jobFileSystem);
    this.executable = executable;
  }

  capabilities(): ProviderCapabilities {
    return {
      text: true,
      structuredOutput: true,
      sandboxed: true,
      reasoningEfforts: AGY_REASONING_EFFORTS,
      vision: this.visionProbePassed
        ? "supported"
        : this.visionProbeAttempted
          ? "unsupported"
          : "probe-required",
    };
  }

  protected async prepareInvocation(
    workspace: CliJobWorkspace,
    schemaPath: string,
    _schemaJson: string,
    _media: readonly NeutralMedia[],
    prompt: string,
    model: string,
    reasoningEffort: ReasoningEffortV1,
  ): Promise<PreparedInvocation> {
    await workspace.writeText("briefing.txt", prompt);
    return {
      args: [
        "--print",
        "Read briefing.txt in the current isolated directory, follow it exactly, and return only the JSON object required by --json-schema.",
        "--output-format",
        "json",
        "--json-schema",
        schemaPath,
        "--sandbox",
        "--model",
        model.length > 0 ? model : DEFAULT_AGY_MODEL,
        "--mode",
        "accept-edits",
        "--effort",
        reasoningEffort,
        "--print-timeout",
        "4m30s",
        "--disable-slash-commands",
        "--new-project",
        "--dangerously-skip-permissions",
      ],
      stdin: "",
    };
  }

  /**
   * Explicitly performs a synthetic, headless visual test. No authored note or
   * vault media is used. Vision remains disabled unless this method succeeds.
   */
  async probeVision(signal?: AbortSignal): Promise<AgyVisionProbeResult> {
    let workspace: CliJobWorkspace | undefined;
    this.visionProbePassed = false;
    this.visionProbeAttempted = true;
    try {
      workspace = await this.jobFileSystem.create();
      const mediaPath = await workspace.writeBinary(
        "media-001.png",
        RED_PIXEL_PNG,
      );
      const schema = {
        type: "object",
        additionalProperties: false,
        properties: { observedColor: { type: "string" } },
        required: ["observedColor"],
      } as const;
      const schemaPath = await workspace.writeText(
        "schema.json",
        JSON.stringify(schema),
      );
      const invocation = await this.prepareInvocation(
        workspace,
        schemaPath,
        JSON.stringify(schema),
        [
          {
            absolutePath: mediaPath,
            filename: "media-001.png",
            mimeType: "image/png",
          },
        ],
        "Inspect media-001.png in this isolated directory. Return its single pixel's color in observedColor. Return JSON only.",
        DEFAULT_AGY_MODEL,
        "low",
      );
      const result = await this.runInvocation(
        workspace,
        invocation,
        PROBE_TIMEOUT_MS,
        signal,
      );
      const parsed = parseProviderOutput<{ observedColor: string }>(
        result.stdout,
        (value) => ({
          valid:
            typeof value === "object" &&
            value !== null &&
            "observedColor" in value &&
            typeof value.observedColor === "string",
        }),
      );
      const observed = parsed.value.observedColor.trim().toLowerCase();
      this.visionProbePassed = observed === "red" || observed === "#ff0000";
      return {
        passed: this.visionProbePassed,
        detail: this.visionProbePassed
          ? "agy identified the synthetic image in headless sandbox mode."
          : `agy returned an unexpected color (${observed || "empty"}).`,
      };
    } catch (error) {
      const normalized = normalizeUnknownError(error, this.label);
      if (normalized.code === "cancelled") {
        this.visionProbeAttempted = false;
        throw normalized;
      }
      return { passed: false, detail: normalized.message };
    } finally {
      if (workspace !== undefined) {
        try {
          await workspace.cleanup();
        } catch (error) {
          this.visionProbePassed = false;
          // eslint-disable-next-line no-unsafe-finally -- Cleanup failure is the actionable result even when the probe itself succeeded.
          throw new CliProviderError(
            "workspace-error",
            "The synthetic agy probe completed, but its temporary job could not be removed.",
            { provider: this.id, cause: error },
          );
        }
      }
    }
  }
}
