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
import {
  displayReasoningEffort,
  reasoningEffortDescription,
} from "../reasoning";
import {
  agyModelForReasoning,
  agyModelReasoningProblem,
  MAX_MODEL_ID_LENGTH,
  modelIdProblem,
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
import {
  normalizeDisplayPreferences,
  orderStudyItems,
  type PracticeLabDisplayPreferences,
  type StudyOrderDefault,
  type VisualSelectionDefault,
} from "../preferences";
import {
  applyHoverDescriptions,
  installHoverDescriptions,
} from "./hover-descriptions";
import { OcclusionEditor } from "./occlusion-editor";
import {
  acceptAllValidOcclusions,
  getReviewGateState,
  reviewFingerprint,
} from "./review-state";
import { isGifVisual, selectAllVisuals } from "./visual-selection";
import { presentStudyOcclusionVisual } from "./study-occlusion";
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
  type GenerationConfiguration,
  type GifFramePosition,
  type JobPresentation,
  type PayloadPreview,
  type PracticeLabConfigurationDefaults,
  type PracticeLabViewOptions,
  type ProviderId,
  type ProviderPresentation,
  type ReasoningEffort,
  type MarkdownSourceMode,
  type SourcePresentation,
  type StudyAnswerRecord,
} from "./contracts";

export const PRACTICE_LAB_VIEW_TYPE = "practice-lab-view";

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
    (_placeholder, id: string) => {
      const number = ordinal.get(id);
      return number === undefined ? "____" : `____ [blank ${number}]`;
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

export class PracticeLabView extends ItemView {
  private stage: MainStage = "source";
  private source: SourcePresentation | null;
  private providers: readonly ProviderPresentation[];
  private provider: ProviderId;
  private model = "";
  private reasoningEffort: ReasoningEffort = "medium";
  private focusInstructions = "";
  private defaultFocusInstructions = "";
  private gifFrameDefault: GifFramePosition = "middle";
  private visualSelectionDefault: VisualSelectionDefault = "manual";
  private studyOrderDefault: StudyOrderDefault = "bank";
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
  private studySubmitted: { readonly correct?: boolean; readonly answer: string } | null = null;
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
  private sourceRequestMode: SourcePresentation["mode"] | null = null;
  private sourceRequestEpoch = 0;
  private providerRefreshBusy = false;
  private reviewSaving = false;
  private reviewSaveError: string | null = null;
  private studyFinishing = false;
  private studyFinishError: string | null = null;
  private regenerationContext: string | null = null;

  public constructor(
    leaf: WorkspaceLeaf,
    private readonly options: PracticeLabViewOptions,
  ) {
    super(leaf);
    this.navigation = false;
    this.source = options.initialSource ?? null;
    this.providers = [...options.providers];
    this.displayPreferences = normalizeDisplayPreferences(options.displayPreferences);
    this.payloadPreviewOpen = this.displayPreferences.practice.expandPayloadPreview;
    this.provider =
      this.providers.find((provider) => provider.id === "codex" && provider.available)
        ?.id ??
      this.providers.find((provider) => provider.available)?.id ??
      "codex";
    this.model = this.providers.find((provider) => provider.id === this.provider)
      ?.defaultModel ?? "";
    this.answerReviewProvider = this.answerReviewDefaultProvider;
    this.ensureSupportedReasoningEffort();
  }

  public getViewType(): string {
    return PRACTICE_LAB_VIEW_TYPE;
  }

  public getDisplayText(): string {
    return "Practice Problem Generator";
  }

  public getIcon(): string {
    return "flask-conical";
  }

  public override async onOpen(): Promise<void> {
    installHoverDescriptions(this.contentEl);
    this.render();
  }

  public override async onClose(): Promise<void> {
    this.clearOcclusionEditors();
    this.clearActivityClock();
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
    this.studySubmitted = null;
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

  public setProviders(providers: readonly ProviderPresentation[]): void {
    const previousProvider = this.provider;
    this.providers = [...providers];
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
      this.model = this.providers.find((provider) => provider.id === this.provider)
        ?.defaultModel ?? "";
    }
    this.ensureSupportedReasoningEffort();
    this.invalidatePreview();
    if (this.stage === "study") {
      this.refreshAnswerReviewControls();
      this.renderCurrentFreeResponseActions();
      this.renderStudyCompletionAiFeedback();
      return;
    }
    this.render();
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
    if (defaults.model !== undefined) this.model = defaults.model;
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

  public startStudy(
    exercises?: readonly DraftExercisePresentation[],
  ): void {
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
    const orderedExercises = this.studyOrderDefault === "shuffle"
      ? orderStudyItems(selectedExercises, "shuffle")
      : [...selectedExercises];
    this.studyExercises = orderedExercises.map((exercise) => ({
      ...editableDraft(exercise),
      rejected: false,
      occlusionReviewed: true,
    }));
    if (this.studyExercises.length === 0) {
      new Notice("There are no approved exercises to study.");
      return;
    }
    this.studyIndex = 0;
    this.studySessionId = `session-${crypto.randomUUID()}`;
    this.studyStartedAt = new Date().toISOString();
    this.studyAnswers = [];
    this.studySubmitted = null;
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
      ["source", "1. Source"],
      ["configure", "2. Configure"],
      ["review", "3. Review"],
    ];
    for (const [stage, label] of definitions) {
      const button = steps.createEl("button", {
        text: label,
        cls: this.stage === stage ? "is-active" : "",
        attr: {
          type: "button",
          "aria-current": this.stage === stage ? "step" : "false",
        },
      });
      const unavailable = stage === "configure" ? this.source === null : stage === "review" ? this.drafts.length === 0 : false;
      button.disabled = unavailable;
      button.addEventListener("click", () => {
        this.stage = stage;
        this.render();
      });
    }
  }

  private renderSource(container: HTMLElement): void {
    const top = container.createDiv({ cls: "practice-lab-section-heading" });
    top.createEl("h3", { text: "Choose the source" });
    top.createEl("p", {
      text: "Practice Problem Generator reads an active selection, note, or explicit PDF page range. Source material is never rewritten.",
    });

    if (this.options.callbacks.requestSource !== undefined) {
      const sourceButtons = container.createDiv({ cls: "practice-lab-button-row" });
      new ButtonComponent(sourceButtons)
        .setButtonText(
          this.sourceRequestMode === "selection"
            ? "Loading selection…"
            : "Use editor selection",
        )
        .setIcon("text-select")
        .setDisabled(this.sourceRequestMode !== null)
        .onClick(() => void this.requestSource("selection"));
      new ButtonComponent(sourceButtons)
        .setButtonText(
          this.sourceRequestMode === "note"
            ? "Loading note…"
            : "Use current note",
        )
        .setIcon("file-text")
        .setDisabled(this.sourceRequestMode !== null)
        .onClick(() => void this.requestSource("note"));
    }
    if (this.options.callbacks.requestPdfSource !== undefined) {
      const sourceButtons = container.querySelector<HTMLElement>(
        ".practice-lab-button-row",
      ) ?? container.createDiv({ cls: "practice-lab-button-row" });
      new ButtonComponent(sourceButtons)
        .setButtonText(
          this.sourceRequestMode === "pdf"
            ? "Loading PDF…"
            : "Use active PDF",
        )
        .setIcon("file-scan")
        .setDisabled(this.sourceRequestMode !== null)
        .onClick(() => void this.requestPdfSource());
    }

    if (this.sourceRequestMode !== null) {
      const status = container.createDiv({
        cls: "practice-lab-source-loading",
        attr: { role: "status", "aria-live": "polite" },
      });
      const spinner = status.createSpan({ cls: "practice-lab-spinner" });
      setIcon(spinner, "loader-circle");
      status.createSpan({
        text: this.sourceRequestMode === "pdf"
          ? "Preparing the PDF source. Complete or cancel the page dialog to continue."
          : "Reading the active source…",
      });
    }

    if (this.source === null) {
      this.renderEmptyState(
        container,
        "No source loaded",
        "Open a note or PDF, then choose the current note, an editor selection, or a PDF page range.",
        "file-search",
      );
      return;
    }

    const sourceCard = container.createDiv({ cls: "practice-lab-source-card" });
    const badge = sourceCard.createSpan({
      cls: "practice-lab-badge",
      text: this.source.mode === "selection"
        ? "Editor selection"
        : this.source.mode === "pdf" ? "PDF pages" : "Current note",
    });
    badge.setAttribute("aria-label", `Source mode: ${badge.textContent ?? ""}`);
    sourceCard.createEl("h4", { text: this.source.title });
    if (this.displayPreferences.practice.showSourcePath) {
      sourceCard.createDiv({
        cls: "practice-lab-path",
        text: this.source.path,
      });
    }
    if (this.source.detail !== undefined) {
      sourceCard.createDiv({
        cls: "practice-lab-source-detail",
        text: this.source.detail,
      });
    }
    if (this.displayPreferences.practice.showSourceExcerpt) {
      sourceCard.createEl("p", {
        cls: "practice-lab-excerpt",
        text: this.source.excerpt,
      });
    }
    sourceCard.createDiv({
      cls: "practice-lab-source-meta",
      text: `${this.source.characterCount.toLocaleString()} characters`,
    });

    const visualHeading = container.createDiv({ cls: "practice-lab-section-heading" });
    visualHeading.createEl("h4", { text: "Detected visuals" });
    visualHeading.createEl("p", {
      text: "Select only visuals that should be sent. GIFs use your default frame automatically; videos and remote images still require explicit review.",
    });
    if (this.source.visuals.length === 0) {
      container.createEl("p", {
        cls: "practice-lab-muted",
        text: this.source.mode === "pdf"
          ? "No separate visual was selected. PDF text is page-grounded; embedded page images are not uploaded automatically."
          : "No supported visuals were detected in this source.",
      });
    } else {
      const bulkControls = container.createDiv({
        cls: "practice-lab-visual-bulk-controls",
      });
      const defaultLabel = bulkControls.createEl("label", {
        cls: "practice-lab-gif-default",
      });
      defaultLabel.createSpan({ text: "Default GIF frame" });
      const defaultSelect = defaultLabel.createEl("select", {
        attr: { "aria-label": "Default GIF frame" },
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
        .setButtonText(this.visualSelectionBusy ? "Selecting…" : "Select all images")
        .setIcon("list-checks")
        .setDisabled(this.visualSelectionBusy)
        .onClick(() => void this.selectAllImages());
      new ButtonComponent(bulkControls)
        .setButtonText("Clear selection")
        .setIcon("x")
        .setDisabled(
          this.visualSelectionBusy
            || !this.source.visuals.some((visual) => visual.selected),
        )
        .onClick(() => this.clearVisualSelection());
      bulkControls.createSpan({
        cls: "practice-lab-muted",
        text: `${selectedVisualIds(this.source).length} selected`,
      });
      const visualList = container.createDiv({ cls: "practice-lab-visual-grid" });
      for (const visual of this.source.visuals) this.renderVisualCard(visualList, visual);
    }

    const footer = container.createDiv({ cls: "practice-lab-stage-footer" });
    new ButtonComponent(footer)
      .setButtonText("Configure practice")
      .setCta()
      .setIcon("arrow-right")
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
            .setButtonText(`Use ${displayGifFramePosition(this.gifFrameDefault)}`)
            .setIcon("check")
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
          .setButtonText("Choose different frame")
          .setIcon("scan-line")
          .setDisabled(
            this.visualSelectionBusy
              || this.options.callbacks.chooseMediaFrame === undefined,
          );
        change.onClick(() => void this.resolveFrame(visual));
      }
    } else if (visual.state === "frame-required") {
      if (isGifVisual(visual)) {
        const useDefault = new ButtonComponent(controls)
          .setButtonText(`Use ${displayGifFramePosition(this.gifFrameDefault)}`)
          .setIcon("check")
          .setDisabled(
            this.visualSelectionBusy
              || this.options.callbacks.chooseMediaFrame === undefined,
          );
        useDefault.onClick(() => void this.resolveFrame(
          visual,
          this.gifFrameDefault,
        ));
        const choose = new ButtonComponent(controls)
          .setButtonText("Choose different frame")
          .setIcon("scan-line")
          .setDisabled(
            this.visualSelectionBusy
              || this.options.callbacks.chooseMediaFrame === undefined,
          );
        choose.onClick(() => void this.resolveFrame(visual));
      } else {
        const button = new ButtonComponent(controls)
          .setButtonText("Choose still frame")
          .setIcon("scan-line")
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
        .setButtonText("Preview and import")
        .setIcon("download");
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
      this.provider = providerSelect.value as ProviderId;
      this.model = this.providers.find((provider) => provider.id === this.provider)
        ?.defaultModel ?? "";
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
          ].filter((part) => part !== undefined).join(" · ")
        : selectedProvider?.detail ?? "Provider availability has not been confirmed.",
    );
    let modelInput: HTMLInputElement | null = null;
    new Setting(form)
      .setName("Model")
      .setDesc("Optional exact CLI model. Leave blank for the provider default; Practice Problem Generator records that the model was not pinned.")
      .addText((component) => {
        modelInput = component.inputEl;
        component.inputEl.maxLength = MAX_MODEL_ID_LENGTH;
        component.inputEl.spellcheck = false;
        component
          .setPlaceholder("Provider default")
          .setValue(this.model)
          .onChange((value) => {
            this.model = value.trim();
            configurationChanged();
          });
      });
    new Setting(form)
      .setName("Reasoning effort")
      .setDesc(reasoningEffortDescription(this.provider))
      .addDropdown((component) => {
        for (const effort of selectedProvider?.reasoningEfforts ?? []) {
          component.addOption(effort, displayReasoningEffort(effort));
        }
        component.setValue(this.reasoningEffort).onChange((value) => {
          this.reasoningEffort = value as ReasoningEffort;
          if (this.provider === "agy") {
            this.model = agyModelForReasoning(this.model, this.reasoningEffort);
            if (modelInput !== null) modelInput.value = this.model;
          }
          configurationChanged();
        });
      });

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

    new Setting(form)
      .setName("Difficulty")
      .setDesc("Deep exam practice is the recommended default.")
      .addDropdown((component) => {
        component
          .addOption("foundational", "Foundational")
          .addOption("deep-exam", "Deep exam practice")
          .addOption("challenge", "Challenge")
          .setValue(this.difficulty)
          .onChange((value) => {
            this.difficulty = value as Difficulty;
            configurationChanged();
          });
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
    new ButtonComponent(typeActions)
      .setButtonText("Equal selected")
      .setTooltip("Give every currently selected type an equal share.")
      .onClick(() => {
        applyMix(balanceExerciseTypes(
          enabledExerciseTypes(this.exerciseTypePercentages),
        ));
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
    if (capability !== null) {
      const warning = container.createDiv({
        cls: "practice-lab-callout is-warning",
        attr: { role: "alert" },
      });
      setIcon(warning.createSpan(), "triangle-alert");
      warning.createSpan({ text: capability });
      if (this.options.callbacks.refreshProviders !== undefined) {
        new ButtonComponent(warning)
          .setButtonText(
            this.providerRefreshBusy ? "Checking providers…" : "Check again",
          )
          .setIcon("refresh-cw")
          .setDisabled(this.providerRefreshBusy)
          .onClick(() => void this.refreshProviders());
      }
    }
    this.renderPayloadPreview(
      container,
      capability !== null,
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
      .setButtonText("Back")
      .setIcon("arrow-left")
      .onClick(() => {
        this.stage = "source";
        this.render();
      });
    if (this.job.state === "running" || this.job.state === "cancelling") {
      this.renderJob(footer);
    } else {
      const generate = new ButtonComponent(footer)
        .setButtonText(
          this.job.state === "failed" ? "Retry generation" : "Generate draft set",
        )
        .setIcon("sparkles")
        .setCta();
      const currentKey = configurationKey(source, this.getConfiguration());
      generate.setDisabled(
        capability !== null ||
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
        .setButtonText("Build payload preview")
        .setIcon("eye");
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
      .setButtonText("Refresh preview")
      .setIcon("refresh-cw")
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
        .setButtonText("Accept all occlusions")
        .setIcon("check-check")
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
      .setButtonText("Back to configure")
      .setIcon("arrow-left")
      .onClick(() => {
        this.stage = "configure";
        this.render();
      });
    const save = new ButtonComponent(footer)
      .setButtonText("Approve and save")
      .setIcon("save")
      .setCta();
    save.onClick(() => void this.saveDrafts());
    this.reviewSaveButton = save;
    const study = new ButtonComponent(footer)
      .setButtonText("Start practice")
      .setIcon("play");
    study.onClick(() => this.startStudy());
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
      const invalid = !draft.rejected && prompt.value.trim().length === 0;
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
      const invalid = !draft.rejected && answer.value.trim().length === 0;
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
    if (
      this.displayPreferences.practice.showDraftRationale
      && draft.rationale !== undefined
    ) {
      card.createEl("p", {
        cls: "practice-lab-rationale",
        text: draft.rationale,
      });
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
    if (this.studyExercises.some((candidate) => candidate.grading.kind === "self")) {
      this.renderAnswerReviewControls(container);
    }

    const card = container.createDiv({ cls: "practice-lab-study-card" });
    card.createSpan({ cls: "practice-lab-badge", text: EXERCISE_LABELS[exercise.type] });
    card.createEl("h3", { text: studyPrompt(exercise) });

    const answerArea = card.createDiv({ cls: "practice-lab-study-answer" });
    if (this.studySubmitted === null) {
      this.renderStudyInput(answerArea, exercise);
    } else {
      this.renderStudyFeedback(answerArea, exercise);
    }
    this.prepareStudyCard(card, exercise.id);
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
          label.createSpan({ text: choice.text });
        }
        this.studySubmitButton(container, () => this.gradeChoice(container, exercise));
        break;
      }
      case "matching": {
        const right = exercise.matchingRight ?? [];
        const matching = container.createDiv({ cls: "practice-lab-matching" });
        for (const left of exercise.matchingLeft ?? []) {
          const row = matching.createDiv({ cls: "practice-lab-matching-row" });
          row.createSpan({ text: left.text });
          const select = row.createEl("select", {
            attr: {
              "aria-label": `Match for ${left.text}`,
              "data-left-id": left.id,
            },
          });
          select.createEl("option", { value: "", text: "Choose…" });
          for (const choice of right) {
            select.createEl("option", { value: choice.id, text: choice.text });
          }
        }
        this.studySubmitButton(container, () => this.gradeMatching(container, exercise));
        break;
      }
      case "ordering": {
        const byId = new Map((exercise.orderingItems ?? []).map((item) => [item.id, item.text]));
        const ordering = container.createDiv({ cls: "practice-lab-ordering" });
        for (const [index, id] of this.orderingState.entries()) {
          const row = ordering.createDiv({ cls: "practice-lab-order-row" });
          row.createSpan({ text: byId.get(id) ?? id });
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
          const label = fields.createEl("label", { text: mask.label });
          const input = label.createEl("input", {
            attr: { type: "text", "data-mask-id": mask.id },
          });
          input.autocomplete = "off";
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
        if (grading.unit !== undefined) {
          row.createSpan({ cls: "practice-lab-unit", text: grading.unit });
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
          this.studySubmitted = { answer: input.value.trim(), correct };
          this.render();
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
        const buttonText = grading.kind === "self" ? "Reveal grounded answer" : "Check answer";
        const reveal = new ButtonComponent(container)
          .setButtonText(buttonText)
          .setCta()
          .onClick(() => {
            const answer = textarea.value;
            if (grading.kind === "self") {
              this.studySubmitted = { answer };
            } else {
              const actual = normalizeAnswer(answer, grading.caseSensitive ?? false);
              const correct = grading.acceptedAnswers.some(
                (accepted) =>
                  normalizeAnswer(accepted, grading.caseSensitive ?? false) === actual,
              );
              this.studySubmitted = { answer, correct };
            }
            this.render();
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
        container.createEl("blockquote", { text: submitted.answer });
      }
    }
    if (exercise.grading.kind === "occlusion") {
      this.renderStudyOcclusionVisual(container, exercise, true);
    }
    const answer = container.createDiv({ cls: "practice-lab-grounded-answer" });
    answer.createEl("h4", { text: "Grounded answer" });
    answer.createEl("p", { text: exercise.groundedAnswer });
    if (
      this.displayPreferences.practice.showStudyRationale
      && exercise.rationale !== undefined
    ) {
      answer.createEl("p", { cls: "practice-lab-rationale", text: exercise.rationale });
    }

    if (exercise.grading.kind === "self") {
      this.studyFeedbackActionsEl = container.createDiv({
        cls: "practice-lab-free-response-actions",
      });
      this.renderCurrentFreeResponseActions();
    } else {
      const next = new ButtonComponent(container)
        .setButtonText(this.studyIndex === this.studyExercises.length - 1 ? "View results" : "Next question")
        .setIcon("arrow-right")
        .setCta()
        .onClick(() =>
          this.recordAndContinue({
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
        const option = providerSelect.createEl("option", {
          value: provider.id,
          text: provider.available
            ? provider.label
            : `${provider.label} (unavailable)`,
        });
        option.disabled = !provider.available;
      }
      providerSelect.value = this.answerReviewProvider;
      providerSelect.addEventListener("change", () => {
        this.answerReviewProvider = providerSelect.value as ProviderId;
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
        this.refreshAnswerReviewControls();
        this.renderCurrentFreeResponseActions();
      });

      const readiness = this.answerReviewProviderProblem();
      controls.createEl("p", {
        cls: `practice-lab-answer-review-note${readiness === null ? "" : " is-warning"}`,
        text: readiness ??
          `${ANSWER_REVIEW_PAYLOAD_DISCLOSURE} will be sent to ${selectedProvider?.label ?? this.answerReviewProvider}. When you finish this session, the submitted answer and locked review context are also stored in the Practice Markdown so the review can resume after a restart and remain visible in history. Reviews never pause the next question.`,
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
        .onClick(() => this.recordAndContinue({
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
    const problem = this.answerReviewActionProblem(exercise, submittedAnswer);
    container.createEl("p", {
      cls: `practice-lab-rating-prompt${problem === null ? "" : " is-warning"}`,
      text: problem ??
        `${provider?.label ?? this.answerReviewProvider} will assess this response in the background. You can continue immediately.`,
    });
    const buttons = container.createDiv({ cls: "practice-lab-rating-row" });
    const queue = new ButtonComponent(buttons)
      .setButtonText(`Send to ${provider?.label ?? this.answerReviewProvider} and continue`)
      .setIcon("send")
      .setCta()
      .setDisabled(problem !== null);
    this.markPrimaryStudyAction(queue);
    queue.onClick(() => {
      if (this.answerReviewActionProblem(exercise, submittedAnswer) !== null) {
        return;
      }
      this.queueAnswerReviewAndContinue(exercise, submittedAnswer);
    });
    new ButtonComponent(buttons)
      .setButtonText("Assess myself instead")
      .onClick(() => {
        container.empty();
        this.renderSelfAssessmentActions(container, exercise, submittedAnswer);
      });
  }

  private queueAnswerReviewAndContinue(
    exercise: EditableDraftExercise,
    submittedAnswer: string,
  ): void {
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
      this.options.callbacks.enqueueAnswerReview?.(request);
    } catch (error) {
      new Notice(this.errorMessage(error, "Could not queue this AI review."));
      return;
    }
    this.recordAndContinue(createPendingAnswerReviewRecord(request));
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
    if (provider === undefined || !provider.available) {
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
      heading.createEl("strong", { text: review.request.exerciseTitle });
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
        .setButtonText("Pause review")
        .setIcon("pause")
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
      .setButtonText(`Retry with ${providerLabel}`)
      .setIcon("refresh-cw")
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
    summary.createEl("h3", { text: "Session complete" });
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
    new ButtonComponent(actions)
      .setButtonText(this.studyFinishing ? "Saving session…" : "Save session")
      .setIcon("save")
      .setCta()
      .setDisabled(this.studyFinishing)
      .onClick(() => void this.finishStudy(false));
    new ButtonComponent(actions)
      .setButtonText(
        this.studyFinishing ? "Saving session…" : "Save and practice again",
      )
      .setIcon("repeat-2")
      .setDisabled(this.studyFinishing)
      .onClick(() => void this.finishStudy(true));
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
      return `Provisional result: ${unresolved} remain unscored and are excluded from points, performance, and streaks. You can finish now. ${continuation}`;
    }
    return "Partial free responses count as half credit. Nothing has been written yet; finish the session to save this score and history as one batched update.";
  }

  private applyAnswerReviewStatus(status: AnswerReviewStatus): boolean {
    if (status.sessionId !== this.studySessionId) return false;
    const result = mergeAnswerReviewStatus(this.studyAnswers, status);
    if (!result.updated) return false;
    this.studyAnswers = [...result.answers];
    if (status.state !== "pending") {
      this.pausedAnswerReviewIds.delete(status.requestId);
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
      heading.createEl("strong", {
        text: exercise?.title ?? exercise?.prompt ?? answer.exerciseId,
      });
      if (review.status.state === "reviewed") {
        heading.createSpan({
          cls: "practice-lab-ai-review-verdict",
          text: review.status.verdict === "correct"
            ? "Correct"
            : review.status.verdict === "partial"
              ? "Partially correct"
              : "Incorrect",
        });
        item.createEl("p", { text: review.status.feedback });
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
      heading.createEl("strong", { text: result.criterion });
      heading.createSpan({
        text: result.outcome === "met"
          ? "Met"
          : result.outcome === "partial"
            ? "Partial"
            : "Missed",
      });
      item.createEl("p", { text: result.feedback });
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
            row.createSpan({ text: `${heading}: ${excerpt}` });
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
      model: this.model,
      reasoningEffort: this.reasoningEffort,
      focusInstructions: this.focusInstructions,
      quantity: this.quantity,
      difficulty: this.difficulty,
      exerciseTypes: enabledExerciseTypes(percentages),
      exerciseTypePercentages: percentages,
      selectedVisualIds: selectedVisualIds(this.source),
    };
  }

  private configurationProblem(): string | null {
    const modelProblem = modelIdProblem(this.model);
    if (modelProblem !== null) return modelProblem;
    if (this.provider === "agy") {
      const reasoningProblem = agyModelReasoningProblem(
        this.model,
        this.reasoningEffort,
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
    if (!provider.reasoningEfforts.includes(this.reasoningEffort)) {
      return `${provider.label} does not support the selected reasoning effort.`;
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
    const provider = this.providers.find((entry) => entry.id === this.provider);
    if (provider?.reasoningEfforts.includes(this.reasoningEffort) === true) return;
    this.reasoningEffort = provider?.reasoningEfforts.includes("medium") === true
      ? "medium"
      : provider?.reasoningEfforts[0] ?? "medium";
  }

  private async buildPreview(
    details: HTMLDetailsElement,
    onStateChanged?: () => void,
  ): Promise<void> {
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
    this.studySubmitted = { answer: chosen.join(","), correct };
    this.render();
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
    this.studySubmitted = { answer: JSON.stringify(answer), correct };
    this.render();
  }

  private gradeOrdering(exercise: EditableDraftExercise): void {
    if (exercise.grading.kind !== "ordering") return;
    const correctOrder = exercise.grading.correctOrder;
    const correct =
      this.orderingState.length === correctOrder.length &&
      this.orderingState.every(
        (id, index) => id === correctOrder[index],
      );
    this.studySubmitted = { answer: this.orderingState.join(","), correct };
    this.render();
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
    this.studySubmitted = {
      answer: inputs.map((input) => input.value).join(" | "),
      correct,
    };
    this.render();
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
    this.studySubmitted = { answer: JSON.stringify(values), correct };
    this.render();
  }

  private moveOrderingItem(from: number, to: number): void {
    if (to < 0 || to >= this.orderingState.length) return;
    const next = [...this.orderingState];
    const removed = next.splice(from, 1)[0];
    if (removed === undefined) return;
    next.splice(to, 0, removed);
    this.orderingState = next;
    this.render();
  }

  private recordAndContinue(answer: StudyAnswerRecord): void {
    this.studyAnswers = [...this.studyAnswers, answer];
    this.studyIndex += 1;
    this.studySubmitted = null;
    this.resetOrderingState();
    this.render();
  }

  private resetOrderingState(): void {
    const exercise = this.studyExercises[this.studyIndex];
    this.orderingState = exercise?.orderingItems?.map((item) => item.id) ?? [];
  }

  private async finishStudy(practiceAgain: boolean): Promise<void> {
    const source = this.source;
    if (source === null || this.studyFinishing) return;
    const session: FinishedStudySession = {
      id: this.studySessionId,
      startedAt: this.studyStartedAt,
      finishedAt: new Date().toISOString(),
      answers: this.studyAnswers,
    };
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
      new Notice(
        practiceAgain
          ? "Session history saved. Starting a new run."
          : "Session history saved.",
      );
      if (practiceAgain) {
        this.startStudy(repeatExercises);
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
    return error instanceof Error && error.message.trim().length > 0
      ? error.message
      : fallback;
  }
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
