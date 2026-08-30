import { Platform, TFile, type App } from "obsidian";

import type { CliProviderLayer } from "./cli";
import type {
  CliActivityEvent,
  DurableProcessHandle,
  MediaInput,
} from "./cli/contracts";
import { formatCliErrorForUi } from "./cli/errors";
import type { LoadedPracticeBank, PracticeBankRepository } from "./bank-repository";
import {
  GENERATION_BATCH_RECOVERY_FILENAME,
  completeGenerationBatchSet,
  completedUnsavedBatchDrafts,
  createGenerationBatchRecovery,
  failGenerationBatchSet,
  generationBatchIsFinished,
  markGenerationBatchSetSaved,
  nextGenerationBatchSet,
  parseGenerationBatchRecovery,
  retryGenerationBatchSet,
  saveGenerationBatchReviewSnapshot,
  serializeGenerationBatchRecovery,
  startGenerationBatchSet,
  type GenerationBatchRecoveryV1,
  type PracticeSetReviewSnapshotV1,
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
  PRACTICE_SET_DRAFT_VERSION,
  validateLearningBlueprintDraft,
  validatePracticeSetBatch,
  validatePracticeSetDraftWithCompletedSiblings,
  type LearningBlueprintDraftV1,
  type LearningBlueprintPlanningInputV1,
  type LearningPathSourceV1,
  type PracticeSetConfigurationV1,
  type PracticeSetDraftV1,
  type PracticeSetPayloadV1,
} from "./learning-path-generation";
import { reconcileLearningWorkspaceDrafts } from "./learning-path-reconciliation";
import { learningPathSaveRequestHash } from "./learning-path-save";
import {
  CURRENT_PRACTICE_BANK_SCHEMA_VERSION,
  type LearningPathStepV1,
  type PracticeBankV4,
  type PracticeSetV1,
  type SourceAlignmentDraftV1,
  type SourceAlignmentLedgerV1,
  type SourceMaterialClassificationV1,
  type SourceMaterialV2,
  type VisualSourceV1,
} from "./model";
import type { PdfSourceBudgetLimitsV1 } from "./pdf-source-budget";
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
  sourceBundleProblem,
  type ApprovedSourceBundleV1,
} from "./source-bundle";
import type { CollectedSource } from "./source";
import {
  confirmSourceClassification as confirmCollectedSourceClassification,
} from "./source";
import { snapshotSourcePresentation } from "./source-presentation";
import {
  SOURCE_ALIGNMENT_PROMPT_VERSION,
  asSourceAlignmentDraft,
  buildSourceAlignmentPrompt,
  createUnverifiedSourceAlignmentLedger,
  finalizeSourceAlignmentLedger,
  isStructuralSourceSegment,
  linkSourceAlignmentTargets,
  sourceAlignmentBlockers,
  sourceAlignmentDraftV1JsonSchema,
  sourceAlignmentInputHash,
  validateSourceAlignmentDraft,
  type SourceAlignmentGenerationInputV1,
} from "./source-alignment-generation";
import {
  invalidateStaleSourceAlignment,
  isConfirmedSchoolMaterial,
} from "./source-alignment";
import {
  SOURCE_ALIGNMENT_RECOVERY_CONTEXT_FILENAME,
  SOURCE_ALIGNMENT_RECOVERY_RESULT_FILENAME,
  createSourceAlignmentRecoveryContext,
  createSourceAlignmentRecoveryResult,
  parseSourceAlignmentRecoveryContext,
  parseSourceAlignmentRecoveryResult,
} from "./source-alignment-recovery";
import { effectiveAiContextCompletionPolicy } from "./ai-context-completion";
import type { GenerationTelemetryV1 } from "./generation-telemetry";
import { applyDraftEdits, presentExercises } from "./ui/presenters";
import type {
  GeneratedLearningSetPresentationV1,
  LearningBlueprintConfigurationV1,
  LearningBlueprintPresentationV1,
  LearningPathSaveRequestV1,
  LearningPayloadPreviewV1,
  LearningPathRecoveredBatchV1,
  LearningPathPreflightResultV1,
  LearningSetGenerationStatusV1,
  LearningSetPayloadPreviewV1,
  LearningSetReviewV1,
} from "./ui/learning-path-view";
import type { ProviderPresentation, SourcePresentation } from "./ui/contracts";
import {
  prepareSelectedVisuals,
  type PreparedVisual,
} from "./visual-preparation";

const LEARNING_BATCH_CONTEXT_FILENAME = "learning-path-context.json";
const LEARNING_BATCH_CONTEXT_VERSION = 1 as const;
const SOURCE_ALIGNMENT_WORKSPACE_FILENAME = "source-alignment-workspace.json";
const SOURCE_ALIGNMENT_WORKSPACE_VERSION = 1 as const;

export type LearningPathRecoveryKindV1 = "source-alignment" | "generation-batch";

export interface SourceAlignmentPreviewV1 {
  readonly providerLabel: string;
  readonly modelLabel: string;
  readonly reasoningEffortLabel: string;
  readonly inputHash: string;
  readonly text: string;
  readonly requiresProvider: boolean;
  readonly warning: string;
}

export interface SourceAlignmentResultPresentationV1 {
  readonly ledger: SourceAlignmentLedgerV1;
  readonly blockerRecordIds: readonly string[];
  readonly checked: boolean;
}

interface PendingBlueprintV1 {
  readonly primaryPresentation: SourcePresentation;
  readonly supportingPresentations: readonly SourcePresentation[];
  readonly bundle: ApprovedSourceBundleV1;
  readonly preparedVisuals: readonly PreparedVisual[];
  readonly planningInput: LearningBlueprintPlanningInputV1;
  readonly configuration: LearningBlueprintConfigurationV1;
  readonly prompt: string;
  readonly sourceAlignment: SourceAlignmentLedgerV1;
}

interface PendingSourceAlignmentV1 {
  readonly primaryPresentation: SourcePresentation;
  readonly supportingPresentations: readonly SourcePresentation[];
  readonly bundle: ApprovedSourceBundleV1;
  readonly input: SourceAlignmentGenerationInputV1;
  readonly inputHash: string;
  readonly configuration: LearningBlueprintConfigurationV1;
  readonly prompt: string;
  ledger?: SourceAlignmentLedgerV1;
}

interface GeneratedSetAuditV1 {
  readonly setId: string;
  readonly jobId: string;
  readonly generatedAt: string;
  readonly attempts: 1 | 2;
  readonly draftCount: number;
  readonly telemetry?: GenerationTelemetryV1;
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

interface LearningPathSaveCandidateV1 {
  readonly bank: PracticeBankV4;
  readonly existing?: PracticeBankV4;
  readonly loaded: LoadedPracticeBank;
  readonly pendingBatch: PendingBatchV1;
  readonly pendingBlueprint: PendingBlueprintV1;
  readonly previouslySaved: ReadonlySet<string>;
  readonly reconciliation: ReturnType<typeof reconcileLearningWorkspaceDrafts>;
  readonly reviewedSetIds: readonly string[];
  readonly savedConfigurations: readonly PracticeSetConfigurationV1[];
  readonly workspaceDrafts: readonly PracticeSetDraftV1[];
}

interface PersistedLearningBatchContextV1 {
  readonly schemaVersion: typeof LEARNING_BATCH_CONTEXT_VERSION;
  readonly primaryPresentation: SourcePresentation;
  readonly supportingPresentations: readonly SourcePresentation[];
  readonly primary: PersistedCollectedSourceV1;
  readonly supporting: readonly PersistedCollectedSourceV1[];
  readonly materials: readonly SourceMaterialV2[];
  readonly combined: PersistedCollectedSourceV1;
  readonly preparedVisuals: readonly VisualSourceV1[];
  readonly blueprint: LearningBlueprintPresentationV1;
  readonly configurations: readonly PracticeSetConfigurationV1[];
}

interface PersistedSourceAlignmentWorkspaceV1 {
  readonly schemaVersion: typeof SOURCE_ALIGNMENT_WORKSPACE_VERSION;
  readonly primaryPresentation: SourcePresentation;
  readonly supportingPresentations: readonly SourcePresentation[];
  readonly primary: PersistedCollectedSourceV1;
  readonly supporting: readonly PersistedCollectedSourceV1[];
  readonly materials: readonly SourceMaterialV2[];
  readonly combined: PersistedCollectedSourceV1;
  readonly configuration: LearningBlueprintConfigurationV1;
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
  readonly pdfSourceBudgetLimits: () => PdfSourceBudgetLimitsV1;
  readonly setRecoveryHandle: (
    handle: DurableProcessHandle | undefined,
  ) => Promise<void>;
}

export class LearningPathController {
  private readonly sources = new Map<string, CollectedSource>();
  private pendingBlueprint: PendingBlueprintV1 | undefined;
  private pendingAlignment: PendingSourceAlignmentV1 | undefined;
  private pendingBatch: PendingBatchV1 | undefined;
  private recoveryHandle: DurableProcessHandle | undefined;
  private recoveryKind: LearningPathRecoveryKindV1 | undefined;
  private cliLayer: CliProviderLayer | undefined;

  constructor(private readonly options: LearningPathControllerOptions) {}

  public registerSource(source: CollectedSource): SourcePresentation {
    this.sources.set(sourceKey(source), source);
    return source;
  }

  public confirmSourceClassification(
    source: SourcePresentation,
    classification: SourceMaterialClassificationV1,
  ): SourcePresentation {
    const collected = this.resolveSource(source);
    this.sources.delete(sourceKey(collected));
    const confirmed = confirmCollectedSourceClassification(collected, classification);
    this.sources.set(sourceKey(confirmed), confirmed);
    this.pendingAlignment = undefined;
    this.pendingBlueprint = undefined;
    this.pendingBatch = undefined;
    return snapshotSourcePresentation(confirmed);
  }

  public confirmSourceClassifications(
    updates: readonly {
      readonly source: SourcePresentation;
      readonly classification: SourceMaterialClassificationV1;
    }[],
  ): readonly SourcePresentation[] {
    const resolved = updates.map(({ source, classification }) => ({
      original: this.resolveSource(source),
      classification,
    }));
    const originalKeys = resolved.map(({ original }) => sourceKey(original));
    if (new Set(originalKeys).size !== originalKeys.length) {
      throw new Error("Each approved source can be classified only once per update.");
    }
    const confirmed = resolved.map(({ original, classification }) => (
      confirmCollectedSourceClassification(original, classification)
    ));
    for (const key of originalKeys) this.sources.delete(key);
    for (const source of confirmed) this.sources.set(sourceKey(source), source);
    this.pendingAlignment = undefined;
    this.pendingBlueprint = undefined;
    this.pendingBatch = undefined;
    return confirmed.map(snapshotSourcePresentation);
  }

  public setRecoveryHandle(handle: DurableProcessHandle | undefined): void {
    this.recoveryHandle = handle;
    this.recoveryKind = undefined;
  }

  public get hasRecoverableBatch(): boolean {
    return this.recoveryHandle !== undefined;
  }

  public async inspectRecoveryKind(): Promise<LearningPathRecoveryKindV1 | null> {
    if (this.recoveryHandle === undefined) return null;
    if (this.recoveryKind !== undefined) return this.recoveryKind;
    const cli = await import("./cli");
    try {
      parseGenerationBatchRecovery(await cli.readDurableRecoveryText(
        this.recoveryHandle,
        GENERATION_BATCH_RECOVERY_FILENAME,
      ));
      this.recoveryKind = "generation-batch";
      return this.recoveryKind;
    } catch {
      try {
        parseSourceAlignmentRecoveryContext(await cli.readDurableRecoveryText(
          this.recoveryHandle,
          SOURCE_ALIGNMENT_RECOVERY_CONTEXT_FILENAME,
        ));
        this.recoveryKind = "source-alignment";
        return this.recoveryKind;
      } catch {
        throw new Error("The recoverable Practice Problem Generator job has no recognized alignment or generation context.");
      }
    }
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
    if (
      this.recoveryKind === "source-alignment"
      && this.recoveryHandle !== undefined
    ) {
      return this.cliLayer?.coordinator.detach(this.recoveryHandle.jobId) ?? false;
    }
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

  public async previewSourceAlignment(
    primaryPresentation: SourcePresentation,
    supportingPresentations: readonly SourcePresentation[],
    configuration: LearningBlueprintConfigurationV1,
  ): Promise<SourceAlignmentPreviewV1> {
    this.assertDesktop();
    if (this.recoveryHandle !== undefined) {
      const kind = await this.inspectRecoveryKind();
      throw new Error(kind === "source-alignment"
        ? "A recoverable course-alignment check already exists. Resume or discard it before checking another source bundle."
        : "A recoverable guided-path batch already exists. Resume or discard it before checking another source bundle.");
    }
    const previousLedger = this.pendingAlignment?.ledger;
    const pending = this.prepareSourceAlignment(
      primaryPresentation,
      supportingPresentations,
      configuration,
    );
    if (previousLedger !== undefined) {
      pending.ledger = invalidateStaleSourceAlignment(
        previousLedger,
        pending.bundle.materials,
      );
    }
    this.pendingAlignment = pending;
    const provider = this.provider(configuration.provider);
    const requiresProvider = alignmentHasConfirmedEvidence(pending.input);
    return {
      providerLabel: provider.label,
      modelLabel: configuration.model.length === 0 ? "Automatic" : configuration.model,
      reasoningEffortLabel: configuration.reasoningEffort,
      inputHash: pending.inputHash,
      text: pending.prompt,
      requiresProvider,
      warning: requiresProvider
        ? "This check compares only the explicitly selected evidence and never treats model knowledge as school authority. School-backed context is used automatically; optional AI-supported context is added only after your aggregated approval."
        : "No confirmed comparable school evidence is available. Your selected material still defines the path; optional AI-supported context is added only after your aggregated approval.",
    };
  }

  public async generateSourceAlignment(
    onActivity: (event: CliActivityEvent) => void,
  ): Promise<SourceAlignmentResultPresentationV1> {
    this.assertDesktop();
    const pending = this.pendingAlignment;
    if (pending === undefined) {
      throw new Error("Preview and approve the course-alignment payload first.");
    }
    if (!alignmentHasConfirmedEvidence(pending.input)) {
      pending.ledger = createUnverifiedSourceAlignmentLedger();
      return alignmentPresentation(pending.ledger, false);
    }
    const layer = await this.options.ensureCliLayer();
    this.cliLayer = layer;
    const provider = this.provider(pending.configuration.provider);
    if (!provider.available) {
      throw new Error(`${provider.label} is unavailable. ${provider.detail ?? "Check its executable setting."}`);
    }
    const adapter = layer.adapters[pending.configuration.provider];
    const jobId = `source-alignment-${crypto.randomUUID()}`;
    const startedAt = new Date().toISOString();
    const result = await layer.coordinator.generate(adapter, {
      prompt: pending.prompt,
      schema: sourceAlignmentDraftV1JsonSchema,
      validate: (value) => validateSourceAlignmentDraft(value, pending.input),
      ...(pending.configuration.model.length === 0
        ? {}
        : { model: pending.configuration.model }),
      reasoningEffort: pending.configuration.reasoningEffort,
      timeoutMs: this.options.timeoutMs(),
      onActivity,
      recovery: {
        mode: "start",
        jobId,
        context: JSON.stringify({
          kind: "source-alignment",
          inputHash: pending.inputHash,
        }),
        onReady: async (handle) => {
          await this.persistSourceAlignmentRecoveryContext(
            handle,
            pending,
            jobId,
            startedAt,
          );
          await this.persistSourceAlignmentWorkspace(handle, pending);
          this.recoveryHandle = handle;
          this.recoveryKind = "source-alignment";
          await this.options.setRecoveryHandle(handle);
        },
      },
    }, {
      id: jobId,
      kind: "generation",
      provider: pending.configuration.provider,
    });
    const draft = asSourceAlignmentDraft(result.value, pending.input);
    const completedAt = new Date().toISOString();
    const ledger = finalizeSourceAlignmentLedger({
      sourceMaterials: pending.input.sourceMaterials,
      segments: pending.input.segments,
      draft,
      provenance: {
        provider: pending.configuration.provider,
        providerVersion: provider.version ?? "unknown",
        model: pending.configuration.model.length === 0
          ? "automatic"
          : pending.configuration.model,
        reasoningEffort: pending.configuration.reasoningEffort,
        promptVersion: SOURCE_ALIGNMENT_PROMPT_VERSION,
        generatedAt: completedAt,
      },
    });
    pending.ledger = ledger;
    if (this.recoveryHandle !== undefined) {
      const cli = await import("./cli");
      await cli.writeDurableRecoveryText(
        this.recoveryHandle,
        SOURCE_ALIGNMENT_RECOVERY_RESULT_FILENAME,
        JSON.stringify(createSourceAlignmentRecoveryResult({
          jobId,
          completedAt,
          attempts: result.attempts,
          draft,
          alignmentInput: pending.input,
        })),
      );
    }
    return alignmentPresentation(ledger, true);
  }

  public async resumeRecoverableSourceAlignment(
    onActivity: (event: CliActivityEvent) => void,
  ): Promise<SourceAlignmentResultPresentationV1> {
    this.assertDesktop();
    const handle = this.recoveryHandle;
    if (handle === undefined || await this.inspectRecoveryKind() !== "source-alignment") {
      throw new Error("There is no recoverable course-alignment job.");
    }
    const pending = await this.restorePendingSourceAlignment(handle);
    this.pendingAlignment = pending;
    const cli = await import("./cli");
    let recoveredDraft: SourceAlignmentDraftV1 | undefined;
    let completedAt = new Date().toISOString();
    let attempts: 1 | 2 = 1;
    try {
      const recovered = parseSourceAlignmentRecoveryResult(
        await cli.readDurableRecoveryText(handle, SOURCE_ALIGNMENT_RECOVERY_RESULT_FILENAME),
        pending.input,
      );
      recoveredDraft = recovered.draft;
      completedAt = recovered.completedAt;
      attempts = recovered.attempts;
    } catch (error) {
      if (!isMissingRecoveryFile(error)) throw error;
      // The durable provider may still be running or may have completed before
      // the local result checkpoint was written. Reattach to that exact job.
    }
    if (recoveredDraft === undefined) {
      const layer = await this.options.ensureCliLayer();
      this.cliLayer = layer;
      const adapter = layer.adapters[pending.configuration.provider];
      const result = await layer.coordinator.generate(adapter, {
        prompt: pending.prompt,
        schema: sourceAlignmentDraftV1JsonSchema,
        validate: (value) => validateSourceAlignmentDraft(value, pending.input),
        recovery: { mode: "resume", handle },
        timeoutMs: this.options.timeoutMs(),
        onActivity,
      }, {
        id: handle.jobId,
        kind: "generation",
        provider: pending.configuration.provider,
      });
      recoveredDraft = asSourceAlignmentDraft(result.value, pending.input);
      attempts = result.attempts;
      completedAt = new Date().toISOString();
    }
    const provider = this.provider(pending.configuration.provider);
    const ledger = finalizeSourceAlignmentLedger({
      sourceMaterials: pending.input.sourceMaterials,
      segments: pending.input.segments,
      draft: recoveredDraft,
      provenance: {
        provider: pending.configuration.provider,
        providerVersion: provider.version ?? "unknown",
        model: pending.configuration.model.length === 0
          ? "automatic"
          : pending.configuration.model,
        reasoningEffort: pending.configuration.reasoningEffort,
        promptVersion: SOURCE_ALIGNMENT_PROMPT_VERSION,
        generatedAt: completedAt,
      },
    });
    pending.ledger = ledger;
    await cli.writeDurableRecoveryText(
      handle,
      SOURCE_ALIGNMENT_RECOVERY_RESULT_FILENAME,
      JSON.stringify(createSourceAlignmentRecoveryResult({
        jobId: handle.jobId,
        completedAt,
        attempts,
        draft: recoveredDraft,
        alignmentInput: pending.input,
      })),
    );
    return alignmentPresentation(ledger, true);
  }

  public async resumeRecoverableSourceAlignmentWorkspace(
    onActivity: (event: CliActivityEvent) => void,
  ): Promise<{
    readonly primary: SourcePresentation;
    readonly supporting: readonly SourcePresentation[];
    readonly result: SourceAlignmentResultPresentationV1;
  }> {
    const result = await this.resumeRecoverableSourceAlignment(onActivity);
    const pending = this.pendingAlignment;
    if (pending === undefined) {
      throw new Error("The recovered course-alignment source bundle is unavailable.");
    }
    return {
      primary: snapshotSourcePresentation(pending.primaryPresentation),
      supporting: pending.supportingPresentations.map(snapshotSourcePresentation),
      result,
    };
  }

  public approveSourceAlignment(ledger: SourceAlignmentLedgerV1): SourceAlignmentResultPresentationV1 {
    const pending = this.pendingAlignment;
    if (pending === undefined || ledger.provenance === null) {
      throw new Error("There is no generated course-alignment result to approve.");
    }
    const draft: SourceAlignmentDraftV1 = {
      schemaVersion: 1,
      records: ledger.records.map(({ sourceHashes: _sourceHashes, ...record }) => {
        void _sourceHashes;
        return structuredClone(record);
      }),
    };
    const checked = finalizeSourceAlignmentLedger({
      sourceMaterials: pending.input.sourceMaterials,
      segments: pending.input.segments,
      draft,
      provenance: {
        provider: ledger.provenance.provider,
        providerVersion: ledger.provenance.providerVersion,
        model: ledger.provenance.model,
        reasoningEffort: ledger.provenance.reasoningEffort,
        promptVersion: ledger.provenance.promptVersion,
        generatedAt: ledger.provenance.generatedAt,
      },
    });
    pending.ledger = checked;
    return alignmentPresentation(checked, true);
  }

  public continueWithoutCourseAlignment(): SourceAlignmentResultPresentationV1 {
    const pending = this.pendingAlignment;
    if (pending === undefined) {
      throw new Error("Preview the source bundle before choosing an unverified fallback.");
    }
    if (pending.ledger?.records.some((record) => (
      record.status === "school-sources-disagree"
      && record.resolution !== "excluded"
    ))) {
      throw new Error("Conflicting school sources must be resolved or excluded; they cannot be silently downgraded to unverified notes.");
    }
    pending.ledger = createUnverifiedSourceAlignmentLedger();
    return alignmentPresentation(pending.ledger, false);
  }

  public async previewBlueprint(
    primaryPresentation: SourcePresentation,
    supportingPresentations: readonly SourcePresentation[],
    configuration: LearningBlueprintConfigurationV1,
  ): Promise<LearningPayloadPreviewV1> {
    this.assertDesktop();
    if (this.recoveryHandle !== undefined) {
      const kind = await this.inspectRecoveryKind();
      if (kind !== "source-alignment") {
        throw new Error("A recoverable guided-path batch already exists. Resume or discard it before approving another path.");
      }
      if (this.pendingAlignment?.ledger === undefined) {
        throw new Error("The course-alignment check has not finished. Resume it or explicitly discard it before previewing the path.");
      }
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
    this.assertPendingPdfBudget(pending);
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
    this.assertPendingPdfBudget(pendingBlueprint);
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
    if (this.recoveryHandle !== undefined) {
      await this.persistBatchRecovery(
        this.pendingBatch.recovery,
        this.recoveryHandle,
      );
      await this.persistBatchContext(this.recoveryHandle);
      this.recoveryKind = "generation-batch";
    }
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
    const pendingBlueprint = this.pendingBlueprint;
    if (pendingBlueprint === undefined) throw new Error("The approved source bundle is no longer available.");
    this.assertPendingPdfBudget(pendingBlueprint);
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
    if (await this.inspectRecoveryKind() !== "generation-batch") {
      throw new Error("The recoverable job is a source-alignment check. Resume that check before opening the generated-set review.");
    }
    await this.restorePendingBatchFromRecovery();
    return this.presentRecoveredBatch();
  }

  public async resumeRecoverableBatch(
    onStatus: (setId: string, status: LearningSetGenerationStatusV1) => void,
    onActivity: (setId: string, event: CliActivityEvent) => void,
  ): Promise<LearningPathRecoveredBatchV1> {
    this.assertDesktop();
    if (await this.inspectRecoveryKind() !== "generation-batch") {
      throw new Error("The recoverable job is a source-alignment check, not a generated-set batch.");
    }
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
        aiContextCompletionPolicy: effectiveAiContextCompletionPolicy(
          context.blueprint.planningInput.aiContextCompletionPolicy,
        ),
      },
      prompt: buildLearningBlueprintPrompt(context.blueprint.planningInput),
      sourceAlignment: structuredClone(
        context.blueprint.planningInput.sourceAlignment
          ?? createUnverifiedSourceAlignmentLedger(),
      ),
    };
    this.pendingBlueprint = pendingBlueprint;
    this.recoveryKind = "generation-batch";
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
        ...(entry.telemetry === undefined ? {} : { telemetry: entry.telemetry }),
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

  public async persistReviewSnapshots(
    sets: readonly LearningSetReviewV1[],
  ): Promise<void> {
    const pending = this.pendingBatch;
    const handle = this.recoveryHandle;
    if (pending === undefined || handle === undefined) {
      throw new Error("The durable guided-path review workspace is no longer available.");
    }
    let recovery = pending.recovery;
    const updatedAt = new Date().toISOString();
    for (const set of sets) {
      const completed = recovery.completedDrafts.find((entry) => entry.setId === set.setId);
      if (completed === undefined) {
        throw new Error(`Set ${set.setId} has not completed generation.`);
      }
      const snapshot: PracticeSetReviewSnapshotV1 = {
        setId: set.setId,
        payloadHash: completed.payloadHash,
        updatedAt,
        exercises: set.exercises.map((exercise) => ({
          id: exercise.id,
          type: exercise.type,
          prompt: exercise.prompt,
          groundedAnswer: exercise.groundedAnswer,
          rejected: exercise.rejected,
          occlusionReviewed: exercise.occlusionReviewed,
          ...(exercise.type === "image-occlusion"
            ? { masks: structuredClone(exercise.masks ?? []) }
            : {}),
        })),
        approvedExerciseIds: [...set.approvedExerciseIds],
      };
      recovery = saveGenerationBatchReviewSnapshot(recovery, snapshot);
    }
    pending.recovery = recovery;
    await this.persistBatchRecovery(recovery, handle);
  }

  public async discardRecoverableBatch(): Promise<void> {
    const handle = this.recoveryHandle;
    if (handle === undefined) return;
    const cli = await import("./cli");
    await cli.cancelDurableRecovery(handle).catch(() => undefined);
    await cli.removeDurableRecovery(handle);
    this.recoveryHandle = undefined;
    this.recoveryKind = undefined;
    this.pendingAlignment = undefined;
    this.pendingBatch = undefined;
    await this.options.setRecoveryHandle(undefined);
  }

  public async saveLearningPath(
    request: LearningPathSaveRequestV1,
  ): Promise<{
    readonly path: string;
    readonly bank: PracticeBankV4;
    readonly reconciledLinkCount: number;
    readonly reconciledTutorBlockOrderCount: number;
    readonly batchComplete: boolean;
  }> {
    const candidate = await this.buildLearningPathSaveCandidate(request);
    const {
      bank,
      existing,
      loaded,
      pendingBatch,
      pendingBlueprint,
      previouslySaved,
      reconciliation,
      reviewedSetIds,
      savedConfigurations,
      workspaceDrafts,
    } = candidate;

    const sidecars = await this.buildSidecars(
      loaded.file,
      bank,
      savedConfigurations,
      workspaceDrafts,
    );
    const batchWasFinished = generationBatchIsFinished(pendingBatch.recovery);
    if (!batchWasFinished && this.recoveryHandle === undefined) {
      throw new Error("The unfinished batch no longer has a durable recovery workspace. Resume or regenerate it before saving completed sets.");
    }
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
    for (const setId of reviewedSetIds) {
      if (previouslySaved.has(setId)) continue;
      pendingBatch.recovery = markGenerationBatchSetSaved(
        pendingBatch.recovery,
        setId,
        new Date().toISOString(),
      );
    }
    const batchComplete = generationBatchIsFinished(pendingBatch.recovery)
      && completedUnsavedBatchDrafts(pendingBatch.recovery).length === 0;
    if (batchComplete) {
      await this.clearRecoveryAfterSave();
    } else {
      await this.persistBatchRecovery(pendingBatch.recovery, this.recoveryHandle);
      if (this.recoveryHandle !== undefined) {
        this.recoveryKind = "generation-batch";
        await this.options.setRecoveryHandle(this.recoveryHandle);
      }
    }
    return {
      ...saved,
      reconciledLinkCount: reconciliation.reconciledLinkCount,
      reconciledTutorBlockOrderCount: reconciliation.reconciledTutorBlockOrderCount,
      batchComplete,
    };
  }

  public async preflightLearningPath(
    request: LearningPathSaveRequestV1,
  ): Promise<LearningPathPreflightResultV1> {
    await this.buildLearningPathSaveCandidate(request);
    return {
      requestHash: learningPathSaveRequestHash(request),
      valid: true,
    };
  }

  private async buildLearningPathSaveCandidate(
    request: LearningPathSaveRequestV1,
  ): Promise<LearningPathSaveCandidateV1> {
    const pendingBlueprint = this.pendingBlueprint;
    const pendingBatch = this.pendingBatch;
    if (pendingBlueprint === undefined || pendingBatch === undefined) {
      throw new Error("The approved learning-path generation context is no longer available.");
    }
    if (request.blueprint.blueprintId !== pendingBatch.blueprint.draft.blueprintId) {
      throw new Error("The reviewed sets no longer match the approved batch.");
    }
    const reviewedSetIds = request.sets.map((set) => set.setId);
    if (reviewedSetIds.length === 0 || new Set(reviewedSetIds).size !== reviewedSetIds.length) {
      throw new Error("Choose at least one distinct completed set before saving.");
    }
    const generatedSetIds = new Set(pendingBatch.generated.map((draft) => draft.setId));
    if (reviewedSetIds.some((setId) => !generatedSetIds.has(setId))) {
      throw new Error("The reviewed sets include a set that has not completed generation.");
    }

    const loaded = await this.options.repository.loadForSource(
      pendingBlueprint.bundle.combined.path,
    );
    const existing = loaded.parsed.status === "ok" ? loaded.parsed.bank : undefined;
    if (loaded.parsed.status !== "ok" && loaded.parsed.status !== "missing") {
      throw new Error(loaded.parsed.recoveryMessage);
    }

    const draftsBySet = new Map(pendingBatch.generated.map((draft) => [draft.setId, draft]));
    const reviewedBySet = new Map(request.sets.map((set) => [set.setId, set]));
    const previouslySaved = new Set(pendingBatch.recovery.savedSetIds);
    const finalDrafts: PracticeSetDraftV1[] = [];
    for (const payload of pendingBatch.payloads) {
      const original = draftsBySet.get(payload.targetSet.id);
      const reviewed = reviewedBySet.get(payload.targetSet.id);
      if (previouslySaved.has(payload.targetSet.id)) {
        if (existing === undefined) {
          throw new Error(`Previously saved set ${payload.targetSet.title} is missing from its Practice workspace.`);
        }
        const savedDraft = practiceSetDraftFromBank(existing, payload.targetSet.id);
        if (savedDraft === null) {
          throw new Error(`Previously saved set ${payload.targetSet.title} is incomplete in its Practice workspace.`);
        }
        finalDrafts.push(savedDraft);
        continue;
      }
      if (original === undefined || reviewed === undefined) continue;
      const approved = new Set(reviewed.approvedExerciseIds);
      const kept = reviewed.exercises.filter((exercise) => !exercise.rejected);
      if (kept.some((exercise) => !approved.has(exercise.id))) {
        throw new Error(`Set ${payload.targetSet.title} contains an unapproved exercise.`);
      }
      const requiredExerciseIds = new Set(
        original.tutorLessons.map((lesson) => lesson.guidedExerciseId),
      );
      const rejectedRequired = reviewed.exercises.find((exercise) => (
        exercise.rejected && requiredExerciseIds.has(exercise.id)
      ));
      if (rejectedRequired !== undefined) {
        throw new Error(
          `Set ${payload.targetSet.title} rejects guided exercise ${rejectedRequired.id}. Keep it or change the approved path plan first.`,
        );
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
    if (finalDrafts.length === 0) {
      throw new Error("No completed reviewed set is ready to save.");
    }

    const now = new Date().toISOString();
    const includedSetIds = new Set(finalDrafts.map((draft) => draft.setId));
    const includedSets = request.blueprint.sets.filter((set) => includedSetIds.has(set.id));
    const includedLessonIds = new Set(
      includedSets.flatMap((set) => set.tutorLessonBriefIds),
    );
    const includedLessonBriefs = request.blueprint.tutorLessonBriefs.filter((lesson) => (
      includedLessonIds.has(lesson.id)
    ));
    const includedAspectIds = learningPathAspectClosure({
      blueprint: request.blueprint,
      sets: includedSets,
      lessonBriefs: includedLessonBriefs,
      drafts: finalDrafts,
    });
    const savedBlueprint: LearningBlueprintDraftV1 = {
      ...request.blueprint,
      aspects: request.blueprint.aspects.filter((aspect) => includedAspectIds.has(aspect.id)),
      tutorLessonBriefs: includedLessonBriefs,
      sets: includedSets,
    };
    const reconciliation = reconcileLearningWorkspaceDrafts(savedBlueprint, finalDrafts);
    const workspaceDrafts = reconciliation.drafts;
    const practiceSets = buildPracticeSets(savedBlueprint, workspaceDrafts);
    const tutorLessons = workspaceDrafts.flatMap((draft) => (
      draft.tutorLessons.map((lesson) => structuredClone(lesson))
    ));
    const exercises = workspaceDrafts.flatMap((draft) => (
      draft.exercises.map((exercise) => structuredClone(exercise))
    ));
    const steps = buildLearningPathSteps(savedBlueprint, practiceSets);
    const preparedIds = new Set(
      pendingBlueprint.preparedVisuals.map((visual) => visual.source.id),
    );
    const sourceMaterials = pendingBlueprint.bundle.materials.map((material) => ({
      ...structuredClone(material),
      visualIds: material.visualIds.filter((id) => preparedIds.has(id)),
    }));
    const primaryMaterial = sourceMaterials.find((material) => material.role === "primary");
    if (primaryMaterial === undefined) {
      throw new Error("The approved bundle has no primary source material.");
    }
    const savedConfigurations = request.configurations.filter((entry) => (
      includedSetIds.has(entry.setId)
    ));
    const finalConfiguration = savedConfigurations.at(-1)?.configuration;
    const sourceAlignment = linkSourceAlignmentTargets({
      ledger: pendingBlueprint.sourceAlignment,
      exercises,
      tutorLessons,
    });
    const bank: PracticeBankV4 = {
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
      exercises,
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
      sourceAlignment,
      aiContextCompletionPolicy: effectiveAiContextCompletionPolicy(
        request.planningInput.aiContextCompletionPolicy,
      ),
      aspects: reconciliation.aspects.map((aspect) => structuredClone(aspect)),
      practiceSets,
      tutorLessons,
      learningPath: {
        id: savedBlueprint.blueprintId,
        title: savedBlueprint.title,
        startingLevel: request.planningInput.startingLevel,
        aspectIds: reconciliation.aspects
          .filter((aspect) => aspect.status === "supported")
          .map((aspect) => aspect.id),
        steps,
      },
    };
    const validation = validatePracticeBank(bank);
    if (!validation.ok) {
      throw new Error(`Cannot save an invalid learning workspace: ${validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
    }
    return {
      bank,
      ...(existing === undefined ? {} : { existing }),
      loaded,
      pendingBatch,
      pendingBlueprint,
      previouslySaved,
      reconciliation,
      reviewedSetIds,
      savedConfigurations,
      workspaceDrafts,
    };
  }

  private async prepareBlueprint(
    primaryPresentation: SourcePresentation,
    supportingPresentations: readonly SourcePresentation[],
    configuration: LearningBlueprintConfigurationV1,
  ): Promise<PendingBlueprintV1> {
    const primary = this.resolveSource(primaryPresentation);
    const supporting = supportingPresentations.map((source) => this.resolveSource(source));
    const bundle = createApprovedSourceBundle(
      primary,
      supporting,
      this.options.pdfSourceBudgetLimits(),
    );
    const preparedVisuals = await prepareSelectedVisuals(
      this.options.app,
      bundle.combined.visuals,
    );
    const adapter = (await this.options.ensureCliLayer()).adapters[configuration.provider];
    const includeVisuals = adapter.capabilities().vision === "supported";
    const sources = learningSources(bundle, includeVisuals ? preparedVisuals : []);
    const alignmentInput: SourceAlignmentGenerationInputV1 = {
      sourceMaterials: bundle.materials.map((material) => structuredClone(material)),
      segments: bundle.combined.segments.map((segment) => structuredClone(segment)),
    };
    const pendingAlignment = this.pendingAlignment;
    const alignmentMatches = pendingAlignment !== undefined
      && pendingAlignment.inputHash === sourceAlignmentInputHash(alignmentInput);
    if (alignmentMatches && pendingAlignment.ledger === undefined) {
      throw new Error("Run the previewed course-alignment check or explicitly continue without course alignment before building the path.");
    }
    const sourceAlignment = alignmentMatches && pendingAlignment.ledger !== undefined
      ? structuredClone(pendingAlignment.ledger)
      : createUnverifiedSourceAlignmentLedger();
    const blockers = sourceAlignmentBlockers(sourceAlignment);
    if (blockers.length > 0) {
      throw new Error(`Resolve or exclude ${blockers.length} confirmed school-source ${blockers.length === 1 ? "conflict" : "conflicts"} before building the learning path. Other evidence areas do not block the path.`);
    }
    const planningInput: LearningBlueprintPlanningInputV1 = {
      startingLevel: configuration.startingLevel,
      desiredSetCount: configuration.desiredSetCount,
      globalFocusInstructions: configuration.globalFocusInstructions,
      sources,
      sourceAlignment,
      ...(configuration.aiContextCompletionPolicy === undefined
        ? {}
        : { aiContextCompletionPolicy: configuration.aiContextCompletionPolicy }),
    };
    return {
      primaryPresentation: snapshotSourcePresentation(primaryPresentation),
      supportingPresentations: supportingPresentations.map(snapshotSourcePresentation),
      bundle,
      preparedVisuals: includeVisuals ? preparedVisuals : [],
      planningInput,
      configuration: structuredClone(configuration),
      prompt: buildLearningBlueprintPrompt(planningInput),
      sourceAlignment,
    };
  }

  private prepareSourceAlignment(
    primaryPresentation: SourcePresentation,
    supportingPresentations: readonly SourcePresentation[],
    configuration: LearningBlueprintConfigurationV1,
  ): PendingSourceAlignmentV1 {
    const primary = this.resolveSource(primaryPresentation);
    const supporting = supportingPresentations.map((source) => this.resolveSource(source));
    const bundle = createApprovedSourceBundle(
      primary,
      supporting,
      this.options.pdfSourceBudgetLimits(),
    );
    const input: SourceAlignmentGenerationInputV1 = {
      sourceMaterials: bundle.materials.map((material) => structuredClone(material)),
      segments: bundle.combined.segments.map((segment) => structuredClone(segment)),
    };
    return {
      primaryPresentation: snapshotSourcePresentation(primaryPresentation),
      supportingPresentations: supportingPresentations.map(snapshotSourcePresentation),
      bundle,
      input,
      inputHash: sourceAlignmentInputHash(input),
      configuration: structuredClone(configuration),
      prompt: buildSourceAlignmentPrompt(input),
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
            validate: (value) => validatePracticeSetDraftWithCompletedSiblings({
              payload: approved.payload,
              draft: value,
              completedDrafts: pending.generated,
            }),
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
            ...(result.telemetry === undefined ? {} : { telemetry: result.telemetry }),
            completedAt: new Date().toISOString(),
          });
          pending.generated = replaceDraft(pending.generated, draft);
          pending.audits = replaceAudit(pending.audits, {
            setId,
            jobId: resumedJobId,
            generatedAt: new Date().toISOString(),
            attempts: result.attempts,
            draftCount: draft.exercises.length,
            ...(result.telemetry === undefined ? {} : { telemetry: result.telemetry }),
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

      const pendingBlueprint = this.pendingBlueprint;
      if (pendingBlueprint === undefined) {
        throw new Error("The approved source bundle is no longer available.");
      }
      this.assertPendingPdfBudget(pendingBlueprint);
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
          validate: (value) => validatePracticeSetDraftWithCompletedSiblings({
            payload,
            draft: value,
            completedDrafts: pending.generated,
          }),
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
              this.recoveryKind = "generation-batch";
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
          ...(result.telemetry === undefined ? {} : { telemetry: result.telemetry }),
          completedAt: generatedAt,
        });
        pending.generated = replaceDraft(pending.generated, draft);
        pending.audits = replaceAudit(pending.audits, {
          setId,
          jobId,
          generatedAt,
          attempts: result.attempts,
          draftCount: draft.exercises.length,
          ...(result.telemetry === undefined ? {} : { telemetry: result.telemetry }),
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
        this.recoveryKind = "generation-batch";
        await this.options.setRecoveryHandle(target);
      } catch {
        if (previousHandle !== undefined) {
          this.recoveryHandle = previousHandle;
          this.recoveryKind = "generation-batch";
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
    const snapshots = new Map(
      (this.pendingBatch?.recovery.reviewSnapshots ?? []).map((snapshot) => [
        snapshot.setId,
        snapshot,
      ]),
    );
    return drafts.map((draft) => {
      const snapshot = snapshots.get(draft.setId);
      const reviewById = new Map(
        (snapshot?.exercises ?? []).map((exercise) => [exercise.id, exercise]),
      );
      return {
        setId: draft.setId,
        draft: structuredClone(draft),
        exercises: presentExercises(
        draft.exercises,
        (id) => visualUrls.get(id),
        pending.bundle.combined.segments,
      ).map((exercise) => ({
        ...structuredClone(exercise),
        ...(reviewById.get(exercise.id) ?? {}),
        rejected: reviewById.get(exercise.id)?.rejected ?? false,
        occlusionReviewed: reviewById.get(exercise.id)?.occlusionReviewed
          ?? exercise.type !== "image-occlusion",
      })),
        ...(snapshot === undefined
          ? {}
          : { approvedExerciseIds: [...snapshot.approvedExerciseIds] }),
      };
    });
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

  private async persistSourceAlignmentRecoveryContext(
    handle: DurableProcessHandle,
    pending: PendingSourceAlignmentV1,
    jobId: string,
    startedAt: string,
  ): Promise<void> {
    const cli = await import("./cli");
    await cli.writeDurableRecoveryText(
      handle,
      SOURCE_ALIGNMENT_RECOVERY_CONTEXT_FILENAME,
      JSON.stringify(createSourceAlignmentRecoveryContext({
        jobId,
        startedAt,
        alignmentInput: pending.input,
        configuration: {
          provider: pending.configuration.provider,
          model: pending.configuration.model,
          reasoningEffort: pending.configuration.reasoningEffort,
        },
        prompt: pending.prompt,
      })),
    );
  }

  private async persistSourceAlignmentWorkspace(
    handle: DurableProcessHandle,
    pending: PendingSourceAlignmentV1,
  ): Promise<void> {
    const workspace: PersistedSourceAlignmentWorkspaceV1 = {
      schemaVersion: SOURCE_ALIGNMENT_WORKSPACE_VERSION,
      primaryPresentation: snapshotSourcePresentation(pending.primaryPresentation),
      supportingPresentations: pending.supportingPresentations.map(snapshotSourcePresentation),
      primary: persistCollectedSource(pending.bundle.primary),
      supporting: pending.bundle.supporting.map(persistCollectedSource),
      materials: pending.bundle.materials.map((material) => structuredClone(material)),
      combined: persistCollectedSource(pending.bundle.combined),
      configuration: structuredClone(pending.configuration),
    };
    const cli = await import("./cli");
    await cli.writeDurableRecoveryText(
      handle,
      SOURCE_ALIGNMENT_WORKSPACE_FILENAME,
      JSON.stringify(workspace),
    );
  }

  private async restorePendingSourceAlignment(
    handle: DurableProcessHandle,
  ): Promise<PendingSourceAlignmentV1> {
    const cli = await import("./cli");
    const recovery = parseSourceAlignmentRecoveryContext(
      await cli.readDurableRecoveryText(
        handle,
        SOURCE_ALIGNMENT_RECOVERY_CONTEXT_FILENAME,
      ),
    );
    if (recovery.jobId !== handle.jobId) {
      throw new Error("The recoverable course-alignment context belongs to another provider job.");
    }
    const workspace = parsePersistedSourceAlignmentWorkspace(
      await cli.readDurableRecoveryText(handle, SOURCE_ALIGNMENT_WORKSPACE_FILENAME),
      this.options.app,
    );
    const input: SourceAlignmentGenerationInputV1 = {
      sourceMaterials: workspace.bundle.materials.map((material) => structuredClone(material)),
      segments: workspace.bundle.combined.segments.map((segment) => structuredClone(segment)),
    };
    if (
      sourceAlignmentInputHash(input) !== recovery.inputHash
      || sourceAlignmentInputHash(recovery.input) !== recovery.inputHash
    ) {
      throw new Error("The recoverable course-alignment workspace no longer matches its approved source payload.");
    }
    if (
      workspace.configuration.provider !== recovery.configuration.provider
      || workspace.configuration.model !== recovery.configuration.model
      || workspace.configuration.reasoningEffort !== recovery.configuration.reasoningEffort
    ) {
      throw new Error("The recoverable course-alignment provider configuration changed.");
    }
    return {
      primaryPresentation: workspace.primaryPresentation,
      supportingPresentations: workspace.supportingPresentations,
      bundle: workspace.bundle,
      input,
      inputHash: recovery.inputHash,
      configuration: workspace.configuration,
      prompt: recovery.prompt,
    };
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
    bank: PracticeBankV4,
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
    const previouslySaved = new Set(pendingBatch.recovery.savedSetIds);
    const entries: GenerationHistoryEntryDraftV2[] = drafts
      .filter((draft) => !previouslySaved.has(draft.setId))
      .map((draft) => {
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
        ...(audit.telemetry === undefined ? {} : { telemetry: audit.telemetry }),
        aiContextCompletionPolicy: effectiveAiContextCompletionPolicy(
          configuration.aiContextCompletionPolicy,
        ),
        batchId: pendingBatch.batchId,
        blueprintId: pendingBatch.blueprint.draft.blueprintId,
        setId: draft.setId,
      };
    });
    return {
      catalog,
      legacyRecipe,
      history: entries.length === 0
        ? history
        : appendGenerationHistoryBatch(history, entries, targetRevision),
    };
  }

  private resolveSource(source: SourcePresentation): CollectedSource {
    const exact = this.sources.get(sourceKey(source));
    if (exact !== undefined) return exact;
    const candidate = [...this.sources.values()].find((entry) => (
      entry.path === source.path
      && entry.mode === source.mode
      && entry.title === source.title
      && (source.classification === undefined || entry.classification === source.classification)
      && (source.classificationState === undefined || entry.classificationState === source.classificationState)
    ));
    if (candidate === undefined) throw new Error("The selected source is no longer available. Choose it again.");
    return candidate;
  }

  private provider(id: ProviderPresentation["id"]): ProviderPresentation {
    const provider = this.options.providers().find((entry) => entry.id === id);
    if (provider === undefined) throw new Error(`Provider ${id} is not configured.`);
    return provider;
  }

  private assertPendingPdfBudget(pending: PendingBlueprintV1): void {
    const problem = sourceBundleProblem(
      pending.bundle.primary,
      pending.bundle.supporting,
      this.options.pdfSourceBudgetLimits(),
    );
    if (problem !== null) throw new Error(problem.message);
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
    this.recoveryKind = undefined;
    this.pendingAlignment = undefined;
    this.pendingBatch = undefined;
    await this.options.setRecoveryHandle(undefined);
  }
}

function learningPathAspectClosure(input: {
  readonly blueprint: LearningBlueprintDraftV1;
  readonly sets: readonly LearningBlueprintDraftV1["sets"][number][];
  readonly lessonBriefs: readonly LearningBlueprintDraftV1["tutorLessonBriefs"][number][];
  readonly drafts: readonly PracticeSetDraftV1[];
}): ReadonlySet<string> {
  const aspectById = new Map(input.blueprint.aspects.map((aspect) => [aspect.id, aspect]));
  const included = new Set<string>([
    ...input.sets.flatMap((set) => set.aspectIds),
    ...input.lessonBriefs.flatMap((lesson) => [
      ...lesson.aspectIds,
      ...lesson.prerequisiteAspectIds,
    ]),
    ...input.drafts.flatMap((draft) => [
      ...draft.assignments.flatMap((assignment) => assignment.aspectIds),
      ...draft.tutorLessons.flatMap((lesson) => [
        ...lesson.aspectIds,
        ...lesson.prerequisiteAspectIds,
      ]),
    ]),
  ]);
  const pending = [...included];
  while (pending.length > 0) {
    const aspectId = pending.pop();
    if (aspectId === undefined) continue;
    const aspect = aspectById.get(aspectId);
    if (aspect === undefined) {
      throw new Error(`The partial learning path references unknown aspect ${aspectId}.`);
    }
    for (const prerequisiteId of aspect.prerequisiteAspectIds) {
      if (included.has(prerequisiteId)) continue;
      included.add(prerequisiteId);
      pending.push(prerequisiteId);
    }
  }
  return included;
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
      classification: material.classification,
      classificationState: material.classificationState,
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

function scopeLabel(material: SourceMaterialV2): string {
  if (material.scope.kind === "note") return "complete explicitly selected note";
  if (material.scope.kind === "selection") return "explicit note selection only";
  return material.scope.firstPage === material.scope.lastPage
    ? `PDF page ${material.scope.firstPage} of ${material.scope.pageCount}`
    : `PDF pages ${material.scope.firstPage}-${material.scope.lastPage} of ${material.scope.pageCount}`;
}

function practiceSetDraftFromBank(
  bank: PracticeBankV4,
  setId: string,
): PracticeSetDraftV1 | null {
  const set = bank.practiceSets.find((candidate) => candidate.id === setId);
  if (set === undefined) return null;
  const exerciseById = new Map(bank.exercises.map((exercise) => [exercise.id, exercise]));
  const exerciseIds = new Set(set.assignments.map((assignment) => assignment.exerciseId));
  const exercises = set.assignments.flatMap((assignment) => {
    const exercise = exerciseById.get(assignment.exerciseId);
    return exercise === undefined ? [] : [structuredClone(exercise)];
  });
  if (exercises.length !== set.assignments.length) return null;
  return {
    schemaVersion: PRACTICE_SET_DRAFT_VERSION,
    setId,
    exercises,
    assignments: set.assignments.map((assignment) => structuredClone(assignment)),
    tutorLessons: bank.tutorLessons
      .filter((lesson) => exerciseIds.has(lesson.guidedExerciseId))
      .map((lesson) => structuredClone(lesson)),
  };
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
    source.classification ?? "",
    source.classificationState ?? "",
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

function alignmentHasConfirmedEvidence(
  input: SourceAlignmentGenerationInputV1,
): boolean {
  const segmentById = new Map(input.segments.map((segment) => [segment.id, segment]));
  return input.sourceMaterials.some((material) => (
    isConfirmedSchoolMaterial(material)
    && material.segmentIds.some((id) => {
      const segment = segmentById.get(id);
      return segment?.kind === "paragraph" && !isStructuralSourceSegment(segment);
    })
  ));
}

function alignmentPresentation(
  ledger: SourceAlignmentLedgerV1,
  checked: boolean,
): SourceAlignmentResultPresentationV1 {
  return {
    ledger: structuredClone(ledger),
    blockerRecordIds: sourceAlignmentBlockers(ledger).map((record) => record.id),
    checked,
  };
}

function parsePersistedSourceAlignmentWorkspace(
  serialized: string,
  app: App,
): {
  readonly primaryPresentation: SourcePresentation;
  readonly supportingPresentations: readonly SourcePresentation[];
  readonly bundle: ApprovedSourceBundleV1;
  readonly configuration: LearningBlueprintConfigurationV1;
} {
  const value = JSON.parse(serialized) as PersistedSourceAlignmentWorkspaceV1;
  if (value.schemaVersion !== SOURCE_ALIGNMENT_WORKSPACE_VERSION) {
    throw new Error("The recovered course-alignment workspace version is unsupported.");
  }
  const restore = (
    source: PersistedCollectedSourceV1,
    label: string,
  ): CollectedSource => {
    const file = app.vault.getAbstractFileByPath(source.path);
    if (!(file instanceof TFile)) {
      throw new Error(`The recovered ${label} source no longer exists as a file in the vault.`);
    }
    return { ...structuredClone(source), file };
  };
  const primary = restore(value.primary, "primary alignment");
  const supporting = value.supporting.map((source, index) => (
    restore(source, `supporting alignment source ${index + 1}`)
  ));
  const combined = restore(value.combined, "combined alignment");
  return {
    primaryPresentation: recoveredSourcePresentation(value.primaryPresentation, primary),
    supportingPresentations: value.supportingPresentations.map((presentation, index) => (
      recoveredSourcePresentation(presentation, supporting[index])
    )),
    bundle: {
      primary,
      supporting,
      combined,
      materials: value.materials.map((material) => structuredClone(material)),
      bundleHash: combined.hash,
    },
    configuration: structuredClone(value.configuration),
  };
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
    primaryPresentation: recoveredSourcePresentation(
      value.primaryPresentation,
      primary,
    ),
    supportingPresentations: value.supportingPresentations.map((presentation, index) => (
      recoveredSourcePresentation(presentation, supporting[index])
    )),
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

function recoveredSourcePresentation(
  presentation: SourcePresentation,
  source: CollectedSource | undefined,
): SourcePresentation {
  if (
    presentation.mode !== "pdf"
    || presentation.pdfPageSelection !== undefined
    || source?.sourceImport === undefined
  ) return snapshotSourcePresentation(presentation);
  return snapshotSourcePresentation({
    ...presentation,
    pdfPageSelection: {
      firstPage: source.sourceImport.firstPage,
      lastPage: source.sourceImport.lastPage,
      documentPageCount: source.sourceImport.pageCount,
    },
  });
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
  const saved = new Set(recovery.savedSetIds);
  return recovery.queue.map((entry) => {
    let status: LearningSetGenerationStatusV1;
    if (entry.status === "completed") {
      status = { state: saved.has(entry.setId) ? "saved" : "review" };
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

function isMissingRecoveryFile(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

function cliErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}
