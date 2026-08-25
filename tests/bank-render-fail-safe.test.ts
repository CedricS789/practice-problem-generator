import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(
  new URL("../src/main.ts", import.meta.url),
  "utf8",
);

test("a saved-bank renderer failure cannot reject the Markdown file load", () => {
  assert.match(
    mainSource,
    /registerMarkdownCodeBlockProcessor\("practice-lab", async \(source, element, context\) => \{[\s\S]*?try \{[\s\S]*?await this\.renderPracticeBlock\(source, element, context\);[\s\S]*?catch \(error\) \{[\s\S]*?element\.empty\(\);[\s\S]*?this\.renderReadOnlyBlock/u,
  );
});
