import { Platform, TFile, type App } from "obsidian";

import type { CliProviderLayer } from "./cli";
import type {
  CliActivityEvent,
  DurableProcessHandle,
  MediaInput,
} from "./cli/contracts";
import { formatCliErrorForUi } from "./cli/errors";
import type { PracticeBankRepository } from "./bank-repository";
import {
  GENERATION_BATCH_RECOVERY_FILENAME,
  completeGenerationBatchSet,
  createGenerationBatchRecovery,
  failGenerationBatchSet,
  nextGenerationBatchSet,
  parseGenerationBatchRecovery,
  retryGenerationBatchSet,
  serializeGenerationBatchRecovery,
  startGenerationBatchSet,
  type GenerationBatchRecoveryV1,
} from "./generation-batch-recovery";
import {
  appendGenerationHistoryBatch,
  emptyGenerationHistory,
  parseGenerationHistoryMarkdown,
  type GenerationHistoryEntryDraftV2,
} from "./generation-history";
import {
  LEARNING_PATH_PROMPT_VERSION,
  asLearningBlueprintDraft,
  asPracticeSetDraft,
  buildLearningBlueprintPrompt,
  buildPracticeSetPrompt,
  createPracticeSetPayloads,
  learningBlueprintDraftV1JsonSchema,
  practiceSetDraftV1JsonSchema,
  practiceSetPayloadHash,
  validateLearningBlueprintDraft,
  validatePracticeSetBatch,
  validatePracticeSetDraftForWorkspace,
  type LearningBlueprintDraftV1,
  type LearningBlueprintPlanningInputV1,
  type LearningPathSourceV1,
  type PracticeSetConfigurationV1,
  type PracticeSetDraftV1,
  type PracticeSetPayloadV1,
} from "./learning-path-generation";
import { reconcileLearningWorkspaceDrafts } from "./learning-path-reconciliation";
import {
  CURRENT_PRACTICE_BANK_SCHEMA_VERSION,
  type LearningPathStepV1,
  type PracticeBankV3,
  type PracticeSetV1,
  type SourceMaterialV1,
  type VisualSourceV1,
} from "./model";
import {
  generationRecipeCatalogFromLegacy,
  parseGenerationRecipeCatalogMarkdown,
  parseGenerationRecipeMarkdown,
  setGenerationRecipeForSet,
  type GenerationRecipeCatalogV1,
  type GenerationRecipeV2,
} from "./regeneration";
import { validatePracticeBank } from "./schema";
import {
  createApprovedSourceBundle,
  type ApprovedSourceBundleV1,
} from "./source-bundle";
import type { CollectedSource } from "./source";
import { snapshotSourcePresentation } from "./source-presentation";
import { applyDraftEdits, presentExercises } from "./ui/presenters";
import type {
  GeneratedLearningSetPresentationV1,
  LearningBlueprintConfigurationV1,
  LearningBlueprintPresentationV1,
  LearningPathSaveRequestV1,
  LearningPayloadPreviewV1,
  LearningPathRecoveredBatchV1,
  LearningSetGenerationStatusV1,
  LearningSetPayloadPreviewV1,
} from "./ui/learning-path-view";
import type { ProviderPresentation, SourcePresentation } from "./ui/contracts";
import {
  prepareSelectedVisuals,
  type PreparedVisual,
} from "./visual-preparation";

const LEARNING_BATCH_CONTEXT_FILENAME = "learning-path-context.json";
const LEARNING_BATCH_CONTEXT_VERSION = 1 as const;

interface PendingBlueprintV1 {
  readonly primaryPresentation: SourcePresentation;
  readonly supportingPresentations: readonly SourcePresentation[];
  readonly bundle: ApprovedSourceBundleV1;
  readonly preparedVisuals: readonly PreparedVisual[];
  readonly planningInput: LearningBlueprintPlanningInputV1;
  readonly configuration: LearningBlueprintConfigurationV1;
  readonly prompt: string;
}

interface GeneratedSetAuditV1 {
  readonly setId: string;
  readonly jobId: string;
  readonly generatedAt: string;
  readonly attempts: 1 | 2;
  readonly draftCount: number;
}

interface PendingBatchV1 {
  readonly batchId: string;
  readonly blueprint: LearningBlueprintPresentationV1;
  readonly configurations: readonly PracticeSetConfigurationV1[];
  readonly payloads: readonly PracticeSetPayloadV1[];
  recovery: GenerationBatchRecoveryV1;
  audits: GeneratedSetAuditV1[];
  generated: PracticeSetDraftV1[];
}

interface PersistedLearningBatchContextV1 {
  readonly schemaVersion: typeof LEARNING_BATCH_CONTEXT_VERSION;
  readonly primaryPresentation: SourcePresentation;
  readonly supportingPresentations: readonly SourcePresentation[];
  readonly primary: PersistedCollectedSourceV1;
  readonly supporting: readonly PersistedCollectedSourceV1[];
  readonly materials: readonly SourceMaterialV1[];
  readonly combined: PersistedCollectedSourceV1;
  readonly preparedVisuals: readonly VisualSourceV1[];
  readonly blueprint: LearningBlueprintPresentationV1;
  readonly configurations: readonly PracticeSetConfigurationV1[];
}

type PersistedCollectedSourceV1 = Omit<CollectedSource, "file" | "visuals"> & {
  readonly visuals: CollectedSource["visuals"];
};

export interface LearningPathControllerOptions {
  readonly app: App;
  readonly repository: PracticeBankRepository;
  readonly ensureCliLayer: () => Promise<CliProviderLayer>;
  readonly providers: () => readonly ProviderPresentation[];
  readonly timeoutMs: () => number;
  readonly setRecoveryHandle: (
    handle: DurableProcessHandle | undefined,
  ) => Promise<void>;
}

export class LearningPathController {
  private readonly sources = new Map<string, CollectedSource>();
  private pendingBlueprint: PendingBlueprintV1 | undefined;
  private pendingBatch: PendingBatchV1 | undefined;
  private recoveryHandle: DurableProcessHandle | undefined;
  private cliLayer: CliProviderLayer | undefined;

  constructor(private readonly options: LearningPathControllerOptions) {}

  public registerSource(source: CollectedSource): SourcePresentation {
    this.sources.set(sourceKey(source), source);
    return source;
  }

  public setRecoveryHandle(handle: DurableProcessHandle | undefined): void {
    this.recoveryHandle = handle;
  }

  public get hasRecoverableBatch(): boolean {
    return this.recoveryHandle !== undefined;
  }

  public cancel(): void {
    this.options.ensureCliLayer().then((layer) => {
      layer.coordinator.cancel();
    }).catch(() => undefined);
  }

  /**
   * Stop polling the currently active durable guided-set job without killing its
   * helper process. Completed, failed, queued, and merely discoverable recovery
   * work is deliberately left alone.
   */
  public detachActive(): boolean {
    const active = this.pendingBatch?.recovery.active;
    const recoveryHandle = this.recoveryHandle;
    if (
      active === undefined
      || recoveryHandle === undefined
      || active.handle.jobId !== recoveryHandle.jobId
      || active.handle.workspacePath !== recoveryHandle.workspacePath
    ) return false;
    return this.cliLayer?.coordinator.detach(active.handle.jobId) ?? false;
  }

  public async previewBlueprint(
    primaryPresentation: SourcePresentation,
    supportingPresentations: readonly SourcePresentation[],
    configuration: LearningBlueprintConfigurationV1,
  ): Promise<LearningPayloadPreviewV1> {
    this.assertDesktop();
    if (this.recoveryHandle !== undefined) {
      throw new Error("A recoverable guided-path batch already exists. Resume or discard it before approving another path.");
    }
    const pending = await this.prepareBlueprint(
      primaryPresentation,
      supportingPresentations,
      configuration,
    );
    this.pendingBlueprint = pending;
    const provider = this.provider(configuration.provider);
    const cli = await import("./cli");
    const filenames = pending.preparedVisuals.map((visual, index) => (
      neutralFilename(index, visual.source.mimeType)
    ));
    return {
      providerLabel: provider.label,
      modelLabel: configuration.model.length === 0 ? "Automatic" : configuration.model,
      reasoningEffortLabel: configuration.reasoningEffort,
      text: cli.appendNeutralMediaManifest(pending.prompt, filenames),
      visualNames: pending.preparedVisuals.map((visual) => visual.source.altText ?? visual.source.id),
      warning: pending.preparedVisuals.length === 0
        ? "No visual bytes are included in this planning call."
        : `${pending.preparedVisuals.length} approved visual ${pending.preparedVisuals.length === 1 ? "copy is" : "copies are"} included under neutral filenames.`,
    };
  }

  public async generateBlueprint(
    primaryPresentation: SourcePresentation,
    supportingPresentations: readonly SourcePresentation[],
    configuration: LearningBlueprintConfigurationV1,
    onActivity: (event: CliActivityEvent) => void,
  ): Promise<LearningBlueprintPresentationV1> {
    this.assertDesktop();
    const pending = this.pendingBlueprint;
    if (
      pending === undefined
      || sourceKey(pending.primaryPresentation) !== sourceKey(primaryPresentation)
      || JSON.stringify(pending.supportingPresentations.map(sourceKey))
        !== JSON.stringify(supportingPresentations.map(sourceKey))
      || JSON.stringify(pending.configuration) !== JSON.stringify(configuration)
    ) {
      throw new Error("The approved planning payload changed. Preview and approve it again.");
    }
    const layer = await this.options.ensureCliLayer();
    const provider = this.provider(configuration.provider);
    const adapter = layer.adapters[configuration.provider];
    if (!provider.available) throw new Error(`${provider.label} is unavailable. ${provider.detail ?? "Check its executable setting."}`);
    if (
      pending.preparedVisuals.length > 0
      && adapter.capabilities().vision !== "supported"
    ) {
      throw new Error(`${provider.label} cannot inspect the selected visuals. Choose a vision-capable provider or remove visual-only scope.`);
    }
    const result = await layer.coordinator.generate(adapter, {
      prompt: pending.prompt,
      schema: learningBlueprintDraftV1JsonSchema,
      validate: (value) => validateLearningBlueprintDraft(value, pending.planningInput),
      ...(configuration.model.length === 0 ? {} : { model: configuration.model }),
      reasoningEffort: configuration.reasoningEffort,
      media: pending.preparedVisuals.map((visual) => visual.media),
      timeoutMs: this.options.timeoutMs(),
      onActivity,
    }, {
      id: `learning-blueprint-${crypto.randomUUID()}`,
      kind: "generation",
      provider: configuration.provider,
    });
    return {
      draft: asLearningBlueprintDraft(result.value, pending.planningInput),
      planningInput: structuredClone(pending.planningInput),
    };
  }

  public async previewSetPayloads(
    blueprint: LearningBlueprintPresentationV1,
    configurations: readonly PracticeSetConfigurationV1[],
  ): Promise<readonly LearningSetPayloadPreviewV1[]> {
    const pendingBlueprint = this.pendingBlueprint;
    if (pendingBlueprint === undefined) throw new Error("The approved source bundle is no longer available.");
    const batchId = `batch-${crypto.randomUUID()}`;
    const payloads = createPracticeSetPayloads({
      batchId,
      planningInput: blueprint.planningInput,
      blueprint: blueprint.draft,
      setConfigurations: configurations,
    });
    this.pendingBatch = {
      batchId,
      blueprint: structuredClone(blueprint),
      configurations: structuredClone(configurations),
      payloads,
      recovery: createGenerationBatchRecovery({
        batchId,
        blueprintId: blueprint.draft.blueprintId,
        createdAt: new Date().toISOString(),
        payloads,
      }),
      audits: [],
      generated: [],
    };
    return payloads.map((payload) => {
      const provider = this.provider(payload.configuration.provider);
      return {
        setId: payload.targetSet.id,
        setTitle: payload.targetSet.title,
        providerLabel: provider.label,
        modelLabel: payload.configuration.model.length === 0 ? "Automatic" : payload.configuration.model,
        reasoningEffortLabel: payload.configuration.reasoningEffort,
        payloadHash: practiceSetPayloadHash(payload),
        text: buildPracticeSetPrompt(payload),
      };
    });
  }

  public async generateAllSets(
    blueprint: LearningBlueprintPresentationV1,
    configurations: readonly PracticeSetConfigurationV1[],
    onStatus: (setId: string, status: LearningSetGenerationStatusV1) => void,
    onActivity: (setId: string, event: CliActivityEvent) => void,
  ): Promise<readonly GeneratedLearningSetPresentationV1[]> {
    this.assertDesktop();
    const pending = this.pendingBatch;
    if (pending === undefined) throw new Error("Preview and approve every set payload before generation.");
    const recomputed = createPracticeSetPayloads({
      batchId: pending.batchId,
      planningInput: blueprint.planningInput,
      blueprint: blueprint.draft,
      setConfigurations: configurations,
    });
    if (
      JSON.stringify(recomputed.map(practiceSetPayloadHash))
      !== JSON.stringify(pending.payloads.map(practiceSetPayloadHash))
    ) throw new Error("A set payload changed after approval. Preview the complete batch again.");

    for (const entry of pending.recovery.queue) {
      if (entry.status === "completed") onStatus(entry.setId, { state: "review" });
      else onStatus(entry.setId, { state: "queued" });
    }
    await this.runPendingBatch(pending, onStatus, onActivity);
    return this.presentGeneratedSets(pending.generated);
  }

  public async inspectRecoverableBatch(): Promise<LearningPathRecoveredBatchV1> {
    this.assertDesktop();
    await this.restorePendingBatchFromRecovery();
    return this.presentRecoveredBatch();
  }

  public async resumeRecoverableBatch(
    onStatus: (setId: string, status: LearningSetGenerationStatusV1) => void,
    onActivity: (setId: string, event: CliActivityEvent) => void,
  ): Promise<LearningPathRecoveredBatchV1> {
    this.assertDesktop();
    await this.restorePendingBatchFromRecovery();
    const pending = this.pendingBatch;
    if (pending === undefined) throw new Error("There is no recoverable guided-path batch.");
    for (const entry of recoveryStatuses(pending.recovery)) onStatus(entry.setId, entry.status);
    await this.runPendingBatch(pending, onStatus, onActivity, true);
    return this.presentRecoveredBatch();
  }

  private async restorePendingBatchFromRecovery(): Promise<void> {
    const handle = this.recoveryHandle;
    if (handle === undefined) throw new Error("There is no recoverable guided-path batch.");
    const cli = await import("./cli");
    const recovery = parseGenerationBatchRecovery(
      await cli.readDurableRecoveryText(handle, GENERATION_BATCH_RECOVERY_FILENAME),
    );
    const context = parsePersistedContext(
      await cli.readDurableRecoveryText(handle, LEARNING_BATCH_CONTEXT_FILENAME),
      this.options.app,
    );
    const pendingBlueprint: PendingBlueprintV1 = {
      primaryPresentation: context.primaryPresentation,
      supportingPresentations: context.supportingPresentations,
      bundle: context.bundle,
      preparedVisuals: await preparedVisualsFromSources(this.options.app, context.preparedVisuals),
      planningInput: context.blueprint.planningInput,
      configuration: {
        provider: context.configurations[0]?.configuration.provider ?? "codex",
        model: context.configurations[0]?.configuration.model ?? "",
        reasoningEffort: context.configurations[0]?.configuration.reasoningEffort ?? "medium",
        startingLevel: context.blueprint.planningInput.startingLevel,
        desiredSetCount: context.blueprint.draft.sets.length,
        globalFocusInstructions: context.blueprint.planningInput.globalFocusInstructions,
      },
      prompt: buildLearningBlueprintPrompt(context.blueprint.planningInput),
    };
    this.pendingBlueprint = pendingBlueprint;
    this.pendingBatch = {
      batchId: recovery.batchId,
      blueprint: context.blueprint,
      configurations: context.configurations,
      payloads: recovery.approvedPayloads.map((entry) => entry.payload),
      recovery,
      audits: recovery.completedDrafts.map((entry) => ({
        setId: entry.setId,
        jobId: `recovered-${entry.setId}`,
        generatedAt: entry.completedAt,
        attempts: entry.attempts,
        draftCount: entry.draft.exercises.length,
      })),
      generated: recovery.completedDrafts.map((entry) => entry.draft),
    };
  }

  private presentRecoveredBatch(): LearningPathRecoveredBatchV1 {
    const pendingBlueprint = this.pendingBlueprint;
    const pendingBatch = this.pendingBatch;
    if (pendingBlueprint === undefined || pendingBatch === undefined) {
      throw new Error("There is no recovered guided-path workspace to present.");
    }
    return {
      primary: pendingBlueprint.primaryPresentation,
      supporting: pendingBlueprint.supportingPresentations,
      blueprint: pendingBatch.blueprint,
      configurations: pendingBatch.configurations,
      generated: this.presentGeneratedSets(pendingBatch.generated),
      statuses: recoveryStatuses(pendingBatch.recovery),
    };
  }

  public async discardRecoverableBatch(): Promise<void> {
    const handle = this.recoveryHandle;
    if (handle === undefined) return;
    const cli = await import("./cli");
    await cli.cancelDurableRecovery(handle).catch(() => undefined);
    await cli.removeDurableRecovery(handle);
    this.recoveryHandle = undefined;
    this.pendingBatch = undefined;
    await this.options.setRecoveryHandle(undefined);
  }

  public async saveLearningPath(
    request: LearningPathSaveRequestV1,
  ): Promise<{
    readonly path: string;
    readonly bank: PracticeBankV3;
    readonly reconciledLinkCount: number;
  }> {
    const pendingBlueprint = this.pendingBlueprint;
    const pendingBatch = this.pendingBatch;
    if (pendingBlueprint === undefined || pendingBatch === undefined) {
      throw new Error("The approved learning-path generation context is no longer available.");
    }
    if (
      request.blueprint.blueprintId !== pendingBatch.blueprint.draft.blueprintId
      || request.sets.length !== pendingBatch.generated.length
    ) throw new Error("The reviewed sets no longer match the approved batch.");

    const draftsBySet = new Map(pendingBatch.generated.map((draft) => [draft.setId, draft]));
    const reviewedBySet = new Map(request.sets.map((set) => [set.setId, set]));
    const finalDrafts: PracticeSetDraftV1[] = [];
    for (const payload of pendingBatch.payloads) {
      const original = draftsBySet.get(payload.targetSet.id);
      const reviewed = reviewedBySet.get(payload.targetSet.id);
      if (original === undefined || reviewed === undefined) {
        throw new Error(`Reviewed batch is missing set ${payload.targetSet.id}.`);
      }
      const approved = new Set(reviewed.approvedExerciseIds);
      const kept = reviewed.exercises.filter((exercise) => !exercise.rejected);
      if (kept.some((exercise) => !approved.has(exercise.id))) {
        throw new Error(`Set ${payload.targetSet.title} contains an unapproved exercise.`);
      }
      const exercises = applyDraftEdits(original.exercises, reviewed.exercises);
      const keptIds = new Set(exercises.map((exercise) => exercise.id));
      const tutorLessons = original.tutorLessons.filter((lesson) => {
        if (keptIds.has(lesson.guidedExerciseId)) return true;
        throw new Error(`Tutor lesson ${lesson.title} lost its guided exercise. Keep that exercise or remove the lesson in the map.`);
      });
      finalDrafts.push({
        schemaVersion: original.schemaVersion,
        setId: original.setId,
        exercises,
        assignments: original.assignments.filter((assignment) => keptIds.has(assignment.exerciseId)),
        tutorLessons,
      });
    }

    const now = new Date().toISOString();
    const loaded = await this.options.repository.loadForSource(pendingBlueprint.bundle.combined.path);
    const existing = loaded.parsed.status === "ok" ? loaded.parsed.bank : undefined;
    if (loaded.parsed.status !== "ok" && loaded.parsed.status !== "missing") {
      throw new Error(loaded.parsed.recoveryMessage);
    }
    const reconciliation = reconcileLearningWorkspaceDrafts(request.blueprint, finalDrafts);
    const workspaceDrafts = reconciliation.drafts;
    const practiceSets = buildPracticeSets(request.blueprint, workspaceDrafts);
    const tutorLessons = workspaceDrafts.flatMap((draft) => draft.tutorLessons.map((lesson) => structuredClone(lesson)));
    const steps = buildLearningPathSteps(request.blueprint, practiceSets);
    const preparedIds = new Set(pendingBlueprint.preparedVisuals.map((visual) => visual.source.id));
    const sourceMaterials = pendingBlueprint.bundle.materials.map((material) => ({
      ...structuredClone(material),
      visualIds: material.visualIds.filter((id) => preparedIds.has(id)),
    }));
    const primaryMaterial = sourceMaterials.find((material) => material.role === "primary");
    if (primaryMaterial === undefined) throw new Error("The approved bundle has no primary source material.");
    const finalConfiguration = request.configurations.at(-1)?.configuration;
    const bank: PracticeBankV3 = {
      schemaVersion: CURRENT_PRACTICE_BANK_SCHEMA_VERSION,
      bankId: existing?.bankId ?? `bank-${crypto.randomUUID()}`,
      revision: existing === undefined ? 0 : existing.revision + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      source: {
        vaultPath: primaryMaterial.vaultPath,
        wikilink: primaryMaterial.wikilink,
        title: sourceMaterials.length === 1
          ? primaryMaterial.title
          : pendingBlueprint.bundle.combined.title,
        scope: primaryMaterial.scope.kind === "pdf-pages"
          ? "selection"
          : primaryMaterial.scope.kind,
        hash: sourceMaterials.length === 1
          ? primaryMaterial.sourceHash
          : pendingBlueprint.bundle.bundleHash,
      },
      segments: pendingBlueprint.bundle.combined.segments.map((segment) => structuredClone(segment)),
      visuals: pendingBlueprint.preparedVisuals.map((visual) => structuredClone(visual.source)),
      exercises: workspaceDrafts.flatMap((draft) => draft.exercises.map((exercise) => structuredClone(exercise))),
      sessions: existing?.sessions.map((session) => structuredClone(session)) ?? [],
      generation: {
        provider: finalConfiguration?.provider ?? "codex",
        generatedAt: now,
        promptVersion: LEARNING_PATH_PROMPT_VERSION,
        ...(finalConfiguration === undefined
          ? {}
          : { reasoningEffort: finalConfiguration.reasoningEffort }),
      },
      sourceMaterials,
      aspects: reconciliation.aspects.map((aspect) => structuredClone(aspect)),
      practiceSets,
      tutorLessons,
      learningPath: {
        id: request.blueprint.blueprintId,
        title: request.blueprint.title,
        startingLevel: request.planningInput.startingLevel,
        aspectIds: request.blueprint.aspects
          .filter((aspect) => aspect.status === "supported")
          .map((aspect) => aspect.id),
        steps,
      },
    };
    const validation = validatePracticeBank(bank);
    if (!validation.ok) {
      throw new Error(`Cannot save an invalid learning workspace: ${validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
    }

    const sidecars = await this.buildSidecars(
      loaded.file,
      bank,
      request.configurations,
      workspaceDrafts,
    );
    const saved = await this.options.repository.saveLearningWorkspace({
      bank,
      ...(existing === undefined ? {} : { expectedRevision: existing.revision }),
      generationRecipe: sidecars.legacyRecipe,
      generationRecipeCatalog: sidecars.catalog,
      generationHistory: sidecars.history,
      ...(pendingBlueprint.bundle.primary.sourceImport === undefined
        ? {}
        : { sourceImport: pendingBlueprint.bundle.primary.sourceImport }),
    });
    await this.clearRecoveryAfterSave();
    return {
      ...saved,
      reconciledLinkCount: reconciliation.reconciledLinkCount,
    };
  }

  private async prepareBlueprint(
    primaryPresentation: SourcePresentation,
    supportingPresentations: readonly SourcePresentation[],
    configuration: LearningBlueprintConfigurationV1,
  ): Promise<PendingBlueprintV1> {
    const primary = this.resolveSource(primaryPresentation);
    const supporting = supportingPresentations.map((source) => this.resolveSource(source));
    const bundle = createApprovedSourceBundle(primary, supporting);
    const preparedVisuals = await prepareSelectedVisuals(
      this.options.app,
      bundle.combined.visuals,
    );
    const adapter = (await this.options.ensureCliLayer()).adapters[configuration.provider];
    const includeVisuals = adapter.capabilities().vision === "supported";
    const sources = learningSources(bundle, includeVisuals ? preparedVisuals : []);
    const planningInput: LearningBlueprintPlanningInputV1 = {
      startingLevel: configuration.startingLevel,
      desiredSetCount: configuration.desiredSetCount,
      globalFocusInstructions: configuration.globalFocusInstructions,
      sources,
    };
    return {
      primaryPresentation: snapshotSourcePresentation(primaryPresentation),
      supportingPresentations: supportingPresentations.map(snapshotSourcePresentation),
      bundle,
      preparedVisuals: includeVisuals ? preparedVisuals : [],
      planningInput,
      configuration: structuredClone(configuration),
      prompt: buildLearningBlueprintPrompt(planningInput),
    };
  }

  private async runPendingBatch(
    pending: PendingBatchV1,
    onStatus: (setId: string, status: LearningSetGenerationStatusV1) => void,
    onActivity: (setId: string, event: CliActivityEvent) => void,
    resuming = false,
  ): Promise<void> {
    const layer = await this.options.ensureCliLayer();
    this.cliLayer = layer;
    while (true) {
      if (pending.recovery.active !== undefined && resuming) {
        const resumedHandle = pending.recovery.active.handle;
        const resumedJobId = resumedHandle.jobId;
        const approved = pending.recovery.approvedPayloads[pending.recovery.queuePosition];
        if (approved === undefined) break;
        const setId = approved.setId;
        onStatus(setId, { state: "generating", message: "Reattaching to the existing local agent…" });
        const adapter = layer.adapters[approved.payload.configuration.provider];
        try {
          const result = await layer.coordinator.generate(adapter, {
            prompt: buildPracticeSetPrompt(approved.payload),
            schema: practiceSetDraftV1JsonSchema,
            validate: (value) => validatePracticeSetDraftForWorkspace(value, approved.payload),
            recovery: { mode: "resume", handle: resumedHandle },
            timeoutMs: this.options.timeoutMs(),
            onActivity: (event) => onActivity(setId, event),
          }, {
            id: resumedJobId,
            kind: "generation",
            provider: approved.payload.configuration.provider,
          });
          const draft = asPracticeSetDraft(result.value, approved.payload);
          pending.recovery = completeGenerationBatchSet(pending.recovery, {
            setId,
            draft,
            attempts: result.attempts,
            completedAt: new Date().toISOString(),
          });
          pending.generated = replaceDraft(pending.generated, draft);
          pending.audits = replaceAudit(pending.audits, {
            setId,
            jobId: resumedJobId,
            generatedAt: new Date().toISOString(),
            attempts: result.attempts,
            draftCount: draft.exercises.length,
          });
          await this.persistBatchRecovery(pending.recovery, this.recoveryHandle);
          onStatus(setId, { state: "review" });
          resuming = false;
          continue;
        } catch (error) {
          if (cliErrorCode(error) === "detached") throw error;
          await this.failActiveSet(pending, setId, error);
          onStatus(setId, { state: "failed", message: errorMessage(error) });
          break;
        }
      }

      let approved = nextGenerationBatchSet(pending.recovery);
      if (approved === undefined) break;
      const queueEntry = pending.recovery.queue[pending.recovery.queuePosition];
      if (queueEntry?.status === "failed") {
        pending.recovery = retryGenerationBatchSet(
          pending.recovery,
          approved.setId,
          new Date().toISOString(),
        );
        approved = nextGenerationBatchSet(pending.recovery);
        if (approved === undefined) break;
      }
      const payload = approved.payload;
      const provider = this.provider(payload.configuration.provider);
      const adapter = layer.adapters[payload.configuration.provider];
      if (!provider.available) {
        onStatus(approved.setId, { state: "failed", message: `${provider.label} is unavailable.` });
        break;
      }
      const media = this.mediaForConfiguration(payload.configuration.selectedVisualIds);
      if (media.length > 0 && adapter.capabilities().vision !== "supported") {
        onStatus(approved.setId, { state: "failed", message: `${provider.label} is not vision-capable. Provider switching is never automatic.` });
        break;
      }
      const setId = approved.setId;
      const jobId = `learning-set-${crypto.randomUUID()}`;
      const previousHandle = this.recoveryHandle;
      onStatus(setId, { state: "generating" });
      try {
        const result = await layer.coordinator.generate(adapter, {
          prompt: buildPracticeSetPrompt(payload),
          schema: practiceSetDraftV1JsonSchema,
          validate: (value) => validatePracticeSetDraftForWorkspace(value, payload),
          ...(payload.configuration.model.length === 0 ? {} : { model: payload.configuration.model }),
          reasoningEffort: payload.configuration.reasoningEffort,
          media,
          timeoutMs: this.options.timeoutMs(),
          onActivity: (event) => onActivity(setId, event),
          recovery: {
            mode: "start",
            jobId,
            context: JSON.stringify({
              kind: "guided-learning-set",
              batchId: pending.batchId,
              blueprintId: pending.blueprint.draft.blueprintId,
              setId,
              payloadHash: approved.payloadHash,
            }),
            onReady: async (handle) => {
              pending.recovery = startGenerationBatchSet(
                pending.recovery,
                setId,
                handle,
                new Date().toISOString(),
              );
              await this.persistBatchRecovery(pending.recovery, handle);
              await this.persistBatchContext(handle);
              this.recoveryHandle = handle;
              await this.options.setRecoveryHandle(handle);
            },
          },
        }, {
          id: jobId,
          kind: "generation",
          provider: payload.configuration.provider,
        });
        onStatus(setId, { state: "validating" });
        const draft = asPracticeSetDraft(result.value, payload);
        const generatedAt = new Date().toISOString();
        pending.recovery = completeGenerationBatchSet(pending.recovery, {
          setId,
          draft,
          attempts: result.attempts,
          completedAt: generatedAt,
        });
        pending.generated = replaceDraft(pending.generated, draft);
        pending.audits = replaceAudit(pending.audits, {
          setId,
          jobId,
          generatedAt,
          attempts: result.attempts,
          draftCount: draft.exercises.length,
        });
        await this.persistBatchRecovery(pending.recovery, this.recoveryHandle);
        if (previousHandle !== undefined && previousHandle.workspacePath !== this.recoveryHandle?.workspacePath) {
          const cli = await import("./cli");
          await cli.removeDurableRecovery(previousHandle).catch(() => undefined);
        }
        onStatus(setId, { state: "review" });
      } catch (error) {
        if (cliErrorCode(error) === "detached") throw error;
        await this.failActiveSet(pending, setId, error, previousHandle);
        onStatus(setId, { state: "failed", message: errorMessage(error) });
        break;
      }
    }
    const validation = validatePracticeSetBatch({
      payloads: pending.payloads,
      drafts: pending.generated,
    });
    if (pending.generated.length === pending.payloads.length && !validation.valid) {
      throw new Error(validation.errors?.join("; ") ?? "The generated batch is invalid.");
    }
  }

  private async failActiveSet(
    pending: PendingBatchV1,
    setId: string,
    error: unknown,
    previousHandle?: DurableProcessHandle,
  ): Promise<void> {
    if (pending.recovery.active?.setId === setId) {
      pending.recovery = failGenerationBatchSet(pending.recovery, {
        setId,
        message: errorMessage(error),
        failedAt: new Date().toISOString(),
      });
    }
    const target = this.recoveryHandle ?? previousHandle;
    if (target !== undefined) {
      try {
        await this.persistBatchRecovery(pending.recovery, target);
        this.recoveryHandle = target;
        await this.options.setRecoveryHandle(target);
      } catch {
        if (previousHandle !== undefined) {
          this.recoveryHandle = previousHandle;
          await this.options.setRecoveryHandle(previousHandle);
        }
      }
    }
  }

  private presentGeneratedSets(
    drafts: readonly PracticeSetDraftV1[],
  ): GeneratedLearningSetPresentationV1[] {
    const pending = this.pendingBlueprint;
    if (pending === undefined) throw new Error("The source presentation is unavailable.");
    const visualUrls = new Map(pending.preparedVisuals.map((visual) => [
      visual.source.id,
      this.options.app.vault.adapter.getResourcePath(visual.source.vaultPath),
    ]));
    return drafts.map((draft) => ({
      setId: draft.setId,
      draft: structuredClone(draft),
      exercises: presentExercises(
        draft.exercises,
        (id) => visualUrls.get(id),
        pending.bundle.combined.segments,
      ).map((exercise) => ({
        ...structuredClone(exercise),
        rejected: false,
        occlusionReviewed: exercise.type !== "image-occlusion",
      })),
    }));
  }

  private mediaForConfiguration(selectedVisualIds: readonly string[]): MediaInput[] {
    const prepared = this.pendingBlueprint?.preparedVisuals ?? [];
    const selected = new Set(selectedVisualIds);
    return prepared.filter((visual) => selected.has(visual.source.id)).map((visual) => visual.media);
  }

  private async persistBatchRecovery(
    recovery: GenerationBatchRecoveryV1,
    handle: DurableProcessHandle | undefined,
  ): Promise<void> {
    if (handle === undefined) return;
    const cli = await import("./cli");
    await cli.writeDurableRecoveryText(
      handle,
      GENERATION_BATCH_RECOVERY_FILENAME,
      serializeGenerationBatchRecovery(recovery),
    );
  }

  private async persistBatchContext(handle: DurableProcessHandle): Promise<void> {
    const pending = this.pendingBlueprint;
    const batch = this.pendingBatch;
    if (pending === undefined || batch === undefined) return;
    const context: PersistedLearningBatchContextV1 = {
      schemaVersion: LEARNING_BATCH_CONTEXT_VERSION,
      primaryPresentation: snapshotSourcePresentation(pending.primaryPresentation),
      supportingPresentations: pending.supportingPresentations.map(snapshotSourcePresentation),
      primary: persistCollectedSource(pending.bundle.primary),
      supporting: pending.bundle.supporting.map(persistCollectedSource),
      materials: pending.bundle.materials,
      combined: persistCollectedSource(pending.bundle.combined),
      preparedVisuals: pending.preparedVisuals.map((visual) => visual.source),
      blueprint: batch.blueprint,
      configurations: batch.configurations,
    };
    const cli = await import("./cli");
    await cli.writeDurableRecoveryText(
      handle,
      LEARNING_BATCH_CONTEXT_FILENAME,
      JSON.stringify(context),
    );
  }

  private async buildSidecars(
    file: TFile | null,
    bank: PracticeBankV3,
    configurations: readonly PracticeSetConfigurationV1[],
    drafts: readonly PracticeSetDraftV1[],
  ): Promise<{
    readonly catalog: GenerationRecipeCatalogV1;
    readonly legacyRecipe: GenerationRecipeV2;
    readonly history: ReturnType<typeof emptyGenerationHistory>;
  }> {
    const pendingBlueprint = this.pendingBlueprint;
    const pendingBatch = this.pendingBatch;
    const firstConfiguration = configurations[0];
    if (
      pendingBlueprint === undefined
      || pendingBatch === undefined
      || firstConfiguration === undefined
    ) {
      throw new Error("Generation provenance is unavailable for this learning path.");
    }
    const markdown = file === null ? "" : await this.options.app.vault.cachedRead(file);
    const catalogResult = parseGenerationRecipeCatalogMarkdown(markdown);
    if (catalogResult.status === "invalid") throw new Error(catalogResult.message);
    const loadedCatalog = catalogResult.status === "ok"
      ? catalogResult.catalog
      : generationRecipeCatalogFromLegacy(
        firstConfiguration.setId,
        parseGenerationRecipeMarkdown(markdown),
      );
    const liveSetIds = new Set(bank.practiceSets.map((set) => set.id));
    let catalog: GenerationRecipeCatalogV1 = {
      schemaVersion: loadedCatalog.schemaVersion,
      recipesBySetId: Object.fromEntries(
        Object.entries(loadedCatalog.recipesBySetId)
          .filter(([setId]) => liveSetIds.has(setId)),
      ),
    };
    for (const entry of configurations) {
      catalog = setGenerationRecipeForSet(
        catalog,
        entry.setId,
        entry.configuration,
        pendingBlueprint.bundle.bundleHash,
      );
    }
    const legacyRecipe = catalog.recipesBySetId[firstConfiguration.setId];
    if (legacyRecipe === undefined) throw new Error("The set-scoped generation recipe catalog is empty.");
    const parsedHistory = parseGenerationHistoryMarkdown(markdown);
    if (parsedHistory.status === "invalid") throw new Error(parsedHistory.message);
    const history = parsedHistory.status === "ok" ? parsedHistory.history : emptyGenerationHistory();
    const targetRevision = bank.revision;
    const configurationById = new Map(configurations.map((entry) => [entry.setId, entry.configuration]));
    const auditById = new Map(pendingBatch.audits.map((entry) => [entry.setId, entry]));
    const entries: GenerationHistoryEntryDraftV2[] = drafts.map((draft) => {
      const configuration = configurationById.get(draft.setId);
      const audit = auditById.get(draft.setId);
      if (configuration === undefined || audit === undefined) throw new Error(`Generation provenance is missing for ${draft.setId}.`);
      const provider = this.provider(configuration.provider);
      return {
        id: audit.jobId,
        generatedAt: audit.generatedAt,
        provider: configuration.provider,
        ...(provider.version === undefined ? {} : { providerVersion: provider.version }),
        model: configuration.model,
        reasoningEffort: configuration.reasoningEffort,
        promptVersion: LEARNING_PATH_PROMPT_VERSION,
        sourceHash: bank.source.hash,
        sourceScope: pendingBlueprint.bundle.combined.mode,
        requestedQuantity: configuration.quantity,
        draftExerciseCount: audit.draftCount,
        savedExerciseCount: draft.exercises.length,
        difficulty: configuration.difficulty,
        focusInstructions: configuration.focusInstructions,
        exerciseTypePercentages: { ...configuration.exerciseTypePercentages },
        selectedVisualCount: configuration.selectedVisualIds.length,
        attempts: audit.attempts,
        batchId: pendingBatch.batchId,
        blueprintId: pendingBatch.blueprint.draft.blueprintId,
        setId: draft.setId,
      };
    });
    return {
      catalog,
      legacyRecipe,
      history: appendGenerationHistoryBatch(history, entries, targetRevision),
    };
  }

  private resolveSource(source: SourcePresentation): CollectedSource {
    const exact = this.sources.get(sourceKey(source));
    if (exact !== undefined) return exact;
    const candidate = [...this.sources.values()].find((entry) => (
      entry.path === source.path && entry.mode === source.mode && entry.title === source.title
    ));
    if (candidate === undefined) throw new Error("The selected source is no longer available. Choose it again.");
    return candidate;
  }

  private provider(id: ProviderPresentation["id"]): ProviderPresentation {
    const provider = this.options.providers().find((entry) => entry.id === id);
    if (provider === undefined) throw new Error(`Provider ${id} is not configured.`);
    return provider;
  }

  private assertDesktop(): void {
    if (Platform.isMobileApp) throw new Error("Guided learning-path generation is available on desktop only. Saved paths work on mobile.");
  }

  private async clearRecoveryAfterSave(): Promise<void> {
    const handle = this.recoveryHandle;
    if (handle !== undefined) {
      const cli = await import("./cli");
      await cli.removeDurableRecovery(handle);
    }
    this.recoveryHandle = undefined;
    this.pendingBatch = undefined;
    await this.options.setRecoveryHandle(undefined);
  }
}

function learningSources(
  bundle: ApprovedSourceBundleV1,
  visuals: readonly PreparedVisual[],
): LearningPathSourceV1[] {
  const visualById = new Map(visuals.map((visual) => [visual.source.id, visual.source]));
  return [bundle.primary, ...bundle.supporting].map((source, index) => {
    const material = bundle.materials[index];
    if (material === undefined) throw new Error("Source-material ownership is incomplete.");
    return {
      id: material.id,
      role: material.role,
      title: source.title,
      mode: source.mode,
      scope: scopeLabel(material),
      hash: source.hash,
      segments: source.segments.map((segment) => structuredClone(segment)),
      visuals: material.visualIds.flatMap((id) => {
        const visual = visualById.get(id);
        return visual === undefined ? [] : [{
          id: visual.id,
          kind: visual.kind,
          width: visual.width,
          height: visual.height,
          ...(visual.altText === undefined ? {} : { altText: visual.altText }),
        }];
      }),
    };
  });
}

function scopeLabel(material: SourceMaterialV1): string {
  if (material.scope.kind === "note") return "complete explicitly selected note";
  if (material.scope.kind === "selection") return "explicit note selection only";
  return material.scope.firstPage === material.scope.lastPage
    ? `PDF page ${material.scope.firstPage} of ${material.scope.pageCount}`
    : `PDF pages ${material.scope.firstPage}-${material.scope.lastPage} of ${material.scope.pageCount}`;
}

function buildPracticeSets(
  blueprint: LearningBlueprintDraftV1,
  drafts: readonly PracticeSetDraftV1[],
): PracticeSetV1[] {
  const draftById = new Map(drafts.map((draft) => [draft.setId, draft]));
  return [...blueprint.sets]
    .sort((left, right) => left.order - right.order)
    .map((brief, order) => {
      const draft = draftById.get(brief.id);
      if (draft === undefined) throw new Error(`Missing final draft for ${brief.title}.`);
      return {
        id: brief.id,
        title: brief.title,
        purpose: brief.purpose,
        instructionalRole: brief.instructionalRole,
        order,
        assignments: draft.assignments.map((assignment) => structuredClone(assignment)),
      };
    });
}

function buildLearningPathSteps(
  blueprint: LearningBlueprintDraftV1,
  sets: readonly PracticeSetV1[],
): LearningPathStepV1[] {
  const briefById = new Map(blueprint.sets.map((set) => [set.id, set]));
  const steps: LearningPathStepV1[] = [];
  for (const set of [...sets].sort((left, right) => left.order - right.order)) {
    const brief = briefById.get(set.id);
    for (const lessonId of brief?.tutorLessonBriefIds ?? []) {
      steps.push({ kind: "lesson", lessonId, order: steps.length });
    }
    steps.push({ kind: "practice-set", setId: set.id, order: steps.length });
  }
  return steps;
}

function sourceKey(source: SourcePresentation): string {
  return JSON.stringify([
    source.mode,
    source.path,
    source.title,
    source.characterCount,
    source.detail ?? "",
    source.excerpt,
  ]);
}

function neutralFilename(index: number, mimeType: string): string {
  const extension = mimeType === "image/jpeg" ? "jpg"
    : mimeType === "image/webp" ? "webp"
      : mimeType === "image/gif" ? "gif" : "png";
  return `media-${String(index + 1).padStart(3, "0")}.${extension}`;
}

function replaceDraft(
  drafts: readonly PracticeSetDraftV1[],
  replacement: PracticeSetDraftV1,
): PracticeSetDraftV1[] {
  return [
    ...drafts.filter((draft) => draft.setId !== replacement.setId),
    structuredClone(replacement),
  ];
}

function replaceAudit(
  audits: readonly GeneratedSetAuditV1[],
  replacement: GeneratedSetAuditV1,
): GeneratedSetAuditV1[] {
  return [...audits.filter((audit) => audit.setId !== replacement.setId), replacement];
}

function persistCollectedSource(source: CollectedSource): PersistedCollectedSourceV1 {
  const { file: _file, ...persisted } = source;
  void _file;
  return structuredClone(persisted);
}

function parsePersistedContext(
  serialized: string,
  app: App,
): {
  readonly primaryPresentation: SourcePresentation;
  readonly supportingPresentations: readonly SourcePresentation[];
  readonly bundle: ApprovedSourceBundleV1;
  readonly preparedVisuals: readonly VisualSourceV1[];
  readonly blueprint: LearningBlueprintPresentationV1;
  readonly configurations: readonly PracticeSetConfigurationV1[];
} {
  const value = JSON.parse(serialized) as PersistedLearningBatchContextV1;
  if (value.schemaVersion !== LEARNING_BATCH_CONTEXT_VERSION) {
    throw new Error("The recovered guided-path context uses an unsupported version.");
  }
  const restore = (
    source: PersistedCollectedSourceV1,
    label: string,
  ): CollectedSource => {
    const file = app.vault.getAbstractFileByPath(source.path);
    if (!(file instanceof TFile)) {
      throw new Error(`The recovered ${label} source no longer exists as a file in the vault.`);
    }
    return {
      ...structuredClone(source),
      file,
    };
  };
  const primary = restore(value.primary, "primary");
  const supporting = value.supporting.map((source, index) => (
    restore(source, `supporting source ${index + 1}`)
  ));
  return {
    primaryPresentation: value.primaryPresentation,
    supportingPresentations: value.supportingPresentations,
    preparedVisuals: value.preparedVisuals,
    blueprint: value.blueprint,
    configurations: value.configurations,
    bundle: {
      primary,
      supporting,
      materials: value.materials,
      combined: restore(value.combined, "combined primary"),
      bundleHash: value.combined.hash,
    },
  };
}

async function preparedVisualsFromSources(
  app: App,
  sources: readonly VisualSourceV1[],
): Promise<PreparedVisual[]> {
  const prepared: PreparedVisual[] = [];
  for (const source of sources) {
    const file = app.vault.getAbstractFileByPath(source.vaultPath);
    if (!(file instanceof TFile)) {
      throw new Error(`The recovered visual ${source.id} no longer exists as a file in the vault.`);
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

function recoveryStatuses(
  recovery: GenerationBatchRecoveryV1,
): LearningPathRecoveredBatchV1["statuses"] {
  return recovery.queue.map((entry) => {
    let status: LearningSetGenerationStatusV1;
    if (entry.status === "completed") {
      status = { state: "review" };
    } else if (entry.status === "running") {
      status = { state: "generating", message: "The local agent can be reattached when you resume." };
    } else if (entry.status === "failed") {
      status = {
        state: "failed",
        message: entry.lastError ?? "Generation stopped before completing this set.",
      };
    } else if (entry.status === "cancelled") {
      status = { state: "failed", message: "Generation was cancelled before completing this set." };
    } else {
      status = { state: "queued" };
    }
    return { setId: entry.setId, status };
  });
}

function errorMessage(error: unknown): string {
  return formatCliErrorForUi(error, "The guided generation step failed.");
}

function cliErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}
