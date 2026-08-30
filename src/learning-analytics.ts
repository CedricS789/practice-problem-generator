import type {
  LearningAspectV1,
  PracticeBankV4,
  SessionItemResultV2,
  SessionSummaryV3,
} from "./model";

export type LearningEvidenceState = "Unpracticed" | "Developing" | "Consistent evidence";
export type ScoredLearningOutcome = "incorrect" | "partial" | "correct";

export interface LearningEvidenceMetrics {
  readonly state: LearningEvidenceState;
  readonly independentAttempts: number;
  readonly independentSessionCount: number;
  readonly guidedAttempts: number;
  readonly earnedPoints: number;
  readonly weightedPercent: number | null;
  readonly latestOutcome: ScoredLearningOutcome | null;
  readonly hintsRevealed: number;
  readonly retries: number;
  readonly recoveredCount: number;
  readonly unresolvedCount: number;
  readonly pendingReviewCount: number;
  readonly failedReviewCount: number;
}

export interface AspectEvidenceSummary extends LearningEvidenceMetrics {
  readonly aspectId: string;
  readonly title: string;
  readonly historicalOnly: boolean;
}

export interface SetEvidenceSummary extends LearningEvidenceMetrics {
  readonly setId: string;
  readonly title: string;
  readonly historicalOnly: boolean;
}

export interface LearningAnalyticsSummary {
  readonly aspects: readonly AspectEvidenceSummary[];
  readonly sets: readonly SetEvidenceSummary[];
  readonly unmappedResultCount: number;
  readonly orphanedEvidenceCount: number;
  readonly duplicateEvidenceCount: number;
}

export type RecommendationReasonCode =
  | "unmet-prerequisite"
  | "unpracticed"
  | "developing"
  | "next-path-step"
  | "repair";

export interface RecommendedNextLearningStep {
  readonly kind: "lesson" | "practice-set";
  readonly id: string;
  readonly title: string;
  readonly aspectIds: readonly string[];
  readonly reasonCodes: readonly RecommendationReasonCode[];
  readonly reasons: readonly string[];
  readonly advisory: true;
  readonly canIgnore: true;
}

interface MutableEvidence {
  attempts: number;
  sessions: Set<string>;
  guided: number;
  points: number;
  latest: { at: number; outcome: ScoredLearningOutcome } | null;
  hints: number;
  retries: number;
  recovered: number;
  unresolved: number;
  pending: number;
  failed: number;
}

export function deriveLearningAnalytics(bank: PracticeBankV4): LearningAnalyticsSummary {
  const currentAspects = new Map(bank.aspects.map((aspect) => [aspect.id, aspect.title]));
  const currentSets = new Map(bank.practiceSets.map((set) => [set.id, set.title]));
  const aspectTitles = new Map(currentAspects);
  const setTitles = new Map(currentSets);
  const aspectMetrics = new Map<string, MutableEvidence>();
  const setMetrics = new Map<string, MutableEvidence>();
  let unmappedResultCount = 0;
  let orphanedEvidenceCount = 0;
  let duplicateEvidenceCount = 0;

  for (const session of bank.sessions) {
    const results = new Map(session.results.map((result) => [result.exerciseId, result]));
    const seenEvidence = new Set<string>();
    for (const evidence of session.evidence) {
      if (seenEvidence.has(evidence.exerciseId)) {
        duplicateEvidenceCount += 1;
        continue;
      }
      seenEvidence.add(evidence.exerciseId);
      const result = results.get(evidence.exerciseId);
      if (result === undefined) {
        orphanedEvidenceCount += 1;
        continue;
      }
      const score = resultScore(result);
      setTitles.set(evidence.set.id, currentSets.get(evidence.set.id) ?? evidence.set.title);
      for (const aspect of evidence.aspects) {
        aspectTitles.set(aspect.id, currentAspects.get(aspect.id) ?? aspect.title);
      }
      addEvidence(setMetrics, evidence.set.id, session, evidence, score);
      for (const aspect of evidence.aspects) {
        addEvidence(aspectMetrics, aspect.id, session, evidence, score);
      }
    }
    for (const result of session.results) {
      if (!seenEvidence.has(result.exerciseId)) unmappedResultCount += 1;
    }
  }

  return {
    aspects: [...aspectTitles].map(([aspectId, title]) => ({
      aspectId,
      title,
      historicalOnly: !currentAspects.has(aspectId),
      ...finalizeMetrics(aspectMetrics.get(aspectId)),
    })),
    sets: [...setTitles].map(([setId, title]) => ({
      setId,
      title,
      historicalOnly: !currentSets.has(setId),
      ...finalizeMetrics(setMetrics.get(setId)),
    })),
    unmappedResultCount,
    orphanedEvidenceCount,
    duplicateEvidenceCount,
  };
}

export function recommendNextLearningStep(
  bank: PracticeBankV4,
  analytics = deriveLearningAnalytics(bank),
): RecommendedNextLearningStep | null {
  const path = bank.learningPath;
  if (path === null) return null;
  const supported = new Map(bank.aspects
    .filter((aspect) => aspect.status === "supported")
    .map((aspect) => [aspect.id, aspect]));
  const evidence = new Map(analytics.aspects
    .filter((aspect) => !aspect.historicalOnly)
    .map((aspect) => [aspect.aspectId, aspect]));
  const pathAspects = path.aspectIds.flatMap((id) => {
    const aspect = supported.get(id);
    return aspect === undefined ? [] : [aspect];
  });
  if (
    pathAspects.length > 0
    && pathAspects.every((aspect) => evidence.get(aspect.id)?.state === "Consistent evidence")
  ) return null;

  const completedLessons = new Set(bank.sessions.flatMap((session) => (
    session.completedTutorLessons.map((entry) => entry.lesson.id)
  )));
  const steps = [...path.steps].sort((left, right) => left.order - right.order);
  for (const step of steps) {
    const target = stepTarget(bank, step);
    if (target === null || (target.kind === "lesson" && completedLessons.has(target.id))) continue;
    const targetAspects = target.aspectIds.flatMap((id) => {
      const aspect = supported.get(id);
      return aspect === undefined ? [] : [aspect];
    });
    for (const aspect of targetAspects) {
      for (const prerequisiteId of aspect.prerequisiteAspectIds) {
        const prerequisite = supported.get(prerequisiteId);
        const metric = evidence.get(prerequisiteId);
        if (prerequisite === undefined || prerequisiteSatisfied(metric)) continue;
        const destination = earliestStepForAspect(bank, prerequisiteId) ?? target;
        return recommendation(destination, [prerequisite], metric, true);
      }
    }
    const unresolved = targetAspects.filter((aspect) => !aspectSatisfied(evidence.get(aspect.id)));
    if (unresolved.length > 0) {
      const weakest = unresolved[0];
      return recommendation(target, unresolved, weakest === undefined ? undefined : evidence.get(weakest.id), false);
    }
  }
  return null;
}

function emptyMutable(): MutableEvidence {
  return {
    attempts: 0,
    sessions: new Set(),
    guided: 0,
    points: 0,
    latest: null,
    hints: 0,
    retries: 0,
    recovered: 0,
    unresolved: 0,
    pending: 0,
    failed: 0,
  };
}

function addEvidence(
  target: Map<string, MutableEvidence>,
  id: string,
  session: SessionSummaryV3,
  evidence: SessionSummaryV3["evidence"][number],
  score: ReturnType<typeof resultScore>,
): void {
  const metric = target.get(id) ?? emptyMutable();
  target.set(id, metric);
  metric.hints += evidence.hintsRevealed;
  metric.retries += evidence.retries;
  if (evidence.recoveryOutcome === "recovered") metric.recovered += 1;
  if (evidence.recoveryOutcome === "unresolved") metric.unresolved += 1;
  if (!evidence.independent) {
    metric.guided += 1;
    return;
  }
  if (score.state !== "scored") {
    if (score.state === "pending") metric.pending += 1;
    else metric.failed += 1;
    return;
  }
  metric.attempts += 1;
  metric.sessions.add(session.id);
  metric.points += score.points;
  const at = Date.parse(session.finishedAt);
  if (metric.latest === null || at >= metric.latest.at) {
    metric.latest = { at, outcome: score.outcome };
  }
}

function finalizeMetrics(metric = emptyMutable()): LearningEvidenceMetrics {
  const weighted = metric.attempts === 0 ? null : metric.points / metric.attempts;
  return {
    state: metric.attempts === 0
      ? "Unpracticed"
      : metric.attempts >= 3 && metric.sessions.size >= 2 && (weighted ?? 0) >= 0.8
        ? "Consistent evidence"
        : "Developing",
    independentAttempts: metric.attempts,
    independentSessionCount: metric.sessions.size,
    guidedAttempts: metric.guided,
    earnedPoints: metric.points,
    weightedPercent: weighted === null ? null : Math.round(weighted * 10_000) / 100,
    latestOutcome: metric.latest?.outcome ?? null,
    hintsRevealed: metric.hints,
    retries: metric.retries,
    recoveredCount: metric.recovered,
    unresolvedCount: metric.unresolved,
    pendingReviewCount: metric.pending,
    failedReviewCount: metric.failed,
  };
}

function resultScore(result: SessionItemResultV2):
  | { readonly state: "scored"; readonly points: number; readonly outcome: ScoredLearningOutcome }
  | { readonly state: "pending" | "failed" } {
  if (result.grading === "objective") {
    return {
      state: "scored",
      points: result.correct ? 1 : 0,
      outcome: result.correct ? "correct" : "incorrect",
    };
  }
  if (result.grading === "self-rated") {
    const points = result.rating === "again" ? 0 : result.rating === "hard" ? 0.5 : 1;
    return {
      state: "scored",
      points,
      outcome: points === 1 ? "correct" : points === 0.5 ? "partial" : "incorrect",
    };
  }
  if (result.state.status === "pending") return { state: "pending" };
  if (result.state.status === "failed") return { state: "failed" };
  return {
    state: "scored",
    points: result.state.verdict === "correct" ? 1 : result.state.verdict === "partial" ? 0.5 : 0,
    outcome: result.state.verdict,
  };
}

function prerequisiteSatisfied(metric: AspectEvidenceSummary | undefined): boolean {
  return metric?.state === "Consistent evidence" || metric?.latestOutcome === "correct";
}

function aspectSatisfied(metric: AspectEvidenceSummary | undefined): boolean {
  return metric?.state === "Consistent evidence" || metric?.latestOutcome === "correct";
}

type StepTarget = {
  readonly kind: "lesson" | "practice-set";
  readonly id: string;
  readonly title: string;
  readonly aspectIds: readonly string[];
};

function stepTarget(
  bank: PracticeBankV4,
  step: NonNullable<PracticeBankV4["learningPath"]>["steps"][number],
): StepTarget | null {
  if (step.kind === "lesson") {
    const lesson = bank.tutorLessons.find((entry) => entry.id === step.lessonId);
    return lesson === undefined ? null : {
      kind: "lesson",
      id: lesson.id,
      title: lesson.title,
      aspectIds: lesson.aspectIds,
    };
  }
  const set = bank.practiceSets.find((entry) => entry.id === step.setId);
  return set === undefined ? null : {
    kind: "practice-set",
    id: set.id,
    title: set.title,
    aspectIds: [...new Set(set.assignments.flatMap((assignment) => assignment.aspectIds))],
  };
}

function earliestStepForAspect(bank: PracticeBankV4, aspectId: string): StepTarget | null {
  const path = bank.learningPath;
  if (path === null) return null;
  for (const step of [...path.steps].sort((left, right) => left.order - right.order)) {
    const target = stepTarget(bank, step);
    if (target?.aspectIds.includes(aspectId) === true) return target;
  }
  return null;
}

function recommendation(
  target: StepTarget,
  aspects: readonly LearningAspectV1[],
  metric: AspectEvidenceSummary | undefined,
  prerequisite: boolean,
): RecommendedNextLearningStep {
  const reasonCodes: RecommendationReasonCode[] = [
    prerequisite ? "unmet-prerequisite" : "next-path-step",
  ];
  const reasons: string[] = [];
  if (prerequisite) {
    reasons.push(`${aspects[0]?.title ?? "A prerequisite"} is required before the dependent path step.`);
  }
  if (metric === undefined || metric.state === "Unpracticed") {
    reasonCodes.push("unpracticed");
    reasons.push("There is no scored independent evidence for this aspect yet.");
  } else {
    reasonCodes.push("developing");
    reasons.push(`${metric.independentAttempts} independent ${metric.independentAttempts === 1 ? "attempt is" : "attempts are"} still Developing at ${metric.weightedPercent ?? 0}%.`);
    if (metric.latestOutcome === "incorrect" || metric.latestOutcome === "partial") {
      reasonCodes.push("repair");
      reasons.push(`The latest independent outcome was ${metric.latestOutcome}, so a repair pass is recommended.`);
    }
  }
  return {
    ...target,
    aspectIds: aspects.map((aspect) => aspect.id),
    reasonCodes,
    reasons,
    advisory: true,
    canIgnore: true,
  };
}
