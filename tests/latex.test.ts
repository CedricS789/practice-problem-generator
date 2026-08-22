import assert from "node:assert/strict";
import test from "node:test";

import {
  exerciseLatexMarkupProblems,
  hasLatexMarkup,
  latexMarkupProblem,
  offsetIsInsideLatexMath,
  parseLatexMarkup,
} from "../src/latex";
import type { ExerciseV1 } from "../src/model";

test("canonical inline and display LaTeX parse without changing prose", () => {
  const value = "The gain is $A_v=-g_mR_D$.\n\n$$f_c=\\frac{1}{2\\pi RC}$$";
  const parsed = parseLatexMarkup(value);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const math = parsed.segments.filter((segment) => segment.kind === "math");
  assert.deepEqual(
    math.map((segment) => ({ value: segment.value, display: segment.display })),
    [
      { value: "A_v=-g_mR_D", display: false },
      { value: "f_c=\\frac{1}{2\\pi RC}", display: true },
    ],
  );
  assert.equal(hasLatexMarkup(value), true);
});

test("literal dollars stay text while canonical math remains detectable", () => {
  const parsed = parseLatexMarkup("Cost \\$5; solve $x=2$.");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.segments[0]?.kind, "text");
  assert.equal(parsed.segments[0]?.value, "Cost $5; solve ");
  assert.equal(hasLatexMarkup("Cost \\$5"), false);
});

test("malformed or noncanonical LaTeX fails with an actionable problem", () => {
  for (const [value, expected] of [
    ["$V=IR", /Unclosed inline/u],
    ["$V=\nIR$", /cannot span multiple lines/u],
    ["$\\frac{V}{R$", /unclosed brace/u],
    ["\\(V=IR\\)", /Use \$\.\.\.\$/u],
    ["$$V=$IR$$", /single \$/u],
  ] as const) {
    assert.match(latexMarkupProblem(value) ?? "", expected);
  }
  assert.equal(latexMarkupProblem("$\\left\\{x\\right\\}$"), null);
  assert.equal(latexMarkupProblem("$$a \\\\[4pt] b$$"), null);
});

test("cloze placeholders can be located inside or outside math spans", () => {
  const value = "Complete {{plain}} and $V={{symbol}}R$.";
  const plainOffset = value.indexOf("{{plain}}");
  const mathOffset = value.indexOf("{{symbol}}");
  assert.equal(offsetIsInsideLatexMath(value, plainOffset), false);
  assert.equal(offsetIsInsideLatexMath(value, mathOffset), true);
});

test("learner-visible generated fields report exact LaTeX paths", () => {
  const exercise: ExerciseV1 = {
    id: "calc-1",
    type: "calculation",
    title: "Ohm's law",
    prompt: "Find $V=IR$.",
    difficulty: "medium",
    sourceSegmentIds: ["segment-1"],
    groundedAnswer: "The answer is $V=12\\,\\mathrm{V}$.",
    working: "Use $V=IR$ and substitute the values.",
    numericAnswer: 12,
    tolerance: 0.1,
    unit: "$\\mathrm{V}$",
  };
  assert.deepEqual(exerciseLatexMarkupProblems(exercise, 0), []);
  assert.deepEqual(
    exerciseLatexMarkupProblems({ ...exercise, working: "Use $V=IR." }, 3),
    ["/exercises/3/working: Unclosed inline LaTeX delimiter."],
  );
});

test("every exercise-specific learner-facing field is checked", () => {
  const base = {
    id: "exercise",
    title: "Title",
    prompt: "Prompt",
    difficulty: "medium" as const,
    sourceSegmentIds: ["segment-1"],
    groundedAnswer: "Answer",
  };
  const cases: readonly [ExerciseV1, string][] = [
    [{
      ...base,
      type: "short-answer",
      acceptableAnswers: ["$broken"],
      keyPoints: ["Point"],
    }, "/acceptableAnswers/0"],
    [{
      ...base,
      type: "causal-explanation",
      keyPoints: ["$broken"],
    }, "/keyPoints/0"],
    [{
      ...base,
      type: "application",
      scenario: "$broken",
      keyPoints: ["Point"],
    }, "/scenario"],
    [{
      ...base,
      type: "calculation",
      working: "$broken",
      numericAnswer: 1,
      tolerance: 0,
      unit: "1",
    }, "/working"],
    [{
      ...base,
      type: "cloze",
      clozeText: "Complete {{value}}.",
      blanks: [{ id: "value", answers: ["$broken"], caseSensitive: false }],
    }, "/blanks/0/answers/0"],
    [{
      ...base,
      type: "single-select",
      choices: [{ id: "one", text: "$broken" }],
      correctChoiceIds: ["one"],
    }, "/choices/0/text"],
    [{
      ...base,
      type: "multi-select",
      choices: [{ id: "one", text: "$broken" }],
      correctChoiceIds: ["one"],
    }, "/choices/0/text"],
    [{
      ...base,
      type: "matching",
      pairs: [{ id: "one", left: "Left", right: "$broken" }],
    }, "/pairs/0/right"],
    [{
      ...base,
      type: "ordering",
      items: [{ id: "one", text: "$broken" }],
      correctOrder: ["one"],
    }, "/items/0/text"],
    [{
      ...base,
      type: "image-occlusion",
      visualId: "visual-1",
      masks: [{
        id: "one",
        label: "$broken",
        answer: "Answer",
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.2,
      }],
    }, "/masks/0/label"],
  ];

  for (const [exercise, expectedPath] of cases) {
    const problems = exerciseLatexMarkupProblems(exercise, 2);
    assert.ok(
      problems.some((problem) => problem.startsWith(`/exercises/2${expectedPath}:`)),
      `${exercise.type} did not validate ${expectedPath}: ${problems.join("; ")}`,
    );
  }
});
