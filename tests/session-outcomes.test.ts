import assert from "node:assert/strict";
import test from "node:test";

import {
  FREE_RESPONSE_OUTCOMES,
  summarizeFreeResponseOutcomes,
} from "../src/ui/session-outcomes";

test("free-response controls use assessment outcomes instead of flashcard ratings", () => {
  const labels: readonly string[] = FREE_RESPONSE_OUTCOMES.map(
    (outcome) => outcome.label,
  );
  assert.deepEqual(labels, ["Incorrect", "Partially correct", "Correct"]);
  assert.doesNotMatch(labels.join("|"), /Again|Easy/u);
});

test("session summaries report free-response accuracy", () => {
  assert.equal(
    summarizeFreeResponseOutcomes(["again", "hard", "good"]),
    "1 correct, 1 partially correct, 1 incorrect",
  );
  assert.equal(
    summarizeFreeResponseOutcomes(["easy"]),
    "1 correct, 0 partially correct, 0 incorrect",
  );
});
