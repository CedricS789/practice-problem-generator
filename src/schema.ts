import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

import {
  CURRENT_PRACTICE_BANK_SCHEMA_VERSION,
  GENERATION_DRAFT_SCHEMA_VERSION,
  LEGACY_PRACTICE_BANK_SCHEMA_VERSION,
  PRACTICE_BANK_SCHEMA_VERSION,
  PRACTICE_BANK_V3_SCHEMA_VERSION,
  SOURCE_ALIGNMENT_DRAFT_SCHEMA_VERSION,
  SOURCE_ALIGNMENT_SCHEMA_VERSION,
  type AiReviewRequestV2,
  type AiReviewSessionItemResultV2,
  type ExerciseV1,
  type GenerationDraftV1,
  type PracticeBankV1,
  type PracticeBankV2,
  type PracticeBankV3,
  type PracticeBankV4,
  type SourceAlignmentDraftV1,
  type SessionSummaryV1,
  type SessionSummaryV2,
  type ValidationIssue,
  type ValidationResult,
  type VisualSourceV1,
} from "./model";
import { learningPathBankIssues } from "./learning-path";
import { sourceAlignmentIssues } from "./source-alignment";
import { sha256Hex } from "./segmenter";

type JsonSchema = Record<string, unknown>;

const NON_EMPTY_STRING: JsonSchema = { type: "string", minLength: 1 };
const ID_STRING: JsonSchema = {
  type: "string",
  minLength: 1,
  maxLength: 160,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
};
const SHA256_STRING: JsonSchema = {
  type: "string",
  pattern: "^sha256:[0-9a-f]{64}$",
};

const commonExerciseProperties: Record<string, JsonSchema> = {
  id: ID_STRING,
  title: NON_EMPTY_STRING,
  prompt: NON_EMPTY_STRING,
  difficulty: { enum: ["easy", "medium", "hard"] },
  sourceSegmentIds: {
    type: "array",
    minItems: 1,
    items: ID_STRING,
  },
};

function objectSchema(
  properties: Record<string, JsonSchema>,
  required: string[],
): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  };
}

function exerciseSchema(
  type: ExerciseV1["type"],
  specificProperties: Record<string, JsonSchema>,
  specificRequired: string[],
): JsonSchema {
  const commonRequired = [
    "id",
    "type",
    "title",
    "prompt",
    "difficulty",
    "sourceSegmentIds",
  ];
  return objectSchema(
    {
      ...commonExerciseProperties,
      type: { type: "string", const: type },
      ...specificProperties,
    },
    [...commonRequired, ...specificRequired],
  );
}

const choiceSchema = objectSchema(
  { id: ID_STRING, text: NON_EMPTY_STRING },
  ["id", "text"],
);
const maskSchema = objectSchema(
  {
    id: ID_STRING,
    x: { type: "number", minimum: 0, maximum: 1 },
    y: { type: "number", minimum: 0, maximum: 1 },
    width: { type: "number", exclusiveMinimum: 0, maximum: 1 },
    height: { type: "number", exclusiveMinimum: 0, maximum: 1 },
    label: NON_EMPTY_STRING,
    answer: NON_EMPTY_STRING,
  },
  ["id", "x", "y", "width", "height", "label", "answer"],
);

const exerciseSchemas: JsonSchema[] = [
  exerciseSchema(
    "short-answer",
    {
      groundedAnswer: NON_EMPTY_STRING,
      acceptableAnswers: {
        type: "array",
        minItems: 1,
        items: NON_EMPTY_STRING,
      },
      keyPoints: {
        type: "array",
        minItems: 1,
        items: NON_EMPTY_STRING,
      },
    },
    ["groundedAnswer", "acceptableAnswers", "keyPoints"],
  ),
  exerciseSchema(
    "causal-explanation",
    {
      groundedAnswer: NON_EMPTY_STRING,
      keyPoints: {
        type: "array",
        minItems: 1,
        items: NON_EMPTY_STRING,
      },
    },
    ["groundedAnswer", "keyPoints"],
  ),
  exerciseSchema(
    "application",
    {
      scenario: NON_EMPTY_STRING,
      groundedAnswer: NON_EMPTY_STRING,
      keyPoints: {
        type: "array",
        minItems: 1,
        items: NON_EMPTY_STRING,
      },
    },
    ["scenario", "groundedAnswer", "keyPoints"],
  ),
  exerciseSchema(
    "calculation",
    {
      groundedAnswer: NON_EMPTY_STRING,
      working: NON_EMPTY_STRING,
      numericAnswer: { type: "number" },
      tolerance: { type: "number", minimum: 0 },
      unit: NON_EMPTY_STRING,
    },
    ["groundedAnswer", "working", "numericAnswer", "tolerance", "unit"],
  ),
  exerciseSchema(
    "cloze",
    {
      clozeText: NON_EMPTY_STRING,
      blanks: {
        type: "array",
        minItems: 1,
        items: objectSchema(
          {
            id: ID_STRING,
            answers: {
              type: "array",
              minItems: 1,
              items: NON_EMPTY_STRING,
            },
            caseSensitive: { type: "boolean" },
          },
          ["id", "answers", "caseSensitive"],
        ),
      },
      groundedAnswer: NON_EMPTY_STRING,
    },
    ["clozeText", "blanks", "groundedAnswer"],
  ),
  exerciseSchema(
    "single-select",
    {
      choices: { type: "array", minItems: 2, items: choiceSchema },
      correctChoiceIds: {
        type: "array",
        minItems: 1,
        maxItems: 1,
        items: ID_STRING,
      },
      groundedAnswer: NON_EMPTY_STRING,
    },
    ["choices", "correctChoiceIds", "groundedAnswer"],
  ),
  exerciseSchema(
    "multi-select",
    {
      choices: { type: "array", minItems: 3, items: choiceSchema },
      correctChoiceIds: {
        type: "array",
        minItems: 2,
        items: ID_STRING,
      },
      groundedAnswer: NON_EMPTY_STRING,
    },
    ["choices", "correctChoiceIds", "groundedAnswer"],
  ),
  exerciseSchema(
    "matching",
    {
      pairs: {
        type: "array",
        minItems: 2,
        items: objectSchema(
          { id: ID_STRING, left: NON_EMPTY_STRING, right: NON_EMPTY_STRING },
          ["id", "left", "right"],
        ),
      },
      groundedAnswer: NON_EMPTY_STRING,
    },
    ["pairs", "groundedAnswer"],
  ),
  exerciseSchema(
    "ordering",
    {
      items: {
        type: "array",
        minItems: 2,
        items: objectSchema(
          { id: ID_STRING, text: NON_EMPTY_STRING },
          ["id", "text"],
        ),
      },
      correctOrder: {
        type: "array",
        minItems: 2,
        items: ID_STRING,
      },
      groundedAnswer: NON_EMPTY_STRING,
    },
    ["items", "correctOrder", "groundedAnswer"],
  ),
  exerciseSchema(
    "image-occlusion",
    {
      visualId: ID_STRING,
      masks: { type: "array", minItems: 1, items: maskSchema },
      groundedAnswer: NON_EMPTY_STRING,
    },
    ["visualId", "masks", "groundedAnswer"],
  ),
];

const sharedDefinitions: Record<string, JsonSchema> = {
  exercise: { oneOf: exerciseSchemas },
  segment: objectSchema(
    {
      id: ID_STRING,
      kind: { enum: ["heading", "paragraph"] },
      ordinal: { type: "integer", minimum: 0 },
      headingPath: { type: "array", items: NON_EMPTY_STRING },
      text: NON_EMPTY_STRING,
    },
    ["id", "kind", "ordinal", "headingPath", "text"],
  ),
  visual: objectSchema(
    {
      id: ID_STRING,
      kind: {
        enum: [
          "image",
          "gif-frame",
          "video-frame",
          "notability-region",
          "remote-snapshot",
        ],
      },
      vaultPath: NON_EMPTY_STRING,
      storage: { enum: ["source", "practice-snapshot"] },
      mimeType: {
        enum: [
          "image/png",
          "image/jpeg",
          "image/webp",
          "image/gif",
          "image/svg+xml",
        ],
      },
      contentHash: SHA256_STRING,
      width: { type: "integer", minimum: 1 },
      height: { type: "integer", minimum: 1 },
      altText: { type: "string" },
      sourceEmbed: { type: "string" },
      frameTimeSeconds: { type: "number", minimum: 0 },
      framePosition: { enum: ["first", "middle", "last"] },
      remoteHost: NON_EMPTY_STRING,
    },
    [
      "id",
      "kind",
      "vaultPath",
      "storage",
      "mimeType",
      "contentHash",
      "width",
      "height",
    ],
  ),
};

const legacySessionResultSchema: JsonSchema = {
  oneOf: [
    objectSchema(
      {
        exerciseId: ID_STRING,
        grading: { type: "string", const: "objective" },
        correct: { type: "boolean" },
      },
      ["exerciseId", "grading", "correct"],
    ),
    objectSchema(
      {
        exerciseId: ID_STRING,
        grading: { type: "string", const: "self-rated" },
        rating: { enum: ["again", "hard", "good", "easy"] },
      },
      ["exerciseId", "grading", "rating"],
    ),
  ],
};

const aiReviewSourceSegmentSchema = objectSchema(
  {
    id: ID_STRING,
    headingPath: { type: "array", items: NON_EMPTY_STRING },
    text: NON_EMPTY_STRING,
  },
  ["id", "headingPath", "text"],
);

const aiReviewContextSchema = objectSchema(
  {
    exerciseTitle: NON_EMPTY_STRING,
    exerciseType: {
      enum: [
        "short-answer",
        "causal-explanation",
        "application",
        "calculation",
        "cloze",
        "single-select",
        "multi-select",
        "matching",
        "ordering",
        "image-occlusion",
      ],
    },
    prompt: NON_EMPTY_STRING,
    groundedAnswer: NON_EMPTY_STRING,
    keyPoints: { type: "array", minItems: 1, items: NON_EMPTY_STRING },
    sourceSegments: {
      type: "array",
      minItems: 1,
      items: aiReviewSourceSegmentSchema,
    },
  },
  [
    "exerciseTitle",
    "exerciseType",
    "prompt",
    "groundedAnswer",
    "keyPoints",
    "sourceSegments",
  ],
);

const aiReviewRequestSchema = objectSchema(
  {
    requestId: ID_STRING,
    requestHash: SHA256_STRING,
    sessionId: ID_STRING,
    exerciseId: ID_STRING,
    provider: { enum: ["codex", "claude", "agy"] },
    reasoningEffort: { enum: ["low", "medium", "high", "xhigh", "max", "ultra", "ultracode"] },
    promptVersion: NON_EMPTY_STRING,
    requestedAt: NON_EMPTY_STRING,
    submittedAnswer: NON_EMPTY_STRING,
    context: aiReviewContextSchema,
  },
  [
    "requestId",
    "requestHash",
    "sessionId",
    "exerciseId",
    "provider",
    "reasoningEffort",
    "promptVersion",
    "requestedAt",
    "submittedAnswer",
    "context",
  ],
);

const aiReviewCriterionSchema = objectSchema(
  {
    criterion: NON_EMPTY_STRING,
    outcome: { enum: ["missed", "partial", "met"] },
    feedback: NON_EMPTY_STRING,
    sourceSegmentIds: { type: "array", minItems: 1, items: ID_STRING },
  },
  ["criterion", "outcome", "feedback", "sourceSegmentIds"],
);

const aiReviewStateSchema: JsonSchema = {
  oneOf: [
    objectSchema(
      {
        status: { type: "string", const: "pending" },
        queuedAt: NON_EMPTY_STRING,
        attempts: { type: "integer", minimum: 0 },
      },
      ["status", "queuedAt", "attempts"],
    ),
    objectSchema(
      {
        status: { type: "string", const: "reviewed" },
        reviewedAt: NON_EMPTY_STRING,
        attempts: { type: "integer", minimum: 1 },
        verdict: { enum: ["incorrect", "partial", "correct"] },
        feedback: NON_EMPTY_STRING,
        criteria: { type: "array", minItems: 1, items: aiReviewCriterionSchema },
      },
      ["status", "reviewedAt", "attempts", "verdict", "feedback", "criteria"],
    ),
    objectSchema(
      {
        status: { type: "string", const: "failed" },
        failedAt: NON_EMPTY_STRING,
        attempts: { type: "integer", minimum: 0 },
        error: objectSchema(
          {
            code: NON_EMPTY_STRING,
            message: NON_EMPTY_STRING,
            retryable: { type: "boolean" },
          },
          ["code", "message", "retryable"],
        ),
      },
      ["status", "failedAt", "attempts", "error"],
    ),
  ],
};

const currentSessionResultSchema: JsonSchema = {
  oneOf: [
    ...(legacySessionResultSchema.oneOf as JsonSchema[]),
    objectSchema(
      {
        exerciseId: ID_STRING,
        grading: { type: "string", const: "ai-review" },
        request: aiReviewRequestSchema,
        state: aiReviewStateSchema,
      },
      ["exerciseId", "grading", "request", "state"],
    ),
  ],
};

const historicalNamedReferenceSchema = objectSchema(
  { id: ID_STRING, title: NON_EMPTY_STRING },
  ["id", "title"],
);

const sessionLearningScopeSchema = objectSchema(
  {
    mode: { enum: ["quick", "set", "mixed", "learning-path"] },
    learningPath: historicalNamedReferenceSchema,
    sets: { type: "array", minItems: 1, items: historicalNamedReferenceSchema },
  },
  ["mode", "sets"],
);

const sessionExerciseEvidenceSchema = objectSchema(
  {
    exerciseId: ID_STRING,
    set: historicalNamedReferenceSchema,
    aspects: { type: "array", minItems: 1, items: historicalNamedReferenceSchema },
    instructionalRole: {
      enum: ["guided-check", "independent", "transfer", "diagnostic"],
    },
    independent: { type: "boolean" },
    hintsRevealed: { type: "integer", minimum: 0 },
    retries: { type: "integer", minimum: 0 },
    recoveryOutcome: {
      enum: ["not-recorded", "not-needed", "recovered", "unresolved"],
    },
  },
  [
    "exerciseId",
    "set",
    "aspects",
    "instructionalRole",
    "independent",
    "hintsRevealed",
    "retries",
    "recoveryOutcome",
  ],
);

const completedTutorLessonSnapshotSchema = objectSchema(
  {
    lesson: historicalNamedReferenceSchema,
    aspects: { type: "array", minItems: 1, items: historicalNamedReferenceSchema },
  },
  ["lesson", "aspects"],
);

function sessionSchema(version: number): JsonSchema {
  const learningProperties = version >= PRACTICE_BANK_V3_SCHEMA_VERSION
    ? {
        scope: sessionLearningScopeSchema,
        evidence: { type: "array", items: sessionExerciseEvidenceSchema },
        completedTutorLessons: {
          type: "array",
          items: completedTutorLessonSnapshotSchema,
        },
      }
    : {};
  const learningRequired = version >= PRACTICE_BANK_V3_SCHEMA_VERSION
    ? ["scope", "evidence", "completedTutorLessons"]
    : [];
  return objectSchema(
    {
      schemaVersion: { type: "integer", const: version },
      id: ID_STRING,
      startedAt: NON_EMPTY_STRING,
      finishedAt: NON_EMPTY_STRING,
      bankRevisionAtStart: { type: "integer", minimum: 0 },
      exerciseCount: { type: "integer", minimum: 0 },
      completedCount: { type: "integer", minimum: 0 },
      score: objectSchema(
        {
          correct: { type: "integer", minimum: 0 },
          total: { type: "integer", minimum: 0 },
        },
        ["correct", "total"],
      ),
      ratings: objectSchema(
        {
          again: { type: "integer", minimum: 0 },
          hard: { type: "integer", minimum: 0 },
          good: { type: "integer", minimum: 0 },
          easy: { type: "integer", minimum: 0 },
        },
        ["again", "hard", "good", "easy"],
      ),
      results: {
        type: "array",
        items: { $ref: "#/definitions/sessionResult" },
      },
      ...learningProperties,
    },
    [
      "schemaVersion",
      "id",
      "startedAt",
      "finishedAt",
      "bankRevisionAtStart",
      "exerciseCount",
      "completedCount",
      "score",
      "ratings",
      "results",
      ...learningRequired,
    ],
  );
}

const legacyDefinitions: Record<string, JsonSchema> = {
  ...sharedDefinitions,
  sessionResult: legacySessionResultSchema,
  session: sessionSchema(LEGACY_PRACTICE_BANK_SCHEMA_VERSION),
};

const currentDefinitions: Record<string, JsonSchema> = {
  ...sharedDefinitions,
  sessionResult: currentSessionResultSchema,
  session: sessionSchema(PRACTICE_BANK_SCHEMA_VERSION),
};

const v3Definitions: Record<string, JsonSchema> = {
  ...sharedDefinitions,
  sessionResult: currentSessionResultSchema,
  session: sessionSchema(PRACTICE_BANK_V3_SCHEMA_VERSION),
};

const v4Definitions: Record<string, JsonSchema> = {
  ...sharedDefinitions,
  sessionResult: currentSessionResultSchema,
  session: sessionSchema(CURRENT_PRACTICE_BANK_SCHEMA_VERSION),
};

/** Provider-neutral output schema passed unchanged to every structured CLI. */
export const generationDraftV1JsonSchema: JsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://practice-lab.local/schema/generation-draft-v1.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "exercises"],
  properties: {
    schemaVersion: { type: "integer", const: GENERATION_DRAFT_SCHEMA_VERSION },
    exercises: {
      type: "array",
      minItems: 1,
      items: { anyOf: exerciseSchemas },
    },
  },
};

const sourceMaterialScopeSchema: JsonSchema = {
  oneOf: [
    objectSchema({ kind: { const: "note" } }, ["kind"]),
    objectSchema({ kind: { const: "selection" } }, ["kind"]),
    objectSchema(
      {
        kind: { const: "pdf-pages" },
        firstPage: { type: "integer", minimum: 1 },
        lastPage: { type: "integer", minimum: 1 },
        pageCount: { type: "integer", minimum: 1 },
        pdfContentHash: SHA256_STRING,
      },
      ["kind", "firstPage", "lastPage", "pageCount", "pdfContentHash"],
    ),
  ],
};

const sourceMaterialSchema = objectSchema(
  {
    id: ID_STRING,
    role: { enum: ["primary", "supporting"] },
    vaultPath: NON_EMPTY_STRING,
    wikilink: NON_EMPTY_STRING,
    title: NON_EMPTY_STRING,
    sourceHash: SHA256_STRING,
    scope: sourceMaterialScopeSchema,
    segmentIds: { type: "array", minItems: 1, items: ID_STRING },
    visualIds: { type: "array", items: ID_STRING },
  },
  [
    "id",
    "role",
    "vaultPath",
    "wikilink",
    "title",
    "sourceHash",
    "scope",
    "segmentIds",
    "visualIds",
  ],
);

const sourceMaterialV2Schema = objectSchema(
  {
    id: ID_STRING,
    role: { enum: ["primary", "supporting"] },
    vaultPath: NON_EMPTY_STRING,
    wikilink: NON_EMPTY_STRING,
    title: NON_EMPTY_STRING,
    sourceHash: SHA256_STRING,
    scope: sourceMaterialScopeSchema,
    segmentIds: { type: "array", minItems: 1, items: ID_STRING },
    visualIds: { type: "array", items: ID_STRING },
    classification: {
      enum: [
        "personal-note",
        "official-correction",
        "instructor-material",
        "assigned-reference",
        "unclassified",
      ],
    },
    classificationState: { enum: ["confirmed", "suggested", "migration-default"] },
  },
  [
    "id",
    "role",
    "vaultPath",
    "wikilink",
    "title",
    "sourceHash",
    "scope",
    "segmentIds",
    "visualIds",
    "classification",
    "classificationState",
  ],
);

const nullableNonEmptyString: JsonSchema = {
  anyOf: [{ type: "null" }, NON_EMPTY_STRING],
};

const sourceAlignmentDraftRecordSchema = objectSchema(
  {
    id: ID_STRING,
    status: {
      enum: [
        "aligned",
        "notes-incomplete",
        "conflict",
        "school-only",
        "notes-only-unverified",
        "school-sources-disagree",
        "insufficient-evidence",
      ],
    },
    noteSegmentIds: { type: "array", items: ID_STRING },
    schoolSegmentIds: { type: "array", items: ID_STRING },
    noteClaim: nullableNonEmptyString,
    schoolClaim: nullableNonEmptyString,
    courseSupportedClaim: nullableNonEmptyString,
    resolution: {
      enum: [
        "course-authority",
        "manual-override",
        "excluded",
        "unresolved",
        "not-required",
      ],
    },
  },
  [
    "id",
    "status",
    "noteSegmentIds",
    "schoolSegmentIds",
    "noteClaim",
    "schoolClaim",
    "courseSupportedClaim",
    "resolution",
  ],
);

const sourceAlignmentRecordSchema = objectSchema(
  {
    ...(sourceAlignmentDraftRecordSchema.properties as Record<string, JsonSchema>),
    sourceHashes: {
      type: "array",
      minItems: 1,
      items: objectSchema(
        {
          sourceMaterialId: ID_STRING,
          sourceHash: SHA256_STRING,
          classification: {
            enum: [
              "personal-note",
              "official-correction",
              "instructor-material",
              "assigned-reference",
              "unclassified",
            ],
          },
          classificationState: { enum: ["confirmed", "suggested", "migration-default"] },
        },
        ["sourceMaterialId", "sourceHash", "classification", "classificationState"],
      ),
    },
  },
  [
    ...(sourceAlignmentDraftRecordSchema.required as string[]),
    "sourceHashes",
  ],
);

const sourceAlignmentTargetLinkSchema = objectSchema(
  {
    targetId: ID_STRING,
    alignmentRecordIds: { type: "array", minItems: 1, items: ID_STRING },
  },
  ["targetId", "alignmentRecordIds"],
);

const sourceAlignmentProvenanceSchema = objectSchema(
  {
    provider: { enum: ["codex", "claude", "agy"] },
    providerVersion: NON_EMPTY_STRING,
    model: NON_EMPTY_STRING,
    reasoningEffort: {
      enum: ["low", "medium", "high", "xhigh", "max", "ultra", "ultracode"],
    },
    promptVersion: NON_EMPTY_STRING,
    generatedAt: NON_EMPTY_STRING,
    sourceBundleHash: SHA256_STRING,
  },
  [
    "provider",
    "providerVersion",
    "model",
    "reasoningEffort",
    "promptVersion",
    "generatedAt",
    "sourceBundleHash",
  ],
);

const sourceAlignmentLedgerSchema = objectSchema(
  {
    schemaVersion: { const: SOURCE_ALIGNMENT_SCHEMA_VERSION },
    records: { type: "array", items: sourceAlignmentRecordSchema },
    exerciseLinks: { type: "array", items: sourceAlignmentTargetLinkSchema },
    tutorLessonLinks: { type: "array", items: sourceAlignmentTargetLinkSchema },
    provenance: { anyOf: [{ type: "null" }, sourceAlignmentProvenanceSchema] },
  },
  ["schemaVersion", "records", "exerciseLinks", "tutorLessonLinks", "provenance"],
);

/** Provider-neutral schema for the comparison pass before local hash locking. */
export const sourceAlignmentDraftV1JsonSchema: JsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://practice-lab.local/schema/source-alignment-draft-v1.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "records"],
  properties: {
    schemaVersion: { type: "integer", const: SOURCE_ALIGNMENT_DRAFT_SCHEMA_VERSION },
    records: { type: "array", items: sourceAlignmentDraftRecordSchema },
  },
};

const learningAspectSchema = objectSchema(
  {
    id: ID_STRING,
    title: NON_EMPTY_STRING,
    purpose: NON_EMPTY_STRING,
    prerequisiteAspectIds: { type: "array", items: ID_STRING },
    sourceSegmentIds: { type: "array", items: ID_STRING },
    status: { enum: ["supported", "source-gap"] },
  },
  [
    "id",
    "title",
    "purpose",
    "prerequisiteAspectIds",
    "sourceSegmentIds",
    "status",
  ],
);

const exerciseAssignmentSchema = objectSchema(
  {
    exerciseId: ID_STRING,
    aspectIds: { type: "array", minItems: 1, items: ID_STRING },
    role: { enum: ["guided-check", "independent", "transfer", "diagnostic"] },
  },
  ["exerciseId", "aspectIds", "role"],
);

const practiceSetSchema = objectSchema(
  {
    id: ID_STRING,
    title: NON_EMPTY_STRING,
    purpose: NON_EMPTY_STRING,
    instructionalRole: {
      enum: [
        "general",
        "foundations",
        "mechanisms",
        "guided-application",
        "independent-transfer",
        "repair",
      ],
    },
    order: { type: "integer", minimum: 0 },
    assignments: { type: "array", minItems: 1, items: exerciseAssignmentSchema },
  },
  ["id", "title", "purpose", "instructionalRole", "order", "assignments"],
);

const tutorTeachingBlockSchema = objectSchema(
  {
    id: ID_STRING,
    kind: {
      enum: [
        "why",
        "prerequisite",
        "explanation",
        "worked-example",
        "causal-walkthrough",
      ],
    },
    title: NON_EMPTY_STRING,
    content: NON_EMPTY_STRING,
    sourceSegmentIds: { type: "array", minItems: 1, items: ID_STRING },
  },
  ["id", "kind", "title", "content", "sourceSegmentIds"],
);

const tutorCheckSchema = objectSchema(
  {
    prompt: NON_EMPTY_STRING,
    groundedAnswer: NON_EMPTY_STRING,
    keyPoints: { type: "array", minItems: 1, items: NON_EMPTY_STRING },
    sourceSegmentIds: { type: "array", minItems: 1, items: ID_STRING },
  },
  ["prompt", "groundedAnswer", "keyPoints", "sourceSegmentIds"],
);

const tutorHintSchema = objectSchema(
  {
    id: ID_STRING,
    level: { type: "integer", minimum: 1 },
    text: NON_EMPTY_STRING,
    sourceSegmentIds: { type: "array", minItems: 1, items: ID_STRING },
  },
  ["id", "level", "text", "sourceSegmentIds"],
);

const tutorRepairExplanationSchema = objectSchema(
  {
    text: NON_EMPTY_STRING,
    sourceSegmentIds: { type: "array", minItems: 1, items: ID_STRING },
  },
  ["text", "sourceSegmentIds"],
);

const tutorLessonSchema = objectSchema(
  {
    id: ID_STRING,
    title: NON_EMPTY_STRING,
    objective: NON_EMPTY_STRING,
    aspectIds: { type: "array", minItems: 1, items: ID_STRING },
    prerequisiteAspectIds: { type: "array", items: ID_STRING },
    guidedExerciseId: ID_STRING,
    teachingBlocks: { type: "array", minItems: 1, items: tutorTeachingBlockSchema },
    selfExplanationCheck: tutorCheckSchema,
    hints: { type: "array", minItems: 2, maxItems: 3, items: tutorHintSchema },
    repairExplanation: tutorRepairExplanationSchema,
  },
  [
    "id",
    "title",
    "objective",
    "aspectIds",
    "prerequisiteAspectIds",
    "guidedExerciseId",
    "teachingBlocks",
    "selfExplanationCheck",
    "hints",
    "repairExplanation",
  ],
);

const learningPathStepSchema: JsonSchema = {
  oneOf: [
    objectSchema(
      { kind: { const: "lesson" }, lessonId: ID_STRING, order: { type: "integer", minimum: 0 } },
      ["kind", "lessonId", "order"],
    ),
    objectSchema(
      { kind: { const: "practice-set" }, setId: ID_STRING, order: { type: "integer", minimum: 0 } },
      ["kind", "setId", "order"],
    ),
  ],
};

const learningPathSchema: JsonSchema = objectSchema(
  {
    id: ID_STRING,
    title: NON_EMPTY_STRING,
    startingLevel: { enum: ["new-to-topic", "some-familiarity", "exam-review"] },
    aspectIds: { type: "array", minItems: 1, items: ID_STRING },
    steps: { type: "array", minItems: 1, items: learningPathStepSchema },
  },
  ["id", "title", "startingLevel", "aspectIds", "steps"],
);

function practiceBankSchema(
  version: number,
  id: string,
  definitions: Record<string, JsonSchema>,
  extraProperties: Record<string, JsonSchema> = {},
  extraRequired: string[] = [],
): JsonSchema {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: id,
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "bankId",
      "revision",
      "createdAt",
      "updatedAt",
      "source",
      "segments",
      "visuals",
      "exercises",
      "sessions",
      ...extraRequired,
    ],
    properties: {
      schemaVersion: { type: "integer", const: version },
      bankId: ID_STRING,
      revision: { type: "integer", minimum: 0 },
      createdAt: NON_EMPTY_STRING,
      updatedAt: NON_EMPTY_STRING,
      source: objectSchema(
        {
          vaultPath: NON_EMPTY_STRING,
          wikilink: NON_EMPTY_STRING,
          title: NON_EMPTY_STRING,
          scope: { enum: ["note", "selection"] },
          hash: SHA256_STRING,
        },
        ["vaultPath", "wikilink", "title", "scope", "hash"],
      ),
      segments: {
        type: "array",
        minItems: 1,
        items: { $ref: "#/definitions/segment" },
      },
      visuals: {
        type: "array",
        items: { $ref: "#/definitions/visual" },
      },
      exercises: {
        type: "array",
        minItems: 1,
        items: { $ref: "#/definitions/exercise" },
      },
      sessions: {
        type: "array",
        items: { $ref: "#/definitions/session" },
      },
      generation: objectSchema(
        {
          provider: { enum: ["codex", "claude", "agy"] },
          generatedAt: NON_EMPTY_STRING,
          promptVersion: NON_EMPTY_STRING,
          reasoningEffort: { enum: ["low", "medium", "high", "xhigh", "max", "ultra", "ultracode"] },
        },
        ["provider", "generatedAt", "promptVersion"],
      ),
      ...extraProperties,
    },
    definitions,
  };
}

export const practiceBankV1JsonSchema: JsonSchema = practiceBankSchema(
  LEGACY_PRACTICE_BANK_SCHEMA_VERSION,
  "https://practice-lab.local/schema/practice-bank-v1.json",
  legacyDefinitions,
);

export const practiceBankV2JsonSchema: JsonSchema = practiceBankSchema(
  PRACTICE_BANK_SCHEMA_VERSION,
  "https://practice-lab.local/schema/practice-bank-v2.json",
  currentDefinitions,
);

export const practiceBankV3JsonSchema: JsonSchema = practiceBankSchema(
  PRACTICE_BANK_V3_SCHEMA_VERSION,
  "https://practice-lab.local/schema/practice-bank-v3.json",
  v3Definitions,
  {
    sourceMaterials: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: sourceMaterialSchema,
    },
    aspects: { type: "array", minItems: 1, items: learningAspectSchema },
    practiceSets: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: practiceSetSchema,
    },
    tutorLessons: { type: "array", items: tutorLessonSchema },
    learningPath: { anyOf: [{ type: "null" }, learningPathSchema] },
  },
  ["sourceMaterials", "aspects", "practiceSets", "tutorLessons", "learningPath"],
);

export const practiceBankV4JsonSchema: JsonSchema = practiceBankSchema(
  CURRENT_PRACTICE_BANK_SCHEMA_VERSION,
  "https://practice-lab.local/schema/practice-bank-v4.json",
  v4Definitions,
  {
    sourceMaterials: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: sourceMaterialV2Schema,
    },
    aspects: { type: "array", minItems: 1, items: learningAspectSchema },
    practiceSets: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: practiceSetSchema,
    },
    tutorLessons: { type: "array", items: tutorLessonSchema },
    learningPath: { anyOf: [{ type: "null" }, learningPathSchema] },
    sourceAlignment: sourceAlignmentLedgerSchema,
    aiContextCompletionPolicy: {
      enum: ["selected-sources-only", "approved-general-context"],
    },
  },
  [
    "sourceMaterials",
    "aspects",
    "practiceSets",
    "tutorLessons",
    "learningPath",
    "sourceAlignment",
  ],
);

const ajv = new Ajv({ allErrors: true, strict: true });
const validateDraftSchema: ValidateFunction<GenerationDraftV1> =
  ajv.compile<GenerationDraftV1>(generationDraftV1JsonSchema);
const validateAlignmentDraftSchema: ValidateFunction<SourceAlignmentDraftV1> =
  ajv.compile<SourceAlignmentDraftV1>(sourceAlignmentDraftV1JsonSchema);
const validateLegacyBankSchema: ValidateFunction<PracticeBankV1> =
  ajv.compile<PracticeBankV1>(practiceBankV1JsonSchema);
const validateBankSchema: ValidateFunction<PracticeBankV2> =
  ajv.compile<PracticeBankV2>(practiceBankV2JsonSchema);
const validateBankV3Schema: ValidateFunction<PracticeBankV3> =
  ajv.compile<PracticeBankV3>(practiceBankV3JsonSchema);
const validateBankV4Schema: ValidateFunction<PracticeBankV4> =
  ajv.compile<PracticeBankV4>(practiceBankV4JsonSchema);

export interface GenerationValidationContext {
  segmentIds: Iterable<string>;
  visualIds?: Iterable<string>;
}

function schemaIssues(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  return (errors ?? []).map((error) => ({
    code: "schema",
    path: error.instancePath || "/",
    message: error.message ?? "does not match the Practice Problem Generator schema",
  }));
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    const key = normalized(value);
    if (seen.has(key)) duplicates.add(value);
    else seen.add(key);
  }
  return [...duplicates];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export type AiReviewRequestWithoutHashV2 = Omit<AiReviewRequestV2, "requestHash">;

export function createAiReviewRequestHash(
  request: AiReviewRequestWithoutHashV2,
): string {
  return `sha256:${sha256Hex(canonicalJson(request))}`;
}

export function createAiReviewRequest(
  request: AiReviewRequestWithoutHashV2,
): AiReviewRequestV2 {
  return {
    ...structuredClone(request),
    requestHash: createAiReviewRequestHash(request),
  };
}

function pushIssue(
  issues: ValidationIssue[],
  exercise: ExerciseV1,
  code: ValidationIssue["code"],
  path: string,
  message: string,
): void {
  issues.push({ code, path, message, exerciseId: exercise.id });
}

function validateCommonExercise(
  exercise: ExerciseV1,
  index: number,
  segmentIds: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  const path = `/exercises/${index}`;
  if (
    exercise.title.trim().length === 0 ||
    exercise.prompt.trim().length === 0 ||
    exercise.groundedAnswer.trim().length === 0
  ) {
    pushIssue(
      issues,
      exercise,
      "schema",
      path,
      "title, prompt, and grounded answer must not be blank",
    );
  }
  const repeatedReferences = duplicateValues(exercise.sourceSegmentIds);
  if (repeatedReferences.length > 0) {
    pushIssue(
      issues,
      exercise,
      "source-reference",
      `${path}/sourceSegmentIds`,
      `duplicate source references: ${repeatedReferences.join(", ")}`,
    );
  }
  for (const segmentId of exercise.sourceSegmentIds) {
    if (!segmentIds.has(segmentId)) {
      pushIssue(
        issues,
        exercise,
        "source-reference",
        `${path}/sourceSegmentIds`,
        `unknown source segment: ${segmentId}`,
      );
    }
  }
}

function validateChoices(
  exercise: Extract<ExerciseV1, { type: "single-select" | "multi-select" }>,
  index: number,
  issues: ValidationIssue[],
): void {
  const path = `/exercises/${index}`;
  const choiceIds = exercise.choices.map((choice) => choice.id);
  const duplicateIds = duplicateValues(choiceIds);
  const duplicateTexts = duplicateValues(
    exercise.choices.map((choice) => choice.text),
  );
  if (duplicateIds.length > 0 || duplicateTexts.length > 0) {
    pushIssue(
      issues,
      exercise,
      "choice",
      `${path}/choices`,
      "choice IDs and texts must be unique",
    );
  }
  if (exercise.choices.some((choice) => choice.text.trim().length === 0)) {
    pushIssue(
      issues,
      exercise,
      "choice",
      `${path}/choices`,
      "choice texts must not be blank",
    );
  }
  const validIds = new Set(choiceIds);
  if (duplicateValues(exercise.correctChoiceIds).length > 0) {
    pushIssue(
      issues,
      exercise,
      "choice",
      `${path}/correctChoiceIds`,
      "correct choice IDs must be unique",
    );
  }
  for (const correctId of exercise.correctChoiceIds) {
    if (!validIds.has(correctId)) {
      pushIssue(
        issues,
        exercise,
        "choice",
        `${path}/correctChoiceIds`,
        `correct choice does not exist: ${correctId}`,
      );
    }
  }
  if (
    exercise.type === "multi-select" &&
    exercise.correctChoiceIds.length >= exercise.choices.length
  ) {
    pushIssue(
      issues,
      exercise,
      "choice",
      `${path}/correctChoiceIds`,
      "a multi-select question must contain at least one incorrect choice",
    );
  }
}

function validateCloze(
  exercise: Extract<ExerciseV1, { type: "cloze" }>,
  index: number,
  issues: ValidationIssue[],
): void {
  const path = `/exercises/${index}`;
  const blankIds = exercise.blanks.map((blank) => blank.id);
  if (duplicateValues(blankIds).length > 0) {
    pushIssue(issues, exercise, "cloze", `${path}/blanks`, "blank IDs must be unique");
  }
  const placeholders = [...exercise.clozeText.matchAll(/\{\{([^{}]+)\}\}/gu)].map(
    (match) => match[1] ?? "",
  );
  const declared = new Set(blankIds);
  const found = new Set(placeholders);
  if (
    placeholders.length !== blankIds.length ||
    duplicateValues(placeholders).length > 0 ||
    blankIds.some((id) => !found.has(id)) ||
    placeholders.some((id) => !declared.has(id))
  ) {
    pushIssue(
      issues,
      exercise,
      "cloze",
      `${path}/clozeText`,
      "each declared blank must have exactly one matching {{blank-id}} placeholder",
    );
  }
  for (const [blankIndex, blank] of exercise.blanks.entries()) {
    if (
      duplicateValues(blank.answers).length > 0 ||
      blank.answers.some((answer) => answer.trim().length === 0)
    ) {
      pushIssue(
        issues,
        exercise,
        "cloze",
        `${path}/blanks/${blankIndex}/answers`,
        "acceptable blank answers must be non-blank and unique",
      );
    }
  }
}

function validateMatching(
  exercise: Extract<ExerciseV1, { type: "matching" }>,
  index: number,
  issues: ValidationIssue[],
): void {
  const path = `/exercises/${index}/pairs`;
  if (
    duplicateValues(exercise.pairs.map((pair) => pair.id)).length > 0 ||
    duplicateValues(exercise.pairs.map((pair) => pair.left)).length > 0 ||
    duplicateValues(exercise.pairs.map((pair) => pair.right)).length > 0
  ) {
    pushIssue(
      issues,
      exercise,
      "matching",
      path,
      "pair IDs, left values, and right values must each be unique",
    );
  }
  if (
    exercise.pairs.some(
      (pair) => pair.left.trim().length === 0 || pair.right.trim().length === 0,
    )
  ) {
    pushIssue(
      issues,
      exercise,
      "matching",
      path,
      "matching values must not be blank",
    );
  }
}

function validateOrdering(
  exercise: Extract<ExerciseV1, { type: "ordering" }>,
  index: number,
  issues: ValidationIssue[],
): void {
  const path = `/exercises/${index}`;
  const itemIds = exercise.items.map((item) => item.id);
  if (
    duplicateValues(itemIds).length > 0 ||
    duplicateValues(exercise.items.map((item) => item.text)).length > 0
  ) {
    pushIssue(
      issues,
      exercise,
      "ordering",
      `${path}/items`,
      "ordering item IDs and texts must be unique",
    );
  }
  if (exercise.items.some((item) => item.text.trim().length === 0)) {
    pushIssue(
      issues,
      exercise,
      "ordering",
      `${path}/items`,
      "ordering item texts must not be blank",
    );
  }
  const expected = new Set(itemIds);
  const actual = new Set(exercise.correctOrder);
  if (
    exercise.correctOrder.length !== itemIds.length ||
    actual.size !== expected.size ||
    itemIds.some((id) => !actual.has(id)) ||
    exercise.correctOrder.some((id) => !expected.has(id))
  ) {
    pushIssue(
      issues,
      exercise,
      "ordering",
      `${path}/correctOrder`,
      "correctOrder must be an exact permutation of the item IDs",
    );
  }
}

function validateMasks(
  exercise: Extract<ExerciseV1, { type: "image-occlusion" }>,
  index: number,
  visualIds: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  const path = `/exercises/${index}`;
  if (!visualIds.has(exercise.visualId)) {
    pushIssue(
      issues,
      exercise,
      "visual-reference",
      `${path}/visualId`,
      `unknown visual: ${exercise.visualId}`,
    );
  }
  if (duplicateValues(exercise.masks.map((mask) => mask.id)).length > 0) {
    pushIssue(issues, exercise, "mask", `${path}/masks`, "mask IDs must be unique");
  }
  for (const [maskIndex, mask] of exercise.masks.entries()) {
    const values = [mask.x, mask.y, mask.width, mask.height];
    const isFiniteRectangle = values.every(Number.isFinite);
    if (
      !isFiniteRectangle ||
      mask.x < 0 ||
      mask.y < 0 ||
      mask.width <= 0 ||
      mask.height <= 0 ||
      mask.x + mask.width > 1 + Number.EPSILON ||
      mask.y + mask.height > 1 + Number.EPSILON
    ) {
      pushIssue(
        issues,
        exercise,
        "mask",
        `${path}/masks/${maskIndex}`,
        "mask rectangle must have positive size and remain inside normalized bounds",
      );
    }
    if (mask.label.trim().length === 0 || mask.answer.trim().length === 0) {
      pushIssue(
        issues,
        exercise,
        "mask",
        `${path}/masks/${maskIndex}`,
        "mask label and answer must not be blank",
      );
    }
  }
}

function semanticDraftIssues(
  draft: GenerationDraftV1,
  context: GenerationValidationContext,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const segmentIds = new Set(context.segmentIds);
  const visualIds = new Set(context.visualIds ?? []);
  const exerciseIds = draft.exercises.map((exercise) => exercise.id);
  if (duplicateValues(exerciseIds).length > 0) {
    issues.push({
      code: "duplicate",
      path: "/exercises",
      message: "exercise IDs must be unique",
    });
  }
  const signatures = draft.exercises.map((exercise) => normalized(exercise.prompt));
  if (duplicateValues(signatures).length > 0) {
    issues.push({
      code: "duplicate",
      path: "/exercises",
      message: "duplicate exercise prompts are not allowed",
    });
  }

  for (const [index, exercise] of draft.exercises.entries()) {
    validateCommonExercise(exercise, index, segmentIds, issues);
    switch (exercise.type) {
      case "calculation":
        if (
          !Number.isFinite(exercise.numericAnswer) ||
          !Number.isFinite(exercise.tolerance) ||
          exercise.tolerance < 0 ||
          exercise.working.trim().length === 0 ||
          exercise.groundedAnswer.trim().length === 0 ||
          exercise.unit.trim().length === 0
        ) {
          pushIssue(
            issues,
            exercise,
            "calculation",
            `/exercises/${index}`,
            "calculation answer, working, unit, and finite non-negative tolerance must be well formed",
          );
        }
        break;
      case "cloze":
        validateCloze(exercise, index, issues);
        break;
      case "single-select":
      case "multi-select":
        validateChoices(exercise, index, issues);
        break;
      case "matching":
        validateMatching(exercise, index, issues);
        break;
      case "ordering":
        validateOrdering(exercise, index, issues);
        break;
      case "image-occlusion":
        validateMasks(exercise, index, visualIds, issues);
        break;
      case "short-answer":
        if (
          duplicateValues(exercise.acceptableAnswers).length > 0 ||
          exercise.acceptableAnswers.some((answer) => answer.trim().length === 0) ||
          duplicateValues(exercise.keyPoints).length > 0 ||
          exercise.keyPoints.some((point) => point.trim().length === 0)
        ) {
          pushIssue(
            issues,
            exercise,
            "duplicate",
            `/exercises/${index}`,
            "acceptable answers and key points must be non-blank and unique",
          );
        }
        break;
      case "causal-explanation":
      case "application":
        if (
          duplicateValues(exercise.keyPoints).length > 0 ||
          exercise.keyPoints.some((point) => point.trim().length === 0) ||
          (exercise.type === "application" && exercise.scenario.trim().length === 0)
        ) {
          pushIssue(
            issues,
            exercise,
            "duplicate",
            `/exercises/${index}`,
            "scenario and key points must be non-blank, with unique key points",
          );
        }
        break;
      default: {
        const exhaustive: never = exercise;
        return exhaustive;
      }
    }
  }
  return issues;
}

export function validateGenerationDraft(
  value: unknown,
  context: GenerationValidationContext,
): ValidationResult<GenerationDraftV1> {
  if (!validateDraftSchema(value)) {
    return { ok: false, issues: schemaIssues(validateDraftSchema.errors) };
  }
  const issues = semanticDraftIssues(value, context);
  return issues.length === 0
    ? { ok: true, value, issues: [] }
    : { ok: false, issues };
}

export function validateSourceAlignmentDraft(
  value: unknown,
): ValidationResult<SourceAlignmentDraftV1> {
  if (!validateAlignmentDraftSchema(value)) {
    return { ok: false, issues: schemaIssues(validateAlignmentDraftSchema.errors) };
  }
  return { ok: true, value, issues: [] };
}

function validateVisual(
  visual: VisualSourceV1,
  index: number,
  issues: ValidationIssue[],
): void {
  const path = `/visuals/${index}`;
  const normalizedPath = visual.vaultPath.replace(/\\/gu, "/");
  if (
    normalizedPath.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalizedPath) ||
    normalizedPath.split("/").includes("..")
  ) {
    issues.push({
      code: "visual",
      path: `${path}/vaultPath`,
      message: "visual paths must be safe vault-relative paths",
    });
  }
  if (
    visual.kind !== "image" &&
    visual.storage !== "practice-snapshot"
  ) {
    issues.push({
      code: "visual",
      path: `${path}/storage`,
      message: `${visual.kind} visuals must use a durable practice snapshot`,
    });
  }
  const durableSnapshotRoots = [
    "_Vault/Attachments/Practice Problem Generator/",
    "_Vault/Attachments/Grounded Problems/",
    "_Vault/Attachments/Practice Lab/",
  ];
  if (
    visual.storage === "practice-snapshot" &&
    !durableSnapshotRoots.some((root) => normalizedPath.startsWith(root))
  ) {
    issues.push({
      code: "visual",
      path: `${path}/vaultPath`,
      message:
        "durable snapshots must use the Practice Problem Generator attachment folder (legacy Grounded Problems and Practice Lab paths remain supported)",
    });
  }
  if (
    ["gif-frame", "video-frame", "notability-region"].includes(visual.kind) &&
    visual.mimeType !== "image/png"
  ) {
    issues.push({
      code: "visual",
      path: `${path}/mimeType`,
      message: `${visual.kind} snapshots must be stored as PNG`,
    });
  }
  if (
    (visual.kind === "gif-frame" || visual.kind === "video-frame") &&
    visual.frameTimeSeconds === undefined
  ) {
    issues.push({
      code: "visual",
      path: `${path}/frameTimeSeconds`,
      message: "selected GIF and video frames require a frame timestamp",
    });
  }
  if (visual.framePosition !== undefined && visual.kind !== "gif-frame") {
    issues.push({
      code: "visual",
      path: `${path}/framePosition`,
      message: "First, middle, and last positions apply only to GIF frames",
    });
  }
  if (visual.kind === "remote-snapshot" && visual.remoteHost === undefined) {
    issues.push({
      code: "visual",
      path: `${path}/remoteHost`,
      message: "remote snapshots must retain the source host",
    });
  }
}

function validateAiReviewResult(
  result: AiReviewSessionItemResultV2,
  resultPath: string,
  sessionId: string,
  started: number,
  finished: number,
  issues: ValidationIssue[],
): void {
  const { request } = result;
  if (request.sessionId !== sessionId) {
    issues.push({
      code: "session",
      path: `${resultPath}/request/sessionId`,
      message: "AI review sessionId must match its containing session",
    });
  }
  if (request.exerciseId !== result.exerciseId) {
    issues.push({
      code: "session",
      path: `${resultPath}/request/exerciseId`,
      message: "AI review exerciseId must match its session result",
    });
  }
  const { requestHash: _requestHash, ...hashInput } = request;
  void _requestHash;
  if (request.requestHash !== createAiReviewRequestHash(hashInput)) {
    issues.push({
      code: "session",
      path: `${resultPath}/request/requestHash`,
      message: "AI review requestHash must match the locked request snapshot",
    });
  }
  const requested = Date.parse(request.requestedAt);
  if (
    !Number.isFinite(requested)
    || (Number.isFinite(started) && requested < started)
    || (Number.isFinite(finished) && requested > finished)
  ) {
    issues.push({
      code: "session",
      path: `${resultPath}/request/requestedAt`,
      message: "AI review must be requested during its practice session",
    });
  }
  const snapshotSegmentIds = request.context.sourceSegments.map((segment) => segment.id);
  if (duplicateValues(snapshotSegmentIds).length > 0) {
    issues.push({
      code: "session",
      path: `${resultPath}/request/context/sourceSegments`,
      message: "AI review context segment IDs must be unique",
    });
  }
  const snapshotSegmentIdSet = new Set(snapshotSegmentIds);
  const stateTimestamp = result.state.status === "pending"
    ? result.state.queuedAt
    : result.state.status === "reviewed"
      ? result.state.reviewedAt
      : result.state.failedAt;
  const stateTime = Date.parse(stateTimestamp);
  if (
    !Number.isFinite(stateTime)
    || (Number.isFinite(requested) && stateTime < requested)
  ) {
    issues.push({
      code: "session",
      path: `${resultPath}/state`,
      message: "AI review state timestamp must be valid and not precede the request",
    });
  }
  if (result.state.status === "reviewed") {
    for (const [criterionIndex, criterion] of result.state.criteria.entries()) {
      if (criterion.sourceSegmentIds.some((id) => !snapshotSegmentIdSet.has(id))) {
        issues.push({
          code: "session",
          path: `${resultPath}/state/criteria/${criterionIndex}/sourceSegmentIds`,
          message: "AI review criterion evidence must reference its locked context",
        });
      }
    }
    const outcomes = result.state.criteria.map((criterion) => criterion.outcome);
    const expectedVerdict = outcomes.every((outcome) => outcome === "met")
      ? "correct"
      : outcomes.every((outcome) => outcome === "missed")
        ? "incorrect"
        : "partial";
    if (result.state.verdict !== expectedVerdict) {
      issues.push({
        code: "session",
        path: `${resultPath}/state/verdict`,
        message: `AI review verdict must be ${expectedVerdict} for its criterion outcomes`,
      });
    }
  }
}

function validateSession(
  session: SessionSummaryV1 | SessionSummaryV2,
  index: number,
  bankRevision: number,
  issues: ValidationIssue[],
): void {
  const path = `/sessions/${index}`;
  const started = Date.parse(session.startedAt);
  const finished = Date.parse(session.finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) {
    issues.push({
      code: "session",
      path,
      message: "session timestamps must be valid and finish after the start",
    });
  }
  if (session.bankRevisionAtStart > bankRevision) {
    issues.push({
      code: "session",
      path: `${path}/bankRevisionAtStart`,
      message: "session cannot start from a future bank revision",
    });
  }
  if (
    session.completedCount !== session.results.length ||
    session.completedCount > session.exerciseCount
  ) {
    issues.push({
      code: "session",
      path: `${path}/completedCount`,
      message: "completedCount must equal result count and not exceed exerciseCount",
    });
  }
  if (duplicateValues(session.results.map((result) => result.exerciseId)).length > 0) {
    issues.push({
      code: "session",
      path: `${path}/results`,
      message: "a session may record each exercise only once",
    });
  }
  const aiRequestIds = session.results.flatMap((result) =>
    result.grading === "ai-review" ? [result.request.requestId] : [],
  );
  if (duplicateValues(aiRequestIds).length > 0) {
    issues.push({
      code: "session",
      path: `${path}/results`,
      message: "AI review request IDs must be unique within a session",
    });
  }
  const objectiveTotal = session.results.filter(
    (result) => result.grading === "objective",
  ).length;
  const correct = session.results.filter(
    (result) => result.grading === "objective" && result.correct,
  ).length;
  if (session.score.total !== objectiveTotal || session.score.correct !== correct) {
    issues.push({
      code: "session",
      path: `${path}/score`,
      message: "stored score must match objective item results",
    });
  }
  const ratings = { again: 0, hard: 0, good: 0, easy: 0 };
  for (const [resultIndex, result] of session.results.entries()) {
    if (result.grading === "self-rated") ratings[result.rating] += 1;
    if (result.grading === "ai-review") {
      validateAiReviewResult(
        result,
        `${path}/results/${resultIndex}`,
        session.id,
        started,
        finished,
        issues,
      );
    }
  }
  if (
    ratings.again !== session.ratings.again ||
    ratings.hard !== session.ratings.hard ||
    ratings.good !== session.ratings.good ||
    ratings.easy !== session.ratings.easy
  ) {
    issues.push({
      code: "session",
      path: `${path}/ratings`,
      message: "stored rating counts must match self-rated item results",
    });
  }
}

function validateBankSemantics<T extends PracticeBankV1 | PracticeBankV2 | PracticeBankV3 | PracticeBankV4>(
  value: T,
): ValidationResult<T> {
  const issues: ValidationIssue[] = [];
  const sourcePath = value.source.vaultPath.replace(/\\/gu, "/");
  if (
    sourcePath.startsWith("/") ||
    /^[A-Za-z]:\//u.test(sourcePath) ||
    sourcePath
      .split("/")
      .some((part) => part === "" || part === "." || part === "..") ||
    !/\.(?:md|pdf)$/iu.test(sourcePath)
  ) {
    issues.push({
      code: "bank",
      path: "/source/vaultPath",
      message: "source must be a safe vault-relative Markdown or PDF path",
    });
  }
  if (
    !value.source.wikilink.startsWith("[[") ||
    !value.source.wikilink.endsWith("]]")
  ) {
    issues.push({
      code: "bank",
      path: "/source/wikilink",
      message: "source wikilink must use Obsidian [[...]] syntax",
    });
  }
  if (/\.pdf$/iu.test(sourcePath) && value.source.scope !== "selection") {
    issues.push({
      code: "bank",
      path: "/source/scope",
      message: "PDF sources must store an explicit page-range snapshot scope",
    });
  }
  const segmentIds = value.segments.map((segment) => segment.id);
  if (duplicateValues(segmentIds).length > 0) {
    issues.push({
      code: "bank",
      path: "/segments",
      message: "source segment IDs must be unique",
    });
  }
  for (const [index, segment] of value.segments.entries()) {
    if (segment.ordinal !== index) {
      issues.push({
        code: "bank",
        path: `/segments/${index}/ordinal`,
        message: "segment ordinals must be contiguous and match array order",
      });
    }
  }
  const visualIds = value.visuals.map((visual) => visual.id);
  if (duplicateValues(visualIds).length > 0) {
    issues.push({
      code: "bank",
      path: "/visuals",
      message: "visual IDs must be unique",
    });
  }
  for (const [index, visual] of value.visuals.entries()) {
    validateVisual(visual, index, issues);
  }
  issues.push(
    ...semanticDraftIssues(
      { schemaVersion: GENERATION_DRAFT_SCHEMA_VERSION, exercises: value.exercises },
      { segmentIds, visualIds },
    ),
  );
  if (duplicateValues(value.sessions.map((session) => session.id)).length > 0) {
    issues.push({
      code: "session",
      path: "/sessions",
      message: "session IDs must be unique",
    });
  }
  for (const [index, session] of value.sessions.entries()) {
    validateSession(session, index, value.revision, issues);
  }
  if (value.schemaVersion !== LEGACY_PRACTICE_BANK_SCHEMA_VERSION) {
    const requestIds = value.sessions.flatMap((session) =>
      session.results.flatMap((result) =>
        result.grading === "ai-review" ? [result.request.requestId] : [],
      ),
    );
    if (duplicateValues(requestIds).length > 0) {
      issues.push({
        code: "session",
        path: "/sessions",
        message: "AI review request IDs must be unique across the practice bank",
      });
    }
  }
  if (
    value.schemaVersion === PRACTICE_BANK_V3_SCHEMA_VERSION
    || value.schemaVersion === CURRENT_PRACTICE_BANK_SCHEMA_VERSION
  ) {
    issues.push(...learningPathBankIssues(value as PracticeBankV3));
  }
  if (value.schemaVersion === CURRENT_PRACTICE_BANK_SCHEMA_VERSION) {
    issues.push(...sourceAlignmentIssues(value as PracticeBankV4));
  }
  const created = Date.parse(value.createdAt);
  const updated = Date.parse(value.updatedAt);
  if (!Number.isFinite(created) || !Number.isFinite(updated)) {
    issues.push({
      code: "bank",
      path: "/createdAt",
      message: "bank timestamps must be valid dates",
    });
  } else if (updated < created) {
    issues.push({
      code: "bank",
      path: "/updatedAt",
      message: "updatedAt must not precede createdAt",
    });
  }
  return issues.length === 0
    ? { ok: true, value, issues: [] }
    : { ok: false, issues };
}

export function validatePracticeBankV1(
  value: unknown,
): ValidationResult<PracticeBankV1> {
  if (!validateLegacyBankSchema(value)) {
    return { ok: false, issues: schemaIssues(validateLegacyBankSchema.errors) };
  }
  return validateBankSemantics(value);
}

export function validatePracticeBank(
  value: unknown,
): ValidationResult<PracticeBankV2> {
  if (
    typeof value === "object"
    && value !== null
    && (value as { schemaVersion?: unknown }).schemaVersion
      === CURRENT_PRACTICE_BANK_SCHEMA_VERSION
  ) {
    const validation = validatePracticeBankV4(value);
    return validation.ok
      ? { ok: true, value: validation.value, issues: [] }
      : validation;
  }
  if (
    typeof value === "object"
    && value !== null
    && (value as { schemaVersion?: unknown }).schemaVersion
      === PRACTICE_BANK_V3_SCHEMA_VERSION
  ) {
    const validation = validatePracticeBankV3(value);
    return validation.ok
      ? { ok: true, value: validation.value, issues: [] }
      : validation;
  }
  if (!validateBankSchema(value)) return { ok: false, issues: schemaIssues(validateBankSchema.errors) };
  return validateBankSemantics(value);
}

export function validatePracticeBankV2(
  value: unknown,
): ValidationResult<PracticeBankV2> {
  if (!validateBankSchema(value)) return { ok: false, issues: schemaIssues(validateBankSchema.errors) };
  return validateBankSemantics(value);
}

export function validatePracticeBankV3(
  value: unknown,
): ValidationResult<PracticeBankV3> {
  if (
    typeof value === "object"
    && value !== null
    && (value as { schemaVersion?: unknown }).schemaVersion
      === CURRENT_PRACTICE_BANK_SCHEMA_VERSION
  ) {
    const validation = validatePracticeBankV4(value);
    return validation.ok
      ? { ok: true, value: validation.value, issues: [] }
      : validation;
  }
  if (!validateBankV3Schema(value)) {
    return { ok: false, issues: schemaIssues(validateBankV3Schema.errors) };
  }
  return validateBankSemantics(value);
}

export function validatePracticeBankV4(
  value: unknown,
): ValidationResult<PracticeBankV4> {
  if (!validateBankV4Schema(value)) {
    return { ok: false, issues: schemaIssues(validateBankV4Schema.errors) };
  }
  return validateBankSemantics(value);
}
