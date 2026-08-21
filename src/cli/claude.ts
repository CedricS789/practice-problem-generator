import { BaseCliProviderAdapter, type PreparedInvocation } from "./base-adapter";
import type {
  CliJobFileSystem,
  CliJobWorkspace,
  CliProcessRunner,
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

  protected prepareInvocation(
    _workspace: CliJobWorkspace,
    _schemaPath: string,
    schemaJson: string,
    media: readonly NeutralMedia[],
    prompt: string,
    model: string,
    reasoningEffort: ReasoningEffortV1,
  ): PreparedInvocation {
    const args = [
      "--print",
      "--output-format",
      "json",
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
