import { BaseCliProviderAdapter, type PreparedInvocation } from "./base-adapter";
import type {
  CliJobFileSystem,
  CliJobWorkspace,
  CliProcessRunner,
  NeutralMedia,
  ProviderCapabilities,
} from "./contracts";
import type { ReasoningEffortV1 } from "../model";
import { CODEX_REASONING_EFFORTS } from "../reasoning";

const CAPABILITIES: ProviderCapabilities = {
  text: true,
  structuredOutput: true,
  sandboxed: true,
  vision: "supported",
  reasoningEfforts: CODEX_REASONING_EFFORTS,
};

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
