import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [view, quickView, switcher, styles] = await Promise.all([
  readFile(new URL("../src/ui/learning-path-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/practice-lab-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/creation-mode-switch.ts", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
]);

test("guided creation preserves disclosure and active-page scroll state across rerenders", () => {
  assert.match(view, /private readonly disclosureState = new Map<string, boolean>\(\)/u);
  assert.match(view, /private readonly pageScrollPositions = new Map<CreationPage, number>\(\)/u);
  assert.match(view, /this\.pageScrollPositions\.set\(this\.renderedPage, this\.contentEl\.scrollTop\)/u);
  assert.match(view, /this\.contentEl\.scrollTop = restoreScrollTop/u);
  assert.match(view, /private bindDisclosure\(/u);
  assert.match(view, /this\.disclosureState\.set\(key, details\.open\)/u);
});

test("source and engine complexity stays behind calm named disclosures", () => {
  for (const label of [
    "Change source bundle",
    "Review images",
    "Generation engine",
    "Change…",
    "Details · exact provider text",
  ]) {
    assert.ok(view.includes(label), `Missing guided disclosure: ${label}`);
  }
  assert.match(view, /private providerSummary\(\): string/u);
  assert.match(view, /Approve and build path/u);
  assert.match(view, /Approve and generate all sets/u);
});

test("guided creation renders one adaptive page with explicit navigation", () => {
  for (const page of [
    "Material",
    "Review material",
    "Learning goal",
    "Course check",
    "Path plan",
    "Generate sets",
    "Review exercises",
    "Ready",
  ]) {
    assert.ok(view.includes(`label: "${page}"`), `Missing guided page: ${page}`);
  }
  assert.match(view, /if \(this\.page === "material"\) this\.renderMaterialPage\(body\)/u);
  assert.match(view, /else if \(this\.page === "review-material"\) this\.renderReviewMaterialPage\(body\)/u);
  assert.match(view, /else if \(this\.page === "learning-goal"\) this\.renderLearningGoalPage\(body\)/u);
  assert.match(view, /else if \(this\.page === "course-check"\) this\.renderCourseCheckPage\(body\)/u);
  assert.match(view, /else if \(this\.page === "path-plan"\) this\.renderPathPlanPage\(body\)/u);
  assert.match(view, /else if \(this\.page === "generate-sets"\) this\.renderGenerateSetsPage\(body\)/u);
  assert.match(view, /else if \(this\.page === "review-exercises"\) this\.renderReview\(body\)/u);
  assert.match(view, /else this\.renderSaved\(body\)/u);
  assert.match(view, /Step \$\{currentIndex \+ 1\} of \$\{pages\.length\}/u);
  assert.match(view, /setButtonText\("Back"\)/u);
  assert.match(view, /Return to \$\{previous\.label\} without discarding approved work/u);
  assert.match(view, /id !== "course-check" \|\| this\.shouldShowCourseCheck\(\)/u);
});

test("guided material labels can be confirmed atomically before continuing", () => {
  assert.match(view, /confirmSourceClassifications\?:/u);
  assert.match(view, /private async confirmAllSourceClassifications\(\): Promise<void>/u);
  assert.match(view, /Confirm every displayed label in one update/u);
  assert.match(view, /Confirm .* source .* before continuing/u);
  assert.match(view, /Continue to learning goal/u);
});

test("map, batch, and saved views foreground one task and keep detail optional", () => {
  assert.match(view, /private activeMapSetId: string \| null/u);
  assert.match(view, /setButtonText\(expanded \? "Done" : "Customize"\)/u);
  assert.match(view, /advanced\.createEl\("summary", \{ text: "Advanced" \}\)/u);
  assert.match(view, /"Path details"/u);
  assert.match(view, /summary\.createSpan\(\{ text: "Activity" \}\)/u);
  assert.match(view, /practice-learning-path-activity-summary/u);
  assert.match(view, /combineGenerationTelemetry/u);
  assert.match(view, /"More actions"/u);
  assert.match(view, /"Manage path"/u);
  assert.match(view, /return "Generation stopped"/u);
});

test("completed guided sets can be saved without discarding an unfinished batch", () => {
  assert.match(view, /setButtonText\("Approve ready exercises in this set"\)/u);
  assert.match(view, /setButtonText\("Approve ready exercises in all generated sets"\)/u);
  assert.match(view, /partial\s*\? "Save completed sets"/u);
  assert.match(view, /The unfinished batch remains recoverable/u);
  assert.match(view, /const batchComplete = this\.savedWorkspace\.batchComplete !== false/u);
  assert.match(view, /this\.recoveryKind = "generation-batch"/u);
});

test("creation navigation communicates explicit states and the active mode stays visually active", () => {
  for (const state of ["Completed", "Current", "Available", "Needs update", "Locked while generating"]) {
    assert.ok(view.includes(state), `Missing step state: ${state}`);
  }
  assert.match(switcher, /button\.disabled = options\.disabled && !options\.selected/u);
  assert.match(switcher, /"aria-current": options\.selected \? "true" : "false"/u);
});

test("guided layout responds to pane width and bounds disclosure content", () => {
  assert.match(styles, /@container practice-learning-path \(max-width: 720px\)/u);
  assert.match(styles, /@container practice-learning-path \(max-width: 560px\)/u);
  assert.match(styles, /\.practice-learning-path-disclosure-body \{/u);
  assert.match(styles, /overflow-wrap: anywhere/u);
  assert.match(styles, /\.practice-learning-path-current-set \{/u);
  assert.match(styles, /\.practice-learning-path-set-card\.is-compact/u);
});

test("guided source labels stay summarized until the learner reviews them", () => {
  assert.match(view, /"Review labels"/u);
  assert.match(view, /private sourceClassificationSummary\(/u);
  assert.match(view, /private renderSourceClassification\(/u);
  assert.match(view, /confirmSourceClassification\?:/u);
  assert.match(view, /source\.classificationState !== "confirmed"/u);
  assert.match(styles, /\.practice-learning-path-source-label \{/u);
  assert.match(styles, /\.practice-learning-path-source-label\.is-confirmed/u);
});

test("shared study additions have calm focus-visible and narrow-pane styles", () => {
  for (const className of [
    "practice-lab-session-mode-badge",
    "practice-lab-config-disclosure",
    "practice-lab-source-classification",
    "practice-lab-path-compact-current",
    "practice-lab-path-details",
    "practice-lab-answer-review-summary",
    "practice-lab-study-alignment",
    "practice-lab-alignment-record",
  ]) {
    assert.ok(quickView.includes(className), `Shared view no longer emits ${className}`);
    assert.ok(styles.includes(`.${className}`), `Missing style for ${className}`);
  }
  assert.match(styles, /\.practice-lab-view summary:focus-visible/u);
  assert.match(styles, /@container practice-lab \(max-width: 700px\)/u);
  assert.match(styles, /@container practice-lab \(max-width: 520px\)/u);
  assert.match(styles, /\.practice-lab-path-position\.is-compact \{[\s\S]*position: sticky/u);
});

test("the sticky Guided path navigator paints an opaque surface beneath its accent", () => {
  const surface = styles.match(/\.practice-lab-path-position \{(?<body>[\s\S]*?)\n\}/u)?.groups?.body;
  assert.ok(surface, "Missing Guided path navigator surface styles");
  assert.match(surface, /background-color:\s*var\(--background-primary\)/u);
  assert.match(
    surface,
    /background-image:\s*linear-gradient\([\s\S]*var\(--practice-lab-accent-soft\)[\s\S]*transparent 72%/u,
  );
  assert.doesNotMatch(surface, /background:\s*linear-gradient/u);
});
