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
import type { ReasoningEffortV1 } from "../model";
import {
  CLAUDE_REASONING_EFFORTS,
  isReasoningEffort,
} from "../reasoning";
import { modelIdProblem } from "../model-selection";

const DEFAULT_CLAUDE_REASONING_EFFORTS = CLAUDE_REASONING_EFFORTS.filter(
  (effort) => effort !== "ultracode",
);

const DEFAULT_CLAUDE_MODEL_ALIASES = ["fable", "opus", "sonnet"] as const;

export class ClaudeCliProviderAdapter extends BaseCliProviderAdapter {
  readonly id = "claude" as const;
  readonly label = "Claude";
  readonly executable: string;
  private detectedReasoningEfforts: readonly ReasoningEffortV1[] =
    DEFAULT_CLAUDE_REASONING_EFFORTS;

  constructor(
    runner: CliProcessRunner,
    jobFileSystem: CliJobFileSystem,
    executable = "claude",
  ) {
    super(runner, jobFileSystem);
    this.executable = executable;
  }

  capabilities(): ProviderCapabilities {
    return {
      text: true,
      structuredOutput: true,
      sandboxed: true,
      vision: "supported",
      reasoningEfforts: this.detectedReasoningEfforts,
    };
  }

  protected async discoverModels(
    signal?: AbortSignal,
  ): Promise<DetectedModelCatalog> {
    // Claude has no prompt-free model catalog. Its local --help is authoritative
    // for rolling aliases and effort levels, so capability drift is detected
    // without sending a prompt or creating a provider session.
    const result = await this.runModelCatalog(["--help"], signal);
    const parsed = parseClaudeInstalledHelp(result.stdout || result.stderr);
    this.detectedReasoningEfforts = parsed.reasoningEfforts;
    return { models: parsed.models };
  }

  protected prepareInvocation(
    _workspace: CliJobWorkspace,
    _schemaPath: string,
    schemaJson: string,
    media: readonly NeutralMedia[],
    prompt: string,
    model: string,
    reasoningEffort: ReasoningEffortV1,
    _timeoutMs: number,
  ): PreparedInvocation {
    const args = [
      "--print",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--json-schema",
      schemaJson,
      "--no-session-persistence",
      "--effort",
      reasoningEffort,
      "--safe-mode",
      "--no-chrome",
      "--disable-slash-commands",
      "--permission-mode",
      "dontAsk",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--tools",
      media.length === 0 ? "" : "Read",
    ];
    if (model.length > 0) args.push("--model", model);
    if (media.length > 0) args.push("--allowedTools", "Read(./**)");
    return { args, stdin: prompt };
  }
}

export function claudeInstalledModelAliases(): readonly DetectedProviderModel[] {
  return claudeModels(DEFAULT_CLAUDE_MODEL_ALIASES, DEFAULT_CLAUDE_REASONING_EFFORTS);
}

export function parseClaudeInstalledHelp(help: string): {
  readonly models: readonly DetectedProviderModel[];
  readonly reasoningEfforts: readonly ReasoningEffortV1[];
} {
  const effortClause = /--effort[\s\S]{0,300}?\(([^)]+)\)/u.exec(help)?.[1] ?? "";
  const detectedEfforts = effortClause
    .split(",")
    .map((effort) => effort.trim())
    .filter(isReasoningEffort);
  const reasoningEfforts = CLAUDE_REASONING_EFFORTS.filter((effort) =>
    detectedEfforts.includes(effort));

  const modelSection = help.split("--model <model>")[1]?.slice(0, 700) ?? "";
  const aliasClause = modelSection.split("or a model's full name")[0] ?? "";
  const aliases: string[] = [];
  for (const match of aliasClause.matchAll(/'([A-Za-z][A-Za-z0-9_-]{0,30})'/gu)) {
    const alias = match[1];
    if (alias !== undefined && modelIdProblem(alias) === null && !aliases.includes(alias)) {
      aliases.push(alias);
    }
  }

  const effectiveEfforts = reasoningEfforts.length > 0
    ? reasoningEfforts
    : DEFAULT_CLAUDE_REASONING_EFFORTS;
  return {
    models: claudeModels(
      aliases.length > 0 ? aliases : DEFAULT_CLAUDE_MODEL_ALIASES,
      effectiveEfforts,
    ),
    reasoningEfforts: effectiveEfforts,
  };
}

function claudeModels(
  aliases: readonly string[],
  reasoningEfforts: readonly ReasoningEffortV1[],
): readonly DetectedProviderModel[] {
  return aliases.map((id) => ({
    id,
    label: `Claude ${id.charAt(0).toUpperCase()}${id.slice(1)} (latest)`,
    description: `Rolling alias supported by the installed Claude CLI.`,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: reasoningEfforts,
  }));
}
