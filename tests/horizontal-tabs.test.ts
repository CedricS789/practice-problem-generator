import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { horizontalTabTargetIndex } from "../src/ui/horizontal-tabs";

const source = await readFile(
  new URL("../src/ui/horizontal-tabs.ts", import.meta.url),
  "utf8",
);

test("horizontal tabs wrap and support first and last keyboard navigation", () => {
  assert.equal(horizontalTabTargetIndex("ArrowRight", 2, 3), 0);
  assert.equal(horizontalTabTargetIndex("ArrowLeft", 0, 3), 2);
  assert.equal(horizontalTabTargetIndex("Home", 2, 3), 0);
  assert.equal(horizontalTabTargetIndex("End", 0, 3), 2);
  assert.equal(horizontalTabTargetIndex("Enter", 1, 3), null);
  assert.equal(horizontalTabTargetIndex("ArrowRight", 0, 0), null);
});

test("horizontal tabs expose one accessible active panel", () => {
  assert.match(source, /role: "tablist"/u);
  assert.match(source, /role: "tab"/u);
  assert.match(source, /role: "tabpanel"/u);
  assert.match(source, /"aria-selected": String\(tab\.id === selected\.id\)/u);
  assert.match(source, /tabindex: tab\.id === selected\.id \? "0" : "-1"/u);
  assert.match(source, /"aria-controls": panelId/u);
  assert.match(source, /"aria-labelledby": selectedTabId/u);
  assert.match(source, /options\.renderPanel\(panelEl, selected\.id\)/u);
  assert.equal(source.match(/options\.renderPanel\(/gu)?.length, 1);
});
