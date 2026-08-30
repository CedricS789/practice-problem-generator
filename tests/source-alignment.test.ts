import assert from "node:assert/strict";
import test from "node:test";

import {
  CURRENT_PRACTICE_BANK_SCHEMA_VERSION,
  PRACTICE_BANK_SCHEMA_VERSION,
  PRACTICE_BANK_V3_SCHEMA_VERSION,
  SOURCE_ALIGNMENT_DRAFT_SCHEMA_VERSION,
  type PracticeBankV2,
  type PracticeBankV3,
  type PracticeBankV4,
  type SourceAlignmentDraftV1,
} from "../src/model";
import {
  migratePracticeBankV2ToV3,
  replacePracticeSetContent,
} from "../src/learning-path";
import { createSourceHash } from "../src/segmenter";
import {
  parsePracticeBankMarkdown,
  serializePracticeBank,
} from "../src/persistence";
import {
  createExerciseAlignmentSnapshot,
  createSourceAlignmentLedger,
  invalidateStaleSourceAlignment,
  sourceAlignmentLedgerHash,
  sourceMaterialAuthorityRank,
} from "../src/source-alignment";
import {
  validatePracticeBankV4,
  validateSourceAlignmentDraft,
} from "../src/schema";

function v2Bank(): PracticeBankV2 {
  const sourceText = "# Notes\nThe drift current is always dominant.";
  return {
    schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
    bankId: "bank-alignment",
    revision: 0,
    createdAt: "2026-08-25T08:00:00.000Z",
    updatedAt: "2026-08-25T08:00:00.000Z",
    source: {
      vaultPath: "Notes/Term/Course/Notes.md",
      wikilink: "[[Notes/Term/Course/Notes]]",
      title: "Notes",
      scope: "note",
      hash: createSourceHash(sourceText),
    },
    segments: [
      { id: "note-heading", kind: "heading", ordinal: 0, headingPath: ["Notes"], text: "Notes" },
      {
        id: "note-claim",
        kind: "paragraph",
        ordinal: 1,
        headingPath: ["Notes"],
        text: "The drift current is always dominant.",
      },
    ],
    visuals: [],
    exercises: [{
      id: "exercise-1",
      type: "short-answer",
      title: "Compare transport",
      prompt: "Which transport mechanism dominates?",
      difficulty: "hard",
      sourceSegmentIds: ["note-claim"],
      groundedAnswer: "It depends on where carriers are generated.",
      acceptableAnswers: ["It depends on carrier generation location."],
      keyPoints: ["drift", "diffusion"],
    }],
    sessions: [],
    generation: {
      provider: "codex",
      generatedAt: "2026-08-25T08:00:00.000Z",
      promptVersion: "test",
    },
  };
}

function classifiedBank(): PracticeBankV4 {
  const bank = migratePracticeBankV2ToV3(v2Bank());
  bank.sourceMaterials[0] = {
    ...bank.sourceMaterials[0]!,
    classification: "personal-note",
    classificationState: "confirmed",
  };
  const schoolText = "Drift dominates inside depletion regions; diffusion can dominate outside them.";
  bank.segments.push({
    id: "school-source:claim",
    kind: "paragraph",
    ordinal: 2,
    headingPath: ["Carrier transport"],
    text: schoolText,
  });
  bank.sourceMaterials.push({
    id: "school-source",
    role: "supporting",
    vaultPath: "Notes/Term/Course/Lecture.pdf",
    wikilink: "[[Notes/Term/Course/Lecture.pdf]]",
    title: "Lecture",
    sourceHash: createSourceHash(schoolText),
    scope: {
      kind: "pdf-pages",
      firstPage: 4,
      lastPage: 4,
      pageCount: 20,
      pdfContentHash: createSourceHash("synthetic-pdf"),
    },
    segmentIds: ["school-source:claim"],
    visualIds: [],
    classification: "instructor-material",
    classificationState: "confirmed",
  });
  return bank;
}

function conflictDraft(): SourceAlignmentDraftV1 {
  return {
    schemaVersion: SOURCE_ALIGNMENT_DRAFT_SCHEMA_VERSION,
    records: [{
      id: "alignment-1",
      status: "conflict",
      noteSegmentIds: ["note-claim"],
      schoolSegmentIds: ["school-source:claim"],
      noteClaim: "Drift always dominates.",
      schoolClaim: "Transport depends on the carrier-generation region.",
      courseSupportedClaim: "Drift dominates in depletion regions; diffusion may dominate outside.",
      resolution: "course-authority",
    }],
  };
}

function addLedger(bank: PracticeBankV4): void {
  bank.sourceAlignment = createSourceAlignmentLedger({
    sourceMaterials: bank.sourceMaterials,
    segments: bank.segments,
    draft: conflictDraft(),
    provenance: {
      provider: "codex",
      providerVersion: "codex-cli test",
      model: "synthetic-model",
      reasoningEffort: "high",
      promptVersion: "source-alignment-v1",
      generatedAt: "2026-08-25T08:05:00.000Z",
    },
    exerciseLinks: [{ targetId: "exercise-1", alignmentRecordIds: ["alignment-1"] }],
  });
}

test("v4 migration preserves content and marks every historical source unclassified", () => {
  const before = v2Bank();
  const migrated = migratePracticeBankV2ToV3(before);
  assert.equal(migrated.schemaVersion, CURRENT_PRACTICE_BANK_SCHEMA_VERSION);
  assert.deepEqual(migrated.exercises, before.exercises);
  assert.deepEqual(migrated.sessions, before.sessions);
  assert.equal(migrated.sourceMaterials[0]?.classification, "unclassified");
  assert.equal(migrated.sourceMaterials[0]?.classificationState, "migration-default");
  assert.deepEqual(migrated.sourceAlignment.records, []);
  assert.equal(validatePracticeBankV4(migrated).ok, true);
});

test("stored v3 workspaces migrate in memory without losing learning-path content", () => {
  const current = classifiedBank();
  const {
    sourceAlignment: _sourceAlignment,
    sourceMaterials: currentMaterials,
    ...workspace
  } = current;
  void _sourceAlignment;
  const v3: PracticeBankV3 = {
    ...workspace,
    schemaVersion: PRACTICE_BANK_V3_SCHEMA_VERSION,
    sessions: current.sessions.map((session) => ({
      ...structuredClone(session),
      schemaVersion: PRACTICE_BANK_V3_SCHEMA_VERSION,
    })),
    sourceMaterials: currentMaterials.map(({
      classification: _classification,
      classificationState: _classificationState,
      ...material
    }) => {
      void _classification;
      void _classificationState;
      return material;
    }),
  };
  const markdown = `\`\`\`practice-lab\n${JSON.stringify(v3)}\n\`\`\`\n`;
  const parsed = parsePracticeBankMarkdown(markdown);
  assert.equal(parsed.status, "ok");
  if (parsed.status !== "ok") return;
  assert.equal(parsed.storedSchemaVersion, PRACTICE_BANK_V3_SCHEMA_VERSION);
  assert.equal(parsed.bank.schemaVersion, CURRENT_PRACTICE_BANK_SCHEMA_VERSION);
  assert.deepEqual(parsed.bank.practiceSets, v3.practiceSets);
  assert.deepEqual(parsed.bank.tutorLessons, v3.tutorLessons);
  assert.ok(parsed.bank.sourceMaterials.every((material) =>
    material.classification === "unclassified"
    && material.classificationState === "migration-default"
  ));
  assert.match(parsed.warnings[0] ?? "", /next authorized write will save version 4/u);
});

test("authority order is explicit and never treats an unconfirmed label as authority", () => {
  assert.ok(sourceMaterialAuthorityRank("official-correction") > sourceMaterialAuthorityRank("instructor-material"));
  assert.ok(sourceMaterialAuthorityRank("instructor-material") > sourceMaterialAuthorityRank("assigned-reference"));
  assert.ok(sourceMaterialAuthorityRank("assigned-reference") > sourceMaterialAuthorityRank("personal-note"));
  assert.equal(sourceMaterialAuthorityRank("unclassified"), 0);

  const bank = classifiedBank();
  bank.sourceMaterials[1] = {
    ...bank.sourceMaterials[1]!,
    classificationState: "suggested",
  };
  bank.sourceAlignment = createSourceAlignmentLedger({
    sourceMaterials: classifiedBank().sourceMaterials,
    segments: bank.segments,
    draft: conflictDraft(),
    provenance: {
      provider: "codex",
      providerVersion: "test",
      model: "test",
      reasoningEffort: "high",
      promptVersion: "test",
      generatedAt: "2026-08-25T08:05:00.000Z",
    },
  });
  const result = validatePracticeBankV4(bank);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => /confirmed school material/u.test(issue.message)));
});

test("alignment draft schema is strict and local semantics reject a silent aligned override", () => {
  assert.equal(validateSourceAlignmentDraft(conflictDraft()).ok, true);
  assert.equal(validateSourceAlignmentDraft({ ...conflictDraft(), unexpected: true }).ok, false);
  const bank = classifiedBank();
  const invalidDraft = conflictDraft();
  invalidDraft.records[0] = {
    ...invalidDraft.records[0]!,
    status: "aligned",
    resolution: "manual-override",
  };
  assert.throws(
    () => createSourceAlignmentLedger({
      sourceMaterials: bank.sourceMaterials,
      segments: bank.segments,
      draft: invalidDraft,
      provenance: {
        provider: "codex",
        providerVersion: "test",
        model: "test",
        reasoningEffort: "high",
        promptVersion: "test",
        generatedAt: "2026-08-25T08:05:00.000Z",
      },
    }),
    /manual override cannot be labelled course-aligned/u,
  );
});

test("every alignment state has a valid, source-owned representation", () => {
  const bank = classifiedBank();
  const secondSchoolText = "The assigned reference uses a different limiting assumption.";
  bank.segments.push({
    id: "reference-source:claim",
    kind: "paragraph",
    ordinal: 3,
    headingPath: ["Reference"],
    text: secondSchoolText,
  });
  bank.sourceMaterials.push({
    id: "reference-source",
    role: "supporting",
    vaultPath: "Notes/Term/Course/Reference.pdf",
    wikilink: "[[Notes/Term/Course/Reference.pdf]]",
    title: "Reference",
    sourceHash: createSourceHash(secondSchoolText),
    scope: {
      kind: "pdf-pages",
      firstPage: 9,
      lastPage: 9,
      pageCount: 30,
      pdfContentHash: createSourceHash("synthetic-reference-pdf"),
    },
    segmentIds: ["reference-source:claim"],
    visualIds: [],
    classification: "assigned-reference",
    classificationState: "confirmed",
  });
  const records: SourceAlignmentDraftV1["records"] = [
    {
      id: "aligned",
      status: "aligned",
      noteSegmentIds: ["note-claim"],
      schoolSegmentIds: ["school-source:claim"],
      noteClaim: "The note and lecture agree.",
      schoolClaim: "The note and lecture agree.",
      courseSupportedClaim: "The note and lecture agree.",
      resolution: "not-required",
    },
    {
      id: "notes-incomplete",
      status: "notes-incomplete",
      noteSegmentIds: ["note-claim"],
      schoolSegmentIds: ["school-source:claim"],
      noteClaim: "The note gives only one condition.",
      schoolClaim: "The lecture gives both conditions.",
      courseSupportedClaim: "Use both conditions.",
      resolution: "course-authority",
    },
    conflictDraft().records[0]!,
    {
      id: "school-only",
      status: "school-only",
      noteSegmentIds: [],
      schoolSegmentIds: ["school-source:claim"],
      noteClaim: null,
      schoolClaim: "This appears only in the lecture.",
      courseSupportedClaim: "Use the lecture statement.",
      resolution: "course-authority",
    },
    {
      id: "notes-only",
      status: "notes-only-unverified",
      noteSegmentIds: ["note-claim"],
      schoolSegmentIds: [],
      noteClaim: "This note claim has no selected school evidence.",
      schoolClaim: null,
      courseSupportedClaim: null,
      resolution: "unresolved",
    },
    {
      id: "school-disagreement",
      status: "school-sources-disagree",
      noteSegmentIds: [],
      schoolSegmentIds: ["school-source:claim", "reference-source:claim"],
      noteClaim: null,
      schoolClaim: "The selected school sources use incompatible limiting assumptions.",
      courseSupportedClaim: null,
      resolution: "unresolved",
    },
    {
      id: "insufficient",
      status: "insufficient-evidence",
      noteSegmentIds: ["note-claim"],
      schoolSegmentIds: [],
      noteClaim: "The available excerpt is insufficient.",
      schoolClaim: null,
      courseSupportedClaim: null,
      resolution: "unresolved",
    },
  ];
  for (const record of records) {
    const ledger = createSourceAlignmentLedger({
      sourceMaterials: bank.sourceMaterials,
      segments: bank.segments,
      draft: { schemaVersion: SOURCE_ALIGNMENT_DRAFT_SCHEMA_VERSION, records: [record] },
      provenance: {
        provider: "codex",
        providerVersion: "test",
        model: "test",
        reasoningEffort: "high",
        promptVersion: "test",
        generatedAt: "2026-08-25T08:05:00.000Z",
      },
    });
    assert.equal(validatePracticeBankV4({ ...bank, sourceAlignment: ledger }).ok, true, record.status);
  }
});

test("v4 validates exact source hashes and target links", () => {
  const bank = classifiedBank();
  addLedger(bank);
  assert.equal(validatePracticeBankV4(bank).ok, true);

  const tampered = structuredClone(bank);
  tampered.sourceAlignment.records[0]!.sourceHashes[0]!.sourceHash = createSourceHash("changed");
  const result = validatePracticeBankV4(tampered);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => /stale source snapshot/u.test(issue.message)));
});

test("v4 alignment records and provenance round-trip through portable Markdown", () => {
  const bank = classifiedBank();
  addLedger(bank);
  const parsed = parsePracticeBankMarkdown(serializePracticeBank(bank));
  assert.equal(parsed.status, "ok");
  if (parsed.status !== "ok") return;
  assert.deepEqual(parsed.bank.sourceMaterials, bank.sourceMaterials);
  assert.deepEqual(parsed.bank.sourceAlignment, bank.sourceAlignment);
  assert.deepEqual(parsed.warnings, []);
});

test("exercise snapshots are immutable, evidence-complete, and reveal comparison state", () => {
  const bank = classifiedBank();
  addLedger(bank);
  const snapshot = createExerciseAlignmentSnapshot(bank, "exercise-1");
  assert.equal(snapshot.state, "notes-differ");
  assert.equal(snapshot.records[0]?.noteEvidence[0]?.text, "The drift current is always dominant.");
  assert.equal(snapshot.records[0]?.schoolEvidence[0]?.scope.kind, "pdf-pages");

  bank.segments[1]!.text = "Later edit";
  assert.equal(snapshot.records[0]?.noteEvidence[0]?.text, "The drift current is always dominant.");
  assert.match(sourceAlignmentLedgerHash(bank.sourceAlignment), /^sha256:[0-9a-f]{64}$/u);
});

test("source changes invalidate only dependent records and links", () => {
  const bank = classifiedBank();
  addLedger(bank);
  const changedMaterials = bank.sourceMaterials.map((material) =>
    material.id === "school-source"
      ? { ...material, sourceHash: createSourceHash("new school revision") }
      : material,
  );
  const invalidated = invalidateStaleSourceAlignment(bank.sourceAlignment, changedMaterials);
  assert.deepEqual(invalidated.records, []);
  assert.deepEqual(invalidated.exerciseLinks, []);
  assert.equal(invalidated.provenance, null);
});

test("set regeneration removes stale target links while preserving the alignment ledger", () => {
  const bank = classifiedBank();
  addLedger(bank);
  const replacement = {
    ...structuredClone(bank.exercises[0]!),
    id: "exercise-2",
  };
  const replaced = replacePracticeSetContent(bank, "set-general", {
    set: {
      ...structuredClone(bank.practiceSets[0]!),
      assignments: [{
        exerciseId: replacement.id,
        aspectIds: ["aspect-general"],
        role: "independent",
      }],
    },
    exercises: [replacement],
    tutorLessons: [],
    sourceAlignmentLinks: {
      exerciseLinks: [{
        targetId: replacement.id,
        alignmentRecordIds: ["alignment-1"],
      }],
      tutorLessonLinks: [],
    },
  }, "2026-08-25T08:10:00.000Z");
  assert.deepEqual(
    replaced.sourceAlignment.exerciseLinks.map((link) => link.targetId),
    ["exercise-2"],
  );
  assert.equal(replaced.sourceAlignment.records.length, 1);
  assert.equal(validatePracticeBankV4(replaced).ok, true);
});
