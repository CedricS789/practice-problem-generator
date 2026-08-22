import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const surfacePaths = [
  "../src/frame-picker.ts",
  "../src/remote-import.ts",
  "../src/ui/destructive-confirmation-modal.ts",
  "../src/ui/learning-path-view.ts",
  "../src/ui/offline-readiness-modal.ts",
  "../src/ui/pdf-extraction-progress-modal.ts",
  "../src/ui/pdf-page-range-modal.ts",
  "../src/ui/practice-dashboard-view.ts",
  "../src/ui/practice-lab-view.ts",
  "../src/ui/practice-set-picker-modal.ts",
  "../src/ui/saved-set-generation-modal.ts",
  "../src/ui/source-material-picker-modal.ts",
  "../src/ui/study-order-modal.ts",
] as const;

const surfaceSources = await Promise.all(surfacePaths.map(async (path) => ({
  path,
  source: await readFile(new URL(path, import.meta.url), "utf8"),
})));
const hoverSource = await readFile(
  new URL("../src/ui/hover-descriptions.ts", import.meta.url),
  "utf8",
);

test("every plugin view and modal installs hover descriptions over its complete surface", () => {
  for (const { path, source } of surfaceSources) {
    assert.match(source, /installHoverDescriptions\(this\.(?:contentEl|modalEl)\)/u, path);
    if (/extends (?:Modal|FuzzySuggestModal)/u.test(source)) {
      assert.match(source, /installHoverDescriptions\(this\.modalEl\)/u, path);
    }
  }
});

test("labeled icon buttons retain their text for hover and keyboard descriptions", () => {
  for (const { path, source } of surfaceSources) {
    assert.deepEqual(lateIconsInButtonChains(source), [], path);
  }
});

test("even an accidentally unlabeled button receives a safe hover fallback", () => {
  assert.match(hoverSource, /control\.instanceOf\(HTMLButtonElement\)/u);
  assert.match(hoverSource, /return "Activate this button\.";/u);
});

function lateIconsInButtonChains(source: string): readonly string[] {
  const lines = source.split(/\r?\n/u);
  const lateIcons: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*\.setIcon\(/u.test(lines[index] ?? "")) continue;
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      const line = lines[previous] ?? "";
      if (/new ButtonComponent/u.test(line)) break;
      if (/^\s*\.setButtonText\(/u.test(line)) {
        lateIcons.push(`line ${index + 1}: ${(lines[index] ?? "").trim()}`);
        break;
      }
      if (/^\s*(?:const|let|return)\b/u.test(line) || /^\s*(?:\}|\))\)?;?\s*$/u.test(line)) break;
    }
  }
  return lateIcons;
}
