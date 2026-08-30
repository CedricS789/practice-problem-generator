import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const surfaces = await Promise.all([
  "../src/ui/learning-path-view.ts",
  "../src/ui/practice-lab-view.ts",
  "../src/ui/practice-dashboard-view.ts",
  "../src/bank-statistics-view.ts",
  "../src/main.ts",
].map(async (path) => readFile(new URL(path, import.meta.url), "utf8")));

const userFacingSource = surfaces.join("\n");

test("practice surfaces use neutral evidence language instead of judging notes", () => {
  assert.doesNotMatch(
    userFacingSource,
    /Your notes are incomplete|notes are incomplete|incomplete[- ]note/iu,
  );
  assert.match(userFacingSource, /School material adds context/u);
  assert.match(
    userFacingSource,
    /Additional context could strengthen this practice/u,
  );
});

test("supporting AI context is one explicit, non-editing choice", () => {
  assert.match(userFacingSource, /Add supporting context/u);
  assert.match(userFacingSource, /Continue with selected material only/u);
  assert.match(
    userFacingSource,
    /AI-supported context approved · not course-checked/u,
  );
  assert.match(userFacingSource, /Your notes will not be changed/u);
});
