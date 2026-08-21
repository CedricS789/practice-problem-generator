import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
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
  appendNeutralMediaManifest,
  createCliProviderLayer,
  parseProviderOutput,
  type CliJobFileSystem,
  type CliJobWorkspace,
  type CliProcessRunner,
  type CliProviderAdapter,
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
  assert.deepEqual(request.args.slice(0, 16), [
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
  assert.deepEqual(request.args.slice(16), [
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
  assert.ok(runner.requests[0]?.args.includes("--sandbox"));
  assert.ok(runner.requests[0]?.args.includes("--dangerously-skip-permissions"));
  assert.ok(runner.requests[0]?.args.includes("--new-project"));
  assert.deepEqual(
    runner.requests[0]?.args.slice(
      (runner.requests[0]?.args.indexOf("--model") ?? -1) + 1,
      (runner.requests[0]?.args.indexOf("--model") ?? -1) + 2,
    ),
    ["gemini-3.6-flash-low"],
  );
  assert.deepEqual(
    runner.requests[0]?.args.slice(
      (runner.requests[0]?.args.indexOf("--mode") ?? -1) + 1,
      (runner.requests[0]?.args.indexOf("--mode") ?? -1) + 2,
    ),
    ["accept-edits"],
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
    { stdout: "2.1.220\n", stderr: "", exitCode: 0 },
    { stdout: "agy version 1.1.11\n", stderr: "", exitCode: 0 },
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
    ["codex", "claude", "agy"],
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
