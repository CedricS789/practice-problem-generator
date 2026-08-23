import assert from "node:assert/strict";
import test from "node:test";
import {
  AgyCliProviderAdapter,
  ClaudeCliProviderAdapter,
  CliProviderError,
  CodexCliProviderAdapter,
  parseClaudeInstalledHelp,
  parseAgyModelCatalog,
  type CliJobFileSystem,
  type CliJobWorkspace,
  type CliProcessRunner,
  type ProcessRunRequest,
  type ProcessRunResult,
} from "../src/cli/index";

class QueueRunner implements CliProcessRunner {
  readonly requests: ProcessRunRequest[] = [];
  private readonly queue: Array<
    ProcessRunResult | ((request: ProcessRunRequest) => ProcessRunResult)
  >;

  constructor(
    queue: Array<ProcessRunResult | ((request: ProcessRunRequest) => ProcessRunResult)>,
  ) {
    this.queue = queue;
  }

  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    this.requests.push(request);
    const next = this.queue.shift();
    if (next === undefined) throw new Error("Unexpected runner invocation.");
    return await Promise.resolve(typeof next === "function" ? next(request) : next);
  }
}

class UnusedJobFileSystem implements CliJobFileSystem {
  async create(): Promise<CliJobWorkspace> {
    throw new Error("Detection must not create a generation workspace.");
  }
}

test("Codex detection keeps only display-safe list models and their reasoning metadata", async () => {
  const catalog = {
    models: [
      {
        slug: "gpt-5.6-sol",
        display_name: "GPT-5.6 Sol",
        description: "Frontier model",
        default_reasoning_level: "low",
        supported_reasoning_levels: [
          { effort: "low", description: "Fast" },
          { effort: "high", description: "Deep" },
          { effort: "unsupported", description: "Ignored" },
        ],
        visibility: "list",
        base_instructions: "must never enter the UI contract",
      },
      {
        slug: "hidden-model",
        display_name: "Hidden",
        visibility: "hide",
      },
      {
        slug: "unsafe model id",
        display_name: "Unsafe",
        visibility: "list",
      },
    ],
  };
  const runner = new QueueRunner([
    { stdout: "codex-cli 0.146.0\n", stderr: "", exitCode: 0 },
    { stdout: JSON.stringify(catalog), stderr: "", exitCode: 0 },
  ]);
  const adapter = new CodexCliProviderAdapter(runner, new UnusedJobFileSystem());

  const detection = await adapter.detect();

  assert.equal(detection.available, true);
  assert.deepEqual(detection.models, [
    {
      id: "gpt-5.6-sol",
      label: "GPT-5.6 Sol",
      description: "Frontier model",
      defaultReasoningEffort: "low",
      supportedReasoningEfforts: ["low", "high"],
    },
  ]);
  assert.equal(detection.modelCatalogDetail, undefined);
  assert.deepEqual(runner.requests.map((request) => request.args), [
    ["--version"],
    ["debug", "models", "--bundled"],
  ]);
  assert.equal(runner.requests[1]?.stdin, "");
  assert.ok((runner.requests[1]?.timeoutMs ?? Infinity) <= 10_000);
});

test("a Codex catalog failure is non-fatal for an otherwise installed provider", async () => {
  const runner = new QueueRunner([
    { stdout: "codex-cli 0.146.0\n", stderr: "", exitCode: 0 },
    { stdout: "", stderr: "catalog unavailable", exitCode: 2 },
  ]);
  const adapter = new CodexCliProviderAdapter(runner, new UnusedJobFileSystem());

  const detection = await adapter.detect();

  assert.equal(detection.available, true);
  assert.deepEqual(detection.models, []);
  assert.match(detection.modelCatalogDetail ?? "", /temporarily unavailable/iu);
});

test("Claude derives rolling aliases and every installed effort from local help", async () => {
  const runner = new QueueRunner([
    { stdout: "2.1.220\n", stderr: "", exitCode: 0 },
    {
      stdout: "--effort <level> (low, medium, high, xhigh, max, ultracode)\n--model <model> alias for latest (e.g. 'fable', 'opus', 'sonnet', or 'haiku') or a model's full name\n",
      stderr: "",
      exitCode: 0,
    },
  ]);
  const adapter = new ClaudeCliProviderAdapter(runner, new UnusedJobFileSystem());

  const detection = await adapter.detect();

  assert.deepEqual(detection.models.map((model) => model.id), [
    "fable",
    "opus",
    "sonnet",
    "haiku",
  ]);
  assert.ok(detection.models.every((model) =>
    model.defaultReasoningEffort === "medium"
    && model.supportedReasoningEfforts?.join(",") === "low,medium,high,xhigh,max,ultracode"));
  assert.deepEqual(detection.capabilities.reasoningEfforts, [
    "low", "medium", "high", "xhigh", "max", "ultracode",
  ]);
  assert.equal(runner.requests.length, 2);
  assert.deepEqual(runner.requests[0]?.args, ["--version"]);
  assert.deepEqual(runner.requests[1]?.args, ["--help"]);
});

test("Claude help parsing falls back conservatively when wording is incomplete", () => {
  const parsed = parseClaudeInstalledHelp("Claude Code help without capability details");
  assert.deepEqual(parsed.models.map((model) => model.id), ["fable", "opus", "sonnet"]);
  assert.deepEqual(parsed.reasoningEfforts, ["low", "medium", "high", "xhigh", "max"]);
});

test("agy TSV models carry the reasoning variants available to their family", () => {
  const models = parseAgyModelCatalog([
    "Fetching available models...",
    "gemini-3.7-flash-high\tGemini 3.7 Flash (High)",
    "gemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)",
    "gemini-3.7-flash-low\tGemini 3.7 Flash (Low)",
    "gemini-3.1-pro-high\tGemini 3.1 Pro (High)",
    "gemini-3.1-pro-low\tGemini 3.1 Pro (Low)",
    "claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)",
  ].join("\n"));

  assert.deepEqual(models[0], {
    id: "gemini-3.7-flash-high",
    label: "Gemini 3.7 Flash (High)",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "medium", "high"],
  });
  assert.deepEqual(models[3]?.supportedReasoningEfforts, ["low", "high"]);
  assert.deepEqual(models[5], {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6 (Thinking)",
  });
});

test("agy detection uses a prompt-free bounded catalog command", async () => {
  const runner = new QueueRunner([
    { stdout: "agy version 1.1.11\n", stderr: "", exitCode: 0 },
    {
      stdout: "gemini-3.7-flash-low\tGemini 3.7 Flash (Low)\n",
      stderr: "Fetching available models...\n",
      exitCode: 0,
    },
  ]);
  const adapter = new AgyCliProviderAdapter(runner, new UnusedJobFileSystem());

  const detection = await adapter.detect();

  assert.equal(detection.available, true);
  assert.equal(detection.models[0]?.id, "gemini-3.7-flash-low");
  assert.deepEqual(runner.requests[1]?.args, ["models"]);
  assert.equal(runner.requests[1]?.stdin, "");
  assert.ok((runner.requests[1]?.timeoutMs ?? Infinity) <= 10_000);
});

test("provider catalogs are capped before they can create an unbounded UI", async () => {
  const codexModels = Array.from({ length: 205 }, (_unused, index) => ({
    slug: `synthetic-model-${index}`,
    display_name: `Synthetic model ${index}`,
    visibility: "list",
  }));
  const runner = new QueueRunner([
    { stdout: "codex-cli 0.146.0\n", stderr: "", exitCode: 0 },
    {
      stdout: JSON.stringify({ models: codexModels }),
      stderr: "",
      exitCode: 0,
    },
  ]);
  const detection = await new CodexCliProviderAdapter(
    runner,
    new UnusedJobFileSystem(),
  ).detect();
  assert.equal(detection.models.length, 200);
  assert.match(detection.modelCatalogDetail ?? "", /first 200/iu);

  const agyRows = Array.from(
    { length: 205 },
    (_unused, index) => `synthetic-${index}-medium\tSynthetic ${index}`,
  );
  assert.equal(parseAgyModelCatalog(agyRows.join("\n")).length, 200);
});

test("successful catalogs are cached by CLI version for ten minutes", async () => {
  const runner = new QueueRunner([
    { stdout: "codex-cli 0.146.0\n", stderr: "", exitCode: 0 },
    { stdout: '{"models":[]}', stderr: "", exitCode: 0 },
    { stdout: "codex-cli 0.146.0\n", stderr: "", exitCode: 0 },
  ]);
  const adapter = new CodexCliProviderAdapter(
    runner,
    new UnusedJobFileSystem(),
  );
  await adapter.detect();
  await adapter.detect();
  assert.deepEqual(runner.requests.map((request) => request.args), [
    ["--version"],
    ["debug", "models", "--bundled"],
    ["--version"],
  ]);
});

test("catalog cancellation cancels detection instead of returning stale availability", async () => {
  const controller = new AbortController();
  const runner = new QueueRunner([
    { stdout: "codex-cli 0.146.0\n", stderr: "", exitCode: 0 },
    () => {
      controller.abort();
      throw new DOMException("cancelled", "AbortError");
    },
  ]);
  const adapter = new CodexCliProviderAdapter(runner, new UnusedJobFileSystem());

  await assert.rejects(
    adapter.detect(controller.signal),
    (error: unknown) =>
      error instanceof CliProviderError && error.code === "cancelled",
  );
});
