import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [bridge, main, quickView, guidedView, dashboardView, styles] = await Promise.all([
  readFile(new URL("../src/ui/theme-bridge.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/practice-lab-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/learning-path-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/practice-dashboard-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
]);

test("native plugin views resolve heading roles from a scoped Markdown theme probe", () => {
  assert.match(bridge, /markdown-rendered practice-lab-theme-probe/u);
  assert.match(bridge, /getComputedStyle\(probe\)/u);
  assert.match(bridge, /--inline-title-color/u);
  assert.match(bridge, /--h2-color/u);
  assert.match(bridge, /--practice-lab-title-color/u);
  assert.match(bridge, /probe\.remove\(\)/u);

  for (const source of [quickView, guidedView, dashboardView]) {
    assert.match(source, /applyMarkdownHeadingTheme\(this\.contentEl\)/u);
  }
});

test("theme changes refresh open plugin views and rendered saved banks", () => {
  assert.match(main, /workspace\.on\("css-change"/u);
  assert.match(
    main,
    /\.practice-lab-view, \.practice-learning-path, \.practice-lab-bank-card/u,
  );
  assert.match(main, /applyMarkdownHeadingTheme\(element\)/u);
});

test("plugin headings use semantic Obsidian heading roles while actions keep the accent", () => {
  assert.match(
    styles,
    /--practice-lab-title-color:\s*var\([\s\S]*--inline-title-color/u,
  );
  assert.match(
    styles,
    /--practice-lab-section-title-color:\s*var\(--h2-color/u,
  );
  assert.match(
    styles,
    /:is\(\.practice-lab-view, \.practice-learning-path, \.practice-lab-bank-card\) h3 \{\s*color: var\(--practice-lab-section-title-color\)/u,
  );
  assert.match(styles, /\.practice-lab-stepper button\.is-current[\s\S]*var\(--interactive-accent\)/u);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}/iu);
});
