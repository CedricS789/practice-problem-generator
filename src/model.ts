/** Exercise-generation output remains on its independent, provider-facing v1 contract. */
export const GENERATION_DRAFT_SCHEMA_VERSION = 1 as const;
/**
 * Kept as the v2 compatibility constant while the quick-generation pipeline is
 * migrated. New authorized writes use CURRENT_PRACTICE_BANK_SCHEMA_VERSION.
 */
export const PRACTICE_BANK_SCHEMA_VERSION = 2 as const;
export const PRACTICE_BANK_V3_SCHEMA_VERSION = 3 as const;
export const CURRENT_PRACTICE_BANK_SCHEMA_VERSION = 4 as const;
export const LEGACY_PRACTICE_BANK_SCHEMA_VERSION = 1 as const;
export const PRACTICE_BLOCK_LANGUAGE = "practice-lab" as const;
export const SOURCE_ALIGNMENT_SCHEMA_VERSION = 1 as const;
export const SOURCE_ALIGNMENT_DRAFT_SCHEMA_VERSION = 1 as const;

export type ExerciseDifficultyV1 = "easy" | "medium" | "hard";
export type SelfRatingV1 = "again" | "hard" | "good" | "easy";
export type ReasoningEffortV1 =
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra"
  | "ultracode";
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
    | typeof PRACTICE_BANK_V3_SCHEMA_VERSION
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
  /** V4 preserves the V3 learning-evidence fields without rewriting history. */
  schemaVersion:
    | typeof PRACTICE_BANK_V3_SCHEMA_VERSION
    | typeof CURRENT_PRACTICE_BANK_SCHEMA_VERSION;
  scope: SessionLearningScopeV3;
  evidence: SessionExerciseEvidenceV3[];
  completedTutorLessons: CompletedTutorLessonSnapshotV3[];
}

export interface SessionSummaryV4 extends SessionSummaryV3 {
  schemaVersion: typeof CURRENT_PRACTICE_BANK_SCHEMA_VERSION;
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

export type SourceMaterialClassificationV1 =
  | "personal-note"
  | "official-correction"
  | "instructor-material"
  | "assigned-reference"
  | "unclassified";

/**
 * Suggested labels are never treated as authoritative until the user confirms
 * them. Migration defaults preserve that historical banks were never labelled.
 */
export type SourceMaterialClassificationStateV1 =
  | "confirmed"
  | "suggested"
  | "migration-default";

/** Controls whether generation may add non-course-checked technical context. */
export type AiContextCompletionPolicyV1 =
  | "selected-sources-only"
  | "approved-general-context";

export interface SourceMaterialV2 extends SourceMaterialV1 {
  classification: SourceMaterialClassificationV1;
  classificationState: SourceMaterialClassificationStateV1;
}

export type SourceAlignmentStatusV1 =
  | "aligned"
  | "notes-incomplete"
  | "conflict"
  | "school-only"
  | "notes-only-unverified"
  | "school-sources-disagree"
  | "insufficient-evidence";

export type SourceAlignmentResolutionV1 =
  | "course-authority"
  | "manual-override"
  | "excluded"
  | "unresolved"
  | "not-required";

/** Provider result before local source-ownership and hash locking. */
export interface SourceAlignmentDraftRecordV1 {
  id: string;
  status: SourceAlignmentStatusV1;
  noteSegmentIds: string[];
  schoolSegmentIds: string[];
  noteClaim: string | null;
  schoolClaim: string | null;
  courseSupportedClaim: string | null;
  resolution: SourceAlignmentResolutionV1;
}

export interface SourceAlignmentDraftV1 {
  schemaVersion: typeof SOURCE_ALIGNMENT_DRAFT_SCHEMA_VERSION;
  records: SourceAlignmentDraftRecordV1[];
}

export interface SourceAlignmentSourceHashV1 {
  sourceMaterialId: string;
  sourceHash: string;
  classification: SourceMaterialClassificationV1;
  classificationState: SourceMaterialClassificationStateV1;
}

export interface SourceAlignmentRecordV1 extends SourceAlignmentDraftRecordV1 {
  sourceHashes: SourceAlignmentSourceHashV1[];
}

export interface SourceAlignmentTargetLinkV1 {
  targetId: string;
  alignmentRecordIds: string[];
}

export interface SourceAlignmentProvenanceV1 {
  provider: AiReviewProviderV2;
  providerVersion: string;
  model: string;
  reasoningEffort: ReasoningEffortV1;
  promptVersion: string;
  generatedAt: string;
  sourceBundleHash: string;
}

export interface SourceAlignmentLedgerV1 {
  schemaVersion: typeof SOURCE_ALIGNMENT_SCHEMA_VERSION;
  records: SourceAlignmentRecordV1[];
  exerciseLinks: SourceAlignmentTargetLinkV1[];
  tutorLessonLinks: SourceAlignmentTargetLinkV1[];
  provenance: SourceAlignmentProvenanceV1 | null;
}

export interface SourceAlignmentCitationSnapshotV1 {
  sourceMaterialId: string;
  classification: SourceMaterialClassificationV1;
  title: string;
  vaultPath: string;
  scope: SourceMaterialScopeV1;
  segmentId: string;
  headingPath: string[];
  text: string;
}

export interface SourceAlignmentRecordSnapshotV1 {
  recordId: string;
  status: SourceAlignmentStatusV1;
  noteClaim: string | null;
  schoolClaim: string | null;
  courseSupportedClaim: string | null;
  resolution: SourceAlignmentResolutionV1;
  noteEvidence: SourceAlignmentCitationSnapshotV1[];
  schoolEvidence: SourceAlignmentCitationSnapshotV1[];
}

/** Immutable, path-complete evidence shown only after an answer is revealed. */
export interface ExerciseAlignmentSnapshotV1 {
  exerciseId: string;
  /** Missing only on legacy snapshots created before explicit approval existed. */
  aiContextCompletionPolicy?: AiContextCompletionPolicyV1;
  state:
    | "course-aligned"
    | "notes-differ"
    | "notes-incomplete"
    | "notes-grounded-unverified"
    | "school-sources-disagree"
    | "insufficient-evidence";
  records: SourceAlignmentRecordSnapshotV1[];
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
    | typeof PRACTICE_BANK_V3_SCHEMA_VERSION
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
 * V3 introduced one-workspace learning paths. Flat source and exercise
 * collections remain canonical; learning-path records reference stable IDs.
 */
export interface PracticeBankV3 extends PracticeBankV2 {
  /** Includes V4 for source compatibility while PracticeBankV4 is the exact current contract. */
  schemaVersion:
    | typeof PRACTICE_BANK_V3_SCHEMA_VERSION
    | typeof CURRENT_PRACTICE_BANK_SCHEMA_VERSION;
  sessions: SessionSummaryV3[];
  sourceMaterials: SourceMaterialV1[];
  aspects: LearningAspectV1[];
  practiceSets: PracticeSetV1[];
  tutorLessons: TutorLessonV1[];
  learningPath: LearningPathV1 | null;
}

export interface PracticeBankV4 extends PracticeBankV3 {
  schemaVersion: typeof CURRENT_PRACTICE_BANK_SCHEMA_VERSION;
  sessions: SessionSummaryV4[];
  sourceMaterials: SourceMaterialV2[];
  sourceAlignment: SourceAlignmentLedgerV1;
  /** Missing only on legacy banks, whose generation allowed AI-supported context. */
  aiContextCompletionPolicy?: AiContextCompletionPolicyV1;
}

export type CurrentPracticeBank = PracticeBankV4;
export type CurrentSessionSummary = SessionSummaryV4;

export type PracticeBankParseResult =
  | {
      status: "ok";
      bank: PracticeBankV4;
      storedSchemaVersion:
        | typeof LEGACY_PRACTICE_BANK_SCHEMA_VERSION
        | typeof PRACTICE_BANK_SCHEMA_VERSION
        | typeof PRACTICE_BANK_V3_SCHEMA_VERSION
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
    | "source-alignment"
    | "bank";
  path: string;
  message: string;
  exerciseId?: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T; issues: [] }
  | { ok: false; issues: ValidationIssue[] };
