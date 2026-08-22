import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [renderer, view, bank, occlusion, styles] = await Promise.all([
  readFile(new URL("../src/ui/latex-renderer.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/practice-lab-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/bank-statistics-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/occlusion-editor.ts", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
]);

test("learner-facing item surfaces use Obsidian MathJax rendering", () => {
  assert.match(renderer, /renderMath\(segment\.value, segment\.display\)/u);
  assert.match(renderer, /finishRenderMath\(\)/u);
  for (const surface of [
    "studyPrompt(exercise)",
    "choice.text",
    "left.text",
    "byId.get(id) ?? id",
    "mask.label",
    "grading.unit",
    "exercise.groundedAnswer",
    "exercise.rationale",
    "submitted.answer",
    "review.status.feedback",
    "result.feedback",
  ]) {
    assert.ok(view.includes(surface), `Missing math-capable study surface: ${surface}`);
  }
  assert.match(view, /renderLatexMarkup\(prompt, studyPrompt\(exercise\)\)/u);
  assert.match(view, /Available matching answers/u);
  assert.match(view, /text: `Answer \$\{index \+ 1\}`/u);
});

test("review editing exposes previews and blocks malformed math", () => {
  assert.match(view, /Rendered math preview/u);
  assert.match(view, /Prompt LaTeX:/u);
  assert.match(view, /Grounded-answer LaTeX:/u);
  assert.match(view, /invalidLatexCount/u);
  assert.match(view, /\\boxed\{\\\\text\{blank \$\{number\}\}\}/u);
  assert.match(occlusion, /practice-lab-mask-math-preview/u);
});

test("saved AI feedback and narrow layouts retain readable equations", () => {
  assert.match(bank, /renderLatexMarkup\(title, exerciseTitle\)/u);
  assert.match(bank, /renderLatexMarkup\(submittedValue/u);
  assert.match(bank, /renderLatexMarkup\(feedbackValue/u);
  assert.match(styles, /mjx-container\[display="true"\]/u);
  assert.match(styles, /overflow-x: auto/u);
  assert.match(styles, /practice-lab-draft-preview-grid/u);
});
