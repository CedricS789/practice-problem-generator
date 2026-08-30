import type {
  ExerciseV1,
  LearningPathStartingLevelV1,
  PracticeBankV4,
} from "./model";
import {
  deriveLearningAnalytics,
  recommendNextLearningStep,
  type LearningEvidenceMetrics,
  type LearningEvidenceState,
  type RecommendedNextLearningStep,
} from "./learning-analytics";
import {
  calculatePerformanceScore,
  calculatePracticeBankStatistics,
  performanceOutcomeForResult,
  type PerformanceOutcome,
  type PerformanceScore,
  type SessionStatistic,
} from "./session-statistics";

export interface DashboardBankRecord {
  readonly bankPath: string;
  readonly bank: PracticeBankV4;
  readonly sourceTags: readonly string[];
  readonly sourceExists: boolean;
}

export type DashboardScope =
  | { readonly kind: "all" }
  | { readonly kind: "folder"; readonly path: string }
  | { readonly kind: "tag"; readonly tag: string }
  | { readonly kind: "source"; readonly path: string };

/**
 * A primary hierarchy level plus an optional tag facet. Keeping the tag
 * separate lets a dashboard answer questions such as "this course folder,
 * but only #exam/closed-book" without inventing persisted relationships.
 */
export interface DashboardFilter {
  readonly primary: DashboardScope;
  readonly tagPrefix?: string;
}

export interface DashboardScopeOption {
  readonly scope: DashboardScope;
  readonly label: string;
  readonly count: number;
}

export interface DashboardScopeOptions {
  readonly all: DashboardScopeOption;
  readonly folders: readonly DashboardScopeOption[];
  readonly tags: readonly DashboardScopeOption[];
  readonly sources: readonly DashboardScopeOption[];
}

export interface DashboardExerciseTypeSummary {
  readonly type: ExerciseV1["type"];
  readonly problemCount: number;
  readonly practicedProblemCount: number;
  readonly unpracticedProblemCount: number;
  readonly answerCount: number;
  readonly performance: PerformanceScore;
}

export interface DashboardRecentSession {
  readonly bankPath: string;
  readonly bankId: string;
  readonly sourcePath: string;
  readonly sourceTitle: string;
  readonly session: SessionStatistic;
}

export interface DashboardBankSummary {
  readonly bankPath: string;
  readonly bankId: string;
  readonly sourcePath: string;
  readonly sourceTitle: string;
  readonly sourceTags: readonly string[];
  readonly sourceExists: boolean;
  readonly problemCount: number;
  readonly practicedProblemCount: number;
  readonly unpracticedProblemCount: number;
  readonly sessionCount: number;
  readonly answerCount: number;
  readonly completionPercent: number | null;
  readonly performance: PerformanceScore;
  readonly bestAnswerStreak: number;
  readonly latestSessionAt: string | null;
  readonly unmappedAnswerCount: number;
  readonly freeResponseCorrect: number;
  readonly freeResponsePartial: number;
  readonly freeResponseIncorrect: number;
  readonly reviewedAiResponseCount: number;
  readonly pendingAiReviewCount: number;
  readonly failedAiReviewCount: number;
  readonly provisional: boolean;
  readonly learningPath: DashboardLearningPathSummary | null;
}

export interface DashboardLearningEvidenceRow extends LearningEvidenceMetrics {
  readonly id: string;
  readonly title: string;
  readonly historicalOnly: boolean;
}

export interface DashboardLearningPathSummary {
  readonly pathId: string;
  readonly title: string;
  readonly startingLevel: LearningPathStartingLevelV1;
  readonly setCount: number;
  readonly lessonCount: number;
  readonly completedLessonCount: number;
  readonly lessonCompletionPercent: number | null;
  readonly remainingLessonTitles: readonly string[];
  readonly sourceMaterialCount: number;
  readonly sourceSegmentCount: number;
  readonly coveredSourceSegmentCount: number;
  readonly sourceCoveragePercent: number | null;
  readonly supportedAspectCount: number;
  readonly unresolvedSourceGapCount: number;
  readonly unresolvedSourceGapTitles: readonly string[];
  readonly unpracticedAspectCount: number;
  readonly developingAspectCount: number;
  readonly consistentAspectCount: number;
  readonly independentAttempts: number;
  readonly independentEarnedPoints: number;
  readonly independentPerformancePercent: number | null;
  readonly guidedAttempts: number;
  readonly assistedGuidedAttemptCount: number;
  readonly assistanceRatePercent: number | null;
  readonly hintsRevealed: number;
  readonly retries: number;
  readonly recoveredCount: number;
  readonly unresolvedCount: number;
  readonly recoveryRatePercent: number | null;
  readonly aspects: readonly DashboardLearningEvidenceRow[];
  readonly sets: readonly DashboardLearningEvidenceRow[];
  readonly recommendation: RecommendedNextLearningStep | null;
}

export interface DashboardLearningOverview {
  readonly pathBankCount: number;
  readonly supportedAspectCount: number;
  readonly unresolvedSourceGapCount: number;
  readonly unpracticedAspectCount: number;
  readonly developingAspectCount: number;
  readonly consistentAspectCount: number;
  readonly independentAttempts: number;
  readonly independentEarnedPoints: number;
  readonly independentPerformancePercent: number | null;
  readonly lessonCount: number;
  readonly completedLessonCount: number;
  readonly lessonCompletionPercent: number | null;
  readonly sourceSegmentCount: number;
  readonly coveredSourceSegmentCount: number;
  readonly sourceCoveragePercent: number | null;
  readonly guidedAttempts: number;
  readonly assistedGuidedAttemptCount: number;
  readonly assistanceRatePercent: number | null;
  readonly hintsRevealed: number;
  readonly retries: number;
  readonly recoveredCount: number;
  readonly unresolvedCount: number;
  readonly recoveryRatePercent: number | null;
}

export interface DashboardAlignmentHealth {
  readonly courseCheckedBankCount: number;
  readonly notCourseCheckedBankCount: number;
  readonly alignedRecordCount: number;
  readonly noteDifferenceRecordCount: number;
  readonly noteIncompleteRecordCount: number;
  readonly schoolDisagreementRecordCount: number;
  readonly unresolvedRecordCount: number;
}

/**
 * A concrete member of a bank-ID collision group. The paths are normalized
 * vault paths so callers can identify and open every conflicting file
 * deterministically, including counterparts outside the active filter.
 */
export interface DashboardExcludedDuplicateRecord {
  readonly bankId: string;
  readonly bankPath: string;
  readonly sourcePath: string;
  readonly sourceTitle: string;
}

export interface PracticeDashboardSummary {
  readonly filter: DashboardFilter;
  readonly bankCount: number;
  readonly problemCount: number;
  readonly sessionCount: number;
  readonly answerCount: number;
  readonly practicedBankCount: number;
  readonly unpracticedBankCount: number;
  readonly practicedProblemCount: number;
  readonly unpracticedProblemCount: number;
  readonly completionPercent: number | null;
  readonly performance: PerformanceScore;
  readonly bestAnswerStreak: number;
  readonly objectiveCorrect: number;
  readonly objectiveTotal: number;
  readonly freeResponseCorrect: number;
  readonly freeResponsePartial: number;
  readonly freeResponseIncorrect: number;
  readonly reviewedAiResponseCount: number;
  readonly pendingAiReviewCount: number;
  readonly failedAiReviewCount: number;
  readonly provisional: boolean;
  readonly unmappedAnswerCount: number;
  readonly missingSourceCount: number;
  /** Number of colliding bank IDs represented in the selected raw records. */
  readonly duplicateBankIdCount: number;
  /** Selected records omitted because their bank ID is not unique. */
  readonly excludedDuplicateRecordCount: number;
  /**
   * Full collision groups for duplicate IDs affecting the selected records.
   * Counterparts outside the active filter are included for repairability.
   */
  readonly excludedDuplicateRecords: readonly DashboardExcludedDuplicateRecord[];
  readonly typeBreakdown: readonly DashboardExerciseTypeSummary[];
  readonly recentSessions: readonly DashboardRecentSession[];
  readonly banks: readonly DashboardBankSummary[];
  readonly learning: DashboardLearningOverview;
  readonly alignment: DashboardAlignmentHealth;
}

const EXERCISE_TYPE_ORDER = [
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
] as const satisfies readonly ExerciseV1["type"][];

function normalizeVaultPath(path: string): string {
  return path
    .trim()
    .replace(/\\/gu, "/")
    .replace(/^\.\//u, "")
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\/{2,}/gu, "/");
}

function normalizeTag(tag: string): string {
  return tag
    .trim()
    .replace(/^#+/u, "")
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\/{2,}/gu, "/")
    .toLocaleLowerCase();
}

function normalizedTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map(normalizeTag).filter((tag) => tag.length > 0))]
    .sort((left, right) => left.localeCompare(right));
}

function tagAncestors(tag: string): string[] {
  const parts = normalizeTag(tag).split("/").filter((part) => part.length > 0);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

function sourceFolderAncestors(path: string): string[] {
  const parts = normalizeVaultPath(path).split("/").filter((part) => part.length > 0);
  parts.pop();
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

function matchesTag(tags: readonly string[], tagPrefix: string): boolean {
  const prefix = normalizeTag(tagPrefix);
  if (prefix.length === 0) return true;
  return normalizedTags(tags).some(
    (tag) => tag === prefix || tag.startsWith(`${prefix}/`),
  );
}

function normalizeScope(scope: DashboardScope): DashboardScope {
  switch (scope.kind) {
    case "folder":
      return { kind: "folder", path: normalizeVaultPath(scope.path) };
    case "source":
      return { kind: "source", path: normalizeVaultPath(scope.path) };
    case "tag":
      return { kind: "tag", tag: normalizeTag(scope.tag) };
    case "all":
      return { kind: "all" };
  }
}

function normalizeFilter(
  filter: DashboardScope | DashboardFilter,
): DashboardFilter {
  if ("primary" in filter) {
    const tagPrefix = filter.tagPrefix === undefined
      ? undefined
      : normalizeTag(filter.tagPrefix);
    return tagPrefix === undefined || tagPrefix.length === 0
      ? { primary: normalizeScope(filter.primary) }
      : { primary: normalizeScope(filter.primary), tagPrefix };
  }
  return { primary: normalizeScope(filter) };
}

function matchesScope(record: DashboardBankRecord, scope: DashboardScope): boolean {
  const sourcePath = normalizeVaultPath(record.bank.source.vaultPath);
  switch (scope.kind) {
    case "all":
      return true;
    case "folder": {
      const folder = normalizeVaultPath(scope.path);
      return folder.length === 0 || sourcePath.startsWith(`${folder}/`);
    }
    case "source":
      return sourcePath === normalizeVaultPath(scope.path);
    case "tag":
      return matchesTag(record.sourceTags, scope.tag);
  }
}

function matchesFilter(record: DashboardBankRecord, filter: DashboardFilter): boolean {
  return matchesScope(record, filter.primary)
    && (filter.tagPrefix === undefined
      || matchesTag(record.sourceTags, filter.tagPrefix));
}

function duplicateBankIds(records: readonly DashboardBankRecord[]): Set<string> {
  const counts = new Map<string, number>();
  for (const record of records) {
    counts.set(record.bank.bankId, (counts.get(record.bank.bankId) ?? 0) + 1);
  }
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([bankId]) => bankId),
  );
}

function safeRecords(records: readonly DashboardBankRecord[]): DashboardBankRecord[] {
  const duplicates = duplicateBankIds(records);
  return records.filter((record) => !duplicates.has(record.bank.bankId));
}

export function countDashboardBanks(
  records: readonly DashboardBankRecord[],
  scopeOrFilter: DashboardScope | DashboardFilter,
): number {
  const filter = normalizeFilter(scopeOrFilter);
  const duplicateIds = duplicateBankIds(records);
  return records.filter((record) => (
    !duplicateIds.has(record.bank.bankId) && matchesFilter(record, filter)
  )).length;
}

function percentage(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round(numerator / denominator * 100);
}

function countMatches(
  records: readonly DashboardBankRecord[],
  scope: DashboardScope,
): number {
  return records.filter((record) => matchesScope(record, scope)).length;
}

export function getDashboardScopeOptions(
  records: readonly DashboardBankRecord[],
): DashboardScopeOptions {
  const recordsWithoutDuplicateIds = safeRecords(records);
  const folders = new Set<string>();
  const tags = new Set<string>();
  const sources = new Map<string, string>();
  for (const record of recordsWithoutDuplicateIds) {
    const sourcePath = normalizeVaultPath(record.bank.source.vaultPath);
    for (const folder of sourceFolderAncestors(sourcePath)) folders.add(folder);
    for (const tag of normalizedTags(record.sourceTags)) {
      for (const ancestor of tagAncestors(tag)) tags.add(ancestor);
    }
    const currentTitle = sources.get(sourcePath);
    if (currentTitle === undefined || record.bank.source.title.localeCompare(currentTitle) < 0) {
      sources.set(sourcePath, record.bank.source.title);
    }
  }

  const allScope = { kind: "all" } as const satisfies DashboardScope;
  return {
    all: {
      scope: allScope,
      label: "All practice",
      count: recordsWithoutDuplicateIds.length,
    },
    folders: [...folders]
      .sort((left, right) => left.localeCompare(right))
      .map((path) => {
        const scope = { kind: "folder", path } as const satisfies DashboardScope;
        return { scope, label: path, count: countMatches(recordsWithoutDuplicateIds, scope) };
      }),
    tags: [...tags]
      .sort((left, right) => left.localeCompare(right))
      .map((tag) => {
        const scope = { kind: "tag", tag } as const satisfies DashboardScope;
        return { scope, label: `#${tag}`, count: countMatches(recordsWithoutDuplicateIds, scope) };
      }),
    sources: [...sources.entries()]
      .sort(([leftPath, leftTitle], [rightPath, rightTitle]) => (
        leftTitle.localeCompare(rightTitle) || leftPath.localeCompare(rightPath)
      ))
      .map(([path, label]) => {
        const scope = { kind: "source", path } as const satisfies DashboardScope;
        return { scope, label, count: countMatches(recordsWithoutDuplicateIds, scope) };
      }),
  };
}

interface BankAggregation {
  readonly summary: DashboardBankSummary;
  readonly outcomesByType: ReadonlyMap<ExerciseV1["type"], readonly PerformanceOutcome[]>;
  readonly attemptedIdsByType: ReadonlyMap<ExerciseV1["type"], ReadonlySet<string>>;
  readonly recentSessions: readonly DashboardRecentSession[];
  readonly totalAvailableAnswers: number;
}

interface GuidedAttemptSummary {
  readonly guidedAttempts: number;
  readonly assistedGuidedAttemptCount: number;
  readonly hintsRevealed: number;
  readonly retries: number;
  readonly recoveredCount: number;
  readonly unresolvedCount: number;
}

function guidedAttemptSummary(bank: PracticeBankV4): GuidedAttemptSummary {
  let guidedAttempts = 0;
  let assistedGuidedAttemptCount = 0;
  let hintsRevealed = 0;
  let retries = 0;
  let recoveredCount = 0;
  let unresolvedCount = 0;
  for (const session of bank.sessions) {
    const resultIds = new Set(session.results.map((result) => result.exerciseId));
    const seen = new Set<string>();
    for (const evidence of session.evidence) {
      if (
        evidence.independent
        || seen.has(evidence.exerciseId)
        || !resultIds.has(evidence.exerciseId)
      ) continue;
      seen.add(evidence.exerciseId);
      guidedAttempts += 1;
      hintsRevealed += evidence.hintsRevealed;
      retries += evidence.retries;
      if (evidence.recoveryOutcome === "recovered") recoveredCount += 1;
      if (evidence.recoveryOutcome === "unresolved") unresolvedCount += 1;
      if (
        evidence.hintsRevealed > 0
        || evidence.retries > 0
        || evidence.recoveryOutcome === "recovered"
        || evidence.recoveryOutcome === "unresolved"
      ) assistedGuidedAttemptCount += 1;
    }
  }
  return {
    guidedAttempts,
    assistedGuidedAttemptCount,
    hintsRevealed,
    retries,
    recoveredCount,
    unresolvedCount,
  };
}

function learningEvidenceRow(
  entry: {
    readonly title: string;
    readonly historicalOnly: boolean;
  } & LearningEvidenceMetrics,
  id: string,
): DashboardLearningEvidenceRow {
  return {
    id,
    title: entry.title,
    historicalOnly: entry.historicalOnly,
    state: entry.state,
    independentAttempts: entry.independentAttempts,
    independentSessionCount: entry.independentSessionCount,
    guidedAttempts: entry.guidedAttempts,
    earnedPoints: entry.earnedPoints,
    weightedPercent: entry.weightedPercent,
    latestOutcome: entry.latestOutcome,
    hintsRevealed: entry.hintsRevealed,
    retries: entry.retries,
    recoveredCount: entry.recoveredCount,
    unresolvedCount: entry.unresolvedCount,
    pendingReviewCount: entry.pendingReviewCount,
    failedReviewCount: entry.failedReviewCount,
  };
}

function learningPathSummary(bank: PracticeBankV4): DashboardLearningPathSummary | null {
  const path = bank.learningPath;
  if (path === null) return null;
  const analytics = deriveLearningAnalytics(bank);
  const supportedAspects = bank.aspects.filter((aspect) => aspect.status === "supported");
  const supportedAspectIds = new Set(supportedAspects.map((aspect) => aspect.id));
  const unresolvedGaps = bank.aspects.filter((aspect) => aspect.status === "source-gap");
  const currentAspectEvidence = analytics.aspects.filter(
    (aspect) => !aspect.historicalOnly && supportedAspectIds.has(aspect.aspectId),
  );
  const currentLessonIds = new Set(path.steps.flatMap((step) => (
    step.kind === "lesson" ? [step.lessonId] : []
  )));
  const currentLessons = bank.tutorLessons.filter((lesson) => currentLessonIds.has(lesson.id));
  const completedLessonIds = new Set(bank.sessions.flatMap((session) => (
    session.completedTutorLessons.map((entry) => entry.lesson.id)
  )));
  const completedLessonCount = currentLessons.filter(
    (lesson) => completedLessonIds.has(lesson.id),
  ).length;
  const sourceSegmentIds = new Set(bank.sourceMaterials.flatMap(
    (material) => material.segmentIds,
  ));
  const coveredSourceSegmentIds = new Set(supportedAspects.flatMap(
    (aspect) => aspect.sourceSegmentIds.filter((id) => sourceSegmentIds.has(id)),
  ));
  const independentAttempts = analytics.sets.reduce(
    (total, set) => total + set.independentAttempts,
    0,
  );
  const independentEarnedPoints = analytics.sets.reduce(
    (total, set) => total + set.earnedPoints,
    0,
  );
  const guided = guidedAttemptSummary(bank);
  const pathSetIds = new Set(path.steps.flatMap((step) => (
    step.kind === "practice-set" ? [step.setId] : []
  )));

  return {
    pathId: path.id,
    title: path.title,
    startingLevel: path.startingLevel,
    setCount: pathSetIds.size,
    lessonCount: currentLessons.length,
    completedLessonCount,
    lessonCompletionPercent: percentage(completedLessonCount, currentLessons.length),
    remainingLessonTitles: currentLessons
      .filter((lesson) => !completedLessonIds.has(lesson.id))
      .map((lesson) => lesson.title),
    sourceMaterialCount: bank.sourceMaterials.length,
    sourceSegmentCount: sourceSegmentIds.size,
    coveredSourceSegmentCount: coveredSourceSegmentIds.size,
    sourceCoveragePercent: percentage(coveredSourceSegmentIds.size, sourceSegmentIds.size),
    supportedAspectCount: supportedAspects.length,
    unresolvedSourceGapCount: unresolvedGaps.length,
    unresolvedSourceGapTitles: unresolvedGaps.map((aspect) => aspect.title),
    unpracticedAspectCount: currentAspectEvidence.filter(
      (aspect) => aspect.state === "Unpracticed",
    ).length,
    developingAspectCount: currentAspectEvidence.filter(
      (aspect) => aspect.state === "Developing",
    ).length,
    consistentAspectCount: currentAspectEvidence.filter(
      (aspect) => aspect.state === "Consistent evidence",
    ).length,
    independentAttempts,
    independentEarnedPoints,
    independentPerformancePercent: percentage(independentEarnedPoints, independentAttempts),
    ...guided,
    assistanceRatePercent: percentage(
      guided.assistedGuidedAttemptCount,
      guided.guidedAttempts,
    ),
    recoveryRatePercent: percentage(
      guided.recoveredCount,
      guided.recoveredCount + guided.unresolvedCount,
    ),
    aspects: analytics.aspects
      .filter((aspect) => aspect.historicalOnly || supportedAspectIds.has(aspect.aspectId))
      .map((aspect) => learningEvidenceRow(aspect, aspect.aspectId)),
    sets: analytics.sets.map((set) => learningEvidenceRow(set, set.setId)),
    recommendation: recommendNextLearningStep(bank, analytics),
  };
}

function countEvidenceState(
  paths: readonly DashboardLearningPathSummary[],
  state: LearningEvidenceState,
): number {
  if (state === "Unpracticed") {
    return paths.reduce((total, path) => total + path.unpracticedAspectCount, 0);
  }
  if (state === "Developing") {
    return paths.reduce((total, path) => total + path.developingAspectCount, 0);
  }
  return paths.reduce((total, path) => total + path.consistentAspectCount, 0);
}

function aggregateLearningOverview(
  banks: readonly DashboardBankSummary[],
): DashboardLearningOverview {
  const paths = banks.flatMap((bank) => (
    bank.learningPath === null ? [] : [bank.learningPath]
  ));
  const sum = (select: (path: DashboardLearningPathSummary) => number): number => (
    paths.reduce((total, path) => total + select(path), 0)
  );
  const independentAttempts = sum((path) => path.independentAttempts);
  const independentEarnedPoints = sum((path) => path.independentEarnedPoints);
  const lessonCount = sum((path) => path.lessonCount);
  const completedLessonCount = sum((path) => path.completedLessonCount);
  const sourceSegmentCount = sum((path) => path.sourceSegmentCount);
  const coveredSourceSegmentCount = sum((path) => path.coveredSourceSegmentCount);
  const guidedAttempts = sum((path) => path.guidedAttempts);
  const assistedGuidedAttemptCount = sum((path) => path.assistedGuidedAttemptCount);
  const recoveredCount = sum((path) => path.recoveredCount);
  const unresolvedCount = sum((path) => path.unresolvedCount);
  return {
    pathBankCount: paths.length,
    supportedAspectCount: sum((path) => path.supportedAspectCount),
    unresolvedSourceGapCount: sum((path) => path.unresolvedSourceGapCount),
    unpracticedAspectCount: countEvidenceState(paths, "Unpracticed"),
    developingAspectCount: countEvidenceState(paths, "Developing"),
    consistentAspectCount: countEvidenceState(paths, "Consistent evidence"),
    independentAttempts,
    independentEarnedPoints,
    independentPerformancePercent: percentage(independentEarnedPoints, independentAttempts),
    lessonCount,
    completedLessonCount,
    lessonCompletionPercent: percentage(completedLessonCount, lessonCount),
    sourceSegmentCount,
    coveredSourceSegmentCount,
    sourceCoveragePercent: percentage(coveredSourceSegmentCount, sourceSegmentCount),
    guidedAttempts,
    assistedGuidedAttemptCount,
    assistanceRatePercent: percentage(assistedGuidedAttemptCount, guidedAttempts),
    hintsRevealed: sum((path) => path.hintsRevealed),
    retries: sum((path) => path.retries),
    recoveredCount,
    unresolvedCount,
    recoveryRatePercent: percentage(recoveredCount, recoveredCount + unresolvedCount),
  };
}

function aggregateBank(record: DashboardBankRecord): BankAggregation {
  const statistics = calculatePracticeBankStatistics(record.bank);
  const typeByExerciseId = new Map(
    record.bank.exercises.map((exercise) => [exercise.id, exercise.type]),
  );
  const outcomesByType = new Map<ExerciseV1["type"], PerformanceOutcome[]>();
  const attemptedIdsByType = new Map<ExerciseV1["type"], Set<string>>();
  for (const session of record.bank.sessions) {
    for (const result of session.results) {
      const type = typeByExerciseId.get(result.exerciseId);
      if (type === undefined) continue;
      const outcome = performanceOutcomeForResult(result);
      if (outcome !== null) {
        const outcomes = outcomesByType.get(type) ?? [];
        outcomes.push(outcome);
        outcomesByType.set(type, outcomes);
      }
      const attemptedIds = attemptedIdsByType.get(type) ?? new Set<string>();
      attemptedIds.add(result.exerciseId);
      attemptedIdsByType.set(type, attemptedIds);
    }
  }
  const practicedProblemCount = [...attemptedIdsByType.values()].reduce(
    (total, ids) => total + ids.size,
    0,
  );
  const bankPath = normalizeVaultPath(record.bankPath);
  const sourcePath = normalizeVaultPath(record.bank.source.vaultPath);
  const latestSessionAt = statistics.history[0]?.finishedAt ?? null;
  return {
    summary: {
      bankPath,
      bankId: record.bank.bankId,
      sourcePath,
      sourceTitle: record.bank.source.title,
      sourceTags: normalizedTags(record.sourceTags),
      sourceExists: record.sourceExists,
      problemCount: record.bank.exercises.length,
      practicedProblemCount,
      unpracticedProblemCount: record.bank.exercises.length - practicedProblemCount,
      sessionCount: statistics.sessionCount,
      answerCount: statistics.totalAnswered,
      completionPercent: statistics.completionPercent,
      performance: statistics.performance,
      bestAnswerStreak: statistics.bestAnswerStreak,
      latestSessionAt,
      unmappedAnswerCount: statistics.unmappedAttempts,
      freeResponseCorrect: statistics.freeResponseCorrect,
      freeResponsePartial: statistics.freeResponsePartial,
      freeResponseIncorrect: statistics.freeResponseIncorrect,
      reviewedAiResponseCount: statistics.reviewedAiResponseCount,
      pendingAiReviewCount: statistics.pendingAiReviewCount,
      failedAiReviewCount: statistics.failedAiReviewCount,
      provisional: statistics.provisional,
      learningPath: learningPathSummary(record.bank),
    },
    outcomesByType,
    attemptedIdsByType,
    recentSessions: statistics.history.map((session) => ({
      bankPath,
      bankId: record.bank.bankId,
      sourcePath,
      sourceTitle: record.bank.source.title,
      session,
    })),
    totalAvailableAnswers: record.bank.sessions.reduce(
      (total, session) => total + session.exerciseCount,
      0,
    ),
  };
}

function aggregateAlignmentHealth(
  records: readonly DashboardBankRecord[],
): DashboardAlignmentHealth {
  const ledgers = records.map((record) => record.bank.sourceAlignment);
  const courseCheckedBankCount = ledgers.filter((ledger) => (
    ledger.provenance !== null
    && ledger.records.some((record) => record.status !== "notes-only-unverified")
  )).length;
  const alignmentRecords = ledgers.flatMap((ledger) => ledger.records);
  return {
    courseCheckedBankCount,
    notCourseCheckedBankCount: records.length - courseCheckedBankCount,
    alignedRecordCount: alignmentRecords.filter((record) => (
      record.status === "aligned" || record.status === "school-only"
    )).length,
    noteDifferenceRecordCount: alignmentRecords.filter(
      (record) => record.status === "conflict",
    ).length,
    noteIncompleteRecordCount: alignmentRecords.filter(
      (record) => record.status === "notes-incomplete",
    ).length,
    schoolDisagreementRecordCount: alignmentRecords.filter(
      (record) => record.status === "school-sources-disagree",
    ).length,
    unresolvedRecordCount: alignmentRecords.filter(
      (record) => (
        record.resolution === "unresolved"
        && record.status !== "notes-only-unverified"
        && record.status !== "insufficient-evidence"
        && record.status !== "school-sources-disagree"
      ),
    ).length,
  };
}

function compareRecentSessions(
  left: DashboardRecentSession,
  right: DashboardRecentSession,
): number {
  const leftFinished = Date.parse(left.session.finishedAt);
  const rightFinished = Date.parse(right.session.finishedAt);
  return rightFinished - leftFinished
    || right.session.id.localeCompare(left.session.id)
    || left.bankPath.localeCompare(right.bankPath);
}

function compareExcludedDuplicateRecords(
  left: DashboardExcludedDuplicateRecord,
  right: DashboardExcludedDuplicateRecord,
): number {
  const compareText = (leftText: string, rightText: string): number => (
    leftText < rightText ? -1 : leftText > rightText ? 1 : 0
  );
  return compareText(left.bankId, right.bankId)
    || compareText(left.bankPath, right.bankPath)
    || compareText(left.sourcePath, right.sourcePath)
    || compareText(left.sourceTitle, right.sourceTitle);
}

export function aggregatePracticeDashboard(
  records: readonly DashboardBankRecord[],
  scopeOrFilter: DashboardScope | DashboardFilter,
): PracticeDashboardSummary {
  const filter = normalizeFilter(scopeOrFilter);
  const duplicateIds = duplicateBankIds(records);
  const selectedRawRecords = records.filter((record) => matchesFilter(record, filter));
  const excludedDuplicateRecords = selectedRawRecords.filter(
    (record) => duplicateIds.has(record.bank.bankId),
  );
  const affectedDuplicateIds = new Set(
    excludedDuplicateRecords.map((record) => record.bank.bankId),
  );
  const excludedDuplicateRecordDetails = records
    .filter((record) => affectedDuplicateIds.has(record.bank.bankId))
    .map((record): DashboardExcludedDuplicateRecord => ({
      bankId: record.bank.bankId,
      bankPath: normalizeVaultPath(record.bankPath),
      sourcePath: normalizeVaultPath(record.bank.source.vaultPath),
      sourceTitle: record.bank.source.title,
    }))
    .sort(compareExcludedDuplicateRecords);
  const selectedRecords = selectedRawRecords.filter(
    (record) => !duplicateIds.has(record.bank.bankId),
  );
  const aggregations = selectedRecords.map(aggregateBank);
  const banks = aggregations
    .map((aggregation) => aggregation.summary)
    .sort((left, right) => (
      left.sourceTitle.localeCompare(right.sourceTitle)
      || left.sourcePath.localeCompare(right.sourcePath)
      || left.bankPath.localeCompare(right.bankPath)
    ));

  const allOutcomes = selectedRecords.flatMap((record) => (
    record.bank.sessions.flatMap((session) => session.results.flatMap((result) => {
      const outcome = performanceOutcomeForResult(result);
      return outcome === null ? [] : [outcome];
    }))
  ));
  const performance = calculatePerformanceScore(allOutcomes);
  const answerCount = aggregations.reduce(
    (total, aggregation) => total + aggregation.summary.answerCount,
    0,
  );
  const totalAvailableAnswers = aggregations.reduce(
    (total, aggregation) => total + aggregation.totalAvailableAnswers,
    0,
  );
  const problemCount = banks.reduce((total, bank) => total + bank.problemCount, 0);
  const practicedProblemCount = banks.reduce(
    (total, bank) => total + bank.practicedProblemCount,
    0,
  );

  const typeBreakdown = EXERCISE_TYPE_ORDER.flatMap((type) => {
    const typeProblemCount = selectedRecords.reduce(
      (total, record) => total
        + record.bank.exercises.filter((exercise) => exercise.type === type).length,
      0,
    );
    if (typeProblemCount === 0) return [];
    const outcomes = aggregations.flatMap(
      (aggregation) => aggregation.outcomesByType.get(type) ?? [],
    );
    const typePracticedProblemCount = aggregations.reduce(
      (total, aggregation) => total
        + (aggregation.attemptedIdsByType.get(type)?.size ?? 0),
      0,
    );
    return [{
      type,
      problemCount: typeProblemCount,
      practicedProblemCount: typePracticedProblemCount,
      unpracticedProblemCount: typeProblemCount - typePracticedProblemCount,
      answerCount: outcomes.length,
      performance: calculatePerformanceScore(outcomes),
    }];
  });

  return {
    filter,
    bankCount: banks.length,
    problemCount,
    sessionCount: banks.reduce((total, bank) => total + bank.sessionCount, 0),
    answerCount,
    practicedBankCount: banks.filter((bank) => bank.sessionCount > 0).length,
    unpracticedBankCount: banks.filter((bank) => bank.sessionCount === 0).length,
    practicedProblemCount,
    unpracticedProblemCount: problemCount - practicedProblemCount,
    completionPercent: percentage(answerCount, totalAvailableAnswers),
    performance,
    bestAnswerStreak: banks.reduce(
      (best, bank) => Math.max(best, bank.bestAnswerStreak),
      0,
    ),
    objectiveCorrect: selectedRecords.reduce(
      (total, record) => total
        + record.bank.sessions.reduce((subtotal, session) => subtotal + session.score.correct, 0),
      0,
    ),
    objectiveTotal: selectedRecords.reduce(
      (total, record) => total
        + record.bank.sessions.reduce((subtotal, session) => subtotal + session.score.total, 0),
      0,
    ),
    freeResponseCorrect: banks.reduce((total, bank) => total + bank.freeResponseCorrect, 0),
    freeResponsePartial: banks.reduce((total, bank) => total + bank.freeResponsePartial, 0),
    freeResponseIncorrect: banks.reduce((total, bank) => total + bank.freeResponseIncorrect, 0),
    reviewedAiResponseCount: banks.reduce((total, bank) => total + bank.reviewedAiResponseCount, 0),
    pendingAiReviewCount: banks.reduce((total, bank) => total + bank.pendingAiReviewCount, 0),
    failedAiReviewCount: banks.reduce((total, bank) => total + bank.failedAiReviewCount, 0),
    provisional: banks.some((bank) => bank.provisional),
    unmappedAnswerCount: banks.reduce(
      (total, bank) => total + bank.unmappedAnswerCount,
      0,
    ),
    missingSourceCount: banks.filter((bank) => !bank.sourceExists).length,
    duplicateBankIdCount: new Set(
      excludedDuplicateRecords.map((record) => record.bank.bankId),
    ).size,
    excludedDuplicateRecordCount: excludedDuplicateRecords.length,
    excludedDuplicateRecords: excludedDuplicateRecordDetails,
    typeBreakdown,
    recentSessions: aggregations
      .flatMap((aggregation) => aggregation.recentSessions)
      .sort(compareRecentSessions),
    banks,
    learning: aggregateLearningOverview(banks),
    alignment: aggregateAlignmentHealth(selectedRecords),
  };
}
