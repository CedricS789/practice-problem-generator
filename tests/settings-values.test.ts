import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_AI_TIMEOUT_MS,
  MAX_AI_TIMEOUT_MS,
  MIN_AI_TIMEOUT_MS,
  normalizeAiTimeout,
} from "../src/settings-values";

test("legacy AI defaults migrate to three hours while explicit current values survive", () => {
  assert.equal(DEFAULT_AI_TIMEOUT_MS, 10_800_000);
  assert.equal(normalizeAiTimeout(undefined, 300_000, true), DEFAULT_AI_TIMEOUT_MS);
  assert.equal(normalizeAiTimeout(300_000, 300_000, true), DEFAULT_AI_TIMEOUT_MS);
  assert.equal(normalizeAiTimeout(120_000, 120_000, true), DEFAULT_AI_TIMEOUT_MS);
  assert.equal(normalizeAiTimeout(7_200_000, 300_000, true), 7_200_000);
  assert.equal(normalizeAiTimeout(300_000, 300_000, false), 300_000);
});

test("AI timeouts remain bounded without shortening the three-hour default", () => {
  assert.equal(normalizeAiTimeout(1, 300_000, false), MIN_AI_TIMEOUT_MS);
  assert.equal(normalizeAiTimeout(Number.POSITIVE_INFINITY, 300_000, false), DEFAULT_AI_TIMEOUT_MS);
  assert.equal(normalizeAiTimeout(MAX_AI_TIMEOUT_MS + 1, 300_000, false), MAX_AI_TIMEOUT_MS);
});
