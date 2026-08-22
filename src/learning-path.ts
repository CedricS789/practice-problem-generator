import { exerciseLatexMarkupProblems, latexMarkupProblem } from "./latex";
import {
  CURRENT_PRACTICE_BANK_SCHEMA_VERSION,
  type LearningAspectV1,
  type PracticeBankV2,
  type PracticeBankV3,
  type ExerciseV1,
  type PracticeSetV1,
  type CompletedTutorLessonSnapshotV3,
  type SessionExerciseEvidenceV3,
  type SessionLearningScopeV3,
  type SessionSummaryV2,
  type SessionSummaryV3,
  type SourceMaterialScopeV1,
  type TutorLessonV1,
  type ValidationIssue,
} from "./model";

export const GENERAL_SOURCE_MATERIAL_ID = "source-primary" as const;
export const GENERAL_ASPECT_ID = "aspect-general" as const;
export const GENERAL_PRACTICE_SET_ID = "set-general" as const;

export interface PdfSourceScopeMigrationV1 {
  readonly sourceHash: string;
  readonly pdfContentHash: string;
  readonly firstPage: number;
  readonly lastPage: number;
  readonly pageCount: number;
}

function legacySourceScope(
  bank: PracticeBankV2,
  pdf?: PdfSourceScopeMigrationV1,
): SourceMaterialScopeV1 {
  if (/\.pdf$/iu.test(bank.source.vaultPath) && pdf !== undefined) {
    return {
      kind: "pdf-pages",
      firstPage: pdf.firstPage,
      lastPage: pdf.lastPage,
      pageCount: pdf.pageCount,
      pdfContentHash: pdf.pdfContentHash,
    };
  }
  return { kind: bank.source.scope };
}

export interface SessionLearningMetadataV3 {
  readonly scope: SessionLearningScopeV3;
  readonly evidence: readonly SessionExerciseEvidenceV3[];
  readonly completedTutorLessons: readonly CompletedTutorLessonSnapshotV3[];
}

export function defaultSessionLearningMetadataV3(
  bank: PracticeBankV2,
  exerciseIds: readonly string[],
): SessionLearningMetadataV3 {
  const v3 = bank.schemaVersion === CURRENT_PRACTICE_BANK_SCHEMA_VERSION
    ? bank as PracticeBankV3
    : undefined;
  const fallbackSet = { id: GENERAL_PRACTICE_SET_ID, title: "General practice" };
  const fallbackAspect = { id: GENERAL_ASPECT_ID, title: "General practice" };
  const liveSets = new Map(v3?.practiceSets.map((set) => [set.id, set]) ?? []);
  const liveAspects = new Map(v3?.aspects.map((aspect) => [aspect.id, aspect]) ?? []);
  const evidence = exerciseIds.map((exerciseId): SessionExerciseEvidenceV3 => {
    const owning = v3?.practiceSets.flatMap((set) =>
      set.assignments
        .filter((assignment) => assignment.exerciseId === exerciseId)
        .map((assignment) => ({ set, assignment })),
    )[0];
    if (owning === undefined) {
      return {
        exerciseId,
        set: fallbackSet,
        aspects: [fallbackAspect],
        instructionalRole: "independent",
        independent: true,
        hintsRevealed: 0,
        retries: 0,
        recoveryOutcome: "not-recorded",
      };
    }
    return {
      exerciseId,
      set: { id: owning.set.id, title: owning.set.title },
      aspects: owning.assignment.aspectIds.map((id) => ({
        id,
        title: liveAspects.get(id)?.title ?? id,
      })),
      instructionalRole: owning.assignment.role,
      independent: owning.assignment.role === "independent"
        || owning.assignment.role === "transfer"
        || owning.assignment.role === "diagnostic",
      hintsRevealed: 0,
      retries: 0,
      recoveryOutcome: "not-recorded",
    };
  });
  const recordedSetIds = [...new Set(evidence.map((entry) => entry.set.id))];
  const setIds = recordedSetIds.length === 0
    ? [GENERAL_PRACTICE_SET_ID]
    : recordedSetIds;
  const sets = setIds.map((id) => {
    const set = liveSets.get(id);
    return set === undefined
      ? evidence.find((entry) => entry.set.id === id)?.set ?? fallbackSet
      : { id, title: set.title };
  });
  const mode = v3 === undefined || setIds.every((id) => id === GENERAL_PRACTICE_SET_ID)
    ? "quick"
    : setIds.length === 1
      ? "set"
      : "mixed";
  return { scope: { mode, sets }, evidence, completedTutorLessons: [] };
}

export function migrateSessionSummaryV2ToV3(
  bank: PracticeBankV2,
  session: SessionSummaryV2,
): SessionSummaryV3 {
  if (
    session.schemaVersion === CURRENT_PRACTICE_BANK_SCHEMA_VERSION
    && "scope" in session
    && "evidence" in session
    && "completedTutorLessons" in session
  ) return structuredClone(session) as SessionSummaryV3;
  const learning = defaultSessionLearningMetadataV3(
    bank,
    session.results.map((result) => result.exerciseId),
  );
  return {
    ...structuredClone(session),
    schemaVersion: CURRENT_PRACTICE_BANK_SCHEMA_VERSION,
    scope: structuredClone(learning.scope),
    evidence: learning.evidence.map((entry) => structuredClone(entry)),
    completedTutorLessons: learning.completedTutorLessons.map((entry) => structuredClone(entry)),
  };
}

/**
 * Lossless structural migration. The flat source, exercise, session result,
 * review, timestamp, and revision records remain byte-for-byte equivalent
 * after JSON cloning; v3 only adds references and immutable evidence labels.
 */
export function migratePracticeBankV2ToV3(
  bank: PracticeBankV2,
  pdf?: PdfSourceScopeMigrationV1,
): PracticeBankV3 {
  if (bank.schemaVersion === CURRENT_PRACTICE_BANK_SCHEMA_VERSION) {
    return structuredClone(bank) as PracticeBankV3;
  }
  const segmentIds = bank.segments.map((segment) => segment.id);
  const generalAspect: LearningAspectV1 = {
    id: GENERAL_ASPECT_ID,
    title: "General practice",
    purpose: "Practice the explicitly approved source material.",
    prerequisiteAspectIds: [],
    sourceSegmentIds: segmentIds,
    status: "supported",
  };
  return {
    ...structuredClone(bank),
    schemaVersion: CURRENT_PRACTICE_BANK_SCHEMA_VERSION,
    sessions: bank.sessions.map((session) => migrateSessionSummaryV2ToV3(bank, session)),
    sourceMaterials: [{
      id: GENERAL_SOURCE_MATERIAL_ID,
      role: "primary",
      vaultPath: bank.source.vaultPath,
      wikilink: bank.source.wikilink,
      title: bank.source.title,
      sourceHash: bank.source.hash,
      scope: legacySourceScope(bank, pdf),
      segmentIds,
      visualIds: bank.visuals.map((visual) => visual.id),
    }],
    aspects: [generalAspect],
    practiceSets: [{
      id: GENERAL_PRACTICE_SET_ID,
      title: "General practice",
      purpose: "The original practice bank, preserved as one independent set.",
      instructionalRole: "general",
      order: 0,
      assignments: bank.exercises.map((exercise) => ({
        exerciseId: exercise.id,
        aspectIds: [GENERAL_ASPECT_ID],
        role: "independent",
      })),
    }],
    tutorLessons: [],
    learningPath: null,
  };
}

export interface PracticeSetContentReplacementV1 {
  readonly set: PracticeSetV1;
  readonly exercises: readonly ExerciseV1[];
  readonly tutorLessons: readonly TutorLessonV1[];
}

/** Replaces only one live set. Historical session snapshots are never rewritten. */
export function replacePracticeSetContent(
  bank: PracticeBankV3,
  setId: string,
  replacement: PracticeSetContentReplacementV1,
  updatedAt: string,
): PracticeBankV3 {
  const previousUpdatedTime = Date.parse(bank.updatedAt);
  const replacementUpdatedTime = Date.parse(updatedAt);
  if (
    !Number.isFinite(previousUpdatedTime)
    || !Number.isFinite(replacementUpdatedTime)
    || replacementUpdatedTime < previousUpdatedTime
  ) {
    throw new Error("A practice-set replacement requires a valid non-decreasing timestamp.");
  }
  const setIndex = bank.practiceSets.findIndex((set) => set.id === setId);
  const previousSet = bank.practiceSets[setIndex];
  if (previousSet === undefined) throw new Error(`Practice set ${setId} does not exist.`);
  if (replacement.set.id !== setId) throw new Error("A set replacement cannot change the set ID.");
  const replacementExerciseIds = replacement.exercises.map((exercise) => exercise.id);
  if (duplicateIds(replacementExerciseIds)) throw new Error("Replacement exercise IDs must be unique.");
  const assignmentIds = replacement.set.assignments.map((assignment) => assignment.exerciseId);
  if (
    duplicateIds(assignmentIds)
    || replacementExerciseIds.length !== assignmentIds.length
    || replacementExerciseIds.some((id) => !assignmentIds.includes(id))
  ) {
    throw new Error("Replacement assignments must own every replacement exercise exactly once.");
  }
  const previousExerciseIds = new Set(
    previousSet.assignments.map((assignment) => assignment.exerciseId),
  );
  const otherExerciseIds = new Set(
    bank.exercises
      .filter((exercise) => !previousExerciseIds.has(exercise.id))
      .map((exercise) => exercise.id),
  );
  const collision = replacementExerciseIds.find((id) => otherExerciseIds.has(id));
  if (collision !== undefined) {
    throw new Error(`Replacement exercise ${collision} collides with another set.`);
  }
  const firstPreviousIndex = bank.exercises.findIndex((exercise) =>
    previousExerciseIds.has(exercise.id),
  );
  const preservedExercises = bank.exercises.filter((exercise) =>
    !previousExerciseIds.has(exercise.id),
  );
  const insertionIndex = firstPreviousIndex < 0
    ? preservedExercises.length
    : Math.min(firstPreviousIndex, preservedExercises.length);
  const exercises = [
    ...preservedExercises.slice(0, insertionIndex),
    ...replacement.exercises.map((exercise) => structuredClone(exercise)),
    ...preservedExercises.slice(insertionIndex),
  ];

  const priorLessonIds = new Set(
    bank.tutorLessons
      .filter((lesson) => previousExerciseIds.has(lesson.guidedExerciseId))
      .map((lesson) => lesson.id),
  );
  if (replacement.tutorLessons.some((lesson) =>
    !replacementExerciseIds.includes(lesson.guidedExerciseId),
  )) {
    throw new Error("Replacement tutor lessons must link to exercises in their own set.");
  }
  const preservedLessons = bank.tutorLessons.filter((lesson) =>
    !priorLessonIds.has(lesson.id),
  );
  const lessonCollision = replacement.tutorLessons.find((lesson) =>
    preservedLessons.some((existing) => existing.id === lesson.id),
  );
  if (lessonCollision !== undefined) {
    throw new Error(`Replacement tutor lesson ${lessonCollision.id} collides with another set.`);
  }
  const tutorLessons = [
    ...preservedLessons,
    ...replacement.tutorLessons.map((lesson) => structuredClone(lesson)),
  ];

  const learningPath = bank.learningPath === null
    ? null
    : {
        ...structuredClone(bank.learningPath),
        steps: bank.learningPath.steps
          .filter((step) => step.kind !== "lesson" || !priorLessonIds.has(step.lessonId))
          .flatMap((step) => step.kind === "practice-set" && step.setId === setId
            ? [
                ...replacement.tutorLessons.map((lesson) => ({
                  kind: "lesson" as const,
                  lessonId: lesson.id,
                  order: 0,
                })),
                { ...step, order: 0 },
              ]
            : [{ ...step, order: 0 }])
          .map((step, order) => ({ ...step, order })),
      };

  return {
    ...structuredClone(bank),
    revision: bank.revision + 1,
    updatedAt,
    exercises,
    practiceSets: bank.practiceSets.map((set, index) => index === setIndex
      ? { ...structuredClone(replacement.set), order: previousSet.order }
      : structuredClone(set)),
    tutorLessons,
    learningPath,
    sessions: bank.sessions.map((session) => structuredClone(session)),
  };
}

function duplicateIds(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function issue(
  issues: ValidationIssue[],
  code: ValidationIssue["code"],
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function safeVaultPath(path: string): boolean {
  const normalized = path.replace(/\\/gu, "/");
  return !normalized.startsWith("/")
    && !/^[A-Za-z]:\//u.test(normalized)
    && !normalized.split("/").some((part) => part === "" || part === "." || part === "..")
    && /\.(?:md|pdf)$/iu.test(normalized);
}

function exactOrders(values: readonly number[]): boolean {
  return values.every((value, index) => value === index);
}

function citedTextProblems(
  value: string,
  path: string,
  issues: ValidationIssue[],
): void {
  const problem = latexMarkupProblem(value);
  if (problem !== null) issue(issues, "tutor", path, `contains malformed LaTeX: ${problem}`);
}

/** Strict cross-reference and progression validation for the v3 domain. */
export function learningPathBankIssues(bank: PracticeBankV3): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const segmentIds = new Set(bank.segments.map((segment) => segment.id));
  const visualIds = new Set(bank.visuals.map((visual) => visual.id));
  const exerciseIds = new Set(bank.exercises.map((exercise) => exercise.id));

  const materialIds = bank.sourceMaterials.map((material) => material.id);
  if (duplicateIds(materialIds)) {
    issue(issues, "source-material", "/sourceMaterials", "source-material IDs must be unique");
  }
  const primaries = bank.sourceMaterials.filter((material) => material.role === "primary");
  if (primaries.length !== 1) {
    issue(issues, "source-material", "/sourceMaterials", "exactly one source material must be primary");
  }
  const segmentOwners = new Map<string, number>();
  const visualOwners = new Map<string, number>();
  for (const [index, material] of bank.sourceMaterials.entries()) {
    const path = `/sourceMaterials/${index}`;
    if (!safeVaultPath(material.vaultPath)) {
      issue(issues, "source-material", `${path}/vaultPath`, "must be a safe vault-relative Markdown or PDF path");
    }
    if (!material.wikilink.startsWith("[[") || !material.wikilink.endsWith("]]")) {
      issue(issues, "source-material", `${path}/wikilink`, "must use Obsidian [[...]] syntax");
    }
    if (duplicateIds(material.segmentIds) || duplicateIds(material.visualIds)) {
      issue(issues, "source-material", path, "owned segment and visual IDs must be unique");
    }
    for (const id of material.segmentIds) {
      if (!segmentIds.has(id)) issue(issues, "source-material", `${path}/segmentIds`, `unknown segment ${id}`);
      if (material.role === "supporting" && !id.startsWith(`${material.id}:`)) {
        issue(issues, "source-material", `${path}/segmentIds`, `supporting segment ${id} must be namespaced by ${material.id}:`);
      }
      segmentOwners.set(id, (segmentOwners.get(id) ?? 0) + 1);
    }
    for (const id of material.visualIds) {
      if (!visualIds.has(id)) issue(issues, "source-material", `${path}/visualIds`, `unknown visual ${id}`);
      if (material.role === "supporting" && !id.startsWith(`${material.id}:`)) {
        issue(issues, "source-material", `${path}/visualIds`, `supporting visual ${id} must be namespaced by ${material.id}:`);
      }
      visualOwners.set(id, (visualOwners.get(id) ?? 0) + 1);
    }
    const pdfPath = /\.pdf$/iu.test(material.vaultPath);
    if (pdfPath !== (material.scope.kind === "pdf-pages")) {
      issue(issues, "source-material", `${path}/scope`, "PDF materials require page scope and non-PDF materials cannot use it");
    }
    if (
      material.scope.kind === "pdf-pages"
      && (
        material.scope.firstPage > material.scope.lastPage
        || material.scope.lastPage > material.scope.pageCount
      )
    ) {
      issue(issues, "source-material", `${path}/scope`, "PDF page range falls outside the document");
    }
  }
  for (const id of segmentIds) {
    if (segmentOwners.get(id) !== 1) issue(issues, "source-material", "/sourceMaterials", `segment ${id} must have exactly one owner`);
  }
  for (const id of visualIds) {
    if (visualOwners.get(id) !== 1) issue(issues, "source-material", "/sourceMaterials", `visual ${id} must have exactly one owner`);
  }
  const primary = primaries[0];
  if (
    primary !== undefined
    && (
      primary.vaultPath !== bank.source.vaultPath
      || primary.wikilink !== bank.source.wikilink
    )
  ) {
    issue(issues, "source-material", "/sourceMaterials", "the primary material must match the compatibility source identity");
  }
  if (
    primary !== undefined
    && bank.sourceMaterials.length === 1
    && (primary.title !== bank.source.title || primary.sourceHash !== bank.source.hash)
  ) {
    issue(issues, "source-material", "/sourceMaterials", "a single primary material must match the compatibility source snapshot");
  }

  const aspectIds = bank.aspects.map((aspect) => aspect.id);
  const aspectById = new Map(bank.aspects.map((aspect) => [aspect.id, aspect]));
  const aspectIndex = new Map(bank.aspects.map((aspect, index) => [aspect.id, index]));
  if (duplicateIds(aspectIds)) issue(issues, "aspect", "/aspects", "aspect IDs must be unique");
  for (const [index, aspect] of bank.aspects.entries()) {
    const path = `/aspects/${index}`;
    citedTextProblems(aspect.title, `${path}/title`, issues);
    citedTextProblems(aspect.purpose, `${path}/purpose`, issues);
    if (duplicateIds(aspect.prerequisiteAspectIds) || duplicateIds(aspect.sourceSegmentIds)) {
      issue(issues, "aspect", path, "prerequisites and source references must be unique");
    }
    for (const prerequisiteId of aspect.prerequisiteAspectIds) {
      const prerequisiteIndex = aspectIndex.get(prerequisiteId);
      if (prerequisiteIndex === undefined) {
        issue(issues, "aspect", `${path}/prerequisiteAspectIds`, `unknown prerequisite ${prerequisiteId}`);
      } else if (prerequisiteIndex >= index) {
        issue(issues, "aspect", `${path}/prerequisiteAspectIds`, `prerequisite ${prerequisiteId} must appear before its dependent aspect`);
      }
    }
    if (aspect.sourceSegmentIds.some((id) => !segmentIds.has(id))) {
      issue(issues, "aspect", `${path}/sourceSegmentIds`, "aspect source references must exist in the approved source bundle");
    }
    if (aspect.status === "supported" && aspect.sourceSegmentIds.length === 0) {
      issue(issues, "aspect", `${path}/sourceSegmentIds`, "a supported aspect requires cited source evidence");
    }
  }

  const setIds = bank.practiceSets.map((set) => set.id);
  const setById = new Map(bank.practiceSets.map((set) => [set.id, set]));
  if (duplicateIds(setIds)) issue(issues, "practice-set", "/practiceSets", "practice-set IDs must be unique");
  if (!exactOrders(bank.practiceSets.map((set) => set.order))) {
    issue(issues, "practice-set", "/practiceSets", "practice-set order must be contiguous and match array order");
  }
  const assignedExerciseIds = new Set<string>();
  const assignmentOwners = new Map<string, PracticeBankV3["practiceSets"][number]["assignments"][number]>();
  const assignmentSetOwners = new Map<string, PracticeSetV1>();
  for (const [setIndex, set] of bank.practiceSets.entries()) {
    const path = `/practiceSets/${setIndex}`;
    citedTextProblems(set.title, `${path}/title`, issues);
    citedTextProblems(set.purpose, `${path}/purpose`, issues);
    if (set.assignments.length === 0) issue(issues, "practice-set", `${path}/assignments`, "a practice set cannot be empty");
    if (duplicateIds(set.assignments.map((assignment) => assignment.exerciseId))) {
      issue(issues, "practice-set", `${path}/assignments`, "an exercise may appear only once in a set");
    }
    for (const [assignmentIndex, assignment] of set.assignments.entries()) {
      const assignmentPath = `${path}/assignments/${assignmentIndex}`;
      if (!exerciseIds.has(assignment.exerciseId)) {
        issue(issues, "practice-set", `${assignmentPath}/exerciseId`, `unknown exercise ${assignment.exerciseId}`);
      }
      if (assignedExerciseIds.has(assignment.exerciseId)) {
        issue(issues, "practice-set", `${assignmentPath}/exerciseId`, `exercise ${assignment.exerciseId} is assigned to more than one set`);
      }
      assignedExerciseIds.add(assignment.exerciseId);
      assignmentOwners.set(assignment.exerciseId, assignment);
      assignmentSetOwners.set(assignment.exerciseId, set);
      if (assignment.aspectIds.length === 0 || duplicateIds(assignment.aspectIds)) {
        issue(issues, "practice-set", `${assignmentPath}/aspectIds`, "an assignment requires unique aspect references");
      }
      const assignedAspects = assignment.aspectIds.flatMap((id) => {
        const aspect = aspectById.get(id);
        if (aspect === undefined) {
          issue(issues, "practice-set", `${assignmentPath}/aspectIds`, `unknown aspect ${id}`);
          return [];
        }
        if (aspect.status !== "supported") {
          issue(issues, "practice-set", `${assignmentPath}/aspectIds`, `source-gap aspect ${id} cannot be practiced`);
        }
        return [aspect];
      });
      const exercise = bank.exercises.find((candidate) => candidate.id === assignment.exerciseId);
      const coveredSegments = new Set(assignedAspects.flatMap((aspect) => aspect.sourceSegmentIds));
      if (exercise?.sourceSegmentIds.some((id) => !coveredSegments.has(id))) {
        issue(issues, "practice-set", assignmentPath, "assigned aspects must cover every exercise source reference");
      }
    }
  }
  for (const id of exerciseIds) {
    if (!assignedExerciseIds.has(id)) issue(issues, "practice-set", "/practiceSets", `exercise ${id} is not assigned to a practice set`);
  }

  const lessonIds = bank.tutorLessons.map((lesson) => lesson.id);
  const lessonById = new Map(bank.tutorLessons.map((lesson) => [lesson.id, lesson]));
  const guidedLessonOwners = new Map<string, number>();
  if (duplicateIds(lessonIds)) issue(issues, "tutor", "/tutorLessons", "tutor-lesson IDs must be unique");
  for (const [lessonIndex, lesson] of bank.tutorLessons.entries()) {
    const path = `/tutorLessons/${lessonIndex}`;
    citedTextProblems(lesson.title, `${path}/title`, issues);
    citedTextProblems(lesson.objective, `${path}/objective`, issues);
    const citedAspectIds = [...lesson.aspectIds, ...lesson.prerequisiteAspectIds];
    if (lesson.aspectIds.length === 0 || duplicateIds(citedAspectIds)) {
      issue(issues, "tutor", path, "lesson aspect and prerequisite references must be non-empty and non-overlapping");
    }
    const lessonAspects = citedAspectIds.flatMap((id) => {
      const aspect = aspectById.get(id);
      if (aspect === undefined) {
        issue(issues, "tutor", path, `unknown aspect ${id}`);
        return [];
      }
      if (aspect.status !== "supported") issue(issues, "tutor", path, `source-gap aspect ${id} cannot be taught`);
      return [aspect];
    });
    const guidedAssignment = assignmentOwners.get(lesson.guidedExerciseId);
    guidedLessonOwners.set(
      lesson.guidedExerciseId,
      (guidedLessonOwners.get(lesson.guidedExerciseId) ?? 0) + 1,
    );
    if (guidedAssignment === undefined) {
      issue(issues, "tutor", `${path}/guidedExerciseId`, `unknown guided exercise ${lesson.guidedExerciseId}`);
    } else if (guidedAssignment.role !== "guided-check") {
      issue(issues, "tutor", `${path}/guidedExerciseId`, "a tutor lesson must link to a guided-check assignment");
    } else if (guidedAssignment.aspectIds.some((id) => !lesson.aspectIds.includes(id))) {
      issue(issues, "tutor", `${path}/guidedExerciseId`, "the guided exercise must stay within the lesson's taught aspects");
    }
    const allowedSegments = new Set(lessonAspects.flatMap((aspect) => aspect.sourceSegmentIds));
    const checkCitations = (ids: readonly string[], citationPath: string): void => {
      if (ids.length === 0 || ids.some((id) => !allowedSegments.has(id))) {
        issue(issues, "tutor", citationPath, "tutor content must cite evidence owned by its supported aspects");
      }
    };
    if (lesson.teachingBlocks.length === 0) issue(issues, "tutor", `${path}/teachingBlocks`, "a tutor lesson requires teaching content");
    if (duplicateIds(lesson.teachingBlocks.map((block) => block.id))) {
      issue(issues, "tutor", `${path}/teachingBlocks`, "teaching-block IDs must be unique");
    }
    const blockKinds = new Set(lesson.teachingBlocks.map((block) => block.kind));
    if (!blockKinds.has("why") || !blockKinds.has("prerequisite") || !blockKinds.has("explanation")) {
      issue(issues, "tutor", `${path}/teachingBlocks`, "a tutor lesson requires why, prerequisite, and connected explanation blocks");
    }
    const blockRank: Record<TutorLessonV1["teachingBlocks"][number]["kind"], number> = {
      why: 0,
      prerequisite: 1,
      explanation: 2,
      "worked-example": 3,
      "causal-walkthrough": 3,
    };
    const ranks = lesson.teachingBlocks.map((block) => blockRank[block.kind]);
    if (ranks.some((rank, index) => index > 0 && rank < (ranks[index - 1] ?? rank))) {
      issue(
        issues,
        "tutor",
        `${path}/teachingBlocks`,
        "teaching blocks must follow why, prerequisite, explanation, then optional walkthrough order",
      );
    }
    for (const [blockIndex, block] of lesson.teachingBlocks.entries()) {
      checkCitations(block.sourceSegmentIds, `${path}/teachingBlocks/${blockIndex}/sourceSegmentIds`);
      citedTextProblems(block.title, `${path}/teachingBlocks/${blockIndex}/title`, issues);
      citedTextProblems(block.content, `${path}/teachingBlocks/${blockIndex}/content`, issues);
    }
    checkCitations(lesson.selfExplanationCheck.sourceSegmentIds, `${path}/selfExplanationCheck/sourceSegmentIds`);
    citedTextProblems(lesson.selfExplanationCheck.prompt, `${path}/selfExplanationCheck/prompt`, issues);
    citedTextProblems(lesson.selfExplanationCheck.groundedAnswer, `${path}/selfExplanationCheck/groundedAnswer`, issues);
    for (const [keyPointIndex, keyPoint] of lesson.selfExplanationCheck.keyPoints.entries()) {
      citedTextProblems(keyPoint, `${path}/selfExplanationCheck/keyPoints/${keyPointIndex}`, issues);
    }
    if (!exactOrders(lesson.hints.map((hint) => hint.level - 1))) {
      issue(issues, "tutor", `${path}/hints`, "hint levels must be contiguous and start at 1");
    }
    if (duplicateIds(lesson.hints.map((hint) => hint.id))) {
      issue(issues, "tutor", `${path}/hints`, "hint IDs must be unique");
    }
    for (const [hintIndex, hint] of lesson.hints.entries()) {
      checkCitations(hint.sourceSegmentIds, `${path}/hints/${hintIndex}/sourceSegmentIds`);
      citedTextProblems(hint.text, `${path}/hints/${hintIndex}/text`, issues);
    }
    checkCitations(lesson.repairExplanation.sourceSegmentIds, `${path}/repairExplanation/sourceSegmentIds`);
    citedTextProblems(lesson.repairExplanation.text, `${path}/repairExplanation/text`, issues);
    for (const aspect of lessonAspects.filter((candidate) => lesson.aspectIds.includes(candidate.id))) {
      for (const prerequisiteId of aspect.prerequisiteAspectIds) {
        if (!lesson.prerequisiteAspectIds.includes(prerequisiteId)) {
          issue(issues, "tutor", `${path}/prerequisiteAspectIds`, `lesson omits required prerequisite ${prerequisiteId}`);
        }
      }
    }
  }

  for (const [exerciseId, assignment] of assignmentOwners) {
    const ownerCount = guidedLessonOwners.get(exerciseId) ?? 0;
    if (assignment.role === "guided-check" && ownerCount !== 1) {
      issue(issues, "tutor", "/tutorLessons", `guided exercise ${exerciseId} must belong to exactly one tutor lesson`);
    } else if (assignment.role !== "guided-check" && ownerCount > 0) {
      issue(issues, "tutor", "/tutorLessons", `non-guided exercise ${exerciseId} cannot own tutor hints or repair content`);
    }
  }

  if (bank.learningPath !== null) {
    citedTextProblems(bank.learningPath.title, "/learningPath/title", issues);
    const pathAspectIds = new Set(bank.learningPath.aspectIds);
    if (duplicateIds(bank.learningPath.aspectIds)) {
      issue(issues, "learning-path", "/learningPath/aspectIds", "learning-path aspect IDs must be unique");
    }
    for (const id of bank.learningPath.aspectIds) {
      const aspect = aspectById.get(id);
      if (aspect === undefined) issue(issues, "learning-path", "/learningPath/aspectIds", `unknown aspect ${id}`);
      else if (aspect.status !== "supported") issue(issues, "learning-path", "/learningPath/aspectIds", `source-gap aspect ${id} must be removed or resolved`);
      for (const prerequisiteId of aspect?.prerequisiteAspectIds ?? []) {
        if (!pathAspectIds.has(prerequisiteId)) {
          issue(issues, "learning-path", "/learningPath/aspectIds", `aspect ${id} requires omitted prerequisite ${prerequisiteId}`);
        }
      }
    }
    if (!exactOrders(bank.learningPath.steps.map((step) => step.order))) {
      issue(issues, "learning-path", "/learningPath/steps", "learning-path step order must be contiguous and match array order");
    }
    const stepKeys = bank.learningPath.steps.map((step) =>
      step.kind === "lesson" ? `lesson:${step.lessonId}` : `set:${step.setId}`,
    );
    if (duplicateIds(stepKeys)) issue(issues, "learning-path", "/learningPath/steps", "learning-path steps must be unique");
    const earliestAspectStep = new Map<string, number>();
    const recordAspectStep = (aspectId: string, stepIndex: number): void => {
      if (!earliestAspectStep.has(aspectId)) earliestAspectStep.set(aspectId, stepIndex);
    };
    for (const [stepIndex, step] of bank.learningPath.steps.entries()) {
      if (step.kind === "lesson") {
        const lesson = lessonById.get(step.lessonId);
        if (lesson === undefined) issue(issues, "learning-path", `/learningPath/steps/${stepIndex}/lessonId`, `unknown lesson ${step.lessonId}`);
        else {
          if (lesson.aspectIds.some((id) => !pathAspectIds.has(id))) {
            issue(issues, "learning-path", `/learningPath/steps/${stepIndex}`, "lesson teaches an aspect outside the learning path");
          }
          for (const aspectId of lesson.aspectIds) recordAspectStep(aspectId, stepIndex);
        }
      } else {
        const set = setById.get(step.setId);
        if (set === undefined) issue(issues, "learning-path", `/learningPath/steps/${stepIndex}/setId`, `unknown practice set ${step.setId}`);
        else {
          if (set.assignments.some((assignment) => assignment.aspectIds.some((id) => !pathAspectIds.has(id)))) {
            issue(issues, "learning-path", `/learningPath/steps/${stepIndex}`, "practice set uses an aspect outside the learning path");
          }
          for (const aspectId of set.assignments.flatMap((assignment) => assignment.aspectIds)) {
            recordAspectStep(aspectId, stepIndex);
          }
        }
      }
    }
    for (const aspectId of bank.learningPath.aspectIds) {
      const dependentStep = earliestAspectStep.get(aspectId);
      if (dependentStep === undefined) {
        issue(issues, "learning-path", "/learningPath/steps", `aspect ${aspectId} has no teaching or practice step`);
        continue;
      }
      for (const prerequisiteId of aspectById.get(aspectId)?.prerequisiteAspectIds ?? []) {
        const prerequisiteStep = earliestAspectStep.get(prerequisiteId);
        if (prerequisiteStep === undefined || prerequisiteStep >= dependentStep) {
          issue(
            issues,
            "learning-path",
            "/learningPath/steps",
            `prerequisite aspect ${prerequisiteId} must be introduced before dependent aspect ${aspectId}`,
          );
        }
      }
    }
    const steppedLessons = new Set(bank.learningPath.steps.flatMap((step) =>
      step.kind === "lesson" ? [step.lessonId] : [],
    ));
    const steppedSets = new Set(bank.learningPath.steps.flatMap((step) =>
      step.kind === "practice-set" ? [step.setId] : [],
    ));
    for (const lesson of bank.tutorLessons) {
      if (!steppedLessons.has(lesson.id)) {
        issue(issues, "learning-path", "/learningPath/steps", `tutor lesson ${lesson.id} is omitted from the path`);
      }
    }
    for (const set of bank.practiceSets) {
      if (set.instructionalRole !== "repair" && !steppedSets.has(set.id)) {
        issue(issues, "learning-path", "/learningPath/steps", `practice set ${set.id} is omitted from the path`);
      }
    }
    const stepOrderByKey = new Map(stepKeys.map((key, index) => [key, index]));
    for (const lesson of bank.tutorLessons) {
      const owningSet = assignmentSetOwners.get(lesson.guidedExerciseId);
      const lessonOrder = stepOrderByKey.get(`lesson:${lesson.id}`);
      const setOrder = owningSet === undefined
        ? undefined
        : stepOrderByKey.get(`set:${owningSet.id}`);
      if (lessonOrder !== undefined && setOrder !== undefined && lessonOrder >= setOrder) {
        issue(issues, "learning-path", "/learningPath/steps", `tutor lesson ${lesson.id} must precede its guided practice set ${owningSet?.id ?? "unknown"}`);
      }
    }
  } else if (bank.tutorLessons.length > 0) {
    issue(issues, "learning-path", "/learningPath", "tutor lessons require an explicit learning path");
  }

  for (const [exerciseIndex, exercise] of bank.exercises.entries()) {
    for (const latexIssue of exerciseLatexMarkupProblems(exercise, exerciseIndex)) {
      const separator = latexIssue.indexOf(": ");
      const path = separator < 0
        ? `/exercises/${exerciseIndex}`
        : latexIssue.slice(0, separator);
      const message = separator < 0
        ? latexIssue
        : latexIssue.slice(separator + 2);
      issues.push({
        code: "schema",
        path,
        message: `contains malformed LaTeX: ${message}`,
        exerciseId: exercise.id,
      });
    }
  }

  for (const [sessionIndex, session] of bank.sessions.entries()) {
    const path = `/sessions/${sessionIndex}`;
    const scopedSetIds = session.scope.sets.map((set) => set.id);
    const scopedSets = new Map(session.scope.sets.map((set) => [set.id, set]));
    if (duplicateIds(scopedSetIds)) {
      issue(issues, "session", `${path}/scope/sets`, "historical session set snapshots must be unique");
    }
    if (
      (session.scope.mode === "quick" || session.scope.mode === "set")
      && scopedSetIds.length !== 1
    ) {
      issue(issues, "session", `${path}/scope/sets`, `${session.scope.mode} sessions require exactly one scoped practice set`);
    }
    if (session.scope.mode === "mixed" && scopedSetIds.length < 2) {
      issue(issues, "session", `${path}/scope/sets`, "mixed sessions require at least two scoped practice sets");
    }
    if ((session.scope.mode === "learning-path") !== (session.scope.learningPath !== undefined)) {
      issue(issues, "session", `${path}/scope`, "only learning-path sessions must identify a learning path");
    }
    if (session.evidence.length !== session.results.length) {
      issue(issues, "session", `${path}/evidence`, "historical evidence must contain one snapshot per recorded result");
    }
    if (duplicateIds(session.evidence.map((entry) => entry.exerciseId))) {
      issue(issues, "session", `${path}/evidence`, "historical exercise evidence must be unique");
    }
    const resultIds = new Set(session.results.map((result) => result.exerciseId));
    if (session.evidence.some((entry) => !resultIds.has(entry.exerciseId))) {
      issue(issues, "session", `${path}/evidence`, "historical evidence must match recorded results");
    }
    for (const [evidenceIndex, evidence] of session.evidence.entries()) {
      if (!scopedSetIds.includes(evidence.set.id)) {
        issue(issues, "session", `${path}/evidence/${evidenceIndex}/set`, "historical evidence set must appear in the session scope");
      } else if (scopedSets.get(evidence.set.id)?.title !== evidence.set.title) {
        issue(issues, "session", `${path}/evidence/${evidenceIndex}/set`, "historical evidence set title must match its scoped snapshot");
      }
      if (duplicateIds(evidence.aspects.map((aspect) => aspect.id))) {
        issue(issues, "session", `${path}/evidence/${evidenceIndex}/aspects`, "historical evidence aspect snapshots must be unique");
      }
      const expectedIndependent = evidence.instructionalRole !== "guided-check";
      if (evidence.independent !== expectedIndependent) {
        issue(issues, "session", `${path}/evidence/${evidenceIndex}/independent`, "independent evidence must match its snapshotted instructional role");
      }
    }
    if (session.evidence.length > 0) {
      const contributingSetIds = new Set(session.evidence.map((entry) => entry.set.id));
      if (
        contributingSetIds.size !== scopedSetIds.length
        || scopedSetIds.some((id) => !contributingSetIds.has(id))
      ) {
        issue(issues, "session", `${path}/scope/sets`, "every scoped practice set must contribute recorded evidence");
      }
    }
    if (duplicateIds(session.completedTutorLessons.map((entry) => entry.lesson.id))) {
      issue(issues, "session", `${path}/completedTutorLessons`, "completed tutor-lesson snapshots must be unique");
    }
    for (const [lessonIndex, lesson] of session.completedTutorLessons.entries()) {
      if (duplicateIds(lesson.aspects.map((aspect) => aspect.id))) {
        issue(issues, "session", `${path}/completedTutorLessons/${lessonIndex}/aspects`, "completed tutor-lesson aspect snapshots must be unique");
      }
    }
  }

  return issues;
}
