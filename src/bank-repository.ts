import type { App, TFile } from "obsidian";
import type {
  AiReviewSessionItemResultV2,
  AiReviewStateV2,
  ExerciseV1,
  GenerationMetadataV1,
  PracticeBankParseResult,
  PracticeBankV2,
  PracticeBankV3,
  SessionItemResultV2,
  SessionSummaryV2,
  SessionSummaryV3,
  VisualSourceV1
} from "./model";
import {
  CURRENT_PRACTICE_BANK_SCHEMA_VERSION,
  PRACTICE_BANK_SCHEMA_VERSION,
} from "./model";
import {
  derivePracticePath,
  type AiReviewResolutionPatchV2,
  type AiReviewStateTransitionPatchV2,
  mergeAiReviewStateTransition,
  mergeSessionSummary,
  parsePracticeBankMarkdown,
  serializePracticeBank
} from "./persistence";
import { createAiReviewRequest } from "./schema";
import type { CollectedSource } from "./source";
import type { FinishedStudySession } from "./ui/contracts";
import { compactHeadingPath } from "./segmenter";
import {
  generationRecipeCatalogFromLegacy,
  parseGenerationRecipeCatalogMarkdown,
  parseGenerationRecipeMarkdown,
  type GenerationRecipeCatalogV1,
  type GenerationRecipeV2,
} from "./regeneration";
import {
  appendGenerationHistory,
  emptyGenerationHistory,
  parseGenerationHistoryMarkdown,
  type GenerationHistoryEntryDraftV1,
  type GenerationHistoryV1,
} from "./generation-history";
import {
  parseSourceImportMarkdown,
  recordPdfSourceRevision,
  type SourceImportV1,
} from "./source-import";
import {
  defaultSessionLearningMetadataV3,
  GENERAL_ASPECT_ID,
  GENERAL_PRACTICE_SET_ID,
  migratePracticeBankV2ToV3,
  replacePracticeSetContent,
  type PracticeSetContentReplacementV1,
  type SessionLearningMetadataV3,
} from "./learning-path";
import {
  clearPracticeSessions,
  removePracticeSession,
  type SessionRemovalResult,
} from "./data-management";

export interface LoadedPracticeBank {
  readonly path: string;
  readonly file: TFile | null;
  readonly parsed: PracticeBankParseResult;
}

export interface SaveBankInput {
  readonly source: CollectedSource;
  readonly exercises: readonly ExerciseV1[];
  readonly visuals: readonly VisualSourceV1[];
  readonly generation: GenerationMetadataV1;
  readonly generationRecipe: GenerationRecipeV2;
  readonly generationHistoryEntry: GenerationHistoryEntryDraftV1;
}

export interface LearningWorkspaceSidecarsV1 {
  readonly generationRecipe?: GenerationRecipeV2;
  readonly generationRecipeCatalog?: GenerationRecipeCatalogV1;
  readonly generationHistory?: GenerationHistoryV1;
  readonly sourceImport?: SourceImportV1;
}

export interface SaveLearningWorkspaceInput extends LearningWorkspaceSidecarsV1 {
  readonly bank: PracticeBankV3;
  /** Required only when the derived workspace already exists. */
  readonly expectedRevision?: number;
}

export interface ReplacePracticeSetInput extends LearningWorkspaceSidecarsV1 {
  readonly bankPath: string;
  readonly bankId: string;
  readonly setId: string;
  readonly expectedRevision: number;
  readonly replacement: PracticeSetContentReplacementV1;
}

export interface PracticeBankRepositoryOptions {
  /** Dynamic preferred path for newly created banks. */
  readonly preferredPath?: (sourcePath: string) => string;
  /** Finds an already saved bank so changing defaults never relocates it. */
  readonly locateExistingPath?: (sourcePath: string) => Promise<string | undefined>;
}

export class PracticeBankRepository {
  constructor(
    private readonly app: App,
    private readonly options: PracticeBankRepositoryOptions = {},
  ) {}

  async loadForSource(sourcePath: string): Promise<LoadedPracticeBank> {
    return this.resolveForSource(sourcePath);
  }

  async saveGenerated(input: SaveBankInput): Promise<{ path: string; bank: PracticeBankV3 }> {
    const target = await this.resolveForSource(input.source.path);
    const path = target.path;
    await ensureParentFolder(this.app, path);
    const now = new Date().toISOString();
    const createBank = (previous?: PracticeBankV2): PracticeBankV3 => migratePracticeBankV2ToV3({
      schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
      bankId: previous?.bankId ?? `bank-${crypto.randomUUID()}`,
      revision: (previous?.revision ?? -1) + 1,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      source: {
        vaultPath: input.source.path,
        wikilink: createSourceWikilink(input.source.path),
        title: input.source.title,
        scope: input.source.mode === "pdf" ? "selection" : input.source.mode,
        hash: input.source.hash
      },
      segments: input.source.segments.map((segment) => ({
        ...segment,
        headingPath: compactHeadingPath(segment.headingPath)
      })),
      visuals: input.visuals.map((visual) => ({ ...visual })),
      exercises: input.exercises.map(cloneExercise),
      sessions: previous?.sessions.map((session) => structuredClone(session)) ?? [],
      generation: { ...input.generation }
    }, input.source.sourceImport);

    const existing = this.app.vault.getAbstractFileByPath(path);
    if (!isVaultFile(existing)) {
      const bank = createBank();
      const history = appendGenerationHistory(
        emptyGenerationHistory(),
        input.generationHistoryEntry,
        bank.revision,
      );
      const sourceImport = input.source.sourceImport === undefined
        ? undefined
        : recordPdfSourceRevision(
            input.source.sourceImport,
            undefined,
            bank.revision,
            input.generationHistoryEntry.id,
          );
      try {
        await this.app.vault.create(
          path,
          serializePracticeBank(
            bank,
            input.generationRecipe,
            history,
            sourceImport,
            generationRecipeCatalogFromLegacy(
              GENERAL_PRACTICE_SET_ID,
              {
                status: "ok",
                recipe: input.generationRecipe,
                storedSchemaVersion: 2,
              },
            ),
          ),
        );
        return { path, bank };
      } catch (error) {
        const raced = this.app.vault.getAbstractFileByPath(path);
        if (!isVaultFile(raced)) throw error;
        return this.replaceExisting(
          raced,
          input.source.path,
          createBank,
          input.generationRecipe,
          input.generationHistoryEntry,
          input.source.sourceImport,
        );
      }
    }
    return this.replaceExisting(
      existing,
      input.source.path,
      createBank,
      input.generationRecipe,
      input.generationHistoryEntry,
      input.source.sourceImport,
    );
  }

  async saveLearningWorkspace(
    input: SaveLearningWorkspaceInput,
  ): Promise<{ path: string; bank: PracticeBankV3 }> {
    const target = await this.resolveForSource(input.bank.source.vaultPath);
    const path = target.path;
    await ensureParentFolder(this.app, path);
    const existing = target.file;
    if (existing === null) {
      if (input.expectedRevision !== undefined) {
        throw new Error("The expected learning workspace no longer exists.");
      }
      const bank = structuredClone(input.bank);
      await this.app.vault.create(
        path,
        serializePracticeBank(
          bank,
          input.generationRecipe,
          input.generationHistory,
          input.sourceImport,
          input.generationRecipeCatalog,
        ),
      );
      return { path, bank };
    }
    if (input.expectedRevision === undefined) {
      throw new Error("expectedRevision is required when replacing a learning workspace.");
    }
    let saved: PracticeBankV3 | undefined;
    await this.app.vault.process(existing, (markdown) => {
      const parsed = parsePracticeBankMarkdown(markdown);
      if (parsed.status !== "ok") throw readOnlyError(parsed);
      if (parsed.bank.bankId !== input.bank.bankId) {
        throw new Error("The learning workspace changed identity. Refresh before saving.");
      }
      if (parsed.bank.revision !== input.expectedRevision) {
        throw new Error(
          `The learning workspace changed from revision ${input.expectedRevision} to ${parsed.bank.revision}. Refresh before saving.`,
        );
      }
      const bank: PracticeBankV3 = {
        ...structuredClone(input.bank),
        schemaVersion: CURRENT_PRACTICE_BANK_SCHEMA_VERSION,
        bankId: parsed.bank.bankId,
        revision: parsed.bank.revision + 1,
        createdAt: parsed.bank.createdAt,
        updatedAt: nonDecreasingTimestamp(input.bank.updatedAt, parsed.bank.updatedAt),
        sessions: parsed.bank.sessions.map((session) => structuredClone(session)),
      };
      const sidecars = learningWorkspaceSidecars(
        markdown,
        input,
        bank,
        parsed.bank,
      );
      saved = bank;
      return serializePracticeBank(
        bank,
        sidecars.generationRecipe,
        sidecars.generationHistory,
        sidecars.sourceImport,
        sidecars.generationRecipeCatalog,
      );
    });
    if (saved === undefined) {
      throw new Error("Practice Problem Generator could not confirm the learning workspace save.");
    }
    return { path, bank: saved };
  }

  async replacePracticeSet(
    input: ReplacePracticeSetInput,
  ): Promise<PracticeBankV3> {
    const file = this.app.vault.getAbstractFileByPath(normalizeVaultPath(input.bankPath));
    if (!isVaultFile(file)) throw new Error("The Practice Problem Generator bank no longer exists.");
    let saved: PracticeBankV3 | undefined;
    await this.app.vault.process(file, (markdown) => {
      const parsed = parsePracticeBankMarkdown(markdown);
      if (parsed.status !== "ok") throw readOnlyError(parsed);
      if (parsed.bank.bankId !== input.bankId) {
        throw new Error("The practice bank changed identity. Refresh before regenerating the set.");
      }
      if (parsed.bank.revision !== input.expectedRevision) {
        throw new Error(
          `The practice bank changed from revision ${input.expectedRevision} to ${parsed.bank.revision}. Refresh before regenerating the set.`,
        );
      }
      const bank = replacePracticeSetContent(
        parsed.bank,
        input.setId,
        input.replacement,
        nonDecreasingTimestamp(new Date().toISOString(), parsed.bank.updatedAt),
      );
      const sidecars = learningWorkspaceSidecars(
        markdown,
        input,
        bank,
        parsed.bank,
        input.setId,
      );
      saved = bank;
      return serializePracticeBank(
        bank,
        sidecars.generationRecipe,
        sidecars.generationHistory,
        sidecars.sourceImport,
        sidecars.generationRecipeCatalog,
      );
    });
    if (saved === undefined) {
      throw new Error("Practice Problem Generator could not confirm the regenerated set.");
    }
    return saved;
  }

  async appendFinishedSession(
    bankPath: string,
    session: SessionSummaryV2,
    expectedRevision: number
  ): Promise<PracticeBankV3> {
    const file = this.app.vault.getAbstractFileByPath(normalizeVaultPath(bankPath));
    if (!isVaultFile(file)) throw new Error("The Practice Problem Generator bank no longer exists.");
    let saved: PracticeBankV3 | undefined;
    await this.app.vault.process(file, (markdown) => {
      const parsed = parsePracticeBankMarkdown(markdown);
      if (parsed.status !== "ok") throw readOnlyError(parsed);
      const merged = mergeSessionSummary(parsed.bank, session, { expectedRevision });
      if (merged.status === "conflict" || merged.status === "invalid-session") {
        throw new Error(merged.message);
      }
      saved = requireV3Bank(merged.bank);
      const recipe = generationRecipeForWrite(markdown);
      const recipeCatalog = generationRecipeCatalogForWrite(markdown, merged.bank);
      const history = requireGenerationHistoryForWrite(markdown);
      const sourceImport = requireSourceImportForWrite(markdown);
      return merged.status === "unchanged"
        ? markdown
        : serializePracticeBank(
            merged.bank,
            recipe,
            history,
            sourceImport,
            recipeCatalog,
          );
    });
    if (saved === undefined) throw new Error("Practice Problem Generator could not confirm the saved session.");
    return saved;
  }

  async removeSession(
    bankPath: string,
    bankId: string,
    sessionId: string,
  ): Promise<{ bank: PracticeBankV3; removedSessions: number }> {
    return this.updateSessions(
      bankPath,
      bankId,
      (bank, updatedAt) => removePracticeSession(bank, sessionId, updatedAt),
      "The selected history entry no longer exists.",
    );
  }

  async clearSessions(
    bankPath: string,
    bankId: string,
  ): Promise<{ bank: PracticeBankV3; removedSessions: number }> {
    return this.updateSessions(
      bankPath,
      bankId,
      clearPracticeSessions,
      "This practice bank has no session history to clear.",
    );
  }

  async applyAiReviewResolution(
    bankPath: string,
    patch: AiReviewResolutionPatchV2,
    expectedRevision?: number,
  ): Promise<PracticeBankV3> {
    return this.applyAiReviewStateTransition(bankPath, patch, expectedRevision);
  }

  async applyAiReviewStateTransition(
    bankPath: string,
    patch: AiReviewStateTransitionPatchV2,
    expectedRevision?: number,
  ): Promise<PracticeBankV3> {
    const file = this.app.vault.getAbstractFileByPath(normalizeVaultPath(bankPath));
    if (!isVaultFile(file)) throw new Error("The Practice Problem Generator bank no longer exists.");
    let saved: PracticeBankV3 | undefined;
    await this.app.vault.process(file, (markdown) => {
      const parsed = parsePracticeBankMarkdown(markdown);
      if (parsed.status !== "ok") throw readOnlyError(parsed);
      const merged = mergeAiReviewStateTransition(parsed.bank, patch, {
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
      });
      if (merged.status === "conflict" || merged.status === "invalid-review") {
        throw new Error(merged.message);
      }
      saved = requireV3Bank(merged.bank);
      const recipe = generationRecipeForWrite(markdown);
      const recipeCatalog = generationRecipeCatalogForWrite(markdown, merged.bank);
      const history = requireGenerationHistoryForWrite(markdown);
      const sourceImport = requireSourceImportForWrite(markdown);
      return merged.status === "unchanged"
        ? markdown
        : serializePracticeBank(
            merged.bank,
            recipe,
            history,
            sourceImport,
            recipeCatalog,
          );
    });
    if (saved === undefined) throw new Error("Practice Problem Generator could not confirm the AI review update.");
    return saved;
  }

  private async replaceExisting(
    file: TFile,
    expectedSourcePath: string,
    createBank: (previous: PracticeBankV2) => PracticeBankV3,
    generationRecipe: GenerationRecipeV2,
    generationHistoryEntry: GenerationHistoryEntryDraftV1,
    sourceImport?: SourceImportV1,
  ): Promise<{ path: string; bank: PracticeBankV3 }> {
    let saved: PracticeBankV3 | undefined;
    await this.app.vault.process(file, (markdown) => {
      const parsed = parsePracticeBankMarkdown(markdown);
      if (parsed.status !== "ok") throw readOnlyError(parsed);
      assertSameSource(file.path, parsed.bank.source.vaultPath, expectedSourcePath);
      const quickReplacementProblem = quickGenerationReplacementProblem(parsed.bank);
      if (quickReplacementProblem !== null) {
        throw new Error(quickReplacementProblem);
      }
      const replacement = createBank(parsed.bank);
      saved = replacement;
      const history = appendGenerationHistory(
        requireGenerationHistoryForWrite(markdown),
        generationHistoryEntry,
        replacement.revision,
      );
      const previousSourceImport = requireSourceImportForWrite(markdown);
      if (sourceImport === undefined && previousSourceImport !== undefined) {
        throw new Error("A PDF practice bank cannot be replaced without PDF source metadata.");
      }
      const recordedSourceImport = sourceImport === undefined
        ? undefined
        : recordPdfSourceRevision(
            sourceImport,
            previousSourceImport,
            replacement.revision,
            generationHistoryEntry.id,
          );
      const previousRecipeCatalog = generationRecipeCatalogForWrite(markdown, parsed.bank);
      const newRecipeCatalog = generationRecipeCatalogFromLegacy(
        GENERAL_PRACTICE_SET_ID,
        { status: "ok", recipe: generationRecipe, storedSchemaVersion: 2 },
      );
      const recipeCatalog: GenerationRecipeCatalogV1 = {
        schemaVersion: newRecipeCatalog.schemaVersion,
        recipesBySetId: {
          ...previousRecipeCatalog?.recipesBySetId,
          ...newRecipeCatalog.recipesBySetId,
        },
      };
      return serializePracticeBank(
        replacement,
        generationRecipe,
        history,
        recordedSourceImport,
        recipeCatalog,
      );
    });
    if (saved === undefined) throw new Error("Practice Problem Generator could not confirm the saved bank.");
    return { path: file.path, bank: saved };
  }

  private async resolveForSource(sourcePath: string): Promise<LoadedPracticeBank> {
    const locatedPath = await this.options.locateExistingPath?.(sourcePath);
    const checkedPaths = new Set<string>();
    const existingAt = async (path: string | undefined): Promise<LoadedPracticeBank | null> => {
      if (path === undefined || checkedPaths.has(path)) return null;
      checkedPaths.add(path);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!isVaultFile(file)) return null;
      const parsed = parsePracticeBankMarkdown(await this.app.vault.cachedRead(file));
      if (parsed.status === "ok") {
        assertSameSource(file.path, parsed.bank.source.vaultPath, sourcePath);
      }
      return { path: file.path, file, parsed };
    };

    // A bank already associated with this source owns its current path. Resolve it
    // before evaluating the new preference so changing storage settings never makes
    // a previously valid workspace unreachable.
    const located = await existingAt(locatedPath);
    if (located !== null) return located;

    const preferredPath = this.options.preferredPath?.(sourcePath)
      ?? derivePracticePath(sourcePath);
    let legacyPath: string | undefined;
    try {
      legacyPath = derivePracticePath(sourcePath);
    } catch {
      // Custom storage may intentionally support sources outside Notes/<term>/<course>/.
    }
    for (const path of [preferredPath, legacyPath]) {
      const existing = await existingAt(path);
      if (existing !== null) return existing;
    }
    return {
      path: preferredPath,
      file: null,
      parsed: {
        status: "missing",
        recoveryMessage: "No saved Practice Problem Generator bank exists for this source note.",
      },
    };
  }

  private async updateSessions(
    bankPath: string,
    bankId: string,
    update: (bank: PracticeBankV2, updatedAt: string) => SessionRemovalResult,
    unchangedMessage: string,
  ): Promise<{ bank: PracticeBankV3; removedSessions: number }> {
    const file = this.app.vault.getAbstractFileByPath(normalizeVaultPath(bankPath));
    if (!isVaultFile(file)) throw new Error("The Practice Problem Generator bank no longer exists.");
    let saved: PracticeBankV3 | undefined;
    let removedSessions = 0;
    await this.app.vault.process(file, (markdown) => {
      const parsed = parsePracticeBankMarkdown(markdown);
      if (parsed.status !== "ok") throw readOnlyError(parsed);
      if (parsed.bank.bankId !== bankId) {
        throw new Error("The practice bank changed identity. Refresh before deleting data.");
      }
      const result = update(parsed.bank, new Date().toISOString());
      if (result.status === "unchanged") throw new Error(unchangedMessage);
      saved = requireV3Bank(result.bank);
      removedSessions = result.removed.length;
      return serializePracticeBank(
        result.bank,
        generationRecipeForWrite(markdown),
        requireGenerationHistoryForWrite(markdown),
        requireSourceImportForWrite(markdown),
        generationRecipeCatalogForWrite(markdown, result.bank),
      );
    });
    if (saved === undefined) {
      throw new Error("Practice Problem Generator could not confirm the history update.");
    }
    return { bank: saved, removedSessions };
  }
}

function requireSourceImportForWrite(markdown: string): SourceImportV1 | undefined {
  const parsed = parseSourceImportMarkdown(markdown);
  if (parsed.status === "ok") return parsed.sourceImport;
  if (parsed.status === "missing") return undefined;
  throw new Error(
    `The saved PDF source metadata is invalid and will not be overwritten: ${parsed.message}`,
  );
}

function requireGenerationHistoryForWrite(markdown: string): GenerationHistoryV1 {
  const parsed = parseGenerationHistoryMarkdown(markdown);
  if (parsed.status === "ok") return parsed.history;
  if (parsed.status === "missing") return emptyGenerationHistory();
  throw new Error(
    `The saved generation history is invalid and will not be overwritten: ${parsed.message}`,
  );
}

function generationRecipeForWrite(
  markdown: string,
): GenerationRecipeV2 | undefined {
  const parsed = parseGenerationRecipeMarkdown(markdown);
  if (parsed.status === "ok") return parsed.recipe;
  if (parsed.status === "missing") return undefined;
  throw new Error(
    `The saved generation recipe is invalid and will not be overwritten: ${parsed.message}`,
  );
}

function quickGenerationReplacementProblem(bank: PracticeBankV3): string | null {
  const set = bank.practiceSets[0];
  const isCanonicalQuickWorkspace = bank.learningPath === null
    && bank.tutorLessons.length === 0
    && bank.aspects.length === 1
    && bank.aspects[0]?.id === GENERAL_ASPECT_ID
    && bank.practiceSets.length === 1
    && set?.id === GENERAL_PRACTICE_SET_ID
    && set.instructionalRole === "general"
    && set.assignments.length === bank.exercises.length
    && set.assignments.every((assignment) =>
      assignment.role === "independent"
      && assignment.aspectIds.length === 1
      && assignment.aspectIds[0] === GENERAL_ASPECT_ID
    );
  return isCanonicalQuickWorkspace
    ? null
    : "This source already has a guided or multi-set learning workspace. Quick generation cannot replace it; regenerate or tweak an individual set, or manage the learning path.";
}

function generationRecipeCatalogForWrite(
  markdown: string,
  bank: PracticeBankV2,
): GenerationRecipeCatalogV1 | undefined {
  const parsed = parseGenerationRecipeCatalogMarkdown(markdown);
  if (parsed.status === "ok") return parsed.catalog;
  if (parsed.status === "invalid") {
    throw new Error(
      `The saved set-scoped generation recipes are invalid and will not be overwritten: ${parsed.message}`,
    );
  }

  const legacy = parseGenerationRecipeMarkdown(markdown);
  if (legacy.status === "invalid") {
    throw new Error(
      `The saved generation recipe is invalid and will not be overwritten: ${legacy.message}`,
    );
  }
  if (legacy.status === "missing") return undefined;

  const currentBank = requireV3Bank(bank);
  const fallbackSetId = currentBank.practiceSets.some((set) => set.id === "set-general")
    ? "set-general"
    : [...currentBank.practiceSets]
        .sort((left, right) => left.order - right.order)[0]?.id;
  return fallbackSetId === undefined
    ? undefined
    : generationRecipeCatalogFromLegacy(fallbackSetId, legacy);
}

function learningWorkspaceSidecars(
  markdown: string,
  input: LearningWorkspaceSidecarsV1,
  bank: PracticeBankV3,
  previousBank: PracticeBankV3,
  mutableRecipeSetId?: string,
): {
  readonly generationRecipe: GenerationRecipeV2 | undefined;
  readonly generationRecipeCatalog: GenerationRecipeCatalogV1 | undefined;
  readonly generationHistory: GenerationHistoryV1;
  readonly sourceImport: SourceImportV1 | undefined;
} {
  const previousHistory = requireGenerationHistoryForWrite(markdown);
  const generationHistory = input.generationHistory ?? previousHistory;
  if (
    generationHistory.entries.length < previousHistory.entries.length
    || previousHistory.entries.some((entry, index) =>
      JSON.stringify(entry) !== JSON.stringify(generationHistory.entries[index]),
    )
  ) {
    throw new Error("The replacement generation history would erase or alter an existing entry.");
  }
  const previousSourceImport = requireSourceImportForWrite(markdown);
  const sourceImport = input.sourceImport ?? previousSourceImport;
  if (
    previousSourceImport !== undefined
    && sourceImport !== undefined
    && (
      sourceImport.revisions.length < previousSourceImport.revisions.length
      || previousSourceImport.revisions.some((revision, index) =>
        JSON.stringify(revision) !== JSON.stringify(sourceImport.revisions[index]),
      )
    )
  ) {
    throw new Error("The replacement PDF provenance would erase or alter an existing revision.");
  }
  const previousRecipeCatalog = generationRecipeCatalogForWrite(markdown, previousBank);
  if (input.generationRecipeCatalog !== undefined && previousRecipeCatalog !== undefined) {
    const liveSetIds = new Set(bank.practiceSets.map((set) => set.id));
    for (const [setId, previousRecipe] of Object.entries(previousRecipeCatalog.recipesBySetId)) {
      if (!liveSetIds.has(setId)) continue;
      const nextRecipe = input.generationRecipeCatalog.recipesBySetId[setId];
      if (nextRecipe === undefined) {
        throw new Error(`The replacement generation recipe catalog would erase live set ${setId}.`);
      }
      if (
        mutableRecipeSetId !== undefined
        && setId !== mutableRecipeSetId
        && JSON.stringify(nextRecipe) !== JSON.stringify(previousRecipe)
      ) {
        throw new Error(`Regenerating ${mutableRecipeSetId} cannot alter the recipe for ${setId}.`);
      }
    }
  }
  const generationRecipeCatalog = input.generationRecipeCatalog
    ?? previousRecipeCatalog;
  return {
    generationRecipe: input.generationRecipe
      ?? (input.generationRecipeCatalog === undefined
        ? generationRecipeForWrite(markdown)
        : undefined),
    generationRecipeCatalog,
    generationHistory,
    sourceImport,
  };
}

function nonDecreasingTimestamp(candidate: string, previous: string): string {
  const candidateTime = Date.parse(candidate);
  const previousTime = Date.parse(previous);
  if (!Number.isFinite(candidateTime) || !Number.isFinite(previousTime)) {
    throw new Error("The learning workspace timestamps are invalid.");
  }
  return candidateTime < previousTime ? previous : candidate;
}

export interface CreateSessionSummaryOptionsV3 {
  readonly sessionId?: string;
  readonly learning?: SessionLearningMetadataV3;
}

export function createSessionSummary(
  bank: PracticeBankV2,
  session: FinishedStudySession,
  options: CreateSessionSummaryOptionsV3 = {},
): SessionSummaryV3 {
  if (options.sessionId !== undefined && session.id !== options.sessionId) {
    throw new Error("The finished session ID does not match the requested stable session ID.");
  }
  const sessionId = options.sessionId ?? session.id ?? `session-${crypto.randomUUID()}`;
  const orderedExerciseIds = session.orderedExerciseIds
    ?? bank.exercises.map((exercise) => exercise.id);
  const exerciseIds = new Set(orderedExerciseIds);
  if (exerciseIds.size !== orderedExerciseIds.length) {
    throw new Error("The session's locked exercise order contains duplicate IDs.");
  }
  const exerciseCount = session.exerciseCountAtStart ?? orderedExerciseIds.length;
  if (exerciseCount !== orderedExerciseIds.length) {
    throw new Error("The session's locked exercise count is inconsistent.");
  }
  const bankRevisionAtStart = session.bankRevisionAtStart ?? bank.revision;
  if (!Number.isInteger(bankRevisionAtStart) || bankRevisionAtStart < 0) {
    throw new Error("The session's starting bank revision is invalid.");
  }
  const skippedExerciseIds = session.skippedExerciseIds ?? [];
  if (new Set(skippedExerciseIds).size !== skippedExerciseIds.length) {
    throw new Error("The session contains duplicate skipped exercise IDs.");
  }
  if (skippedExerciseIds.some((id) => !exerciseIds.has(id))) {
    throw new Error("The session contains an unknown skipped exercise.");
  }
  const seen = new Set<string>();
  const results: SessionItemResultV2[] = session.answers.map((answer) => {
    if (!exerciseIds.has(answer.exerciseId)) throw new Error(`Unknown exercise in session: ${answer.exerciseId}`);
    if (seen.has(answer.exerciseId)) throw new Error(`Duplicate exercise in session: ${answer.exerciseId}`);
    seen.add(answer.exerciseId);
    if (answer.aiReview !== undefined) {
      if (answer.rating !== undefined || answer.correct !== undefined) {
        throw new Error(`AI-reviewed session answer ${answer.exerciseId} also has a manual result.`);
      }
      return createAiReviewResult(sessionId, answer.exerciseId, answer.aiReview);
    }
    if (answer.rating !== undefined) {
      return { exerciseId: answer.exerciseId, grading: "self-rated", rating: answer.rating };
    }
    if (answer.correct === undefined) throw new Error(`Session answer ${answer.exerciseId} has no grade or rating.`);
    return { exerciseId: answer.exerciseId, grading: "objective", correct: answer.correct };
  });
  if (skippedExerciseIds.some((id) => seen.has(id))) {
    throw new Error("A session exercise cannot be both answered and skipped.");
  }
  if (results.length + skippedExerciseIds.length > exerciseCount) {
    throw new Error("The session contains more answered and skipped questions than its locked exercise count.");
  }
  const objective = results.filter((result): result is Extract<SessionItemResultV2, { grading: "objective" }> => (
    result.grading === "objective"
  ));
  const ratings = { again: 0, hard: 0, good: 0, easy: 0 };
  for (const result of results) if (result.grading === "self-rated") ratings[result.rating] += 1;
  const learning = options.learning
    ?? sessionLearningMetadata(session)
    ?? defaultSessionLearningMetadataV3(
      bank,
      results.map((result) => result.exerciseId),
    );
  const resultIds = results.map((result) => result.exerciseId);
  if (
    learning.evidence.length !== resultIds.length
    || new Set(learning.evidence.map((entry) => entry.exerciseId)).size
      !== learning.evidence.length
    || learning.evidence.some((entry) => !resultIds.includes(entry.exerciseId))
  ) {
    throw new Error("The session learning evidence must contain one snapshot per recorded result.");
  }
  const scopedSets = new Map(learning.scope.sets.map((set) => [set.id, set]));
  if (scopedSets.size !== learning.scope.sets.length) {
    throw new Error("The session learning scope contains duplicate practice sets.");
  }
  if (
    (learning.scope.mode === "quick" || learning.scope.mode === "set")
    && learning.scope.sets.length !== 1
  ) {
    throw new Error(`${learning.scope.mode} sessions require exactly one scoped practice set.`);
  }
  if (learning.scope.mode === "mixed" && learning.scope.sets.length < 2) {
    throw new Error("Mixed sessions require at least two scoped practice sets.");
  }
  if ((learning.scope.mode === "learning-path") !== (learning.scope.learningPath !== undefined)) {
    throw new Error("Only learning-path sessions may identify a learning path.");
  }
  if (learning.evidence.some((entry) => {
    const scoped = scopedSets.get(entry.set.id);
    return scoped === undefined || scoped.title !== entry.set.title;
  })) {
    throw new Error("Every session evidence set must exactly match its scoped snapshot.");
  }
  if (learning.evidence.length > 0 && skippedExerciseIds.length === 0) {
    const contributingSetIds = new Set(learning.evidence.map((entry) => entry.set.id));
    if (
      contributingSetIds.size !== scopedSets.size
      || learning.scope.sets.some((set) => !contributingSetIds.has(set.id))
    ) {
      throw new Error("Every scoped practice set must contribute recorded session evidence.");
    }
  }
  return {
    schemaVersion: CURRENT_PRACTICE_BANK_SCHEMA_VERSION,
    id: sessionId,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    bankRevisionAtStart,
    exerciseCount,
    completedCount: results.length,
    score: {
      correct: objective.filter((result) => result.correct).length,
      total: objective.length
    },
    ratings,
    results,
    scope: structuredClone(learning.scope),
    evidence: learning.evidence.map((entry) => structuredClone(entry)),
    completedTutorLessons: learning.completedTutorLessons.map((entry) => structuredClone(entry)),
  };
}

type SessionAiReviewInput = NonNullable<
  FinishedStudySession["answers"][number]["aiReview"]
>;

function dynamicProperty(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function sessionLearningMetadata(
  session: FinishedStudySession,
): SessionLearningMetadataV3 | undefined {
  const value = dynamicProperty(session, "learning");
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) {
    throw new Error("The finished session learning snapshot must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.scope !== "object"
    || record.scope === null
    || !Array.isArray(record.evidence)
    || !Array.isArray(record.completedTutorLessons)
  ) {
    throw new Error("The finished session learning snapshot is incomplete.");
  }
  return structuredClone(value) as SessionLearningMetadataV3;
}

function dynamicString(value: unknown, key: string, fallback: string): string {
  const candidate = dynamicProperty(value, key);
  return typeof candidate === "string" && candidate.length > 0 ? candidate : fallback;
}

function createAiReviewResult(
  sessionId: string,
  exerciseId: string,
  aiReview: SessionAiReviewInput,
): AiReviewSessionItemResultV2 {
  const { request, status } = aiReview;
  if (request.sessionId !== sessionId || status.sessionId !== sessionId) {
    throw new Error(`AI review ${request.requestId} does not match session ${sessionId}.`);
  }
  if (request.exerciseId !== exerciseId || status.exerciseId !== exerciseId) {
    throw new Error(`AI review ${request.requestId} does not match exercise ${exerciseId}.`);
  }
  if (status.requestId !== request.requestId) {
    throw new Error(`AI review request ID ${request.requestId} does not match its status.`);
  }
  const attempts = status.attempts;
  const lockedRequest = createAiReviewRequest({
    requestId: request.requestId,
    sessionId,
    exerciseId,
    provider: request.provider,
    reasoningEffort: request.reasoningEffort,
    promptVersion: dynamicString(request, "promptVersion", "answer-review-v1"),
    requestedAt: request.requestedAt,
    submittedAnswer: request.submittedAnswer,
    context: {
      exerciseTitle: request.exerciseTitle,
      exerciseType: request.exerciseType,
      prompt: request.prompt,
      groundedAnswer: request.groundedAnswer,
      keyPoints: [...request.keyPoints],
      sourceSegments: request.sourceSegments.map((segment) => ({
        id: segment.id,
        headingPath: [...segment.headingPath],
        text: segment.text,
      })),
    },
  });
  let state: AiReviewStateV2;
  if (status.state === "reviewed") {
    state = {
      status: "reviewed",
      reviewedAt: status.reviewedAt,
      attempts,
      verdict: status.verdict,
      feedback: status.feedback,
      criteria: status.criterionResults.map((criterion) => ({
        criterion: criterion.criterion,
        outcome: criterion.outcome,
        feedback: criterion.feedback,
        sourceSegmentIds: [...criterion.sourceSegmentIds],
      })),
    };
  } else if (status.state === "failed") {
    state = {
      status: "failed",
      failedAt: status.failedAt,
      attempts,
      error: {
        code: status.failureCode,
        message: status.failure,
        retryable: status.retryable ?? false,
      },
    };
  } else {
    state = {
      status: "pending",
      queuedAt: status.queuedAt,
      attempts,
    };
  }
  return { exerciseId, grading: "ai-review", request: lockedRequest, state };
}

function cloneExercise(exercise: ExerciseV1): ExerciseV1 {
  return structuredClone(exercise);
}

function createSourceWikilink(path: string): string {
  const linkPath = normalizeVaultPath(path).replace(/\.md$/iu, "");
  return `[[${linkPath}]]`;
}

function requireV3Bank(bank: PracticeBankV2): PracticeBankV3 {
  if (bank.schemaVersion !== CURRENT_PRACTICE_BANK_SCHEMA_VERSION) {
    throw new Error("An authorized bank update did not produce the current schema version.");
  }
  return bank as PracticeBankV3;
}

function readOnlyError(parsed: Exclude<PracticeBankParseResult, { status: "ok" }>): Error {
  if (parsed.status === "unsupported-version") {
    return new Error(`This bank uses unsupported schema version ${String(parsed.schemaVersion)}. ${parsed.recoveryMessage}`);
  }
  if (parsed.status === "invalid") return new Error(`${parsed.errors.join("; ")} ${parsed.recoveryMessage}`);
  return new Error(parsed.recoveryMessage);
}

async function ensureParentFolder(app: App, filePath: string): Promise<void> {
  const parts = normalizeVaultPath(filePath).split("/").slice(0, -1);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
  }
}

function normalizeVaultPath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/\/{2,}/gu, "/").replace(/^\/+|\/+$/gu, "");
}

function assertSameSource(
  bankPath: string,
  actualSourcePath: string,
  expectedSourcePath: string,
): void {
  if (
    normalizeVaultPath(actualSourcePath).toLocaleLowerCase()
    === normalizeVaultPath(expectedSourcePath).toLocaleLowerCase()
  ) return;
  throw new Error(
    `The configured practice-bank path ${bankPath} is already used by ${actualSourcePath}. Add {sourceHash} to the custom path template or choose another base folder.`,
  );
}

function isVaultFile(value: unknown): value is TFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TFile>;
  return typeof candidate.path === "string"
    && typeof candidate.basename === "string"
    && typeof candidate.extension === "string";
}
