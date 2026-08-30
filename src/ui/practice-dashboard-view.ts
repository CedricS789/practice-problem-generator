import {
  ButtonComponent,
  ItemView,
  Notice,
  Setting,
  WorkspaceLeaf,
  setIcon,
  type ViewStateResult,
} from "obsidian";

import {
  aggregatePracticeDashboard,
  countDashboardBanks,
  getDashboardScopeOptions,
  type DashboardBankRecord,
  type DashboardBankSummary,
  type DashboardFilter,
  type DashboardLearningEvidenceRow,
  type DashboardLearningPathSummary,
  type DashboardScope,
  type DashboardScopeOption,
  type PracticeDashboardSummary,
} from "../dashboard-model";
import type { PracticeDashboardSnapshot } from "../dashboard-repository";
import { formatPracticeRunPoints, practiceRunRankText } from "../practice-run";
import {
  normalizeDisplayPreferences,
  type PracticeLabDisplayPreferences,
} from "../preferences";
import { installHoverDescriptions } from "./hover-descriptions";
import { renderHorizontalTabs } from "./horizontal-tabs";
import { applyMarkdownHeadingTheme } from "./theme-bridge";
import {
  activityMetricValue,
  buildPracticeActivity,
  type ActivityMetric,
  type ActivityRangeWeeks,
  type PracticeActivityDay,
  type PracticeActivitySummary,
  type PracticeActivityWeek,
  type WeekStart,
} from "../activity-analytics";

export const PRACTICE_DASHBOARD_VIEW_TYPE = "practice-lab-dashboard-view";

export type DashboardPage = "practice-now" | "learning" | "activity" | "library";

export type DashboardActivityView =
  | "heatmap"
  | "trend"
  | "performance"
  | "outcomes";

export type DashboardRecoveryAction = "resume" | "resolve";

export interface DashboardRecoveryPresentation {
  readonly state: "resumable" | "needs-resolution";
  /** Stable bank identity when the checkpoint can be matched to a library card. */
  readonly bankId?: string;
  readonly title: string;
  readonly description: string;
  readonly actionLabel?: string;
}

const EXERCISE_TYPE_LABELS = {
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
} as const;

export interface PracticeDashboardViewOptions {
  readonly displayPreferences?: PracticeLabDisplayPreferences;
  readonly analyticsDefaults?: {
    readonly rangeWeeks: ActivityRangeWeeks;
    readonly metric: ActivityMetric;
    readonly weekStart: WeekStart;
  };
  readonly load: () => Promise<PracticeDashboardSnapshot>;
  /** Read-only device-local checkpoint state supplied by the plugin controller. */
  readonly recoveryPresentation?: DashboardRecoveryPresentation | null
    | (() => DashboardRecoveryPresentation | null);
  readonly handleRecovery?: (
    action: DashboardRecoveryAction,
  ) => Promise<void> | void;
  readonly startPractice: (record: DashboardBankRecord) => Promise<void> | void;
  readonly continueLearning?: (record: DashboardBankRecord) => Promise<void> | void;
  readonly chooseSet?: (record: DashboardBankRecord) => Promise<void> | void;
  readonly mixedPractice?: (record: DashboardBankRecord) => Promise<void> | void;
  readonly manageLearningPath?: (record: DashboardBankRecord) => Promise<void> | void;
  readonly openBank: (record: DashboardBankRecord) => Promise<void> | void;
  readonly openSource: (record: DashboardBankRecord) => Promise<void> | void;
  readonly regenerate?: (record: DashboardBankRecord) => Promise<void> | void;
  readonly prepareOffline?: (
    records: readonly DashboardBankRecord[],
  ) => Promise<void> | void;
  readonly deleteBank?: (record: DashboardBankRecord) => Promise<void> | void;
}

type PrimaryScopeKind = "all" | "folder" | "source";

function recordValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function percentText(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

function durationText(durationMs: number): string {
  const minutes = Math.max(0, Math.round(durationMs / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

function formatDay(day: PracticeActivityDay): string {
  return new Date(day.timestamp).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function activityDayLabel(day: PracticeActivityDay): string {
  const date = formatDay(day);
  if (day.future) return `${date}: future date`;
  if (day.sessionCount === 0) return `${date}: no completed practice`;
  const performance = day.performancePercent === null
    ? "no scored answers"
    : `${day.performancePercent}% performance`;
  return `${date}: ${day.sessionCount} ${day.sessionCount === 1 ? "session" : "sessions"}, ${day.answerCount} ${day.answerCount === 1 ? "answer" : "answers"}, ${durationText(day.durationMs)}, ${performance}`;
}

function activityMetricLabel(metric: ActivityMetric): string {
  if (metric === "sessions") return "Sessions";
  if (metric === "minutes") return "Practice time";
  return "Answers";
}

function formatWeekStart(week: PracticeActivityWeek): string {
  return new Date(`${week.startDateKey}T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function shortWeekLabel(week: PracticeActivityWeek | undefined): string {
  if (week === undefined) return "—";
  return new Date(`${week.startDateKey}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function weeklyMetricLabel(
  week: PracticeActivityWeek,
  metric: ActivityMetric,
): string {
  const prefix = `Week of ${formatWeekStart(week)}`;
  if (metric === "sessions") {
    return `${prefix}: ${week.sessionCount} ${week.sessionCount === 1 ? "session" : "sessions"}`;
  }
  if (metric === "minutes") return `${prefix}: ${durationText(week.durationMs)} practice time`;
  return `${prefix}: ${week.answerCount} ${week.answerCount === 1 ? "answer" : "answers"}`;
}

function weeklyPerformanceLabel(week: PracticeActivityWeek): string {
  return `Week of ${formatWeekStart(week)}: ${percentText(week.performancePercent)} performance across ${week.scoredAnswerCount} scored ${week.scoredAnswerCount === 1 ? "answer" : "answers"}${week.provisionalSessionCount > 0 ? "; provisional reviews remain" : ""}`;
}

function sourceFolder(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function sourceNameFromPath(path: string): string {
  const filename = path.split("/").at(-1) ?? path;
  return filename.replace(/\.md$/iu, "");
}

function folderAncestors(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((_part, index) => parts.slice(0, index + 1).join("/"));
}

function scopeKind(scope: DashboardScope): PrimaryScopeKind {
  return scope.kind === "tag" ? "all" : scope.kind;
}

function startingLevelLabel(level: DashboardLearningPathSummary["startingLevel"]): string {
  if (level === "new-to-topic") return "New to this topic";
  if (level === "some-familiarity") return "Some familiarity";
  return "Exam review";
}

function evidenceStateDescription(row: DashboardLearningEvidenceRow): string {
  if (row.state === "Unpracticed") {
    return "No scored independent evidence is available. Guided work does not change this label.";
  }
  if (row.state === "Consistent evidence") {
    return "At least three scored independent attempts across two sessions with at least 80% weighted performance.";
  }
  return "Some scored independent evidence exists, but it does not yet meet the Consistent evidence threshold.";
}

export class PracticeDashboardView extends ItemView {
  private snapshot: PracticeDashboardSnapshot | null = null;
  private primary: DashboardScope = { kind: "all" };
  private tagPrefix: string | undefined;
  private search = "";
  private loadEpoch = 0;
  private loading = false;
  private errorMessage: string | null = null;
  private lastLoadedAt: number | null = null;
  private displayPreferences: PracticeLabDisplayPreferences;
  private activityRangeWeeks: ActivityRangeWeeks;
  private activityMetric: ActivityMetric;
  private activityWeekStart: WeekStart;
  private activePage: DashboardPage = "practice-now";
  private activityView: DashboardActivityView = "heatmap";
  private scopeEditorOpen = false;
  private selectedLearningBankId: string | null = null;
  private activePanelEl: HTMLElement | null = null;

  public constructor(
    leaf: WorkspaceLeaf,
    private readonly options: PracticeDashboardViewOptions,
  ) {
    super(leaf);
    this.navigation = false;
    this.displayPreferences = normalizeDisplayPreferences(options.displayPreferences);
    this.activityRangeWeeks = options.analyticsDefaults?.rangeWeeks ?? 52;
    this.activityMetric = options.analyticsDefaults?.metric ?? "answers";
    this.activityWeekStart = options.analyticsDefaults?.weekStart ?? "monday";
  }

  public getViewType(): string {
    return PRACTICE_DASHBOARD_VIEW_TYPE;
  }

  public getDisplayText(): string {
    return "Practice dashboard";
  }

  public getIcon(): string {
    return "layout-dashboard";
  }

  public override getState(): Record<string, unknown> {
    return {
      ...super.getState(),
      scopeKind: this.primary.kind,
      scopeValue: this.primary.kind === "folder"
        ? this.primary.path
        : this.primary.kind === "source" ? this.primary.path : "",
      tagPrefix: this.tagPrefix ?? "",
      search: this.search,
    };
  }

  public override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    await super.setState(state, result);
    const kind = recordValue(state, "scopeKind");
    const value = recordValue(state, "scopeValue");
    if (kind === "folder" && typeof value === "string" && value.length > 0) {
      this.primary = { kind, path: value };
    } else if (
      kind === "source" &&
      typeof value === "string" &&
      value.length > 0
    ) {
      this.primary = { kind, path: value };
    } else {
      this.primary = { kind: "all" };
    }
    const tagPrefix = recordValue(state, "tagPrefix");
    this.tagPrefix = typeof tagPrefix === "string" && tagPrefix.length > 0
      ? tagPrefix
      : undefined;
    const search = recordValue(state, "search");
    this.search = typeof search === "string" ? search : "";
    if (this.snapshot !== null) this.render();
  }

  public override async onOpen(): Promise<void> {
    installHoverDescriptions(this.contentEl);
    this.addAction("refresh-cw", "Refresh practice dashboard", () => {
      void this.refresh();
    });
    await this.refresh();
  }

  public setScope(scope: DashboardScope, tagPrefix?: string): void {
    if (scope.kind === "tag") {
      this.primary = { kind: "all" };
      this.tagPrefix = scope.tag;
    } else {
      this.primary = scope;
      this.tagPrefix = tagPrefix;
    }
    this.render();
  }

  public setDisplayPreferences(
    preferences: PracticeLabDisplayPreferences,
    analyticsDefaults?: PracticeDashboardViewOptions["analyticsDefaults"],
  ): void {
    const normalized = normalizeDisplayPreferences(preferences);
    const analyticsChanged = analyticsDefaults !== undefined && (
      analyticsDefaults.rangeWeeks !== this.activityRangeWeeks
      || analyticsDefaults.metric !== this.activityMetric
      || analyticsDefaults.weekStart !== this.activityWeekStart
    );
    const changed = JSON.stringify(normalized) !== JSON.stringify(this.displayPreferences)
      || analyticsChanged;
    this.displayPreferences = normalized;
    if (analyticsDefaults !== undefined) {
      this.activityRangeWeeks = analyticsDefaults.rangeWeeks;
      this.activityMetric = analyticsDefaults.metric;
      this.activityWeekStart = analyticsDefaults.weekStart;
    }
    if (changed) this.render();
  }

  public async refresh(): Promise<void> {
    const epoch = ++this.loadEpoch;
    this.loading = true;
    this.errorMessage = null;
    this.render();
    try {
      const snapshot = await this.options.load();
      if (epoch !== this.loadEpoch) return;
      this.snapshot = snapshot;
      this.lastLoadedAt = Date.now();
    } catch (error) {
      if (epoch !== this.loadEpoch) return;
      this.errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      if (epoch === this.loadEpoch) {
        this.loading = false;
        this.render();
      }
    }
  }

  private currentFilter(): DashboardFilter {
    return {
      primary: this.primary,
      ...(this.tagPrefix === undefined ? {} : { tagPrefix: this.tagPrefix }),
    };
  }

  private render(): void {
    this.contentEl.empty();
    this.activePanelEl = null;
    this.contentEl.addClasses([
      "practice-lab-view",
      "practice-lab-dashboard-view",
    ]);
    applyMarkdownHeadingTheme(this.contentEl);
    this.contentEl.toggleClass(
      "is-compact",
      this.displayPreferences.practice.density === "compact",
    );
    const header = this.contentEl.createDiv({ cls: "practice-lab-header" });
    const heading = header.createDiv();
    heading.createEl("h2", { text: "Practice dashboard" });
    if (this.displayPreferences.dashboard.showIntroduction) {
      heading.createEl("p", {
        text: "See every Practice Problem Generator bank together, then narrow the statistics to any source-folder level, one note, or an optional source tag.",
      });
    }
    const headerActions = header.createDiv({
      cls: "practice-lab-header-actions",
    });
    if (this.lastLoadedAt !== null) {
      headerActions.createSpan({
        cls: "practice-lab-last-updated",
        text: `Updated ${new Date(this.lastLoadedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}`,
      });
    }
    new ButtonComponent(headerActions)
      .setIcon("refresh-cw")
      .setButtonText(this.loading ? "Refreshing…" : "Refresh")
      .setDisabled(this.loading)
      .onClick(() => void this.refresh());
    const icon = headerActions.createDiv({ cls: "practice-lab-header-icon" });
    setIcon(icon, "layout-dashboard");

    if (this.loading && this.snapshot === null) {
      this.renderStatus("Loading practice banks…", "loader-circle");
      return;
    }
    if (this.errorMessage !== null && this.snapshot === null) {
      this.renderStatus(
        `The dashboard could not load: ${this.errorMessage}`,
        "circle-alert",
        "alert",
      );
      return;
    }
    const snapshot = this.snapshot;
    if (snapshot === null) {
      this.renderStatus("No dashboard data is available yet.", "layout-dashboard");
      return;
    }
    const scopeOptions = getDashboardScopeOptions(snapshot.records);
    const tagOptions = this.contextualTagOptions(
      snapshot.records,
      scopeOptions.tags,
    );
    const display = this.displayPreferences.dashboard;
    const summary = aggregatePracticeDashboard(
      snapshot.records,
      this.currentFilter(),
    );
    renderHorizontalTabs(this.contentEl, {
      tabs: [
        { id: "practice-now", label: "Practice now" },
        { id: "learning", label: "Learning" },
        { id: "activity", label: "Activity" },
        { id: "library", label: "Library" },
      ],
      selected: this.activePage,
      ariaLabel: "Practice dashboard pages",
      className: "practice-lab-dashboard-tabs",
      onSelect: (page) => {
        this.activePage = page;
        this.scopeEditorOpen = false;
        this.render();
      },
      renderPanel: (panel) => {
        this.activePanelEl = panel;
        this.renderScopeBar(scopeOptions, tagOptions);
        if (this.errorMessage !== null) {
          const alert = panel.createDiv({
            cls: "practice-lab-dashboard-diagnostics",
            attr: { role: "alert", "aria-live": "assertive" },
          });
          alert.createEl("strong", { text: "Dashboard refresh failed" });
          alert.createEl("p", {
            text: `Showing the last loaded statistics. ${this.errorMessage}`,
          });
        }
        if (snapshot.records.length === 0) {
          this.renderStatus(
            "No practice banks are available yet. Generate and save a practice set first.",
            "library-big",
          );
          return;
        }
        if (summary.bankCount === 0) {
          this.renderStatus(
            "No practice banks match this scope. Change the scope to continue.",
            "filter-x",
          );
          return;
        }
        if (this.activePage === "practice-now") {
          this.renderPracticeNow(summary, snapshot.records);
          this.renderDiagnostics(snapshot, summary);
          return;
        }
        if (this.activePage === "learning") {
          if (display.showLearningPathAnalytics) {
            this.renderLearningPathAnalytics(summary, snapshot.records);
          } else {
            this.renderStatus(
              "Learning-path insights are hidden in dashboard settings.",
              "route",
            );
          }
          return;
        }
        if (this.activePage === "activity") {
          this.renderActivityAnalytics(summary);
          return;
        }
        if (display.showBankList) {
          this.renderBankSection(summary, snapshot.records);
          this.renderDiagnostics(snapshot, summary);
        } else {
          this.renderStatus(
            "The practice library is hidden in dashboard settings.",
            "library-big",
          );
        }
      },
    });
  }

  private dashboardContainer(): HTMLElement {
    return this.activePanelEl ?? this.contentEl;
  }

  private renderScopeBar(
    options: ReturnType<typeof getDashboardScopeOptions>,
    tagOptions: readonly DashboardScopeOption[],
  ): void {
    const bar = this.dashboardContainer().createDiv({
      cls: "practice-lab-dashboard-scope-bar",
      attr: { "aria-label": "Current dashboard scope" },
    });
    const copy = bar.createDiv();
    copy.createSpan({ cls: "practice-lab-muted", text: "Scope" });
    copy.createEl("strong", { text: this.scopeLabel() });
    if (this.displayPreferences.dashboard.showScopeControls) {
      new ButtonComponent(bar)
        .setIcon(this.scopeEditorOpen ? "x" : "sliders-horizontal")
        .setButtonText(this.scopeEditorOpen ? "Close" : "Change scope…")
        .setTooltip(this.scopeEditorOpen
          ? "Close the dashboard scope controls."
          : "Choose a folder, source note, or optional source tag.")
        .onClick(() => {
          this.scopeEditorOpen = !this.scopeEditorOpen;
          this.render();
        });
    }
    if (!this.scopeEditorOpen) return;
    const editor = this.dashboardContainer().createDiv({
      cls: "practice-lab-dashboard-scope-editor",
    });
    const previousHost = this.activePanelEl;
    this.activePanelEl = editor;
    this.renderFilters(options, tagOptions);
    this.activePanelEl = previousHost;
  }

  private scopeLabel(): string {
    const base = this.primary.kind === "all"
      ? "All practice"
      : this.primary.kind === "folder"
        ? this.primary.path
        : this.primary.kind === "source"
          ? sourceNameFromPath(this.primary.path)
          : `#${this.primary.tag}`;
    return this.tagPrefix === undefined ? base : `${base} · #${this.tagPrefix}`;
  }

  private renderPracticeNow(
    summary: PracticeDashboardSummary,
    records: readonly DashboardBankRecord[],
  ): void {
    const section = this.dashboardSection(
      "Practice now",
      "Pick up from the most useful available place. This is guidance from your saved activity, never a due task or spaced-repetition schedule.",
    );
    const actionCard = section.createDiv({
      cls: "practice-lab-dashboard-primary-action",
    });
    const recovery = this.recoveryPresentation();
    if (recovery !== undefined && recovery !== null) {
      const icon = actionCard.createSpan({ attr: { "aria-hidden": "true" } });
      setIcon(icon, recovery.state === "resumable" ? "history" : "circle-alert");
      const copy = actionCard.createDiv();
      copy.createEl("h3", { text: recovery.title });
      copy.createEl("p", { text: recovery.description });
      const action = recovery.state === "resumable" ? "resume" : "resolve";
      new ButtonComponent(actionCard)
        .setIcon(recovery.state === "resumable" ? "play" : "wrench")
        .setButtonText(recovery.actionLabel
          ?? (recovery.state === "resumable" ? "Resume session" : "Resolve session"))
        .setDisabled(this.options.handleRecovery === undefined)
        .setCta()
        .onClick(() => void this.runAction(
          () => this.options.handleRecovery?.(action),
          "Could not open the saved session.",
        ));
    } else {
      const guided = this.mostRecentBank(summary, true);
      const regular = guided === undefined
        ? this.mostRecentBank(summary, false)
        : undefined;
      const recommended = guided ?? regular;
      if (recommended === undefined) {
        const copy = actionCard.createDiv();
        copy.createEl("h3", { text: "Choose your first practice" });
        copy.createEl("p", {
          text: "There is no completed practice in this scope yet. Choose any saved bank to begin.",
        });
        new ButtonComponent(actionCard)
          .setIcon("library-big")
          .setButtonText("Choose practice")
          .setCta()
          .onClick(() => {
            this.activePage = "library";
            this.render();
          });
      } else {
        const record = this.recordForBank(records, recommended);
        const guidedPath = recommended.learningPath !== null;
        const copy = actionCard.createDiv();
        copy.createEl("h3", {
          text: guidedPath
            ? `Continue ${recommended.learningPath?.title ?? recommended.sourceTitle}`
            : `Practise ${recommended.sourceTitle}`,
        });
        copy.createEl("p", {
          text: guidedPath
            ? "This is the most recently practised guided path in the current scope."
            : "This is the most recently practised regular bank in the current scope.",
        });
        const button = new ButtonComponent(actionCard)
          .setIcon(guidedPath ? "route" : "play")
          .setButtonText(guidedPath ? "Continue learning" : "Start practice")
          .setDisabled(record === undefined)
          .setCta();
        button.onClick(() => void this.runAction(
          () => {
            if (record === undefined) return;
            return guidedPath && this.options.continueLearning !== undefined
              ? this.options.continueLearning(record)
              : this.options.startPractice(record);
          },
          guidedPath
            ? "Could not continue this learning path."
            : "Could not start this practice bank.",
        ));
      }
    }

    const metrics = section.createDiv({
      cls: "practice-lab-dashboard-metrics practice-lab-dashboard-key-metrics",
    });
    this.dashboardMetric(
      metrics,
      "Performance",
      percentText(summary.performance.percent),
      summary.performance.totalPoints === 0
        ? "No scored answers yet"
        : `${formatPracticeRunPoints(summary.performance.earnedPoints)} / ${summary.performance.totalPoints} points`,
    );
    this.dashboardMetric(
      metrics,
      "Practised coverage",
      summary.problemCount === 0
        ? "—"
        : `${Math.round(summary.practicedProblemCount / summary.problemCount * 100)}%`,
      `${summary.practicedProblemCount} of ${summary.problemCount} saved problems attempted`,
    );
    const attentionCount = summary.failedAiReviewCount
      + summary.pendingAiReviewCount
      + summary.alignment.schoolDisagreementRecordCount
      + summary.alignment.unresolvedRecordCount
      + summary.learning.unresolvedSourceGapCount
      + summary.missingSourceCount;
    if (attentionCount > 0) {
      this.dashboardMetric(
        metrics,
        "Needs attention",
        String(attentionCount),
        "Reviews, alignment, source gaps, or missing source notes",
      );
      const details = section.createEl("details", {
        cls: "practice-lab-dashboard-diagnostics",
      });
      details.createEl("summary", { text: "Review attention items" });
      details.createEl("p", {
        text: `${summary.pendingAiReviewCount} pending AI reviews · ${summary.failedAiReviewCount} failed AI reviews · ${summary.learning.unresolvedSourceGapCount} source gaps · ${summary.alignment.schoolDisagreementRecordCount + summary.alignment.unresolvedRecordCount} alignment concerns · ${summary.missingSourceCount} missing source notes.`,
      });
    } else {
      this.dashboardMetric(
        metrics,
        "Recent activity",
        String(summary.sessionCount),
        summary.recentSessions[0] === undefined
          ? "No completed sessions yet"
          : `Last practised ${new Date(summary.recentSessions[0].session.finishedAt).toLocaleDateString()}`,
      );
    }

    if (
      this.displayPreferences.dashboard.showOfflinePreparation
      && this.options.prepareOffline !== undefined
    ) {
      const details = section.createEl("details", {
        cls: "practice-lab-dashboard-secondary-actions",
      });
      details.createEl("summary", { text: "More…" });
      const selectedPaths = new Set(summary.banks.map((bank) => bank.bankPath));
      const previousHost = this.activePanelEl;
      this.activePanelEl = details;
      this.renderOfflinePreparation(records.filter((record) => (
        selectedPaths.has(record.bankPath.replace(/\\/gu, "/"))
      )));
      this.activePanelEl = previousHost;
    }
  }

  private mostRecentBank(
    summary: PracticeDashboardSummary,
    guided: boolean,
  ): DashboardBankSummary | undefined {
    return summary.banks
      .filter((bank) => (bank.learningPath !== null) === guided)
      .filter((bank) => bank.latestSessionAt !== null)
      .sort((left, right) => (
        Date.parse(right.latestSessionAt ?? "") - Date.parse(left.latestSessionAt ?? "")
      ))[0];
  }

  private recordForBank(
    records: readonly DashboardBankRecord[],
    bank: DashboardBankSummary,
  ): DashboardBankRecord | undefined {
    return records.find((record) => (
      record.bankPath.replace(/\\/gu, "/") === bank.bankPath
    ));
  }

  private renderOfflinePreparation(
    records: readonly DashboardBankRecord[],
  ): void {
    const panel = this.dashboardContainer().createDiv({
      cls: "practice-lab-offline-preparation",
    });
    const copy = panel.createDiv();
    copy.createEl("strong", { text: "Taking this practice offline?" });
    copy.createEl("p", {
      text: "Audit every bank in the current dashboard scope and every static image required by its occlusion questions.",
    });
    new ButtonComponent(panel)
      .setIcon("cloud-off")
      .setButtonText("Prepare for offline practice")
      .setTooltip("Checks the currently filtered banks without contacting or configuring a sync service.")
      .onClick(() => void this.runAction(
        () => this.options.prepareOffline?.(records),
        "Could not audit the selected practice banks.",
      ));
  }

  private contextualTagOptions(
    records: readonly DashboardBankRecord[],
    options: readonly DashboardScopeOption[],
  ): readonly DashboardScopeOption[] {
    return options.flatMap((option) => {
      if (option.scope.kind !== "tag") return [];
      const count = countDashboardBanks(records, {
        primary: this.primary,
        tagPrefix: option.scope.tag,
      });
      return count === 0 ? [] : [{ ...option, count }];
    });
  }

  private renderFilters(
    options: ReturnType<typeof getDashboardScopeOptions>,
    tagOptions: readonly DashboardScopeOption[],
  ): void {
    const panel = this.dashboardContainer().createDiv({
      cls: "practice-lab-dashboard-filters",
    });
    new Setting(panel)
      .setName("Scope level")
      .setDesc("Choose all practice, any source-folder depth, or one source note.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("all", "All practice")
          .addOption("folder", "Folder subtree")
          .addOption("source", "Source note")
          .setValue(scopeKind(this.primary))
          .onChange((value) => {
            if (value === "folder") {
              const first = options.folders[0]?.scope;
              this.primary = first?.kind === "folder" ? first : { kind: "all" };
            } else if (value === "source") {
              const first = options.sources[0]?.scope;
              this.primary = first?.kind === "source" ? first : { kind: "all" };
            } else {
              this.primary = { kind: "all" };
            }
            this.render();
          });
      });

    if (this.primary.kind === "folder") {
      new Setting(panel)
        .setName("Folder")
        .setDesc("Includes every source note below this folder.")
        .addDropdown((dropdown) => {
          const currentPath = this.primary.kind === "folder"
            ? this.primary.path
            : "";
          const available = options.folders.some(
            (option) => option.scope.kind === "folder"
              && option.scope.path === currentPath,
          );
          if (!available) {
            dropdown.addOption(currentPath, `${currentPath} (unavailable)`);
          }
          for (const option of options.folders) {
            if (option.scope.kind !== "folder") continue;
            dropdown.addOption(
              option.scope.path,
              `${option.label} (${option.count})`,
            );
          }
          dropdown.setValue(currentPath);
          dropdown.onChange((path) => {
            this.primary = { kind: "folder", path };
            this.render();
          });
        });
    } else if (this.primary.kind === "source") {
      new Setting(panel)
        .setName("Source note")
        .setDesc("Shows the bank and history for exactly one source note.")
        .addDropdown((dropdown) => {
          const currentPath = this.primary.kind === "source"
            ? this.primary.path
            : "";
          const available = options.sources.some(
            (option) => option.scope.kind === "source"
              && option.scope.path === currentPath,
          );
          if (!available) {
            const parent = sourceFolder(currentPath);
            const location = parent.length === 0 ? "Vault root" : parent;
            dropdown.addOption(
              currentPath,
              `${sourceNameFromPath(currentPath)} — ${location} (unavailable)`,
            );
          }
          const titleCounts = new Map<string, number>();
          for (const option of options.sources) {
            const title = option.label.toLocaleLowerCase();
            titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
          }
          for (const option of options.sources) {
            if (option.scope.kind !== "source") continue;
            const hasDuplicateTitle = (titleCounts.get(
              option.label.toLocaleLowerCase(),
            ) ?? 0) > 1;
            const parent = sourceFolder(option.scope.path);
            const label = hasDuplicateTitle
              ? `${option.label} — ${parent.length === 0 ? "Vault root" : parent}`
              : option.label;
            dropdown.addOption(
              option.scope.path,
              `${label} (${option.count})`,
            );
          }
          dropdown.setValue(currentPath);
          dropdown.onChange((path) => {
            this.primary = { kind: "source", path };
            this.render();
          });
        });
    }

    new Setting(panel)
      .setName("Tag filter")
      .setDesc("Optional. Tags come from source notes; parent tags include nested tags.")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "Any source tag");
        const tagAvailable = this.tagPrefix === undefined || tagOptions.some(
          (option) => option.scope.kind === "tag"
            && option.scope.tag === this.tagPrefix,
        );
        if (!tagAvailable && this.tagPrefix !== undefined) {
          dropdown.addOption(
            this.tagPrefix,
            `#${this.tagPrefix} (unavailable)`,
          );
        }
        for (const option of tagOptions) {
          if (option.scope.kind !== "tag") continue;
          dropdown.addOption(
            option.scope.tag,
            `${option.label} (${option.count})`,
          );
        }
        dropdown.setValue(this.tagPrefix ?? "");
        dropdown.onChange((tag) => {
          this.tagPrefix = tag.length === 0 ? undefined : tag;
          this.render();
        });
      });
  }

  private renderBreadcrumbs(): void {
    if (this.primary.kind === "all" && this.tagPrefix === undefined) return;
    const trail = this.dashboardContainer().createDiv({
      cls: "practice-lab-dashboard-breadcrumbs",
      attr: { "aria-label": "Dashboard scope" },
    });
    this.scopeButton(trail, "All practice", { kind: "all" });
    const path = this.primary.kind === "folder"
      ? this.primary.path
      : this.primary.kind === "source"
        ? sourceFolder(this.primary.path)
        : "";
    for (const folder of folderAncestors(path)) {
      trail.createSpan({ text: "/", attr: { "aria-hidden": "true" } });
      this.scopeButton(trail, folder.split("/").at(-1) ?? folder, {
        kind: "folder",
        path: folder,
      });
    }
    if (this.primary.kind === "source") {
      trail.createSpan({ text: "/", attr: { "aria-hidden": "true" } });
      trail.createSpan({ text: this.primary.path.split("/").at(-1) ?? "Source" });
    }
    if (this.tagPrefix !== undefined) {
      trail.createSpan({ text: "·", attr: { "aria-hidden": "true" } });
      const tag = trail.createEl("button", {
        cls: "practice-lab-dashboard-tag is-active",
        text: `#${this.tagPrefix}`,
        attr: { type: "button", "aria-label": `Remove #${this.tagPrefix} filter` },
      });
      tag.addEventListener("click", () => {
        this.tagPrefix = undefined;
        this.render();
      });
    }
  }

  private scopeButton(
    container: HTMLElement,
    label: string,
    scope: DashboardScope,
  ): void {
    const button = container.createEl("button", {
      text: label,
      cls: "practice-lab-dashboard-scope-link",
      attr: { type: "button" },
    });
    button.addEventListener("click", () => {
      this.primary = scope;
      this.render();
    });
  }

  private renderMetrics(summary: PracticeDashboardSummary): void {
    const preferences = this.displayPreferences.dashboard;
    const section = this.dashboardSection(
      "Overview",
      "Weighted from individual answers, never from averaging bank percentages.",
    );
    const metrics = section.createDiv({ cls: "practice-lab-dashboard-metrics" });
    if (preferences.showPerformance) {
      this.dashboardMetric(
        metrics,
        "Performance",
        percentText(summary.performance.percent),
        `${summary.provisional ? "Provisional · " : ""}${formatPracticeRunPoints(summary.performance.earnedPoints)} / ${summary.performance.totalPoints} points`,
      );
    }
    if (preferences.showBankCount) {
      this.dashboardMetric(
        metrics,
        "Practice banks",
        String(summary.bankCount),
        `${summary.practicedBankCount} practiced · ${summary.unpracticedBankCount} new`,
      );
    }
    if (preferences.showProblemCount) {
      this.dashboardMetric(
        metrics,
        "Practice problems",
        String(summary.problemCount),
        `${summary.practicedProblemCount} attempted · ${summary.unpracticedProblemCount} unattempted`,
      );
    }
    if (preferences.showSessionCount) {
      this.dashboardMetric(
        metrics,
        "Completed sessions",
        String(summary.sessionCount),
        `${summary.answerCount} total answers`,
      );
    }
    if (preferences.showCompletion) {
      this.dashboardMetric(
        metrics,
        "Session completion",
        percentText(summary.completionPercent),
        "Completed answers across session sizes",
      );
    }
    if (preferences.showBestStreak) {
      this.dashboardMetric(
        metrics,
        "Best answer streak",
        String(summary.bestAnswerStreak),
        "Consecutive full-credit answers",
      );
    }
    if (preferences.showObjectiveAnswers) {
      this.dashboardMetric(
        metrics,
        "Objective answers",
        `${summary.objectiveCorrect} / ${summary.objectiveTotal}`,
        "Correct answers from deterministic grading",
      );
    }
    if (preferences.showFreeResponses) {
      this.dashboardMetric(
        metrics,
        "Free responses",
        String(summary.freeResponseCorrect),
        `${summary.freeResponsePartial} partial · ${summary.freeResponseIncorrect} incorrect`,
      );
    }
    if (preferences.showAiReviews) {
      this.dashboardMetric(
        metrics,
        "AI answer reviews",
        String(summary.reviewedAiResponseCount),
        `${summary.pendingAiReviewCount} pending · ${summary.failedAiReviewCount} failed`,
      );
    }
  }

  private dashboardMetric(
    container: HTMLElement,
    label: string,
    value: string,
    note: string,
  ): void {
    const metric = container.createDiv({ cls: "practice-lab-dashboard-metric" });
    metric.createSpan({ cls: "practice-lab-dashboard-metric-label", text: label });
    metric.createEl("strong", { text: value });
    metric.createSpan({ cls: "practice-lab-dashboard-metric-note", text: note });
  }

  private renderAlignmentHealth(summary: PracticeDashboardSummary): void {
    const health = summary.alignment;
    const panel = this.dashboardContainer().createDiv({
      cls: "practice-lab-dashboard-alignment-health",
      attr: { role: "status" },
    });
    const icon = panel.createSpan({
      cls: "practice-lab-dashboard-alignment-icon",
      attr: { "aria-hidden": "true" },
    });
    setIcon(icon, health.unresolvedRecordCount + health.schoolDisagreementRecordCount > 0
      ? "shield-alert"
      : health.courseCheckedBankCount > 0 ? "shield-check" : "shield-question");
    const copy = panel.createDiv();
    copy.createEl("strong", { text: "Course alignment" });
    copy.createEl("p", {
      text: `${health.courseCheckedBankCount} course-checked · ${health.notCourseCheckedBankCount} not course-checked${health.noteDifferenceRecordCount === 0 ? "" : ` · ${health.noteDifferenceRecordCount} note ${health.noteDifferenceRecordCount === 1 ? "difference" : "differences"}`}`,
    });
    const attentionCount = health.schoolDisagreementRecordCount
      + health.unresolvedRecordCount;
    if (attentionCount === 0 && health.noteIncompleteRecordCount === 0) return;
    const details = panel.createEl("details");
    details.createEl("summary", { text: "Details" });
    details.createEl("p", {
      text: `${health.noteIncompleteRecordCount} school-backed context ${health.noteIncompleteRecordCount === 1 ? "addition" : "additions"} · ${health.schoolDisagreementRecordCount} school-source ${health.schoolDisagreementRecordCount === 1 ? "disagreement" : "disagreements"} · ${health.unresolvedRecordCount} ${health.unresolvedRecordCount === 1 ? "area needs" : "areas need"} attention. Alignment is informational and never changes practice scores.`,
    });
  }

  private renderLearningPathAnalytics(
    summary: PracticeDashboardSummary,
    records: readonly DashboardBankRecord[],
  ): void {
    const section = this.dashboardSection(
      "Learning",
      "Choose one guided path to see its current step and the evidence that supports the recommendation.",
    );
    const pathBanks = summary.banks.filter((bank) => bank.learningPath !== null);
    if (pathBanks.length === 0) {
      section.createEl("p", {
        cls: "practice-lab-dashboard-empty-inline",
        text: "No guided learning path is available in this scope.",
      });
      return;
    }
    if (!pathBanks.some((bank) => bank.bankId === this.selectedLearningBankId)) {
      this.selectedLearningBankId = pathBanks[0]?.bankId ?? null;
    }
    const selector = section.createDiv({
      cls: "practice-lab-dashboard-learning-selector",
      attr: { role: "listbox", "aria-label": "Guided learning paths" },
    });
    for (const bank of pathBanks) {
      const path = bank.learningPath;
      if (path === null) continue;
      const selected = bank.bankId === this.selectedLearningBankId;
      const button = selector.createEl("button", {
        cls: `practice-lab-dashboard-learning-option${selected ? " is-selected" : ""}`,
        attr: {
          type: "button",
          role: "option",
          "aria-selected": String(selected),
        },
      });
      button.createEl("strong", { text: path.title });
      button.createSpan({
        text: `${path.completedLessonCount}/${path.lessonCount} lessons · ${path.setCount} ${path.setCount === 1 ? "set" : "sets"}`,
      });
      button.addEventListener("click", () => {
        this.selectedLearningBankId = bank.bankId;
        this.render();
      });
    }
    const selected = pathBanks.find((bank) => (
      bank.bankId === this.selectedLearningBankId
    ));
    const learning = selected?.learningPath;
    if (selected === undefined || learning === null || learning === undefined) return;
    this.renderLearningPathCard(
      section,
      selected,
      learning,
      this.recordForBank(records, selected),
    );
  }

  private renderLearningPathCard(
    container: HTMLElement,
    bank: DashboardBankSummary,
    learning: DashboardLearningPathSummary,
    record: DashboardBankRecord | undefined,
  ): void {
    const card = container.createDiv({
      cls: "practice-lab-dashboard-bank practice-lab-dashboard-learning-detail",
    });
    const heading = card.createDiv({ cls: "practice-lab-dashboard-bank-heading" });
    const title = heading.createDiv();
    title.createEl("h4", { text: learning.title });
    title.createEl("p", { text: bank.sourceTitle });
    heading.createSpan({
      cls: "practice-lab-dashboard-tag",
      text: startingLevelLabel(learning.startingLevel),
      attr: { title: "The learner starting level selected when this guided path was approved." },
    });

    const current = card.createDiv({ cls: "practice-lab-dashboard-primary-action" });
    const recommendation = learning.recommendation;
    const copy = current.createDiv();
    copy.createSpan({ cls: "practice-lab-muted", text: "Current step" });
    copy.createEl("strong", {
      text: recommendation?.title
        ?? (learning.remainingLessonTitles[0] ?? "Path complete — choose any set"),
    });
    if (recommendation !== null) {
      copy.createEl("p", { text: recommendation.reasons[0] ?? "Ready to continue." });
    }
    const continueButton = new ButtonComponent(current)
      .setIcon("route")
      .setButtonText("Continue learning")
      .setDisabled(record === undefined || this.options.continueLearning === undefined)
      .setCta();
    continueButton.onClick(() => void this.runAction(
      () => record === undefined
        ? undefined
        : this.options.continueLearning?.(record),
      "Could not continue this learning path.",
    ));

    const status = card.createDiv({ cls: "practice-lab-dashboard-metrics" });
    this.dashboardMetric(
      status,
      "Independent evidence",
      percentText(learning.independentPerformancePercent),
      `${learning.independentAttempts} scored independent ${learning.independentAttempts === 1 ? "attempt" : "attempts"}`,
    );
    this.dashboardMetric(
      status,
      "Lesson progress",
      `${learning.completedLessonCount}/${learning.lessonCount}`,
      `${learning.setCount} practice ${learning.setCount === 1 ? "set" : "sets"}`,
    );
    this.dashboardMetric(
      status,
      "Evidence state",
      String(learning.consistentAspectCount),
      `${learning.developingAspectCount} developing · ${learning.unpracticedAspectCount} unpractised`,
    );

    if (learning.unresolvedSourceGapCount > 0) {
      const gaps = card.createEl("details", {
        cls: "practice-lab-dashboard-diagnostics",
      });
      gaps.createEl("summary", {
        text: `${learning.unresolvedSourceGapCount} unresolved source ${learning.unresolvedSourceGapCount === 1 ? "gap" : "gaps"}`,
        attr: {
          "data-practice-lab-description": "Show aspects that the approved source bundle does not currently support.",
        },
      });
      const gapList = gaps.createEl("ul");
      for (const gap of learning.unresolvedSourceGapTitles) {
        gapList.createEl("li", { text: gap });
      }
      gaps.createEl("p", {
        text: "Resolve a gap by explicitly adding supporting material or remove it from the path. The plugin does not fill it from general knowledge.",
      });
    }

    const evidence = card.createEl("details", {
      cls: "practice-lab-analytics-table-details",
    });
    evidence.createEl("summary", {
      text: "Details",
      attr: {
        "data-practice-lab-description": "Expand source coverage, assistance, and historical evidence for this path.",
      },
    });
    evidence.createEl("p", {
      cls: "practice-lab-dashboard-note",
      text: `${percentText(learning.sourceCoveragePercent)} source coverage · ${percentText(learning.assistanceRatePercent)} assistance rate · ${learning.hintsRevealed} hints · ${learning.retries} retries · ${percentText(learning.recoveryRatePercent)} recovery after difficulty. Guided support never inflates independent performance.`,
    });
    evidence.createEl("p", {
      cls: "practice-lab-dashboard-note",
      text: "Unpractised means no scored independent evidence. Developing means some evidence. Consistent evidence requires at least three independent attempts across two sessions with at least 80% weighted performance.",
    });
    this.renderLearningEvidenceTable(evidence, "Aspect evidence", "Aspect", learning.aspects);
    this.renderLearningEvidenceTable(evidence, "Practice-set evidence", "Set", learning.sets);
  }

  private renderLearningRecommendation(
    container: HTMLElement,
    learning: DashboardLearningPathSummary,
    record: DashboardBankRecord | undefined,
  ): void {
    const recommendation = learning.recommendation;
    if (recommendation === null) {
      container.createEl("p", {
        cls: "practice-lab-dashboard-note",
        text: "No next step is currently recommended. Current evidence may already satisfy each available step, or the path may have no supported next target. You can still open any set or lesson.",
      });
      return;
    }
    const card = container.createDiv({
      cls: "practice-lab-dashboard-type-card",
      attr: {
        role: "note",
        "aria-label": `Recommended next: ${recommendation.title}`,
      },
    });
    card.createEl("strong", { text: `Recommended next: ${recommendation.title}` });
    const reasons = card.createEl("ul");
    for (const reason of recommendation.reasons) reasons.createEl("li", { text: reason });
    card.createEl("p", {
      text: "This recommendation is derived locally from prerequisites and independent evidence. It is guidance only: nothing is locked, scheduled, or due.",
    });
    const actions = card.createDiv({ cls: "practice-lab-dashboard-bank-actions" });
    if (record !== undefined && this.options.continueLearning !== undefined) {
      new ButtonComponent(actions)
        .setIcon(recommendation.kind === "lesson" ? "book-open" : "play")
        .setButtonText(recommendation.kind === "lesson" ? "Open recommended lesson" : "Start recommended set")
        .setTooltip("Open the current locally recommended path step. You remain free to choose any other lesson or set.")
        .onClick(() => void this.runAction(
          () => this.options.continueLearning?.(record),
          "Could not open the recommended learning step.",
        ));
    }
    new ButtonComponent(actions)
      .setIcon("x")
      .setButtonText("Ignore for now")
      .setTooltip("Hide this suggestion until the dashboard is rendered again. No learning data is changed.")
      .onClick(() => {
        card.empty();
        const status = card.createEl("p", {
          text: "Recommendation hidden for this dashboard view. No learning data was changed.",
          attr: { role: "status", tabindex: "-1" },
        });
        status.focus();
      });
  }

  private renderLearningEvidenceTable(
    container: HTMLElement,
    caption: string,
    nameLabel: string,
    rows: readonly DashboardLearningEvidenceRow[],
  ): void {
    const heading = container.createEl("h5", { text: caption });
    heading.title = `${caption} is calculated only from scored independent attempts; guided support is shown separately.`;
    if (rows.length === 0) {
      container.createEl("p", {
        cls: "practice-lab-dashboard-empty-inline",
        text: `No ${nameLabel.toLocaleLowerCase()} evidence is available.`,
      });
      return;
    }
    const scroll = container.createDiv({ cls: "practice-lab-table-scroll" });
    const table = scroll.createEl("table");
    table.createEl("caption", { text: caption });
    const header = table.createTHead().insertRow();
    for (const [label, description] of [
      [nameLabel, `Current or historical ${nameLabel.toLocaleLowerCase()} name.`],
      ["Evidence", "Transparent evidence state based only on scored independent work."],
      ["Independent performance", "Weighted score from independent attempts; guided attempts are excluded."],
      ["Independent attempts", "Scored independent attempts and the number of sessions containing them."],
      ["Guided support", "Guided attempts, hints, retries, and explicit recovery outcomes."],
    ] as const) {
      const cell = header.createEl("th", { text: label, attr: { title: description } });
      cell.scope = "col";
    }
    const body = table.createTBody();
    for (const row of rows) {
      const tableRow = body.insertRow();
      const name = tableRow.insertCell();
      name.createEl("strong", { text: row.title });
      if (row.historicalOnly) {
        name.createSpan({
          text: " Historical",
          attr: {
            title: "This saved evidence belongs to a set or aspect that is no longer in the current path.",
          },
        });
      }
      tableRow.insertCell().createSpan({
        text: row.state,
        attr: { title: evidenceStateDescription(row) },
      });
      const performance = tableRow.insertCell();
      performance.appendText(percentText(row.weightedPercent));
      if (row.pendingReviewCount + row.failedReviewCount > 0) {
        performance.createEl("small", {
          text: ` · ${row.pendingReviewCount} pending · ${row.failedReviewCount} failed review`,
        });
      }
      tableRow.insertCell().appendText(
        `${row.independentAttempts} across ${row.independentSessionCount} ${row.independentSessionCount === 1 ? "session" : "sessions"}`,
      );
      tableRow.insertCell().appendText(
        `${row.guidedAttempts} guided · ${row.hintsRevealed} hints · ${row.retries} retries · ${row.recoveredCount} recovered · ${row.unresolvedCount} unresolved`,
      );
    }
  }

  private renderActivityAnalytics(summary: PracticeDashboardSummary): void {
    const preferences = this.displayPreferences.dashboard;
    const availableViews = [
      ...(preferences.showActivityHeatmap
        ? [{ id: "heatmap", label: "Heatmap" } as const]
        : []),
      ...(preferences.showActivityTrend
        ? [{ id: "trend", label: "Trend" } as const]
        : []),
      ...(preferences.showPerformanceTrend
        ? [{ id: "performance", label: "Performance" } as const]
        : []),
      ...(preferences.showOutcomeChart
        ? [{ id: "outcomes", label: "Outcomes" } as const]
        : []),
    ] satisfies readonly { readonly id: DashboardActivityView; readonly label: string }[];
    if (availableViews.length === 0) {
      this.renderStatus(
        "Activity visualisations are hidden in dashboard settings.",
        "chart-no-axes-column",
      );
      return;
    }
    if (!availableViews.some((view) => view.id === this.activityView)) {
      this.activityView = availableViews[0]?.id ?? "heatmap";
    }
    const activity = buildPracticeActivity(summary.recentSessions, {
      rangeWeeks: this.activityRangeWeeks,
      weekStart: this.activityWeekStart,
    });
    const section = this.dashboardSection(
      "Practice activity",
      "Completed sessions in the current dashboard scope. These graphs describe past work only; they do not create due dates, quotas, or review schedules.",
    );
    const controls = section.createDiv({ cls: "practice-lab-dashboard-activity-controls" });
    const views = controls.createDiv({
      cls: "practice-lab-dashboard-activity-views",
      attr: { role: "group", "aria-label": "Activity visualisation" },
    });
    for (const view of availableViews) {
      const button = views.createEl("button", {
        text: view.label,
        cls: view.id === this.activityView ? "is-active" : "",
        attr: {
          type: "button",
          "aria-pressed": String(view.id === this.activityView),
        },
      });
      button.addEventListener("click", () => {
        this.activityView = view.id;
        this.render();
      });
    }
    new Setting(controls)
      .setName("Window")
      .setDesc("Changes this dashboard view only.")
      .addDropdown((dropdown) => dropdown
        .addOption("13", "13 Weeks")
        .addOption("26", "26 Weeks")
        .addOption("52", "52 Weeks")
        .setValue(String(this.activityRangeWeeks))
        .onChange((value) => {
          this.activityRangeWeeks = Number(value) as ActivityRangeWeeks;
          this.render();
        }));
    if (this.activityView === "trend") {
      new Setting(controls)
        .setName("Trend metric")
        .setDesc("Changes this dashboard view only.")
        .addDropdown((dropdown) => dropdown
          .addOption("answers", "Answers")
          .addOption("sessions", "Sessions")
          .addOption("minutes", "Practice time")
          .setValue(this.activityMetric)
          .onChange((value) => {
            this.activityMetric = value as ActivityMetric;
            this.render();
          }));
    }

    const chart = section.createDiv({ cls: "practice-lab-dashboard-active-chart" });
    if (this.activityView === "heatmap") this.renderActivityHeatmap(chart, activity);
    if (this.activityView === "trend") this.renderActivityTrend(chart, activity);
    if (this.activityView === "performance") this.renderPerformanceTrend(chart, activity);
    if (this.activityView === "outcomes") this.renderOutcomeChart(chart, summary);

    if (preferences.showActivitySummary) {
      const summaryDetails = section.createEl("details", {
        cls: "practice-lab-analytics-table-details",
      });
      summaryDetails.createEl("summary", { text: "Activity summary" });
      const metrics = summaryDetails.createDiv({ cls: "practice-lab-dashboard-metrics practice-lab-activity-metrics" });
      this.dashboardMetric(
        metrics,
        "Active days",
        String(activity.activeDayCount),
        `${activity.rangeWeeks}-week window`,
      );
      this.dashboardMetric(
        metrics,
        "Practice sessions",
        String(activity.sessionCount),
        `${activity.answerCount} completed answers`,
      );
      this.dashboardMetric(
        metrics,
        "Practice time",
        durationText(activity.durationMs),
        "Elapsed session time",
      );
      this.dashboardMetric(
        metrics,
        "Window performance",
        percentText(activity.performancePercent),
        `${formatPracticeRunPoints(activity.earnedPoints)} / ${activity.scoredAnswerCount} scored points`,
      );
    }
    if (this.activityView === "trend" || this.activityView === "performance") {
      this.renderWeeklyActivityTable(section, activity);
    }
    if (preferences.showRecentSessions) {
      const recent = section.createEl("details", {
        cls: "practice-lab-analytics-table-details",
      });
      recent.createEl("summary", { text: "Recent sessions" });
      const previousHost = this.activePanelEl;
      this.activePanelEl = recent;
      this.renderRecentSessions(summary);
      this.activePanelEl = previousHost;
    }
    if (preferences.showTypeBreakdown) {
      const breakdown = section.createEl("details", {
        cls: "practice-lab-analytics-table-details",
      });
      breakdown.createEl("summary", { text: "Performance by exercise type" });
      const previousHost = this.activePanelEl;
      this.activePanelEl = breakdown;
      this.renderTypeBreakdown(summary);
      this.activePanelEl = previousHost;
    }
    section.createEl("p", {
      cls: "practice-lab-dashboard-note",
      text: "A single day can be noisy. Use the longer trend and source scope to interpret changes; Practice Problem Generator never turns this history into a due queue.",
    });
  }

  private renderActivityHeatmap(
    container: HTMLElement,
    activity: PracticeActivitySummary,
  ): void {
    const heading = container.createDiv({ cls: "practice-lab-chart-heading" });
    heading.createEl("h4", { text: "Activity heatmap" });
    const busiest = activity.busiestDay;
    heading.createSpan({
      text: busiest === null
        ? "No completed practice in this window"
        : `Busiest: ${formatDay(busiest)} · ${busiest.answerCount} answers`,
    });
    const scroll = container.createDiv({ cls: "practice-lab-heatmap-scroll" });
    const layout = scroll.createDiv({ cls: "practice-lab-heatmap-layout" });
    const labels = layout.createDiv({ cls: "practice-lab-heatmap-weekdays", attr: { "aria-hidden": "true" } });
    const weekdayLabels = this.activityWeekStart === "monday"
      ? ["M", "", "W", "", "F", "", "S"]
      : ["S", "", "T", "", "T", "", "S"];
    for (const label of weekdayLabels) labels.createSpan({ text: label });
    const grid = layout.createDiv({
      cls: "practice-lab-heatmap-grid",
      attr: {
        role: "group",
        "aria-label": `${activity.rangeWeeks}-week practice activity heatmap`,
      },
    });
    for (const day of activity.days) {
      const cell = grid.createEl("button", {
        cls: `practice-lab-heatmap-day${day.future ? " is-future" : ""}`,
        attr: {
          type: "button",
          "data-level": String(day.intensity),
          "aria-label": activityDayLabel(day),
          title: activityDayLabel(day),
        },
      });
      if (day.future) {
        cell.disabled = true;
        cell.tabIndex = -1;
        cell.setAttribute("aria-hidden", "true");
      }
    }
    const range = container.createDiv({ cls: "practice-lab-heatmap-range" });
    range.createSpan({ text: activity.startDateKey });
    const legend = range.createDiv({ cls: "practice-lab-heatmap-legend", attr: { "aria-label": "Heatmap intensity legend" } });
    legend.createSpan({ text: "Less" });
    for (let level = 0; level <= 4; level += 1) {
      legend.createSpan({
        cls: "practice-lab-heatmap-legend-cell",
        attr: { "data-level": String(level), "aria-hidden": "true" },
      });
    }
    legend.createSpan({ text: "More" });
    range.createSpan({ text: activity.endDateKey });
  }

  private renderActivityTrend(
    container: HTMLElement,
    activity: PracticeActivitySummary,
  ): void {
    const label = activityMetricLabel(this.activityMetric);
    container.createEl("h4", { text: `${label} by week` });
    const values = activity.weeks.map((week) => activityMetricValue(week, this.activityMetric));
    const maximum = Math.max(0, ...values);
    if (maximum === 0) {
      container.createEl("p", {
        cls: "practice-lab-dashboard-empty-inline",
        text: `No ${label.toLocaleLowerCase()} to graph in this window.`,
      });
      return;
    }
    const chart = container.createDiv({
      cls: "practice-lab-activity-chart-scroll",
      attr: { role: "group", "aria-label": `${label} per week` },
    });
    const bars = chart.createDiv({ cls: "practice-lab-activity-bars" });
    for (const [index, week] of activity.weeks.entries()) {
      const value = values[index] ?? 0;
      const column = bars.createDiv({ cls: "practice-lab-activity-bar-column" });
      const bar = column.createSpan({
        cls: "practice-lab-activity-bar",
        attr: {
          tabindex: "0",
          role: "img",
          "aria-label": weeklyMetricLabel(week, this.activityMetric),
          title: weeklyMetricLabel(week, this.activityMetric),
        },
      });
      bar.style.height = `${value === 0 ? 0 : Math.max(3, value / maximum * 100)}%`;
      if (index === 0 || index === activity.weeks.length - 1 || index % Math.ceil(activity.weeks.length / 6) === 0) {
        column.createSpan({
          cls: "practice-lab-activity-bar-label",
          text: shortWeekLabel(week),
          attr: { "aria-hidden": "true" },
        });
      }
    }
  }

  private renderPerformanceTrend(
    container: HTMLElement,
    activity: PracticeActivitySummary,
  ): void {
    container.createEl("h4", { text: "Performance by week" });
    const scoredWeeks = activity.weeks.filter((week) => week.performancePercent !== null);
    if (scoredWeeks.length === 0) {
      container.createEl("p", {
        cls: "practice-lab-dashboard-empty-inline",
        text: "No scored answers are available for a performance trend in this window.",
      });
      return;
    }
    const scroll = container.createDiv({ cls: "practice-lab-activity-chart-scroll" });
    const svg = scroll.createSvg("svg");
    svg.classList.add("practice-lab-performance-chart");
    svg.setAttribute("viewBox", "0 0 720 190");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Weekly scored-answer performance from zero to one hundred percent");
    const plot = { left: 38, right: 702, top: 14, bottom: 158 };
    for (const value of [100, 50, 0]) {
      const y = plot.top + (100 - value) / 100 * (plot.bottom - plot.top);
      const line = svg.createSvg("line");
      line.setAttribute("x1", String(plot.left));
      line.setAttribute("x2", String(plot.right));
      line.setAttribute("y1", String(y));
      line.setAttribute("y2", String(y));
      line.classList.add("practice-lab-performance-gridline");
      const text = svg.createSvg("text");
      text.setAttribute("x", "2");
      text.setAttribute("y", String(y + 4));
      text.textContent = `${value}%`;
      text.classList.add("practice-lab-performance-axis-label");
    }
    const xFor = (index: number): number => activity.weeks.length <= 1
      ? plot.left
      : plot.left + index / (activity.weeks.length - 1) * (plot.right - plot.left);
    const yFor = (percent: number): number => plot.top
      + (100 - percent) / 100 * (plot.bottom - plot.top);
    let segment: string[] = [];
    const appendSegment = (): void => {
      if (segment.length < 2) {
        segment = [];
        return;
      }
      const polyline = svg.createSvg("polyline");
      polyline.setAttribute("points", segment.join(" "));
      polyline.classList.add("practice-lab-performance-line");
      segment = [];
    };
    for (const [index, week] of activity.weeks.entries()) {
      const percent = week.performancePercent;
      if (percent === null) {
        appendSegment();
        continue;
      }
      const x = xFor(index);
      const y = yFor(percent);
      segment.push(`${x},${y}`);
      const point = svg.createSvg("circle");
      point.setAttribute("cx", String(x));
      point.setAttribute("cy", String(y));
      point.setAttribute("r", week.provisionalSessionCount > 0 ? "4.5" : "3.5");
      point.classList.add("practice-lab-performance-point");
      if (week.provisionalSessionCount > 0) point.classList.add("is-provisional");
      const title = point.createSvg("title");
      title.textContent = weeklyPerformanceLabel(week);
    }
    appendSegment();
    const labels = container.createDiv({ cls: "practice-lab-chart-range" });
    labels.createSpan({ text: shortWeekLabel(activity.weeks[0]) });
    labels.createSpan({ text: shortWeekLabel(activity.weeks.at(-1)) });
  }

  private renderOutcomeChart(
    container: HTMLElement,
    summary: PracticeDashboardSummary,
  ): void {
    container.createEl("h4", { text: "Scored answer outcomes" });
    const score = summary.performance;
    if (score.totalPoints === 0) {
      container.createEl("p", {
        cls: "practice-lab-dashboard-empty-inline",
        text: "No scored answers are available for an outcome graph.",
      });
      return;
    }
    const chart = container.createDiv({
      cls: "practice-lab-outcome-chart",
      attr: {
        role: "img",
        "aria-label": `${score.correct} correct, ${score.partial} partial, and ${score.incorrect} incorrect scored answers`,
      },
    });
    for (const [kind, value] of [
      ["correct", score.correct],
      ["partial", score.partial],
      ["incorrect", score.incorrect],
    ] as const) {
      if (value === 0) continue;
      const segment = chart.createSpan({
        cls: `practice-lab-outcome-segment is-${kind}`,
        attr: { "aria-hidden": "true" },
      });
      segment.style.width = `${value / score.totalPoints * 100}%`;
    }
    const legend = container.createDiv({ cls: "practice-lab-outcome-legend" });
    for (const [kind, label, value] of [
      ["correct", "Correct", score.correct],
      ["partial", "Partial", score.partial],
      ["incorrect", "Incorrect", score.incorrect],
    ] as const) {
      const item = legend.createSpan();
      item.createSpan({ cls: `practice-lab-outcome-key is-${kind}`, attr: { "aria-hidden": "true" } });
      item.appendText(`${label} ${value}`);
    }
    if (summary.pendingAiReviewCount + summary.failedAiReviewCount > 0) {
      container.createEl("p", {
        cls: "practice-lab-dashboard-note",
        text: `${summary.pendingAiReviewCount} pending and ${summary.failedAiReviewCount} failed AI-reviewed ${summary.pendingAiReviewCount + summary.failedAiReviewCount === 1 ? "answer is" : "answers are"} intentionally outside this scored distribution.`,
      });
    }
  }

  private renderWeeklyActivityTable(
    container: HTMLElement,
    activity: PracticeActivitySummary,
  ): void {
    const details = container.createEl("details", {
      cls: "practice-lab-analytics-table-details",
    });
    details.createEl("summary", { text: "View weekly data table" });
    const scroll = details.createDiv({ cls: "practice-lab-table-scroll" });
    const table = scroll.createEl("table");
    const header = table.createTHead().insertRow();
    for (const label of ["Week of", "Sessions", "Answers", "Time", "Performance", "Status"]) {
      const cell = header.createEl("th");
      cell.scope = "col";
      cell.textContent = label;
    }
    const body = table.createTBody();
    for (const week of activity.weeks.filter((item) => item.sessionCount > 0)) {
      const row = body.insertRow();
      for (const value of [
        formatWeekStart(week),
        String(week.sessionCount),
        String(week.answerCount),
        durationText(week.durationMs),
        percentText(week.performancePercent),
        week.provisionalSessionCount > 0 ? "Provisional" : "Settled",
      ]) {
        row.insertCell().textContent = value;
      }
    }
    if (body.rows.length === 0) {
      const row = body.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 6;
      cell.textContent = "No completed sessions in this window.";
    }
  }

  private renderTypeBreakdown(summary: PracticeDashboardSummary): void {
    if (summary.typeBreakdown.length === 0) return;
    const section = this.dashboardSection(
      "Performance by exercise type",
      "Attempts from exercises removed by later bank revisions remain in totals but are listed as unmapped.",
    );
    const grid = section.createDiv({ cls: "practice-lab-dashboard-type-grid" });
    for (const type of summary.typeBreakdown) {
      const card = grid.createDiv({ cls: "practice-lab-dashboard-type-card" });
      const heading = card.createDiv({ cls: "practice-lab-dashboard-type-heading" });
      heading.createEl("strong", { text: EXERCISE_TYPE_LABELS[type.type] });
      heading.createSpan({ text: percentText(type.performance.percent) });
      this.performanceBar(
        card,
        type.performance.percent,
        `${EXERCISE_TYPE_LABELS[type.type]} performance`,
      );
      card.createEl("p", {
        text: `${type.answerCount} answers · ${type.problemCount} problems · ${type.unpracticedProblemCount} unattempted`,
      });
    }
    if (summary.unmappedAnswerCount > 0) {
      section.createEl("p", {
        cls: "practice-lab-dashboard-note",
        text: `${summary.unmappedAnswerCount} historical ${summary.unmappedAnswerCount === 1 ? "answer no longer maps" : "answers no longer map"} to the current exercise revisions and is excluded from the type breakdown.`,
      });
    }
  }

  private performanceBar(
    container: HTMLElement,
    percent: number | null,
    label: string,
  ): void {
    const track = container.createDiv({
      cls: "practice-lab-performance-track",
      attr: {
        role: "progressbar",
        "aria-label": label,
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        ...(percent === null
          ? { "aria-valuetext": "No scored answers" }
          : { "aria-valuenow": String(percent) }),
      },
    });
    const fill = track.createDiv({ cls: "practice-lab-performance-fill" });
    fill.style.width = `${percent ?? 0}%`;
  }

  private renderRecentSessions(summary: PracticeDashboardSummary): void {
    const section = this.dashboardSection(
      "Recent sessions",
      "The newest completed sessions across the current scope.",
    );
    if (summary.recentSessions.length === 0) {
      section.createEl("p", {
        cls: "practice-lab-dashboard-empty-inline",
        text: "No completed sessions in this scope yet.",
      });
      return;
    }
    const list = section.createDiv({ cls: "practice-lab-dashboard-session-list" });
    const sourcePathsByTitle = new Map<string, Set<string>>();
    for (const recent of summary.recentSessions) {
      const key = recent.sourceTitle.toLocaleLowerCase();
      const paths = sourcePathsByTitle.get(key) ?? new Set<string>();
      paths.add(recent.sourcePath);
      sourcePathsByTitle.set(key, paths);
    }
    for (const recent of summary.recentSessions.slice(0, 10)) {
      const row = list.createDiv({ cls: "practice-lab-dashboard-session" });
      const heading = row.createDiv({ cls: "practice-lab-dashboard-session-heading" });
      const sameTitleSourceCount = sourcePathsByTitle.get(
        recent.sourceTitle.toLocaleLowerCase(),
      )?.size ?? 0;
      const parent = sourceFolder(recent.sourcePath);
      heading.createEl("strong", {
        text: sameTitleSourceCount > 1
          ? `${recent.sourceTitle} — ${parent.length === 0 ? "Vault root" : parent}`
          : recent.sourceTitle,
      });
      heading.createSpan({
        text: new Date(recent.session.finishedAt).toLocaleString(),
      });
      row.createEl("p", {
        text: `${recent.session.provisional ? "Provisional · " : ""}${practiceRunRankText(recent.session.practiceRun.rank)} · ${percentText(recent.session.performance.percent)} · ${recent.session.completedCount}/${recent.session.exerciseCount} answered${recent.session.skippedCount === 0 ? "" : ` · ${recent.session.skippedCount} skipped`} · ${recent.session.pendingAiReviewCount} AI pending · ${durationText(recent.session.durationMs)}`,
      });
    }
  }

  private renderBankSection(
    summary: PracticeDashboardSummary,
    records: readonly DashboardBankRecord[],
  ): void {
    const section = this.dashboardSection(
      "Library",
      "Search saved practice and open secondary actions only when you need them.",
    );
    const search = section.createEl("input", {
      cls: "practice-lab-dashboard-search",
      attr: {
        type: "search",
        value: this.search,
        placeholder: "Search source titles, paths, or tags…",
        "aria-label": "Search practice banks",
      },
    });
    const host = section.createDiv({ cls: "practice-lab-dashboard-bank-list" });
    const refresh = (): void => {
      host.empty();
      const query = this.search.trim().toLocaleLowerCase();
      const filtered = summary.banks.filter((bank) =>
        query.length === 0 || [
          bank.sourceTitle,
          bank.sourcePath,
          ...bank.sourceTags,
        ].some((value) => value.toLocaleLowerCase().includes(query)),
      );
      if (filtered.length === 0) {
        host.createEl("p", {
          cls: "practice-lab-dashboard-empty-inline",
          text: "No source matches this search.",
        });
        return;
      }
      for (const bank of filtered) {
        const record = records.find((entry) => entry.bankPath === bank.bankPath);
        if (record !== undefined) this.renderBankCard(host, bank, record);
      }
    };
    search.addEventListener("input", () => {
      this.search = search.value;
      refresh();
    });
    refresh();
  }

  private renderBankCard(
    container: HTMLElement,
    bank: DashboardBankSummary,
    record: DashboardBankRecord,
  ): void {
    const card = container.createDiv({ cls: "practice-lab-dashboard-bank" });
    const heading = card.createDiv({ cls: "practice-lab-dashboard-bank-heading" });
    const title = heading.createDiv();
    title.createEl("h4", { text: bank.sourceTitle });
    const preferences = this.displayPreferences.dashboard;
    if (preferences.showBankPaths) {
      title.createEl("p", { text: bank.sourcePath });
    }
    if (preferences.showPerformance) {
      const score = heading.createDiv({ cls: "practice-lab-dashboard-bank-score" });
      score.createEl("strong", { text: percentText(bank.performance.percent) });
      score.createSpan({ text: bank.provisional ? "Provisional performance" : "Performance" });
    }

    const facets = card.createDiv({ cls: "practice-lab-dashboard-facets" });
    const folder = sourceFolder(bank.sourcePath);
    if (folder.length > 0) {
      const folderButton = facets.createEl("button", {
        cls: "practice-lab-dashboard-folder",
        text: folder,
        attr: { type: "button", "aria-label": `Filter by folder ${folder}` },
      });
      folderButton.addEventListener("click", () => {
        this.primary = { kind: "folder", path: folder };
        this.render();
      });
    }
    if (preferences.showBankTags) {
      for (const tag of bank.sourceTags) {
        const button = facets.createEl("button", {
          cls: "practice-lab-dashboard-tag",
          text: `#${tag}`,
          attr: { type: "button", "aria-label": `Filter by tag #${tag}` },
        });
        button.addEventListener("click", () => {
          this.tagPrefix = tag;
          this.render();
        });
      }
    }
    if (!bank.sourceExists) {
      facets.createSpan({
        cls: "practice-lab-dashboard-warning",
        text: "Source note missing",
      });
    }

    if (preferences.showBankActivity) {
      const statistics = card.createDiv({ cls: "practice-lab-dashboard-bank-stats" });
      statistics.createSpan({
        text: `${bank.problemCount} problems · ${bank.sessionCount} completed ${bank.sessionCount === 1 ? "session" : "sessions"} · ${bank.latestSessionAt === null ? "Not practised yet" : `Last practised ${new Date(bank.latestSessionAt).toLocaleDateString()}`}`,
      });
      if (bank.reviewedAiResponseCount + bank.pendingAiReviewCount + bank.failedAiReviewCount > 0) {
        statistics.createSpan({
          cls: bank.pendingAiReviewCount + bank.failedAiReviewCount > 0
            ? "practice-lab-dashboard-warning"
            : "",
          text: `AI reviews: ${bank.pendingAiReviewCount} pending · ${bank.failedAiReviewCount} failed`,
        });
      }
    }

    const actions = card.createDiv({ cls: "practice-lab-dashboard-bank-actions" });
    const recovery = this.recoveryPresentation();
    const recoveryMatches = recovery?.bankId === record.bank.bankId
      && this.options.handleRecovery !== undefined;
    if (recoveryMatches && recovery !== undefined) {
      const recoveryAction = recovery.state === "resumable" ? "resume" : "resolve";
      new ButtonComponent(actions)
        .setIcon(recovery.state === "resumable" ? "history" : "circle-alert")
        .setButtonText(recovery.actionLabel
          ?? (recovery.state === "resumable" ? "Resume" : "Resolve"))
        .setCta()
        .onClick(() => void this.runAction(
          () => this.options.handleRecovery?.(recoveryAction),
          "Could not open the saved session.",
        ));
    } else if (record.bank.learningPath !== null && this.options.continueLearning !== undefined) {
      new ButtonComponent(actions)
        .setIcon("route")
        .setButtonText("Continue")
        .setTooltip("Continue the locally recommended tutor lesson or practice set.")
        .setCta()
        .onClick(() => void this.runAction(
          () => this.options.continueLearning?.(record),
          "Could not continue this learning path.",
        ));
    } else {
      new ButtonComponent(actions)
        .setIcon("play")
        .setButtonText("Start")
        .setTooltip("Start a practice run across this saved bank.")
        .setCta()
        .onClick(() => void this.runAction(
          () => this.options.startPractice(record),
          "Could not start this practice bank.",
        ));
    }

    const more = card.createEl("details", {
      cls: "practice-lab-dashboard-bank-more",
    });
    more.createEl("summary", {
      text: "More…",
      attr: {
        "data-practice-lab-description": "Show alternate practice modes, note actions, and data controls.",
      },
    });
    const moreActions = more.createDiv({ cls: "practice-lab-dashboard-bank-actions" });
    if (record.bank.learningPath !== null) {
      if (this.options.chooseSet !== undefined) {
        new ButtonComponent(moreActions)
          .setIcon("list")
          .setButtonText("Choose a set")
          .setTooltip("Choose any named practice set without progression locks.")
          .onClick(() => void this.runAction(
            () => this.options.chooseSet?.(record),
            "Could not open the set chooser.",
          ));
      }
      if (this.options.mixedPractice !== undefined) {
        new ButtonComponent(moreActions)
          .setIcon("shuffle")
          .setButtonText("Mixed practice")
          .setTooltip("Combine all named sets without replaying tutor lessons.")
          .onClick(() => void this.runAction(
            () => this.options.mixedPractice?.(record),
            "Could not start mixed practice.",
          ));
      }
      new ButtonComponent(moreActions)
        .setIcon("play")
        .setButtonText("Free practice")
        .setTooltip("Practice every saved question without tutor sequencing.")
        .onClick(() => void this.runAction(
          () => this.options.startPractice(record),
          "Could not start this practice bank.",
        ));
    }
    if (this.options.regenerate !== undefined && record.bank.learningPath === null) {
      const regenerate = new ButtonComponent(moreActions)
        .setIcon("refresh-cw")
        .setButtonText("Regenerate / tweak")
        .setDisabled(!record.sourceExists);
      regenerate.onClick(() => void this.runAction(
        () => this.options.regenerate?.(record),
        "Could not prepare this bank for regeneration.",
      ));
    }
    if (record.bank.learningPath !== null && this.options.manageLearningPath !== undefined) {
      new ButtonComponent(moreActions)
        .setIcon("settings-2")
        .setButtonText("Manage path")
        .onClick(() => void this.runAction(
          () => this.options.manageLearningPath?.(record),
          "Could not open the learning-path manager.",
        ));
    }
    new ButtonComponent(moreActions)
      .setIcon("notebook-tabs")
      .setButtonText("Open bank")
      .onClick(() => void this.runAction(
        () => this.options.openBank(record),
        "Could not open this practice bank.",
      ));
    const openSource = new ButtonComponent(moreActions)
      .setIcon("file-text")
      .setButtonText("Open source")
      .setDisabled(!record.sourceExists);
    openSource.onClick(() => void this.runAction(
      () => this.options.openSource(record),
      "Could not open the source note.",
    ));
    if (this.options.deleteBank !== undefined) {
      const dataActions = more.createEl("details", {
        cls: "practice-lab-dashboard-data-actions",
      });
      dataActions.createEl("summary", { text: "Data actions" });
      dataActions.createEl("p", {
        text: "Deleting a bank removes its generated problems and full history. The source note and original attachments are never deleted.",
      });
      const remove = new ButtonComponent(dataActions)
        .setIcon("trash-2")
        .setButtonText("Move bank to trash…")
        .setDestructive();
      remove.onClick(() => void this.runAction(async () => {
        await this.options.deleteBank?.(record);
        await this.refresh();
      }, "Could not move this practice bank to trash."));
    }
  }

  private async runAction(
    action: () => Promise<void> | void,
    fallback: string,
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : fallback, 8_000);
    }
  }

  private recoveryPresentation(): DashboardRecoveryPresentation | null {
    const presentation = this.options.recoveryPresentation;
    return typeof presentation === "function"
      ? presentation()
      : presentation ?? null;
  }

  private renderDiagnostics(
    snapshot: PracticeDashboardSnapshot,
    summary?: PracticeDashboardSummary,
  ): void {
    const duplicateRecords = summary?.excludedDuplicateRecords ?? [];
    const duplicateCount = duplicateRecords.length;
    const missingSourceCount = summary?.missingSourceCount ?? 0;
    if (
      snapshot.issues.length === 0
      && duplicateCount === 0
      && missingSourceCount === 0
    ) return;
    const attentionCount = snapshot.issues.length
      + duplicateCount
      + missingSourceCount;
    const details = this.dashboardContainer().createEl("details", {
      cls: "practice-lab-dashboard-diagnostics",
    });
    details.createEl("summary", {
      text: `${attentionCount} dashboard ${attentionCount === 1 ? "item needs" : "items need"} attention`,
    });
    if (duplicateCount > 0) {
      details.createEl("p", {
        text: `${summary?.duplicateBankIdCount ?? 0} duplicated bank ${(summary?.duplicateBankIdCount ?? 0) === 1 ? "identifier affects" : "identifiers affect"} this scope. ${summary?.excludedDuplicateRecordCount ?? 0} matching ${(summary?.excludedDuplicateRecordCount ?? 0) === 1 ? "record was" : "records were"} excluded. ${duplicateCount} collision ${duplicateCount === 1 ? "record is" : "records are"} listed below so every copy can be identified.`,
      });
      for (const record of duplicateRecords) {
        const row = details.createDiv({
          cls: "practice-lab-dashboard-diagnostic",
        });
        row.createEl("strong", { text: "Duplicate bank identifier" });
        row.createSpan({ text: record.bankId });
        row.createEl("p", { text: `Bank: ${record.bankPath}` });
        row.createEl("p", {
          text: `Source: ${record.sourceTitle} — ${record.sourcePath}`,
        });
      }
    }
    if (missingSourceCount > 0) {
      details.createEl("p", {
        text: `${missingSourceCount} practice ${missingSourceCount === 1 ? "bank points" : "banks point"} to a source note that is missing or was moved. Its saved history remains available.`,
      });
    }
    for (const issue of snapshot.issues) {
      const row = details.createDiv({ cls: "practice-lab-dashboard-diagnostic" });
      row.createEl("strong", {
        text: issue.severity === "error" ? "Error" : "Warning",
      });
      row.createSpan({ text: issue.bankPath });
      row.createEl("p", { text: issue.message });
    }
  }

  private dashboardSection(
    title: string,
    description: string,
  ): HTMLElement {
    const section = this.dashboardContainer().createEl("section", {
      cls: "practice-lab-dashboard-section",
    });
    const heading = section.createDiv({ cls: "practice-lab-section-heading" });
    heading.createEl("h3", { text: title });
    heading.createEl("p", { text: description });
    return section;
  }

  private renderStatus(
    message: string,
    iconName: string,
    role: "alert" | "status" = "status",
  ): void {
    const state = this.dashboardContainer().createDiv({
      cls: "practice-lab-empty",
      attr: {
        role,
        "aria-live": role === "alert" ? "assertive" : "polite",
      },
    });
    const icon = state.createDiv({ cls: "practice-lab-empty-icon" });
    setIcon(icon, iconName);
    state.createEl("p", { text: message });
  }
}
