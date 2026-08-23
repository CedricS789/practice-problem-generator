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
  dashboardPreset,
  DEFAULT_STUDY_TYPE_SEQUENCE,
  DEFAULT_DISPLAY_PREFERENCES,
  displayPreset,
  migrateLegacyDashboardPreferences,
  normalizeDisplayPreferences,
  normalizeStudyTypeSequence,
  type DisplayPreset,
  type PracticeLabDisplayPreferences,
  type StudyExerciseType,
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
import {
  DEFAULT_AI_TIMEOUT_MS,
  MAX_AI_TIMEOUT_MS,
  MIN_AI_TIMEOUT_MS,
  normalizeAiTimeout,
  normalizeGifFrameDefault,
} from "./settings-values";
import {
  AUTOMATIC_MODEL_CHOICE,
  agyModelForReasoning,
  agyReasoningEffortForModel,
  automaticModelForProvider,
  CUSTOM_MODEL_CHOICE,
  DEFAULT_AGY_MODEL,
  LEGACY_DEFAULT_AGY_MODEL,
  MAX_MODEL_ID_LENGTH,
  type ModelCatalogEntry,
  modelPickerChoice,
  modelIdProblem,
  modelsForProvider,
  normalizeModelId,
  preferredReasoningEffort,
  reasoningEffortsForModel,
} from "./model-selection";
import type {
  ActivityMetric,
  ActivityRangeWeeks,
  WeekStart,
} from "./activity-analytics";
import {
  DEFAULT_PRACTICE_BANK_CUSTOM_FOLDER,
  DEFAULT_PRACTICE_BANK_PATH_TEMPLATE,
  PRACTICE_BANK_PATH_TEMPLATE_TOKENS,
  practiceBankPathPreview,
  practiceBankStoragePolicyProblem,
  type PracticeBankStorageMode,
  type PracticeBankStoragePolicyV1,
} from "./persistence";
import {
  generationDifficultyFromSetting,
  settingDifficultyFromGeneration,
  type StoredDifficulty,
} from "./difficulty";
import { renderDifficultySelector } from "./ui/difficulty-selector";

export type ProviderId = "codex" | "claude" | "agy";
export type AnswerReviewDefault = "self" | "ai";
export type Difficulty = StoredDifficulty;
export type ExerciseTypeId = StudyExerciseType;
export type PracticeViewLocation = "main-tab" | "right-sidebar";

const EXERCISE_TYPE_LABELS: Readonly<Record<ExerciseTypeId, string>> = {
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

export const SETTINGS_SCHEMA_VERSION = 7;
const LEGACY_GENERATION_TIMEOUT_MS = 300_000;
const LEGACY_ANSWER_REVIEW_TIMEOUT_MS = 120_000;

export interface PracticeLabSettings {
  settingsSchemaVersion: number;
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
  studyTypeSequence: ExerciseTypeId[];
  studyShuffleWithinTypesDefault: boolean;
  exerciseTypePercentages: Record<ExerciseTypeId, number>;
  timeoutMs: number;
  recoverInterruptedGenerations: boolean;
  generationRecoveryRetentionHours: number;
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
  practiceBankStorageMode: PracticeBankStorageMode;
  practiceBankCustomFolder: string;
  practiceBankPathTemplate: string;
  practiceViewLocation: PracticeViewLocation;
  dashboardActivityRangeWeeks: ActivityRangeWeeks;
  dashboardActivityMetric: ActivityMetric;
  dashboardWeekStart: WeekStart;
  display: PracticeLabDisplayPreferences;
}

export const DEFAULT_SETTINGS: PracticeLabSettings = {
  settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
  provider: "codex",
  codexModel: "",
  claudeModel: "",
  agyModel: "",
  reasoningEffort: "medium",
  gifFrameDefault: "middle",
  quantity: 10,
  difficulty: "exam",
  defaultFocusInstructions: "",
  visualSelectionDefault: "manual",
  studyOrderDefault: "bank",
  studyTypeSequence: [...DEFAULT_STUDY_TYPE_SEQUENCE],
  studyShuffleWithinTypesDefault: false,
  exerciseTypePercentages: copyExerciseTypePercentages(
    RECOMMENDED_EXERCISE_TYPE_PERCENTAGES,
  ),
  timeoutMs: DEFAULT_AI_TIMEOUT_MS,
  recoverInterruptedGenerations: true,
  generationRecoveryRetentionHours: 168,
  answerReviewDefault: "self",
  answerReviewProvider: "codex",
  answerReviewReasoningEffort: "high",
  answerReviewTimeoutMs: DEFAULT_AI_TIMEOUT_MS,
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
  practiceBankStorageMode: "course",
  practiceBankCustomFolder: DEFAULT_PRACTICE_BANK_CUSTOM_FOLDER,
  practiceBankPathTemplate: DEFAULT_PRACTICE_BANK_PATH_TEMPLATE,
  practiceViewLocation: "main-tab",
  dashboardActivityRangeWeeks: 52,
  dashboardActivityMetric: "answers",
  dashboardWeekStart: "monday",
  display: {
    ...copyDisplayPreferences(DEFAULT_DISPLAY_PREFERENCES),
    dashboard: dashboardPreset("focused"),
  },
};

export function normalizeSettings(value: unknown): PracticeLabSettings {
  const partial = value && typeof value === "object" ? value as Partial<PracticeLabSettings> : {};
  const storedSchemaVersion = Number.isInteger(partial.settingsSchemaVersion)
    ? partial.settingsSchemaVersion ?? 0
    : 0;
  const migrateLegacyTimeouts = storedSchemaVersion < 4;
  const provider = partial.provider === "claude" || partial.provider === "agy" ? partial.provider : "codex";
  const reasoningEffort = normalizeReasoningEffort(provider, partial.reasoningEffort);
  const gifFrameDefault = normalizeGifFrameDefault(partial.gifFrameDefault);
  const difficulty = partial.difficulty === "foundation" || partial.difficulty === "challenge"
    ? partial.difficulty
    : "exam";
  const quantity = Number.isInteger(partial.quantity)
    ? Math.min(30, Math.max(1, partial.quantity ?? 10))
    : 10;
  const timeoutMs = normalizeAiTimeout(
    partial.timeoutMs,
    LEGACY_GENERATION_TIMEOUT_MS,
    migrateLegacyTimeouts,
  );
  const answerReviewDefault = partial.answerReviewDefault === "ai" ? "ai" : "self";
  const answerReviewProvider = partial.answerReviewProvider === "claude" || partial.answerReviewProvider === "agy"
    ? partial.answerReviewProvider
    : "codex";
  const answerReviewReasoningEffort = normalizeReasoningEffort(
    answerReviewProvider,
    partial.answerReviewReasoningEffort ?? "high",
  );
  const answerReviewTimeoutMs = normalizeAiTimeout(
    partial.answerReviewTimeoutMs,
    LEGACY_ANSWER_REVIEW_TIMEOUT_MS,
    migrateLegacyTimeouts,
  );
  const defaultFocusInstructions = typeof partial.defaultFocusInstructions === "string"
    ? partial.defaultFocusInstructions.slice(0, 4_000)
    : "";
  const normalizedAgyModel = normalizeModelId(partial.agyModel);
  const agyModel = migrateLegacyTimeouts && normalizedAgyModel === LEGACY_DEFAULT_AGY_MODEL
    ? DEFAULT_AGY_MODEL
    : normalizedAgyModel;
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
  const storagePolicyCandidate: PracticeBankStoragePolicyV1 = {
    mode: partial.practiceBankStorageMode === "custom" ? "custom" : "course",
    customBaseFolder: typeof partial.practiceBankCustomFolder === "string"
      ? partial.practiceBankCustomFolder.trim().replace(/\\/gu, "/").replace(/\/$/u, "")
      : DEFAULT_PRACTICE_BANK_CUSTOM_FOLDER,
    customPathTemplate: typeof partial.practiceBankPathTemplate === "string"
      ? partial.practiceBankPathTemplate.trim().replace(/\\/gu, "/")
      : DEFAULT_PRACTICE_BANK_PATH_TEMPLATE,
  };
  const storagePolicy = practiceBankStoragePolicyProblem(storagePolicyCandidate) === null
    ? storagePolicyCandidate
    : {
        mode: "course" as const,
        customBaseFolder: DEFAULT_PRACTICE_BANK_CUSTOM_FOLDER,
        customPathTemplate: DEFAULT_PRACTICE_BANK_PATH_TEMPLATE,
      };
  const display = normalizeDisplayPreferences(partial.display);
  if (storedSchemaVersion < 7) {
    display.dashboard = migrateLegacyDashboardPreferences(
      partial.display?.dashboard,
    );
  }
  return {
    settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
    provider,
    codexModel: normalizeModelId(partial.codexModel),
    claudeModel: normalizeModelId(partial.claudeModel),
    agyModel,
    reasoningEffort,
    gifFrameDefault,
    difficulty,
    defaultFocusInstructions,
    visualSelectionDefault: partial.visualSelectionDefault === "all-local"
      ? "all-local"
      : "manual",
    studyOrderDefault:
      partial.studyOrderDefault === "shuffle"
      || partial.studyOrderDefault === "shuffle-types"
      || partial.studyOrderDefault === "type-sequence"
        ? partial.studyOrderDefault
        : "bank",
    studyTypeSequence: normalizeStudyTypeSequence(partial.studyTypeSequence),
    studyShuffleWithinTypesDefault:
      partial.studyShuffleWithinTypesDefault === true,
    quantity,
    timeoutMs,
    recoverInterruptedGenerations: partial.recoverInterruptedGenerations !== false,
    generationRecoveryRetentionHours: boundedInteger(
      partial.generationRecoveryRetentionHours,
      1,
      720,
      168,
    ),
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
    practiceBankStorageMode: storagePolicy.mode,
    practiceBankCustomFolder: storagePolicy.customBaseFolder,
    practiceBankPathTemplate: storagePolicy.customPathTemplate,
    practiceViewLocation: partial.practiceViewLocation === "right-sidebar"
      ? "right-sidebar"
      : "main-tab",
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
    display,
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

function modelKeyForProvider(
  provider: ProviderId,
): "codexModel" | "claudeModel" | "agyModel" {
  if (provider === "claude") return "claudeModel";
  return provider === "agy" ? "agyModel" : "codexModel";
}

export class PracticeLabSettingTab extends PluginSettingTab {
  private modelSettingsSaveChain: Promise<void> = Promise.resolve();

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
      text: "Choose the defaults for new work and decide how much information each Practice Problem Generator surface shows. Safety, consent, validation, and repair controls always remain visible.",
    });

    if (!Platform.isMobileApp) {
      this.addHeading(
        "Generation defaults",
        "Applied when a new source is loaded. You can still override every value in Configure.",
      );
    new Setting(this.containerEl)
      .setName("Default AI provider")
      .setDesc("Practice Problem Generator never switches providers automatically.")
      .addDropdown((dropdown) => dropdown
        .addOption("codex", "Codex")
        .addOption("claude", "Claude")
        .addOption("agy", "agy")
        .setValue(this.owner.settings.provider)
        .onChange(async (value) => {
          this.owner.settings.provider = value as ProviderId;
          this.normalizeDefaultModelReasoning();
          await this.owner.saveSettings();
          this.update();
        }));

    const provider = this.owner.settings.provider;
    const modelKey = modelKeyForProvider(provider);
    const previousReasoningEffort = this.owner.settings.reasoningEffort;
    this.normalizeDefaultModelReasoning();
    const reasoningWasAdjusted = previousReasoningEffort
      !== this.owner.settings.reasoningEffort;
    if (reasoningWasAdjusted) this.queueModelSettingsSave();
    let refreshReasoningControl = (): void => undefined;
    this.addModelDefault(
      "Default model",
      modelKey,
      provider,
      "Automatic follows the selected CLI's default. Each provider remembers its own selection, and Custom accepts a safe exact model ID.",
      () => {
        this.normalizeDefaultModelReasoning();
        refreshReasoningControl();
      },
    );

    const reasoningSetting = new Setting(this.containerEl)
      .setName("Default reasoning effort")
      .setDesc(`${reasoningEffortDescription(provider)} Only levels supported by the selected model are shown.`)
      .addDropdown((dropdown) => {
        refreshReasoningControl = (): void => {
          const efforts = this.defaultModelReasoningEfforts();
          dropdown.selectEl.empty();
          for (const effort of efforts) {
            dropdown.addOption(effort, displayReasoningEffort(effort));
          }
          dropdown.setValue(this.owner.settings.reasoningEffort);
        };
        refreshReasoningControl();
        dropdown.onChange(async (value) => {
          this.owner.settings.reasoningEffort = value as ReasoningEffortV1;
          if (provider === "agy" && this.owner.settings.agyModel.length > 0) {
            this.owner.settings.agyModel = agyModelForReasoning(
              this.owner.settings.agyModel,
              this.owner.settings.reasoningEffort,
              this.modelCatalog("agy"),
            );
          }
          await this.owner.saveSettings();
          if (provider === "agy") this.update();
        });
      });
    reasoningSetting.descEl.createDiv({
      cls: "practice-lab-model-detail",
      text: reasoningWasAdjusted
        ? `Adjusted ${displayReasoningEffort(previousReasoningEffort)} to ${displayReasoningEffort(this.owner.settings.reasoningEffort)} because the selected model does not support the saved level.`
        : "Changing provider reveals that provider's remembered model and compatible reasoning levels.",
    });

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

    const difficultySetting = new Setting(this.containerEl)
      .setName("Default difficulty")
      .setDesc("Default reasoning demand for new quick sets and guided-path sets. You can still change each set before generation.");
    difficultySetting.settingEl.addClass("practice-lab-difficulty-setting");
    renderDifficultySelector(difficultySetting.controlEl, {
      value: generationDifficultyFromSetting(this.owner.settings.difficulty),
      name: "practice-lab-default-difficulty",
      ariaLabel: "Default generation difficulty profile",
      onChange: (value) => {
        this.owner.settings.difficulty = settingDifficultyFromGeneration(value);
        void this.owner.saveSettings();
      },
    });

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
      .setDesc("Twenty thousand to two hundred fifty thousand characters. Practice Problem Generator fails closed instead of truncating source evidence silently.")
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

    this.addPracticeBankStorageSettings();
    this.addExerciseMixEditor();
    new Setting(this.containerEl)
      .setName("Restore generation defaults")
      .setDesc("Restore provider, models, reasoning, count, difficulty, focus, visual selection, GIF frame, and exercise mix. Executable paths are unchanged.")
      .addButton((button) => button
        .setButtonText("Restore")
        .onClick(() => void this.restoreGenerationDefaults()));
    }

    this.addHeading(
      "Study defaults",
      "Controls the initial session behavior. The review choice and provider can still be changed during a session.",
    );
    new Setting(this.containerEl)
      .setName("Exercise order")
      .setDesc("Choose the initial ordering strategy shown in the session setup dialog. It can be changed before every practice run.")
      .addDropdown((dropdown) => dropdown
        .addOption("bank", "Use bank order")
        .addOption("shuffle", "Shuffle every question")
        .addOption("shuffle-types", "Shuffle type blocks")
        .addOption("type-sequence", "Follow custom type sequence")
        .setValue(this.owner.settings.studyOrderDefault)
        .onChange(async (value) => {
          this.owner.settings.studyOrderDefault = value as StudyOrderDefault;
          await this.owner.saveSettings();
        }));
    new Setting(this.containerEl)
      .setName("Shuffle within type blocks")
      .setDesc("For shuffled or custom type blocks, also randomize the questions inside each type. The saved bank order is never modified.")
      .addToggle((toggle) => toggle
        .setValue(this.owner.settings.studyShuffleWithinTypesDefault)
        .onChange(async (value) => {
          this.owner.settings.studyShuffleWithinTypesDefault = value;
          await this.owner.saveSettings();
        }));
    this.addStudyTypeSequenceEditor();

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
      .setDesc("Used only when AI review is selected. Practice Problem Generator never switches providers automatically.")
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
      .setDesc("Restore bank order, the recommended type sequence, within-type ordering, and local self-assessment defaults. Saved sessions are unchanged.")
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

    if (!Platform.isMobileApp) {
      const advanced = this.addSettingsGroup(
        "Advanced runtime",
        "Process limits and executable locations. Changing an executable refreshes provider detection after the active job finishes.",
      );
    new Setting(advanced)
      .setName("Recover interrupted generations")
      .setDesc("Keep the exact ephemeral CLI job running in a detached local helper if Obsidian closes or reloads. Approved source and neutral media stay only in the operating-system temporary directory until the draft is saved, discarded, or expires.")
      .addToggle((toggle) => toggle
        .setValue(this.owner.settings.recoverInterruptedGenerations)
        .onChange(async (value) => {
          this.owner.settings.recoverInterruptedGenerations = value;
          await this.owner.saveSettings();
        }));

    new Setting(advanced)
      .setName("Recovery retention")
      .setDesc("Hours to keep an unfinished or recovered draft before automatic cleanup. Range: 1 to 720 hours; active work is always protected for the full generation timeout plus one hour. Default: 168 hours (7 days).")
      .addText((text) => text
        .setPlaceholder("168")
        .setValue(String(this.owner.settings.generationRecoveryRetentionHours))
        .onChange(async (value) => {
          const hours = Number.parseInt(value, 10);
          if (!Number.isInteger(hours)) return;
          this.owner.settings.generationRecoveryRetentionHours = Math.min(
            720,
            Math.max(1, hours),
          );
          await this.owner.saveSettings();
        }));

    new Setting(advanced)
      .setName("Discard interrupted generation")
      .setDesc("Cancel and remove the current recoverable CLI job, approved source checkpoint, neutral media copies, and unsaved draft. A typed confirmation is required; saved banks and source notes are untouched.")
      .addButton((button) => button
        .setButtonText("Discard…")
        .setDestructive()
        .onClick(() => void this.owner.requestDiscardInterruptedGeneration()));

    new Setting(advanced)
      .setName("Generation timeout")
      .setDesc("Minutes allowed for one generation job, including its single schema-repair attempt. Default: 180 minutes (3 hours).")
      .addText((text) => text
        .setPlaceholder("180")
        .setValue(String(Math.round(this.owner.settings.timeoutMs / 60_000)))
        .onChange(async (value) => {
          const minutes = Number(value);
          if (!Number.isFinite(minutes)) return;
          this.owner.settings.timeoutMs = Math.min(
            MAX_AI_TIMEOUT_MS,
            Math.max(MIN_AI_TIMEOUT_MS, minutes * 60_000),
          );
          await this.owner.saveSettings();
        }));

    new Setting(advanced)
      .setName("Answer-review timeout")
      .setDesc("Minutes allowed for one background AI answer review, including its bounded retry. Default: 180 minutes (3 hours); practice continues while it runs.")
      .addText((text) => text
        .setPlaceholder("180")
        .setValue(String(Math.round(this.owner.settings.answerReviewTimeoutMs / 60_000)))
        .onChange(async (value) => {
          const minutes = Number(value);
          if (!Number.isFinite(minutes)) return;
          this.owner.settings.answerReviewTimeoutMs = Math.min(
            MAX_AI_TIMEOUT_MS,
            Math.max(MIN_AI_TIMEOUT_MS, minutes * 60_000),
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
        .setDisabled(false)
        .onClick(async () => {
          button.setDisabled(true).setButtonText("Testing…");
          try {
            new Notice(await this.owner.testAgyVisionCapability(), 10_000);
          } catch (error) {
            new Notice(error instanceof Error ? error.message : "agy vision testing failed.", 10_000);
          } finally {
            button.setDisabled(false).setButtonText("Run test");
          }
        }));
    }
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

  private addPracticeBankStorageSettings(): void {
    this.addHeading(
      "Practice-bank storage",
      "Choose where newly created practice Markdown workspaces are saved. Existing banks stay at their current paths and remain discoverable; changing this default never moves them.",
    );
    new Setting(this.containerEl)
      .setName("Save-location strategy")
      .setDesc("Per-course preserves Notes/<term>/<course>/Practice/. Custom uses a vault-relative base folder and the path template below.")
      .addDropdown((dropdown) => dropdown
        .addOption("course", "Per-course practice folder")
        .addOption("custom", "Custom folder and template")
        .setValue(this.owner.settings.practiceBankStorageMode)
        .onChange(async (value) => {
          this.owner.settings.practiceBankStorageMode = value === "custom"
            ? "custom"
            : "course";
          await this.owner.saveSettings();
          this.update();
        }));

    if (this.owner.settings.practiceBankStorageMode === "course") {
      this.containerEl.createEl("p", {
        cls: "setting-item-description practice-lab-storage-preview",
        text: "Example: Notes/2025-26 - Q2/ELEC-Y418/Practice/Chapter 8 - Image Sensors - Practice.md",
      });
    } else {
      let folderDraft = this.owner.settings.practiceBankCustomFolder;
      let templateDraft = this.owner.settings.practiceBankPathTemplate;
      let preview: HTMLElement | null = null;
      const candidate = (): PracticeBankStoragePolicyV1 => ({
        mode: "custom",
        customBaseFolder: folderDraft,
        customPathTemplate: templateDraft,
      });
      const renderPreview = (): void => {
        if (preview === null) return;
        const result = practiceBankPathPreview(
          candidate(),
          undefined,
          this.app.vault.configDir,
        );
        preview.toggleClass("is-error", result.problem !== undefined);
        preview.setText(result.path === undefined
          ? `Not saved: ${result.problem ?? "The storage format is invalid."}`
          : `Example PDF bank: ${result.path}`);
      };
      const saveCandidate = async (): Promise<void> => {
        const policy = candidate();
        if (
          practiceBankStoragePolicyProblem(policy, this.app.vault.configDir)
          !== null
        ) return;
        this.owner.settings.practiceBankCustomFolder = policy.customBaseFolder
          .trim()
          .replace(/\\/gu, "/")
          .replace(/\/$/u, "");
        this.owner.settings.practiceBankPathTemplate = policy.customPathTemplate
          .trim()
          .replace(/\\/gu, "/");
        await this.owner.saveSettings();
      };
      new Setting(this.containerEl)
        .setName("Custom base folder")
        .setDesc("Vault-relative folder only. Obsidian configuration, trash, temporary folders, absolute paths, and parent traversal are blocked.")
        .addText((text) => text
          .setPlaceholder(DEFAULT_PRACTICE_BANK_CUSTOM_FOLDER)
          .setValue(folderDraft)
          .onChange(async (value) => {
            folderDraft = value;
            renderPreview();
            await saveCandidate();
          }));
      new Setting(this.containerEl)
        .setName("Path inside the custom folder")
        .setDesc(`Available tokens: ${PRACTICE_BANK_PATH_TEMPLATE_TOKENS.join(", ")}. The result must end in .md and include {source} or {sourceHash}.`)
        .addText((text) => {
          text.inputEl.addClass("practice-lab-storage-template-input");
          text
            .setPlaceholder(DEFAULT_PRACTICE_BANK_PATH_TEMPLATE)
            .setValue(templateDraft)
            .onChange(async (value) => {
              templateDraft = value;
              renderPreview();
              await saveCandidate();
            });
        });
      preview = this.containerEl.createEl("p", {
        cls: "setting-item-description practice-lab-storage-preview",
      });
      renderPreview();
    }

    new Setting(this.containerEl)
      .setName("Restore storage defaults")
      .setDesc("Return new banks to the established per-course practice folder. Existing bank files are not moved.")
      .addButton((button) => button
        .setButtonText("Restore")
        .onClick(async () => {
          this.owner.settings.practiceBankStorageMode = DEFAULT_SETTINGS.practiceBankStorageMode;
          this.owner.settings.practiceBankCustomFolder = DEFAULT_SETTINGS.practiceBankCustomFolder;
          this.owner.settings.practiceBankPathTemplate = DEFAULT_SETTINGS.practiceBankPathTemplate;
          await this.owner.saveSettings();
          this.update();
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
    for (const type of Object.keys(EXERCISE_TYPE_LABELS) as ExerciseTypeId[]) {
      const row = new Setting(details).setName(EXERCISE_TYPE_LABELS[type]);
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
          text.inputEl.setAttribute("aria-label", `${EXERCISE_TYPE_LABELS[type]} default percentage`);
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

  private addStudyTypeSequenceEditor(): void {
    const details = this.containerEl.createEl("details", {
      cls: "practice-lab-settings-details practice-lab-study-sequence-settings",
    });
    const summary = details.createEl("summary");
    summary.createEl("strong", { text: "Default type sequence" });
    summary.createSpan({ text: " · used when custom type sequence is selected" });
    details.createEl("p", {
      cls: "setting-item-description",
      text: "Move exercise types into the progression you prefer. Types absent from a bank are skipped automatically.",
    });
    const list = details.createDiv({ cls: "practice-lab-study-sequence-list" });
    const render = (): void => {
      list.empty();
      for (const [index, type] of this.owner.settings.studyTypeSequence.entries()) {
        const row = new Setting(list)
          .setName(`${index + 1}. ${EXERCISE_TYPE_LABELS[type]}`)
          .setDesc("Questions of this type stay together in sequence mode.");
        row.addButton((button) => button
          .setIcon("arrow-up")
          .setTooltip(`Move ${EXERCISE_TYPE_LABELS[type]} earlier`)
          .setDisabled(index === 0)
          .onClick(() => this.moveStudyType(index, index - 1, render)));
        row.addButton((button) => button
          .setIcon("arrow-down")
          .setTooltip(`Move ${EXERCISE_TYPE_LABELS[type]} later`)
          .setDisabled(index === this.owner.settings.studyTypeSequence.length - 1)
          .onClick(() => this.moveStudyType(index, index + 1, render)));
      }
    };
    new Setting(details)
      .setName("Sequence controls")
      .setDesc("Changes apply to future session setup dialogs, not an active session.")
      .addButton((button) => button
        .setButtonText("Restore recommended sequence")
        .setTooltip("Restore the default progression of exercise types")
        .onClick(() => {
          this.owner.settings.studyTypeSequence = [...DEFAULT_STUDY_TYPE_SEQUENCE];
          render();
          void this.owner.saveSettings();
        }));
    render();
  }

  private moveStudyType(
    from: number,
    to: number,
    render: () => void,
  ): void {
    const sequence = [...this.owner.settings.studyTypeSequence];
    if (from < 0 || from >= sequence.length || to < 0 || to >= sequence.length) return;
    const [type] = sequence.splice(from, 1);
    if (type === undefined) return;
    sequence.splice(to, 0, type);
    this.owner.settings.studyTypeSequence = normalizeStudyTypeSequence(sequence);
    render();
    void this.owner.saveSettings();
  }

  private addPracticeViewSettings(): void {
    const group = this.addSettingsGroup(
      "Practice Problem Generator view",
      "Choose information density for source, review, study, and completion. Grounded answers and required AI-review notices cannot be hidden.",
    );
    new Setting(group)
      .setName("Open workspace in")
      .setDesc("Main tab is recommended for generation, occlusion editing, and study. Right sidebar is available for a compact layout. An already-open workspace keeps its location so active work is not discarded; close it before reopening in the new location.")
      .addDropdown((dropdown) => dropdown
        .addOption("main-tab", "Main tab (recommended)")
        .addOption("right-sidebar", "Right sidebar")
        .setValue(this.owner.settings.practiceViewLocation)
        .onChange(async (value) => {
          this.owner.settings.practiceViewLocation = value === "right-sidebar"
            ? "right-sidebar"
            : "main-tab";
          await this.owner.saveSettings();
        }));
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
    this.addDisplayToggle("Show view introduction", "Show the short description below the Practice Problem Generator title.", "practice", "showHeaderDescription", group);
    if (!Platform.isMobileApp) {
      this.addDisplayToggle("Show generation stepper", "Show Source, Configure, and Review navigation steps.", "practice", "showGenerationStepper", group);
      this.addDisplayToggle("Live agent activity", "Show safe provider events, elapsed time, and emitted reasoning status while AI work runs. Private chain-of-thought is never exposed or saved.", "practice", "showAgentActivity", group);
      this.addDisplayToggle("Show source path", "Show the vault-relative source path.", "practice", "showSourcePath", group);
      this.addDisplayToggle("Show source excerpt", "Show the source preview in the Source stage.", "practice", "showSourceExcerpt", group);
      this.addDisplayToggle("Expand payload preview", "Open the exact provider payload by default. It always remains available.", "practice", "expandPayloadPreview", group);
      this.addDisplayToggle("Show draft grounding", "Show cited segment IDs on draft cards.", "practice", "showDraftGrounding", group);
      this.addDisplayToggle("Show draft rationale", "Show generated rationale text while reviewing drafts.", "practice", "showDraftRationale", group);
    }
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
      "Keep the dashboard as quiet or detailed as you want. These settings control its layout; data-integrity diagnostics remain visible when they need attention.",
    );
    new Setting(group)
      .setName("Quick layout")
      .setDesc("Focused is the calm recommended layout. Detailed shows every dashboard section. Minimal keeps only core outcomes and the bank list.")
      .addButton((button) => button
        .setButtonText("Focused")
        .setCta()
        .onClick(() => void this.applyDashboardDisplayPreset("focused")))
      .addButton((button) => button
        .setButtonText("Detailed")
        .onClick(() => void this.applyDashboardDisplayPreset("detailed")))
      .addButton((button) => button
        .setButtonText("Minimal")
        .onClick(() => void this.applyDashboardDisplayPreset("minimal")));

    const layout = this.addSettingsSubgroup(
      group,
      "Layout and scope",
      "Choose the dashboard framing and optional workflow panels.",
    );
    this.addDisplayToggle("Scope controls", "Show folder, source, tag, and search controls.", "dashboard", "showScopeControls", layout);
    this.addDisplayToggle("Scope breadcrumbs", "Show the active folder, source, and tag trail.", "dashboard", "showBreadcrumbs", layout);
    this.addDisplayToggle("Dashboard introduction", "Show the explanatory sentence below the dashboard title.", "dashboard", "showIntroduction", layout);
    this.addDisplayToggle("Offline-preparation panel", "Show the audit action for banks and occlusion images in the current scope.", "dashboard", "showOfflinePreparation", layout);
    this.addDisplayToggle("Guided-path analytics", "Show learning-path evidence, coverage, assistance, and advisory next-step sections when available.", "dashboard", "showLearningPathAnalytics", layout);

    const overview = this.addSettingsSubgroup(
      group,
      "Overview cards",
      "Choose the summary numbers shown at the top of the dashboard.",
    );
    this.addDisplayToggle("Performance", "Weighted score across the selected scope.", "dashboard", "showPerformance", overview);
    this.addDisplayToggle("Practice-bank count", "Practiced and new bank counts.", "dashboard", "showBankCount", overview);
    this.addDisplayToggle("Practice-problem count", "Attempted and unattempted problem counts.", "dashboard", "showProblemCount", overview);
    this.addDisplayToggle("Completed-session count", "Sessions and total answers.", "dashboard", "showSessionCount", overview);
    this.addDisplayToggle("Session completion", "Completion across recorded session sizes.", "dashboard", "showCompletion", overview);
    this.addDisplayToggle("Best answer streak", "Longest full-credit answer sequence.", "dashboard", "showBestStreak", overview);
    this.addDisplayToggle("Objective-answer summary", "Locally graded correct and total objective answers.", "dashboard", "showObjectiveAnswers", overview);
    this.addDisplayToggle("Free-response summary", "Correct, partial, and incorrect free responses.", "dashboard", "showFreeResponses", overview);
    this.addDisplayToggle("AI-review summary", "Reviewed, pending, and failed AI reviews.", "dashboard", "showAiReviews", overview);

    const activity = this.addSettingsSubgroup(
      group,
      "Activity and analytics",
      "Control the activity section here; the dashboard itself stays free of configuration controls.",
    );
    new Setting(activity)
      .setName("Analytics range")
      .setDesc("The heatmap and trend window. This changes presentation only, not saved practice data.")
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
    new Setting(activity)
      .setName("Weekly activity metric")
      .setDesc("Choose answers, sessions, or practice time for the optional weekly activity graph.")
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
    new Setting(activity)
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
    this.addDisplayToggle("Activity summary cards", "Show active days, session count, practice time, and window performance.", "dashboard", "showActivitySummary", activity);
    this.addDisplayToggle("Activity heatmap", "Calendar of completed practice activity in the selected dashboard scope.", "dashboard", "showActivityHeatmap", activity);
    this.addDisplayToggle("Weekly activity graph", "Answers, sessions, or practice time grouped by week.", "dashboard", "showActivityTrend", activity);
    this.addDisplayToggle("Weekly performance graph", "Scored-answer performance over time; provisional sessions remain identified.", "dashboard", "showPerformanceTrend", activity);
    this.addDisplayToggle("Answer-outcome graph", "Accessible distribution of correct, partial, and incorrect scored answers.", "dashboard", "showOutcomeChart", activity);

    const history = this.addSettingsSubgroup(
      group,
      "Breakdowns and history",
      "Optional detail sections below the activity overview.",
    );
    this.addDisplayToggle("Performance by exercise type", "Per-type performance cards.", "dashboard", "showTypeBreakdown", history);
    this.addDisplayToggle("Recent sessions", "Ten newest sessions in the selected scope.", "dashboard", "showRecentSessions", history);

    const banks = this.addSettingsSubgroup(
      group,
      "Practice-bank list",
      "Choose the bank list and the metadata shown on each bank card.",
    );
    this.addDisplayToggle("Show practice-bank list", "Searchable bank cards and actions.", "dashboard", "showBankList", banks);
    this.addDisplayToggle("Bank paths", "Show vault-relative source paths on bank cards.", "dashboard", "showBankPaths", banks);
    this.addDisplayToggle("Bank tags", "Show source-tag filter chips on bank cards.", "dashboard", "showBankTags", banks);
    this.addDisplayToggle("Bank activity details", "Show per-bank counts, AI status, streak, and last-practiced date.", "dashboard", "showBankActivity", banks);
  }

  private addDataManagementSettings(): void {
    const group = this.addSettingsGroup(
      "Data management",
      "Destructive controls stay collapsed here. Every action shows its exact scope and requires a typed confirmation; Practice Problem Generator never clears data automatically.",
    );
    new Setting(group)
      .setName("Reset all settings")
      .setDesc("Restore generation, study, interface, storage, timeout, and executable settings. Generated banks and session history are preserved.")
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
      .setDesc("Move every valid Practice Problem Generator bank to the configured Obsidian trash. Source notes, PDFs, and original attachments are preserved. Settings are preserved.")
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

  private addSettingsSubgroup(
    container: HTMLElement,
    name: string,
    description: string,
  ): HTMLElement {
    const details = container.createEl("details", {
      cls: "practice-lab-settings-subgroup",
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
    provider: ProviderId,
    description: string,
    onChanged: () => void,
  ): void {
    const catalog = this.modelCatalog(provider);
    const setting = new Setting(this.containerEl)
      .setName(name)
      .setDesc(description);
    const controls = setting.controlEl.createDiv({
      cls: "practice-lab-model-controls",
    });
    const select = controls.createEl("select", {
      attr: { "aria-label": `${provider} default model` },
    });
    const automaticModel = automaticModelForProvider(
      provider,
      this.owner.settings.reasoningEffort,
      catalog,
    );
    const automaticOption = select.createEl("option", {
      value: AUTOMATIC_MODEL_CHOICE,
      text: provider === "agy"
        ? automaticModel.length > 0
          ? `Automatic (${automaticModel})`
          : "Automatic (no compatible catalog model)"
        : "Automatic (provider default)",
    });
    automaticOption.disabled = provider === "agy" && automaticModel.length === 0;
    for (const model of catalog) {
      const option = select.createEl("option", {
        value: model.id,
        text: model.label,
      });
      option.title = model.description
        ?? (model.supportedReasoningEfforts === undefined
          ? "Uses provider-supported reasoning levels."
          : `Reasoning: ${model.supportedReasoningEfforts.map(displayReasoningEffort).join(", ")}.`);
    }
    select.createEl("option", {
      value: CUSTOM_MODEL_CHOICE,
      text: "Custom model id…",
    });
    const input = controls.createEl("input", {
      type: "text",
      placeholder: "Exact model ID",
      cls: "practice-lab-custom-model-input",
      attr: {
        "aria-label": `${provider} custom model ID`,
        maxlength: String(MAX_MODEL_ID_LENGTH),
        autocomplete: "off",
      },
    });
    input.spellcheck = false;
    const initialChoice = modelPickerChoice(
      provider,
      this.owner.settings[key],
      this.owner.settings.reasoningEffort,
      catalog,
    );
    let customMode = initialChoice === CUSTOM_MODEL_CHOICE;
    select.value = initialChoice;
    input.hidden = !customMode;
    input.value = customMode ? this.owner.settings[key] : "";
    const detail = setting.descEl.createDiv({
      cls: "practice-lab-model-detail",
      attr: { role: "status" },
    });
    const updateDetail = (): void => {
      if (customMode) {
        const value = input.value.trim();
        const problem = modelIdProblem(value);
        detail.setText(
          value.length === 0
            ? "Enter a safe exact model ID; the current saved value remains active until then."
            : problem ?? `Custom exact model: ${value}`,
        );
        return;
      }
      detail.setText(
        select.value === AUTOMATIC_MODEL_CHOICE
          ? provider === "agy"
            ? automaticModel.length > 0
              ? `agy requires an explicit model; generation resolves Automatic to ${automaticModel} and records that exact ID.`
              : "No compatible automatic agy model is available for this reasoning level. Choose a listed or custom model."
            : "The CLI chooses its current default; generation history records that the model was not pinned."
          : catalog.find((model) => model.id === select.value)?.description
            ?? `Exact model: ${select.value}`,
      );
    };
    updateDetail();
    const catalogDetail = this.owner.providerPresentation(provider)
      ?.modelCatalogDetail;
    if (catalogDetail !== undefined) {
      setting.descEl.createDiv({
        cls: "practice-lab-model-catalog-note",
        text: this.owner.providerPresentation(provider)?.models.length === 0
          ? `Live model list unavailable; showing conservative built-in choices. ${catalogDetail}`
          : `Model catalog note: ${catalogDetail}`,
      });
    }
    select.addEventListener("change", () => {
      const choice = select.value;
      customMode = choice === CUSTOM_MODEL_CHOICE;
      input.hidden = !customMode;
      if (customMode) {
        input.value = "";
        updateDetail();
        input.focus();
        return;
      }
      this.owner.settings[key] = choice === AUTOMATIC_MODEL_CHOICE ? "" : choice;
      if (provider === "agy") {
        this.owner.settings.reasoningEffort = agyReasoningEffortForModel(
          this.owner.settings.agyModel,
        ) ?? this.owner.settings.reasoningEffort;
      }
      onChanged();
      updateDetail();
      this.queueModelSettingsSave();
    });
    input.addEventListener("input", () => {
      const value = input.value.trim();
      updateDetail();
      const problem = modelIdProblem(value);
      input.setAttribute("aria-invalid", String(problem !== null));
    });
    input.addEventListener("change", () => {
      const value = input.value.trim();
      if (value.length === 0 || modelIdProblem(value) !== null) return;
      if (value === this.owner.settings[key]) return;
      this.owner.settings[key] = value;
      if (provider === "agy") {
        this.owner.settings.reasoningEffort = agyReasoningEffortForModel(
          value,
        ) ?? this.owner.settings.reasoningEffort;
      }
      onChanged();
      this.queueModelSettingsSave();
    });
  }

  private queueModelSettingsSave(): void {
    this.modelSettingsSaveChain = this.modelSettingsSaveChain
      .catch(() => undefined)
      .then(async () => await this.owner.saveSettings())
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        new Notice(`Could not save the model setting. ${detail}`, 8_000);
      });
  }

  private modelCatalog(provider: ProviderId): readonly ModelCatalogEntry[] {
    return modelsForProvider(
      provider,
      this.owner.providerPresentation(provider)?.models ?? [],
    );
  }

  private defaultModelReasoningEfforts(): readonly ReasoningEffortV1[] {
    const provider = this.owner.settings.provider;
    const model = this.owner.settings[modelKeyForProvider(provider)];
    const effectiveModel = provider === "agy" && model.length === 0
      ? automaticModelForProvider(
          "agy",
          this.owner.settings.reasoningEffort,
          this.modelCatalog("agy"),
        )
      : model;
    return reasoningEffortsForModel(
      reasoningEffortsForProvider(provider),
      effectiveModel,
      this.modelCatalog(provider),
    );
  }

  private normalizeDefaultModelReasoning(): void {
    const provider = this.owner.settings.provider;
    const key = modelKeyForProvider(provider);
    const catalog = this.modelCatalog(provider);
    const model = this.owner.settings[key];
    const effectiveModel = provider === "agy" && model.length === 0
      ? automaticModelForProvider(
          "agy",
          this.owner.settings.reasoningEffort,
          catalog,
        )
      : model;
    const efforts = reasoningEffortsForModel(
      reasoningEffortsForProvider(provider),
      effectiveModel,
      catalog,
    );
    const selected = catalog.find((entry) => entry.id === effectiveModel);
    const pinnedAgyEffort = provider === "agy" && model.length > 0
      ? agyReasoningEffortForModel(effectiveModel)
      : undefined;
    this.owner.settings.reasoningEffort = pinnedAgyEffort !== undefined
      && efforts.includes(pinnedAgyEffort)
      ? pinnedAgyEffort
      : preferredReasoningEffort(
          this.owner.settings.reasoningEffort,
          efforts,
          selected,
        );
  }

  private async applyDisplayPreset(preset: DisplayPreset): Promise<void> {
    this.owner.settings.display = displayPreset(preset);
    await this.owner.saveSettings();
    this.update();
  }

  private async applyDashboardDisplayPreset(preset: DisplayPreset): Promise<void> {
    this.owner.settings.display.dashboard = dashboardPreset(preset);
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
    this.owner.settings.recoverInterruptedGenerations =
      DEFAULT_SETTINGS.recoverInterruptedGenerations;
    this.owner.settings.generationRecoveryRetentionHours =
      DEFAULT_SETTINGS.generationRecoveryRetentionHours;
    this.owner.settings.exerciseTypePercentages = copyExerciseTypePercentages(
      DEFAULT_SETTINGS.exerciseTypePercentages,
    );
    await this.owner.saveSettings();
    this.update();
  }

  private async restoreStudyDefaults(): Promise<void> {
    this.owner.settings.studyOrderDefault = DEFAULT_SETTINGS.studyOrderDefault;
    this.owner.settings.studyTypeSequence = [...DEFAULT_SETTINGS.studyTypeSequence];
    this.owner.settings.studyShuffleWithinTypesDefault =
      DEFAULT_SETTINGS.studyShuffleWithinTypesDefault;
    this.owner.settings.answerReviewDefault = DEFAULT_SETTINGS.answerReviewDefault;
    this.owner.settings.answerReviewProvider = DEFAULT_SETTINGS.answerReviewProvider;
    this.owner.settings.answerReviewReasoningEffort =
      DEFAULT_SETTINGS.answerReviewReasoningEffort;
    await this.owner.saveSettings();
    this.update();
  }
}
