import assert from "node:assert/strict";
import test from "node:test";
import {
  createGenerationRecoveryContext,
  createGenerationRecoveryDraft,
  parseGenerationRecoveryContext,
  parseGenerationRecoveryDraft,
} from "../src/generation-recovery";
import { GENERATION_DRAFT_SCHEMA_VERSION, type GenerationDraftV1 } from "../src/model";
import { prepareSource } from "../src/segmenter";
import type { CollectedSource } from "../src/source";
import type { GenerationConfiguration } from "../src/ui/contracts";

const text = "# Junction capacitance\n\nA wider depletion region reduces capacitance.";
const segmented = prepareSource(text);
const source = {
  mode: "selection",
  title: "Synthetic source",
  path: "Notes/Synthetic source.md",
  characterCount: text.length,
  excerpt: text,
  visuals: [],
  file: {} as CollectedSource["file"],
  submittedText: text,
  ...segmented,
} satisfies CollectedSource;
const percentages: GenerationConfiguration["exerciseTypePercentages"] = {
  "short-answer": 100,
  "causal-explanation": 0,
  application: 0,
  calculation: 0,
  cloze: 0,
  "single-select": 0,
  "multi-select": 0,
  matching: 0,
  ordering: 0,
  "image-occlusion": 0,
};
const configuration: GenerationConfiguration = {
  provider: "codex",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  focusInstructions: "Focus on the causal relation.",
  quantity: 1,
  difficulty: "deep-exam",
  exerciseTypes: ["short-answer"],
  exerciseTypePercentages: percentages,
  selectedVisualIds: [],
  aiContextCompletionPolicy: "selected-sources-only",
};
const jobId = "generation-00000000-0000-4000-8000-000000000002";

test("generation recovery context round-trips the exact approved source and configuration", () => {
  const context = createGenerationRecoveryContext({
    jobId,
    startedAt: "2026-08-22T10:00:00.000Z",
    source,
    configuration,
    prompt: "Synthetic approved prompt",
    visuals: [],
  });
  assert.deepEqual(
    parseGenerationRecoveryContext(JSON.stringify(context)),
    context,
  );
  assert.equal(context.source.submittedText, text);
  assert.equal(context.configuration.model, "gpt-5.6-sol");
  assert.equal(context.configuration.aiContextCompletionPolicy, "selected-sources-only");

  const legacy = structuredClone(context) as unknown as {
    configuration: Record<string, unknown>;
  };
  delete legacy.configuration.aiContextCompletionPolicy;
  assert.equal(
    parseGenerationRecoveryContext(JSON.stringify(legacy)).configuration
      .aiContextCompletionPolicy,
    "approved-general-context",
  );
});

test("generation recovery rejects mismatched visuals and unsafe vault paths", () => {
  const context = createGenerationRecoveryContext({
    jobId,
    startedAt: "2026-08-22T10:00:00.000Z",
    source,
    configuration,
    prompt: "Synthetic approved prompt",
    visuals: [],
  });
  assert.throws(
    () => parseGenerationRecoveryContext(JSON.stringify({
      ...context,
      configuration: {
        ...context.configuration,
        selectedVisualIds: ["visual-missing"],
      },
    })),
    /selected visuals do not match/iu,
  );
  assert.throws(
    () => parseGenerationRecoveryContext(JSON.stringify({
      ...context,
      source: { ...context.source, path: "C:\\Private\\Source.md" },
    })),
    /unsafe vault path/iu,
  );
  assert.throws(
    () => parseGenerationRecoveryContext(JSON.stringify({
      ...context,
      configuration: {
        ...context.configuration,
        exerciseTypePercentages: {
          ...context.configuration.exerciseTypePercentages,
          "causal-explanation": 10,
        },
      },
    })),
    /total 100%/iu,
  );
  const incompleteMix = {
    ...context.configuration.exerciseTypePercentages,
  } as Record<string, number>;
  delete incompleteMix.ordering;
  assert.throws(
    () => parseGenerationRecoveryContext(JSON.stringify({
      ...context,
      configuration: {
        ...context.configuration,
        exerciseTypePercentages: incompleteMix,
      },
    })),
    /mix is incomplete/iu,
  );
});

test("validated recovery drafts retain the original generation job and attempts", () => {
  const draft: GenerationDraftV1 = {
    schemaVersion: GENERATION_DRAFT_SCHEMA_VERSION,
    exercises: [],
  };
  const checkpoint = createGenerationRecoveryDraft({
    jobId,
    attempts: 2,
    draft,
    telemetry: {
      schemaVersion: 1,
      durationMs: 9_000,
      attempts: 2,
      tokenUsage: {
        inputTokens: 500,
        outputTokens: 120,
        source: "local-estimate",
        inputEstimateExcludesMedia: true,
      },
    },
  });
  assert.deepEqual(
    parseGenerationRecoveryDraft(JSON.stringify(checkpoint)),
    checkpoint,
  );
  assert.throws(
    () => parseGenerationRecoveryDraft(JSON.stringify({
      ...checkpoint,
      jobId: "other-job",
    })),
    /job ID/iu,
  );
  assert.throws(
    () => parseGenerationRecoveryDraft(JSON.stringify({
      ...checkpoint,
      telemetry: { ...checkpoint.telemetry, attempts: 1 },
    })),
    /attempt count changed/iu,
  );
});
