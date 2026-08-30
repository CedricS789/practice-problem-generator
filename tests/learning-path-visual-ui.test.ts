import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [viewSource, styles] = await Promise.all([
  readFile(new URL("../src/ui/learning-path-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
]);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `Missing source marker: ${start}`);
  assert.ok(endIndex > startIndex, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("guided source selection exposes a configured GIF default and safe bulk actions", () => {
  const implementation = sourceBetween(
    viewSource,
    "private renderVisualBundleControls(",
    "private renderSourceVisuals(",
  );
  assert.match(implementation, /Default GIF frame/u);
  assert.match(implementation, /Select all images/u);
  assert.match(implementation, /Deselect all/u);
  assert.match(implementation, /GIFs without an explicit frame use the configured default/u);
  assert.match(implementation, /videos and remote images still require explicit review/iu);
  assert.match(viewSource, /options\.defaults\.gifFrameDefault \?\? "middle"/u);
  assert.match(viewSource, /updateGifFrameDefault/u);
});

test("every visual can be included independently and GIFs can override the default", () => {
  const implementation = sourceBetween(
    viewSource,
    "private renderVisualCard(",
    "private renderGifFrameChoice(",
  );
  assert.match(implementation, /Use for generation/u);
  assert.match(implementation, /commitVisual/u);
  assert.match(viewSource, /\["first", "middle", "last"\] as const/u);
  assert.match(viewSource, /This choice overrides the configured default for this GIF only/u);
  assert.match(viewSource, /resolveVisualFrame\(source, visual, select\.value as GifFramePosition\)/u);
});

test("remote, video, and unavailable visuals remain explicit and immutable", () => {
  assert.match(viewSource, /Videos are never uploaded directly/u);
  assert.match(viewSource, /original video remains unchanged/iu);
  assert.match(viewSource, /stays excluded until you explicitly preview and import one local snapshot/u);
  assert.match(viewSource, /The source note is not rewritten/u);
  assert.match(viewSource, /The local attachment could not be resolved/u);
  assert.match(viewSource, /The Notability cache preview is missing/u);
  assert.match(viewSource, /updateSourceVisuals/u);
});

test("guided and tutor UI classes have an Obsidian-theme-aware responsive style surface", () => {
  const learningClasses = new Set(
    viewSource.match(/practice-learning-path-[a-z0-9-]+/gu) ?? [],
  );
  learningClasses.delete("practice-learning-path-view");
  for (const className of learningClasses) {
    assert.ok(styles.includes(`.${className}`), `Missing style for ${className}`);
  }
  for (const className of [
    "practice-lab-tutor-lesson",
    "practice-lab-tutor-heading",
    "practice-lab-tutor-objective",
    "practice-lab-tutor-block",
    "practice-lab-tutor-check",
    "practice-lab-tutor-recovery",
    "practice-lab-tutor-hint",
    "practice-lab-tutor-repair",
    "practice-lab-tutor-actions",
  ]) {
    assert.ok(styles.includes(`.${className}`), `Missing style for ${className}`);
  }
  assert.match(styles, /@media \(max-width: 520px\)/u);
  assert.match(styles, /var\(--background-primary\)/u);
  assert.match(styles, /var\(--interactive-accent\)/u);
});

test("map and configure responds to the Obsidian pane width without overlapping controls", () => {
  assert.match(
    styles,
    /\.practice-learning-path-shell \{[\s\S]*container-name: practice-learning-path;[\s\S]*container-type: inline-size;/u,
  );
  assert.match(styles, /@container practice-learning-path \(max-width: 720px\)/u);
  assert.match(styles, /@container practice-learning-path \(max-width: 560px\)/u);
  assert.match(
    styles,
    /\.practice-learning-path-set-heading \{[\s\S]*display: grid;[\s\S]*grid-template-columns: auto minmax\(0, 1fr\) auto;/u,
  );
  assert.match(
    styles,
    /@container practice-learning-path \(max-width: 720px\) \{[\s\S]*\.practice-learning-path-provider-grid,[\s\S]*grid-template-columns: minmax\(0, 1fr\);/u,
  );
  assert.match(
    styles,
    /@container practice-learning-path \(max-width: 560px\) \{[\s\S]*\.practice-learning-path-card-actions \{[\s\S]*grid-column: 2;[\s\S]*\.practice-learning-path-mix-row \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) 44px;/u,
  );
});

test("batch navigator cards bound their status text and animate active generation", () => {
  assert.match(viewSource, /"aria-label": "Set generation status"/u);
  assert.match(viewSource, /"aria-live": "polite"/u);
  assert.match(viewSource, /practice-learning-path-nav-icon/u);
  assert.match(viewSource, /status\.state === "generating" \? " practice-lab-spinner" : ""/u);
  assert.match(viewSource, /practice-learning-path-nav-title/u);
  assert.match(viewSource, /practice-learning-path-nav-status/u);
  assert.match(
    styles,
    /\.practice-learning-path-set-navigator \{[\s\S]*overflow-y: hidden;[\s\S]*padding: var\(--size-2-2\) var\(--size-2-2\) var\(--size-4-3\);/u,
  );
  assert.match(
    styles,
    /\.practice-learning-path-nav-item \{[\s\S]*grid-template-rows: auto auto;[\s\S]*height: auto;[\s\S]*min-height: 68px;/u,
  );
  assert.match(styles, /\.practice-learning-path-nav-icon \{[\s\S]*grid-row: 1 \/ span 2;/u);
  assert.match(styles, /\.practice-learning-path-nav-status \{[\s\S]*grid-row: 2;/u);
  assert.match(styles, /\.practice-lab-spinner svg \{\s+animation: practice-lab-spin/u);
});
