import {
  ButtonComponent,
  ItemView,
  Notice,
  Setting,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";

import {
  DEFAULT_MAX_LEARNING_PATH_SETS,
  MAX_LEARNING_PATH_EXERCISES,
  MAX_LEARNING_PATH_SETS,
  MIN_LEARNING_PATH_SETS,
  type LearningBlueprintDraftV1,
  type LearningBlueprintPlanningInputV1,
  type PracticeSetDraftV1,
} from "../learning-path-generation";
import { learningPathSaveRequestHash } from "../learning-path-save";
import type { CliActivityEvent } from "../cli/contracts";
import { formatCliErrorForUi } from "../cli/errors";
import {
  combineGenerationTelemetry,
  formatGenerationCost,
  formatGenerationDuration,
  formatTokenUsage,
  generationTelemetryFromActivity,
  tokenUsageTotal,
} from "../generation-telemetry";
import {
  RECOMMENDED_EXERCISE_TYPE_PERCENTAGES,
  balanceExerciseTypes,
  copyExerciseTypePercentages,
  enabledExerciseTypes,
  rebalanceExerciseTypePercentageWithIntent,
} from "../exercise-distribution";
import { displayDifficulty } from "../difficulty";
import { MAX_FOCUS_INSTRUCTIONS_LENGTH } from "../focus-instructions";
import {
  pdfSourceBudgetProblem,
  pdfSourceBudgetUsage,
  type PdfSourceBudgetLimitsV1,
  type PdfSourceBudgetProblemV1,
  type PdfSourceBudgetUsageV1,
} from "../pdf-source-budget";
import type {
  LearningPathStartingLevelV1,
  AiContextCompletionPolicyV1,
  PracticeBankV4,
  SourceAlignmentLedgerV1,
  SourceAlignmentRecordV1,
  SourceAlignmentStatusV1,
  SourceMaterialClassificationV1,
} from "../model";
import {
  DEFAULT_AI_CONTEXT_COMPLETION_POLICY,
  aiContextCompletionApproved,
  effectiveAiContextCompletionPolicy,
} from "../ai-context-completion";
import { sourceAlignmentBlockers } from "../source-alignment-generation";
import { displayReasoningEffort } from "../reasoning";
import {
  validateOcclusionMasks,
  type DetectedVisual,
} from "../visuals";
import { OcclusionEditor } from "./occlusion-editor";
import { installHoverDescriptions } from "./hover-descriptions";
import { renderCreationModeSwitch as renderSharedCreationModeSwitch } from "./creation-mode-switch";
import { renderDifficultySelector } from "./difficulty-selector";
import { renderLatexMarkup } from "./latex-renderer";
import { applyMarkdownHeadingTheme } from "./theme-bridge";
import {
  approveReadyLearningPathExercises,
  learningPathSetReviewState,
  type LearningPathReviewSetInput,
} from "./review-state";
import {
  renderSourceChoices,
  renderSourceSummaryCard,
  type SourceChoiceMode,
} from "./source-picker";
import { isGifVisual } from "./visual-selection";
import type {
  Difficulty,
  EditableDraftExercise,
  ExerciseType,
  GenerationRecoveryPresentation,
  GenerationConfiguration,
  GifFramePosition,
  ProviderId,
  ProviderPresentation,
  ReasoningEffort,
  SourcePresentation,
} from "./contracts";

export const PRACTICE_LEARNING_PATH_VIEW_TYPE = "practice-learning-path-view";

export interface LearningBlueprintConfigurationV1 {
  readonly provider: ProviderId;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
  readonly startingLevel: LearningPathStartingLevelV1;
  readonly desiredSetCount: number;
  readonly globalFocusInstructions: string;
  readonly aiContextCompletionPolicy?: AiContextCompletionPolicyV1;
}

export interface LearningPayloadPreviewV1 {
  readonly providerLabel: string;
  readonly modelLabel: string;
  readonly reasoningEffortLabel: string;
  readonly text: string;
  readonly visualNames: readonly string[];
  readonly warning?: string;
}

export interface LearningBlueprintPresentationV1 {
  readonly draft: LearningBlueprintDraftV1;
  readonly planningInput: LearningBlueprintPlanningInputV1;
}

/**
 * UI-owned alignment contracts intentionally mirror the controller's public
 * values without importing the controller at runtime. That keeps the view a
 * presentation boundary and avoids a controller -> view -> controller cycle.
 */
export interface LearningSourceAlignmentPreviewV1 {
  readonly providerLabel: string;
  readonly modelLabel: string;
  readonly reasoningEffortLabel: string;
  readonly inputHash: string;
  readonly text: string;
  readonly requiresProvider: boolean;
  readonly warning: string;
}

export interface LearningSourceAlignmentResultV1 {
  readonly ledger: SourceAlignmentLedgerV1;
  readonly blockerRecordIds: readonly string[];
  readonly checked: boolean;
}

export interface RecoveredLearningSourceAlignmentV1 {
  readonly primary: SourcePresentation;
  readonly supporting: readonly SourcePresentation[];
  readonly result: LearningSourceAlignmentResultV1;
}

export type LearningPathRecoveryKindV1 = "source-alignment" | "generation-batch";

export interface LearningSetPayloadPreviewV1 {
  readonly setId: string;
  readonly setTitle: string;
  readonly providerLabel: string;
  readonly modelLabel: string;
  readonly reasoningEffortLabel: string;
  readonly payloadHash: string;
  readonly text: string;
}

export interface GeneratedLearningSetPresentationV1 {
  readonly setId: string;
  readonly draft: PracticeSetDraftV1;
  readonly exercises: readonly EditableDraftExercise[];
  /** Present only when restored from a durable reviewed snapshot. */
  readonly approvedExerciseIds?: readonly string[];
}

export interface LearningSetReviewV1 extends GeneratedLearningSetPresentationV1 {
  readonly approvedExerciseIds: readonly string[];
}

export interface LearningPathSaveRequestV1 {
  readonly primary: SourcePresentation;
  readonly supporting: readonly SourcePresentation[];
  readonly blueprint: LearningBlueprintDraftV1;
  readonly planningInput: LearningBlueprintPlanningInputV1;
  readonly configurations: readonly {
    readonly setId: string;
    readonly configuration: GenerationConfiguration;
  }[];
  readonly sets: readonly LearningSetReviewV1[];
}

export interface LearningPathSavedWorkspaceV1 {
  readonly path: string;
  readonly bank: PracticeBankV4;
  readonly reconciledLinkCount?: number;
  readonly reconciledTutorBlockOrderCount?: number;
  readonly batchComplete?: boolean;
}

export interface LearningPathSavedWorkspaceStudyStateV1 {
  readonly state: "ready" | "resume" | "blocked";
  readonly description: string;
}

export interface LearningPathPreflightResultV1 {
  readonly requestHash: string;
  readonly valid: true;
}

interface SavePreflightStateV1 {
  readonly requestHash: string;
  readonly state: "checking" | "valid" | "invalid";
  readonly message?: string;
}

export interface LearningPathViewCallbacks {
  readonly requestPrimarySource: (
    mode: SourceChoiceMode,
  ) => Promise<SourcePresentation | null>;
  readonly preparePrimarySourceVisuals?: (
    source: SourcePresentation,
  ) => Promise<SourcePresentation>;
  readonly requestSupportingSource: (
    mode: "note" | "pdf",
    pdfBudget: PdfSourceBudgetUsageV1 | null,
  ) => Promise<SourcePresentation | null>;
  readonly updateSourceVisuals?: (
    source: SourcePresentation,
  ) => Promise<SourcePresentation> | SourcePresentation;
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
  readonly confirmSourceClassification?: (
    source: SourcePresentation,
    classification: SourceMaterialClassificationV1,
  ) => Promise<SourcePresentation> | SourcePresentation;
  readonly confirmSourceClassifications?: (
    updates: readonly {
      readonly source: SourcePresentation;
      readonly classification: SourceMaterialClassificationV1;
    }[],
  ) => Promise<readonly SourcePresentation[]> | readonly SourcePresentation[];
  readonly openQuickPractice: (source: SourcePresentation | null) => Promise<void> | void;
  readonly resumeInterruptedQuickGeneration?: () => Promise<void> | void;
  readonly retryInterruptedQuickGeneration?: () => Promise<void> | void;
  readonly discardInterruptedQuickGeneration?: () => Promise<void> | void;
  readonly inspectRecoverableKind?: () => Promise<LearningPathRecoveryKindV1 | null>;
  readonly previewSourceAlignment: (
    primary: SourcePresentation,
    supporting: readonly SourcePresentation[],
    configuration: LearningBlueprintConfigurationV1,
  ) => Promise<LearningSourceAlignmentPreviewV1>;
  readonly generateSourceAlignment: (
    onActivity: (event: CliActivityEvent) => void,
  ) => Promise<LearningSourceAlignmentResultV1>;
  readonly approveSourceAlignment: (
    ledger: SourceAlignmentLedgerV1,
  ) => Promise<LearningSourceAlignmentResultV1> | LearningSourceAlignmentResultV1;
  readonly continueWithoutCourseAlignment: () => (
    Promise<LearningSourceAlignmentResultV1> | LearningSourceAlignmentResultV1
  );
  readonly resumeRecoverableSourceAlignment?: (
    onActivity: (event: CliActivityEvent) => void,
  ) => Promise<RecoveredLearningSourceAlignmentV1>;
  readonly previewBlueprint: (
    primary: SourcePresentation,
    supporting: readonly SourcePresentation[],
    configuration: LearningBlueprintConfigurationV1,
  ) => Promise<LearningPayloadPreviewV1>;
  readonly generateBlueprint: (
    primary: SourcePresentation,
    supporting: readonly SourcePresentation[],
    configuration: LearningBlueprintConfigurationV1,
    onActivity: (event: CliActivityEvent) => void,
  ) => Promise<LearningBlueprintPresentationV1>;
  readonly previewSetPayloads: (
    blueprint: LearningBlueprintPresentationV1,
    configurations: readonly {
      readonly setId: string;
      readonly configuration: GenerationConfiguration;
    }[],
  ) => Promise<readonly LearningSetPayloadPreviewV1[]>;
  readonly generateAllSets: (
    blueprint: LearningBlueprintPresentationV1,
    configurations: readonly {
      readonly setId: string;
      readonly configuration: GenerationConfiguration;
    }[],
    onStatus: (setId: string, status: LearningSetGenerationStatusV1) => void,
    onActivity: (setId: string, event: CliActivityEvent) => void,
  ) => Promise<readonly GeneratedLearningSetPresentationV1[]>;
  readonly cancelGeneration?: () => Promise<void> | void;
  readonly saveLearningPath: (
    request: LearningPathSaveRequestV1,
  ) => Promise<LearningPathSavedWorkspaceV1>;
  readonly preflightLearningPath?: (
    request: LearningPathSaveRequestV1,
  ) => Promise<LearningPathPreflightResultV1>;
  readonly persistReviewSnapshots?: (
    sets: readonly LearningSetReviewV1[],
  ) => Promise<void>;
  readonly saveManagedWorkspace?: (
    workspace: LearningPathSavedWorkspaceV1,
  ) => Promise<LearningPathSavedWorkspaceV1>;
  readonly regenerateSavedSet?: (
    workspace: LearningPathSavedWorkspaceV1,
    setId: string,
  ) => Promise<void> | void;
  readonly useSavedWorkspace?: (
    workspace: LearningPathSavedWorkspaceV1,
    action: "continue" | "choose-set" | "mixed" | "open-bank",
  ) => Promise<void> | void;
  readonly savedWorkspaceStudyState?: (
    workspace: LearningPathSavedWorkspaceV1,
  ) => LearningPathSavedWorkspaceStudyStateV1;
  readonly resumeRecoverableBatch?: (
    onStatus: (setId: string, status: LearningSetGenerationStatusV1) => void,
    onActivity: (setId: string, event: CliActivityEvent) => void,
  ) => Promise<LearningPathRecoveredBatchV1>;
  readonly inspectRecoverableBatch?: () => Promise<LearningPathRecoveredBatchV1>;
  readonly discardRecoverableBatch?: () => Promise<boolean>;
}

export interface LearningPathRecoveredBatchV1 {
  readonly primary: SourcePresentation;
  readonly supporting: readonly SourcePresentation[];
  readonly blueprint: LearningBlueprintPresentationV1;
  readonly configurations: readonly {
    readonly setId: string;
    readonly configuration: GenerationConfiguration;
  }[];
  readonly generated: readonly GeneratedLearningSetPresentationV1[];
  readonly statuses: readonly {
    readonly setId: string;
    readonly status: LearningSetGenerationStatusV1;
  }[];
}

export interface LearningPathViewOptions {
  readonly callbacks: LearningPathViewCallbacks;
  readonly providers: readonly ProviderPresentation[];
  readonly defaults: {
    readonly provider: ProviderId;
    readonly model: string;
    readonly reasoningEffort: ReasoningEffort;
    readonly quantity: number;
    readonly difficulty: Difficulty;
    readonly focusInstructions: string;
    readonly gifFrameDefault?: GifFramePosition;
    readonly pdfMaxPageCount: number;
    readonly pdfMaxExtractedCharacters: number;
  };
  readonly initialSource?: SourcePresentation;
  readonly recoverableBatch?: boolean;
  readonly recoverableKind?: LearningPathRecoveryKindV1 | null;
  readonly quickGenerationRecovery?: GenerationRecoveryPresentation | null;
}

export type LearningSetGenerationStatusV1 =
  | { readonly state: "queued" }
  | { readonly state: "generating"; readonly message?: string }
  | { readonly state: "validating"; readonly message?: string }
  | { readonly state: "review" }
  | { readonly state: "failed"; readonly message: string }
  | { readonly state: "saved" };

interface EditableSetState {
  id: string;
  configuration: GenerationConfiguration;
  advancedOpen: boolean;
  intendedTypes: Set<ExerciseType>;
  rememberedPercentages: Record<ExerciseType, number>;
}

type Stage = "source" | "map" | "review" | "saved";

type StageState = "completed" | "current" | "available" | "needs-update" | "locked";

type CreationPage =
  | "material"
  | "review-material"
  | "learning-goal"
  | "course-check"
  | "path-plan"
  | "generate-sets"
  | "review-exercises"
  | "ready";

interface CreationPageDefinition {
  readonly id: CreationPage;
  readonly label: string;
}

const CREATION_PAGES: readonly CreationPageDefinition[] = [
  { id: "material", label: "Material" },
  { id: "review-material", label: "Review material" },
  { id: "learning-goal", label: "Learning goal" },
  { id: "course-check", label: "Course check" },
  { id: "path-plan", label: "Path plan" },
  { id: "generate-sets", label: "Generate sets" },
  { id: "review-exercises", label: "Review exercises" },
  { id: "ready", label: "Ready" },
];

const EXERCISE_LABELS: Readonly<Record<ExerciseType, string>> = {
  "short-answer": "Short answer",
  "causal-explanation": "Causal explanation",
  application: "Application",
  calculation: "Calculation",
  cloze: "Cloze",
  "single-select": "Single select",
  "multi-select": "Multi select",
  matching: "Matching",
  ordering: "Ordering",
  "image-occlusion": "Image occlusion",
};

const STARTING_LEVELS: ReadonlyArray<{
  readonly id: LearningPathStartingLevelV1;
  readonly label: string;
  readonly description: string;
}> = [
  { id: "new-to-topic", label: "New to this topic", description: "Introduce supported prerequisites and fade guidance gradually." },
  { id: "some-familiarity", label: "Some familiarity", description: "Reconnect the key mechanisms before application." },
  { id: "exam-review", label: "Exam review", description: "Move faster toward independent integration and transfer." },
];

const VISUAL_LABELS: Readonly<Record<DetectedVisual["kind"], string>> = {
  "static-image": "Static image",
  "animated-gif": "Animated GIF",
  video: "Video",
  "remote-image": "Remote image",
  "notability-region": "Notability region",
};

const GIF_FRAME_POSITIONS = ["first", "middle", "last"] as const;

const SOURCE_CLASSIFICATION_LABELS: Readonly<Record<
  SourceMaterialClassificationV1,
  string
>> = {
  "personal-note": "Personal note",
  "official-correction": "Official correction",
  "instructor-material": "Instructor material",
  "assigned-reference": "Assigned reference",
  unclassified: "Unclassified",
};

function displayGifFramePosition(value: GifFramePosition): string {
  if (value === "first") return "First frame";
  if (value === "last") return "Last frame";
  return "Middle frame";
}

function displayVisualName(visual: DetectedVisual): string {
  return visual.sourceTarget
    ?? visual.region?.title
    ?? visual.remoteHost
    ?? visual.id;
}

function sameSourceScope(
  left: SourcePresentation,
  right: SourcePresentation,
): boolean {
  return left.mode === right.mode
    && left.path === right.path
    && left.title === right.title
    && left.detail === right.detail
    && JSON.stringify(left.pdfPageSelection ?? null)
      === JSON.stringify(right.pdfPageSelection ?? null)
    && left.excerpt === right.excerpt;
}

export function replaceLearningPathVisual(
  source: SourcePresentation,
  replacement: DetectedVisual,
): SourcePresentation {
  if (!source.visuals.some((visual) => visual.id === replacement.id)) {
    throw new Error(`Visual ${replacement.id} does not belong to ${source.title}.`);
  }
  return {
    ...source,
    visuals: source.visuals.map((visual) => (
      visual.id === replacement.id ? { ...replacement } : { ...visual }
    )),
  };
}

export function setLearningPathVisualSelection(
  source: SourcePresentation,
  selected: boolean,
): SourcePresentation {
  return {
    ...source,
    visuals: source.visuals.map((visual) => ({
      ...visual,
      selected: visual.state === "ready" ? selected : false,
    })),
  };
}

function editableDraft(exercise: EditableDraftExercise): EditableDraftExercise {
  return {
    ...structuredClone(exercise),
    rejected: exercise.rejected,
    occlusionReviewed: exercise.occlusionReviewed,
  };
}

export class PracticeLearningPathView extends ItemView {
  private stage: Stage = "source";
  private page: CreationPage = "material";
  private primary: SourcePresentation | null;
  private supporting: SourcePresentation[] = [];
  private providers: ProviderPresentation[];
  private blueprintConfiguration: LearningBlueprintConfigurationV1;
  private alignmentPreview: LearningSourceAlignmentPreviewV1 | null = null;
  private alignmentResult: LearningSourceAlignmentResultV1 | null = null;
  private alignmentAccepted = false;
  private aiContextCompletionDecisionMade = false;
  private preview: LearningPayloadPreviewV1 | null = null;
  private previewAccepted = false;
  private blueprint: LearningBlueprintPresentationV1 | null = null;
  private staleBlueprint: LearningBlueprintPresentationV1 | null = null;
  private setStates: EditableSetState[] = [];
  private setPayloadPreviews: readonly LearningSetPayloadPreviewV1[] = [];
  private setPayloadsAccepted = false;
  private statuses = new Map<string, LearningSetGenerationStatusV1>();
  private activity = new Map<string, CliActivityEvent[]>();
  private generatedSets: GeneratedLearningSetPresentationV1[] = [];
  private staleGeneratedSets: GeneratedLearningSetPresentationV1[] = [];
  private approvedBySet = new Map<string, Set<string>>();
  private reviewFeedback: string | null = null;
  private activeReviewSetId: string | null = null;
  private busy: "source" | "alignment-preview" | "alignment" | "alignment-approval" | "preview" | "blueprint" | "payloads" | "batch" | "save" | "recovery" | null = null;
  private primarySourceChoiceBusy: SourceChoiceMode | null = null;
  private supportingSourceChoiceBusy: "note" | "pdf" | null = null;
  private error: string | null = null;
  private saveValidationBlocked = false;
  private savePreflight: SavePreflightStateV1 | null = null;
  private savePreflightSequence = 0;
  private reviewPersistenceTimer: number | undefined;
  private reviewPersistencePending = false;
  private reviewPersistenceChain: Promise<void> = Promise.resolve();
  private recoveryAvailable: boolean;
  private recoveryKind: LearningPathRecoveryKindV1 | "unknown" | null;
  private savedWorkspace: LearningPathSavedWorkspaceV1 | null = null;
  private savedWorkspaceDirty = false;
  private gifFrameDefault: GifFramePosition;
  private visualSelectionBusy = false;
  private visualSelectionMessage: string | null = null;
  private primaryVisualPreparationToken: symbol | null = null;
  private quickGenerationRecovery: GenerationRecoveryPresentation | null;
  private readonly expandedVisualSources = new Set<string>();
  private readonly classificationDrafts = new Map<string, SourceMaterialClassificationV1>();
  private readonly occlusionEditors: OcclusionEditor[] = [];
  private blueprintActivityHost: HTMLElement | null = null;
  private alignmentActivityHost: HTMLElement | null = null;
  private alignmentPreviewHost: HTMLElement | null = null;
  private alignmentResultHost: HTMLElement | null = null;
  private planningPreviewHost: HTMLElement | null = null;
  private batchNavigatorHost: HTMLElement | null = null;
  private batchActivityHost: HTMLElement | null = null;
  private batchCurrentHost: HTMLElement | null = null;
  private setPayloadPreviewHost: HTMLElement | null = null;
  private activeMapSetId: string | null = null;
  private renderedStage: Stage | null = null;
  private readonly stageScrollPositions = new Map<Stage, number>();
  private renderedPage: CreationPage | null = null;
  private readonly pageScrollPositions = new Map<CreationPage, number>();
  private readonly disclosureState = new Map<string, boolean>();
  private readonly staleStages = new Set<Stage>();
  private activityClock: number | undefined;
  private activitySummaryRefreshers: Array<{
    readonly element: HTMLElement;
    readonly refresh: () => void;
  }> = [];

  constructor(
    leaf: WorkspaceLeaf,
    private readonly options: LearningPathViewOptions,
  ) {
    super(leaf);
    this.navigation = false;
    this.primary = options.initialSource ?? null;
    this.recoveryAvailable = options.recoverableBatch === true;
    this.recoveryKind = options.recoverableKind
      ?? (this.recoveryAvailable ? "unknown" : null);
    this.quickGenerationRecovery = options.quickGenerationRecovery ?? null;
    this.providers = [...options.providers];
    this.gifFrameDefault = options.defaults.gifFrameDefault ?? "middle";
    this.blueprintConfiguration = {
      provider: options.defaults.provider,
      model: options.defaults.model,
      reasoningEffort: options.defaults.reasoningEffort,
      startingLevel: "new-to-topic",
      desiredSetCount: Math.min(DEFAULT_MAX_LEARNING_PATH_SETS, 4),
      globalFocusInstructions: options.defaults.focusInstructions,
      aiContextCompletionPolicy: DEFAULT_AI_CONTEXT_COMPLETION_POLICY,
    };
  }

  getViewType(): string {
    return PRACTICE_LEARNING_PATH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Practice creation - guided path";
  }

  getIcon(): string {
    return "route";
  }

  override async onOpen(): Promise<void> {
    installHoverDescriptions(this.contentEl);
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        void this.flushReviewSnapshot().catch(() => undefined);
      }
    });
    this.render();
    void this.refreshRecoveryKind();
  }

  override async onClose(): Promise<void> {
    if (this.reviewPersistenceTimer !== undefined) {
      window.clearTimeout(this.reviewPersistenceTimer);
      this.reviewPersistenceTimer = undefined;
    }
    try {
      await this.flushReviewSnapshot();
    } catch (error) {
      new Notice(`Guided review progress could not be checkpointed: ${errorMessage(error)}`, 8_000);
    }
    this.clearOcclusionEditors();
    this.clearActivityClock();
  }

  public setPrimarySource(source: SourcePresentation): void {
    this.primary = source;
    this.supporting = [];
    this.primaryVisualPreparationToken = null;
    this.visualSelectionBusy = false;
    this.visualSelectionMessage = null;
    this.resetAfterSourceChange();
    this.render();
  }

  public beginPrimaryVisualPreparation(source: SourcePresentation): symbol | null {
    if (this.primary === null || !sameSourceScope(this.primary, source)) return null;
    const token = Symbol("primary-visual-preparation");
    this.primaryVisualPreparationToken = token;
    this.visualSelectionBusy = true;
    this.visualSelectionMessage = null;
    this.render();
    return token;
  }

  public finishPrimaryVisualPreparation(
    token: symbol,
    expected: SourcePresentation,
    prepared?: SourcePresentation,
  ): boolean {
    if (
      this.primaryVisualPreparationToken !== token
      || this.primary === null
      || !sameSourceScope(this.primary, expected)
    ) {
      return false;
    }
    this.primaryVisualPreparationToken = null;
    this.visualSelectionBusy = false;
    if (prepared !== undefined) {
      this.primary = prepared;
      this.invalidatePlanningPreview();
    }
    this.render();
    return true;
  }

  public setProviders(providers: readonly ProviderPresentation[]): void {
    this.providers = [...providers];
    this.render();
  }

  public setRecoveryAvailable(available: boolean): void {
    this.recoveryAvailable = available;
    this.recoveryKind = available ? (this.recoveryKind ?? "unknown") : null;
    this.render();
  }

  public setQuickGenerationRecovery(
    recovery: GenerationRecoveryPresentation | null,
  ): void {
    this.quickGenerationRecovery = recovery;
    this.render();
  }

  public manageSavedWorkspace(
    path: string,
    bank: PracticeBankV4,
  ): void {
    this.primary = null;
    this.supporting = [];
    this.alignmentPreview = null;
    this.alignmentResult = null;
    this.alignmentAccepted = false;
    this.preview = null;
    this.previewAccepted = false;
    this.blueprint = null;
    this.staleBlueprint = null;
    this.setStates = [];
    this.setPayloadPreviews = [];
    this.setPayloadsAccepted = false;
    this.statuses.clear();
    this.activity.clear();
    this.generatedSets = [];
    this.staleGeneratedSets = [];
    this.approvedBySet.clear();
    this.activeMapSetId = null;
    this.activeReviewSetId = null;
    this.reviewFeedback = null;
    this.classificationDrafts.clear();
    this.savedWorkspace = { path, bank: structuredClone(bank) };
    this.savedWorkspaceDirty = false;
    this.stage = "saved";
    this.page = "ready";
    this.staleStages.clear();
    this.error = null;
    this.render();
  }

  public async resumeRecovery(): Promise<void> {
    if (this.busy !== null) return;
    const kind = await this.resolveRecoveryKind();
    if (kind === "source-alignment") {
      await this.resumeSourceAlignmentRecovery();
      return;
    }
    if (this.options.callbacks.resumeRecoverableBatch === undefined) return;
    this.busy = "batch";
    this.error = null;
    this.stage = "map";
    this.page = "generate-sets";
    this.activity.clear();
    this.render();
    try {
      if (this.options.callbacks.inspectRecoverableBatch !== undefined) {
        this.applyRecoveredBatch(await this.options.callbacks.inspectRecoverableBatch());
        this.stage = "map";
        this.page = "generate-sets";
        this.render();
      }
      const result = await this.options.callbacks.resumeRecoverableBatch(
        (setId, status) => {
          this.statuses.set(setId, status);
          this.refreshBatchProgress();
        },
        (setId, event) => {
          this.activity.set(setId, [...(this.activity.get(setId) ?? []), event].slice(-40));
          this.refreshBatchActivity();
        },
      );
      this.applyRecoveredBatch(result);
    } catch (error) {
      this.error = errorMessage(error);
      if (this.blueprint === null) {
        this.stage = "source";
        this.page = "material";
      }
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private render(): void {
    if (this.renderedStage !== null) this.stageScrollPositions.set(this.renderedStage, this.contentEl.scrollTop);
    if (this.renderedPage !== null) this.pageScrollPositions.set(this.renderedPage, this.contentEl.scrollTop);
    this.ensureCurrentPageIsValid();
    const renderedStage = this.stage;
    const renderedPage = this.page;
    const restoreScrollTop = this.pageScrollPositions.get(renderedPage)
      ?? this.stageScrollPositions.get(renderedStage)
      ?? 0;
    this.clearOcclusionEditors();
    this.blueprintActivityHost = null;
    this.alignmentActivityHost = null;
    this.alignmentPreviewHost = null;
    this.alignmentResultHost = null;
    this.planningPreviewHost = null;
    this.batchNavigatorHost = null;
    this.batchActivityHost = null;
    this.batchCurrentHost = null;
    this.setPayloadPreviewHost = null;
    this.activitySummaryRefreshers = [];
    this.contentEl.empty();
    this.contentEl.addClasses(["practice-lab", "practice-learning-path"]);
    applyMarkdownHeadingTheme(this.contentEl);
    const shell = this.contentEl.createDiv({ cls: "practice-learning-path-shell" });
    this.renderHeader(shell);
    if (this.page !== "ready") this.renderCreationModeSwitch(shell);
    this.renderQuickGenerationRecovery(shell);
    this.renderStageNavigation(shell);
    const body = shell.createDiv({ cls: "practice-learning-path-body" });
    if (this.error !== null) {
      const presentation = learningPathErrorPresentation(this.error);
      const error = body.createDiv({ cls: "practice-lab-callout is-error", attr: { role: "alert" } });
      setIcon(error.createSpan(), "circle-alert");
      const copy = error.createDiv({ cls: "practice-generation-error-copy" });
      copy.createEl("strong", { text: "This step did not finish" });
      copy.createEl("p", { text: presentation.summary });
      copy.createEl("p", { cls: "practice-learning-path-error-recovery", text: presentation.recovery });
      if (presentation.details.length > 0) {
        const details = copy.createEl("details", { cls: "practice-learning-path-error-details" });
        details.createEl("summary", { text: `Show ${presentation.details.length} technical validation ${presentation.details.length === 1 ? "detail" : "details"}` });
        const list = details.createEl("ol");
        for (const detail of presentation.details) list.createEl("li", { text: detail });
      }
    }
    if (this.page === "material") this.renderMaterialPage(body);
    else if (this.page === "review-material") this.renderReviewMaterialPage(body);
    else if (this.page === "learning-goal") this.renderLearningGoalPage(body);
    else if (this.page === "course-check") this.renderCourseCheckPage(body);
    else if (this.page === "path-plan") this.renderPathPlanPage(body);
    else if (this.page === "generate-sets") this.renderGenerateSetsPage(body);
    else if (this.page === "review-exercises") this.renderReview(body);
    else this.renderSaved(body);
    this.renderedStage = renderedStage;
    this.renderedPage = renderedPage;
    window.requestAnimationFrame(() => {
      if (this.stage !== renderedStage || this.page !== renderedPage || !this.contentEl.isConnected) return;
      this.contentEl.scrollTop = restoreScrollTop;
    });
  }

  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: "practice-lab-header" });
    const text = header.createDiv();
    text.createEl("h2", { text: this.page === "ready" ? "Your guided path" : "Build a guided path" });
    text.createEl("p", {
      text: this.page === "ready"
        ? "Continue learning, choose a set, or adjust the saved path when you need to."
        : "Build connected tutor lessons and focused practice sets from only the material you approve.",
    });
    const icon = header.createDiv({ cls: "practice-lab-header-icon" });
    setIcon(icon, "route");
  }

  private renderCreationModeSwitch(container: HTMLElement): void {
    const switchBlocked = this.busy !== null
      || this.page === "generate-sets"
      || this.page === "review-exercises";
    renderSharedCreationModeSwitch(container, {
      active: "guided",
      quickDisabled: switchBlocked,
      guidedDisabled: switchBlocked,
      ...(switchBlocked
        ? {
            quickDisabledReason: "Finish the current guided generation or review before changing creation mode.",
          }
        : {}),
      onQuick: () => {
        void this.options.callbacks.openQuickPractice(this.primary);
      },
      onGuided: () => undefined,
    });
  }

  private renderQuickGenerationRecovery(container: HTMLElement): void {
    const recovery = this.quickGenerationRecovery;
    if (recovery === null) return;
    const panel = container.createEl("section", {
      cls: `practice-generation-recovery is-${recovery.state}`,
      attr: { role: "alert", "aria-live": "polite" },
    });
    const copy = panel.createDiv({ cls: "practice-generation-recovery-copy" });
    copy.createEl("strong", { text: "Resolve the saved quick set first" });
    copy.createEl("p", {
      text: `${recovery.message} Guided generation is paused so two AI jobs cannot overwrite each other's recoverable state.`,
    });
    const actions = panel.createDiv({ cls: "practice-generation-recovery-actions" });
    if (
      (recovery.state === "running" || recovery.state === "blocked" || recovery.state === "ready")
      && this.options.callbacks.resumeInterruptedQuickGeneration !== undefined
    ) {
      new ButtonComponent(actions)
        .setIcon("history")
        .setButtonText(recovery.state === "ready" ? "Open recovered Quick set" : "Resume / inspect Quick set")
        .onClick(() => void this.options.callbacks.resumeInterruptedQuickGeneration?.());
    }
    if (
      recovery.state === "failed"
      && this.options.callbacks.retryInterruptedQuickGeneration !== undefined
    ) {
      new ButtonComponent(actions)
        .setIcon("refresh-cw")
        .setButtonText("Retry approved quick set")
        .setCta()
        .onClick(() => void this.options.callbacks.retryInterruptedQuickGeneration?.());
    }
    if (this.options.callbacks.discardInterruptedQuickGeneration !== undefined) {
      new ButtonComponent(actions)
        .setIcon("trash-2")
        .setButtonText("Discard recovery...")
        .setDestructive()
        .onClick(() => void this.options.callbacks.discardInterruptedQuickGeneration?.());
    }
  }

  private renderStageNavigation(container: HTMLElement): void {
    const pages = this.creationPages();
    const currentIndex = Math.max(0, pages.findIndex(({ id }) => id === this.page));
    const current = pages[currentIndex] ?? pages[0];
    if (current === undefined) return;
    const locator = container.createEl("nav", {
      cls: "practice-learning-path-page-locator",
      attr: { "aria-label": "Guided-path creation progress" },
    });
    const previous = pages[currentIndex - 1];
    if (previous !== undefined) {
      new ButtonComponent(locator)
        .setClass("practice-learning-path-page-back")
        .setIcon("arrow-left")
        .setButtonText("Back")
        .setDisabled(this.busy !== null)
        .setTooltip(`Return to ${previous.label} without discarding approved work.`)
        .onClick(() => this.navigateToPage(previous.id));
    }
    const identity = locator.createDiv({ cls: "practice-learning-path-page-current" });
    identity.createSpan({ cls: "practice-lab-badge", text: "Guided path" });
    identity.createSpan({
      cls: "practice-learning-path-page-count",
      text: `Step ${currentIndex + 1} of ${pages.length}`,
    });
    identity.createEl("strong", { text: current.label });
    identity.createSpan({ text: this.stageStateLabel(this.pageState(current.id)) });
    const details = locator.createEl("details", {
      cls: "practice-learning-path-page-details",
    });
    this.bindDisclosure(details, "creation-page-details", false);
    details.createEl("summary", { text: "Path details" });
    const list = details.createEl("ol");
    for (const [index, definition] of pages.entries()) {
      const state = this.pageState(definition.id);
      const item = list.createEl("li", { cls: `is-${state}` });
      const button = item.createEl("button", {
        attr: {
          type: "button",
          ...(definition.id === this.page ? { "aria-current": "step" } : {}),
        },
      });
      button.createSpan({ text: String(index + 1) });
      button.createSpan({ text: definition.label });
      button.createSpan({ text: this.stageStateLabel(state) });
      const available = this.pageAvailable(definition.id) && this.busy === null;
      button.disabled = definition.id === this.page || !available || this.busy !== null;
      button.title = available
        ? `Open ${definition.label}`
        : this.pageUnavailableReason(definition.id, definition.label);
      button.addEventListener("click", () => this.navigateToPage(definition.id));
    }
  }

  private creationPages(): readonly CreationPageDefinition[] {
    return CREATION_PAGES.filter(({ id }) => id !== "course-check" || this.shouldShowCourseCheck());
  }

  private shouldShowCourseCheck(): boolean {
    return this.approvedSources().some((source) => (
      source.classificationState === "confirmed"
      && source.classification !== undefined
      && source.classification !== "personal-note"
      && source.classification !== "unclassified"
    ));
  }

  private ensureCurrentPageIsValid(): void {
    if (this.page === "course-check" && !this.shouldShowCourseCheck()) {
      this.page = this.alignmentAccepted ? "path-plan" : "learning-goal";
    }
    if (this.savedWorkspace !== null && this.stage === "saved") this.page = "ready";
  }

  private pageAvailable(page: CreationPage): boolean {
    if (page === "material") return true;
    if (page === "review-material") return this.primary !== null;
    if (page === "learning-goal") return this.primary !== null && this.reviewMaterialProblem() === null;
    if (page === "course-check") return this.shouldShowCourseCheck() && this.reviewMaterialProblem() === null;
    if (page === "path-plan") return this.alignmentAccepted || this.preview !== null || this.blueprint !== null;
    if (page === "generate-sets") return this.blueprint !== null;
    if (page === "review-exercises") {
      return this.blueprint !== null && this.generatedSets.length > 0;
    }
    return this.savedWorkspace !== null;
  }

  private pageCompleted(page: CreationPage): boolean {
    if (page === "material") return this.primary !== null;
    if (page === "review-material") return this.reviewMaterialProblem() === null;
    if (page === "learning-goal") return this.alignmentPreview !== null || this.alignmentAccepted;
    if (page === "course-check") return this.alignmentAccepted;
    if (page === "path-plan") return this.blueprint !== null && this.mapProblem() === null;
    if (page === "generate-sets") {
      return this.setStates.length > 0 && this.generatedSets.length === this.setStates.length;
    }
    if (page === "review-exercises") return this.savedWorkspace !== null;
    return this.savedWorkspace !== null;
  }

  private pageStale(page: CreationPage): boolean {
    if (page === "path-plan") return this.staleStages.has("map");
    if (page === "generate-sets" || page === "review-exercises") {
      return this.staleStages.has("review");
    }
    return page === "ready" && this.staleStages.has("saved");
  }

  private pageState(page: CreationPage): StageState {
    if (page === this.page) return "current";
    if (this.busy !== null) return "locked";
    if (this.pageStale(page)) return "needs-update";
    if (this.pageCompleted(page)) return "completed";
    return this.pageAvailable(page) ? "available" : "locked";
  }

  private navigateToPage(page: CreationPage): void {
    if (this.busy !== null || page === this.page || !this.pageAvailable(page)) return;
    this.page = page;
    this.stage = this.stageForPage(page);
    this.error = null;
    this.render();
  }

  private stageForPage(page: CreationPage): Stage {
    if (page === "ready") return "saved";
    if (page === "review-exercises") return "review";
    if (page === "generate-sets" || (page === "path-plan" && this.blueprint !== null)) return "map";
    return "source";
  }

  private pageUnavailableReason(page: CreationPage, label: string): string {
    if (this.busy !== null) return `Wait for the current operation before opening ${label}.`;
    if (page === "review-material") return "Choose the primary material first.";
    if (page === "learning-goal") return this.reviewMaterialProblem() ?? "Review the approved material first.";
    if (page === "course-check") return "Confirm a school-authority source before checking course alignment.";
    if (page === "path-plan") return "Approve the source alignment before building the path.";
    if (page === "generate-sets") return "Build and approve the editable path first.";
    if (page === "review-exercises") return "Generate at least one set before reviewing exercises.";
    if (page === "ready") return "Save the complete reviewed path first.";
    return `Open ${label}`;
  }

  private reviewMaterialProblem(): string | null {
    if (this.primary === null) return "Choose primary material before continuing.";
    const unconfirmed = this.approvedSources().filter((source) => (
      source.classificationState !== "confirmed"
    )).length;
    if (unconfirmed > 0) {
      return `Confirm ${unconfirmed} source ${unconfirmed === 1 ? "label" : "labels"} before continuing.`;
    }
    if (this.primaryVisualPreparationToken !== null || this.visualSelectionBusy) {
      return "Wait for image preparation to finish before continuing.";
    }
    return this.pdfBudgetProblem()?.message ?? null;
  }

  private stageAvailable(stage: Stage): boolean {
    if (stage === "source") return true;
    const recoveryCanRestore = this.recoveryAvailable
      && this.options.callbacks.inspectRecoverableBatch !== undefined;
    if (stage === "map") return this.blueprint !== null || recoveryCanRestore;
    if (stage === "review") {
      return this.statuses.size > 0 || this.generatedSets.length > 0 || recoveryCanRestore;
    }
    return this.savedWorkspace !== null;
  }

  private async navigateToStage(stage: Stage): Promise<void> {
    if (this.busy !== null || stage === this.stage) return;
    const hasLocalState = stage === "source"
      || (stage === "map" && this.blueprint !== null)
      || (stage === "review" && (this.statuses.size > 0 || this.generatedSets.length > 0))
      || (stage === "saved" && this.savedWorkspace !== null);
    if (hasLocalState) {
      this.stage = stage;
      this.error = null;
      this.render();
      return;
    }
    if (
      (stage === "map" || stage === "review")
      && this.recoveryAvailable
      && this.options.callbacks.inspectRecoverableBatch !== undefined
    ) {
      await this.restoreRecoverableWorkspace(stage);
    }
  }

  private async restoreRecoverableWorkspace(stage: "map" | "review"): Promise<void> {
    const inspect = this.options.callbacks.inspectRecoverableBatch;
    if (inspect === undefined || this.busy !== null) return;
    this.busy = "alignment";
    this.error = null;
    this.render();
    try {
      this.applyRecoveredBatch(await inspect());
      this.stage = stage;
    } catch (error) {
      this.error = `The saved guided-path workspace could not be restored. ${errorMessage(error)}`;
      this.stage = "source";
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private async resumeSourceAlignmentRecovery(): Promise<void> {
    const resume = this.options.callbacks.resumeRecoverableSourceAlignment;
    if (resume === undefined || this.busy !== null) return;
    this.busy = "recovery";
    this.error = null;
    this.activity.clear();
    this.render();
    try {
      const recovered = await resume((event) => {
        this.activity.set("source-alignment", [
          ...(this.activity.get("source-alignment") ?? []),
          event,
        ].slice(-40));
        this.refreshAlignmentActivity();
      });
      this.primary = recovered.primary;
      this.supporting = [...recovered.supporting];
      this.alignmentPreview = null;
      this.alignmentResult = recovered.result;
      this.alignmentAccepted = false;
      this.aiContextCompletionDecisionMade = false;
      this.blueprintConfiguration = {
        ...this.blueprintConfiguration,
        aiContextCompletionPolicy: DEFAULT_AI_CONTEXT_COMPLETION_POLICY,
      };
      this.stage = "source";
      this.page = "course-check";
      this.recoveryAvailable = false;
      this.recoveryKind = null;
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = null;
      this.render();
      if (this.alignmentResult !== null) this.revealAlignmentResult();
    }
  }

  private applyRecoveredBatch(result: LearningPathRecoveredBatchV1): void {
    const existingStates = new Map(this.setStates.map((state) => [state.id, state]));
    const existingGenerated = new Map(this.generatedSets.map((set) => [set.setId, set]));
    const existingApprovals = this.approvedBySet;
    this.primary = result.primary;
    this.supporting = [...result.supporting];
    this.blueprint = result.blueprint;
    this.blueprintConfiguration = {
      ...this.blueprintConfiguration,
      aiContextCompletionPolicy: effectiveAiContextCompletionPolicy(
        result.blueprint.planningInput.aiContextCompletionPolicy,
      ),
    };
    this.aiContextCompletionDecisionMade = true;
    const recoveredAlignment = result.blueprint.planningInput.sourceAlignment;
    if (recoveredAlignment !== undefined) {
      this.alignmentResult = {
        ledger: structuredClone(recoveredAlignment),
        blockerRecordIds: sourceAlignmentBlockers(recoveredAlignment).map((record) => record.id),
        checked: recoveredAlignment.provenance !== null,
      };
      this.alignmentAccepted = this.alignmentResult.blockerRecordIds.length === 0;
    }
    this.setStates = result.blueprint.draft.sets.flatMap((brief) => {
      const current = existingStates.get(brief.id);
      if (current !== undefined) return [current];
      const entry = result.configurations.find((candidate) => candidate.setId === brief.id);
      return entry === undefined ? [] : [this.editableSetState(brief.id, entry.configuration, false)];
    });
    this.generatedSets = result.generated.map((set) => existingGenerated.get(set.setId) ?? ({
      ...set,
      exercises: set.exercises.map(editableDraft),
    }));
    this.approvedBySet = new Map(result.generated.map((set) => [
      set.setId,
      set.approvedExerciseIds === undefined
        ? (existingApprovals.get(set.setId) ?? new Set<string>())
        : new Set(set.approvedExerciseIds),
    ]));
    this.statuses = new Map(result.statuses.map((entry) => [entry.setId, entry.status]));
    this.activeMapSetId = this.setStates.some((state) => state.id === this.activeMapSetId)
      ? this.activeMapSetId
      : (this.setStates[0]?.id ?? null);
    this.activeReviewSetId = this.generatedSets.some((set) => set.setId === this.activeReviewSetId)
      ? this.activeReviewSetId
      : (this.generatedSets[0]?.setId ?? null);
    this.recoveryAvailable = true;
    this.staleStages.delete("map");
    this.staleStages.delete("review");
    this.saveValidationBlocked = false;
    this.savePreflight = null;
    if (this.reviewProblem() === null) void this.runSavePreflight();
  }

  private stageUnavailableReason(stage: Stage, label: string): string {
    if (this.busy !== null) return `Wait for the current operation before opening ${label}.`;
    if (stage === "map") return "Create the aspect map to unlock this step.";
    if (stage === "review") return "Start set generation to unlock this step.";
    if (stage === "saved") return "Save the guided path to unlock this step.";
    return `Open ${label}`;
  }

  private stageStateLabel(state: StageState): string {
    if (state === "completed") return "Completed";
    if (state === "current") return "Current";
    if (state === "available") return "Available";
    if (state === "needs-update") return "Needs update";
    return this.busy === null ? "Not ready" : "Locked while generating";
  }

  private renderMaterialPage(container: HTMLElement): void {
    this.renderGuidedRecoveryPrompt(container);
    const section = this.section(
      container,
      "Material",
      "Choose only the notes or PDF page ranges this path may use. Nothing is crawled automatically.",
    );
    if (this.primary === null) {
      section.createEl("h4", { text: "Choose primary material" });
      this.renderSourceChoiceButtons(section);
      const empty = section.createDiv({ cls: "practice-source-empty-inline" });
      setIcon(empty.createSpan(), "file-search");
      empty.createSpan({ text: "Open a note or PDF, then choose the material to use." });
      return;
    }

    const sources = this.approvedSources();
    const bundle = section.createDiv({ cls: "practice-learning-path-bundle-summary" });
    const copy = bundle.createDiv();
    copy.createEl("strong", { text: this.primary.title });
    copy.createSpan({
      text: `${this.supporting.length} supporting ${this.supporting.length === 1 ? "source" : "sources"} · ${sources.reduce((total, source) => total + source.characterCount, 0).toLocaleString()} submitted characters`,
    });
    const pdfCount = sources.filter((source) => source.mode === "pdf").length;
    bundle.createSpan({
      cls: "practice-lab-badge",
      text: pdfCount === 0 ? "Notes and selection" : `${pdfCount} PDF ${pdfCount === 1 ? "range" : "ranges"}`,
    });

    this.renderSourceCard(section, this.primary, "Primary", () => {
      this.primary = null;
      this.supporting = [];
      this.primaryVisualPreparationToken = null;
      this.visualSelectionBusy = false;
      this.resetAfterSourceChange();
      this.render();
    }, false, () => void this.choosePrimarySource("vault-note"));
    for (const source of this.supporting) {
      this.renderSourceCard(section, source, "Supporting", () => {
        this.supporting = this.supporting.filter((candidate) => candidate !== source);
        this.resetAfterSourceChange();
        this.render();
      }, false);
    }

    const budgetProblem = this.pdfBudgetProblem();
    const editor = this.disclosure(
      section,
      "material-change",
      "Change source bundle",
      "Replace the primary material or add supporting material",
      budgetProblem !== null,
      "Change…",
    );
    editor.createEl("p", {
      cls: "practice-lab-muted",
      text: "Changing the primary material replaces the bundle. Supporting sources are added separately.",
    });
    this.renderSourceChoiceButtons(editor);
    const pdfBudget = this.pdfBudgetUsage();
    if (pdfCount > 0 || budgetProblem !== null) this.renderPdfBudget(editor, pdfBudget, budgetProblem);
    const supportActions = editor.createDiv({ cls: "practice-learning-path-support-actions" });
    new ButtonComponent(supportActions)
      .setIcon("file-text")
      .setButtonText(this.supportingSourceChoiceBusy === "note" ? "Choosing note…" : "Add supporting note")
      .setDisabled(this.busy !== null || this.supporting.length >= 4)
      .setTooltip("Add one explicitly chosen Markdown note.")
      .onClick(() => void this.addSupportingSource("note"));
    new ButtonComponent(supportActions)
      .setIcon("file-scan")
      .setButtonText(this.supportingSourceChoiceBusy === "pdf" ? "Choosing PDF pages…" : "Add supporting PDF pages")
      .setDisabled(
        this.busy !== null
        || this.supporting.length >= 4
        || pdfBudget === null
        || pdfBudget.remainingPages < 1
        || pdfBudget.remainingCharacters < 1
      )
      .setTooltip(budgetProblem?.message ?? "Choose one PDF and its exact page range.")
      .onClick(() => void this.addSupportingSource("pdf"));

    const actions = container.createDiv({ cls: "practice-learning-path-actions is-sticky" });
    new ButtonComponent(actions)
      .setIcon("arrow-right")
      .setButtonText("Continue to review material")
      .setCta()
      .setDisabled(this.busy !== null || budgetProblem !== null)
      .setTooltip(budgetProblem?.message ?? "Review source labels and selected images.")
      .onClick(() => this.navigateToPage("review-material"));
  }

  private renderReviewMaterialPage(container: HTMLElement): void {
    const sources = this.approvedSources();
    const visualCount = sources.reduce((total, source) => total + source.visuals.length, 0);
    const selectedVisualCount = sources.reduce(
      (total, source) => total + source.visuals.filter((visual) => visual.selected).length,
      0,
    );
    const section = this.section(
      container,
      "Review material",
      "Confirm what each source represents, then review detected images only when useful.",
    );
    const summary = section.createDiv({ cls: "practice-learning-path-bundle-summary" });
    summary.createEl("strong", { text: `${sources.length} approved ${sources.length === 1 ? "source" : "sources"}` });
    summary.createSpan({ text: this.sourceClassificationSummary(sources) });
    summary.createSpan({
      cls: "practice-lab-badge",
      text: visualCount === 0 ? "No separate images" : `${selectedVisualCount}/${visualCount} images selected`,
    });

    this.renderBatchSourceClassifications(section, sources);
    if (visualCount > 0 || this.primaryVisualPreparationToken !== null) {
      const imageBody = this.disclosure(
        section,
        "review-material-images",
        "Review images",
        this.primaryVisualPreparationToken !== null
          ? "Preparing default GIF frames…"
          : `${selectedVisualCount} of ${visualCount} selected`,
        this.visualSelectionMessage !== null,
        "Review images…",
      );
      this.renderVisualBundleControls(imageBody);
      for (const source of sources) {
        if (source.visuals.length === 0) continue;
        const sourceVisuals = imageBody.createDiv({ cls: "practice-source-primary-visuals" });
        this.renderSourceVisuals(sourceVisuals, source);
      }
    }

    const problem = this.reviewMaterialProblem();
    if (problem !== null) {
      const warning = section.createDiv({ cls: "practice-lab-callout is-warning", attr: { role: "status" } });
      setIcon(warning.createSpan(), "triangle-alert");
      warning.createSpan({ text: problem });
    }
    const actions = container.createDiv({ cls: "practice-learning-path-actions is-sticky" });
    new ButtonComponent(actions)
      .setIcon("arrow-right")
      .setButtonText("Continue to learning goal")
      .setCta()
      .setDisabled(problem !== null || this.busy !== null)
      .setTooltip(problem ?? "Choose the teaching depth and path focus.")
      .onClick(() => this.navigateToPage("learning-goal"));
  }

  private renderLearningGoalPage(container: HTMLElement): void {
    const section = this.section(
      container,
      "Learning goal",
      "Choose where teaching begins and what the path should emphasize.",
    );
    const levelGrid = section.createDiv({ cls: "practice-learning-path-level-grid" });
    for (const option of STARTING_LEVELS) {
      const label = levelGrid.createEl("label", {
        cls: `practice-learning-path-level${this.blueprintConfiguration.startingLevel === option.id ? " is-selected" : ""}`,
      });
      const input = label.createEl("input", {
        attr: { type: "radio", name: "learning-starting-level", value: option.id },
      });
      input.checked = this.blueprintConfiguration.startingLevel === option.id;
      label.createEl("strong", { text: option.label });
      label.createSpan({ text: option.description });
      input.addEventListener("change", () => {
        if (!input.checked) return;
        this.blueprintConfiguration = { ...this.blueprintConfiguration, startingLevel: option.id };
        this.invalidatePlanningPreview();
        this.render();
      });
    }
    new Setting(section)
      .setName("Proposed set count")
      .setDesc(`The planner may reduce this when the source cannot support distinct sets. Maximum ${MAX_LEARNING_PATH_SETS}.`)
      .addSlider((slider) => slider
        .setLimits(MIN_LEARNING_PATH_SETS, MAX_LEARNING_PATH_SETS, 1)
        .setValue(this.blueprintConfiguration.desiredSetCount)
        .onChange((value) => {
          this.blueprintConfiguration = { ...this.blueprintConfiguration, desiredSetCount: value };
          this.invalidatePlanningPreview();
        }));
    const focus = section.createEl("label", { cls: "practice-learning-path-focus" });
    focus.createEl("strong", { text: "Comments for the planner" });
    focus.createSpan({ text: "For example: focus on mechanisms first, compare architectures, or keep calculations for the last set." });
    const textarea = focus.createEl("textarea", {
      attr: { rows: "4", maxlength: String(MAX_FOCUS_INSTRUCTIONS_LENGTH) },
    });
    textarea.value = this.blueprintConfiguration.globalFocusInstructions;
    textarea.addEventListener("input", () => {
      this.blueprintConfiguration = { ...this.blueprintConfiguration, globalFocusInstructions: textarea.value };
      this.invalidatePlanningPreview();
    });
    const selectedProvider = this.providers.find((entry) => entry.id === this.blueprintConfiguration.provider);
    const engine = this.disclosure(
      section,
      "learning-goal-engine",
      "Generation engine",
      this.providerSummary(),
      selectedProvider?.available === false,
      "Change…",
    );
    this.renderProviderControls(engine);

    if (!this.shouldShowCourseCheck()) {
      const suggestion = section.createDiv({
        cls: "practice-lab-callout practice-learning-path-context-suggestion",
      });
      const heading = suggestion.createDiv({
        cls: "practice-learning-path-context-suggestion-heading",
      });
      setIcon(heading.createSpan(), "sparkles");
      heading.createEl("strong", {
        text: "Additional context could strengthen this practice",
      });
      if (!this.aiContextCompletionDecisionMade) {
        suggestion.createEl("p", {
          text: "Your selected material remains the basis. Choose once whether the generated path may use a small amount of clearly labelled AI-supported context. Your notes will not be changed.",
        });
        const contextActions = suggestion.createDiv({
          cls: "practice-learning-path-actions",
        });
        new ButtonComponent(contextActions)
          .setIcon("sparkles")
          .setButtonText("Add supporting context")
          .setCta()
          .setTooltip("Allow minimum AI-supported context in this practice path. It remains not course-checked and never edits your notes.")
          .onClick(() => this.chooseAiContextCompletion("approved-general-context"));
        new ButtonComponent(contextActions)
          .setIcon("file-check-2")
          .setButtonText("Continue with selected material only")
          .setTooltip("Keep generation limited to the material you selected.")
          .onClick(() => this.chooseAiContextCompletion("selected-sources-only"));
        return;
      }
      const selected = suggestion.createDiv({
        cls: "practice-learning-path-approved-state",
      });
      setIcon(selected.createSpan(), "check-circle-2");
      selected.createSpan({
        text: aiContextCompletionApproved(
          this.blueprintConfiguration.aiContextCompletionPolicy,
        )
          ? "AI-supported context approved · not course-checked"
          : "Using selected material only",
      });
      new ButtonComponent(suggestion)
        .setButtonText("Change…")
        .setTooltip("Review the supporting-context choice before building the path.")
        .onClick(() => {
          this.aiContextCompletionDecisionMade = false;
          this.invalidatePlanningPreview();
          this.render();
        });
    }

    const actions = container.createDiv({ cls: "practice-learning-path-actions is-sticky" });
    const nextLabel = this.shouldShowCourseCheck()
      ? "Continue to course check"
      : "Continue to path plan";
    new ButtonComponent(actions)
      .setIcon("arrow-right")
      .setButtonText(this.busy === "alignment-preview" ? "Preparing source check…" : nextLabel)
      .setCta()
      .setDisabled(this.busy !== null || selectedProvider?.available === false)
      .setTooltip("Prepare the exact classified-source boundary before planning.")
      .onClick(() => void this.continueFromLearningGoal());
  }

  private renderCourseCheckPage(container: HTMLElement): void {
    const section = this.section(
      container,
      "Course check",
      "Compare confirmed personal notes with the approved school material before planning.",
    );
    const sources = this.approvedSources();
    const summary = section.createDiv({ cls: "practice-learning-path-map-summary" });
    summary.createSpan({ text: this.sourceClassificationSummary(sources) });
    summary.createSpan({ text: this.providerSummary() });
    if (this.alignmentPreview === null && this.alignmentResult === null) {
      const actions = section.createDiv({ cls: "practice-learning-path-actions" });
      new ButtonComponent(actions)
        .setIcon("scan-eye")
        .setButtonText(this.busy === "alignment-preview" ? "Preparing course check…" : "Prepare course check")
        .setCta()
        .setDisabled(this.busy !== null)
        .onClick(() => void this.previewSourceAlignment());
      return;
    }
    this.renderSourceAlignment(container, 0);
    if (this.alignmentAccepted) {
      const actions = container.createDiv({ cls: "practice-learning-path-actions is-sticky" });
      new ButtonComponent(actions)
        .setIcon("arrow-right")
        .setButtonText(this.busy === "preview" ? "Preparing path plan…" : "Continue to path plan")
        .setCta()
        .setDisabled(this.busy !== null)
        .onClick(() => void this.openPathPlan());
    }
  }

  private renderPathPlanPage(container: HTMLElement): void {
    if (!this.alignmentAccepted) {
      const warning = container.createDiv({ cls: "practice-lab-callout is-warning" });
      setIcon(warning.createSpan(), "triangle-alert");
      warning.createSpan({ text: "Approve the source check before building the path." });
      return;
    }
    if (this.staleStages.has("map") && this.staleBlueprint !== null) {
      this.renderStalePathPlan(container, this.staleBlueprint);
      return;
    }
    if (this.preview === null && this.blueprint === null) {
      const section = this.section(container, "Path plan", "Prepare the exact planning request from the approved material and learning goal.");
      new ButtonComponent(section)
        .setIcon("scan-eye")
        .setButtonText(this.busy === "preview" ? "Preparing planning request…" : "Prepare path plan")
        .setCta()
        .setDisabled(this.busy !== null)
        .onClick(() => void this.previewPlanningPayload());
      return;
    }
    if (this.blueprint === null) {
      this.renderPlanningPreview(container);
      return;
    }
    this.renderMap(container, false);
    const problem = this.mapProblem();
    const actions = container.createDiv({ cls: "practice-learning-path-actions is-sticky" });
    new ButtonComponent(actions)
      .setIcon("arrow-right")
      .setButtonText(this.busy === "payloads" ? "Preparing set requests…" : "Continue to generate sets")
      .setCta()
      .setDisabled(problem !== null || this.busy !== null)
      .setTooltip(problem ?? "Prepare the exact payload for every approved set.")
      .onClick(() => void this.openGenerateSets());
  }

  private renderGenerateSetsPage(container: HTMLElement): void {
    const blueprint = this.blueprint;
    if (blueprint === null) {
      const warning = container.createDiv({ cls: "practice-lab-callout is-warning" });
      setIcon(warning.createSpan(), "triangle-alert");
      warning.createSpan({ text: "Build the editable path before generating its sets." });
      return;
    }
    const section = this.section(
      container,
      "Generate sets",
      "Approve the complete batch once, then the sets run sequentially through one recoverable job coordinator.",
    );
    const summary = section.createDiv({ cls: "practice-learning-path-map-summary" });
    summary.createSpan({ text: `${this.setStates.length} sets` });
    summary.createSpan({ text: `${this.totalExercises()} questions` });
    summary.createSpan({ text: `${this.setStates.filter((state) => this.statuses.get(state.id)?.state === "review").length} complete` });
    if (this.setPayloadPreviews.length === 0 && this.busy !== "batch") {
      new ButtonComponent(section)
        .setIcon("scan-eye")
        .setButtonText(this.busy === "payloads" ? "Preparing exact set requests…" : "Prepare exact set requests")
        .setCta()
        .setDisabled(this.busy !== null)
        .onClick(() => void this.previewSetPayloads());
    } else if (this.setPayloadPreviews.length > 0 && this.statuses.size === 0) {
      this.renderSetPayloadPreviews(container);
    }
    if (this.statuses.size > 0 || this.busy === "batch" || this.recoveryAvailable) {
      this.renderGenerationStatus(container, blueprint);
    }
    if (this.generatedSets.length === 0 && this.staleGeneratedSets.length > 0) {
      this.renderStaleGeneratedSets(container);
    }
    if (
      this.busy === null
      && this.generatedSets.length === this.setStates.length
      && this.generatedSets.length > 0
    ) {
      const actions = container.createDiv({ cls: "practice-learning-path-actions is-sticky" });
      new ButtonComponent(actions)
        .setIcon("arrow-right")
        .setButtonText("Review exercises")
        .setCta()
        .onClick(() => this.navigateToPage("review-exercises"));
    }
  }

  private renderStalePathPlan(
    container: HTMLElement,
    blueprint: LearningBlueprintPresentationV1,
  ): void {
    const section = this.section(
      container,
      "Path plan needs an update",
      "An earlier approved plan is retained below for reference. It cannot generate or save sets until it is refreshed from the current material and learning goal.",
    );
    const retained = section.createDiv({
      cls: "practice-learning-path-stale-preview",
      attr: { "aria-label": "Previous path plan, read only" },
    });
    retained.setAttribute("inert", "");
    const list = retained.createEl("ol");
    for (const set of [...blueprint.draft.sets].sort((left, right) => left.order - right.order)) {
      const item = list.createEl("li");
      item.createEl("strong", { text: set.title });
      item.createEl("p", { text: set.purpose });
    }
    const actions = section.createDiv({ cls: "practice-learning-path-actions" });
    new ButtonComponent(actions)
      .setIcon("refresh-cw")
      .setButtonText(this.busy === "preview" ? "Refreshing path plan…" : "Refresh path plan")
      .setCta()
      .setDisabled(this.busy !== null)
      .setTooltip("Rebuild the exact planning request from the current approved inputs.")
      .onClick(() => void this.refreshStalePathPlan());
  }

  private renderStaleGeneratedSets(container: HTMLElement): void {
    const details = container.createEl("details", {
      cls: "practice-learning-path-stale-preview",
    });
    details.createEl("summary", {
      text: `${this.staleGeneratedSets.length} previous generated ${this.staleGeneratedSets.length === 1 ? "set" : "sets"} retained for reference`,
    });
    details.createEl("p", {
      text: "These drafts belong to an earlier configuration. They are read-only and cannot be reviewed or saved until the current set requests are regenerated.",
    });
    const list = details.createEl("ul");
    for (const set of this.staleGeneratedSets) {
      const title = this.staleBlueprint?.draft.sets.find((brief) => brief.id === set.setId)?.title
        ?? this.blueprint?.draft.sets.find((brief) => brief.id === set.setId)?.title
        ?? set.setId;
      list.createEl("li", {
        text: `${title} · ${set.exercises.length} ${set.exercises.length === 1 ? "exercise" : "exercises"}`,
      });
    }
  }

  private async refreshStalePathPlan(): Promise<void> {
    if (this.busy !== null || !this.alignmentAccepted) return;
    this.blueprint = null;
    this.setStates = [];
    this.setPayloadPreviews = [];
    this.setPayloadsAccepted = false;
    this.statuses.clear();
    this.activity.clear();
    this.generatedSets = [];
    this.approvedBySet.clear();
    this.preview = null;
    this.previewAccepted = false;
    this.staleStages.delete("map");
    await this.previewPlanningPayload();
  }

  private renderGuidedRecoveryPrompt(container: HTMLElement): void {
    if (
      !this.recoveryAvailable
      || (
        this.options.callbacks.resumeRecoverableBatch === undefined
        && this.options.callbacks.resumeRecoverableSourceAlignment === undefined
      )
    ) return;
    const recovery = container.createDiv({
      cls: "practice-lab-callout is-warning practice-learning-path-recovery",
    });
    const copy = recovery.createDiv();
    copy.createEl("strong", { text: "Unfinished guided work is available" });
    copy.createEl("p", {
      text: this.recoveryKind === "source-alignment"
        ? "Resume the exact approved source comparison."
        : "Continue the exact approved batch from its next unfinished set.",
    });
    const actions = recovery.createDiv({ cls: "practice-learning-path-actions" });
    new ButtonComponent(actions)
      .setIcon("history")
      .setButtonText("Resume guided work")
      .setCta()
      .setDisabled(this.busy !== null)
      .onClick(() => void this.resumeRecovery());
    if (this.options.callbacks.discardRecoverableBatch !== undefined) {
      new ButtonComponent(actions)
        .setIcon("trash-2")
        .setButtonText("Discard recovery…")
        .setDestructive()
        .setDisabled(this.busy !== null)
        .onClick(() => void this.discardRecovery());
    }
  }

  private sourceDraftKey(source: SourcePresentation): string {
    return `${source.mode}:${source.path}:${source.detail ?? ""}`;
  }

  private renderBatchSourceClassifications(
    container: HTMLElement,
    sources: readonly SourcePresentation[],
  ): void {
    const unconfirmed = sources.filter((source) => source.classificationState !== "confirmed").length;
    const body = this.disclosure(
      container,
      "batch-source-labels",
      "Review labels",
      unconfirmed === 0 ? this.sourceClassificationSummary(sources) : `${unconfirmed} need confirmation`,
      unconfirmed > 0,
      unconfirmed > 0 ? "Review" : "Change…",
    );
    body.createEl("p", {
      cls: "practice-lab-muted",
      text: "Labels establish the course-authority order without changing any source file.",
    });
    for (const source of sources) {
      const key = this.sourceDraftKey(source);
      const current = this.classificationDrafts.get(key)
        ?? source.classification
        ?? "unclassified";
      const row = body.createDiv({
        cls: `practice-learning-path-source-label${source.classificationState === "confirmed" ? " is-confirmed" : " is-unconfirmed"}`,
      });
      const copy = row.createDiv({ cls: "practice-learning-path-source-label-copy" });
      copy.createEl("strong", { text: source.title });
      copy.createSpan({
        text: source.classificationState === "confirmed" ? "Confirmed" : "Confirmation needed",
      });
      const select = row.createEl("select", {
        attr: { "aria-label": `Source label for ${source.title}` },
      });
      for (const [value, label] of Object.entries(SOURCE_CLASSIFICATION_LABELS)) {
        select.createEl("option", { value, text: label });
      }
      select.value = current;
      select.addEventListener("change", () => {
        this.classificationDrafts.set(key, select.value as SourceMaterialClassificationV1);
        this.render();
      });
    }
    const hasChanges = this.hasClassificationChanges(sources);
    const actions = body.createDiv({ cls: "practice-learning-path-actions" });
    new ButtonComponent(actions)
      .setIcon("check")
      .setButtonText(this.busy === "source"
        ? "Saving labels…"
        : unconfirmed > 0
          ? "Confirm labels"
          : "Apply label changes")
      .setCta()
      .setDisabled(this.busy !== null || !hasChanges)
      .setTooltip("Confirm every displayed label in one update.")
      .onClick(() => void this.confirmAllSourceClassifications());
  }

  private hasClassificationChanges(
    sources: readonly SourcePresentation[],
  ): boolean {
    return sources.some((source) => {
      const selected = this.classificationDrafts.get(this.sourceDraftKey(source))
        ?? source.classification
        ?? "unclassified";
      return source.classificationState !== "confirmed"
        || source.classification !== selected;
    });
  }

  private async confirmAllSourceClassifications(): Promise<void> {
    if (this.busy !== null) return;
    const sources = this.approvedSources();
    const updates = sources.flatMap((source) => {
      const classification = this.classificationDrafts.get(this.sourceDraftKey(source))
        ?? source.classification
        ?? "unclassified";
      return source.classificationState === "confirmed"
        && source.classification === classification
        ? []
        : [{ source, classification }];
    });
    if (updates.length === 0) return;
    this.busy = "source";
    this.error = null;
    this.render();
    try {
      const batch = this.options.callbacks.confirmSourceClassifications;
      const updated = batch !== undefined
        ? await batch(updates)
        : await Promise.all(updates.map(async ({ source, classification }) => {
            const single = this.options.callbacks.confirmSourceClassification;
            return single === undefined ? source : await single(source, classification);
          }));
      if (updated.length !== updates.length) {
        throw new Error("The source-label update did not return every changed source.");
      }
      const updatedByKey = new Map(updated.map((source) => [this.sourceDraftKey(source), source]));
      const merged = sources.map((source) => (
        updatedByKey.get(this.sourceDraftKey(source)) ?? source
      ));
      this.primary = merged[0] ?? null;
      this.supporting = merged.slice(1);
      this.classificationDrafts.clear();
      this.invalidateSourceAlignment();
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private async continueFromLearningGoal(): Promise<void> {
    if (this.busy !== null) return;
    await this.previewSourceAlignment();
    const preview = this.alignmentPreview;
    if (preview === null) return;
    if (preview.requiresProvider) {
      this.page = "course-check";
      this.stage = "source";
      this.render();
      return;
    }
    if (!this.aiContextCompletionDecisionMade) return;
    await this.continueWithoutCourseAlignment(
      effectiveAiContextCompletionPolicy(
        this.blueprintConfiguration.aiContextCompletionPolicy,
      ),
    );
    if (!this.alignmentAccepted) return;
    await this.openPathPlan();
  }

  private async openPathPlan(): Promise<void> {
    if (!this.alignmentAccepted || this.busy !== null) return;
    this.page = "path-plan";
    this.stage = this.blueprint === null ? "source" : "map";
    this.render();
    if (this.preview === null && this.blueprint === null) await this.previewPlanningPayload();
  }

  private async openGenerateSets(): Promise<void> {
    if (this.blueprint === null || this.mapProblem() !== null || this.busy !== null) return;
    this.page = "generate-sets";
    this.stage = "map";
    this.render();
    if (this.setPayloadPreviews.length === 0) await this.previewSetPayloads();
  }

  private renderGenerationStatus(
    container: HTMLElement,
    blueprint: LearningBlueprintPresentationV1,
  ): void {
    const section = this.section(
      container,
      "Current batch",
      "The active set stays in focus. Completed drafts remain available if a later set fails.",
    );
    const currentHost = section.createDiv({ cls: "practice-learning-path-current-set-host" });
    this.batchCurrentHost = currentHost;
    this.renderCurrentBatchSet(currentHost, blueprint);
    const details = this.disclosure(
      section,
      "generate-set-details",
      "All sets",
      `${this.generatedSets.length} of ${this.setStates.length} completed`,
      false,
    );
    const navigator = details.createDiv({
      cls: "practice-learning-path-set-navigator",
      attr: { "aria-label": "Set generation status", "aria-live": "polite" },
    });
    this.batchNavigatorHost = navigator;
    this.renderBatchNavigator(navigator, blueprint);
    const activity = section.createDiv({
      cls: "practice-learning-path-batch-activity",
      attr: { "aria-live": "polite" },
    });
    this.batchActivityHost = activity;
    this.renderActivity(activity);
    if (this.busy === "batch") {
      new ButtonComponent(section)
        .setIcon("square")
        .setButtonText("Cancel current set and stop batch")
        .setDestructive()
        .onClick(() => void this.options.callbacks.cancelGeneration?.());
    } else if (
      this.recoveryAvailable
      && this.generatedSets.length < this.setStates.length
      && this.options.callbacks.resumeRecoverableBatch !== undefined
    ) {
      new ButtonComponent(section)
        .setIcon("history")
        .setButtonText("Retry remaining sets")
        .setCta()
        .onClick(() => void this.resumeRecovery());
    }
  }

  private renderSource(container: HTMLElement): void {
    if (
      this.recoveryAvailable
      && (
        this.options.callbacks.resumeRecoverableBatch !== undefined
        || this.options.callbacks.resumeRecoverableSourceAlignment !== undefined
      )
    ) {
      const recovery = container.createDiv({ cls: "practice-lab-callout is-warning practice-learning-path-recovery" });
      const text = recovery.createDiv();
      text.createEl("strong", {
        text: this.recoveryKind === "source-alignment"
          ? "Unfinished course-alignment check found"
          : this.recoveryKind === "generation-batch"
            ? "Unfinished guided path found"
            : "Unfinished guided work found",
      });
      text.createEl("p", {
        text: this.recoveryKind === "source-alignment"
          ? "Resume the exact approved source comparison. Your labels and payload remain unchanged."
          : this.recoveryKind === "generation-batch"
            ? "Continue the exact approved batch from its next unfinished set. Completed drafts are retained."
            : "Inspect and resume the exact approved work without starting over.",
      });
      const actions = recovery.createDiv({ cls: "practice-learning-path-actions" });
      new ButtonComponent(actions)
        .setIcon("history")
        .setButtonText(this.recoveryKind === "source-alignment"
          ? "Resume alignment check"
          : "Resume guided path")
        .setCta()
        .setDisabled(this.busy !== null)
        .onClick(() => void this.resumeRecovery());
      if (this.options.callbacks.discardRecoverableBatch !== undefined) {
        new ButtonComponent(actions)
          .setIcon("trash-2")
          .setButtonText("Discard recovery…")
          .setDestructive()
          .setDisabled(this.busy !== null)
          .onClick(() => void this.discardRecovery());
      }
      if (this.busy === "alignment" && this.recoveryKind === "source-alignment") {
        this.alignmentActivityHost = recovery.createDiv({
          cls: "practice-learning-path-planning-activity",
          attr: { "aria-live": "polite" },
        });
        this.refreshAlignmentActivity();
      }
    }
    const section = this.section(
      container,
      "Source and intent",
      "Approve only the material this path may use. Nothing is crawled or added automatically.",
    );
    if (this.primary === null) {
      section.createEl("h4", { text: "Choose a primary source" });
      this.renderSourceChoiceButtons(section);
      const empty = section.createDiv({ cls: "practice-source-empty-inline" });
      const icon = empty.createSpan();
      setIcon(icon, "file-search");
      empty.createSpan({
        text: "No primary source is loaded yet. Open a note or PDF, then choose one option above.",
      });
      return;
    }

    const approvedSources = this.approvedSources();
    const visualCount = approvedSources.reduce((total, source) => total + source.visuals.length, 0);
    const selectedVisualCount = approvedSources.reduce(
      (total, source) => total + source.visuals.filter((visual) => visual.selected).length,
      0,
    );
    const bundleSummary = section.createDiv({ cls: "practice-learning-path-bundle-summary" });
    const bundleCopy = bundleSummary.createDiv();
    bundleCopy.createEl("strong", { text: this.primary.title });
    bundleCopy.createSpan({
      text: `${this.supporting.length} supporting ${this.supporting.length === 1 ? "source" : "sources"} · ${approvedSources.reduce((total, source) => total + source.characterCount, 0).toLocaleString()} submitted characters`,
    });
    bundleSummary.createSpan({
      cls: "practice-lab-badge",
      text: visualCount === 0 ? "Text only" : `${selectedVisualCount}/${visualCount} images selected`,
    });
    const unconfirmedLabels = approvedSources.filter((source) => (
      source.classificationState !== "confirmed"
    )).length;
    const sourceLabels = this.disclosure(
      section,
      "source-labels",
      "Review labels",
      this.sourceClassificationSummary(approvedSources),
      unconfirmedLabels > 0,
    );
    const sourceLabelDetails = sourceLabels.parentElement as HTMLDetailsElement;
    sourceLabels.createEl("p", {
      cls: "practice-lab-muted practice-learning-path-source-label-help",
      text: "Labels determine which approved sources represent school material and which are personal notes. Confirming a label never changes the source file.",
    });
    for (const source of approvedSources) {
      this.renderSourceClassification(sourceLabels, source);
    }
    this.renderSourceCard(section, this.primary, "Primary", () => {
      this.primary = null;
      this.supporting = [];
      this.primaryVisualPreparationToken = null;
      this.visualSelectionBusy = false;
      this.resetAfterSourceChange();
      this.render();
    }, false, () => {
      void this.choosePrimarySource("vault-note");
    });
    if (this.primaryVisualPreparationToken !== null) {
      section.createEl("p", {
        cls: "practice-lab-muted practice-learning-path-visual-message",
        text: "Guided path is open. Preparing the default GIF frames in the background…",
        attr: { role: "status", "aria-live": "polite" },
      });
    }

    if (visualCount > 0 || this.primaryVisualPreparationToken !== null) {
      const visualBody = this.disclosure(
        section,
        "source-visuals",
        "Review images",
        visualCount === 0
          ? "Preparing detected visuals…"
          : `${selectedVisualCount} of ${visualCount} selected`,
        this.visualSelectionMessage !== null,
      );
      {
        const section = visualBody;
        this.renderVisualBundleControls(section);
      }
      for (const source of approvedSources) {
        if (source.visuals.length === 0) continue;
        const sourceVisuals = visualBody.createDiv({ cls: "practice-source-primary-visuals" });
        this.renderSourceVisuals(sourceVisuals, source);
      }
    }

    const pdfBudgetProblem = this.pdfBudgetProblem();
    const pdfBudget = this.pdfBudgetUsage();
    const sourceEditor = this.disclosure(
      section,
      "source-bundle",
      "Change source bundle",
      "Replace the primary source or add up to four supporting sources",
      pdfBudgetProblem !== null,
    );
    sourceEditor.createEl("p", {
      cls: "practice-source-replace-note",
      text: "Choosing a different primary source replaces this bundle. Supporting material is changed separately below.",
    });
    this.renderSourceChoiceButtons(sourceEditor);
    const supportHeading = sourceEditor.createDiv({ cls: "practice-learning-path-subheading" });
    supportHeading.createEl("strong", { text: "Supporting material" });
    supportHeading.createSpan({ text: `${this.supporting.length} of 4 selected` });
    sourceEditor.createEl("p", {
      cls: "setting-item-description practice-learning-path-support-help",
      text: "Add only the material you approve. Every PDF opens a page picker; primary and supporting PDFs share one total generation budget.",
    });
    this.renderPdfBudget(sourceEditor, pdfBudget, pdfBudgetProblem);
    for (const source of this.supporting) {
      this.renderSourceCard(sourceEditor, source, "Supporting", () => {
        this.supporting = this.supporting.filter((candidate) => candidate !== source);
        this.resetAfterSourceChange();
        this.render();
      }, false);
    }
    const supportActions = sourceEditor.createDiv({ cls: "practice-learning-path-support-actions" });
    new ButtonComponent(supportActions)
      .setIcon("file-text")
      .setButtonText(this.supportingSourceChoiceBusy === "note" ? "Choosing note…" : "Add supporting note")
      .setTooltip("Choose one Markdown note explicitly. Linked material is never added automatically.")
      .setDisabled(this.busy !== null || this.visualSelectionBusy || this.supporting.length >= 4)
      .onClick(() => void this.addSupportingSource("note"));
    new ButtonComponent(supportActions)
      .setIcon("file-scan")
      .setButtonText(this.supportingSourceChoiceBusy === "pdf" ? "Choosing PDF pages…" : "Add supporting PDF pages")
      .setTooltip(pdfBudget === null
        ? pdfBudgetProblem?.message ?? "Choose the invalid PDF source again before adding another PDF."
        : `Choose one PDF and an exact page range. ${pdfBudget.remainingPages.toLocaleString()} pages and ${pdfBudget.remainingCharacters.toLocaleString()} extracted characters remain in this bundle.`)
      .setDisabled(
        this.busy !== null
        || this.visualSelectionBusy
        || this.supporting.length >= 4
        || pdfBudget === null
        || pdfBudget.remainingPages < 1
        || pdfBudget.remainingCharacters < 1
      )
      .onClick(() => void this.addSupportingSource("pdf"));

    const level = this.section(container, "Where should the path begin?", "This changes the teaching depth, never the approved source boundary.");
    const levelGrid = level.createDiv({ cls: "practice-learning-path-level-grid" });
    for (const option of STARTING_LEVELS) {
      const label = levelGrid.createEl("label", {
        cls: `practice-learning-path-level${this.blueprintConfiguration.startingLevel === option.id ? " is-selected" : ""}`,
      });
      const input = label.createEl("input", { attr: { type: "radio", name: "learning-starting-level", value: option.id } });
      input.checked = this.blueprintConfiguration.startingLevel === option.id;
      label.createEl("strong", { text: option.label });
      label.createSpan({ text: option.description });
      input.addEventListener("change", () => {
        if (!input.checked) return;
        this.blueprintConfiguration = { ...this.blueprintConfiguration, startingLevel: option.id };
        this.invalidatePlanningPreview();
        this.render();
      });
    }

    const planning = this.section(container, "Shape the path", "Choose the path size and tell the planner what deserves attention.");
    new Setting(planning)
      .setName("Proposed set count")
      .setDesc(`The planner may reduce this when the source cannot support distinct sets. Maximum ${MAX_LEARNING_PATH_SETS}.`)
      .addSlider((slider) => slider
        .setLimits(MIN_LEARNING_PATH_SETS, MAX_LEARNING_PATH_SETS, 1)
        .setValue(this.blueprintConfiguration.desiredSetCount)
        .onChange((value) => {
          this.blueprintConfiguration = { ...this.blueprintConfiguration, desiredSetCount: value };
          this.invalidatePlanningPreview();
        }));
    const focus = planning.createEl("label", { cls: "practice-learning-path-focus" });
    focus.createEl("strong", { text: "Comments for the planner" });
    focus.createSpan({ text: "For example: focus on mechanisms first, compare the two architectures, or keep calculations for the last set." });
    const textarea = focus.createEl("textarea", { attr: { rows: "4", maxlength: String(MAX_FOCUS_INSTRUCTIONS_LENGTH) } });
    textarea.value = this.blueprintConfiguration.globalFocusInstructions;
    textarea.addEventListener("input", () => {
      this.blueprintConfiguration = { ...this.blueprintConfiguration, globalFocusInstructions: textarea.value };
      this.invalidatePlanningPreview();
    });
    const selectedProvider = this.providers.find((entry) => (
      entry.id === this.blueprintConfiguration.provider
    ));
    const engine = this.disclosure(
      planning,
      "planning-engine",
      "Generation engine",
      this.providerSummary(),
      selectedProvider?.available === false,
      "Change…",
    );
    this.renderProviderControls(engine);

    this.renderSourceAlignment(container, unconfirmedLabels);

    const actions = container.createDiv({ cls: "practice-learning-path-actions" });
    if (unconfirmedLabels > 0) {
      new ButtonComponent(actions)
        .setIcon("tags")
        .setButtonText(`Review ${unconfirmedLabels} source ${unconfirmedLabels === 1 ? "label" : "labels"}`)
        .setCta()
        .setDisabled(this.busy !== null)
        .setTooltip("Confirm what each source represents before the course-alignment check.")
        .onClick(() => {
          sourceLabelDetails.open = true;
          this.disclosureState.set("source-labels", true);
          sourceLabelDetails.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
            block: "start",
          });
        });
    } else if (this.alignmentPreview === null && this.alignmentResult === null) {
      new ButtonComponent(actions)
        .setIcon("scan-eye")
        .setButtonText(this.busy === "alignment-preview" ? "Preparing alignment preview…" : "Preview course alignment")
        .setCta()
        .setDisabled(
          this.busy !== null
          || this.primaryVisualPreparationToken !== null
          || pdfBudgetProblem !== null
        )
        .setTooltip(pdfBudgetProblem?.message ?? "Preview the exact classified source comparison before it runs.")
        .onClick(() => void this.previewSourceAlignment());
    } else if (this.alignmentAccepted && this.preview === null) {
      new ButtonComponent(actions)
        .setIcon("scan-eye")
        .setButtonText(this.busy === "preview" ? "Preparing planning preview…" : "Preview planning payload")
        .setCta()
        .setDisabled(
          this.busy !== null
          || this.primaryVisualPreparationToken !== null
          || pdfBudgetProblem !== null
        )
        .setTooltip(pdfBudgetProblem?.message ?? "Preview exactly what the selected AI will receive before path planning.")
        .onClick(() => void this.previewPlanningPayload());
    }
    if (this.preview !== null) this.renderPlanningPreview(container);
  }

  private renderSourceAlignment(
    container: HTMLElement,
    unconfirmedLabels: number,
  ): void {
    if (unconfirmedLabels > 0) return;
    const preview = this.alignmentPreview;
    const result = this.alignmentResult;
    if (preview === null && result === null) return;

    const blockers = result?.blockerRecordIds.length ?? 0;
    const section = this.section(
      container,
      "Course alignment",
      result === null
        ? "Check how your selected material and school sources relate before planning. Your material stays the topical backbone; optional AI-supported context is added only after your approval and remains not course-checked."
        : alignmentResultDescription(
            result,
            this.blueprintConfiguration.aiContextCompletionPolicy,
            this.aiContextCompletionDecisionMade,
          ),
    );
    section.addClass("practice-learning-path-alignment");

    if (result === null && preview !== null) {
      section.tabIndex = -1;
      section.setAttribute("aria-label", "Course-alignment request ready for review");
      this.alignmentPreviewHost = section;
      const metadata = section.createDiv({ cls: "practice-learning-path-payload-meta" });
      metadata.createSpan({ text: preview.providerLabel });
      metadata.createSpan({ text: preview.modelLabel });
      metadata.createSpan({ text: `${preview.reasoningEffortLabel} reasoning` });
      const payload = section.createEl("details", {
        cls: "practice-learning-path-payload practice-learning-path-alignment-payload",
      });
      this.bindDisclosure(payload, "source-alignment-payload", false);
      payload.createEl("summary", { text: "Details · exact alignment request" });
      payload.createEl("pre", { text: preview.text });
      section.createEl("p", { cls: "practice-lab-muted", text: preview.warning });

      if (this.busy === "alignment") {
        const progress = section.createDiv({
          cls: "practice-learning-path-planning-progress",
          attr: { role: "status", "aria-live": "polite" },
        });
        const heading = progress.createDiv({ cls: "practice-learning-path-planning-progress-heading" });
        const spinner = heading.createSpan({ cls: "practice-lab-spinner" });
        setIcon(spinner, "loader-circle");
        heading.createEl("strong", { text: "Checking the approved sources" });
        progress.createEl("p", {
          text: "The comparison is recoverable. You can continue using Obsidian while it runs.",
        });
        this.alignmentActivityHost = progress.createDiv({
          cls: "practice-learning-path-planning-activity",
          attr: { "aria-live": "polite" },
        });
        this.refreshAlignmentActivity();
        if (this.options.callbacks.cancelGeneration !== undefined) {
          new ButtonComponent(progress)
            .setButtonText("Cancel alignment check")
            .setDestructive()
            .onClick(() => void this.options.callbacks.cancelGeneration?.());
        }
      } else {
        if (preview.requiresProvider) {
          const actions = section.createDiv({ cls: "practice-learning-path-actions" });
          new ButtonComponent(actions)
            .setIcon("shield-check")
            .setButtonText("Approve and check alignment")
            .setCta()
            .setDisabled(this.busy !== null || this.quickGenerationRecovery !== null)
            .setTooltip("Run the selected AI on only this exact classified source payload.")
            .onClick(() => void this.generateSourceAlignment());
        } else {
          const suggestion = section.createDiv({
            cls: "practice-lab-callout practice-learning-path-context-suggestion",
          });
          const suggestionHeading = suggestion.createDiv({
            cls: "practice-learning-path-context-suggestion-heading",
          });
          setIcon(suggestionHeading.createSpan(), "sparkles");
          suggestionHeading.createEl("strong", {
            text: "Additional context could strengthen this practice",
          });
          suggestion.createEl("p", {
            text: "Your selected material remains the basis. Choose once whether generated lessons and problems may use a small amount of clearly labelled AI-supported context. Your notes will not be changed.",
          });
          const actions = section.createDiv({ cls: "practice-learning-path-actions" });
          new ButtonComponent(actions)
            .setIcon("sparkles")
            .setButtonText("Add supporting context")
            .setCta()
            .setDisabled(this.busy !== null)
            .setTooltip("Allow minimum AI-supported context in the practice path. It remains not course-checked and never edits your notes.")
            .onClick(() => void this.continueWithoutCourseAlignment("approved-general-context"));
          new ButtonComponent(actions)
            .setIcon("file-check-2")
            .setButtonText("Continue with selected material only")
            .setDisabled(this.busy !== null)
            .setTooltip("Keep generation limited to the material you selected.")
            .onClick(() => void this.continueWithoutCourseAlignment("selected-sources-only"));
        }
      }
      return;
    }

    if (result === null) return;
    section.tabIndex = -1;
    section.setAttribute("aria-label", "Course-alignment result");
    this.alignmentResultHost = section;
    const summary = section.createEl("details", {
      cls: `practice-lab-study-alignment ${alignmentResultClass(result)}`,
    });
    this.bindDisclosure(summary, "source-alignment-result", blockers > 0);
    const summaryHeading = summary.createEl("summary");
    setIcon(summaryHeading.createSpan(), blockers > 0 ? "triangle-alert" : alignmentResultIcon(result));
    summaryHeading.createSpan({ text: alignmentResultTitle(result) });
    const body = summary.createDiv({ cls: "practice-lab-study-alignment-body" });
    body.createEl("p", {
      text: alignmentResultDescription(
        result,
        this.blueprintConfiguration.aiContextCompletionPolicy,
        this.aiContextCompletionDecisionMade,
      ),
    });
    if (result.ledger.records.length > 0) {
      const counts = body.createDiv({ cls: "practice-learning-path-map-summary" });
      for (const [status, count] of alignmentStatusCounts(result.ledger)) {
        counts.createSpan({ text: `${count} ${alignmentStatusLabel(status).toLocaleLowerCase()}` });
      }
      const blockingRecords = result.ledger.records.filter((record) => (
        result.blockerRecordIds.includes(record.id)
      ));
      const informationalRecords = result.ledger.records.filter((record) => (
        !result.blockerRecordIds.includes(record.id)
      ));
      for (const record of blockingRecords) {
        this.renderSourceAlignmentRecord(body, record, result);
      }
      if (informationalRecords.length > 0) {
        const comparisons = body.createEl("details", {
          cls: "practice-learning-path-alignment-comparisons",
        });
        this.bindDisclosure(comparisons, "source-alignment-comparisons", false);
        comparisons.createEl("summary", {
          text: `Details · Review ${informationalRecords.length} source ${informationalRecords.length === 1 ? "comparison" : "comparisons"}`,
        });
        const comparisonBody = comparisons.createDiv();
        for (const record of informationalRecords) {
          this.renderSourceAlignmentRecord(comparisonBody, record, result);
        }
      }
    }

    const contextOpportunity = alignmentHasAiContextOpportunity(result);
    if (blockers === 0 && contextOpportunity) {
      const suggestion = body.createDiv({
        cls: "practice-lab-callout practice-learning-path-context-suggestion",
      });
      const suggestionHeading = suggestion.createDiv({
        cls: "practice-learning-path-context-suggestion-heading",
      });
      setIcon(suggestionHeading.createSpan(), "sparkles");
      suggestionHeading.createEl("strong", {
        text: "Additional context could strengthen this practice",
      });
      if (!this.aiContextCompletionDecisionMade) {
        suggestion.createEl("p", {
          text: "Your selected material remains the basis. You can approve a small amount of AI-supported technical context for the generated lessons and problems, or continue using only the selected sources. Your notes will not be changed.",
        });
        const choiceActions = suggestion.createDiv({
          cls: "practice-learning-path-actions",
        });
        new ButtonComponent(choiceActions)
          .setIcon("sparkles")
          .setButtonText("Add supporting context")
          .setCta()
          .setDisabled(this.busy !== null)
          .setTooltip("Allow minimum AI-supported context in this practice path. It will remain visibly not course-checked and will not edit your notes.")
          .onClick(() => this.chooseAiContextCompletion("approved-general-context"));
        new ButtonComponent(choiceActions)
          .setIcon("file-check-2")
          .setButtonText("Continue with selected material only")
          .setDisabled(this.busy !== null)
          .setTooltip("Keep generation limited to the selected notes and approved school material.")
          .onClick(() => this.chooseAiContextCompletion("selected-sources-only"));
      } else {
        const selected = suggestion.createDiv({
          cls: "practice-learning-path-approved-state",
        });
        setIcon(selected.createSpan(), "check-circle-2");
        selected.createSpan({
          text: aiContextCompletionApproved(
            this.blueprintConfiguration.aiContextCompletionPolicy,
          )
            ? "AI-supported context approved · not course-checked"
            : "Using selected material only",
        });
        new ButtonComponent(suggestion)
          .setButtonText("Change…")
          .setTooltip("Review the context-completion choice before building the path.")
          .onClick(() => {
            this.aiContextCompletionDecisionMade = false;
            this.alignmentAccepted = false;
            this.invalidatePlanningPreview();
            this.render();
          });
      }
    }

    const actions = section.createDiv({ cls: "practice-learning-path-actions" });
    if (this.alignmentAccepted) {
      const approved = actions.createDiv({ cls: "practice-learning-path-approved-state" });
      setIcon(approved.createSpan(), "check-circle-2");
      approved.createSpan({
        text: result.checked
          ? "Course alignment approved"
          : "Continuing as not course-checked",
      });
    } else if (
      blockers === 0
      && (!contextOpportunity || this.aiContextCompletionDecisionMade)
    ) {
      new ButtonComponent(actions)
        .setIcon("check-circle-2")
        .setButtonText(result.ledger.records.some((record) => record.resolution === "excluded")
          ? "Use source-led check with exclusions"
          : "Use source-led course check")
        .setCta()
        .setDisabled(this.busy !== null)
        .setTooltip(aiContextCompletionApproved(
          this.blueprintConfiguration.aiContextCompletionPolicy,
        )
          ? "Continue with selected school context first and the explicitly approved AI-supported context labelled not course-checked."
          : "Continue using only the selected material and approved school context.")
        .onClick(() => void this.approveSourceAlignment());
    } else {
      const warning = actions.createDiv({ cls: "practice-learning-path-approved-state is-warning" });
      setIcon(warning.createSpan(), "triangle-alert");
      warning.createSpan({
        text: `Resolve or exclude ${blockers} confirmed school-source ${blockers === 1 ? "conflict" : "conflicts"} to continue. Other areas do not block the path; you will choose whether to add supporting AI context.`,
      });
    }
  }

  private renderSourceAlignmentRecord(
    container: HTMLElement,
    record: SourceAlignmentRecordV1,
    result: LearningSourceAlignmentResultV1,
  ): void {
    const blocking = result.blockerRecordIds.includes(record.id);
    const card = container.createEl("details", {
      cls: `practice-lab-alignment-record is-${record.status}${blocking ? " is-blocking" : ""}`,
    });
    this.bindDisclosure(card, `source-alignment-record:${record.id}`, blocking);
    const heading = card.createEl("summary");
    setIcon(heading.createSpan(), blocking ? "triangle-alert" : alignmentStatusIcon(record.status));
    heading.createSpan({ text: alignmentStatusLabel(record.status) });
    const details = card.createDiv({ cls: "practice-lab-alignment-record-body" });
    if (record.courseSupportedClaim !== null) {
      const supported = details.createEl("p", { cls: "practice-lab-alignment-resolution" });
      supported.createEl("strong", { text: "School-supported interpretation" });
      supported.createSpan({ text: record.courseSupportedClaim });
    }
    if (record.noteClaim !== null) {
      const note = details.createEl("p", { cls: "practice-lab-alignment-claim" });
      note.createEl("strong", { text: "Your notes" });
      note.createSpan({ text: record.noteClaim });
    }
    if (record.schoolClaim !== null) {
      const school = details.createEl("p", { cls: "practice-lab-alignment-claim" });
      school.createEl("strong", { text: "School material" });
      school.createSpan({ text: record.schoolClaim });
    }
    const evidence = details.createEl("p", { cls: "practice-lab-muted" });
    evidence.setText(`${record.noteSegmentIds.length} note and ${record.schoolSegmentIds.length} school evidence ${record.noteSegmentIds.length + record.schoolSegmentIds.length === 1 ? "segment" : "segments"} · ${displayAlignmentResolution(record)}`);
    if (blocking) {
      new ButtonComponent(details)
        .setIcon("circle-slash-2")
        .setButtonText("Exclude this disputed claim from practice")
        .setDestructive()
        .setDisabled(this.busy !== null)
        .setTooltip("Exclude only this disputed topic. The plugin will not choose between conflicting school sources or use the excluded claim to create practice.")
        .onClick(() => this.excludeSourceAlignmentRecord(record.id));
    }
  }

  private renderPlanningPreview(container: HTMLElement): void {
    const preview = this.preview;
    if (preview === null) return;
    const section = this.section(container, "Ready to approve", "Confirm the selected engine and inspect the exact source-grounded payload if you want more detail.");
    section.addClass("practice-learning-path-planning-preview");
    section.tabIndex = -1;
    section.setAttribute("aria-label", "Exact planning payload ready for review");
    this.planningPreviewHost = section;
    const metadata = section.createDiv({ cls: "practice-learning-path-payload-meta" });
    metadata.createSpan({ text: preview.providerLabel });
    metadata.createSpan({ text: preview.modelLabel });
    metadata.createSpan({ text: preview.reasoningEffortLabel });
    const details = section.createEl("details", { cls: "practice-learning-path-payload" });
    this.bindDisclosure(details, "planning-payload", false);
    details.createEl("summary", { text: "Details · exact provider text" });
    details.createEl("pre", { text: preview.text });
    if (preview.warning !== undefined) section.createEl("p", { cls: "practice-lab-muted", text: preview.warning });
    const actions = section.createDiv({ cls: "practice-learning-path-actions" });
    new ButtonComponent(actions)
      .setIcon("route")
      .setButtonText(this.busy === "blueprint" ? "Building path…" : "Approve and build path")
      .setCta()
      .setDisabled(this.busy !== null || this.quickGenerationRecovery !== null)
      .setTooltip("Approve this exact request and build the editable path without another confirmation step.")
      .onClick(() => {
        this.previewAccepted = true;
        void this.generateBlueprint();
      });
    if (this.busy === "blueprint") {
      const progress = section.createDiv({
        cls: "practice-learning-path-planning-progress",
        attr: { role: "status", "aria-live": "polite" },
      });
      const heading = progress.createDiv({ cls: "practice-learning-path-planning-progress-heading" });
      const spinner = heading.createSpan({ cls: "practice-lab-spinner" });
      setIcon(spinner, "loader-circle");
      heading.createEl("strong", { text: "Planner is working" });
      progress.createEl("p", {
        text: `${preview.providerLabel} is planning with ${preview.reasoningEffortLabel} reasoning and ${preview.visualNames.length} approved visual ${preview.visualNames.length === 1 ? "copy" : "copies"}. You can continue using Obsidian while this creation tab remains open.`,
      });
      this.blueprintActivityHost = progress.createDiv({
        cls: "practice-learning-path-planning-activity",
        attr: { "aria-live": "polite" },
      });
      this.refreshBlueprintActivity();
      if (this.options.callbacks.cancelGeneration !== undefined) {
        new ButtonComponent(progress)
          .setButtonText("Cancel planning")
          .setDestructive()
          .onClick(() => void this.options.callbacks.cancelGeneration?.());
      }
    }
  }

  private renderMap(container: HTMLElement, includeGenerationAction = true): void {
    const blueprint = this.blueprint;
    if (blueprint === null) {
      this.stage = "source";
      this.render();
      return;
    }
    const overview = this.section(container, blueprint.draft.title, blueprint.draft.overview);
    const summary = overview.createDiv({ cls: "practice-learning-path-map-summary" });
    summary.createSpan({ text: `${blueprint.draft.aspects.filter((aspect) => aspect.status === "supported").length} supported aspects` });
    summary.createSpan({ text: `${this.setStates.length} practice sets` });
    summary.createSpan({ text: `${this.totalExercises()} exercises planned` });

    const gaps = blueprint.draft.aspects.filter((aspect) => aspect.status === "source-gap");
    const aspects = this.section(
      container,
      "Learning map",
      gaps.length === 0
        ? "The proposed prerequisites are ready. Open Details when you want to inspect the complete concept map."
        : `${gaps.length} source ${gaps.length === 1 ? "gap needs" : "gaps need"} attention before generation.`,
    );
    const aspectBody = this.disclosure(
      aspects,
      "aspect-map",
      "Details",
      `${blueprint.draft.aspects.length} aspects · ${gaps.length} source ${gaps.length === 1 ? "gap" : "gaps"}`,
      gaps.length > 0,
    );
    const aspectGrid = aspectBody.createDiv({ cls: "practice-learning-path-aspect-grid" });
    for (const aspect of blueprint.draft.aspects) {
      const card = aspectGrid.createDiv({ cls: `practice-learning-path-aspect is-${aspect.status}` });
      const heading = card.createDiv({ cls: "practice-learning-path-card-heading" });
      setIcon(heading.createSpan(), aspect.status === "supported" ? "check-circle-2" : "triangle-alert");
      const title = heading.createEl("strong");
      renderLatexMarkup(title, aspect.title);
      card.createEl("p", { text: aspect.purpose });
      if (aspect.prerequisiteAspectIds.length > 0) {
        card.createEl("p", { cls: "practice-lab-muted", text: `Requires: ${aspect.prerequisiteAspectIds.map((id) => blueprint.draft.aspects.find((entry) => entry.id === id)?.title ?? id).join(", ")}` });
      }
      if (aspect.status === "source-gap") {
        card.createEl("p", { cls: "practice-learning-path-gap", text: aspect.gapReason ?? "Unsupported prerequisite" });
        new ButtonComponent(card)
          .setIcon("trash-2")
          .setButtonText("Remove from path")
          .setTooltip("Remove this unsupported aspect. No AI-generated general knowledge will replace it.")
          .onClick(() => this.removeGap(aspect.id));
      }
    }

    const sets = this.section(container, "Practice-set progression", "Choose one set to adjust. The rest stay compact so the learning sequence remains easy to scan.");
    const problem = this.mapProblem();
    const blockingSetId = this.blockingSetId();
    if (
      this.activeMapSetId !== null
      && !this.setStates.some((state) => state.id === this.activeMapSetId)
    ) this.activeMapSetId = null;
    if (blockingSetId !== null) this.activeMapSetId = blockingSetId;
    if (problem !== null) {
      const callout = sets.createDiv({ cls: "practice-lab-callout is-warning", attr: { role: "status" } });
      setIcon(callout.createSpan(), "triangle-alert");
      callout.createSpan({ text: problem });
    }
    const list = sets.createDiv({ cls: "practice-learning-path-set-list" });
    for (const [index, state] of this.setStates.entries()) {
      this.renderSetCard(list, state, index);
    }
    new ButtonComponent(sets)
      .setIcon("plus")
      .setButtonText("Add focused set")
      .setTooltip(`Add another editable set. A path can contain at most ${MAX_LEARNING_PATH_SETS}.`)
      .setDisabled(this.setStates.length >= MAX_LEARNING_PATH_SETS || this.busy !== null)
      .onClick(() => this.addSet());

    if (includeGenerationAction) {
      const actions = container.createDiv({ cls: "practice-learning-path-actions is-sticky" });
      new ButtonComponent(actions)
        .setIcon("scan-eye")
        .setButtonText(this.busy === "payloads" ? "Computing exact payloads…" : "Preview all set payloads")
        .setCta()
        .setDisabled(problem !== null || this.busy !== null)
        .onClick(() => void this.previewSetPayloads());
      if (this.setPayloadPreviews.length > 0) this.renderSetPayloadPreviews(container);
    }
  }

  private renderSetCard(container: HTMLElement, state: EditableSetState, index: number): void {
    const blueprint = this.blueprint;
    if (blueprint === null) return;
    const brief = blueprint.draft.sets.find((set) => set.id === state.id);
    if (brief === undefined) return;
    const expanded = this.activeMapSetId === state.id;
    const card = container.createEl("article", {
      cls: "practice-learning-path-set-card",
      attr: { "data-set-id": state.id },
    });
    card.addClass(expanded ? "is-expanded" : "is-compact");
    card.addEventListener("dragover", (event) => event.preventDefault());
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      const dragged = event.dataTransfer?.getData("text/plain");
      if (dragged !== undefined && dragged.length > 0) this.moveSet(dragged, index);
    });
    const heading = card.createDiv({ cls: "practice-learning-path-set-heading" });
    const order = heading.createSpan({
      cls: "practice-learning-path-set-order",
      text: String(index + 1),
      attr: {
        draggable: "true",
        title: "Drag this handle to change the learning sequence.",
        "aria-label": `Drag set ${index + 1} to change the learning sequence`,
        "data-practice-lab-description": "Drag this handle to reorder the set. The adjacent arrow buttons provide keyboard-accessible reordering.",
      },
    });
    order.addEventListener("dragstart", (event) => {
      if (event.dataTransfer === null) return;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", state.id);
    });
    const identity = heading.createDiv();
    if (expanded) {
      const title = identity.createEl("input", { cls: "practice-learning-path-set-title", attr: { type: "text", "aria-label": `Set ${index + 1} title` } });
      title.value = brief.title;
      title.addEventListener("input", () => this.updateBrief(state.id, { title: title.value }));
    } else {
      const title = identity.createEl("strong", { cls: "practice-learning-path-set-title" });
      renderLatexMarkup(title, brief.title);
    }
    identity.createSpan({ cls: "practice-lab-badge", text: brief.instructionalRole.replaceAll("-", " ") });
    const controls = heading.createDiv({ cls: "practice-learning-path-card-actions" });
    this.iconButton(controls, "arrow-up", "Move set earlier", index === 0, () => this.moveSet(state.id, index - 1));
    this.iconButton(controls, "arrow-down", "Move set later", index === this.setStates.length - 1, () => this.moveSet(state.id, index + 1));
    this.iconButton(controls, "trash-2", "Remove set", this.setStates.length <= MIN_LEARNING_PATH_SETS, () => this.removeSet(state.id));
    new ButtonComponent(controls)
      .setIcon(expanded ? "chevron-up" : "sliders-horizontal")
      .setButtonText(expanded ? "Done" : "Customize")
      .setTooltip(expanded
        ? `Collapse ${brief.title}`
        : `Adjust the purpose, quantity, difficulty, engine, and exercise mix for ${brief.title}`)
      .onClick(() => {
        this.activeMapSetId = expanded ? null : state.id;
        this.render();
      });

    if (!expanded) {
      const summary = card.createDiv({ cls: "practice-learning-path-set-summary" });
      const purpose = summary.createDiv();
      renderLatexMarkup(purpose, brief.purpose);
      const selectedProvider = this.providers.find((entry) => entry.id === state.configuration.provider);
      summary.createSpan({
        text: `${state.configuration.quantity} questions · ${displayDifficulty(state.configuration.difficulty)} · ${selectedProvider?.label ?? state.configuration.provider}`,
      });
      const chips = card.createDiv({ cls: "practice-learning-path-aspect-chips" });
      for (const aspectId of brief.aspectIds) {
        chips.createSpan({ text: blueprint.draft.aspects.find((aspect) => aspect.id === aspectId)?.title ?? aspectId });
      }
      return;
    }

    const purpose = card.createEl("textarea", { attr: { rows: "2", "aria-label": `${brief.title} purpose` } });
    purpose.value = brief.purpose;
    purpose.addEventListener("input", () => this.updateBrief(state.id, { purpose: purpose.value }));
    const chips = card.createDiv({ cls: "practice-learning-path-aspect-chips" });
    for (const aspectId of brief.aspectIds) {
      chips.createSpan({ text: blueprint.draft.aspects.find((aspect) => aspect.id === aspectId)?.title ?? aspectId });
    }
    const compact = card.createDiv({ cls: "practice-learning-path-set-compact" });
    const quantity = compact.createEl("label");
    quantity.createSpan({ text: "Questions" });
    const quantityInput = quantity.createEl("input", { attr: { type: "number", min: "1", max: "30" } });
    quantityInput.value = String(state.configuration.quantity);
    quantityInput.addEventListener("change", () => {
      const value = Math.min(30, Math.max(1, Number.parseInt(quantityInput.value, 10) || 1));
      this.updateSetConfiguration(state.id, { quantity: value });
      quantityInput.value = String(value);
    });
    const difficulty = card.createDiv({
      cls: "practice-learning-path-set-difficulty",
    });
    difficulty.createEl("strong", { text: "Difficulty profile" });
    difficulty.createSpan({
      text: "Calibrate this set independently. The approved sources and set purpose remain fixed.",
    });
    renderDifficultySelector(difficulty, {
      value: state.configuration.difficulty,
      name: `practice-lab-path-difficulty-${state.id}`,
      ariaLabel: `Difficulty profile for ${brief.title}`,
      compact: true,
      onChange: (value) => this.updateSetConfiguration(state.id, {
        difficulty: value,
      }),
    });

    const advanced = card.createEl("details", { cls: "practice-learning-path-advanced" });
    advanced.open = state.advancedOpen;
    advanced.addEventListener("toggle", () => { state.advancedOpen = advanced.open; });
    advanced.createEl("summary", { text: "Advanced" });
    this.renderSetAdvanced(advanced, state);
  }

  private renderSetAdvanced(container: HTMLElement, state: EditableSetState): void {
    const providerRow = container.createDiv({ cls: "practice-learning-path-provider-grid" });
    const providerLabel = providerRow.createEl("label");
    providerLabel.createSpan({ text: "Provider" });
    const provider = providerLabel.createEl("select");
    for (const entry of this.providers) {
      provider.createEl("option", { value: entry.id, text: entry.available ? entry.label : `${entry.label} (unavailable)` }).disabled = !entry.available;
    }
    provider.value = state.configuration.provider;
    provider.addEventListener("change", () => {
      const id = provider.value as ProviderId;
      const presentation = this.providers.find((entry) => entry.id === id);
      this.updateSetConfiguration(state.id, {
        provider: id,
        model: presentation?.defaultModel ?? "",
        reasoningEffort: presentation?.reasoningEfforts[0] ?? "medium",
      });
      this.render();
    });
    const selectedProvider = this.providers.find((entry) => entry.id === state.configuration.provider);
    const modelLabel = providerRow.createEl("label");
    modelLabel.createSpan({ text: "Model" });
    const model = modelLabel.createEl("select");
    const models = selectedProvider?.models ?? [];
    if (models.length === 0) model.createEl("option", { value: "", text: "Automatic" });
    for (const entry of models) model.createEl("option", { value: entry.id, text: entry.label });
    if (state.configuration.model.length > 0 && !models.some((entry) => entry.id === state.configuration.model)) {
      model.createEl("option", { value: state.configuration.model, text: state.configuration.model });
    }
    model.value = state.configuration.model;
    model.addEventListener("change", () => this.updateSetConfiguration(state.id, { model: model.value }));
    const reasoningLabel = providerRow.createEl("label");
    reasoningLabel.createSpan({ text: "Reasoning" });
    const reasoning = reasoningLabel.createEl("select", { attr: { title: "Reasoning effort is sent explicitly to this set's selected agent." } });
    for (const effort of selectedProvider?.reasoningEfforts ?? []) {
      reasoning.createEl("option", { value: effort, text: displayReasoningEffort(effort) });
    }
    reasoning.value = state.configuration.reasoningEffort;
    reasoning.addEventListener("change", () => this.updateSetConfiguration(state.id, { reasoningEffort: reasoning.value as ReasoningEffort }));

    const focus = container.createEl("label", { cls: "practice-learning-path-focus" });
    focus.createEl("strong", { text: "Local objective comments" });
    focus.createSpan({ text: "This set-specific note is added after the global path context and sibling briefs." });
    const focusInput = focus.createEl("textarea", { attr: { rows: "3", maxlength: String(MAX_FOCUS_INSTRUCTIONS_LENGTH) } });
    focusInput.value = state.configuration.focusInstructions;
    focusInput.addEventListener("input", () => this.updateSetConfiguration(state.id, { focusInstructions: focusInput.value }));

    const mix = container.createDiv({ cls: "practice-learning-path-mix" });
    const mixHeading = mix.createDiv({ cls: "practice-learning-path-subheading" });
    mixHeading.createEl("strong", { text: "Exercise mix" });
    mixHeading.createSpan({ text: "Changing one share automatically rebalances the rest to 100%." });
    const presets = mix.createDiv({ cls: "practice-learning-path-mix-presets" });
    new ButtonComponent(presets).setButtonText("Deep practice").onClick(() => {
      const percentages = copyExerciseTypePercentages(RECOMMENDED_EXERCISE_TYPE_PERCENTAGES);
      state.intendedTypes = new Set(enabledExerciseTypes(percentages));
      state.rememberedPercentages = copyExerciseTypePercentages(percentages);
      this.updateSetConfiguration(state.id, { exerciseTypePercentages: percentages });
      this.render();
    });
    new ButtonComponent(presets).setButtonText("Equal mix").onClick(() => {
      const percentages = balanceExerciseTypes(Object.keys(EXERCISE_LABELS) as ExerciseType[]);
      state.intendedTypes = new Set(enabledExerciseTypes(percentages));
      state.rememberedPercentages = copyExerciseTypePercentages(percentages);
      this.updateSetConfiguration(state.id, { exerciseTypePercentages: percentages });
      this.render();
    });
    for (const [type, label] of Object.entries(EXERCISE_LABELS) as Array<[ExerciseType, string]>) {
      const row = mix.createEl("label", { cls: `practice-learning-path-mix-row${state.configuration.exerciseTypePercentages[type] === 0 ? " is-zero" : ""}` });
      row.createSpan({ text: label });
      const slider = row.createEl("input", {
        attr: { type: "range", min: "0", max: "100", step: "5", draggable: "false" },
      });
      slider.value = String(state.configuration.exerciseTypePercentages[type]);
      row.createEl("output", { text: `${slider.value}%` });
      slider.addEventListener("input", () => {
        const requested = Number.parseInt(slider.value, 10);
        if (requested === 0) state.intendedTypes.delete(type);
        else state.intendedTypes.add(type);
        for (const candidate of enabledExerciseTypes(state.configuration.exerciseTypePercentages)) {
          state.rememberedPercentages[candidate] = state.configuration.exerciseTypePercentages[candidate];
        }
        const percentages = rebalanceExerciseTypePercentageWithIntent(
          state.configuration.exerciseTypePercentages,
          type,
          requested,
          state.intendedTypes,
          state.rememberedPercentages,
        );
        this.updateSetConfiguration(state.id, { exerciseTypePercentages: percentages });
        for (const candidate of Array.from(mix.querySelectorAll<HTMLInputElement>("input[type=range]"))) {
          const candidateType = candidate.dataset.type as ExerciseType | undefined;
          if (candidateType === undefined) continue;
          const value = percentages[candidateType];
          candidate.value = String(value);
          candidate.closest("label")?.classList.toggle("is-zero", value === 0);
          candidate.parentElement?.querySelector("output")?.setText(`${value}%`);
        }
      });
      slider.dataset.type = type;
    }
  }

  private renderSetPayloadPreviews(container: HTMLElement): void {
    const section = this.section(container, "Ready to approve", "Every set uses the complete approved source bundle and path context. Inspect exact payloads only when you need the technical detail.");
    section.addClass("practice-learning-path-set-payload-preview");
    section.tabIndex = -1;
    this.setPayloadPreviewHost = section;
    const payloads = this.disclosure(
      section,
      "set-payloads",
      "Details",
      `${this.setPayloadPreviews.length} exact set ${this.setPayloadPreviews.length === 1 ? "payload" : "payloads"}`,
      false,
    );
    for (const preview of this.setPayloadPreviews) {
      const details = payloads.createEl("details", { cls: "practice-learning-path-payload" });
      this.bindDisclosure(details, `set-payload:${preview.setId}`, false);
      const summary = details.createEl("summary");
      summary.createEl("strong", { text: preview.setTitle });
      const configuration = this.setStates.find((state) => state.id === preview.setId)?.configuration;
      const difficulty = configuration === undefined
        ? "Difficulty not available"
        : displayDifficulty(configuration.difficulty);
      summary.createSpan({ text: `${preview.providerLabel} · ${preview.modelLabel} · ${preview.reasoningEffortLabel} · ${difficulty}` });
      details.createEl("code", { text: preview.payloadHash });
      details.createEl("pre", { text: preview.text });
    }
    const actions = section.createDiv({ cls: "practice-learning-path-actions" });
    new ButtonComponent(actions)
      .setIcon("play")
      .setButtonText(this.busy === "batch" ? "Generating sets sequentially…" : "Approve and generate all sets")
      .setCta()
      .setDisabled(this.busy !== null || this.quickGenerationRecovery !== null)
      .setTooltip("Approve every exact set request and start the recoverable sequential batch.")
      .onClick(() => {
        this.setPayloadsAccepted = true;
        void this.generateAllSets();
      });
  }

  private renderReview(container: HTMLElement): void {
    const blueprint = this.blueprint;
    if (blueprint === null) return;
    const navigator = this.section(container, "Generate and review", "The current set stays in focus. Open Path details or Activity only when you need them.");
    const currentHost = navigator.createDiv({ cls: "practice-learning-path-current-set-host" });
    this.batchCurrentHost = currentHost;
    this.renderCurrentBatchSet(currentHost, blueprint);
    const finishedCount = this.setStates.filter((state) => {
      const status = this.statuses.get(state.id)?.state;
      return status === "review" || status === "saved";
    }).length;
    const pathDetails = this.disclosure(
      navigator,
      "review-path-details",
      "Path details",
      `${finishedCount} of ${this.setStates.length} sets generated`,
      false,
    );
    const nav = pathDetails.createDiv({
      cls: "practice-learning-path-set-navigator",
      attr: {
        "aria-label": "Set generation status",
        "aria-live": "polite",
      },
    });
    this.batchNavigatorHost = nav;
    this.renderBatchNavigator(nav, blueprint);
    const activityHost = navigator.createDiv({
      cls: "practice-learning-path-batch-activity",
      attr: { "aria-live": "polite" },
    });
    this.batchActivityHost = activityHost;
    this.renderActivity(activityHost);
    if (this.busy === "batch") {
      new ButtonComponent(navigator)
        .setIcon("square")
        .setButtonText("Cancel current set and stop batch")
        .setDestructive()
        .onClick(() => void this.options.callbacks.cancelGeneration?.());
    } else if (
      this.recoveryAvailable
      && this.generatedSets.length < this.setStates.length
      && this.options.callbacks.resumeRecoverableBatch !== undefined
    ) {
      new ButtonComponent(navigator)
        .setIcon("history")
        .setButtonText("Retry remaining sets")
        .setCta()
        .onClick(() => void this.resumeRecovery());
    }

    const active = this.generatedSets.find((set) => (
      set.setId === this.activeReviewSetId
      && this.statuses.get(set.setId)?.state !== "saved"
    ))
      ?? this.generatedSets.find((set) => this.statuses.get(set.setId)?.state !== "saved")
      ?? this.generatedSets[0];
    if (active === undefined) {
      const empty = container.createDiv({ cls: "practice-lab-empty" });
      empty.createEl("h3", { text: this.busy === "batch" ? "Generation in progress" : "No completed set yet" });
      empty.createEl("p", { text: "Safe agent activity appears in the navigator as each set is generated and validated." });
      return;
    }
    this.activeReviewSetId = active.setId;
    const brief = blueprint.draft.sets.find((set) => set.id === active.setId);
    const review = this.section(container, brief?.title ?? active.setId, brief?.purpose ?? "Review this generated set before saving.");
    if (this.statuses.get(active.setId)?.state === "saved") {
      const saved = review.createDiv({ cls: "practice-lab-callout is-info" });
      setIcon(saved.createSpan(), "check-circle-2");
      saved.createSpan({
        text: "Every completed set is already saved. Resume or retry the remaining batch from the navigator above.",
      });
      return;
    }
    const approved = this.approvedBySet.get(active.setId) ?? new Set<string>();
    const activeOcclusions = active.exercises.filter((exercise) => (
      !exercise.rejected && exercise.type === "image-occlusion"
    ));
    const acceptedOcclusions = activeOcclusions.filter((exercise) => (
      exercise.occlusionReviewed && validateOcclusionMasks(exercise.masks ?? []).valid
    )).length;
    const toolbar = review.createDiv({ cls: "practice-learning-path-review-toolbar" });
    new ButtonComponent(toolbar)
      .setIcon("list-checks")
      .setButtonText("Approve ready exercises in this set")
      .setTooltip("Approve the ready text exercises in the set you are viewing. Occlusions are included only after their masks were explicitly accepted.")
      .onClick(() => {
        const result = approveReadyLearningPathExercises([
          this.reviewSetInput(active, blueprint),
        ]);
        for (const [setId, ids] of result.approvedBySet) {
          this.approvedBySet.set(setId, new Set(ids));
        }
        const blocker = result.blockers[0];
        if (blocker === undefined) {
          this.reviewFeedback = `All ${result.totalApprovedCount} kept exercises in ${brief?.title ?? active.setId} are approved.`;
        } else {
          this.reviewFeedback = `Approved ${result.newlyApprovedCount} ready ${result.newlyApprovedCount === 1 ? "exercise" : "exercises"} in this set. Next: ${blocker.reason}`;
        }
        this.reviewStateChanged(true);
        this.renderAndFocusReviewFeedback(this.reviewProblem() === null);
      });
    new ButtonComponent(toolbar)
      .setIcon("scan")
      .setButtonText(
        activeOcclusions.length > 0 && acceptedOcclusions === activeOcclusions.length
          ? `Occlusions accepted (${acceptedOcclusions})`
          : `Accept valid occlusions (${acceptedOcclusions}/${activeOcclusions.length})`,
      )
      .setTooltip("Accept every kept occlusion whose current masks are valid. Invalid or missing masks remain blocked.")
      .setDisabled(activeOcclusions.length === 0 || acceptedOcclusions === activeOcclusions.length)
      .onClick(() => {
        const exercises = active.exercises.map((exercise) => {
          if (exercise.rejected || exercise.type !== "image-occlusion") return exercise;
          const valid = validateOcclusionMasks(exercise.masks ?? []).valid;
          if (valid) approved.add(exercise.id);
          return { ...exercise, occlusionReviewed: valid };
        });
        this.generatedSets = this.generatedSets.map((set) => (
          set.setId === active.setId ? { ...set, exercises } : set
        ));
        this.approvedBySet.set(active.setId, approved);
        const remaining = exercises.filter((exercise) => (
          !exercise.rejected
          && exercise.type === "image-occlusion"
          && !exercise.occlusionReviewed
        )).length;
        this.reviewFeedback = remaining === 0
          ? `All occlusion masks in ${brief?.title ?? active.setId} are accepted and their exercises are approved.`
          : `${remaining} ${remaining === 1 ? "occlusion still needs" : "occlusions still need"} a valid mask in ${brief?.title ?? active.setId}.`;
        this.reviewStateChanged(true);
        this.renderAndFocusReviewFeedback(false);
      });
    const moreApproval = toolbar.createEl("details", {
      cls: "practice-learning-path-disclosure practice-learning-path-review-bulk",
    });
    moreApproval.createEl("summary", { text: "More…" });
    const moreApprovalBody = moreApproval.createDiv({
      cls: "practice-learning-path-disclosure-body",
    });
    new ButtonComponent(moreApprovalBody)
      .setIcon("list-checks")
      .setButtonText("Approve ready exercises in all generated sets")
      .setTooltip("Bulk-approve every currently ready text exercise. Occlusions still require explicit mask acceptance.")
      .onClick(() => {
        const result = approveReadyLearningPathExercises(this.reviewSetInputs(blueprint));
        this.approvedBySet = new Map([...result.approvedBySet].map(([setId, ids]) => [
          setId,
          new Set(ids),
        ]));
        const blocker = result.blockers[0];
        if (blocker === undefined) {
          this.reviewFeedback = `All ${result.totalApprovedCount} kept exercises across ${this.generatedSets.length} sets are approved. Checking the complete workspace before saving…`;
        } else {
          this.activeReviewSetId = blocker.setId;
          this.reviewFeedback = `Approved ${result.newlyApprovedCount} ready ${result.newlyApprovedCount === 1 ? "exercise" : "exercises"}. Next: ${blocker.setTitle} — ${blocker.reason}`;
        }
        this.reviewStateChanged(true);
        this.renderAndFocusReviewFeedback(result.blockers.length === 0);
      });
    const activeState = learningPathSetReviewState(this.reviewSetInput(active, blueprint));
    review.createEl("p", {
      cls: "practice-lab-muted",
      text: `${activeState.approvedCount} of ${activeState.keptCount} kept exercises approved in this set. Review this set before moving to another one.`,
    });
    if (this.reviewFeedback !== null) {
      const feedback = review.createDiv({
        cls: "practice-lab-callout is-info practice-learning-path-review-feedback",
        attr: { role: "status", "aria-live": "polite", tabindex: "-1" },
      });
      setIcon(feedback.createSpan(), "info");
      feedback.createSpan({ text: this.reviewFeedback });
    }
    for (const [index, exercise] of active.exercises.entries()) {
      this.renderExerciseReview(review, active, exercise, index, approved);
    }
    const reviewGate = this.reviewProblem();
    const currentRequest = this.currentSaveRequest();
    const currentRequestHash = currentRequest === null
      ? null
      : learningPathSaveRequestHash(currentRequest);
    const currentPreflight = this.savePreflight !== null
      && this.savePreflight.requestHash === currentRequestHash
      ? this.savePreflight
      : null;
    const saveGate = reviewGate
      ?? (this.saveValidationBlocked
        ? "The generated path needs a compatibility repair before it can be saved. Nothing was written."
        : currentPreflight?.state === "invalid"
          ? "The complete workspace did not pass its save check. Open the error details above."
          : currentPreflight?.state === "valid"
            ? null
            : "Checking the complete workspace before enabling save…");
    if (saveGate !== null) {
      const callout = container.createDiv({ cls: "practice-lab-callout is-warning" });
      setIcon(callout.createSpan(), "triangle-alert");
      callout.createSpan({ text: saveGate });
    }
    const actions = container.createDiv({
      cls: "practice-learning-path-actions is-sticky practice-learning-path-save-actions",
      attr: { tabindex: "-1" },
    });
    const partial = this.generatedSets.length < this.setStates.length;
    const saveGuidance = actions.createDiv({ cls: "practice-learning-path-save-guidance" });
    saveGuidance.createEl("strong", {
      text: saveGate === null
        ? partial ? "Completed sets are ready" : "Ready to save"
        : this.saveValidationBlocked || currentPreflight?.state === "invalid"
          ? "Save blocked"
          : reviewGate === null
            ? "Checking workspace"
            : "Review still required",
    });
    saveGuidance.createSpan({
      text: saveGate ?? (partial
        ? "Save the approved completed sets now. The unfinished batch remains recoverable."
        : "All kept exercises and occlusion masks are approved across every set."),
    });
    new ButtonComponent(actions)
      .setIcon("save")
      .setButtonText(this.busy === "save"
        ? "Saving workspace atomically…"
        : partial
          ? "Save completed sets"
          : "Save guided learning path")
      .setCta()
      .setDisabled(saveGate !== null || this.busy !== null)
      .setTooltip(saveGate ?? (partial
        ? "Save completed approved sets without discarding the unfinished recoverable batch."
        : "Save the complete reviewed learning path to its Markdown workspace."))
      .onClick(() => void this.saveLearningPath());
  }

  private renderExerciseReview(
    container: HTMLElement,
    set: GeneratedLearningSetPresentationV1,
    exercise: EditableDraftExercise,
    index: number,
    approved: Set<string>,
  ): void {
    const card = container.createEl("article", { cls: `practice-learning-path-exercise${exercise.rejected ? " is-rejected" : ""}` });
    const heading = card.createDiv({ cls: "practice-learning-path-card-heading" });
    heading.createSpan({ cls: "practice-lab-badge", text: EXERCISE_LABELS[exercise.type] });
    heading.createEl("strong", { text: `Question ${index + 1}` });
    const keep = heading.createEl("label", { cls: "practice-learning-path-keep" });
    const keepInput = keep.createEl("input", { attr: { type: "checkbox" } });
    keepInput.checked = !exercise.rejected;
    const requiredByTutor = set.draft.tutorLessons.some((lesson) => (
      lesson.guidedExerciseId === exercise.id
    ));
    keepInput.disabled = requiredByTutor;
    keep.title = requiredByTutor
      ? "This guided exercise is required by a tutor lesson. Change the path plan before removing it."
      : "Keep or reject this exercise.";
    keep.createSpan({ text: requiredByTutor ? "Required by tutor lesson" : "Keep" });
    keepInput.addEventListener("change", () => {
      if (requiredByTutor) return;
      this.updateReviewExercise(set.setId, exercise.id, { rejected: !keepInput.checked });
      approved.delete(exercise.id);
      this.reviewStateChanged(true);
      this.render();
    });
    if (exercise.rejected) return;
    const prompt = card.createEl("label");
    prompt.createSpan({ text: "Prompt" });
    const promptInput = prompt.createEl("textarea", { attr: { rows: "3" } });
    promptInput.value = exercise.prompt;
    promptInput.addEventListener("input", () => {
      this.updateReviewExercise(set.setId, exercise.id, { prompt: promptInput.value });
      approved.delete(exercise.id);
      this.reviewStateChanged(false);
    });
    const answer = card.createEl("label");
    answer.createSpan({ text: "Grounded answer" });
    const answerInput = answer.createEl("textarea", { attr: { rows: "3" } });
    answerInput.value = exercise.groundedAnswer;
    answerInput.addEventListener("input", () => {
      this.updateReviewExercise(set.setId, exercise.id, { groundedAnswer: answerInput.value });
      approved.delete(exercise.id);
      this.reviewStateChanged(false);
    });
    if (exercise.type === "image-occlusion") {
      if (exercise.visualUrl === undefined) {
        card.createEl("p", { cls: "practice-lab-callout is-error", text: "The selected visual is unavailable; reject this exercise or restore the durable snapshot." });
      } else {
        const editorHost = card.createDiv();
        const editor = new OcclusionEditor(editorHost, {
          imageUrl: exercise.visualUrl,
          imageAlt: exercise.title ?? exercise.prompt,
          masks: exercise.masks ?? [],
          reviewed: exercise.occlusionReviewed,
          onChange: (masks) => {
            approved.delete(exercise.id);
            this.updateReviewExercise(set.setId, exercise.id, { masks, occlusionReviewed: false });
            this.reviewStateChanged(true);
          },
          onReviewed: (masks) => {
            approved.add(exercise.id);
            this.updateReviewExercise(set.setId, exercise.id, { masks, occlusionReviewed: true });
            this.approvedBySet.set(set.setId, approved);
            this.reviewStateChanged(true);
            this.render();
          },
        });
        this.occlusionEditors.push(editor);
        this.addChild(editor);
      }
    } else {
      const approve = new ButtonComponent(card)
        .setIcon(approved.has(exercise.id) ? "check" : "circle-check")
        .setButtonText(approved.has(exercise.id) ? "Approved" : "Approve exercise")
        .setDisabled(approved.has(exercise.id));
      approve.onClick(() => {
        approved.add(exercise.id);
        this.approvedBySet.set(set.setId, approved);
        this.reviewStateChanged(true);
        this.render();
      });
    }
  }

  private renderSaved(container: HTMLElement): void {
    const workspace = this.savedWorkspace;
    const complete = container.createDiv({ cls: "practice-lab-complete" });
    const icon = complete.createDiv({ cls: "practice-lab-complete-icon" });
    setIcon(icon, "route");
    complete.createEl("h3", { text: workspace === null ? "Learning path saved" : "Manage learning path" });
    complete.createEl("p", { text: "Tutor lessons, named sets, exact source provenance, and the editable path now live in the source’s existing practice Markdown workspace." });
    complete.createEl("p", { cls: "practice-lab-muted", text: "Saved paths and review sessions work on mobile. AI planning and generation remain desktop-only." });
    if (workspace === null) return;

    const path = workspace.bank.learningPath;
    if (path === null) {
      container.createEl("p", { cls: "practice-lab-callout is-error", text: "This workspace no longer contains a learning path." });
      return;
    }
    complete.createEl("p", {
      cls: "practice-lab-muted",
      text: `${path.steps.length} path ${path.steps.length === 1 ? "step" : "steps"} · ${workspace.bank.tutorLessons.length} tutor ${workspace.bank.tutorLessons.length === 1 ? "lesson" : "lessons"} · ${workspace.bank.practiceSets.length} named ${workspace.bank.practiceSets.length === 1 ? "set" : "sets"} · ${workspace.bank.exercises.length} total ${workspace.bank.exercises.length === 1 ? "question" : "questions"}.`,
    });
    const studyState = this.options.callbacks.savedWorkspaceStudyState?.(workspace) ?? {
      state: "ready" as const,
      description: "The saved guided path is ready to continue.",
    };
    if (studyState.state !== "ready") {
      const notice = container.createDiv({
        cls: `practice-lab-callout ${studyState.state === "blocked" ? "is-warning" : "is-info"}`,
        attr: { role: "status" },
      });
      notice.createEl("strong", {
        text: studyState.state === "resume"
          ? "A saved session is ready to resume"
          : "Resolve the saved session first",
      });
      notice.createEl("p", { text: studyState.description });
    }
    const actions = container.createDiv({ cls: "practice-learning-path-actions is-sticky" });
    if (studyState.state === "blocked") {
      this.savedAction(
        actions,
        "Open recovery choices",
        "shield-alert",
        "open-bank",
        true,
        "Open the Practice note to review the preserved session before deciding whether to keep or discard it.",
      );
    } else {
      this.savedAction(
        actions,
        studyState.state === "resume" ? "Resume saved session" : "Continue guided path",
        "play",
        "continue",
        true,
        studyState.state === "resume"
          ? "Resume the exact device-local session without losing answers, skips, or tutor progress."
          : "Continue guided path from the locally recommended step. Tutor steps contain one guided problem and continue directly after saving.",
      );
    }
    const moreActions = this.disclosure(
      actions,
      "saved-actions",
      "More actions",
      studyState.state === "ready"
        ? "Choose a set, mix the path, or open its Practice note"
        : "Open the Practice note without changing the preserved session",
      false,
    );
    if (studyState.state === "ready") {
      this.savedAction(
        moreActions,
        "Choose a set",
        "list",
        "choose-set",
        false,
        "Choose any named practice set without progression locks.",
      );
      this.savedAction(
        moreActions,
        "Mixed practice",
        "shuffle",
        "mixed",
        false,
        "Combine every named set without replaying tutor lessons.",
      );
    }
    this.savedAction(
      moreActions,
      "Open Practice note",
      "file-text",
      "open-bank",
      false,
      "Open the readable Practice Markdown workspace with study choices, history, and statistics.",
    );

    const management = this.disclosure(
      container,
      "saved-management",
      "Manage path",
      `${workspace.bank.practiceSets.length} named ${workspace.bank.practiceSets.length === 1 ? "set" : "sets"} · labels and regeneration controls`,
      false,
    );
    const identity = this.section(management, "Path identity", "Rename the path without changing its grounded content, sessions, or source provenance.");
    const title = identity.createEl("input", {
      cls: "practice-learning-path-set-title",
      attr: { type: "text", "aria-label": "Learning-path title" },
    });
    title.value = path.title;
    title.addEventListener("input", () => {
      if (this.savedWorkspace === null || this.savedWorkspace.bank.learningPath === null) return;
      this.savedWorkspace.bank.learningPath.title = title.value;
      this.savedWorkspaceDirty = true;
    });

    const sets = this.section(management, "Named practice sets", "Titles and purposes can be refined here. Exercise assignments, tutor links, and historical evidence keep their stable IDs.");
    for (const set of [...workspace.bank.practiceSets].sort((left, right) => left.order - right.order)) {
      const card = sets.createEl("article", { cls: "practice-learning-path-set-card" });
      const heading = card.createDiv({ cls: "practice-learning-path-set-heading" });
      heading.createSpan({ cls: "practice-learning-path-set-order", text: String(set.order + 1) });
      const text = heading.createDiv();
      const setTitle = text.createEl("input", {
        cls: "practice-learning-path-set-title",
        attr: { type: "text", "aria-label": `Title for ${set.title}` },
      });
      setTitle.value = set.title;
      setTitle.addEventListener("input", () => {
        set.title = setTitle.value;
        this.savedWorkspaceDirty = true;
      });
      text.createSpan({ cls: "practice-lab-badge", text: set.instructionalRole.replaceAll("-", " ") });
      const purpose = card.createEl("textarea", {
        attr: { rows: "2", "aria-label": `Purpose for ${set.title}` },
      });
      purpose.value = set.purpose;
      purpose.addEventListener("input", () => {
        set.purpose = purpose.value;
        this.savedWorkspaceDirty = true;
      });
      const lessonCount = workspace.bank.tutorLessons.filter((lesson) => (
        set.assignments.some((assignment) => assignment.exerciseId === lesson.guidedExerciseId)
      )).length;
      card.createEl("p", {
        cls: "practice-lab-muted",
        text: `${set.assignments.length} ${set.assignments.length === 1 ? "exercise" : "exercises"} · ${lessonCount} tutor ${lessonCount === 1 ? "lesson" : "lessons"}`,
      });
      if (this.options.callbacks.regenerateSavedSet !== undefined) {
        new ButtonComponent(card)
          .setIcon("refresh-cw")
          .setButtonText("Regenerate / tweak this set")
          .setDisabled(this.busy !== null)
          .onClick(() => {
            if (this.savedWorkspaceDirty) {
              new Notice("Save the edited path labels before regenerating a set.", 6_000);
              return;
            }
            if (this.savedWorkspace !== null) {
              void this.options.callbacks.regenerateSavedSet?.(
                this.savedWorkspace,
                set.id,
              );
            }
          });
      }
    }
    if (this.options.callbacks.saveManagedWorkspace !== undefined) {
      new ButtonComponent(sets)
        .setIcon("save")
        .setButtonText(this.busy === "save" ? "Saving changes…" : "Save path labels")
        .setCta()
        .setDisabled(!this.savedWorkspaceDirty || this.busy !== null)
        .onClick(() => void this.saveManagedWorkspace());
    }
  }

  private savedAction(
    container: HTMLElement,
    label: string,
    icon: string,
    action: "continue" | "choose-set" | "mixed" | "open-bank",
    cta: boolean,
    tooltip: string,
  ): void {
    const button = new ButtonComponent(container)
      .setIcon(icon)
      .setButtonText(label)
      .setTooltip(tooltip)
      .setDisabled(this.busy !== null)
      .onClick(() => {
        if (this.savedWorkspace !== null) {
          void this.options.callbacks.useSavedWorkspace?.(this.savedWorkspace, action);
        }
      });
    if (cta) button.setCta();
  }

  private async saveManagedWorkspace(): Promise<void> {
    const workspace = this.savedWorkspace;
    const save = this.options.callbacks.saveManagedWorkspace;
    if (workspace === null || save === undefined || this.busy !== null) return;
    this.busy = "save";
    this.error = null;
    this.render();
    try {
      this.savedWorkspace = await save({
        path: workspace.path,
        bank: structuredClone(workspace.bank),
      });
      this.savedWorkspaceDirty = false;
      new Notice("Learning-path labels saved.", 6_000);
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private renderProviderControls(container: HTMLElement): void {
    const grid = container.createDiv({ cls: "practice-learning-path-provider-grid" });
    const providerLabel = grid.createEl("label");
    providerLabel.createSpan({ text: "Planning provider" });
    const provider = providerLabel.createEl("select");
    for (const entry of this.providers) {
      const option = provider.createEl("option", { value: entry.id, text: entry.available ? entry.label : `${entry.label} (unavailable)` });
      option.disabled = !entry.available;
    }
    provider.value = this.blueprintConfiguration.provider;
    provider.addEventListener("change", () => {
      const id = provider.value as ProviderId;
      const selected = this.providers.find((entry) => entry.id === id);
      this.blueprintConfiguration = {
        ...this.blueprintConfiguration,
        provider: id,
        model: selected?.defaultModel ?? "",
        reasoningEffort: selected?.reasoningEfforts[0] ?? "medium",
      };
      this.invalidateSourceAlignment();
      this.render();
    });
    const selected = this.providers.find((entry) => entry.id === this.blueprintConfiguration.provider);
    const modelLabel = grid.createEl("label");
    modelLabel.createSpan({ text: "Planning model" });
    const model = modelLabel.createEl("select");
    for (const entry of selected?.models ?? []) model.createEl("option", { value: entry.id, text: entry.label });
    if ((selected?.models.length ?? 0) === 0) model.createEl("option", { value: "", text: "Automatic" });
    model.value = this.blueprintConfiguration.model;
    model.addEventListener("change", () => {
      this.blueprintConfiguration = { ...this.blueprintConfiguration, model: model.value };
      this.invalidateSourceAlignment();
      this.render();
    });
    const reasoningLabel = grid.createEl("label");
    reasoningLabel.createSpan({ text: "Planning reasoning" });
    const reasoning = reasoningLabel.createEl("select", { attr: { title: "Higher reasoning may take longer. The installed default timeout is three hours." } });
    for (const effort of selected?.reasoningEfforts ?? []) reasoning.createEl("option", { value: effort, text: displayReasoningEffort(effort) });
    reasoning.value = this.blueprintConfiguration.reasoningEffort;
    reasoning.addEventListener("change", () => {
      this.blueprintConfiguration = { ...this.blueprintConfiguration, reasoningEffort: reasoning.value as ReasoningEffort };
      this.invalidateSourceAlignment();
      this.render();
    });
  }

  private renderSourceChoiceButtons(container: HTMLElement): void {
    renderSourceChoices(container, {
      availableModes: new Set<SourceChoiceMode>(["note", "selection", "pdf"]),
      busyMode: this.primarySourceChoiceBusy,
      disabled: this.busy !== null,
      onChoose: (mode) => {
        void this.choosePrimarySource(mode);
      },
    });
  }

  private renderSourceCard(
    container: HTMLElement,
    source: SourcePresentation,
    role: string,
    remove: () => void,
    includeVisuals = true,
    chooseAnotherNote?: () => void,
  ): void {
    const card = renderSourceSummaryCard(container, source, {
      badge: role,
      removeLabel: `Remove ${role.toLowerCase()} source`,
      removeDisabled: this.busy !== null || this.visualSelectionBusy,
      onRemove: remove,
      ...(chooseAnotherNote === undefined ? {} : {
        actionLabel: "Choose another note…",
        actionDescription: "Search the vault and replace the primary source with a different complete Markdown note.",
        actionDisabled: this.busy !== null,
        onAction: chooseAnotherNote,
      }),
    });
    if (includeVisuals) this.renderSourceVisuals(card, source);
  }

  private sourceClassificationSummary(sources: readonly SourcePresentation[]): string {
    const counts = new Map<SourceMaterialClassificationV1, number>();
    for (const source of sources) {
      const classification = source.classification ?? "unclassified";
      counts.set(classification, (counts.get(classification) ?? 0) + 1);
    }
    return [...counts].map(([classification, count]) => {
      const singular = SOURCE_CLASSIFICATION_LABELS[classification].toLocaleLowerCase();
      const label = classification === "unclassified"
        ? `${singular} source${count === 1 ? "" : "s"}`
        : `${singular}${count === 1 ? "" : "s"}`;
      return `${count} ${label}`;
    }).join(" · ");
  }

  private renderSourceClassification(
    container: HTMLElement,
    source: SourcePresentation,
  ): void {
    const classification = source.classification ?? "unclassified";
    const confirmed = source.classificationState === "confirmed";
    const row = container.createDiv({
      cls: `practice-learning-path-source-label${confirmed ? " is-confirmed" : " is-unconfirmed"}`,
    });
    const copy = row.createDiv({ cls: "practice-learning-path-source-label-copy" });
    copy.createEl("strong", { text: source.title });
    const state = copy.createSpan({
      text: confirmed
        ? `${SOURCE_CLASSIFICATION_LABELS[classification]} · Confirmed`
        : `${SOURCE_CLASSIFICATION_LABELS[classification]} · Confirmation needed`,
    });
    const controls = row.createDiv({ cls: "practice-learning-path-source-label-controls" });
    const select = controls.createEl("select", {
      attr: { "aria-label": `Source label for ${source.title}` },
    });
    for (const [value, label] of Object.entries(SOURCE_CLASSIFICATION_LABELS)) {
      select.createEl("option", { value, text: label });
    }
    select.value = classification;
    const callback = this.options.callbacks.confirmSourceClassification;
    const confirm = new ButtonComponent(controls)
      .setIcon("check")
      .setButtonText(confirmed ? "Confirmed" : "Confirm")
      .setCta()
      .setDisabled(callback === undefined || confirmed);
    const status = row.createEl("p", {
      cls: "practice-learning-path-source-label-status",
      attr: { role: "status", "aria-live": "polite" },
    });
    select.addEventListener("change", () => {
      confirm.setButtonText("Confirm");
      confirm.setDisabled(callback === undefined);
      state.setText(`${SOURCE_CLASSIFICATION_LABELS[select.value as SourceMaterialClassificationV1]} · Not yet confirmed`);
      status.setText("");
    });
    confirm.onClick(() => {
      if (callback === undefined) return;
      const selected = select.value as SourceMaterialClassificationV1;
      confirm.setDisabled(true).setButtonText("Saving…");
      void Promise.resolve()
        .then(() => callback(source, selected))
        .then((updated) => {
          if (this.primary !== null && sameSourceScope(this.primary, source)) {
            this.primary = updated;
          }
          this.supporting = this.supporting.map((candidate) => (
            sameSourceScope(candidate, source) ? updated : candidate
          ));
          this.invalidateSourceAlignment();
          this.render();
        })
        .catch((error: unknown) => {
          confirm.setDisabled(false).setButtonText("Confirm");
          status.setText(`Could not confirm this label. ${errorMessage(error)}`);
        });
    });
  }

  private renderVisualBundleControls(container: HTMLElement): void {
    const sources = this.approvedSources();
    const visualCount = sources.reduce((total, source) => total + source.visuals.length, 0);
    if (visualCount === 0) {
      container.createEl("p", {
        cls: "practice-lab-muted practice-learning-path-visual-empty",
        text: "No separate supported visual was detected in the approved bundle. PDF text remains limited to the chosen page range.",
      });
      return;
    }

    const selectedCount = sources.reduce(
      (total, source) => total + source.visuals.filter((visual) => visual.selected).length,
      0,
    );
    const toolbar = container.createDiv({ cls: "practice-learning-path-visual-toolbar" });
    const defaultLabel = toolbar.createEl("label", { cls: "practice-learning-path-gif-default" });
    defaultLabel.createSpan({ text: "Default GIF frame" });
    const defaultSelect = defaultLabel.createEl("select", {
      attr: {
        "aria-label": "Default GIF frame for newly selected animations",
        "aria-description": "Select all images uses this frame automatically. You can still choose a different frame on any GIF.",
      },
    });
    for (const position of GIF_FRAME_POSITIONS) {
      defaultSelect.createEl("option", {
        value: position,
        text: displayGifFramePosition(position),
      });
    }
    defaultSelect.value = this.gifFrameDefault;
    defaultSelect.disabled = this.visualSelectionBusy;
    defaultSelect.addEventListener("change", () => {
      void this.setGifFrameDefault(defaultSelect.value as GifFramePosition);
    });

    new ButtonComponent(toolbar)
      .setIcon("list-checks")
      .setButtonText(this.visualSelectionBusy ? "Updating images…" : "Select all images")
      .setTooltip("Select every available local image. GIFs without an explicit frame use the configured default; existing overrides are preserved. Videos and remote images still require explicit review.")
      .setDisabled(this.visualSelectionBusy || this.busy !== null)
      .onClick(() => void this.selectAllSourceImages());
    new ButtonComponent(toolbar)
      .setIcon("square-x")
      .setButtonText("Deselect all")
      .setTooltip("Remove every visual from the planning and set-generation payloads without changing the source files.")
      .setDisabled(this.visualSelectionBusy || this.busy !== null || selectedCount === 0)
      .onClick(() => void this.deselectAllSourceImages());
    toolbar.createSpan({
      cls: "practice-learning-path-visual-count",
      text: `${selectedCount} of ${visualCount} selected`,
      attr: { "aria-live": "polite" },
    });
    if (this.visualSelectionMessage !== null) {
      container.createEl("p", {
        cls: "practice-lab-muted practice-learning-path-visual-message",
        text: this.visualSelectionMessage,
        attr: { "aria-live": "polite" },
      });
    }
  }

  private renderSourceVisuals(container: HTMLElement, source: SourcePresentation): void {
    if (source.visuals.length === 0) return;
    const selected = source.visuals.filter((visual) => visual.selected).length;
    const details = container.createEl("details", { cls: "practice-learning-path-visuals" });
    const scopeKey = this.sourceScopeKey(source);
    details.open = this.expandedVisualSources.has(scopeKey);
    details.addEventListener("toggle", () => {
      if (details.open) this.expandedVisualSources.add(scopeKey);
      else this.expandedVisualSources.delete(scopeKey);
    });
    const summary = details.createEl("summary");
    const summaryIcon = summary.createSpan({ cls: "practice-learning-path-visual-summary-icon" });
    setIcon(summaryIcon, "images");
    summary.createSpan({
      text: `${source.visuals.length} detected ${source.visuals.length === 1 ? "visual" : "visuals"}`,
    });
    summary.createSpan({
      cls: "practice-learning-path-visual-summary-count",
      text: `${selected} selected`,
    });
    const grid = details.createDiv({ cls: "practice-learning-path-visual-grid" });
    for (const visual of source.visuals) this.renderVisualCard(grid, source, visual);
  }

  private renderVisualCard(
    container: HTMLElement,
    source: SourcePresentation,
    visual: DetectedVisual,
  ): void {
    const card = container.createEl("article", {
      cls: `practice-learning-path-visual-card is-${visual.state}${visual.selected ? " is-selected" : ""}`,
    });
    if (visual.previewUrl !== undefined) {
      card.createEl("img", {
        cls: "practice-learning-path-visual-preview",
        attr: {
          src: visual.previewUrl,
          alt: `Preview of ${displayVisualName(visual)}`,
          loading: "lazy",
        },
      });
    } else {
      const placeholder = card.createDiv({ cls: "practice-learning-path-visual-placeholder", attr: { "aria-hidden": "true" } });
      setIcon(placeholder, visual.kind === "video" ? "video" : "image-off");
    }
    const heading = card.createDiv({ cls: "practice-learning-path-visual-heading" });
    const copy = heading.createDiv();
    copy.createEl("strong", { text: displayVisualName(visual) });
    copy.createSpan({ text: VISUAL_LABELS[visual.kind] });
    heading.createSpan({
      cls: "practice-lab-status-pill",
      text: visual.state.replaceAll("-", " "),
    });
    if (visual.reason !== undefined) {
      card.createEl("p", { cls: "practice-learning-path-visual-reason", text: visual.reason });
    }

    const controls = card.createDiv({ cls: "practice-learning-path-visual-controls" });
    if (visual.state === "ready") {
      const label = controls.createEl("label", { cls: "practice-lab-checkbox" });
      const checkbox = label.createEl("input", {
        attr: {
          type: "checkbox",
          "aria-label": `Use ${displayVisualName(visual)} for generation`,
        },
      });
      checkbox.checked = visual.selected;
      checkbox.disabled = this.visualSelectionBusy || this.busy !== null;
      label.createSpan({ text: "Use for generation" });
      checkbox.addEventListener("change", () => {
        void this.commitVisual(source, { ...visual, selected: checkbox.checked });
      });
      if (isGifVisual(visual)) this.renderGifFrameChoice(controls, source, visual);
      else if (visual.frameSourcePath !== undefined) {
        new ButtonComponent(controls)
          .setIcon("scan-line")
          .setButtonText("Choose another still")
          .setTooltip("Open the video frame picker. The original video is never modified.")
          .setDisabled(this.visualSelectionBusy || this.busy !== null || this.options.callbacks.chooseMediaFrame === undefined)
          .onClick(() => void this.resolveVisualFrame(source, visual));
      }
      return;
    }

    if (visual.state === "frame-required") {
      if (isGifVisual(visual)) {
        card.createEl("p", {
          cls: "practice-learning-path-visual-help",
          text: `Selecting this GIF will extract the ${displayGifFramePosition(this.gifFrameDefault).toLowerCase()} by default. Choose another position here whenever this animation needs a different frame.`,
        });
        this.renderGifFrameChoice(controls, source, visual);
      } else {
        card.createEl("p", {
          cls: "practice-learning-path-visual-help",
          text: "Videos are never uploaded directly. Choose one still frame explicitly; the original video remains unchanged.",
        });
        new ButtonComponent(controls)
          .setIcon("scan-line")
          .setButtonText("Choose still frame")
          .setTooltip("Open sampled video frames and select the exact still image to use.")
          .setDisabled(this.visualSelectionBusy || this.busy !== null || this.options.callbacks.chooseMediaFrame === undefined)
          .onClick(() => void this.resolveVisualFrame(source, visual));
      }
      return;
    }

    if (visual.state === "consent-required") {
      const host = visual.remoteHost ?? "the remote host";
      card.createEl("p", {
        cls: "practice-learning-path-visual-help",
        text: `This image stays excluded until you explicitly preview and import one local snapshot from ${host}. The source note is not rewritten.`,
      });
      if (this.options.callbacks.importRemoteVisual !== undefined) {
        new ButtonComponent(controls)
          .setIcon("download")
          .setButtonText("Preview and import…")
          .setTooltip(`Preview the remote image from ${host}, then choose whether to preserve a local snapshot.`)
          .setDisabled(this.visualSelectionBusy || this.busy !== null)
          .onClick(() => void this.importRemoteSourceVisual(source, visual));
      } else {
        controls.createSpan({ cls: "practice-lab-muted", text: "Remote import is unavailable on this device." });
      }
      return;
    }

    const unavailable = visual.state === "cache-missing"
      ? "The Notability cache preview is missing. Refresh that region before building this path."
      : visual.state === "missing"
        ? "The local attachment could not be resolved. Restore or relink it in the source note first."
        : "This visual is invalid and cannot be sent to an AI provider.";
    card.createEl("p", { cls: "practice-learning-path-visual-help", text: unavailable });
  }

  private renderGifFrameChoice(
    container: HTMLElement,
    source: SourcePresentation,
    visual: DetectedVisual,
  ): void {
    const label = container.createEl("label", { cls: "practice-learning-path-frame-choice" });
    label.createSpan({ text: "GIF frame" });
    const select = label.createEl("select", {
      attr: {
        "aria-label": `GIF frame for ${displayVisualName(visual)}`,
        "aria-description": "This choice overrides the configured default for this GIF only.",
      },
    });
    for (const position of GIF_FRAME_POSITIONS) {
      select.createEl("option", {
        value: position,
        text: `${displayGifFramePosition(position)}${position === this.gifFrameDefault ? " (default)" : ""}`,
      });
    }
    select.value = visual.framePosition ?? this.gifFrameDefault;
    select.disabled = this.visualSelectionBusy
      || this.busy !== null
      || this.options.callbacks.chooseMediaFrame === undefined;
    select.addEventListener("change", () => {
      void this.resolveVisualFrame(source, visual, select.value as GifFramePosition);
    });
  }

  private approvedSources(): SourcePresentation[] {
    return this.primary === null ? [] : [this.primary, ...this.supporting];
  }

  private pdfBudgetLimits(): PdfSourceBudgetLimitsV1 {
    return {
      maxPages: this.options.defaults.pdfMaxPageCount,
      maxCharacters: this.options.defaults.pdfMaxExtractedCharacters,
    };
  }

  private pdfBudgetProblem(): PdfSourceBudgetProblemV1 | null {
    return pdfSourceBudgetProblem(this.approvedSources(), this.pdfBudgetLimits());
  }

  private pdfBudgetUsage(): PdfSourceBudgetUsageV1 | null {
    try {
      return pdfSourceBudgetUsage(this.approvedSources(), this.pdfBudgetLimits());
    } catch {
      return null;
    }
  }

  private renderPdfBudget(
    container: HTMLElement,
    usage: PdfSourceBudgetUsageV1 | null,
    problem: PdfSourceBudgetProblemV1 | null,
  ): void {
    const limits = this.pdfBudgetLimits();
    const budget = container.createDiv({
      cls: `practice-learning-path-pdf-budget${problem === null ? "" : " is-error"}`,
      attr: { role: "status", "aria-live": "polite" },
    });
    budget.createEl("strong", { text: "Shared PDF budget" });
    if (usage === null) {
      budget.createSpan({ text: problem?.message ?? "PDF budget metadata is unavailable." });
      return;
    }
    budget.createSpan({
      text: `${usage.pageCount.toLocaleString()} of ${limits.maxPages.toLocaleString()} pages · ${usage.characterCount.toLocaleString()} of ${limits.maxCharacters.toLocaleString()} extracted characters`,
    });
    budget.createEl("small", {
      text: usage.pdfSourceCount === 0
        ? "No PDF pages selected yet."
        : `${usage.remainingPages.toLocaleString()} pages and ${usage.remainingCharacters.toLocaleString()} characters remain for additional PDFs.`,
    });
    if (problem !== null) budget.createEl("small", { text: problem.message });
  }

  private sourceScopeKey(source: SourcePresentation): string {
    return JSON.stringify([
      source.mode,
      source.path,
      source.title,
      source.detail ?? "",
      source.pdfPageSelection ?? null,
      source.excerpt,
    ]);
  }

  private currentSource(source: SourcePresentation): SourcePresentation | null {
    return this.approvedSources().find((candidate) => sameSourceScope(candidate, source)) ?? null;
  }

  private applySourcePresentation(
    previous: SourcePresentation,
    replacement: SourcePresentation,
  ): void {
    if (this.primary !== null && sameSourceScope(this.primary, previous)) {
      this.primary = replacement;
      return;
    }
    this.supporting = this.supporting.map((source) => (
      sameSourceScope(source, previous) ? replacement : source
    ));
  }

  private async syncSourcePresentation(
    previous: SourcePresentation,
    replacement: SourcePresentation,
  ): Promise<SourcePresentation> {
    const update = this.options.callbacks.updateSourceVisuals;
    if (update === undefined) return replacement;
    const synced = await update(replacement);
    if (!sameSourceScope(previous, synced)) {
      throw new Error("The updated visual selection no longer matches its approved source scope.");
    }
    return synced;
  }

  private async commitVisual(
    source: SourcePresentation,
    replacement: DetectedVisual,
  ): Promise<void> {
    if (this.visualSelectionBusy || this.busy !== null) return;
    const current = this.currentSource(source);
    if (current === null) return;
    const updated = replaceLearningPathVisual(current, replacement);
    this.visualSelectionBusy = true;
    this.visualSelectionMessage = null;
    this.applySourcePresentation(current, updated);
    this.render();
    try {
      const synced = await this.syncSourcePresentation(current, updated);
      this.applySourcePresentation(updated, synced);
      this.invalidatePlanningPreview();
    } catch (error) {
      this.applySourcePresentation(updated, current);
      this.visualSelectionMessage = `The visual change was not saved: ${errorMessage(error)}`;
      new Notice(this.visualSelectionMessage, 8_000);
    } finally {
      this.visualSelectionBusy = false;
      this.render();
    }
  }

  private async resolveVisualFrame(
    source: SourcePresentation,
    visual: DetectedVisual,
    position?: GifFramePosition,
  ): Promise<void> {
    const choose = this.options.callbacks.chooseMediaFrame;
    if (choose === undefined || this.visualSelectionBusy || this.busy !== null) return;
    this.visualSelectionBusy = true;
    this.visualSelectionMessage = null;
    this.render();
    try {
      const resolved = await choose(visual, position);
      if (resolved === null) return;
      const current = this.currentSource(source);
      if (current === null) return;
      const updated = replaceLearningPathVisual(current, resolved);
      const synced = await this.syncSourcePresentation(current, updated);
      this.applySourcePresentation(current, synced);
      this.invalidatePlanningPreview();
    } catch (error) {
      this.visualSelectionMessage = `Could not prepare that frame: ${errorMessage(error)}`;
      new Notice(this.visualSelectionMessage, 8_000);
    } finally {
      this.visualSelectionBusy = false;
      this.render();
    }
  }

  private async importRemoteSourceVisual(
    source: SourcePresentation,
    visual: DetectedVisual,
  ): Promise<void> {
    const importer = this.options.callbacks.importRemoteVisual;
    if (importer === undefined || this.visualSelectionBusy || this.busy !== null) return;
    this.visualSelectionBusy = true;
    this.visualSelectionMessage = null;
    this.render();
    try {
      const imported = await importer(visual);
      if (imported === null) return;
      const current = this.currentSource(source);
      if (current === null) return;
      const updated = replaceLearningPathVisual(current, imported);
      const synced = await this.syncSourcePresentation(current, updated);
      this.applySourcePresentation(current, synced);
      this.invalidatePlanningPreview();
    } catch (error) {
      this.visualSelectionMessage = `Could not import that remote image: ${errorMessage(error)}`;
      new Notice(this.visualSelectionMessage, 8_000);
    } finally {
      this.visualSelectionBusy = false;
      this.render();
    }
  }

  private async setGifFrameDefault(position: GifFramePosition): Promise<void> {
    if (this.visualSelectionBusy) return;
    const previous = this.gifFrameDefault;
    this.visualSelectionBusy = true;
    this.gifFrameDefault = position;
    this.visualSelectionMessage = `Newly selected GIFs will use the ${displayGifFramePosition(position).toLowerCase()}. Existing per-GIF choices are unchanged.`;
    this.render();
    try {
      await this.options.callbacks.updateGifFrameDefault?.(position);
    } catch (error) {
      this.gifFrameDefault = previous;
      this.visualSelectionMessage = `Could not save the GIF default: ${errorMessage(error)}`;
      new Notice(this.visualSelectionMessage, 8_000);
    } finally {
      this.visualSelectionBusy = false;
      this.render();
    }
  }

  private async selectAllSourceImages(): Promise<void> {
    if (this.visualSelectionBusy || this.busy !== null) return;
    const choose = this.options.callbacks.chooseMediaFrame;
    const originals = this.approvedSources();
    this.visualSelectionBusy = true;
    this.visualSelectionMessage = null;
    this.render();
    let selectedCount = 0;
    let skippedCount = 0;
    const failures: string[] = [];
    try {
      for (const original of originals) {
        let updated = original;
        for (const visual of original.visuals) {
          if (visual.state === "ready") {
            updated = replaceLearningPathVisual(updated, { ...visual, selected: true });
            selectedCount += 1;
            continue;
          }
          if (visual.state === "frame-required" && isGifVisual(visual) && choose !== undefined) {
            try {
              const resolved = await choose(visual, this.gifFrameDefault);
              if (resolved !== null) {
                updated = replaceLearningPathVisual(updated, resolved);
                selectedCount += 1;
                continue;
              }
            } catch (error) {
              failures.push(`${displayVisualName(visual)}: ${errorMessage(error)}`);
            }
          }
          skippedCount += 1;
        }
        const synced = await this.syncSourcePresentation(original, updated);
        this.applySourcePresentation(original, synced);
      }
      this.invalidatePlanningPreview();
      this.visualSelectionMessage = skippedCount === 0
        ? `Selected all ${selectedCount} detected visuals.`
        : `Selected ${selectedCount} available visuals. ${skippedCount} ${skippedCount === 1 ? "visual still requires" : "visuals still require"} explicit review or is unavailable.`;
      for (const failure of failures) new Notice(`Could not prepare ${failure}`, 8_000);
    } catch (error) {
      for (const original of originals) {
        const current = this.currentSource(original);
        if (current !== null) this.applySourcePresentation(current, original);
        try {
          await this.options.callbacks.updateSourceVisuals?.(original);
        } catch {
          // Preserve the local approved bundle and surface the original failure.
        }
      }
      this.visualSelectionMessage = `The bulk visual selection was not saved: ${errorMessage(error)}`;
      new Notice(this.visualSelectionMessage, 8_000);
    } finally {
      this.visualSelectionBusy = false;
      this.render();
    }
  }

  private async deselectAllSourceImages(): Promise<void> {
    if (this.visualSelectionBusy || this.busy !== null) return;
    const originals = this.approvedSources();
    this.visualSelectionBusy = true;
    this.visualSelectionMessage = null;
    this.render();
    try {
      for (const original of originals) {
        const updated = setLearningPathVisualSelection(original, false);
        const synced = await this.syncSourcePresentation(original, updated);
        this.applySourcePresentation(original, synced);
      }
      this.invalidatePlanningPreview();
      this.visualSelectionMessage = "All visuals are excluded from the AI payload. Original files are unchanged.";
    } catch (error) {
      for (const original of originals) {
        const current = this.currentSource(original);
        if (current !== null) this.applySourcePresentation(current, original);
        try {
          await this.options.callbacks.updateSourceVisuals?.(original);
        } catch {
          // Preserve the local approved bundle and surface the original failure.
        }
      }
      this.visualSelectionMessage = `The bulk visual change was not saved: ${errorMessage(error)}`;
      new Notice(this.visualSelectionMessage, 8_000);
    } finally {
      this.visualSelectionBusy = false;
      this.render();
    }
  }

  private renderActivity(container: HTMLElement): void {
    const groups = [...this.activity.values()].filter((events) => events.length > 0);
    const allEvents = groups.flat();
    const events = allEvents.slice(-12);
    if (events.length === 0) return;
    const details = container.createEl("details", { cls: "practice-learning-path-activity" });
    this.bindDisclosure(details, "activity", false);
    const summary = details.createEl("summary");
    summary.createSpan({ text: "Activity" });
    const summaryMeta = summary.createSpan({ cls: "practice-learning-path-activity-summary" });
    const startedAt = activityBoundary(allEvents, "first") ?? Date.now();
    const finishedAt = this.aiActivityIsRunning()
      ? undefined
      : activityBoundary(allEvents, "last") ?? Date.now();
    const telemetry = combineGenerationTelemetry(
      groups.flatMap((group) => {
        const item = generationTelemetryFromActivity(group);
        return item === undefined ? [] : [item];
      }),
    );
    const elapsed = (finishedAt ?? Date.now()) - startedAt;
    let elapsedMetric: HTMLElement | undefined;
    const refreshSummary = (): void => {
      const liveElapsed = (finishedAt ?? Date.now()) - startedAt;
      summaryMeta.setText(
        `${formatGenerationDuration(liveElapsed)}`
        + (telemetry === undefined
          ? ""
          : ` · ${telemetry.tokenUsage.source === "provider-reported" ? "" : "~"}${compactTelemetryTokens(tokenUsageTotal(telemetry.tokenUsage))} tokens`),
      );
      elapsedMetric?.setText(formatGenerationDuration(liveElapsed));
    };
    this.activitySummaryRefreshers.push({ element: summaryMeta, refresh: refreshSummary });
    this.ensureActivityClock();
    if (telemetry !== undefined) {
      const metrics = details.createDiv({
        cls: "practice-lab-generation-telemetry",
        attr: { "aria-label": "Guided generation usage summary" },
      });
      elapsedMetric = telemetryMetric(metrics, "Elapsed", formatGenerationDuration(elapsed));
      telemetryMetric(metrics, "Tokens", formatTokenUsage(telemetry.tokenUsage));
      telemetryMetric(metrics, "Cost", formatGenerationCost(telemetry));
      telemetryMetric(
        metrics,
        "Provider work",
        `${telemetry.jobCount} ${telemetry.jobCount === 1 ? "job" : "jobs"} · ${telemetry.providerAttemptCount} ${telemetry.providerAttemptCount === 1 ? "attempt" : "attempts"}`,
      );
      if (telemetry.tokenUsage.source !== "provider-reported") {
        metrics.createDiv({
          cls: "practice-lab-generation-telemetry-note",
          text: `~ covers submitted text and visible structured output only. Hidden reasoning and provider/tool overhead${telemetry.tokenUsage.inputEstimateExcludesMedia ? ", including visual tokenization," : ""} are not included.`,
        });
      }
    }
    refreshSummary();
    const list = details.createEl("ol");
    for (const event of events) {
      const occurredAt = Date.parse(event.occurredAt);
      list.createEl("li", {
        text: `${Number.isFinite(occurredAt) ? `+${formatGenerationDuration(Math.max(0, occurredAt - startedAt))} · ` : ""}${event.phase}: ${event.message}`,
      });
    }
  }

  private aiActivityIsRunning(): boolean {
    return this.busy === "alignment"
      || this.busy === "blueprint"
      || this.busy === "batch"
      || this.busy === "recovery";
  }

  private ensureActivityClock(): void {
    if (!this.aiActivityIsRunning() || this.activityClock !== undefined) return;
    this.activityClock = window.setInterval(() => {
      this.activitySummaryRefreshers = this.activitySummaryRefreshers.filter(
        (item) => item.element.isConnected,
      );
      for (const item of this.activitySummaryRefreshers) item.refresh();
      if (!this.aiActivityIsRunning()) this.clearActivityClock();
    }, 1_000);
  }

  private clearActivityClock(): void {
    if (this.activityClock === undefined) return;
    window.clearInterval(this.activityClock);
    this.activityClock = undefined;
  }

  private currentBatchSetState(): EditableSetState | null {
    const activeStatus = ["generating", "validating", "failed"];
    return this.setStates.find((state) => (
      activeStatus.includes(this.statuses.get(state.id)?.state ?? "")
    ))
      ?? this.setStates.find((state) => state.id === this.activeReviewSetId)
      ?? this.setStates.find((state) => this.statuses.get(state.id)?.state === "queued")
      ?? this.setStates[0]
      ?? null;
  }

  private renderBatchNavigator(
    container: HTMLElement,
    blueprint: LearningBlueprintPresentationV1,
  ): void {
    container.replaceChildren();
    for (const state of this.setStates) {
      const brief = blueprint.draft.sets.find((set) => set.id === state.id);
      if (brief === undefined) continue;
      const status = this.statuses.get(state.id) ?? { state: "queued" as const };
      const generated = this.generatedSets.find((set) => set.setId === state.id);
      const available = generated !== undefined;
      const reviewState = generated === undefined
        ? null
        : learningPathSetReviewState(this.reviewSetInput(generated, blueprint));
      const button = container.createEl("button", {
        cls: `practice-learning-path-nav-item is-${status.state}`,
        attr: {
          type: "button",
          title: available
            ? `Review ${brief.title}`
            : `${brief.title}: ${statusLabel(status)}. Review opens after generation completes.`,
          "aria-current": this.activeReviewSetId === state.id ? "true" : "false",
        },
      });
      button.disabled = !available;
      const icon = button.createSpan({
        cls: `practice-learning-path-nav-icon${status.state === "generating" ? " practice-lab-spinner" : ""}`,
        attr: { "aria-hidden": "true" },
      });
      setIcon(icon, statusIcon(status.state));
      button.createEl("strong", {
        cls: "practice-learning-path-nav-title",
        text: brief.title,
      });
      button.createSpan({
        cls: "practice-learning-path-nav-status",
        text: reviewState === null
          ? statusLabel(status)
          : `${statusLabel(status)} · ${reviewState.approvedCount}/${reviewState.keptCount} approved`,
      });
      button.addEventListener("click", () => {
        if (!available) return;
        this.activeReviewSetId = state.id;
        this.render();
      });
    }
  }

  private renderCurrentBatchSet(
    container: HTMLElement,
    blueprint: LearningBlueprintPresentationV1,
  ): void {
    container.replaceChildren();
    const currentState = this.currentBatchSetState();
    if (currentState === null) return;
    const brief = blueprint.draft.sets.find((set) => set.id === currentState.id);
    const status = this.statuses.get(currentState.id) ?? { state: "queued" as const };
    const current = container.createDiv({
      cls: `practice-learning-path-current-set is-${status.state}`,
      attr: { role: "status", "aria-live": "polite" },
    });
    const icon = current.createSpan({
      cls: status.state === "generating" ? "practice-lab-spinner" : "",
      attr: { "aria-hidden": "true" },
    });
    setIcon(icon, statusIcon(status.state));
    const copy = current.createDiv();
    copy.createEl("strong", { text: brief?.title ?? currentState.id });
    copy.createSpan({ text: statusLabel(status) });
  }

  private refreshBatchProgress(): void {
    const host = this.batchNavigatorHost;
    const currentHost = this.batchCurrentHost;
    const blueprint = this.blueprint;
    if (blueprint === null) return;
    if (host !== null) this.renderBatchNavigator(host, blueprint);
    if (currentHost !== null) this.renderCurrentBatchSet(currentHost, blueprint);
  }

  private refreshBatchActivity(): void {
    const host = this.batchActivityHost;
    if (host === null) return;
    host.replaceChildren();
    this.renderActivity(host);
  }

  private refreshBlueprintActivity(): void {
    const host = this.blueprintActivityHost;
    if (host === null) return;
    host.replaceChildren();
    this.renderActivity(host);
  }

  private refreshAlignmentActivity(): void {
    const host = this.alignmentActivityHost;
    if (host === null) return;
    host.replaceChildren();
    this.renderActivity(host);
  }

  private async choosePrimarySource(mode: SourceChoiceMode): Promise<void> {
    if (this.busy !== null) return;
    this.busy = "source";
    this.primarySourceChoiceBusy = mode;
    this.error = null;
    this.render();
    try {
      const source = await this.options.callbacks.requestPrimarySource(mode);
      if (source !== null) {
        this.setPrimarySource(source);
        const prepare = this.options.callbacks.preparePrimarySourceVisuals;
        if (
          prepare !== undefined
          && source.visuals.some((visual) => (
            visual.state === "frame-required" && visual.kind === "animated-gif"
          ))
        ) {
          const token = this.beginPrimaryVisualPreparation(source);
          if (token !== null) {
            try {
              const prepared = await prepare(source);
              this.finishPrimaryVisualPreparation(token, source, prepared);
            } catch (error) {
              this.finishPrimaryVisualPreparation(token, source);
              throw error;
            }
          }
        }
      }
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = null;
      this.primarySourceChoiceBusy = null;
      this.render();
    }
  }

  private async addSupportingSource(mode: "note" | "pdf"): Promise<void> {
    if (this.busy !== null || this.supporting.length >= 4) return;
    const pdfBudget = mode === "pdf" ? this.pdfBudgetUsage() : null;
    if (
      mode === "pdf"
      && (
        pdfBudget === null
        || pdfBudget.remainingPages < 1
        || pdfBudget.remainingCharacters < 1
      )
    ) {
      this.error = this.pdfBudgetProblem()?.message
        ?? "The approved source bundle has no PDF capacity remaining. Remove PDF pages or raise the total PDF budget in settings.";
      this.render();
      return;
    }
    this.busy = "source";
    this.supportingSourceChoiceBusy = mode;
    this.error = null;
    this.render();
    try {
      const source = await this.options.callbacks.requestSupportingSource(
        mode,
        pdfBudget,
      );
      if (source !== null) {
        const duplicate = [this.primary, ...this.supporting].some((candidate) => (
          candidate?.path === source.path && candidate.mode === source.mode && candidate.detail === source.detail
        ));
        if (duplicate) throw new Error("That exact source scope is already in the approved bundle.");
        this.supporting = [...this.supporting, source];
        this.resetAfterSourceChange();
      }
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = null;
      this.supportingSourceChoiceBusy = null;
      this.render();
    }
  }

  private async previewSourceAlignment(): Promise<void> {
    const primary = this.primary;
    if (primary === null || this.busy !== null) return;
    const unconfirmedLabels = this.approvedSources().filter((source) => (
      source.classificationState !== "confirmed"
    )).length;
    if (unconfirmedLabels > 0) {
      this.error = `Confirm ${unconfirmedLabels} source ${unconfirmedLabels === 1 ? "label" : "labels"} before checking course alignment.`;
      this.render();
      return;
    }
    const budgetProblem = this.pdfBudgetProblem();
    if (budgetProblem !== null) {
      this.error = budgetProblem.message;
      this.render();
      return;
    }
    let completed = false;
    this.busy = "alignment-preview";
    this.error = null;
    this.render();
    try {
      this.alignmentPreview = await this.options.callbacks.previewSourceAlignment(
        primary,
        this.supporting,
        this.blueprintConfiguration,
      );
      this.alignmentResult = null;
      this.alignmentAccepted = false;
      completed = true;
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = null;
      this.render();
      if (completed) this.revealAlignmentPreview();
    }
  }

  private async generateSourceAlignment(): Promise<void> {
    if (this.alignmentPreview === null || this.busy !== null) return;
    if (this.quickGenerationRecovery !== null) {
      this.error = "Resolve the saved Quick set recovery above before checking course alignment.";
      this.render();
      return;
    }
    let completed = false;
    this.busy = "alignment";
    this.error = null;
    this.activity.clear();
    this.render();
    try {
      this.alignmentResult = await this.options.callbacks.generateSourceAlignment((event) => {
        this.activity.set("source-alignment", [
          ...(this.activity.get("source-alignment") ?? []),
          event,
        ].slice(-40));
        this.refreshAlignmentActivity();
      });
      this.alignmentAccepted = false;
      this.aiContextCompletionDecisionMade = false;
      this.blueprintConfiguration = {
        ...this.blueprintConfiguration,
        aiContextCompletionPolicy: DEFAULT_AI_CONTEXT_COMPLETION_POLICY,
      };
      completed = true;
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = null;
      this.render();
      if (completed) this.revealAlignmentResult();
    }
  }

  private async approveSourceAlignment(): Promise<void> {
    const result = this.alignmentResult;
    if (
      result === null
      || result.blockerRecordIds.length > 0
      || this.busy !== null
      || (alignmentHasAiContextOpportunity(result) && !this.aiContextCompletionDecisionMade)
    ) return;
    this.busy = "alignment-approval";
    this.error = null;
    this.render();
    try {
      this.alignmentResult = await this.options.callbacks.approveSourceAlignment(
        structuredClone(result.ledger),
      );
      if (this.alignmentResult.blockerRecordIds.length > 0) {
        throw new Error("The approved course-alignment result still has unresolved blockers.");
      }
      this.alignmentAccepted = true;
      this.invalidatePlanningPreview();
    } catch (error) {
      this.error = errorMessage(error);
      this.alignmentAccepted = false;
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private async continueWithoutCourseAlignment(
    policy: AiContextCompletionPolicyV1,
  ): Promise<void> {
    if (this.alignmentPreview === null || this.alignmentPreview.requiresProvider || this.busy !== null) return;
    this.busy = "alignment-approval";
    this.error = null;
    this.render();
    try {
      const result = await this.options.callbacks.continueWithoutCourseAlignment();
      if (result.blockerRecordIds.length > 0) {
        throw new Error("Conflicting school sources cannot be downgraded to an unverified path.");
      }
      this.alignmentResult = result;
      this.alignmentAccepted = true;
      this.aiContextCompletionDecisionMade = true;
      this.blueprintConfiguration = {
        ...this.blueprintConfiguration,
        aiContextCompletionPolicy: policy,
      };
      this.invalidatePlanningPreview();
    } catch (error) {
      this.error = errorMessage(error);
      this.alignmentAccepted = false;
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private excludeSourceAlignmentRecord(recordId: string): void {
    const result = this.alignmentResult;
    if (result === null || !result.blockerRecordIds.includes(recordId) || this.busy !== null) return;
    const ledger = structuredClone(result.ledger);
    const record = ledger.records.find((candidate) => candidate.id === recordId);
    if (record === undefined) return;
    record.resolution = "excluded";
    this.alignmentResult = {
      ...result,
      ledger,
      blockerRecordIds: result.blockerRecordIds.filter((id) => id !== recordId),
    };
    this.alignmentAccepted = false;
    this.render();
  }

  private chooseAiContextCompletion(policy: AiContextCompletionPolicyV1): void {
    if (this.busy !== null) return;
    this.blueprintConfiguration = {
      ...this.blueprintConfiguration,
      aiContextCompletionPolicy: policy,
    };
    this.aiContextCompletionDecisionMade = true;
    this.alignmentAccepted = false;
    this.invalidatePlanningPreview();
    this.render();
  }

  private async previewPlanningPayload(): Promise<void> {
    const primary = this.primary;
    if (primary === null || this.busy !== null || !this.alignmentAccepted) return;
    const budgetProblem = this.pdfBudgetProblem();
    if (budgetProblem !== null) {
      this.error = budgetProblem.message;
      this.render();
      return;
    }
    let completed = false;
    this.busy = "preview";
    this.error = null;
    this.render();
    try {
      this.preview = await this.options.callbacks.previewBlueprint(primary, this.supporting, this.blueprintConfiguration);
      this.previewAccepted = false;
      completed = true;
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = null;
      this.render();
      if (completed) this.revealPlanningPreview();
    }
  }

  private revealPlanningPreview(): void {
    window.requestAnimationFrame(() => {
      const preview = this.planningPreviewHost;
      if (preview === null || !preview.isConnected) return;
      preview.focus({ preventScroll: true });
      preview.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    });
  }

  private async generateBlueprint(): Promise<void> {
    const primary = this.primary;
    if (
      primary === null
      || this.busy !== null
      || !this.alignmentAccepted
      || !this.previewAccepted
    ) return;
    if (this.quickGenerationRecovery !== null) {
      this.error = "Resolve the saved Quick set recovery above before starting Guided path generation.";
      this.render();
      return;
    }
    this.busy = "blueprint";
    this.error = null;
    this.activity.clear();
    this.render();
    try {
      const result = await this.options.callbacks.generateBlueprint(
        primary,
        this.supporting,
        this.blueprintConfiguration,
        (event) => {
          this.activity.set("blueprint", [...(this.activity.get("blueprint") ?? []), event].slice(-40));
          this.refreshBlueprintActivity();
        },
      );
      this.blueprint = result;
      this.staleBlueprint = null;
      this.setStates = result.draft.sets.map((set) => this.editableSetState(
        set.id,
        this.defaultSetConfiguration(
          set.recommendedQuantity,
          set.recommendedDifficulty,
          result.planningInput,
        ),
        false,
      ));
      this.activeMapSetId = this.setStates[0]?.id ?? null;
      this.staleStages.delete("map");
      this.stage = "map";
      this.page = "path-plan";
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private async previewSetPayloads(): Promise<void> {
    const blueprint = this.blueprint;
    if (blueprint === null || this.busy !== null || this.mapProblem() !== null) return;
    let completed = false;
    this.busy = "payloads";
    this.error = null;
    this.render();
    try {
      this.setPayloadPreviews = await this.options.callbacks.previewSetPayloads(blueprint, this.setConfigurations());
      this.setPayloadsAccepted = false;
      completed = true;
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = null;
      this.render();
      if (completed) this.revealSetPayloadPreview();
    }
  }

  private async generateAllSets(): Promise<void> {
    const blueprint = this.blueprint;
    if (blueprint === null || this.busy !== null || !this.setPayloadsAccepted) return;
    if (this.quickGenerationRecovery !== null) {
      this.error = "Resolve the saved Quick set recovery above before generating the guided sets.";
      this.render();
      return;
    }
    this.busy = "batch";
    this.error = null;
    this.saveValidationBlocked = false;
    this.savePreflight = null;
    this.savePreflightSequence += 1;
    this.stage = "map";
    this.page = "generate-sets";
    this.statuses = new Map(this.setStates.map((state) => [state.id, { state: "queued" as const }]));
    this.activity.clear();
    this.generatedSets = [];
    this.render();
    try {
      const result = await this.options.callbacks.generateAllSets(
        blueprint,
        this.setConfigurations(),
        (setId, status) => {
          this.statuses.set(setId, status);
          this.refreshBatchProgress();
        },
        (setId, event) => {
          this.activity.set(setId, [...(this.activity.get(setId) ?? []), event].slice(-40));
          this.refreshBatchActivity();
        },
      );
      this.generatedSets = result.map((set) => ({
        ...set,
        exercises: set.exercises.map(editableDraft),
      }));
      this.staleGeneratedSets = [];
      this.staleStages.delete("review");
      this.approvedBySet = new Map(result.map((set) => [set.setId, new Set<string>()]));
      this.activeReviewSetId = result[0]?.setId ?? null;
      for (const set of result) this.statuses.set(set.setId, { state: "review" });
    } catch (error) {
      const failure = errorMessage(error);
      const inspect = this.options.callbacks.inspectRecoverableBatch;
      if (inspect !== undefined) {
        try {
          this.applyRecoveredBatch(await inspect());
          this.error = this.generatedSets.length === 0
            ? failure
            : `${failure} ${this.generatedSets.length} completed ${this.generatedSets.length === 1 ? "set remains" : "sets remain"} available in this batch.`;
        } catch {
          this.error = failure;
        }
      } else {
        this.error = failure;
      }
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private async saveLearningPath(): Promise<void> {
    const request = this.currentSaveRequest();
    if (request === null || this.busy !== null || this.reviewProblem() !== null) return;
    const requestHash = learningPathSaveRequestHash(request);
    if (
      this.savePreflight?.state !== "valid"
      || this.savePreflight.requestHash !== requestHash
    ) {
      await this.runSavePreflight();
      return;
    }
    this.busy = "save";
    this.error = null;
    this.render();
    try {
      await this.flushReviewSnapshot();
      this.savedWorkspace = await this.options.callbacks.saveLearningPath(request);
      this.savedWorkspaceDirty = false;
      this.saveValidationBlocked = false;
      const batchComplete = this.savedWorkspace.batchComplete !== false;
      for (const set of this.generatedSets) {
        this.statuses.set(set.setId, { state: "saved" });
      }
      if (batchComplete) {
        this.stage = "saved";
        this.page = "ready";
        this.staleStages.delete("saved");
        this.recoveryAvailable = false;
      } else {
        this.stage = "review";
        this.page = "review-exercises";
        this.recoveryAvailable = true;
        this.recoveryKind = "generation-batch";
      }
      const reconciled = this.savedWorkspace.reconciledLinkCount ?? 0;
      const reordered = this.savedWorkspace.reconciledTutorBlockOrderCount ?? 0;
      new Notice(
        !batchComplete
          ? "Completed sets saved. The unfinished guided batch remains available to resume."
          : reconciled === 0 && reordered === 0
            ? "Guided learning path saved in the source practice workspace."
            : `Guided learning path saved. ${[
              reconciled > 0
                ? `${reconciled} generated source-to-aspect ${reconciled === 1 ? "link was" : "links were"} normalized`
                : null,
              reordered > 0
                ? `${reordered} tutor ${reordered === 1 ? "lesson was" : "lessons were"} put into teaching order`
                : null,
            ].filter((message): message is string => message !== null).join("; ")}.`,
        8_000,
      );
    } catch (error) {
      this.error = errorMessage(error);
      this.saveValidationBlocked = this.error.startsWith(
        "Cannot save an invalid learning workspace:",
      );
      this.savePreflight = {
        requestHash,
        state: "invalid",
        message: this.error,
      };
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private defaultSetConfiguration(
    quantity: number,
    difficulty: Difficulty,
    planning: LearningBlueprintPlanningInputV1,
  ): GenerationConfiguration {
    return {
      provider: this.blueprintConfiguration.provider,
      model: this.blueprintConfiguration.model,
      reasoningEffort: this.blueprintConfiguration.reasoningEffort,
      focusInstructions: "",
      quantity,
      difficulty,
      exerciseTypes: enabledExerciseTypes(RECOMMENDED_EXERCISE_TYPE_PERCENTAGES),
      exerciseTypePercentages: copyExerciseTypePercentages(RECOMMENDED_EXERCISE_TYPE_PERCENTAGES),
      selectedVisualIds: planning.sources.flatMap((source) => source.visuals.map((visual) => visual.id)),
      ...(planning.aiContextCompletionPolicy === undefined
        ? {}
        : { aiContextCompletionPolicy: planning.aiContextCompletionPolicy }),
    };
  }

  private setConfigurations(): Array<{ readonly setId: string; readonly configuration: GenerationConfiguration }> {
    return this.setStates.map((state) => ({
      setId: state.id,
      configuration: {
        ...state.configuration,
        exerciseTypes: enabledExerciseTypes(state.configuration.exerciseTypePercentages),
        exerciseTypePercentages: { ...state.configuration.exerciseTypePercentages },
        selectedVisualIds: [...state.configuration.selectedVisualIds],
      },
    }));
  }

  private updateSetConfiguration(setId: string, patch: Partial<GenerationConfiguration>): void {
    const state = this.setStates.find((candidate) => candidate.id === setId);
    if (state === undefined) return;
    state.configuration = {
      ...state.configuration,
      ...patch,
      exerciseTypes: enabledExerciseTypes(
        patch.exerciseTypePercentages ?? state.configuration.exerciseTypePercentages,
      ),
    };
    this.invalidateSetPayloads();
  }

  private updateBrief(setId: string, patch: { readonly title?: string; readonly purpose?: string }): void {
    const blueprint = this.blueprint;
    if (blueprint === null) return;
    this.blueprint = {
      ...blueprint,
      draft: {
        ...blueprint.draft,
        sets: blueprint.draft.sets.map((set) => set.id === setId ? { ...set, ...patch } : set),
      },
    };
    this.invalidateSetPayloads();
  }

  private moveSet(setId: string, targetIndex: number): void {
    const from = this.setStates.findIndex((state) => state.id === setId);
    if (from < 0 || targetIndex < 0 || targetIndex >= this.setStates.length || from === targetIndex) return;
    const states = [...this.setStates];
    const removed = states.splice(from, 1)[0];
    if (removed === undefined) return;
    states.splice(targetIndex, 0, removed);
    this.setStates = states;
    this.reorderBlueprintSets();
    this.invalidateSetPayloads();
    this.render();
  }

  private addSet(): void {
    const blueprint = this.blueprint;
    if (blueprint === null || this.setStates.length >= MAX_LEARNING_PATH_SETS) return;
    const id = `set-custom-${crypto.randomUUID()}`;
    const supported = blueprint.draft.aspects.filter((aspect) => aspect.status === "supported").map((aspect) => aspect.id);
    const set = {
      id,
      title: `Focused set ${this.setStates.length + 1}`,
      purpose: "Define the distinct source-grounded objective for this set.",
      instructionalRole: "general" as const,
      order: this.setStates.length,
      aspectIds: supported,
      tutorLessonBriefIds: [],
      recommendedQuantity: Math.min(10, Math.max(1, MAX_LEARNING_PATH_EXERCISES - this.totalExercises())),
      recommendedDifficulty: "deep-exam" as const,
    };
    this.blueprint = { ...blueprint, draft: { ...blueprint.draft, sets: [...blueprint.draft.sets, set] } };
    this.setStates.push(this.editableSetState(
      id,
      this.defaultSetConfiguration(
        set.recommendedQuantity,
        set.recommendedDifficulty,
        blueprint.planningInput,
      ),
      false,
    ));
    this.activeMapSetId = id;
    this.invalidateSetPayloads();
    this.render();
  }

  private removeSet(setId: string): void {
    const blueprint = this.blueprint;
    if (blueprint === null || this.setStates.length <= MIN_LEARNING_PATH_SETS) return;
    const removed = blueprint.draft.sets.find((set) => set.id === setId);
    const lessonIds = new Set(removed?.tutorLessonBriefIds ?? []);
    this.setStates = this.setStates.filter((state) => state.id !== setId);
    if (this.activeMapSetId === setId) this.activeMapSetId = this.setStates[0]?.id ?? null;
    this.blueprint = {
      ...blueprint,
      draft: {
        ...blueprint.draft,
        sets: blueprint.draft.sets.filter((set) => set.id !== setId),
        tutorLessonBriefs: blueprint.draft.tutorLessonBriefs.filter((lesson) => !lessonIds.has(lesson.id)),
      },
    };
    this.reorderBlueprintSets();
    this.invalidateSetPayloads();
    this.render();
  }

  private removeGap(aspectId: string): void {
    const blueprint = this.blueprint;
    if (blueprint === null) return;
    this.blueprint = {
      ...blueprint,
      draft: {
        ...blueprint.draft,
        aspects: blueprint.draft.aspects
          .filter((aspect) => aspect.id !== aspectId)
          .map((aspect) => ({ ...aspect, prerequisiteAspectIds: aspect.prerequisiteAspectIds.filter((id) => id !== aspectId) })),
      },
    };
    this.invalidateSetPayloads();
    this.render();
  }

  private reorderBlueprintSets(): void {
    const blueprint = this.blueprint;
    if (blueprint === null) return;
    const byId = new Map(blueprint.draft.sets.map((set) => [set.id, set]));
    this.blueprint = {
      ...blueprint,
      draft: {
        ...blueprint.draft,
        sets: this.setStates.map((state, order) => ({ ...byId.get(state.id)!, order })),
      },
    };
  }

  private updateReviewExercise(setId: string, exerciseId: string, patch: Partial<EditableDraftExercise>): void {
    this.reviewFeedback = null;
    this.generatedSets = this.generatedSets.map((set) => set.setId !== setId ? set : {
      ...set,
      exercises: set.exercises.map((exercise) => exercise.id === exerciseId ? { ...exercise, ...patch } : exercise),
    });
  }

  private currentSaveRequest(): LearningPathSaveRequestV1 | null {
    const primary = this.primary;
    const blueprint = this.blueprint;
    if (primary === null || blueprint === null) return null;
    return {
      primary,
      supporting: this.supporting,
      blueprint: blueprint.draft,
      planningInput: blueprint.planningInput,
      configurations: this.setConfigurations(),
      sets: this.generatedSets.map((set) => ({
        ...set,
        approvedExerciseIds: [...(this.approvedBySet.get(set.setId) ?? [])],
      })),
    };
  }

  private reviewStateChanged(immediate: boolean): void {
    this.saveValidationBlocked = false;
    this.savePreflight = null;
    this.savePreflightSequence += 1;
    this.reviewPersistencePending = true;
    if (this.reviewPersistenceTimer !== undefined) {
      window.clearTimeout(this.reviewPersistenceTimer);
      this.reviewPersistenceTimer = undefined;
    }
    const persistAndCheck = (): void => {
      void this.flushReviewSnapshot().catch((error) => {
        this.error = `Guided review progress could not be checkpointed. ${errorMessage(error)}`;
        this.render();
      });
      void this.runSavePreflight();
    };
    if (immediate) {
      persistAndCheck();
      return;
    }
    this.reviewPersistenceTimer = window.setTimeout(() => {
      this.reviewPersistenceTimer = undefined;
      persistAndCheck();
    }, 400);
  }

  private async flushReviewSnapshot(): Promise<void> {
    const persist = this.options.callbacks.persistReviewSnapshots;
    if (persist === undefined) {
      this.reviewPersistencePending = false;
      return;
    }
    while (this.reviewPersistencePending) {
      this.reviewPersistencePending = false;
      const request = this.currentSaveRequest();
      if (request === null || request.sets.length === 0) return;
      const snapshot = structuredClone(request.sets);
      this.reviewPersistenceChain = this.reviewPersistenceChain
        .catch(() => undefined)
        .then(async () => await persist(snapshot));
      await this.reviewPersistenceChain;
    }
  }

  private async runSavePreflight(): Promise<void> {
    if (this.reviewProblem() !== null) return;
    const request = this.currentSaveRequest();
    if (request === null) return;
    const requestHash = learningPathSaveRequestHash(request);
    const sequence = ++this.savePreflightSequence;
    const preflight = this.options.callbacks.preflightLearningPath;
    if (preflight === undefined) {
      this.savePreflight = { requestHash, state: "valid" };
      this.render();
      return;
    }
    this.savePreflight = { requestHash, state: "checking" };
    this.render();
    try {
      const result = await preflight(request);
      const current = this.currentSaveRequest();
      if (
        sequence !== this.savePreflightSequence
        || current === null
        || learningPathSaveRequestHash(current) !== result.requestHash
      ) return;
      this.savePreflight = { requestHash: result.requestHash, state: "valid" };
      this.saveValidationBlocked = false;
    } catch (error) {
      if (sequence !== this.savePreflightSequence) return;
      const message = errorMessage(error);
      this.savePreflight = {
        requestHash,
        state: "invalid",
        message,
      };
      this.saveValidationBlocked = true;
      this.error = message;
    }
    this.render();
  }

  private totalExercises(): number {
    return this.setStates.reduce((total, state) => total + state.configuration.quantity, 0);
  }

  private mapProblem(): string | null {
    const blueprint = this.blueprint;
    if (blueprint === null) return "Generate an aspect map first.";
    const gaps = blueprint.draft.aspects.filter((aspect) => aspect.status === "source-gap");
    if (gaps.length > 0) return `${gaps.length} unresolved source ${gaps.length === 1 ? "gap remains" : "gaps remain"}. Remove each gap or return to Source and add material.`;
    if (this.setStates.length < MIN_LEARNING_PATH_SETS || this.setStates.length > MAX_LEARNING_PATH_SETS) return `Keep ${MIN_LEARNING_PATH_SETS}-${MAX_LEARNING_PATH_SETS} sets.`;
    if (this.totalExercises() > MAX_LEARNING_PATH_EXERCISES) return `The batch requests ${this.totalExercises()} exercises; reduce it to ${MAX_LEARNING_PATH_EXERCISES} or fewer.`;
    const blank = blueprint.draft.sets.find((set) => set.title.trim().length === 0 || set.purpose.trim().length === 0);
    if (blank !== undefined) return "Every set needs a distinct title and purpose.";
    return null;
  }

  private reviewProblem(): string | null {
    if (this.busy === "batch") return "Wait for the current set generation to finish or cancel it.";
    if (this.generatedSets.length === 0) return "Generate at least one complete set before saving.";
    const blueprint = this.blueprint;
    if (blueprint === null) return "Restore the approved aspect map before saving.";
    const unsavedInputs = this.reviewSetInputs(blueprint).filter((input) => (
      this.statuses.get(input.setId)?.state !== "saved"
    ));
    if (unsavedInputs.length === 0) {
      return "Every completed set is already saved. Resume or retry the unfinished batch when you are ready.";
    }
    for (const input of unsavedInputs) {
      const state = learningPathSetReviewState(input);
      const blocker = state.blockers[0];
      if (blocker !== undefined) return `${state.setTitle}: ${blocker.reason}`;
      if (state.pendingApprovalCount > 0) {
        return `${state.setTitle}: approve ${state.pendingApprovalCount} ready ${state.pendingApprovalCount === 1 ? "exercise" : "exercises"}.`;
      }
    }
    return null;
  }

  private blockingSetId(): string | null {
    const blueprint = this.blueprint;
    if (blueprint === null) return null;
    const blank = blueprint.draft.sets.find((set) => (
      set.title.trim().length === 0 || set.purpose.trim().length === 0
    ));
    if (blank !== undefined) return blank.id;
    if (this.totalExercises() > MAX_LEARNING_PATH_EXERCISES) {
      return this.setStates.at(-1)?.id ?? null;
    }
    return null;
  }

  private reviewSetInput(
    set: GeneratedLearningSetPresentationV1,
    blueprint: LearningBlueprintPresentationV1,
  ): LearningPathReviewSetInput {
    return {
      setId: set.setId,
      setTitle: blueprint.draft.sets.find((brief) => brief.id === set.setId)?.title ?? set.setId,
      exercises: set.exercises,
      approvedExerciseIds: this.approvedBySet.get(set.setId) ?? new Set<string>(),
      requiredExerciseIds: new Set(
        set.draft.tutorLessons.map((lesson) => lesson.guidedExerciseId),
      ),
    };
  }

  private reviewSetInputs(
    blueprint: LearningBlueprintPresentationV1,
  ): LearningPathReviewSetInput[] {
    return this.generatedSets.map((set) => this.reviewSetInput(set, blueprint));
  }

  private renderAndFocusReviewFeedback(saveReady: boolean): void {
    this.render();
    window.setTimeout(() => {
      const selector = saveReady
        ? ".practice-learning-path-save-actions"
        : ".practice-learning-path-review-feedback";
      const target = this.contentEl.querySelector<HTMLElement>(selector);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
    }, 0);
  }

  private invalidatePlanningPreview(): void {
    const hadDownstream = this.blueprint !== null
      || this.setPayloadPreviews.length > 0
      || this.generatedSets.length > 0
      || this.savedWorkspace !== null;
    if (hadDownstream) {
      this.staleStages.add("map");
      this.staleStages.add("review");
      this.staleStages.add("saved");
    }
    if (this.blueprint !== null) {
      this.staleBlueprint = structuredClone(this.blueprint);
    }
    this.preview = null;
    this.previewAccepted = false;
    this.blueprint = null;
    this.setStates = [];
    this.invalidateSetPayloads();
  }

  private invalidateSetPayloads(): void {
    if (
      this.setPayloadPreviews.length > 0
      || this.statuses.size > 0
      || this.generatedSets.length > 0
    ) {
      this.staleStages.add("review");
      this.staleStages.add("saved");
    }
    if (this.generatedSets.length > 0) {
      this.staleGeneratedSets = structuredClone(this.generatedSets);
    }
    this.setPayloadPreviews = [];
    this.setPayloadsAccepted = false;
    this.statuses.clear();
    this.activity.clear();
    this.generatedSets = [];
    this.approvedBySet.clear();
    this.reviewFeedback = null;
    this.activeReviewSetId = null;
    this.saveValidationBlocked = false;
    this.savePreflight = null;
    this.savePreflightSequence += 1;
  }

  private invalidateSourceAlignment(): void {
    this.alignmentPreview = null;
    this.alignmentResult = null;
    this.alignmentAccepted = false;
    this.aiContextCompletionDecisionMade = false;
    this.blueprintConfiguration = {
      ...this.blueprintConfiguration,
      aiContextCompletionPolicy: DEFAULT_AI_CONTEXT_COMPLETION_POLICY,
    };
    this.activity.delete("source-alignment");
    this.invalidatePlanningPreview();
  }

  private resetAfterSourceChange(): void {
    this.stage = "source";
    this.page = "material";
    this.error = null;
    this.invalidateSourceAlignment();
  }

  private editableSetState(
    id: string,
    configuration: GenerationConfiguration,
    advancedOpen: boolean,
  ): EditableSetState {
    const percentages = copyExerciseTypePercentages(configuration.exerciseTypePercentages);
    return {
      id,
      advancedOpen,
      configuration: {
        ...configuration,
        exerciseTypes: [...configuration.exerciseTypes],
        exerciseTypePercentages: percentages,
        selectedVisualIds: [...configuration.selectedVisualIds],
      },
      intendedTypes: new Set(enabledExerciseTypes(percentages)),
      rememberedPercentages: copyExerciseTypePercentages(percentages),
    };
  }

  private async discardRecovery(): Promise<void> {
    const discard = this.options.callbacks.discardRecoverableBatch;
    if (discard === undefined || this.busy !== null) return;
    this.busy = "source";
    this.error = null;
    this.render();
    try {
      if (await discard()) {
        this.recoveryAvailable = false;
        this.statuses.clear();
        this.activity.clear();
        this.generatedSets = [];
      }
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private section(container: HTMLElement, title: string, description: string): HTMLElement {
    const section = container.createEl("section", { cls: "practice-learning-path-section" });
    const heading = section.createDiv({ cls: "practice-learning-path-section-heading" });
    heading.createEl("h3", { text: title });
    heading.createEl("p", { text: description });
    return section;
  }

  private disclosure(
    container: HTMLElement,
    key: string,
    label: string,
    description: string,
    defaultOpen = false,
    actionLabel?: string,
  ): HTMLElement {
    const details = container.createEl("details", { cls: "practice-learning-path-disclosure" });
    this.bindDisclosure(details, key, defaultOpen);
    const summary = details.createEl("summary");
    const copy = summary.createSpan({ cls: "practice-learning-path-disclosure-copy" });
    copy.createEl("strong", { text: label });
    copy.createSpan({ text: description });
    if (actionLabel !== undefined) {
      summary.createSpan({ cls: "practice-learning-path-disclosure-action", text: actionLabel });
    }
    return details.createDiv({ cls: "practice-learning-path-disclosure-body" });
  }

  private bindDisclosure(
    details: HTMLDetailsElement,
    key: string,
    defaultOpen: boolean,
  ): void {
    details.open = this.disclosureState.get(key) ?? defaultOpen;
    details.addEventListener("toggle", () => {
      this.disclosureState.set(key, details.open);
    });
  }

  private providerSummary(): string {
    const selected = this.providers.find((entry) => (
      entry.id === this.blueprintConfiguration.provider
    ));
    const model = selected?.models.find((entry) => (
      entry.id === this.blueprintConfiguration.model
    ));
    const modelLabel = model?.label
      ?? (this.blueprintConfiguration.model.length === 0
        ? "Automatic model"
        : this.blueprintConfiguration.model);
    return `${selected?.label ?? this.blueprintConfiguration.provider} · ${modelLabel} · ${displayReasoningEffort(this.blueprintConfiguration.reasoningEffort)} reasoning`;
  }

  private async refreshRecoveryKind(): Promise<void> {
    if (!this.recoveryAvailable || this.options.callbacks.inspectRecoverableKind === undefined) return;
    try {
      const kind = await this.options.callbacks.inspectRecoverableKind();
      if (kind === this.recoveryKind) return;
      this.recoveryKind = kind;
      this.recoveryAvailable = kind !== null;
      this.render();
    } catch (error) {
      this.error = `The saved guided work could not be identified. ${errorMessage(error)}`;
      this.render();
    }
  }

  private async resolveRecoveryKind(): Promise<LearningPathRecoveryKindV1 | null> {
    if (this.recoveryKind !== "unknown") return this.recoveryKind;
    const inspect = this.options.callbacks.inspectRecoverableKind;
    if (inspect === undefined) return "generation-batch";
    try {
      const kind = await inspect();
      this.recoveryKind = kind;
      this.recoveryAvailable = kind !== null;
      return kind;
    } catch (error) {
      this.error = `The saved guided work could not be identified. ${errorMessage(error)}`;
      this.render();
      return null;
    }
  }

  private revealAlignmentPreview(): void {
    window.requestAnimationFrame(() => {
      const preview = this.alignmentPreviewHost;
      if (preview === null || !preview.isConnected) return;
      preview.focus({ preventScroll: true });
      preview.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    });
  }

  private revealAlignmentResult(): void {
    window.requestAnimationFrame(() => {
      const result = this.alignmentResultHost;
      if (result === null || !result.isConnected) return;
      result.focus({ preventScroll: true });
      result.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    });
  }

  private revealSetPayloadPreview(): void {
    window.requestAnimationFrame(() => {
      const preview = this.setPayloadPreviewHost;
      if (preview === null || !preview.isConnected) return;
      preview.focus({ preventScroll: true });
      preview.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    });
  }

  private iconButton(
    container: HTMLElement,
    icon: string,
    tooltip: string,
    disabled: boolean,
    action: () => void,
  ): void {
    const button = container.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": tooltip, title: tooltip } });
    setIcon(button, icon);
    button.disabled = disabled;
    button.addEventListener("click", action);
  }

  private clearOcclusionEditors(): void {
    for (const editor of this.occlusionEditors.splice(0)) this.removeChild(editor);
  }
}

const ALIGNMENT_STATUS_LABELS: Readonly<Record<SourceAlignmentStatusV1, string>> = {
  aligned: "Aligned with school material",
  "notes-incomplete": "School material adds context",
  conflict: "Your notes differ",
  "school-only": "Covered only by school material",
  "notes-only-unverified": "Selected material only · not course-checked",
  "school-sources-disagree": "School sources disagree",
  "insufficient-evidence": "Additional context could strengthen this practice",
};

function alignmentStatusLabel(status: SourceAlignmentStatusV1): string {
  return ALIGNMENT_STATUS_LABELS[status];
}

function alignmentStatusIcon(status: SourceAlignmentStatusV1): string {
  if (status === "aligned") return "badge-check";
  if (status === "notes-incomplete" || status === "school-only") return "notebook-tabs";
  if (status === "notes-only-unverified") return "shield-question";
  return "triangle-alert";
}

function alignmentStatusCounts(
  ledger: SourceAlignmentLedgerV1,
): ReadonlyArray<readonly [SourceAlignmentStatusV1, number]> {
  const order: readonly SourceAlignmentStatusV1[] = [
    "conflict",
    "notes-incomplete",
    "school-sources-disagree",
    "insufficient-evidence",
    "aligned",
    "school-only",
    "notes-only-unverified",
  ];
  return order.flatMap((status) => {
    const count = ledger.records.filter((record) => record.status === status).length;
    return count === 0 ? [] : [[status, count] as const];
  });
}

function alignmentResultTitle(result: LearningSourceAlignmentResultV1): string {
  if (!result.checked || result.ledger.records.length === 0) {
    return "Notes-grounded · not course-checked";
  }
  const active = result.ledger.records.filter((record) => record.resolution !== "excluded");
  if (active.some((record) => record.status === "school-sources-disagree")) {
    return "School sources disagree";
  }
  if (active.some((record) => record.status === "conflict")) return "Your notes differ";
  if (active.some((record) => record.status === "notes-incomplete")) {
    return "School material adds context";
  }
  if (active.some((record) => (
    record.status === "notes-only-unverified"
    || record.status === "insufficient-evidence"
  ))) {
    return "Additional context could strengthen this practice";
  }
  if (active.some((record) => record.status === "school-only")) {
    return "Checked against selected school material";
  }
  return "Aligned with school material";
}

function alignmentResultDescription(
  result: LearningSourceAlignmentResultV1,
  policy: AiContextCompletionPolicyV1 | undefined,
  decisionMade: boolean,
): string {
  if (!result.checked || result.ledger.records.length === 0) {
    return "Your selected material defines the topic. No course comparison is available, so the path remains not course-checked.";
  }
  if (result.blockerRecordIds.length > 0) {
    return `${result.blockerRecordIds.length} confirmed school-source ${result.blockerRecordIds.length === 1 ? "conflict needs" : "conflicts need"} your decision. Other areas remain available and do not judge or modify your notes.`;
  }
  const conflicts = result.ledger.records.filter((record) => (
    record.status === "conflict" && record.resolution !== "excluded"
  )).length;
  const incomplete = result.ledger.records.filter((record) => (
    record.status === "notes-incomplete" && record.resolution !== "excluded"
  )).length;
  const supplemental = result.ledger.records.filter((record) => (
    (
      record.status === "notes-only-unverified"
      || record.status === "insufficient-evidence"
    )
    && record.resolution !== "excluded"
  )).length;
  if (supplemental > 0) {
    const schoolChanges = conflicts + incomplete;
    const schoolContext = schoolChanges === 0
      ? "supply verified context where available"
      : `supply ${schoolChanges} verified ${schoolChanges === 1 ? "correction or addition" : "corrections or additions"}`;
    if (!decisionMade) {
      return `Your material remains the backbone. School sources ${schoolContext}. ${supplemental} ${supplemental === 1 ? "area could" : "areas could"} use optional supporting context; choose how to continue below.`;
    }
    return aiContextCompletionApproved(policy)
      ? `Your material remains the backbone. School sources ${schoolContext}. AI-supported context was approved for ${supplemental} ${supplemental === 1 ? "area" : "areas"} and will remain not course-checked.`
      : `Your material remains the backbone. School sources ${schoolContext}. Generation will stay within the selected material for the remaining ${supplemental} ${supplemental === 1 ? "area" : "areas"}.`;
  }
  if (conflicts > 0) {
    return `${conflicts} note-school ${conflicts === 1 ? "difference uses" : "differences use"} the selected school-supported interpretation. Your notes are not changed.`;
  }
  if (incomplete > 0) {
    return `${incomplete} course-backed ${incomplete === 1 ? "addition comes" : "additions come"} from the selected school material. It will inform practice without changing your notes.`;
  }
  return "The selected source claims have no unresolved course-authority blocker. Exact comparisons remain available under Details.";
}

function alignmentResultClass(result: LearningSourceAlignmentResultV1): string {
  const title = alignmentResultTitle(result);
  if (title === "Aligned with school material") return "is-course-aligned";
  if (title === "Your notes differ") return "is-notes-differ";
  if (title === "School material adds context") return "is-notes-incomplete";
  if (title === "School sources disagree") return "is-school-sources-disagree";
  if (title === "Additional context could strengthen this practice") return "is-not-course-checked";
  return "is-not-course-checked";
}

function alignmentResultIcon(result: LearningSourceAlignmentResultV1): string {
  if (!result.checked || result.ledger.records.length === 0) return "shield-question";
  if (alignmentResultClass(result) === "is-course-aligned") return "badge-check";
  if (alignmentResultClass(result) === "is-not-course-checked") return "shield-question";
  return "triangle-alert";
}

function displayAlignmentResolution(record: SourceAlignmentRecordV1): string {
  if (record.resolution === "course-authority") return "School-supported interpretation selected";
  if (record.resolution === "manual-override") return "Manual override · not course-aligned";
  if (record.resolution === "excluded") return "Explicitly excluded from practice";
  if (
    record.status === "notes-only-unverified"
    || record.status === "insufficient-evidence"
  ) return "Optional supporting context available · not course-checked";
  if (record.resolution === "unresolved") return "Needs a source decision";
  return "No resolution needed";
}

function alignmentHasAiContextOpportunity(result: LearningSourceAlignmentResultV1): boolean {
  return result.ledger.records.some((record) => (
    record.resolution !== "excluded"
    && (
      record.status === "notes-only-unverified"
      || record.status === "insufficient-evidence"
    )
  ));
}

function activityBoundary(
  events: readonly CliActivityEvent[],
  boundary: "first" | "last",
): number | undefined {
  const timestamps = events
    .map((event) => Date.parse(event.occurredAt))
    .filter(Number.isFinite);
  if (timestamps.length === 0) return undefined;
  return boundary === "first" ? Math.min(...timestamps) : Math.max(...timestamps);
}

function compactTelemetryTokens(value: number): string {
  if (value < 1_000) return Math.round(value).toLocaleString();
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

function telemetryMetric(
  container: HTMLElement,
  label: string,
  value: string,
): HTMLElement {
  const metric = container.createDiv({ cls: "practice-lab-generation-telemetry-metric" });
  metric.createSpan({ text: label });
  return metric.createEl("strong", { text: value });
}

function statusIcon(status: LearningSetGenerationStatusV1["state"]): string {
  if (status === "queued") return "clock-3";
  if (status === "generating") return "loader-circle";
  if (status === "validating") return "shield-check";
  if (status === "review") return "clipboard-check";
  if (status === "saved") return "check-circle-2";
  return "circle-alert";
}

function statusLabel(status: LearningSetGenerationStatusV1): string {
  if (status.state === "queued") return "Queued";
  if (status.state === "generating") return status.message ?? "Generating";
  if (status.state === "validating") return status.message ?? "Validating";
  if (status.state === "review") return "Ready for review";
  if (status.state === "saved") return "Saved";
  return "Generation stopped";
}

function errorMessage(error: unknown): string {
  return formatCliErrorForUi(error, "The requested action failed.");
}

function learningPathErrorPresentation(message: string): {
  readonly summary: string;
  readonly recovery: string;
  readonly details: readonly string[];
} {
  const prefix = "Cannot save an invalid learning workspace:";
  if (!message.startsWith(prefix)) {
    const detailMarker = message.indexOf(" Details:");
    const rawSummary = detailMarker < 0 ? message : message.slice(0, detailMarker);
    const rawDetails = detailMarker < 0 ? "" : message.slice(detailMarker + " Details:".length);
    const details = [...new Set(rawDetails.length === 0
      ? (message.length > 320 ? [message] : [])
      : rawDetails.split(";").map((detail) => detail.trim()).filter((detail) => detail.length > 0))];
    const providerStopped = /\b(?:codex|claude|agy|provider|cli|generation|agent)\b/iu.test(message);
    return {
      summary: rawSummary.length <= 280
        ? rawSummary
        : providerStopped
          ? "The selected AI stopped before it produced a valid result. Your approved source and configuration are unchanged."
          : "This action stopped before it could finish. Nothing was silently saved or replaced.",
      recovery: providerStopped
        ? "Retry once. If it stops again, open Activity for the last safe progress update and Details for the technical reason."
        : "Review the current step, correct the highlighted blocker, then retry the same action.",
      details,
    };
  }
  const details = [...new Set(message.slice(prefix.length)
    .split(";")
    .map((detail) => detail.trim())
    .filter((detail) => detail.length > 0))];
  const teachingOrderOnly = details.length > 0 && details.every((detail) => (
    /^\/tutorLessons\/\d+\/teachingBlocks: teaching blocks must follow why, prerequisite, explanation, then optional walkthrough order\.$/u.test(detail)
  ));
  return {
    summary: teachingOrderOnly
      ? `${details.length} tutor ${details.length === 1 ? "lesson has" : "lessons have"} sections out of teaching order. Nothing was written, and the generated batch remains recoverable.`
      : `The generated workspace still contains ${details.length} inconsistent learning-path ${details.length === 1 ? "item" : "items"}. Nothing was written, and the generated batch remains recoverable.`,
    recovery: "Reloading alone does not repair generated content. Retry Save after the plugin update; if the same check still fails, regenerate the affected set and open Details for the exact paths.",
    details,
  };
}
