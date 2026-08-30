import {
  type App,
  getAllTags,
  MarkdownView,
  type MarkdownFileInfo,
  Menu,
  Notice,
  normalizePath,
  Platform,
  Plugin,
  TAbstractFile,
  TFile,
  TFolder,
  type Editor,
  type MarkdownPostProcessorContext,
  type WorkspaceLeaf,
} from "obsidian";
import {
  canRunAnswerReview,
  createAnswerReviewInput,
  createAnswerReviewStructuredRequest,
  validateAnswerReviewInput,
  type AnswerReviewOutputV1,
} from "./answer-review";
import {
  AnswerReviewQueue,
  type AnswerReviewQueueEvent,
} from "./answer-review-queue";
import { retryAsync } from "./async-retry";
import { generationDifficultyFromSetting } from "./difficulty";
import { enabledExerciseTypes } from "./exercise-distribution";
import { auditOfflineReadiness } from "./offline-readiness";
import { hiddenPracticeMetadataEditorExtension } from "./hidden-practice-metadata-editor";
import { practiceBankEditorExtension } from "./practice-bank-editor";
import { PracticeBankRepository, createSessionSummary } from "./bank-repository";
import { renderBankStatistics } from "./bank-statistics-view";
import { LearningPathController } from "./learning-path-controller";
import { SavedSetGenerationController } from "./saved-set-controller";
import {
  deriveRepairSetSeed,
  repairFocusInstructions,
  type RepairSetSeedV1,
} from "./saved-set-generation";
import {
  deriveLearningAnalytics,
  recommendNextLearningStep,
} from "./learning-analytics";
import {
  createGuidedLessonState,
  createSessionExerciseEvidence,
} from "./learning-study";
import type {
  CliActivityEvent,
  CliProviderLayer,
  DurableProcessHandle,
  ProviderDetection,
} from "./cli";
import type { DashboardBankRecord, DashboardScope } from "./dashboard-model";
import { PracticeDashboardRepository } from "./dashboard-repository";
import {
  GENERATION_PROMPT_VERSION,
  asGenerationDraft,
  buildGenerationPrompt,
  validateGeneratedDraft
} from "./generation";
import {
  createGenerationRecoveryContext,
  createGenerationRecoveryDraft,
  GENERATION_RECOVERY_DRAFT_FILENAME,
  parseGenerationRecoveryContext,
  parseGenerationRecoveryDraft,
  type GenerationRecoveryContextV1,
} from "./generation-recovery";
import {
  parseGenerationHistoryMarkdown,
  type GenerationHistoryV1,
} from "./generation-history";
import {
  checkpointBankSnapshot,
  createStudySessionCheckpoint,
  finishedSessionFromCheckpoint,
  markStudySessionCheckpointMerging,
  parseStudySessionCheckpoint,
  updateStudySessionCheckpoint,
  type StudySessionCheckpointV1,
} from "./study-checkpoint";
import {
  rebaseLatestStudySessionCheckpointBankPath,
  resolveStudyCheckpointBankCandidate,
  studyCheckpointWorkspaceActionState,
  summarizeStudyCheckpointProgress,
} from "./study-checkpoint-recovery";
import type {
  AiReviewSessionItemResultV2,
  PracticeBankV2,
  PracticeBankV4,
  PracticeSetV1,
  GenerationDraftV1,
  SessionSummaryV2,
  SourceAlignmentLedgerV1,
  VisualSourceV1,
} from "./model";
import { CURRENT_PRACTICE_BANK_SCHEMA_VERSION } from "./model";
import { createExerciseAlignmentSnapshots } from "./source-alignment";
import {
  DEFAULT_AI_CONTEXT_COMPLETION_POLICY,
  effectiveAiContextCompletionPolicy,
} from "./ai-context-completion";
import {
  createUnverifiedSourceAlignmentLedger,
  sourceAlignmentBlockers,
} from "./source-alignment-generation";
import {
  derivePracticePath,
  getStaleSourceState,
  parsePracticeBankMarkdown,
  type AiReviewResolutionPatchV2,
  type AiReviewStateTransitionPatchV2,
} from "./persistence";
import {
  extractPdfPages,
  inspectPdf,
  type PdfDocumentInfo,
  type PdfExtractionResult,
  type PdfPageRange,
} from "./pdf-tools";
import type {
  PdfSourceBudgetLimitsV1,
} from "./pdf-source-budget";
import {
  displayReasoningEffort,
  reasoningEffortsForProvider,
} from "./reasoning";
import { displayModelSelection, modelsForProvider } from "./model-selection";
import {
  createGenerationRecipe,
  parseGenerationRecipeMarkdown,
  regenerationPreset,
} from "./regeneration";
import { copyDisplayPreferences } from "./preferences";
import {
  CLEAR_HISTORY_CONFIRMATION,
  DELETE_BANK_CONFIRMATION,
  DELETE_SESSION_CONFIRMATION,
  RESET_SETTINGS_CONFIRMATION,
  practiceBankBackupPath,
} from "./data-management";
import { generationDraftV1JsonSchema } from "./schema";
import { prepareSource } from "./segmenter";
import {
  DEFAULT_SETTINGS,
  PracticeLabSettingTab,
  normalizeSettings,
  type PracticeLabSettings
} from "./settings";
import {
  collectRegenerationSource,
  collectRegenerationPdfSource,
  collectSource,
  collectSourceFromFile,
  collectPdfSource,
  confirmSourceClassification,
  type CollectedSource,
  type RegenerationSourceResult,
} from "./source";
import { parseSourceImportMarkdown } from "./source-import";
import {
  PRACTICE_DASHBOARD_VIEW_TYPE,
  PRACTICE_LAB_VIEW_TYPE,
  PRACTICE_LEARNING_PATH_VIEW_TYPE,
  PracticeDashboardView,
  PracticeLabView,
  PracticeLearningPathView,
  choosePracticeSet,
  OfflineReadinessModal,
  applyMarkdownHeadingTheme,
  applyDraftEdits,
  presentExercises,
  type DraftExercisePresentation,
  type AnswerReviewRequest,
  type AnswerReviewActivityPresentation,
  type AnswerReviewStatus,
  type EditableDraftExercise,
  type GenerationRecoveryPresentation,
  type GenerationConfiguration,
  type PayloadPreview,
  type PersistedAnswerReviewRetryTarget,
  type DashboardRecoveryPresentation,
  type PracticeDashboardViewOptions,
  type PracticeLabViewOptions,
  type LearningPathViewOptions,
  type LearningStudyLaunchV1,
  type ProviderPresentation,
  type MarkdownSourceMode,
  type SourcePresentation,
  type StudySessionProgressV1,
} from "./ui";
import {
  chooseSourceNoteFile,
  chooseSourcePdfFile,
} from "./ui/source-material-picker-modal";
import { confirmDestructiveAction } from "./ui/destructive-confirmation-modal";
import { choosePdfPageRange } from "./ui/pdf-page-range-modal";
import { showPdfExtractionProgress } from "./ui/pdf-extraction-progress-modal";
import { SavedSetGenerationModal } from "./ui/saved-set-generation-modal";
import { renderHorizontalTabs } from "./ui/horizontal-tabs";
import {
  chooseVisualFrame,
  importRemoteVisual,
  prepareSelectedVisuals,
  type PreparedVisual
} from "./visual-preparation";
import type { DetectedVisual } from "./visuals";
import type { GenerationTelemetryV1 } from "./generation-telemetry";

interface PendingGeneration {
  readonly source: CollectedSource;
  readonly configuration: GenerationConfiguration;
  readonly prompt: string;
  readonly preparedVisuals: readonly PreparedVisual[];
  readonly sourceAlignment: SourceAlignmentLedgerV1;
  draft?: GenerationDraftV1;
  jobId?: string;
  attempts?: 1 | 2;
  telemetry?: GenerationTelemetryV1;
}

interface ActiveBank {
  readonly path: string;
  bank: PracticeBankV4;
}

type SavedBankPage = "practice" | "progress" | "manage";

interface SavedBankRenderMetadata {
  readonly generationHistory?: GenerationHistoryV1;
  readonly generationHistoryWarning?: string;
  readonly pdfSourceDetail?: string;
  readonly pdfSourceWarning?: string;
  readonly pdfSourceHistory: readonly string[];
}

type StudyCheckpointRestoreOutcome =
  | { readonly status: "none" }
  | { readonly status: "resumed" }
  | { readonly status: "merged" }
  | {
      readonly status: "invalid" | "unavailable" | "ambiguous" | "blocked" | "conflict" | "failed";
      readonly message: string;
    };

type StudyCheckpointBankLookup =
  | {
      readonly status: "resolved";
      readonly active: ActiveBank;
      readonly checkpoint: StudySessionCheckpointV1;
      readonly relocated: boolean;
    }
  | { readonly status: "unavailable" | "ambiguous"; readonly message: string };

type BankStudySelection =
  | { readonly kind: "quick" }
  | { readonly kind: "set"; readonly setId: string }
  | {
      readonly kind: "path-set";
      readonly setId: string;
      readonly pathStepIndex: number;
    }
  | { readonly kind: "mixed" }
  | { readonly kind: "lesson"; readonly lessonId: string }
  | { readonly kind: "recommended" };

interface AnswerReviewPersistenceTarget {
  readonly bankPath: string;
  readonly bankId: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly requestHash: string;
  readonly expectedRevision: number;
}

type TerminalAnswerReviewStatus = Exclude<
  AnswerReviewStatus,
  { readonly state: "pending" }
>;

const ANSWER_REVIEW_PERSISTENCE_RETRY_DELAYS_MS = [0, 500, 2_000] as const;
const ANSWER_REVIEW_PERSISTENCE_DEFER_MS = 30_000;
const GENERATION_RECOVERY_DATA_KEY = "generationRecovery";
const LEARNING_BATCH_RECOVERY_DATA_KEY = "learningBatchRecovery";
const STUDY_CHECKPOINT_DATA_KEY = "studySessionCheckpoint";
const CONTEXT_MENU_SECTION = "practice-problem-generator";
const DISCARD_GENERATION_RECOVERY_CONFIRMATION = "DISCARD INTERRUPTED GENERATION";
const DISCARD_LEARNING_BATCH_RECOVERY_CONFIRMATION = "DISCARD GUIDED PATH";
const DISCARD_STUDY_CHECKPOINT_CONFIRMATION = "DISCARD PRACTICE SESSION";

function mobileProviderPresentations(
  settings: PracticeLabSettings,
): readonly ProviderPresentation[] {
  return (["codex", "claude", "agy"] as const).map((id) => ({
    id,
    label: id === "codex" ? "Codex" : id === "claude" ? "Claude" : "agy",
    available: false,
    executionMode: "queue-for-desktop" as const,
    supportsVision: false,
    reasoningEfforts: [...reasoningEffortsForProvider(id)],
    models: modelsForProvider(id),
    defaultModel: modelForProvider(settings, id),
    detail: "Generation is desktop-only; grounded answer reviews can be queued for a synchronized desktop.",
  }));
}

function desktopPendingProviderPresentations(
  settings: PracticeLabSettings,
  detail = "Checking installed desktop providers…",
): readonly ProviderPresentation[] {
  return (["codex", "claude", "agy"] as const).map((id) => ({
    id,
    label: id === "codex" ? "Codex" : id === "claude" ? "Claude" : "agy",
    available: false,
    executionMode: "unavailable" as const,
    supportsVision: false,
    reasoningEfforts: [...reasoningEffortsForProvider(id)],
    models: modelsForProvider(id),
    defaultModel: modelForProvider(settings, id),
    detail,
  }));
}

export default class PracticeLabPlugin extends Plugin {
  settings: PracticeLabSettings = {
    ...DEFAULT_SETTINGS,
    studyTypeSequence: [...DEFAULT_SETTINGS.studyTypeSequence],
    exerciseTypePercentages: { ...DEFAULT_SETTINGS.exerciseTypePercentages },
    display: copyDisplayPreferences(DEFAULT_SETTINGS.display),
  };
  private repository!: PracticeBankRepository;
  private learningPathController!: LearningPathController;
  private savedSetController!: SavedSetGenerationController;
  private dashboardRepository!: PracticeDashboardRepository;
  private cliLayer: CliProviderLayer | undefined;
  private cliLayerPromise: Promise<CliProviderLayer> | undefined;
  private providers: readonly ProviderPresentation[] = [];
  private providerRefreshEpoch = 0;
  private providerRefreshPromise: Promise<void> | undefined;
  private providersRefreshedAt = 0;
  private providerRefreshAfterIdle = false;
  private unloading = false;
  private pendingGeneration?: PendingGeneration;
  private activeBank?: ActiveBank;
  private lastSource?: CollectedSource;
  private dashboardRefreshTimer: number | undefined;
  private pendingAnswerReviewScanTimer: number | undefined;
  private answerReviewQueue: AnswerReviewQueue | undefined;
  private answerReviewQueueUnsubscribe: (() => void) | undefined;
  private readonly answerReviewRequests = new Map<string, AnswerReviewRequest>();
  private readonly answerReviewStatusesById = new Map<string, AnswerReviewStatus>();
  private readonly answerReviewTargets = new Map<string, AnswerReviewPersistenceTarget>();
  private readonly pausedAnswerReviewIds = new Set<string>();
  private readonly pendingAnswerReviewPersistence = new Map<
    string,
    TerminalAnswerReviewStatus
  >();
  private readonly queuedAnswerReviewPersistence = new Set<string>();
  private readonly warnedAnswerReviewPersistence = new Set<string>();
  private answerReviewPersistenceChain: Promise<void> = Promise.resolve();
  private answerReviewPersistenceRetryTimer: number | undefined;
  private activeGenerationJobId: string | undefined;
  private generationRecoveryHandle: DurableProcessHandle | undefined;
  private learningBatchRecoveryHandle: DurableProcessHandle | undefined;
  private generationRecoveryContext: GenerationRecoveryContextV1 | undefined;
  private generationRecoveryState: "idle" | "running" | "blocked" | "ready" | "failed" = "idle";
  private generationRecoveryMessage: string | undefined;
  private generationRecoveryTask: Promise<void> | undefined;
  private discardingGenerationRecovery = false;
  private studyCheckpoint: StudySessionCheckpointV1 | undefined;
  private invalidStudyCheckpointRaw: unknown;
  private studyCheckpointRecoveryIssue: string | undefined;
  private studyCheckpointRestoreTask: Promise<StudyCheckpointRestoreOutcome> | undefined;
  private bankStudyStartTask: Promise<void> | undefined;
  private storedDataSaveChain: Promise<void> = Promise.resolve();
  private readonly savedBankPagesByLeaf = new WeakMap<
    Element,
    Map<string, SavedBankPage>
  >();

  override async onload(): Promise<void> {
    const storedData: unknown = await this.loadData();
    this.settings = normalizeSettings(storedData);
    this.providers = Platform.isMobileApp
      ? mobileProviderPresentations(this.settings)
      : desktopPendingProviderPresentations(this.settings);
    this.generationRecoveryHandle = storedGenerationRecoveryHandle(storedData);
    this.learningBatchRecoveryHandle = storedLearningBatchRecoveryHandle(storedData);
    const storedCheckpoint = storedDataValue(storedData, STUDY_CHECKPOINT_DATA_KEY);
    const parsedCheckpoint = parseStudySessionCheckpoint(storedCheckpoint);
    if (parsedCheckpoint.status === "ok") {
      this.studyCheckpoint = parsedCheckpoint.checkpoint;
    } else if (parsedCheckpoint.status !== "missing") {
      this.invalidStudyCheckpointRaw = storedCheckpoint;
    }
    if (JSON.stringify(storedData) !== JSON.stringify(this.storedDataSnapshot())) {
      await this.saveData(this.storedDataSnapshot());
    }
    this.registerEditorExtension(hiddenPracticeMetadataEditorExtension);
    this.registerEditorExtension(practiceBankEditorExtension);
    this.dashboardRepository = new PracticeDashboardRepository(this.app, {
      hasPracticeBankMarker: (file) =>
        this.app.metadataCache.getFileCache(file)?.frontmatter?.["practice-lab"] === true,
      sourceTags: (file) => {
        const cache = this.app.metadataCache.getFileCache(file);
        return cache === null ? [] : getAllTags(cache) ?? [];
      }
    });
    this.repository = new PracticeBankRepository(this.app, {
      preferredPath: (sourcePath) => derivePracticePath(sourcePath, {
        mode: this.settings.practiceBankStorageMode,
        customBaseFolder: this.settings.practiceBankCustomFolder,
        customPathTemplate: this.settings.practiceBankPathTemplate,
      }, this.app.vault.configDir),
      locateExistingPath: async (sourcePath) =>
        this.existingPracticeBankPathForSource(sourcePath),
    });
    this.learningPathController = new LearningPathController({
      app: this.app,
      repository: this.repository,
      ensureCliLayer: async () => this.ensureCliLayer(),
      providers: () => this.providers,
      timeoutMs: () => this.settings.timeoutMs,
      pdfSourceBudgetLimits: () => ({
        maxPages: this.settings.pdfMaxPageCount,
        maxCharacters: this.settings.pdfMaxExtractedCharacters,
      }),
      setRecoveryHandle: async (handle) => {
        this.learningBatchRecoveryHandle = handle;
        await this.persistStoredData();
        for (const leaf of this.app.workspace.getLeavesOfType(PRACTICE_LEARNING_PATH_VIEW_TYPE)) {
          if (leaf.view instanceof PracticeLearningPathView) {
            leaf.view.setRecoveryAvailable(handle !== undefined);
          }
        }
      },
    });
    this.learningPathController.setRecoveryHandle(this.learningBatchRecoveryHandle);
    this.savedSetController = new SavedSetGenerationController({
      app: this.app,
      repository: this.repository,
      ensureCliLayer: async () => this.ensureCliLayer(),
      providers: () => this.providers,
      timeoutMs: () => this.settings.timeoutMs,
    });
    this.registerView(
      PRACTICE_LAB_VIEW_TYPE,
      (leaf) => new PracticeLabView(leaf, this.createViewOptions(leaf)),
    );
    if (!Platform.isMobileApp) {
      this.registerView(
        PRACTICE_LEARNING_PATH_VIEW_TYPE,
        (leaf) => new PracticeLearningPathView(
          leaf,
          this.createLearningPathViewOptions(leaf),
        ),
      );
    }
    this.registerView(
      PRACTICE_DASHBOARD_VIEW_TYPE,
      (leaf) => new PracticeDashboardView(leaf, this.createDashboardViewOptions())
    );
    this.registerCommands();
    this.registerDashboardRefreshEvents();
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, view) => {
      this.addEditorMenuItems(menu, editor, view);
    }));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      this.addFileMenuItems(menu, file);
    }));
    this.registerEvent(this.app.workspace.on("css-change", () => {
      this.app.workspace.containerEl
        .querySelectorAll<HTMLElement>(
          ".practice-lab-view, .practice-learning-path, .practice-lab-bank-card",
        )
        .forEach((element) => applyMarkdownHeadingTheme(element));
    }));
    this.registerMarkdownCodeBlockProcessor("practice-lab", async (source, element, context) => {
      try {
        await this.renderPracticeBlock(source, element, context);
      } catch (error) {
        console.error("Practice Problem Generator could not render a saved bank.", error);
        element.empty();
        this.renderReadOnlyBlock(
          element,
          `The interactive bank renderer failed safely: ${error instanceof Error ? error.message : String(error)}. The Markdown file remains available; reload the plugin after installing an update, or inspect the recovery JSON below.`,
          source,
        );
      }
    });
    this.addSettingTab(new PracticeLabSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      void this.restoreStudyCheckpoint();
    });

    if (!Platform.isMobileApp) void this.initializeDesktopWork();
  }

  override onunload(): void {
    this.unloading = true;
    this.answerReviewQueueUnsubscribe?.();
    this.answerReviewQueueUnsubscribe = undefined;
    void this.answerReviewQueue?.shutdown();
    const coordinator = this.cliLayer?.coordinator;
    if (this.learningPathController.detachActive()) {
      // The durable guided-set process continues independently for recovery.
    } else if (
      this.activeGenerationJobId !== undefined
      && this.generationRecoveryHandle !== undefined
    ) {
      coordinator?.detach(this.activeGenerationJobId);
    } else {
      coordinator?.cancel();
    }
    this.clearAnswerReviewPersistenceRetryTimer();
    this.clearDashboardRefreshTimer();
    this.clearPendingAnswerReviewScanTimer();
  }

  async saveSettings(
    options: { readonly refreshProviders?: boolean } = {},
  ): Promise<void> {
    await this.persistStoredData();
    for (const leaf of this.app.workspace.getLeavesOfType(PRACTICE_LAB_VIEW_TYPE)) {
      if (leaf.view instanceof PracticeLabView) {
        leaf.view.setDisplayPreferences(this.settings.display);
      }
    }
    for (const leaf of this.app.workspace.getLeavesOfType(PRACTICE_DASHBOARD_VIEW_TYPE)) {
      if (leaf.view instanceof PracticeDashboardView) {
        leaf.view.setDisplayPreferences(this.settings.display, {
          rangeWeeks: this.settings.dashboardActivityRangeWeeks,
          metric: this.settings.dashboardActivityMetric,
          weekStart: this.settings.dashboardWeekStart,
        });
      }
    }
    if (options.refreshProviders !== true) return;
    const activeLayer = this.cliLayer;
    if (activeLayer?.coordinator.isBusy) {
      void activeLayer.coordinator.whenIdle().then(() => {
        if (!this.unloading && this.cliLayer === activeLayer) {
          this.cliLayer = undefined;
        }
      });
    } else {
      this.cliLayer = undefined;
    }
    if (!Platform.isMobileApp) void this.refreshProviders(true);
  }

  private storedDataSnapshot(): Record<string, unknown> {
    return {
      ...this.settings,
      ...(this.generationRecoveryHandle === undefined
        ? {}
        : { [GENERATION_RECOVERY_DATA_KEY]: this.generationRecoveryHandle }),
      ...(this.learningBatchRecoveryHandle === undefined
        ? {}
        : { [LEARNING_BATCH_RECOVERY_DATA_KEY]: this.learningBatchRecoveryHandle }),
      ...(this.studyCheckpoint === undefined
        ? this.invalidStudyCheckpointRaw === undefined
          ? {}
          : { [STUDY_CHECKPOINT_DATA_KEY]: this.invalidStudyCheckpointRaw }
        : { [STUDY_CHECKPOINT_DATA_KEY]: this.studyCheckpoint }),
    };
  }

  private async persistStoredData(): Promise<void> {
    const snapshot = this.storedDataSnapshot();
    const operation = this.storedDataSaveChain
      .catch(() => undefined)
      .then(async () => await this.saveData(snapshot));
    this.storedDataSaveChain = operation;
    await operation;
  }

  private async persistStudySessionCheckpoint(
    progress: StudySessionProgressV1,
  ): Promise<void> {
    if (this.invalidStudyCheckpointRaw !== undefined) {
      throw new Error(
        "A malformed older study checkpoint is preserved in plugin data. Discard or recover it before starting another session.",
      );
    }
    if (this.studyCheckpoint === undefined) {
      const active = this.activeBank;
      if (
        active === undefined
        || active.path !== progress.bankPath
        || active.bank.bankId !== progress.bankId
        || active.bank.revision !== progress.bankRevisionAtStart
      ) {
        throw new Error("The active bank changed before its study checkpoint could be created.");
      }
      this.studyCheckpoint = createStudySessionCheckpoint(
        active.path,
        active.bank,
        progress,
      );
    } else {
      this.studyCheckpoint = updateStudySessionCheckpoint(
        this.studyCheckpoint,
        progress,
      );
    }
    this.studyCheckpointRecoveryIssue = undefined;
    await this.persistStoredData();
  }

  private async clearStudySessionCheckpoint(sessionId?: string): Promise<void> {
    if (
      sessionId !== undefined
      && this.studyCheckpoint !== undefined
      && this.studyCheckpoint.sessionId !== sessionId
    ) {
      throw new Error("The requested checkpoint cleanup does not match the saved session.");
    }
    this.studyCheckpoint = undefined;
    this.invalidStudyCheckpointRaw = undefined;
    this.studyCheckpointRecoveryIssue = undefined;
    await this.persistStoredData();
  }

  private async restoreStudyCheckpoint(
    preferred?: ActiveBank,
    notifyFailure = true,
  ): Promise<StudyCheckpointRestoreOutcome> {
    const running = this.studyCheckpointRestoreTask;
    if (running !== undefined) return await running;
    const task = this.performStudyCheckpointRestore(preferred);
    this.studyCheckpointRestoreTask = task;
    try {
      const outcome = await task;
      this.studyCheckpointRecoveryIssue = outcome.status === "invalid"
        || outcome.status === "unavailable"
        || outcome.status === "ambiguous"
        || outcome.status === "blocked"
        || outcome.status === "conflict"
        || outcome.status === "failed"
        ? outcome.message
        : undefined;
      if (
        notifyFailure
        && outcome.status !== "none"
        && outcome.status !== "resumed"
        && outcome.status !== "merged"
        && outcome.status !== "conflict"
      ) {
        new Notice(
          `Practice Problem Generator: ${outcome.message} Start a saved practice bank to resolve this session, or use “Discard saved practice session” if it is no longer needed.`,
          14_000,
        );
      }
      return outcome;
    } finally {
      if (this.studyCheckpointRestoreTask === task) {
        this.studyCheckpointRestoreTask = undefined;
      }
    }
  }

  private async performStudyCheckpointRestore(
    preferred?: ActiveBank,
  ): Promise<StudyCheckpointRestoreOutcome> {
    if (this.invalidStudyCheckpointRaw !== undefined) {
      return {
        status: "invalid",
        message: "The preserved device-local study checkpoint is malformed and cannot be resumed.",
      };
    }
    const checkpoint = this.studyCheckpoint;
    if (checkpoint === undefined) return { status: "none" };
    try {
      const lookup = await this.resolveStudyCheckpointBank(checkpoint, preferred);
      if (lookup.status !== "resolved") return lookup;
      if (
        preferred !== undefined
        && preferred.bank.bankId !== lookup.checkpoint.bankId
      ) {
        return {
          status: "conflict",
          message: "Another saved practice session is in progress for a different bank.",
        };
      }
      const current = lookup.active.bank;
      const resolvedCheckpoint = lookup.checkpoint;
      if (current.revision < resolvedCheckpoint.bankRevisionAtStart) {
        return {
          status: "blocked",
          message: "This device has an older bank revision than the saved session. Synchronize the newer bank before resuming.",
        };
      }
      if (resolvedCheckpoint.phase === "merging") {
        await this.resumeMergingStudyCheckpoint(
          resolvedCheckpoint,
          lookup.active.path,
          current,
        );
        return { status: "merged" };
      }
      this.activeBank = lookup.active;
      const lockedBank = checkpointBankSnapshot(resolvedCheckpoint);
      const source = sourcePresentationFromBank(lockedBank);
      const view = await this.openView(source);
      const visualUrls = new Map(resolvedCheckpoint.visuals.map((visual) => [
        visual.id,
        this.app.vault.adapter.getResourcePath(visual.vaultPath),
      ]));
      const exercises = presentExercises(
        resolvedCheckpoint.exercises,
        (visualId) => visualUrls.get(visualId),
        resolvedCheckpoint.segments,
        resolvedCheckpoint.alignmentSnapshots ?? [],
      );
      const learningEvidence = resolvedCheckpoint.learningProgress === undefined
        ? []
        : this.learningEvidenceTemplates(
            lockedBank as PracticeBankV4,
            resolvedCheckpoint.learningProgress.scope.sets.map((reference) => {
              const set = (lockedBank as PracticeBankV4).practiceSets.find((candidate) => candidate.id === reference.id);
              if (set === undefined) throw new Error(`The saved learning scope references missing set ${reference.id}.`);
              return set;
            }),
            resolvedCheckpoint.exercises.map((exercise) => exercise.id),
          );
      view.restoreStudy(
        exercises,
        studyProgressFromCheckpoint(resolvedCheckpoint),
        learningEvidence,
      );
      if (!Platform.isMobileApp) {
        for (const answer of resolvedCheckpoint.answers) {
          if (answer.aiReview?.status.state !== "pending") continue;
          this.enqueueAnswerReview(answer.aiReview.request);
        }
      }
      new Notice(
        `${lookup.relocated ? "Found the moved practice bank and updated its recovery path. " : ""}Resumed practice at question ${Math.min(resolvedCheckpoint.currentQuestionIndex + 1, resolvedCheckpoint.exercises.length)} of ${resolvedCheckpoint.exercises.length}.`,
        8_000,
      );
      return { status: "resumed" };
    } catch (error) {
      return {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async resolveStudyCheckpointBank(
    checkpoint: StudySessionCheckpointV1,
    preferred?: ActiveBank,
  ): Promise<StudyCheckpointBankLookup> {
    const byPath = new Map<string, ActiveBank>();
    const addCandidate = (candidate: ActiveBank): void => {
      const normalized = normalizePath(candidate.path);
      const firstPart = normalized.split("/")[0]?.toLocaleLowerCase();
      const configPart = this.app.vault.configDir.toLocaleLowerCase();
      if (firstPart === ".tmp" || firstPart === ".trash" || firstPart === configPart) {
        return;
      }
      byPath.set(normalized.toLocaleLowerCase(), {
        path: normalized,
        bank: candidate.bank,
      });
    };
    if (preferred !== undefined) addCandidate(preferred);

    const exactFile = this.app.vault.getAbstractFileByPath(checkpoint.bankPath);
    if (exactFile instanceof TFile) {
      try {
        addCandidate({
          path: exactFile.path,
          bank: await this.loadPracticeBank(exactFile.path),
        });
      } catch {
        // A valid matching copy elsewhere may still recover this checkpoint.
      }
    }
    const snapshot = await this.dashboardRepository.load();
    for (const record of snapshot.records) {
      addCandidate({ path: record.bankPath, bank: record.bank });
    }
    const resolution = resolveStudyCheckpointBankCandidate(
      checkpoint,
      [...byPath.values()].map((candidate) => ({
        bankPath: candidate.path,
        bankId: candidate.bank.bankId,
      })),
    );
    if (resolution.status === "missing") {
      return {
        status: "unavailable",
        message: "The bank for the saved session was moved, replaced, deleted, or is not synchronized on this device.",
      };
    }
    if (resolution.status === "ambiguous") {
      return {
        status: "ambiguous",
        message: `More than one bank has the saved session identity (${resolution.candidates.map((candidate) => candidate.bankPath).join(", ")}). Resolve the duplicate banks before resuming.`,
      };
    }
    const key = normalizePath(resolution.candidate.bankPath).toLocaleLowerCase();
    const active = byPath.get(key);
    if (active === undefined) {
      return {
        status: "unavailable",
        message: "The matching practice bank disappeared while recovery was checking it.",
      };
    }
    let resolvedCheckpoint = checkpoint;
    if (resolution.status === "relocated") {
      const latest = rebaseLatestStudySessionCheckpointBankPath(
        checkpoint,
        this.studyCheckpoint,
        active.path,
      );
      if (latest.status === "stale") {
        return {
          status: "unavailable",
          message: "The saved session changed while its bank location was being recovered.",
        };
      }
      resolvedCheckpoint = latest.checkpoint;
      if (latest.status === "rebased") {
        this.studyCheckpoint = resolvedCheckpoint;
        await this.persistStoredData();
      }
    }
    return {
      status: "resolved",
      active,
      checkpoint: resolvedCheckpoint,
      relocated: resolution.status === "relocated",
    };
  }

  private async resumeMergingStudyCheckpoint(
    checkpoint: StudySessionCheckpointV1,
    bankPath: string,
    current: PracticeBankV4,
  ): Promise<void> {
    if (current.bankId !== checkpoint.bankId) {
      throw new Error("The practice bank changed identity while a finished session was awaiting merge. The checkpoint was retained.");
    }
    const session = finishedSessionFromCheckpoint(checkpoint);
    const summary = createSessionSummary(checkpointBankSnapshot(checkpoint), session);
    const saved = await this.repository.appendFinishedSession(
      bankPath,
      summary,
      checkpoint.bankRevisionAtStart,
    );
    this.activeBank = { path: bankPath, bank: saved };
    await this.clearStudySessionCheckpoint(checkpoint.sessionId);
    this.scheduleDashboardRefresh();
    new Notice("Recovered and saved the completed practice session without duplicating history.", 10_000);
  }

  private async requestDiscardStudyCheckpoint(): Promise<boolean> {
    if (this.studyCheckpoint === undefined && this.invalidStudyCheckpointRaw === undefined) {
      new Notice("There is no saved in-progress practice session to discard.");
      return false;
    }
    return await this.discardStudyCheckpointAfterConfirmation({
      title: "Discard the saved practice session?",
      warning: "The device-local in-progress session, current input, and any answers not yet merged into the Practice Markdown will be removed.",
      consequences: [
        "Already finished sessions in practice-bank history remain unchanged.",
        "Generated problems, source notes, images, settings, scores, and synchronized data remain unchanged.",
        "This in-progress checkpoint cannot be reconstructed after removal.",
      ],
      confirmationPhrase: DISCARD_STUDY_CHECKPOINT_CONFIRMATION,
      confirmLabel: "Discard saved session",
      completionNotice: "The device-local practice-session checkpoint was discarded.",
    });
  }

  private async requestDiscardStudyCheckpointAndStart(
    targetBank: PracticeBankV4,
    recoveryMessage: string,
  ): Promise<boolean> {
    const checkpoint = this.studyCheckpoint;
    const progress = checkpoint === undefined
      ? "Its progress cannot be read because the saved checkpoint is malformed."
      : (() => {
          const summary = summarizeStudyCheckpointProgress(checkpoint);
          const answerLabel = summary.answeredCount === 1 ? "answer" : "answers";
          const skipLabel = summary.skippedCount === 1 ? "skip" : "skips";
          return `It contains ${summary.answeredCount} ${answerLabel}, ${summary.skippedCount} ${skipLabel}${summary.hasDraft ? ", and unsaved input" : ", and no unsaved input"}.`;
        })();
    return await this.discardStudyCheckpointAfterConfirmation({
      title: "Discard the saved session and start this practice?",
      warning: `${recoveryMessage} ${progress}`,
      consequences: [
        "The unavailable session's current input and any answers not yet merged into history will be removed from this device.",
        `The selected “${targetBank.source.title}” bank will start immediately after confirmation. Its exercises, lessons, history, and statistics will not be changed.`,
        "Source notes, PDFs, images, provider settings, and every other saved practice bank remain unchanged.",
      ],
      confirmationPhrase: DISCARD_STUDY_CHECKPOINT_CONFIRMATION,
      confirmLabel: "Discard session and start",
      completionNotice: "The unavailable saved session was discarded. Starting the selected practice now.",
    });
  }

  private async discardStudyCheckpointAfterConfirmation(options: {
    readonly title: string;
    readonly warning: string;
    readonly consequences: readonly string[];
    readonly confirmationPhrase: string;
    readonly confirmLabel: string;
    readonly completionNotice: string;
  }): Promise<boolean> {
    const sessionId = this.studyCheckpoint?.sessionId;
    const confirmed = await confirmDestructiveAction(this.app, options);
    if (!confirmed) return false;
    if (
      sessionId !== undefined
      && this.studyCheckpoint !== undefined
      && this.studyCheckpoint.sessionId !== sessionId
    ) {
      throw new Error("The saved practice session changed while the discard confirmation was open.");
    }
    await this.clearStudySessionCheckpoint();
    for (const leaf of this.app.workspace.getLeavesOfType(PRACTICE_LAB_VIEW_TYPE)) {
      if (leaf.view instanceof PracticeLabView) leaf.view.discardStudySession();
    }
    new Notice(options.completionNotice, 8_000);
    return true;
  }

  public providerPresentation(
    provider: ProviderPresentation["id"],
  ): ProviderPresentation | undefined {
    return this.providers.find((entry) => entry.id === provider);
  }

  public async requestResetAllSettings(): Promise<void> {
    const confirmed = await confirmDestructiveAction(this.app, {
      title: "Reset all Practice Problem Generator settings?",
      warning: "Every Practice Problem Generator preference will return to its installed default.",
      consequences: [
        "Provider, model, reasoning, exercise mix, focus, PDF, study, interface, storage, timeout, and executable settings will be reset.",
        "Generated practice banks, session history, answers, and statistics will not be changed.",
        "You will need to re-enter any custom executable paths.",
      ],
      confirmationPhrase: RESET_SETTINGS_CONFIRMATION,
      confirmLabel: "Reset settings",
    });
    if (!confirmed) return;
    this.settings = normalizeSettings(DEFAULT_SETTINGS);
    await this.saveSettings({ refreshProviders: true });
    new Notice("Practice Problem Generator settings were reset. Saved banks and history were preserved.", 8_000);
  }

  public async requestClearAllPracticeHistory(): Promise<void> {
    const snapshot = await this.dashboardRepository.load();
    const invalid = snapshot.issues.filter((issue) => issue.severity === "error");
    if (invalid.length > 0) {
      throw new Error(
        `Practice Problem Generator found ${invalid.length} unreadable practice ${invalid.length === 1 ? "bank" : "banks"}. Repair them before clearing all history so the operation cannot silently skip data.`,
      );
    }
    const affected = snapshot.records.filter((record) => record.bank.sessions.length > 0);
    const sessionCount = affected.reduce(
      (total, record) => total + record.bank.sessions.length,
      0,
    );
    if (sessionCount === 0) {
      new Notice("There is no saved Practice Problem Generator session history to clear.");
      return;
    }
    const confirmed = await confirmDestructiveAction(this.app, {
      title: "Clear all Practice Problem Generator session history?",
      warning: `This will remove ${sessionCount} ${sessionCount === 1 ? "session" : "sessions"} from ${affected.length} practice ${affected.length === 1 ? "bank" : "banks"}.`,
      consequences: [
        "Scores, ratings, submitted answers, AI-review requests, feedback, and session statistics will be removed.",
        "Generated exercises, source links, generation history, PDF page provenance, and settings will be preserved.",
        "Practice Problem Generator will create a Markdown backup under the vault's .tmp/practice-lab-ai/data-management folder before changing any bank.",
      ],
      confirmationPhrase: CLEAR_HISTORY_CONFIRMATION,
      confirmLabel: "Clear all history",
    });
    if (!confirmed) return;
    const backupRoot = await this.backupPracticeBanks(affected, "clear-all-history");
    this.discardAnswerReviews(affected.flatMap((record) => record.bank.sessions));
    await this.answerReviewPersistenceChain;
    let cleared = 0;
    for (const record of affected) {
      try {
        const result = await this.repository.clearSessions(
          record.bankPath,
          record.bank.bankId,
        );
        cleared += result.removedSessions;
        if (this.activeBank?.path === record.bankPath) this.activeBank.bank = result.bank;
      } catch (error) {
        throw new Error(
          `Cleared ${cleared} of ${sessionCount} sessions before a bank update failed. Restore affected files from ${backupRoot}. ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    this.scheduleDashboardRefresh();
    new Notice(
      `Cleared ${cleared} Practice Problem Generator ${cleared === 1 ? "session" : "sessions"}. Backup: ${backupRoot}`,
      12_000,
    );
  }

  public async requestDeleteAllPracticeBanks(): Promise<void> {
    const snapshot = await this.dashboardRepository.load();
    const invalid = snapshot.issues.filter((issue) => issue.severity === "error");
    if (invalid.length > 0) {
      throw new Error(
        `Practice Problem Generator found ${invalid.length} unreadable practice ${invalid.length === 1 ? "bank" : "banks"}. Repair them before deleting all banks so the operation cannot silently leave hidden data behind.`,
      );
    }
    if (snapshot.records.length === 0) {
      new Notice("There are no valid Practice Problem Generator banks to delete.");
      return;
    }
    const sessionCount = snapshot.records.reduce(
      (total, record) => total + record.bank.sessions.length,
      0,
    );
    const confirmed = await confirmDestructiveAction(this.app, {
      title: "Delete all Practice Problem Generator banks?",
      warning: `This will send ${snapshot.records.length} practice ${snapshot.records.length === 1 ? "bank" : "banks"} and ${sessionCount} saved ${sessionCount === 1 ? "session" : "sessions"} through Obsidian's configured deletion method.`,
      consequences: [
        "All generated exercises, masks, generation records, answers, AI feedback, and statistics stored in those bank notes will be removed.",
        "Source notes, source PDFs, original attachments, and Practice Problem Generator settings will be preserved.",
        "Recoverability depends on your Obsidian trash configuration and operating-system trash retention.",
      ],
      confirmationPhrase: DELETE_BANK_CONFIRMATION,
      confirmLabel: "Delete all banks",
    });
    if (!confirmed) return;
    this.discardAnswerReviews(snapshot.records.flatMap((record) => record.bank.sessions));
    await this.answerReviewPersistenceChain;
    let deleted = 0;
    for (const record of snapshot.records) {
      const current = await this.requireCurrentPracticeBank(
        record.bankPath,
        record.bank.bankId,
      );
      await this.app.fileManager.trashFile(current.file);
      deleted += 1;
      if (this.activeBank?.path === record.bankPath) delete this.activeBank;
    }
    this.scheduleDashboardRefresh();
    new Notice(`Moved ${deleted} Practice Problem Generator ${deleted === 1 ? "bank" : "banks"} through Obsidian's configured trash method.`, 10_000);
  }

  async testAgyVisionCapability(): Promise<string> {
    if (Platform.isMobileApp) {
      throw new Error("agy vision testing is available only on desktop.");
    }
    const layer = await this.ensureCliLayer();
    const detection = await layer.adapters.agy.detect();
    if (!detection.available) {
      throw new Error(detection.detail ?? "The agy executable was not found.");
    }
    const result = await layer.probeAgyVision();
    await this.refreshProviders();
    return result.passed
      ? result.detail
      : `agy vision remains disabled. ${result.detail}`;
  }

  private registerCommands(): void {
    if (!Platform.isMobileApp) {
      this.addCommand({
        id: "generate-from-selection",
        name: "Generate from selection",
        editorCheckCallback: (checking, editor) => {
          const available = editor.getSelection().trim().length > 0;
          if (!checking && available) void this.generateFrom("selection", editor.getSelection());
          return available;
        },
      });
      this.addCommand({
        id: "generate-from-current-note",
        name: "Generate from current note",
        checkCallback: (checking) => {
          const available = this.activeMarkdownFile() !== null;
          if (!checking && available) void this.generateFrom("note");
          return available;
        },
      });
      this.addCommand({
        id: "generate-from-current-pdf",
        name: "Generate from current PDF",
        checkCallback: (checking) => {
          const file = this.activePdfFile();
          const available = file !== null;
          if (!checking && available && file !== null) void this.generateFromPdf(file);
          return available;
        },
      });
      this.addCommand({
        id: "open-practice-lab",
        name: "Open workspace",
        callback: () => { void this.openView(); },
      });
      this.addCommand({
        id: "build-guided-learning-path-from-selection",
        name: "Build guided learning path from selection",
        editorCheckCallback: (checking, editor) => {
          const selection = editor.getSelection();
          const available = selection.trim().length > 0;
          if (!checking && available) void this.generateGuidedFrom("selection", selection);
          return available;
        },
      });
      this.addCommand({
        id: "build-guided-learning-path-from-current-note",
        name: "Build guided learning path from current note",
        checkCallback: (checking) => {
          const available = this.activeMarkdownFile() !== null;
          if (!checking && available) void this.generateGuidedFrom("note");
          return available;
        },
      });
      this.addCommand({
        id: "build-guided-learning-path-from-current-pdf",
        name: "Build guided learning path from current PDF",
        checkCallback: (checking) => {
          const file = this.activePdfFile();
          const available = file !== null;
          if (!checking && available && file !== null) void this.generateGuidedFromPdf(file);
          return available;
        },
      });
      this.addCommand({
        id: "open-guided-learning-path",
        name: "Open guided learning path builder",
        callback: () => { void this.openLearningPathView(); },
      });
      this.addCommand({
        id: "resume-guided-learning-path",
        name: "Resume interrupted guided learning path",
        checkCallback: (checking) => {
          const available = this.learningBatchRecoveryHandle !== undefined;
          if (!checking && available) void this.resumeLearningPathBatch();
          return available;
        },
      });
      this.addCommand({
        id: "discard-guided-learning-path-recovery",
        name: "Discard interrupted guided learning path",
        checkCallback: (checking) => {
          const available = this.learningBatchRecoveryHandle !== undefined;
          if (!checking && available) void this.requestDiscardLearningPathRecovery();
          return available;
        },
      });
      this.addCommand({
        id: "resume-interrupted-generation",
        name: "Resume interrupted generation",
        checkCallback: (checking) => {
          const available = this.generationRecoveryHandle !== undefined;
          if (!checking && available) void this.requestResumeInterruptedGeneration();
          return available;
        },
      });
      this.addCommand({
        id: "retry-interrupted-generation",
        name: "Retry interrupted generation from approved request",
        checkCallback: (checking) => {
          const available = this.generationRecoveryHandle !== undefined
            && this.generationRecoveryState === "failed";
          if (!checking && available) void this.requestRetryInterruptedGeneration();
          return available;
        },
      });
      this.addCommand({
        id: "discard-interrupted-generation",
        name: "Discard interrupted generation",
        checkCallback: (checking) => {
          const available = this.generationRecoveryHandle !== undefined;
          if (!checking && available) void this.requestDiscardInterruptedGeneration();
          return available;
        },
      });
    }
    this.addCommand({
      id: "resume-saved-practice-session",
      name: "Resume saved practice session",
      checkCallback: (checking) => {
        const available = this.studyCheckpoint !== undefined;
        if (!checking && available) void this.restoreStudyCheckpoint();
        return available;
      },
    });
    this.addCommand({
      id: "discard-saved-practice-session",
      name: "Discard saved practice session",
      checkCallback: (checking) => {
        const available = this.studyCheckpoint !== undefined
          || this.invalidStudyCheckpointRaw !== undefined;
        if (!checking && available) void this.requestDiscardStudyCheckpoint();
        return available;
      },
    });
    this.addCommand({
      id: "open-practice-dashboard",
      name: "Open practice dashboard",
      callback: () => { void this.openDashboard(); },
    });
    this.addCommand({
      id: "prepare-for-offline-practice",
      name: "Prepare for offline practice",
      callback: () => { void this.prepareForOfflinePractice(); },
    });
    this.addCommand({
      id: "start-practice-for-current-note",
      name: "Start practice for current note",
      checkCallback: (checking) => {
        const available = this.activeMarkdownFile() !== null;
        if (!checking && available) void this.startPracticeForCurrentNote();
        return available;
      }
    });
    this.addCommand({
      id: "start-practice-for-current-pdf",
      name: "Start practice for current PDF",
      checkCallback: (checking) => {
        const file = this.activePdfFile();
        const available = file !== null;
        if (!checking && available && file !== null) {
          void this.startPracticeForSourceFile(file);
        }
        return available;
      }
    });
  }

  private addEditorMenuItems(menu: Menu, editor: Editor, view: MarkdownView | MarkdownFileInfo): void {
    if (Platform.isMobileApp || view.file === null) return;
    const selection = editor.getSelection();

    menu.addSeparator();
    if (selection.trim()) {
      menu.addItem((item) => item
        .setTitle("Create practice from selection…")
        .setIcon("text-select")
        .setSection(CONTEXT_MENU_SECTION)
        .onClick(() => { void this.generateFrom("selection", selection); }));
    }
    menu.addItem((item) => item
      .setTitle("Create practice from this note…")
      .setIcon("sparkles")
      .setSection(CONTEXT_MENU_SECTION)
      .onClick(() => { void this.generateFrom("note"); }));
    menu.addItem((item) => item
      .setTitle("Start saved practice for this note")
      .setIcon("gamepad-2")
      .setSection(CONTEXT_MENU_SECTION)
      .onClick(() => { void this.startPracticeForCurrentNote(); }));
  }

  private addFileMenuItems(menu: Menu, file: TAbstractFile): void {
    if (
      Platform.isMobileApp
      || !(file instanceof TFile)
      || file.extension.toLowerCase() !== "pdf"
    ) return;

    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle("Create practice from selected pages…")
      .setIcon("file-scan")
      .setSection(CONTEXT_MENU_SECTION)
      .onClick(() => { void this.generateFromPdf(file); }));
    menu.addItem((item) => item
      .setTitle("Start saved practice for this PDF")
      .setIcon("gamepad-2")
      .setSection(CONTEXT_MENU_SECTION)
      .onClick(() => { void this.startPracticeForSourceFile(file); }));
  }

  private async generateFrom(mode: MarkdownSourceMode, selection?: string): Promise<void> {
    try {
      if (this.learningBatchRecoveryHandle !== undefined) {
        new Notice("Finish, save, or discard the interrupted guided path before starting another generation.", 8_000);
        await this.resumeLearningPathBatch();
        return;
      }
      if (await this.redirectToInterruptedGeneration()) return;
      const source = await collectSource(
        this.app,
        mode,
        selection,
        this.settings.sourceClassificationRules,
      );
      this.lastSource = source;
      await this.openView(source, true);
    } catch (error) {
      this.showError(error);
    }
  }

  private async generateFromPdf(file?: TFile): Promise<void> {
    try {
      if (this.learningBatchRecoveryHandle !== undefined) {
        new Notice("Finish, save, or discard the interrupted guided path before starting another generation.", 8_000);
        await this.resumeLearningPathBatch();
        return;
      }
      if (await this.redirectToInterruptedGeneration()) return;
      const source = await this.requestPdfSource(file);
      if (source === null) return;
      this.lastSource = source;
      await this.openView(source, true);
    } catch (error) {
      this.showError(error);
    }
  }

  private async requestPdfSource(
    file = this.activePdfFile(),
    allowance?: PdfSourceBudgetLimitsV1,
  ): Promise<CollectedSource | null> {
    if (Platform.isMobileApp) {
      throw new Error("PDF source extraction is available in Obsidian desktop only.");
    }
    if (file === null || file.extension.toLowerCase() !== "pdf") {
      throw new Error("Open or right-click a vault PDF before using Practice Problem Generator.");
    }
    const limits = allowance ?? {
      maxPages: this.settings.pdfMaxPageCount,
      maxCharacters: this.settings.pdfMaxExtractedCharacters,
    };
    if (limits.maxPages < 1 || limits.maxCharacters < 1) {
      throw new Error(
        "The approved source bundle has no PDF capacity remaining. Remove PDF pages or raise the total PDF budget in settings.",
      );
    }
    const bytes = await this.app.vault.readBinary(file);
    const inspecting = new Notice(
      `Practice Problem Generator: inspecting ${file.basename} locally…`,
      0,
    );
    let info: PdfDocumentInfo;
    try {
      info = await inspectPdf(bytes, {
        pdfinfoExecutable: this.settings.pdfinfoExecutable,
        timeoutMs: this.settings.pdfExtractionTimeoutMs,
      });
    } finally {
      inspecting.hide();
    }
    const range = await choosePdfPageRange(this.app, {
      title: file.basename,
      info,
      defaultPageCount: Math.min(this.settings.pdfDefaultPageCount, limits.maxPages),
      maxPages: limits.maxPages,
      maxCharacters: limits.maxCharacters,
    });
    if (range === null) return null;
    const progress = showPdfExtractionProgress(this.app, {
      title: file.basename,
      ...range,
    });
    let extraction: PdfExtractionResult;
    try {
      extraction = await this.extractPdfRange(
        bytes,
        info,
        range,
        limits.maxPages,
        progress.signal,
        limits.maxCharacters,
      );
    } catch (error) {
      if (progress.signal.aborted) return null;
      throw error;
    } finally {
      progress.finish();
    }
    const source = collectPdfSource(
      file,
      extraction,
      this.settings.sourceClassificationRules,
    );
    new Notice(
      `Loaded ${extraction.extractedPageCount} PDF ${extraction.extractedPageCount === 1 ? "page" : "pages"} locally. Review the exact payload before generation.`,
      6000,
    );
    return source;
  }

  private async extractPdfRange(
    bytes: ArrayBuffer,
    info: PdfDocumentInfo,
    range: PdfPageRange,
    maxPages = this.settings.pdfMaxPageCount,
    signal?: AbortSignal,
    maxCharacters = this.settings.pdfMaxExtractedCharacters,
  ): Promise<PdfExtractionResult> {
    return extractPdfPages(bytes, info, range, {
      pdfinfoExecutable: this.settings.pdfinfoExecutable,
      pdftotextExecutable: this.settings.pdftotextExecutable,
      maxPages,
      maxCharacters,
      timeoutMs: this.settings.pdfExtractionTimeoutMs,
      ...(signal === undefined ? {} : { signal }),
    });
  }

  private createViewOptions(leaf: WorkspaceLeaf): PracticeLabViewOptions {
    return {
      creationAvailable: !Platform.isMobileApp,
      providers: this.providers,
      displayPreferences: this.settings.display,
      callbacks: {
        ...(Platform.isMobileApp ? {} : {
          refreshProviders: async () => this.refreshProviders(true),
        }),
        requestSource: async (mode) => {
          try {
            const selection = mode === "selection"
              ? this.app.workspace.getActiveViewOfType(MarkdownView)?.editor.getSelection()
              : undefined;
            const source = await collectSource(
              this.app,
              mode,
              selection,
              this.settings.sourceClassificationRules,
            );
            this.lastSource = source;
            return source;
          } catch (error) {
            this.showError(error);
            return null;
          }
        },
        ...(Platform.isMobileApp ? {} : {
          requestNoteSource: async () => {
            try {
              const file = await chooseSourceNoteFile(this.app);
              if (file === null) return null;
              const source = await collectSourceFromFile(
                this.app,
                file,
                "note",
                undefined,
                this.settings.sourceClassificationRules,
              );
              this.lastSource = source;
              return source;
            } catch (error) {
              this.showError(error);
              return null;
            }
          },
        }),
        ...(Platform.isMobileApp ? {} : {
          requestPdfSource: async () => {
            try {
              const source = await this.requestPdfSource();
              if (source !== null) this.lastSource = source;
              return source;
            } catch (error) {
              this.showError(error);
              return null;
            }
          },
        }),
        confirmSourceClassification: async (presentation, classification) => {
          const source = this.resolveCollectedSource(presentation);
          const confirmed = confirmSourceClassification(source, classification);
          this.lastSource = confirmed;
          return confirmed;
        },
        previewPayload: async (source, configuration) => this.previewPayload(source, configuration),
        generate: async (request) => this.runGeneration(
          request.source,
          request.configuration,
          request.onActivity,
        ),
        cancelGeneration: () => {
          if (this.activeGenerationJobId !== undefined) {
            this.cliLayer?.coordinator.cancel(this.activeGenerationJobId);
          }
        },
        ...(Platform.isMobileApp ? {} : {
          openGuidedLearningPath: async (source: SourcePresentation | null) => {
            await this.switchCreationMode(leaf, "guided", source);
          },
          resumeInterruptedGeneration: async () => {
            await this.requestResumeInterruptedGeneration();
          },
          retryInterruptedGeneration: async () => {
            await this.requestRetryInterruptedGeneration();
          },
          discardInterruptedGeneration: async () => {
            await this.requestDiscardInterruptedGeneration();
          },
        }),
        saveDrafts: async (source, drafts) => this.saveDrafts(source, drafts),
        resolveStudySessionOrigin: () => this.activeBank === undefined
          ? null
          : {
              bankPath: this.activeBank.path,
              bankId: this.activeBank.bank.bankId,
              bankRevisionAtStart: this.activeBank.bank.revision,
              exerciseCountAtStart: this.activeBank.bank.exercises.length,
            },
        persistStudyCheckpoint: async (progress) => {
          await this.persistStudySessionCheckpoint(progress);
        },
        enqueueAnswerReview: async (request) => {
          const validation = validateAnswerReviewInput(createAnswerReviewInput(request));
          if (!validation.valid) {
            throw new Error(validation.errors?.[0] ?? "The locked AI review is invalid.");
          }
          if (!Platform.isMobileApp) this.enqueueAnswerReview(request);
        },
        updateStudyOrderDefaults: async (selection) => {
          this.settings.studyOrderDefault = selection.mode;
          this.settings.studyTypeSequence = [...selection.typeSequence];
          this.settings.studyShuffleWithinTypesDefault =
            selection.shuffleWithinTypes;
          await this.saveSettings();
        },
        ...(Platform.isMobileApp ? {} : {
          importRemoteVisual: async (visual: DetectedVisual) => {
            try {
              return await importRemoteVisual(this.app, visual);
            } catch (error) {
              this.showError(error);
              return null;
            }
          },
          chooseMediaFrame: async (visual: DetectedVisual, position) => {
            try {
              return await chooseVisualFrame(this.app, visual, {
                ffmpegExecutable: this.settings.ffmpegExecutable,
                ffprobeExecutable: this.settings.ffprobeExecutable
              }, position);
            } catch (error) {
              this.showError(error);
              return null;
            }
          },
          updateGifFrameDefault: async (position) => {
            this.settings.gifFrameDefault = position;
            await this.saveSettings();
          },
          retryAnswerReview: async (request) => this.retryAnswerReview(request),
          pauseAnswerReview: (requestId) => {
            this.pauseAnswerReview(requestId);
          },
          getAnswerReviewStatuses: (sessionId) => this.answerReviewStatuses(sessionId)
        }),
        finishSession: async (source, session) => {
          if (!this.activeBank || this.activeBank.bank.source.vaultPath !== source.path) {
            throw new Error("The active study session no longer matches its saved bank.");
          }
          let lockedSession = session;
          let summaryBank: PracticeBankV2 = this.activeBank.bank;
          let expectedRevision = this.activeBank.bank.revision;
          if (this.studyCheckpoint !== undefined) {
            if (this.studyCheckpoint.sessionId !== session.id) {
              throw new Error("The finished session does not match the device-local checkpoint.");
            }
            if (this.studyCheckpoint.phase === "active") {
              this.studyCheckpoint = markStudySessionCheckpointMerging(
                this.studyCheckpoint,
                session,
              );
              await this.persistStoredData();
            }
            lockedSession = finishedSessionFromCheckpoint(this.studyCheckpoint);
            summaryBank = checkpointBankSnapshot(this.studyCheckpoint);
            expectedRevision = this.studyCheckpoint.bankRevisionAtStart;
          }
          const currentBank = await this.loadPracticeBank(this.activeBank.path);
          if (currentBank.bankId !== summaryBank.bankId) {
            throw new Error("The practice bank changed identity; the finished session remains safely checkpointed.");
          }
          this.activeBank.bank = currentBank;
          const summary = createSessionSummary(summaryBank, lockedSession);
          this.activeBank.bank = await this.repository.appendFinishedSession(
            this.activeBank.path,
            summary,
            expectedRevision,
          );
          const storedSession = this.activeBank.bank.sessions.find((candidate) => candidate.id === summary.id);
          if (storedSession === undefined) {
            throw new Error("Practice Problem Generator saved the session but could not locate it for background review.");
          }
          for (const result of storedSession.results) {
            if (result.grading !== "ai-review") continue;
            if (result.state.status !== "pending") {
              this.answerReviewQueue?.forget(result.request.requestId);
              continue;
            }
            this.answerReviewTargets.set(result.request.requestId, {
              bankPath: this.activeBank.path,
              bankId: this.activeBank.bank.bankId,
              sessionId: storedSession.id,
              requestId: result.request.requestId,
              requestHash: result.request.requestHash,
              expectedRevision: this.activeBank.bank.revision,
            });
            this.flushTerminalAnswerReview(result.request.requestId);
          }
          const pendingCount = storedSession.results.filter((result) =>
            result.grading === "ai-review" && result.state.status === "pending",
          ).length;
          await this.clearStudySessionCheckpoint(session.id);
          new Notice(pendingCount > 0
            ? Platform.isMobileApp
              ? `Practice session saved. ${pendingCount} AI ${pendingCount === 1 ? "review is" : "reviews are"} queued for synchronized desktop processing.`
              : `Practice session saved. ${pendingCount} AI ${pendingCount === 1 ? "review is" : "reviews are"} continuing in the background.`
            : "Practice session saved.");
        },
        continueLearningPath: async (completedStepIndex) => {
          const active = this.activeBank;
          if (active === undefined) {
            throw new Error("The saved learning path is no longer active.");
          }
          const current = await this.loadPracticeBank(active.path);
          if (current.bankId !== active.bank.bankId) {
            throw new Error("The saved learning path changed identity before the next step opened.");
          }
          active.bank = current;
          const path = current.learningPath;
          if (path === null) {
            throw new Error("The saved learning path is no longer available.");
          }
          const steps = [...path.steps].sort((left, right) => left.order - right.order);
          const nextStepIndex = completedStepIndex + 1;
          const nextStep = steps[nextStepIndex];
          if (nextStep === undefined) {
            new Notice("Guided path complete. Choose a set or mixed practice whenever you want another run.", 8_000);
            return;
          }
          await this.startBankStudy(
            active.path,
            current,
            nextStep.kind === "lesson"
              ? { kind: "lesson", lessonId: nextStep.lessonId }
              : {
                  kind: "path-set",
                  setId: nextStep.setId,
                  pathStepIndex: nextStepIndex,
                },
          );
        },
        ...(Platform.isMobileApp ? {} : {
          buildRepairSet: async (_source: SourcePresentation, session) => {
            await this.openRepairSetFromSession(session);
          },
        }),
      }
    };
  }

  private createLearningPathViewOptions(leaf: WorkspaceLeaf): LearningPathViewOptions {
    return {
      providers: this.providers,
      recoverableBatch: this.learningBatchRecoveryHandle !== undefined,
      quickGenerationRecovery: this.generationRecoveryPresentation(),
      defaults: {
        provider: this.settings.provider,
        model: modelForProvider(this.settings, this.settings.provider),
        reasoningEffort: this.settings.reasoningEffort,
        quantity: this.settings.quantity,
        difficulty: generationDifficultyFromSetting(this.settings.difficulty),
        focusInstructions: this.settings.defaultFocusInstructions,
        gifFrameDefault: this.settings.gifFrameDefault,
        pdfMaxPageCount: this.settings.pdfMaxPageCount,
        pdfMaxExtractedCharacters: this.settings.pdfMaxExtractedCharacters,
      },
      callbacks: {
        requestPrimarySource: async (mode) => {
          try {
            let source: CollectedSource | null;
            if (mode === "pdf") {
              source = await this.requestPdfSource();
            } else if (mode === "vault-note") {
              const file = await chooseSourceNoteFile(this.app);
              source = file === null
                ? null
                : await collectSourceFromFile(
                    this.app,
                    file,
                    "note",
                    undefined,
                    this.settings.sourceClassificationRules,
                  );
            } else {
              source = await collectSource(
                this.app,
                mode,
                mode === "selection"
                  ? this.app.workspace.getActiveViewOfType(MarkdownView)?.editor.getSelection()
                  : undefined,
                this.settings.sourceClassificationRules,
              );
            }
            if (source === null) return null;
            this.lastSource = source;
            return this.learningPathController.registerSource(source);
          } catch (error) {
            this.showError(error);
            return null;
          }
        },
        preparePrimarySourceVisuals: async (source) => {
          if (!isRuntimeCollectedSource(source)) {
            throw new Error("Choose the primary source again before preparing its GIF frames.");
          }
          const prepared = await this.prepareGuidedSourceVisuals(source);
          this.lastSource = prepared;
          return this.learningPathController.registerSource(prepared);
        },
        requestSupportingSource: async (
          mode,
          pdfBudget,
        ) => {
          try {
            let source: CollectedSource | null;
            if (mode === "pdf") {
              if (pdfBudget === null) {
                throw new Error(
                  "The current PDF bundle has invalid or unavailable budget metadata. Choose its PDF sources again before adding another PDF.",
                );
              }
              const file = await chooseSourcePdfFile(this.app);
              if (file === null) return null;
              source = await this.requestPdfSource(file, {
                maxPages: pdfBudget.remainingPages,
                maxCharacters: pdfBudget.remainingCharacters,
              });
            } else {
              const file = await chooseSourceNoteFile(this.app);
              if (file === null) return null;
              source = await collectSourceFromFile(
                this.app,
                file,
                "note",
                undefined,
                this.settings.sourceClassificationRules,
              );
            }
            if (source === null) return null;
            return this.learningPathController.registerSource(
              await this.prepareGuidedSourceVisuals(source),
            );
          } catch (error) {
            this.showError(error);
            return null;
          }
        },
        updateSourceVisuals: (source) => {
          if (!isRuntimeCollectedSource(source)) {
            throw new Error("The selected source must be chosen again before its visual changes can be used.");
          }
          return this.learningPathController.registerSource(source);
        },
        confirmSourceClassification: (source, classification) =>
          this.learningPathController.confirmSourceClassification(
            source,
            classification,
          ),
        confirmSourceClassifications: (updates) =>
          this.learningPathController.confirmSourceClassifications(updates),
        ...(Platform.isMobileApp ? {} : {
          importRemoteVisual: async (visual: DetectedVisual) => {
            try {
              return await importRemoteVisual(this.app, visual);
            } catch (error) {
              this.showError(error);
              return null;
            }
          },
          chooseMediaFrame: async (visual: DetectedVisual, position) => {
            try {
              return await chooseVisualFrame(this.app, visual, {
                ffmpegExecutable: this.settings.ffmpegExecutable,
                ffprobeExecutable: this.settings.ffprobeExecutable,
              }, position);
            } catch (error) {
              this.showError(error);
              return null;
            }
          },
          updateGifFrameDefault: async (position) => {
            this.settings.gifFrameDefault = position;
            await this.saveSettings();
          },
        }),
        openQuickPractice: async (source) => {
          await this.switchCreationMode(leaf, "quick", source);
        },
        resumeInterruptedQuickGeneration: async () => {
          await this.requestResumeInterruptedGeneration();
        },
        retryInterruptedQuickGeneration: async () => {
          await this.requestRetryInterruptedGeneration();
        },
        discardInterruptedQuickGeneration: async () => {
          await this.requestDiscardInterruptedGeneration();
        },
        inspectRecoverableKind: async () =>
          this.learningPathController.inspectRecoveryKind(),
        previewSourceAlignment: async (primary, supporting, configuration) =>
          this.learningPathController.previewSourceAlignment(
            primary,
            supporting,
            configuration,
          ),
        generateSourceAlignment: async (onActivity) =>
          this.learningPathController.generateSourceAlignment(onActivity),
        approveSourceAlignment: (ledger) =>
          this.learningPathController.approveSourceAlignment(ledger),
        continueWithoutCourseAlignment: () =>
          this.learningPathController.continueWithoutCourseAlignment(),
        resumeRecoverableSourceAlignment: async (onActivity) =>
          this.learningPathController.resumeRecoverableSourceAlignmentWorkspace(
            onActivity,
          ),
        previewBlueprint: async (primary, supporting, configuration) =>
          this.learningPathController.previewBlueprint(primary, supporting, configuration),
        generateBlueprint: async (primary, supporting, configuration, onActivity) =>
          this.learningPathController.generateBlueprint(
            primary,
            supporting,
            configuration,
            onActivity,
          ),
        previewSetPayloads: async (blueprint, configurations) =>
          this.learningPathController.previewSetPayloads(blueprint, configurations),
        generateAllSets: async (
          blueprint,
          configurations,
          onStatus,
          onActivity,
        ) => this.learningPathController.generateAllSets(
          blueprint,
          configurations,
          onStatus,
          onActivity,
        ),
        cancelGeneration: () => this.learningPathController.cancel(),
        saveLearningPath: async (request) => {
          const saved = await this.learningPathController.saveLearningPath(request);
          this.scheduleDashboardRefresh();
          return saved;
        },
        preflightLearningPath: async (request) =>
          await this.learningPathController.preflightLearningPath(request),
        persistReviewSnapshots: async (sets) =>
          await this.learningPathController.persistReviewSnapshots(sets),
        saveManagedWorkspace: async (workspace) => {
          const saved = await this.repository.saveLearningWorkspace({
            bank: {
              ...structuredClone(workspace.bank),
              updatedAt: new Date().toISOString(),
            },
            expectedRevision: workspace.bank.revision,
          });
          this.scheduleDashboardRefresh();
          if (this.activeBank?.path === saved.path) this.activeBank.bank = saved.bank;
          return saved;
        },
        ...(Platform.isMobileApp ? {} : {
          regenerateSavedSet: async (workspace, setId) => {
            const current = await this.loadPracticeBank(workspace.path);
            if (
              current.bankId !== workspace.bank.bankId
              || current.revision !== workspace.bank.revision
            ) {
              throw new Error("The learning workspace changed. Refresh the manager before regenerating a set.");
            }
            const set = current.practiceSets.find((candidate) => candidate.id === setId);
            if (set === undefined) throw new Error("The selected practice set no longer exists.");
            await this.openSavedSetGenerator(workspace.path, current, set);
          },
        }),
        savedWorkspaceStudyState: (workspace) =>
          studyCheckpointWorkspaceActionState(
            this.studyCheckpoint,
            this.invalidStudyCheckpointRaw !== undefined,
            workspace.bank,
          ),
        useSavedWorkspace: async (workspace, action) => {
          if (action === "open-bank") {
            await this.openPracticeBank(workspace.path);
          } else if (action === "choose-set") {
            await this.chooseAndStartPracticeSet(workspace.path, workspace.bank);
          } else if (action === "mixed") {
            await this.startBankStudy(workspace.path, workspace.bank, { kind: "mixed" });
          } else {
            await this.startBankStudy(workspace.path, workspace.bank, { kind: "recommended" });
          }
        },
        resumeRecoverableBatch: async (onStatus, onActivity) =>
          this.learningPathController.resumeRecoverableBatch(onStatus, onActivity),
        inspectRecoverableBatch: async () =>
          this.learningPathController.inspectRecoverableBatch(),
        discardRecoverableBatch: async () => this.requestDiscardLearningPathRecovery(),
      },
    };
  }

  private async prepareGuidedSourceVisuals(
    source: CollectedSource,
  ): Promise<CollectedSource> {
    const visuals: DetectedVisual[] = [];
    for (const visual of source.visuals) {
      if (visual.state === "ready") {
        visuals.push({ ...visual, selected: true });
        continue;
      }
      if (visual.state === "frame-required" && visual.kind === "animated-gif") {
        try {
          const prepared = await chooseVisualFrame(this.app, visual, {
            ffmpegExecutable: this.settings.ffmpegExecutable,
            ffprobeExecutable: this.settings.ffprobeExecutable,
          }, this.settings.gifFrameDefault);
          visuals.push(prepared ?? visual);
        } catch (error) {
          visuals.push(visual);
          new Notice(
            `Could not prepare the default frame for ${displayVisualName(visual)}: ${error instanceof Error ? error.message : String(error)}`,
            8_000,
          );
        }
        continue;
      }
      visuals.push(visual);
    }
    return { ...source, visuals };
  }

  private createDashboardViewOptions(): PracticeDashboardViewOptions {
    return {
      displayPreferences: this.settings.display,
      analyticsDefaults: {
        rangeWeeks: this.settings.dashboardActivityRangeWeeks,
        metric: this.settings.dashboardActivityMetric,
        weekStart: this.settings.dashboardWeekStart,
      },
      load: async () => this.dashboardRepository.load(),
      recoveryPresentation: () => this.dashboardRecoveryPresentation(),
      handleRecovery: async (action) => {
        if (action === "resolve") {
          await this.requestDiscardStudyCheckpoint();
        } else {
          await this.restoreStudyCheckpoint();
        }
        this.scheduleDashboardRefresh();
      },
      startPractice: async (record) => this.startBankStudy(record.bankPath, record.bank),
      continueLearning: async (record) => this.startBankStudy(
        record.bankPath,
        record.bank,
        { kind: "recommended" },
      ),
      chooseSet: async (record) => this.chooseAndStartPracticeSet(
        record.bankPath,
        record.bank,
      ),
      mixedPractice: async (record) => this.startBankStudy(
        record.bankPath,
        record.bank,
        { kind: "mixed" },
      ),
      ...(Platform.isMobileApp ? {} : {
        manageLearningPath: async (record: DashboardBankRecord) => {
          await this.openSavedLearningPathManager(record.bankPath, record.bank);
        },
      }),
      openBank: async (record) => {
        await this.openPracticeBank(record.bankPath);
      },
      openSource: async (record) => {
        await this.app.workspace.openLinkText(
          record.bank.source.vaultPath,
          record.bankPath,
          true
        );
      },
      prepareOffline: async (records) => {
        await this.prepareForOfflinePractice(records);
      },
      ...(Platform.isMobileApp ? {} : {
        regenerate: async (record) => {
          await this.regenerateBank(record.bankPath, record.bank);
        },
      }),
      deleteBank: async (record) => {
        await this.requestDeletePracticeBank(record.bankPath, record.bank);
      },
    };
  }

  private async openPracticeBank(
    bankPath: string,
  ): Promise<void> {
    const normalized = normalizePath(bankPath);
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (!(file instanceof TFile)) {
      throw new Error(`The saved Practice note is not available on this device: ${normalized}`);
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(
      file,
      this.settings.savedBankOpenMode === "reading"
        ? { active: true, state: { mode: "preview" } }
        : { active: true },
    );
    await this.app.workspace.revealLeaf(leaf);
  }

  private async requestRemovePracticeSession(
    bankPath: string,
    bank: PracticeBankV4,
    sessionId: string,
  ): Promise<void> {
    const session = bank.sessions.find((candidate) => candidate.id === sessionId);
    if (session === undefined) {
      throw new Error("The selected history entry no longer exists. Refresh the bank.");
    }
    const confirmed = await confirmDestructiveAction(this.app, {
      title: "Remove this practice history entry?",
      warning: `The session finished ${new Date(session.finishedAt).toLocaleString()} will be removed from ${bank.source.title}.`,
      consequences: [
        "This session's score, rating, submitted answers, and AI-review feedback will no longer contribute to bank or dashboard statistics.",
        "Other sessions, generated exercises, generation history, and the source remain unchanged.",
        "Practice Problem Generator will save a Markdown backup under the vault's .tmp/practice-lab-ai/data-management folder first.",
      ],
      confirmationPhrase: DELETE_SESSION_CONFIRMATION,
      confirmLabel: "Remove history entry",
    });
    if (!confirmed) throw new Error("Removal cancelled. Nothing was changed.");
    const backupRoot = await this.backupPracticeBanks(
      [{ bankPath, bank }],
      "remove-session",
    );
    this.discardAnswerReviews([session]);
    await this.answerReviewPersistenceChain;
    const result = await this.repository.removeSession(bankPath, bank.bankId, sessionId);
    if (this.activeBank?.path === bankPath) this.activeBank.bank = result.bank;
    this.scheduleDashboardRefresh();
    new Notice(`History entry removed. Backup: ${backupRoot}`, 10_000);
  }

  private async requestClearPracticeBankHistory(
    bankPath: string,
    bank: PracticeBankV4,
  ): Promise<void> {
    if (bank.sessions.length === 0) {
      new Notice("This practice bank has no session history to clear.");
      return;
    }
    const confirmed = await confirmDestructiveAction(this.app, {
      title: `Clear history for ${bank.source.title}?`,
      warning: `All ${bank.sessions.length} saved ${bank.sessions.length === 1 ? "session" : "sessions"} in this bank will be removed.`,
      consequences: [
        "Scores, ratings, submitted answers, AI reviews, feedback, and this bank's session statistics will be removed.",
        "Generated exercises, generation history, source links, and settings will be preserved.",
        "Practice Problem Generator will save a Markdown backup under the vault's .tmp/practice-lab-ai/data-management folder first.",
      ],
      confirmationPhrase: CLEAR_HISTORY_CONFIRMATION,
      confirmLabel: "Clear bank history",
    });
    if (!confirmed) return;
    const backupRoot = await this.backupPracticeBanks(
      [{ bankPath, bank }],
      "clear-bank-history",
    );
    this.discardAnswerReviews(bank.sessions);
    await this.answerReviewPersistenceChain;
    const result = await this.repository.clearSessions(bankPath, bank.bankId);
    if (this.activeBank?.path === bankPath) this.activeBank.bank = result.bank;
    this.scheduleDashboardRefresh();
    new Notice(`Cleared ${result.removedSessions} ${result.removedSessions === 1 ? "session" : "sessions"}. Backup: ${backupRoot}`, 10_000);
  }

  private async requestDeletePracticeBank(
    bankPath: string,
    bank: PracticeBankV4,
  ): Promise<void> {
    const confirmed = await confirmDestructiveAction(this.app, {
      title: `Delete the practice bank for ${bank.source.title}?`,
      warning: "The generated practice-bank note and everything stored inside it will be sent through Obsidian's configured deletion method.",
      consequences: [
        `${bank.exercises.length} generated ${bank.exercises.length === 1 ? "exercise" : "exercises"} and ${bank.sessions.length} saved ${bank.sessions.length === 1 ? "session" : "sessions"} will be removed.`,
        "The source note or PDF and original attachments will not be deleted.",
        "Recoverability depends on your Obsidian trash configuration and operating-system trash retention.",
      ],
      confirmationPhrase: DELETE_BANK_CONFIRMATION,
      confirmLabel: "Delete practice bank",
    });
    if (!confirmed) return;
    const current = await this.requireCurrentPracticeBank(bankPath, bank.bankId);
    this.discardAnswerReviews(current.bank.sessions);
    await this.answerReviewPersistenceChain;
    await this.app.fileManager.trashFile(current.file);
    if (this.activeBank?.path === bankPath) delete this.activeBank;
    this.scheduleDashboardRefresh();
    new Notice("Practice bank sent through Obsidian's configured trash method. The source was preserved.", 10_000);
  }

  private async requireCurrentPracticeBank(
    bankPath: string,
    bankId: string,
  ): Promise<{ file: TFile; bank: PracticeBankV2 }> {
    const abstract = this.app.vault.getAbstractFileByPath(normalizePath(bankPath));
    if (!(abstract instanceof TFile)) {
      throw new Error("The Practice Problem Generator bank no longer exists.");
    }
    const parsed = parsePracticeBankMarkdown(await this.app.vault.cachedRead(abstract));
    if (parsed.status !== "ok") throw parseFailure(parsed);
    if (parsed.bank.bankId !== bankId) {
      throw new Error("The practice bank changed identity. Refresh before deleting data.");
    }
    return { file: abstract, bank: parsed.bank };
  }

  private async backupPracticeBanks(
    records: readonly Pick<DashboardBankRecord, "bankPath" | "bank">[],
    operation: string,
  ): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
    const root = normalizePath(`.tmp/practice-lab-ai/data-management/${stamp}-${operation}`);
    const prepared: { readonly path: string; readonly markdown: string }[] = [];
    for (const record of records) {
      const current = await this.requireCurrentPracticeBank(
        record.bankPath,
        record.bank.bankId,
      );
      prepared.push({
        path: practiceBankBackupPath(root, record.bankPath),
        markdown: await this.app.vault.cachedRead(current.file),
      });
    }
    for (const backup of prepared) {
      await ensureVaultParentFolder(this.app, backup.path);
      if (this.app.vault.getAbstractFileByPath(backup.path) !== null) {
        throw new Error(`Backup path already exists: ${backup.path}`);
      }
      await this.app.vault.create(backup.path, backup.markdown);
    }
    return root;
  }

  private discardAnswerReviews(sessions: readonly SessionSummaryV2[]): void {
    const requestIds = sessions.flatMap((session) => session.results
      .filter((result) => result.grading === "ai-review")
      .map((result) => result.request.requestId));
    for (const requestId of requestIds) {
      this.pausedAnswerReviewIds.add(requestId);
      this.answerReviewQueue?.cancel(requestId);
      this.answerReviewRequests.delete(requestId);
      this.answerReviewStatusesById.delete(requestId);
      this.answerReviewTargets.delete(requestId);
      this.pendingAnswerReviewPersistence.delete(requestId);
      this.queuedAnswerReviewPersistence.delete(requestId);
      this.warnedAnswerReviewPersistence.delete(requestId);
    }
    const queue = this.answerReviewQueue;
    if (queue !== undefined && requestIds.length > 0) {
      void queue.whenIdle().then(() => {
        for (const requestId of requestIds) queue.forget(requestId);
      });
    }
  }

  private async previewPayload(
    presentation: SourcePresentation,
    configuration: GenerationConfiguration
  ): Promise<PayloadPreview> {
    if (Platform.isMobileApp) throw new Error("Exercise generation is available in Obsidian desktop only.");
    if (this.generationRecoveryHandle !== undefined) {
      throw new Error(
        "A recoverable generation already exists. Review, save, or discard it before approving another payload.",
      );
    }
    const source = this.resolveCollectedSource(presentation);
    const preparedVisuals = await prepareSelectedVisuals(this.app, presentation.visuals);
    // A Quick set has one source and therefore cannot make a reliable
    // notes-versus-school comparison. Persist an explicit unverified ledger so
    // it can never be presented as course-aligned merely because its filename
    // looks authoritative. Guided paths run the recoverable comparison pass.
    const sourceAlignment = createUnverifiedSourceAlignmentLedger();
    const prompt = buildGenerationPrompt(
      source,
      configuration,
      preparedVisuals.map((visual) => visual.source),
      sourceAlignment,
    );
    const cli = await import("./cli");
    const filenames = preparedVisuals.map((visual, index) => neutralFilename(index, visual.source.mimeType));
    const exactPayload = cli.appendNeutralMediaManifest(prompt, filenames);
    this.pendingGeneration = {
      source,
      configuration,
      prompt,
      preparedVisuals,
      sourceAlignment,
    };
    const provider = this.providers.find((candidate) => candidate.id === configuration.provider);
    return {
      providerLabel: provider?.label ?? configuration.provider,
      modelLabel: displayModelSelection(configuration.model),
      reasoningEffortLabel: displayReasoningEffort(configuration.reasoningEffort),
      text: exactPayload,
      visualNames: presentation.visuals
        .filter((visual) => visual.selected)
        .map(displayVisualName),
      warning: preparedVisuals.length === 0
        ? "No images will leave the vault. The approved allocation contains no image-occlusion items."
        : `${preparedVisuals.length} selected image ${preparedVisuals.length === 1 ? "copy" : "copies"} will be sent with this text.`
    };
  }

  private async runGeneration(
    presentation: SourcePresentation,
    configuration: GenerationConfiguration,
    onActivity?: (event: CliActivityEvent) => void,
  ): Promise<readonly DraftExercisePresentation[]> {
    if (Platform.isMobileApp) throw new Error("Exercise generation is available in Obsidian desktop only.");
    const pending = this.pendingGeneration;
    if (!pending || pending.source.path !== presentation.path || !sameConfiguration(pending.configuration, configuration)) {
      throw new Error("The source or configuration changed. Preview and approve the payload again.");
    }
    const layer = await this.ensureCliLayer();
    const cli = await import("./cli");
    const adapter = layer.adapters[configuration.provider];
    const detection = this.providers.find((provider) => provider.id === configuration.provider);
    if (!detection?.available) throw new Error(`${adapter.label} is not available. ${detection?.detail ?? "Check its executable setting."}`);
    if (pending.preparedVisuals.length > 0 && adapter.capabilities().vision !== "supported") {
      throw new Error(`${adapter.label} vision is not enabled. Choose Codex or Claude for image occlusion.`);
    }
    if (this.generationRecoveryHandle !== undefined) {
      throw new Error(
        "A recoverable generation already exists. Review, save, or discard it before starting another generation.",
      );
    }

    const generationJobId = `generation-${crypto.randomUUID()}`;
    const recoveryContext = this.settings.recoverInterruptedGenerations
      ? createGenerationRecoveryContext({
          jobId: generationJobId,
          startedAt: new Date().toISOString(),
          source: pending.source,
          configuration,
          prompt: pending.prompt,
          visuals: pending.preparedVisuals.map((visual) => visual.source),
          sourceAlignment: pending.sourceAlignment,
        })
      : undefined;
    this.generationRecoveryContext = recoveryContext;
    this.generationRecoveryState = recoveryContext === undefined ? "idle" : "running";
    this.generationRecoveryMessage = recoveryContext === undefined
      ? undefined
      : "Generation is recoverable if Obsidian closes or reloads.";
    this.activeGenerationJobId = generationJobId;
    let generatedValue: unknown;
    try {
      const result = await layer.coordinator.generate(adapter, {
        prompt: pending.prompt,
        schema: generationDraftV1JsonSchema,
        validate: (value) => validateGeneratedDraft(value, {
          source: pending.source,
          configuration,
          visualIds: pending.preparedVisuals.map((visual) => visual.source.id),
          sourceAlignment: pending.sourceAlignment,
        }),
        ...(configuration.model.length === 0 ? {} : { model: configuration.model }),
        reasoningEffort: configuration.reasoningEffort,
        media: pending.preparedVisuals.map((visual) => visual.media),
        timeoutMs: this.settings.timeoutMs,
        ...(onActivity === undefined ? {} : { onActivity }),
        ...(recoveryContext === undefined
          ? {}
          : {
              recovery: {
                mode: "start" as const,
                jobId: generationJobId,
                context: JSON.stringify(recoveryContext),
                onReady: async (handle: DurableProcessHandle): Promise<void> => {
                  this.generationRecoveryHandle = handle;
                  await this.persistStoredData();
                  this.updateGenerationRecoveryViews();
                },
              },
            }),
      }, {
        id: generationJobId,
        kind: "generation",
        provider: configuration.provider,
      });
      generatedValue = result.value;
      this.generationRecoveryHandle = result.recoveryHandle
        ?? this.generationRecoveryHandle;
      pending.jobId = generationJobId;
      pending.attempts = result.attempts;
      if (result.telemetry === undefined) delete pending.telemetry;
      else pending.telemetry = result.telemetry;
    } catch (error) {
      const code = cliErrorCode(error);
      if (code === "detached") throw error;
      if (this.generationRecoveryHandle !== undefined) {
        if (code === "cancelled" || code === "timeout") {
          await this.clearGenerationRecovery(false);
        } else {
          this.generationRecoveryState = "failed";
          const detail = error instanceof Error
            ? error.message
            : "The recoverable generation stopped before producing a valid draft.";
          this.generationRecoveryMessage = `${detail} The exact approved request remains available to retry or discard.`;
          await this.persistStoredData();
          this.updateGenerationRecoveryViews();
        }
      }
      throw error;
    } finally {
      if (this.activeGenerationJobId === generationJobId) this.activeGenerationJobId = undefined;
    }
    const draft = asGenerationDraft(generatedValue, {
      source: pending.source,
      configuration,
      visualIds: pending.preparedVisuals.map((visual) => visual.source.id),
      sourceAlignment: pending.sourceAlignment,
    });
    pending.draft = draft;
    if (this.generationRecoveryHandle !== undefined) {
      await cli.writeDurableRecoveryText(
        this.generationRecoveryHandle,
        GENERATION_RECOVERY_DRAFT_FILENAME,
        JSON.stringify(createGenerationRecoveryDraft({
          jobId: generationJobId,
          attempts: pending.attempts ?? 1,
          ...(pending.telemetry === undefined ? {} : { telemetry: pending.telemetry }),
          draft,
        })),
      );
      this.generationRecoveryState = "ready";
      this.generationRecoveryMessage = "Recovered draft ready for review and saving.";
      await this.persistStoredData();
      this.updateGenerationRecoveryViews();
    }
    const visualUrls = new Map(pending.preparedVisuals.map((visual) => [
      visual.source.id,
      this.app.vault.adapter.getResourcePath(visual.source.vaultPath)
    ]));
    return presentExercises(
      draft.exercises,
      (visualId) => visualUrls.get(visualId),
      pending.source.segments,
    );
  }

  private async saveDrafts(
    presentation: SourcePresentation,
    drafts: readonly EditableDraftExercise[]
  ): Promise<void> {
    const pending = this.pendingGeneration;
    if (!pending?.draft || pending.source.path !== presentation.path) {
      throw new Error("The generated draft is no longer available. Generate it again before saving.");
    }
    const exercises = applyDraftEdits(pending.draft.exercises, drafts);
    if (exercises.length === 0) throw new Error("Approve at least one exercise before saving.");
    if (pending.jobId === undefined || pending.attempts === undefined) {
      throw new Error("The generation audit record is incomplete. Generate the draft again before saving.");
    }
    const generatedAt = new Date().toISOString();
    const provider = this.providers.find(
      (candidate) => candidate.id === pending.configuration.provider,
    );
    const saved = await this.repository.saveGenerated({
      source: pending.source,
      exercises,
      visuals: pending.preparedVisuals.map((visual) => visual.source),
      sourceAlignment: pending.sourceAlignment,
      generation: {
        provider: pending.configuration.provider,
        generatedAt,
        promptVersion: GENERATION_PROMPT_VERSION,
        reasoningEffort: pending.configuration.reasoningEffort
      },
      generationRecipe: createGenerationRecipe(
        pending.configuration,
        pending.source.hash,
      ),
      generationHistoryEntry: {
        id: pending.jobId,
        generatedAt,
        provider: pending.configuration.provider,
        ...(provider?.version === undefined ? {} : { providerVersion: provider.version }),
        model: pending.configuration.model,
        reasoningEffort: pending.configuration.reasoningEffort,
        promptVersion: GENERATION_PROMPT_VERSION,
        sourceHash: pending.source.hash,
        sourceScope: pending.source.mode,
        requestedQuantity: pending.configuration.quantity,
        draftExerciseCount: pending.draft.exercises.length,
        savedExerciseCount: exercises.length,
        difficulty: pending.configuration.difficulty,
        focusInstructions: pending.configuration.focusInstructions,
        exerciseTypePercentages: {
          ...pending.configuration.exerciseTypePercentages,
        },
        selectedVisualCount: pending.preparedVisuals.length,
        attempts: pending.attempts,
        ...(pending.telemetry === undefined ? {} : { telemetry: pending.telemetry }),
        aiContextCompletionPolicy: effectiveAiContextCompletionPolicy(
          pending.configuration.aiContextCompletionPolicy,
        ),
      },
    });
    this.activeBank = { path: saved.path, bank: saved.bank };
    if (this.generationRecoveryHandle !== undefined) {
      try {
        await this.clearGenerationRecovery(true);
      } catch (error) {
        new Notice(
          `The practice set was saved, but its temporary recovery data could not be removed. ${error instanceof Error ? error.message : String(error)}`,
          10_000,
        );
      }
    }
    new Notice(`Saved ${exercises.length} practice ${exercises.length === 1 ? "problem" : "problems"}.`);
    await this.openPracticeBank(saved.path);
  }

  private async startPracticeForCurrentNote(): Promise<void> {
    const current = this.activeMarkdownFile();
    if (current === null) {
      this.showError(new Error("Open a source note or Practice Problem Generator bank first."));
      return;
    }
    await this.startPracticeForSourceFile(current);
  }

  private async startPracticeForSourceFile(current: TFile): Promise<void> {
    try {
      let path: string;
      let bank: PracticeBankV2;
      if (
        current.extension.toLowerCase() === "md"
        && /(?:^|\/)Practice(?: Sources)?\//u.test(current.path)
      ) {
        const markdown = await this.app.vault.cachedRead(current);
        const parsed = parsePracticeBankMarkdown(markdown);
        if (parsed.status !== "ok") throw parseFailure(parsed);
        path = current.path;
        bank = parsed.bank;
      } else {
        const loaded = await this.repository.loadForSource(current.path);
        if (loaded.parsed.status !== "ok") throw parseFailure(loaded.parsed);
        path = loaded.path;
        bank = loaded.parsed.bank;
        if (current.extension.toLowerCase() === "pdf") {
          const bankMarkdown = loaded.file === null
            ? ""
            : await this.app.vault.cachedRead(loaded.file);
          const sourceImport = parseSourceImportMarkdown(bankMarkdown);
          if (sourceImport.status === "ok") {
            const range = sourceImport.sourceImport.firstPage === sourceImport.sourceImport.lastPage
              ? `page ${sourceImport.sourceImport.firstPage}`
              : `pages ${sourceImport.sourceImport.firstPage}–${sourceImport.sourceImport.lastPage}`;
            new Notice(`Starting practice generated from PDF ${range}.`, 5000);
          } else if (sourceImport.status === "invalid") {
            new Notice(`The saved PDF provenance is invalid: ${sourceImport.message}`, 8000);
          }
        } else if (bank.source.scope === "note") {
          const markdown = await this.app.vault.cachedRead(current);
          const stale = getStaleSourceState(bank, markdown);
          if (stale.stale) new Notice("This practice bank is based on an older version of the source note.", 8000);
        } else {
          new Notice("This bank was generated from a selection; automatic whole-note freshness checking is not applicable.", 6000);
        }
      }
      await this.startBankStudy(path, bank);
    } catch (error) {
      this.showError(error);
    }
  }

  private async startBankStudy(
    path: string,
    bank: PracticeBankV2,
    selection: BankStudySelection = { kind: "quick" },
  ): Promise<void> {
    const running = this.bankStudyStartTask;
    if (running !== undefined) {
      await running;
      return;
    }
    const task = this.performBankStudyStart(path, bank, selection);
    this.bankStudyStartTask = task;
    try {
      await task;
    } finally {
      if (this.bankStudyStartTask === task) this.bankStudyStartTask = undefined;
    }
  }

  private async performBankStudyStart(
    path: string,
    bank: PracticeBankV2,
    selection: BankStudySelection,
  ): Promise<void> {
    const currentBank = bank as PracticeBankV4;
    if (
      currentBank.schemaVersion !== CURRENT_PRACTICE_BANK_SCHEMA_VERSION
      || !Array.isArray(currentBank.practiceSets)
      || !Array.isArray(currentBank.aspects)
      || !Array.isArray(currentBank.tutorLessons)
    ) {
      throw new Error("This bank must be migrated before its learning controls can be used.");
    }
    if (this.studyCheckpoint !== undefined || this.invalidStudyCheckpointRaw !== undefined) {
      const recovery = await this.restoreStudyCheckpoint(
        { path, bank: currentBank },
        false,
      );
      if (recovery.status === "resumed") return;
      if (recovery.status !== "none" && recovery.status !== "merged") {
        const discarded = await this.requestDiscardStudyCheckpointAndStart(
          currentBank,
          recovery.message,
        );
        if (!discarded) return;
      }
    }
    let resolvedSelection = selection;
    if (selection.kind === "recommended") {
      const recommended = recommendNextLearningStep(
        currentBank,
        deriveLearningAnalytics(currentBank),
      );
      if (recommended === null) {
        new Notice("This path already has consistent evidence. Starting mixed practice; the recommendation remains optional.", 7_000);
        resolvedSelection = { kind: "mixed" };
      } else {
        new Notice(`Recommended next: ${recommended.title}. ${recommended.reasons.join(" ")}`, 10_000);
        if (recommended.kind === "lesson") {
          resolvedSelection = { kind: "lesson", lessonId: recommended.id };
        } else {
          const pathStepIndex = [...(currentBank.learningPath?.steps ?? [])]
            .sort((left, right) => left.order - right.order)
            .findIndex((step) => (
              step.kind === "practice-set" && step.setId === recommended.id
            ));
          if (pathStepIndex < 0) {
            throw new Error("The recommended set is missing from the saved path sequence.");
          }
          resolvedSelection = {
            kind: "path-set",
            setId: recommended.id,
            pathStepIndex,
          };
        }
      }
    }

    let exerciseIds: string[] = currentBank.exercises.map((exercise) => exercise.id);
    let learning: LearningStudyLaunchV1 | undefined;
    const setById = new Map(currentBank.practiceSets.map((set) => [set.id, set]));
    const exerciseById = new Map(currentBank.exercises.map((exercise) => [exercise.id, exercise]));
    if (
      resolvedSelection.kind === "set"
      || resolvedSelection.kind === "path-set"
    ) {
      const set = setById.get(resolvedSelection.setId);
      if (set === undefined) throw new Error("The selected practice set no longer exists.");
      exerciseIds = set.assignments.map((assignment) => assignment.exerciseId);
      learning = this.learningStudyLaunch(currentBank, [set], exerciseIds, {
        mode: resolvedSelection.kind === "path-set" ? "learning-path" : "set",
        activeSetId: set.id,
        ...(resolvedSelection.kind === "path-set"
          ? { pathStepIndex: resolvedSelection.pathStepIndex }
          : {}),
      });
    } else if (resolvedSelection.kind === "mixed") {
      const sets = [...currentBank.practiceSets]
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
      exerciseIds = sets.flatMap((set) => set.assignments.map((assignment) => assignment.exerciseId));
      learning = this.learningStudyLaunch(currentBank, sets, exerciseIds, {
        mode: "mixed",
        activeSetId: sets[0]?.id ?? null,
      });
    } else if (resolvedSelection.kind === "lesson") {
      const lesson = currentBank.tutorLessons.find((candidate) => (
        candidate.id === resolvedSelection.lessonId
      ));
      if (lesson === undefined) throw new Error("The selected tutor lesson no longer exists.");
      const set = currentBank.practiceSets.find((candidate) => (
        candidate.assignments.some((assignment) => (
          assignment.exerciseId === lesson.guidedExerciseId
        ))
      ));
      if (set === undefined) throw new Error("The tutor lesson's guided problem has no practice set.");
      const path = currentBank.learningPath;
      if (path === null) throw new Error("This tutor lesson is not attached to a saved learning path.");
      const pathStepIndex = [...path.steps]
        .sort((left, right) => left.order - right.order)
        .findIndex((step) => step.kind === "lesson" && step.lessonId === lesson.id);
      if (pathStepIndex < 0) throw new Error("The tutor lesson is missing from the saved path sequence.");
      exerciseIds = [lesson.guidedExerciseId];
      learning = this.learningStudyLaunch(currentBank, [set], exerciseIds, {
        mode: "learning-path",
        activeSetId: set.id,
        pathStepIndex,
        lesson,
      });
    }
    if (exerciseIds.length === 0) throw new Error("The selected learning scope contains no exercises.");
    const selectedExercises = exerciseIds.map((id) => {
      const exercise = exerciseById.get(id);
      if (exercise === undefined) throw new Error(`The learning scope references missing exercise ${id}.`);
      return exercise;
    });
    const source = sourcePresentationFromBank(currentBank);
    const view = await this.openView(source);
    const visualUrls = new Map(currentBank.visuals.map((visual) => [
      visual.id,
      this.app.vault.adapter.getResourcePath(visual.vaultPath)
    ]));
    this.activeBank = { path, bank: currentBank };
    await view.startStudy(
      presentExercises(
        selectedExercises,
        (visualId) => visualUrls.get(visualId),
        currentBank.segments,
        createExerciseAlignmentSnapshots(
          currentBank,
          selectedExercises.map((exercise) => exercise.id),
        ),
      ),
      {
        bankPath: path,
        bankId: currentBank.bankId,
        bankRevisionAtStart: currentBank.revision,
        exerciseCountAtStart: selectedExercises.length,
      },
      learning,
    );
  }

  private async chooseAndStartPracticeSet(
    path: string,
    bank: PracticeBankV4,
  ): Promise<void> {
    const set = await choosePracticeSet(this.app, bank.practiceSets, "practice");
    if (set === null) return;
    await this.startBankStudy(path, bank, { kind: "set", setId: set.id });
  }

  private async openSavedLearningPathManager(
    path: string,
    bank: PracticeBankV4,
  ): Promise<void> {
    const view = await this.openLearningPathView();
    view.manageSavedWorkspace(path, bank);
  }

  private async openRepairSetFromSession(
    session: Parameters<NonNullable<PracticeLabViewOptions["callbacks"]["buildRepairSet"]>>[1],
  ): Promise<void> {
    const active = this.activeBank;
    if (active === undefined) throw new Error("The saved learning workspace is no longer active.");
    const bank = await this.loadPracticeBank(active.path);
    const storedSession = bank.sessions.find((candidate) => candidate.id === session.id);
    if (storedSession === undefined) {
      throw new Error("The finished session was saved, but its historical evidence could not be located.");
    }
    const seed = deriveRepairSetSeed(bank, storedSession, session);
    if (seed === null) {
      throw new Error("This session has no incorrect or partial independent outcomes that need a repair set.");
    }
    if (bank.practiceSets.length >= 6) {
      throw new Error("This path already has six sets. Remove or regenerate a set before adding a repair set.");
    }
    const remaining = 60 - bank.exercises.length;
    if (remaining < 1) {
      throw new Error("This path already contains the maximum of sixty exercises.");
    }
    const targetSet: PracticeSetV1 = {
      id: seed.setId,
      title: seed.title,
      purpose: seed.purpose,
      instructionalRole: "repair",
      order: bank.practiceSets.length,
      assignments: [],
    };
    await this.openSavedSetGenerator(
      active.path,
      bank,
      targetSet,
      {
        addingSet: true,
        repairSeed: seed,
        targetAspectIds: seed.aspectIds,
        quantity: Math.min(remaining, Math.max(3, Math.min(10, seed.entries.length * 2))),
      },
    );
  }

  private async openSavedSetGenerator(
    bankPath: string,
    bank: PracticeBankV4,
    targetSet: PracticeSetV1,
    options: {
      readonly addingSet?: boolean;
      readonly repairSeed?: RepairSetSeedV1;
      readonly targetAspectIds?: readonly string[];
      readonly quantity?: number;
    } = {},
  ): Promise<void> {
    if (Platform.isMobileApp) {
      throw new Error("AI set generation is available on desktop only. Saved paths remain usable on mobile.");
    }
    if (this.providersRefreshedAt === 0) await this.refreshProviders();
    else if (Date.now() - this.providersRefreshedAt > 60_000) void this.refreshProviders();
    const basePercentages = { ...this.settings.exerciseTypePercentages };
    const fallback: GenerationConfiguration = {
      provider: this.settings.provider,
      model: modelForProvider(this.settings, this.settings.provider),
      reasoningEffort: this.settings.reasoningEffort,
      focusInstructions: options.repairSeed === undefined
        ? ""
        : repairFocusInstructions(options.repairSeed, {
            includeSubmittedAnswers: false,
            includeReviewFeedback: false,
          }),
      quantity: options.quantity
        ?? Math.max(1, Math.min(30, targetSet.assignments.length || this.settings.quantity)),
      difficulty: generationDifficultyFromSetting(this.settings.difficulty),
      exerciseTypes: enabledExerciseTypes(basePercentages),
      exerciseTypePercentages: basePercentages,
      selectedVisualIds: bank.visuals.map((visual) => visual.id),
      aiContextCompletionPolicy: effectiveAiContextCompletionPolicy(
        bank.aiContextCompletionPolicy,
      ),
    };
    const configuration = options.addingSet === true
      ? fallback
      : await this.savedSetController.defaults(
          bankPath,
          bank,
          targetSet.id,
          fallback,
        );
    const request = {
      bankPath,
      bank: structuredClone(bank),
      targetSet: structuredClone(targetSet),
      ...(options.targetAspectIds === undefined
        ? {}
        : { targetAspectIds: [...options.targetAspectIds] }),
      configuration,
      addingSet: options.addingSet === true,
    };
    new SavedSetGenerationModal(this.app, {
      request,
      providers: this.providers,
      visuals: bank.visuals,
      ...(options.repairSeed === undefined ? {} : { repairSeed: options.repairSeed }),
      callbacks: {
        preview: async (next) => this.savedSetController.preview(next),
        generate: async (next, onActivity) => this.savedSetController.generate(next, onActivity),
        save: async (next, review) => this.savedSetController.save(next, review),
        cancel: () => this.savedSetController.cancel(),
        onSaved: async (saved) => {
          this.activeBank = { path: saved.path, bank: saved.bank };
          this.scheduleDashboardRefresh();
          for (const leaf of this.app.workspace.getLeavesOfType(PRACTICE_LEARNING_PATH_VIEW_TYPE)) {
            if (leaf.view instanceof PracticeLearningPathView) {
              leaf.view.manageSavedWorkspace(saved.path, saved.bank);
            }
          }
        },
      },
    }).open();
  }

  private learningStudyLaunch(
    bank: PracticeBankV4,
    sets: readonly PracticeSetV1[],
    exerciseIds: readonly string[],
    options: {
      readonly mode: "set" | "mixed" | "learning-path";
      readonly activeSetId: string | null;
      readonly pathStepIndex?: number;
      readonly lesson?: PracticeBankV4["tutorLessons"][number];
    },
  ): LearningStudyLaunchV1 {
    const evidenceByExerciseId = this.learningEvidenceTemplates(
      bank,
      sets,
      exerciseIds,
    );
    const pathStep = options.mode !== "learning-path"
      ? undefined
      : (() => {
          const path = bank.learningPath;
          if (path === null) {
            throw new Error("Learning-path study requires a saved path.");
          }
          const steps = [...path.steps].sort((left, right) => left.order - right.order);
          const stepIndex = options.pathStepIndex ?? 0;
          const step = steps[stepIndex];
          if (step === undefined) {
            throw new Error("The selected learning-path step no longer exists.");
          }
          if (options.lesson !== undefined) {
            if (step.kind !== "lesson" || step.lessonId !== options.lesson.id) {
              throw new Error("The selected tutor lesson does not match the saved path position.");
            }
            return {
              pathTitle: path.title,
              stepIndex,
              stepCount: steps.length,
              stepTitle: options.lesson.title,
              kind: "tutor-lesson" as const,
              questionCount: exerciseIds.length,
              totalQuestionCount: bank.exercises.length,
            };
          }
          const set = sets[0];
          if (
            set === undefined
            || step.kind !== "practice-set"
            || step.setId !== set.id
          ) {
            throw new Error("The selected practice set does not match the saved path position.");
          }
          return {
            pathTitle: path.title,
            stepIndex,
            stepCount: steps.length,
            stepTitle: set.title,
            kind: "practice-set" as const,
            questionCount: exerciseIds.length,
            totalQuestionCount: bank.exercises.length,
          };
        })();
    return {
      evidenceByExerciseId,
      ...(pathStep === undefined ? {} : { pathStep }),
      progress: {
        schemaVersion: 1,
        scope: options.mode === "learning-path"
          ? {
              mode: "learning-path",
              learningPath: learningPathReference(bank),
              sets: sets.map((set) => ({ id: set.id, title: set.title })),
            }
          : {
              mode: options.mode,
              sets: sets.map((set) => ({ id: set.id, title: set.title })),
            },
        pathStepIndex: options.mode === "learning-path"
          ? options.pathStepIndex ?? 0
          : null,
        activeSetId: options.activeSetId,
        activeLesson: options.lesson === undefined
          ? null
          : {
              lesson: structuredClone(options.lesson),
              state: createGuidedLessonState(
                options.lesson,
                options.lesson.guidedExerciseId,
              ),
              currentInput: "",
            },
        evidence: [],
        completedTutorLessons: [],
      },
    };
  }

  private dashboardRecoveryPresentation(): DashboardRecoveryPresentation | null {
    if (this.invalidStudyCheckpointRaw !== undefined) {
      return {
        state: "needs-resolution",
        title: "Resolve the unreadable saved session",
        description: this.studyCheckpointRecoveryIssue
          ?? "The device-local practice checkpoint is malformed. Review the warning before explicitly discarding it.",
        actionLabel: "Resolve saved session…",
      };
    }
    const checkpoint = this.studyCheckpoint;
    if (checkpoint === undefined) return null;
    const bank = checkpointBankSnapshot(checkpoint);
    if (this.studyCheckpointRecoveryIssue !== undefined) {
      return {
        state: "needs-resolution",
        bankId: checkpoint.bankId,
        title: `Resolve the saved session for ${bank.source.title}`,
        description: this.studyCheckpointRecoveryIssue,
        actionLabel: "Resolve saved session…",
      };
    }
    const current = Math.min(
      checkpoint.currentQuestionIndex + 1,
      checkpoint.exercises.length,
    );
    return {
      state: "resumable",
      bankId: checkpoint.bankId,
      title: `Resume ${bank.source.title}`,
      description: `Continue at question ${current} of ${checkpoint.exercises.length}. Your exact answer input, skips, and revealed tutor help are preserved on this device.`,
    };
  }

  private learningEvidenceTemplates(
    bank: PracticeBankV4,
    sets: readonly PracticeSetV1[],
    exerciseIds: readonly string[],
  ): ReturnType<typeof createSessionExerciseEvidence>[] {
    const assignmentByExercise = new Map(
      sets.flatMap((set) => set.assignments.map((assignment) => [
        assignment.exerciseId,
        { set, assignment },
      ] as const)),
    );
    const aspectById = new Map(bank.aspects.map((aspect) => [aspect.id, aspect]));
    return exerciseIds.map((exerciseId) => {
      const owned = assignmentByExercise.get(exerciseId);
      if (owned === undefined) throw new Error(`Exercise ${exerciseId} has no assignment in the selected scope.`);
      const aspects = owned.assignment.aspectIds.map((aspectId) => {
        const aspect = aspectById.get(aspectId);
        if (aspect === undefined) throw new Error(`Exercise ${exerciseId} references missing aspect ${aspectId}.`);
        return aspect;
      });
      return createSessionExerciseEvidence({
        assignment: owned.assignment,
        set: owned.set,
        aspects,
      });
    });
  }

  private async regenerateBank(
    bankPath: string,
    bank: PracticeBankV2,
  ): Promise<void> {
    if (Platform.isMobileApp) {
      throw new Error("Exercise generation is available in Obsidian desktop only.");
    }
    const bankFile = this.app.vault.getAbstractFileByPath(bankPath);
    if (!(bankFile instanceof TFile)) {
      throw new Error("The saved practice bank no longer exists.");
    }
    const bankMarkdown = await this.app.vault.cachedRead(bankFile);
    const parsed = parsePracticeBankMarkdown(bankMarkdown);
    if (parsed.status !== "ok") throw parseFailure(parsed);
    if (parsed.bank.bankId !== bank.bankId) {
      throw new Error("The practice bank changed identity. Refresh its view before regenerating.");
    }
    const currentBank = parsed.bank;
    const sourceFile = this.app.vault.getAbstractFileByPath(
      currentBank.source.vaultPath,
    );
    const sourceExtension = sourceFile instanceof TFile
      ? sourceFile.extension.toLowerCase()
      : "";
    if (!(sourceFile instanceof TFile) || (sourceExtension !== "md" && sourceExtension !== "pdf")) {
      throw new Error("The source note or PDF for this practice bank no longer exists.");
    }
    const recipeResult = parseGenerationRecipeMarkdown(bankMarkdown);
    const preset = regenerationPreset(currentBank, recipeResult, {
      provider: this.settings.provider,
      model: modelForProvider(
        this.settings,
        currentBank.generation?.provider ?? this.settings.provider,
      ),
      reasoningEffort: this.settings.reasoningEffort,
      difficulty: generationDifficultyFromSetting(this.settings.difficulty),
      focusInstructions: this.settings.defaultFocusInstructions,
    });
    let restored: RegenerationSourceResult;
    if (sourceExtension === "pdf") {
      const sourceImportResult = parseSourceImportMarkdown(bankMarkdown);
      if (sourceImportResult.status !== "ok") {
        throw new Error(sourceImportResult.status === "missing"
          ? "This PDF practice bank has no saved page-range provenance. Generate it again from the PDF."
          : `The saved PDF source metadata is invalid: ${sourceImportResult.message}`);
      }
      const savedImport = sourceImportResult.sourceImport;
      const bytes = await this.app.vault.readBinary(sourceFile);
      const info = await inspectPdf(bytes, {
        pdfinfoExecutable: this.settings.pdfinfoExecutable,
        timeoutMs: this.settings.pdfExtractionTimeoutMs,
      });
      if (savedImport.lastPage > info.pageCount) {
        throw new Error(
          `The PDF now has ${info.pageCount} pages, but this bank used page ${savedImport.lastPage}. Generate a new range from the PDF.`,
        );
      }
      const savedRange = {
        firstPage: savedImport.firstPage,
        lastPage: savedImport.lastPage,
      };
      const selectedCount = savedRange.lastPage - savedRange.firstPage + 1;
      const extraction = await this.extractPdfRange(
        bytes,
        info,
        savedRange,
        Math.max(this.settings.pdfMaxPageCount, selectedCount),
      );
      restored = await collectRegenerationPdfSource(
        this.app,
        sourceFile,
        currentBank,
        extraction,
        savedImport,
        this.settings.sourceClassificationRules,
      );
    } else {
      restored = await collectRegenerationSource(
        this.app,
        sourceFile,
        currentBank,
        this.settings.sourceClassificationRules,
      );
    }
    this.lastSource = restored.source;
    const context = [
      preset.explanation,
      restored.source.mode === "pdf"
        ? restored.currentNoteChanged
          ? "The PDF changed since this bank was generated; the new draft will use the same saved page range from the current PDF."
          : "The PDF is unchanged; the new draft will use the same saved page range."
        : currentBank.source.scope === "selection"
        ? "Generation will use the saved selection snapshot, so unrelated text from the source note is not added."
        : restored.currentNoteChanged
          ? "The source note has changed since this bank was generated; the new draft will use the current note content."
          : "The source note is unchanged; the new draft will use its current content.",
      restored.restoredVisualCount === 0
        ? "No previous visual is selected."
        : `${restored.restoredVisualCount} previously used ${restored.restoredVisualCount === 1 ? "visual is" : "visuals are"} selected again.`,
    ].join(" ");
    const view = await this.openView();
    view.prepareRegeneration(restored.source, preset.defaults, context);
  }

  private async openView(
    source?: SourcePresentation,
    prepareDefaultVisuals = false,
  ): Promise<PracticeLabView> {
    if (!Platform.isMobileApp && this.generationRecoveryHandle === undefined) {
      if (this.providersRefreshedAt === 0) {
        await this.refreshProviders();
      } else if (Date.now() - this.providersRefreshedAt > 60_000) {
        void this.refreshProviders();
      }
    }
    const existingLeaves = this.app.workspace.getLeavesOfType(
      PRACTICE_LAB_VIEW_TYPE,
    );
    let leaf: WorkspaceLeaf | undefined;
    if (Platform.isMobileApp) {
      const rootLeaves = new Set<WorkspaceLeaf>();
      this.app.workspace.iterateRootLeaves((candidate) => {
        rootLeaves.add(candidate);
      });
      leaf = existingLeaves.find((candidate) => rootLeaves.has(candidate));
      const drawerLeaves = existingLeaves.filter(
        (candidate) => !rootLeaves.has(candidate),
      );
      for (const drawerLeaf of drawerLeaves) {
        if (drawerLeaf.view instanceof PracticeLabView) {
          await drawerLeaf.view.prepareForWorkspaceRelocation();
        }
      }
      if (leaf === undefined) {
        leaf = this.app.workspace.getLeaf("tab");
        await leaf.setViewState({
          type: PRACTICE_LAB_VIEW_TYPE,
          active: true,
        });
      }
      for (const drawerLeaf of drawerLeaves) drawerLeaf.detach();
      if (drawerLeaves.length > 0) {
        this.app.workspace.requestSaveLayout();
      }
    } else {
      leaf = existingLeaves[0];
      if (leaf === undefined) {
        leaf = this.settings.practiceViewLocation === "right-sidebar"
          ? this.app.workspace.getRightLeaf(false)
            ?? this.app.workspace.getLeaf("tab")
          : this.app.workspace.getLeaf("tab");
        await leaf.setViewState({
          type: PRACTICE_LAB_VIEW_TYPE,
          active: true,
        });
      }
    }
    await this.app.workspace.revealLeaf(leaf);
    if (!(leaf.view instanceof PracticeLabView)) throw new Error("Practice Problem Generator view could not be opened.");
    leaf.view.setProviders(this.providers);
    leaf.view.setDisplayPreferences(this.settings.display);
    leaf.view.setGenerationRecovery(this.generationRecoveryPresentation());
    leaf.view.setConfigurationDefaults({
      provider: this.settings.provider,
      model: modelForProvider(this.settings, this.settings.provider),
      reasoningEffort: this.settings.reasoningEffort,
      focusInstructions: this.settings.defaultFocusInstructions,
      gifFrameDefault: this.settings.gifFrameDefault,
      visualSelectionDefault: this.settings.visualSelectionDefault,
      studyOrderDefault: this.settings.studyOrderDefault,
      studyTypeSequence: [...this.settings.studyTypeSequence],
      studyShuffleWithinTypesDefault:
        this.settings.studyShuffleWithinTypesDefault,
      quantity: this.settings.quantity,
      difficulty: generationDifficultyFromSetting(this.settings.difficulty),
      exerciseTypePercentages: { ...this.settings.exerciseTypePercentages },
      aiContextCompletionPolicy: DEFAULT_AI_CONTEXT_COMPLETION_POLICY,
      answerReviewMode: this.settings.answerReviewDefault,
      answerReviewProvider: this.settings.answerReviewProvider,
      answerReviewReasoningEffort: this.settings.answerReviewReasoningEffort,
    });
    if (source !== undefined) {
      leaf.view.setSource(source, { prepareDefaultVisuals });
    } else if (
      this.generationRecoveryHandle !== undefined
      && this.pendingGeneration !== undefined
    ) {
      this.presentInterruptedGeneration(leaf.view);
    }
    return leaf.view;
  }

  private async openLearningPathView(
    source?: SourcePresentation,
  ): Promise<PracticeLearningPathView> {
    if (Platform.isMobileApp) {
      throw new Error("Guided learning-path generation is available on desktop. Saved paths remain usable on mobile.");
    }
    if (this.providersRefreshedAt === 0) {
      await this.refreshProviders();
    } else if (Date.now() - this.providersRefreshedAt > 60_000) {
      void this.refreshProviders();
    }
    let leaf = this.app.workspace.getLeavesOfType(PRACTICE_LEARNING_PATH_VIEW_TYPE)[0];
    if (leaf === undefined) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: PRACTICE_LEARNING_PATH_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    if (!(leaf.view instanceof PracticeLearningPathView)) {
      throw new Error("The guided learning-path builder could not be opened.");
    }
    leaf.view.setProviders(this.providers);
    leaf.view.setRecoveryAvailable(this.learningBatchRecoveryHandle !== undefined);
    leaf.view.setQuickGenerationRecovery(this.generationRecoveryPresentation());
    if (source !== undefined) leaf.view.setPrimarySource(source);
    return leaf.view;
  }

  private generationRecoveryPresentation(): GenerationRecoveryPresentation | null {
    if (this.generationRecoveryHandle === undefined) return null;
    const state = this.generationRecoveryState === "idle"
      ? "running"
      : this.generationRecoveryState;
    return {
      state,
      message: this.generationRecoveryMessage
        ?? "Inspecting the saved local generation before continuing.",
    };
  }

  private updateGenerationRecoveryViews(): void {
    const presentation = this.generationRecoveryPresentation();
    for (const leaf of this.app.workspace.getLeavesOfType(PRACTICE_LAB_VIEW_TYPE)) {
      if (leaf.view instanceof PracticeLabView) {
        leaf.view.setGenerationRecovery(presentation);
      }
    }
    for (const leaf of this.app.workspace.getLeavesOfType(PRACTICE_LEARNING_PATH_VIEW_TYPE)) {
      if (leaf.view instanceof PracticeLearningPathView) {
        leaf.view.setQuickGenerationRecovery(presentation);
      }
    }
  }

  private async switchCreationMode(
    leaf: WorkspaceLeaf,
    mode: "quick" | "guided",
    source: SourcePresentation | null,
  ): Promise<void> {
    if (mode === "guided") {
      let guidedSource: SourcePresentation | undefined;
      let collectedSource: CollectedSource | undefined;
      if (source !== null) {
        if (!isRuntimeCollectedSource(source)) {
          throw new Error("Choose the source again before switching it to Guided path mode.");
        }
        collectedSource = source;
        this.lastSource = source;
        guidedSource = this.learningPathController.registerSource(source);
      }
      await leaf.setViewState({
        type: PRACTICE_LEARNING_PATH_VIEW_TYPE,
        active: true,
      });
      await this.app.workspace.revealLeaf(leaf);
      if (!(leaf.view instanceof PracticeLearningPathView)) {
        throw new Error("Guided path mode could not be opened.");
      }
      leaf.view.setProviders(this.providers);
      leaf.view.setRecoveryAvailable(this.learningBatchRecoveryHandle !== undefined);
      leaf.view.setQuickGenerationRecovery(this.generationRecoveryPresentation());
      if (guidedSource !== undefined) leaf.view.setPrimarySource(guidedSource);
      if (
        collectedSource !== undefined
        && guidedSource !== undefined
        && collectedSource.visuals.some((visual) => (
          visual.state === "frame-required" && visual.kind === "animated-gif"
        ))
      ) {
        const preparationToken = leaf.view.beginPrimaryVisualPreparation(guidedSource);
        if (preparationToken !== null) {
          try {
            const prepared = await this.prepareGuidedSourceVisuals(collectedSource);
            this.lastSource = prepared;
            const preparedPresentation = this.learningPathController.registerSource(prepared);
            if (leaf.view instanceof PracticeLearningPathView) {
              leaf.view.finishPrimaryVisualPreparation(
                preparationToken,
                guidedSource,
                preparedPresentation,
              );
            }
          } catch (error) {
            if (leaf.view instanceof PracticeLearningPathView) {
              leaf.view.finishPrimaryVisualPreparation(preparationToken, guidedSource);
            }
            this.showError(error);
          }
        }
      }
      return;
    }

    await leaf.setViewState({ type: PRACTICE_LAB_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
    if (!(leaf.view instanceof PracticeLabView)) {
      throw new Error("Quick set mode could not be opened.");
    }
    leaf.view.setProviders(this.providers);
    leaf.view.setDisplayPreferences(this.settings.display);
    leaf.view.setGenerationRecovery(this.generationRecoveryPresentation());
    if (source !== null) leaf.view.setSource(source, { prepareDefaultVisuals: true });
  }

  private async resumeLearningPathBatch(): Promise<void> {
    try {
      const view = await this.openLearningPathView();
      await view.resumeRecovery();
    } catch (error) {
      this.showError(error);
    }
  }

  private async requestDiscardLearningPathRecovery(): Promise<boolean> {
    if (this.learningBatchRecoveryHandle === undefined) return true;
    const confirmed = await confirmDestructiveAction(this.app, {
      title: "Discard interrupted guided path?",
      warning: "This removes the recoverable local batch workspace and its completed unsaved drafts.",
      consequences: [
        "Already saved practice banks, sessions, notes, PDFs, and original attachments remain untouched.",
        "The exact approved payloads and unsaved generated sets in this interrupted batch cannot be resumed afterward.",
      ],
      confirmationPhrase: DISCARD_LEARNING_BATCH_RECOVERY_CONFIRMATION,
      confirmLabel: "Discard guided path",
    });
    if (!confirmed) return false;
    await this.learningPathController.discardRecoverableBatch();
    new Notice("Discarded the interrupted guided learning path.", 6_000);
    return true;
  }

  private async openDashboard(scope?: DashboardScope): Promise<PracticeDashboardView> {
    let leaf = this.app.workspace.getLeavesOfType(PRACTICE_DASHBOARD_VIEW_TYPE)[0];
    const existing = leaf !== undefined;
    if (leaf === undefined) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: PRACTICE_DASHBOARD_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    if (!(leaf.view instanceof PracticeDashboardView)) {
      throw new Error("Practice dashboard could not be opened.");
    }
    leaf.view.setDisplayPreferences(this.settings.display, {
      rangeWeeks: this.settings.dashboardActivityRangeWeeks,
      metric: this.settings.dashboardActivityMetric,
      weekStart: this.settings.dashboardWeekStart,
    });
    if (scope !== undefined) leaf.view.setScope(scope);
    if (existing) await leaf.view.refresh();
    return leaf.view;
  }

  private async prepareForOfflinePractice(
    selectedRecords?: readonly DashboardBankRecord[],
  ): Promise<void> {
    const snapshot = await this.dashboardRepository.load();
    const records = selectedRecords ?? snapshot.records;
    const selectedPaths = new Set(records.map((record) => record.bankPath));
    const parseIssues = snapshot.issues
      .filter((issue) => selectedRecords === undefined || selectedPaths.has(issue.bankPath))
      .map((issue) => ({
        bankPath: issue.bankPath,
        severity: issue.severity,
        message: issue.message,
      }));
    const report = auditOfflineReadiness(
      records,
      (path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile
          ? { exists: true, extension: file.extension }
          : { exists: false };
      },
      parseIssues,
    );
    new OfflineReadinessModal(this.app, report).open();
  }

  private registerDashboardRefreshEvents(): void {
    const scheduleRefresh = (): void => {
      this.scheduleDashboardRefresh();
      this.schedulePendingAnswerReviewScan();
    };
    this.registerEvent(this.app.vault.on("create", scheduleRefresh));
    this.registerEvent(this.app.vault.on("modify", scheduleRefresh));
    this.registerEvent(this.app.vault.on("delete", scheduleRefresh));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      scheduleRefresh();
      void this.followStudyCheckpointBankRename(file, oldPath);
    }));
    this.registerEvent(this.app.metadataCache.on("changed", scheduleRefresh));
    this.registerEvent(this.app.metadataCache.on("resolved", scheduleRefresh));
    this.register(() => { this.clearDashboardRefreshTimer(); });
    this.register(() => { this.clearPendingAnswerReviewScanTimer(); });
  }

  private async followStudyCheckpointBankRename(
    file: TAbstractFile,
    oldPath: string,
  ): Promise<void> {
    const checkpoint = this.studyCheckpoint;
    if (
      checkpoint === undefined
      || normalizePath(oldPath).toLocaleLowerCase()
        !== normalizePath(checkpoint.bankPath).toLocaleLowerCase()
      || !(file instanceof TFile)
    ) {
      return;
    }
    try {
      const bank = await this.loadPracticeBank(file.path);
      if (bank.bankId !== checkpoint.bankId) return;
      const latest = rebaseLatestStudySessionCheckpointBankPath(
        checkpoint,
        this.studyCheckpoint,
        file.path,
      );
      if (latest.status !== "rebased") return;
      this.studyCheckpoint = latest.checkpoint;
      await this.persistStoredData();
    } catch {
      // Recovery will retry by stable bank identity when the session is resumed.
    }
  }

  private scheduleDashboardRefresh(): void {
    if (this.app.workspace.getLeavesOfType(PRACTICE_DASHBOARD_VIEW_TYPE).length === 0) {
      this.clearDashboardRefreshTimer();
      return;
    }
    this.clearDashboardRefreshTimer();
    this.dashboardRefreshTimer = window.setTimeout(() => {
      this.dashboardRefreshTimer = undefined;
      for (const leaf of this.app.workspace.getLeavesOfType(PRACTICE_DASHBOARD_VIEW_TYPE)) {
        if (leaf.view instanceof PracticeDashboardView) void leaf.view.refresh();
      }
    }, 400);
  }

  private clearDashboardRefreshTimer(): void {
    if (this.dashboardRefreshTimer === undefined) return;
    window.clearTimeout(this.dashboardRefreshTimer);
    this.dashboardRefreshTimer = undefined;
  }

  private schedulePendingAnswerReviewScan(): void {
    if (Platform.isMobileApp || this.unloading) return;
    this.clearPendingAnswerReviewScanTimer();
    this.pendingAnswerReviewScanTimer = window.setTimeout(() => {
      this.pendingAnswerReviewScanTimer = undefined;
      void this.resumePendingAnswerReviews().catch((error: unknown) => {
        this.showError(error);
      });
    }, 1_500);
  }

  private clearPendingAnswerReviewScanTimer(): void {
    if (this.pendingAnswerReviewScanTimer === undefined) return;
    window.clearTimeout(this.pendingAnswerReviewScanTimer);
    this.pendingAnswerReviewScanTimer = undefined;
  }

  private resolveCollectedSource(presentation: SourcePresentation): CollectedSource {
    const source = this.lastSource;
    if (!source || source.path !== presentation.path || source.mode !== presentation.mode) {
      throw new Error("The active source changed. Load the note or selection again.");
    }
    return {
      ...source,
      visuals: presentation.visuals,
      ...(presentation.classification === undefined
        ? {}
        : { classification: presentation.classification }),
      ...(presentation.classificationState === undefined
        ? {}
        : { classificationState: presentation.classificationState }),
    };
  }

  private async initializeDesktopWork(): Promise<void> {
    const recovery = this.restoreInterruptedGeneration();
    this.generationRecoveryTask = recovery;
    // Provider discovery must not wait for a potentially three-hour restored
    // generation. A restored creation view needs an accurate desktop state
    // immediately, even while the durable job is still being inspected.
    void this.refreshProviders();
    try {
      await recovery;
    } catch (error) {
      const code = cliErrorCode(error);
      if (
        !this.unloading
        && !this.discardingGenerationRecovery
        && code !== "detached"
      ) {
        if (code === "workspace-error") {
          await this.clearGenerationRecovery(false);
          new Notice("The saved interrupted-generation workspace was no longer available, so its stale recovery pointer was cleared.", 10_000);
        } else {
          if (
            this.generationRecoveryHandle !== undefined
            && this.generationRecoveryState === "running"
            && this.activeGenerationJobId === undefined
          ) {
            this.generationRecoveryState = "blocked";
            this.generationRecoveryMessage = `${error instanceof Error ? error.message : String(error)} Restore the required source or visual, then run “Resume interrupted generation” again.`;
            await this.persistStoredData();
            this.updateInterruptedGenerationViews();
          }
          this.showError(error);
        }
      }
    } finally {
      if (this.generationRecoveryTask === recovery) {
        this.generationRecoveryTask = undefined;
      }
    }
    if (
      !this.unloading
      && this.generationRecoveryState !== "running"
      && this.generationRecoveryState !== "blocked"
    ) {
      await this.initializeDesktopAnswerReviews();
    }
  }

  private async generateGuidedFrom(
    mode: MarkdownSourceMode,
    selection?: string,
  ): Promise<void> {
    try {
      if (this.generationRecoveryHandle !== undefined) {
        new Notice("Finish, save, or discard the interrupted quick generation before building a guided path.", 8_000);
        await this.openInterruptedGeneration();
        return;
      }
      if (this.learningBatchRecoveryHandle !== undefined) {
        await this.resumeLearningPathBatch();
        return;
      }
      const source = await collectSource(
        this.app,
        mode,
        selection,
        this.settings.sourceClassificationRules,
      );
      const prepared = await this.prepareGuidedSourceVisuals(source);
      this.lastSource = prepared;
      const presentation = this.learningPathController.registerSource(prepared);
      await this.openLearningPathView(presentation);
    } catch (error) {
      this.showError(error);
    }
  }

  private async generateGuidedFromPdf(file?: TFile): Promise<void> {
    try {
      if (this.generationRecoveryHandle !== undefined) {
        new Notice("Finish, save, or discard the interrupted quick generation before building a guided path.", 8_000);
        await this.openInterruptedGeneration();
        return;
      }
      if (this.learningBatchRecoveryHandle !== undefined) {
        await this.resumeLearningPathBatch();
        return;
      }
      const source = await this.requestPdfSource(file);
      if (source === null) return;
      const prepared = await this.prepareGuidedSourceVisuals(source);
      this.lastSource = prepared;
      const presentation = this.learningPathController.registerSource(prepared);
      await this.openLearningPathView(presentation);
    } catch (error) {
      this.showError(error);
    }
  }

  private async restoreInterruptedGeneration(): Promise<void> {
    const handle = this.generationRecoveryHandle;
    if (handle === undefined) return;
    const cli = await import("./cli");
    // The adapter shares one timeout budget across its initial and repair
    // attempts. Keep recovery longer than that complete approved budget.
    const minimumRetentionMs = this.settings.timeoutMs + 60 * 60 * 1_000;
    const configuredRetentionMs = this.settings.generationRecoveryRetentionHours
      * 60 * 60 * 1_000;
    if (
      Date.now() - Date.parse(handle.startedAt)
      > Math.max(minimumRetentionMs, configuredRetentionMs)
    ) {
      await cli.removeDurableRecovery(handle);
      await this.clearGenerationRecovery(false);
      new Notice("Expired interrupted-generation data was removed from the operating-system temporary directory.", 8_000);
      return;
    }

    const context = parseGenerationRecoveryContext(
      await cli.readDurableRecoveryText(
        handle,
        cli.GENERATION_RECOVERY_CONTEXT_FILENAME,
      ),
    );
    if (context.jobId !== handle.jobId) {
      throw new Error("The interrupted generation does not match its saved recovery handle.");
    }
    this.generationRecoveryState = "running";
    this.generationRecoveryMessage = "Inspecting the saved local job before reattaching.";
    const pending = await this.pendingGenerationFromRecovery(context);
    this.generationRecoveryContext = context;
    this.pendingGeneration = pending;
    this.lastSource = pending.source;

    const checkpoint = await this.readRecoveryDraftCheckpoint(handle);
    if (checkpoint !== null) {
      if (checkpoint.jobId !== context.jobId) {
        throw new Error("The recovered draft belongs to a different generation job.");
      }
      const draft = asGenerationDraft(checkpoint.draft, {
        source: pending.source,
        configuration: pending.configuration,
        visualIds: pending.preparedVisuals.map((visual) => visual.source.id),
        sourceAlignment: pending.sourceAlignment,
      });
      pending.draft = draft;
      pending.jobId = context.jobId;
      pending.attempts = checkpoint.attempts;
      if (checkpoint.telemetry === undefined) delete pending.telemetry;
      else pending.telemetry = checkpoint.telemetry;
      this.generationRecoveryState = "ready";
      this.generationRecoveryMessage = "Recovered draft ready for review and saving.";
      this.updateInterruptedGenerationViews();
      new Notice("Recovered an interrupted practice-problem draft. Open Practice Problem Generator to review it.", 10_000);
      return;
    }

    this.generationRecoveryState = "running";
    this.generationRecoveryMessage = "Reattached to the exact local CLI job; generation is continuing from its existing progress.";
    this.activeGenerationJobId = context.jobId;
    this.updateInterruptedGenerationViews();
    new Notice(`Resuming interrupted ${context.configuration.provider} generation in the background.`, 8_000);
    try {
      const layer = await this.ensureCliLayer();
      const adapter = layer.adapters[context.configuration.provider];
      const result = await layer.coordinator.generateWhenAvailable(adapter, {
        prompt: context.prompt,
        schema: generationDraftV1JsonSchema,
        validate: (value) => validateGeneratedDraft(value, {
          source: pending.source,
          configuration: pending.configuration,
          visualIds: pending.preparedVisuals.map((visual) => visual.source.id),
          sourceAlignment: pending.sourceAlignment,
        }),
        ...(context.configuration.model.length === 0
          ? {}
          : { model: context.configuration.model }),
        reasoningEffort: context.configuration.reasoningEffort,
        media: pending.preparedVisuals.map((visual) => visual.media),
        timeoutMs: this.settings.timeoutMs,
        recovery: { mode: "resume", handle },
        onActivity: (event) => this.publishRecoveredGenerationActivity(event),
      }, {
        id: context.jobId,
        kind: "generation",
        provider: context.configuration.provider,
      });
      const draft = asGenerationDraft(result.value, {
        source: pending.source,
        configuration: pending.configuration,
        visualIds: pending.preparedVisuals.map((visual) => visual.source.id),
        sourceAlignment: pending.sourceAlignment,
      });
      pending.draft = draft;
      pending.jobId = context.jobId;
      pending.attempts = result.attempts;
      if (result.telemetry === undefined) delete pending.telemetry;
      else pending.telemetry = result.telemetry;
      this.generationRecoveryHandle = result.recoveryHandle ?? handle;
      await cli.writeDurableRecoveryText(
        this.generationRecoveryHandle,
        GENERATION_RECOVERY_DRAFT_FILENAME,
        JSON.stringify(createGenerationRecoveryDraft({
          jobId: context.jobId,
          attempts: result.attempts,
          ...(result.telemetry === undefined ? {} : { telemetry: result.telemetry }),
          draft,
        })),
      );
      this.generationRecoveryState = "ready";
      this.generationRecoveryMessage = "Interrupted generation completed and is ready for review.";
      await this.persistStoredData();
      this.updateInterruptedGenerationViews();
      new Notice("Interrupted generation recovered successfully. Open Practice Problem Generator to review the draft.", 10_000);
    } catch (error) {
      const code = cliErrorCode(error);
      if (code === "detached") throw error;
      if (code === "cancelled" || code === "timeout") {
        await this.clearGenerationRecovery(false);
      } else {
        this.generationRecoveryState = "failed";
        const detail = error instanceof Error
          ? error.message
          : "The interrupted generation could not be recovered.";
        this.generationRecoveryMessage = `${detail} The exact approved request remains available to retry or discard.`;
        await this.persistStoredData();
        this.updateInterruptedGenerationViews();
      }
      throw error;
    } finally {
      if (this.activeGenerationJobId === context.jobId) {
        this.activeGenerationJobId = undefined;
      }
    }
  }

  private async pendingGenerationFromRecovery(
    context: GenerationRecoveryContextV1,
  ): Promise<PendingGeneration> {
    const file = this.app.vault.getAbstractFileByPath(context.source.path);
    if (!(file instanceof TFile)) {
      throw new Error(
        `The interrupted generation's source is missing: ${context.source.path}. Restore it before resuming.`,
      );
    }
    const prepared = prepareSource(context.source.submittedText);
    if (
      prepared.hash !== context.source.hash
      || JSON.stringify(prepared.segments) !== JSON.stringify(context.source.segments)
    ) {
      throw new Error("The interrupted generation's source checkpoint failed its local integrity check.");
    }
    const preparedVisuals: PreparedVisual[] = [];
    for (const visual of context.visuals) {
      const visualFile = this.app.vault.getAbstractFileByPath(visual.vaultPath);
      if (!(visualFile instanceof TFile)) {
        throw new Error(
          `A visual required by the interrupted generation is missing: ${visual.vaultPath}.`,
        );
      }
      preparedVisuals.push({
        source: visual,
        media: {
          bytes: await this.app.vault.readBinary(visualFile),
          mimeType: visual.mimeType,
        },
      });
    }
    const detectedVisuals = context.visuals.map((visual, index) =>
      recoveredDetectedVisual(
        visual,
        index,
        this.app.vault.adapter.getResourcePath(visual.vaultPath),
      ));
    const source: CollectedSource = {
      mode: context.source.mode,
      title: context.source.title,
      path: context.source.path,
      characterCount: context.source.characterCount,
      excerpt: context.source.excerpt,
      ...(context.source.detail === undefined ? {} : { detail: context.source.detail }),
      visuals: detectedVisuals,
      file,
      submittedText: context.source.submittedText,
      ...(context.source.sourceImport === undefined
        ? {}
        : { sourceImport: context.source.sourceImport }),
      hash: context.source.hash,
      segments: [...context.source.segments],
      ...(context.source.classification === undefined
        ? {}
        : { classification: context.source.classification }),
      ...(context.source.classificationState === undefined
        ? {}
        : { classificationState: context.source.classificationState }),
    };
    return {
      source,
      configuration: context.configuration,
      prompt: context.prompt,
      preparedVisuals,
      sourceAlignment: context.sourceAlignment
        ?? createUnverifiedSourceAlignmentLedger(),
    };
  }

  private async readRecoveryDraftCheckpoint(
    handle: DurableProcessHandle,
  ): Promise<ReturnType<typeof parseGenerationRecoveryDraft> | null> {
    const cli = await import("./cli");
    try {
      return parseGenerationRecoveryDraft(
        await cli.readDurableRecoveryText(
          handle,
          GENERATION_RECOVERY_DRAFT_FILENAME,
        ),
      );
    } catch (error) {
      if (nodeErrorCode(error) === "ENOENT") return null;
      throw error;
    }
  }

  private publishRecoveredGenerationActivity(event: CliActivityEvent): void {
    for (const leaf of this.app.workspace.getLeavesOfType(PRACTICE_LAB_VIEW_TYPE)) {
      if (leaf.view instanceof PracticeLabView) {
        leaf.view.publishRecoveredGenerationActivity(event);
      }
    }
  }

  private updateInterruptedGenerationViews(): void {
    this.updateGenerationRecoveryViews();
    for (const leaf of this.app.workspace.getLeavesOfType(PRACTICE_LAB_VIEW_TYPE)) {
      if (leaf.view instanceof PracticeLabView && this.pendingGeneration !== undefined) {
        this.presentInterruptedGeneration(leaf.view);
      }
    }
  }

  private presentInterruptedGeneration(view: PracticeLabView): void {
    const pending = this.pendingGeneration;
    if (pending === undefined || this.generationRecoveryHandle === undefined) return;
    const visualUrls = new Map(pending.preparedVisuals.map((visual) => [
      visual.source.id,
      this.app.vault.adapter.getResourcePath(visual.source.vaultPath),
    ]));
    const drafts = pending.draft === undefined
      ? undefined
      : presentExercises(
          pending.draft.exercises,
          (visualId) => visualUrls.get(visualId),
          pending.source.segments,
        );
    view.prepareRecoveredGeneration(
      pending.source,
      configurationDefaults(pending.configuration),
      {
        state: this.generationRecoveryState,
        ...(this.generationRecoveryMessage === undefined
          ? {}
          : { message: this.generationRecoveryMessage }),
      },
      drafts,
    );
  }

  private async openInterruptedGeneration(): Promise<void> {
    const view = await this.openView();
    this.presentInterruptedGeneration(view);
  }

  private async requestResumeInterruptedGeneration(): Promise<void> {
    if (this.generationRecoveryHandle === undefined) {
      new Notice("There is no interrupted generation to resume.");
      return;
    }
    if (
      this.generationRecoveryState === "blocked"
      && this.generationRecoveryTask === undefined
    ) {
      this.generationRecoveryState = "running";
      this.generationRecoveryMessage = "Checking the saved source and exact detached CLI job again.";
      const recovery = this.restoreInterruptedGeneration();
      this.generationRecoveryTask = recovery;
      try {
        await recovery;
      } catch (error) {
        const code = cliErrorCode(error);
        if (code === "workspace-error") {
          await this.clearGenerationRecovery(false);
          new Notice("The interrupted-generation workspace is no longer available; its stale pointer was cleared.", 10_000);
          return;
        }
        if (code !== "detached") {
          if (
            this.generationRecoveryHandle !== undefined
            && this.pendingGeneration === undefined
          ) {
            this.generationRecoveryState = "blocked";
            this.generationRecoveryMessage = `${error instanceof Error ? error.message : String(error)} Restore the required source or visual, or discard this recovery.`;
            await this.persistStoredData();
          }
          this.showError(error);
        }
      } finally {
        if (this.generationRecoveryTask === recovery) {
          this.generationRecoveryTask = undefined;
        }
      }
      if (
        !this.unloading
        && this.generationRecoveryState !== "running"
        && this.generationRecoveryState !== "blocked"
      ) {
        await this.initializeDesktopAnswerReviews();
      }
    }
    if (this.generationRecoveryHandle !== undefined) {
      await this.openInterruptedGeneration();
    }
  }

  private async requestRetryInterruptedGeneration(): Promise<void> {
    const handle = this.generationRecoveryHandle;
    if (handle === undefined) {
      new Notice("There is no interrupted generation to retry.");
      return;
    }
    if (this.generationRecoveryState === "ready") {
      new Notice("The recovered draft is already ready for review.", 6_000);
      await this.openInterruptedGeneration();
      return;
    }
    if (
      this.generationRecoveryState === "running"
      || this.generationRecoveryTask !== undefined
    ) {
      new Notice("The saved generation is still being inspected. Use resume / inspect first.", 8_000);
      await this.openInterruptedGeneration();
      return;
    }
    if (this.generationRecoveryState === "blocked") {
      new Notice("Restore the missing source or visual, then use resume / inspect.", 8_000);
      await this.openInterruptedGeneration();
      return;
    }

    const pending = this.pendingGeneration;
    if (pending === undefined) {
      new Notice("The exact approved request could not be reopened. Keep the recovery and use resume / inspect.", 10_000);
      await this.openInterruptedGeneration();
      return;
    }
    const retryPending: PendingGeneration = {
      source: pending.source,
      configuration: pending.configuration,
      prompt: pending.prompt,
      preparedVisuals: pending.preparedVisuals,
      sourceAlignment: pending.sourceAlignment,
    };

    this.discardingGenerationRecovery = true;
    try {
      const cli = await import("./cli");
      try {
        await cli.cancelDurableRecovery(handle);
      } catch (error) {
        if (cliErrorCode(error) !== "workspace-error") throw error;
      }
      await this.clearGenerationRecovery(true);
      this.pendingGeneration = retryPending;
      this.lastSource = retryPending.source;
    } finally {
      this.discardingGenerationRecovery = false;
    }

    const view = await this.openView();
    view.prepareRecoveredGeneration(
      retryPending.source,
      configurationDefaults(retryPending.configuration),
      {
        state: "running",
        message: "Starting a fresh local job from the exact payload you already approved.",
      },
    );
    try {
      const drafts = await this.runGeneration(
        retryPending.source,
        retryPending.configuration,
        (event) => view.publishRecoveredGenerationActivity(event),
      );
      view.setJob({ state: "idle" });
      view.setDrafts(drafts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      view.setJob({ state: "failed", message });
      this.updateGenerationRecoveryViews();
      this.showError(error);
    }
  }

  private async redirectToInterruptedGeneration(): Promise<boolean> {
    if (this.generationRecoveryHandle === undefined) return false;
    new Notice(
      "A recoverable generation already exists. Review, save, or discard it before starting another.",
      8_000,
    );
    await this.openInterruptedGeneration();
    return true;
  }

  public async requestDiscardInterruptedGeneration(): Promise<void> {
    const handle = this.generationRecoveryHandle;
    if (handle === undefined) {
      new Notice("There is no interrupted generation to discard.");
      return;
    }
    const confirmed = await confirmDestructiveAction(this.app, {
      title: "Discard the interrupted generation?",
      warning: "The recoverable CLI job, approved source checkpoint, neutral media copies, and unsaved generated draft will be removed.",
      consequences: [
        "No source note, saved practice bank, session history, score, or setting will be changed.",
        "An unsaved generated draft cannot be recovered after this cleanup.",
        "A currently running provider process will be cancelled first.",
      ],
      confirmationPhrase: DISCARD_GENERATION_RECOVERY_CONFIRMATION,
      confirmLabel: "Discard generation",
    });
    if (!confirmed) return;
    this.discardingGenerationRecovery = true;
    try {
      const cli = await import("./cli");
      try {
        await cli.cancelDurableRecovery(handle);
      } catch (error) {
        if (cliErrorCode(error) !== "workspace-error") throw error;
        // A missing or rejected workspace has nothing safe to cancel or
        // delete. Clearing only the small plugin-data pointer is safe.
        await this.clearGenerationRecovery(false);
      }
      if (this.activeGenerationJobId !== undefined) {
        this.cliLayer?.coordinator.cancel(this.activeGenerationJobId);
        try {
          await this.cliLayer?.coordinator.whenIdle();
        } catch {
          // Cleanup below remains authoritative.
        }
      }
      const recoveryTask = this.generationRecoveryTask;
      if (recoveryTask !== undefined) {
        try {
          await recoveryTask;
        } catch {
          // An interrupted restore is expected to reject after cancellation.
        }
      }
      await this.clearGenerationRecovery(true);
      delete this.pendingGeneration;
      for (const leaf of this.app.workspace.getLeavesOfType(PRACTICE_LAB_VIEW_TYPE)) {
        if (leaf.view instanceof PracticeLabView) {
          leaf.view.setJob({ state: "idle" });
        }
      }
      new Notice("Interrupted-generation recovery data was removed.", 6_000);
    } finally {
      this.discardingGenerationRecovery = false;
    }
  }

  private async clearGenerationRecovery(removeWorkspace: boolean): Promise<void> {
    const handle = this.generationRecoveryHandle;
    if (removeWorkspace && handle !== undefined) {
      const cli = await import("./cli");
      await cli.removeDurableRecovery(handle);
    }
    this.generationRecoveryHandle = undefined;
    this.generationRecoveryContext = undefined;
    this.generationRecoveryState = "idle";
    this.generationRecoveryMessage = undefined;
    await this.persistStoredData();
    this.updateGenerationRecoveryViews();
  }

  private async initializeDesktopAnswerReviews(): Promise<void> {
    await this.refreshProviders();
    try {
      await this.resumePendingAnswerReviews();
    } catch (error) {
      this.showError(error);
    }
  }

  private ensureAnswerReviewQueue(): AnswerReviewQueue {
    if (Platform.isMobileApp) {
      throw new Error("Background AI answer review is available in Obsidian desktop only.");
    }
    if (this.answerReviewQueue !== undefined) return this.answerReviewQueue;
    const queue = new AnswerReviewQueue({
      executor: async (job, signal) => {
        const layer = await this.ensureCliLayer();
        const adapter = layer.adapters[job.provider];
        const contract = createAnswerReviewStructuredRequest(job.input);
        const result = await layer.coordinator.generate<AnswerReviewOutputV1>(adapter, {
          ...contract,
          reasoningEffort: job.reasoningEffort,
          timeoutMs: job.timeoutMs ?? this.settings.answerReviewTimeoutMs,
          signal,
          onActivity: (activity) => {
            this.publishAnswerReviewActivity(job.input.requestId, activity);
          },
        }, {
          id: job.input.requestId,
          kind: "answer-review",
          provider: job.provider,
        });
        return result.value;
      },
      waitUntilAvailable: async (signal) => {
        const layer = await this.ensureCliLayer();
        await layer.coordinator.whenIdle(signal);
      },
      maxRetries: 1,
    });
    this.answerReviewQueueUnsubscribe = queue.subscribe((event) => {
      this.handleAnswerReviewQueueEvent(event);
    });
    this.answerReviewQueue = queue;
    return queue;
  }

  private enqueueAnswerReview(request: AnswerReviewRequest): void {
    const inputValidation = validateAnswerReviewInput(
      createAnswerReviewInput(request),
    );
    if (!inputValidation.valid) {
      throw new Error(
        inputValidation.errors?.[0] ?? "The AI review payload is invalid.",
      );
    }
    const existingRequest = this.answerReviewRequests.get(request.requestId);
    if (
      existingRequest !== undefined
      && JSON.stringify(existingRequest) !== JSON.stringify(request)
    ) {
      throw new Error(
        `AI review request ID ${request.requestId} is already active with different locked content.`,
      );
    }
    this.answerReviewRequests.set(request.requestId, structuredClone(request));
    const pending: AnswerReviewStatus = {
      requestId: request.requestId,
      sessionId: request.sessionId,
      exerciseId: request.exerciseId,
      state: "pending",
      queuedAt: request.requestedAt,
      attempts: 0,
    };
    this.answerReviewStatusesById.set(request.requestId, pending);
    this.publishAnswerReviewStatus(pending);
    try {
      this.enqueueAnswerReviewIfReady(request);
    } catch (error) {
      this.answerReviewRequests.delete(request.requestId);
      this.answerReviewStatusesById.delete(request.requestId);
      throw error;
    }
  }

  private enqueueAnswerReviewIfReady(
    request: AnswerReviewRequest,
    attempts = 0,
  ): boolean {
    if (this.pausedAnswerReviewIds.has(request.requestId)) return false;
    if (!canRunAnswerReview(this.providers, request.provider, request.reasoningEffort)) {
      return false;
    }
    const queue = this.ensureAnswerReviewQueue();
    const existing = queue.get(request.requestId);
    if (existing !== undefined) {
      if (existing.state === "failed" || existing.state === "cancelled") {
        return queue.retry(request.requestId);
      }
      return true;
    }
    queue.enqueue({
      input: createAnswerReviewInput(request),
      provider: request.provider,
      reasoningEffort: request.reasoningEffort,
      timeoutMs: this.settings.answerReviewTimeoutMs,
      attempts,
    });
    return true;
  }

  private queueWaitingAnswerReviews(): void {
    for (const [requestId, status] of this.answerReviewStatusesById) {
      if (status.state !== "pending") continue;
      const request = this.answerReviewRequests.get(requestId);
      if (request !== undefined) {
        this.enqueueAnswerReviewIfReady(request, status.attempts);
      }
    }
  }

  private handleAnswerReviewQueueEvent(event: AnswerReviewQueueEvent): void {
    const request = this.answerReviewRequests.get(event.requestId);
    if (request === undefined) return;
    let status: AnswerReviewStatus;
    if (event.state === "completed" && event.output !== undefined) {
      const input = event.job.input;
      const criteriaById = new Map(input.criteria.map((criterion) => [criterion.id, criterion.text]));
      status = {
        requestId: request.requestId,
        sessionId: request.sessionId,
        exerciseId: request.exerciseId,
        state: "reviewed",
        reviewedAt: new Date().toISOString(),
        attempts: event.attempts,
        verdict: event.output.verdict,
        feedback: event.output.feedback,
        criterionResults: event.output.criterionResults.map((criterion) => ({
          criterion: criteriaById.get(criterion.criterionId) ?? criterion.criterionId,
          outcome: criterion.state,
          feedback: criterion.feedback,
          sourceSegmentIds: [...criterion.sourceSegmentIds],
        })),
      };
    } else if (
      event.state === "cancelled"
      && this.pausedAnswerReviewIds.has(event.requestId)
    ) {
      const previous = this.answerReviewStatusesById.get(event.requestId);
      status = {
        requestId: request.requestId,
        sessionId: request.sessionId,
        exerciseId: request.exerciseId,
        state: "pending",
        queuedAt: previous?.state === "pending"
          ? previous.queuedAt
          : request.requestedAt,
        attempts: event.attempts,
      };
    } else if (event.state === "failed" || event.state === "cancelled") {
      status = {
        requestId: request.requestId,
        sessionId: request.sessionId,
        exerciseId: request.exerciseId,
        state: "failed",
        failedAt: new Date().toISOString(),
        attempts: event.attempts,
        failureCode: event.error?.code ?? "process-failed",
        failure: event.error?.message ?? "The AI review failed.",
        ...(event.error === undefined ? {} : { retryable: event.error.retryable }),
      };
    } else {
      const previous = this.answerReviewStatusesById.get(event.requestId);
      status = {
        requestId: request.requestId,
        sessionId: request.sessionId,
        exerciseId: request.exerciseId,
        state: "pending",
        queuedAt: previous?.state === "pending" ? previous.queuedAt : request.requestedAt,
        attempts: event.attempts,
      };
    }
    this.answerReviewStatusesById.set(event.requestId, status);
    this.publishAnswerReviewStatus(status);
    if (status.state !== "pending") this.queueAnswerReviewPersistence(event.requestId, status);
  }

  private pauseAnswerReview(requestId: string): void {
    this.pausedAnswerReviewIds.add(requestId);
    this.answerReviewQueue?.cancel(requestId);
  }

  private async retryAnswerReview(request: AnswerReviewRequest): Promise<void> {
    const inputValidation = validateAnswerReviewInput(
      createAnswerReviewInput(request),
    );
    if (!inputValidation.valid) {
      throw new Error(
        inputValidation.errors?.[0] ?? "The locked AI review payload is invalid.",
      );
    }
    const previous = this.answerReviewStatusesById.get(request.requestId);
    if (previous?.state !== "failed") return;
    const pending: AnswerReviewStatus = {
      requestId: request.requestId,
      sessionId: request.sessionId,
      exerciseId: request.exerciseId,
      state: "pending",
      queuedAt: new Date().toISOString(),
      attempts: previous.attempts,
    };
    this.pausedAnswerReviewIds.delete(request.requestId);
    this.answerReviewStatusesById.set(request.requestId, pending);
    this.publishAnswerReviewStatus(pending);

    try {
      await this.answerReviewPersistenceChain;
      this.pendingAnswerReviewPersistence.delete(request.requestId);
      this.warnedAnswerReviewPersistence.delete(request.requestId);
      let target = this.answerReviewTargets.get(request.requestId);
      if (target === undefined && this.activeBank !== undefined) {
        const stored = findStoredAnswerReview(
          this.activeBank.bank,
          request.sessionId,
          request.requestId,
        );
        if (stored !== undefined) {
          target = {
            bankPath: this.activeBank.path,
            bankId: this.activeBank.bank.bankId,
            sessionId: request.sessionId,
            requestId: request.requestId,
            requestHash: stored.request.requestHash,
            expectedRevision: this.activeBank.bank.revision,
          };
          this.answerReviewTargets.set(request.requestId, target);
        }
      }
      if (target !== undefined) {
        const bank = await this.loadPracticeBank(target.bankPath);
        const stored = findStoredAnswerReview(
          bank,
          target.sessionId,
          target.requestId,
        );
        if (stored === undefined || stored.request.requestHash !== target.requestHash) {
          throw new Error("The saved AI review no longer matches its locked request.");
        }
        let saved = bank;
        if (stored.state.status === "failed") {
          const patch: AiReviewStateTransitionPatchV2 = {
            bankId: target.bankId,
            sessionId: target.sessionId,
            requestId: target.requestId,
            requestHash: target.requestHash,
            state: {
              status: "pending",
              queuedAt: pending.queuedAt,
              attempts: previous.attempts,
            },
          };
          saved = await this.repository.applyAiReviewStateTransition(
            target.bankPath,
            patch,
            target.expectedRevision,
          );
        } else if (stored.state.status === "reviewed") {
          throw new Error("This AI review has already been completed.");
        }
        this.answerReviewTargets.set(request.requestId, {
          ...target,
          expectedRevision: saved.revision,
        });
        if (
          this.activeBank?.path === target.bankPath
          && this.activeBank.bank.bankId === target.bankId
        ) {
          this.activeBank.bank = saved;
        }
      }
    } catch (error) {
      this.answerReviewStatusesById.set(request.requestId, previous);
      this.publishAnswerReviewStatus(previous);
      throw error;
    }

    this.enqueueAnswerReviewIfReady(request, previous.attempts);
  }

  private async retryPersistedAnswerReview(
    bankPath: string,
    identity: PersistedAnswerReviewRetryTarget,
  ): Promise<void> {
    const bank = await this.loadPracticeBank(bankPath);
    if (bank.bankId !== identity.bankId) {
      throw new Error("The saved practice bank identity changed; the review was not retried.");
    }
    const stored = findStoredAnswerReview(
      bank,
      identity.sessionId,
      identity.requestId,
    );
    if (
      stored === undefined
      || stored.request.requestHash !== identity.requestHash
      || stored.state.status !== "failed"
    ) {
      throw new Error("The failed AI review no longer matches the selected history entry.");
    }
    const request = answerReviewRequestFromStored(stored);
    const existingRequest = this.answerReviewRequests.get(request.requestId);
    const existingTarget = this.answerReviewTargets.get(request.requestId);
    if (
      (existingRequest !== undefined
        && JSON.stringify(existingRequest) !== JSON.stringify(request))
      || (existingTarget !== undefined
        && (existingTarget.bankId !== bank.bankId
          || existingTarget.sessionId !== identity.sessionId
          || existingTarget.requestHash !== identity.requestHash))
    ) {
      throw new Error(
        `AI review request ID ${request.requestId} is already active for another locked review.`,
      );
    }
    this.answerReviewRequests.set(request.requestId, request);
    this.answerReviewStatusesById.set(
      request.requestId,
      answerReviewStatusFromStored(stored),
    );
    this.answerReviewTargets.set(request.requestId, {
      bankPath,
      bankId: bank.bankId,
      sessionId: identity.sessionId,
      requestId: identity.requestId,
      requestHash: identity.requestHash,
      expectedRevision: bank.revision,
    });
    await this.retryAnswerReview(request);
  }

  private async existingPracticeBankPathForSource(
    sourcePath: string,
  ): Promise<string | undefined> {
    const normalizedSource = normalizePath(sourcePath).toLocaleLowerCase();
    const snapshot = await this.dashboardRepository.load();
    const paths = new Set(
      snapshot.records
        .filter((record) =>
          normalizePath(record.bank.source.vaultPath).toLocaleLowerCase() === normalizedSource)
        .map((record) => normalizePath(record.bankPath)),
    );
    if (
      this.activeBank !== undefined
      && normalizePath(this.activeBank.bank.source.vaultPath).toLocaleLowerCase()
        === normalizedSource
    ) {
      paths.add(normalizePath(this.activeBank.path));
    }
    if (paths.size > 1) {
      throw new Error(
        `Multiple practice banks already reference ${sourcePath}: ${[...paths].sort().join(", ")}. Remove the duplicate before generating again.`,
      );
    }
    return [...paths][0];
  }

  private async loadPracticeBank(bankPath: string): Promise<PracticeBankV4> {
    const file = this.app.vault.getAbstractFileByPath(bankPath);
    if (!(file instanceof TFile)) {
      throw new Error("The Practice Problem Generator bank no longer exists.");
    }
    const parsed = parsePracticeBankMarkdown(await this.app.vault.cachedRead(file));
    if (parsed.status !== "ok") throw parseFailure(parsed);
    return parsed.bank;
  }

  private answerReviewStatuses(sessionId: string): readonly AnswerReviewStatus[] {
    return [...this.answerReviewStatusesById.values()]
      .filter((status) => status.sessionId === sessionId)
      .sort((left, right) => left.requestId.localeCompare(right.requestId));
  }

  private publishAnswerReviewStatus(status: AnswerReviewStatus): void {
    for (const leaf of this.app.workspace.getLeavesOfType(PRACTICE_LAB_VIEW_TYPE)) {
      if (leaf.view instanceof PracticeLabView) leaf.view.publishAnswerReviewStatus(status);
    }
  }

  private publishAnswerReviewActivity(
    requestId: string,
    activity: CliActivityEvent,
  ): void {
    const request = this.answerReviewRequests.get(requestId);
    if (request === undefined) return;
    const presentation: AnswerReviewActivityPresentation = {
      ...activity,
      requestId,
      sessionId: request.sessionId,
      exerciseId: request.exerciseId,
      exerciseTitle: request.exerciseTitle,
    };
    for (const leaf of this.app.workspace.getLeavesOfType(PRACTICE_LAB_VIEW_TYPE)) {
      if (leaf.view instanceof PracticeLabView) {
        leaf.view.publishAnswerReviewActivity(presentation);
      }
    }
  }

  private flushTerminalAnswerReview(requestId: string): void {
    const status = this.answerReviewStatusesById.get(requestId);
    if (status !== undefined && status.state !== "pending") {
      this.queueAnswerReviewPersistence(requestId, status);
      return;
    }
    const entry = this.answerReviewQueue?.get(requestId);
    if (entry?.state === "completed" || entry?.state === "failed" || entry?.state === "cancelled") {
      this.handleAnswerReviewQueueEvent({ ...entry, terminal: true });
    }
  }

  private queueAnswerReviewPersistence(
    requestId: string,
    status: TerminalAnswerReviewStatus,
  ): void {
    if (!this.answerReviewTargets.has(requestId)) return;
    this.pendingAnswerReviewPersistence.set(requestId, status);
    if (this.queuedAnswerReviewPersistence.has(requestId)) return;
    this.queuedAnswerReviewPersistence.add(requestId);
    this.answerReviewPersistenceChain = this.answerReviewPersistenceChain
      .then(async () => {
        const latest = this.pendingAnswerReviewPersistence.get(requestId);
        if (latest === undefined || !this.answerReviewTargets.has(requestId)) return;
        try {
          await this.persistAnswerReviewStatusWithRetry(requestId, latest);
          this.pendingAnswerReviewPersistence.delete(requestId);
          this.warnedAnswerReviewPersistence.delete(requestId);
        } catch {
          if (!this.warnedAnswerReviewPersistence.has(requestId)) {
            this.warnedAnswerReviewPersistence.add(requestId);
            new Notice(
              "Practice Problem Generator: the AI review finished, but its bank update is delayed. The result is retained and will be retried automatically.",
              10_000,
            );
          }
          this.scheduleAnswerReviewPersistenceRetry();
        } finally {
          this.queuedAnswerReviewPersistence.delete(requestId);
        }
      });
  }

  private async persistAnswerReviewStatusWithRetry(
    requestId: string,
    status: TerminalAnswerReviewStatus,
  ): Promise<void> {
    await retryAsync(
      async () => this.persistAnswerReviewStatus(requestId, status),
      ANSWER_REVIEW_PERSISTENCE_RETRY_DELAYS_MS,
    );
  }

  private scheduleAnswerReviewPersistenceRetry(): void {
    if (
      this.unloading
      || this.answerReviewPersistenceRetryTimer !== undefined
      || this.pendingAnswerReviewPersistence.size === 0
    ) {
      return;
    }
    this.answerReviewPersistenceRetryTimer = window.setTimeout(() => {
      this.answerReviewPersistenceRetryTimer = undefined;
      for (const [requestId, status] of this.pendingAnswerReviewPersistence) {
        this.queueAnswerReviewPersistence(requestId, status);
      }
    }, ANSWER_REVIEW_PERSISTENCE_DEFER_MS);
  }

  private clearAnswerReviewPersistenceRetryTimer(): void {
    if (this.answerReviewPersistenceRetryTimer === undefined) return;
    window.clearTimeout(this.answerReviewPersistenceRetryTimer);
    this.answerReviewPersistenceRetryTimer = undefined;
  }

  private async persistAnswerReviewStatus(
    requestId: string,
    status: TerminalAnswerReviewStatus,
  ): Promise<void> {
    const target = this.answerReviewTargets.get(requestId);
    if (target === undefined) return;
    const state: AiReviewResolutionPatchV2["state"] = status.state === "reviewed"
      ? {
          status: "reviewed",
          reviewedAt: status.reviewedAt,
          attempts: status.attempts,
          verdict: status.verdict,
          feedback: status.feedback,
          criteria: status.criterionResults.map((criterion) => ({
            criterion: criterion.criterion,
            outcome: criterion.outcome,
            feedback: criterion.feedback,
            sourceSegmentIds: [...criterion.sourceSegmentIds],
          })),
        }
      : {
          status: "failed",
          failedAt: status.failedAt,
          attempts: status.attempts,
          error: {
            code: status.failureCode,
            message: status.failure,
            retryable: status.retryable ?? false,
          },
        };
    const saved = await this.repository.applyAiReviewResolution(
      target.bankPath,
      {
        bankId: target.bankId,
        sessionId: target.sessionId,
        requestId: target.requestId,
        requestHash: target.requestHash,
        state,
      },
      target.expectedRevision,
    );
    if (this.activeBank?.path === target.bankPath && this.activeBank.bank.bankId === target.bankId) {
      this.activeBank.bank = saved;
    }
    if (status.state === "reviewed") {
      this.answerReviewTargets.delete(requestId);
    } else {
      this.answerReviewTargets.set(requestId, {
        ...target,
        expectedRevision: saved.revision,
      });
    }
    this.answerReviewQueue?.forget(requestId);
  }

  private async resumePendingAnswerReviews(): Promise<void> {
    const snapshot = await this.dashboardRepository.load();
    const bankIdCounts = new Map<string, number>();
    for (const record of snapshot.records) {
      bankIdCounts.set(record.bank.bankId, (bankIdCounts.get(record.bank.bankId) ?? 0) + 1);
    }
    const requestIdCounts = new Map<string, number>();
    for (const record of snapshot.records) {
      if (bankIdCounts.get(record.bank.bankId) !== 1) continue;
      for (const session of record.bank.sessions) {
        for (const result of session.results) {
          if (result.grading !== "ai-review" || result.state.status !== "pending") continue;
          requestIdCounts.set(
            result.request.requestId,
            (requestIdCounts.get(result.request.requestId) ?? 0) + 1,
          );
        }
      }
    }
    const collidingRequestIds = new Set<string>();
    for (const record of snapshot.records) {
      if (bankIdCounts.get(record.bank.bankId) !== 1) continue;
      for (const session of record.bank.sessions) {
        for (const result of session.results) {
          if (result.grading !== "ai-review" || result.state.status !== "pending") continue;
          if (requestIdCounts.get(result.request.requestId) !== 1) {
            collidingRequestIds.add(result.request.requestId);
            continue;
          }
          if (this.answerReviewRequests.has(result.request.requestId)) continue;
          const request = answerReviewRequestFromStored(result);
          this.answerReviewRequests.set(request.requestId, request);
          const status: AnswerReviewStatus = {
            requestId: request.requestId,
            sessionId: request.sessionId,
            exerciseId: request.exerciseId,
            state: "pending",
            queuedAt: result.state.queuedAt,
            attempts: result.state.attempts,
          };
          this.answerReviewStatusesById.set(request.requestId, status);
          this.answerReviewTargets.set(request.requestId, {
            bankPath: record.bankPath,
            bankId: record.bank.bankId,
            sessionId: session.id,
            requestId: result.request.requestId,
            requestHash: result.request.requestHash,
            expectedRevision: record.bank.revision,
          });
          this.enqueueAnswerReviewIfReady(request, result.state.attempts);
        }
      }
    }
    if (collidingRequestIds.size > 0) {
      new Notice(
        `Practice Problem Generator left ${collidingRequestIds.size} colliding AI review ${collidingRequestIds.size === 1 ? "ID" : "IDs"} pending. Repair the duplicated request IDs before resuming them.`,
        10_000,
      );
    }
  }

  private async ensureCliLayer(): Promise<CliProviderLayer> {
    if (Platform.isMobileApp) throw new Error("CLI providers are not available on mobile.");
    if (this.cliLayer) return this.cliLayer;
    if (this.cliLayerPromise !== undefined) return this.cliLayerPromise;
    const operation = import("./cli").then(({ createCliProviderLayer }) => {
      const layer = createCliProviderLayer({
        executables: {
          codex: this.settings.codexExecutable,
          claude: this.settings.claudeExecutable,
          agy: this.settings.agyExecutable
        }
      });
      this.cliLayer = layer;
      return layer;
    });
    this.cliLayerPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.cliLayerPromise === operation) this.cliLayerPromise = undefined;
    }
  }

  private async refreshProviders(force = false): Promise<void> {
    if (!force && this.providerRefreshPromise !== undefined) {
      await this.providerRefreshPromise;
      return;
    }
    const operation = this.performProviderRefresh();
    this.providerRefreshPromise = operation;
    try {
      await operation;
    } finally {
      if (this.providerRefreshPromise === operation) {
        this.providerRefreshPromise = undefined;
      }
    }
  }

  private async performProviderRefresh(): Promise<void> {
    const refreshEpoch = ++this.providerRefreshEpoch;
    if (Platform.isMobileApp) {
      this.providers = mobileProviderPresentations(this.settings);
      this.providersRefreshedAt = Date.now();
      return;
    }
    try {
      const layer = await this.ensureCliLayer();
      if (layer.coordinator.isBusy) {
        this.providers = desktopPendingProviderPresentations(
          this.settings,
          "Provider check is waiting for the active desktop AI job to finish.",
        );
        this.publishProvidersToOpenViews();
        if (!this.providerRefreshAfterIdle) {
          this.providerRefreshAfterIdle = true;
          void layer.coordinator.whenIdle().then(() => {
            this.providerRefreshAfterIdle = false;
            if (!this.unloading) void this.refreshProviders();
          });
        }
        return;
      }
      const detections = await layer.detectAll();
      if (refreshEpoch !== this.providerRefreshEpoch) return;
      this.providers = detections.map((detection) =>
        providerPresentation(detection, this.settings),
      );
      this.providersRefreshedAt = Date.now();
      this.publishProvidersToOpenViews();
      this.queueWaitingAnswerReviews();
    } catch (error) {
      if (refreshEpoch !== this.providerRefreshEpoch) return;
      this.providers = desktopPendingProviderPresentations(
        this.settings,
        error instanceof Error ? error.message : "Provider detection failed.",
      );
      this.providersRefreshedAt = Date.now();
      this.publishProvidersToOpenViews();
    }
  }

  private publishProvidersToOpenViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(PRACTICE_LAB_VIEW_TYPE)) {
      if (leaf.view instanceof PracticeLabView) leaf.view.setProviders(this.providers);
    }
    for (const leaf of this.app.workspace.getLeavesOfType(PRACTICE_LEARNING_PATH_VIEW_TYPE)) {
      if (leaf.view instanceof PracticeLearningPathView) {
        leaf.view.setProviders(this.providers);
      }
    }
  }

  private savedBankLeafHost(element: HTMLElement): Element {
    return element.closest(".workspace-leaf") ?? element;
  }

  private savedBankPage(element: HTMLElement, bankId: string): SavedBankPage {
    return this.savedBankPagesByLeaf
      .get(this.savedBankLeafHost(element))
      ?.get(bankId) ?? "practice";
  }

  private setSavedBankPage(
    element: HTMLElement,
    bankId: string,
    page: SavedBankPage,
  ): void {
    const host = this.savedBankLeafHost(element);
    let pages = this.savedBankPagesByLeaf.get(host);
    if (pages === undefined) {
      pages = new Map<string, SavedBankPage>();
      this.savedBankPagesByLeaf.set(host, pages);
    }
    pages.set(bankId, page);
  }

  private rerenderSavedBankPage(
    source: string,
    element: HTMLElement,
    context: MarkdownPostProcessorContext,
    bankId: string,
    page: SavedBankPage,
  ): void {
    this.setSavedBankPage(element, bankId, page);
    element.empty();
    void this.renderPracticeBlock(source, element, context)
      .then(() => {
        element.querySelector<HTMLButtonElement>(
          `[data-practice-lab-tab-id="${page}"]`,
        )?.focus();
      })
      .catch((error: unknown) => {
        console.error("Practice Problem Generator could not rerender a saved bank.", error);
        element.empty();
        this.renderReadOnlyBlock(
          element,
          `The interactive bank renderer failed safely: ${error instanceof Error ? error.message : String(error)}. The Markdown file remains available.`,
          source,
        );
      });
  }

  private async loadSavedBankRenderMetadata(
    context: MarkdownPostProcessorContext,
    bank: PracticeBankV4,
  ): Promise<SavedBankRenderMetadata> {
    let generationHistory: GenerationHistoryV1 | undefined;
    let generationHistoryWarning: string | undefined;
    let pdfSourceDetail: string | undefined;
    let pdfSourceWarning: string | undefined;
    let pdfSourceHistory: readonly string[] = [];
    const bankFile = this.app.vault.getAbstractFileByPath(context.sourcePath);
    if (!(bankFile instanceof TFile)) return { pdfSourceHistory };
    try {
      const bankMarkdown = await this.app.vault.cachedRead(bankFile);
      const historyResult = parseGenerationHistoryMarkdown(bankMarkdown);
      if (historyResult.status === "ok") {
        generationHistory = historyResult.history;
      } else if (historyResult.status === "invalid") {
        generationHistoryWarning = historyResult.message;
      }
      if (/\.pdf$/iu.test(bank.source.vaultPath)) {
        const sourceImport = parseSourceImportMarkdown(bankMarkdown);
        if (sourceImport.status === "ok") {
          const value = sourceImport.sourceImport;
          const range = value.firstPage === value.lastPage
            ? `page ${value.firstPage}`
            : `pages ${value.firstPage}–${value.lastPage}`;
          pdfSourceDetail = `PDF ${range} of ${value.pageCount} · extracted locally ${new Date(value.extractedAt).toLocaleString()}`;
          pdfSourceHistory = value.revisions.map((revision) => {
            const revisionRange = revision.firstPage === revision.lastPage
              ? `page ${revision.firstPage}`
              : `pages ${revision.firstPage}–${revision.lastPage}`;
            return `Revision ${revision.bankRevision} · ${revisionRange} of ${revision.pageCount} · ${new Date(revision.extractedAt).toLocaleString()} · ${revision.generationId}`;
          });
        } else {
          pdfSourceWarning = sourceImport.status === "missing"
            ? "PDF page-range provenance is missing; regeneration is unavailable."
            : sourceImport.message;
        }
      }
    } catch (error) {
      generationHistoryWarning = error instanceof Error
        ? `Practice Problem Generator could not read the generation ledger: ${error.message}`
        : "Practice Problem Generator could not read the generation ledger.";
    }
    return {
      ...(generationHistory === undefined ? {} : { generationHistory }),
      ...(generationHistoryWarning === undefined ? {} : { generationHistoryWarning }),
      ...(pdfSourceDetail === undefined ? {} : { pdfSourceDetail }),
      ...(pdfSourceWarning === undefined ? {} : { pdfSourceWarning }),
      pdfSourceHistory,
    };
  }

  private async renderPracticeBlock(
    source: string,
    element: HTMLElement,
    context: MarkdownPostProcessorContext,
  ): Promise<void> {
    element.addClass("practice-lab-bank-card", "practice-lab-saved-bank-shell");
    applyMarkdownHeadingTheme(element);
    const parsed = parsePracticeBankMarkdown(`\`\`\`practice-lab\n${source}\n\`\`\`\n`);
    if (parsed.status !== "ok") {
      this.renderReadOnlyBlock(element, parseFailure(parsed).message, source);
      return;
    }
    const bank = parsed.bank;
    const page = this.savedBankPage(element, bank.bankId);
    const metadata = page === "practice"
      ? { pdfSourceHistory: [] } satisfies SavedBankRenderMetadata
      : await this.loadSavedBankRenderMetadata(context, bank);
    const header = element.createEl("header", {
      cls: "practice-lab-saved-bank-header",
    });
    const title = header.createDiv({ cls: "practice-lab-saved-bank-title" });
    title.createEl("strong", { text: bank.source.title });
    title.createSpan({
      cls: "practice-lab-saved-bank-kind",
      text: bank.learningPath === null ? "Quick practice" : "Guided path",
    });
    const summary = header.createDiv({ cls: "practice-lab-saved-bank-summary" });
    summary.createSpan({
      text: `${bank.exercises.length} ${bank.exercises.length === 1 ? "question" : "questions"}`,
    });
    summary.createSpan({
      text: `${bank.sessions.length} completed ${bank.sessions.length === 1 ? "session" : "sessions"}`,
    });
    summary.createSpan({
      cls: `practice-lab-alignment-health ${alignmentHealthClass(bank)}`,
      text: alignmentHealthLabel(bank),
      attr: {
        title: alignmentHealthSummary(bank),
        "aria-label": alignmentHealthSummary(bank),
      },
    });
    if (parsed.storedSchemaVersion === 1) {
      header.createEl("p", {
        cls: "practice-lab-bank-migration-note",
        text: "Legacy bank loaded safely. It will migrate on the next authorized save.",
      });
    }
    renderHorizontalTabs<SavedBankPage>(element, {
      selected: page,
      ariaLabel: "Saved practice workspace",
      className: "practice-lab-saved-bank-tabs",
      tabs: [
        { id: "practice", label: "Practice" },
        { id: "progress", label: "Progress" },
        { id: "manage", label: "Manage" },
      ],
      onSelect: (selected) => {
        this.rerenderSavedBankPage(
          source,
          element,
          context,
          bank.bankId,
          selected,
        );
      },
      renderPanel: (panel, selected) => {
        if (selected === "practice") {
          this.renderSavedBankPracticePage(panel, context.sourcePath, bank);
        } else if (selected === "progress") {
          this.renderSavedBankProgressPage(panel, context.sourcePath, bank, metadata);
        } else {
          this.renderSavedBankManagePage(
            panel,
            source,
            context.sourcePath,
            bank,
            metadata,
          );
        }
      },
    });
  }

  private renderSavedBankPracticePage(
    panel: HTMLElement,
    bankPath: string,
    bank: PracticeBankV4,
  ): void {
    panel.addClass("practice-lab-saved-bank-practice");
    const savedSession = this.studyCheckpoint;
    const hasUnreadableSession = this.invalidStudyCheckpointRaw !== undefined;
    const savedSessionMatchesBank = savedSession?.bankId === bank.bankId;
    let recommendation: ReturnType<typeof recommendNextLearningStep> = null;
    if (bank.learningPath !== null) {
      recommendation = recommendNextLearningStep(bank, deriveLearningAnalytics(bank));
    }
    const next = panel.createEl("section", {
      cls: "practice-lab-saved-bank-next-action",
      attr: { "aria-label": "Next practice action" },
    });
    if (savedSessionMatchesBank && savedSession !== undefined) {
      next.createEl("h3", { text: "Resume where you stopped" });
      next.createEl("p", {
        text: `Question ${Math.min(savedSession.currentQuestionIndex + 1, savedSession.exercises.length)} of ${savedSession.exercises.length}. Your exact input, revealed tutor help, skips, and answer state are saved on this device.`,
      });
    } else if (savedSession !== undefined || hasUnreadableSession) {
      next.createEl("h3", { text: "Resolve the saved session" });
      next.createEl("p", {
        text: "Another saved session must be resolved before starting this bank. Nothing is discarded without explicit confirmation.",
      });
    } else if (bank.learningPath !== null && recommendation !== null) {
      const steps = [...bank.learningPath.steps].sort((left, right) => left.order - right.order);
      const stepIndex = steps.findIndex((step) => (
        recommendation?.kind === "lesson"
          ? step.kind === "lesson" && step.lessonId === recommendation.id
          : step.kind === "practice-set" && step.setId === recommendation?.id
      ));
      next.createEl("h3", { text: recommendation.title });
      next.createEl("p", {
        text: `Recommended next · Step ${Math.max(0, stepIndex) + 1} of ${steps.length}. ${recommendation.reasons.join(" ")}`,
      });
    } else if (bank.learningPath !== null) {
      next.createEl("h3", { text: "Keep the knowledge connected" });
      next.createEl("p", {
        text: "Your guided objectives currently have consistent evidence. A mixed review keeps every set freely accessible without adding a schedule.",
      });
    } else {
      next.createEl("h3", { text: "Practice this source" });
      next.createEl("p", {
        text: `Work through ${bank.exercises.length} source-grounded ${bank.exercises.length === 1 ? "question" : "questions"}. You can choose the order before the run begins.`,
      });
    }
    next.createEl("p", {
      cls: `practice-lab-alignment-health ${alignmentHealthClass(bank)}`,
      text: alignmentHealthSummary(bank),
      attr: { role: "status" },
    });
    const primaryLabel = savedSessionMatchesBank
      ? "Resume session"
      : savedSession !== undefined || hasUnreadableSession
        ? "Resolve saved session…"
        : bank.learningPath !== null
          ? recommendation === null ? "Start mixed review" : "Continue learning"
          : "Start practice";
    const primary = next.createEl("button", {
      cls: "mod-cta practice-lab-saved-bank-primary-action",
      text: primaryLabel,
      attr: { type: "button" },
    });
    primary.addEventListener("click", () => {
      const selection: BankStudySelection = bank.learningPath === null
        ? { kind: "quick" }
        : { kind: "recommended" };
      void this.startBankStudy(bankPath, bank, selection);
    });
    if (savedSession !== undefined || hasUnreadableSession) return;
    if (bank.learningPath === null) return;
    const alternatives = panel.createEl("details", {
      cls: "practice-lab-bank-secondary-actions",
    });
    alternatives.createEl("summary", { text: "Choose another session…" });
    const alternateActions = alternatives.createDiv({
      cls: "practice-lab-bank-tools-body",
    });
    const addAlternate = (
      label: string,
      description: string,
      action: () => void,
    ): void => {
      const row = alternateActions.createDiv({ cls: "practice-lab-bank-alternate-action" });
      const button = row.createEl("button", {
        text: label,
        attr: { type: "button", title: description },
      });
      button.addEventListener("click", action);
      row.createSpan({ text: description });
    };
    addAlternate(
      "Choose a set",
      "Pick one named set and choose its question order.",
      () => { void this.chooseAndStartPracticeSet(bankPath, bank); },
    );
    addAlternate(
      "Mixed practice",
      "Combine every named set while retaining set and aspect evidence.",
      () => { void this.startBankStudy(bankPath, bank, { kind: "mixed" }); },
    );
    addAlternate(
      "Free practice",
      "Use every saved question without tutor sequencing.",
      () => { void this.startBankStudy(bankPath, bank); },
    );
  }

  private renderSavedBankProgressPage(
    panel: HTMLElement,
    bankPath: string,
    bank: PracticeBankV4,
    metadata: SavedBankRenderMetadata,
  ): void {
    panel.addClass("practice-lab-saved-bank-progress");
    const heading = panel.createDiv({ cls: "practice-lab-saved-bank-panel-heading" });
    heading.createEl("h3", { text: "Your progress" });
    heading.createEl("p", {
      text: bank.learningPath === null
        ? "Completed independent practice is summarized first. Open only the detail you need."
        : `${bank.learningPath.steps.length} guided steps · ${bank.practiceSets.length} sets · ${bank.tutorLessons.length} tutor lessons. Guided help remains separate from independent performance.`,
    });
    const dashboard = heading.createEl("button", {
      text: "Open full dashboard",
      attr: {
        type: "button",
        title: "Open cross-bank performance, learning evidence, and activity.",
      },
    });
    dashboard.addEventListener("click", () => {
      void this.openDashboard({ kind: "source", path: bank.source.vaultPath });
    });
    renderBankStatistics(panel, bank, Platform.isMobileApp ? {
      visibility: this.settings.display.bank,
      compactOverview: true,
      sessionPageSize: 5,
      ...(metadata.generationHistory === undefined
        ? {}
        : { generationHistory: metadata.generationHistory }),
      ...(metadata.generationHistoryWarning === undefined
        ? {}
        : { generationHistoryWarning: metadata.generationHistoryWarning }),
      removeSession: async (sessionId) => {
        await this.requestRemovePracticeSession(bankPath, bank, sessionId);
      },
    } : {
      visibility: this.settings.display.bank,
      compactOverview: true,
      sessionPageSize: 5,
      ...(metadata.generationHistory === undefined
        ? {}
        : { generationHistory: metadata.generationHistory }),
      ...(metadata.generationHistoryWarning === undefined
        ? {}
        : { generationHistoryWarning: metadata.generationHistoryWarning }),
      retryAnswerReview: async (target) => {
        await this.retryPersistedAnswerReview(bankPath, target);
      },
      pauseAnswerReview: (requestId) => {
        this.pauseAnswerReview(requestId);
      },
      removeSession: async (sessionId) => {
        await this.requestRemovePracticeSession(bankPath, bank, sessionId);
      },
    });
  }

  private renderSavedBankManagePage(
    panel: HTMLElement,
    rawBankJson: string,
    bankPath: string,
    bank: PracticeBankV4,
    metadata: SavedBankRenderMetadata,
  ): void {
    panel.addClass("practice-lab-saved-bank-manage");
    const heading = panel.createDiv({ cls: "practice-lab-saved-bank-panel-heading" });
    heading.createEl("h3", { text: "Manage this practice" });
    heading.createEl("p", {
      text: "Source, generation, and data controls stay separate from everyday practice.",
    });
    const commonActions = panel.createDiv({ cls: "practice-lab-bank-tools-body" });
    const openSource = commonActions.createEl("button", {
      text: "Open source",
      attr: { type: "button", title: "Open the primary note or PDF used by this bank." },
    });
    openSource.addEventListener("click", () => {
      void this.app.workspace.openLinkText(bank.source.vaultPath, bankPath, true);
    });
    const dashboard = commonActions.createEl("button", {
      text: "View dashboard",
      attr: { type: "button", title: "Open this source in the full practice dashboard." },
    });
    dashboard.addEventListener("click", () => {
      void this.openDashboard({ kind: "source", path: bank.source.vaultPath });
    });
    if (Platform.isMobileApp) {
      panel.createEl("p", {
        cls: "practice-lab-bank-migration-note",
        text: "Generation and path editing require desktop. Studying, recovery, statistics, and saved data remain available on this device.",
      });
    } else if (bank.learningPath === null) {
      const regenerate = commonActions.createEl("button", {
        text: "Regenerate / tweak",
        attr: {
          type: "button",
          title: "Open creation with this bank's previous generation settings loaded.",
        },
      });
      regenerate.addEventListener("click", () => {
        void this.regenerateBank(bankPath, bank).catch((error: unknown) => {
          this.showError(error);
        });
      });
    } else {
      const manage = commonActions.createEl("button", {
        text: "Manage path",
        attr: {
          type: "button",
          title: "Rename, inspect, or regenerate individual sets without replacing sibling sets or history.",
        },
      });
      manage.addEventListener("click", () => {
        void this.openSavedLearningPathManager(bankPath, bank);
      });
    }
    if (metadata.pdfSourceWarning !== undefined) {
      panel.createEl("p", {
        cls: "practice-lab-bank-warning",
        text: metadata.pdfSourceWarning,
        attr: { role: "alert" },
      });
    }
    const sourceDetails = panel.createEl("details", {
      cls: "practice-lab-saved-bank-source-details",
    });
    sourceDetails.createEl("summary", { text: "Source details" });
    sourceDetails.createEl("p", {
      text: `Primary source: ${bank.source.title} · ${bank.source.scope}`,
    });
    if (metadata.pdfSourceDetail !== undefined) {
      sourceDetails.createEl("p", { text: metadata.pdfSourceDetail });
    }
    const sourceList = sourceDetails.createEl("ul");
    for (const material of bank.sourceMaterials) {
      sourceList.createEl("li", {
        text: `${material.role === "primary" ? "Primary" : "Supporting"} · ${material.title} · ${sourceClassificationLabel(material.classification)} · ${sourceMaterialScopeLabel(material.scope)}`,
      });
    }
    sourceDetails.createEl("p", {
      cls: `practice-lab-alignment-health ${alignmentHealthClass(bank)}`,
      text: alignmentHealthSummary(bank),
    });
    if (metadata.pdfSourceHistory.length > 0) {
      const revisions = sourceDetails.createEl("details", {
        cls: "practice-lab-pdf-source-history",
      });
      revisions.createEl("summary", {
        text: `PDF source history (${metadata.pdfSourceHistory.length})`,
      });
      const list = revisions.createEl("ol");
      for (const entry of metadata.pdfSourceHistory) list.createEl("li", { text: entry });
    }
    const technical = panel.createEl("details", {
      cls: "practice-lab-saved-bank-technical-details",
    });
    technical.createEl("summary", { text: "Technical details" });
    technical.createEl("p", {
      text: `Bank ${bank.bankId} · Schema ${bank.schemaVersion} · Revision ${bank.revision} · Updated ${new Date(bank.updatedAt).toLocaleString()}`,
    });
    const showRaw = technical.createEl("button", {
      text: "Show raw bank data",
      attr: {
        type: "button",
        title: "Reveal the portable JSON stored in this bank's practice-lab fenced block.",
        "aria-expanded": "false",
      },
    });
    showRaw.addEventListener("click", () => {
      const existing = technical.querySelector<HTMLElement>(".practice-lab-raw-bank-data");
      if (existing !== null) {
        existing.remove();
        showRaw.setText("Show raw bank data");
        showRaw.setAttribute("aria-expanded", "false");
        return;
      }
      technical.createEl("pre", {
        cls: "practice-lab-raw-bank-data",
        text: rawBankJson,
      });
      showRaw.setText("Hide raw bank data");
      showRaw.setAttribute("aria-expanded", "true");
    });
    const danger = panel.createEl("details", {
      cls: "practice-lab-bank-data-actions practice-lab-danger-zone",
    });
    danger.createEl("summary", { text: "Danger zone" });
    danger.createEl("p", {
      text: "These actions always show a detailed warning and require a typed confirmation.",
    });
    const dataButtons = danger.createDiv({ cls: "practice-lab-destructive-actions" });
    const clearHistory = dataButtons.createEl("button", {
      text: "Clear bank history…",
      cls: "mod-warning",
      attr: { type: "button" },
    });
    clearHistory.disabled = bank.sessions.length === 0;
    clearHistory.addEventListener("click", () => {
      void this.requestClearPracticeBankHistory(bankPath, bank).catch((error: unknown) => {
        this.showError(error);
      });
    });
    const deleteBank = dataButtons.createEl("button", {
      text: "Move bank to trash…",
      cls: "mod-warning",
      attr: { type: "button" },
    });
    deleteBank.addEventListener("click", () => {
      void this.requestDeletePracticeBank(bankPath, bank).catch((error: unknown) => {
        this.showError(error);
      });
    });
  }

  private renderReadOnlyBlock(element: HTMLElement, message: string, source: string): void {
    element.addClass("is-read-only");
    element.createEl("strong", { text: "Practice Problem Generator bank is read-only" });
    element.createEl("p", { text: message });
    const details = element.createEl("details");
    details.createEl("summary", { text: "Recovery JSON" });
    details.createEl("pre", { text: source });
  }

  private activeMarkdownFile(): TFile | null {
    const file = this.app.workspace.getActiveFile();
    return file instanceof TFile && file.extension.toLowerCase() === "md" ? file : null;
  }

  private activePdfFile(): TFile | null {
    const file = this.app.workspace.getActiveFile();
    return file instanceof TFile && file.extension.toLowerCase() === "pdf" ? file : null;
  }

  private showError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    new Notice(`Practice Problem Generator: ${message}`, 10_000);
  }
}

function providerPresentation(
  detection: ProviderDetection,
  settings: PracticeLabSettings,
): ProviderPresentation {
  return {
    id: detection.id,
    label: detection.id === "codex" ? "Codex" : detection.id === "claude" ? "Claude" : "agy",
    available: detection.available,
    executionMode: detection.available ? "execute-now" : "unavailable",
    supportsVision: detection.capabilities.vision === "supported",
    reasoningEfforts: [...detection.capabilities.reasoningEfforts],
    models: detection.models.map((model) => ({
      ...model,
      ...(model.supportedReasoningEfforts === undefined
        ? {}
        : { supportedReasoningEfforts: [...model.supportedReasoningEfforts] }),
    })),
    defaultModel: modelForProvider(settings, detection.id),
    ...(detection.version === undefined ? {} : { version: detection.version }),
    ...(detection.detail === undefined ? {} : { detail: detection.detail }),
    ...(detection.modelCatalogDetail === undefined
      ? {}
      : { modelCatalogDetail: detection.modelCatalogDetail }),
  };
}

function modelForProvider(
  settings: PracticeLabSettings,
  provider: ProviderPresentation["id"],
): string {
  if (provider === "claude") return settings.claudeModel;
  return provider === "agy" ? settings.agyModel : settings.codexModel;
}

function storedGenerationRecoveryHandle(
  value: unknown,
): DurableProcessHandle | undefined {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || !(GENERATION_RECOVERY_DATA_KEY in value)
  ) return undefined;
  const candidate = (value as Record<string, unknown>)[GENERATION_RECOVERY_DATA_KEY];
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return undefined;
  }
  const record = candidate as Record<string, unknown>;
  if (
    record.version !== 1
    || typeof record.jobId !== "string"
    || !/^generation-[a-f0-9-]{36}$/u.test(record.jobId)
    || typeof record.workspacePath !== "string"
    || record.workspacePath.length === 0
    || typeof record.startedAt !== "string"
    || !Number.isFinite(Date.parse(record.startedAt))
  ) return undefined;
  return {
    version: 1,
    jobId: record.jobId,
    workspacePath: record.workspacePath,
    startedAt: record.startedAt,
  };
}

function storedLearningBatchRecoveryHandle(
  value: unknown,
): DurableProcessHandle | undefined {
  const candidate = storedDataValue(value, LEARNING_BATCH_RECOVERY_DATA_KEY);
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return undefined;
  }
  const record = candidate as Record<string, unknown>;
  if (
    record.version !== 1
    || typeof record.jobId !== "string"
    || !/^learning-set-[a-f0-9-]{36}$/u.test(record.jobId)
    || typeof record.workspacePath !== "string"
    || record.workspacePath.length === 0
    || typeof record.startedAt !== "string"
    || !Number.isFinite(Date.parse(record.startedAt))
  ) return undefined;
  return {
    version: 1,
    jobId: record.jobId,
    workspacePath: record.workspacePath,
    startedAt: record.startedAt,
  };
}

function storedDataValue(value: unknown, key: string): unknown {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function recoveredDetectedVisual(
  visual: VisualSourceV1,
  index: number,
  previewUrl: string,
): DetectedVisual {
  return {
    id: visual.id,
    kind: visual.kind === "remote-snapshot" ? "remote-image" : "static-image",
    state: "ready",
    start: index,
    end: index + 1,
    selected: true,
    ...(visual.sourceEmbed === undefined ? {} : { sourceTarget: visual.sourceEmbed }),
    resolvedPath: visual.vaultPath,
    previewUrl,
    mimeType: visual.mimeType,
    ...(visual.remoteHost === undefined ? {} : { remoteHost: visual.remoteHost }),
    ...(visual.frameTimeSeconds === undefined
      ? {}
      : { frameTimeSeconds: visual.frameTimeSeconds }),
    ...(visual.framePosition === undefined
      ? {}
      : { framePosition: visual.framePosition }),
    reason: "Recovered from the exact approved generation payload",
  };
}

function alignmentHealthSummary(bank: PracticeBankV4): string {
  const records = bank.sourceAlignment.records.filter((record) => (
    record.resolution !== "excluded"
  ));
  if (records.length === 0) {
    return effectiveAiContextCompletionPolicy(bank.aiContextCompletionPolicy)
      === "approved-general-context"
      ? "AI-supported context approved · not course-checked. No confirmed school comparison is available for this workspace."
      : "Selected material · not course-checked. Add and confirm school material in a guided path when you want a course comparison.";
  }
  const schoolDisagreements = sourceAlignmentBlockers(bank.sourceAlignment).length;
  if (schoolDisagreements > 0) {
    return `School sources disagree in ${schoolDisagreements} ${schoolDisagreements === 1 ? "claim" : "claims"}. Those disputed topics cannot ground practice until you resolve or exclude them; other evidence areas remain available.`;
  }
  const manualOverrides = records.filter((record) => record.resolution === "manual-override").length;
  if (manualOverrides > 0) {
    return `${manualOverrides} manual alignment ${manualOverrides === 1 ? "override" : "overrides"}. This workspace is source-grounded but is not labelled course-aligned.`;
  }
  const differences = records.filter((record) => record.status === "conflict").length;
  const incomplete = records.filter((record) => record.status === "notes-incomplete").length;
  const supplemental = records.filter((record) => (
    record.status === "notes-only-unverified"
    || record.status === "insufficient-evidence"
  )).length;
  if (differences > 0 || incomplete > 0 || supplemental > 0) {
    const parts = [
      differences === 0 ? null : `${differences} note-school ${differences === 1 ? "difference" : "differences"}`,
      incomplete === 0 ? null : `${incomplete} school-backed context ${incomplete === 1 ? "addition" : "additions"}`,
      supplemental === 0 ? null : effectiveAiContextCompletionPolicy(
        bank.aiContextCompletionPolicy,
      ) === "approved-general-context"
        ? `${supplemental} AI-supported ${supplemental === 1 ? "area" : "areas"} not course-checked`
        : `${supplemental} ${supplemental === 1 ? "area uses" : "areas use"} selected material only`,
    ].filter((entry): entry is string => entry !== null);
    return `Source-led course check · ${parts.join(" · ")}. School-supported interpretations take priority; any approved AI-supported context is disclosed after each answer and never changes scores.`;
  }
  return "Course alignment checked. Comparisons stay hidden until after each answer and never affect scores.";
}

function alignmentHealthLabel(bank: PracticeBankV4): string {
  const records = bank.sourceAlignment.records.filter((record) => (
    record.resolution !== "excluded"
  ));
  if (records.length === 0) return "Not course-checked";
  if (sourceAlignmentBlockers(bank.sourceAlignment).length > 0) return "Alignment needs attention";
  if (records.some((record) => record.resolution === "manual-override")) {
    return "Source-grounded override";
  }
  if (records.some((record) => (
    record.status === "notes-only-unverified"
    || record.status === "insufficient-evidence"
  ))) {
    return effectiveAiContextCompletionPolicy(bank.aiContextCompletionPolicy)
      === "approved-general-context"
      ? "Source-led · AI-supported context"
      : "Selected material only";
  }
  if (records.some((record) => record.status === "conflict")) {
    return "Course-checked · notes differ";
  }
  if (records.some((record) => record.status === "notes-incomplete")) {
    return "School material adds context";
  }
  return "Course-aligned";
}

function sourceClassificationLabel(
  classification: PracticeBankV4["sourceMaterials"][number]["classification"],
): string {
  if (classification === "personal-note") return "Personal note";
  if (classification === "official-correction") return "Official correction";
  if (classification === "instructor-material") return "Instructor material";
  if (classification === "assigned-reference") return "Assigned reference";
  return "Unclassified";
}

function sourceMaterialScopeLabel(
  scope: PracticeBankV4["sourceMaterials"][number]["scope"],
): string {
  if (scope.kind === "note") return "Complete note";
  if (scope.kind === "selection") return "Note selection";
  return scope.firstPage === scope.lastPage
    ? `PDF page ${scope.firstPage}`
    : `PDF pages ${scope.firstPage}–${scope.lastPage}`;
}

function alignmentHealthClass(bank: PracticeBankV4): string {
  const records = bank.sourceAlignment.records.filter((record) => record.resolution !== "excluded");
  if (records.length === 0) return "is-unverified";
  if (sourceAlignmentBlockers(bank.sourceAlignment).length > 0) return "is-blocked";
  if (records.some((record) => (
    record.status === "notes-only-unverified"
    || record.status === "insufficient-evidence"
  ))) return "is-unverified";
  if (records.some((record) => (
    record.status === "conflict"
    || record.status === "notes-incomplete"
    || record.resolution === "manual-override"
  ))) return "is-attention";
  return "is-aligned";
}

function configurationDefaults(
  configuration: GenerationConfiguration,
): Parameters<PracticeLabView["setConfigurationDefaults"]>[0] {
  return {
    provider: configuration.provider,
    model: configuration.model,
    reasoningEffort: configuration.reasoningEffort,
    focusInstructions: configuration.focusInstructions,
    quantity: configuration.quantity,
    difficulty: configuration.difficulty,
    exerciseTypes: configuration.exerciseTypes,
    exerciseTypePercentages: { ...configuration.exerciseTypePercentages },
    ...(configuration.aiContextCompletionPolicy === undefined
      ? {}
      : { aiContextCompletionPolicy: configuration.aiContextCompletionPolicy }),
  };
}

function cliErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function nodeErrorCode(error: unknown): string | undefined {
  return cliErrorCode(error);
}

function sameConfiguration(left: GenerationConfiguration, right: GenerationConfiguration): boolean {
  return JSON.stringify({
    ...left,
    exerciseTypes: [...left.exerciseTypes].sort(),
    exerciseTypePercentages: Object.entries(left.exerciseTypePercentages).sort(),
    selectedVisualIds: [...left.selectedVisualIds].sort()
  }) === JSON.stringify({
    ...right,
    exerciseTypes: [...right.exerciseTypes].sort(),
    exerciseTypePercentages: Object.entries(right.exerciseTypePercentages).sort(),
    selectedVisualIds: [...right.selectedVisualIds].sort()
  });
}

function neutralFilename(index: number, mime: string): string {
  const extension = mime === "image/jpeg" ? "jpg" : mime.split("/")[1] ?? "bin";
  return `media-${String(index + 1).padStart(3, "0")}.${extension}`;
}

function displayVisualName(visual: DetectedVisual): string {
  if (visual.kind === "remote-image") return visual.remoteHost ?? visual.id;
  if (visual.kind === "notability-region") {
    return `${visual.region?.title ?? "Notability region"}${visual.region?.page === undefined ? "" : `, page ${visual.region.page}`}`;
  }
  return visual.sourceTarget ?? visual.id;
}

function sourcePresentationFromBank(bank: PracticeBankV2): SourcePresentation {
  const pdfSource = /\.pdf$/iu.test(bank.source.vaultPath);
  return {
    mode: pdfSource ? "pdf" : bank.source.scope,
    title: bank.source.title,
    path: bank.source.vaultPath,
    characterCount: bank.segments.reduce((total, segment) => total + segment.text.length, 0),
    excerpt: "Saved Practice Problem Generator bank",
    ...(pdfSource ? { detail: "Saved PDF page-range source" } : {}),
    visuals: []
  };
}

function learningPathReference(
  bank: PracticeBankV4,
): { readonly id: string; readonly title: string } {
  if (bank.learningPath === null) {
    throw new Error("The selected tutor step is not attached to a learning path.");
  }
  return { id: bank.learningPath.id, title: bank.learningPath.title };
}

function isRuntimeCollectedSource(
  source: SourcePresentation,
): source is SourcePresentation & CollectedSource {
  const candidate = source as SourcePresentation & Partial<CollectedSource>;
  return typeof candidate.submittedText === "string"
    && typeof candidate.hash === "string"
    && Array.isArray(candidate.segments)
    && candidate.file instanceof TFile;
}

function studyProgressFromCheckpoint(
  checkpoint: StudySessionCheckpointV1,
): StudySessionProgressV1 {
  return {
    bankPath: checkpoint.bankPath,
    bankId: checkpoint.bankId,
    bankRevisionAtStart: checkpoint.bankRevisionAtStart,
    exerciseCountAtStart: checkpoint.exerciseCountAtStart,
    sessionId: checkpoint.sessionId,
    startedAt: checkpoint.startedAt,
    orderedExerciseIds: checkpoint.exercises.map((exercise) => exercise.id),
    currentQuestionIndex: checkpoint.currentQuestionIndex,
    answers: structuredClone(checkpoint.answers),
    skippedExerciseIds: [...(checkpoint.skippedExerciseIds ?? [])],
    currentInput: structuredClone(checkpoint.currentInput),
    alignmentSnapshots: checkpoint.alignmentSnapshots?.map((entry) =>
      structuredClone(entry)
    ) ?? [],
    answerReviewMode: checkpoint.answerReviewMode,
    answerReviewProvider: checkpoint.answerReviewProvider,
    answerReviewReasoningEffort: checkpoint.answerReviewReasoningEffort,
    ...(checkpoint.learningProgress === undefined
      ? {}
      : { learningProgress: structuredClone(checkpoint.learningProgress) }),
  };
}

function answerReviewRequestFromStored(
  result: AiReviewSessionItemResultV2,
): AnswerReviewRequest {
  return {
    requestId: result.request.requestId,
    sessionId: result.request.sessionId,
    exerciseId: result.request.exerciseId,
    exerciseTitle: result.request.context.exerciseTitle,
    exerciseType: result.request.context.exerciseType,
    prompt: result.request.context.prompt,
    submittedAnswer: result.request.submittedAnswer,
    groundedAnswer: result.request.context.groundedAnswer,
    keyPoints: [...result.request.context.keyPoints],
    sourceSegmentIds: result.request.context.sourceSegments.map((segment) => segment.id),
    sourceSegments: result.request.context.sourceSegments.map((segment) => ({
      id: segment.id,
      headingPath: [...segment.headingPath],
      text: segment.text,
    })),
    provider: result.request.provider,
    reasoningEffort: result.request.reasoningEffort,
    requestedAt: result.request.requestedAt,
  };
}

function answerReviewStatusFromStored(
  result: AiReviewSessionItemResultV2,
): AnswerReviewStatus {
  const base = {
    requestId: result.request.requestId,
    sessionId: result.request.sessionId,
    exerciseId: result.request.exerciseId,
  };
  if (result.state.status === "pending") {
    return {
      ...base,
      state: "pending",
      queuedAt: result.state.queuedAt,
      attempts: result.state.attempts,
    };
  }
  if (result.state.status === "reviewed") {
    return {
      ...base,
      state: "reviewed",
      reviewedAt: result.state.reviewedAt,
      attempts: result.state.attempts,
      verdict: result.state.verdict,
      feedback: result.state.feedback,
      criterionResults: result.state.criteria.map((criterion) => ({
        criterion: criterion.criterion,
        outcome: criterion.outcome,
        feedback: criterion.feedback,
        sourceSegmentIds: [...criterion.sourceSegmentIds],
      })),
    };
  }
  return {
    ...base,
    state: "failed",
    failedAt: result.state.failedAt,
    attempts: result.state.attempts,
    failureCode: result.state.error.code,
    failure: result.state.error.message,
    retryable: result.state.error.retryable,
  };
}

function findStoredAnswerReview(
  bank: PracticeBankV2,
  sessionId: string,
  requestId: string,
): AiReviewSessionItemResultV2 | undefined {
  const session = bank.sessions.find((candidate) => candidate.id === sessionId);
  const result = session?.results.find((candidate) =>
    candidate.grading === "ai-review"
    && candidate.request.requestId === requestId,
  );
  return result?.grading === "ai-review" ? result : undefined;
}

function parseFailure(parsed: ReturnType<typeof parsePracticeBankMarkdown>): Error {
  if (parsed.status === "ok") return new Error("Unexpected Practice Problem Generator parsing state.");
  if (parsed.status === "invalid") return new Error(`${parsed.errors.join("; ")} ${parsed.recoveryMessage}`);
  if (parsed.status === "unsupported-version") {
    return new Error(`Unsupported Practice Problem Generator schema version ${String(parsed.schemaVersion)}. ${parsed.recoveryMessage}`);
  }
  return new Error(parsed.recoveryMessage);
}

async function ensureVaultParentFolder(app: App, filePath: string): Promise<void> {
  const parts = normalizePath(filePath).split("/").slice(0, -1);
  let current = "";
  for (const part of parts) {
    current = current.length === 0 ? part : `${current}/${part}`;
    const existing = app.vault.getAbstractFileByPath(current);
    if (existing instanceof TFolder) continue;
    if (existing !== null) {
      throw new Error(`Cannot create backup folder because ${current} is a file.`);
    }
    await app.vault.createFolder(current);
  }
}
