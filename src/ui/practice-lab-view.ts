import {
  ButtonComponent,
  ItemView,
  Notice,
  Platform,
  Setting,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";

import {
  ANSWER_REVIEW_PAYLOAD_DISCLOSURE,
  createAnswerReviewInput,
  validateAnswerReviewInput,
} from "../answer-review";
import type { DetectedVisual, OcclusionMaskCandidate } from "../visuals";
import type { CliActivityEvent, CliActivityPhase } from "../cli/contracts";
import { formatCliErrorForUi } from "../cli/errors";
import {
  displayReasoningEffort,
  reasoningEffortDescription,
} from "../reasoning";
import {
  AUTOMATIC_MODEL_CHOICE,
  agyModelForReasoning,
  agyReasoningEffortForModel,
  agyModelReasoningProblem,
  automaticModelForProvider,
  CUSTOM_MODEL_CHOICE,
  MAX_MODEL_ID_LENGTH,
  modelPickerChoice,
  modelIdProblem,
  modelsForProvider,
  preferredReasoningEffort,
  reasoningEffortsForModel,
} from "../model-selection";
import {
  balanceExerciseTypes,
  copyExerciseTypePercentages,
  enabledExerciseTypes,
  exerciseTypeDistributionProblem,
  exerciseTypePercentageTotal,
  normalizeExerciseTypePercentages,
  planExerciseDistribution,
  plannedExerciseCount,
  rebalanceExerciseTypePercentage,
  rebalanceExerciseTypePercentageWithIntent,
  RECOMMENDED_EXERCISE_TYPE_PERCENTAGES,
  toggleExerciseType,
} from "../exercise-distribution";
import {
  focusInstructionsProblem,
  MAX_FOCUS_INSTRUCTIONS_LENGTH,
} from "../focus-instructions";
import { difficultyProfile, displayDifficulty } from "../difficulty";
import {
  hasLatexMarkup,
  latexMarkupProblem,
  offsetIsInsideLatexMath,
} from "../latex";
import {
  calculatePerformanceScore,
  type PerformanceOutcome,
} from "../session-statistics";
import {
  calculatePracticeRun,
  formatPracticeRunPoints,
  practiceRunRankText,
  type PracticeRunScore,
} from "../practice-run";
import type {
  CompletedTutorLessonSnapshotV3,
  SessionExerciseEvidenceV3,
} from "../model";
import {
  completeGuidedLesson,
  guidedAssistanceSummary,
  recordIndependentAttempt,
  recordRecoveryAttempt,
  revealNextTeachingBlock,
  revealNextTutorHint,
  revealSelfExplanationAnswer,
  revealTutorRepairExplanation,
  submitSelfExplanation,
  type GuidedAttemptOutcome,
} from "../learning-study";
import type {
  StudyGuidedLessonCheckpointV1,
  StudySessionLearningProgressV1,
} from "../study-checkpoint";
import {
  DEFAULT_STUDY_TYPE_SEQUENCE,
  normalizeDisplayPreferences,
  normalizeStudyTypeSequence,
  orderStudyItems,
  type PracticeLabDisplayPreferences,
  type StudyOrderDefault,
  type StudyOrderSelection,
  type VisualSelectionDefault,
} from "../preferences";
import {
  applyHoverDescriptions,
  installHoverDescriptions,
} from "./hover-descriptions";
import { renderCreationModeSwitch as renderSharedCreationModeSwitch } from "./creation-mode-switch";
import {
  renderSourceChoices,
  renderSourceSummaryCard,
  sourceModeLabel,
  type SourceChoiceMode,
} from "./source-picker";
import { OcclusionEditor } from "./occlusion-editor";
import {
  acceptAllValidOcclusions,
  getReviewGateState,
  reviewFingerprint,
} from "./review-state";
import { isGifVisual, selectAllVisuals } from "./visual-selection";
import { presentStudyOcclusionVisual } from "./study-occlusion";
import { chooseStudyOrder } from "./study-order-modal";
import { renderDifficultySelector } from "./difficulty-selector";
import { renderLatexMarkup } from "./latex-renderer";
import {
  applyAnswerReviewStatus as mergeAnswerReviewStatus,
  answerReviewVerdictRating,
  countAnswerReviews,
  createPendingAnswerReviewRecord,
  FREE_RESPONSE_OUTCOMES,
  lockAnswerReviewRequest,
  summarizeFreeResponseOutcomes,
} from "./session-outcomes";
import {
  EXERCISE_TYPES,
  type AnswerReviewCriterionResult,
  type AnswerReviewActivityPresentation,
  type AnswerReviewMode,
  type AnswerReviewRequest,
  type AnswerReviewStatus,
  type Difficulty,
  type DraftExercisePresentation,
  type EditableDraftExercise,
  type ExerciseType,
  type FinishedStudySession,
  type GenerationRecoveryPresentation,
  type GenerationConfiguration,
  type GifFramePosition,
  type JobPresentation,
  type PayloadPreview,
  type PracticeLabConfigurationDefaults,
  type PracticeLabViewOptions,
  type ProviderId,
  type ProviderModelPresentation,
  type ProviderPresentation,
  type ReasoningEffort,
  type MarkdownSourceMode,
  type SourcePresentation,
  type StudyAnswerRecord,
  type StudyCurrentInputStateV1,
  type StudySessionOriginV1,
  type StudySessionProgressV1,
} from "./contracts";

export const PRACTICE_LAB_VIEW_TYPE = "practice-lab-view";

export interface LearningStudyLaunchV1 {
  readonly progress: StudySessionLearningProgressV1;
  readonly evidenceByExerciseId: readonly SessionExerciseEvidenceV3[];
  readonly pathStep?: LearningPathStepPresentationV1;
}

export interface LearningPathStepPresentationV1 {
  readonly pathTitle: string;
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly stepTitle: string;
  readonly kind: "tutor-lesson" | "practice-set";
  readonly questionCount: number;
  readonly totalQuestionCount: number;
}

type MainStage = "source" | "configure" | "review" | "study";

const EXERCISE_LABELS: Readonly<Record<ExerciseType, string>> = {
  "short-answer": "Short answer",
  "causal-explanation": "Causal explanation",
  application: "Application / scenario",
  calculation: "Calculation",
  cloze: "Cloze",
  "single-select": "Single-select MCQ",
  "multi-select": "Multi-select MCQ",
  matching: "Matching",
  ordering: "Ordering",
  "image-occlusion": "Image occlusion",
};

const VISUAL_LABELS: Readonly<Record<DetectedVisual["kind"], string>> = {
  "static-image": "Image",
  "animated-gif": "Animated GIF",
  video: "Video",
  "remote-image": "Remote image",
  "notability-region": "Notability region",
};

const MAX_GENERATION_ACTIVITY_EVENTS = 120;
const MAX_ANSWER_REVIEW_ACTIVITY_EVENTS = 40;
const MAX_ANSWER_REVIEW_ACTIVITY_JOBS = 8;
const VISIBLE_ACTIVITY_EVENTS_PER_JOB = 12;
const TERMINAL_ACTIVITY_PHASES = new Set<CliActivityPhase>([
  "completed",
  "cancelled",
  "failed",
]);

interface AnswerReviewActivityLog {
  readonly requestId: string;
  readonly sessionId: string;
  readonly exerciseId: string;
  readonly exerciseTitle: string;
  readonly provider: ProviderId;
  readonly startedAt: number;
  finishedAt?: number;
  events: CliActivityEvent[];
}

function selectedVisualIds(source: SourcePresentation | null): readonly string[] {
  return source?.visuals.filter((visual) => visual.selected).map((visual) => visual.id) ?? [];
}

function recoveredPathStepPresentation(
  progress: StudySessionLearningProgressV1 | undefined,
  questionCount: number,
): LearningPathStepPresentationV1 | null {
  if (
    progress?.scope.mode !== "learning-path"
    || progress.pathStepIndex === null
    || progress.context?.learningPath === null
    || progress.context?.learningPath === undefined
  ) return null;
  const path = progress.context.learningPath;
  const steps = [...path.steps].sort((left, right) => left.order - right.order);
  const step = steps.find((candidate) => candidate.order === progress.pathStepIndex)
    ?? steps[progress.pathStepIndex];
  if (step === undefined) return null;
  if (step.kind === "lesson") {
    const lesson = progress.context.tutorLessons.find((candidate) => (
      candidate.id === step.lessonId
    ));
    if (lesson === undefined) return null;
    return {
      pathTitle: path.title,
      stepIndex: steps.indexOf(step),
      stepCount: steps.length,
      stepTitle: lesson.title,
      kind: "tutor-lesson",
      questionCount,
      totalQuestionCount: progress.context.exercises.length,
    };
  }
  const set = progress.context.practiceSets.find((candidate) => candidate.id === step.setId);
  if (set === undefined) return null;
  return {
    pathTitle: path.title,
    stepIndex: steps.indexOf(step),
    stepCount: steps.length,
    stepTitle: set.title,
    kind: "practice-set",
    questionCount,
    totalQuestionCount: progress.context.exercises.length,
  };
}

function configurationKey(
  source: SourcePresentation,
  configuration: GenerationConfiguration,
): string {
  return JSON.stringify({
    sourcePath: source.path,
    characterCount: source.characterCount,
    ...configuration,
    exerciseTypes: [...configuration.exerciseTypes].sort(),
    exerciseTypePercentages: EXERCISE_TYPES.map((type) => [
      type,
      configuration.exerciseTypePercentages[type],
    ]),
    selectedVisualIds: [...configuration.selectedVisualIds].sort(),
  });
}

function editableDraft(
  draft: DraftExercisePresentation,
): EditableDraftExercise {
  return {
    ...draft,
    rejected: false,
    occlusionReviewed: draft.type !== "image-occlusion",
  };
}

function displayVisualName(visual: DetectedVisual): string {
  if (visual.kind === "notability-region") {
    const title = visual.region?.title ?? "Notability region";
    const page = visual.region?.page;
    return page === undefined ? title : `${title}, page ${page}`;
  }
  if (visual.kind === "remote-image") return visual.remoteHost ?? "Remote host";
  return visual.sourceTarget ?? VISUAL_LABELS[visual.kind];
}

function displayGifFramePosition(value: GifFramePosition): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function normalizeAnswer(value: string, caseSensitive = false): string {
  const compact = value.trim().replace(/\s+/gu, " ");
  return caseSensitive ? compact : compact.toLocaleLowerCase();
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const normalizedLeft = [...new Set(left)].sort();
  const normalizedRight = [...new Set(right)].sort();
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

function studyPrompt(exercise: EditableDraftExercise): string {
  if (exercise.grading.kind !== "cloze") return exercise.prompt;
  const ordinal = new Map(
    exercise.grading.blanks.map((blank, index) => [blank.id, index + 1]),
  );
  return exercise.prompt.replace(
    /\{\{([^{}]+)\}\}/gu,
    (_placeholder, id: string, offset: number) => {
      const number = ordinal.get(id);
      if (number === undefined) return "____";
      return offsetIsInsideLatexMath(exercise.prompt, offset)
        ? `\\boxed{\\text{blank ${number}}}`
        : `____ [blank ${number}]`;
    },
  );
}

function occlusionGrading(masks: readonly OcclusionMaskCandidate[]) {
  return {
    kind: "occlusion" as const,
    acceptedAnswers: Object.fromEntries(
      masks.map((mask) => [mask.id, [mask.answer]]),
    ) as Readonly<Record<string, readonly string[]>>,
  };
}

function modelReasoningSummary(
  efforts: readonly ReasoningEffort[] | undefined,
): string {
  return efforts === undefined || efforts.length === 0
    ? "Uses the reasoning levels reported for this provider."
    : `Reasoning: ${efforts.map(displayReasoningEffort).join(", ")}.`;
}

export class PracticeLabView extends ItemView {
  private stage: MainStage = "source";
  private source: SourcePresentation | null;
  private providers: readonly ProviderPresentation[];
  private provider: ProviderId;
  private model = "";
  private readonly modelsByProvider: Record<ProviderId, string> = {
    codex: "",
    claude: "",
    agy: "",
  };
  private readonly defaultModelsByProvider: Record<ProviderId, string> = {
    codex: "",
    claude: "",
    agy: "",
  };
  private readonly customModelDraftsByProvider: Record<ProviderId, string> = {
    codex: "",
    claude: "",
    agy: "",
  };
  private readonly customModelModeByProvider: Record<ProviderId, boolean> = {
    codex: false,
    claude: false,
    agy: false,
  };
  private reasoningEffort: ReasoningEffort = "medium";
  private focusInstructions = "";
  private defaultFocusInstructions = "";
  private gifFrameDefault: GifFramePosition = "middle";
  private visualSelectionDefault: VisualSelectionDefault = "manual";
  private studyOrderDefault: StudyOrderDefault = "bank";
  private studyTypeSequence: ExerciseType[] = [...DEFAULT_STUDY_TYPE_SEQUENCE];
  private studyShuffleWithinTypesDefault = false;
  private studySetupOpen = false;
  private displayPreferences: PracticeLabDisplayPreferences;
  private payloadPreviewOpen = false;
  private quantity = 10;
  private difficulty: Difficulty = "deep-exam";
  private exerciseTypePercentages = copyExerciseTypePercentages(
    RECOMMENDED_EXERCISE_TYPE_PERCENTAGES,
  );
  private payloadPreview: PayloadPreview | null = null;
  private previewKey: string | null = null;
  private payloadAccepted = false;
  private job: JobPresentation = { state: "idle" };
  private generationActivityEvents: CliActivityEvent[] = [];
  private generationActivityStartedAt: number | null = null;
  private generationActivityFinishedAt: number | null = null;
  private readonly answerReviewActivityLogs = new Map<string, AnswerReviewActivityLog>();
  private agentActivityHostEl: HTMLElement | null = null;
  private agentActivitySummaryEl: HTMLElement | null = null;
  private activityElapsedEls: Array<{
    readonly element: HTMLElement;
    readonly startedAt: number;
    readonly finishedAt?: number;
  }> = [];
  private agentActivityOpen = true;
  private activityClock: number | undefined;
  private drafts: EditableDraftExercise[] = [];
  private studyExercises: EditableDraftExercise[] = [];
  private studyIndex = 0;
  private studySessionId = "";
  private studyStartedAt = "";
  private studyAnswers: StudyAnswerRecord[] = [];
  private studySkippedExerciseIds: string[] = [];
  private studySubmitted: { readonly correct?: boolean; readonly answer: string } | null = null;
  private studyOrigin: StudySessionOriginV1 | null = null;
  private studyLearningProgress: StudySessionLearningProgressV1 | null = null;
  private studyPathStep: LearningPathStepPresentationV1 | null = null;
  private readonly studyLearningEvidenceByExerciseId = new Map<
    string,
    SessionExerciseEvidenceV3
  >();
  private studyTutorProblemStarted = false;
  private studyCurrentInput: StudyCurrentInputStateV1 | null = null;
  private studyCheckpointTimer: number | undefined;
  private studyCheckpointWarningShown = false;
  private readonly handleDocumentVisibilityChange = (): void => {
    if (document.visibilityState !== "hidden") return;
    if (this.stage !== "study" || this.studyIndex >= this.studyExercises.length) return;
    void this.flushStudyCheckpoint().catch(() => undefined);
  };
  private answerReviewMode: AnswerReviewMode = "self";
  private answerReviewProvider: ProviderId = "codex";
  private answerReviewReasoningEffort: ReasoningEffort = "medium";
  private answerReviewDefaultMode: AnswerReviewMode = "self";
  private answerReviewDefaultProvider: ProviderId = "codex";
  private answerReviewDefaultReasoningEffort: ReasoningEffort = "medium";
  private orderingState: string[] = [];
  private readonly occlusionEditors: OcclusionEditor[] = [];
  private savedDraftFingerprint: string | null = null;
  private reviewMutationVersion = 0;
  private reviewSaveButton: ButtonComponent | null = null;
  private reviewStudyButton: ButtonComponent | null = null;
  private reviewAcceptAllButton: ButtonComponent | null = null;
  private reviewSummaryEl: HTMLElement | null = null;
  private reviewGateNoticeEl: HTMLElement | null = null;
  private answerReviewControlsEl: HTMLElement | null = null;
  private answerReviewStatusEl: HTMLElement | null = null;
  private answerReviewActionsEl: HTMLElement | null = null;
  private studyFeedbackActionsEl: HTMLElement | null = null;
  private studyCompletionProvisionalEl: HTMLElement | null = null;
  private studyCompletionOutcomeEl: HTMLElement | null = null;
  private studyCompletionRunSummaryEl: HTMLElement | null = null;
  private studyCompletionAiFeedbackEl: HTMLElement | null = null;
  private readonly studyRunMetricEls = new Map<string, HTMLElement>();
  private readonly studyCompletionMetricEls = new Map<string, HTMLElement>();
  private readonly pausedAnswerReviewIds = new Set<string>();
  private visualSelectionBusy = false;
  private sourceRequestMode: SourceChoiceMode | null = null;
  private sourceRequestEpoch = 0;
  private providerRefreshBusy = false;
  private providerRefreshRenderPending = false;
  private pendingProviderPresentations: readonly ProviderPresentation[] | null = null;
  private preserveNextProviderRender = false;
  private reviewSaving = false;
  private reviewSaveError: string | null = null;
  private studyFinishing = false;
  private studyFinishError: string | null = null;
  private regenerationContext: string | null = null;
  private generationRecovery: GenerationRecoveryPresentation | null = null;

  public constructor(
    leaf: WorkspaceLeaf,
    private readonly options: PracticeLabViewOptions,
  ) {
    super(leaf);
    this.navigation = false;
    this.source = options.initialSource ?? null;
    this.providers = [...options.providers];
    this.updateProviderModelDefaults(this.providers, true);
    this.displayPreferences = normalizeDisplayPreferences(options.displayPreferences);
    this.payloadPreviewOpen = this.displayPreferences.practice.expandPayloadPreview;
    this.provider =
      this.providers.find((provider) => provider.id === "codex" && provider.available)
        ?.id ??
      this.providers.find((provider) => provider.available)?.id ??
      "codex";
    this.model = this.modelsByProvider[this.provider];
    this.syncCustomModelState();
    this.answerReviewProvider = this.answerReviewDefaultProvider;
    this.ensureSupportedReasoningEffort();
  }

  public getViewType(): string {
    return PRACTICE_LAB_VIEW_TYPE;
  }

  public getDisplayText(): string {
    return this.options.creationAvailable === false
      ? "Practice"
      : "Practice creation - quick set";
  }

  public getIcon(): string {
    return "flask-conical";
  }

  public override async onOpen(): Promise<void> {
    document.addEventListener(
      "visibilitychange",
      this.handleDocumentVisibilityChange,
    );
    installHoverDescriptions(this.contentEl);
    this.render();
  }

  public override async onClose(): Promise<void> {
    document.removeEventListener(
      "visibilitychange",
      this.handleDocumentVisibilityChange,
    );
    this.providerRefreshRenderPending = false;
    this.pendingProviderPresentations = null;
    this.clearOcclusionEditors();
    this.clearActivityClock();
    if (this.stage === "study" && this.studyIndex < this.studyExercises.length) {
      try {
        await this.flushStudyCheckpoint();
      } catch {
        // flushStudyCheckpoint already displayed the actionable warning.
        return;
      }
    }
  }

  public async prepareForWorkspaceRelocation(): Promise<void> {
    if (this.stage === "study" && this.studyIndex < this.studyExercises.length) {
      await this.flushStudyCheckpoint();
    }
  }

  public setSource(
    source: SourcePresentation,
    options: { readonly prepareDefaultVisuals?: boolean } = {},
  ): void {
    this.source = source;
    this.sourceRequestEpoch += 1;
    this.sourceRequestMode = null;
    this.regenerationContext = null;
    this.generationActivityEvents = [];
    this.generationActivityStartedAt = null;
    this.generationActivityFinishedAt = null;
    this.answerReviewActivityLogs.clear();
    this.clearActivityClock();
    this.focusInstructions = this.defaultFocusInstructions;
    this.drafts = [];
    this.studyExercises = [];
    this.studyAnswers = [];
    this.studySkippedExerciseIds = [];
    this.studySubmitted = null;
    this.studyOrigin = null;
    this.studyCurrentInput = null;
    this.clearStudyCheckpointTimer();
    this.pausedAnswerReviewIds.clear();
    this.savedDraftFingerprint = null;
    this.reviewSaving = false;
    this.reviewSaveError = null;
    this.studyFinishing = false;
    this.studyFinishError = null;
    this.reviewMutationVersion += 1;
    this.stage = "source";
    this.invalidatePreview();
    this.render();
    if (
      options.prepareDefaultVisuals === true
      && this.visualSelectionDefault === "all-local"
      && source.visuals.length > 0
    ) {
      void this.selectAllImages(false);
    }
  }

  public prepareRegeneration(
    source: SourcePresentation,
    defaults: PracticeLabConfigurationDefaults,
    explanation: string,
  ): void {
    this.setSource(source);
    const defaultFocusInstructions = this.defaultFocusInstructions;
    this.setConfigurationDefaults(defaults);
    this.defaultFocusInstructions = defaultFocusInstructions;
    this.regenerationContext = explanation;
    this.stage = "configure";
    this.render();
  }

  public prepareRecoveredGeneration(
    source: SourcePresentation,
    defaults: PracticeLabConfigurationDefaults,
    recovery: {
      readonly state: "idle" | "running" | "blocked" | "ready" | "failed";
      readonly message?: string;
    },
    drafts?: readonly DraftExercisePresentation[],
  ): void {
    this.generationRecovery = recovery.state === "idle"
      ? null
      : {
          state: recovery.state,
          message: recovery.message ?? "The approved interrupted generation is still available locally.",
        };
    this.setSource(source);
    const defaultFocusInstructions = this.defaultFocusInstructions;
    this.setConfigurationDefaults(defaults);
    this.defaultFocusInstructions = defaultFocusInstructions;
    this.regenerationContext = recovery.state === "running"
      ? "Resumed the exact detached CLI job after Obsidian restarted. The approved payload is unchanged."
      : recovery.state === "ready"
        ? "Recovered the validated draft and its exact approved generation context after an interruption."
        : recovery.state === "blocked"
          ? "The exact interrupted-generation context is preserved, but a required local source or visual must be restored before reattachment."
        : "The approved interrupted-generation context is still available locally.";
    this.job = recovery.state === "running"
      ? { state: "running", message: recovery.message ?? "Resuming interrupted generation…" }
      : recovery.state === "failed" || recovery.state === "blocked"
        ? { state: "failed", message: recovery.message ?? "Interrupted generation recovery failed." }
        : { state: "idle" };
    if (drafts !== undefined) {
      this.setDrafts(drafts);
      return;
    }
    this.stage = "configure";
    this.render();
  }

  public setDrafts(drafts: readonly DraftExercisePresentation[]): void {
    this.drafts = drafts.map(editableDraft);
    this.savedDraftFingerprint = null;
    this.reviewMutationVersion += 1;
    this.stage = "review";
    this.render();
  }

  public setJob(job: JobPresentation): void {
    this.job = job;
    this.render();
  }

  public setGenerationRecovery(
    recovery: GenerationRecoveryPresentation | null,
  ): void {
    this.generationRecovery = recovery;
    this.render();
  }

  public publishRecoveredGenerationActivity(event: CliActivityEvent): void {
    if (this.generationActivityStartedAt === null) {
      const occurredAt = Date.parse(event.occurredAt);
      this.generationActivityStartedAt = Number.isFinite(occurredAt)
        ? occurredAt
        : Date.now();
    }
    this.job = { state: "running", message: "Resuming interrupted generation…" };
    this.publishGenerationActivity(event);
  }

  public setProviders(providers: readonly ProviderPresentation[]): void {
    if (
      this.stage === "configure"
      && this.deferProviderUpdateWhileFocused(providers)
    ) return;
    const previousProvider = this.provider;
    this.modelsByProvider[this.provider] = this.model;
    this.providers = [...providers];
    this.updateProviderModelDefaults(this.providers, false);
    this.provider =
      this.providers.find(
        (provider) => provider.id === this.provider && provider.available,
      )?.id ??
      this.providers.find(
        (provider) => provider.id === "codex" && provider.available,
      )?.id ??
      this.providers.find((provider) => provider.available)?.id ??
      "codex";
    if (this.provider !== previousProvider) {
      this.model = this.modelsByProvider[this.provider];
    }
    this.syncCustomModelState();
    this.ensureSupportedReasoningEffort();
    this.invalidatePreview();
    if (this.stage === "study") {
      this.refreshAnswerReviewControls();
      this.renderCurrentFreeResponseActions();
      this.renderStudyCompletionAiFeedback();
      return;
    }
    if (this.preserveNextProviderRender) {
      this.preserveNextProviderRender = false;
      this.renderPreservingScroll();
    } else {
      this.render();
    }
  }

  private deferProviderUpdateWhileFocused(
    providers: readonly ProviderPresentation[],
  ): boolean {
    const active = this.contentEl.ownerDocument.activeElement;
    if (active === null || !this.contentEl.contains(active)) return false;
    this.pendingProviderPresentations = [...providers];
    if (this.providerRefreshRenderPending) return true;
    this.providerRefreshRenderPending = true;
    const waitForBlur = (): void => {
      this.contentEl.addEventListener("focusout", () => {
        window.setTimeout(() => {
          if (!this.providerRefreshRenderPending) return;
          const nextActive = this.contentEl.ownerDocument.activeElement;
          if (nextActive !== null && this.contentEl.contains(nextActive)) {
            waitForBlur();
            return;
          }
          this.providerRefreshRenderPending = false;
          const pending = this.pendingProviderPresentations;
          this.pendingProviderPresentations = null;
          if (pending !== null) {
            this.preserveNextProviderRender = true;
            this.setProviders(pending);
          }
        }, 0);
      }, { once: true });
    };
    waitForBlur();
    return true;
  }

  public setDisplayPreferences(preferences: PracticeLabDisplayPreferences): void {
    const normalized = normalizeDisplayPreferences(preferences);
    if (JSON.stringify(normalized) === JSON.stringify(this.displayPreferences)) return;
    const expansionChanged = normalized.practice.expandPayloadPreview
      !== this.displayPreferences.practice.expandPayloadPreview;
    this.displayPreferences = normalized;
    if (expansionChanged) {
      this.payloadPreviewOpen = normalized.practice.expandPayloadPreview;
    }
    if (this.stage === "study") {
      this.updateAgentActivityDom();
      return;
    }
    this.renderPreservingScroll();
  }

  /** Publish a late background result without rebuilding the active question. */
  public publishAnswerReviewStatus(status: AnswerReviewStatus): void {
    if (!this.applyAnswerReviewStatus(status)) return;
    this.updateAnswerReviewStatusDom();
    this.updatePracticeRunDom();
    this.updateStudyCompletionDom();
  }

  /** Publish safe provider progress without rebuilding or disturbing the question. */
  public publishAnswerReviewActivity(
    activity: AnswerReviewActivityPresentation,
  ): void {
    if (activity.sessionId !== this.studySessionId) return;
    const existing = this.answerReviewActivityLogs.get(activity.requestId);
    const occurredAt = Date.parse(activity.occurredAt);
    const log: AnswerReviewActivityLog = existing ?? {
      requestId: activity.requestId,
      sessionId: activity.sessionId,
      exerciseId: activity.exerciseId,
      exerciseTitle: activity.exerciseTitle,
      provider: activity.provider,
      startedAt: Number.isFinite(occurredAt) ? occurredAt : Date.now(),
      events: [],
    };
    log.events = appendActivityEvent(
      log.events,
      activity,
      MAX_ANSWER_REVIEW_ACTIVITY_EVENTS,
    );
    if (TERMINAL_ACTIVITY_PHASES.has(activity.phase)) {
      log.finishedAt = Date.now();
    } else if (log.finishedAt !== undefined) {
      delete log.finishedAt;
    }
    this.answerReviewActivityLogs.delete(activity.requestId);
    this.answerReviewActivityLogs.set(activity.requestId, log);
    while (this.answerReviewActivityLogs.size > MAX_ANSWER_REVIEW_ACTIVITY_JOBS) {
      const oldest = this.answerReviewActivityLogs.keys().next().value;
      if (oldest === undefined) break;
      this.answerReviewActivityLogs.delete(oldest);
    }
    this.agentActivityOpen = true;
    this.updateActivityClock();
    this.updateAgentActivityDom();
  }

  public setConfigurationDefaults(
    defaults: PracticeLabConfigurationDefaults,
  ): void {
    if (defaults.provider !== undefined) this.provider = defaults.provider;
    if (defaults.model !== undefined) {
      this.model = defaults.model;
      this.modelsByProvider[this.provider] = this.model;
      this.syncCustomModelState();
    } else {
      this.model = this.modelsByProvider[this.provider];
    }
    if (defaults.reasoningEffort !== undefined) {
      this.reasoningEffort = defaults.reasoningEffort;
    }
    if (defaults.focusInstructions !== undefined) {
      this.defaultFocusInstructions = defaults.focusInstructions.slice(
        0,
        MAX_FOCUS_INSTRUCTIONS_LENGTH,
      );
      this.focusInstructions = this.defaultFocusInstructions;
    }
    if (defaults.gifFrameDefault !== undefined) {
      this.gifFrameDefault = defaults.gifFrameDefault;
    }
    if (defaults.visualSelectionDefault !== undefined) {
      this.visualSelectionDefault = defaults.visualSelectionDefault;
    }
    if (defaults.studyOrderDefault !== undefined) {
      this.studyOrderDefault = defaults.studyOrderDefault;
    }
    if (defaults.studyTypeSequence !== undefined) {
      this.studyTypeSequence = normalizeStudyTypeSequence(
        defaults.studyTypeSequence,
      );
    }
    if (defaults.studyShuffleWithinTypesDefault !== undefined) {
      this.studyShuffleWithinTypesDefault =
        defaults.studyShuffleWithinTypesDefault;
    }
    if (defaults.quantity !== undefined && Number.isFinite(defaults.quantity)) {
      this.quantity = Math.min(30, Math.max(1, Math.round(defaults.quantity)));
    }
    if (defaults.difficulty !== undefined) {
      this.difficulty = defaults.difficulty;
    }
    if (defaults.exerciseTypePercentages !== undefined) {
      this.exerciseTypePercentages = normalizeExerciseTypePercentages(
        defaults.exerciseTypePercentages,
      );
    } else if (defaults.exerciseTypes !== undefined) {
      this.exerciseTypePercentages = balanceExerciseTypes(
        defaults.exerciseTypes,
      );
    }
    if (defaults.answerReviewMode !== undefined) {
      this.answerReviewDefaultMode = defaults.answerReviewMode;
    }
    if (defaults.answerReviewProvider !== undefined) {
      this.answerReviewDefaultProvider = defaults.answerReviewProvider;
    }
    if (defaults.answerReviewReasoningEffort !== undefined) {
      this.answerReviewDefaultReasoningEffort =
        defaults.answerReviewReasoningEffort;
    }
    if (this.stage !== "study") {
      this.answerReviewMode =
        this.options.callbacks.enqueueAnswerReview === undefined
          ? "self"
          : this.answerReviewDefaultMode;
      this.answerReviewProvider = this.answerReviewDefaultProvider;
      this.answerReviewReasoningEffort =
        this.answerReviewDefaultReasoningEffort;
    }
    this.ensureSupportedReasoningEffort();
    this.invalidatePreview();
    this.render();
  }

  public async startStudy(
    exercises?: readonly DraftExercisePresentation[],
    origin?: StudySessionOriginV1,
    learning?: LearningStudyLaunchV1,
  ): Promise<void> {
    if (this.source === null) {
      new Notice("Load the source note before starting a practice session.");
      return;
    }
    if (exercises === undefined) {
      const gate = getReviewGateState(
        this.drafts,
        this.savedDraftFingerprint,
      );
      if (!gate.canStartPractice) {
        new Notice("Save the current reviewed set before starting practice.");
        return;
      }
    }
    const selectedExercises =
      exercises ?? this.drafts.filter((draft) => !draft.rejected);
    if (selectedExercises.length === 0) {
      new Notice("There are no approved exercises to study.");
      return;
    }
    if (this.studySetupOpen) {
      new Notice("The session setup dialog is already open.");
      return;
    }
    await this.configureAndStartStudy([...selectedExercises], origin, learning);
  }

  private async configureAndStartStudy(
    selectedExercises: readonly DraftExercisePresentation[],
    origin?: StudySessionOriginV1,
    learning?: LearningStudyLaunchV1,
  ): Promise<void> {
    this.studySetupOpen = true;
    try {
      const isSingleTutorStep = learning?.pathStep?.kind === "tutor-lesson"
        && selectedExercises.length === 1;
      const result = isSingleTutorStep
        ? null
        : await chooseStudyOrder(this.app, {
            itemTypes: selectedExercises.map((exercise) => exercise.type),
            defaults: {
              mode: this.studyOrderDefault,
              typeSequence: this.studyTypeSequence,
              shuffleWithinTypes: this.studyShuffleWithinTypesDefault,
            },
            labels: EXERCISE_LABELS,
          });
      if (!isSingleTutorStep && result === null) return;

      const selection: StudyOrderSelection = isSingleTutorStep
        ? {
            mode: "bank",
            typeSequence: normalizeStudyTypeSequence(this.studyTypeSequence),
            shuffleWithinTypes: false,
          }
        : {
            mode: result?.mode ?? "bank",
            typeSequence: normalizeStudyTypeSequence(
              result?.typeSequence ?? this.studyTypeSequence,
            ),
            shuffleWithinTypes: result?.shuffleWithinTypes ?? false,
          };
      if (result?.rememberAsDefault === true) {
        this.studyOrderDefault = selection.mode;
        this.studyTypeSequence = [...selection.typeSequence];
        this.studyShuffleWithinTypesDefault = selection.shuffleWithinTypes;
        try {
          await this.options.callbacks.updateStudyOrderDefaults?.(selection);
        } catch (error) {
          new Notice(this.errorMessage(
            error,
            "Could not save the study-order defaults. This session will still start.",
          ));
        }
      }

      const orderedExercises = orderStudyItems(selectedExercises, selection);
      this.studyExercises = orderedExercises.map((exercise) => ({
        ...editableDraft(exercise),
        rejected: false,
        occlusionReviewed: true,
      }));
      this.studyIndex = 0;
      this.studySessionId = `session-${crypto.randomUUID()}`;
      this.studyStartedAt = new Date().toISOString();
      this.studyAnswers = [];
      this.studySkippedExerciseIds = [];
      this.studySubmitted = null;
      this.studyOrigin = origin
        ?? this.options.callbacks.resolveStudySessionOrigin?.()
        ?? null;
      this.studyLearningProgress = learning === undefined
        ? null
        : structuredClone(learning.progress);
      this.studyPathStep = learning?.pathStep === undefined
        ? recoveredPathStepPresentation(learning?.progress, selectedExercises.length)
        : structuredClone(learning.pathStep);
      this.studyLearningEvidenceByExerciseId.clear();
      for (const evidence of learning?.evidenceByExerciseId ?? []) {
        this.studyLearningEvidenceByExerciseId.set(
          evidence.exerciseId,
          structuredClone(evidence),
        );
      }
      this.studyTutorProblemStarted = false;
      this.studyFinishing = false;
      this.studyFinishError = null;
      this.pausedAnswerReviewIds.clear();
      this.answerReviewActivityLogs.clear();
      this.answerReviewMode =
        this.options.callbacks.enqueueAnswerReview === undefined
          ? "self"
          : this.answerReviewDefaultMode;
      this.answerReviewProvider = this.answerReviewDefaultProvider;
      this.answerReviewReasoningEffort = this.answerReviewDefaultReasoningEffort;
      this.stage = "study";
      this.resetOrderingState();
      this.resetStudyCurrentInput();
      try {
        await this.persistStudyCheckpoint();
      } catch (error) {
        this.stage = "review";
        this.studyOrigin = null;
        this.studyLearningProgress = null;
        this.studyLearningEvidenceByExerciseId.clear();
        this.studyCurrentInput = null;
        new Notice(this.errorMessage(
          error,
          "Could not create the crash-safe study checkpoint, so the session was not started.",
        ));
        this.render();
        return;
      }
      this.render();
    } finally {
      this.studySetupOpen = false;
    }
  }

  public restoreStudy(
    exercises: readonly DraftExercisePresentation[],
    progress: StudySessionProgressV1,
    evidenceByExerciseId: readonly SessionExerciseEvidenceV3[] = [],
  ): void {
    const orderedIds = exercises.map((exercise) => exercise.id);
    const skippedExerciseIds = progress.skippedExerciseIds ?? [];
    if (JSON.stringify(orderedIds) !== JSON.stringify(progress.orderedExerciseIds)) {
      throw new Error("The recovered exercise order does not match its saved checkpoint.");
    }
    if (
      progress.currentQuestionIndex < 0
      || progress.currentQuestionIndex > exercises.length
      || progress.answers.length + skippedExerciseIds.length
        !== progress.currentQuestionIndex
    ) {
      throw new Error("The recovered study position is invalid.");
    }
    this.clearStudyCheckpointTimer();
    this.studyExercises = exercises.map((exercise) => ({
      ...editableDraft(exercise),
      rejected: false,
      occlusionReviewed: true,
    }));
    this.studyOrigin = {
      bankPath: progress.bankPath,
      bankId: progress.bankId,
      bankRevisionAtStart: progress.bankRevisionAtStart,
      exerciseCountAtStart: progress.exerciseCountAtStart,
    };
    this.studyLearningProgress = progress.learningProgress === undefined
      ? null
      : structuredClone(progress.learningProgress);
    this.studyPathStep = recoveredPathStepPresentation(
      progress.learningProgress,
      exercises.length,
    );
    this.studyLearningEvidenceByExerciseId.clear();
    for (const evidence of [
      ...evidenceByExerciseId,
      ...(progress.learningProgress?.evidence ?? []),
    ]) {
      this.studyLearningEvidenceByExerciseId.set(
        evidence.exerciseId,
        structuredClone(evidence),
      );
    }
    this.studyTutorProblemStarted = false;
    this.studySessionId = progress.sessionId;
    this.studyStartedAt = progress.startedAt;
    this.studyIndex = progress.currentQuestionIndex;
    this.studyAnswers = progress.answers.map((answer) => structuredClone(answer));
    this.studySkippedExerciseIds = [...skippedExerciseIds];
    this.studyCurrentInput = structuredClone(progress.currentInput);
    this.studySubmitted = structuredClone(progress.currentInput?.submitted ?? null);
    this.answerReviewMode = progress.answerReviewMode;
    this.answerReviewProvider = progress.answerReviewProvider;
    this.answerReviewReasoningEffort = progress.answerReviewReasoningEffort;
    this.orderingState = progress.currentInput?.ordering !== undefined
      ? [...progress.currentInput.ordering]
      : [];
    this.studyFinishing = false;
    this.studyFinishError = null;
    this.studyCheckpointWarningShown = false;
    this.stage = "study";
    this.render();
  }

  public discardStudySession(): void {
    this.clearStudyCheckpointTimer();
    this.studyExercises = [];
    this.studyAnswers = [];
    this.studySkippedExerciseIds = [];
    this.studyIndex = 0;
    this.studySessionId = "";
    this.studyStartedAt = "";
    this.studySubmitted = null;
    this.studyCurrentInput = null;
    this.studyOrigin = null;
    this.studyLearningProgress = null;
    this.studyPathStep = null;
    this.studyLearningEvidenceByExerciseId.clear();
    this.studyTutorProblemStarted = false;
    this.stage = this.drafts.length > 0 ? "review" : "source";
    this.render();
  }

  private render(): void {
    this.reconcileAnswerReviewStatuses();
    this.clearOcclusionEditors();
    this.reviewSaveButton = null;
    this.reviewStudyButton = null;
    this.reviewAcceptAllButton = null;
    this.reviewSummaryEl = null;
    this.reviewGateNoticeEl = null;
    this.answerReviewControlsEl = null;
    this.answerReviewStatusEl = null;
    this.answerReviewActionsEl = null;
    this.agentActivityHostEl = null;
    this.agentActivitySummaryEl = null;
    this.activityElapsedEls = [];
    this.studyFeedbackActionsEl = null;
    this.studyCompletionProvisionalEl = null;
    this.studyCompletionOutcomeEl = null;
    this.studyCompletionRunSummaryEl = null;
    this.studyCompletionAiFeedbackEl = null;
    this.studyRunMetricEls.clear();
    this.studyCompletionMetricEls.clear();
    this.contentEl.empty();
    this.contentEl.addClass("practice-lab-view");
    this.contentEl.toggleClass(
      "is-compact",
      this.displayPreferences.practice.density === "compact",
    );

    if (this.options.creationAvailable === false && this.stage !== "study") {
      this.renderStudyOnlyHome();
      applyHoverDescriptions(this.contentEl);
      return;
    }

    const header = this.contentEl.createDiv({ cls: "practice-lab-header" });
    const heading = header.createDiv();
    heading.createEl("h2", { text: "Practice Problem Generator" });
    if (this.displayPreferences.practice.showHeaderDescription) {
      heading.createEl("p", {
        text: "Turn one note into grounded practice, then study it without leaving your vault.",
      });
    }
    const icon = header.createDiv({ cls: "practice-lab-header-icon" });
    setIcon(icon, "flask-conical");
    this.renderCreationModeSwitch(this.contentEl);
    this.renderGenerationRecovery(this.contentEl);

    this.agentActivityHostEl = this.contentEl.createDiv({
      cls: "practice-lab-agent-activity-host",
    });
    this.updateAgentActivityDom();

    if (
      this.stage !== "study"
      && this.displayPreferences.practice.showGenerationStepper
    ) {
      this.renderStepper(this.contentEl);
    }
    const body = this.contentEl.createDiv({ cls: "practice-lab-body" });
    switch (this.stage) {
      case "source":
        this.renderSource(body);
        break;
      case "configure":
        this.renderConfigure(body);
        break;
      case "review":
        this.renderReview(body);
        break;
      case "study":
        this.renderStudy(body);
        break;
    }
    applyHoverDescriptions(this.contentEl);
  }

  private renderStudyOnlyHome(): void {
    const header = this.contentEl.createDiv({ cls: "practice-lab-header" });
    const heading = header.createDiv();
    heading.createEl("h2", { text: "Practice" });
    heading.createEl("p", {
      text: "Open a saved practice bank to begin an offline session.",
    });
    const icon = header.createDiv({ cls: "practice-lab-header-icon" });
    setIcon(icon, "gamepad-2");
    const body = this.contentEl.createDiv({ cls: "practice-lab-body" });
    const empty = body.createDiv({ cls: "practice-lab-empty" });
    empty.createEl("strong", { text: "No practice session is open" });
    empty.createEl("p", {
      text: "Open a saved practice note and start its practice session.",
    });
  }

  private renderCreationModeSwitch(container: HTMLElement): void {
    if (Platform.isMobileApp || this.options.callbacks.openGuidedLearningPath === undefined) return;
    const switchBlocked = this.stage === "review"
      || this.stage === "study"
      || this.job.state === "running"
      || this.job.state === "cancelling";
    renderSharedCreationModeSwitch(container, {
      active: "quick",
      quickDisabled: true,
      guidedDisabled: switchBlocked,
      ...(switchBlocked
        ? {
            guidedDisabledReason: this.stage === "study"
              ? "Finish or leave the current practice session before changing creation mode."
              : "Finish the current generation or draft review before changing creation mode.",
          }
        : {}),
      onQuick: () => undefined,
      onGuided: () => {
        void this.options.callbacks.openGuidedLearningPath?.(this.source);
      },
    });
  }

  private renderGenerationRecovery(container: HTMLElement): void {
    const recovery = this.generationRecovery;
    if (recovery === null) return;
    const panel = container.createEl("section", {
      cls: `practice-generation-recovery is-${recovery.state}`,
      attr: {
        role: recovery.state === "failed" || recovery.state === "blocked" ? "alert" : "status",
        "aria-live": "polite",
      },
    });
    const copy = panel.createDiv({ cls: "practice-generation-recovery-copy" });
    const title = recovery.state === "ready"
      ? "Recovered draft ready"
      : recovery.state === "running"
        ? "Generation recovery in progress"
        : recovery.state === "blocked"
          ? "Saved generation needs attention"
          : "Saved generation stopped";
    copy.createEl("strong", { text: title });
    copy.createEl("p", { text: recovery.message });
    const actions = panel.createDiv({ cls: "practice-generation-recovery-actions" });
    if (
      (recovery.state === "running" || recovery.state === "blocked" || recovery.state === "ready")
      && this.options.callbacks.resumeInterruptedGeneration !== undefined
    ) {
      new ButtonComponent(actions)
        .setIcon(recovery.state === "ready" ? "file-check-2" : "history")
        .setButtonText(recovery.state === "ready" ? "Open recovered draft" : "Resume / inspect")
        .setDisabled(this.job.state === "running" || this.job.state === "cancelling")
        .onClick(() => void this.options.callbacks.resumeInterruptedGeneration?.());
    }
    if (
      recovery.state === "failed"
      && this.options.callbacks.retryInterruptedGeneration !== undefined
    ) {
      new ButtonComponent(actions)
        .setIcon("refresh-cw")
        .setButtonText("Retry approved request")
        .setCta()
        .onClick(() => void this.options.callbacks.retryInterruptedGeneration?.());
    }
    if (this.options.callbacks.discardInterruptedGeneration !== undefined) {
      new ButtonComponent(actions)
        .setIcon("trash-2")
        .setButtonText("Discard recovery...")
        .setDestructive()
        .setDisabled(this.job.state === "running" || this.job.state === "cancelling")
        .onClick(() => void this.options.callbacks.discardInterruptedGeneration?.());
    }
  }

  private renderPreservingScroll(): void {
    const scrollTop = this.contentEl.scrollTop;
    this.render();
    this.contentEl.scrollTop = scrollTop;
  }

  private renderStepper(container: HTMLElement): void {
    const steps = container.createDiv({
      cls: "practice-lab-stepper",
      attr: { "aria-label": "Practice generation steps" },
    });
    const definitions: ReadonlyArray<readonly [Exclude<MainStage, "study">, string]> = [
      ["source", "Source"],
      ["configure", "Configure"],
      ["review", "Review"],
    ];
    for (const [index, [stage, label]] of definitions.entries()) {
      const button = steps.createEl("button", {
        cls: this.stage === stage ? "is-active" : "",
        attr: {
          type: "button",
          "aria-current": this.stage === stage ? "step" : "false",
        },
      });
      button.createSpan({ cls: "practice-step-number", text: String(index + 1) });
      button.createSpan({ text: label });
      const unavailable = stage === "configure" ? this.source === null : stage === "review" ? this.drafts.length === 0 : false;
      button.disabled = unavailable;
      button.addEventListener("click", () => {
        this.stage = stage;
        this.render();
      });
    }
  }

  private renderSource(container: HTMLElement): void {
    const section = container.createEl("section", {
      cls: "practice-learning-path-section practice-source-stage",
    });
    const top = section.createDiv({ cls: "practice-learning-path-section-heading" });
    top.createEl("h3", { text: "Primary source" });
    top.createEl("p", {
      text: "Choose exactly what this set may use. Source material is read only and never rewritten.",
    });
    const availableModes = new Set<SourceChoiceMode>();
    if (this.options.callbacks.requestSource !== undefined) {
      availableModes.add("note");
      availableModes.add("selection");
    }
    if (this.options.callbacks.requestPdfSource !== undefined) {
      availableModes.add("pdf");
    }
    renderSourceChoices(section, {
      availableModes,
      busyMode: this.sourceRequestMode,
      disabled: this.sourceRequestMode !== null,
      onChoose: (mode) => {
        if (mode === "pdf") void this.requestPdfSource();
        else if (mode === "vault-note") void this.requestNoteSource();
        else void this.requestSource(mode);
      },
    });

    if (this.source !== null) {
      section.createEl("p", {
        cls: "practice-source-replace-note",
        text: "Choosing another option replaces this source and clears the unsaved configuration for it.",
      });
    }

    if (this.sourceRequestMode !== null) {
      const status = section.createDiv({
        cls: "practice-lab-source-loading",
        attr: { role: "status", "aria-live": "polite" },
      });
      const spinner = status.createSpan({ cls: "practice-lab-spinner" });
      setIcon(spinner, "loader-circle");
      status.createSpan({
        text: this.sourceRequestMode === "pdf"
          ? "Preparing the PDF source. Complete or cancel the page dialog to continue."
          : this.sourceRequestMode === "vault-note"
            ? "Choose a Markdown note from the searchable vault list, or cancel to keep this source."
            : "Reading the active source…",
      });
    }

    if (this.source === null) {
      const empty = section.createDiv({ cls: "practice-source-empty-inline" });
      const emptyIcon = empty.createSpan();
      setIcon(emptyIcon, "file-search");
      empty.createSpan({
        text: "No source is loaded yet. Open a note or PDF, then choose one option above.",
      });
      return;
    }

    renderSourceSummaryCard(section, this.source, {
      badge: sourceModeLabel(this.source),
      showPath: this.displayPreferences.practice.showSourcePath,
      showExcerpt: this.displayPreferences.practice.showSourceExcerpt,
      ...(this.options.callbacks.requestNoteSource === undefined ? {} : {
        actionLabel: "Choose another note…",
        actionDescription: "Search the vault and replace this primary source with a different complete Markdown note.",
        actionDisabled: this.sourceRequestMode !== null,
        onAction: () => {
          void this.requestNoteSource();
        },
      }),
    });

    const visualHeading = section.createDiv({ cls: "practice-source-subheading" });
    const visualCopy = visualHeading.createDiv();
    visualCopy.createEl("strong", { text: "Detected visuals" });
    visualCopy.createEl("p", {
      text: "Select only visuals that should be sent. GIFs use your default frame automatically; videos and remote images still require explicit review.",
    });
    if (this.source.visuals.length === 0) {
      section.createEl("p", {
        cls: "practice-lab-muted practice-learning-path-visual-empty",
        text: this.source.mode === "pdf"
          ? "No separate visual was selected. PDF text is page-grounded; embedded page images are not uploaded automatically."
          : "No supported visuals were detected in this source.",
      });
    } else {
      const bulkControls = section.createDiv({
        cls: "practice-learning-path-visual-toolbar practice-lab-visual-bulk-controls",
      });
      const defaultLabel = bulkControls.createEl("label", {
        cls: "practice-learning-path-gif-default practice-lab-gif-default",
      });
      defaultLabel.createSpan({ text: "Default GIF frame" });
      const defaultSelect = defaultLabel.createEl("select", {
        attr: {
          "aria-label": "Default GIF frame for newly selected animations",
          "aria-description": "Select all images uses this frame automatically. You can still override an individual GIF.",
        },
      });
      for (const position of ["first", "middle", "last"] as const) {
        defaultSelect.createEl("option", {
          value: position,
          text: displayGifFramePosition(position),
        });
      }
      defaultSelect.value = this.gifFrameDefault;
      defaultSelect.disabled = this.visualSelectionBusy;
      defaultSelect.addEventListener("change", () => {
        this.gifFrameDefault = defaultSelect.value as GifFramePosition;
        const updateDefault = this.options.callbacks.updateGifFrameDefault;
        if (updateDefault !== undefined) {
          Promise.resolve(updateDefault(this.gifFrameDefault)).catch((error: unknown) => {
            new Notice(this.errorMessage(error, "Could not save the GIF default."));
          });
        }
      });
      new ButtonComponent(bulkControls)
        .setIcon("list-checks")
        .setButtonText(this.visualSelectionBusy ? "Updating images…" : "Select all images")
        .setTooltip("Select every available local image. GIFs use the configured default unless you choose a different frame for that GIF.")
        .setDisabled(this.visualSelectionBusy)
        .onClick(() => void this.selectAllImages());
      new ButtonComponent(bulkControls)
        .setIcon("square-x")
        .setButtonText("Deselect all")
        .setTooltip("Remove every visual from the generation payload without changing any source file.")
        .setDisabled(
          this.visualSelectionBusy
            || !this.source.visuals.some((visual) => visual.selected),
        )
        .onClick(() => this.clearVisualSelection());
      bulkControls.createSpan({
        cls: "practice-learning-path-visual-count",
        text: `${selectedVisualIds(this.source).length} of ${this.source.visuals.length} selected`,
        attr: { "aria-live": "polite" },
      });
      const visualList = section.createDiv({
        cls: "practice-lab-visual-grid practice-source-visual-grid",
      });
      for (const visual of this.source.visuals) this.renderVisualCard(visualList, visual);
    }

    const footer = container.createDiv({ cls: "practice-lab-stage-footer" });
    new ButtonComponent(footer)
      .setIcon("arrow-right")
      .setButtonText("Configure practice")
      .setCta()
      .onClick(() => {
        this.stage = "configure";
        this.render();
      });
  }

  private renderVisualCard(container: HTMLElement, visual: DetectedVisual): void {
    const card = container.createDiv({
      cls: `practice-lab-visual-card is-${visual.state}`,
    });
    if (visual.previewUrl !== undefined) {
      card.createEl("img", {
        cls: "practice-lab-visual-preview",
        attr: {
          src: visual.previewUrl,
          alt: `Preview of ${displayVisualName(visual)}`,
          loading: "lazy",
        },
      });
    }
    const heading = card.createDiv({ cls: "practice-lab-visual-heading" });
    const icon = heading.createSpan({ cls: "practice-lab-visual-icon" });
    setIcon(icon, visual.kind === "video" ? "video" : "image");
    const title = heading.createDiv();
    title.createEl("strong", { text: displayVisualName(visual) });
    title.createSpan({ text: VISUAL_LABELS[visual.kind] });
    const status = heading.createSpan({
      cls: "practice-lab-status-pill",
      text: visual.state.replaceAll("-", " "),
    });
    status.setAttribute("aria-label", `Visual status: ${status.textContent ?? ""}`);

    if (visual.reason !== undefined) {
      card.createEl("p", { cls: "practice-lab-visual-reason", text: visual.reason });
    }

    const controls = card.createDiv({ cls: "practice-lab-visual-controls" });
    if (visual.state === "ready") {
      const label = controls.createEl("label", { cls: "practice-lab-checkbox" });
      const checkbox = label.createEl("input", { attr: { type: "checkbox" } });
      checkbox.checked = visual.selected;
      checkbox.disabled = this.visualSelectionBusy;
      label.createSpan({ text: "Use for generation" });
      checkbox.addEventListener("change", () => {
        this.updateVisual({ ...visual, selected: checkbox.checked });
      });
      if (isGifVisual(visual)) {
        if (visual.framePosition !== this.gifFrameDefault) {
          const useDefault = new ButtonComponent(controls)
            .setIcon("check")
            .setButtonText(`Use ${displayGifFramePosition(this.gifFrameDefault)}`)
            .setDisabled(
              this.visualSelectionBusy
                || this.options.callbacks.chooseMediaFrame === undefined,
            );
          useDefault.onClick(() => void this.resolveFrame(
            visual,
            this.gifFrameDefault,
          ));
        }
        const change = new ButtonComponent(controls)
          .setIcon("scan-line")
          .setButtonText("Choose different frame")
          .setDisabled(
            this.visualSelectionBusy
              || this.options.callbacks.chooseMediaFrame === undefined,
          );
        change.onClick(() => void this.resolveFrame(visual));
      }
    } else if (visual.state === "frame-required") {
      if (isGifVisual(visual)) {
        const useDefault = new ButtonComponent(controls)
          .setIcon("check")
          .setButtonText(`Use ${displayGifFramePosition(this.gifFrameDefault)}`)
          .setDisabled(
            this.visualSelectionBusy
              || this.options.callbacks.chooseMediaFrame === undefined,
          );
        useDefault.onClick(() => void this.resolveFrame(
          visual,
          this.gifFrameDefault,
        ));
        const choose = new ButtonComponent(controls)
          .setIcon("scan-line")
          .setButtonText("Choose different frame")
          .setDisabled(
            this.visualSelectionBusy
              || this.options.callbacks.chooseMediaFrame === undefined,
          );
        choose.onClick(() => void this.resolveFrame(visual));
      } else {
        const button = new ButtonComponent(controls)
          .setIcon("scan-line")
          .setButtonText("Choose still frame")
          .setDisabled(
            this.visualSelectionBusy
              || this.options.callbacks.chooseMediaFrame === undefined,
          );
        button.onClick(() => void this.resolveFrame(visual));
      }
    } else if (visual.state === "consent-required") {
      const host = visual.remoteHost ?? "this remote host";
      card.createEl("p", {
        cls: "practice-lab-consent-note",
        text: `Importing will download one snapshot from ${host}. The source note will not change.`,
      });
      const button = new ButtonComponent(controls)
        .setIcon("download")
        .setButtonText("Preview and import");
      button.setDisabled(
        this.visualSelectionBusy
          || this.options.callbacks.importRemoteVisual === undefined,
      );
      button.onClick(() => void this.importRemote(visual));
    }
  }

  private renderConfigure(container: HTMLElement): void {
    const source = this.source;
    if (source === null) {
      this.stage = "source";
      this.render();
      return;
    }

    const heading = container.createDiv({ cls: "practice-lab-section-heading" });
    heading.createEl("h3", { text: "Configure the set" });
    heading.createEl("p", {
      text: "Choose the exact exercise mix. Practice Problem Generator keeps the allocation balanced and converts it into deterministic item counts before any provider is contacted.",
    });
    if (this.regenerationContext !== null) {
      const context = container.createDiv({
        cls: "practice-lab-regeneration-context",
        attr: { role: "status" },
      });
      context.createEl("strong", { text: "Previous practice loaded" });
      context.createEl("p", { text: this.regenerationContext });
      context.createEl("p", {
        cls: "practice-lab-muted",
        text: "Tweak any field below, review source if you want different visuals, then preview and approve the exact payload before generation.",
      });
    }

    let refreshMix = (): void => undefined;
    let refreshOutput = (): void => undefined;
    let refreshModelControl = (): void => undefined;
    let refreshReasoningControl = (): void => undefined;
    const configurationChanged = (): void => {
      this.invalidatePreview();
      refreshOutput();
    };

    const form = container.createDiv({ cls: "practice-lab-config-grid" });
    const providerSetting = new Setting(form)
      .setName("AI provider")
      .setDesc("Practice Problem Generator never switches providers silently.");
    const providerSelect = providerSetting.controlEl.createEl("select", {
      attr: { "aria-label": "AI provider" },
    });
    for (const provider of this.providers) {
      const option = providerSelect.createEl("option", {
        value: provider.id,
        text: provider.available ? provider.label : `${provider.label} — unavailable`,
      });
      option.disabled = !provider.available;
    }
    providerSelect.value = this.provider;
    providerSelect.addEventListener("change", () => {
      this.modelsByProvider[this.provider] = this.model;
      this.provider = providerSelect.value as ProviderId;
      this.model = this.modelsByProvider[this.provider];
      this.syncCustomModelState();
      this.ensureSupportedReasoningEffort();
      this.invalidatePreview();
      this.renderPreservingScroll();
    });

    const selectedProvider = this.providers.find(
      (provider) => provider.id === this.provider,
    );
    const providerStatus = providerSetting.descEl.createDiv({
      cls: `practice-lab-provider-status${selectedProvider?.available === true ? " is-ready" : " is-unavailable"}`,
      attr: { role: "status" },
    });
    providerStatus.setText(
      selectedProvider?.available === true
        ? [
            "Ready",
            selectedProvider.version,
            selectedProvider.supportsVision ? "vision enabled" : "text only",
            selectedProvider.models.length > 0
              ? `${selectedProvider.models.length} models detected`
              : undefined,
          ].filter((part) => part !== undefined).join(" · ")
        : selectedProvider?.detail ?? "Provider availability has not been confirmed.",
    );
    const modelCatalog = this.modelCatalog(this.provider);
    const modelSetting = new Setting(form)
      .setName("Model")
      .setDesc("Choose a model exposed by the selected CLI. Automatic follows the provider default; Custom preserves any safe exact model id.");
    const modelControls = modelSetting.controlEl.createDiv({
      cls: "practice-lab-model-controls",
    });
    const modelSelect = modelControls.createEl("select", {
      attr: { "aria-label": "AI model" },
    });
    const initialAutomaticModel = automaticModelForProvider(
      this.provider,
      this.reasoningEffort,
      modelCatalog,
    );
    const automaticModelOption = modelSelect.createEl("option", {
      value: AUTOMATIC_MODEL_CHOICE,
      text: this.provider === "agy"
        ? initialAutomaticModel.length > 0
          ? `Automatic (${initialAutomaticModel})`
          : "Automatic (no compatible catalog model)"
        : "Automatic (provider default)",
    });
    automaticModelOption.disabled = this.provider === "agy"
      && initialAutomaticModel.length === 0;
    for (const option of modelCatalog) {
      const element = modelSelect.createEl("option", {
        value: option.id,
        text: option.label,
      });
      element.title = option.description
        ?? modelReasoningSummary(option.supportedReasoningEfforts);
    }
    modelSelect.createEl("option", {
      value: CUSTOM_MODEL_CHOICE,
      text: "Custom model id…",
    });
    const customModelInput = modelControls.createEl("input", {
      type: "text",
      placeholder: "Exact model id",
      cls: "practice-lab-custom-model-input",
      attr: {
        "aria-label": "Custom model id",
        maxlength: String(MAX_MODEL_ID_LENGTH),
        autocomplete: "off",
      },
    });
    customModelInput.spellcheck = false;
    const modelDetail = modelSetting.descEl.createDiv({
      cls: "practice-lab-model-detail",
      attr: { role: "status" },
    });
    if (selectedProvider?.modelCatalogDetail !== undefined) {
      modelSetting.descEl.createDiv({
        cls: "practice-lab-model-catalog-note",
        text: selectedProvider.models.length === 0
          ? `Live model list unavailable; showing conservative built-in choices. ${selectedProvider.modelCatalogDetail}`
          : `Model catalog note: ${selectedProvider.modelCatalogDetail}`,
      });
    }
    const updateModelDetail = (): void => {
      const choice = this.customModelModeByProvider[this.provider]
        ? CUSTOM_MODEL_CHOICE
        : modelPickerChoice(
            this.provider,
            this.model,
            this.reasoningEffort,
            modelCatalog,
          );
      const known = modelCatalog.find((entry) => entry.id === this.model);
      if (choice === CUSTOM_MODEL_CHOICE) {
        modelDetail.setText(
          this.model.length === 0
            ? "Enter a safe exact CLI model identifier."
            : `Custom exact model: ${this.model}`,
        );
        return;
      }
      if (choice === AUTOMATIC_MODEL_CHOICE) {
        const automaticModel = automaticModelForProvider(
          this.provider,
          this.reasoningEffort,
          modelCatalog,
        );
        modelDetail.setText(
          this.provider === "agy"
            ? automaticModel.length > 0
              ? `Practice Problem Generator will pin and record ${automaticModel} because agy requires an explicit model.`
              : "No compatible automatic agy model is available for this reasoning level. Choose a listed or custom model."
            : "The CLI will choose its current provider default; history records that the model was not pinned.",
        );
        return;
      }
      if (known !== undefined) {
        modelDetail.setText(
          known.description ?? modelReasoningSummary(known.supportedReasoningEfforts),
        );
        return;
      }
      modelDetail.setText(`Exact model: ${this.model}`);
    };
    refreshModelControl = (): void => {
      const automaticModel = automaticModelForProvider(
        this.provider,
        this.reasoningEffort,
        modelCatalog,
      );
      automaticModelOption.setText(
        this.provider === "agy"
          ? automaticModel.length > 0
            ? `Automatic (${automaticModel})`
            : "Automatic (no compatible catalog model)"
          : "Automatic (provider default)",
      );
      automaticModelOption.disabled = this.provider === "agy"
        && automaticModel.length === 0;
      const choice = this.customModelModeByProvider[this.provider]
        ? CUSTOM_MODEL_CHOICE
        : modelPickerChoice(
            this.provider,
            this.model,
            this.reasoningEffort,
            modelCatalog,
          );
      modelSelect.value = choice;
      customModelInput.hidden = choice !== CUSTOM_MODEL_CHOICE;
      if (!customModelInput.hidden) customModelInput.value = this.model;
      updateModelDetail();
    };
    modelSelect.addEventListener("change", () => {
      const choice = modelSelect.value;
      if (choice === AUTOMATIC_MODEL_CHOICE) {
        this.customModelModeByProvider[this.provider] = false;
        this.model = "";
      } else if (choice === CUSTOM_MODEL_CHOICE) {
        this.customModelModeByProvider[this.provider] = true;
        this.model = this.customModelDraftsByProvider[this.provider];
      } else {
        this.customModelModeByProvider[this.provider] = false;
        this.model = choice;
        if (this.provider === "agy") {
          this.reasoningEffort = agyReasoningEffortForModel(choice)
            ?? this.reasoningEffort;
        }
      }
      this.modelsByProvider[this.provider] = this.model;
      this.ensureSupportedReasoningEffort();
      refreshModelControl();
      refreshReasoningControl();
      configurationChanged();
      if (choice === CUSTOM_MODEL_CHOICE) customModelInput.focus();
    });
    customModelInput.addEventListener("input", () => {
      this.model = customModelInput.value.trim();
      this.modelsByProvider[this.provider] = this.model;
      this.customModelDraftsByProvider[this.provider] = this.model;
      updateModelDetail();
      this.ensureSupportedReasoningEffort();
      refreshReasoningControl();
      configurationChanged();
    });

    const reasoningSetting = new Setting(form)
      .setName("Reasoning effort")
      .setDesc("Only reasoning levels supported by the selected model are shown.");
    const reasoningSelect = reasoningSetting.controlEl.createEl("select", {
      attr: { "aria-label": "Reasoning effort" },
    });
    refreshReasoningControl = (): void => {
      const efforts = this.supportedReasoningEfforts();
      const selectedModel = modelCatalog.find((entry) => entry.id === this.model);
      this.reasoningEffort = preferredReasoningEffort(
        this.reasoningEffort,
        efforts,
        selectedModel,
      );
      reasoningSelect.empty();
      for (const effort of efforts) {
        reasoningSelect.createEl("option", {
          value: effort,
          text: displayReasoningEffort(effort),
        });
      }
      reasoningSelect.value = this.reasoningEffort;
      reasoningSetting.setDesc(
        `${reasoningEffortDescription(this.provider)} Only levels supported by the selected model are listed.`,
      );
    };
    reasoningSelect.addEventListener("change", () => {
      this.reasoningEffort = reasoningSelect.value as ReasoningEffort;
      if (this.provider === "agy") {
        this.model = this.customModelModeByProvider.agy || this.model.length === 0
          ? this.model
          : agyModelForReasoning(this.model, this.reasoningEffort, modelCatalog);
        this.modelsByProvider.agy = this.model;
      }
      refreshModelControl();
      configurationChanged();
    });
    refreshModelControl();
    refreshReasoningControl();

    new Setting(form)
      .setName("Number of exercises")
      .setDesc("Choose between 1 and 30 items. Distribution counts update from this total.")
      .addText((component) => {
        component.inputEl.type = "number";
        component.inputEl.min = "1";
        component.inputEl.max = "30";
        component.setValue(String(this.quantity));
        component.inputEl.addEventListener("change", () => {
          const parsed = Number.parseInt(component.inputEl.value, 10);
          this.quantity = Number.isFinite(parsed)
            ? Math.min(30, Math.max(1, parsed))
            : 10;
          component.setValue(String(this.quantity));
          refreshMix();
          configurationChanged();
        });
      });

    const difficultySetting = new Setting(form)
      .setName("Difficulty")
      .setDesc("Choose the reasoning demand for this set. It never expands the approved source or permits missing assumptions.");
    difficultySetting.settingEl.addClass("practice-lab-difficulty-setting");
    renderDifficultySelector(difficultySetting.controlEl, {
      value: this.difficulty,
      name: "practice-lab-generation-difficulty",
      ariaLabel: "Generation difficulty profile",
      onChange: (value) => {
        this.difficulty = value;
        configurationChanged();
      },
    });

    const focusSetting = new Setting(form)
      .setName("Focus instructions for the AI")
      .setDesc(
        "Optional guidance for this draft only. Specify what to emphasize, compare, avoid, or make more challenging. The source and exact exercise mix remain authoritative.",
      );
    focusSetting.settingEl.addClass("practice-lab-focus-setting");
    const focusCount = focusSetting.descEl.createSpan({
      cls: "practice-lab-focus-count",
      text: `${this.focusInstructions.length} / ${MAX_FOCUS_INSTRUCTIONS_LENGTH.toLocaleString()}`,
    });
    focusSetting.addTextArea((component) => {
      component
        .setPlaceholder(
          "Example: Focus on the physical cause-and-effect chain. Compare the two operating regimes, and avoid definition-only questions.",
        )
        .setValue(this.focusInstructions)
        .onChange((value) => {
          this.focusInstructions = value;
          focusCount.setText(
            `${value.length} / ${MAX_FOCUS_INSTRUCTIONS_LENGTH.toLocaleString()}`,
          );
          configurationChanged();
        });
      component.inputEl.maxLength = MAX_FOCUS_INSTRUCTIONS_LENGTH;
      component.inputEl.rows = 4;
      component.inputEl.setAttribute(
        "aria-label",
        "Focus instructions for the AI",
      );
    });

    const typeSection = container.createDiv({
      cls: "practice-lab-type-section",
    });
    const output = container.createDiv({ cls: "practice-lab-config-output" });
    refreshOutput = (): void => {
      const scrollTop = this.contentEl.scrollTop;
      output.empty();
      this.renderConfigureOutput(output, source, refreshOutput);
      this.contentEl.scrollTop = scrollTop;
    };
    refreshMix = this.renderExerciseMix(typeSection, configurationChanged);
    refreshOutput();
  }

  private renderExerciseMix(
    container: HTMLElement,
    onConfigurationChanged: () => void,
  ): () => void {
    const typeHeading = container.createDiv({
      cls: "practice-lab-type-heading",
    });
    const typeHeadingCopy = typeHeading.createDiv();
    typeHeadingCopy.createEl("h4", { text: "Exercise mix" });
    typeHeadingCopy.createEl("p", {
      text: "Change one share and the other selected types rebalance automatically. A type may temporarily reach 0% during a large drag and will return automatically when you slide back. The total always remains 100%.",
    });
    const typeActions = typeHeading.createDiv({
      cls: "practice-lab-type-actions",
    });
    new ButtonComponent(typeActions)
      .setButtonText("Recommended")
      .setTooltip("Restore the constructed-response-heavy Practice Problem Generator mix.")
      .onClick(() => {
        applyMix(copyExerciseTypePercentages(
          RECOMMENDED_EXERCISE_TYPE_PERCENTAGES,
        ));
      });
    new ButtonComponent(typeActions)
      .setButtonText("Core reasoning")
      .setTooltip("Use only short answer, causal explanation, application, and calculation.")
      .onClick(() => {
        applyMix(balanceExerciseTypes([
          "short-answer",
          "causal-explanation",
          "application",
          "calculation",
        ]));
      });
    const equalSelectedButton = new ButtonComponent(typeActions)
      .setButtonText("Equal selected")
      .setTooltip("Give every currently selected type an equal share.")
      .onClick(() => {
        applyMix(balanceExerciseTypes(
          enabledExerciseTypes(this.exerciseTypePercentages),
        ));
      });
    const selectAllButton = new ButtonComponent(typeActions)
      .setButtonText("Select all")
      .setTooltip("Select every exercise type and give each one an equal share.")
      .onClick(() => {
        applyMix(balanceExerciseTypes(EXERCISE_TYPES));
      });
    const deselectAllButton = new ButtonComponent(typeActions)
      .setButtonText("Deselect all")
      .setTooltip("Clear every exercise type. Generation stays blocked until you select at least one.")
      .onClick(() => {
        applyMix(balanceExerciseTypes([]));
      });

    const distributionSummary = container.createDiv({
      cls: "practice-lab-distribution-summary",
      attr: { role: "status", "aria-live": "polite" },
    });
    const distributionTotal = distributionSummary.createEl("strong");
    const distributionDetail = distributionSummary.createSpan();

    const types = container.createDiv({ cls: "practice-lab-type-grid" });
    const controls = new Map<ExerciseType, {
      readonly row: HTMLDivElement;
      readonly checkbox: HTMLInputElement;
      readonly slider: HTMLInputElement;
      readonly percentage: HTMLInputElement;
      readonly count: HTMLSpanElement;
    }>();
    const intendedTypes = new Set(enabledExerciseTypes(
      this.exerciseTypePercentages,
    ));
    const rememberedPercentages = copyExerciseTypePercentages(
      this.exerciseTypePercentages,
    );
    let refresh = (): void => undefined;
    const applyMix = (
      percentages: Readonly<Record<ExerciseType, number>>,
      preserveSliderIntent = false,
    ): void => {
      this.exerciseTypePercentages = copyExerciseTypePercentages(percentages);
      if (!preserveSliderIntent) {
        intendedTypes.clear();
        for (const selected of enabledExerciseTypes(percentages)) {
          intendedTypes.add(selected);
        }
      }
      for (const candidate of EXERCISE_TYPES) {
        if (percentages[candidate] > 0) {
          rememberedPercentages[candidate] = percentages[candidate];
        }
      }
      refresh();
      onConfigurationChanged();
    };
    for (const type of EXERCISE_TYPES) {
      const row = types.createDiv({
        cls: "practice-lab-type-row",
        attr: { "data-exercise-type": type },
      });
      const label = row.createEl("label", { cls: "practice-lab-type-toggle" });
      const checkbox = label.createEl("input", { attr: { type: "checkbox" } });
      checkbox.dataset.mixControl = "toggle";
      label.createSpan({ text: EXERCISE_LABELS[type] });
      checkbox.addEventListener("change", () => {
        applyMix(toggleExerciseType(
          this.exerciseTypePercentages,
          type,
          checkbox.checked,
        ));
      });

      const allocation = row.createDiv({
        cls: "practice-lab-type-allocation",
      });
      const percentageLabel = allocation.createEl("label", {
        cls: "practice-lab-percentage-control",
      });
      const input = percentageLabel.createEl("input", {
        attr: {
          type: "number",
          min: "0",
          max: "100",
          step: "1",
          "aria-label": `${EXERCISE_LABELS[type]} percentage`,
        },
      });
      input.dataset.mixControl = "percentage";
      percentageLabel.createSpan({ text: "%" });
      input.addEventListener("change", () => {
        const parsed = Number.parseInt(input.value, 10);
        if (!Number.isFinite(parsed)) {
          refresh();
          return;
        }
        applyMix(rebalanceExerciseTypePercentage(
          this.exerciseTypePercentages,
          type,
          parsed,
        ));
      });
      const count = allocation.createSpan({
        cls: "practice-lab-type-count",
      });
      const slider = row.createEl("input", {
        cls: "practice-lab-percentage-slider",
        attr: {
          type: "range",
          min: "1",
          max: "100",
          step: "1",
          draggable: "false",
          "aria-label": `${EXERCISE_LABELS[type]} percentage slider`,
        },
      });
      slider.dataset.mixControl = "slider";
      slider.addEventListener("input", () => {
        intendedTypes.add(type);
        applyMix(
          rebalanceExerciseTypePercentageWithIntent(
            this.exerciseTypePercentages,
            type,
            Number.parseInt(slider.value, 10),
            intendedTypes,
            rememberedPercentages,
          ),
          true,
        );
      });
      controls.set(type, {
        row,
        checkbox,
        slider,
        percentage: input,
        count,
      });
    }

    const roundedNote = container.createEl("p", {
      cls: "practice-lab-distribution-note",
    });
    refresh = (): void => {
      const distributionProblem = exerciseTypeDistributionProblem(
        this.exerciseTypePercentages,
      );
      const distributionPlan = distributionProblem === null
        ? planExerciseDistribution(this.exerciseTypePercentages, this.quantity)
        : [];
      const total = exerciseTypePercentageTotal(
        this.exerciseTypePercentages,
      );
      const selectedCount = enabledExerciseTypes(
        this.exerciseTypePercentages,
      ).length;
      equalSelectedButton.setDisabled(selectedCount <= 1);
      selectAllButton.setDisabled(selectedCount === EXERCISE_TYPES.length);
      deselectAllButton.setDisabled(selectedCount === 0);
      distributionSummary.classList.toggle(
        "is-valid",
        distributionProblem === null,
      );
      distributionSummary.classList.toggle(
        "is-invalid",
        distributionProblem !== null,
      );
      distributionTotal.setText(
        distributionProblem === null ? `${total}% allocated` : `${total}% total`,
      );
      distributionDetail.setText(distributionProblem === null
        ? ` · ${selectedCount} selected ${selectedCount === 1 ? "type" : "types"} · ${this.quantity} ${this.quantity === 1 ? "exercise" : "exercises"}`
        : ` · ${distributionProblem}`);
      for (const type of EXERCISE_TYPES) {
        const control = controls.get(type);
        if (control === undefined) continue;
        const percentage = this.exerciseTypePercentages[type];
        const enabled = percentage > 0;
        const targetCount = distributionProblem === null
          ? plannedExerciseCount(distributionPlan, type)
          : null;
        control.row.classList.toggle("is-enabled", enabled);
        control.row.classList.toggle(
          "is-rounded-out",
          enabled && targetCount === 0,
        );
        control.checkbox.checked = enabled;
        control.checkbox.disabled = enabled && selectedCount === 1;
        control.checkbox.title = control.checkbox.disabled
          ? "At least one exercise type must remain selected."
          : "";
        control.percentage.value = String(percentage);
        control.percentage.disabled = !enabled || selectedCount === 1;
        control.slider.value = String(Math.max(1, percentage));
        control.slider.disabled = !enabled || selectedCount === 1;
        control.count.setText(targetCount === null
          ? `— of ${this.quantity}`
          : `${targetCount} of ${this.quantity}`);
      }
      const roundedOut = distributionPlan.filter((target) => target.count === 0);
      roundedNote.hidden = roundedOut.length === 0;
      roundedNote.setText(roundedOut.length === 0
        ? ""
        : `${roundedOut.map((target) => EXERCISE_LABELS[target.type]).join(", ")} ${roundedOut.length === 1 ? "has" : "have"} a positive share but rounds to 0 items at this set size.`);
    };
    refresh();
    return refresh;
  }

  private renderConfigureOutput(
    container: HTMLElement,
    source: SourcePresentation,
    refreshOutput: () => void,
  ): void {
    const capability = this.configurationProblem();
    const recoveryBlocked = this.generationRecovery !== null;
    if (capability !== null) {
      const warning = container.createDiv({
        cls: "practice-lab-callout is-warning",
        attr: { role: "alert" },
      });
      setIcon(warning.createSpan(), "triangle-alert");
      warning.createSpan({ text: capability });
      if (this.options.callbacks.refreshProviders !== undefined) {
        new ButtonComponent(warning)
          .setIcon("refresh-cw")
          .setButtonText(
            this.providerRefreshBusy ? "Checking providers…" : "Check again",
          )
          .setDisabled(this.providerRefreshBusy)
          .onClick(() => void this.refreshProviders());
      }
    }
    this.renderPayloadPreview(
      container,
      capability !== null || recoveryBlocked,
      refreshOutput,
    );

    if (this.job.state === "failed") {
      const failure = container.createDiv({
        cls: "practice-lab-callout is-error",
        attr: { role: "alert", "aria-live": "assertive" },
      });
      setIcon(failure.createSpan(), "circle-alert");
      failure.createSpan({
        text: this.job.message ?? "Generation failed. Your reviewed payload is still ready to retry.",
      });
    }

    const footer = container.createDiv({ cls: "practice-lab-stage-footer" });
    new ButtonComponent(footer)
      .setIcon("arrow-left")
      .setButtonText("Back")
      .onClick(() => {
        this.stage = "source";
        this.render();
      });
    if (this.job.state === "running" || this.job.state === "cancelling") {
      this.renderJob(footer);
    } else {
      const generate = new ButtonComponent(footer)
        .setIcon("sparkles")
        .setButtonText(
          this.job.state === "failed" ? "Retry generation" : "Generate draft set",
        )
        .setCta();
      const currentKey = configurationKey(source, this.getConfiguration());
      generate.setDisabled(
        capability !== null ||
          recoveryBlocked ||
          !this.payloadAccepted ||
          this.previewKey !== currentKey ||
          this.payloadPreview === null,
      );
      generate.onClick(() => void this.generate());
    }

  }

  private renderPayloadPreview(
    container: HTMLElement,
    configurationInvalid: boolean,
    onStateChanged: () => void,
  ): void {
    const details = container.createEl("details", {
      cls: "practice-lab-payload-preview",
    });
    details.open = this.payloadPreviewOpen;
    details.addEventListener("toggle", () => {
      this.payloadPreviewOpen = details.open;
    });
    details.createEl("summary", {
      text: "Preview exactly what will be sent",
    });
    const body = details.createDiv({ cls: "practice-lab-payload-body" });
    if (this.payloadPreview === null) {
      body.createEl("p", {
        text: "Build the payload preview before generation. No provider is contacted by this preview.",
      });
      const build = new ButtonComponent(body)
        .setIcon("eye")
        .setButtonText("Build payload preview");
      build.setDisabled(configurationInvalid);
      build.onClick(() => void this.buildPreview(details, onStateChanged));
      return;
    }

    body.createDiv({
      cls: "practice-lab-payload-provider",
      text: `Provider: ${this.payloadPreview.providerLabel}`,
    });
    body.createDiv({
      cls: "practice-lab-payload-provider",
      text: `Model: ${this.payloadPreview.modelLabel}`,
    });
    body.createDiv({
      cls: "practice-lab-payload-provider",
      text: `Reasoning effort: ${this.payloadPreview.reasoningEffortLabel}`,
    });
    const difficulty = difficultyProfile(this.difficulty);
    body.createDiv({
      cls: "practice-lab-payload-provider",
      text: `Difficulty: ${displayDifficulty(this.difficulty)} — ${difficulty.tagline}`,
    });
    const pre = body.createEl("pre", {
      cls: "practice-lab-payload-text",
    });
    pre.createEl("code", { text: this.payloadPreview.text });
    if (this.payloadPreview.visualNames.length > 0) {
      body.createEl("h5", { text: "Visual files" });
      const list = body.createEl("ul");
      for (const name of this.payloadPreview.visualNames) {
        list.createEl("li", { text: name });
      }
    }
    if (this.payloadPreview.warning !== undefined) {
      body.createEl("p", {
        cls: "practice-lab-callout is-warning",
        text: this.payloadPreview.warning,
      });
    }
    const consent = body.createEl("label", {
      cls: "practice-lab-payload-consent",
    });
    const checkbox = consent.createEl("input", { attr: { type: "checkbox" } });
    checkbox.checked = this.payloadAccepted;
    consent.createSpan({
      text: "I reviewed this exact payload and approve sending it to the selected CLI provider.",
    });
    checkbox.addEventListener("change", () => {
      this.payloadAccepted = checkbox.checked;
      onStateChanged();
    });
    new ButtonComponent(body)
      .setIcon("refresh-cw")
      .setButtonText("Refresh preview")
      .onClick(() => void this.buildPreview(details, onStateChanged));
  }

  private renderJob(container: HTMLElement): void {
    const job = container.createDiv({
      cls: "practice-lab-job",
      attr: { role: "status", "aria-live": "polite" },
    });
    const spinner = job.createSpan({ cls: "practice-lab-spinner" });
    setIcon(spinner, "loader-circle");
    job.createSpan({ text: this.job.message ?? "Generating grounded exercises…" });
    const cancel = new ButtonComponent(job)
      .setButtonText(this.job.state === "cancelling" ? "Cancelling…" : "Cancel")
      .setDestructive();
    cancel.setDisabled(this.job.state === "cancelling");
    cancel.onClick(() => void this.cancelGeneration());
  }

  private publishGenerationActivity(event: CliActivityEvent): void {
    this.generationActivityEvents = appendActivityEvent(
      this.generationActivityEvents,
      event,
      MAX_GENERATION_ACTIVITY_EVENTS,
    );
    if (TERMINAL_ACTIVITY_PHASES.has(event.phase)) {
      this.generationActivityFinishedAt = Date.now();
    }
    this.agentActivityOpen = true;
    this.updateActivityClock();
    this.updateAgentActivityDom();
  }

  private updateAgentActivityDom(): void {
    const host = this.agentActivityHostEl;
    if (host === null) return;
    host.empty();
    this.agentActivitySummaryEl = null;
    this.activityElapsedEls = [];
    const reviewLogs = [...this.answerReviewActivityLogs.values()]
      .filter((log) => log.sessionId === this.studySessionId);
    const generationVisible = this.generationActivityEvents.length > 0
      || this.job.state === "running"
      || this.job.state === "cancelling";
    const visible = this.displayPreferences.practice.showAgentActivity
      && (generationVisible || reviewLogs.length > 0);
    host.hidden = !visible;
    if (!visible) return;

    const activeCount = (this.job.state === "running" || this.job.state === "cancelling" ? 1 : 0)
      + reviewLogs.filter((log) => log.finishedAt === undefined).length;
    const details = host.createEl("details", {
      cls: "practice-lab-agent-activity",
    });
    details.open = this.agentActivityOpen || activeCount > 0;
    details.addEventListener("toggle", () => {
      this.agentActivityOpen = details.open;
    });
    const summary = details.createEl("summary", {
      attr: {
        title: "Show or hide live provider progress. Raw output and private reasoning content are never displayed.",
      },
    });
    const summaryIcon = summary.createSpan({ cls: "practice-lab-agent-activity-icon" });
    setIcon(summaryIcon, activeCount > 0 ? "activity" : "check-circle-2");
    summary.createEl("strong", { text: "Agent activity" });
    this.agentActivitySummaryEl = summary.createSpan({
      cls: "practice-lab-agent-activity-summary",
      text: activeCount > 0
        ? `${activeCount} running · ${this.currentActivityElapsedText(reviewLogs)}`
        : "Latest run complete",
    });
    const body = details.createDiv({ cls: "practice-lab-agent-activity-body" });
    body.createEl("p", {
      cls: "practice-lab-agent-activity-disclosure",
      text: "Live provider events, elapsed time, and emitted reasoning status. Private chain-of-thought and raw provider output are not exposed; this activity log is capped and is not saved to your vault.",
    });
    if (generationVisible) {
      this.renderActivityLog(
        body,
        "Exercise generation",
        this.generationActivityStartedAt ?? Date.now(),
        this.generationActivityFinishedAt ?? undefined,
        this.generationActivityEvents,
      );
    }
    for (const log of reviewLogs.slice(-3).reverse()) {
      this.renderActivityLog(
        body,
        `Answer review · ${log.exerciseTitle}`,
        log.startedAt,
        log.finishedAt,
        log.events,
      );
    }
  }

  private renderActivityLog(
    container: HTMLElement,
    title: string,
    startedAt: number,
    finishedAt: number | undefined,
    events: readonly CliActivityEvent[],
  ): void {
    const section = container.createEl("section", {
      cls: "practice-lab-agent-activity-job",
    });
    const heading = section.createDiv({ cls: "practice-lab-agent-activity-job-heading" });
    heading.createEl("strong", { text: title });
    const elapsed = heading.createSpan({
      text: formatElapsed((finishedAt ?? Date.now()) - startedAt),
      attr: { title: "Elapsed provider time" },
    });
    this.activityElapsedEls.push({
      element: elapsed,
      startedAt,
      ...(finishedAt === undefined ? {} : { finishedAt }),
    });
    const list = section.createEl("ol", {
      cls: "practice-lab-agent-activity-log",
      attr: { "aria-live": "polite", "aria-relevant": "additions text" },
    });
    if (events.length === 0) {
      list.createEl("li", { text: "Preparing the provider process…" });
      return;
    }
    for (const event of events.slice(-VISIBLE_ACTIVITY_EVENTS_PER_JOB)) {
      const item = list.createEl("li", {
        cls: `is-${event.phase}`,
      });
      const eventTime = Date.parse(event.occurredAt);
      item.createEl("time", {
        text: Number.isFinite(eventTime)
          ? `+${formatElapsed(Math.max(0, eventTime - startedAt))}`
          : "now",
      });
      item.createSpan({ text: event.message });
    }
  }

  private currentActivityElapsedText(
    reviewLogs: readonly AnswerReviewActivityLog[],
  ): string {
    const starts: number[] = [];
    if (
      (this.job.state === "running" || this.job.state === "cancelling")
      && this.generationActivityStartedAt !== null
    ) {
      starts.push(this.generationActivityStartedAt);
    }
    starts.push(...reviewLogs
      .filter((log) => log.finishedAt === undefined)
      .map((log) => log.startedAt));
    return formatElapsed(Date.now() - Math.min(...starts, Date.now()));
  }

  private updateActivityClock(): void {
    const generationActive = this.job.state === "running" || this.job.state === "cancelling";
    const reviewActive = [...this.answerReviewActivityLogs.values()]
      .some((log) => log.finishedAt === undefined);
    if ((generationActive || reviewActive) && this.activityClock === undefined) {
      this.activityClock = window.setInterval(() => {
        this.refreshActivityElapsedDom();
      }, 1_000);
    } else if (!generationActive && !reviewActive) {
      this.clearActivityClock();
    }
  }

  private refreshActivityElapsedDom(): void {
    for (const elapsed of this.activityElapsedEls) {
      elapsed.element.setText(formatElapsed(
        (elapsed.finishedAt ?? Date.now()) - elapsed.startedAt,
      ));
    }
    const reviewLogs = [...this.answerReviewActivityLogs.values()]
      .filter((log) => log.sessionId === this.studySessionId);
    const activeCount = (this.job.state === "running" || this.job.state === "cancelling" ? 1 : 0)
      + reviewLogs.filter((log) => log.finishedAt === undefined).length;
    if (this.agentActivitySummaryEl !== null && activeCount > 0) {
      this.agentActivitySummaryEl.setText(
        `${activeCount} running · ${this.currentActivityElapsedText(reviewLogs)}`,
      );
    }
  }

  private clearActivityClock(): void {
    if (this.activityClock === undefined) return;
    window.clearInterval(this.activityClock);
    this.activityClock = undefined;
  }

  private renderReview(container: HTMLElement): void {
    const heading = container.createDiv({ cls: "practice-lab-section-heading" });
    heading.createEl("h3", { text: "Review the draft" });
    heading.createEl("p", {
      text: "Edit, reject, or reorder every item. Inspect occlusion masks individually, or accept all complete masks at once before saving.",
    });
    if (this.drafts.length === 0) {
      this.renderEmptyState(
        container,
        "No draft exercises",
        "Return to Configure and generate a draft set.",
        "list-restart",
      );
      return;
    }

    const reviewToolbar = container.createDiv({
      cls: "practice-lab-review-toolbar",
    });
    this.reviewSummaryEl = reviewToolbar.createDiv({
      cls: "practice-lab-review-summary",
    });
    if (
      this.drafts.some(
        (draft) => !draft.rejected && draft.type === "image-occlusion",
      )
    ) {
      const acceptAll = new ButtonComponent(reviewToolbar)
        .setIcon("check-check")
        .setButtonText("Accept all occlusions")
        .onClick(() => this.acceptAllOcclusions());
      this.reviewAcceptAllButton = acceptAll;
    }
    const list = container.createDiv({ cls: "practice-lab-draft-list" });
    for (const [index, draft] of this.drafts.entries()) {
      this.renderDraftCard(list, draft, index);
    }

    if (this.reviewSaveError !== null) {
      const error = container.createDiv({
        cls: "practice-lab-callout is-error",
        attr: { role: "alert", "aria-live": "assertive" },
      });
      setIcon(error.createSpan(), "circle-alert");
      error.createSpan({ text: this.reviewSaveError });
    }

    const warning = container.createDiv({
      cls: "practice-lab-callout is-warning",
      attr: { role: "status", "aria-live": "polite" },
    });
    setIcon(warning.createSpan(), "scan-line");
    warning.createSpan({ cls: "practice-lab-review-gate-message" });
    this.reviewGateNoticeEl = warning;

    const footer = container.createDiv({ cls: "practice-lab-stage-footer" });
    new ButtonComponent(footer)
      .setIcon("arrow-left")
      .setButtonText("Back to configure")
      .onClick(() => {
        this.stage = "configure";
        this.render();
      });
    const save = new ButtonComponent(footer)
      .setIcon("save")
      .setButtonText("Approve and save")
      .setCta();
    save.onClick(() => void this.saveDrafts());
    this.reviewSaveButton = save;
    const study = new ButtonComponent(footer)
      .setIcon("play")
      .setButtonText("Start practice");
    study.onClick(() => void this.startStudy());
    this.reviewStudyButton = study;
    this.refreshReviewActionState();
  }

  private renderDraftCard(
    container: HTMLElement,
    draft: EditableDraftExercise,
    index: number,
  ): void {
    const card = container.createDiv({
      cls: `practice-lab-draft-card${draft.rejected ? " is-rejected" : ""}`,
    });
    const header = card.createDiv({ cls: "practice-lab-draft-header" });
    header.createSpan({ cls: "practice-lab-draft-number", text: String(index + 1) });
    header.createSpan({ cls: "practice-lab-badge", text: EXERCISE_LABELS[draft.type] });
    const source = header.createSpan({
      cls: "practice-lab-segments",
      text: draft.sourceSegmentIds.join(", "),
    });
    source.setAttribute("aria-label", `Grounded in segments ${source.textContent ?? ""}`);
    source.hidden = !this.displayPreferences.practice.showDraftGrounding;
    const actions = header.createDiv({ cls: "practice-lab-card-actions" });
    this.iconButton(actions, "arrow-up", "Move exercise up", index === 0, () => {
      this.moveDraft(index, index - 1);
    });
    this.iconButton(
      actions,
      "arrow-down",
      "Move exercise down",
      index === this.drafts.length - 1,
      () => this.moveDraft(index, index + 1),
    );
    this.iconButton(
      actions,
      draft.rejected ? "rotate-ccw" : "trash-2",
      draft.rejected ? "Restore exercise" : "Reject exercise",
      false,
      () => {
        this.updateDraft(draft.id, { rejected: !draft.rejected });
        this.render();
      },
    );

    const promptLabel = card.createEl("label", { text: "Prompt" });
    const prompt = card.createEl("textarea", {
      cls: "practice-lab-draft-text",
      text: draft.prompt,
      attr: { rows: "3" },
    });
    promptLabel.htmlFor = `prompt-${draft.id}`;
    prompt.id = `prompt-${draft.id}`;
    prompt.disabled = draft.rejected;
    const promptError = card.createEl("p", {
      cls: "practice-lab-field-error",
      text: "Prompt is required for a kept exercise.",
      attr: { role: "alert" },
    });
    const refreshPromptValidity = (): void => {
      const blank = prompt.value.trim().length === 0;
      const latexProblem = latexMarkupProblem(prompt.value);
      const invalid = !draft.rejected && (blank || latexProblem !== null);
      promptError.setText(
        blank
          ? "Prompt is required for a kept exercise."
          : latexProblem === null
            ? ""
            : `Prompt LaTeX: ${latexProblem}`,
      );
      prompt.setAttribute("aria-invalid", String(invalid));
      promptError.hidden = !invalid;
    };
    prompt.addEventListener("input", () => {
      this.updateDraft(draft.id, { prompt: prompt.value });
      refreshPromptValidity();
    });
    refreshPromptValidity();

    const answerLabel = card.createEl("label", { text: "Grounded answer" });
    const answer = card.createEl("textarea", {
      cls: "practice-lab-draft-text",
      text: draft.groundedAnswer,
      attr: { rows: "3" },
    });
    answerLabel.htmlFor = `answer-${draft.id}`;
    answer.id = `answer-${draft.id}`;
    answer.disabled = draft.rejected;
    const answerError = card.createEl("p", {
      cls: "practice-lab-field-error",
      text: "Grounded answer is required for a kept exercise.",
      attr: { role: "alert" },
    });
    const refreshAnswerValidity = (): void => {
      const blank = answer.value.trim().length === 0;
      const latexProblem = latexMarkupProblem(answer.value);
      const invalid = !draft.rejected && (blank || latexProblem !== null);
      answerError.setText(
        blank
          ? "Grounded answer is required for a kept exercise."
          : latexProblem === null
            ? ""
            : `Grounded-answer LaTeX: ${latexProblem}`,
      );
      answer.setAttribute("aria-invalid", String(invalid));
      answerError.hidden = !invalid;
    };
    answer.addEventListener("input", () => {
      const value = answer.value;
      const grading =
        draft.grading.kind === "self"
          ? { ...draft.grading, groundedAnswer: value }
          : draft.grading;
      this.updateDraft(draft.id, { groundedAnswer: value, grading });
      refreshAnswerValidity();
    });
    refreshAnswerValidity();
    const renderedPreview = card.createEl("details", {
      cls: "practice-lab-draft-rendered-preview",
    });
    renderedPreview.open = hasLatexMarkup(prompt.value)
      || hasLatexMarkup(answer.value)
      || latexMarkupProblem(prompt.value) !== null
      || latexMarkupProblem(answer.value) !== null;
    renderedPreview.createEl("summary", { text: "Rendered math preview" });
    const previewGrid = renderedPreview.createDiv({
      cls: "practice-lab-draft-preview-grid",
    });
    const promptPreview = previewGrid.createDiv();
    promptPreview.createEl("strong", { text: "Prompt" });
    const promptPreviewContent = promptPreview.createDiv({
      cls: "practice-lab-draft-preview-content",
    });
    const answerPreview = previewGrid.createDiv();
    answerPreview.createEl("strong", { text: "Grounded answer" });
    const answerPreviewContent = answerPreview.createDiv({
      cls: "practice-lab-draft-preview-content",
    });
    const previewStatus = renderedPreview.createEl("p", {
      cls: "practice-lab-field-error",
      attr: { role: "status", "aria-live": "polite" },
    });
    const refreshRenderedPreview = (): void => {
      const promptValid = renderLatexMarkup(promptPreviewContent, prompt.value);
      const answerValid = renderLatexMarkup(answerPreviewContent, answer.value);
      previewStatus.hidden = promptValid && answerValid;
      previewStatus.setText(
        promptValid && answerValid
          ? ""
          : "Fix the highlighted LaTeX before saving this exercise.",
      );
      if (!promptValid || !answerValid || hasLatexMarkup(prompt.value) || hasLatexMarkup(answer.value)) {
        renderedPreview.open = true;
      }
    };
    prompt.addEventListener("input", refreshRenderedPreview);
    answer.addEventListener("input", refreshRenderedPreview);
    refreshRenderedPreview();
    if (
      this.displayPreferences.practice.showDraftRationale
      && draft.rationale !== undefined
    ) {
      const rationale = card.createDiv({
        cls: "practice-lab-rationale",
      });
      renderLatexMarkup(rationale, draft.rationale);
    }

    if (
      draft.type === "image-occlusion" &&
      draft.visualUrl !== undefined &&
      !draft.rejected
    ) {
      const editorContainer = card.createDiv({ cls: "practice-lab-draft-occlusion" });
      const editor = new OcclusionEditor(editorContainer, {
        imageUrl: draft.visualUrl,
        imageAlt: `Visual for exercise ${index + 1}`,
        masks: draft.masks ?? [],
        reviewed: draft.occlusionReviewed,
        onChange: (masks) => {
          this.updateDraft(draft.id, {
            masks,
            grading: occlusionGrading(masks),
            occlusionReviewed: false,
          });
        },
        onReviewed: (masks) => {
          this.updateDraft(draft.id, {
            masks,
            grading: occlusionGrading(masks),
            occlusionReviewed: true,
          });
          this.renderPreservingScroll();
        },
      });
      this.occlusionEditors.push(editor);
      this.addChild(editor);
    }
  }

  private renderStudy(container: HTMLElement): void {
    const exercise = this.studyExercises[this.studyIndex];
    if (exercise === undefined) {
      this.renderStudyComplete(container);
      return;
    }
    this.renderGuidedPathPosition(container);
    if (this.displayPreferences.practice.showStudyProgress) {
      const progress = container.createDiv({ cls: "practice-lab-study-progress" });
      const progressText = progress.createDiv({
        text: `Question ${this.studyIndex + 1} of ${this.studyExercises.length}`,
      });
      const meter = progress.createEl("progress", {
        attr: {
          max: String(this.studyExercises.length),
          value: String(this.studyIndex + 1),
          "aria-label": progressText.textContent ?? "Study progress",
        },
      });
      meter.value = this.studyIndex + 1;
    }
    this.renderPracticeRunHud(container, this.projectedPracticeRun());
    const activeLesson = this.studyLearningProgress?.activeLesson ?? null;
    if (
      activeLesson !== null
      && (
        activeLesson.state.phase === "teaching"
        || activeLesson.state.phase === "self-explanation"
        || (activeLesson.state.phase === "independent" && !this.studyTutorProblemStarted)
      )
    ) {
      this.renderTutorLesson(container, activeLesson, exercise);
      return;
    }
    if (activeLesson?.state.phase === "recovery") {
      this.renderTutorRecovery(container, activeLesson);
    }
    if (this.studyExercises.some((candidate) => candidate.grading.kind === "self")) {
      this.renderAnswerReviewControls(container);
    }

    const card = container.createDiv({ cls: "practice-lab-study-card" });
    card.createSpan({ cls: "practice-lab-badge", text: EXERCISE_LABELS[exercise.type] });
    const prompt = card.createEl("h3");
    renderLatexMarkup(prompt, studyPrompt(exercise));

    const answerArea = card.createDiv({ cls: "practice-lab-study-answer" });
    if (this.studySubmitted === null) {
      this.renderStudyInput(answerArea, exercise);
      this.renderStudySkipAction(answerArea, exercise);
    } else {
      this.renderStudyFeedback(answerArea, exercise);
    }
    this.prepareStudyCard(card, exercise.id);
  }

  private renderGuidedPathPosition(container: HTMLElement): void {
    const step = this.studyPathStep;
    if (step === null) return;
    const position = container.createEl("section", {
      cls: "practice-lab-path-position",
      attr: { "aria-label": "Guided path position" },
    });
    const heading = position.createDiv({ cls: "practice-lab-path-position-heading" });
    heading.createSpan({ cls: "practice-lab-badge", text: "Guided path" });
    heading.createEl("strong", {
      text: `Step ${step.stepIndex + 1} of ${step.stepCount}`,
    });
    position.createEl("h3", { text: step.stepTitle });
    const kind = step.kind === "tutor-lesson" ? "Tutor lesson" : "Practice set";
    position.createEl("p", {
      text: `${kind} · ${step.questionCount} ${step.questionCount === 1 ? "guided question" : "questions"} in this step · ${step.totalQuestionCount} total questions in the saved path.`,
    });
    const meter = position.createEl("progress", {
      attr: {
        max: String(step.stepCount),
        value: String(step.stepIndex + 1),
        "aria-label": `Guided path step ${step.stepIndex + 1} of ${step.stepCount}`,
      },
    });
    meter.value = step.stepIndex + 1;
  }

  private renderStudySkipAction(
    container: HTMLElement,
    exercise: EditableDraftExercise,
  ): void {
    if (!this.canSkipCurrentQuestion(exercise)) return;
    const isGuidedLesson = (
      this.studyLearningProgress?.activeLesson?.lesson.guidedExerciseId === exercise.id
    );
    const actions = container.createDiv({ cls: "practice-lab-study-question-actions" });
    new ButtonComponent(actions)
      .setIcon("skip-forward")
      .setButtonText("Skip question")
      .setTooltip(
        isGuidedLesson
          ? "Skip this tutor lesson and its guided problem. It will be excluded from scores and recorded as skipped for this session."
          : "Leave this question unanswered. It will be excluded from scores and recorded as skipped for this session.",
      )
      .onClick(() => void this.skipCurrentQuestion(exercise));
  }

  private canSkipCurrentQuestion(exercise: EditableDraftExercise): boolean {
    if (this.studySubmitted !== null) return false;
    const activeLesson = this.studyLearningProgress?.activeLesson ?? null;
    if (activeLesson === null) return true;
    return activeLesson.lesson.guidedExerciseId === exercise.id
      && activeLesson.state.originalIndependentAttempt === null
      && (
        activeLesson.state.phase === "teaching"
        || activeLesson.state.phase === "self-explanation"
        || activeLesson.state.phase === "independent"
      );
  }

  private renderTutorLesson(
    container: HTMLElement,
    active: StudyGuidedLessonCheckpointV1,
    exercise: EditableDraftExercise,
  ): void {
    const { lesson, state } = active;
    const tutor = container.createEl("section", {
      cls: "practice-lab-tutor-lesson",
      attr: { "aria-label": `Tutor lesson: ${lesson.title}` },
    });
    const heading = tutor.createDiv({ cls: "practice-lab-tutor-heading" });
    const icon = heading.createSpan({ attr: { "aria-hidden": "true" } });
    setIcon(icon, "graduation-cap");
    const identity = heading.createDiv();
    identity.createSpan({ cls: "practice-lab-badge", text: "Grounded tutor" });
    identity.createEl("h3", { text: lesson.title });
    const objective = identity.createDiv({ cls: "practice-lab-tutor-objective" });
    renderLatexMarkup(objective, lesson.objective);
    this.renderStudySkipAction(tutor, exercise);

    for (const block of lesson.teachingBlocks.filter((candidate) => (
      state.revealedTeachingBlockIds.includes(candidate.id)
    ))) {
      const card = tutor.createEl("article", { cls: "practice-lab-tutor-block" });
      card.createSpan({ cls: "practice-lab-badge", text: tutorBlockLabel(block.kind) });
      card.createEl("h4", { text: block.title });
      const content = card.createDiv();
      renderLatexMarkup(content, block.content);
    }

    if (state.phase === "teaching") {
      const next = lesson.teachingBlocks.find((block) => (
        !state.revealedTeachingBlockIds.includes(block.id)
      ));
      new ButtonComponent(tutor)
        .setIcon("arrow-right")
        .setButtonText(state.revealedTeachingBlockIds.length === 0
          ? "Begin lesson"
          : next === undefined ? "Continue" : `Continue to ${tutorBlockLabel(next.kind).toLowerCase()}`)
        .setCta()
        .onClick(() => void this.updateTutorLesson((current) => ({
          ...current,
          state: revealNextTeachingBlock(current.lesson, current.state),
        })));
      return;
    }

    const check = tutor.createEl("article", { cls: "practice-lab-tutor-check" });
    check.createEl("h4", { text: "Explain it in your own words" });
    const prompt = check.createDiv();
    renderLatexMarkup(prompt, lesson.selfExplanationCheck.prompt);
    if (state.selfExplanationAnswer === null) {
      const response = check.createEl("textarea", {
        attr: {
          rows: "5",
          placeholder: "Build the explanation from premise to consequence…",
          "aria-label": "Self-explanation response",
        },
      });
      response.value = active.currentInput;
      response.addEventListener("input", () => {
        this.setTutorCurrentInput(response.value);
      });
      new ButtonComponent(check)
        .setIcon("send")
        .setButtonText("Submit explanation")
        .setCta()
        .onClick(() => void this.updateTutorLesson((current) => ({
          ...current,
          currentInput: "",
          state: submitSelfExplanation(
            current.lesson,
            current.state,
            response.value,
          ),
        })));
      return;
    }

    check.createEl("strong", { text: "Your explanation" });
    const submitted = check.createEl("blockquote");
    renderLatexMarkup(submitted, state.selfExplanationAnswer);
    if (!state.selfExplanationAnswerRevealed) {
      new ButtonComponent(check)
        .setIcon("eye")
        .setButtonText("Reveal grounded comparison")
        .setCta()
        .onClick(() => void this.updateTutorLesson((current) => ({
          ...current,
          state: revealSelfExplanationAnswer(current.lesson, current.state),
        })));
      return;
    }

    check.createEl("strong", { text: "Grounded comparison" });
    const grounded = check.createDiv({ cls: "practice-lab-grounded-answer" });
    renderLatexMarkup(grounded, lesson.selfExplanationCheck.groundedAnswer);
    if (lesson.selfExplanationCheck.keyPoints.length > 0) {
      const points = check.createEl("ul");
      for (const point of lesson.selfExplanationCheck.keyPoints) {
        const item = points.createEl("li");
        renderLatexMarkup(item, point);
      }
    }
    new ButtonComponent(check)
      .setIcon("arrow-right")
      .setButtonText("Begin guided problem")
      .setCta()
      .onClick(() => {
        this.studyTutorProblemStarted = true;
        this.render();
      });
  }

  private renderTutorRecovery(
    container: HTMLElement,
    active: StudyGuidedLessonCheckpointV1,
  ): void {
    const { lesson, state } = active;
    const support = container.createEl("section", {
      cls: "practice-lab-tutor-recovery",
      attr: { "aria-label": "Guided recovery support" },
    });
    support.createEl("h3", { text: "Work through the difficulty" });
    support.createEl("p", {
      text: "Your first attempt is locked as the session result. Hints and retries are tracked separately and never inflate independent performance.",
    });
    for (const hint of [...lesson.hints]
      .sort((left, right) => left.level - right.level)
      .filter((candidate) => state.revealedHintIds.includes(candidate.id))) {
      const card = support.createDiv({ cls: "practice-lab-tutor-hint" });
      card.createEl("strong", { text: `Hint ${hint.level}` });
      const content = card.createDiv();
      renderLatexMarkup(content, hint.text);
    }
    if (state.repairExplanationRevealed) {
      const repair = support.createDiv({ cls: "practice-lab-tutor-repair" });
      repair.createEl("strong", { text: "Repair explanation" });
      const content = repair.createDiv();
      renderLatexMarkup(content, lesson.repairExplanation.text);
    }
    const actions = support.createDiv({ cls: "practice-lab-tutor-actions" });
    if (state.revealedHintIds.length < lesson.hints.length) {
      new ButtonComponent(actions)
        .setIcon("life-buoy")
        .setButtonText("Need help")
        .onClick(() => void this.updateTutorLesson((current) => ({
          ...current,
          state: revealNextTutorHint(current.lesson, current.state),
        })));
    } else if (!state.repairExplanationRevealed) {
      new ButtonComponent(actions)
        .setIcon("book-open-check")
        .setButtonText("Show repair explanation")
        .onClick(() => void this.updateTutorLesson((current) => ({
          ...current,
          state: revealTutorRepairExplanation(current.lesson, current.state),
        })));
    }
    new ButtonComponent(actions)
      .setIcon("arrow-right")
      .setButtonText("Continue without resolving")
      .onClick(() => void this.completeUnresolvedTutorLesson());
  }

  private setTutorCurrentInput(value: string): void {
    const progress = this.studyLearningProgress;
    if (progress?.activeLesson === null || progress === null) return;
    this.studyLearningProgress = {
      ...progress,
      activeLesson: { ...progress.activeLesson, currentInput: value },
    };
    this.scheduleStudyCheckpoint();
  }

  private async updateTutorLesson(
    transition: (
      active: StudyGuidedLessonCheckpointV1,
    ) => StudyGuidedLessonCheckpointV1,
  ): Promise<void> {
    const progress = this.studyLearningProgress;
    if (progress?.activeLesson === null || progress === null) return;
    const previous = progress;
    try {
      this.studyLearningProgress = {
        ...progress,
        activeLesson: transition(progress.activeLesson),
      };
      await this.flushStudyCheckpoint();
      this.studyCheckpointWarningShown = false;
      this.render();
    } catch (error) {
      this.studyLearningProgress = previous;
      new Notice(this.errorMessage(error, "Could not save the tutor checkpoint."), 10_000);
    }
  }

  private renderStudyInput(
    container: HTMLElement,
    exercise: EditableDraftExercise,
  ): void {
    switch (exercise.grading.kind) {
      case "single-select":
      case "multi-select": {
        const multiple = exercise.grading.kind === "multi-select";
        const fieldset = container.createEl("fieldset", { cls: "practice-lab-choice-list" });
        fieldset.createEl("legend", {
          text: multiple ? "Select every correct answer" : "Select one answer",
        });
        for (const choice of exercise.choices ?? []) {
          const label = fieldset.createEl("label", { cls: "practice-lab-choice" });
          const input = label.createEl("input", {
            attr: {
              type: multiple ? "checkbox" : "radio",
              name: `choice-${exercise.id}`,
              value: choice.id,
            },
          });
          input.dataset.choiceId = choice.id;
          input.checked = this.studyCurrentInput?.selectedIds.includes(choice.id) ?? false;
          input.addEventListener("change", () => {
            const selected = new Set(this.studyCurrentInput?.selectedIds ?? []);
            if (!multiple && input.checked) selected.clear();
            if (input.checked) selected.add(choice.id);
            else selected.delete(choice.id);
            this.updateStudyCurrentInput({ selectedIds: [...selected] });
          });
          const choiceText = label.createDiv({
            cls: "practice-lab-choice-text",
          });
          renderLatexMarkup(choiceText, choice.text);
        }
        this.studySubmitButton(container, () => this.gradeChoice(container, exercise));
        break;
      }
      case "matching": {
        const right = exercise.matchingRight ?? [];
        const matching = container.createDiv({ cls: "practice-lab-matching" });
        const answerKey = matching.createDiv({
          cls: "practice-lab-matching-key",
          attr: { "aria-label": "Available matching answers" },
        });
        answerKey.id = `matching-key-${exercise.id}`;
        answerKey.createEl("strong", { text: "Available answers" });
        const answerKeyList = answerKey.createEl("ol");
        for (const choice of right) {
          const item = answerKeyList.createEl("li");
          const value = item.createDiv();
          renderLatexMarkup(value, choice.text);
        }
        for (const left of exercise.matchingLeft ?? []) {
          const row = matching.createDiv({ cls: "practice-lab-matching-row" });
          const leftText = row.createDiv({
            cls: "practice-lab-matching-left",
          });
          renderLatexMarkup(leftText, left.text);
          const select = row.createEl("select", {
            attr: {
              "aria-label": `Match for ${left.text}`,
              "aria-describedby": answerKey.id,
              "data-left-id": left.id,
            },
          });
          select.createEl("option", { value: "", text: "Choose…" });
          for (const [index, choice] of right.entries()) {
            select.createEl("option", {
              value: choice.id,
              text: `Answer ${index + 1}`,
            });
          }
          select.value = this.studyCurrentInput?.fields[`match:${left.id}`] ?? "";
          select.addEventListener("change", () => {
            this.updateStudyInputField(`match:${left.id}`, select.value);
          });
        }
        this.studySubmitButton(container, () => this.gradeMatching(container, exercise));
        break;
      }
      case "ordering": {
        const byId = new Map((exercise.orderingItems ?? []).map((item) => [item.id, item.text]));
        const ordering = container.createDiv({ cls: "practice-lab-ordering" });
        for (const [index, id] of this.orderingState.entries()) {
          const row = ordering.createDiv({ cls: "practice-lab-order-row" });
          const itemText = row.createDiv({
            cls: "practice-lab-order-text",
          });
          renderLatexMarkup(itemText, byId.get(id) ?? id);
          this.iconButton(row, "arrow-up", "Move item up", index === 0, () => {
            this.moveOrderingItem(index, index - 1);
          });
          this.iconButton(
            row,
            "arrow-down",
            "Move item down",
            index === this.orderingState.length - 1,
            () => this.moveOrderingItem(index, index + 1),
          );
        }
        this.studySubmitButton(container, () => this.gradeOrdering(exercise));
        break;
      }
      case "occlusion": {
        this.renderStudyOcclusionVisual(container, exercise, false);
        const fields = container.createDiv({ cls: "practice-lab-occlusion-answers" });
        for (const mask of exercise.masks ?? []) {
          const label = fields.createEl("label");
          const labelText = label.createDiv({
            cls: "practice-lab-occlusion-label",
          });
          renderLatexMarkup(labelText, mask.label);
          const input = label.createEl("input", {
            attr: { type: "text", "data-mask-id": mask.id },
          });
          input.autocomplete = "off";
          input.value = this.studyCurrentInput?.fields[`mask:${mask.id}`] ?? "";
          input.addEventListener("input", () => {
            this.updateStudyInputField(`mask:${mask.id}`, input.value);
          });
        }
        this.studySubmitButton(container, () => this.gradeOcclusion(container, exercise));
        break;
      }
      case "calculation": {
        const grading = exercise.grading;
        const row = container.createDiv({ cls: "practice-lab-calculation-answer" });
        const label = row.createEl("label", { text: "Numerical answer" });
        const input = label.createEl("input", {
          attr: {
            type: "text",
            inputmode: "decimal",
            autocomplete: "off",
            "aria-label": "Numerical answer",
          },
        });
        input.value = this.studyCurrentInput?.fields.calculation ?? "";
        input.addEventListener("input", () => {
          this.updateStudyInputField("calculation", input.value);
        });
        if (grading.unit !== undefined) {
          const unit = row.createSpan({ cls: "practice-lab-unit" });
          renderLatexMarkup(unit, grading.unit);
        }
        this.studySubmitButton(container, () => {
          const value = Number(input.value.trim().replace(",", "."));
          if (!Number.isFinite(value)) {
            new Notice("Enter a valid numerical answer first.");
            return;
          }
          const correct =
            Math.abs(value - grading.numericAnswer) <=
            Math.abs(grading.tolerance);
          this.setStudySubmitted({ answer: input.value.trim(), correct });
        });
        break;
      }
      case "cloze": {
        const fields = container.createDiv({ cls: "practice-lab-cloze-answers" });
        for (const [index, blank] of exercise.grading.blanks.entries()) {
          const label = fields.createEl("label", {
            text: `Blank ${index + 1}`,
          });
          const input = label.createEl("input", {
            attr: {
              type: "text",
              autocomplete: "off",
              "data-blank-id": blank.id,
            },
          });
          input.setAttribute("aria-label", `Answer for blank ${index + 1}`);
          input.value = this.studyCurrentInput?.fields[`blank:${blank.id}`] ?? "";
          input.addEventListener("input", () => {
            this.updateStudyInputField(`blank:${blank.id}`, input.value);
          });
        }
        this.studySubmitButton(container, () => this.gradeCloze(container, exercise));
        break;
      }
      case "self":
      case "text": {
        const grading = exercise.grading;
        const textarea = container.createEl("textarea", {
          cls: "practice-lab-free-response",
          attr: {
            rows: "6",
            placeholder: "Write your answer before revealing the grounded answer…",
            "aria-label": "Your answer",
          },
        });
        textarea.value = this.studyCurrentInput?.fields.response ?? "";
        textarea.addEventListener("input", () => {
          this.updateStudyInputField("response", textarea.value);
        });
        const buttonText = grading.kind === "self" ? "Reveal grounded answer" : "Check answer";
        const reveal = new ButtonComponent(container)
          .setButtonText(buttonText)
          .setCta()
          .onClick(() => {
            const answer = textarea.value;
            if (grading.kind === "self") {
              this.setStudySubmitted({ answer });
            } else {
              const actual = normalizeAnswer(answer, grading.caseSensitive ?? false);
              const correct = grading.acceptedAnswers.some(
                (accepted) =>
                  normalizeAnswer(accepted, grading.caseSensitive ?? false) === actual,
              );
              this.setStudySubmitted({ answer, correct });
            }
          });
        this.markPrimaryStudyAction(reveal);
        break;
      }
    }
  }

  private renderStudyFeedback(
    container: HTMLElement,
    exercise: EditableDraftExercise,
  ): void {
    const submitted = this.studySubmitted;
    if (submitted === null) return;
    if (submitted.correct !== undefined) {
      const result = container.createDiv({
        cls: `practice-lab-result ${submitted.correct ? "is-correct" : "is-incorrect"}`,
        attr: { role: "status" },
      });
      setIcon(result.createSpan(), submitted.correct ? "circle-check" : "circle-x");
      result.createSpan({ text: submitted.correct ? "Correct" : "Not quite" });
      if (submitted.correct) {
        const run = this.projectedPracticeRun();
        result.createSpan({
          cls: "practice-lab-run-reward",
          text: run.currentStreak > 1
            ? `+1 run point · ${run.currentStreak} answer streak`
            : "+1 run point",
        });
      }
    } else {
      container.createEl("h4", { text: "Compare your response" });
      if (submitted.answer.trim().length > 0) {
        const submittedAnswer = container.createEl("blockquote");
        renderLatexMarkup(submittedAnswer, submitted.answer);
      }
    }
    if (exercise.grading.kind === "occlusion") {
      this.renderStudyOcclusionVisual(container, exercise, true);
    }
    const answer = container.createDiv({ cls: "practice-lab-grounded-answer" });
    answer.createEl("h4", { text: "Grounded answer" });
    const groundedAnswer = answer.createDiv();
    renderLatexMarkup(groundedAnswer, exercise.groundedAnswer);
    if (
      this.displayPreferences.practice.showStudyRationale
      && exercise.rationale !== undefined
    ) {
      const rationale = answer.createDiv({ cls: "practice-lab-rationale" });
      renderLatexMarkup(rationale, exercise.rationale);
    }

    if (exercise.grading.kind === "self") {
      this.studyFeedbackActionsEl = container.createDiv({
        cls: "practice-lab-free-response-actions",
      });
      this.renderCurrentFreeResponseActions();
    } else {
      const next = new ButtonComponent(container)
        .setIcon("arrow-right")
        .setButtonText(this.studyIndex === this.studyExercises.length - 1 ? "View results" : "Next question")
        .setCta()
        .onClick(() =>
          void this.recordAndContinue({
            exerciseId: exercise.id,
            correct: submitted.correct ?? false,
          }),
        );
      this.markPrimaryStudyAction(next);
    }
  }

  private renderAnswerReviewControls(container: HTMLElement): void {
    this.answerReviewControlsEl = container.createEl("section", {
      cls: "practice-lab-answer-review-controls",
      attr: { "aria-label": "Free-response review" },
    });
    this.refreshAnswerReviewControls();
  }

  private refreshAnswerReviewControls(): void {
    const controls = this.answerReviewControlsEl;
    if (controls === null) return;
    controls.empty();
    const heading = controls.createDiv({ cls: "practice-lab-answer-review-heading" });
    heading.createEl("strong", { text: "Free-response review" });
    heading.createSpan({
      text: "Choose how open answers are assessed in this session.",
    });

    const choices = controls.createDiv({
      cls: "practice-lab-answer-review-mode",
      attr: { role: "radiogroup", "aria-label": "Free-response review method" },
    });
    this.renderAnswerReviewModeChoice(choices, "self", "Self-assess", false);
    const hasExecutor = this.options.callbacks.enqueueAnswerReview !== undefined;
    this.renderAnswerReviewModeChoice(
      choices,
      "ai",
      "AI review (background)",
      !hasExecutor,
    );

    if (this.answerReviewMode === "ai" && hasExecutor) {
      const configuration = controls.createDiv({
        cls: "practice-lab-answer-review-configuration",
      });
      const providerLabel = configuration.createEl("label", { text: "Provider" });
      const providerSelect = providerLabel.createEl("select", {
        attr: { "aria-label": "Answer-review provider" },
      });
      for (const provider of this.providers) {
        const executionMode = provider.executionMode
          ?? (provider.available ? "execute-now" : "unavailable");
        const option = providerSelect.createEl("option", {
          value: provider.id,
          text: executionMode === "execute-now"
            ? provider.label
            : executionMode === "queue-for-desktop"
              ? `${provider.label} (queue for desktop)`
              : `${provider.label} (unavailable)`,
        });
        option.disabled = executionMode === "unavailable";
      }
      providerSelect.value = this.answerReviewProvider;
      providerSelect.addEventListener("change", () => {
        this.answerReviewProvider = providerSelect.value as ProviderId;
        this.scheduleStudyCheckpoint();
        this.refreshAnswerReviewControls();
        this.renderCurrentFreeResponseActions();
      });

      const reasoningLabel = configuration.createEl("label", { text: "Reasoning" });
      const reasoningSelect = reasoningLabel.createEl("select", {
        attr: {
          "aria-label": "Answer-review reasoning effort",
          title: reasoningEffortDescription(this.answerReviewProvider),
        },
      });
      const selectedProvider = this.selectedAnswerReviewProvider();
      const efforts = selectedProvider?.reasoningEfforts ?? [];
      if (!efforts.includes(this.answerReviewReasoningEffort)) {
        const unsupported = reasoningSelect.createEl("option", {
          value: this.answerReviewReasoningEffort,
          text: `${displayReasoningEffort(this.answerReviewReasoningEffort)} (unavailable)`,
        });
        unsupported.disabled = true;
      }
      for (const effort of efforts) {
        reasoningSelect.createEl("option", {
          value: effort,
          text: displayReasoningEffort(effort),
        });
      }
      reasoningSelect.value = this.answerReviewReasoningEffort;
      reasoningSelect.addEventListener("change", () => {
        this.answerReviewReasoningEffort = reasoningSelect.value as ReasoningEffort;
        this.scheduleStudyCheckpoint();
        this.refreshAnswerReviewControls();
        this.renderCurrentFreeResponseActions();
      });

      const readiness = this.answerReviewProviderProblem();
      const queuesForDesktop = selectedProvider?.executionMode === "queue-for-desktop";
      controls.createEl("p", {
        cls: `practice-lab-answer-review-note${readiness === null ? "" : " is-warning"}`,
        text: readiness ??
          (queuesForDesktop
            ? `${ANSWER_REVIEW_PAYLOAD_DISCLOSURE} will be locked locally and queued in the Practice Markdown when this session finishes. A desktop with ${selectedProvider?.label ?? this.answerReviewProvider} available will run the exact provider and reasoning after synchronization. You can continue immediately.`
            : `${ANSWER_REVIEW_PAYLOAD_DISCLOSURE} will be sent to ${selectedProvider?.label ?? this.answerReviewProvider}. When you finish this session, the submitted answer and locked review context are also stored in the Practice Markdown so the review can resume after a restart and remain visible in history. Reviews never pause the next question.`),
      });
    } else if (!hasExecutor) {
      controls.createEl("p", {
        cls: "practice-lab-answer-review-note is-warning",
        text: "AI answer review is unavailable on this device. Self-assessment remains available.",
      });
    }

    this.answerReviewStatusEl = controls.createDiv({
      cls: "practice-lab-answer-review-status",
      attr: { role: "status", "aria-live": "polite" },
    });
    this.answerReviewActionsEl = controls.createDiv({
      cls: "practice-lab-answer-review-queue-actions",
    });
    this.updateAnswerReviewStatusDom();
  }

  private renderAnswerReviewModeChoice(
    container: HTMLElement,
    mode: AnswerReviewMode,
    labelText: string,
    disabled: boolean,
  ): void {
    const label = container.createEl("label", {
      cls: `practice-lab-answer-review-choice${this.answerReviewMode === mode ? " is-selected" : ""}`,
    });
    const input = label.createEl("input", {
      attr: {
        type: "radio",
        name: `answer-review-${this.studySessionId}`,
        value: mode,
      },
    });
    input.checked = this.answerReviewMode === mode;
    input.disabled = disabled;
    label.createSpan({ text: labelText });
    input.addEventListener("change", () => {
      if (!input.checked || input.disabled) return;
      this.answerReviewMode = mode;
      this.scheduleStudyCheckpoint();
      this.refreshAnswerReviewControls();
      this.renderCurrentFreeResponseActions();
    });
  }

  private renderCurrentFreeResponseActions(): void {
    const actions = this.studyFeedbackActionsEl;
    const exercise = this.studyExercises[this.studyIndex];
    const submitted = this.studySubmitted;
    if (
      actions === null ||
      exercise?.grading.kind !== "self" ||
      submitted === null
    ) {
      return;
    }
    actions.empty();
    if (this.answerReviewMode === "ai") {
      this.renderAiReviewActions(actions, exercise, submitted.answer);
    } else {
      this.renderSelfAssessmentActions(actions, exercise, submitted.answer);
    }
  }

  private renderSelfAssessmentActions(
    container: HTMLElement,
    exercise: EditableDraftExercise,
    submittedAnswer: string,
  ): void {
    container.createEl("p", {
      cls: "practice-lab-rating-prompt",
      text: "How accurate was your submitted answer compared with the grounded answer? This records the outcome for this session only.",
    });
    const ratings = container.createDiv({ cls: "practice-lab-rating-row" });
    for (const outcome of FREE_RESPONSE_OUTCOMES) {
      const points = calculatePracticeRun([{ rating: outcome.rating }])
        .earnedPoints;
      new ButtonComponent(ratings)
        .setButtonText(`${outcome.label} · +${formatPracticeRunPoints(points)}`)
        .setTooltip(
          `${outcome.description} Adds ${formatPracticeRunPoints(points)} run ${points === 1 ? "point" : "points"}.`,
        )
        .onClick(() => void this.recordAndContinue({
          exerciseId: exercise.id,
          submittedAnswer,
          rating: outcome.rating,
        }));
    }
  }

  private renderAiReviewActions(
    container: HTMLElement,
    exercise: EditableDraftExercise,
    submittedAnswer: string,
  ): void {
    const provider = this.selectedAnswerReviewProvider();
    const queuesForDesktop = provider?.executionMode === "queue-for-desktop";
    const problem = this.answerReviewActionProblem(exercise, submittedAnswer);
    container.createEl("p", {
      cls: `practice-lab-rating-prompt${problem === null ? "" : " is-warning"}`,
      text: problem ??
        (queuesForDesktop
          ? `The exact ${provider?.label ?? this.answerReviewProvider} request will queue for desktop. You can continue immediately, even while offline.`
          : `${provider?.label ?? this.answerReviewProvider} will assess this response in the background. You can continue immediately.`),
    });
    const buttons = container.createDiv({ cls: "practice-lab-rating-row" });
    const queue = new ButtonComponent(buttons)
      .setIcon("send")
      .setButtonText(queuesForDesktop
        ? `Queue for desktop ${provider?.label ?? this.answerReviewProvider} review`
        : `Send to ${provider?.label ?? this.answerReviewProvider} and continue`)
      .setCta()
      .setDisabled(problem !== null);
    this.markPrimaryStudyAction(queue);
    queue.onClick(() => {
      if (this.answerReviewActionProblem(exercise, submittedAnswer) !== null) {
        return;
      }
      void this.queueAnswerReviewAndContinue(exercise, submittedAnswer);
    });
    new ButtonComponent(buttons)
      .setButtonText("Assess myself instead")
      .onClick(() => {
        container.empty();
        this.renderSelfAssessmentActions(container, exercise, submittedAnswer);
      });
  }

  private async queueAnswerReviewAndContinue(
    exercise: EditableDraftExercise,
    submittedAnswer: string,
  ): Promise<void> {
    const context = exercise.answerReviewContext;
    const request = lockAnswerReviewRequest({
      requestId: `review-${crypto.randomUUID()}`,
      sessionId: this.studySessionId,
      exerciseId: exercise.id,
      exerciseTitle: exercise.title ?? exercise.prompt,
      exerciseType: exercise.type,
      prompt: exercise.prompt,
      submittedAnswer,
      groundedAnswer: exercise.groundedAnswer,
      keyPoints: context?.keyPoints ?? [],
      sourceSegmentIds: [...exercise.sourceSegmentIds],
      sourceSegments: context?.sourceSegments ?? [],
      provider: this.answerReviewProvider,
      reasoningEffort: this.answerReviewReasoningEffort,
      requestedAt: new Date().toISOString(),
    });
    try {
      await this.options.callbacks.enqueueAnswerReview?.(request);
    } catch (error) {
      new Notice(this.errorMessage(error, "Could not queue this AI review."));
      return;
    }
    await this.recordAndContinue(createPendingAnswerReviewRecord(request));
  }

  private selectedAnswerReviewProvider(): ProviderPresentation | undefined {
    return this.providers.find(
      (provider) => provider.id === this.answerReviewProvider,
    );
  }

  private answerReviewProviderProblem(): string | null {
    if (this.options.callbacks.enqueueAnswerReview === undefined) {
      return "AI answer review is unavailable on this device.";
    }
    const provider = this.selectedAnswerReviewProvider();
    const executionMode = provider?.executionMode
      ?? (provider?.available === true ? "execute-now" : "unavailable");
    if (provider === undefined || executionMode === "unavailable") {
      return `${provider?.label ?? this.answerReviewProvider} is unavailable. Choose an available provider or self-assess; Practice Problem Generator will not switch providers automatically.`;
    }
    if (!provider.reasoningEfforts.includes(this.answerReviewReasoningEffort)) {
      return `${displayReasoningEffort(this.answerReviewReasoningEffort)} reasoning is unavailable for ${provider.label}. Choose a supported level; Practice Problem Generator will not substitute one.`;
    }
    return null;
  }

  private answerReviewActionProblem(
    exercise: EditableDraftExercise,
    submittedAnswer: string,
  ): string | null {
    if (submittedAnswer.trim().length === 0) {
      return "Write an answer first, or assess the blank response yourself.";
    }
    const providerProblem = this.answerReviewProviderProblem();
    if (providerProblem !== null) return providerProblem;
    const keyPoints = exercise.answerReviewContext?.keyPoints ?? [];
    if (
      keyPoints.length === 0 ||
      keyPoints.every((point) => point.trim().length === 0)
    ) {
      return "This answer has no grounded review criteria. Self-assess instead.";
    }
    const contextIds = new Set(
      exercise.answerReviewContext?.sourceSegments.map((segment) => segment.id) ?? [],
    );
    if (
      exercise.sourceSegmentIds.length === 0 ||
      exercise.sourceSegmentIds.some((id) => !contextIds.has(id))
    ) {
      return "The locked cited source context is unavailable for this answer. Self-assess instead.";
    }
    const validation = validateAnswerReviewInput(createAnswerReviewInput({
      requestId: "answer-review-preflight",
      exerciseTitle: exercise.title ?? exercise.prompt,
      exerciseType: exercise.type,
      prompt: exercise.prompt,
      submittedAnswer,
      groundedAnswer: exercise.groundedAnswer,
      keyPoints,
      sourceSegmentIds: [...exercise.sourceSegmentIds],
      sourceSegments: exercise.answerReviewContext?.sourceSegments ?? [],
    }));
    if (!validation.valid) {
      return `This answer exceeds the safe AI-review payload limits. ${validation.errors?.[0] ?? "Self-assess instead."}`;
    }
    return null;
  }

  private renderLiveAnswerReviewActions(): void {
    const container = this.answerReviewActionsEl;
    if (container === null) return;
    container.empty();
    const unresolved = this.studyAnswers.filter((answer) => {
      const state = answer.aiReview?.status.state;
      return state === "pending" || state === "failed";
    });
    container.toggleClass("is-empty", unresolved.length === 0);
    for (const answer of unresolved) {
      const review = answer.aiReview;
      if (review === undefined) continue;
      const item = container.createDiv({
        cls: `practice-lab-answer-review-queue-item is-${review.status.state}`,
      });
      const heading = item.createDiv({
        cls: "practice-lab-ai-review-feedback-heading",
      });
      const exerciseTitle = heading.createEl("strong");
      renderLatexMarkup(exerciseTitle, review.request.exerciseTitle);
      heading.createSpan({
        text: review.status.state === "pending" ? "Pending" : "Failed",
      });
      this.renderAnswerReviewManagement(item, answer);
    }
  }

  private renderAnswerReviewManagement(
    container: HTMLElement,
    answer: StudyAnswerRecord,
  ): void {
    const review = answer.aiReview;
    if (review === undefined || review.status.state === "reviewed") return;
    const providerLabel = this.answerReviewProviderLabel(review.request.provider);
    const reasoningLabel = displayReasoningEffort(
      review.request.reasoningEffort,
    );
    const actions = container.createDiv({
      cls: "practice-lab-ai-review-actions",
    });
    if (review.status.state === "pending") {
      if (this.pausedAnswerReviewIds.has(review.request.requestId)) {
        actions.createSpan({
          cls: "practice-lab-answer-review-note",
          text: "Paused locally. It remains pending and can resume on the next desktop start.",
        });
        return;
      }
      const pause = this.options.callbacks.pauseAnswerReview;
      if (pause === undefined) {
        actions.createSpan({
          cls: "practice-lab-answer-review-note",
          text: "This pending review can be paused from Practice Problem Generator on desktop.",
        });
        return;
      }
      new ButtonComponent(actions)
        .setIcon("pause")
        .setButtonText("Pause review")
        .setTooltip(`Pause exact request ${review.request.requestId}; it remains resumable.`)
        .onClick(() => this.pauseAnswerReview(answer));
      actions.createSpan({
        cls: "practice-lab-answer-review-note",
        text: `${providerLabel} · ${reasoningLabel} reasoning`,
      });
      return;
    }

    const problem = this.answerReviewRetryProblem(review.request);
    new ButtonComponent(actions)
      .setIcon("refresh-cw")
      .setButtonText(`Retry with ${providerLabel}`)
      .setDisabled(problem !== null)
      .setTooltip(
        problem ??
          `Reuse the original locked request with ${reasoningLabel} reasoning.`,
      )
      .onClick(() => {
        if (this.answerReviewRetryProblem(review.request) !== null) return;
        this.retryAnswerReview(answer);
      });
    actions.createSpan({
      cls: `practice-lab-answer-review-note${problem === null ? "" : " is-warning"}`,
      text: problem ??
        `Uses the original ${providerLabel} provider, ${reasoningLabel} reasoning, answer, and locked context.`,
    });
  }

  private answerReviewProviderLabel(providerId: ProviderId): string {
    return this.providers.find((provider) => provider.id === providerId)?.label
      ?? (providerId === "agy"
        ? "agy"
        : providerId === "claude"
          ? "Claude"
          : "Codex");
  }

  private answerReviewRetryProblem(request: AnswerReviewRequest): string | null {
    if (this.options.callbacks.retryAnswerReview === undefined) {
      return "Retry is unavailable on this device. Open Practice Problem Generator on desktop.";
    }
    const provider = this.providers.find(
      (candidate) => candidate.id === request.provider,
    );
    if (provider === undefined || !provider.available) {
      return `${this.answerReviewProviderLabel(request.provider)} is unavailable. Restore that provider before retrying; Practice Problem Generator will not switch providers.`;
    }
    if (!provider.reasoningEfforts.includes(request.reasoningEffort)) {
      return `${displayReasoningEffort(request.reasoningEffort)} reasoning is no longer available for ${provider.label}. Restore that capability before retrying; Practice Problem Generator will not substitute one.`;
    }
    return null;
  }

  private pauseAnswerReview(answer: StudyAnswerRecord): void {
    const review = answer.aiReview;
    const pause = this.options.callbacks.pauseAnswerReview;
    if (review?.status.state !== "pending" || pause === undefined) return;
    try {
      pause(review.request.requestId);
      this.pausedAnswerReviewIds.add(review.request.requestId);
      this.updateAnswerReviewStatusDom();
      this.updateStudyCompletionDom();
    } catch (error) {
      new Notice(this.errorMessage(error, "Could not pause this AI review."));
    }
  }

  private retryAnswerReview(answer: StudyAnswerRecord): void {
    const review = answer.aiReview;
    const retry = this.options.callbacks.retryAnswerReview;
    if (
      review?.status.state !== "failed" ||
      retry === undefined ||
      this.answerReviewRetryProblem(review.request) !== null
    ) {
      return;
    }
    const previousStatus = review.status;
    try {
      const operation = retry(review.request);
      void Promise.resolve(operation).then(() => {
        this.pausedAnswerReviewIds.delete(review.request.requestId);
        const current = this.studyAnswers.find(
          (candidate) =>
            candidate.aiReview?.request.requestId === review.request.requestId,
        );
        if (current?.aiReview?.status.state === "failed") {
          this.applyAnswerReviewStatus({
            requestId: review.request.requestId,
            sessionId: review.request.sessionId,
            exerciseId: review.request.exerciseId,
            state: "pending",
            queuedAt: new Date().toISOString(),
            attempts: previousStatus.attempts,
          });
        }
        this.updateAnswerReviewStatusDom();
        this.updatePracticeRunDom();
        this.updateStudyCompletionDom();
      }).catch((error: unknown) => {
        new Notice(this.errorMessage(error, "Could not retry this AI review."));
      });
    } catch (error) {
      new Notice(this.errorMessage(error, "Could not retry this AI review."));
    }
  }

  private renderStudyOcclusionVisual(
    container: HTMLElement,
    exercise: EditableDraftExercise,
    answered: boolean,
  ): void {
    const presentation = presentStudyOcclusionVisual(exercise, answered);
    if (presentation === null) return;
    const figure = container.createEl("figure", {
      cls: `practice-lab-study-figure${presentation.revealed ? " is-revealed" : ""}`,
    });
    const visual = figure.createDiv({ cls: "practice-lab-study-occlusion" });
    visual.createEl("img", {
      attr: {
        src: presentation.imageUrl,
        alt: presentation.revealed
          ? "Original image with occlusions revealed"
          : "Occlusion practice visual",
      },
    });
    for (const mask of presentation.masks) {
      const overlay = visual.createDiv({ cls: "practice-lab-study-mask" });
      overlay.style.left = `${mask.x * 100}%`;
      overlay.style.top = `${mask.y * 100}%`;
      overlay.style.width = `${mask.width * 100}%`;
      overlay.style.height = `${mask.height * 100}%`;
      overlay.setAttribute("aria-label", `Hidden region: ${mask.label}`);
    }
    figure.createEl("figcaption", {
      text: presentation.revealed
        ? "Original image revealed"
        : "Answer every hidden region before revealing the image.",
    });
  }

  private projectedPracticeRun(): PracticeRunScore {
    const pendingCorrect = this.studySubmitted?.correct;
    return calculatePracticeRun(
      this.studyAnswers,
      pendingCorrect === undefined ? undefined : { correct: pendingCorrect },
    );
  }

  private renderPracticeRunHud(
    container: HTMLElement,
    run: PracticeRunScore,
  ): void {
    const preferences = this.displayPreferences.practice;
    if (!preferences.showRunPoints && !preferences.showRunStreak && !preferences.showRunRank) {
      return;
    }
    const hud = container.createEl("section", {
      cls: "practice-lab-run-hud",
      attr: { "aria-label": "Practice run status" },
    });
    const heading = hud.createDiv({ cls: "practice-lab-run-heading" });
    const icon = heading.createSpan({ attr: { "aria-hidden": "true" } });
    setIcon(icon, "gamepad-2");
    heading.createEl("strong", { text: "Practice run" });
    const metrics = hud.createDiv({ cls: "practice-lab-run-metrics" });
    if (preferences.showRunPoints) {
      this.studyRunMetricEls.set(
        "points",
        this.renderPracticeRunMetric(
          metrics,
          "Run points",
          `${formatPracticeRunPoints(run.earnedPoints)} / ${run.totalPoints}`,
        ),
      );
    }
    if (preferences.showRunStreak) {
      this.studyRunMetricEls.set(
        "streak",
        this.renderPracticeRunMetric(
          metrics,
          "Answer streak",
          String(run.currentStreak),
        ),
      );
    }
    if (preferences.showRunRank) {
      this.studyRunMetricEls.set(
        "rank",
        this.renderPracticeRunMetric(
          metrics,
          "Run rank",
          practiceRunRankText(run.rank),
        ),
      );
    }
  }

  private renderPracticeRunMetric(
    container: HTMLElement,
    label: string,
    value: string,
  ): HTMLElement {
    const metric = container.createDiv({ cls: "practice-lab-run-metric" });
    metric.createSpan({ text: label });
    return metric.createEl("strong", { text: value });
  }

  private renderStudyComplete(container: HTMLElement): void {
    const performance = calculatePerformanceScore(this.studyPerformanceOutcomes());
    const run = calculatePracticeRun(this.studyAnswers);
    const summary = container.createDiv({ cls: "practice-lab-complete" });
    const preferences = this.displayPreferences.practice;
    if (preferences.celebrateCompletion) {
      const icon = summary.createDiv({ cls: "practice-lab-complete-icon" });
      setIcon(icon, "party-popper");
    }
    const pathStep = this.studyPathStep;
    summary.createEl("h3", {
      text: pathStep === null ? "Session complete" : "Path step complete",
    });
    if (pathStep !== null) {
      summary.createEl("p", {
        cls: "practice-lab-path-completion-note",
        text: `You finished step ${pathStep.stepIndex + 1} of ${pathStep.stepCount}: ${pathStep.stepTitle}. Save it to record this work, then continue directly to the next saved path step.`,
      });
    }
    const finale = summary.createDiv({ cls: "practice-lab-run-finale" });
    if (preferences.showCompletionRank) {
      this.studyCompletionMetricEls.set(
        "rank",
        this.renderPracticeRunMetric(
          finale,
          "Run rank",
          practiceRunRankText(run.rank),
        ),
      );
    }
    if (preferences.showCompletionPerformance) {
      this.studyCompletionMetricEls.set(
        "performance",
        this.renderPracticeRunMetric(
          finale,
          "Performance score",
          performance.percent === null ? "—" : `${performance.percent}%`,
        ),
      );
    }
    if (preferences.showCompletionStreak) {
      this.studyCompletionMetricEls.set(
        "streak",
        this.renderPracticeRunMetric(
          finale,
          "Best answer streak",
          String(run.bestStreak),
        ),
      );
    }
    finale.hidden = this.studyCompletionMetricEls.size === 0;
    if (preferences.showCompletionNarrative) {
      this.studyCompletionRunSummaryEl = summary.createEl("p", {
        cls: "practice-lab-run-summary",
        text: `${run.rank.description} You earned ${formatPracticeRunPoints(run.earnedPoints)} of ${run.totalPoints} run points.`,
      });
      this.studyCompletionOutcomeEl = summary.createEl("p", {
        text: this.studyCompletionOutcomeText(),
      });
    }
    this.studyCompletionProvisionalEl = summary.createEl("p", {
      cls: "practice-lab-muted",
      text: this.studyCompletionProvisionalText(),
    });
    this.studyCompletionAiFeedbackEl = summary.createEl("section", {
      cls: "practice-lab-ai-review-feedback",
      attr: { "aria-label": "AI review feedback", "aria-live": "polite" },
    });
    this.renderStudyCompletionAiFeedback();
    if (this.studyFinishError !== null) {
      const failure = summary.createDiv({
        cls: "practice-lab-callout is-error",
        attr: { role: "alert", "aria-live": "assertive" },
      });
      setIcon(failure.createSpan(), "circle-alert");
      failure.createSpan({ text: this.studyFinishError });
    }
    const actions = summary.createDiv({ cls: "practice-lab-completion-actions" });
    if (
      pathStep !== null
      && this.options.callbacks.continueLearningPath !== undefined
    ) {
      new ButtonComponent(actions)
        .setIcon("route")
        .setButtonText(this.studyFinishing ? "Saving path step…" : "Save and continue path")
        .setTooltip("Save this completed step, then open the next tutor lesson or practice set in the saved path.")
        .setCta()
        .setDisabled(this.studyFinishing)
        .onClick(() => void this.finishStudy("continue"));
      new ButtonComponent(actions)
        .setIcon("save")
        .setButtonText(this.studyFinishing ? "Saving path step…" : "Save and stop here")
        .setTooltip("Save this completed path step and return without opening another step.")
        .setDisabled(this.studyFinishing)
        .onClick(() => void this.finishStudy("save"));
    } else {
      new ButtonComponent(actions)
        .setIcon("save")
        .setButtonText(this.studyFinishing ? "Saving session…" : "Save session")
        .setCta()
        .setDisabled(this.studyFinishing)
        .onClick(() => void this.finishStudy("save"));
    }
    if (this.studyLearningProgress === null) {
      new ButtonComponent(actions)
        .setIcon("repeat-2")
        .setButtonText(
          this.studyFinishing ? "Saving session…" : "Save and practice again",
        )
        .setDisabled(this.studyFinishing)
        .onClick(() => void this.finishStudy("repeat"));
    }
    if (
      this.studyLearningProgress !== null
      && this.options.callbacks.buildRepairSet !== undefined
      && this.studyHasRepairOpportunity()
    ) {
      new ButtonComponent(actions)
        .setIcon("wrench")
        .setButtonText(this.studyFinishing ? "Saving session…" : "Save and build repair set")
        .setDisabled(this.studyFinishing)
        .onClick(() => void this.finishStudy("repair"));
    }
  }

  private studyPerformanceOutcomes(): PerformanceOutcome[] {
    const outcomes: PerformanceOutcome[] = [];
    for (const answer of this.studyAnswers) {
      if (answer.correct !== undefined) {
        outcomes.push({ grading: "objective", correct: answer.correct });
      } else {
        const rating = this.studyAnswerRating(answer);
        if (rating !== undefined) {
          outcomes.push({ grading: "self-rated", rating });
        }
      }
    }
    return outcomes;
  }

  private studyCompletionOutcomeText(): string {
    const correctAnswers = this.studyAnswers.filter(
      (answer) => answer.correct === true,
    ).length;
    const objectiveAnswers = this.studyAnswers.filter(
      (answer) => answer.correct !== undefined,
    ).length;
    const freeResponseRatings = this.studyAnswers.flatMap((answer) => {
      if (answer.correct !== undefined) return [];
      const rating = this.studyAnswerRating(answer);
      return rating === undefined ? [] : [rating];
    });
    if (objectiveAnswers === 0 && freeResponseRatings.length === 0) {
      return "No questions were answered.";
    }
    if (objectiveAnswers === 0) {
      return `${freeResponseRatings.length} assessed free responses: ${summarizeFreeResponseOutcomes(freeResponseRatings)}.`;
    }
    if (freeResponseRatings.length === 0) {
      return `${correctAnswers} of ${objectiveAnswers} objective answers correct.`;
    }
    return `${correctAnswers} of ${objectiveAnswers} objective answers correct; assessed free responses: ${summarizeFreeResponseOutcomes(freeResponseRatings)}.`;
  }

  private studyAnswerRating(
    answer: StudyAnswerRecord,
  ): StudyAnswerRecord["rating"] {
    if (answer.rating !== undefined) return answer.rating;
    const status = answer.aiReview?.status;
    return status?.state === "reviewed"
      ? answerReviewVerdictRating(status.verdict)
      : undefined;
  }

  private studyCompletionProvisionalText(): string {
    const reviews = countAnswerReviews(this.studyAnswers);
    const skipped = this.studySkippedExerciseIds.length;
    const skippedText = skipped === 0
      ? ""
      : `${skipped} ${skipped === 1 ? "question was" : "questions were"} skipped and excluded from scores, performance, and streaks. `;
    if (reviews.pending > 0 || reviews.failed > 0) {
      const unresolved = [
        reviews.pending > 0
          ? `${reviews.pending} pending ${reviews.pending === 1 ? "review" : "reviews"}`
          : "",
        reviews.failed > 0
          ? `${reviews.failed} failed ${reviews.failed === 1 ? "review" : "reviews"}`
          : "",
      ].filter((part) => part.length > 0).join(" and ");
      const paused = this.studyAnswers.filter((answer) =>
        answer.aiReview?.status.state === "pending"
        && this.pausedAnswerReviewIds.has(answer.aiReview.request.requestId),
      ).length;
      const continuation = paused > 0
        ? `${paused} paused ${paused === 1 ? "review remains" : "reviews remain"} pending and will resume on a later desktop start.`
        : "Background results will update the saved history later.";
      return `${skippedText}Provisional result: ${unresolved} remain unscored and are excluded from points, performance, and streaks. You can finish now. ${continuation}`;
    }
    return `${skippedText}Partial free responses count as half credit. Nothing has been written yet; finish the session to save this score and history as one batched update.`;
  }

  private applyAnswerReviewStatus(status: AnswerReviewStatus): boolean {
    if (status.sessionId !== this.studySessionId) return false;
    const result = mergeAnswerReviewStatus(this.studyAnswers, status);
    if (!result.updated) return false;
    if (JSON.stringify(result.answers) === JSON.stringify(this.studyAnswers)) {
      return false;
    }
    this.studyAnswers = [...result.answers];
    if (status.state !== "pending") {
      this.pausedAnswerReviewIds.delete(status.requestId);
    }
    if (this.studyIndex < this.studyExercises.length) {
      void this.flushStudyCheckpoint().catch(() => undefined);
    }
    return true;
  }

  private reconcileAnswerReviewStatuses(): void {
    if (this.studySessionId.length === 0) return;
    const statuses = this.options.callbacks.getAnswerReviewStatuses?.(
      this.studySessionId,
    ) ?? [];
    for (const status of statuses) this.applyAnswerReviewStatus(status);
  }

  private updateAnswerReviewStatusDom(): void {
    const element = this.answerReviewStatusEl;
    if (element !== null) {
      const reviews = countAnswerReviews(this.studyAnswers);
      const total = reviews.pending + reviews.reviewed + reviews.failed;
      element.setText(total === 0
        ? "No AI reviews queued in this session."
        : `AI reviews: ${reviews.pending} pending · ${reviews.reviewed} reviewed · ${reviews.failed} failed.`);
      element.toggleClass("has-failure", reviews.failed > 0);
    }
    this.renderLiveAnswerReviewActions();
  }

  private updatePracticeRunDom(): void {
    const run = this.projectedPracticeRun();
    this.studyRunMetricEls.get("points")?.setText(
      `${formatPracticeRunPoints(run.earnedPoints)} / ${run.totalPoints}`,
    );
    this.studyRunMetricEls.get("streak")?.setText(String(run.currentStreak));
    this.studyRunMetricEls.get("rank")?.setText(practiceRunRankText(run.rank));
  }

  private updateStudyCompletionDom(): void {
    if (this.studyCompletionProvisionalEl === null) return;
    const run = calculatePracticeRun(this.studyAnswers);
    const performance = calculatePerformanceScore(this.studyPerformanceOutcomes());
    this.studyCompletionMetricEls.get("rank")?.setText(
      practiceRunRankText(run.rank),
    );
    this.studyCompletionMetricEls.get("performance")?.setText(
      performance.percent === null ? "—" : `${performance.percent}%`,
    );
    this.studyCompletionMetricEls.get("streak")?.setText(String(run.bestStreak));
    this.studyCompletionRunSummaryEl?.setText(
      `${run.rank.description} You earned ${formatPracticeRunPoints(run.earnedPoints)} of ${run.totalPoints} run points.`,
    );
    this.studyCompletionOutcomeEl?.setText(this.studyCompletionOutcomeText());
    this.studyCompletionProvisionalEl.setText(
      this.studyCompletionProvisionalText(),
    );
    this.renderStudyCompletionAiFeedback();
  }

  private renderStudyCompletionAiFeedback(): void {
    const container = this.studyCompletionAiFeedbackEl;
    if (container === null) return;
    container.empty();
    const reviewedAnswers = this.studyAnswers.filter(
      (answer) => answer.aiReview !== undefined,
    );
    container.toggleClass("is-empty", reviewedAnswers.length === 0);
    if (reviewedAnswers.length === 0) return;
    container.createEl("h4", { text: "AI review feedback" });
    const history = container.createDiv({ cls: "practice-lab-ai-review-history" });
    for (const answer of reviewedAnswers) {
      const review = answer.aiReview;
      if (review === undefined) continue;
      const item = history.createEl("article", {
        cls: `practice-lab-ai-review-history-item is-${review.status.state}`,
      });
      const exercise = this.studyExercises.find(
        (candidate) => candidate.id === answer.exerciseId,
      );
      const heading = item.createDiv({
        cls: "practice-lab-ai-review-feedback-heading",
      });
      const exerciseHeading = heading.createEl("strong");
      renderLatexMarkup(
        exerciseHeading,
        exercise?.title ?? exercise?.prompt ?? answer.exerciseId,
      );
      if (review.status.state === "reviewed") {
        heading.createSpan({
          cls: "practice-lab-ai-review-verdict",
          text: review.status.verdict === "correct"
            ? "Correct"
            : review.status.verdict === "partial"
              ? "Partially correct"
              : "Incorrect",
        });
        const feedback = item.createDiv({
          cls: "practice-lab-ai-review-feedback",
        });
        renderLatexMarkup(feedback, review.status.feedback);
        this.renderAnswerReviewCriteria(
          item,
          review.status.criterionResults,
          review.request.sourceSegments,
        );
      } else if (review.status.state === "pending") {
        heading.createSpan({ text: "Pending" });
        item.createEl("p", {
          text: this.pausedAnswerReviewIds.has(review.request.requestId)
            ? "The review is paused and remains pending for a later desktop resume."
            : "The review is continuing in the background.",
        });
        this.renderAnswerReviewManagement(item, answer);
      } else {
        heading.createSpan({ text: "Failed" });
        item.createEl("p", { text: review.status.failure });
        this.renderAnswerReviewManagement(item, answer);
      }
    }
  }

  private renderAnswerReviewCriteria(
    container: HTMLElement,
    criteria: readonly AnswerReviewCriterionResult[],
    sourceSegments: AnswerReviewRequest["sourceSegments"],
  ): void {
    if (criteria.length === 0) return;
    const list = container.createEl("ul", {
      cls: "practice-lab-ai-review-criteria",
      attr: { "aria-label": "Criterion-level feedback" },
    });
    for (const result of criteria) {
      const item = list.createEl("li", {
        cls: `practice-lab-ai-review-criterion is-${result.outcome}`,
      });
      const heading = item.createDiv({
        cls: "practice-lab-ai-review-criterion-heading",
      });
      const criterion = heading.createEl("strong");
      renderLatexMarkup(criterion, result.criterion);
      heading.createSpan({
        text: result.outcome === "met"
          ? "Met"
          : result.outcome === "partial"
            ? "Partial"
            : "Missed",
      });
      const feedback = item.createDiv({
        cls: "practice-lab-ai-review-feedback",
      });
      renderLatexMarkup(feedback, result.feedback);
      const evidence = item.createDiv({
        cls: "practice-lab-ai-review-evidence",
      });
      evidence.createSpan({ text: "Evidence segments:" });
      if (result.sourceSegmentIds.length === 0) {
        evidence.createSpan({ text: " none returned" });
      } else {
        const evidenceList = evidence.createEl("ul");
        for (const segmentId of result.sourceSegmentIds) {
          const segment = sourceSegments.find((candidate) => candidate.id === segmentId);
          const row = evidenceList.createEl("li");
          row.createEl("code", { text: segmentId });
          if (segment !== undefined) {
            const heading = segment.headingPath.length === 0
              ? "Source excerpt"
              : segment.headingPath.join(" › ");
            const excerpt = segment.text.length <= 180
              ? segment.text
              : `${segment.text.slice(0, 177)}…`;
            const sourceExcerpt = row.createDiv({
              cls: "practice-lab-ai-review-source-excerpt",
            });
            renderLatexMarkup(sourceExcerpt, `${heading}: ${excerpt}`);
          }
        }
      }
    }
  }

  private async refreshProviders(): Promise<void> {
    const refresh = this.options.callbacks.refreshProviders;
    if (refresh === undefined || this.providerRefreshBusy) return;
    this.providerRefreshBusy = true;
    this.renderPreservingScroll();
    try {
      await refresh();
    } catch (error) {
      new Notice(this.errorMessage(error, "Could not refresh AI providers."));
    } finally {
      this.providerRefreshBusy = false;
      this.renderPreservingScroll();
    }
  }

  private async requestSource(mode: MarkdownSourceMode): Promise<void> {
    const request = this.options.callbacks.requestSource;
    if (request === undefined || this.sourceRequestMode !== null) return;
    const epoch = ++this.sourceRequestEpoch;
    this.sourceRequestMode = mode;
    this.renderPreservingScroll();
    try {
      const source = await request(mode);
      if (epoch !== this.sourceRequestEpoch) return;
      this.sourceRequestMode = null;
      if (source !== null) {
        this.setSource(source, { prepareDefaultVisuals: true });
      } else {
        this.renderPreservingScroll();
      }
    } catch (error) {
      if (epoch !== this.sourceRequestEpoch) return;
      this.sourceRequestMode = null;
      new Notice(this.errorMessage(error, "Could not load the source."));
      this.renderPreservingScroll();
    }
  }

  private async requestNoteSource(): Promise<void> {
    const request = this.options.callbacks.requestNoteSource;
    if (request === undefined || this.sourceRequestMode !== null) return;
    const epoch = ++this.sourceRequestEpoch;
    this.sourceRequestMode = "vault-note";
    this.renderPreservingScroll();
    try {
      const source = await request();
      if (epoch !== this.sourceRequestEpoch) return;
      this.sourceRequestMode = null;
      if (source !== null) {
        this.setSource(source, { prepareDefaultVisuals: true });
      } else {
        this.renderPreservingScroll();
      }
    } catch (error) {
      if (epoch !== this.sourceRequestEpoch) return;
      this.sourceRequestMode = null;
      new Notice(this.errorMessage(error, "Could not load the selected note."));
      this.renderPreservingScroll();
    }
  }

  private async requestPdfSource(): Promise<void> {
    const request = this.options.callbacks.requestPdfSource;
    if (request === undefined || this.sourceRequestMode !== null) return;
    const epoch = ++this.sourceRequestEpoch;
    this.sourceRequestMode = "pdf";
    this.renderPreservingScroll();
    try {
      const source = await request();
      if (epoch !== this.sourceRequestEpoch) return;
      this.sourceRequestMode = null;
      if (source !== null) {
        this.setSource(source, { prepareDefaultVisuals: true });
      } else {
        this.renderPreservingScroll();
      }
    } catch (error) {
      if (epoch !== this.sourceRequestEpoch) return;
      this.sourceRequestMode = null;
      new Notice(this.errorMessage(error, "Could not load the PDF source."));
      this.renderPreservingScroll();
    }
  }

  private async resolveFrame(
    visual: DetectedVisual,
    position?: GifFramePosition,
  ): Promise<void> {
    const choose = this.options.callbacks.chooseMediaFrame;
    if (choose === undefined || this.visualSelectionBusy) return;
    this.visualSelectionBusy = true;
    this.render();
    try {
      const resolved = await choose(visual, position);
      if (resolved !== null) this.updateVisual(resolved);
    } catch (error) {
      new Notice(this.errorMessage(error, "Could not extract that frame."));
    } finally {
      this.visualSelectionBusy = false;
      this.render();
    }
  }

  private async selectAllImages(notify = true): Promise<void> {
    const source = this.source;
    if (source === null || this.visualSelectionBusy) return;
    this.visualSelectionBusy = true;
    this.render();
    const choose = this.options.callbacks.chooseMediaFrame;
    try {
      const result = await selectAllVisuals(
        source.visuals,
        this.gifFrameDefault,
        choose,
      );
      if (this.source?.path !== source.path) return;
      this.source = { ...source, visuals: result.visuals };
      this.invalidatePreview();
      if (notify) {
        for (const failure of result.failures) {
          const visual = source.visuals.find(
            (candidate) => candidate.id === failure.visualId,
          );
          new Notice(
            `Could not prepare ${visual === undefined ? failure.visualId : displayVisualName(visual)}: ${failure.message}`,
            8_000,
          );
        }
        new Notice(
          result.skippedCount === 0
            ? `Selected all ${result.selectedCount} detected visuals.`
            : `Selected ${result.selectedCount} visuals. ${result.skippedCount} still require individual review or are unavailable.`,
          6_000,
        );
      }
    } finally {
      this.visualSelectionBusy = false;
      this.render();
    }
  }

  private clearVisualSelection(): void {
    if (this.source === null || this.visualSelectionBusy) return;
    this.source = {
      ...this.source,
      visuals: this.source.visuals.map((visual) => ({
        ...visual,
        selected: false,
      })),
    };
    this.invalidatePreview();
    this.render();
  }

  private async importRemote(visual: DetectedVisual): Promise<void> {
    const importer = this.options.callbacks.importRemoteVisual;
    if (importer === undefined) return;
    try {
      const resolved = await importer(visual);
      if (resolved !== null) this.updateVisual(resolved);
    } catch (error) {
      new Notice(this.errorMessage(error, "Could not import that remote image."));
    }
  }

  private updateVisual(visual: DetectedVisual): void {
    if (this.source === null) return;
    this.source = {
      ...this.source,
      visuals: this.source.visuals.map((entry) =>
        entry.id === visual.id ? visual : entry,
      ),
    };
    this.invalidatePreview();
    this.render();
  }

  private getConfiguration(): GenerationConfiguration {
    const percentages = copyExerciseTypePercentages(
      this.exerciseTypePercentages,
    );
    return {
      provider: this.provider,
      model: this.effectiveModel(),
      reasoningEffort: this.reasoningEffort,
      focusInstructions: this.focusInstructions,
      quantity: this.quantity,
      difficulty: this.difficulty,
      exerciseTypes: enabledExerciseTypes(percentages),
      exerciseTypePercentages: percentages,
      selectedVisualIds: selectedVisualIds(this.source),
    };
  }

  private effectiveModel(): string {
    if (this.provider !== "agy" || this.customModelModeByProvider.agy) {
      return this.model;
    }
    const catalog = this.modelCatalog("agy");
    return modelPickerChoice(
      "agy",
      this.model,
      this.reasoningEffort,
      catalog,
    ) === AUTOMATIC_MODEL_CHOICE
      ? automaticModelForProvider("agy", this.reasoningEffort, catalog)
      : this.model;
  }

  private modelCatalog(provider: ProviderId): readonly ProviderModelPresentation[] {
    const presentation = this.providers.find((entry) => entry.id === provider);
    return modelsForProvider(provider, presentation?.models ?? []);
  }

  private updateProviderModelDefaults(
    providers: readonly ProviderPresentation[],
    initialize: boolean,
  ): void {
    for (const provider of providers) {
      const previousDefault = this.defaultModelsByProvider[provider.id];
      if (initialize || this.modelsByProvider[provider.id] === previousDefault) {
        this.modelsByProvider[provider.id] = provider.defaultModel;
      }
      this.defaultModelsByProvider[provider.id] = provider.defaultModel;
    }
  }

  private syncCustomModelState(): void {
    const choice = modelPickerChoice(
      this.provider,
      this.model,
      this.reasoningEffort,
      this.modelCatalog(this.provider),
    );
    this.customModelModeByProvider[this.provider] = choice === CUSTOM_MODEL_CHOICE;
    if (choice === CUSTOM_MODEL_CHOICE) {
      this.customModelDraftsByProvider[this.provider] = this.model;
    }
  }

  private supportedReasoningEfforts(): readonly ReasoningEffort[] {
    const provider = this.providers.find((entry) => entry.id === this.provider);
    return reasoningEffortsForModel(
      provider?.reasoningEfforts ?? [],
      this.effectiveModel(),
      this.modelCatalog(this.provider),
    );
  }

  private configurationProblem(): string | null {
    if (this.customModelModeByProvider[this.provider] && this.model.length === 0) {
      return "Enter a custom model ID or choose Automatic.";
    }
    const effectiveModel = this.effectiveModel();
    if (this.provider === "agy" && effectiveModel.length === 0) {
      return "No compatible automatic agy model is available for this reasoning level. Choose a listed or custom model.";
    }
    const modelProblem = modelIdProblem(effectiveModel);
    if (modelProblem !== null) return modelProblem;
    if (this.provider === "agy") {
      const reasoningProblem = agyModelReasoningProblem(
        effectiveModel,
        this.reasoningEffort,
        this.modelCatalog("agy"),
      );
      if (reasoningProblem !== null) return reasoningProblem;
    }
    const focusProblem = focusInstructionsProblem(this.focusInstructions);
    if (focusProblem !== null) return focusProblem;
    const distributionProblem = exerciseTypeDistributionProblem(
      this.exerciseTypePercentages,
    );
    if (distributionProblem !== null) return distributionProblem;
    const distributionPlan = planExerciseDistribution(
      this.exerciseTypePercentages,
      this.quantity,
    );
    const provider = this.providers.find((entry) => entry.id === this.provider);
    if (provider === undefined || !provider.available) {
      return provider?.detail === undefined
        ? "The selected provider is not available on this computer."
        : `${provider.label} is unavailable: ${provider.detail}`;
    }
    if (!this.supportedReasoningEfforts().includes(this.reasoningEffort)) {
      return `${provider.label} does not support the selected reasoning effort for this model.`;
    }
    if (!provider.supportsVision && selectedVisualIds(this.source).length > 0) {
      const capable = this.providers
        .filter((entry) => entry.available && entry.supportsVision)
        .map((entry) => entry.label)
        .join(" or ");
      return `The selected provider cannot receive the selected visual. Unselect it or choose ${capable || "an available vision provider"}.`;
    }
    const occlusionCount = plannedExerciseCount(
      distributionPlan,
      "image-occlusion",
    );
    if (occlusionCount > 0) {
      if (!provider.supportsVision) {
        const capable = this.providers
          .filter((entry) => entry.available && entry.supportsVision)
          .map((entry) => entry.label)
          .join(" or ");
        return `Image occlusion requires a vision-capable provider. Choose ${capable || "an available vision provider"}.`;
      }
      if (selectedVisualIds(this.source).length === 0) {
        return `The current mix allocates ${occlusionCount} image-occlusion ${occlusionCount === 1 ? "exercise" : "exercises"}. Select a ready visual or set image occlusion to 0%.`;
      }
    }
    return null;
  }

  private ensureSupportedReasoningEffort(): void {
    const efforts = this.supportedReasoningEfforts();
    const pinnedAgyEffort = this.provider === "agy" && this.model.length > 0
      ? agyReasoningEffortForModel(this.model)
      : undefined;
    if (pinnedAgyEffort !== undefined && efforts.includes(pinnedAgyEffort)) {
      this.reasoningEffort = pinnedAgyEffort;
      return;
    }
    const selectedModel = this.modelCatalog(this.provider)
      .find((entry) => entry.id === this.effectiveModel());
    this.reasoningEffort = preferredReasoningEffort(
      this.reasoningEffort,
      efforts,
      selectedModel,
    );
  }

  private async buildPreview(
    details: HTMLDetailsElement,
    onStateChanged?: () => void,
  ): Promise<void> {
    if (this.generationRecovery !== null) {
      new Notice("Resolve the saved generation above before approving another payload.", 8_000);
      return;
    }
    const source = this.source;
    if (source === null) return;
    const problem = this.configurationProblem();
    if (problem !== null) {
      new Notice(problem);
      return;
    }
    try {
      const configuration = this.getConfiguration();
      this.payloadPreview = await this.options.callbacks.previewPayload(
        source,
        configuration,
      );
      this.previewKey = configurationKey(source, configuration);
      this.payloadAccepted = false;
      this.payloadPreviewOpen = true;
      if (onStateChanged === undefined) {
        this.renderPreservingScroll();
      } else {
        onStateChanged();
      }
      const nextDetails = this.contentEl.querySelector<HTMLDetailsElement>(
        ".practice-lab-payload-preview",
      );
      if (nextDetails !== null) nextDetails.open = true;
    } catch (error) {
      this.payloadPreviewOpen = true;
      details.open = true;
      new Notice(this.errorMessage(error, "Could not build the payload preview."));
    }
  }

  private async generate(): Promise<void> {
    if (this.generationRecovery !== null) {
      new Notice("Resolve the saved generation above before starting another request.", 8_000);
      return;
    }
    const source = this.source;
    if (source === null || !this.payloadAccepted) return;
    const configuration = this.getConfiguration();
    if (configurationKey(source, configuration) !== this.previewKey) {
      this.invalidatePreview();
      new Notice("The configuration changed. Review the refreshed payload first.");
      this.render();
      return;
    }
    this.generationActivityEvents = [];
    this.generationActivityStartedAt = Date.now();
    this.generationActivityFinishedAt = null;
    this.agentActivityOpen = true;
    this.job = { state: "running", message: "Generating grounded exercises…" };
    this.updateActivityClock();
    this.render();
    try {
      const drafts = await this.options.callbacks.generate({
        source,
        configuration,
        payloadAccepted: true,
        onActivity: (event) => this.publishGenerationActivity(event),
      });
      this.generationActivityFinishedAt ??= Date.now();
      this.job = { state: "idle" };
      this.updateActivityClock();
      this.setDrafts(drafts);
    } catch (error) {
      this.generationActivityFinishedAt ??= Date.now();
      this.job = {
        state: "failed",
        message: this.errorMessage(error, "Generation failed."),
      };
      new Notice(this.job.message ?? "Generation failed.");
      this.updateActivityClock();
      this.render();
    }
  }

  private async cancelGeneration(): Promise<void> {
    if (this.options.callbacks.cancelGeneration === undefined) return;
    this.job = { state: "cancelling", message: "Cancelling generation…" };
    this.render();
    try {
      await this.options.callbacks.cancelGeneration();
    } finally {
      this.generationActivityFinishedAt ??= Date.now();
      this.job = { state: "idle" };
      this.updateActivityClock();
      this.render();
    }
  }

  private async saveDrafts(): Promise<void> {
    const source = this.source;
    if (source === null || this.reviewSaving) return;
    const gate = getReviewGateState(this.drafts, this.savedDraftFingerprint);
    if (!gate.canSave) {
      new Notice(
        gate.invalidContentCount > 0
          ? "Every kept exercise needs a prompt and grounded answer before saving."
          : gate.invalidLatexCount > 0
            ? "Fix every highlighted LaTeX delimiter or brace before saving."
          : gate.hasUnreviewedOcclusion
          ? "Review and accept every kept occlusion mask before saving."
          : "Keep at least one exercise before saving.",
      );
      this.refreshReviewActionState();
      return;
    }
    const submittedFingerprint = gate.currentFingerprint;
    const submittedMutationVersion = this.reviewMutationVersion;
    this.reviewSaving = true;
    this.reviewSaveError = null;
    this.refreshReviewActionState();
    try {
      await this.options.callbacks.saveDrafts(source, this.drafts);
      const savedCurrent =
        this.reviewMutationVersion === submittedMutationVersion &&
        reviewFingerprint(this.drafts) === submittedFingerprint;
      this.savedDraftFingerprint = savedCurrent ? submittedFingerprint : null;
      new Notice(
        savedCurrent
          ? "Practice set saved."
          : "Practice set saved, but the review changed during saving. Save again before practice.",
      );
      this.reviewSaving = false;
      this.render();
    } catch (error) {
      this.reviewSaving = false;
      this.reviewSaveError = this.errorMessage(
        error,
        "Could not save the practice set.",
      );
      new Notice(this.reviewSaveError);
      this.renderPreservingScroll();
    }
  }

  private updateDraft(
    id: string,
    update: Partial<EditableDraftExercise>,
  ): void {
    this.drafts = this.drafts.map((draft) =>
      draft.id === id ? { ...draft, ...update } : draft,
    );
    this.invalidateSavedReview();
    this.reviewSaveError = null;
    this.refreshReviewActionState();
  }

  private acceptAllOcclusions(): void {
    const result = acceptAllValidOcclusions(this.drafts);
    if (result.changed) {
      this.drafts = [...result.drafts];
      this.invalidateSavedReview();
      this.renderPreservingScroll();
    }

    const accepted = result.newlyAcceptedCount;
    const invalid = result.invalid.length;
    if (invalid > 0) {
      const acceptedMessage =
        accepted === 0
          ? ""
          : `Accepted ${accepted} occlusion${accepted === 1 ? "" : "s"}. `;
      const first = result.invalid[0];
      new Notice(
        `${acceptedMessage}${invalid} occlusion${invalid === 1 ? " needs" : "s need"} attention${first === undefined ? "." : `: ${first.reason}`}`,
      );
      return;
    }
    if (accepted > 0) {
      new Notice(
        `Accepted ${accepted} occlusion${accepted === 1 ? "" : "s"}.`,
      );
    }
  }

  private moveDraft(from: number, to: number): void {
    if (to < 0 || to >= this.drafts.length) return;
    const next = [...this.drafts];
    const removed = next.splice(from, 1)[0];
    if (removed === undefined) return;
    next.splice(to, 0, removed);
    this.drafts = next;
    this.invalidateSavedReview();
    this.render();
  }

  private invalidateSavedReview(): void {
    this.savedDraftFingerprint = null;
    this.reviewSaveError = null;
    this.reviewMutationVersion += 1;
  }

  private refreshReviewActionState(): void {
    const gate = getReviewGateState(this.drafts, this.savedDraftFingerprint);
    const keptOcclusions = this.drafts.filter(
      (draft) => !draft.rejected && draft.type === "image-occlusion",
    );
    const acceptedOcclusions = keptOcclusions.filter(
      (draft) => draft.occlusionReviewed,
    ).length;
    this.reviewSummaryEl?.setText(
      `${gate.acceptedCount} kept · ${gate.rejectedCount} rejected${keptOcclusions.length === 0 ? "" : ` · ${acceptedOcclusions}/${keptOcclusions.length} occlusions accepted`}`,
    );
    this.reviewAcceptAllButton?.setDisabled(!gate.hasUnreviewedOcclusion);
    this.reviewAcceptAllButton?.setTooltip(
      gate.hasUnreviewedOcclusion
        ? "Accept every kept occlusion whose masks are complete and valid"
        : "Every kept occlusion is accepted",
    );
    this.reviewSaveButton?.setDisabled(
      this.reviewSaving || gate.savedCurrent || !gate.canSave,
    );
    this.reviewSaveButton?.setButtonText(
      this.reviewSaving
        ? "Saving…"
        : gate.savedCurrent ? "Saved" : "Approve and save",
    );
    this.reviewStudyButton?.setDisabled(!gate.canStartPractice);
    this.reviewStudyButton?.setTooltip(
      gate.canStartPractice
        ? "Start the saved practice set"
        : "Save the current reviewed set before starting practice",
    );
    const notice = this.reviewGateNoticeEl;
    if (notice === null) return;
    const message = notice.querySelector<HTMLElement>(
      ".practice-lab-review-gate-message",
    );
    if (gate.invalidContentCount > 0) {
      notice.hidden = false;
      message?.setText(
        `${gate.invalidContentCount} kept ${gate.invalidContentCount === 1 ? "exercise needs" : "exercises need"} both a prompt and grounded answer.`,
      );
    } else if (gate.invalidLatexCount > 0) {
      notice.hidden = false;
      message?.setText(
        `${gate.invalidLatexCount} kept ${gate.invalidLatexCount === 1 ? "exercise has" : "exercises have"} malformed LaTeX. Open its rendered preview and fix the highlighted delimiter or brace.`,
      );
    } else if (gate.hasUnreviewedOcclusion) {
      notice.hidden = false;
      message?.setText(
        "Review and accept every kept occlusion mask before saving.",
      );
    } else if (gate.canSave && !gate.savedCurrent) {
      notice.hidden = false;
      message?.setText(
        "Save the current reviewed set before starting practice.",
      );
    } else {
      notice.hidden = true;
      message?.setText("");
    }
  }

  private studySubmitButton(container: HTMLElement, action: () => void): void {
    const button = new ButtonComponent(container)
      .setButtonText("Check answer")
      .setCta()
      .onClick(action);
    this.markPrimaryStudyAction(button);
  }

  private markPrimaryStudyAction(button: ButtonComponent): void {
    button.buttonEl.dataset.practiceLabPrimaryAction = "true";
    if (this.displayPreferences.practice.enableStudyKeyboardShortcuts) {
      button.buttonEl.setAttribute(
        "aria-keyshortcuts",
        "Control+Enter Meta+Enter",
      );
    }
  }

  private prepareStudyCard(card: HTMLElement, exerciseId: string): void {
    const primary = card.querySelector<HTMLButtonElement>(
      'button[data-practice-lab-primary-action="true"]',
    );
    const preferences = this.displayPreferences.practice;
    if (preferences.enableStudyKeyboardShortcuts && primary !== null) {
      card.addEventListener("keydown", (event) => {
        const currentPrimary = card.querySelector<HTMLButtonElement>(
          'button[data-practice-lab-primary-action="true"]',
        );
        if (
          event.key !== "Enter"
          || (!event.ctrlKey && !event.metaKey)
          || event.altKey
          || event.repeat
          || currentPrimary === null
          || currentPrimary.disabled
        ) {
          return;
        }
        event.preventDefault();
        currentPrimary.click();
      });
      if (preferences.showStudyShortcutHint) {
        const hint = card.createEl("p", {
          cls: "practice-lab-study-shortcut-hint",
        });
        hint.createSpan({ text: "Keyboard shortcut: " });
        hint.createEl("kbd", { text: "Ctrl/⌘ + ↵" });
      }
    }
    if (
      !preferences.autoFocusStudyInput
      || Platform.isMobileApp
      || this.studySubmitted !== null
    ) {
      return;
    }
    window.requestAnimationFrame(() => {
      if (
        !card.isConnected
        || this.stage !== "study"
        || this.studySubmitted !== null
        || this.studyExercises[this.studyIndex]?.id !== exerciseId
      ) {
        return;
      }
      const answerControl = card.querySelector<HTMLElement>(
        ".practice-lab-study-answer textarea:not(:disabled), .practice-lab-study-answer input:not(:disabled), .practice-lab-study-answer select:not(:disabled)",
      );
      (answerControl ?? primary)?.focus();
    });
  }

  private gradeChoice(
    container: HTMLElement,
    exercise: EditableDraftExercise,
  ): void {
    const chosen = Array.from(
      container.querySelectorAll<HTMLInputElement>("input[data-choice-id]:checked"),
    )
      .map((input) => input.dataset.choiceId)
      .filter((value): value is string => value !== undefined);
    if (chosen.length === 0) {
      new Notice("Choose an answer first.");
      return;
    }
    const correct =
      exercise.grading.kind === "single-select"
        ? chosen.length === 1 && chosen[0] === exercise.grading.correctChoiceId
        : exercise.grading.kind === "multi-select"
          ? sameStringSet(chosen, exercise.grading.correctChoiceIds)
          : false;
    this.setStudySubmitted({ answer: chosen.join(","), correct });
  }

  private gradeMatching(
    container: HTMLElement,
    exercise: EditableDraftExercise,
  ): void {
    if (exercise.grading.kind !== "matching") return;
    const selects = Array.from(
      container.querySelectorAll<HTMLSelectElement>("select[data-left-id]"),
    );
    if (selects.some((select) => select.value.length === 0)) {
      new Notice("Complete every match first.");
      return;
    }
    const answer: Record<string, string> = {};
    for (const select of selects) {
      const left = select.dataset.leftId;
      if (left !== undefined) answer[left] = select.value;
    }
    const correct = Object.entries(exercise.grading.correctPairs).every(
      ([left, right]) => answer[left] === right,
    );
    this.setStudySubmitted({ answer: JSON.stringify(answer), correct });
  }

  private gradeOrdering(exercise: EditableDraftExercise): void {
    if (exercise.grading.kind !== "ordering") return;
    const correctOrder = exercise.grading.correctOrder;
    const correct =
      this.orderingState.length === correctOrder.length &&
      this.orderingState.every(
        (id, index) => id === correctOrder[index],
      );
    this.setStudySubmitted({ answer: this.orderingState.join(","), correct });
  }

  private gradeOcclusion(
    container: HTMLElement,
    exercise: EditableDraftExercise,
  ): void {
    if (exercise.grading.kind !== "occlusion") return;
    const acceptedAnswers = exercise.grading.acceptedAnswers;
    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>("input[data-mask-id]"),
    );
    if (inputs.some((input) => input.value.trim().length === 0)) {
      new Notice("Answer every occluded region first.");
      return;
    }
    const correct = inputs.every((input) => {
      const id = input.dataset.maskId;
      if (id === undefined) return false;
      const accepted = acceptedAnswers[id] ?? [];
      return accepted.some(
        (answer) => normalizeAnswer(answer) === normalizeAnswer(input.value),
      );
    });
    this.setStudySubmitted({
      answer: inputs.map((input) => input.value).join(" | "),
      correct,
    });
  }

  private gradeCloze(
    container: HTMLElement,
    exercise: EditableDraftExercise,
  ): void {
    if (exercise.grading.kind !== "cloze") return;
    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>("input[data-blank-id]"),
    );
    if (inputs.some((input) => input.value.trim().length === 0)) {
      new Notice("Answer every blank first.");
      return;
    }
    const values: Record<string, string> = {};
    for (const input of inputs) {
      const id = input.dataset.blankId;
      if (id !== undefined) values[id] = input.value;
    }
    const correct = exercise.grading.blanks.every((blank) => {
      const actual = values[blank.id];
      if (actual === undefined) return false;
      return blank.acceptedAnswers.some(
        (accepted) =>
          normalizeAnswer(accepted, blank.caseSensitive) ===
          normalizeAnswer(actual, blank.caseSensitive),
      );
    });
    this.setStudySubmitted({ answer: JSON.stringify(values), correct });
  }

  private moveOrderingItem(from: number, to: number): void {
    if (to < 0 || to >= this.orderingState.length) return;
    const next = [...this.orderingState];
    const removed = next.splice(from, 1)[0];
    if (removed === undefined) return;
    next.splice(to, 0, removed);
    this.orderingState = next;
    this.updateStudyCurrentInput({ ordering: [...next] });
    this.render();
  }

  private async skipCurrentQuestion(exercise: EditableDraftExercise): Promise<void> {
    if (
      this.studyExercises[this.studyIndex]?.id !== exercise.id
      || !this.canSkipCurrentQuestion(exercise)
      || this.studySkippedExerciseIds.includes(exercise.id)
    ) {
      return;
    }
    const previousSkippedExerciseIds = this.studySkippedExerciseIds;
    const previousIndex = this.studyIndex;
    const previousSubmitted = this.studySubmitted;
    const previousInput = this.studyCurrentInput;
    const previousOrderingState = this.orderingState;
    const previousLearningProgress = this.studyLearningProgress;
    const previousTutorProblemStarted = this.studyTutorProblemStarted;
    const activeLesson = previousLearningProgress?.activeLesson ?? null;

    this.studySkippedExerciseIds = [...this.studySkippedExerciseIds, exercise.id];
    if (previousLearningProgress !== null && activeLesson !== null) {
      this.studyLearningProgress = {
        ...previousLearningProgress,
        activeLesson: null,
      };
    }
    this.studyIndex += 1;
    this.studySubmitted = null;
    this.studyTutorProblemStarted = false;
    this.resetOrderingState();
    this.resetStudyCurrentInput();
    this.clearStudyCheckpointTimer();
    try {
      await this.persistStudyCheckpoint();
      this.studyCheckpointWarningShown = false;
    } catch (error) {
      this.studySkippedExerciseIds = previousSkippedExerciseIds;
      this.studyIndex = previousIndex;
      this.studySubmitted = previousSubmitted;
      this.studyCurrentInput = previousInput;
      this.orderingState = previousOrderingState;
      this.studyLearningProgress = previousLearningProgress;
      this.studyTutorProblemStarted = previousTutorProblemStarted;
      new Notice(this.errorMessage(
        error,
        "Could not save the skipped-question checkpoint. The session did not advance.",
      ), 10_000);
    }
    this.render();
  }

  private async recordAndContinue(answer: StudyAnswerRecord): Promise<void> {
    const activeLesson = this.studyLearningProgress?.activeLesson ?? null;
    if (activeLesson?.lesson.guidedExerciseId === answer.exerciseId) {
      await this.recordGuidedTutorAttempt(answer);
      return;
    }
    const previousAnswers = this.studyAnswers;
    const previousIndex = this.studyIndex;
    const previousSubmitted = this.studySubmitted;
    const previousInput = this.studyCurrentInput;
    const previousLearningProgress = this.studyLearningProgress;
    let nextLearningProgress = previousLearningProgress;
    if (previousLearningProgress !== null) {
      const evidence = this.studyLearningEvidenceByExerciseId.get(answer.exerciseId);
      if (evidence === undefined) {
        new Notice("This learning-path exercise has no locked evidence assignment, so the session did not advance.", 10_000);
        return;
      }
      nextLearningProgress = {
        ...previousLearningProgress,
        evidence: [
          ...previousLearningProgress.evidence,
          structuredClone(evidence),
        ],
      };
    }
    this.studyAnswers = [...this.studyAnswers, answer];
    this.studyLearningProgress = nextLearningProgress;
    this.studyIndex += 1;
    this.studySubmitted = null;
    this.resetOrderingState();
    this.resetStudyCurrentInput();
    try {
      await this.persistStudyCheckpoint();
      this.studyCheckpointWarningShown = false;
    } catch (error) {
      this.studyAnswers = previousAnswers;
      this.studyIndex = previousIndex;
      this.studySubmitted = previousSubmitted;
      this.studyCurrentInput = previousInput;
      this.studyLearningProgress = previousLearningProgress;
      this.orderingState = previousInput?.ordering !== undefined
        ? [...previousInput.ordering]
        : [];
      new Notice(this.errorMessage(
        error,
        "Could not save this answer checkpoint. The session did not advance.",
      ));
    }
    this.render();
  }

  private async recordGuidedTutorAttempt(answer: StudyAnswerRecord): Promise<void> {
    const progress = this.studyLearningProgress;
    const active = progress?.activeLesson ?? null;
    if (progress === null || active === null) return;
    const previousProgress = structuredClone(progress);
    const previousSubmitted = this.studySubmitted;
    const previousInput = this.studyCurrentInput;
    const outcome = guidedOutcome(answer);
    const submittedAnswer = answer.submittedAnswer
      ?? this.studySubmitted?.answer
      ?? "";
    try {
      const firstAttempt = active.state.originalIndependentAttempt === null;
      const state = firstAttempt
        ? recordIndependentAttempt(active.state, {
            exerciseId: answer.exerciseId,
            outcome,
            submittedAnswer,
          })
        : recordRecoveryAttempt(active.state, {
            exerciseId: answer.exerciseId,
            outcome,
            submittedAnswer,
          });
      const originalAnswer = firstAttempt
        ? answer
        : parseLockedTutorAnswer(active.currentInput, answer.exerciseId);
      this.studyLearningProgress = {
        ...progress,
        activeLesson: {
          ...active,
          state,
          currentInput: serializeLockedTutorAnswer(originalAnswer),
        },
      };
      this.studySubmitted = null;
      this.resetOrderingState();
      this.resetStudyCurrentInput();
      await this.flushStudyCheckpoint();
      if (state.phase === "complete") {
        await this.finalizeTutorLesson(originalAnswer);
      } else {
        this.studyTutorProblemStarted = true;
        this.render();
      }
    } catch (error) {
      this.studyLearningProgress = previousProgress;
      this.studySubmitted = previousSubmitted;
      this.studyCurrentInput = previousInput;
      new Notice(this.errorMessage(error, "Could not save the guided attempt."), 10_000);
    }
  }

  private async completeUnresolvedTutorLesson(): Promise<void> {
    const progress = this.studyLearningProgress;
    const active = progress?.activeLesson ?? null;
    if (progress === null || active === null || active.state.originalIndependentAttempt === null) {
      return;
    }
    const previous = structuredClone(progress);
    try {
      const state = completeGuidedLesson(active.state);
      this.studyLearningProgress = {
        ...progress,
        activeLesson: { ...active, state },
      };
      await this.flushStudyCheckpoint();
      await this.finalizeTutorLesson(
        parseLockedTutorAnswer(active.currentInput, active.lesson.guidedExerciseId),
      );
    } catch (error) {
      this.studyLearningProgress = previous;
      new Notice(this.errorMessage(error, "Could not finish the guided recovery."), 10_000);
    }
  }

  private async finalizeTutorLesson(originalAnswer: StudyAnswerRecord): Promise<void> {
    const progress = this.studyLearningProgress;
    const active = progress?.activeLesson ?? null;
    if (progress === null || active === null || active.state.phase !== "complete") return;
    const evidence = this.studyLearningEvidenceByExerciseId.get(originalAnswer.exerciseId);
    if (evidence === undefined) {
      throw new Error("The guided problem has no locked learning-evidence assignment.");
    }
    const assistance = guidedAssistanceSummary(active.state);
    const completed: CompletedTutorLessonSnapshotV3 = {
      lesson: { id: active.lesson.id, title: active.lesson.title },
      aspects: evidence.aspects
        .filter((aspect) => active.lesson.aspectIds.includes(aspect.id))
        .map((aspect) => structuredClone(aspect)),
    };
    this.studyAnswers = [...this.studyAnswers, structuredClone(originalAnswer)];
    this.studyLearningProgress = {
      ...progress,
      activeLesson: null,
      evidence: [
        ...progress.evidence,
        {
          ...structuredClone(evidence),
          hintsRevealed: assistance.hintsRevealed,
          retries: assistance.retries,
          recoveryOutcome: assistance.recoveryOutcome,
        },
      ],
      completedTutorLessons: [...progress.completedTutorLessons, completed],
    };
    this.studyIndex += 1;
    this.studySubmitted = null;
    this.studyTutorProblemStarted = false;
    this.resetOrderingState();
    this.resetStudyCurrentInput();
    await this.flushStudyCheckpoint();
    this.render();
  }

  private resetOrderingState(): void {
    const exercise = this.studyExercises[this.studyIndex];
    this.orderingState = exercise?.orderingItems?.map((item) => item.id) ?? [];
  }

  private resetStudyCurrentInput(): void {
    const exercise = this.studyExercises[this.studyIndex];
    this.studyCurrentInput = exercise === undefined
      ? null
      : {
          exerciseId: exercise.id,
          fields: {},
          selectedIds: [],
          ordering: [...this.orderingState],
          submitted: null,
        };
  }

  private updateStudyInputField(key: string, value: string): void {
    const current = this.studyCurrentInput;
    if (current === null) return;
    this.updateStudyCurrentInput({
      fields: { ...current.fields, [key]: value },
    });
  }

  private updateStudyCurrentInput(
    patch: Partial<Omit<StudyCurrentInputStateV1, "exerciseId">>,
  ): void {
    const current = this.studyCurrentInput;
    if (current === null) return;
    this.studyCurrentInput = {
      ...current,
      ...patch,
      fields: patch.fields === undefined
        ? current.fields
        : { ...patch.fields },
      selectedIds: patch.selectedIds === undefined
        ? current.selectedIds
        : [...patch.selectedIds],
      ordering: patch.ordering === undefined
        ? current.ordering
        : [...patch.ordering],
    };
    this.scheduleStudyCheckpoint();
  }

  private setStudySubmitted(
    submitted: { readonly correct?: boolean; readonly answer: string },
  ): void {
    this.studySubmitted = submitted;
    if (this.studyCurrentInput !== null) {
      this.studyCurrentInput = {
        ...this.studyCurrentInput,
        ordering: [...this.orderingState],
        submitted: structuredClone(submitted),
      };
    }
    void this.flushStudyCheckpoint().catch(() => undefined);
    this.render();
  }

  private studyProgress(): StudySessionProgressV1 | null {
    const origin = this.studyOrigin;
    if (origin === null || this.studySessionId.length === 0) return null;
    return {
      ...origin,
      sessionId: this.studySessionId,
      startedAt: this.studyStartedAt,
      orderedExerciseIds: this.studyExercises.map((exercise) => exercise.id),
      currentQuestionIndex: this.studyIndex,
      answers: structuredClone(this.studyAnswers),
      skippedExerciseIds: [...this.studySkippedExerciseIds],
      currentInput: structuredClone(this.studyCurrentInput),
      answerReviewMode: this.answerReviewMode,
      answerReviewProvider: this.answerReviewProvider,
      answerReviewReasoningEffort: this.answerReviewReasoningEffort,
      ...(this.studyLearningProgress === null
        ? {}
        : { learningProgress: structuredClone(this.studyLearningProgress) }),
    };
  }

  private scheduleStudyCheckpoint(): void {
    if (this.options.callbacks.persistStudyCheckpoint === undefined) return;
    this.clearStudyCheckpointTimer();
    this.studyCheckpointTimer = window.setTimeout(() => {
      this.studyCheckpointTimer = undefined;
      void this.persistStudyCheckpoint().catch((error: unknown) => {
        if (this.studyCheckpointWarningShown) return;
        this.studyCheckpointWarningShown = true;
        new Notice(this.errorMessage(
          error,
          "Current input could not be checkpointed. Keep this view open and retry typing before leaving Obsidian.",
        ), 10_000);
      });
    }, 400);
  }

  private clearStudyCheckpointTimer(): void {
    if (this.studyCheckpointTimer === undefined) return;
    window.clearTimeout(this.studyCheckpointTimer);
    this.studyCheckpointTimer = undefined;
  }

  private async flushStudyCheckpoint(): Promise<void> {
    this.clearStudyCheckpointTimer();
    try {
      await this.persistStudyCheckpoint();
      this.studyCheckpointWarningShown = false;
    } catch (error) {
      if (!this.studyCheckpointWarningShown) {
        this.studyCheckpointWarningShown = true;
        new Notice(this.errorMessage(
          error,
          "The active study checkpoint could not be saved.",
        ), 10_000);
      }
      throw error;
    }
  }

  private async persistStudyCheckpoint(): Promise<void> {
    const callback = this.options.callbacks.persistStudyCheckpoint;
    const progress = this.studyProgress();
    if (callback === undefined || progress === null) return;
    await callback(progress);
  }

  private studyHasRepairOpportunity(): boolean {
    return this.studyAnswers.some((answer) => (
      answer.correct === false
      || answer.rating === "again"
      || answer.rating === "hard"
      || (
        answer.aiReview?.status.state === "reviewed"
        && answer.aiReview.status.verdict !== "correct"
      )
    )) || this.studyLearningProgress?.evidence.some((entry) => (
      entry.independent && entry.recoveryOutcome === "unresolved"
    )) === true;
  }

  private async finishStudy(
    action: "save" | "repeat" | "repair" | "continue",
  ): Promise<void> {
    const source = this.source;
    if (source === null || this.studyFinishing) return;
    const session: FinishedStudySession = {
      id: this.studySessionId,
      startedAt: this.studyStartedAt,
      finishedAt: new Date().toISOString(),
      answers: this.studyAnswers,
      skippedExerciseIds: [...this.studySkippedExerciseIds],
      ...(this.studyOrigin === null
        ? {}
        : {
            bankRevisionAtStart: this.studyOrigin.bankRevisionAtStart,
            exerciseCountAtStart: this.studyOrigin.exerciseCountAtStart,
            orderedExerciseIds: this.studyExercises.map((exercise) => exercise.id),
          }),
      ...(this.studyLearningProgress === null
        ? {}
        : {
            learning: {
              scope: structuredClone(this.studyLearningProgress.scope),
              evidence: this.studyLearningProgress.evidence.map((entry) => structuredClone(entry)),
              completedTutorLessons: this.studyLearningProgress.completedTutorLessons.map((entry) => structuredClone(entry)),
            },
          }),
    };
    const practiceAgain = action === "repeat";
    const buildRepair = action === "repair";
    const continuePath = action === "continue";
    const completedPathStep = this.studyPathStep;
    const repeatExercises = [...this.studyExercises];
    const repeatReview = {
      mode: this.answerReviewMode,
      provider: this.answerReviewProvider,
      reasoningEffort: this.answerReviewReasoningEffort,
    } as const;
    this.studyFinishing = true;
    this.studyFinishError = null;
    this.render();
    try {
      await this.options.callbacks.finishSession(source, session);
      this.studyFinishing = false;
      this.clearStudyCheckpointTimer();
      this.studyOrigin = null;
      this.studySkippedExerciseIds = [];
      this.studyLearningProgress = null;
      this.studyPathStep = null;
      this.studyLearningEvidenceByExerciseId.clear();
      this.studyTutorProblemStarted = false;
      this.studyCurrentInput = null;
      if (buildRepair) {
        try {
          await this.options.callbacks.buildRepairSet?.(source, session);
        } catch (error) {
          new Notice(this.errorMessage(
            error,
            "The session was saved, but the repair-set editor could not be opened.",
          ), 10_000);
        }
      }
      new Notice(
        practiceAgain
          ? "Session history saved. Starting a new run."
          : continuePath
            ? "Path step saved. Opening the next step."
            : "Session history saved.",
      );
      if (continuePath) {
        try {
          if (completedPathStep === null) {
            throw new Error("The completed path-step position is unavailable.");
          }
          await this.options.callbacks.continueLearningPath?.(
            completedPathStep.stepIndex,
          );
          if (this.studyIndex >= this.studyExercises.length) {
            this.stage = "review";
            this.render();
          }
        } catch (error) {
          this.stage = "review";
          this.render();
          new Notice(this.errorMessage(
            error,
            "The path step was saved, but the next step could not be opened.",
          ), 10_000);
        }
      } else if (practiceAgain) {
        await this.startStudy(repeatExercises);
        this.answerReviewMode =
          this.options.callbacks.enqueueAnswerReview === undefined
            ? "self"
            : repeatReview.mode;
        this.answerReviewProvider = repeatReview.provider;
        this.answerReviewReasoningEffort = repeatReview.reasoningEffort;
        this.render();
      } else {
        this.stage = "review";
        this.render();
      }
    } catch (error) {
      this.studyFinishing = false;
      this.studyFinishError = this.errorMessage(
        error,
        "Could not save session history.",
      );
      new Notice(this.studyFinishError);
      this.render();
    }
  }

  private invalidatePreview(): void {
    this.payloadPreview = null;
    this.previewKey = null;
    this.payloadAccepted = false;
    if (this.job.state === "failed") this.job = { state: "idle" };
  }

  private clearOcclusionEditors(): void {
    for (const editor of this.occlusionEditors.splice(0)) {
      this.removeChild(editor);
    }
  }

  private renderEmptyState(
    container: HTMLElement,
    title: string,
    description: string,
    iconName: string,
  ): void {
    const empty = container.createDiv({ cls: "practice-lab-empty" });
    const icon = empty.createDiv({ cls: "practice-lab-empty-icon" });
    setIcon(icon, iconName);
    empty.createEl("h4", { text: title });
    empty.createEl("p", { text: description });
  }

  private iconButton(
    container: HTMLElement,
    iconName: string,
    label: string,
    disabled: boolean,
    action: () => void,
  ): void {
    const button = container.createEl("button", {
      cls: "clickable-icon",
      attr: { type: "button", "aria-label": label },
    });
    button.disabled = disabled;
    setIcon(button, iconName);
    button.addEventListener("click", action);
  }

  private errorMessage(error: unknown, fallback: string): string {
    return formatCliErrorForUi(error, fallback);
  }
}

function tutorBlockLabel(
  kind: "why" | "prerequisite" | "explanation" | "worked-example" | "causal-walkthrough",
): string {
  if (kind === "why") return "Why it matters";
  if (kind === "prerequisite") return "Required prerequisite";
  if (kind === "worked-example") return "Worked example";
  if (kind === "causal-walkthrough") return "Causal walkthrough";
  return "Connected explanation";
}

function guidedOutcome(answer: StudyAnswerRecord): GuidedAttemptOutcome {
  if (answer.correct !== undefined) return answer.correct ? "correct" : "incorrect";
  if (answer.rating === "easy" || answer.rating === "good") return "correct";
  if (answer.rating === "hard") return "partial";
  return answer.rating === "again" ? "incorrect" : "partial";
}

function serializeLockedTutorAnswer(answer: StudyAnswerRecord): string {
  return JSON.stringify({ schemaVersion: 1, answer });
}

function parseLockedTutorAnswer(
  serialized: string,
  exerciseId: string,
): StudyAnswerRecord {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("The locked first guided attempt is unreadable.");
  }
  if (
    typeof value !== "object"
    || value === null
    || !("schemaVersion" in value)
    || value.schemaVersion !== 1
    || !("answer" in value)
    || typeof value.answer !== "object"
    || value.answer === null
    || !("exerciseId" in value.answer)
    || value.answer.exerciseId !== exerciseId
  ) {
    throw new Error("The locked first guided attempt does not match this exercise.");
  }
  return structuredClone(value.answer) as StudyAnswerRecord;
}

function appendActivityEvent(
  events: readonly CliActivityEvent[],
  event: CliActivityEvent,
  maximum: number,
): CliActivityEvent[] {
  const next = [...events];
  const latest = next.at(-1);
  if (
    latest !== undefined
    && latest.phase === event.phase
    && (
      event.phase === "receiving"
      || event.phase === "reasoning"
      || latest.message === event.message
    )
  ) {
    next[next.length - 1] = event;
  } else {
    next.push(event);
  }
  return next.slice(-maximum);
}

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
