import {
  SOURCE_ALIGNMENT_DRAFT_SCHEMA_VERSION,
  SOURCE_ALIGNMENT_SCHEMA_VERSION,
  type ExerciseAlignmentSnapshotV1,
  type PracticeBankV4,
  type SourceAlignmentCitationSnapshotV1,
  type SourceAlignmentDraftV1,
  type SourceAlignmentDraftRecordV1,
  type SourceAlignmentLedgerV1,
  type SourceAlignmentProvenanceV1,
  type SourceAlignmentRecordSnapshotV1,
  type SourceAlignmentRecordV1,
  type SourceAlignmentStatusV1,
  type SourceAlignmentTargetLinkV1,
  type SourceMaterialClassificationV1,
  type SourceMaterialV2,
  type SourceSegmentV1,
  type TutorLessonV1,
  type ValidationIssue,
} from "./model";
import { sha256Hex } from "./segmenter";
import { effectiveAiContextCompletionPolicy } from "./ai-context-completion";

const SCHOOL_CLASSIFICATIONS = new Set<SourceMaterialClassificationV1>([
  "official-correction",
  "instructor-material",
  "assigned-reference",
]);

export function sourceMaterialAuthorityRank(
  classification: SourceMaterialClassificationV1,
): number {
  switch (classification) {
    case "official-correction": return 4;
    case "instructor-material": return 3;
    case "assigned-reference": return 2;
    case "personal-note": return 1;
    case "unclassified": return 0;
  }
}

export function isConfirmedSchoolMaterial(material: SourceMaterialV2): boolean {
  return material.classificationState === "confirmed"
    && SCHOOL_CLASSIFICATIONS.has(material.classification);
}

export function emptySourceAlignmentLedger(): SourceAlignmentLedgerV1 {
  return {
    schemaVersion: SOURCE_ALIGNMENT_SCHEMA_VERSION,
    records: [],
    exerciseLinks: [],
    tutorLessonLinks: [],
    provenance: null,
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sourceAlignmentSourceBundleHash(
  sourceMaterials: readonly SourceMaterialV2[],
): string {
  return `sha256:${sha256Hex(canonicalJson(
    [...sourceMaterials]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((material) => ({
        id: material.id,
        sourceHash: material.sourceHash,
        classification: material.classification,
        classificationState: material.classificationState,
        scope: material.scope,
      })),
  ))}`;
}

export function sourceAlignmentLedgerHash(ledger: SourceAlignmentLedgerV1): string {
  return `sha256:${sha256Hex(canonicalJson(ledger))}`;
}

interface SourceAlignmentContext {
  readonly sourceMaterials: readonly SourceMaterialV2[];
  readonly segments: readonly SourceSegmentV1[];
}

function duplicateIds(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function pushIssue(
  issues: ValidationIssue[],
  path: string,
  message: string,
): void {
  issues.push({ code: "source-alignment", path, message });
}

function sourceOwners(
  sourceMaterials: readonly SourceMaterialV2[],
): ReadonlyMap<string, SourceMaterialV2> {
  return new Map(sourceMaterials.flatMap((material) =>
    material.segmentIds.map((segmentId) => [segmentId, material] as const),
  ));
}

function recordShapeIssues(
  record: SourceAlignmentDraftRecordV1,
  path: string,
  owners: ReadonlyMap<string, SourceMaterialV2>,
  segmentIds: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  const noteIds = record.noteSegmentIds;
  const schoolIds = record.schoolSegmentIds;
  if (duplicateIds(noteIds) || duplicateIds(schoolIds)) {
    pushIssue(issues, path, "note and school source references must be unique");
  }
  if (noteIds.some((id) => schoolIds.includes(id))) {
    pushIssue(issues, path, "one source segment cannot be both note and school evidence");
  }
  for (const [kind, ids] of [["note", noteIds], ["school", schoolIds]] as const) {
    for (const id of ids) {
      if (!segmentIds.has(id)) {
        pushIssue(issues, `${path}/${kind}SegmentIds`, `unknown source segment ${id}`);
        continue;
      }
      const owner = owners.get(id);
      if (owner === undefined) continue;
      if (kind === "note") {
        if (
          owner.classification !== "personal-note"
          || owner.classificationState !== "confirmed"
        ) {
          pushIssue(
            issues,
            `${path}/noteSegmentIds`,
            `note evidence ${id} must belong to a confirmed personal-note source`,
          );
        }
      } else if (!isConfirmedSchoolMaterial(owner)) {
        pushIssue(
          issues,
          `${path}/schoolSegmentIds`,
          `school evidence ${id} must belong to confirmed school material`,
        );
      }
    }
  }

  const requiresBoth = record.status === "aligned"
    || record.status === "notes-incomplete"
    || record.status === "conflict";
  if (requiresBoth && (noteIds.length === 0 || schoolIds.length === 0)) {
    pushIssue(issues, path, `${record.status} records require both note and school evidence`);
  }
  if (record.status === "notes-only-unverified" && (noteIds.length === 0 || schoolIds.length > 0)) {
    pushIssue(issues, path, "notes-only records require note evidence and no school evidence");
  }
  if (record.status === "school-only" && (schoolIds.length === 0 || noteIds.length > 0)) {
    pushIssue(issues, path, "school-only records require school evidence and no note evidence");
  }
  if (
    record.status === "school-sources-disagree"
    && new Set(schoolIds.map((id) => owners.get(id)?.id).filter((id) => id !== undefined)).size < 2
  ) {
    pushIssue(issues, path, "school-source disagreement requires evidence from at least two school materials");
  }
  if (
    record.status === "insufficient-evidence"
    && noteIds.length === 0
    && schoolIds.length === 0
  ) {
    pushIssue(issues, path, "insufficient-evidence records still require at least one source reference");
  }

  const noteClaimRequired = noteIds.length > 0;
  const schoolClaimRequired = schoolIds.length > 0;
  if (noteClaimRequired !== (record.noteClaim !== null)) {
    pushIssue(issues, `${path}/noteClaim`, "the note claim must match the presence of note evidence");
  }
  if (schoolClaimRequired !== (record.schoolClaim !== null)) {
    pushIssue(issues, `${path}/schoolClaim`, "the school claim must match the presence of school evidence");
  }
  if (
    (record.noteClaim !== null && record.noteClaim.trim().length === 0)
    || (record.schoolClaim !== null && record.schoolClaim.trim().length === 0)
    || (
      record.courseSupportedClaim !== null
      && record.courseSupportedClaim.trim().length === 0
    )
  ) {
    pushIssue(issues, path, "claim text must be non-empty when present");
  }

  const needsCourseClaim = record.status === "aligned"
    || record.status === "notes-incomplete"
    || record.status === "school-only"
    || (record.status === "conflict" && record.resolution === "course-authority");
  if (needsCourseClaim && record.courseSupportedClaim === null) {
    pushIssue(issues, `${path}/courseSupportedClaim`, "the course-supported interpretation is required");
  }
  if (record.status === "aligned" && record.resolution === "manual-override") {
    pushIssue(issues, `${path}/resolution`, "a manual override cannot be labelled course-aligned");
  }
  if (
    record.status === "school-sources-disagree"
    && (record.resolution === "course-authority" || record.resolution === "not-required")
  ) {
    pushIssue(issues, `${path}/resolution`, "disagreeing school sources cannot be resolved silently");
  }
}

export function sourceAlignmentDraftIssues(
  context: Pick<SourceAlignmentContext, "sourceMaterials" | "segments">,
  draft: SourceAlignmentDraftV1,
  basePath = "",
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const recordsPath = `${basePath}/records`;
  if (duplicateIds(draft.records.map((record) => record.id))) {
    pushIssue(issues, recordsPath, "alignment record IDs must be unique");
  }
  const owners = sourceOwners(context.sourceMaterials);
  const segmentIds = new Set(context.segments.map((segment) => segment.id));
  for (const [index, record] of draft.records.entries()) {
    recordShapeIssues(record, `${recordsPath}/${index}`, owners, segmentIds, issues);
  }
  return issues;
}

function targetLinkIssues(
  links: readonly SourceAlignmentTargetLinkV1[],
  path: string,
  targetIds: ReadonlySet<string>,
  records: ReadonlyMap<string, SourceAlignmentRecordV1>,
  issues: ValidationIssue[],
): void {
  if (duplicateIds(links.map((link) => link.targetId))) {
    pushIssue(issues, path, "alignment target links must be unique");
  }
  for (const [index, link] of links.entries()) {
    const linkPath = `${path}/${index}`;
    if (!targetIds.has(link.targetId)) {
      pushIssue(issues, `${linkPath}/targetId`, `unknown alignment target ${link.targetId}`);
    }
    if (link.alignmentRecordIds.length === 0 || duplicateIds(link.alignmentRecordIds)) {
      pushIssue(issues, `${linkPath}/alignmentRecordIds`, "a target link requires unique alignment records");
    }
    for (const recordId of link.alignmentRecordIds) {
      const record = records.get(recordId);
      if (record === undefined) {
        pushIssue(issues, `${linkPath}/alignmentRecordIds`, `unknown alignment record ${recordId}`);
      } else if (record.resolution === "excluded") {
        pushIssue(issues, `${linkPath}/alignmentRecordIds`, `excluded alignment record ${recordId} cannot ground practice`);
      }
    }
  }
}

export function sourceAlignmentIssues(bank: PracticeBankV4): ValidationIssue[] {
  const issues = sourceAlignmentDraftIssues(
    { sourceMaterials: bank.sourceMaterials, segments: bank.segments },
    {
      schemaVersion: SOURCE_ALIGNMENT_DRAFT_SCHEMA_VERSION,
      records: bank.sourceAlignment.records.map(({ sourceHashes: _sourceHashes, ...record }) => {
        void _sourceHashes;
        return record;
      }),
    },
    "/sourceAlignment",
  );
  const records = new Map(bank.sourceAlignment.records.map((record) => [record.id, record]));
  const materials = new Map(bank.sourceMaterials.map((material) => [material.id, material]));
  const owners = sourceOwners(bank.sourceMaterials);
  for (const [index, record] of bank.sourceAlignment.records.entries()) {
    const expectedMaterialIds = new Set(
      [...record.noteSegmentIds, ...record.schoolSegmentIds]
        .map((id) => owners.get(id)?.id)
        .filter((id) => id !== undefined),
    );
    const hashes = new Map(record.sourceHashes.map((snapshot) => [snapshot.sourceMaterialId, snapshot]));
    if (hashes.size !== record.sourceHashes.length) {
      pushIssue(issues, `/sourceAlignment/records/${index}/sourceHashes`, "source-hash snapshots must be unique");
    }
    if (
      hashes.size !== expectedMaterialIds.size
      || [...expectedMaterialIds].some((id) => !hashes.has(id))
    ) {
      pushIssue(issues, `/sourceAlignment/records/${index}/sourceHashes`, "source-hash snapshots must exactly cover cited materials");
    }
    for (const snapshot of record.sourceHashes) {
      const material = materials.get(snapshot.sourceMaterialId);
      if (
        material === undefined
        || material.sourceHash !== snapshot.sourceHash
        || material.classification !== snapshot.classification
        || material.classificationState !== snapshot.classificationState
      ) {
        pushIssue(issues, `/sourceAlignment/records/${index}/sourceHashes`, `stale source snapshot ${snapshot.sourceMaterialId}`);
      }
    }
  }
  targetLinkIssues(
    bank.sourceAlignment.exerciseLinks,
    "/sourceAlignment/exerciseLinks",
    new Set(bank.exercises.map((exercise) => exercise.id)),
    records,
    issues,
  );
  targetLinkIssues(
    bank.sourceAlignment.tutorLessonLinks,
    "/sourceAlignment/tutorLessonLinks",
    new Set(bank.tutorLessons.map((lesson) => lesson.id)),
    records,
    issues,
  );
  for (const [index, link] of bank.sourceAlignment.exerciseLinks.entries()) {
    const exercise = bank.exercises.find((candidate) => candidate.id === link.targetId);
    if (exercise === undefined) continue;
    const cited = new Set(exercise.sourceSegmentIds);
    if (!link.alignmentRecordIds.some((id) => {
      const record = records.get(id);
      return [...(record?.noteSegmentIds ?? []), ...(record?.schoolSegmentIds ?? [])]
        .some((segmentId) => cited.has(segmentId));
    })) {
      pushIssue(
        issues,
        `/sourceAlignment/exerciseLinks/${index}`,
        "an exercise alignment link must overlap its grounded source references",
      );
    }
  }
  for (const [index, link] of bank.sourceAlignment.tutorLessonLinks.entries()) {
    const lesson = bank.tutorLessons.find((candidate) => candidate.id === link.targetId);
    if (lesson === undefined) continue;
    const cited = new Set(tutorLessonSourceSegmentIds(lesson));
    if (!link.alignmentRecordIds.some((id) => {
      const record = records.get(id);
      return [...(record?.noteSegmentIds ?? []), ...(record?.schoolSegmentIds ?? [])]
        .some((segmentId) => cited.has(segmentId));
    })) {
      pushIssue(
        issues,
        `/sourceAlignment/tutorLessonLinks/${index}`,
        "a tutor alignment link must overlap its grounded source references",
      );
    }
  }
  if (bank.sourceAlignment.records.length === 0) {
    if (
      bank.sourceAlignment.provenance !== null
      || bank.sourceAlignment.exerciseLinks.length > 0
      || bank.sourceAlignment.tutorLessonLinks.length > 0
    ) {
      pushIssue(issues, "/sourceAlignment", "an empty alignment ledger cannot retain provenance or links");
    }
  } else if (bank.sourceAlignment.provenance === null) {
    pushIssue(issues, "/sourceAlignment/provenance", "an alignment result requires generation provenance");
  } else {
    if (!Number.isFinite(Date.parse(bank.sourceAlignment.provenance.generatedAt))) {
      pushIssue(issues, "/sourceAlignment/provenance/generatedAt", "alignment timestamp must be a valid date");
    }
  }
  return issues;
}

export interface CreateSourceAlignmentLedgerInput {
  readonly sourceMaterials: readonly SourceMaterialV2[];
  readonly segments: readonly SourceSegmentV1[];
  readonly draft: SourceAlignmentDraftV1;
  readonly provenance: Omit<SourceAlignmentProvenanceV1, "sourceBundleHash">;
  readonly exerciseLinks?: readonly SourceAlignmentTargetLinkV1[];
  readonly tutorLessonLinks?: readonly SourceAlignmentTargetLinkV1[];
}

export function createSourceAlignmentLedger(
  input: CreateSourceAlignmentLedgerInput,
): SourceAlignmentLedgerV1 {
  const issues = sourceAlignmentDraftIssues(input, input.draft);
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  if (input.draft.records.length === 0) return emptySourceAlignmentLedger();
  const owners = sourceOwners(input.sourceMaterials);
  const records = input.draft.records.map((draft): SourceAlignmentRecordV1 => {
    const materialIds = [...new Set(
      [...draft.noteSegmentIds, ...draft.schoolSegmentIds]
        .map((id) => owners.get(id)?.id)
        .filter((id) => id !== undefined),
    )];
    return {
      ...structuredClone(draft),
      sourceHashes: materialIds.map((sourceMaterialId) => {
        const material = input.sourceMaterials.find((candidate) =>
          candidate.id === sourceMaterialId
        );
        if (material === undefined) throw new Error(`Unknown source material ${sourceMaterialId}.`);
        return {
          sourceMaterialId,
          sourceHash: material.sourceHash,
          classification: material.classification,
          classificationState: material.classificationState,
        };
      }),
    };
  });
  return {
    schemaVersion: SOURCE_ALIGNMENT_SCHEMA_VERSION,
    records,
    exerciseLinks: input.exerciseLinks?.map((link) => structuredClone(link)) ?? [],
    tutorLessonLinks: input.tutorLessonLinks?.map((link) => structuredClone(link)) ?? [],
    provenance: {
      ...structuredClone(input.provenance),
      sourceBundleHash: sourceAlignmentSourceBundleHash(input.sourceMaterials),
    },
  };
}

export function alignmentRecordIdsForExercise(
  ledger: SourceAlignmentLedgerV1,
  exerciseId: string,
): readonly string[] {
  return ledger.exerciseLinks.find((link) => link.targetId === exerciseId)
    ?.alignmentRecordIds ?? [];
}

export function alignmentRecordIdsForTutorLesson(
  ledger: SourceAlignmentLedgerV1,
  tutorLessonId: string,
): readonly string[] {
  return ledger.tutorLessonLinks.find((link) => link.targetId === tutorLessonId)
    ?.alignmentRecordIds ?? [];
}

function citationSnapshot(
  bank: PracticeBankV4,
  segmentId: string,
): SourceAlignmentCitationSnapshotV1 {
  const material = bank.sourceMaterials.find((candidate) => candidate.segmentIds.includes(segmentId));
  const segment = bank.segments.find((candidate) => candidate.id === segmentId);
  if (material === undefined || segment === undefined) {
    throw new Error(`Alignment evidence ${segmentId} is absent from the locked source bundle.`);
  }
  return {
    sourceMaterialId: material.id,
    classification: material.classification,
    title: material.title,
    vaultPath: material.vaultPath,
    scope: structuredClone(material.scope),
    segmentId,
    headingPath: [...segment.headingPath],
    text: segment.text,
  };
}

function recordSnapshot(
  bank: PracticeBankV4,
  record: SourceAlignmentRecordV1,
): SourceAlignmentRecordSnapshotV1 {
  return {
    recordId: record.id,
    status: record.status,
    noteClaim: record.noteClaim,
    schoolClaim: record.schoolClaim,
    courseSupportedClaim: record.courseSupportedClaim,
    resolution: record.resolution,
    noteEvidence: record.noteSegmentIds.map((id) => citationSnapshot(bank, id)),
    schoolEvidence: record.schoolSegmentIds.map((id) => citationSnapshot(bank, id)),
  };
}

function snapshotState(statuses: readonly SourceAlignmentStatusV1[]): ExerciseAlignmentSnapshotV1["state"] {
  if (statuses.includes("school-sources-disagree")) return "school-sources-disagree";
  if (statuses.includes("conflict")) return "notes-differ";
  if (statuses.includes("notes-incomplete")) return "notes-incomplete";
  if (statuses.includes("insufficient-evidence")) return "insufficient-evidence";
  if (statuses.includes("notes-only-unverified") || statuses.length === 0) {
    return "notes-grounded-unverified";
  }
  return "course-aligned";
}

export function createExerciseAlignmentSnapshot(
  bank: PracticeBankV4,
  exerciseId: string,
): ExerciseAlignmentSnapshotV1 {
  if (!bank.exercises.some((exercise) => exercise.id === exerciseId)) {
    throw new Error(`Exercise ${exerciseId} does not exist in the current practice bank.`);
  }
  const recordIds = alignmentRecordIdsForExercise(bank.sourceAlignment, exerciseId);
  const recordById = new Map(bank.sourceAlignment.records.map((record) => [record.id, record]));
  const records = recordIds.map((id) => {
    const record = recordById.get(id);
    if (record === undefined) throw new Error(`Unknown exercise alignment record ${id}.`);
    return recordSnapshot(bank, record);
  });
  return {
    exerciseId,
    state: snapshotState(records.map((record) => record.status)),
    records,
    aiContextCompletionPolicy: effectiveAiContextCompletionPolicy(
      bank.aiContextCompletionPolicy,
    ),
  };
}

export function createExerciseAlignmentSnapshots(
  bank: PracticeBankV4,
  exerciseIds: readonly string[],
): ExerciseAlignmentSnapshotV1[] {
  if (duplicateIds(exerciseIds)) throw new Error("Exercise alignment snapshot IDs must be unique.");
  return exerciseIds.map((exerciseId) => createExerciseAlignmentSnapshot(bank, exerciseId));
}

export function invalidateStaleSourceAlignment(
  ledger: SourceAlignmentLedgerV1,
  sourceMaterials: readonly SourceMaterialV2[],
): SourceAlignmentLedgerV1 {
  const materials = new Map(sourceMaterials.map((material) => [material.id, material]));
  const records = ledger.records.filter((record) => record.sourceHashes.every((snapshot) =>
    materials.get(snapshot.sourceMaterialId)?.sourceHash === snapshot.sourceHash
    && materials.get(snapshot.sourceMaterialId)?.classification === snapshot.classification
    && materials.get(snapshot.sourceMaterialId)?.classificationState
      === snapshot.classificationState,
  ));
  if (records.length === ledger.records.length) return structuredClone(ledger);
  const retainedIds = new Set(records.map((record) => record.id));
  const retainLinks = (links: readonly SourceAlignmentTargetLinkV1[]): SourceAlignmentTargetLinkV1[] =>
    links.flatMap((link) => {
      const alignmentRecordIds = link.alignmentRecordIds.filter((id) => retainedIds.has(id));
      return alignmentRecordIds.length === 0
        ? []
        : [{ targetId: link.targetId, alignmentRecordIds }];
    });
  return {
    schemaVersion: SOURCE_ALIGNMENT_SCHEMA_VERSION,
    records: records.map((record) => structuredClone(record)),
    exerciseLinks: retainLinks(ledger.exerciseLinks),
    tutorLessonLinks: retainLinks(ledger.tutorLessonLinks),
    provenance: records.length === 0 ? null : structuredClone(ledger.provenance),
  };
}

export function tutorLessonSourceSegmentIds(lesson: TutorLessonV1): readonly string[] {
  return [...new Set([
    ...lesson.teachingBlocks.flatMap((block) => block.sourceSegmentIds),
    ...lesson.selfExplanationCheck.sourceSegmentIds,
    ...lesson.hints.flatMap((hint) => hint.sourceSegmentIds),
    ...lesson.repairExplanation.sourceSegmentIds,
  ])];
}
