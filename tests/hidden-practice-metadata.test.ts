import assert from "node:assert/strict";
import test from "node:test";

import {
  parseHiddenPracticeMetadata,
  serializeHiddenPracticeMetadata,
} from "../src/hidden-practice-metadata";

test("hidden practice metadata round-trips without creating an HTML comment terminator", () => {
  const serialized = serializeHiddenPracticeMetadata({
    generationRecipe: {
      schemaVersion: 2,
      model: "model--with-hyphens",
      focusInstructions: "Do not expose --> or plugin-owned metadata.",
    },
  });
  assert.ok(serialized);
  const body = serialized.split("\n")[1] ?? "";
  assert.doesNotMatch(body, /-->/u);
  assert.match(body, /\\u002d/u);
  assert.deepEqual(parseHiddenPracticeMetadata(serialized), {
    status: "ok",
    metadata: {
      schemaVersion: 1,
      generationRecipe: {
        schemaVersion: 2,
        model: "model--with-hyphens",
        focusInstructions: "Do not expose --> or plugin-owned metadata.",
      },
    },
  });
});

test("hidden metadata is optional, unique, versioned, and strict", () => {
  assert.equal(serializeHiddenPracticeMetadata({}), undefined);
  assert.deepEqual(parseHiddenPracticeMetadata("# Ordinary note\n"), {
    status: "missing",
  });
  const valid = serializeHiddenPracticeMetadata({ generationHistory: { entries: [] } });
  assert.ok(valid);
  assert.equal(parseHiddenPracticeMetadata(`${valid}\n${valid}\n`).status, "invalid");
  assert.equal(parseHiddenPracticeMetadata(
    "<!-- practice-problem-generator-metadata-v1\n{\"schemaVersion\":2}\n-->",
  ).status, "invalid");
  assert.equal(parseHiddenPracticeMetadata(
    "<!-- practice-problem-generator-metadata-v1\n{\"schemaVersion\":1,\"extra\":true}\n-->",
  ).status, "invalid");
});
