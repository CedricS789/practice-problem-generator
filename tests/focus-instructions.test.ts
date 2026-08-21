import assert from "node:assert/strict";
import test from "node:test";

import {
  focusInstructionsForPrompt,
  focusInstructionsProblem,
  MAX_FOCUS_INSTRUCTIONS_LENGTH,
} from "../src/focus-instructions";

test("empty focus instructions produce an explicit neutral prompt statement", () => {
  assert.match(focusInstructionsForPrompt("   \n"), /None supplied/u);
  assert.equal(focusInstructionsProblem(""), null);
});

test("focus instructions preserve the user's exact text as a JSON string", () => {
  const instructions = "Focus on A.\nAvoid recall-only questions about B.";
  assert.equal(
    focusInstructionsForPrompt(instructions),
    JSON.stringify(instructions),
  );
});

test("focus instructions have a bounded provider payload", () => {
  assert.equal(
    focusInstructionsProblem("x".repeat(MAX_FOCUS_INSTRUCTIONS_LENGTH)),
    null,
  );
  assert.match(
    focusInstructionsProblem(
      "x".repeat(MAX_FOCUS_INSTRUCTIONS_LENGTH + 1),
    ) ?? "",
    /characters or fewer/u,
  );
});
