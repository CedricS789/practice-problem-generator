import assert from "node:assert/strict";
import test from "node:test";

import type { App, TFile } from "obsidian";

import { PracticeBankRepository } from "../src/bank-repository";
import { migratePracticeBankV2ToV3 } from "../src/learning-path";
import {
  PRACTICE_BANK_SCHEMA_VERSION,
  type PracticeBankV2,
  type PracticeBankV3,
} from "../src/model";
import { parsePracticeBankMarkdown, serializePracticeBank } from "../src/persistence";
import {
  generationRecipeCatalogFromLegacy,
  parseGenerationRecipeCatalogMarkdown,
  parseGenerationRecipeMarkdown,
  type GenerationRecipeV2,
} from "../src/regeneration";
import {
  emptyGenerationHistory,
  parseGenerationHistoryMarkdown,
} from "../src/generation-history";
import { createSourceHash, segmentSource } from "../src/segmenter";

interface FakeFile extends TFile {
  content: string;
}

class FakeVault {
  readonly files = new Map<string, FakeFile>();
  readonly folders = new Set<string>();
  processCalls = 0;

  getAbstractFileByPath(path: string): FakeFile | { path: string } | null {
    const normalized = path.replace(/\\/gu, "/");
    return this.files.get(normalized)
      ?? (this.folders.has(normalized) ? { path: normalized } : null);
  }

  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
  }

  async create(path: string, content: string): Promise<FakeFile> {
    const file = {
      path,
      name: path.split("/").at(-1) ?? path,
      basename: (path.split("/").at(-1) ?? path).replace(/\.md$/iu, ""),
      extension: "md",
      content,
    } as FakeFile;
    this.files.set(path, file);
    return file;
  }

  async cachedRead(file: FakeFile): Promise<string> {
    return file.content;
  }

  async process(
    file: FakeFile,
    processor: (markdown: string) => string,
  ): Promise<void> {
    this.processCalls += 1;
    file.content = processor(file.content);
  }
}

function bankV2(): PracticeBankV2 {
  const text = "# Evidence\nAlpha causes beta.";
  const segments = segmentSource(text);
  const paragraph = segments.find((segment) => segment.kind === "paragraph");
  assert.ok(paragraph);
  return {
    schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
    bankId: "bank-atomic-learning",
    revision: 0,
    createdAt: "2026-08-22T08:00:00.000Z",
    updatedAt: "2026-08-22T08:00:00.000Z",
    source: {
      vaultPath: "Notes/Term/Course/Evidence.md",
      wikilink: "[[Notes/Term/Course/Evidence]]",
      title: "Evidence",
      scope: "note",
      hash: createSourceHash(text),
    },
    segments,
    visuals: [],
    exercises: [{
      id: "exercise-old",
      type: "short-answer",
      title: "Old exercise",
      prompt: "What causes beta?",
      difficulty: "medium",
      sourceSegmentIds: [paragraph.id],
      groundedAnswer: "Alpha.",
      acceptableAnswers: ["alpha"],
      keyPoints: ["alpha"],
    }],
    sessions: [{
      schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
      id: "session-historical",
      startedAt: "2026-08-22T08:01:00.000Z",
      finishedAt: "2026-08-22T08:02:00.000Z",
      bankRevisionAtStart: 0,
      exerciseCount: 1,
      completedCount: 1,
      score: { correct: 1, total: 1 },
      ratings: { again: 0, hard: 0, good: 0, easy: 0 },
      results: [{ exerciseId: "exercise-old", grading: "objective", correct: true }],
    }],
  };
}

function guidedWorkspace(): PracticeBankV3 {
  const bank = migratePracticeBankV2ToV3(bankV2());
  const segmentId = bank.exercises[0]?.sourceSegmentIds[0];
  assert.ok(segmentId);
  bank.aspects = [{
    id: "aspect-guided",
    title: "Guided cause",
    purpose: "Build the supported causal relationship.",
    prerequisiteAspectIds: [],
    sourceSegmentIds: [segmentId],
    status: "supported",
  }];
  bank.practiceSets = [{
    id: "set-guided",
    title: "Guided set",
    purpose: "Apply the supported causal relationship.",
    instructionalRole: "foundations",
    order: 0,
    assignments: [{
      exerciseId: "exercise-old",
      aspectIds: ["aspect-guided"],
      role: "guided-check",
    }],
  }];
  bank.tutorLessons = [{
    id: "lesson-guided",
    title: "Guided cause lesson",
    objective: "Explain why alpha is the cause.",
    aspectIds: ["aspect-guided"],
    prerequisiteAspectIds: [],
    guidedExerciseId: "exercise-old",
    teachingBlocks: [{
      id: "block-why",
      kind: "why",
      title: "Why it matters",
      content: "Causal direction determines the answer.",
      sourceSegmentIds: [segmentId],
    }, {
      id: "block-prerequisite",
      kind: "prerequisite",
      title: "Premise",
      content: "Alpha is the supported premise.",
      sourceSegmentIds: [segmentId],
    }, {
      id: "block-explanation",
      kind: "explanation",
      title: "Connection",
      content: "Alpha causes beta in the approved source.",
      sourceSegmentIds: [segmentId],
    }],
    selfExplanationCheck: {
      prompt: "What is the causal direction?",
      groundedAnswer: "Alpha causes beta.",
      keyPoints: ["alpha", "beta"],
      sourceSegmentIds: [segmentId],
    },
    hints: [{
      id: "hint-1",
      level: 1,
      text: "Identify the premise.",
      sourceSegmentIds: [segmentId],
    }, {
      id: "hint-2",
      level: 2,
      text: "Follow the stated direction.",
      sourceSegmentIds: [segmentId],
    }],
    repairExplanation: {
      text: "The approved source states that alpha causes beta.",
      sourceSegmentIds: [segmentId],
    },
  }];
  bank.learningPath = {
    id: "path-guided",
    title: "Guided path",
    startingLevel: "new-to-topic",
    aspectIds: ["aspect-guided"],
    steps: [{ kind: "lesson", lessonId: "lesson-guided", order: 0 }, {
      kind: "practice-set",
      setId: "set-guided",
      order: 1,
    }],
  };
  return bank;
}

const recipe: GenerationRecipeV2 = {
  schemaVersion: 2,
  sourceHash: bankV2().source.hash,
  provider: "codex",
  model: "gpt-5.6",
  reasoningEffort: "high",
  quantity: 1,
  difficulty: "deep-exam",
  focusInstructions: "Ground every item.",
  exerciseTypePercentages: {
    "short-answer": 100,
    "causal-explanation": 0,
    application: 0,
    calculation: 0,
    cloze: 0,
    "single-select": 0,
    "multi-select": 0,
    matching: 0,
    ordering: 0,
    "image-occlusion": 0,
  },
};

const recipeCatalog = generationRecipeCatalogFromLegacy("set-general", {
  status: "ok",
  recipe,
  storedSchemaVersion: 2,
});

test("new workspaces use the configured preferred path", async () => {
  const bank = migratePracticeBankV2ToV3(bankV2());
  const vault = new FakeVault();
  const customPath = "Practice Problems/Term/Course/Evidence.md";
  const repository = new PracticeBankRepository(
    { vault } as unknown as App,
    { preferredPath: () => customPath },
  );

  const saved = await repository.saveLearningWorkspace({ bank });

  assert.equal(saved.path, customPath);
  assert.ok(vault.files.has(customPath));
  assert.equal(
    vault.files.has("Notes/Term/Course/Practice/Evidence - Practice.md"),
    false,
  );
});

test("an existing source-owned bank remains discoverable after storage defaults change", async () => {
  const bank = migratePracticeBankV2ToV3(bankV2());
  const existingPath = "Previously chosen/Evidence - Practice.md";
  const vault = new FakeVault();
  await vault.create(existingPath, serializePracticeBank(bank));
  const repository = new PracticeBankRepository(
    { vault } as unknown as App,
    {
      locateExistingPath: async () => existingPath,
      preferredPath: () => {
        throw new Error("The new default does not support this old source location.");
      },
    },
  );

  const loaded = await repository.loadForSource(bank.source.vaultPath);

  assert.equal(loaded.path, existingPath);
  assert.equal(loaded.file?.path, existingPath);
  assert.equal(loaded.parsed.status, "ok");
});

test("a custom-path collision cannot overwrite a bank owned by another source", async () => {
  const bank = migratePracticeBankV2ToV3(bankV2());
  const collisionPath = "Practice Problems/Evidence.md";
  const vault = new FakeVault();
  await vault.create(collisionPath, serializePracticeBank(bank));
  const repository = new PracticeBankRepository(
    { vault } as unknown as App,
    { preferredPath: () => collisionPath },
  );

  await assert.rejects(
    repository.loadForSource("Notes/Term/Course/Another Evidence.md"),
    /already used by Notes\/Term\/Course\/Evidence\.md.*\{sourceHash\}/u,
  );
});

test("learning workspace replacement is revision-aware and preserves sessions and sidecars", async () => {
  const original = migratePracticeBankV2ToV3(bankV2());
  const history = emptyGenerationHistory();
  const path = "Notes/Term/Course/Practice/Evidence - Practice.md";
  const vault = new FakeVault();
  await vault.create(
    path,
    serializePracticeBank(original, recipe, history, undefined, recipeCatalog),
  );
  const repository = new PracticeBankRepository({ vault } as unknown as App);
  const replacement = structuredClone(original);
  replacement.updatedAt = "2026-08-22T08:10:00.000Z";
  replacement.aspects[0]!.title = "Revised evidence";
  replacement.sessions = [];

  const saved = await repository.saveLearningWorkspace({
    bank: replacement,
    expectedRevision: 0,
  });

  assert.equal(vault.processCalls, 1);
  assert.equal(saved.bank.revision, 1);
  assert.equal(saved.bank.aspects[0]?.title, "Revised evidence");
  assert.equal(saved.bank.sessions[0]?.id, "session-historical");
  const file = vault.files.get(path);
  assert.ok(file);
  assert.equal(parseGenerationRecipeMarkdown(file.content).status, "ok");
  assert.deepEqual(parseGenerationRecipeCatalogMarkdown(file.content), {
    status: "ok",
    catalog: recipeCatalog,
  });
  assert.deepEqual(parseGenerationHistoryMarkdown(file.content), {
    status: "ok",
    history,
  });
  await assert.rejects(
    repository.saveLearningWorkspace({ bank: replacement, expectedRevision: 0 }),
    /changed from revision 0 to 1/u,
  );
  await assert.rejects(
    repository.saveLearningWorkspace({
      bank: saved.bank,
      expectedRevision: saved.bank.revision,
      generationRecipeCatalog: { schemaVersion: 1, recipesBySetId: {} },
    }),
    /would erase live set set-general/iu,
  );
});

test("v3 serialization keeps a compatible legacy recipe fallback for a set catalog", () => {
  const bank = migratePracticeBankV2ToV3(bankV2());
  const markdown = serializePracticeBank(
    bank,
    undefined,
    emptyGenerationHistory(),
    undefined,
    recipeCatalog,
  );

  assert.deepEqual(parseGenerationRecipeCatalogMarkdown(markdown), {
    status: "ok",
    catalog: recipeCatalog,
  });
  const legacy = parseGenerationRecipeMarkdown(markdown);
  assert.equal(legacy.status, "ok");
  if (legacy.status === "ok") assert.deepEqual(legacy.recipe, recipe);

  assert.throws(
    () => serializePracticeBank(bank, recipe, undefined, undefined, {
      schemaVersion: 1,
      recipesBySetId: { "set-missing": recipe },
    }),
    /references an unknown practice set/u,
  );
  assert.throws(
    () => serializePracticeBank(bank, recipe, undefined, undefined, {
      schemaVersion: 1,
      recipesBySetId: {
        "set-general": { ...recipe, reasoningEffort: "low" },
      },
    }),
    /fallback does not match/iu,
  );
});

test("set replacement preserves other bank state and immutable historical evidence", async () => {
  const original = migratePracticeBankV2ToV3(bankV2());
  const path = "Notes/Term/Course/Practice/Evidence - Practice.md";
  const vault = new FakeVault();
  await vault.create(path, serializePracticeBank(original, recipe, emptyGenerationHistory()));
  const repository = new PracticeBankRepository({ vault } as unknown as App);
  const segmentId = original.exercises[0]?.sourceSegmentIds[0] ?? "missing";
  const regeneratedRecipe = { ...recipe, reasoningEffort: "max" as const };

  const saved = await repository.replacePracticeSet({
    bankPath: path,
    bankId: original.bankId,
    setId: "set-general",
    expectedRevision: original.revision,
    replacement: {
      set: {
        ...structuredClone(original.practiceSets[0]!),
        title: "Regenerated general practice",
        assignments: [{
          exerciseId: "exercise-new",
          aspectIds: ["aspect-general"],
          role: "independent",
        }],
      },
      exercises: [{
        id: "exercise-new",
        type: "short-answer",
        title: "New exercise",
        prompt: "What is the causal input?",
        difficulty: "hard",
        sourceSegmentIds: [segmentId],
        groundedAnswer: "Alpha.",
        acceptableAnswers: ["alpha"],
        keyPoints: ["alpha"],
      }],
      tutorLessons: [],
    },
    generationRecipeCatalog: generationRecipeCatalogFromLegacy("set-general", {
      status: "ok",
      recipe: regeneratedRecipe,
      storedSchemaVersion: 2,
    }),
  });

  assert.equal(saved.revision, original.revision + 1);
  assert.deepEqual(saved.exercises.map((exercise) => exercise.id), ["exercise-new"]);
  assert.equal(saved.sessions[0]?.results[0]?.exerciseId, "exercise-old");
  const file = vault.files.get(path);
  assert.ok(file);
  const parsed = parsePracticeBankMarkdown(file.content);
  assert.equal(parsed.status, "ok");
  if (parsed.status === "ok") {
    assert.equal(parsed.bank.practiceSets[0]?.title, "Regenerated general practice");
    assert.equal(parsed.bank.sessions[0]?.evidence[0]?.exerciseId, "exercise-old");
  }
  const regeneratedLegacy = parseGenerationRecipeMarkdown(file.content);
  assert.equal(regeneratedLegacy.status, "ok");
  if (regeneratedLegacy.status === "ok") {
    assert.equal(regeneratedLegacy.recipe.reasoningEffort, "max");
  }
});

test("quick generation cannot flatten an existing guided workspace", async () => {
  const original = guidedWorkspace();
  const path = "Notes/Term/Course/Practice/Evidence - Practice.md";
  const vault = new FakeVault();
  const initialMarkdown = serializePracticeBank(
    original,
    recipe,
    emptyGenerationHistory(),
    undefined,
    generationRecipeCatalogFromLegacy("set-guided", {
      status: "ok",
      recipe,
      storedSchemaVersion: 2,
    }),
  );
  await vault.create(path, initialMarkdown);
  const repository = new PracticeBankRepository({ vault } as unknown as App);
  const sourceText = "# Evidence\nAlpha causes beta.";
  const sourceFile = {
    path: original.source.vaultPath,
    name: "Evidence.md",
    basename: "Evidence",
    extension: "md",
  } as TFile;

  await assert.rejects(
    repository.saveGenerated({
      source: {
        mode: "note",
        title: "Evidence",
        path: original.source.vaultPath,
        characterCount: sourceText.length,
        excerpt: sourceText,
        visuals: [],
        file: sourceFile,
        submittedText: sourceText,
        segments: original.segments,
        hash: original.source.hash,
      },
      exercises: original.exercises,
      visuals: [],
      generation: {
        provider: "codex",
        generatedAt: "2026-08-22T09:00:00.000Z",
        promptVersion: "practice-lab-v3.4",
        reasoningEffort: "high",
      },
      generationRecipe: recipe,
      generationHistoryEntry: {
        id: "generation-quick-flatten",
        generatedAt: "2026-08-22T09:00:00.000Z",
        provider: "codex",
        model: "gpt-5.6",
        reasoningEffort: "high",
        promptVersion: "practice-lab-v3.4",
        sourceHash: original.source.hash,
        sourceScope: "note",
        requestedQuantity: 1,
        draftExerciseCount: 1,
        savedExerciseCount: 1,
        difficulty: "deep-exam",
        focusInstructions: "Ground every item.",
        exerciseTypePercentages: recipe.exerciseTypePercentages,
        selectedVisualCount: 0,
        attempts: 1,
      },
    }),
    /guided or multi-set learning workspace.*cannot replace/iu,
  );
  assert.equal(vault.files.get(path)?.content, initialMarkdown);
});
