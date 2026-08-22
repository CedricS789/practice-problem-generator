import {
  createPracticeSetPayload,
  learningPathSourceFromMaterial,
  type LearningAspectDraftV1,
  type LearningBlueprintDraftV1,
  type LearningBlueprintPlanningInputV1,
  type PracticeSetBriefDraftV1,
  type PracticeSetDraftV1,
  type PracticeSetPayloadV1,
  type TutorLessonBriefDraftV1,
} from "./learning-path-generation";
import type {
  ExerciseV1,
  PracticeBankV3,
  PracticeSetV1,
  SessionItemResultV2,
  SessionSummaryV3,
} from "./model";
import type {
  GenerationRecipeCatalogV1,
  GenerationRecipeV2,
} from "./regeneration";
import type {
  FinishedStudySession,
  GenerationConfiguration,
  StudyAnswerRecord,
} from "./ui/contracts";

export interface SavedSetPayloadContextV1 {
  readonly planningInput: LearningBlueprintPlanningInputV1;
  readonly blueprint: LearningBlueprintDraftV1;
  readonly payload: PracticeSetPayloadV1;
  readonly siblingDrafts: readonly PracticeSetDraftV1[];
  readonly addingSet: boolean;
}

export interface RepairSetSeedEntryV1 {
  readonly exerciseId: string;
  readonly exerciseTitle: string;
  readonly outcome: "incorrect" | "partial";
  readonly aspectIds: readonly string[];
  readonly aspectTitles: readonly string[];
  readonly submittedAnswer?: string;
  readonly reviewFeedback?: string;
}

export interface RepairSetSeedV1 {
  readonly sessionId: string;
  readonly setId: string;
  readonly title: string;
  readonly purpose: string;
  readonly aspectIds: readonly string[];
  readonly entries: readonly RepairSetSeedEntryV1[];
}

export interface RepairPayloadDisclosureV1 {
  readonly includeSubmittedAnswers: boolean;
  readonly includeReviewFeedback: boolean;
}

/** Reconstructs the exact approved path context for one set-only AI call. */
export function createSavedSetPayloadContext(input: {
  readonly bank: PracticeBankV3;
  readonly targetSet: PracticeSetV1;
  readonly configuration: GenerationConfiguration;
  readonly recipeCatalog?: GenerationRecipeCatalogV1;
  readonly addingSet?: boolean;
  readonly targetAspectIds?: readonly string[];
  readonly batchId?: string;
}): SavedSetPayloadContextV1 {
  const path = input.bank.learningPath;
  if (path === null) {
    throw new Error("Set-only guided generation requires a saved learning path.");
  }
  const addingSet = input.addingSet === true;
  const existingTarget = input.bank.practiceSets.find((set) => set.id === input.targetSet.id);
  if (addingSet === (existingTarget !== undefined)) {
    throw new Error(addingSet
      ? "A repair set must use a new stable set ID."
      : "The set selected for regeneration no longer exists.");
  }
  const sets = addingSet
    ? [...input.bank.practiceSets, structuredClone(input.targetSet)]
    : input.bank.practiceSets.map((set) => (
        set.id === input.targetSet.id ? structuredClone(input.targetSet) : structuredClone(set)
      ));
  if (sets.length > 6) throw new Error("A learning path can contain at most six sets.");

  const sources = input.bank.sourceMaterials.map((material) => (
    learningPathSourceFromMaterial(material, input.bank.segments, input.bank.visuals)
  ));
  const aspects: LearningAspectDraftV1[] = input.bank.aspects.map((aspect) => ({
    id: aspect.id,
    title: aspect.title,
    purpose: aspect.purpose,
    status: aspect.status,
    prerequisiteAspectIds: [...aspect.prerequisiteAspectIds],
    sourceSegmentIds: [...aspect.sourceSegmentIds],
  }));
  const tutorLessonBriefs = tutorBriefs(input.bank);
  const setBriefs: PracticeSetBriefDraftV1[] = [...sets]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((set, order) => {
      const target = set.id === input.targetSet.id;
      const recipe = recipeForSet(input.recipeCatalog, set.id);
      const ownedTutorIds = input.bank.tutorLessons
        .filter((lesson) => set.assignments.some((assignment) => (
          assignment.exerciseId === lesson.guidedExerciseId
        )))
        .map((lesson) => lesson.id);
      return {
        id: set.id,
        title: set.title,
        purpose: set.purpose,
        instructionalRole: set.instructionalRole,
        order,
        aspectIds: target && input.targetAspectIds !== undefined
          ? unique(input.targetAspectIds)
          : unique(set.assignments.flatMap((assignment) => assignment.aspectIds)),
        tutorLessonBriefIds: target && addingSet ? [] : ownedTutorIds,
        recommendedQuantity: target
          ? input.configuration.quantity
          : Math.max(1, set.assignments.length),
        recommendedDifficulty: target
          ? input.configuration.difficulty
          : recipe?.difficulty ?? "deep-exam",
      };
    });
  const blueprint: LearningBlueprintDraftV1 = {
    schemaVersion: 1,
    blueprintId: path.id,
    title: path.title,
    overview: `Saved learning path for ${input.bank.source.title}.`,
    aspects,
    tutorLessonBriefs,
    sets: setBriefs,
  };
  const planningInput: LearningBlueprintPlanningInputV1 = {
    startingLevel: path.startingLevel,
    desiredSetCount: setBriefs.length,
    globalFocusInstructions: "",
    sources,
  };
  const payload = createPracticeSetPayload({
    batchId: input.batchId ?? `set-update-${crypto.randomUUID()}`,
    planningInput,
    blueprint,
    targetSetId: input.targetSet.id,
    configuration: input.configuration,
  });
  const siblingDrafts = input.bank.practiceSets
    .filter((set) => set.id !== input.targetSet.id)
    .map((set) => practiceSetDraftFromBank(input.bank, set));
  return {
    planningInput,
    blueprint,
    payload,
    siblingDrafts,
    addingSet,
  };
}

export function practiceSetDraftFromBank(
  bank: PracticeBankV3,
  set: PracticeSetV1,
): PracticeSetDraftV1 {
  const exerciseById = new Map(bank.exercises.map((exercise) => [exercise.id, exercise]));
  const exercises = set.assignments.map((assignment) => {
    const exercise = exerciseById.get(assignment.exerciseId);
    if (exercise === undefined) {
      throw new Error(`Set ${set.title} references missing exercise ${assignment.exerciseId}.`);
    }
    return structuredClone(exercise);
  });
  const exerciseIds = new Set(exercises.map((exercise) => exercise.id));
  return {
    schemaVersion: 1,
    setId: set.id,
    exercises,
    assignments: set.assignments.map((assignment) => structuredClone(assignment)),
    tutorLessons: bank.tutorLessons
      .filter((lesson) => exerciseIds.has(lesson.guidedExerciseId))
      .map((lesson) => structuredClone(lesson)),
  };
}

/** Build a local repair brief from the just-finished independent evidence. */
export function deriveRepairSetSeed(
  bank: PracticeBankV3,
  session: SessionSummaryV3,
  finished?: FinishedStudySession,
): RepairSetSeedV1 | null {
  const resultByExercise = new Map(session.results.map((result) => [result.exerciseId, result]));
  const answerByExercise = new Map(
    (finished?.answers ?? []).map((answer) => [answer.exerciseId, answer]),
  );
  const exerciseById = new Map(bank.exercises.map((exercise) => [exercise.id, exercise]));
  const aspectById = new Map(bank.aspects.map((aspect) => [aspect.id, aspect]));
  const entries: RepairSetSeedEntryV1[] = [];
  for (const evidence of session.evidence) {
    if (!evidence.independent) continue;
    const result = resultByExercise.get(evidence.exerciseId);
    const outcome = result === undefined ? null : repairOutcome(result);
    if (outcome === null) continue;
    const exercise = exerciseById.get(evidence.exerciseId);
    const answer = answerByExercise.get(evidence.exerciseId);
    const reviewFeedback = result?.grading === "ai-review"
      && result.state.status === "reviewed"
      ? result.state.feedback
      : undefined;
    entries.push({
      exerciseId: evidence.exerciseId,
      exerciseTitle: exercise?.title ?? evidence.exerciseId,
      outcome,
      aspectIds: evidence.aspects.map((aspect) => aspect.id),
      aspectTitles: evidence.aspects.map((aspect) => (
        aspectById.get(aspect.id)?.title ?? aspect.title
      )),
      ...(answer === undefined ? {} : { submittedAnswer: submittedAnswerText(answer) }),
      ...(reviewFeedback === undefined ? {} : { reviewFeedback }),
    });
  }
  if (entries.length === 0) return null;
  const aspectIds = unique(entries.flatMap((entry) => entry.aspectIds));
  const aspectTitles = aspectIds.map((id) => aspectById.get(id)?.title ?? id);
  return {
    sessionId: session.id,
    setId: `set-repair-${crypto.randomUUID()}`,
    title: `Repair: ${aspectTitles.slice(0, 2).join(" + ")}`,
    purpose: "Target the incomplete independent evidence from the latest session with fresh, source-grounded problems. Do not repeat the original prompts.",
    aspectIds,
    entries,
  };
}

/**
 * The returned text is intended for the visible payload preview. Authored
 * answers and review feedback are excluded unless their separate switches are
 * enabled.
 */
export function repairFocusInstructions(
  seed: RepairSetSeedV1,
  disclosure: RepairPayloadDisclosureV1,
): string {
  const lines = [
    "Build a repair set for the locally identified incomplete independent evidence below.",
    "Create fresh problems that target the same supported aspects; do not repeat the original prompts.",
  ];
  for (const [index, entry] of seed.entries.entries()) {
    lines.push(`${index + 1}. ${entry.exerciseTitle}: ${entry.outcome}; aspects: ${entry.aspectTitles.join(", ")}.`);
    if (disclosure.includeSubmittedAnswers && entry.submittedAnswer !== undefined) {
      lines.push(`   Submitted answer approved for this payload: ${entry.submittedAnswer}`);
    }
    if (disclosure.includeReviewFeedback && entry.reviewFeedback !== undefined) {
      lines.push(`   Review feedback approved for this payload: ${entry.reviewFeedback}`);
    }
  }
  return lines.join("\n").slice(0, 4_000);
}

function tutorBriefs(bank: PracticeBankV3): TutorLessonBriefDraftV1[] {
  return bank.tutorLessons.map((lesson) => ({
    id: lesson.id,
    title: lesson.title,
    objective: lesson.objective,
    aspectIds: [...lesson.aspectIds],
    prerequisiteAspectIds: [...lesson.prerequisiteAspectIds],
    sourceSegmentIds: unique([
      ...lesson.teachingBlocks.flatMap((block) => block.sourceSegmentIds),
      ...lesson.selfExplanationCheck.sourceSegmentIds,
      ...lesson.hints.flatMap((hint) => hint.sourceSegmentIds),
      ...lesson.repairExplanation.sourceSegmentIds,
    ]),
  }));
}

function recipeForSet(
  catalog: GenerationRecipeCatalogV1 | undefined,
  setId: string,
): GenerationRecipeV2 | undefined {
  return catalog?.recipesBySetId[setId];
}

function repairOutcome(result: SessionItemResultV2): "incorrect" | "partial" | null {
  if (result.grading === "objective") return result.correct ? null : "incorrect";
  if (result.grading === "self-rated") {
    return result.rating === "again" ? "incorrect" : result.rating === "hard" ? "partial" : null;
  }
  if (result.state.status !== "reviewed") return null;
  return result.state.verdict === "correct" ? null : result.state.verdict;
}

function submittedAnswerText(answer: StudyAnswerRecord): string {
  return answer.submittedAnswer ?? "";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function exerciseTitle(exercise: ExerciseV1): string {
  return exercise.title.trim().length > 0 ? exercise.title : exercise.prompt.slice(0, 80);
}
