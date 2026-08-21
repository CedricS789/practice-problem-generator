import type { App, TFile } from "obsidian";
import type {
  AiReviewSessionItemResultV2,
  AiReviewStateV2,
  ExerciseV1,
  GenerationMetadataV1,
  PracticeBankParseResult,
  PracticeBankV2,
  SessionItemResultV2,
  SessionSummaryV2,
  VisualSourceV1
} from "./model";
import { PRACTICE_BANK_SCHEMA_VERSION } from "./model";
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
  parseGenerationRecipeMarkdown,
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

export class PracticeBankRepository {
  constructor(private readonly app: App) {}

  async loadForSource(sourcePath: string): Promise<LoadedPracticeBank> {
    const path = derivePracticePath(sourcePath);
    const abstract = this.app.vault.getAbstractFileByPath(path);
    if (!isVaultFile(abstract)) {
      return {
        path,
        file: null,
        parsed: {
          status: "missing",
          recoveryMessage: "No saved Grounded Problems bank exists for this source note."
        }
      };
    }
    return { path, file: abstract, parsed: parsePracticeBankMarkdown(await this.app.vault.cachedRead(abstract)) };
  }

  async saveGenerated(input: SaveBankInput): Promise<{ path: string; bank: PracticeBankV2 }> {
    const path = derivePracticePath(input.source.path);
    await ensureParentFolder(this.app, path);
    const now = new Date().toISOString();
    const createBank = (previous?: PracticeBankV2): PracticeBankV2 => ({
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
    });

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
          ),
        );
        return { path, bank };
      } catch (error) {
        const raced = this.app.vault.getAbstractFileByPath(path);
        if (!isVaultFile(raced)) throw error;
        return this.replaceExisting(
          raced,
          createBank,
          input.generationRecipe,
          input.generationHistoryEntry,
          input.source.sourceImport,
        );
      }
    }
    return this.replaceExisting(
      existing,
      createBank,
      input.generationRecipe,
      input.generationHistoryEntry,
      input.source.sourceImport,
    );
  }

  async appendFinishedSession(
    bankPath: string,
    session: SessionSummaryV2,
    expectedRevision: number
  ): Promise<PracticeBankV2> {
    const file = this.app.vault.getAbstractFileByPath(normalizeVaultPath(bankPath));
    if (!isVaultFile(file)) throw new Error("The Grounded Problems bank no longer exists.");
    let saved: PracticeBankV2 | undefined;
    await this.app.vault.process(file, (markdown) => {
      const parsed = parsePracticeBankMarkdown(markdown);
      if (parsed.status !== "ok") throw readOnlyError(parsed);
      const merged = mergeSessionSummary(parsed.bank, session, { expectedRevision });
      if (merged.status === "conflict" || merged.status === "invalid-session") {
        throw new Error(merged.message);
      }
      saved = merged.bank;
      const recipe = generationRecipeForWrite(markdown);
      const history = requireGenerationHistoryForWrite(markdown);
      const sourceImport = requireSourceImportForWrite(markdown);
      return merged.status === "unchanged"
        ? markdown
        : serializePracticeBank(
            merged.bank,
            recipe,
            history,
            sourceImport,
          );
    });
    if (saved === undefined) throw new Error("Grounded Problems could not confirm the saved session.");
    return saved;
  }

  async removeSession(
    bankPath: string,
    bankId: string,
    sessionId: string,
  ): Promise<{ bank: PracticeBankV2; removedSessions: number }> {
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
  ): Promise<{ bank: PracticeBankV2; removedSessions: number }> {
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
  ): Promise<PracticeBankV2> {
    return this.applyAiReviewStateTransition(bankPath, patch, expectedRevision);
  }

  async applyAiReviewStateTransition(
    bankPath: string,
    patch: AiReviewStateTransitionPatchV2,
    expectedRevision?: number,
  ): Promise<PracticeBankV2> {
    const file = this.app.vault.getAbstractFileByPath(normalizeVaultPath(bankPath));
    if (!isVaultFile(file)) throw new Error("The Grounded Problems bank no longer exists.");
    let saved: PracticeBankV2 | undefined;
    await this.app.vault.process(file, (markdown) => {
      const parsed = parsePracticeBankMarkdown(markdown);
      if (parsed.status !== "ok") throw readOnlyError(parsed);
      const merged = mergeAiReviewStateTransition(parsed.bank, patch, {
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
      });
      if (merged.status === "conflict" || merged.status === "invalid-review") {
        throw new Error(merged.message);
      }
      saved = merged.bank;
      const recipe = generationRecipeForWrite(markdown);
      const history = requireGenerationHistoryForWrite(markdown);
      const sourceImport = requireSourceImportForWrite(markdown);
      return merged.status === "unchanged"
        ? markdown
        : serializePracticeBank(
            merged.bank,
            recipe,
            history,
            sourceImport,
          );
    });
    if (saved === undefined) throw new Error("Grounded Problems could not confirm the AI review update.");
    return saved;
  }

  private async replaceExisting(
    file: TFile,
    createBank: (previous: PracticeBankV2) => PracticeBankV2,
    generationRecipe: GenerationRecipeV2,
    generationHistoryEntry: GenerationHistoryEntryDraftV1,
    sourceImport?: SourceImportV1,
  ): Promise<{ path: string; bank: PracticeBankV2 }> {
    let saved: PracticeBankV2 | undefined;
    await this.app.vault.process(file, (markdown) => {
      const parsed = parsePracticeBankMarkdown(markdown);
      if (parsed.status !== "ok") throw readOnlyError(parsed);
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
      return serializePracticeBank(
        replacement,
        generationRecipe,
        history,
        recordedSourceImport,
      );
    });
    if (saved === undefined) throw new Error("Grounded Problems could not confirm the saved bank.");
    return { path: file.path, bank: saved };
  }

  private async updateSessions(
    bankPath: string,
    bankId: string,
    update: (bank: PracticeBankV2, updatedAt: string) => SessionRemovalResult,
    unchangedMessage: string,
  ): Promise<{ bank: PracticeBankV2; removedSessions: number }> {
    const file = this.app.vault.getAbstractFileByPath(normalizeVaultPath(bankPath));
    if (!isVaultFile(file)) throw new Error("The Grounded Problems bank no longer exists.");
    let saved: PracticeBankV2 | undefined;
    let removedSessions = 0;
    await this.app.vault.process(file, (markdown) => {
      const parsed = parsePracticeBankMarkdown(markdown);
      if (parsed.status !== "ok") throw readOnlyError(parsed);
      if (parsed.bank.bankId !== bankId) {
        throw new Error("The practice bank changed identity. Refresh before deleting data.");
      }
      const result = update(parsed.bank, new Date().toISOString());
      if (result.status === "unchanged") throw new Error(unchangedMessage);
      saved = result.bank;
      removedSessions = result.removed.length;
      return serializePracticeBank(
        result.bank,
        generationRecipeForWrite(markdown),
        requireGenerationHistoryForWrite(markdown),
        requireSourceImportForWrite(markdown),
      );
    });
    if (saved === undefined) {
      throw new Error("Grounded Problems could not confirm the history update.");
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

export function createSessionSummary(
  bank: PracticeBankV2,
  session: FinishedStudySession,
  options: { readonly sessionId?: string } = {},
): SessionSummaryV2 {
  if (options.sessionId !== undefined && session.id !== options.sessionId) {
    throw new Error("The finished session ID does not match the requested stable session ID.");
  }
  const sessionId = options.sessionId ?? session.id ?? `session-${crypto.randomUUID()}`;
  const exerciseIds = new Set(bank.exercises.map((exercise) => exercise.id));
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
  const objective = results.filter((result): result is Extract<SessionItemResultV2, { grading: "objective" }> => (
    result.grading === "objective"
  ));
  const ratings = { again: 0, hard: 0, good: 0, easy: 0 };
  for (const result of results) if (result.grading === "self-rated") ratings[result.rating] += 1;
  return {
    schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
    id: sessionId,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    bankRevisionAtStart: bank.revision,
    exerciseCount: bank.exercises.length,
    completedCount: results.length,
    score: {
      correct: objective.filter((result) => result.correct).length,
      total: objective.length
    },
    ratings,
    results
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

function isVaultFile(value: unknown): value is TFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TFile>;
  return typeof candidate.path === "string"
    && typeof candidate.basename === "string"
    && typeof candidate.extension === "string";
}
