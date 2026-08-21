import type { DetectedVisual, OcclusionMaskCandidate } from "../visuals";
import type { CliActivityEvent } from "../cli/contracts";
import type {
  ExerciseV1,
  GifFramePositionV1,
  ReasoningEffortV1,
  SelfRatingV1,
} from "../model";
import type {
  PracticeLabDisplayPreferences,
  StudyOrderDefault,
  VisualSelectionDefault,
} from "../preferences";

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
export type Difficulty = "foundational" | "deep-exam" | "challenge";
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
  readonly supportsVision: boolean;
  readonly reasoningEfforts: readonly ReasoningEffort[];
  readonly version?: string;
  readonly defaultModel: string;
  readonly detail?: string;
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

export interface FinishedStudySession {
  readonly id: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly answers: readonly StudyAnswerRecord[];
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
  readonly enqueueAnswerReview?: (request: AnswerReviewRequest) => void;
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
}

export interface PracticeLabViewOptions {
  readonly callbacks: PracticeLabCallbacks;
  readonly providers: readonly ProviderPresentation[];
  readonly initialSource?: SourcePresentation;
  readonly displayPreferences?: PracticeLabDisplayPreferences;
}
