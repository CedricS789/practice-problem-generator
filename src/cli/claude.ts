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
import { CLAUDE_REASONING_EFFORTS } from "../reasoning";

const CAPABILITIES: ProviderCapabilities = {
  text: true,
  structuredOutput: true,
  sandboxed: true,
  vision: "supported",
  reasoningEfforts: CLAUDE_REASONING_EFFORTS,
};

const INSTALLED_HELP_MODEL_ALIASES = [
  {
    id: "fable",
    label: "Claude Fable (latest)",
    description: "Stable alias for the latest Claude Fable model supported by the installed CLI.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: CLAUDE_REASONING_EFFORTS,
  },
  {
    id: "opus",
    label: "Claude Opus (latest)",
    description: "Stable alias for the latest Claude Opus model supported by the installed CLI.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: CLAUDE_REASONING_EFFORTS,
  },
  {
    id: "sonnet",
    label: "Claude Sonnet (latest)",
    description: "Stable alias for the latest Claude Sonnet model supported by the installed CLI.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: CLAUDE_REASONING_EFFORTS,
  },
] as const satisfies readonly DetectedProviderModel[];

export class ClaudeCliProviderAdapter extends BaseCliProviderAdapter {
  readonly id = "claude" as const;
  readonly label = "Claude";
  readonly executable: string;

  constructor(
    runner: CliProcessRunner,
    jobFileSystem: CliJobFileSystem,
    executable = "claude",
  ) {
    super(runner, jobFileSystem);
    this.executable = executable;
  }

  capabilities(): ProviderCapabilities {
    return CAPABILITIES;
  }

  protected async discoverModels(
    _signal?: AbortSignal,
  ): Promise<DetectedModelCatalog> {
    // The installed CLI's own --help documents these aliases. Claude does not
    // expose a reliable prompt-free catalog command, so detection launches no
    // additional child process.
    return await Promise.resolve({ models: INSTALLED_HELP_MODEL_ALIASES });
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
  return INSTALLED_HELP_MODEL_ALIASES;
}
