import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [quickView, guidedView, savedSetModal, statistics, styles] = await Promise.all([
  readFile(new URL("../src/ui/practice-lab-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/learning-path-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/saved-set-generation-modal.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/bank-statistics-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
]);

test("every desktop generation surface shows calm elapsed, token, and cost metadata", () => {
  for (const source of [quickView, guidedView, savedSetModal]) {
    assert.match(source, /generationTelemetryFromActivity/u);
    assert.match(source, /formatGenerationDuration|formatElapsed/u);
    assert.match(source, /formatTokenUsage/u);
    assert.match(source, /formatReportedCost|formatGenerationCost/u);
  }
  assert.match(quickView, /Local token estimates are marked with ~/u);
  assert.match(guidedView, /Guided generation usage summary/u);
  assert.match(guidedView, /elapsedMetric\?\.setText/u);
  assert.match(savedSetModal, /Set generation usage summary/u);
  assert.match(savedSetModal, /private activityExpanded = false/u);
  assert.match(savedSetModal, /this\.activityElapsedEl\?\.setText/u);
  assert.doesNotMatch(savedSetModal, /attr: \{ open: "" \},/u);
});

test("generation telemetry is retained in history without inventing monetary cost", () => {
  assert.match(statistics, /"Elapsed time"/u);
  assert.match(statistics, /"Token usage"/u);
  assert.match(statistics, /"Usage basis"/u);
  assert.match(statistics, /"Monetary cost"/u);
  assert.match(statistics, /formatGenerationCost\(entry\.telemetry\)/u);
  assert.match(styles, /\.practice-lab-generation-telemetry \{/u);
  assert.match(styles, /\.practice-lab-generation-telemetry-metric \{/u);
});
