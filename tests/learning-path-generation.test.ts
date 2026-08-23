import assert from "node:assert/strict";
import test from "node:test";

import { balanceExerciseTypes } from "../src/exercise-distribution";
import {
  LEARNING_BLUEPRINT_DRAFT_VERSION,
  PRACTICE_SET_DRAFT_VERSION,
  buildLearningBlueprintPrompt,
  buildPracticeSetPrompt,
  createPracticeSetPayloads,
  learningBlueprintDraftV1JsonSchema,
  practiceSetDraftV1JsonSchema,
  practiceSetPayloadHash,
  validateLearningBlueprintDraft,
  validatePracticeSetBatch,
  validatePracticeSetDraft,
  validatePracticeSetDraftForWorkspace,
  type LearningBlueprintDraftV1,
  type LearningBlueprintPlanningInputV1,
  type PracticeSetDraftV1,
  type PracticeSetPayloadV1,
} from "../src/learning-path-generation";
import type { ExerciseV1, TutorLessonV1 } from "../src/model";
import type { GenerationConfiguration } from "../src/ui/contracts";

const sourceHash = `sha256:${"a".repeat(64)}`;
const supportingHash = `sha256:${"b".repeat(64)}`;

const planningInput: LearningBlueprintPlanningInputV1 = {
  startingLevel: "new-to-topic",
  desiredSetCount: 2,
  globalFocusInstructions: "Build the causal story before transfer.",
  sources: [
    {
      id: "primary",
      role: "primary",
      title: "Synthetic primary",
      mode: "note",
      scope: "complete submitted note",
      hash: sourceHash,
      segments: [
        {
          id: "seg-foundation",
          kind: "paragraph",
          ordinal: 0,
          headingPath: ["Foundation"],
          text: "A wider depletion region lowers junction capacitance.",
        },
      ],
      visuals: [],
    },
    {
      id: "support",
      role: "supporting",
      title: "Synthetic support",
      mode: "pdf",
      scope: "pages 3-4 only",
      hash: supportingHash,
      segments: [
        {
          id: "support:seg-application",
          kind: "paragraph",
          ordinal: 0,
          headingPath: ["Application"],
          text: "Lower capacitance reduces the charge needed for the same voltage change.",
        },
      ],
      visuals: [
        {
          id: "support:visual-curve",
          kind: "image",
          width: 800,
          height: 600,
          altText: "Synthetic capacitance curve",
        },
      ],
    },
  ],
};

const blueprint: LearningBlueprintDraftV1 = {
  schemaVersion: LEARNING_BLUEPRINT_DRAFT_VERSION,
  blueprintId: "blueprint-1",
  title: "Junction capacitance path",
  overview: "Build the mechanism, then apply it.",
  aspects: [
    {
      id: "aspect-foundation",
      title: "Depletion width",
      purpose: "Relate depletion width to junction capacitance.",
      status: "supported",
      prerequisiteAspectIds: [],
      sourceSegmentIds: ["seg-foundation"],
    },
    {
      id: "aspect-application",
      title: "Charge consequence",
      purpose: "Apply the capacitance relation to a voltage change.",
      status: "supported",
      prerequisiteAspectIds: ["aspect-foundation"],
      sourceSegmentIds: ["support:seg-application"],
    },
    {
      id: "gap-doping-profile",
      title: "Doping profile",
      purpose: "Explain the missing material boundary.",
      status: "source-gap",
      prerequisiteAspectIds: [],
      sourceSegmentIds: [],
      gapReason: "No submitted segment explains a doping profile.",
    },
  ],
  tutorLessonBriefs: [
    {
      id: "lesson-foundation",
      title: "Why width changes capacitance",
      objective: "Explain the supported width-to-capacitance relation.",
      aspectIds: ["aspect-foundation"],
      prerequisiteAspectIds: [],
      sourceSegmentIds: ["seg-foundation"],
    },
    {
      id: "lesson-application",
      title: "Carry the relation into charge",
      objective: "Connect lower capacitance to the required charge.",
      aspectIds: ["aspect-application"],
      prerequisiteAspectIds: ["aspect-foundation"],
      sourceSegmentIds: ["support:seg-application"],
    },
  ],
  sets: [
    {
      id: "set-foundation",
      title: "Foundations",
      purpose: "Establish the supported physical relation.",
      instructionalRole: "foundations",
      order: 0,
      aspectIds: ["aspect-foundation"],
      tutorLessonBriefIds: ["lesson-foundation"],
      recommendedQuantity: 2,
      recommendedDifficulty: "foundational",
    },
    {
      id: "set-application",
      title: "Guided application",
      purpose: "Use the established relation in a supported consequence.",
      instructionalRole: "guided-application",
      order: 1,
      aspectIds: ["aspect-application"],
      tutorLessonBriefIds: ["lesson-application"],
      recommendedQuantity: 2,
      recommendedDifficulty: "deep-exam",
    },
  ],
};

function configuration(quantity = 2): GenerationConfiguration {
  return {
    provider: "codex",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    focusInstructions: "Keep the set distinct and source-grounded.",
    quantity,
    difficulty: "deep-exam",
    exerciseTypes: ["short-answer"],
    exerciseTypePercentages: balanceExerciseTypes(["short-answer"]),
    selectedVisualIds: [],
  };
}

function shortAnswer(id: string, segmentId: string): ExerciseV1 {
  return {
    id,
    type: "short-answer",
    title: `Question ${id}`,
    prompt: `Explain the distinct relation for ${id}.`,
    difficulty: "medium",
    sourceSegmentIds: [segmentId],
    groundedAnswer: "The submitted relation provides the answer.",
    acceptableAnswers: ["The submitted relation"],
    keyPoints: ["State the supported relation"],
  };
}

function tutorLesson(
  lessonId: string,
  aspectId: string,
  segmentId: string,
  guidedExerciseId: string,
  prerequisites: readonly string[] = [],
): TutorLessonV1 {
  return {
    id: lessonId,
    title: `Tutor ${lessonId}`,
    objective: "Build the relation from its supported premise.",
    aspectIds: [aspectId],
    prerequisiteAspectIds: [...prerequisites],
    guidedExerciseId,
    teachingBlocks: [
      {
        id: `${lessonId}-why`,
        kind: "why",
        title: "Why it matters",
        content: "This relation controls the supported consequence.",
        sourceSegmentIds: [segmentId],
      },
      {
        id: `${lessonId}-prerequisite`,
        kind: "prerequisite",
        title: "Required premise",
        content: "Begin from the exact submitted relation.",
        sourceSegmentIds: [segmentId],
      },
      {
        id: `${lessonId}-explanation`,
        kind: "explanation",
        title: "Connected explanation",
        content: "Follow the submitted premise to its stated consequence.",
        sourceSegmentIds: [segmentId],
      },
    ],
    selfExplanationCheck: {
      prompt: "Explain the relation in your own words.",
      groundedAnswer: "The supported premise leads to the stated consequence.",
      keyPoints: ["Premise", "Consequence"],
      sourceSegmentIds: [segmentId],
    },
    hints: [
      {
        id: `${lessonId}-hint-1`,
        level: 1,
        text: "Start from the stated premise.",
        sourceSegmentIds: [segmentId],
      },
      {
        id: `${lessonId}-hint-2`,
        level: 2,
        text: "Connect that premise to the stated consequence.",
        sourceSegmentIds: [segmentId],
      },
    ],
    repairExplanation: {
      text: "The source directly connects the premise and consequence.",
      sourceSegmentIds: [segmentId],
    },
  };
}

function payloads(): readonly PracticeSetPayloadV1[] {
  return createPracticeSetPayloads({
    batchId: "batch-1",
    planningInput,
    blueprint,
    setConfigurations: blueprint.sets.map((set) => ({
      setId: set.id,
      configuration: configuration(),
    })),
  });
}

function draftFor(payload: PracticeSetPayloadV1): PracticeSetDraftV1 {
  const isFoundation = payload.targetSet.id === "set-foundation";
  const aspectId = isFoundation ? "aspect-foundation" : "aspect-application";
  const segmentId = isFoundation ? "seg-foundation" : "support:seg-application";
  const lessonId = isFoundation ? "lesson-foundation" : "lesson-application";
  const guidedId = `${payload.targetSet.id}-guided`;
  const independentId = `${payload.targetSet.id}-independent`;
  return {
    schemaVersion: PRACTICE_SET_DRAFT_VERSION,
    setId: payload.targetSet.id,
    exercises: [
      shortAnswer(guidedId, segmentId),
      shortAnswer(independentId, segmentId),
    ],
    assignments: [
      { exerciseId: guidedId, aspectIds: [aspectId], role: "guided-check" },
      { exerciseId: independentId, aspectIds: [aspectId], role: "independent" },
    ],
    tutorLessons: [tutorLesson(
      lessonId,
      aspectId,
      segmentId,
      guidedId,
      isFoundation ? [] : ["aspect-foundation"],
    )],
  };
}

function schemaContainsKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => schemaContainsKey(entry, key));
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return key in record || Object.values(record).some((entry) => schemaContainsKey(entry, key));
}

function objectSchemasWithOptionalProperties(
  value: unknown,
  path = "$",
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => objectSchemasWithOptionalProperties(entry, `${path}/${index}`));
  }
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  const failures: string[] = [];
  if (
    record.type === "object"
    && typeof record.properties === "object"
    && record.properties !== null
    && !Array.isArray(record.properties)
  ) {
    const properties = Object.keys(record.properties);
    const required = new Set(Array.isArray(record.required) ? record.required : []);
    const missing = properties.filter((property) => !required.has(property));
    if (missing.length > 0) failures.push(`${path}: ${missing.join(", ")}`);
  }
  for (const [key, entry] of Object.entries(record)) {
    failures.push(...objectSchemasWithOptionalProperties(entry, `${path}/${key}`));
  }
  return failures;
}

test("learning blueprint and set schemas are strict draft-07 provider contracts", () => {
  assert.equal(learningBlueprintDraftV1JsonSchema.$schema, "http://json-schema.org/draft-07/schema#");
  assert.equal(practiceSetDraftV1JsonSchema.$schema, "http://json-schema.org/draft-07/schema#");
  assert.equal(learningBlueprintDraftV1JsonSchema.additionalProperties, false);
  assert.equal(practiceSetDraftV1JsonSchema.additionalProperties, false);
  assert.equal(schemaContainsKey(learningBlueprintDraftV1JsonSchema, "uniqueItems"), false);
  assert.equal(schemaContainsKey(practiceSetDraftV1JsonSchema, "uniqueItems"), false);
  assert.deepEqual(objectSchemasWithOptionalProperties(learningBlueprintDraftV1JsonSchema), []);
  assert.deepEqual(objectSchemasWithOptionalProperties(practiceSetDraftV1JsonSchema), []);
});

test("blueprint prompt carries the exact approved multi-source payload without vault paths", () => {
  const prompt = buildLearningBlueprintPrompt(planningInput);
  assert.match(prompt, /EXACT APPROVED PLANNING PAYLOAD/u);
  assert.match(prompt, /seg-foundation/u);
  assert.match(prompt, /support:seg-application/u);
  assert.match(prompt, /pages 3-4 only/u);
  assert.match(prompt, /Difficulty controls reasoning demand, not source scope/u);
  assert.match(prompt, /foundational \(Foundational\)/u);
  assert.match(prompt, /deep-exam \(Deep exam practice\)/u);
  assert.match(prompt, /challenge \(Challenge\)/u);
  assert.match(prompt, /source-gap/u);
  assert.match(prompt, /not flashcards, spaced repetition/u);
  assert.doesNotMatch(prompt, /C:\\|OneDrive|School Vault/u);
});

test("blueprint validator accepts disclosed inactive gaps and rejects forward, gap, and LaTeX misuse", () => {
  assert.deepEqual(validateLearningBlueprintDraft(blueprint, planningInput), {
    valid: true,
    value: blueprint,
  });

  const forward: LearningBlueprintDraftV1 = {
    ...blueprint,
    aspects: blueprint.aspects.map((aspect, index) => index === 0
      ? { ...aspect, prerequisiteAspectIds: ["aspect-application"] }
      : aspect),
  };
  const forwardResult = validateLearningBlueprintDraft(forward, planningInput);
  assert.equal(forwardResult.valid, false);
  assert.match(forwardResult.errors?.join(" ") ?? "", /must appear earlier|cycle/iu);

  const gapOwned: LearningBlueprintDraftV1 = {
    ...blueprint,
    sets: blueprint.sets.map((set, index) => index === 0
      ? { ...set, aspectIds: ["gap-doping-profile"] }
      : set),
  };
  const gapResult = validateLearningBlueprintDraft(gapOwned, planningInput);
  assert.equal(gapResult.valid, false);
  assert.match(gapResult.errors?.join(" ") ?? "", /unknown supported aspect/iu);

  const malformedMath: LearningBlueprintDraftV1 = {
    ...blueprint,
    aspects: blueprint.aspects.map((aspect, index) => index === 0
      ? { ...aspect, purpose: "Explain $C = Q/V." }
      : aspect),
  };
  const mathResult = validateLearningBlueprintDraft(malformedMath, planningInput);
  assert.equal(mathResult.valid, false);
  assert.match(mathResult.errors?.join(" ") ?? "", /Unclosed inline LaTeX/u);

  const duplicateReference: LearningBlueprintDraftV1 = {
    ...blueprint,
    aspects: blueprint.aspects.map((aspect, index) => index === 0
      ? { ...aspect, sourceSegmentIds: ["seg-foundation", "seg-foundation"] }
      : aspect),
  };
  const duplicateResult = validateLearningBlueprintDraft(duplicateReference, planningInput);
  assert.equal(duplicateResult.valid, false);
  assert.match(duplicateResult.errors?.join(" ") ?? "", /sourceSegmentIds.*unique/iu);
});

test("supporting segment and visual IDs must be namespaced", () => {
  const unsafe: LearningBlueprintPlanningInputV1 = {
    ...planningInput,
    sources: planningInput.sources.map((source, index) => index === 1
      ? {
          ...source,
          segments: source.segments.map((segment) => ({ ...segment, id: "seg-collision" })),
          visuals: source.visuals.map((visual) => ({ ...visual, id: "visual-collision" })),
        }
      : source),
  };
  assert.throws(
    () => buildLearningBlueprintPrompt(unsafe),
    /must be namespaced with support:/iu,
  );
});

test("per-set payloads are exact, sequentially ordered, and contain global sibling context", () => {
  const generatedPayloads = payloads();
  assert.deepEqual(generatedPayloads.map((payload) => payload.targetSet.id), [
    "set-foundation",
    "set-application",
  ]);
  assert.equal(generatedPayloads[0]!.sources.length, 2);
  assert.equal(generatedPayloads[0]!.siblingSets.length, 2);
  assert.equal(generatedPayloads[1]!.aspects.length, 3);
  assert.match(practiceSetPayloadHash(generatedPayloads[0]!), /^sha256:[a-f0-9]{64}$/u);
  const prompt = buildPracticeSetPrompt(generatedPayloads[1]!);
  assert.match(prompt, /set-foundation/u);
  assert.match(prompt, /set-application/u);
  assert.match(prompt, /support:seg-application/u);
  assert.match(prompt, /exactly 2 exercises/u);
  assert.match(prompt, /Difficulty profile: deep-exam/u);
  assert.match(prompt, /medium and hard items/u);
  assert.match(prompt, /Do not manufacture difficulty by withholding necessary evidence/u);
  assert.doesNotMatch(prompt, /C:\\|OneDrive|School Vault/u);
});

test("payload creation enforces per-set and whole-path exercise limits", () => {
  assert.throws(
    () => createPracticeSetPayloads({
      batchId: "batch-1",
      planningInput,
      blueprint,
      setConfigurations: blueprint.sets.map((set) => ({
        setId: set.id,
        configuration: configuration(31),
      })),
    }),
    /quantity must be a whole number from 1 to 30/iu,
  );

  const threeSetBlueprint: LearningBlueprintDraftV1 = {
    ...blueprint,
    sets: [
      ...blueprint.sets,
      {
        id: "set-third",
        title: "Third set",
        purpose: "A distinct third set.",
        instructionalRole: "independent-transfer",
        order: 2,
        aspectIds: ["aspect-application"],
        tutorLessonBriefIds: [],
        recommendedQuantity: 1,
        recommendedDifficulty: "challenge",
      },
    ],
  };
  assert.throws(
    () => createPracticeSetPayloads({
      batchId: "batch-1",
      planningInput: { ...planningInput, desiredSetCount: 3 },
      blueprint: threeSetBlueprint,
      setConfigurations: threeSetBlueprint.sets.map((set) => ({
        setId: set.id,
        configuration: configuration(21),
      })),
    }),
    /maximum is 60/iu,
  );
});

test("set validation enforces grounded exercises, assignments, tutor checks, and staged hints", () => {
  const payload = payloads()[0]!;
  const draft = draftFor(payload);
  assert.deepEqual(validatePracticeSetDraft(draft, payload), {
    valid: true,
    value: draft,
  });

  const brokenTutor = structuredClone(draft);
  brokenTutor.tutorLessons[0]!.guidedExerciseId = "missing-exercise";
  brokenTutor.tutorLessons[0]!.hints[1]!.level = 1;
  brokenTutor.tutorLessons[0]!.repairExplanation.sourceSegmentIds = ["seg-missing"];
  brokenTutor.tutorLessons[0]!.selfExplanationCheck.keyPoints = ["Premise", "Premise"];
  const brokenResult = validatePracticeSetDraft(brokenTutor, payload);
  assert.equal(brokenResult.valid, false);
  assert.match(brokenResult.errors?.join(" ") ?? "", /unknown exercise/iu);
  assert.match(brokenResult.errors?.join(" ") ?? "", /hint levels/iu);
  assert.match(brokenResult.errors?.join(" ") ?? "", /unknown source segment/iu);
  assert.match(brokenResult.errors?.join(" ") ?? "", /keyPoints.*unique/iu);

  const brokenVisual: PracticeSetDraftV1 = {
    ...draft,
    exercises: [
      {
        id: draft.exercises[0]!.id,
        type: "image-occlusion",
        title: "Broken visual",
        prompt: "Identify $V_{PD}$.",
        difficulty: "medium",
        sourceSegmentIds: ["seg-foundation"],
        visualId: "visual-missing",
        masks: [
          {
            id: "mask-1",
            x: 0.9,
            y: 0.9,
            width: 0.2,
            height: 0.2,
            label: "Node $V_{PD}$",
            answer: "$V_{PD$",
          },
        ],
        groundedAnswer: "The hidden node is $V_{PD}$.",
      },
      ...draft.exercises.slice(1),
    ],
  };
  const visualResult = validatePracticeSetDraft(brokenVisual, payload);
  assert.equal(visualResult.valid, false);
  assert.match(visualResult.errors?.join(" ") ?? "", /unknown visual/iu);
  assert.match(visualResult.errors?.join(" ") ?? "", /normalized bounds/iu);
  assert.match(visualResult.errors?.join(" ") ?? "", /unclosed brace/iu);
});

test("workspace-bound set validation rejects relationships that would fail only at save", () => {
  const payload = payloads()[0]!;
  const assignmentMismatch = structuredClone(draftFor(payload));
  assignmentMismatch.exercises[0]!.sourceSegmentIds = ["support:seg-application"];
  assert.equal(validatePracticeSetDraft(assignmentMismatch, payload).valid, true);
  const assignmentResult = validatePracticeSetDraftForWorkspace(
    assignmentMismatch,
    payload,
  );
  assert.equal(assignmentResult.valid, false);
  assert.match(assignmentResult.errors?.join(" ") ?? "", /assigned aspects must own/iu);

  const tutorMismatch = structuredClone(draftFor(payload));
  tutorMismatch.tutorLessons[0]!.prerequisiteAspectIds = ["aspect-foundation"];
  tutorMismatch.tutorLessons[0]!.teachingBlocks[0]!.sourceSegmentIds = [
    "support:seg-application",
  ];
  assert.equal(validatePracticeSetDraft(tutorMismatch, payload).valid, true);
  const tutorResult = validatePracticeSetDraftForWorkspace(tutorMismatch, payload);
  assert.equal(tutorResult.valid, false);
  assert.match(tutorResult.errors?.join(" ") ?? "", /non-overlapping/iu);
  assert.match(tutorResult.errors?.join(" ") ?? "", /evidence owned/iu);
});

test("whole-batch validation rejects duplicate exercises across otherwise valid sets", () => {
  const generatedPayloads = payloads();
  const drafts = generatedPayloads.map((payload) => draftFor(payload));
  assert.equal(validatePracticeSetBatch({ payloads: generatedPayloads, drafts }).valid, true);

  const duplicated = structuredClone(drafts);
  duplicated[1]!.exercises[0]!.id = duplicated[0]!.exercises[0]!.id;
  duplicated[1]!.assignments[0]!.exerciseId = duplicated[0]!.exercises[0]!.id;
  duplicated[1]!.tutorLessons[0]!.guidedExerciseId = duplicated[0]!.exercises[0]!.id;
  duplicated[1]!.exercises[0]!.prompt = duplicated[0]!.exercises[0]!.prompt;
  const result = validatePracticeSetBatch({ payloads: generatedPayloads, drafts: duplicated });
  assert.equal(result.valid, false);
  assert.match(result.errors?.join(" ") ?? "", /duplicated across/iu);
});
