/** Exercise-generation output remains on its independent, provider-facing v1 contract. */
export const GENERATION_DRAFT_SCHEMA_VERSION = 1 as const;
/**
 * Kept as the v2 compatibility constant while the quick-generation pipeline is
 * migrated. New authorized writes use CURRENT_PRACTICE_BANK_SCHEMA_VERSION.
 */
export const PRACTICE_BANK_SCHEMA_VERSION = 2 as const;
export const CURRENT_PRACTICE_BANK_SCHEMA_VERSION = 3 as const;
export const LEGACY_PRACTICE_BANK_SCHEMA_VERSION = 1 as const;
export const PRACTICE_BLOCK_LANGUAGE = "practice-lab" as const;

export type ExerciseDifficultyV1 = "easy" | "medium" | "hard";
export type SelfRatingV1 = "again" | "hard" | "good" | "easy";
export type ReasoningEffortV1 =
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra";
export type GifFramePositionV1 = "first" | "middle" | "last";

export interface SourceSegmentV1 {
  id: string;
  kind: "heading" | "paragraph";
  ordinal: number;
  headingPath: string[];
  text: string;
}

export type VisualSourceKindV1 =
  | "image"
  | "gif-frame"
  | "video-frame"
  | "notability-region"
  | "remote-snapshot";

export interface VisualSourceV1 {
  id: string;
  kind: VisualSourceKindV1;
  /** A vault-relative path. Original local images may be reused directly. */
  vaultPath: string;
  storage: "source" | "practice-snapshot";
  mimeType:
    | "image/png"
    | "image/jpeg"
    | "image/webp"
    | "image/gif"
    | "image/svg+xml";
  contentHash: string;
  width: number;
  height: number;
  altText?: string;
  sourceEmbed?: string;
  frameTimeSeconds?: number;
  framePosition?: GifFramePositionV1;
  remoteHost?: string;
}

export interface OcclusionMaskV1 {
  id: string;
  /** Normalized left coordinate in [0, 1]. */
  x: number;
  /** Normalized top coordinate in [0, 1]. */
  y: number;
  /** Normalized width in (0, 1]. */
  width: number;
  /** Normalized height in (0, 1]. */
  height: number;
  label: string;
  answer: string;
}

interface ExerciseBaseV1 {
  id: string;
  title: string;
  prompt: string;
  difficulty: ExerciseDifficultyV1;
  sourceSegmentIds: string[];
}

export interface ShortAnswerExerciseV1 extends ExerciseBaseV1 {
  type: "short-answer";
  groundedAnswer: string;
  acceptableAnswers: string[];
  keyPoints: string[];
}

export interface CausalExplanationExerciseV1 extends ExerciseBaseV1 {
  type: "causal-explanation";
  groundedAnswer: string;
  keyPoints: string[];
}

export interface ApplicationExerciseV1 extends ExerciseBaseV1 {
  type: "application";
  scenario: string;
  groundedAnswer: string;
  keyPoints: string[];
}

export interface CalculationExerciseV1 extends ExerciseBaseV1 {
  type: "calculation";
  groundedAnswer: string;
  working: string;
  numericAnswer: number;
  tolerance: number;
  /** Use "1" for a dimensionless result. */
  unit: string;
}

export interface ClozeBlankV1 {
  id: string;
  answers: string[];
  caseSensitive: boolean;
}

export interface ClozeExerciseV1 extends ExerciseBaseV1 {
  type: "cloze";
  /** Placeholders use {{blank-id}} and must correspond one-to-one with blanks. */
  clozeText: string;
  blanks: ClozeBlankV1[];
  groundedAnswer: string;
}

export interface ChoiceV1 {
  id: string;
  text: string;
}

export interface SingleSelectExerciseV1 extends ExerciseBaseV1 {
  type: "single-select";
  choices: ChoiceV1[];
  correctChoiceIds: [string];
  groundedAnswer: string;
}

export interface MultiSelectExerciseV1 extends ExerciseBaseV1 {
  type: "multi-select";
  choices: ChoiceV1[];
  correctChoiceIds: string[];
  groundedAnswer: string;
}

export interface MatchingPairV1 {
  id: string;
  left: string;
  right: string;
}

export interface MatchingExerciseV1 extends ExerciseBaseV1 {
  type: "matching";
  pairs: MatchingPairV1[];
  groundedAnswer: string;
}

export interface OrderingItemV1 {
  id: string;
  text: string;
}

export interface OrderingExerciseV1 extends ExerciseBaseV1 {
  type: "ordering";
  items: OrderingItemV1[];
  correctOrder: string[];
  groundedAnswer: string;
}

export interface ImageOcclusionExerciseV1 extends ExerciseBaseV1 {
  type: "image-occlusion";
  visualId: string;
  masks: OcclusionMaskV1[];
  groundedAnswer: string;
}

export type ExerciseV1 =
  | ShortAnswerExerciseV1
  | CausalExplanationExerciseV1
  | ApplicationExerciseV1
  | CalculationExerciseV1
  | ClozeExerciseV1
  | SingleSelectExerciseV1
  | MultiSelectExerciseV1
  | MatchingExerciseV1
  | OrderingExerciseV1
  | ImageOcclusionExerciseV1;

export interface ObjectiveSessionItemResultV1 {
  exerciseId: string;
  grading: "objective";
  correct: boolean;
}

export interface SelfRatedSessionItemResultV1 {
  exerciseId: string;
  grading: "self-rated";
  rating: SelfRatingV1;
}

export type SessionItemResultV1 =
  | ObjectiveSessionItemResultV1
  | SelfRatedSessionItemResultV1;

export interface SessionSummaryV1 {
  schemaVersion: typeof LEGACY_PRACTICE_BANK_SCHEMA_VERSION;
  id: string;
  startedAt: string;
  finishedAt: string;
  bankRevisionAtStart: number;
  exerciseCount: number;
  completedCount: number;
  score: {
    correct: number;
    total: number;
  };
  ratings: Record<SelfRatingV1, number>;
  results: SessionItemResultV1[];
}

export type AiReviewProviderV2 = "codex" | "claude" | "agy";
export type AiReviewVerdictV2 = "incorrect" | "partial" | "correct";

export interface AiReviewSourceSegmentSnapshotV2 {
  id: string;
  headingPath: string[];
  text: string;
}

/**
 * The exact grading context authorized by the user. Keeping this immutable
 * lets a queued review finish safely after the live bank has been regenerated.
 */
export interface AiReviewContextSnapshotV2 {
  exerciseTitle: string;
  exerciseType: ExerciseV1["type"];
  prompt: string;
  groundedAnswer: string;
  keyPoints: string[];
  sourceSegments: AiReviewSourceSegmentSnapshotV2[];
}

export interface AiReviewRequestV2 {
  requestId: string;
  requestHash: string;
  sessionId: string;
  exerciseId: string;
  provider: AiReviewProviderV2;
  reasoningEffort: ReasoningEffortV1;
  promptVersion: string;
  requestedAt: string;
  submittedAnswer: string;
  context: AiReviewContextSnapshotV2;
}

export interface AiReviewCriterionResultV2 {
  criterion: string;
  outcome: "missed" | "partial" | "met";
  feedback: string;
  sourceSegmentIds: string[];
}

export interface PendingAiReviewStateV2 {
  status: "pending";
  queuedAt: string;
  attempts: number;
}

export interface ReviewedAiReviewStateV2 {
  status: "reviewed";
  reviewedAt: string;
  attempts: number;
  verdict: AiReviewVerdictV2;
  feedback: string;
  criteria: AiReviewCriterionResultV2[];
}

export interface FailedAiReviewStateV2 {
  status: "failed";
  failedAt: string;
  attempts: number;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export type AiReviewStateV2 =
  | PendingAiReviewStateV2
  | ReviewedAiReviewStateV2
  | FailedAiReviewStateV2;

export interface AiReviewSessionItemResultV2 {
  exerciseId: string;
  grading: "ai-review";
  request: AiReviewRequestV2;
  state: AiReviewStateV2;
}

export type SessionItemResultV2 =
  | ObjectiveSessionItemResultV1
  | SelfRatedSessionItemResultV1
  | AiReviewSessionItemResultV2;

export interface SessionSummaryV2 {
  schemaVersion:
    | typeof PRACTICE_BANK_SCHEMA_VERSION
    | typeof CURRENT_PRACTICE_BANK_SCHEMA_VERSION;
  id: string;
  startedAt: string;
  finishedAt: string;
  bankRevisionAtStart: number;
  exerciseCount: number;
  /** Answered questions, including AI reviews that are pending or failed. */
  completedCount: number;
  /** Objective results only. */
  score: {
    correct: number;
    total: number;
  };
  /** Genuine user self-ratings only; AI verdicts are never folded into this field. */
  ratings: Record<SelfRatingV1, number>;
  results: SessionItemResultV2[];
}

export type ExerciseInstructionalRoleV1 =
  | "guided-check"
  | "independent"
  | "transfer"
  | "diagnostic";

export type RecoveryOutcomeV1 =
  | "not-recorded"
  | "not-needed"
  | "recovered"
  | "unresolved";

export interface HistoricalNamedReferenceV1 {
  id: string;
  title: string;
}

/** Immutable learning evidence retained even after a set or aspect is edited. */
export interface SessionExerciseEvidenceV3 {
  exerciseId: string;
  set: HistoricalNamedReferenceV1;
  aspects: HistoricalNamedReferenceV1[];
  instructionalRole: ExerciseInstructionalRoleV1;
  independent: boolean;
  hintsRevealed: number;
  retries: number;
  recoveryOutcome: RecoveryOutcomeV1;
}

export interface CompletedTutorLessonSnapshotV3 {
  lesson: HistoricalNamedReferenceV1;
  aspects: HistoricalNamedReferenceV1[];
}

export interface SessionLearningScopeV3 {
  mode: "quick" | "set" | "mixed" | "learning-path";
  learningPath?: HistoricalNamedReferenceV1;
  sets: HistoricalNamedReferenceV1[];
}

export interface SessionSummaryV3 extends SessionSummaryV2 {
  schemaVersion: typeof CURRENT_PRACTICE_BANK_SCHEMA_VERSION;
  scope: SessionLearningScopeV3;
  evidence: SessionExerciseEvidenceV3[];
  completedTutorLessons: CompletedTutorLessonSnapshotV3[];
}

export interface PracticeSourceV1 {
  vaultPath: string;
  wikilink: string;
  title: string;
  scope: "note" | "selection";
  hash: string;
}

export type SourceMaterialScopeV1 =
  | { kind: "note" }
  | { kind: "selection" }
  | {
      kind: "pdf-pages";
      firstPage: number;
      lastPage: number;
      pageCount: number;
      pdfContentHash: string;
    };

/** One explicitly approved member of the source bundle. */
export interface SourceMaterialV1 {
  id: string;
  role: "primary" | "supporting";
  vaultPath: string;
  wikilink: string;
  title: string;
  sourceHash: string;
  scope: SourceMaterialScopeV1;
  segmentIds: string[];
  visualIds: string[];
}

export interface LearningAspectV1 {
  id: string;
  title: string;
  purpose: string;
  prerequisiteAspectIds: string[];
  sourceSegmentIds: string[];
  status: "supported" | "source-gap";
}

export interface ExerciseAssignmentV1 {
  exerciseId: string;
  aspectIds: string[];
  role: ExerciseInstructionalRoleV1;
}

export type PracticeSetInstructionalRoleV1 =
  | "general"
  | "foundations"
  | "mechanisms"
  | "guided-application"
  | "independent-transfer"
  | "repair";

export interface PracticeSetV1 {
  id: string;
  title: string;
  purpose: string;
  instructionalRole: PracticeSetInstructionalRoleV1;
  order: number;
  assignments: ExerciseAssignmentV1[];
}

export type TutorTeachingBlockKindV1 =
  | "why"
  | "prerequisite"
  | "explanation"
  | "worked-example"
  | "causal-walkthrough";

export interface TutorTeachingBlockV1 {
  id: string;
  kind: TutorTeachingBlockKindV1;
  title: string;
  content: string;
  sourceSegmentIds: string[];
}

export interface TutorCheckV1 {
  prompt: string;
  groundedAnswer: string;
  keyPoints: string[];
  sourceSegmentIds: string[];
}

export interface TutorHintV1 {
  id: string;
  level: number;
  text: string;
  sourceSegmentIds: string[];
}

export interface TutorRepairExplanationV1 {
  text: string;
  sourceSegmentIds: string[];
}

export interface TutorLessonV1 {
  id: string;
  title: string;
  objective: string;
  aspectIds: string[];
  prerequisiteAspectIds: string[];
  guidedExerciseId: string;
  teachingBlocks: TutorTeachingBlockV1[];
  selfExplanationCheck: TutorCheckV1;
  hints: TutorHintV1[];
  repairExplanation: TutorRepairExplanationV1;
}

export type LearningPathStartingLevelV1 =
  | "new-to-topic"
  | "some-familiarity"
  | "exam-review";

export type LearningPathStepV1 =
  | { kind: "lesson"; lessonId: string; order: number }
  | { kind: "practice-set"; setId: string; order: number };

export interface LearningPathV1 {
  id: string;
  title: string;
  startingLevel: LearningPathStartingLevelV1;
  aspectIds: string[];
  steps: LearningPathStepV1[];
}

export interface GenerationMetadataV1 {
  provider: "codex" | "claude" | "agy";
  generatedAt: string;
  promptVersion: string;
  reasoningEffort?: ReasoningEffortV1;
}

export interface GenerationDraftV1 {
  schemaVersion: typeof GENERATION_DRAFT_SCHEMA_VERSION;
  exercises: ExerciseV1[];
}

export interface PracticeBankV1 {
  schemaVersion: typeof LEGACY_PRACTICE_BANK_SCHEMA_VERSION;
  bankId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  source: PracticeSourceV1;
  segments: SourceSegmentV1[];
  visuals: VisualSourceV1[];
  exercises: ExerciseV1[];
  sessions: SessionSummaryV1[];
  generation?: GenerationMetadataV1;
}

export interface PracticeBankV2 {
  schemaVersion:
    | typeof PRACTICE_BANK_SCHEMA_VERSION
    | typeof CURRENT_PRACTICE_BANK_SCHEMA_VERSION;
  bankId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  source: PracticeSourceV1;
  segments: SourceSegmentV1[];
  visuals: VisualSourceV1[];
  exercises: ExerciseV1[];
  sessions: SessionSummaryV2[];
  generation?: GenerationMetadataV1;
}

/**
 * Current one-workspace contract. Flat source and exercise collections remain
 * canonical; learning-path records reference them by stable ID.
 */
export interface PracticeBankV3 extends PracticeBankV2 {
  schemaVersion: typeof CURRENT_PRACTICE_BANK_SCHEMA_VERSION;
  sessions: SessionSummaryV3[];
  sourceMaterials: SourceMaterialV1[];
  aspects: LearningAspectV1[];
  practiceSets: PracticeSetV1[];
  tutorLessons: TutorLessonV1[];
  learningPath: LearningPathV1 | null;
}

export type CurrentPracticeBank = PracticeBankV3;
export type CurrentSessionSummary = SessionSummaryV3;

export type PracticeBankParseResult =
  | {
      status: "ok";
      bank: PracticeBankV3;
      storedSchemaVersion:
        | typeof LEGACY_PRACTICE_BANK_SCHEMA_VERSION
        | typeof PRACTICE_BANK_SCHEMA_VERSION
        | typeof CURRENT_PRACTICE_BANK_SCHEMA_VERSION;
      warnings: string[];
    }
  | {
      status: "missing";
      recoveryMessage: string;
    }
  | {
      status: "invalid";
      errors: string[];
      recoveryMessage: string;
      rawJson?: string;
    }
  | {
      status: "unsupported-version";
      schemaVersion: unknown;
      rawJson: string;
      recoveryMessage: string;
    };

export interface ValidationIssue {
  code:
    | "schema"
    | "duplicate"
    | "source-reference"
    | "visual-reference"
    | "calculation"
    | "choice"
    | "cloze"
    | "matching"
    | "ordering"
    | "mask"
    | "visual"
    | "session"
    | "source-material"
    | "aspect"
    | "practice-set"
    | "tutor"
    | "learning-path"
    | "bank";
  path: string;
  message: string;
  exerciseId?: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T; issues: [] }
  | { ok: false; issues: ValidationIssue[] };
