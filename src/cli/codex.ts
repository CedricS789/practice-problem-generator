import { BaseCliProviderAdapter, type PreparedInvocation } from "./base-adapter";
import type {
  CliJobFileSystem,
  CliJobWorkspace,
  CliProcessRunner,
  DetectedModelCatalog,
  DetectedProviderModel,
  NeutralMedia,
  ProviderCapabilities,
} from "./contracts";
import { CliProviderError } from "./errors";
import type { ReasoningEffortV1 } from "../model";
import { modelIdProblem } from "../model-selection";
import { CODEX_REASONING_EFFORTS } from "../reasoning";

const CAPABILITIES: ProviderCapabilities = {
  text: true,
  structuredOutput: true,
  sandboxed: true,
  vision: "supported",
  reasoningEfforts: CODEX_REASONING_EFFORTS,
};
const MAX_DETECTED_MODELS = 200;

export class CodexCliProviderAdapter extends BaseCliProviderAdapter {
  readonly id = "codex" as const;
  readonly label = "Codex";
  readonly executable: string;

  constructor(
    runner: CliProcessRunner,
    jobFileSystem: CliJobFileSystem,
    executable = "codex",
  ) {
    super(runner, jobFileSystem);
    this.executable = executable;
  }

  capabilities(): ProviderCapabilities {
    return CAPABILITIES;
  }

  protected async discoverModels(
    signal?: AbortSignal,
  ): Promise<DetectedModelCatalog> {
    const result = await this.runModelCatalog(
      ["debug", "models", "--bundled"],
      signal,
    );
    try {
      return parseCodexModelCatalogResult(result.stdout);
    } catch (error) {
      throw new CliProviderError(
        "malformed-output",
        "Codex's installed model catalog could not be read.",
        { provider: this.id, cause: error },
      );
    }
  }

  protected prepareInvocation(
    workspace: CliJobWorkspace,
    schemaPath: string,
    _schemaJson: string,
    media: readonly NeutralMedia[],
    prompt: string,
    model: string,
    reasoningEffort: ReasoningEffortV1,
    _timeoutMs: number,
  ): PreparedInvocation {
    const args: string[] = [
      "--ask-for-approval",
      "never",
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--config",
      `model_reasoning_effort="${reasoningEffort}"`,
      "--ignore-rules",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--json",
      "--cd",
      workspace.absolutePath,
      "--output-schema",
      schemaPath,
    ];

    if (model.length > 0) args.push("--model", model);

    for (const item of media) args.push("--image", item.absolutePath);
    args.push("-");
    return { args, stdin: prompt };
  }
}

export function parseCodexModelCatalog(
  output: string,
): readonly DetectedProviderModel[] {
  return parseCodexModelCatalogResult(output).models;
}

function parseCodexModelCatalogResult(output: string): DetectedModelCatalog {
  const parsed: unknown = JSON.parse(output);
  if (!isRecord(parsed) || !Array.isArray(parsed.models)) {
    throw new Error("Expected a models array.");
  }

  const seen = new Set<string>();
  const models: DetectedProviderModel[] = [];
  let truncated = false;
  for (const value of parsed.models) {
    if (!isRecord(value) || value.visibility !== "list") continue;
    const id = boundedText(value.slug, 120);
    if (id === undefined || modelIdProblem(id) !== null || seen.has(id)) continue;
    if (models.length >= MAX_DETECTED_MODELS) {
      truncated = true;
      break;
    }

    const supportedReasoningEfforts = Array.isArray(value.supported_reasoning_levels)
      ? value.supported_reasoning_levels
          .map((level) => isRecord(level) ? level.effort : undefined)
          .filter(isCodexReasoningEffort)
      : [];
    const defaultReasoningEffort = isCodexReasoningEffort(value.default_reasoning_level)
      ? value.default_reasoning_level
      : undefined;
    const label = boundedText(value.display_name, 160) ?? id;
    const description = boundedText(value.description, 500);
    seen.add(id);
    models.push({
      id,
      label,
      ...(description === undefined ? {} : { description }),
      ...(defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort }),
      ...(supportedReasoningEfforts.length === 0
        ? {}
        : { supportedReasoningEfforts }),
    });
  }
  return {
    models,
    ...(truncated
      ? { detail: `Model catalog limited to the first ${MAX_DETECTED_MODELS} safe entries.` }
      : {}),
  };
}

function isCodexReasoningEffort(
  value: unknown,
): value is (typeof CODEX_REASONING_EFFORTS)[number] {
  return typeof value === "string"
    && CODEX_REASONING_EFFORTS.includes(
      value as (typeof CODEX_REASONING_EFFORTS)[number],
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length === 0 ? undefined : text.slice(0, maximumLength);
}
