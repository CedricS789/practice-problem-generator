import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateGenerationTelemetry,
  combineGenerationTelemetry,
  formatGenerationCost,
  formatReportedCost,
  formatTokenUsage,
  generationTelemetryProblem,
  tokenUsageTotal,
  type GenerationAttemptTelemetryV1,
} from "../src/generation-telemetry";

const attemptOne: GenerationAttemptTelemetryV1 = {
  attempt: 1,
  durationMs: 1_500,
  tokenUsage: {
    inputTokens: 1_000,
    outputTokens: 200,
    cachedInputTokens: 400,
    reasoningTokens: 80,
    source: "provider-reported",
    inputEstimateExcludesMedia: false,
  },
  reportedCostUsd: 0.01,
};

const attemptTwo: GenerationAttemptTelemetryV1 = {
  attempt: 2,
  durationMs: 2_500,
  tokenUsage: {
    inputTokens: 1_200,
    outputTokens: 300,
    source: "local-estimate",
    inputEstimateExcludesMedia: true,
  },
};

test("generation telemetry aggregates schema-repair attempts without double-counting subsets", () => {
  const telemetry = aggregateGenerationTelemetry([attemptOne, attemptTwo], 4_500);
  assert.equal(telemetry.attempts, 2);
  assert.equal(telemetry.durationMs, 4_500);
  assert.equal(telemetry.tokenUsage.source, "mixed");
  assert.equal(telemetry.tokenUsage.inputTokens, 2_200);
  assert.equal(telemetry.tokenUsage.outputTokens, 500);
  assert.equal(telemetry.tokenUsage.cachedInputTokens, 400);
  assert.equal(telemetry.tokenUsage.reasoningTokens, 80);
  assert.equal(tokenUsageTotal(telemetry.tokenUsage), 2_700);
  assert.equal(telemetry.reportedCostUsd, undefined);
  assert.equal(telemetry.partialReportedCostUsd, 0.01);
  assert.deepEqual(telemetry.reportedCostCoverage, {
    reportedProviderAttempts: 1,
    totalProviderAttempts: 2,
  });
  assert.equal(
    formatGenerationCost(telemetry),
    "$0.010 reported for 1 of 2 attempts · partial lower bound",
  );
  assert.equal(telemetry.tokenUsage.inputEstimateExcludesMedia, true);
  assert.equal(generationTelemetryProblem(telemetry), null);
});

test("batch telemetry totals jobs and provider attempts", () => {
  const first = aggregateGenerationTelemetry([attemptOne], 1_500);
  const second = aggregateGenerationTelemetry([attemptOne, attemptTwo], 4_500);
  const totals = combineGenerationTelemetry([first, second]);
  assert.equal(totals?.jobCount, 2);
  assert.equal(totals?.providerAttemptCount, 3);
  assert.equal(totals?.tokenUsage.inputTokens, 3_200);
  assert.equal(totals?.tokenUsage.outputTokens, 700);
  assert.equal(totals?.reportedCostUsd, undefined);
  assert.equal(totals?.partialReportedCostUsd, 0.02);
  assert.deepEqual(totals?.reportedCostCoverage, {
    reportedProviderAttempts: 2,
    totalProviderAttempts: 3,
  });
});

test("telemetry formatting distinguishes estimates from provider-reported cost", () => {
  assert.equal(
    formatTokenUsage(attemptTwo.tokenUsage),
    "~1.2k input · ~300 output",
  );
  assert.equal(formatReportedCost(undefined), "Monetary cost not reported by CLI");
  assert.equal(formatReportedCost(0.004), "< $0.01 reported");
});

test("telemetry validation rejects unknown or malformed persisted metadata", () => {
  assert.match(
    generationTelemetryProblem({
      ...aggregateGenerationTelemetry([attemptOne], 1_500),
      secret: "no",
    }) ?? "",
    /unknown field/u,
  );
  assert.match(
    generationTelemetryProblem({
      ...aggregateGenerationTelemetry([attemptOne], 1_500),
      durationMs: -1,
    }) ?? "",
    /timing/u,
  );
});

test("telemetry validation enforces subset token accounting", () => {
  for (const tokenUsage of [
    { ...attemptOne.tokenUsage, cachedInputTokens: 1_001 },
    { ...attemptOne.tokenUsage, cacheWriteInputTokens: 1_001 },
    { ...attemptOne.tokenUsage, reasoningTokens: 201 },
  ]) {
    assert.match(
      generationTelemetryProblem({
        ...aggregateGenerationTelemetry([attemptOne], 1_500),
        tokenUsage,
      }) ?? "",
      /cannot exceed/u,
    );
  }
});

test("attempt aggregation rejects duplicate and non-sequential attempts", () => {
  assert.throws(
    () => aggregateGenerationTelemetry([attemptOne, { ...attemptTwo, attempt: 1 }], 4_500),
    /unique and sequential/u,
  );
  assert.throws(
    () => aggregateGenerationTelemetry([{ ...attemptOne, attempt: 2 }], 1_500),
    /unique and sequential/u,
  );
});
