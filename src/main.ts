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
  type MarkdownPostProcessorContext
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
import { PracticeBankRepository, createSessionSummary } from "./bank-repository";
import { renderBankStatistics } from "./bank-statistics-view";
import type { CliProviderLayer, ProviderDetection } from "./cli";
import type { DashboardBankRecord, DashboardScope } from "./dashboard-model";
import { PracticeDashboardRepository } from "./dashboard-repository";
import {
  GENERATION_PROMPT_VERSION,
  asGenerationDraft,
  buildGenerationPrompt,
  validateGeneratedDraft
} from "./generation";
import {
  parseGenerationHistoryMarkdown,
  type GenerationHistoryV1,
} from "./generation-history";
import type {
  AiReviewSessionItemResultV2,
  PracticeBankV2,
  GenerationDraftV1,
  SessionSummaryV2,
} from "./model";
import {
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
import { displayReasoningEffort } from "./reasoning";
import { displayModelSelection } from "./model-selection";
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
  collectPdfSource,
  type CollectedSource,
  type RegenerationSourceResult,
} from "./source";
import { parseSourceImportMarkdown } from "./source-import";
import {
  PRACTICE_DASHBOARD_VIEW_TYPE,
  PRACTICE_LAB_VIEW_TYPE,
  PracticeDashboardView,
  PracticeLabView,
  applyDraftEdits,
  presentExercises,
  type DraftExercisePresentation,
  type AnswerReviewRequest,
  type AnswerReviewStatus,
  type EditableDraftExercise,
  type GenerationConfiguration,
  type PayloadPreview,
  type PersistedAnswerReviewRetryTarget,
  type PracticeDashboardViewOptions,
  type PracticeLabViewOptions,
  type ProviderPresentation,
  type MarkdownSourceMode,
  type SourcePresentation
} from "./ui";
import { confirmDestructiveAction } from "./ui/destructive-confirmation-modal";
import { choosePdfPageRange } from "./ui/pdf-page-range-modal";
import { showPdfExtractionProgress } from "./ui/pdf-extraction-progress-modal";
import {
  chooseVisualFrame,
  importRemoteVisual,
  prepareSelectedVisuals,
  type PreparedVisual
} from "./visual-preparation";
import type { DetectedVisual } from "./visuals";

interface PendingGeneration {
  readonly source: CollectedSource;
  readonly configuration: GenerationConfiguration;
  readonly prompt: string;
  readonly preparedVisuals: readonly PreparedVisual[];
  draft?: GenerationDraftV1;
  jobId?: string;
  attempts?: 1 | 2;
}

interface ActiveBank {
  readonly path: string;
  bank: PracticeBankV2;
}

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

const MOBILE_PROVIDERS: readonly ProviderPresentation[] = [
  { id: "codex", label: "Codex", available: false, supportsVision: false, reasoningEfforts: [], defaultModel: "", detail: "Generation is desktop-only." },
  { id: "claude", label: "Claude", available: false, supportsVision: false, reasoningEfforts: [], defaultModel: "", detail: "Generation is desktop-only." },
  { id: "agy", label: "agy", available: false, supportsVision: false, reasoningEfforts: [], defaultModel: "", detail: "Generation is desktop-only." }
];

export default class PracticeLabPlugin extends Plugin {
  settings: PracticeLabSettings = {
    ...DEFAULT_SETTINGS,
    exerciseTypePercentages: { ...DEFAULT_SETTINGS.exerciseTypePercentages },
    display: copyDisplayPreferences(DEFAULT_SETTINGS.display),
  };
  private repository!: PracticeBankRepository;
  private dashboardRepository!: PracticeDashboardRepository;
  private cliLayer: CliProviderLayer | undefined;
  private providers: readonly ProviderPresentation[] = MOBILE_PROVIDERS;
  private providerRefreshEpoch = 0;
  private providerRefreshPromise: Promise<void> | undefined;
  private providersRefreshedAt = 0;
  private providerRefreshAfterIdle = false;
  private unloading = false;
  private pendingGeneration?: PendingGeneration;
  private activeBank?: ActiveBank;
  private lastSource?: CollectedSource;
  private dashboardRefreshTimer: number | undefined;
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

  override async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    this.repository = new PracticeBankRepository(this.app);
    this.dashboardRepository = new PracticeDashboardRepository(this.app, {
      hasPracticeBankMarker: (file) =>
        this.app.metadataCache.getFileCache(file)?.frontmatter?.["practice-lab"] === true,
      sourceTags: (file) => {
        const cache = this.app.metadataCache.getFileCache(file);
        return cache === null ? [] : getAllTags(cache) ?? [];
      }
    });

    this.registerView(PRACTICE_LAB_VIEW_TYPE, (leaf) => new PracticeLabView(leaf, this.createViewOptions()));
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
    this.registerMarkdownCodeBlockProcessor("practice-lab", async (source, element, context) => {
      await this.renderPracticeBlock(source, element, context);
    });
    this.addSettingTab(new PracticeLabSettingTab(this.app, this));

    if (!Platform.isMobileApp) void this.initializeDesktopAnswerReviews();
  }

  override onunload(): void {
    this.unloading = true;
    this.answerReviewQueueUnsubscribe?.();
    this.answerReviewQueueUnsubscribe = undefined;
    void this.answerReviewQueue?.shutdown();
    this.cliLayer?.coordinator.cancel();
    this.clearAnswerReviewPersistenceRetryTimer();
    this.clearDashboardRefreshTimer();
  }

  async saveSettings(
    options: { readonly refreshProviders?: boolean } = {},
  ): Promise<void> {
    await this.saveData(this.settings);
    for (const leaf of this.app.workspace.getLeavesOfType(PRACTICE_LAB_VIEW_TYPE)) {
      if (leaf.view instanceof PracticeLabView) {
        leaf.view.setDisplayPreferences(this.settings.display);
      }
    }
    for (const leaf of this.app.workspace.getLeavesOfType(PRACTICE_DASHBOARD_VIEW_TYPE)) {
      if (leaf.view instanceof PracticeDashboardView) {
        leaf.view.setDisplayPreferences(this.settings.display);
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

  public async requestResetAllSettings(): Promise<void> {
    const confirmed = await confirmDestructiveAction(this.app, {
      title: "Reset all Practice Problem Generator settings?",
      warning: "Every Practice Problem Generator preference will return to its installed default.",
      consequences: [
        "Provider, model, reasoning, exercise mix, focus, PDF, study, interface, timeout, and executable settings will be reset.",
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
    this.addCommand({
      id: "generate-from-selection",
      name: "Generate from selection",
      editorCheckCallback: (checking, editor) => {
        const available = editor.getSelection().trim().length > 0;
        if (!checking && available) void this.generateFrom("selection", editor.getSelection());
        return available;
      }
    });
    this.addCommand({
      id: "generate-from-current-note",
      name: "Generate from current note",
      checkCallback: (checking) => {
        const available = this.activeMarkdownFile() !== null;
        if (!checking && available) void this.generateFrom("note");
        return available;
      }
    });
    this.addCommand({
      id: "generate-from-current-pdf",
      name: "Generate from current PDF",
      checkCallback: (checking) => {
        const file = this.activePdfFile();
        const available = !Platform.isMobileApp && file !== null;
        if (!checking && available && file !== null) void this.generateFromPdf(file);
        return available;
      }
    });
    this.addCommand({
      id: "open-practice-lab",
      name: "Open workspace",
      callback: () => { void this.openView(); }
    });
    this.addCommand({
      id: "open-practice-dashboard",
      name: "Open practice dashboard",
      callback: () => { void this.openDashboard(); }
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
    if (view.file === null) return;
    const selection = editor.getSelection();
    if (selection.trim()) {
      menu.addItem((item) => item
        .setTitle("Practice Problem Generator: Generate from selection")
        .setIcon("text-select")
        .onClick(() => { void this.generateFrom("selection", selection); }));
    }
    menu.addItem((item) => item
      .setTitle("Practice Problem Generator: Generate from current note")
      .setIcon("flask-conical")
      .onClick(() => { void this.generateFrom("note"); }));
  }

  private addFileMenuItems(menu: Menu, file: TAbstractFile): void {
    if (
      Platform.isMobileApp
      || !(file instanceof TFile)
      || file.extension.toLowerCase() !== "pdf"
    ) return;
    menu.addItem((item) => item
      .setTitle("Practice Problem Generator: Generate from PDF")
      .setIcon("file-scan")
      .onClick(() => { void this.generateFromPdf(file); }));
  }

  private async generateFrom(mode: MarkdownSourceMode, selection?: string): Promise<void> {
    try {
      const source = await collectSource(this.app, mode, selection);
      this.lastSource = source;
      await this.openView(source, true);
    } catch (error) {
      this.showError(error);
    }
  }

  private async generateFromPdf(file?: TFile): Promise<void> {
    try {
      const source = await this.requestPdfSource(file);
      if (source === null) return;
      this.lastSource = source;
      await this.openView(source, true);
    } catch (error) {
      this.showError(error);
    }
  }

  private async requestPdfSource(file = this.activePdfFile()): Promise<CollectedSource | null> {
    if (Platform.isMobileApp) {
      throw new Error("PDF source extraction is available in Obsidian desktop only.");
    }
    if (file === null || file.extension.toLowerCase() !== "pdf") {
      throw new Error("Open or right-click a vault PDF before using Practice Problem Generator.");
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
      defaultPageCount: this.settings.pdfDefaultPageCount,
      maxPages: this.settings.pdfMaxPageCount,
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
        this.settings.pdfMaxPageCount,
        progress.signal,
      );
    } catch (error) {
      if (progress.signal.aborted) return null;
      throw error;
    } finally {
      progress.finish();
    }
    const source = collectPdfSource(file, extraction);
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
  ): Promise<PdfExtractionResult> {
    return extractPdfPages(bytes, info, range, {
      pdfinfoExecutable: this.settings.pdfinfoExecutable,
      pdftotextExecutable: this.settings.pdftotextExecutable,
      maxPages,
      maxCharacters: this.settings.pdfMaxExtractedCharacters,
      timeoutMs: this.settings.pdfExtractionTimeoutMs,
      ...(signal === undefined ? {} : { signal }),
    });
  }

  private createViewOptions(): PracticeLabViewOptions {
    return {
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
            const source = await collectSource(this.app, mode, selection);
            this.lastSource = source;
            return source;
          } catch (error) {
            this.showError(error);
            return null;
          }
        },
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
        previewPayload: async (source, configuration) => this.previewPayload(source, configuration),
        generate: async (request) => this.runGeneration(request.source, request.configuration),
        cancelGeneration: () => {
          if (this.activeGenerationJobId !== undefined) {
            this.cliLayer?.coordinator.cancel(this.activeGenerationJobId);
          }
        },
        saveDrafts: async (source, drafts) => this.saveDrafts(source, drafts),
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
            await this.saveData(this.settings);
          },
          enqueueAnswerReview: (request) => {
            this.enqueueAnswerReview(request);
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
          const summary = createSessionSummary(this.activeBank.bank, session);
          this.activeBank.bank = await this.repository.appendFinishedSession(
            this.activeBank.path,
            summary,
            this.activeBank.bank.revision
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
          new Notice(pendingCount > 0
            ? `Practice session saved. ${pendingCount} AI ${pendingCount === 1 ? "review is" : "reviews are"} continuing in the background.`
            : "Practice session saved.");
        }
      }
    };
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
      startPractice: async (record) => this.startBankStudy(record.bankPath, record.bank),
      openBank: async (record) => {
        await this.app.workspace.openLinkText(record.bankPath, "", true);
      },
      openSource: async (record) => {
        await this.app.workspace.openLinkText(
          record.bank.source.vaultPath,
          record.bankPath,
          true
        );
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

  private async requestRemovePracticeSession(
    bankPath: string,
    bank: PracticeBankV2,
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
    bank: PracticeBankV2,
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
    bank: PracticeBankV2,
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
    const source = this.resolveCollectedSource(presentation);
    const preparedVisuals = await prepareSelectedVisuals(this.app, presentation.visuals);
    const prompt = buildGenerationPrompt(
      source,
      configuration,
      preparedVisuals.map((visual) => visual.source)
    );
    const cli = await import("./cli");
    const filenames = preparedVisuals.map((visual, index) => neutralFilename(index, visual.source.mimeType));
    const exactPayload = cli.appendNeutralMediaManifest(prompt, filenames);
    this.pendingGeneration = { source, configuration, prompt, preparedVisuals };
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
    configuration: GenerationConfiguration
  ): Promise<readonly DraftExercisePresentation[]> {
    if (Platform.isMobileApp) throw new Error("Exercise generation is available in Obsidian desktop only.");
    const pending = this.pendingGeneration;
    if (!pending || pending.source.path !== presentation.path || !sameConfiguration(pending.configuration, configuration)) {
      throw new Error("The source or configuration changed. Preview and approve the payload again.");
    }
    const layer = await this.ensureCliLayer();
    const adapter = layer.adapters[configuration.provider];
    const detection = this.providers.find((provider) => provider.id === configuration.provider);
    if (!detection?.available) throw new Error(`${adapter.label} is not available. ${detection?.detail ?? "Check its executable setting."}`);
    if (pending.preparedVisuals.length > 0 && adapter.capabilities().vision !== "supported") {
      throw new Error(`${adapter.label} vision is not enabled. Choose Codex or Claude for image occlusion.`);
    }

    const generationJobId = `generation-${crypto.randomUUID()}`;
    this.activeGenerationJobId = generationJobId;
    let generatedValue: unknown;
    try {
      const result = await layer.coordinator.generate(adapter, {
        prompt: pending.prompt,
        schema: generationDraftV1JsonSchema,
        validate: (value) => validateGeneratedDraft(value, {
          source: pending.source,
          configuration,
          visualIds: pending.preparedVisuals.map((visual) => visual.source.id)
        }),
        ...(configuration.model.length === 0 ? {} : { model: configuration.model }),
        reasoningEffort: configuration.reasoningEffort,
        media: pending.preparedVisuals.map((visual) => visual.media),
        timeoutMs: this.settings.timeoutMs
      }, {
        id: generationJobId,
        kind: "generation",
        provider: configuration.provider,
      });
      generatedValue = result.value;
      pending.jobId = generationJobId;
      pending.attempts = result.attempts;
    } finally {
      if (this.activeGenerationJobId === generationJobId) this.activeGenerationJobId = undefined;
    }
    const draft = asGenerationDraft(generatedValue, {
      source: pending.source,
      configuration,
      visualIds: pending.preparedVisuals.map((visual) => visual.source.id)
    });
    pending.draft = draft;
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
      },
    });
    this.activeBank = { path: saved.path, bank: saved.bank };
    new Notice(`Saved ${exercises.length} practice ${exercises.length === 1 ? "problem" : "problems"}.`);
    await this.app.workspace.openLinkText(saved.path, pending.source.path, true);
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

  private async startBankStudy(path: string, bank: PracticeBankV2): Promise<void> {
    const source = sourcePresentationFromBank(bank);
    const view = await this.openView(source);
    const visualUrls = new Map(bank.visuals.map((visual) => [
      visual.id,
      this.app.vault.adapter.getResourcePath(visual.vaultPath)
    ]));
    this.activeBank = { path, bank };
    view.startStudy(presentExercises(
      bank.exercises,
      (visualId) => visualUrls.get(visualId),
      bank.segments,
    ));
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
      difficulty: this.settings.difficulty === "foundation"
        ? "foundational"
        : this.settings.difficulty === "exam" ? "deep-exam" : "challenge",
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
      );
    } else {
      restored = await collectRegenerationSource(
        this.app,
        sourceFile,
        currentBank,
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
    if (!Platform.isMobileApp) {
      if (this.providersRefreshedAt === 0) {
        await this.refreshProviders();
      } else if (Date.now() - this.providersRefreshedAt > 60_000) {
        void this.refreshProviders();
      }
    }
    let leaf = this.app.workspace.getLeavesOfType(PRACTICE_LAB_VIEW_TYPE)[0];
    if (leaf === undefined) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: PRACTICE_LAB_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    if (!(leaf.view instanceof PracticeLabView)) throw new Error("Practice Problem Generator view could not be opened.");
    leaf.view.setProviders(this.providers);
    leaf.view.setDisplayPreferences(this.settings.display);
    leaf.view.setConfigurationDefaults({
      provider: this.settings.provider,
      model: modelForProvider(this.settings, this.settings.provider),
      reasoningEffort: this.settings.reasoningEffort,
      focusInstructions: this.settings.defaultFocusInstructions,
      gifFrameDefault: this.settings.gifFrameDefault,
      visualSelectionDefault: this.settings.visualSelectionDefault,
      studyOrderDefault: this.settings.studyOrderDefault,
      quantity: this.settings.quantity,
      difficulty: this.settings.difficulty === "foundation"
        ? "foundational"
        : this.settings.difficulty === "exam" ? "deep-exam" : "challenge",
      exerciseTypePercentages: { ...this.settings.exerciseTypePercentages },
      answerReviewMode: this.settings.answerReviewDefault,
      answerReviewProvider: this.settings.answerReviewProvider,
      answerReviewReasoningEffort: this.settings.answerReviewReasoningEffort,
    });
    if (source !== undefined) {
      leaf.view.setSource(source, { prepareDefaultVisuals });
    }
    return leaf.view;
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
    if (scope !== undefined) leaf.view.setScope(scope);
    if (existing) await leaf.view.refresh();
    return leaf.view;
  }

  private registerDashboardRefreshEvents(): void {
    const scheduleRefresh = (): void => { this.scheduleDashboardRefresh(); };
    this.registerEvent(this.app.vault.on("create", scheduleRefresh));
    this.registerEvent(this.app.vault.on("modify", scheduleRefresh));
    this.registerEvent(this.app.vault.on("delete", scheduleRefresh));
    this.registerEvent(this.app.vault.on("rename", scheduleRefresh));
    this.registerEvent(this.app.metadataCache.on("changed", scheduleRefresh));
    this.registerEvent(this.app.metadataCache.on("resolved", scheduleRefresh));
    this.register(() => { this.clearDashboardRefreshTimer(); });
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

  private resolveCollectedSource(presentation: SourcePresentation): CollectedSource {
    const source = this.lastSource;
    if (!source || source.path !== presentation.path || source.mode !== presentation.mode) {
      throw new Error("The active source changed. Load the note or selection again.");
    }
    return { ...source, visuals: presentation.visuals };
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

  private async loadPracticeBank(bankPath: string): Promise<PracticeBankV2> {
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
    const { createCliProviderLayer } = await import("./cli");
    this.cliLayer = createCliProviderLayer({
      executables: {
        codex: this.settings.codexExecutable,
        claude: this.settings.claudeExecutable,
        agy: this.settings.agyExecutable
      }
    });
    return this.cliLayer;
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
      this.providers = MOBILE_PROVIDERS;
      this.providersRefreshedAt = Date.now();
      return;
    }
    try {
      const layer = await this.ensureCliLayer();
      if (layer.coordinator.isBusy) {
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
      for (const leaf of this.app.workspace.getLeavesOfType(PRACTICE_LAB_VIEW_TYPE)) {
        if (leaf.view instanceof PracticeLabView) leaf.view.setProviders(this.providers);
      }
      this.queueWaitingAnswerReviews();
    } catch (error) {
      if (refreshEpoch !== this.providerRefreshEpoch) return;
      this.providers = MOBILE_PROVIDERS.map((provider) => ({
        ...provider,
        detail: error instanceof Error ? error.message : "Provider detection failed."
      }));
      this.providersRefreshedAt = Date.now();
    }
  }

  private async renderPracticeBlock(
    source: string,
    element: HTMLElement,
    context: MarkdownPostProcessorContext
  ): Promise<void> {
    element.addClass("practice-lab-bank-card");
    const parsed = parsePracticeBankMarkdown(`\`\`\`practice-lab\n${source}\n\`\`\`\n`);
    if (parsed.status !== "ok") {
      this.renderReadOnlyBlock(element, parseFailure(parsed).message, source);
      return;
    }
    const bank = parsed.bank;
    const heading = element.createDiv({ cls: "practice-lab-bank-heading" });
    heading.createEl("strong", { text: `${bank.exercises.length} practice problems` });
    heading.createSpan({ text: `${bank.sessions.length} completed ${bank.sessions.length === 1 ? "session" : "sessions"}` });
    element.createEl("p", { text: `Source: ${bank.source.title}` });
    if (parsed.storedSchemaVersion === 1) {
      element.createEl("p", {
        cls: "practice-lab-bank-migration-note",
        text: "Legacy bank loaded safely. It will migrate to the current format on the next Practice Problem Generator save.",
      });
    }
    let generationHistory: GenerationHistoryV1 | undefined;
    let generationHistoryWarning: string | undefined;
    let pdfSourceDetail: string | undefined;
    let pdfSourceWarning: string | undefined;
    let pdfSourceHistory: readonly string[] = [];
    const bankFile = this.app.vault.getAbstractFileByPath(context.sourcePath);
    if (bankFile instanceof TFile) {
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
    }
    if (pdfSourceDetail !== undefined) {
      element.createEl("p", {
        cls: "practice-lab-bank-source-detail",
        text: pdfSourceDetail,
      });
    }
    if (pdfSourceWarning !== undefined) {
      element.createEl("p", {
        cls: "practice-lab-bank-warning",
        text: pdfSourceWarning,
      });
    }
    if (
      this.settings.display.bank.showGenerationHistory
      && pdfSourceHistory.length > 0
    ) {
      const details = element.createEl("details", {
        cls: "practice-lab-pdf-source-history",
      });
      details.createEl("summary", {
        text: `PDF source history (${pdfSourceHistory.length})`,
      });
      const list = details.createEl("ol");
      for (const entry of pdfSourceHistory) list.createEl("li", { text: entry });
    }
    const generationHistoryOptions = {
      ...(generationHistory === undefined ? {} : { generationHistory }),
      ...(generationHistoryWarning === undefined
        ? {}
        : { generationHistoryWarning }),
    };
    renderBankStatistics(element, bank, Platform.isMobileApp ? {
      visibility: this.settings.display.bank,
      ...generationHistoryOptions,
      removeSession: async (sessionId) => {
        await this.requestRemovePracticeSession(context.sourcePath, bank, sessionId);
      },
    } : {
      visibility: this.settings.display.bank,
      ...generationHistoryOptions,
      retryAnswerReview: async (target) => {
        await this.retryPersistedAnswerReview(context.sourcePath, target);
      },
      pauseAnswerReview: (requestId) => {
        this.pauseAnswerReview(requestId);
      },
      removeSession: async (sessionId) => {
        await this.requestRemovePracticeSession(context.sourcePath, bank, sessionId);
      },
    });
    const actions = element.createDiv({ cls: "practice-lab-bank-actions" });
    const start = actions.createEl("button", { text: "Start practice", cls: "mod-cta" });
    start.addEventListener("click", () => { void this.startBankStudy(context.sourcePath, bank); });
    if (!Platform.isMobileApp) {
      const regenerate = actions.createEl("button", {
        text: "Regenerate / tweak",
        attr: {
          type: "button",
          title: "Open configure with this bank's previous generation settings loaded",
        },
      });
      regenerate.addEventListener("click", () => {
        void this.regenerateBank(context.sourcePath, bank).catch((error: unknown) => {
          this.showError(error);
        });
      });
    }
    const dashboard = actions.createEl("button", { text: "View dashboard" });
    dashboard.addEventListener("click", () => {
      void this.openDashboard({ kind: "source", path: bank.source.vaultPath });
    });
    const dataActions = element.createEl("details", {
      cls: "practice-lab-bank-data-actions",
    });
    dataActions.createEl("summary", { text: "Manage bank data" });
    dataActions.createEl("p", {
      text: "These actions always open a detailed warning and require a typed confirmation.",
    });
    const dataButtons = dataActions.createDiv({ cls: "practice-lab-destructive-actions" });
    const clearHistory = dataButtons.createEl("button", {
      text: "Clear bank history…",
      cls: "mod-warning",
      attr: { type: "button" },
    });
    clearHistory.disabled = bank.sessions.length === 0;
    clearHistory.addEventListener("click", () => {
      void this.requestClearPracticeBankHistory(context.sourcePath, bank).catch((error: unknown) => {
        this.showError(error);
      });
    });
    const deleteBank = dataButtons.createEl("button", {
      text: "Move bank to trash…",
      cls: "mod-warning",
      attr: { type: "button" },
    });
    deleteBank.addEventListener("click", () => {
      void this.requestDeletePracticeBank(context.sourcePath, bank).catch((error: unknown) => {
        this.showError(error);
      });
    });
    if (this.settings.display.bank.showBankMetadata) {
      const details = element.createEl("details");
      details.createEl("summary", { text: "Bank details" });
      details.createEl("p", {
        text: `Revision ${bank.revision} · Updated ${new Date(bank.updatedAt).toLocaleString()} · ${/\.pdf$/iu.test(bank.source.vaultPath) ? "PDF page-range" : bank.source.scope} source`
      });
    }
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
    supportsVision: detection.capabilities.vision === "supported",
    reasoningEfforts: [...detection.capabilities.reasoningEfforts],
    defaultModel: modelForProvider(settings, detection.id),
    ...(detection.version === undefined ? {} : { version: detection.version }),
    ...(detection.detail === undefined ? {} : { detail: detection.detail })
  };
}

function modelForProvider(
  settings: PracticeLabSettings,
  provider: ProviderPresentation["id"],
): string {
  if (provider === "claude") return settings.claudeModel;
  return provider === "agy" ? settings.agyModel : settings.codexModel;
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
