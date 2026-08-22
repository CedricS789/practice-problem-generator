import type { DetectedVisual, OcclusionMaskCandidate } from "../visuals";
import type { StudySessionLearningProgressV1 } from "../study-checkpoint";
import type { CliActivityEvent } from "../cli/contracts";
import type {
  ExerciseV1,
  GifFramePositionV1,
  ReasoningEffortV1,
  SelfRatingV1,
} from "../model";
import type {
  PracticeLabDisplayPreferences,
  StudyOrderSelection,
  StudyOrderDefault,
  VisualSelectionDefault,
} from "../preferences";
import type { GenerationDifficulty } from "../difficulty";

export const EXERCISE_TYPES = [
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
] as const;

export type ExerciseType = ExerciseV1["type"];
export type ProviderId = "codex" | "claude" | "agy";
export type ProviderExecutionMode =
  | "execute-now"
  | "queue-for-desktop"
  | "unavailable";
export type Difficulty = GenerationDifficulty;
export type MarkdownSourceMode = "selection" | "note";
export type SourceMode = MarkdownSourceMode | "pdf";
export type SelfRating = SelfRatingV1;
export type ReasoningEffort = ReasoningEffortV1;
export type GifFramePosition = GifFramePositionV1;
export type ExerciseTypePercentages = Readonly<Record<ExerciseType, number>>;

export interface PlannedExerciseType {
  readonly type: ExerciseType;
  readonly percentage: number;
  readonly count: number;
}

export interface SourcePresentation {
  readonly mode: SourceMode;
  readonly title: string;
  readonly path: string;
  readonly characterCount: number;
  readonly excerpt: string;
  readonly detail?: string;
  readonly visuals: readonly DetectedVisual[];
}

export interface ProviderPresentation {
  readonly id: ProviderId;
  readonly label: string;
  readonly available: boolean;
  /** Where an AI request using this provider can run on the current device. */
  readonly executionMode?: ProviderExecutionMode;
  readonly supportsVision: boolean;
  readonly reasoningEfforts: readonly ReasoningEffort[];
  readonly models: readonly ProviderModelPresentation[];
  readonly version?: string;
  readonly defaultModel: string;
  readonly detail?: string;
  readonly modelCatalogDetail?: string;
}

export interface ProviderModelPresentation {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly defaultReasoningEffort?: ReasoningEffort;
  readonly supportedReasoningEfforts?: readonly ReasoningEffort[];
}

export interface GenerationConfiguration {
  readonly provider: ProviderId;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
  readonly focusInstructions: string;
  readonly quantity: number;
  readonly difficulty: Difficulty;
  readonly exerciseTypes: readonly ExerciseType[];
  readonly exerciseTypePercentages: ExerciseTypePercentages;
  readonly selectedVisualIds: readonly string[];
}

export interface PracticeLabConfigurationDefaults {
  readonly provider?: ProviderId;
  readonly model?: string;
  readonly reasoningEffort?: ReasoningEffort;
  readonly focusInstructions?: string;
  readonly gifFrameDefault?: GifFramePosition;
  readonly visualSelectionDefault?: VisualSelectionDefault;
  readonly studyOrderDefault?: StudyOrderDefault;
  readonly studyTypeSequence?: readonly ExerciseType[];
  readonly studyShuffleWithinTypesDefault?: boolean;
  readonly quantity?: number;
  readonly difficulty?: Difficulty;
  readonly exerciseTypes?: readonly ExerciseType[];
  readonly exerciseTypePercentages?: ExerciseTypePercentages;
  readonly answerReviewMode?: AnswerReviewMode;
  readonly answerReviewProvider?: ProviderId;
  readonly answerReviewReasoningEffort?: ReasoningEffort;
}

export interface PayloadPreview {
  readonly providerLabel: string;
  readonly modelLabel: string;
  readonly reasoningEffortLabel: string;
  readonly text: string;
  readonly visualNames: readonly string[];
  readonly warning?: string;
}

export interface ChoicePresentation {
  readonly id: string;
  readonly text: string;
}

export type GradingRule =
  | {
      readonly kind: "self";
      readonly groundedAnswer: string;
    }
  | {
      readonly kind: "single-select";
      readonly correctChoiceId: string;
    }
  | {
      readonly kind: "multi-select";
      readonly correctChoiceIds: readonly string[];
    }
  | {
      readonly kind: "text";
      readonly acceptedAnswers: readonly string[];
      readonly caseSensitive?: boolean;
    }
  | {
      readonly kind: "calculation";
      readonly numericAnswer: number;
      readonly tolerance: number;
      readonly unit?: string;
    }
  | {
      readonly kind: "cloze";
      readonly blanks: readonly {
        readonly id: string;
        readonly acceptedAnswers: readonly string[];
        readonly caseSensitive: boolean;
      }[];
    }
  | {
      readonly kind: "matching";
      readonly correctPairs: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: "ordering";
      readonly correctOrder: readonly string[];
    }
  | {
      readonly kind: "occlusion";
      readonly acceptedAnswers: Readonly<Record<string, readonly string[]>>;
    };

export interface DraftExercisePresentation {
  readonly id: string;
  readonly title?: string;
  readonly type: ExerciseType;
  readonly prompt: string;
  readonly groundedAnswer: string;
  readonly rationale?: string;
  readonly sourceSegmentIds: readonly string[];
  readonly choices?: readonly ChoicePresentation[];
  readonly matchingLeft?: readonly ChoicePresentation[];
  readonly matchingRight?: readonly ChoicePresentation[];
  readonly orderingItems?: readonly ChoicePresentation[];
  readonly visualUrl?: string;
  readonly masks?: readonly OcclusionMaskCandidate[];
  readonly answerReviewContext?: AnswerReviewContextPresentation;
  readonly grading: GradingRule;
}

export interface EditableDraftExercise extends DraftExercisePresentation {
  readonly rejected: boolean;
  readonly occlusionReviewed: boolean;
}

export interface JobPresentation {
  readonly state: "idle" | "running" | "cancelling" | "failed";
  readonly message?: string;
}

export type AnswerReviewMode = "self" | "ai";
export type AnswerReviewVerdict = "incorrect" | "partial" | "correct";

export interface AnswerReviewSourceSegment {
  readonly id: string;
  readonly headingPath: readonly string[];
  readonly text: string;
}

export interface AnswerReviewContextPresentation {
  readonly keyPoints: readonly string[];
  readonly sourceSegments: readonly AnswerReviewSourceSegment[];
}

export interface AnswerReviewRequest {
  readonly requestId: string;
  readonly sessionId: string;
  readonly exerciseId: string;
  readonly exerciseTitle: string;
  readonly exerciseType: ExerciseType;
  readonly prompt: string;
  readonly submittedAnswer: string;
  readonly groundedAnswer: string;
  readonly keyPoints: readonly string[];
  readonly sourceSegmentIds: readonly string[];
  readonly sourceSegments: readonly AnswerReviewSourceSegment[];
  readonly provider: ProviderId;
  readonly reasoningEffort: ReasoningEffort;
  readonly requestedAt: string;
}

export interface PersistedAnswerReviewRetryTarget {
  readonly bankId: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly requestHash: string;
}

interface AnswerReviewStatusBase {
  readonly requestId: string;
  readonly sessionId: string;
  readonly exerciseId: string;
}

export interface AnswerReviewCriterionResult {
  readonly criterion: string;
  readonly outcome: "missed" | "partial" | "met";
  readonly feedback: string;
  readonly sourceSegmentIds: readonly string[];
}

export type AnswerReviewStatus = AnswerReviewStatusBase & (
  | {
      readonly state: "pending";
      readonly queuedAt: string;
      readonly attempts: number;
    }
  | {
      readonly state: "reviewed";
      readonly reviewedAt: string;
      readonly attempts: number;
      readonly verdict: AnswerReviewVerdict;
      readonly feedback: string;
      readonly criterionResults: readonly AnswerReviewCriterionResult[];
    }
  | {
      readonly state: "failed";
      readonly failedAt: string;
      readonly attempts: number;
      readonly failureCode: string;
      readonly failure: string;
      readonly retryable?: boolean;
    }
);

export interface StudyAnswerRecord {
  readonly exerciseId: string;
  readonly submittedAnswer?: string;
  readonly correct?: boolean;
  readonly rating?: SelfRating;
  readonly aiReview?: {
    readonly request: AnswerReviewRequest;
    readonly status: AnswerReviewStatus;
  };
}

/**
 * The editable state for the current question. Generic keyed fields keep the
 * checkpoint contract stable across every objective and free-response type.
 */
export interface StudyCurrentInputStateV1 {
  readonly exerciseId: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly selectedIds: readonly string[];
  readonly ordering: readonly string[];
  readonly submitted: {
    readonly answer: string;
    readonly correct?: boolean;
  } | null;
}

export interface StudySessionOriginV1 {
  readonly bankPath: string;
  readonly bankId: string;
  readonly bankRevisionAtStart: number;
  readonly exerciseCountAtStart: number;
}

/** The device-local, frequently persisted portion of an active study run. */
export interface StudySessionProgressV1 extends StudySessionOriginV1 {
  readonly sessionId: string;
  readonly startedAt: string;
  readonly orderedExerciseIds: readonly string[];
  readonly currentQuestionIndex: number;
  readonly answers: readonly StudyAnswerRecord[];
  /** Questions deliberately left unanswered in this run. */
  readonly skippedExerciseIds?: readonly string[];
  readonly currentInput: StudyCurrentInputStateV1 | null;
  readonly answerReviewMode: AnswerReviewMode;
  readonly answerReviewProvider: ProviderId;
  readonly answerReviewReasoningEffort: ReasoningEffort;
  readonly learningProgress?: StudySessionLearningProgressV1;
}

export interface FinishedStudySession {
  readonly id: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly answers: readonly StudyAnswerRecord[];
  /** Questions deliberately left unanswered; excluded from grading. */
  readonly skippedExerciseIds?: readonly string[];
  readonly bankRevisionAtStart?: number;
  readonly exerciseCountAtStart?: number;
  readonly orderedExerciseIds?: readonly string[];
  readonly learning?: {
    readonly scope: StudySessionLearningProgressV1["scope"];
    readonly evidence: StudySessionLearningProgressV1["evidence"];
    readonly completedTutorLessons: StudySessionLearningProgressV1["completedTutorLessons"];
  };
}

export interface GenerateRequest {
  readonly source: SourcePresentation;
  readonly configuration: GenerationConfiguration;
  readonly payloadAccepted: true;
  readonly onActivity?: (event: CliActivityEvent) => void;
}

export interface AnswerReviewActivityPresentation extends CliActivityEvent {
  readonly requestId: string;
  readonly sessionId: string;
  readonly exerciseId: string;
  readonly exerciseTitle: string;
}

export interface PracticeLabCallbacks {
  readonly refreshProviders?: () => Promise<void>;
  readonly requestSource?: (
    mode: MarkdownSourceMode,
  ) => Promise<SourcePresentation | null>;
  readonly requestPdfSource?: () => Promise<SourcePresentation | null>;
  readonly previewPayload: (
    source: SourcePresentation,
    configuration: GenerationConfiguration,
  ) => Promise<PayloadPreview>;
  readonly generate: (
    request: GenerateRequest,
  ) => Promise<readonly DraftExercisePresentation[]>;
  readonly cancelGeneration?: () => Promise<void> | void;
  readonly saveDrafts: (
    source: SourcePresentation,
    drafts: readonly EditableDraftExercise[],
  ) => Promise<void>;
  readonly importRemoteVisual?: (
    visual: DetectedVisual,
  ) => Promise<DetectedVisual | null>;
  readonly chooseMediaFrame?: (
    visual: DetectedVisual,
    position?: GifFramePosition,
  ) => Promise<DetectedVisual | null>;
  readonly updateGifFrameDefault?: (
    position: GifFramePosition,
  ) => Promise<void> | void;
  readonly updateStudyOrderDefaults?: (
    selection: StudyOrderSelection,
  ) => Promise<void> | void;
  readonly enqueueAnswerReview?: (
    request: AnswerReviewRequest,
  ) => Promise<void> | void;
  /** Saves a device-local checkpoint; it never writes into the practice bank. */
  readonly persistStudyCheckpoint?: (
    progress: StudySessionProgressV1,
  ) => Promise<void> | void;
  readonly resolveStudySessionOrigin?: () => StudySessionOriginV1 | null;
  readonly retryAnswerReview?: (
    request: AnswerReviewRequest,
  ) => Promise<void> | void;
  readonly pauseAnswerReview?: (requestId: string) => void;
  readonly getAnswerReviewStatuses?: (
    sessionId: string,
  ) => readonly AnswerReviewStatus[];
  readonly finishSession: (
    source: SourcePresentation,
    session: FinishedStudySession,
  ) => Promise<void>;
  /** Opens an editable, consent-first repair-set brief after the session saves. */
  readonly buildRepairSet?: (
    source: SourcePresentation,
    session: FinishedStudySession,
  ) => Promise<void> | void;
}

export interface PracticeLabViewOptions {
  readonly callbacks: PracticeLabCallbacks;
  readonly providers: readonly ProviderPresentation[];
  readonly initialSource?: SourcePresentation;
  readonly displayPreferences?: PracticeLabDisplayPreferences;
}
