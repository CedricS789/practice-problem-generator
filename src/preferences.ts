import type { ExerciseV1 } from "./model";

export type InterfaceDensity = "comfortable" | "compact";
export type VisualSelectionDefault = "manual" | "all-local";
export type StudyOrderDefault =
  | "bank"
  | "shuffle"
  | "shuffle-types"
  | "type-sequence";
export type StudyExerciseType = ExerciseV1["type"];

export const DEFAULT_STUDY_TYPE_SEQUENCE: readonly StudyExerciseType[] = [
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
];

export interface StudyOrderSelection {
  readonly mode: StudyOrderDefault;
  readonly typeSequence: readonly StudyExerciseType[];
  readonly shuffleWithinTypes: boolean;
}

export interface PracticeViewPreferences {
  density: InterfaceDensity;
  showHeaderDescription: boolean;
  showGenerationStepper: boolean;
  showAgentActivity: boolean;
  showSourcePath: boolean;
  showSourceExcerpt: boolean;
  expandPayloadPreview: boolean;
  showDraftGrounding: boolean;
  showDraftRationale: boolean;
  showStudyProgress: boolean;
  enableStudyKeyboardShortcuts: boolean;
  autoFocusStudyInput: boolean;
  showStudyShortcutHint: boolean;
  showRunPoints: boolean;
  showRunStreak: boolean;
  showRunRank: boolean;
  showStudyRationale: boolean;
  showCompletionPerformance: boolean;
  showCompletionStreak: boolean;
  showCompletionRank: boolean;
  showCompletionNarrative: boolean;
  celebrateCompletion: boolean;
}

export interface BankStatisticsPreferences {
  showBankMetadata: boolean;
  showGenerationHistory: boolean;
  showOverallScore: boolean;
  showLatestSession: boolean;
  showBestSession: boolean;
  showCompletion: boolean;
  showBestStreak: boolean;
  showAiReviews: boolean;
  showAnswerOutcomes: boolean;
  showTypeBreakdown: boolean;
  showSessionHistory: boolean;
}

export interface DashboardPreferences {
  showIntroduction: boolean;
  showBreadcrumbs: boolean;
  showPerformance: boolean;
  showBankCount: boolean;
  showProblemCount: boolean;
  showSessionCount: boolean;
  showCompletion: boolean;
  showBestStreak: boolean;
  showObjectiveAnswers: boolean;
  showFreeResponses: boolean;
  showAiReviews: boolean;
  showActivityHeatmap: boolean;
  showActivityTrend: boolean;
  showPerformanceTrend: boolean;
  showOutcomeChart: boolean;
  showTypeBreakdown: boolean;
  showRecentSessions: boolean;
  showBankList: boolean;
  showBankPaths: boolean;
  showBankTags: boolean;
  showBankActivity: boolean;
}

export interface PracticeLabDisplayPreferences {
  practice: PracticeViewPreferences;
  bank: BankStatisticsPreferences;
  dashboard: DashboardPreferences;
}

export type DisplayPreset = "detailed" | "focused" | "minimal";

export const DEFAULT_DISPLAY_PREFERENCES: PracticeLabDisplayPreferences = {
  practice: {
    density: "comfortable",
    showHeaderDescription: true,
    showGenerationStepper: true,
    showAgentActivity: true,
    showSourcePath: true,
    showSourceExcerpt: true,
    expandPayloadPreview: false,
    showDraftGrounding: true,
    showDraftRationale: true,
    showStudyProgress: true,
    enableStudyKeyboardShortcuts: true,
    autoFocusStudyInput: true,
    showStudyShortcutHint: true,
    showRunPoints: true,
    showRunStreak: true,
    showRunRank: true,
    showStudyRationale: true,
    showCompletionPerformance: true,
    showCompletionStreak: true,
    showCompletionRank: true,
    showCompletionNarrative: true,
    celebrateCompletion: true,
  },
  bank: {
    showBankMetadata: true,
    showGenerationHistory: true,
    showOverallScore: true,
    showLatestSession: true,
    showBestSession: true,
    showCompletion: true,
    showBestStreak: true,
    showAiReviews: true,
    showAnswerOutcomes: true,
    showTypeBreakdown: true,
    showSessionHistory: true,
  },
  dashboard: {
    showIntroduction: true,
    showBreadcrumbs: true,
    showPerformance: true,
    showBankCount: true,
    showProblemCount: true,
    showSessionCount: true,
    showCompletion: true,
    showBestStreak: true,
    showObjectiveAnswers: true,
    showFreeResponses: true,
    showAiReviews: true,
    showActivityHeatmap: true,
    showActivityTrend: true,
    showPerformanceTrend: true,
    showOutcomeChart: true,
    showTypeBreakdown: true,
    showRecentSessions: true,
    showBankList: true,
    showBankPaths: true,
    showBankTags: true,
    showBankActivity: true,
  },
};

const FOCUSED_DISPLAY_PREFERENCES: PracticeLabDisplayPreferences = {
  practice: {
    ...DEFAULT_DISPLAY_PREFERENCES.practice,
    showSourcePath: false,
    showHeaderDescription: false,
    showAgentActivity: true,
    showDraftGrounding: false,
    showRunRank: false,
  },
  bank: {
    ...DEFAULT_DISPLAY_PREFERENCES.bank,
    showLatestSession: false,
    showAnswerOutcomes: false,
  },
  dashboard: {
    ...DEFAULT_DISPLAY_PREFERENCES.dashboard,
    showObjectiveAnswers: false,
    showFreeResponses: false,
    showBankPaths: false,
    showIntroduction: false,
  },
};

const MINIMAL_DISPLAY_PREFERENCES: PracticeLabDisplayPreferences = {
  practice: {
    density: "compact",
    showHeaderDescription: false,
    showGenerationStepper: false,
    showAgentActivity: false,
    showSourcePath: false,
    showSourceExcerpt: false,
    expandPayloadPreview: false,
    showDraftGrounding: false,
    showDraftRationale: false,
    showStudyProgress: true,
    enableStudyKeyboardShortcuts: true,
    autoFocusStudyInput: true,
    showStudyShortcutHint: false,
    showRunPoints: true,
    showRunStreak: false,
    showRunRank: false,
    showStudyRationale: false,
    showCompletionPerformance: true,
    showCompletionStreak: false,
    showCompletionRank: false,
    showCompletionNarrative: false,
    celebrateCompletion: false,
  },
  bank: {
    showBankMetadata: false,
    showGenerationHistory: false,
    showOverallScore: true,
    showLatestSession: false,
    showBestSession: false,
    showCompletion: true,
    showBestStreak: false,
    showAiReviews: true,
    showAnswerOutcomes: false,
    showTypeBreakdown: false,
    showSessionHistory: false,
  },
  dashboard: {
    showIntroduction: false,
    showBreadcrumbs: false,
    showPerformance: true,
    showBankCount: true,
    showProblemCount: false,
    showSessionCount: false,
    showCompletion: true,
    showBestStreak: false,
    showObjectiveAnswers: false,
    showFreeResponses: false,
    showAiReviews: true,
    showActivityHeatmap: false,
    showActivityTrend: false,
    showPerformanceTrend: false,
    showOutcomeChart: false,
    showTypeBreakdown: false,
    showRecentSessions: false,
    showBankList: true,
    showBankPaths: false,
    showBankTags: false,
    showBankActivity: false,
  },
};

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function copyDisplayPreferences(
  value: PracticeLabDisplayPreferences,
): PracticeLabDisplayPreferences {
  return {
    practice: { ...value.practice },
    bank: { ...value.bank },
    dashboard: { ...value.dashboard },
  };
}

export function displayPreset(preset: DisplayPreset): PracticeLabDisplayPreferences {
  if (preset === "focused") return copyDisplayPreferences(FOCUSED_DISPLAY_PREFERENCES);
  if (preset === "minimal") return copyDisplayPreferences(MINIMAL_DISPLAY_PREFERENCES);
  return copyDisplayPreferences(DEFAULT_DISPLAY_PREFERENCES);
}

export function normalizeDisplayPreferences(
  value: unknown,
): PracticeLabDisplayPreferences {
  const root = record(value);
  const practice = record(root.practice);
  const bank = record(root.bank);
  const dashboard = record(root.dashboard);
  const defaults = DEFAULT_DISPLAY_PREFERENCES;
  return {
    practice: {
      density: practice.density === "compact" ? "compact" : "comfortable",
      showHeaderDescription: booleanValue(practice.showHeaderDescription, defaults.practice.showHeaderDescription),
      showGenerationStepper: booleanValue(practice.showGenerationStepper, defaults.practice.showGenerationStepper),
      showAgentActivity: booleanValue(practice.showAgentActivity, defaults.practice.showAgentActivity),
      showSourcePath: booleanValue(practice.showSourcePath, defaults.practice.showSourcePath),
      showSourceExcerpt: booleanValue(practice.showSourceExcerpt, defaults.practice.showSourceExcerpt),
      expandPayloadPreview: booleanValue(practice.expandPayloadPreview, defaults.practice.expandPayloadPreview),
      showDraftGrounding: booleanValue(practice.showDraftGrounding, defaults.practice.showDraftGrounding),
      showDraftRationale: booleanValue(practice.showDraftRationale, defaults.practice.showDraftRationale),
      showStudyProgress: booleanValue(practice.showStudyProgress, defaults.practice.showStudyProgress),
      enableStudyKeyboardShortcuts: booleanValue(practice.enableStudyKeyboardShortcuts, defaults.practice.enableStudyKeyboardShortcuts),
      autoFocusStudyInput: booleanValue(practice.autoFocusStudyInput, defaults.practice.autoFocusStudyInput),
      showStudyShortcutHint: booleanValue(practice.showStudyShortcutHint, defaults.practice.showStudyShortcutHint),
      showRunPoints: booleanValue(practice.showRunPoints, defaults.practice.showRunPoints),
      showRunStreak: booleanValue(practice.showRunStreak, defaults.practice.showRunStreak),
      showRunRank: booleanValue(practice.showRunRank, defaults.practice.showRunRank),
      showStudyRationale: booleanValue(practice.showStudyRationale, defaults.practice.showStudyRationale),
      showCompletionPerformance: booleanValue(practice.showCompletionPerformance, defaults.practice.showCompletionPerformance),
      showCompletionStreak: booleanValue(practice.showCompletionStreak, defaults.practice.showCompletionStreak),
      showCompletionRank: booleanValue(practice.showCompletionRank, defaults.practice.showCompletionRank),
      showCompletionNarrative: booleanValue(practice.showCompletionNarrative, defaults.practice.showCompletionNarrative),
      celebrateCompletion: booleanValue(practice.celebrateCompletion, defaults.practice.celebrateCompletion),
    },
    bank: {
      showBankMetadata: booleanValue(bank.showBankMetadata, defaults.bank.showBankMetadata),
      showGenerationHistory: booleanValue(bank.showGenerationHistory, defaults.bank.showGenerationHistory),
      showOverallScore: booleanValue(bank.showOverallScore, defaults.bank.showOverallScore),
      showLatestSession: booleanValue(bank.showLatestSession, defaults.bank.showLatestSession),
      showBestSession: booleanValue(bank.showBestSession, defaults.bank.showBestSession),
      showCompletion: booleanValue(bank.showCompletion, defaults.bank.showCompletion),
      showBestStreak: booleanValue(bank.showBestStreak, defaults.bank.showBestStreak),
      showAiReviews: booleanValue(bank.showAiReviews, defaults.bank.showAiReviews),
      showAnswerOutcomes: booleanValue(bank.showAnswerOutcomes, defaults.bank.showAnswerOutcomes),
      showTypeBreakdown: booleanValue(bank.showTypeBreakdown, defaults.bank.showTypeBreakdown),
      showSessionHistory: booleanValue(bank.showSessionHistory, defaults.bank.showSessionHistory),
    },
    dashboard: {
      showIntroduction: booleanValue(dashboard.showIntroduction, defaults.dashboard.showIntroduction),
      showBreadcrumbs: booleanValue(dashboard.showBreadcrumbs, defaults.dashboard.showBreadcrumbs),
      showPerformance: booleanValue(dashboard.showPerformance, defaults.dashboard.showPerformance),
      showBankCount: booleanValue(dashboard.showBankCount, defaults.dashboard.showBankCount),
      showProblemCount: booleanValue(dashboard.showProblemCount, defaults.dashboard.showProblemCount),
      showSessionCount: booleanValue(dashboard.showSessionCount, defaults.dashboard.showSessionCount),
      showCompletion: booleanValue(dashboard.showCompletion, defaults.dashboard.showCompletion),
      showBestStreak: booleanValue(dashboard.showBestStreak, defaults.dashboard.showBestStreak),
      showObjectiveAnswers: booleanValue(dashboard.showObjectiveAnswers, defaults.dashboard.showObjectiveAnswers),
      showFreeResponses: booleanValue(dashboard.showFreeResponses, defaults.dashboard.showFreeResponses),
      showAiReviews: booleanValue(dashboard.showAiReviews, defaults.dashboard.showAiReviews),
      showActivityHeatmap: booleanValue(dashboard.showActivityHeatmap, defaults.dashboard.showActivityHeatmap),
      showActivityTrend: booleanValue(dashboard.showActivityTrend, defaults.dashboard.showActivityTrend),
      showPerformanceTrend: booleanValue(dashboard.showPerformanceTrend, defaults.dashboard.showPerformanceTrend),
      showOutcomeChart: booleanValue(dashboard.showOutcomeChart, defaults.dashboard.showOutcomeChart),
      showTypeBreakdown: booleanValue(dashboard.showTypeBreakdown, defaults.dashboard.showTypeBreakdown),
      showRecentSessions: booleanValue(dashboard.showRecentSessions, defaults.dashboard.showRecentSessions),
      showBankList: booleanValue(dashboard.showBankList, defaults.dashboard.showBankList),
      showBankPaths: booleanValue(dashboard.showBankPaths, defaults.dashboard.showBankPaths),
      showBankTags: booleanValue(dashboard.showBankTags, defaults.dashboard.showBankTags),
      showBankActivity: booleanValue(dashboard.showBankActivity, defaults.dashboard.showBankActivity),
    },
  };
}

export function hasVisibleDashboardOverview(
  preferences: DashboardPreferences,
): boolean {
  return preferences.showPerformance
    || preferences.showBankCount
    || preferences.showProblemCount
    || preferences.showSessionCount
    || preferences.showCompletion
    || preferences.showBestStreak
    || preferences.showObjectiveAnswers
    || preferences.showFreeResponses
    || preferences.showAiReviews;
}

export function hasVisibleBankOverview(
  preferences: BankStatisticsPreferences,
): boolean {
  return preferences.showOverallScore
    || preferences.showLatestSession
    || preferences.showBestSession
    || preferences.showCompletion
    || preferences.showBestStreak
    || preferences.showAiReviews;
}

export function normalizeStudyTypeSequence(
  value: unknown,
): StudyExerciseType[] {
  const allowed = new Set<StudyExerciseType>(DEFAULT_STUDY_TYPE_SEQUENCE);
  const sequence: StudyExerciseType[] = [];
  if (Array.isArray(value)) {
    for (const candidate of value) {
      if (
        typeof candidate === "string"
        && allowed.has(candidate as StudyExerciseType)
        && !sequence.includes(candidate as StudyExerciseType)
      ) {
        sequence.push(candidate as StudyExerciseType);
      }
    }
  }
  for (const type of DEFAULT_STUDY_TYPE_SEQUENCE) {
    if (!sequence.includes(type)) sequence.push(type);
  }
  return sequence;
}

export function orderStudyItems<T extends { readonly type: StudyExerciseType }>(
  values: readonly T[],
  selection: StudyOrderSelection,
  randomUint32: () => number = () =>
    crypto.getRandomValues(new Uint32Array(1))[0] ?? 0,
): T[] {
  const result = [...values];
  if (selection.mode === "bank") return result;
  if (selection.mode === "shuffle") return shuffledCopy(result, randomUint32);

  const groups = new Map<StudyExerciseType, T[]>();
  for (const item of result) {
    const group = groups.get(item.type) ?? [];
    group.push(item);
    groups.set(item.type, group);
  }
  const presentTypes = normalizeStudyTypeSequence(selection.typeSequence)
    .filter((type) => groups.has(type));
  const orderedTypes = selection.mode === "shuffle-types"
    ? shuffledCopy(presentTypes, randomUint32)
    : presentTypes;
  return orderedTypes.flatMap((type) => {
    const group = groups.get(type) ?? [];
    return selection.shuffleWithinTypes
      ? shuffledCopy(group, randomUint32)
      : [...group];
  });
}

function shuffledCopy<T>(
  values: readonly T[],
  randomUint32: () => number,
): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomUint32() % (index + 1);
    [result[index], result[target]] = [result[target] as T, result[index] as T];
  }
  return result;
}
