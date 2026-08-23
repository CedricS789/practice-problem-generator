import { Platform, TFile, type App } from "obsidian";

import type { CliProviderLayer } from "./cli";
import type { CliActivityEvent, MediaInput } from "./cli/contracts";
import type { PracticeBankRepository } from "./bank-repository";
import {
  appendGenerationHistory,
  emptyGenerationHistory,
  parseGenerationHistoryMarkdown,
  type GenerationHistoryV2,
} from "./generation-history";
import {
  LEARNING_PATH_PROMPT_VERSION,
  asPracticeSetDraft,
  buildPracticeSetPrompt,
  practiceSetDraftV1JsonSchema,
  practiceSetPayloadHash,
  validatePracticeSetDraftForWorkspace,
  validatePracticeSetReplacement,
  type PracticeSetDraftV1,
} from "./learning-path-generation";
import type { PracticeBankV3, PracticeSetV1, VisualSourceV1 } from "./model";
import { parsePracticeBankMarkdown } from "./persistence";
import {
  createGenerationRecipe,
  emptyGenerationRecipeCatalog,
  generationRecipeCatalogFromLegacy,
  parseGenerationRecipeCatalogMarkdown,
  parseGenerationRecipeMarkdown,
  setGenerationRecipeForSet,
  type GenerationRecipeCatalogV1,
} from "./regeneration";
import {
  createSavedSetPayloadContext,
  type SavedSetPayloadContextV1,
} from "./saved-set-generation";
import { parseSourceImportMarkdown } from "./source-import";
import { validatePracticeBank } from "./schema";
import type {
  EditableDraftExercise,
  GenerationConfiguration,
  PayloadPreview,
  ProviderPresentation,
} from "./ui/contracts";
import { applyDraftEdits, presentExercises } from "./ui/presenters";

export interface SavedSetGenerationRequestV1 {
  readonly bankPath: string;
  readonly bank: PracticeBankV3;
  readonly targetSet: PracticeSetV1;
  readonly targetAspectIds?: readonly string[];
  readonly configuration: GenerationConfiguration;
  readonly addingSet: boolean;
}

export interface GeneratedSavedSetPresentationV1 {
  readonly setId: string;
  readonly exercises: readonly EditableDraftExercise[];
  readonly draft: PracticeSetDraftV1;
}

export interface SavedSetReviewV1 extends GeneratedSavedSetPresentationV1 {
  readonly approvedExerciseIds: readonly string[];
}

interface PreparedBankVisualV1 {
  readonly source: VisualSourceV1;
  readonly media: MediaInput;
}

interface PendingSavedSetV1 {
  readonly requestKey: string;
  readonly request: SavedSetGenerationRequestV1;
  readonly context: SavedSetPayloadContextV1;
  readonly visuals: readonly PreparedBankVisualV1[];
  readonly catalog: GenerationRecipeCatalogV1;
  readonly history: GenerationHistoryV2;
  draft?: PracticeSetDraftV1;
  jobId?: string;
  attempts?: 1 | 2;
}

export interface SavedSetControllerOptions {
  readonly app: App;
  readonly repository: PracticeBankRepository;
  readonly ensureCliLayer: () => Promise<CliProviderLayer>;
  readonly providers: () => readonly ProviderPresentation[];
  readonly timeoutMs: () => number;
}

/** Desktop-only AI generation for one saved set, with sibling content frozen. */
export class SavedSetGenerationController {
  private pending: PendingSavedSetV1 | undefined;

  constructor(private readonly options: SavedSetControllerOptions) {}

  public async defaults(
    bankPath: string,
    bank: PracticeBankV3,
    setId: string,
    fallback: GenerationConfiguration,
  ): Promise<GenerationConfiguration> {
    const { markdown } = await this.currentBank(bankPath, bank);
    const catalog = generationCatalog(markdown, bank);
    const recipe = catalog.recipesBySetId[setId];
    if (recipe === undefined) return structuredClone(fallback);
    return {
      provider: recipe.provider,
      model: recipe.model,
      reasoningEffort: recipe.reasoningEffort,
      focusInstructions: recipe.focusInstructions,
      quantity: recipe.quantity,
      difficulty: recipe.difficulty,
      exerciseTypePercentages: { ...recipe.exerciseTypePercentages },
      exerciseTypes: Object.entries(recipe.exerciseTypePercentages)
        .filter(([, percentage]) => percentage > 0)
        .map(([type]) => type as GenerationConfiguration["exerciseTypes"][number]),
      selectedVisualIds: bank.visuals.map((visual) => visual.id),
    };
  }

  public async preview(
    request: SavedSetGenerationRequestV1,
  ): Promise<PayloadPreview> {
    this.assertDesktop();
    const { markdown, bank } = await this.currentBank(request.bankPath, request.bank);
    const catalog = generationCatalog(markdown, bank);
    const context = createSavedSetPayloadContext({
      bank,
      targetSet: request.targetSet,
      configuration: request.configuration,
      recipeCatalog: catalog,
      addingSet: request.addingSet,
      ...(request.targetAspectIds === undefined
        ? {}
        : { targetAspectIds: request.targetAspectIds }),
    });
    const selected = new Set(request.configuration.selectedVisualIds);
    const visuals = await prepareBankVisuals(
      this.options.app,
      bank.visuals.filter((visual) => selected.has(visual.id)),
    );
    const provider = this.provider(request.configuration.provider);
    const layer = await this.options.ensureCliLayer();
    if (!provider.available) {
      throw new Error(`${provider.label} is unavailable. ${provider.detail ?? "Check its executable setting."}`);
    }
    if (visuals.length > 0 && layer.adapters[provider.id].capabilities().vision !== "supported") {
      throw new Error(`${provider.label} cannot inspect the selected visuals. Choose a vision-capable provider or remove image occlusion.`);
    }
    const prompt = buildPracticeSetPrompt(context.payload);
    const cli = await import("./cli");
    this.pending = {
      requestKey: requestKey(request, context),
      request: structuredClone(request),
      context,
      visuals,
      catalog,
      history: parsedHistory(markdown),
    };
    return {
      providerLabel: provider.label,
      modelLabel: request.configuration.model.length === 0
        ? "Automatic"
        : request.configuration.model,
      reasoningEffortLabel: request.configuration.reasoningEffort,
      text: cli.appendNeutralMediaManifest(
        prompt,
        visuals.map((visual, index) => neutralFilename(index, visual.source.mimeType)),
      ),
      visualNames: visuals.map((visual) => visual.source.altText ?? visual.source.id),
      warning: request.addingSet
        ? "This creates one new repair set after you review and approve the generated draft. Existing sets and historical evidence stay untouched."
        : "This replaces only the selected set after review. Sibling sets and every historical evidence snapshot stay untouched.",
    };
  }

  public async generate(
    request: SavedSetGenerationRequestV1,
    onActivity: (event: CliActivityEvent) => void,
  ): Promise<GeneratedSavedSetPresentationV1> {
    this.assertDesktop();
    const pending = this.requirePending(request);
    const provider = this.provider(request.configuration.provider);
    const layer = await this.options.ensureCliLayer();
    const adapter = layer.adapters[provider.id];
    const jobId = `saved-set-${crypto.randomUUID()}`;
    const result = await layer.coordinator.generate(adapter, {
      prompt: buildPracticeSetPrompt(pending.context.payload),
      schema: practiceSetDraftV1JsonSchema,
      validate: (value) => validatePracticeSetDraftForWorkspace(value, pending.context.payload),
      ...(request.configuration.model.length === 0
        ? {}
        : { model: request.configuration.model }),
      reasoningEffort: request.configuration.reasoningEffort,
      media: pending.visuals.map((visual) => visual.media),
      timeoutMs: this.options.timeoutMs(),
      onActivity,
    }, {
      id: jobId,
      kind: "generation",
      provider: provider.id,
    });
    const draft = asPracticeSetDraft(result.value, pending.context.payload);
    const crossSet = validatePracticeSetReplacement({
      payload: pending.context.payload,
      replacement: draft,
      siblingDrafts: pending.context.siblingDrafts,
    });
    if (!crossSet.valid || crossSet.value === undefined) {
      throw new Error(crossSet.errors?.join("; ") ?? "The generated set conflicts with a sibling set.");
    }
    pending.draft = crossSet.value;
    pending.jobId = jobId;
    pending.attempts = result.attempts;
    const visualUrls = new Map(pending.visuals.map((visual) => [
      visual.source.id,
      this.options.app.vault.adapter.getResourcePath(visual.source.vaultPath),
    ]));
    return {
      setId: draft.setId,
      draft: structuredClone(draft),
      exercises: presentExercises(
        draft.exercises,
        (id) => visualUrls.get(id),
        request.bank.segments,
      ).map((exercise) => ({
        ...exercise,
        rejected: false,
        occlusionReviewed: exercise.type !== "image-occlusion",
      })),
    };
  }

  public async save(
    request: SavedSetGenerationRequestV1,
    review: SavedSetReviewV1,
  ): Promise<{ readonly path: string; readonly bank: PracticeBankV3 }> {
    const pending = this.requirePending(request);
    const original = pending.draft;
    if (original === undefined || pending.jobId === undefined || pending.attempts === undefined) {
      throw new Error("Generate and review the saved set before saving it.");
    }
    if (review.setId !== original.setId) throw new Error("The reviewed set identity changed.");
    const approved = new Set(review.approvedExerciseIds);
    const kept = review.exercises.filter((exercise) => !exercise.rejected);
    if (kept.length === 0) throw new Error("Keep at least one approved exercise in the set.");
    if (kept.some((exercise) => !approved.has(exercise.id))) {
      throw new Error("Every kept exercise must be explicitly approved before saving.");
    }
    const exercises = applyDraftEdits(original.exercises, review.exercises);
    const keptIds = new Set(exercises.map((exercise) => exercise.id));
    const replacementDraft: PracticeSetDraftV1 = {
      schemaVersion: original.schemaVersion,
      setId: original.setId,
      exercises,
      assignments: original.assignments.filter((assignment) => keptIds.has(assignment.exerciseId)),
      tutorLessons: original.tutorLessons.filter((lesson) => {
        if (keptIds.has(lesson.guidedExerciseId)) return true;
        throw new Error(`Tutor lesson ${lesson.title} lost its guided exercise. Keep that exercise or regenerate as practice-only.`);
      }),
    };
    const crossSet = validatePracticeSetReplacement({
      payload: pending.context.payload,
      replacement: replacementDraft,
      siblingDrafts: pending.context.siblingDrafts,
    });
    if (!crossSet.valid || crossSet.value === undefined) {
      throw new Error(crossSet.errors?.join("; ") ?? "The reviewed set conflicts with a sibling set.");
    }
    const { markdown, bank } = await this.currentBank(request.bankPath, request.bank);
    const provider = this.provider(request.configuration.provider);
    const catalog = setGenerationRecipeForSet(
      generationCatalog(markdown, bank),
      request.targetSet.id,
      request.configuration,
      bank.source.hash,
    );
    const history = appendGenerationHistory(parsedHistory(markdown), {
      id: pending.jobId,
      generatedAt: new Date().toISOString(),
      provider: request.configuration.provider,
      ...(provider.version === undefined ? {} : { providerVersion: provider.version }),
      model: request.configuration.model,
      reasoningEffort: request.configuration.reasoningEffort,
      promptVersion: LEARNING_PATH_PROMPT_VERSION,
      sourceHash: bank.source.hash,
      sourceScope: bank.source.scope,
      requestedQuantity: request.configuration.quantity,
      draftExerciseCount: original.exercises.length,
      savedExerciseCount: crossSet.value.exercises.length,
      difficulty: request.configuration.difficulty,
      focusInstructions: request.configuration.focusInstructions,
      exerciseTypePercentages: { ...request.configuration.exerciseTypePercentages },
      selectedVisualCount: request.configuration.selectedVisualIds.length,
      attempts: pending.attempts,
      batchId: pending.context.payload.batchId,
      blueprintId: pending.context.payload.blueprintId,
      setId: request.targetSet.id,
    }, bank.revision + 1);
    const sourceImport = parseSourceImportMarkdown(markdown);
    if (sourceImport.status === "invalid") throw new Error(sourceImport.message);
    const sidecars = {
      generationRecipe: createGenerationRecipe(request.configuration, bank.source.hash),
      generationRecipeCatalog: catalog,
      generationHistory: history,
      ...(sourceImport.status === "ok" ? { sourceImport: sourceImport.sourceImport } : {}),
    };
    let saved: PracticeBankV3;
    if (request.addingSet) {
      const path = bank.learningPath;
      if (path === null) throw new Error("The live workspace no longer contains a learning path.");
      const set: PracticeSetV1 = {
        ...structuredClone(request.targetSet),
        order: bank.practiceSets.length,
        assignments: crossSet.value.assignments.map((assignment) => structuredClone(assignment)),
      };
      const next: PracticeBankV3 = {
        ...structuredClone(bank),
        revision: bank.revision + 1,
        updatedAt: new Date().toISOString(),
        exercises: [...bank.exercises.map((exercise) => structuredClone(exercise)), ...crossSet.value.exercises],
        practiceSets: [...bank.practiceSets.map((entry) => structuredClone(entry)), set],
        tutorLessons: [...bank.tutorLessons.map((lesson) => structuredClone(lesson)), ...crossSet.value.tutorLessons],
        learningPath: {
          ...structuredClone(path),
          aspectIds: [...new Set([...path.aspectIds, ...set.assignments.flatMap((assignment) => assignment.aspectIds)])],
          steps: [
            ...path.steps.map((step) => structuredClone(step)),
            { kind: "practice-set", setId: set.id, order: path.steps.length },
          ],
        },
        generation: {
          provider: request.configuration.provider,
          generatedAt: new Date().toISOString(),
          promptVersion: LEARNING_PATH_PROMPT_VERSION,
          reasoningEffort: request.configuration.reasoningEffort,
        },
      };
      const validation = validatePracticeBank(next);
      if (!validation.ok) {
        throw new Error(`Cannot add an invalid repair set: ${validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
      }
      const result = await this.options.repository.saveLearningWorkspace({
        bank: next,
        expectedRevision: bank.revision,
        ...sidecars,
      });
      saved = result.bank;
    } else {
      saved = await this.options.repository.replacePracticeSet({
        bankPath: request.bankPath,
        bankId: bank.bankId,
        setId: request.targetSet.id,
        expectedRevision: bank.revision,
        replacement: {
          set: {
            ...structuredClone(request.targetSet),
            assignments: crossSet.value.assignments.map((assignment) => structuredClone(assignment)),
          },
          exercises: crossSet.value.exercises,
          tutorLessons: crossSet.value.tutorLessons,
        },
        ...sidecars,
      });
    }
    this.pending = undefined;
    return { path: request.bankPath, bank: saved };
  }

  public cancel(): void {
    void this.options.ensureCliLayer().then((layer) => layer.coordinator.cancel()).catch(() => undefined);
  }

  private requirePending(request: SavedSetGenerationRequestV1): PendingSavedSetV1 {
    const pending = this.pending;
    if (pending === undefined || pending.requestKey !== requestKey(request, pending.context)) {
      throw new Error("The saved-set payload changed. Preview and approve the exact payload again.");
    }
    return pending;
  }

  private provider(id: GenerationConfiguration["provider"]): ProviderPresentation {
    const provider = this.options.providers().find((candidate) => candidate.id === id);
    if (provider === undefined) throw new Error(`Provider ${id} is not configured.`);
    return provider;
  }

  private async currentBank(
    bankPath: string,
    expected: PracticeBankV3,
  ): Promise<{ readonly markdown: string; readonly bank: PracticeBankV3 }> {
    const file = this.options.app.vault.getAbstractFileByPath(bankPath);
    if (!(file instanceof TFile)) throw new Error("The saved learning workspace no longer exists.");
    const markdown = await this.options.app.vault.cachedRead(file);
    const parsed = parsePracticeBankMarkdown(markdown);
    if (parsed.status !== "ok") throw new Error(parsed.recoveryMessage);
    if (parsed.bank.bankId !== expected.bankId || parsed.bank.revision !== expected.revision) {
      throw new Error("The learning workspace changed. Refresh it before editing a set.");
    }
    return { markdown, bank: parsed.bank };
  }

  private assertDesktop(): void {
    if (Platform.isMobileApp) throw new Error("Saved-set AI generation is available on desktop only. Saved sets remain usable on mobile.");
  }
}

function generationCatalog(markdown: string, bank: PracticeBankV3): GenerationRecipeCatalogV1 {
  const parsed = parseGenerationRecipeCatalogMarkdown(markdown);
  if (parsed.status === "invalid") throw new Error(parsed.message);
  if (parsed.status === "ok") return parsed.catalog;
  const fallbackSetId = bank.practiceSets[0]?.id;
  if (fallbackSetId === undefined) return emptyGenerationRecipeCatalog();
  return generationRecipeCatalogFromLegacy(
    fallbackSetId,
    parseGenerationRecipeMarkdown(markdown),
  );
}

function parsedHistory(markdown: string): GenerationHistoryV2 {
  const parsed = parseGenerationHistoryMarkdown(markdown);
  if (parsed.status === "invalid") throw new Error(parsed.message);
  return parsed.status === "ok" ? parsed.history : emptyGenerationHistory();
}

async function prepareBankVisuals(
  app: App,
  sources: readonly VisualSourceV1[],
): Promise<PreparedBankVisualV1[]> {
  const prepared: PreparedBankVisualV1[] = [];
  for (const source of sources) {
    const file = app.vault.getAbstractFileByPath(source.vaultPath);
    if (!(file instanceof TFile)) {
      throw new Error(`Selected visual ${source.id} no longer exists in the vault.`);
    }
    prepared.push({
      source: structuredClone(source),
      media: {
        bytes: await app.vault.readBinary(file),
        mimeType: source.mimeType,
      },
    });
  }
  return prepared;
}

function requestKey(
  request: SavedSetGenerationRequestV1,
  context: SavedSetPayloadContextV1,
): string {
  return JSON.stringify({
    bankPath: request.bankPath,
    bankId: request.bank.bankId,
    revision: request.bank.revision,
    targetSet: request.targetSet,
    addingSet: request.addingSet,
    targetAspectIds: request.targetAspectIds,
    payloadHash: practiceSetPayloadHash(context.payload),
  });
}

function neutralFilename(index: number, mimeType: string): string {
  const extension = mimeType === "image/jpeg" ? "jpg"
    : mimeType === "image/webp" ? "webp"
      : mimeType === "image/gif" ? "gif" : "png";
  return `media-${String(index + 1).padStart(3, "0")}.${extension}`;
}
