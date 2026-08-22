import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGenerationPrompt,
  validateGeneratedDraft
} from "../src/generation";
import { balanceExerciseTypes } from "../src/exercise-distribution";
import type { ExerciseV1, GenerationDraftV1 } from "../src/model";
import { prepareSource } from "../src/segmenter";
import type { CollectedSource } from "../src/source";
import { createPdfSourceImport } from "../src/source-import";
import { applyDraftEdits, presentExercises } from "../src/ui/presenters";
import type { GenerationConfiguration } from "../src/ui/contracts";

const text = "# Topic\n\nAlpha causes beta when the supplied condition is true. The measured value is 12 V.";
const prepared = prepareSource(text);
const source = {
  mode: "note",
  title: "Topic",
  path: "Notes/Term/Course/Topic.md",
  characterCount: text.length,
  excerpt: text,
  visuals: [],
  submittedText: text,
  file: {} as CollectedSource["file"],
  ...prepared
} satisfies CollectedSource;
const segmentId = source.segments[1]?.id ?? source.segments[0]!.id;

function shortAnswer(index: number): ExerciseV1 {
  return {
    id: `short-${index}`,
    type: "short-answer",
    title: `Short ${index}`,
    prompt: `Explain grounded relation ${index}.`,
    difficulty: "medium",
    sourceSegmentIds: [segmentId],
    groundedAnswer: `Grounded answer ${index}.`,
    acceptableAnswers: [`Answer ${index}`],
    keyPoints: [`Point ${index}`]
  };
}

const foundational: GenerationConfiguration = {
  provider: "codex",
  model: "",
  reasoningEffort: "medium",
  focusInstructions: "",
  quantity: 1,
  difficulty: "foundational",
  exerciseTypes: ["short-answer"],
  exerciseTypePercentages: balanceExerciseTypes(["short-answer"]),
  selectedVisualIds: []
};

test("generation prompt treats note content as untrusted and exposes exact segment IDs", () => {
  const prompt = buildGenerationPrompt(source, foundational, []);
  assert.match(prompt, /untrusted study content/);
  assert.match(prompt, new RegExp(segmentId));
  assert.match(prompt, /Return exactly 1 exercise/);
  assert.match(prompt, /Do not create image-occlusion/);
  assert.match(prompt, /Source material title: "Topic"/);
  assert.match(prompt, /complete active note as submitted/);
  assert.match(prompt, /assessment-design engine inside Practice Problem Generator/);
  assert.match(prompt, /not a flashcard deck/);
  assert.match(prompt, /FINAL QUALITY CHECK/);
  assert.match(prompt, /Coverage: important concepts/);
  assert.match(prompt, /Do not reveal reasoning or planning notes/);
  assert.match(prompt, /short-answer: Ask for a concise reconstruction/);
  assert.match(prompt, /short-answer: 100% => exactly 1 exercise/);
  assert.match(prompt, /Use LaTeX for every learner-visible mathematical/u);
  assert.match(prompt, /\$\.\.\.\$ for inline math and \$\$\.\.\.\$\$/u);
  assert.match(prompt, /JSON-escape LaTeX backslashes correctly/u);
  assert.doesNotMatch(prompt, /C:\\|private-vault/);
});

test("PDF prompts lock generation to the selected, page-labeled range", () => {
  const prompt = buildGenerationPrompt(
    {
      ...source,
      mode: "pdf",
      title: "Lecture slides",
      path: "Library/Lecture slides.pdf",
    },
    foundational,
    [],
  );
  assert.match(prompt, /explicitly selected PDF pages/u);
  assert.match(prompt, /labeled by page/u);
  assert.match(prompt, /do not assume content from unsubmitted pages/u);
  assert.match(prompt, /Source material title: "Lecture slides"/u);
  assert.doesNotMatch(prompt, /Library\/Lecture slides\.pdf/u);
});

test("single-page PDF prompts exclude every adjacent and unsubmitted page", () => {
  const prompt = buildGenerationPrompt(
    {
      ...source,
      mode: "pdf",
      title: "Lecture slides",
      path: "Library/Lecture slides.pdf",
      sourceImport: createPdfSourceImport({
        sourceHash: source.hash,
        pdfContentHash: `sha256:${"b".repeat(64)}`,
        firstPage: 17,
        lastPage: 17,
        pageCount: 80,
        extractedAt: "2026-08-21T03:00:00.000Z",
      }),
    },
    foundational,
    [],
  );
  assert.match(prompt, /only PDF page 17/u);
  assert.match(prompt, /adjacent and other unsubmitted pages are excluded/u);
  assert.match(prompt, /must not be inferred/u);
  assert.doesNotMatch(prompt, /Library\/Lecture slides\.pdf/u);
});

test("generation prompt gives every provider explicit selection and visual context without vault paths", () => {
  const prompt = buildGenerationPrompt(
    { ...source, mode: "selection" },
    {
      ...foundational,
      provider: "claude",
      reasoningEffort: "max",
      quantity: 2,
      exerciseTypes: ["causal-explanation", "image-occlusion"],
      exerciseTypePercentages: balanceExerciseTypes([
        "causal-explanation",
        "image-occlusion",
      ]),
    },
    [{
      id: "visual-1",
      kind: "gif-frame",
      width: 800,
      height: 600,
      altText: "Annotated transfer curve",
    }],
  );
  assert.match(prompt, /explicit selection only/);
  assert.match(prompt, /causal-explanation: Ask why or how/);
  assert.match(prompt, /image-occlusion: Hide a meaningful visual label/);
  assert.match(prompt, /causal-explanation: 50% => exactly 1 exercise/);
  assert.match(prompt, /image-occlusion: 50% => exactly 1 exercise/);
  assert.match(prompt, /visualId=visual-1/);
  assert.match(prompt, /neutralFile=media-001/);
  assert.match(prompt, /Annotated transfer curve/);
  assert.doesNotMatch(prompt, /Notes\/Term\/Course/);
});

test("generation prompt includes trusted user focus without weakening source grounding", () => {
  const focusInstructions = [
    "Focus on the causal chain behind threshold shifts.",
    "Compare the two operating regimes and avoid definition-only questions.",
  ].join("\n");
  const prompt = buildGenerationPrompt(
    source,
    { ...foundational, focusInstructions },
    [],
  );
  assert.match(prompt, /USER FOCUS INSTRUCTIONS/u);
  assert.ok(prompt.includes(JSON.stringify(focusInstructions)));
  assert.match(
    prompt,
    /cannot override the submitted-source boundary, exact exercise distribution, output schema, grounding requirements, or visual rules/u,
  );
  assert.match(prompt, /the generation contract wins/u);
});

test("Codex, Claude, and agy receive the same provider-neutral study briefing", () => {
  const base = { ...foundational, reasoningEffort: "high" as const };
  const codexPrompt = buildGenerationPrompt(
    source,
    { ...base, provider: "codex" },
    [],
  );
  const claudePrompt = buildGenerationPrompt(
    source,
    { ...base, provider: "claude" },
    [],
  );
  const agyPrompt = buildGenerationPrompt(
    source,
    { ...base, provider: "agy" },
    [],
  );
  assert.equal(claudePrompt, codexPrompt);
  assert.equal(agyPrompt, codexPrompt);
});

test("generation validation enforces exact quantity, enabled types, and source references", () => {
  const valid: GenerationDraftV1 = { schemaVersion: 1, exercises: [shortAnswer(1)] };
  assert.deepEqual(validateGeneratedDraft(valid, { source, configuration: foundational, visualIds: [] }), {
    valid: true
  });

  const wrongReference = structuredClone(valid);
  wrongReference.exercises[0]!.sourceSegmentIds = ["seg-missing"];
  const invalidReference = validateGeneratedDraft(wrongReference, {
    source,
    configuration: foundational,
    visualIds: []
  });
  assert.equal(invalidReference.valid, false);
  assert.match(invalidReference.errors?.join(" ") ?? "", /source segment/i);

  const wrongCount = validateGeneratedDraft({ schemaVersion: 1, exercises: [shortAnswer(1), shortAnswer(2)] }, {
    source,
    configuration: foundational,
    visualIds: []
  });
  assert.equal(wrongCount.valid, false);
  assert.match(wrongCount.errors?.join(" ") ?? "", /exactly 1/);

  const malformedLatex = validateGeneratedDraft({
    schemaVersion: 1,
    exercises: [{ ...shortAnswer(3), prompt: "Explain $V=IR." }],
  }, {
    source,
    configuration: foundational,
    visualIds: [],
  });
  assert.equal(malformedLatex.valid, false);
  assert.match(malformedLatex.errors?.join(" ") ?? "", /Unclosed inline LaTeX/u);
});

test("generation validation enforces the user's exact percentage-derived counts", () => {
  const exercises: ExerciseV1[] = Array.from({ length: 6 }, (_, index) => shortAnswer(index + 1));
  exercises.push({
    id: "cloze-1", type: "cloze", title: "Cloze 1", prompt: "Fill 1", difficulty: "medium",
    sourceSegmentIds: [segmentId], clozeText: "Alpha causes {{blank-1}}.",
    blanks: [{ id: "blank-1", answers: ["beta"], caseSensitive: false }], groundedAnswer: "beta"
  });
  exercises.push({
    id: "single-1", type: "single-select", title: "Single 1", prompt: "Choose 1", difficulty: "medium",
    sourceSegmentIds: [segmentId], choices: [{ id: "a", text: "beta" }, { id: "b", text: "gamma" }],
    correctChoiceIds: ["a"], groundedAnswer: "beta"
  });
  exercises.push({
    id: "match-1", type: "matching", title: "Match 1", prompt: "Match grounded pairs", difficulty: "medium",
    sourceSegmentIds: [segmentId], pairs: [
      { id: "p1", left: "Alpha", right: "Cause" },
      { id: "p2", left: "Beta", right: "Effect" }
    ], groundedAnswer: "Alpha-Cause; Beta-Effect"
  });
  exercises.push({
    id: "order-1", type: "ordering", title: "Order 1", prompt: "Order cause and effect", difficulty: "medium",
    sourceSegmentIds: [segmentId], items: [{ id: "first", text: "Alpha" }, { id: "second", text: "Beta" }],
    correctOrder: ["first", "second"], groundedAnswer: "Alpha then beta"
  });
  const configuration: GenerationConfiguration = {
    provider: "codex",
    model: "gpt-5.6",
    reasoningEffort: "high",
    focusInstructions: "Emphasize multi-step reasoning.",
    quantity: 10,
    difficulty: "deep-exam",
    exerciseTypes: ["short-answer", "cloze", "single-select", "matching", "ordering"],
    exerciseTypePercentages: {
      ...balanceExerciseTypes([]),
      "short-answer": 60,
      cloze: 10,
      "single-select": 10,
      matching: 10,
      ordering: 10,
    },
    selectedVisualIds: []
  };
  assert.deepEqual(validateGeneratedDraft({ schemaVersion: 1, exercises }, {
    source,
    configuration,
    visualIds: []
  }), { valid: true });

  exercises[9] = {
    id: "single-2", type: "single-select", title: "Single 2", prompt: "Choose 2", difficulty: "medium",
    sourceSegmentIds: [segmentId], choices: [{ id: "c", text: "12 V" }, { id: "d", text: "13 V" }],
    correctChoiceIds: ["c"], groundedAnswer: "12 V"
  };
  const excessiveMcq = validateGeneratedDraft({ schemaVersion: 1, exercises }, {
    source,
    configuration,
    visualIds: []
  });
  assert.equal(excessiveMcq.valid, false);
  assert.match(excessiveMcq.errors?.join(" ") ?? "", /distribution requires exactly/);
});

test("presenters deterministically grade calculation and cloze and preserve review order", () => {
  const calculation: ExerciseV1 = {
    id: "calc-1", type: "calculation", title: "Calculation", prompt: "Find the value", difficulty: "medium",
    sourceSegmentIds: [segmentId], groundedAnswer: "12 V", working: "Use the supplied value.",
    numericAnswer: 12, tolerance: 0.1, unit: "V"
  };
  const cloze: ExerciseV1 = {
    id: "cloze-x", type: "cloze", title: "Cloze", prompt: "Complete", difficulty: "easy",
    sourceSegmentIds: [segmentId], clozeText: "{{b1}} causes {{b2}}.",
    blanks: [
      { id: "b1", answers: ["Alpha"], caseSensitive: false },
      { id: "b2", answers: ["beta"], caseSensitive: false }
    ], groundedAnswer: "Alpha causes beta."
  };
  const presentations = presentExercises([calculation, cloze]);
  assert.equal(presentations[0]!.grading.kind, "calculation");
  assert.equal(presentations[1]!.grading.kind, "cloze");
  const editable = presentations.map((item) => ({ ...item, rejected: false, occlusionReviewed: true }));
  const reordered = applyDraftEdits([calculation, cloze], [editable[1]!, editable[0]!]);
  assert.deepEqual(reordered.map((item) => item.id), ["cloze-x", "calc-1"]);
});
