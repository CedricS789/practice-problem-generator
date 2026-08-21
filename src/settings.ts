import { App, Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import type PracticeLabPlugin from "./main";
import {
  balanceExerciseTypes,
  copyExerciseTypePercentages,
  enabledExerciseTypes,
  normalizeExerciseTypePercentages,
  rebalanceExerciseTypePercentage,
  RECOMMENDED_EXERCISE_TYPE_PERCENTAGES,
  toggleExerciseType,
} from "./exercise-distribution";
import type { GifFramePositionV1, ReasoningEffortV1 } from "./model";
import {
  copyDisplayPreferences,
  DEFAULT_DISPLAY_PREFERENCES,
  displayPreset,
  normalizeDisplayPreferences,
  type DisplayPreset,
  type PracticeLabDisplayPreferences,
  type StudyOrderDefault,
  type VisualSelectionDefault,
} from "./preferences";
import {
  displayReasoningEffort,
  normalizeReasoningEffort,
  reasoningEffortDescription,
  reasoningEffortsForProvider,
} from "./reasoning";
import { installHoverDescriptions } from "./ui/hover-descriptions";
import { normalizeGifFrameDefault } from "./settings-values";
import {
  DEFAULT_AGY_MODEL,
  MAX_MODEL_ID_LENGTH,
  normalizeModelId,
} from "./model-selection";
import type {
  ActivityMetric,
  ActivityRangeWeeks,
  WeekStart,
} from "./activity-analytics";

export type ProviderId = "codex" | "claude" | "agy";
export type AnswerReviewDefault = "self" | "ai";
export type Difficulty = "foundation" | "exam" | "challenge";
export type ExerciseTypeId =
  | "short-answer"
  | "causal-explanation"
  | "application"
  | "calculation"
  | "cloze"
  | "single-select"
  | "multi-select"
  | "matching"
  | "ordering"
  | "image-occlusion";

export interface PracticeLabSettings {
  provider: ProviderId;
  codexModel: string;
  claudeModel: string;
  agyModel: string;
  reasoningEffort: ReasoningEffortV1;
  gifFrameDefault: GifFramePositionV1;
  quantity: number;
  difficulty: Difficulty;
  defaultFocusInstructions: string;
  visualSelectionDefault: VisualSelectionDefault;
  studyOrderDefault: StudyOrderDefault;
  exerciseTypePercentages: Record<ExerciseTypeId, number>;
  timeoutMs: number;
  answerReviewDefault: AnswerReviewDefault;
  answerReviewProvider: ProviderId;
  answerReviewReasoningEffort: ReasoningEffortV1;
  answerReviewTimeoutMs: number;
  codexExecutable: string;
  claudeExecutable: string;
  agyExecutable: string;
  ffmpegExecutable: string;
  ffprobeExecutable: string;
  pdfinfoExecutable: string;
  pdftotextExecutable: string;
  pdfDefaultPageCount: number;
  pdfMaxPageCount: number;
  pdfMaxExtractedCharacters: number;
  pdfExtractionTimeoutMs: number;
  dashboardActivityRangeWeeks: ActivityRangeWeeks;
  dashboardActivityMetric: ActivityMetric;
  dashboardWeekStart: WeekStart;
  display: PracticeLabDisplayPreferences;
}

export const DEFAULT_SETTINGS: PracticeLabSettings = {
  provider: "codex",
  codexModel: "",
  claudeModel: "",
  agyModel: DEFAULT_AGY_MODEL,
  reasoningEffort: "medium",
  gifFrameDefault: "middle",
  quantity: 10,
  difficulty: "exam",
  defaultFocusInstructions: "",
  visualSelectionDefault: "manual",
  studyOrderDefault: "bank",
  exerciseTypePercentages: copyExerciseTypePercentages(
    RECOMMENDED_EXERCISE_TYPE_PERCENTAGES,
  ),
  timeoutMs: 300_000,
  answerReviewDefault: "self",
  answerReviewProvider: "codex",
  answerReviewReasoningEffort: "high",
  answerReviewTimeoutMs: 120_000,
  codexExecutable: "codex",
  claudeExecutable: "claude",
  agyExecutable: "agy",
  ffmpegExecutable: "ffmpeg",
  ffprobeExecutable: "ffprobe",
  pdfinfoExecutable: "pdfinfo",
  pdftotextExecutable: "pdftotext",
  pdfDefaultPageCount: 12,
  pdfMaxPageCount: 40,
  pdfMaxExtractedCharacters: 120_000,
  pdfExtractionTimeoutMs: 120_000,
  dashboardActivityRangeWeeks: 52,
  dashboardActivityMetric: "answers",
  dashboardWeekStart: "monday",
  display: copyDisplayPreferences(DEFAULT_DISPLAY_PREFERENCES),
};

export function normalizeSettings(value: unknown): PracticeLabSettings {
  const partial = value && typeof value === "object" ? value as Partial<PracticeLabSettings> : {};
  const provider = partial.provider === "claude" || partial.provider === "agy" ? partial.provider : "codex";
  const reasoningEffort = normalizeReasoningEffort(provider, partial.reasoningEffort);
  const gifFrameDefault = normalizeGifFrameDefault(partial.gifFrameDefault);
  const difficulty = partial.difficulty === "foundation" || partial.difficulty === "challenge"
    ? partial.difficulty
    : "exam";
  const quantity = Number.isInteger(partial.quantity)
    ? Math.min(30, Math.max(1, partial.quantity ?? 10))
    : 10;
  const timeoutMs = Number.isFinite(partial.timeoutMs)
    ? Math.min(900_000, Math.max(30_000, partial.timeoutMs ?? 300_000))
    : 300_000;
  const answerReviewDefault = partial.answerReviewDefault === "ai" ? "ai" : "self";
  const answerReviewProvider = partial.answerReviewProvider === "claude" || partial.answerReviewProvider === "agy"
    ? partial.answerReviewProvider
    : "codex";
  const answerReviewReasoningEffort = normalizeReasoningEffort(
    answerReviewProvider,
    partial.answerReviewReasoningEffort ?? "high",
  );
  const answerReviewTimeoutMs = Number.isFinite(partial.answerReviewTimeoutMs)
    ? Math.min(300_000, Math.max(30_000, partial.answerReviewTimeoutMs ?? 120_000))
    : 120_000;
  const defaultFocusInstructions = typeof partial.defaultFocusInstructions === "string"
    ? partial.defaultFocusInstructions.slice(0, 4_000)
    : "";
  const pdfMaxPageCount = boundedInteger(partial.pdfMaxPageCount, 1, 100, 40);
  const pdfDefaultPageCount = boundedInteger(
    partial.pdfDefaultPageCount,
    1,
    pdfMaxPageCount,
    Math.min(12, pdfMaxPageCount),
  );
  const pdfMaxExtractedCharacters = boundedInteger(
    partial.pdfMaxExtractedCharacters,
    20_000,
    250_000,
    120_000,
  );
  const pdfExtractionTimeoutMs = boundedInteger(
    partial.pdfExtractionTimeoutMs,
    30_000,
    300_000,
    120_000,
  );
  return {
    provider,
    codexModel: normalizeModelId(partial.codexModel),
    claudeModel: normalizeModelId(partial.claudeModel),
    agyModel: normalizeModelId(partial.agyModel, DEFAULT_AGY_MODEL),
    reasoningEffort,
    gifFrameDefault,
    difficulty,
    defaultFocusInstructions,
    visualSelectionDefault: partial.visualSelectionDefault === "all-local"
      ? "all-local"
      : "manual",
    studyOrderDefault: partial.studyOrderDefault === "shuffle" ? "shuffle" : "bank",
    quantity,
    timeoutMs,
    answerReviewDefault,
    answerReviewProvider,
    answerReviewReasoningEffort,
    answerReviewTimeoutMs,
    exerciseTypePercentages: normalizeExerciseTypePercentages(
      partial.exerciseTypePercentages,
    ),
    codexExecutable: cleanExecutable(partial.codexExecutable, "codex"),
    claudeExecutable: cleanExecutable(partial.claudeExecutable, "claude"),
    agyExecutable: cleanExecutable(partial.agyExecutable, "agy"),
    ffmpegExecutable: cleanExecutable(partial.ffmpegExecutable, "ffmpeg"),
    ffprobeExecutable: cleanExecutable(partial.ffprobeExecutable, "ffprobe"),
    pdfinfoExecutable: cleanExecutable(partial.pdfinfoExecutable, "pdfinfo"),
    pdftotextExecutable: cleanExecutable(partial.pdftotextExecutable, "pdftotext"),
    pdfDefaultPageCount,
    pdfMaxPageCount,
    pdfMaxExtractedCharacters,
    pdfExtractionTimeoutMs,
    dashboardActivityRangeWeeks:
      partial.dashboardActivityRangeWeeks === 13
      || partial.dashboardActivityRangeWeeks === 26
        ? partial.dashboardActivityRangeWeeks
        : 52,
    dashboardActivityMetric:
      partial.dashboardActivityMetric === "sessions"
      || partial.dashboardActivityMetric === "minutes"
        ? partial.dashboardActivityMetric
        : "answers",
    dashboardWeekStart: partial.dashboardWeekStart === "sunday"
      ? "sunday"
      : "monday",
    display: normalizeDisplayPreferences(partial.display),
  };
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return Number.isInteger(value)
    ? Math.min(maximum, Math.max(minimum, value as number))
    : fallback;
}

function cleanExecutable(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export class PracticeLabSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly owner: PracticeLabPlugin) {
    super(app, owner);
  }

  display(): void {
    this.containerEl.empty();
    this.containerEl.addClass("practice-lab-settings");
    installHoverDescriptions(this.containerEl);
    new Setting(this.containerEl)
      .setName("Control center")
      .setHeading();
    this.containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Choose the defaults for new work and decide how much information each Grounded Problems surface shows. Safety, consent, validation, and repair controls always remain visible.",
    });

    this.addHeading(
      "Generation defaults",
      "Applied when a new source is loaded. You can still override every value in Configure.",
    );
    new Setting(this.containerEl)
      .setName("Default AI provider")
      .setDesc("Grounded Problems never switches providers automatically.")
      .addDropdown((dropdown) => dropdown
        .addOption("codex", "Codex")
        .addOption("claude", "Claude")
        .addOption("agy", "agy")
        .setValue(this.owner.settings.provider)
        .onChange(async (value) => {
          this.owner.settings.provider = value as ProviderId;
          this.owner.settings.reasoningEffort = normalizeReasoningEffort(
            this.owner.settings.provider,
            this.owner.settings.reasoningEffort,
          );
          await this.owner.saveSettings();
          this.update();
        }));

    new Setting(this.containerEl)
      .setName("Default reasoning effort")
      .setDesc(reasoningEffortDescription(this.owner.settings.provider))
      .addDropdown((dropdown) => {
        for (const effort of reasoningEffortsForProvider(this.owner.settings.provider)) {
          dropdown.addOption(effort, displayReasoningEffort(effort));
        }
        dropdown
          .setValue(this.owner.settings.reasoningEffort)
          .onChange(async (value) => {
            this.owner.settings.reasoningEffort = value as ReasoningEffortV1;
            await this.owner.saveSettings();
          });
      });

    this.addModelDefault(
      "Codex model",
      "codexModel",
      "Optional exact Codex model. Leave blank to use the provider default; history will record that it was not pinned.",
    );
    this.addModelDefault(
      "Claude model",
      "claudeModel",
      "Optional exact Claude model or alias. Leave blank to use the provider default; history will record that it was not pinned.",
    );
    this.addModelDefault(
      "agy model",
      "agyModel",
      "Exact agy model. The installed Grounded Problems default is preserved unless you change it.",
    );

    new Setting(this.containerEl)
      .setName("Default exercise count")
      .setDesc("One to thirty draft exercises per generation.")
      .addSlider((slider) => slider
        .setLimits(1, 30, 1)
        .setValue(this.owner.settings.quantity)
        .onChange(async (value) => {
          this.owner.settings.quantity = value;
          await this.owner.saveSettings();
        }));

    new Setting(this.containerEl)
      .setName("Default difficulty")
      .setDesc("Deep exam practice is the recommended starting point.")
      .addDropdown((dropdown) => dropdown
        .addOption("foundation", "Foundational")
        .addOption("exam", "Deep exam practice")
        .addOption("challenge", "Challenge")
        .setValue(this.owner.settings.difficulty)
        .onChange(async (value) => {
          this.owner.settings.difficulty = value as Difficulty;
          await this.owner.saveSettings();
        }));

    const focus = new Setting(this.containerEl)
      .setName("Default focus instructions")
      .setDesc("Optional reusable guidance for new generations. Per-set edits remain possible in configure.");
    const focusCount = focus.descEl.createSpan({
      cls: "practice-lab-focus-count",
      text: `${this.owner.settings.defaultFocusInstructions.length} / 4,000`,
    });
    focus.addTextArea((text) => {
      text.inputEl.rows = 3;
      text.inputEl.maxLength = 4_000;
      text
        .setPlaceholder("Example: Prefer causal and calculation questions; avoid definition-only prompts.")
        .setValue(this.owner.settings.defaultFocusInstructions)
        .onChange(async (value) => {
          this.owner.settings.defaultFocusInstructions = value.slice(0, 4_000);
          focusCount.setText(`${this.owner.settings.defaultFocusInstructions.length} / 4,000`);
          await this.owner.saveSettings();
        });
    });

    new Setting(this.containerEl)
      .setName("Default visual selection")
      .setDesc("Manual is privacy-first. The automatic option selects ready local images and prepares GIF default frames; videos and remote images still require review.")
      .addDropdown((dropdown) => dropdown
        .addOption("manual", "Choose manually")
        .addOption("all-local", "Select local images and GIFs")
        .setValue(this.owner.settings.visualSelectionDefault)
        .onChange(async (value) => {
          this.owner.settings.visualSelectionDefault = value as VisualSelectionDefault;
          await this.owner.saveSettings();
        }));

    new Setting(this.containerEl)
      .setName("Default GIF frame")
      .setDesc("Used automatically when selecting a GIF. You can still choose a different frame for any individual GIF.")
      .addDropdown((dropdown) => dropdown
        .addOption("first", "First")
        .addOption("middle", "Middle")
        .addOption("last", "Last")
        .setValue(this.owner.settings.gifFrameDefault)
        .onChange(async (value) => {
          this.owner.settings.gifFrameDefault = value as GifFramePositionV1;
          await this.owner.saveSettings();
        }));

    this.addHeading(
      "PDF source defaults",
      "PDF text is extracted locally from an explicit page range. These limits keep one provider payload reviewable; every range can still be changed in the PDF dialog.",
    );
    new Setting(this.containerEl)
      .setName("Default PDF page window")
      .setDesc("Number of pages selected initially when the PDF dialog opens.")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.max = String(this.owner.settings.pdfMaxPageCount);
        text.inputEl.step = "1";
        text
          .setValue(String(this.owner.settings.pdfDefaultPageCount))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (!Number.isInteger(parsed)) return;
            this.owner.settings.pdfDefaultPageCount = Math.min(
              this.owner.settings.pdfMaxPageCount,
              Math.max(1, parsed),
            );
            await this.owner.saveSettings();
          });
      });
    new Setting(this.containerEl)
      .setName("Maximum PDF pages per generation")
      .setDesc("One to one hundred pages. A narrower range usually produces better grounded practice.")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.max = "100";
        text.inputEl.step = "1";
        text
          .setValue(String(this.owner.settings.pdfMaxPageCount))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (!Number.isInteger(parsed)) return;
            this.owner.settings.pdfMaxPageCount = Math.min(100, Math.max(1, parsed));
            this.owner.settings.pdfDefaultPageCount = Math.min(
              this.owner.settings.pdfDefaultPageCount,
              this.owner.settings.pdfMaxPageCount,
            );
            await this.owner.saveSettings();
          });
      });
    new Setting(this.containerEl)
      .setName("Maximum extracted PDF characters")
      .setDesc("Twenty thousand to two hundred fifty thousand characters. Grounded Problems fails closed instead of truncating source evidence silently.")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "20000";
        text.inputEl.max = "250000";
        text.inputEl.step = "1000";
        text
          .setValue(String(this.owner.settings.pdfMaxExtractedCharacters))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (!Number.isInteger(parsed)) return;
            this.owner.settings.pdfMaxExtractedCharacters = Math.min(
              250_000,
              Math.max(20_000, parsed),
            );
            await this.owner.saveSettings();
          });
      });

    this.addExerciseMixEditor();
    new Setting(this.containerEl)
      .setName("Restore generation defaults")
      .setDesc("Restore provider, models, reasoning, count, difficulty, focus, visual selection, GIF frame, and exercise mix. Executable paths are unchanged.")
      .addButton((button) => button
        .setButtonText("Restore")
        .onClick(() => void this.restoreGenerationDefaults()));

    this.addHeading(
      "Study defaults",
      "Controls the initial session behavior. The review choice and provider can still be changed during a session.",
    );
    new Setting(this.containerEl)
      .setName("Exercise order")
      .setDesc("Keep the reviewed bank order or shuffle a fresh copy when each session starts.")
      .addDropdown((dropdown) => dropdown
        .addOption("bank", "Use bank order")
        .addOption("shuffle", "Shuffle each session")
        .setValue(this.owner.settings.studyOrderDefault)
        .onChange(async (value) => {
          this.owner.settings.studyOrderDefault = value as StudyOrderDefault;
          await this.owner.saveSettings();
        }));

    new Setting(this.containerEl)
      .setName("Default free-response review")
      .setDesc("Self-assessment stays local. Background AI review is optional and never blocks the next question.")
      .addDropdown((dropdown) => dropdown
        .addOption("self", "Self-assess")
        .addOption("ai", "AI review in background")
        .setValue(this.owner.settings.answerReviewDefault)
        .onChange(async (value) => {
          this.owner.settings.answerReviewDefault = value === "ai" ? "ai" : "self";
          await this.owner.saveSettings();
        }));

    new Setting(this.containerEl)
      .setName("Answer-review provider")
      .setDesc("Used only when AI review is selected. Grounded Problems never switches providers automatically.")
      .addDropdown((dropdown) => dropdown
        .addOption("codex", "Codex")
        .addOption("claude", "Claude")
        .addOption("agy", "agy")
        .setValue(this.owner.settings.answerReviewProvider)
        .onChange(async (value) => {
          this.owner.settings.answerReviewProvider = value as ProviderId;
          this.owner.settings.answerReviewReasoningEffort = normalizeReasoningEffort(
            this.owner.settings.answerReviewProvider,
            this.owner.settings.answerReviewReasoningEffort,
          );
          await this.owner.saveSettings();
          this.update();
        }));

    new Setting(this.containerEl)
      .setName("Answer-review reasoning effort")
      .setDesc(`${reasoningEffortDescription(this.owner.settings.answerReviewProvider)} The chosen level is locked into each queued review.`)
      .addDropdown((dropdown) => {
        for (const effort of reasoningEffortsForProvider(this.owner.settings.answerReviewProvider)) {
          dropdown.addOption(effort, displayReasoningEffort(effort));
        }
        dropdown
          .setValue(this.owner.settings.answerReviewReasoningEffort)
          .onChange(async (value) => {
            this.owner.settings.answerReviewReasoningEffort = value as ReasoningEffortV1;
            await this.owner.saveSettings();
          });
      });
    new Setting(this.containerEl)
      .setName("Restore study defaults")
      .setDesc("Restore bank order and local self-assessment defaults. Saved sessions are unchanged.")
      .addButton((button) => button
        .setButtonText("Restore")
        .onClick(() => void this.restoreStudyDefaults()));

    this.addHeading(
      "Interface presets",
      "Start from a coherent visibility preset, then customize individual items below. Presets change presentation only, never saved scores or history.",
    );
    new Setting(this.containerEl)
      .setName("Visibility preset")
      .setDesc("Detailed shows everything, focused removes secondary metadata, and minimal keeps only core controls and outcomes.")
      .addButton((button) => button
        .setButtonText("Detailed")
        .onClick(() => void this.applyDisplayPreset("detailed")))
      .addButton((button) => button
        .setButtonText("Focused")
        .onClick(() => void this.applyDisplayPreset("focused")))
      .addButton((button) => button
        .setButtonText("Minimal")
        .onClick(() => void this.applyDisplayPreset("minimal")));

    this.addPracticeViewSettings();
    this.addBankStatisticsSettings();
    this.addDashboardSettings();
    this.addDataManagementSettings();

    const advanced = this.addSettingsGroup(
      "Advanced runtime",
      "Process limits and executable locations. Changing an executable refreshes provider detection after the active job finishes.",
    );
    new Setting(advanced)
      .setName("Generation timeout")
      .setDesc("Seconds before the active CLI process is cancelled.")
      .addText((text) => text
        .setPlaceholder("300")
        .setValue(String(Math.round(this.owner.settings.timeoutMs / 1000)))
        .onChange(async (value) => {
          const seconds = Number(value);
          if (!Number.isFinite(seconds)) return;
          this.owner.settings.timeoutMs = Math.min(900_000, Math.max(30_000, seconds * 1000));
          await this.owner.saveSettings();
        }));

    new Setting(advanced)
      .setName("Answer-review timeout")
      .setDesc("Seconds allowed for one background answer review before a bounded retry.")
      .addText((text) => text
        .setPlaceholder("120")
        .setValue(String(Math.round(this.owner.settings.answerReviewTimeoutMs / 1_000)))
        .onChange(async (value) => {
          const seconds = Number(value);
          if (!Number.isFinite(seconds)) return;
          this.owner.settings.answerReviewTimeoutMs = Math.min(
            300_000,
            Math.max(30_000, seconds * 1_000),
          );
          await this.owner.saveSettings();
        }));

    new Setting(advanced)
      .setName("PDF extraction timeout")
      .setDesc("Seconds allowed for local PDF inspection or text extraction.")
      .addText((text) => text
        .setPlaceholder("120")
        .setValue(String(Math.round(this.owner.settings.pdfExtractionTimeoutMs / 1_000)))
        .onChange(async (value) => {
          const seconds = Number(value);
          if (!Number.isFinite(seconds)) return;
          this.owner.settings.pdfExtractionTimeoutMs = Math.min(
            300_000,
            Math.max(30_000, seconds * 1_000),
          );
          await this.owner.saveSettings();
        }));

    this.addExecutableSetting("Codex executable", "codexExecutable", advanced);
    this.addExecutableSetting("Claude executable", "claudeExecutable", advanced);
    this.addExecutableSetting("agy executable", "agyExecutable", advanced);
    this.addExecutableSetting("FFmpeg executable", "ffmpegExecutable", advanced);
    this.addExecutableSetting("FFprobe executable", "ffprobeExecutable", advanced);
    this.addExecutableSetting("PDFinfo executable", "pdfinfoExecutable", advanced);
    this.addExecutableSetting("PDF-to-text executable", "pdftotextExecutable", advanced);

    new Setting(advanced)
      .setName("Test agy vision")
      .setDesc("Runs a synthetic one-pixel headless test. No note or vault attachment is used, and vision stays blocked unless the test passes.")
      .addButton((button) => button
        .setButtonText("Run test")
        .setDisabled(Platform.isMobileApp)
        .onClick(async () => {
          button.setDisabled(true).setButtonText("Testing…");
          try {
            new Notice(await this.owner.testAgyVisionCapability(), 10_000);
          } catch (error) {
            new Notice(error instanceof Error ? error.message : "agy vision testing failed.", 10_000);
          } finally {
            button.setDisabled(Platform.isMobileApp).setButtonText("Run test");
          }
        }));
  }

  private addExecutableSetting(
    name: string,
    key:
      | "codexExecutable"
      | "claudeExecutable"
      | "agyExecutable"
      | "ffmpegExecutable"
      | "ffprobeExecutable"
      | "pdfinfoExecutable"
      | "pdftotextExecutable",
    container: HTMLElement = this.containerEl,
  ): void {
    new Setting(container)
      .setName(name)
      .setDesc("Command name or an absolute executable path. Arguments are never accepted here.")
      .addText((text) => text
        .setValue(this.owner.settings[key])
        .onChange(async (value) => {
          const cleaned = value.trim();
          if (!cleaned) return;
          this.owner.settings[key] = cleaned;
          const providerExecutable =
            key === "codexExecutable"
            || key === "claudeExecutable"
            || key === "agyExecutable";
          if (providerExecutable) {
            await this.owner.saveSettings({ refreshProviders: true });
          } else {
            await this.owner.saveSettings();
          }
        }));
  }

  private addHeading(name: string, description: string): void {
    new Setting(this.containerEl).setName(name).setDesc(description).setHeading();
  }

  private addExerciseMixEditor(): void {
    const details = this.containerEl.createEl("details", {
      cls: "practice-lab-settings-details",
    });
    const summary = details.createEl("summary");
    summary.createEl("strong", { text: "Default exercise mix" });
    summary.createSpan({ text: " · exact percentages, always totaling 100%" });
    const toolbar = details.createDiv({ cls: "practice-lab-settings-actions" });
    const status = toolbar.createSpan({
      cls: "practice-lab-settings-total",
      attr: { role: "status", "aria-live": "polite" },
    });
    const controls = new Map<ExerciseTypeId, {
      readonly refresh: (value: number, onlySelected: boolean) => void;
    }>();
    const apply = (next: Record<ExerciseTypeId, number>): void => {
      this.owner.settings.exerciseTypePercentages = next;
      refresh();
      void this.owner.saveSettings();
    };
    new Setting(toolbar)
      .setName("Mix presets")
      .addButton((button) => button
        .setButtonText("Recommended")
        .onClick(() => apply(copyExerciseTypePercentages(RECOMMENDED_EXERCISE_TYPE_PERCENTAGES))))
      .addButton((button) => button
        .setButtonText("Core reasoning")
        .onClick(() => apply(balanceExerciseTypes([
          "short-answer",
          "causal-explanation",
          "application",
          "calculation",
        ]))))
      .addButton((button) => button
        .setButtonText("Equal selected")
        .onClick(() => apply(balanceExerciseTypes(enabledExerciseTypes(
          this.owner.settings.exerciseTypePercentages,
        )))));
    const labels: Readonly<Record<ExerciseTypeId, string>> = {
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
    for (const type of Object.keys(labels) as ExerciseTypeId[]) {
      const row = new Setting(details).setName(labels[type]);
      row.addToggle((toggle) => {
        toggle.onChange((enabled) => {
          apply(toggleExerciseType(
            this.owner.settings.exerciseTypePercentages,
            type,
            enabled,
          ));
        });
        row.addText((text) => {
          text.inputEl.type = "number";
          text.inputEl.min = "0";
          text.inputEl.max = "100";
          text.inputEl.step = "1";
          text.inputEl.setAttribute("aria-label", `${labels[type]} default percentage`);
          text.onChange((value) => {
            const parsed = Number.parseInt(value, 10);
            if (!Number.isFinite(parsed)) {
              refresh();
              return;
            }
            apply(rebalanceExerciseTypePercentage(
              this.owner.settings.exerciseTypePercentages,
              type,
              parsed,
            ));
          });
          controls.set(type, {
            refresh: (value, onlySelected) => {
              toggle.setValue(value > 0).setDisabled(value > 0 && onlySelected);
              text.setValue(String(value)).setDisabled(value === 0 || onlySelected);
            },
          });
        });
      });
    }
    const refresh = (): void => {
      const selected = enabledExerciseTypes(this.owner.settings.exerciseTypePercentages);
      status.setText(`${selected.length} selected · 100% allocated`);
      for (const [type, control] of controls) {
        const value = this.owner.settings.exerciseTypePercentages[type];
        control.refresh(value, selected.length === 1);
      }
    };
    refresh();
  }

  private addPracticeViewSettings(): void {
    const group = this.addSettingsGroup(
      "Grounded Problems view",
      "Choose information density for source, review, study, and completion. Grounded answers and required AI-review notices cannot be hidden.",
    );
    new Setting(group)
      .setName("Interface density")
      .setDesc("Compact reduces spacing without removing controls.")
      .addDropdown((dropdown) => dropdown
        .addOption("comfortable", "Comfortable")
        .addOption("compact", "Compact")
        .setValue(this.owner.settings.display.practice.density)
        .onChange(async (value) => {
          this.owner.settings.display.practice.density = value === "compact" ? "compact" : "comfortable";
          await this.owner.saveSettings();
        }));
    this.addDisplayToggle("Show view introduction", "Show the short description below the Grounded Problems title.", "practice", "showHeaderDescription", group);
    this.addDisplayToggle("Show generation stepper", "Show Source, Configure, and Review navigation steps.", "practice", "showGenerationStepper", group);
    this.addDisplayToggle("Show source path", "Show the vault-relative source path.", "practice", "showSourcePath", group);
    this.addDisplayToggle("Show source excerpt", "Show the source preview in the Source stage.", "practice", "showSourceExcerpt", group);
    this.addDisplayToggle("Expand payload preview", "Open the exact provider payload by default. It always remains available.", "practice", "expandPayloadPreview", group);
    this.addDisplayToggle("Show draft grounding", "Show cited segment IDs on draft cards.", "practice", "showDraftGrounding", group);
    this.addDisplayToggle("Show draft rationale", "Show generated rationale text while reviewing drafts.", "practice", "showDraftRationale", group);
    this.addDisplayToggle("Show study progress", "Show question number and progress bar.", "practice", "showStudyProgress", group);
    this.addDisplayToggle("Keyboard study shortcuts", "Use Ctrl/Command + Enter for the current primary study action.", "practice", "enableStudyKeyboardShortcuts", group);
    this.addDisplayToggle("Focus the answer field", "Place keyboard focus in the first answer control when each desktop question opens.", "practice", "autoFocusStudyInput", group);
    this.addDisplayToggle("Show keyboard shortcut hint", "Show the compact Ctrl/Command + Enter reminder below a study question.", "practice", "showStudyShortcutHint", group);
    this.addDisplayToggle("Show run points", "Show earned points in the session HUD.", "practice", "showRunPoints", group);
    this.addDisplayToggle("Show answer streak", "Show the current answer streak in the session HUD.", "practice", "showRunStreak", group);
    this.addDisplayToggle("Show run rank", "Show the session-local gamified rank.", "practice", "showRunRank", group);
    this.addDisplayToggle("Show rationale after answering", "Show rationale below the grounded answer.", "practice", "showStudyRationale", group);
    this.addDisplayToggle("Completion performance", "Show the final performance percentage.", "practice", "showCompletionPerformance", group);
    this.addDisplayToggle("Completion streak", "Show the best streak on the completion screen.", "practice", "showCompletionStreak", group);
    this.addDisplayToggle("Completion rank", "Show the final Practice Run rank.", "practice", "showCompletionRank", group);
    this.addDisplayToggle("Completion narrative", "Show the written run and answer summary.", "practice", "showCompletionNarrative", group);
    this.addDisplayToggle("Completion celebration", "Use the celebratory completion icon.", "practice", "celebrateCompletion", group);
  }

  private addBankStatisticsSettings(): void {
    const group = this.addSettingsGroup(
      "Practice bank statistics",
      "Choose what is rendered inside each saved practice note. Pending and failed review actions remain available even when history is hidden.",
    );
    this.addDisplayToggle("Bank metadata", "Show the collapsed revision, update time, and source-scope details.", "bank", "showBankMetadata", group);
    this.addDisplayToggle("Generation history", "Show provider, model, reasoning, prompt, source, mix, and save details for every generated bank revision.", "bank", "showGenerationHistory", group);
    this.addDisplayToggle("Overall score", "All scored answers in this bank.", "bank", "showOverallScore", group);
    this.addDisplayToggle("Latest session", "Score and rank from the newest completed session.", "bank", "showLatestSession", group);
    this.addDisplayToggle("Best session", "Best settled session score.", "bank", "showBestSession", group);
    this.addDisplayToggle("Completion", "Answered items across recorded sessions.", "bank", "showCompletion", group);
    this.addDisplayToggle("Best answer streak", "Longest full-credit answer sequence.", "bank", "showBestStreak", group);
    this.addDisplayToggle("AI-review counts", "Reviewed, pending, and failed free responses.", "bank", "showAiReviews", group);
    this.addDisplayToggle("Answer outcomes", "Objective and free-response outcome summary.", "bank", "showAnswerOutcomes", group);
    this.addDisplayToggle("Performance by exercise type", "Per-type attempts and performance bars.", "bank", "showTypeBreakdown", group);
    this.addDisplayToggle("Session history", "Detailed historical sessions and settled AI feedback.", "bank", "showSessionHistory", group);
  }

  private addDashboardSettings(): void {
    const group = this.addSettingsGroup(
      "Dashboard",
      "Choose overview cards and sections. Scope filters and data-integrity diagnostics always remain visible.",
    );
    new Setting(group)
      .setName("Default analytics range")
      .setDesc("The initial heatmap and trend window. The dashboard can change it without altering saved practice data.")
      .addDropdown((dropdown) => dropdown
        .addOption("13", "13 Weeks")
        .addOption("26", "26 Weeks")
        .addOption("52", "52 Weeks")
        .setValue(String(this.owner.settings.dashboardActivityRangeWeeks))
        .onChange(async (value) => {
          this.owner.settings.dashboardActivityRangeWeeks = value === "13"
            ? 13
            : value === "26" ? 26 : 52;
          await this.owner.saveSettings();
        }));
    new Setting(group)
      .setName("Default activity graph")
      .setDesc("Choose the initial weekly volume metric. This is descriptive history, not a study quota.")
      .addDropdown((dropdown) => dropdown
        .addOption("answers", "Answers")
        .addOption("sessions", "Sessions")
        .addOption("minutes", "Practice time")
        .setValue(this.owner.settings.dashboardActivityMetric)
        .onChange(async (value) => {
          this.owner.settings.dashboardActivityMetric = value === "sessions"
            ? "sessions"
            : value === "minutes" ? "minutes" : "answers";
          await this.owner.saveSettings();
        }));
    new Setting(group)
      .setName("Heatmap week start")
      .setDesc("Start activity weeks on monday or sunday. Dates use the device's local timezone.")
      .addDropdown((dropdown) => dropdown
        .addOption("monday", "Monday")
        .addOption("sunday", "Sunday")
        .setValue(this.owner.settings.dashboardWeekStart)
        .onChange(async (value) => {
          this.owner.settings.dashboardWeekStart = value === "sunday"
            ? "sunday"
            : "monday";
          await this.owner.saveSettings();
        }));
    this.addDisplayToggle("Dashboard introduction", "Show the explanatory sentence below the dashboard title.", "dashboard", "showIntroduction", group);
    this.addDisplayToggle("Scope breadcrumbs", "Show the active folder, source, and tag trail.", "dashboard", "showBreadcrumbs", group);
    this.addDisplayToggle("Performance", "Weighted score across the selected scope.", "dashboard", "showPerformance", group);
    this.addDisplayToggle("Practice-bank count", "Practiced and new bank counts.", "dashboard", "showBankCount", group);
    this.addDisplayToggle("Practice-problem count", "Attempted and unattempted problem counts.", "dashboard", "showProblemCount", group);
    this.addDisplayToggle("Completed-session count", "Sessions and total answers.", "dashboard", "showSessionCount", group);
    this.addDisplayToggle("Session completion", "Completion across recorded session sizes.", "dashboard", "showCompletion", group);
    this.addDisplayToggle("Best answer streak", "Longest full-credit answer sequence.", "dashboard", "showBestStreak", group);
    this.addDisplayToggle("Objective-answer summary", "Locally graded correct and total objective answers.", "dashboard", "showObjectiveAnswers", group);
    this.addDisplayToggle("Free-response summary", "Correct, partial, and incorrect free responses.", "dashboard", "showFreeResponses", group);
    this.addDisplayToggle("AI-review summary", "Reviewed, pending, and failed AI reviews.", "dashboard", "showAiReviews", group);
    this.addDisplayToggle("Activity heatmap", "Calendar of completed practice activity in the selected dashboard scope.", "dashboard", "showActivityHeatmap", group);
    this.addDisplayToggle("Weekly activity graph", "Answers, sessions, or practice time grouped by week.", "dashboard", "showActivityTrend", group);
    this.addDisplayToggle("Weekly performance graph", "Scored-answer performance over time; provisional sessions remain identified.", "dashboard", "showPerformanceTrend", group);
    this.addDisplayToggle("Answer-outcome graph", "Accessible distribution of correct, partial, and incorrect scored answers.", "dashboard", "showOutcomeChart", group);
    this.addDisplayToggle("Performance by exercise type", "Per-type performance cards.", "dashboard", "showTypeBreakdown", group);
    this.addDisplayToggle("Recent sessions", "Ten newest sessions in the selected scope.", "dashboard", "showRecentSessions", group);
    this.addDisplayToggle("Practice-bank list", "Searchable bank cards and actions.", "dashboard", "showBankList", group);
    this.addDisplayToggle("Bank paths", "Show vault-relative source paths on bank cards.", "dashboard", "showBankPaths", group);
    this.addDisplayToggle("Bank tags", "Show source-tag filter chips on bank cards.", "dashboard", "showBankTags", group);
    this.addDisplayToggle("Bank activity details", "Show per-bank counts, AI status, streak, and last-practiced date.", "dashboard", "showBankActivity", group);
  }

  private addDataManagementSettings(): void {
    const group = this.addSettingsGroup(
      "Data management",
      "Destructive controls stay collapsed here. Every action shows its exact scope and requires a typed confirmation; Grounded Problems never clears data automatically.",
    );
    new Setting(group)
      .setName("Reset all settings")
      .setDesc("Restore generation, study, interface, timeout, and executable settings. Generated banks and session history are preserved.")
      .addButton((button) => button
        .setButtonText("Review reset…")
        .setDestructive()
        .onClick(() => void this.runDataAction(
          button.buttonEl,
          () => this.owner.requestResetAllSettings(),
        )));
    new Setting(group)
      .setName("Clear all session history")
      .setDesc("Remove scores, submitted answers, ratings, and AI-review results from every valid practice bank. Exercises, sources, generation history, and settings are preserved. A Markdown backup is created first.")
      .addButton((button) => button
        .setButtonText("Review history clear…")
        .setDestructive()
        .onClick(() => void this.runDataAction(
          button.buttonEl,
          () => this.owner.requestClearAllPracticeHistory(),
        )));
    new Setting(group)
      .setName("Delete all practice banks")
      .setDesc("Move every valid Grounded Problems bank to the configured Obsidian trash. Source notes, PDFs, and original attachments are preserved. Settings are preserved.")
      .addButton((button) => button
        .setButtonText("Review bank deletion…")
        .setDestructive()
        .onClick(() => void this.runDataAction(
          button.buttonEl,
          () => this.owner.requestDeleteAllPracticeBanks(),
        )));
  }

  private async runDataAction(
    button: HTMLButtonElement,
    action: () => Promise<void>,
  ): Promise<void> {
    button.disabled = true;
    try {
      await action();
      this.update();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "The data action failed.", 10_000);
    } finally {
      button.disabled = false;
    }
  }

  private addDisplayToggle<
    Section extends "practice" | "bank" | "dashboard",
    Key extends {
      practice: Exclude<keyof PracticeLabDisplayPreferences["practice"], "density">;
      bank: keyof PracticeLabDisplayPreferences["bank"];
      dashboard: keyof PracticeLabDisplayPreferences["dashboard"];
    }[Section],
  >(
    name: string,
    description: string,
    section: Section,
    key: Key,
    container: HTMLElement = this.containerEl,
  ): void {
    const values = this.owner.settings.display[section] as unknown as Record<Key, boolean>;
    new Setting(container)
      .setName(name)
      .setDesc(description)
      .addToggle((toggle) => toggle
        .setValue(values[key])
        .onChange(async (value) => {
          values[key] = value;
          await this.owner.saveSettings();
        }));
  }

  private addSettingsGroup(name: string, description: string): HTMLElement {
    const details = this.containerEl.createEl("details", {
      cls: "practice-lab-settings-details practice-lab-settings-visibility",
    });
    const summary = details.createEl("summary");
    summary.createEl("strong", { text: name });
    details.createEl("p", {
      cls: "setting-item-description practice-lab-settings-description",
      text: description,
    });
    return details;
  }

  private addModelDefault(
    name: string,
    key: "codexModel" | "claudeModel" | "agyModel",
    description: string,
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) => {
        text.inputEl.maxLength = MAX_MODEL_ID_LENGTH;
        text.inputEl.spellcheck = false;
        text
          .setPlaceholder(key === "agyModel" ? DEFAULT_AGY_MODEL : "Provider default")
          .setValue(this.owner.settings[key])
          .onChange(async (value) => {
            this.owner.settings[key] = normalizeModelId(
              value,
              key === "agyModel" ? DEFAULT_AGY_MODEL : "",
            );
            await this.owner.saveSettings();
          });
      });
  }

  private async applyDisplayPreset(preset: DisplayPreset): Promise<void> {
    this.owner.settings.display = displayPreset(preset);
    await this.owner.saveSettings();
    this.update();
  }

  private async restoreGenerationDefaults(): Promise<void> {
    this.owner.settings.provider = DEFAULT_SETTINGS.provider;
    this.owner.settings.codexModel = DEFAULT_SETTINGS.codexModel;
    this.owner.settings.claudeModel = DEFAULT_SETTINGS.claudeModel;
    this.owner.settings.agyModel = DEFAULT_SETTINGS.agyModel;
    this.owner.settings.reasoningEffort = DEFAULT_SETTINGS.reasoningEffort;
    this.owner.settings.quantity = DEFAULT_SETTINGS.quantity;
    this.owner.settings.difficulty = DEFAULT_SETTINGS.difficulty;
    this.owner.settings.defaultFocusInstructions = DEFAULT_SETTINGS.defaultFocusInstructions;
    this.owner.settings.visualSelectionDefault = DEFAULT_SETTINGS.visualSelectionDefault;
    this.owner.settings.gifFrameDefault = DEFAULT_SETTINGS.gifFrameDefault;
    this.owner.settings.pdfDefaultPageCount = DEFAULT_SETTINGS.pdfDefaultPageCount;
    this.owner.settings.pdfMaxPageCount = DEFAULT_SETTINGS.pdfMaxPageCount;
    this.owner.settings.pdfMaxExtractedCharacters =
      DEFAULT_SETTINGS.pdfMaxExtractedCharacters;
    this.owner.settings.exerciseTypePercentages = copyExerciseTypePercentages(
      DEFAULT_SETTINGS.exerciseTypePercentages,
    );
    await this.owner.saveSettings();
    this.update();
  }

  private async restoreStudyDefaults(): Promise<void> {
    this.owner.settings.studyOrderDefault = DEFAULT_SETTINGS.studyOrderDefault;
    this.owner.settings.answerReviewDefault = DEFAULT_SETTINGS.answerReviewDefault;
    this.owner.settings.answerReviewProvider = DEFAULT_SETTINGS.answerReviewProvider;
    this.owner.settings.answerReviewReasoningEffort =
      DEFAULT_SETTINGS.answerReviewReasoningEffort;
    await this.owner.saveSettings();
    this.update();
  }
}
