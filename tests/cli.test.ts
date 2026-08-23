import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BaseCliProviderAdapter, type PreparedInvocation } from "../src/cli/base-adapter";
import {
  AgyCliProviderAdapter,
  ClaudeCliProviderAdapter,
  CliJobCoordinator,
  CliProviderError,
  CodexCliProviderAdapter,
  DEFAULT_GENERATION_TIMEOUT_MS,
  DEFAULT_PROVIDER_ID,
  DesktopJobFileSystem,
  DesktopProcessRunner,
  MAX_GENERATION_MEDIA_INPUTS,
  MAX_GENERATION_PROMPT_CHARACTERS,
  appendNeutralMediaManifest,
  cancelDurableRecovery,
  createCliProviderLayer,
  formatCliErrorForUi,
  parseProviderOutput,
  removeDurableRecovery,
  resolveSpawnTarget,
  type CliJobFileSystem,
  type CliJobWorkspace,
  type CliProcessRunner,
  type CliProviderAdapter,
  type DurableProcessHandle,
  type MediaInput,
  type NeutralMedia,
  type ProcessRunRequest,
  type ProcessRunResult,
  type ProviderCapabilities,
  type ProviderDetection,
  type StructuredGenerationRequest,
  type StructuredGenerationResult,
} from "../src/cli/index";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
} as const;

function validateOk(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof value.ok === "boolean"
  );
}

class SyntheticRecoverableAdapter extends BaseCliProviderAdapter {
  readonly id = "codex" as const;
  readonly label = "Synthetic";
  readonly executable = process.execPath;
  prepareCalls = 0;

  capabilities(): ProviderCapabilities {
    return {
      text: true,
      structuredOutput: true,
      sandboxed: true,
      vision: "supported",
      reasoningEfforts: ["low", "medium", "high", "xhigh"],
    };
  }

  protected async discoverModels(): Promise<{ readonly models: readonly [] }> {
    return await Promise.resolve({ models: [] });
  }

  protected prepareInvocation(): PreparedInvocation {
    this.prepareCalls += 1;
    return {
      args: [
        "-e",
        "setTimeout(()=>process.stdout.write(JSON.stringify({ok:true})),700);",
      ],
      stdin: "",
    };
  }
}

class QueueRunner implements CliProcessRunner {
  readonly requests: ProcessRunRequest[] = [];
  readonly queue: Array<
    | ProcessRunResult
    | Error
    | ((request: ProcessRunRequest) => Promise<ProcessRunResult>)
  >;

  constructor(
    queue: Array<
      | ProcessRunResult
      | Error
      | ((request: ProcessRunRequest) => Promise<ProcessRunResult>)
    >,
  ) {
    this.queue = queue;
  }

  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    this.requests.push(request);
    const item = this.queue.shift();
    if (item === undefined) throw new Error("Unexpected runner invocation");
    if (item instanceof Error) throw item;
    if (typeof item === "function") return await item(request);
    return item;
  }
}

class FakeJobFileSystem implements CliJobFileSystem {
  readonly jobs: FakeJobWorkspace[] = [];
  readonly failCleanup: boolean;

  constructor(failCleanup = false) {
    this.failCleanup = failCleanup;
  }

  async create(): Promise<CliJobWorkspace> {
    const job = new FakeJobWorkspace(
      `/neutral/job-${this.jobs.length + 1}`,
      this.failCleanup,
    );
    this.jobs.push(job);
    return job;
  }
}

class FakeJobWorkspace implements CliJobWorkspace {
  readonly absolutePath: string;
  readonly writtenText = new Map<string, string>();
  readonly writtenBinary = new Map<string, Uint8Array>();
  readonly copiedSources: string[] = [];
  cleanupCalls = 0;
  readonly failCleanup: boolean;

  constructor(absolutePath: string, failCleanup: boolean) {
    this.absolutePath = absolutePath;
    this.failCleanup = failCleanup;
  }

  async writeText(filename: string, content: string): Promise<string> {
    this.writtenText.set(filename, content);
    return `${this.absolutePath}/${filename}`;
  }

  async writeBinary(filename: string, content: Uint8Array): Promise<string> {
    this.writtenBinary.set(filename, content);
    return `${this.absolutePath}/${filename}`;
  }

  async copyMedia(media: readonly MediaInput[]): Promise<readonly NeutralMedia[]> {
    return media.map((item, index) => {
      if (item.filePath !== undefined) this.copiedSources.push(item.filePath);
      const filename = `media-${String(index + 1).padStart(3, "0")}.png`;
      if (item.bytes !== undefined) {
        this.writtenBinary.set(
          filename,
          item.bytes instanceof Uint8Array
            ? item.bytes
            : new Uint8Array(item.bytes),
        );
      }
      return item.mimeType === undefined
        ? { absolutePath: `${this.absolutePath}/${filename}`, filename }
        : {
            absolutePath: `${this.absolutePath}/${filename}`,
            filename,
            mimeType: item.mimeType,
          };
    });
  }

  async cleanup(): Promise<void> {
    this.cleanupCalls += 1;
    if (this.failCleanup) throw new Error("synthetic cleanup failure");
  }
}

test("provider factory defaults to Codex and reports explicit capabilities", () => {
  const layer = createCliProviderLayer({
    runner: new QueueRunner([]),
    jobFileSystem: new FakeJobFileSystem(),
  });
  assert.equal(DEFAULT_PROVIDER_ID, "codex");
  assert.deepEqual(layer.adapters.codex.capabilities(), {
    text: true,
    structuredOutput: true,
    sandboxed: true,
    vision: "supported",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
  });
  assert.deepEqual(layer.adapters.claude.capabilities().reasoningEfforts, [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
  assert.deepEqual(layer.adapters.agy.capabilities().reasoningEfforts, [
    "low",
    "medium",
    "high",
  ]);
  assert.equal(layer.adapters.claude.capabilities().vision, "supported");
  assert.equal(layer.adapters.agy.capabilities().vision, "probe-required");
});

test("an adapter rejects unsupported reasoning without switching providers", async () => {
  const runner = new QueueRunner([]);
  const layer = createCliProviderLayer({
    runner,
    jobFileSystem: new FakeJobFileSystem(),
  });

  await assert.rejects(
    layer.adapters.agy.generate({
      prompt: "Synthetic review.",
      schema: SCHEMA,
      validate: validateOk,
      reasoningEffort: "max",
    }),
    (error: unknown) =>
      error instanceof CliProviderError &&
      error.code === "unsupported-capability" &&
      error.provider === "agy",
  );
  assert.equal(runner.requests.length, 0);
});

test("binary media enters the job without any source-vault path", async () => {
  const runner = new QueueRunner([
    { stdout: '{"ok":true}', stderr: "", exitCode: 0 },
  ]);
  const jobs = new FakeJobFileSystem();
  const adapter = new CodexCliProviderAdapter(runner, jobs);
  const binary = Uint8Array.from([137, 80, 78, 71]);

  await adapter.generate({
    prompt: "Synthetic visual only.",
    schema: SCHEMA,
    validate: validateOk,
    media: [{ bytes: binary, mimeType: "image/png" }],
  });

  const request = runner.requests[0];
  assert.ok(request);
  assert.deepEqual(jobs.jobs[0]?.copiedSources, []);
  assert.deepEqual(jobs.jobs[0]?.writtenBinary.get("media-001.png"), binary);
  assert.deepEqual(request.args.slice(-3), [
    "--image",
    "/neutral/job-1/media-001.png",
    "-",
  ]);
  assert.equal(request.stdin.includes("private-vault"), false);
});

test("provider factory honors configured executable paths without shell parsing", () => {
  const layer = createCliProviderLayer({
    runner: new QueueRunner([]),
    jobFileSystem: new FakeJobFileSystem(),
    executables: {
      codex: "C:/Tools/codex.exe",
      claude: "C:/Tools/claude.exe",
      agy: "C:/Tools/agy.exe",
    },
  });
  assert.equal(layer.adapters.codex.executable, "C:/Tools/codex.exe");
  assert.equal(layer.adapters.claude.executable, "C:/Tools/claude.exe");
  assert.equal(layer.adapters.agy.executable, "C:/Tools/agy.exe");
});

test("neutral media preview helper matches the adapter payload", () => {
  assert.equal(appendNeutralMediaManifest("Source", []), "Source");
  assert.equal(
    appendNeutralMediaManifest("Source", ["media-001.png", "media-002.jpg"]),
    "Source\n\nThe only attached visual media are neutral copies in the isolated job directory:\n- media-001.png\n- media-002.jpg\nUse only these copies when analyzing visuals.",
  );
});

test("Codex uses fixed safe arguments, stdin, neutral media, and cleanup", async () => {
  const runner = new QueueRunner([
    { stdout: '{"ok":true}', stderr: "", exitCode: 0 },
  ]);
  const jobs = new FakeJobFileSystem();
  const adapter = new CodexCliProviderAdapter(runner, jobs);
  const authoredPath = "C:/private-vault/Notes/private diagram.png";
  const prompt = 'Source text with $(whoami), `cmd`, quotes, and ; rm -rf.';

  const result = await adapter.generate<{ ok: boolean }>({
    prompt,
    schema: SCHEMA,
    validate: validateOk,
    model: "gpt-5.6",
    reasoningEffort: "ultra",
    media: [{ filePath: authoredPath, mimeType: "image/png" }],
  });

  assert.deepEqual(result, {
    provider: "codex",
    value: { ok: true },
    attempts: 1,
  });
  const request = runner.requests[0];
  assert.ok(request);
  assert.equal(request.executable, "codex");
  assert.deepEqual(request.args.slice(0, 18), [
    "--ask-for-approval",
    "never",
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--config",
    'model_reasoning_effort="ultra"',
    "--ignore-rules",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--color",
    "never",
    "--json",
    "--cd",
    "/neutral/job-1",
    "--output-schema",
    "/neutral/job-1/schema.json",
  ]);
  assert.deepEqual(request.args.slice(18), [
    "--model",
    "gpt-5.6",
    "--image",
    "/neutral/job-1/media-001.png",
    "-",
  ]);
  assert.equal(request.args.some((arg) => arg.includes(prompt)), false);
  assert.equal(request.args.some((arg) => arg.includes("private-vault")), false);
  assert.match(request.stdin, /Source text with \$\(whoami\)/u);
  assert.match(request.stdin, /media-001\.png/u);
  assert.deepEqual(jobs.jobs[0]?.copiedSources, [authoredPath]);
  assert.equal(jobs.jobs[0]?.cleanupCalls, 1);
});

test("Claude uses print, no-persistence, safe mode, schema, and scoped Read", async () => {
  const runner = new QueueRunner([
    {
      stdout: '{"structured_output":{"ok":true}}',
      stderr: "",
      exitCode: 0,
    },
  ]);
  const jobs = new FakeJobFileSystem();
  const adapter = new ClaudeCliProviderAdapter(runner, jobs);
  await adapter.generate({
    prompt: "Inspect the attached visual.",
    schema: SCHEMA,
    validate: validateOk,
    model: "claude-opus-4-6",
    reasoningEffort: "max",
    media: [{ filePath: "D:/secret/original.png", mimeType: "image/png" }],
  });

  const request = runner.requests[0];
  assert.ok(request);
  assert.equal(request.executable, "claude");
  assert.ok(request.args.includes("--print"));
  assert.equal(
    request.args[request.args.indexOf("--output-format") + 1],
    "stream-json",
  );
  assert.ok(request.args.includes("--include-partial-messages"));
  assert.ok(request.args.includes("--verbose"));
  assert.ok(request.args.includes("--no-session-persistence"));
  assert.equal(
    request.args[request.args.indexOf("--effort") + 1],
    "max",
  );
  assert.equal(
    request.args[request.args.indexOf("--model") + 1],
    "claude-opus-4-6",
  );
  assert.ok(request.args.includes("--safe-mode"));
  assert.ok(request.args.includes("--no-chrome"));
  assert.ok(request.args.includes("dontAsk"));
  assert.ok(request.args.includes("Read"));
  assert.ok(request.args.includes("Read(./**)"));
  assert.equal(request.args.some((arg) => arg.includes("D:/secret")), false);
  assert.equal(request.stdin.includes("D:/secret"), false);
});

test("agy blocks authored media until its explicit synthetic probe passes", async () => {
  const runner = new QueueRunner([
    {
      stdout: '{"result":"{\\"observedColor\\":\\"red\\"}"}',
      stderr: "",
      exitCode: 0,
    },
    { stdout: '{"result":"{\\"ok\\":true}"}', stderr: "", exitCode: 0 },
  ]);
  const jobs = new FakeJobFileSystem();
  const adapter = new AgyCliProviderAdapter(runner, jobs);

  await assert.rejects(
    adapter.generate({
      prompt: "visual",
      schema: SCHEMA,
      validate: validateOk,
      media: [{ filePath: "C:/source.png" }],
    }),
    (error: unknown) =>
      error instanceof CliProviderError &&
      error.code === "unsupported-capability",
  );
  assert.equal(runner.requests.length, 0);

  const probe = await adapter.probeVision();
  assert.equal(probe.passed, true);
  assert.equal(adapter.capabilities().vision, "supported");
  assert.equal(jobs.jobs[0]?.writtenBinary.has("media-001.png"), true);
  assert.match(jobs.jobs[0]?.writtenText.get("briefing.txt") ?? "", /media-001\.png/u);
  assert.equal(runner.requests[0]?.stdin, "");
  assert.deepEqual(runner.requests[0]?.args.slice(-2), [
    "--print",
    "Use view_file only to read briefing.txt in the current isolated directory, follow it exactly, and return only the JSON object required by --json-schema. Do not run commands, open a browser, use the network, read any other file, or perform tool-based schema validation; the CLI and caller validate the result.",
  ]);
  assert.ok(runner.requests[0]?.args.includes("--sandbox"));
  assert.equal(runner.requests[0]?.args.includes("--dangerously-skip-permissions"), false);
  assert.ok(runner.requests[0]?.args.includes("--new-project"));
  assert.deepEqual(
    runner.requests[0]?.args.slice(
      (runner.requests[0]?.args.indexOf("--mode") ?? -1) + 1,
      (runner.requests[0]?.args.indexOf("--mode") ?? -1) + 2,
    ),
    ["accept-edits"],
  );
  assert.deepEqual(
    runner.requests[0]?.args.slice(
      (runner.requests[0]?.args.indexOf("--model") ?? -1) + 1,
      (runner.requests[0]?.args.indexOf("--model") ?? -1) + 2,
    ),
    ["gemini-3.6-flash-low"],
  );
  assert.equal(
    runner.requests[0]?.args[(runner.requests[0]?.args.indexOf("--effort") ?? -1) + 1],
    "low",
  );
  assert.equal(
    runner.requests[0]?.args[(runner.requests[0]?.args.indexOf("--print-timeout") ?? -1) + 1],
    "80s",
  );

  const result = await adapter.generate<{ ok: boolean }>({
    prompt: "visual",
    schema: SCHEMA,
    validate: validateOk,
    model: "gemini-3.7-flash-high",
    reasoningEffort: "high",
    media: [{ filePath: "C:/source.png", mimeType: "image/png" }],
  });
  assert.equal(result.value.ok, true);
  assert.equal(
    runner.requests[1]?.args[(runner.requests[1]?.args.indexOf("--effort") ?? -1) + 1],
    "high",
  );
  assert.equal(
    runner.requests[1]?.args[(runner.requests[1]?.args.indexOf("--model") ?? -1) + 1],
    "gemini-3.7-flash-high",
  );
  assert.equal(
    runner.requests[1]?.args[(runner.requests[1]?.args.indexOf("--output-format") ?? -1) + 1],
    "stream-json",
  );
  assert.equal(
    runner.requests[1]?.args[(runner.requests[1]?.args.indexOf("--print-timeout") ?? -1) + 1],
    "10790s",
  );
  assert.equal(jobs.jobs[0]?.cleanupCalls, 1);
  assert.equal(jobs.jobs[1]?.cleanupCalls, 1);
});

test("model identifiers are passed as one argument and invalid values fail before launch", async () => {
  const runner = new QueueRunner([
    { stdout: '{"ok":true}', stderr: "", exitCode: 0 },
  ]);
  const adapter = new CodexCliProviderAdapter(runner, new FakeJobFileSystem());
  await assert.rejects(
    adapter.generate({
      prompt: "Synthetic",
      schema: SCHEMA,
      validate: validateOk,
      model: "gpt-5.6; whoami",
    }),
    /model identifier is invalid/iu,
  );
  assert.equal(runner.requests.length, 0);
});

test("a failed agy probe leaves vision explicitly unsupported", async () => {
  const runner = new QueueRunner([
    {
      stdout: '{"response":"{\\"observedColor\\":\\"blue\\"}"}',
      stderr: "",
      exitCode: 0,
    },
  ]);
  const adapter = new AgyCliProviderAdapter(
    runner,
    new FakeJobFileSystem(),
  );
  const probe = await adapter.probeVision();
  assert.equal(probe.passed, false);
  assert.equal(adapter.capabilities().vision, "unsupported");
});

test("agy aligns an unpinned default to reasoning and rejects conflicting pinned variants", async () => {
  const runner = new QueueRunner([
    { stdout: '{"result":{"structured_output":{"ok":true}}}', stderr: "", exitCode: 0 },
  ]);
  const jobs = new FakeJobFileSystem();
  const adapter = new AgyCliProviderAdapter(runner, jobs);
  const result = await adapter.generate<{ ok: boolean }>({
    prompt: "Synthetic text only.",
    schema: SCHEMA,
    validate: validateOk,
    reasoningEffort: "medium",
  });
  assert.equal(result.value.ok, true);
  assert.equal(
    runner.requests[0]?.args[(runner.requests[0]?.args.indexOf("--model") ?? -1) + 1],
    "gemini-3.6-flash-medium",
  );

  await assert.rejects(
    adapter.generate({
      prompt: "Synthetic text only.",
      schema: SCHEMA,
      validate: validateOk,
      model: "gemini-3.6-flash-low",
      reasoningEffort: "high",
    }),
    (error: unknown) =>
      error instanceof CliProviderError
      && error.code === "unsupported-capability"
      && /pins low reasoning/u.test(error.message),
  );
  assert.equal(runner.requests.length, 1);
  assert.equal(jobs.jobs[1]?.cleanupCalls, 1);
});

test("malformed JSON receives exactly one schema-repair retry", async () => {
  const runner = new QueueRunner([
    { stdout: "not-json", stderr: "", exitCode: 0 },
    { stdout: '{"ok":true}', stderr: "", exitCode: 0 },
  ]);
  const jobs = new FakeJobFileSystem();
  const adapter = new CodexCliProviderAdapter(runner, jobs);
  const result = await adapter.generate<{ ok: boolean }>({
    prompt: "Generate.",
    schema: SCHEMA,
    validate: validateOk,
  });
  assert.equal(result.attempts, 2);
  assert.equal(runner.requests.length, 2);
  assert.match(runner.requests[1]?.stdin ?? "", /previous response was rejected/u);
  assert.match(runner.requests[1]?.stdin ?? "", /not-json/u);
  assert.equal(jobs.jobs[0]?.cleanupCalls, 1);
});

test("provider-declared terminal failures stop without a schema-repair call", async () => {
  const runner = new QueueRunner([{
    stdout: JSON.stringify({
      type: "turn.failed",
      error: { message: "synthetic provider failure" },
    }),
    stderr: "",
    exitCode: 0,
  }]);
  const jobs = new FakeJobFileSystem();
  const adapter = new CodexCliProviderAdapter(runner, jobs);
  await assert.rejects(
    adapter.generate({ prompt: "Generate.", schema: SCHEMA, validate: validateOk }),
    (error: unknown) =>
      error instanceof CliProviderError
      && error.code === "process-failed"
      && error.detail === "synthetic provider failure",
  );
  assert.equal(runner.requests.length, 1);
  assert.equal(jobs.jobs[0]?.cleanupCalls, 1);
});

test("an agy schema-error envelope with structured output receives one repair", async () => {
  const runner = new QueueRunner([
    {
      stdout: JSON.stringify({
        event: "result",
        result: {
          status: "ERROR",
          error: "invalid arguments",
          structured_output: { ok: "not-boolean" },
        },
      }),
      stderr: "",
      exitCode: 0,
    },
    {
      stdout: JSON.stringify({
        event: "result",
        result: { status: "SUCCESS", structured_output: { ok: true } },
      }),
      stderr: "",
      exitCode: 0,
    },
  ]);
  const adapter = new AgyCliProviderAdapter(runner, new FakeJobFileSystem());
  const result = await adapter.generate<{ ok: boolean }>({
    prompt: "Generate.",
    schema: SCHEMA,
    validate: validateOk,
  });
  assert.equal(result.attempts, 2);
  assert.equal(result.value.ok, true);
  assert.equal(runner.requests.length, 2);
});

test("oversized or unserializable generation inputs fail before job creation", async () => {
  const runner = new QueueRunner([]);
  const jobs = new FakeJobFileSystem();
  const adapter = new CodexCliProviderAdapter(runner, jobs);

  await assert.rejects(
    adapter.generate({
      prompt: "x".repeat(MAX_GENERATION_PROMPT_CHARACTERS + 1),
      schema: SCHEMA,
      validate: validateOk,
    }),
    /prompt exceeds/iu,
  );
  await assert.rejects(
    adapter.generate({
      prompt: "Synthetic",
      schema: { invalid: 1n },
      validate: validateOk,
    }),
    /not valid serializable JSON/iu,
  );
  await assert.rejects(
    adapter.generate({
      prompt: "Synthetic",
      schema: SCHEMA,
      validate: validateOk,
      media: Array.from(
        { length: MAX_GENERATION_MEDIA_INPUTS + 1 },
        () => ({ bytes: new Uint8Array(), mimeType: "image/png" }),
      ),
    }),
    /At most/iu,
  );
  assert.equal(runner.requests.length, 0);
  assert.equal(jobs.jobs.length, 0);
});

test("agy-style diagnostic lines before the final JSON envelope are tolerated", async () => {
  const runner = new QueueRunner([
    {
      stdout:
        'headless diagnostic\n{"status":"SUCCESS","response":"{\\"ok\\":true}"}\n',
      stderr: "",
      exitCode: 0,
    },
  ]);
  const adapter = new AgyCliProviderAdapter(
    runner,
    new FakeJobFileSystem(),
  );
  const result = await adapter.generate<{ ok: boolean }>({
    prompt: "Synthetic text only.",
    schema: SCHEMA,
    validate: validateOk,
  });
  assert.equal(result.value.ok, true);
  assert.equal(result.attempts, 1);
});

test("Codex and stream-json result records unwrap their final structured value", () => {
  const codex = parseProviderOutput<{ ok: boolean }>([
    '{"type":"thread.started","thread_id":"synthetic"}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"ok\\":true}"}}',
    '{"type":"turn.completed","usage":{"input_tokens":12}}',
  ].join("\n"), validateOk);
  assert.deepEqual(codex.value, { ok: true });

  const streamJson = parseProviderOutput<{ ok: boolean }>([
    '{"type":"system","subtype":"init","model":"synthetic"}',
    '{"type":"stream_event","event":{"type":"message_stop"}}',
    '{"type":"result","structured_output":{"ok":true}}',
  ].join("\n"), validateOk);
  assert.deepEqual(streamJson.value, { ok: true });

  const agyStream = parseProviderOutput<{ ok: boolean }>([
    '{"event":"init","init":{"model":"gemini-3.6-flash-medium"}}',
    '{"event":"step_update","step_update":{"state":"DONE","step_type":"agent_response","text_delta":"{\\"ok\\":true}"}}',
    '{"event":"result","result":{"status":"SUCCESS","response":"{\\"ok\\":true}","structured_output":{"ok":true}}}',
  ].join("\n"), validateOk);
  assert.deepEqual(agyStream.value, { ok: true });
});

test("the adapter defaults to three hours and streams safe activity observers", async () => {
  const output = [
    '{"type":"thread.started","thread_id":"private-thread-id"}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"type":"reasoning","text":"private reasoning"}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"ok\\":true}"}}',
    '{"type":"turn.completed"}',
  ].join("\n");
  const runner = new QueueRunner([
    async (request) => {
      request.onOutput?.({ stream: "stdout", text: output });
      return { stdout: output, stderr: "", exitCode: 0 };
    },
  ]);
  const messages: string[] = [];
  const phases: string[] = [];
  const adapter = new CodexCliProviderAdapter(runner, new FakeJobFileSystem());
  const result = await adapter.generate<{ ok: boolean }>({
    prompt: "Synthetic source",
    schema: SCHEMA,
    validate: validateOk,
    onActivity: (event) => {
      messages.push(event.message);
      phases.push(event.phase);
    },
  });
  assert.equal(result.value.ok, true);
  const processRequest = runner.requests[0];
  assert.ok(processRequest);
  assert.ok(processRequest.timeoutMs <= DEFAULT_GENERATION_TIMEOUT_MS);
  assert.ok(processRequest.timeoutMs > DEFAULT_GENERATION_TIMEOUT_MS - 1_000);
  for (const phase of ["preparing", "running", "reasoning", "receiving", "validating", "completed"]) {
    assert.ok(phases.includes(phase), `Missing activity phase: ${phase}`);
  }
  assert.doesNotMatch(messages.join("\n"), /private-thread-id|private reasoning/u);
});

test("the timeout budget covers the initial call and repair together", async () => {
  const runner = new QueueRunner([
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { stdout: "not-json", stderr: "", exitCode: 0 };
    },
  ]);
  const adapter = new CodexCliProviderAdapter(
    runner,
    new FakeJobFileSystem(),
  );
  await assert.rejects(
    adapter.generate({
      prompt: "Generate.",
      schema: SCHEMA,
      validate: validateOk,
      timeoutMs: 5,
    }),
    (error: unknown) =>
      error instanceof CliProviderError && error.code === "timeout",
  );
  assert.equal(runner.requests.length, 1);
});

test("a second invalid response fails closed and still cleans the job", async () => {
  const runner = new QueueRunner([
    { stdout: '{"ok":"yes"}', stderr: "", exitCode: 0 },
    { stdout: '{"ok":"still yes"}', stderr: "", exitCode: 0 },
  ]);
  const jobs = new FakeJobFileSystem();
  const adapter = new CodexCliProviderAdapter(runner, jobs);
  await assert.rejects(
    adapter.generate({ prompt: "Generate.", schema: SCHEMA, validate: validateOk }),
    (error: unknown) =>
      error instanceof CliProviderError && error.code === "schema-validation",
  );
  assert.equal(runner.requests.length, 2);
  assert.equal(jobs.jobs[0]?.cleanupCalls, 1);
});

test("non-zero CLI exits do not trigger schema repair", async () => {
  const runner = new QueueRunner([
    { stdout: "", stderr: "authentication failed", exitCode: 2 },
  ]);
  const jobs = new FakeJobFileSystem();
  const adapter = new ClaudeCliProviderAdapter(runner, jobs);
  await assert.rejects(
    adapter.generate({ prompt: "Generate.", schema: SCHEMA, validate: validateOk }),
    (error: unknown) =>
      error instanceof CliProviderError &&
      error.code === "process-failed" &&
      error.detail === "authentication failed",
  );
  assert.equal(runner.requests.length, 1);
  assert.equal(jobs.jobs[0]?.cleanupCalls, 1);
});

test("non-zero JSONL exits prefer the provider's terminal error over raw event output", async () => {
  const runner = new QueueRunner([{
    stdout: [
      '{"event":"init","init":{"cwd":"C:/neutral/job"}}',
      '{"event":"result","result":{"status":"ERROR","error":"synthetic schema is unsupported"}}',
    ].join("\n"),
    stderr: "",
    exitCode: 1,
  }]);
  const adapter = new AgyCliProviderAdapter(runner, new FakeJobFileSystem());
  await assert.rejects(
    adapter.generate({ prompt: "Generate.", schema: SCHEMA, validate: validateOk }),
    (error: unknown) =>
      error instanceof CliProviderError
      && error.code === "process-failed"
      && error.detail === "synthetic schema is unsupported",
  );
  assert.equal(runner.requests.length, 1);
});

test("Codex error envelopes preserve the actionable API reason", async () => {
  const runner = new QueueRunner([{
    stdout: JSON.stringify({
      type: "error",
      error: {
        type: "invalid_request_error",
        code: "invalid_json_schema",
        message: "Synthetic provider schema is unsupported.",
      },
      status: 400,
    }),
    stderr: "",
    exitCode: 1,
  }]);
  const adapter = new CodexCliProviderAdapter(runner, new FakeJobFileSystem());
  await assert.rejects(
    adapter.generate({ prompt: "Generate.", schema: SCHEMA, validate: validateOk }),
    (error: unknown) =>
      error instanceof CliProviderError
      && error.code === "process-failed"
      && error.detail === "Synthetic provider schema is unsupported. (invalid_json_schema)",
  );
});

test("provider error presentation is bounded, actionable, and path-safe", () => {
  const message = formatCliErrorForUi(
    new CliProviderError(
      "process-failed",
      "Codex exited without returning a structured result.",
      {
        provider: "codex",
        detail: JSON.stringify({
          error: {
            code: "invalid_json_schema",
            message: "Invalid schema in C:\\Users\\person\\AppData\\Local\\Temp\\practice-lab-job\\schema.json.",
          },
        }),
      },
    ),
    "Generation failed.",
  );
  assert.match(message, /Invalid schema/iu);
  assert.match(message, /update or reload the plugin/iu);
  assert.doesNotMatch(message, /Users\\person|practice-lab-job/iu);
  assert.ok(message.length < 1_000);
});

test("temporary-job cleanup failures surface instead of being hidden", async () => {
  const adapter = new CodexCliProviderAdapter(
    new QueueRunner([{ stdout: '{"ok":true}', stderr: "", exitCode: 0 }]),
    new FakeJobFileSystem(true),
  );
  await assert.rejects(
    adapter.generate<{ ok: boolean }>({
      prompt: "Generate.",
      schema: SCHEMA,
      validate: validateOk,
    }),
    (error: unknown) =>
      error instanceof CliProviderError && error.code === "workspace-error",
  );
});

test("missing executables are detected without throwing", async () => {
  const missing = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
  const adapter = new CodexCliProviderAdapter(
    new QueueRunner([missing]),
    new FakeJobFileSystem(),
  );
  const detection = await adapter.detect();
  assert.equal(detection.available, false);
  assert.match(detection.detail ?? "", /not found|not installed|PATH/iu);
});

test("provider detection preserves versions and capability state", async () => {
  const runner = new QueueRunner([
    { stdout: "codex-cli 0.146.0\n", stderr: "", exitCode: 0 },
    { stdout: '{"models":[]}', stderr: "", exitCode: 0 },
    { stdout: "2.1.220\n", stderr: "", exitCode: 0 },
    {
      stdout: "--effort <level> (low, medium, high, xhigh, max)\n--model <model> alias (e.g. 'fable', 'opus', or 'sonnet') or a model's full name\n",
      stderr: "",
      exitCode: 0,
    },
    { stdout: "agy version 1.1.11\n", stderr: "", exitCode: 0 },
    { stdout: "", stderr: "", exitCode: 0 },
  ]);
  const layer = createCliProviderLayer({
    runner,
    jobFileSystem: new FakeJobFileSystem(),
  });
  const detected = await layer.detectAll();
  assert.deepEqual(
    detected.map(({ id, available, version }) => ({ id, available, version })),
    [
      { id: "codex", available: true, version: "codex-cli 0.146.0" },
      { id: "claude", available: true, version: "2.1.220" },
      { id: "agy", available: true, version: "agy version 1.1.11" },
    ],
  );
});

test("provider refresh waits for an active review and never overlaps CLI children", async () => {
  let releaseReview!: () => void;
  let reportReviewStarted!: () => void;
  const reviewReleased = new Promise<void>((resolve) => {
    releaseReview = resolve;
  });
  const reviewStarted = new Promise<void>((resolve) => {
    reportReviewStarted = resolve;
  });
  const runner = new class implements CliProcessRunner {
    readonly requests: ProcessRunRequest[] = [];
    active = 0;
    maximumActive = 0;

    async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
      this.requests.push(request);
      this.active += 1;
      this.maximumActive = Math.max(this.maximumActive, this.active);
      try {
        if (request.args[0] === "synthetic-review") {
          reportReviewStarted();
          await reviewReleased;
          return { stdout: '{"ok":true}', stderr: "", exitCode: 0 };
        }
        if (request.args[0] === "debug") {
          assert.deepEqual(request.args, ["debug", "models", "--bundled"]);
          return { stdout: '{"models":[]}', stderr: "", exitCode: 0 };
        }
        if (request.args[0] === "models") {
          assert.deepEqual(request.args, ["models"]);
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        if (request.args[0] === "--help") {
          return {
            stdout: "--effort <level> (low, medium, high, xhigh, max)\n--model <model> alias (e.g. 'fable', 'opus', or 'sonnet') or a model's full name\n",
            stderr: "",
            exitCode: 0,
          };
        }
        assert.deepEqual(request.args, ["--version"]);
        return {
          stdout: `${request.executable} synthetic-version\n`,
          stderr: "",
          exitCode: 0,
        };
      } finally {
        this.active -= 1;
      }
    }
  }();
  const layer = createCliProviderLayer({
    runner,
    jobFileSystem: new FakeJobFileSystem(),
  });
  const ownedJobs: Array<{ id: string; kind: string; provider: string }> = [];
  layer.coordinator.subscribe((activeJob) => {
    if (activeJob !== undefined) ownedJobs.push({ ...activeJob });
  });

  const activeReview = layer.coordinator.runExclusive(
    "codex",
    async (signal) => await runner.run({
      executable: "codex",
      args: ["synthetic-review"],
      cwd: ".",
      stdin: "synthetic answer",
      signal,
      timeoutMs: 1_000,
    }),
    undefined,
    { id: "review-active", kind: "answer-review", provider: "codex" },
  );
  await reviewStarted;

  const refresh = layer.detectAll();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(runner.requests.length, 1, "refresh must wait for review ownership");
  assert.equal(runner.maximumActive, 1);

  releaseReview();
  await activeReview;
  const detections = await refresh;

  assert.equal(runner.maximumActive, 1);
  assert.deepEqual(
    detections.map((detection) => detection.id),
    ["codex", "claude", "agy"],
  );
  assert.deepEqual(
    runner.requests.slice(1).map((request) => request.executable),
    ["codex", "codex", "claude", "claude", "agy", "agy"],
  );
  assert.deepEqual(
    ownedJobs.map((job) => [job.kind, job.provider]),
    [
      ["answer-review", "codex"],
      ["provider-detection", "codex"],
      ["provider-detection", "claude"],
      ["provider-detection", "agy"],
    ],
  );
  assert.equal(new Set(ownedJobs.map((job) => job.id)).size, ownedJobs.length);
});

test("the synthetic vision probe also waits for active coordinator ownership", async () => {
  let releaseReview!: () => void;
  let reportReviewStarted!: () => void;
  const reviewReleased = new Promise<void>((resolve) => {
    releaseReview = resolve;
  });
  const reviewStarted = new Promise<void>((resolve) => {
    reportReviewStarted = resolve;
  });
  const runner = new class implements CliProcessRunner {
    active = 0;
    maximumActive = 0;
    invocations = 0;

    async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
      this.invocations += 1;
      this.active += 1;
      this.maximumActive = Math.max(this.maximumActive, this.active);
      try {
        if (request.args[0] === "synthetic-review") {
          reportReviewStarted();
          await reviewReleased;
          return { stdout: '{"ok":true}', stderr: "", exitCode: 0 };
        }
        return {
          stdout: '{"observedColor":"red"}',
          stderr: "",
          exitCode: 0,
        };
      } finally {
        this.active -= 1;
      }
    }
  }();
  const layer = createCliProviderLayer({
    runner,
    jobFileSystem: new FakeJobFileSystem(),
  });
  const kinds: string[] = [];
  layer.coordinator.subscribe((activeJob) => {
    if (activeJob !== undefined) kinds.push(activeJob.kind);
  });
  const activeReview = layer.coordinator.runExclusive(
    "codex",
    async (signal) => await runner.run({
      executable: "codex",
      args: ["synthetic-review"],
      cwd: ".",
      stdin: "synthetic answer",
      signal,
      timeoutMs: 1_000,
    }),
    undefined,
    { id: "review-before-probe", kind: "answer-review", provider: "codex" },
  );
  await reviewStarted;

  const probe = layer.probeAgyVision();
  await Promise.resolve();
  assert.equal(runner.invocations, 1);
  releaseReview();
  await activeReview;
  const result = await probe;

  assert.equal(result.passed, true);
  assert.equal(runner.maximumActive, 1);
  assert.deepEqual(kinds, ["answer-review", "provider-probe"]);
});

test("the coordinator allows one active job and cancels it", async () => {
  const coordinator = new CliJobCoordinator();
  let release: (() => void) | undefined;
  const adapter = new DeferredAdapter(() => {
    release?.();
  });
  const first = coordinator.generate(adapter, {
    prompt: "one",
    schema: SCHEMA,
    validate: validateOk,
  });
  assert.equal(coordinator.isBusy, true);
  assert.equal(coordinator.activeProviderId, "codex");

  await assert.rejects(
    coordinator.generate(adapter, {
      prompt: "two",
      schema: SCHEMA,
      validate: validateOk,
    }),
    (error: unknown) =>
      error instanceof CliProviderError && error.code === "busy",
  );

  const cancelled = new Promise<void>((resolve) => {
    release = resolve;
  });
  assert.equal(coordinator.cancel(), true);
  await cancelled;
  await assert.rejects(first, /cancelled/u);
  assert.equal(coordinator.isBusy, false);
  assert.equal(coordinator.cancel(), false);
});

test("DesktopProcessRunner normalizes timeout, cancellation, and ENOENT", async () => {
  const runner = new DesktopProcessRunner();
  const hangingArgs = ["-e", "setTimeout(() => {}, 10_000)"];

  await assert.rejects(
    runner.run({
      executable: process.execPath,
      args: hangingArgs,
      cwd: process.cwd(),
      stdin: "",
      timeoutMs: 150,
    }),
    (error: unknown) =>
      error instanceof CliProviderError && error.code === "timeout",
  );

  const controller = new AbortController();
  const cancelled = runner.run({
    executable: process.execPath,
    args: hangingArgs,
    cwd: process.cwd(),
    stdin: "",
    timeoutMs: 5_000,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(
    cancelled,
    (error: unknown) =>
      error instanceof CliProviderError && error.code === "cancelled",
  );

  await assert.rejects(
    runner.run({
      executable: `practice-lab-missing-${Date.now()}`,
      args: [],
      cwd: process.cwd(),
      stdin: "",
      timeoutMs: 1_000,
    }),
    (error: unknown) =>
      error instanceof CliProviderError && error.code === "missing-executable",
  );
});

test("Windows npm shims find Node outside a stale GUI PATH", {
  skip: process.platform !== "win32",
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "practice-lab-node-resolution-"));
  try {
    const shimDirectory = join(root, "npm");
    const entry = join(
      shimDirectory,
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    );
    const programFiles = join(root, "Program Files");
    const nodeExecutable = join(programFiles, "nodejs", "node.exe");
    mkdirSync(join(shimDirectory, "node_modules", "@openai", "codex", "bin"), {
      recursive: true,
    });
    mkdirSync(join(programFiles, "nodejs"), { recursive: true });
    writeFileSync(entry, "// synthetic Codex entry\n", "utf8");
    writeFileSync(nodeExecutable, "synthetic Node executable\n", "utf8");
    const shim = join(shimDirectory, "codex.cmd");
    writeFileSync(
      shim,
      '@ECHO off\r\n"%_prog%" "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n',
      "utf8",
    );

    const target = await resolveSpawnTarget(shim, {
      PATH: join(root, "System32"),
      ProgramFiles: programFiles,
    });

    assert.equal(target.executable, nodeExecutable);
    assert.deepEqual(target.prefixArgs, [entry]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("DesktopProcessRunner reports stdout and stderr incrementally", async () => {
  const runner = new DesktopProcessRunner();
  const output: Array<{ stream: string; text: string }> = [];
  const result = await runner.run({
    executable: process.execPath,
    args: [
      "-e",
      "process.stdout.write('first\\n');process.stderr.write('second\\n');",
    ],
    cwd: process.cwd(),
    stdin: "",
    timeoutMs: 5_000,
    onOutput: (event) => output.push(event),
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /first/u);
  assert.match(result.stderr, /second/u);
  assert.ok(output.some((event) => event.stream === "stdout" && event.text.includes("first")));
  assert.ok(output.some((event) => event.stream === "stderr" && event.text.includes("second")));
});

test("a durable CLI process survives detachment and resumes the exact output", async () => {
  const fileSystem = new DesktopJobFileSystem();
  const job = await fileSystem.create();
  const controller = new AbortController();
  let handle: DurableProcessHandle | undefined;
  const firstRunner = new DesktopProcessRunner();
  const initial = firstRunner.run({
    executable: process.execPath,
    args: [
      "-e",
      "process.stdout.write('started\\n');setTimeout(()=>{process.stdout.write('finished\\n');},700);",
    ],
    cwd: job.absolutePath,
    stdin: "",
    timeoutMs: 5_000,
    signal: controller.signal,
    durable: {
      mode: "start",
      jobId: "generation-00000000-0000-4000-8000-000000000001",
      attempt: 1,
      onReady: async (value) => {
        handle = value;
        await Promise.resolve();
      },
    },
  });
  while (handle === undefined) await new Promise((resolve) => setTimeout(resolve, 10));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const detach = new Error("Synthetic plugin unload");
  detach.name = "PracticeLabDetach";
  controller.abort(detach);
  await assert.rejects(
    initial,
    (error: unknown) =>
      error instanceof CliProviderError && error.code === "detached",
  );

  const resumedEvents: string[] = [];
  const resumed = await new DesktopProcessRunner().run({
    executable: "unused-after-reattach",
    args: [],
    cwd: handle.workspacePath,
    stdin: "",
    timeoutMs: 5_000,
    durable: { mode: "resume", handle },
    onOutput: (event) => resumedEvents.push(event.text),
  });
  assert.equal(resumed.exitCode, 0);
  assert.equal(resumed.durableAttempt, 1);
  assert.match(resumed.stdout, /started[\s\S]*finished/u);
  assert.match(resumedEvents.join(""), /finished/u);
  await job.cleanup();
});

test("structured generation reattaches without launching a replacement provider turn", async () => {
  const fileSystem = new DesktopJobFileSystem();
  const adapter = new SyntheticRecoverableAdapter(
    new DesktopProcessRunner(),
    fileSystem,
  );
  const controller = new AbortController();
  let handle: DurableProcessHandle | undefined;
  const initial = adapter.generate({
    prompt: "Synthetic approved prompt",
    schema: SCHEMA,
    validate: validateOk,
    signal: controller.signal,
    timeoutMs: 5_000,
    recovery: {
      mode: "start",
      jobId: "generation-00000000-0000-4000-8000-000000000003",
      context: "{\"synthetic\":true}",
      onReady: async (value) => {
        handle = value;
        await Promise.resolve();
      },
    },
  });
  while (handle === undefined) await new Promise((resolve) => setTimeout(resolve, 10));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const detach = new Error("Synthetic plugin unload");
  detach.name = "PracticeLabDetach";
  controller.abort(detach);
  await assert.rejects(
    initial,
    (error: unknown) =>
      error instanceof CliProviderError && error.code === "detached",
  );

  const resumedAdapter = new SyntheticRecoverableAdapter(
    new DesktopProcessRunner(),
    fileSystem,
  );
  const recovered = await resumedAdapter.generate({
    prompt: "Synthetic approved prompt",
    schema: SCHEMA,
    validate: validateOk,
    timeoutMs: 5_000,
    recovery: { mode: "resume", handle },
  });
  assert.deepEqual(recovered.value, { ok: true });
  assert.equal(recovered.attempts, 1);
  assert.equal(recovered.recoveryHandle?.jobId, handle.jobId);
  assert.equal(resumedAdapter.prepareCalls, 0);
  await removeDurableRecovery(handle);
});

test("recovery launches an exact prepared request if Obsidian vanished before helper launch", async () => {
  const job = await new DesktopJobFileSystem().create();
  let handle: DurableProcessHandle | undefined;
  await assert.rejects(
    new DesktopProcessRunner().run({
      executable: process.execPath,
      args: ["-e", "process.stdout.write('prepared-request-finished');"],
      cwd: job.absolutePath,
      stdin: "",
      timeoutMs: 10_000,
      durable: {
        mode: "start",
        jobId: "generation-00000000-0000-4000-8000-000000000006",
        attempt: 1,
        onReady: async (value) => {
          handle = value;
          throw new Error("Synthetic Obsidian exit before helper launch");
        },
      },
    }),
    /Synthetic Obsidian exit/iu,
  );
  if (handle === undefined) throw new Error("The synthetic recovery handle was not created.");
  const startedAt = new Date(Date.now() - 10_000).toISOString();
  const activePath = `${handle.workspacePath}/durable-active.json`;
  const active = JSON.parse(readFileSync(activePath, "utf8")) as Record<string, unknown>;
  active.startedAt = startedAt;
  writeFileSync(activePath, `${JSON.stringify(active)}\n`, "utf8");
  handle = { ...handle, startedAt };

  const resumed = await new DesktopProcessRunner().run({
    executable: "unused-after-reattach",
    args: [],
    cwd: handle.workspacePath,
    stdin: "",
    timeoutMs: 10_000,
    durable: { mode: "resume", handle },
  });
  assert.equal(resumed.stdout, "prepared-request-finished");
  await removeDurableRecovery(handle);
});

test("explicit durable recovery cancellation stops the helper and cleanup is idempotent", async () => {
  const fileSystem = new DesktopJobFileSystem();
  const job = await fileSystem.create();
  let handle: DurableProcessHandle | undefined;
  const running = new DesktopProcessRunner().run({
    executable: process.execPath,
    args: ["-e", "setInterval(()=>{},1000);"],
    cwd: job.absolutePath,
    stdin: "",
    timeoutMs: 10_000,
    durable: {
      mode: "start",
      jobId: "generation-00000000-0000-4000-8000-000000000004",
      attempt: 1,
      onReady: async (value) => {
        handle = value;
        await Promise.resolve();
      },
    },
  });
  while (handle === undefined) await new Promise((resolve) => setTimeout(resolve, 10));
  await cancelDurableRecovery(handle);
  await assert.rejects(
    running,
    (error: unknown) =>
      error instanceof CliProviderError && error.code === "cancelled",
  );
  await removeDurableRecovery(handle);
  await removeDurableRecovery(handle);
  assert.equal(existsSync(handle.workspacePath), false);
});

test("the detached helper enforces the durable deadline", async () => {
  const fileSystem = new DesktopJobFileSystem();
  const job = await fileSystem.create();
  let handle: DurableProcessHandle | undefined;
  await assert.rejects(
    new DesktopProcessRunner().run({
      executable: process.execPath,
      args: ["-e", "setTimeout(()=>{},5000);"],
      cwd: job.absolutePath,
      stdin: "",
      timeoutMs: 250,
      durable: {
        mode: "start",
        jobId: "generation-00000000-0000-4000-8000-000000000005",
        attempt: 1,
        onReady: async (value) => {
          handle = value;
          await Promise.resolve();
        },
      },
    }),
    (error: unknown) =>
      error instanceof CliProviderError && error.code === "timeout",
  );
  assert.notEqual(handle, undefined);
  await removeDurableRecovery(handle!);
});

test("DesktopJobFileSystem uses an OS job directory and removes it", async () => {
  const fileSystem = new DesktopJobFileSystem();
  const job = await fileSystem.create();
  assert.match(job.absolutePath, /practice-lab-/u);
  assert.equal(existsSync(job.absolutePath), true);
  const file = await job.writeText("schema.json", "{}");
  assert.equal(existsSync(file), true);
  const media = await job.copyMedia([
    { bytes: Uint8Array.from([1, 2, 3]), mimeType: "image/png" },
  ]);
  assert.equal(media[0]?.filename, "media-001.png");
  assert.deepEqual(
    [...readFileSync(media[0]?.absolutePath ?? "")],
    [1, 2, 3],
  );
  await job.cleanup();
  assert.equal(existsSync(job.absolutePath), false);
});

test("timeout terminates a Windows child tree before job cleanup", async () => {
  const fileSystem = new DesktopJobFileSystem();
  const job = await fileSystem.create();
  const runner = new DesktopProcessRunner();
  const childCode =
    "const {spawn}=require('node:child_process');" +
    "spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{cwd:process.cwd(),stdio:'ignore'});" +
    "setTimeout(()=>{},10000);";

  await assert.rejects(
    runner.run({
      executable: process.execPath,
      args: ["-e", childCode],
      cwd: job.absolutePath,
      stdin: "",
      timeoutMs: 250,
    }),
    (error: unknown) =>
      error instanceof CliProviderError && error.code === "timeout",
  );
  await job.cleanup();
  assert.equal(existsSync(job.absolutePath), false);
});

class DeferredAdapter implements CliProviderAdapter {
  readonly id = "codex" as const;
  readonly label = "Codex";
  readonly executable = "codex";
  readonly onAbort: () => void;

  constructor(onAbort: () => void) {
    this.onAbort = onAbort;
  }

  capabilities(): ProviderCapabilities {
    return {
      text: true,
      structuredOutput: true,
      sandboxed: true,
      vision: "supported",
      reasoningEfforts: ["low", "medium", "high", "xhigh"],
    };
  }

  async detect(): Promise<ProviderDetection> {
    return {
      id: this.id,
      available: true,
      capabilities: this.capabilities(),
      models: [],
    };
  }

  async generate<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResult<T>> {
    return await new Promise((_resolve, reject) => {
      const abort = (): void => {
        this.onAbort();
        reject(new CliProviderError("cancelled", "cancelled"));
      };
      if (request.signal?.aborted === true) abort();
      else request.signal?.addEventListener("abort", abort, { once: true });
    });
  }
}
