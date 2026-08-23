import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [guidedSource, quickSource, savedSetSource, stylesSource] = await Promise.all([
  readFile(new URL("../src/ui/learning-path-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/practice-lab-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/saved-set-generation-modal.ts", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
]);

test("guided set dragging starts only from the numbered order handle", () => {
  const start = guidedSource.indexOf("private renderSetCard(");
  const end = guidedSource.indexOf("private renderSetAdvanced(", start);
  assert.ok(start >= 0 && end > start);
  const implementation = guidedSource.slice(start, end);
  assert.match(
    implementation,
    /cls: "practice-learning-path-set-card",\s+attr: \{ "data-set-id": state\.id \}/u,
  );
  assert.doesNotMatch(
    implementation,
    /cls: "practice-learning-path-set-card",\s+attr: \{[^}]*draggable/u,
  );
  assert.match(
    implementation,
    /cls: "practice-learning-path-set-order",[\s\S]*draggable: "true"/u,
  );
  assert.match(implementation, /order\.addEventListener\("dragstart"/u);
  assert.match(implementation, /event\.dataTransfer\.effectAllowed = "move"/u);
  assert.match(stylesSource, /\.practice-learning-path-set-order\[draggable="true"\]/u);
  assert.doesNotMatch(stylesSource, /\.practice-learning-path-set-card\[draggable="true"\]/u);
});

test("every exercise-mix range explicitly rejects native element dragging", () => {
  for (const source of [guidedSource, quickSource, savedSetSource]) {
    assert.match(
      source,
      /type: "range"[\s\S]{0,100}draggable: "false"/u,
    );
  }
  assert.match(
    stylesSource,
    /\.practice-lab-percentage-slider \{[\s\S]*-webkit-user-drag: none;[\s\S]*user-select: none;/u,
  );
  assert.match(
    stylesSource,
    /\.practice-learning-path-mix-row input\[type="range"\] \{[\s\S]*-webkit-user-drag: none;[\s\S]*user-select: none;/u,
  );
});

test("guided percentage rebalancing refreshes every row value, label state, and output", () => {
  const start = guidedSource.indexOf("private renderSetAdvanced(");
  const end = guidedSource.indexOf("private renderSetPayloadPreviews(", start);
  assert.ok(start >= 0 && end > start);
  const implementation = guidedSource.slice(start, end);
  assert.match(
    implementation,
    /for \(const candidate of Array\.from\(mix\.querySelectorAll<HTMLInputElement>\("input\[type=range\]"\)\)\)/u,
  );
  assert.match(implementation, /candidate\.value = String\(value\)/u);
  assert.match(
    implementation,
    /candidate\.closest\("label"\)\?\.classList\.toggle\("is-zero", value === 0\)/u,
  );
  assert.match(
    implementation,
    /candidate\.parentElement\?\.querySelector\("output"\)\?\.setText\(`\$\{value\}%`\)/u,
  );
  assert.doesNotMatch(implementation, /output\.setText\(`\$\{percentages\[type\]\}%`\)/u);
});
