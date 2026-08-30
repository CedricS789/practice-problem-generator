import assert from "node:assert/strict";
import test from "node:test";

import {
  appendGenerationHistory,
  appendGenerationHistoryBatch,
  emptyGenerationHistory,
  generationForBankRevision,
  generationForSetRevision,
  parseGenerationHistoryMarkdown,
  serializeGenerationHistoryFrontmatter,
  type GenerationHistoryEntryDraftV1,
} from "../src/generation-history";
import { balanceExerciseTypes } from "../src/exercise-distribution";

function entry(
  id: string,
  generatedAt: string,
  model = "gpt-5.6",
): GenerationHistoryEntryDraftV1 {
  return {
    id,
    generatedAt,
    provider: "codex",
    providerVersion: "codex-cli 0.146.0",
    model,
    reasoningEffort: "ultra",
    promptVersion: "practice-lab-v3.1",
    sourceHash: `sha256:${"a".repeat(64)}`,
    sourceScope: "note",
    requestedQuantity: 10,
    draftExerciseCount: 10,
    savedExerciseCount: 9,
    difficulty: "deep-exam",
    focusInstructions: "Focus on causal integration.",
    exerciseTypePercentages: balanceExerciseTypes([
      "short-answer",
      "causal-explanation",
    ]),
    selectedVisualCount: 2,
    attempts: 2,
    aiContextCompletionPolicy: "selected-sources-only",
  };
}

test("generation history round-trips as a strict quoted frontmatter sidecar", () => {
  const history = appendGenerationHistory(
    emptyGenerationHistory(),
    entry("generation-first", "2026-08-21T10:00:00.000Z"),
    0,
  );
  const markdown = [
    "---",
    serializeGenerationHistoryFrontmatter(history),
    "---",
    "",
  ].join("\n");
  assert.deepEqual(parseGenerationHistoryMarkdown(markdown), {
    status: "ok",
    history,
  });
  assert.match(markdown, /practice-lab-generation-history: "\{/u);
});

test("generation history preserves timing, token, and reported-cost provenance", () => {
  const history = appendGenerationHistory(
    emptyGenerationHistory(),
    {
      ...entry("generation-telemetry", "2026-08-21T10:05:00.000Z"),
      telemetry: {
        schemaVersion: 1,
        durationMs: 125_000,
        attempts: 2,
        tokenUsage: {
          inputTokens: 12_000,
          outputTokens: 3_500,
          cachedInputTokens: 2_000,
          reasoningTokens: 900,
          source: "provider-reported",
          inputEstimateExcludesMedia: false,
        },
        reportedCostUsd: 0.123,
      },
    },
    0,
  );
  const markdown = `---\n${serializeGenerationHistoryFrontmatter(history)}\n---\n`;
  const parsed = parseGenerationHistoryMarkdown(markdown);
  assert.equal(parsed.status, "ok");
  if (parsed.status === "ok") {
    assert.deepEqual(parsed.history.entries[0]?.telemetry, history.entries[0]?.telemetry);
  }
});

test("session revisions resolve to the newest generation at or before their start", () => {
  let history = appendGenerationHistory(
    emptyGenerationHistory(),
    entry("generation-first", "2026-08-21T10:00:00.000Z"),
    0,
  );
  history = appendGenerationHistory(
    history,
    entry("generation-second", "2026-08-21T11:00:00.000Z", ""),
    3,
  );
  assert.equal(generationForBankRevision(history, 0)?.id, "generation-first");
  assert.equal(generationForBankRevision(history, 2)?.id, "generation-first");
  assert.equal(generationForBankRevision(history, 3)?.id, "generation-second");
  assert.equal(generationForBankRevision(history, 99)?.id, "generation-second");
});

test("generation history rejects duplicate jobs, out-of-order revisions, and unsafe model text", () => {
  const history = appendGenerationHistory(
    emptyGenerationHistory(),
    entry("generation-first", "2026-08-21T10:00:00.000Z"),
    2,
  );
  assert.throws(
    () => appendGenerationHistory(
      history,
      entry("generation-first", "2026-08-21T11:00:00.000Z"),
      3,
    ),
    /already contains this job ID/iu,
  );
  assert.throws(
    () => appendGenerationHistory(
      history,
      entry("generation-older-revision", "2026-08-21T11:00:00.000Z"),
      1,
    ),
    /revisions must increase/iu,
  );
  const unsafe = {
    ...history,
    entries: history.entries.map((candidate) => ({
      ...candidate,
      model: "gpt-5.6;whoami",
    })),
  };
  const malformed = [
    "---",
    `practice-lab-generation-history: ${JSON.stringify(JSON.stringify(unsafe))}`,
    "---",
    "",
  ].join("\n");
  assert.equal(parseGenerationHistoryMarkdown(malformed).status, "invalid");
});

test("missing generation history is distinct from malformed history", () => {
  assert.deepEqual(parseGenerationHistoryMarkdown("---\npractice-lab: true\n---\n"), {
    status: "missing",
  });
  const parsed = parseGenerationHistoryMarkdown(
    '---\npractice-lab-generation-history: "not-json"\n---\n',
  );
  assert.equal(parsed.status, "invalid");
});

test("learning-path generation history stores exact set ownership at one atomic revision", () => {
  const first = {
    ...entry("generation-path-one", "2026-08-21T12:00:00.000Z"),
    batchId: "batch-one",
    blueprintId: "blueprint-one",
    setId: "set-one",
  };
  const second = {
    ...entry("generation-path-two", "2026-08-21T12:01:00.000Z"),
    batchId: "batch-one",
    blueprintId: "blueprint-one",
    setId: "set-two",
  };
  const history = appendGenerationHistoryBatch(
    emptyGenerationHistory(),
    [first, second],
    4,
  );
  assert.equal(history.schemaVersion, 2);
  assert.deepEqual(history.entries.map((candidate) => candidate.bankRevision), [4, 4]);
  assert.equal(generationForSetRevision(history, "set-one", 4)?.id, "generation-path-one");
  assert.equal(generationForSetRevision(history, "set-two", 4)?.id, "generation-path-two");
});

test("legacy generation history migrates in memory and partial path provenance fails closed", () => {
  const current = entry("generation-legacy", "2026-08-21T09:00:00.000Z");
  const { aiContextCompletionPolicy: _legacyPolicy, ...legacyEntry } = current;
  const legacy = {
    schemaVersion: 1,
    entries: [{ ...legacyEntry, bankRevision: 0 }],
  };
  const markdown = [
    "---",
    `practice-lab-generation-history: ${JSON.stringify(JSON.stringify(legacy))}`,
    "---",
    "",
  ].join("\n");
  const parsed = parseGenerationHistoryMarkdown(markdown);
  assert.equal(parsed.status, "ok");
  if (parsed.status === "ok") {
    assert.equal(parsed.history.schemaVersion, 2);
    assert.equal(parsed.history.entries[0]?.aiContextCompletionPolicy, undefined);
  }

  assert.throws(
    () => appendGenerationHistory(
      emptyGenerationHistory(),
      { ...entry("generation-partial", "2026-08-21T10:00:00.000Z"), setId: "set-only" },
      0,
    ),
    /present together/iu,
  );
});
