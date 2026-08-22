import {
  ButtonComponent,
  ItemView,
  Notice,
  Setting,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";

import {
  DEFAULT_MAX_LEARNING_PATH_SETS,
  MAX_LEARNING_PATH_EXERCISES,
  MAX_LEARNING_PATH_SETS,
  MIN_LEARNING_PATH_SETS,
  type LearningBlueprintDraftV1,
  type LearningBlueprintPlanningInputV1,
  type PracticeSetDraftV1,
} from "../learning-path-generation";
import type { CliActivityEvent } from "../cli/contracts";
import {
  RECOMMENDED_EXERCISE_TYPE_PERCENTAGES,
  balanceExerciseTypes,
  copyExerciseTypePercentages,
  enabledExerciseTypes,
  rebalanceExerciseTypePercentageWithIntent,
} from "../exercise-distribution";
import { displayDifficulty } from "../difficulty";
import { MAX_FOCUS_INSTRUCTIONS_LENGTH } from "../focus-instructions";
import type {
  LearningPathStartingLevelV1,
  PracticeBankV3,
} from "../model";
import { displayReasoningEffort } from "../reasoning";
import {
  validateOcclusionMasks,
  type DetectedVisual,
} from "../visuals";
import { OcclusionEditor } from "./occlusion-editor";
import { installHoverDescriptions } from "./hover-descriptions";
import { renderDifficultySelector } from "./difficulty-selector";
import { renderLatexMarkup } from "./latex-renderer";
import { isGifVisual } from "./visual-selection";
import type {
  Difficulty,
  EditableDraftExercise,
  ExerciseType,
  GenerationRecoveryPresentation,
  GenerationConfiguration,
  GifFramePosition,
  ProviderId,
  ProviderPresentation,
  ReasoningEffort,
  SourcePresentation,
} from "./contracts";

export const PRACTICE_LEARNING_PATH_VIEW_TYPE = "practice-learning-path-view";

export interface LearningBlueprintConfigurationV1 {
  readonly provider: ProviderId;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
  readonly startingLevel: LearningPathStartingLevelV1;
  readonly desiredSetCount: number;
  readonly globalFocusInstructions: string;
}

export interface LearningPayloadPreviewV1 {
  readonly providerLabel: string;
  readonly modelLabel: string;
  readonly reasoningEffortLabel: string;
  readonly text: string;
  readonly visualNames: readonly string[];
  readonly warning?: string;
}

export interface LearningBlueprintPresentationV1 {
  readonly draft: LearningBlueprintDraftV1;
  readonly planningInput: LearningBlueprintPlanningInputV1;
}

export interface LearningSetPayloadPreviewV1 {
  readonly setId: string;
  readonly setTitle: string;
  readonly providerLabel: string;
  readonly modelLabel: string;
  readonly reasoningEffortLabel: string;
  readonly payloadHash: string;
  readonly text: string;
}

export interface GeneratedLearningSetPresentationV1 {
  readonly setId: string;
  readonly draft: PracticeSetDraftV1;
  readonly exercises: readonly EditableDraftExercise[];
}

export interface LearningSetReviewV1 extends GeneratedLearningSetPresentationV1 {
  readonly approvedExerciseIds: readonly string[];
}

export interface LearningPathSaveRequestV1 {
  readonly primary: SourcePresentation;
  readonly supporting: readonly SourcePresentation[];
  readonly blueprint: LearningBlueprintDraftV1;
  readonly planningInput: LearningBlueprintPlanningInputV1;
  readonly configurations: readonly {
    readonly setId: string;
    readonly configuration: GenerationConfiguration;
  }[];
  readonly sets: readonly LearningSetReviewV1[];
}

export interface LearningPathSavedWorkspaceV1 {
  readonly path: string;
  readonly bank: PracticeBankV3;
}

export interface LearningPathViewCallbacks {
  readonly requestPrimarySource: (
    mode: "note" | "selection" | "pdf",
  ) => Promise<SourcePresentation | null>;
  readonly requestSupportingSource: () => Promise<SourcePresentation | null>;
  readonly updateSourceVisuals?: (
    source: SourcePresentation,
  ) => Promise<SourcePresentation> | SourcePresentation;
  readonly importRemoteVisual?: (
    visual: DetectedVisual,
  ) => Promise<DetectedVisual | null>;
  readonly chooseMediaFrame?: (
    visual: DetectedVisual,
    position?: GifFramePosition,
  ) => Promise<DetectedVisual | null>;
  readonly updateGifFrameDefault?: (
    position: GifFramePosition,
  ) => Promise<void> | void;
  readonly openQuickPractice: (source: SourcePresentation) => Promise<void> | void;
  readonly resumeInterruptedQuickGeneration?: () => Promise<void> | void;
  readonly retryInterruptedQuickGeneration?: () => Promise<void> | void;
  readonly discardInterruptedQuickGeneration?: () => Promise<void> | void;
  readonly previewBlueprint: (
    primary: SourcePresentation,
    supporting: readonly SourcePresentation[],
    configuration: LearningBlueprintConfigurationV1,
  ) => Promise<LearningPayloadPreviewV1>;
  readonly generateBlueprint: (
    primary: SourcePresentation,
    supporting: readonly SourcePresentation[],
    configuration: LearningBlueprintConfigurationV1,
    onActivity: (event: CliActivityEvent) => void,
  ) => Promise<LearningBlueprintPresentationV1>;
  readonly previewSetPayloads: (
    blueprint: LearningBlueprintPresentationV1,
    configurations: readonly {
      readonly setId: string;
      readonly configuration: GenerationConfiguration;
    }[],
  ) => Promise<readonly LearningSetPayloadPreviewV1[]>;
  readonly generateAllSets: (
    blueprint: LearningBlueprintPresentationV1,
    configurations: readonly {
      readonly setId: string;
      readonly configuration: GenerationConfiguration;
    }[],
    onStatus: (setId: string, status: LearningSetGenerationStatusV1) => void,
    onActivity: (setId: string, event: CliActivityEvent) => void,
  ) => Promise<readonly GeneratedLearningSetPresentationV1[]>;
  readonly cancelGeneration?: () => Promise<void> | void;
  readonly saveLearningPath: (
    request: LearningPathSaveRequestV1,
  ) => Promise<LearningPathSavedWorkspaceV1>;
  readonly saveManagedWorkspace?: (
    workspace: LearningPathSavedWorkspaceV1,
  ) => Promise<LearningPathSavedWorkspaceV1>;
  readonly regenerateSavedSet?: (
    workspace: LearningPathSavedWorkspaceV1,
    setId: string,
  ) => Promise<void> | void;
  readonly useSavedWorkspace?: (
    workspace: LearningPathSavedWorkspaceV1,
    action: "continue" | "choose-set" | "mixed" | "open-bank",
  ) => Promise<void> | void;
  readonly resumeRecoverableBatch?: (
    onStatus: (setId: string, status: LearningSetGenerationStatusV1) => void,
    onActivity: (setId: string, event: CliActivityEvent) => void,
  ) => Promise<LearningPathRecoveredBatchV1>;
  readonly discardRecoverableBatch?: () => Promise<boolean>;
}

export interface LearningPathRecoveredBatchV1 {
  readonly primary: SourcePresentation;
  readonly supporting: readonly SourcePresentation[];
  readonly blueprint: LearningBlueprintPresentationV1;
  readonly configurations: readonly {
    readonly setId: string;
    readonly configuration: GenerationConfiguration;
  }[];
  readonly generated: readonly GeneratedLearningSetPresentationV1[];
}

export interface LearningPathViewOptions {
  readonly callbacks: LearningPathViewCallbacks;
  readonly providers: readonly ProviderPresentation[];
  readonly defaults: {
    readonly provider: ProviderId;
    readonly model: string;
    readonly reasoningEffort: ReasoningEffort;
    readonly quantity: number;
    readonly difficulty: Difficulty;
    readonly focusInstructions: string;
    readonly gifFrameDefault?: GifFramePosition;
  };
  readonly initialSource?: SourcePresentation;
  readonly recoverableBatch?: boolean;
  readonly quickGenerationRecovery?: GenerationRecoveryPresentation | null;
}

export type LearningSetGenerationStatusV1 =
  | { readonly state: "queued" }
  | { readonly state: "generating"; readonly message?: string }
  | { readonly state: "validating"; readonly message?: string }
  | { readonly state: "review" }
  | { readonly state: "failed"; readonly message: string }
  | { readonly state: "saved" };

interface EditableSetState {
  id: string;
  configuration: GenerationConfiguration;
  advancedOpen: boolean;
  intendedTypes: Set<ExerciseType>;
  rememberedPercentages: Record<ExerciseType, number>;
}

type Stage = "source" | "map" | "review" | "saved";

const EXERCISE_LABELS: Readonly<Record<ExerciseType, string>> = {
  "short-answer": "Short answer",
  "causal-explanation": "Causal explanation",
  application: "Application",
  calculation: "Calculation",
  cloze: "Cloze",
  "single-select": "Single select",
  "multi-select": "Multi select",
  matching: "Matching",
  ordering: "Ordering",
  "image-occlusion": "Image occlusion",
};

const STARTING_LEVELS: ReadonlyArray<{
  readonly id: LearningPathStartingLevelV1;
  readonly label: string;
  readonly description: string;
}> = [
  { id: "new-to-topic", label: "New to this topic", description: "Introduce supported prerequisites and fade guidance gradually." },
  { id: "some-familiarity", label: "Some familiarity", description: "Reconnect the key mechanisms before application." },
  { id: "exam-review", label: "Exam review", description: "Move faster toward independent integration and transfer." },
];

const VISUAL_LABELS: Readonly<Record<DetectedVisual["kind"], string>> = {
  "static-image": "Static image",
  "animated-gif": "Animated GIF",
  video: "Video",
  "remote-image": "Remote image",
  "notability-region": "Notability region",
};

const GIF_FRAME_POSITIONS = ["first", "middle", "last"] as const;

function displayGifFramePosition(value: GifFramePosition): string {
  if (value === "first") return "First frame";
  if (value === "last") return "Last frame";
  return "Middle frame";
}

function displayVisualName(visual: DetectedVisual): string {
  return visual.sourceTarget
    ?? visual.region?.title
    ?? visual.remoteHost
    ?? visual.id;
}

function sameSourceScope(
  left: SourcePresentation,
  right: SourcePresentation,
): boolean {
  return left.mode === right.mode
    && left.path === right.path
    && left.title === right.title
    && left.detail === right.detail
    && left.excerpt === right.excerpt;
}

export function replaceLearningPathVisual(
  source: SourcePresentation,
  replacement: DetectedVisual,
): SourcePresentation {
  if (!source.visuals.some((visual) => visual.id === replacement.id)) {
    throw new Error(`Visual ${replacement.id} does not belong to ${source.title}.`);
  }
  return {
    ...source,
    visuals: source.visuals.map((visual) => (
      visual.id === replacement.id ? { ...replacement } : { ...visual }
    )),
  };
}

export function setLearningPathVisualSelection(
  source: SourcePresentation,
  selected: boolean,
): SourcePresentation {
  return {
    ...source,
    visuals: source.visuals.map((visual) => ({
      ...visual,
      selected: visual.state === "ready" ? selected : false,
    })),
  };
}

function editableDraft(exercise: EditableDraftExercise): EditableDraftExercise {
  return {
    ...structuredClone(exercise),
    rejected: exercise.rejected,
    occlusionReviewed: exercise.occlusionReviewed,
  };
}

export class PracticeLearningPathView extends ItemView {
  private stage: Stage = "source";
  private primary: SourcePresentation | null;
  private supporting: SourcePresentation[] = [];
  private providers: ProviderPresentation[];
  private blueprintConfiguration: LearningBlueprintConfigurationV1;
  private preview: LearningPayloadPreviewV1 | null = null;
  private previewAccepted = false;
  private blueprint: LearningBlueprintPresentationV1 | null = null;
  private setStates: EditableSetState[] = [];
  private setPayloadPreviews: readonly LearningSetPayloadPreviewV1[] = [];
  private setPayloadsAccepted = false;
  private statuses = new Map<string, LearningSetGenerationStatusV1>();
  private activity = new Map<string, CliActivityEvent[]>();
  private generatedSets: GeneratedLearningSetPresentationV1[] = [];
  private approvedBySet = new Map<string, Set<string>>();
  private activeReviewSetId: string | null = null;
  private busy: "source" | "preview" | "blueprint" | "payloads" | "batch" | "save" | null = null;
  private error: string | null = null;
  private recoveryAvailable: boolean;
  private savedWorkspace: LearningPathSavedWorkspaceV1 | null = null;
  private savedWorkspaceDirty = false;
  private gifFrameDefault: GifFramePosition;
  private visualSelectionBusy = false;
  private visualSelectionMessage: string | null = null;
  private quickGenerationRecovery: GenerationRecoveryPresentation | null;
  private readonly expandedVisualSources = new Set<string>();
  private readonly occlusionEditors: OcclusionEditor[] = [];

  constructor(
    leaf: WorkspaceLeaf,
    private readonly options: LearningPathViewOptions,
  ) {
    super(leaf);
    this.navigation = false;
    this.primary = options.initialSource ?? null;
    this.recoveryAvailable = options.recoverableBatch === true;
    this.quickGenerationRecovery = options.quickGenerationRecovery ?? null;
    this.providers = [...options.providers];
    this.gifFrameDefault = options.defaults.gifFrameDefault ?? "middle";
    this.blueprintConfiguration = {
      provider: options.defaults.provider,
      model: options.defaults.model,
      reasoningEffort: options.defaults.reasoningEffort,
      startingLevel: "new-to-topic",
      desiredSetCount: Math.min(DEFAULT_MAX_LEARNING_PATH_SETS, 4),
      globalFocusInstructions: options.defaults.focusInstructions,
    };
  }

  getViewType(): string {
    return PRACTICE_LEARNING_PATH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Practice creation - guided path";
  }

  getIcon(): string {
    return "route";
  }

  override async onOpen(): Promise<void> {
    installHoverDescriptions(this.contentEl);
    this.render();
  }

  override async onClose(): Promise<void> {
    this.clearOcclusionEditors();
  }

  public setPrimarySource(source: SourcePresentation): void {
    this.primary = source;
    this.supporting = [];
    this.resetAfterSourceChange();
    this.render();
  }

  public setProviders(providers: readonly ProviderPresentation[]): void {
    this.providers = [...providers];
    this.render();
  }

  public setRecoveryAvailable(available: boolean): void {
    this.recoveryAvailable = available;
    this.render();
  }

  public setQuickGenerationRecovery(
    recovery: GenerationRecoveryPresentation | null,
  ): void {
    this.quickGenerationRecovery = recovery;
    this.render();
  }

  public manageSavedWorkspace(
    path: string,
    bank: PracticeBankV3,
  ): void {
    this.savedWorkspace = { path, bank: structuredClone(bank) };
    this.savedWorkspaceDirty = false;
    this.stage = "saved";
    this.error = null;
    this.render();
  }

  public async resumeRecovery(): Promise<void> {
    if (this.busy !== null || this.options.callbacks.resumeRecoverableBatch === undefined) return;
    this.busy = "batch";
    this.error = null;
    this.stage = "review";
    this.render();
    try {
      const result = await this.options.callbacks.resumeRecoverableBatch(
        (setId, status) => {
          this.statuses.set(setId, status);
          this.render();
        },
        (setId, event) => {
          this.activity.set(setId, [...(this.activity.get(setId) ?? []), event].slice(-40));
          this.render();
        },
      );
      this.primary = result.primary;
      this.supporting = [...result.supporting];
      this.blueprint = result.blueprint;
      this.setStates = result.blueprint.draft.sets.flatMap((brief) => {
        const entry = result.configurations.find((candidate) => candidate.setId === brief.id);
        return entry === undefined ? [] : [this.editableSetState(brief.id, entry.configuration, false)];
      });
      this.generatedSets = result.generated.map((set) => ({
        ...set,
        exercises: set.exercises.map(editableDraft),
      }));
      this.approvedBySet = new Map(result.generated.map((set) => [set.setId, new Set<string>()]));
      this.activeReviewSetId = result.generated[0]?.setId ?? null;
      for (const set of result.generated) this.statuses.set(set.setId, { state: "review" });
      this.recoveryAvailable = true;
    } catch (error) {
      this.error = errorMessage(error);
      if (this.blueprint === null) this.stage = "source";
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private render(): void {
    this.clearOcclusionEditors();
    this.contentEl.empty();
    this.contentEl.addClasses(["practice-lab", "practice-learning-path"]);
    const shell = this.contentEl.createDiv({ cls: "practice-learning-path-shell" });
    this.renderHeader(shell);
    this.renderCreationModeSwitch(shell);
    this.renderQuickGenerationRecovery(shell);
    this.renderStageNavigation(shell);
    const body = shell.createDiv({ cls: "practice-learning-path-body" });
    if (this.error !== null) {
      const error = body.createDiv({ cls: "practice-lab-callout is-error", attr: { role: "alert" } });
      setIcon(error.createSpan(), "circle-alert");
      error.createSpan({ text: this.error });
    }
    if (this.stage === "source") this.renderSource(body);
    else if (this.stage === "map") this.renderMap(body);
    else if (this.stage === "review") this.renderReview(body);
    else this.renderSaved(body);
  }

  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: "practice-learning-path-header" });
    const icon = header.createDiv({ cls: "practice-learning-path-header-icon" });
    setIcon(icon, "route");
    const text = header.createDiv();
    text.createEl("h2", { text: "Practice Problem Generator" });
    text.createEl("p", {
      text: "Guided path mode builds connected tutor lessons and distinct practice sets from only the material you approve.",
    });
  }

  private renderCreationModeSwitch(container: HTMLElement): void {
    const switcher = container.createDiv({
      cls: "practice-creation-mode-switch",
      attr: {
        role: "group",
        "aria-label": "Practice creation mode",
      },
    });
    const quick = switcher.createEl("button", {
      text: "Quick set",
      attr: {
        type: "button",
        "aria-pressed": "false",
        title: "Create one configurable practice set from the selected source.",
      },
    });
    const switchBlocked = this.busy !== null || this.stage === "review";
    quick.disabled = switchBlocked || this.primary === null;
    if (switchBlocked) {
      quick.title = "Finish the current guided generation or review before changing creation mode.";
    } else if (this.primary === null) {
      quick.title = "Choose a primary source before switching to quick set mode.";
    }
    quick.addEventListener("click", () => {
      if (!quick.disabled && this.primary !== null) {
        void this.options.callbacks.openQuickPractice(this.primary);
      }
    });
    const guided = switcher.createEl("button", {
      cls: "is-selected",
      text: "Guided path",
      attr: {
        type: "button",
        "aria-pressed": "true",
        title: "Create a prerequisite-aware sequence of tutor lessons and practice sets.",
      },
    });
    guided.disabled = true;
  }

  private renderQuickGenerationRecovery(container: HTMLElement): void {
    const recovery = this.quickGenerationRecovery;
    if (recovery === null) return;
    const panel = container.createEl("section", {
      cls: `practice-generation-recovery is-${recovery.state}`,
      attr: { role: "alert", "aria-live": "polite" },
    });
    const copy = panel.createDiv({ cls: "practice-generation-recovery-copy" });
    copy.createEl("strong", { text: "Resolve the saved quick set first" });
    copy.createEl("p", {
      text: `${recovery.message} Guided generation is paused so two AI jobs cannot overwrite each other's recoverable state.`,
    });
    const actions = panel.createDiv({ cls: "practice-generation-recovery-actions" });
    if (
      (recovery.state === "running" || recovery.state === "blocked" || recovery.state === "ready")
      && this.options.callbacks.resumeInterruptedQuickGeneration !== undefined
    ) {
      new ButtonComponent(actions)
        .setButtonText(recovery.state === "ready" ? "Open recovered Quick set" : "Resume / inspect Quick set")
        .setIcon("history")
        .onClick(() => void this.options.callbacks.resumeInterruptedQuickGeneration?.());
    }
    if (
      recovery.state === "failed"
      && this.options.callbacks.retryInterruptedQuickGeneration !== undefined
    ) {
      new ButtonComponent(actions)
        .setButtonText("Retry approved quick set")
        .setIcon("refresh-cw")
        .setCta()
        .onClick(() => void this.options.callbacks.retryInterruptedQuickGeneration?.());
    }
    if (this.options.callbacks.discardInterruptedQuickGeneration !== undefined) {
      new ButtonComponent(actions)
        .setButtonText("Discard recovery...")
        .setIcon("trash-2")
        .setDestructive()
        .onClick(() => void this.options.callbacks.discardInterruptedQuickGeneration?.());
    }
  }

  private renderStageNavigation(container: HTMLElement): void {
    const navigation = container.createEl("ol", {
      cls: "practice-learning-path-steps",
      attr: { "aria-label": "Learning-path creation progress" },
    });
    const stages: ReadonlyArray<readonly [Stage, string]> = [
      ["source", "Source & intent"],
      ["map", "Map & configure"],
      ["review", "Generate & review"],
      ["saved", "Ready"],
    ];
    const current = stages.findIndex(([stage]) => stage === this.stage);
    stages.forEach(([stage, label], index) => {
      const item = navigation.createEl("li", {
        cls: index === current ? "is-current" : index < current ? "is-complete" : "",
      });
      item.createSpan({ text: String(index + 1) });
      item.createDiv({ text: label });
      if (stage === "source" && this.stage !== "source" && this.busy === null) {
        item.addClass("is-clickable");
        item.tabIndex = 0;
        item.addEventListener("click", () => { this.stage = "source"; this.render(); });
      }
    });
  }

  private renderSource(container: HTMLElement): void {
    if (this.recoveryAvailable && this.options.callbacks.resumeRecoverableBatch !== undefined) {
      const recovery = container.createDiv({ cls: "practice-lab-callout is-warning practice-learning-path-recovery" });
      const text = recovery.createDiv();
      text.createEl("strong", { text: "Unfinished guided path found" });
      text.createEl("p", { text: "Continue the exact approved batch from its next unfinished set. Completed drafts are retained." });
      const actions = recovery.createDiv({ cls: "practice-learning-path-actions" });
      new ButtonComponent(actions)
        .setButtonText("Resume guided path")
        .setIcon("history")
        .setCta()
        .setDisabled(this.busy !== null)
        .onClick(() => void this.resumeRecovery());
      if (this.options.callbacks.discardRecoverableBatch !== undefined) {
        new ButtonComponent(actions)
          .setButtonText("Discard recovery…")
          .setIcon("trash-2")
          .setDestructive()
          .setDisabled(this.busy !== null)
          .onClick(() => void this.discardRecovery());
      }
    }
    const section = this.section(container, "Approved source bundle", "Nothing is crawled. The primary source and every supporting range must be selected explicitly.");
    if (this.primary === null) {
      const empty = section.createDiv({ cls: "practice-lab-empty" });
      empty.createEl("h3", { text: "Choose the primary source" });
      empty.createEl("p", { text: "Use the active note, its current selection, or an exact PDF page range." });
      this.renderSourceChoiceButtons(empty, true);
      return;
    }
    this.renderSourceCard(section, this.primary, "Primary", () => {
      this.primary = null;
      this.supporting = [];
      this.resetAfterSourceChange();
      this.render();
    });
    const supportHeading = section.createDiv({ cls: "practice-learning-path-subheading" });
    supportHeading.createEl("strong", { text: "Supporting material" });
    supportHeading.createSpan({ text: `${this.supporting.length} of 4 selected` });
    for (const source of this.supporting) {
      this.renderSourceCard(section, source, "Supporting", () => {
        this.supporting = this.supporting.filter((candidate) => candidate !== source);
        this.resetAfterSourceChange();
        this.render();
      });
    }
    new ButtonComponent(section)
      .setButtonText(this.busy === "source" ? "Choosing source…" : "Add supporting note or PDF range")
      .setIcon("plus")
      .setTooltip("Add one explicitly selected note or exact PDF page range. Linked material is never added automatically.")
      .setDisabled(this.busy !== null || this.visualSelectionBusy || this.supporting.length >= 4)
      .onClick(() => void this.addSupportingSource());
    this.renderVisualBundleControls(section);

    const level = this.section(container, "Starting level", "This changes the proposed teaching depth, never the approved source boundary.");
    const levelGrid = level.createDiv({ cls: "practice-learning-path-level-grid" });
    for (const option of STARTING_LEVELS) {
      const label = levelGrid.createEl("label", {
        cls: `practice-learning-path-level${this.blueprintConfiguration.startingLevel === option.id ? " is-selected" : ""}`,
      });
      const input = label.createEl("input", { attr: { type: "radio", name: "learning-starting-level", value: option.id } });
      input.checked = this.blueprintConfiguration.startingLevel === option.id;
      label.createEl("strong", { text: option.label });
      label.createSpan({ text: option.description });
      input.addEventListener("change", () => {
        if (!input.checked) return;
        this.blueprintConfiguration = { ...this.blueprintConfiguration, startingLevel: option.id };
        this.invalidatePlanningPreview();
        this.render();
      });
    }

    const planning = this.section(container, "Planning instructions", "Tell the planner what to emphasize. These instructions cannot authorize outside knowledge.");
    new Setting(planning)
      .setName("Proposed set count")
      .setDesc(`The planner may reduce this when the source cannot support distinct sets. Maximum ${MAX_LEARNING_PATH_SETS}.`)
      .addSlider((slider) => slider
        .setLimits(MIN_LEARNING_PATH_SETS, MAX_LEARNING_PATH_SETS, 1)
        .setValue(this.blueprintConfiguration.desiredSetCount)
        .onChange((value) => {
          this.blueprintConfiguration = { ...this.blueprintConfiguration, desiredSetCount: value };
          this.invalidatePlanningPreview();
        }));
    const focus = planning.createEl("label", { cls: "practice-learning-path-focus" });
    focus.createEl("strong", { text: "Comments for the planner" });
    focus.createSpan({ text: "For example: focus on mechanisms first, compare the two architectures, or keep calculations for the last set." });
    const textarea = focus.createEl("textarea", { attr: { rows: "4", maxlength: String(MAX_FOCUS_INSTRUCTIONS_LENGTH) } });
    textarea.value = this.blueprintConfiguration.globalFocusInstructions;
    textarea.addEventListener("input", () => {
      this.blueprintConfiguration = { ...this.blueprintConfiguration, globalFocusInstructions: textarea.value };
      this.invalidatePlanningPreview();
    });
    this.renderProviderControls(planning);

    const actions = container.createDiv({ cls: "practice-learning-path-actions" });
    new ButtonComponent(actions)
      .setButtonText(this.busy === "preview" ? "Preparing exact payload…" : "Preview planning payload")
      .setIcon("scan-eye")
      .setCta()
      .setDisabled(this.busy !== null)
      .onClick(() => void this.previewPlanningPayload());
    if (this.preview !== null) this.renderPlanningPreview(container);
  }

  private renderPlanningPreview(container: HTMLElement): void {
    const preview = this.preview;
    if (preview === null) return;
    const section = this.section(container, "Exact planning payload", "Review this complete text before the first AI planning call.");
    const metadata = section.createDiv({ cls: "practice-learning-path-payload-meta" });
    metadata.createSpan({ text: preview.providerLabel });
    metadata.createSpan({ text: preview.modelLabel });
    metadata.createSpan({ text: preview.reasoningEffortLabel });
    const details = section.createEl("details", { cls: "practice-learning-path-payload", attr: { open: "" } });
    details.createEl("summary", { text: "Show exact provider text" });
    details.createEl("pre", { text: preview.text });
    if (preview.warning !== undefined) section.createEl("p", { cls: "practice-lab-muted", text: preview.warning });
    const actions = section.createDiv({ cls: "practice-learning-path-actions" });
    new ButtonComponent(actions)
      .setButtonText(this.previewAccepted ? "Payload approved" : "Approve this payload")
      .setIcon(this.previewAccepted ? "check" : "shield-check")
      .setDisabled(this.previewAccepted || this.busy !== null)
      .onClick(() => { this.previewAccepted = true; this.render(); });
    new ButtonComponent(actions)
      .setButtonText(this.busy === "blueprint" ? "Planning path…" : "Generate editable map")
      .setIcon("route")
      .setCta()
      .setDisabled(
        !this.previewAccepted
        || this.busy !== null
        || this.quickGenerationRecovery !== null,
      )
      .onClick(() => void this.generateBlueprint());
  }

  private renderMap(container: HTMLElement): void {
    const blueprint = this.blueprint;
    if (blueprint === null) {
      this.stage = "source";
      this.render();
      return;
    }
    const overview = this.section(container, blueprint.draft.title, blueprint.draft.overview);
    const summary = overview.createDiv({ cls: "practice-learning-path-map-summary" });
    summary.createSpan({ text: `${blueprint.draft.aspects.filter((aspect) => aspect.status === "supported").length} supported aspects` });
    summary.createSpan({ text: `${this.setStates.length} practice sets` });
    summary.createSpan({ text: `${this.totalExercises()} exercises planned` });

    const aspects = this.section(container, "Aspect and prerequisite map", "Source gaps must be removed or resolved by adding material before generation.");
    const aspectGrid = aspects.createDiv({ cls: "practice-learning-path-aspect-grid" });
    for (const aspect of blueprint.draft.aspects) {
      const card = aspectGrid.createDiv({ cls: `practice-learning-path-aspect is-${aspect.status}` });
      const heading = card.createDiv({ cls: "practice-learning-path-card-heading" });
      setIcon(heading.createSpan(), aspect.status === "supported" ? "check-circle-2" : "triangle-alert");
      const title = heading.createEl("strong");
      renderLatexMarkup(title, aspect.title);
      card.createEl("p", { text: aspect.purpose });
      if (aspect.prerequisiteAspectIds.length > 0) {
        card.createEl("p", { cls: "practice-lab-muted", text: `Requires: ${aspect.prerequisiteAspectIds.map((id) => blueprint.draft.aspects.find((entry) => entry.id === id)?.title ?? id).join(", ")}` });
      }
      if (aspect.status === "source-gap") {
        card.createEl("p", { cls: "practice-learning-path-gap", text: aspect.gapReason ?? "Unsupported prerequisite" });
        new ButtonComponent(card)
          .setButtonText("Remove from path")
          .setIcon("trash-2")
          .setTooltip("Remove this unsupported aspect. No AI-generated general knowledge will replace it.")
          .onClick(() => this.removeGap(aspect.id));
      }
    }

    const sets = this.section(container, "Practice-set progression", "Drag cards or use the arrow controls. Every set can override provider, model, reasoning, difficulty, focus, and exercise mix under Advanced.");
    const problem = this.mapProblem();
    if (problem !== null) {
      const callout = sets.createDiv({ cls: "practice-lab-callout is-warning", attr: { role: "status" } });
      setIcon(callout.createSpan(), "triangle-alert");
      callout.createSpan({ text: problem });
    }
    const list = sets.createDiv({ cls: "practice-learning-path-set-list" });
    for (const [index, state] of this.setStates.entries()) {
      this.renderSetCard(list, state, index);
    }
    new ButtonComponent(sets)
      .setButtonText("Add focused set")
      .setIcon("plus")
      .setTooltip(`Add another editable set. A path can contain at most ${MAX_LEARNING_PATH_SETS}.`)
      .setDisabled(this.setStates.length >= MAX_LEARNING_PATH_SETS || this.busy !== null)
      .onClick(() => this.addSet());

    const actions = container.createDiv({ cls: "practice-learning-path-actions is-sticky" });
    new ButtonComponent(actions)
      .setButtonText(this.busy === "payloads" ? "Computing exact payloads…" : "Preview all set payloads")
      .setIcon("scan-eye")
      .setDisabled(problem !== null || this.busy !== null)
      .onClick(() => void this.previewSetPayloads());
    if (this.setPayloadPreviews.length > 0) this.renderSetPayloadPreviews(container);
  }

  private renderSetCard(container: HTMLElement, state: EditableSetState, index: number): void {
    const blueprint = this.blueprint;
    if (blueprint === null) return;
    const brief = blueprint.draft.sets.find((set) => set.id === state.id);
    if (brief === undefined) return;
    const card = container.createEl("article", {
      cls: "practice-learning-path-set-card",
      attr: { draggable: "true", "data-set-id": state.id },
    });
    card.addEventListener("dragstart", (event) => event.dataTransfer?.setData("text/plain", state.id));
    card.addEventListener("dragover", (event) => event.preventDefault());
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      const dragged = event.dataTransfer?.getData("text/plain");
      if (dragged !== undefined && dragged.length > 0) this.moveSet(dragged, index);
    });
    const heading = card.createDiv({ cls: "practice-learning-path-set-heading" });
    const order = heading.createSpan({ cls: "practice-learning-path-set-order", text: String(index + 1) });
    order.title = "Drag this card to change the learning sequence.";
    const identity = heading.createDiv();
    const title = identity.createEl("input", { cls: "practice-learning-path-set-title", attr: { type: "text", "aria-label": `Set ${index + 1} title` } });
    title.value = brief.title;
    title.addEventListener("input", () => this.updateBrief(state.id, { title: title.value }));
    identity.createSpan({ cls: "practice-lab-badge", text: brief.instructionalRole.replaceAll("-", " ") });
    const controls = heading.createDiv({ cls: "practice-learning-path-card-actions" });
    this.iconButton(controls, "arrow-up", "Move set earlier", index === 0, () => this.moveSet(state.id, index - 1));
    this.iconButton(controls, "arrow-down", "Move set later", index === this.setStates.length - 1, () => this.moveSet(state.id, index + 1));
    this.iconButton(controls, "trash-2", "Remove set", this.setStates.length <= MIN_LEARNING_PATH_SETS, () => this.removeSet(state.id));
    const purpose = card.createEl("textarea", { attr: { rows: "2", "aria-label": `${brief.title} purpose` } });
    purpose.value = brief.purpose;
    purpose.addEventListener("input", () => this.updateBrief(state.id, { purpose: purpose.value }));
    const chips = card.createDiv({ cls: "practice-learning-path-aspect-chips" });
    for (const aspectId of brief.aspectIds) {
      chips.createSpan({ text: blueprint.draft.aspects.find((aspect) => aspect.id === aspectId)?.title ?? aspectId });
    }
    const compact = card.createDiv({ cls: "practice-learning-path-set-compact" });
    const quantity = compact.createEl("label");
    quantity.createSpan({ text: "Questions" });
    const quantityInput = quantity.createEl("input", { attr: { type: "number", min: "1", max: "30" } });
    quantityInput.value = String(state.configuration.quantity);
    quantityInput.addEventListener("change", () => {
      const value = Math.min(30, Math.max(1, Number.parseInt(quantityInput.value, 10) || 1));
      this.updateSetConfiguration(state.id, { quantity: value });
      quantityInput.value = String(value);
    });
    const difficulty = card.createDiv({
      cls: "practice-learning-path-set-difficulty",
    });
    difficulty.createEl("strong", { text: "Difficulty profile" });
    difficulty.createSpan({
      text: "Calibrate this set independently. The approved sources and set purpose remain fixed.",
    });
    renderDifficultySelector(difficulty, {
      value: state.configuration.difficulty,
      name: `practice-lab-path-difficulty-${state.id}`,
      ariaLabel: `Difficulty profile for ${brief.title}`,
      compact: true,
      onChange: (value) => this.updateSetConfiguration(state.id, {
        difficulty: value,
      }),
    });

    const advanced = card.createEl("details", { cls: "practice-learning-path-advanced" });
    advanced.open = state.advancedOpen;
    advanced.addEventListener("toggle", () => { state.advancedOpen = advanced.open; });
    advanced.createEl("summary", { text: "Advanced set controls" });
    this.renderSetAdvanced(advanced, state);
  }

  private renderSetAdvanced(container: HTMLElement, state: EditableSetState): void {
    const providerRow = container.createDiv({ cls: "practice-learning-path-provider-grid" });
    const providerLabel = providerRow.createEl("label");
    providerLabel.createSpan({ text: "Provider" });
    const provider = providerLabel.createEl("select");
    for (const entry of this.providers) {
      provider.createEl("option", { value: entry.id, text: entry.available ? entry.label : `${entry.label} (unavailable)` }).disabled = !entry.available;
    }
    provider.value = state.configuration.provider;
    provider.addEventListener("change", () => {
      const id = provider.value as ProviderId;
      const presentation = this.providers.find((entry) => entry.id === id);
      this.updateSetConfiguration(state.id, {
        provider: id,
        model: presentation?.defaultModel ?? "",
        reasoningEffort: presentation?.reasoningEfforts[0] ?? "medium",
      });
      this.render();
    });
    const selectedProvider = this.providers.find((entry) => entry.id === state.configuration.provider);
    const modelLabel = providerRow.createEl("label");
    modelLabel.createSpan({ text: "Model" });
    const model = modelLabel.createEl("select");
    const models = selectedProvider?.models ?? [];
    if (models.length === 0) model.createEl("option", { value: "", text: "Automatic" });
    for (const entry of models) model.createEl("option", { value: entry.id, text: entry.label });
    if (state.configuration.model.length > 0 && !models.some((entry) => entry.id === state.configuration.model)) {
      model.createEl("option", { value: state.configuration.model, text: state.configuration.model });
    }
    model.value = state.configuration.model;
    model.addEventListener("change", () => this.updateSetConfiguration(state.id, { model: model.value }));
    const reasoningLabel = providerRow.createEl("label");
    reasoningLabel.createSpan({ text: "Reasoning" });
    const reasoning = reasoningLabel.createEl("select", { attr: { title: "Reasoning effort is sent explicitly to this set's selected agent." } });
    for (const effort of selectedProvider?.reasoningEfforts ?? []) {
      reasoning.createEl("option", { value: effort, text: displayReasoningEffort(effort) });
    }
    reasoning.value = state.configuration.reasoningEffort;
    reasoning.addEventListener("change", () => this.updateSetConfiguration(state.id, { reasoningEffort: reasoning.value as ReasoningEffort }));

    const focus = container.createEl("label", { cls: "practice-learning-path-focus" });
    focus.createEl("strong", { text: "Local objective comments" });
    focus.createSpan({ text: "This set-specific note is added after the global path context and sibling briefs." });
    const focusInput = focus.createEl("textarea", { attr: { rows: "3", maxlength: String(MAX_FOCUS_INSTRUCTIONS_LENGTH) } });
    focusInput.value = state.configuration.focusInstructions;
    focusInput.addEventListener("input", () => this.updateSetConfiguration(state.id, { focusInstructions: focusInput.value }));

    const mix = container.createDiv({ cls: "practice-learning-path-mix" });
    const mixHeading = mix.createDiv({ cls: "practice-learning-path-subheading" });
    mixHeading.createEl("strong", { text: "Exercise mix" });
    mixHeading.createSpan({ text: "Changing one share automatically rebalances the rest to 100%." });
    const presets = mix.createDiv({ cls: "practice-learning-path-mix-presets" });
    new ButtonComponent(presets).setButtonText("Deep practice").onClick(() => {
      const percentages = copyExerciseTypePercentages(RECOMMENDED_EXERCISE_TYPE_PERCENTAGES);
      state.intendedTypes = new Set(enabledExerciseTypes(percentages));
      state.rememberedPercentages = copyExerciseTypePercentages(percentages);
      this.updateSetConfiguration(state.id, { exerciseTypePercentages: percentages });
      this.render();
    });
    new ButtonComponent(presets).setButtonText("Equal mix").onClick(() => {
      const percentages = balanceExerciseTypes(Object.keys(EXERCISE_LABELS) as ExerciseType[]);
      state.intendedTypes = new Set(enabledExerciseTypes(percentages));
      state.rememberedPercentages = copyExerciseTypePercentages(percentages);
      this.updateSetConfiguration(state.id, { exerciseTypePercentages: percentages });
      this.render();
    });
    for (const [type, label] of Object.entries(EXERCISE_LABELS) as Array<[ExerciseType, string]>) {
      const row = mix.createEl("label", { cls: `practice-learning-path-mix-row${state.configuration.exerciseTypePercentages[type] === 0 ? " is-zero" : ""}` });
      row.createSpan({ text: label });
      const slider = row.createEl("input", { attr: { type: "range", min: "0", max: "100", step: "5" } });
      slider.value = String(state.configuration.exerciseTypePercentages[type]);
      const output = row.createEl("output", { text: `${slider.value}%` });
      slider.addEventListener("input", () => {
        const requested = Number.parseInt(slider.value, 10);
        if (requested === 0) state.intendedTypes.delete(type);
        else state.intendedTypes.add(type);
        for (const candidate of enabledExerciseTypes(state.configuration.exerciseTypePercentages)) {
          state.rememberedPercentages[candidate] = state.configuration.exerciseTypePercentages[candidate];
        }
        const percentages = rebalanceExerciseTypePercentageWithIntent(
          state.configuration.exerciseTypePercentages,
          type,
          requested,
          state.intendedTypes,
          state.rememberedPercentages,
        );
        this.updateSetConfiguration(state.id, { exerciseTypePercentages: percentages });
        output.setText(`${percentages[type]}%`);
        for (const candidate of Array.from(mix.querySelectorAll<HTMLInputElement>("input[type=range]"))) {
          const candidateType = candidate.dataset.type as ExerciseType | undefined;
          if (candidateType !== undefined) candidate.value = String(percentages[candidateType]);
        }
      });
      slider.dataset.type = type;
    }
  }

  private renderSetPayloadPreviews(container: HTMLElement): void {
    const section = this.section(container, "Exact batch payloads", "Every set payload is computed before batch approval and contains the complete source bundle, aspect map, prerequisite chain, sibling briefs, global instructions, and local objective.");
    for (const preview of this.setPayloadPreviews) {
      const details = section.createEl("details", { cls: "practice-learning-path-payload" });
      const summary = details.createEl("summary");
      summary.createEl("strong", { text: preview.setTitle });
      const configuration = this.setStates.find((state) => state.id === preview.setId)?.configuration;
      const difficulty = configuration === undefined
        ? "Difficulty not available"
        : displayDifficulty(configuration.difficulty);
      summary.createSpan({ text: `${preview.providerLabel} · ${preview.modelLabel} · ${preview.reasoningEffortLabel} · ${difficulty}` });
      details.createEl("code", { text: preview.payloadHash });
      details.createEl("pre", { text: preview.text });
    }
    const actions = section.createDiv({ cls: "practice-learning-path-actions" });
    new ButtonComponent(actions)
      .setButtonText(this.setPayloadsAccepted ? "Complete batch approved" : "Approve complete batch")
      .setIcon(this.setPayloadsAccepted ? "check" : "shield-check")
      .setDisabled(this.setPayloadsAccepted || this.busy !== null)
      .onClick(() => { this.setPayloadsAccepted = true; this.render(); });
    new ButtonComponent(actions)
      .setButtonText(this.busy === "batch" ? "Generating sets sequentially…" : "Generate all sets")
      .setIcon("play")
      .setCta()
      .setDisabled(
        !this.setPayloadsAccepted
        || this.busy !== null
        || this.quickGenerationRecovery !== null,
      )
      .onClick(() => void this.generateAllSets());
  }

  private renderReview(container: HTMLElement): void {
    const blueprint = this.blueprint;
    if (blueprint === null) return;
    const navigator = this.section(container, "Batch navigator", "Sets run sequentially through one provider job coordinator. Completed drafts remain available if a later set fails.");
    const nav = navigator.createDiv({ cls: "practice-learning-path-set-navigator" });
    for (const state of this.setStates) {
      const brief = blueprint.draft.sets.find((set) => set.id === state.id);
      if (brief === undefined) continue;
      const status = this.statuses.get(state.id) ?? { state: "queued" as const };
      const button = nav.createEl("button", { cls: `practice-learning-path-nav-item is-${status.state}`, attr: { type: "button" } });
      setIcon(button.createSpan(), statusIcon(status.state));
      button.createEl("strong", { text: brief.title });
      button.createSpan({ text: statusLabel(status) });
      button.addEventListener("click", () => {
        if (this.generatedSets.some((set) => set.setId === state.id)) {
          this.activeReviewSetId = state.id;
          this.render();
        }
      });
    }
    if (this.busy === "batch") {
      new ButtonComponent(navigator)
        .setButtonText("Cancel current set and stop batch")
        .setIcon("square")
        .setDestructive()
        .onClick(() => void this.options.callbacks.cancelGeneration?.());
    } else if (
      this.recoveryAvailable
      && this.generatedSets.length < this.setStates.length
      && this.options.callbacks.resumeRecoverableBatch !== undefined
    ) {
      new ButtonComponent(navigator)
        .setButtonText("Retry remaining sets")
        .setIcon("history")
        .setCta()
        .onClick(() => void this.resumeRecovery());
    }

    const active = this.generatedSets.find((set) => set.setId === this.activeReviewSetId)
      ?? this.generatedSets[0];
    if (active === undefined) {
      const empty = container.createDiv({ cls: "practice-lab-empty" });
      empty.createEl("h3", { text: this.busy === "batch" ? "Generation in progress" : "No completed set yet" });
      empty.createEl("p", { text: "Safe agent activity appears in the navigator as each set is generated and validated." });
      this.renderActivity(empty);
      return;
    }
    this.activeReviewSetId = active.setId;
    const brief = blueprint.draft.sets.find((set) => set.id === active.setId);
    const review = this.section(container, brief?.title ?? active.setId, brief?.purpose ?? "Review this generated set before saving.");
    const approved = this.approvedBySet.get(active.setId) ?? new Set<string>();
    const toolbar = review.createDiv({ cls: "practice-learning-path-review-toolbar" });
    new ButtonComponent(toolbar)
      .setButtonText("Approve all valid text exercises")
      .setIcon("list-checks")
      .setTooltip("Approve every kept non-occlusion exercise in this set. Image masks still require explicit acceptance.")
      .onClick(() => {
        for (const exercise of active.exercises) {
          if (!exercise.rejected && exercise.type !== "image-occlusion") approved.add(exercise.id);
        }
        this.approvedBySet.set(active.setId, approved);
        this.render();
      });
    new ButtonComponent(toolbar)
      .setButtonText("Accept valid occlusions")
      .setIcon("scan")
      .setTooltip("Accept every kept occlusion whose current masks are valid. Invalid or missing masks remain blocked.")
      .onClick(() => {
        const exercises = active.exercises.map((exercise) => {
          if (exercise.rejected || exercise.type !== "image-occlusion") return exercise;
          const valid = validateOcclusionMasks(exercise.masks ?? []).valid;
          if (valid) approved.add(exercise.id);
          return { ...exercise, occlusionReviewed: valid };
        });
        this.generatedSets = this.generatedSets.map((set) => (
          set.setId === active.setId ? { ...set, exercises } : set
        ));
        this.approvedBySet.set(active.setId, approved);
        this.render();
      });
    review.createEl("p", { cls: "practice-lab-muted", text: `${approved.size} of ${active.exercises.filter((exercise) => !exercise.rejected).length} kept exercises approved.` });
    for (const [index, exercise] of active.exercises.entries()) {
      this.renderExerciseReview(review, active, exercise, index, approved);
    }
    const gate = this.reviewProblem();
    if (gate !== null) {
      const callout = container.createDiv({ cls: "practice-lab-callout is-warning" });
      setIcon(callout.createSpan(), "triangle-alert");
      callout.createSpan({ text: gate });
    }
    const actions = container.createDiv({ cls: "practice-learning-path-actions is-sticky" });
    new ButtonComponent(actions)
      .setButtonText(this.busy === "save" ? "Saving workspace atomically…" : "Save guided learning path")
      .setIcon("save")
      .setCta()
      .setDisabled(gate !== null || this.busy !== null)
      .onClick(() => void this.saveLearningPath());
  }

  private renderExerciseReview(
    container: HTMLElement,
    set: GeneratedLearningSetPresentationV1,
    exercise: EditableDraftExercise,
    index: number,
    approved: Set<string>,
  ): void {
    const card = container.createEl("article", { cls: `practice-learning-path-exercise${exercise.rejected ? " is-rejected" : ""}` });
    const heading = card.createDiv({ cls: "practice-learning-path-card-heading" });
    heading.createSpan({ cls: "practice-lab-badge", text: EXERCISE_LABELS[exercise.type] });
    heading.createEl("strong", { text: `Question ${index + 1}` });
    const keep = heading.createEl("label", { cls: "practice-learning-path-keep" });
    const keepInput = keep.createEl("input", { attr: { type: "checkbox" } });
    keepInput.checked = !exercise.rejected;
    keep.createSpan({ text: "Keep" });
    keepInput.addEventListener("change", () => {
      this.updateReviewExercise(set.setId, exercise.id, { rejected: !keepInput.checked });
      approved.delete(exercise.id);
      this.render();
    });
    if (exercise.rejected) return;
    const prompt = card.createEl("label");
    prompt.createSpan({ text: "Prompt" });
    const promptInput = prompt.createEl("textarea", { attr: { rows: "3" } });
    promptInput.value = exercise.prompt;
    promptInput.addEventListener("input", () => {
      this.updateReviewExercise(set.setId, exercise.id, { prompt: promptInput.value });
      approved.delete(exercise.id);
    });
    const answer = card.createEl("label");
    answer.createSpan({ text: "Grounded answer" });
    const answerInput = answer.createEl("textarea", { attr: { rows: "3" } });
    answerInput.value = exercise.groundedAnswer;
    answerInput.addEventListener("input", () => {
      this.updateReviewExercise(set.setId, exercise.id, { groundedAnswer: answerInput.value });
      approved.delete(exercise.id);
    });
    if (exercise.type === "image-occlusion") {
      if (exercise.visualUrl === undefined) {
        card.createEl("p", { cls: "practice-lab-callout is-error", text: "The selected visual is unavailable; reject this exercise or restore the durable snapshot." });
      } else {
        const editorHost = card.createDiv();
        const editor = new OcclusionEditor(editorHost, {
          imageUrl: exercise.visualUrl,
          imageAlt: exercise.title ?? exercise.prompt,
          masks: exercise.masks ?? [],
          reviewed: exercise.occlusionReviewed,
          onChange: (masks) => {
            approved.delete(exercise.id);
            this.updateReviewExercise(set.setId, exercise.id, { masks, occlusionReviewed: false });
          },
          onReviewed: (masks) => {
            approved.add(exercise.id);
            this.updateReviewExercise(set.setId, exercise.id, { masks, occlusionReviewed: true });
            this.approvedBySet.set(set.setId, approved);
            this.render();
          },
        });
        this.occlusionEditors.push(editor);
        this.addChild(editor);
      }
    } else {
      const approve = new ButtonComponent(card)
        .setButtonText(approved.has(exercise.id) ? "Approved" : "Approve exercise")
        .setIcon(approved.has(exercise.id) ? "check" : "circle-check")
        .setDisabled(approved.has(exercise.id));
      approve.onClick(() => {
        approved.add(exercise.id);
        this.approvedBySet.set(set.setId, approved);
        this.render();
      });
    }
  }

  private renderSaved(container: HTMLElement): void {
    const workspace = this.savedWorkspace;
    const complete = container.createDiv({ cls: "practice-lab-complete" });
    const icon = complete.createDiv({ cls: "practice-lab-complete-icon" });
    setIcon(icon, "route");
    complete.createEl("h3", { text: workspace === null ? "Learning path saved" : "Manage learning path" });
    complete.createEl("p", { text: "Tutor lessons, named sets, exact source provenance, and the editable path now live in the source’s existing practice Markdown workspace." });
    complete.createEl("p", { cls: "practice-lab-muted", text: "Saved paths and review sessions work on mobile. AI planning and generation remain desktop-only." });
    if (workspace === null) return;

    const path = workspace.bank.learningPath;
    if (path === null) {
      container.createEl("p", { cls: "practice-lab-callout is-error", text: "This workspace no longer contains a learning path." });
      return;
    }
    const actions = container.createDiv({ cls: "practice-learning-path-actions is-sticky" });
    this.savedAction(actions, "Continue learning", "play", "continue", true);
    this.savedAction(actions, "Choose a set", "list", "choose-set", false);
    this.savedAction(actions, "Mixed practice", "shuffle", "mixed", false);
    this.savedAction(actions, "Open Markdown workspace", "file-text", "open-bank", false);

    const identity = this.section(container, "Path identity", "Rename the path without changing its grounded content, sessions, or source provenance.");
    const title = identity.createEl("input", {
      cls: "practice-learning-path-set-title",
      attr: { type: "text", "aria-label": "Learning-path title" },
    });
    title.value = path.title;
    title.addEventListener("input", () => {
      if (this.savedWorkspace === null || this.savedWorkspace.bank.learningPath === null) return;
      this.savedWorkspace.bank.learningPath.title = title.value;
      this.savedWorkspaceDirty = true;
    });

    const sets = this.section(container, "Named practice sets", "Titles and purposes can be refined here. Exercise assignments, tutor links, and historical evidence keep their stable IDs.");
    for (const set of [...workspace.bank.practiceSets].sort((left, right) => left.order - right.order)) {
      const card = sets.createEl("article", { cls: "practice-learning-path-set-card" });
      const heading = card.createDiv({ cls: "practice-learning-path-set-heading" });
      heading.createSpan({ cls: "practice-learning-path-set-order", text: String(set.order + 1) });
      const text = heading.createDiv();
      const setTitle = text.createEl("input", {
        cls: "practice-learning-path-set-title",
        attr: { type: "text", "aria-label": `Title for ${set.title}` },
      });
      setTitle.value = set.title;
      setTitle.addEventListener("input", () => {
        set.title = setTitle.value;
        this.savedWorkspaceDirty = true;
      });
      text.createSpan({ cls: "practice-lab-badge", text: set.instructionalRole.replaceAll("-", " ") });
      const purpose = card.createEl("textarea", {
        attr: { rows: "2", "aria-label": `Purpose for ${set.title}` },
      });
      purpose.value = set.purpose;
      purpose.addEventListener("input", () => {
        set.purpose = purpose.value;
        this.savedWorkspaceDirty = true;
      });
      const lessonCount = workspace.bank.tutorLessons.filter((lesson) => (
        set.assignments.some((assignment) => assignment.exerciseId === lesson.guidedExerciseId)
      )).length;
      card.createEl("p", {
        cls: "practice-lab-muted",
        text: `${set.assignments.length} ${set.assignments.length === 1 ? "exercise" : "exercises"} · ${lessonCount} tutor ${lessonCount === 1 ? "lesson" : "lessons"}`,
      });
      if (this.options.callbacks.regenerateSavedSet !== undefined) {
        new ButtonComponent(card)
          .setButtonText("Regenerate / tweak this set")
          .setIcon("refresh-cw")
          .setDisabled(this.busy !== null)
          .onClick(() => {
            if (this.savedWorkspaceDirty) {
              new Notice("Save the edited path labels before regenerating a set.", 6_000);
              return;
            }
            if (this.savedWorkspace !== null) {
              void this.options.callbacks.regenerateSavedSet?.(
                this.savedWorkspace,
                set.id,
              );
            }
          });
      }
    }
    if (this.options.callbacks.saveManagedWorkspace !== undefined) {
      new ButtonComponent(sets)
        .setButtonText(this.busy === "save" ? "Saving changes…" : "Save path labels")
        .setIcon("save")
        .setCta()
        .setDisabled(!this.savedWorkspaceDirty || this.busy !== null)
        .onClick(() => void this.saveManagedWorkspace());
    }
  }

  private savedAction(
    container: HTMLElement,
    label: string,
    icon: string,
    action: "continue" | "choose-set" | "mixed" | "open-bank",
    cta: boolean,
  ): void {
    const button = new ButtonComponent(container)
      .setButtonText(label)
      .setIcon(icon)
      .setDisabled(this.busy !== null)
      .onClick(() => {
        if (this.savedWorkspace !== null) {
          void this.options.callbacks.useSavedWorkspace?.(this.savedWorkspace, action);
        }
      });
    if (cta) button.setCta();
  }

  private async saveManagedWorkspace(): Promise<void> {
    const workspace = this.savedWorkspace;
    const save = this.options.callbacks.saveManagedWorkspace;
    if (workspace === null || save === undefined || this.busy !== null) return;
    this.busy = "save";
    this.error = null;
    this.render();
    try {
      this.savedWorkspace = await save({
        path: workspace.path,
        bank: structuredClone(workspace.bank),
      });
      this.savedWorkspaceDirty = false;
      new Notice("Learning-path labels saved.", 6_000);
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private renderProviderControls(container: HTMLElement): void {
    const grid = container.createDiv({ cls: "practice-learning-path-provider-grid" });
    const providerLabel = grid.createEl("label");
    providerLabel.createSpan({ text: "Planning provider" });
    const provider = providerLabel.createEl("select");
    for (const entry of this.providers) {
      const option = provider.createEl("option", { value: entry.id, text: entry.available ? entry.label : `${entry.label} (unavailable)` });
      option.disabled = !entry.available;
    }
    provider.value = this.blueprintConfiguration.provider;
    provider.addEventListener("change", () => {
      const id = provider.value as ProviderId;
      const selected = this.providers.find((entry) => entry.id === id);
      this.blueprintConfiguration = {
        ...this.blueprintConfiguration,
        provider: id,
        model: selected?.defaultModel ?? "",
        reasoningEffort: selected?.reasoningEfforts[0] ?? "medium",
      };
      this.invalidatePlanningPreview();
      this.render();
    });
    const selected = this.providers.find((entry) => entry.id === this.blueprintConfiguration.provider);
    const modelLabel = grid.createEl("label");
    modelLabel.createSpan({ text: "Planning model" });
    const model = modelLabel.createEl("select");
    for (const entry of selected?.models ?? []) model.createEl("option", { value: entry.id, text: entry.label });
    if ((selected?.models.length ?? 0) === 0) model.createEl("option", { value: "", text: "Automatic" });
    model.value = this.blueprintConfiguration.model;
    model.addEventListener("change", () => {
      this.blueprintConfiguration = { ...this.blueprintConfiguration, model: model.value };
      this.invalidatePlanningPreview();
    });
    const reasoningLabel = grid.createEl("label");
    reasoningLabel.createSpan({ text: "Planning reasoning" });
    const reasoning = reasoningLabel.createEl("select", { attr: { title: "Higher reasoning may take longer. The installed default timeout is three hours." } });
    for (const effort of selected?.reasoningEfforts ?? []) reasoning.createEl("option", { value: effort, text: displayReasoningEffort(effort) });
    reasoning.value = this.blueprintConfiguration.reasoningEffort;
    reasoning.addEventListener("change", () => {
      this.blueprintConfiguration = { ...this.blueprintConfiguration, reasoningEffort: reasoning.value as ReasoningEffort };
      this.invalidatePlanningPreview();
    });
  }

  private renderSourceChoiceButtons(container: HTMLElement, cta = false): void {
    const actions = container.createDiv({ cls: "practice-learning-path-actions" });
    const choices: ReadonlyArray<readonly ["note" | "selection" | "pdf", string, string]> = [
      ["note", "Use current note", "file-text"],
      ["selection", "Use current selection", "text-select"],
      ["pdf", "Choose PDF pages", "file-scan"],
    ];
    choices.forEach(([mode, label, icon], index) => {
      const button = new ButtonComponent(actions)
        .setButtonText(label)
        .setIcon(icon)
        .setDisabled(this.busy !== null)
        .onClick(() => void this.choosePrimarySource(mode));
      if (cta && index === 0) button.setCta();
    });
  }

  private renderSourceCard(container: HTMLElement, source: SourcePresentation, role: string, remove: () => void): void {
    const card = container.createDiv({ cls: "practice-learning-path-source-card" });
    const icon = card.createDiv({ cls: "practice-learning-path-source-icon" });
    setIcon(icon, source.mode === "pdf" ? "file-scan" : "file-text");
    const text = card.createDiv({ cls: "practice-learning-path-source-copy" });
    text.createSpan({ cls: "practice-lab-badge", text: role });
    text.createEl("strong", { text: source.title });
    text.createEl("p", { text: source.detail ?? `${source.characterCount.toLocaleString()} submitted characters` });
    this.iconButton(card, "x", `Remove ${role.toLowerCase()} source`, this.busy !== null || this.visualSelectionBusy, remove);
    this.renderSourceVisuals(card, source);
  }

  private renderVisualBundleControls(container: HTMLElement): void {
    const sources = this.approvedSources();
    const visualCount = sources.reduce((total, source) => total + source.visuals.length, 0);
    if (visualCount === 0) {
      container.createEl("p", {
        cls: "practice-lab-muted practice-learning-path-visual-empty",
        text: "No separate supported visual was detected in the approved bundle. PDF text remains limited to the chosen page range.",
      });
      return;
    }

    const selectedCount = sources.reduce(
      (total, source) => total + source.visuals.filter((visual) => visual.selected).length,
      0,
    );
    const toolbar = container.createDiv({ cls: "practice-learning-path-visual-toolbar" });
    const defaultLabel = toolbar.createEl("label", { cls: "practice-learning-path-gif-default" });
    defaultLabel.createSpan({ text: "Default GIF frame" });
    const defaultSelect = defaultLabel.createEl("select", {
      attr: {
        "aria-label": "Default GIF frame for newly selected animations",
        "aria-description": "Select all images uses this frame automatically. You can still choose a different frame on any GIF.",
      },
    });
    for (const position of GIF_FRAME_POSITIONS) {
      defaultSelect.createEl("option", {
        value: position,
        text: displayGifFramePosition(position),
      });
    }
    defaultSelect.value = this.gifFrameDefault;
    defaultSelect.disabled = this.visualSelectionBusy;
    defaultSelect.addEventListener("change", () => {
      void this.setGifFrameDefault(defaultSelect.value as GifFramePosition);
    });

    new ButtonComponent(toolbar)
      .setButtonText(this.visualSelectionBusy ? "Updating images…" : "Select all images")
      .setIcon("list-checks")
      .setTooltip("Select every available local image. GIFs without an explicit frame use the configured default; existing overrides are preserved. Videos and remote images still require explicit review.")
      .setDisabled(this.visualSelectionBusy || this.busy !== null)
      .onClick(() => void this.selectAllSourceImages());
    new ButtonComponent(toolbar)
      .setButtonText("Deselect all")
      .setIcon("square-x")
      .setTooltip("Remove every visual from the planning and set-generation payloads without changing the source files.")
      .setDisabled(this.visualSelectionBusy || this.busy !== null || selectedCount === 0)
      .onClick(() => void this.deselectAllSourceImages());
    toolbar.createSpan({
      cls: "practice-learning-path-visual-count",
      text: `${selectedCount} of ${visualCount} selected`,
      attr: { "aria-live": "polite" },
    });
    if (this.visualSelectionMessage !== null) {
      container.createEl("p", {
        cls: "practice-lab-muted practice-learning-path-visual-message",
        text: this.visualSelectionMessage,
        attr: { "aria-live": "polite" },
      });
    }
  }

  private renderSourceVisuals(container: HTMLElement, source: SourcePresentation): void {
    if (source.visuals.length === 0) return;
    const selected = source.visuals.filter((visual) => visual.selected).length;
    const details = container.createEl("details", { cls: "practice-learning-path-visuals" });
    const scopeKey = this.sourceScopeKey(source);
    details.open = this.expandedVisualSources.has(scopeKey);
    details.addEventListener("toggle", () => {
      if (details.open) this.expandedVisualSources.add(scopeKey);
      else this.expandedVisualSources.delete(scopeKey);
    });
    const summary = details.createEl("summary");
    const summaryIcon = summary.createSpan({ cls: "practice-learning-path-visual-summary-icon" });
    setIcon(summaryIcon, "images");
    summary.createSpan({
      text: `${source.visuals.length} detected ${source.visuals.length === 1 ? "visual" : "visuals"}`,
    });
    summary.createSpan({
      cls: "practice-learning-path-visual-summary-count",
      text: `${selected} selected`,
    });
    const grid = details.createDiv({ cls: "practice-learning-path-visual-grid" });
    for (const visual of source.visuals) this.renderVisualCard(grid, source, visual);
  }

  private renderVisualCard(
    container: HTMLElement,
    source: SourcePresentation,
    visual: DetectedVisual,
  ): void {
    const card = container.createEl("article", {
      cls: `practice-learning-path-visual-card is-${visual.state}${visual.selected ? " is-selected" : ""}`,
    });
    if (visual.previewUrl !== undefined) {
      card.createEl("img", {
        cls: "practice-learning-path-visual-preview",
        attr: {
          src: visual.previewUrl,
          alt: `Preview of ${displayVisualName(visual)}`,
          loading: "lazy",
        },
      });
    } else {
      const placeholder = card.createDiv({ cls: "practice-learning-path-visual-placeholder", attr: { "aria-hidden": "true" } });
      setIcon(placeholder, visual.kind === "video" ? "video" : "image-off");
    }
    const heading = card.createDiv({ cls: "practice-learning-path-visual-heading" });
    const copy = heading.createDiv();
    copy.createEl("strong", { text: displayVisualName(visual) });
    copy.createSpan({ text: VISUAL_LABELS[visual.kind] });
    heading.createSpan({
      cls: "practice-lab-status-pill",
      text: visual.state.replaceAll("-", " "),
    });
    if (visual.reason !== undefined) {
      card.createEl("p", { cls: "practice-learning-path-visual-reason", text: visual.reason });
    }

    const controls = card.createDiv({ cls: "practice-learning-path-visual-controls" });
    if (visual.state === "ready") {
      const label = controls.createEl("label", { cls: "practice-lab-checkbox" });
      const checkbox = label.createEl("input", {
        attr: {
          type: "checkbox",
          "aria-label": `Use ${displayVisualName(visual)} for generation`,
        },
      });
      checkbox.checked = visual.selected;
      checkbox.disabled = this.visualSelectionBusy || this.busy !== null;
      label.createSpan({ text: "Use for generation" });
      checkbox.addEventListener("change", () => {
        void this.commitVisual(source, { ...visual, selected: checkbox.checked });
      });
      if (isGifVisual(visual)) this.renderGifFrameChoice(controls, source, visual);
      else if (visual.frameSourcePath !== undefined) {
        new ButtonComponent(controls)
          .setButtonText("Choose another still")
          .setIcon("scan-line")
          .setTooltip("Open the video frame picker. The original video is never modified.")
          .setDisabled(this.visualSelectionBusy || this.busy !== null || this.options.callbacks.chooseMediaFrame === undefined)
          .onClick(() => void this.resolveVisualFrame(source, visual));
      }
      return;
    }

    if (visual.state === "frame-required") {
      if (isGifVisual(visual)) {
        card.createEl("p", {
          cls: "practice-learning-path-visual-help",
          text: `Selecting this GIF will extract the ${displayGifFramePosition(this.gifFrameDefault).toLowerCase()} by default. Choose another position here whenever this animation needs a different frame.`,
        });
        this.renderGifFrameChoice(controls, source, visual);
      } else {
        card.createEl("p", {
          cls: "practice-learning-path-visual-help",
          text: "Videos are never uploaded directly. Choose one still frame explicitly; the original video remains unchanged.",
        });
        new ButtonComponent(controls)
          .setButtonText("Choose still frame")
          .setIcon("scan-line")
          .setTooltip("Open sampled video frames and select the exact still image to use.")
          .setDisabled(this.visualSelectionBusy || this.busy !== null || this.options.callbacks.chooseMediaFrame === undefined)
          .onClick(() => void this.resolveVisualFrame(source, visual));
      }
      return;
    }

    if (visual.state === "consent-required") {
      const host = visual.remoteHost ?? "the remote host";
      card.createEl("p", {
        cls: "practice-learning-path-visual-help",
        text: `This image stays excluded until you explicitly preview and import one local snapshot from ${host}. The source note is not rewritten.`,
      });
      if (this.options.callbacks.importRemoteVisual !== undefined) {
        new ButtonComponent(controls)
          .setButtonText("Preview and import…")
          .setIcon("download")
          .setTooltip(`Preview the remote image from ${host}, then choose whether to preserve a local snapshot.`)
          .setDisabled(this.visualSelectionBusy || this.busy !== null)
          .onClick(() => void this.importRemoteSourceVisual(source, visual));
      } else {
        controls.createSpan({ cls: "practice-lab-muted", text: "Remote import is unavailable on this device." });
      }
      return;
    }

    const unavailable = visual.state === "cache-missing"
      ? "The Notability cache preview is missing. Refresh that region before building this path."
      : visual.state === "missing"
        ? "The local attachment could not be resolved. Restore or relink it in the source note first."
        : "This visual is invalid and cannot be sent to an AI provider.";
    card.createEl("p", { cls: "practice-learning-path-visual-help", text: unavailable });
  }

  private renderGifFrameChoice(
    container: HTMLElement,
    source: SourcePresentation,
    visual: DetectedVisual,
  ): void {
    const label = container.createEl("label", { cls: "practice-learning-path-frame-choice" });
    label.createSpan({ text: "GIF frame" });
    const select = label.createEl("select", {
      attr: {
        "aria-label": `GIF frame for ${displayVisualName(visual)}`,
        "aria-description": "This choice overrides the configured default for this GIF only.",
      },
    });
    for (const position of GIF_FRAME_POSITIONS) {
      select.createEl("option", {
        value: position,
        text: `${displayGifFramePosition(position)}${position === this.gifFrameDefault ? " (default)" : ""}`,
      });
    }
    select.value = visual.framePosition ?? this.gifFrameDefault;
    select.disabled = this.visualSelectionBusy
      || this.busy !== null
      || this.options.callbacks.chooseMediaFrame === undefined;
    select.addEventListener("change", () => {
      void this.resolveVisualFrame(source, visual, select.value as GifFramePosition);
    });
  }

  private approvedSources(): SourcePresentation[] {
    return this.primary === null ? [] : [this.primary, ...this.supporting];
  }

  private sourceScopeKey(source: SourcePresentation): string {
    return JSON.stringify([
      source.mode,
      source.path,
      source.title,
      source.detail ?? "",
      source.excerpt,
    ]);
  }

  private currentSource(source: SourcePresentation): SourcePresentation | null {
    return this.approvedSources().find((candidate) => sameSourceScope(candidate, source)) ?? null;
  }

  private applySourcePresentation(
    previous: SourcePresentation,
    replacement: SourcePresentation,
  ): void {
    if (this.primary !== null && sameSourceScope(this.primary, previous)) {
      this.primary = replacement;
      return;
    }
    this.supporting = this.supporting.map((source) => (
      sameSourceScope(source, previous) ? replacement : source
    ));
  }

  private async syncSourcePresentation(
    previous: SourcePresentation,
    replacement: SourcePresentation,
  ): Promise<SourcePresentation> {
    const update = this.options.callbacks.updateSourceVisuals;
    if (update === undefined) return replacement;
    const synced = await update(replacement);
    if (!sameSourceScope(previous, synced)) {
      throw new Error("The updated visual selection no longer matches its approved source scope.");
    }
    return synced;
  }

  private async commitVisual(
    source: SourcePresentation,
    replacement: DetectedVisual,
  ): Promise<void> {
    if (this.visualSelectionBusy || this.busy !== null) return;
    const current = this.currentSource(source);
    if (current === null) return;
    const updated = replaceLearningPathVisual(current, replacement);
    this.visualSelectionBusy = true;
    this.visualSelectionMessage = null;
    this.applySourcePresentation(current, updated);
    this.invalidatePlanningPreview();
    this.render();
    try {
      const synced = await this.syncSourcePresentation(current, updated);
      this.applySourcePresentation(updated, synced);
    } catch (error) {
      this.applySourcePresentation(updated, current);
      this.visualSelectionMessage = `The visual change was not saved: ${errorMessage(error)}`;
      new Notice(this.visualSelectionMessage, 8_000);
    } finally {
      this.visualSelectionBusy = false;
      this.render();
    }
  }

  private async resolveVisualFrame(
    source: SourcePresentation,
    visual: DetectedVisual,
    position?: GifFramePosition,
  ): Promise<void> {
    const choose = this.options.callbacks.chooseMediaFrame;
    if (choose === undefined || this.visualSelectionBusy || this.busy !== null) return;
    this.visualSelectionBusy = true;
    this.visualSelectionMessage = null;
    this.render();
    try {
      const resolved = await choose(visual, position);
      if (resolved === null) return;
      const current = this.currentSource(source);
      if (current === null) return;
      const updated = replaceLearningPathVisual(current, resolved);
      const synced = await this.syncSourcePresentation(current, updated);
      this.applySourcePresentation(current, synced);
      this.invalidatePlanningPreview();
    } catch (error) {
      this.visualSelectionMessage = `Could not prepare that frame: ${errorMessage(error)}`;
      new Notice(this.visualSelectionMessage, 8_000);
    } finally {
      this.visualSelectionBusy = false;
      this.render();
    }
  }

  private async importRemoteSourceVisual(
    source: SourcePresentation,
    visual: DetectedVisual,
  ): Promise<void> {
    const importer = this.options.callbacks.importRemoteVisual;
    if (importer === undefined || this.visualSelectionBusy || this.busy !== null) return;
    this.visualSelectionBusy = true;
    this.visualSelectionMessage = null;
    this.render();
    try {
      const imported = await importer(visual);
      if (imported === null) return;
      const current = this.currentSource(source);
      if (current === null) return;
      const updated = replaceLearningPathVisual(current, imported);
      const synced = await this.syncSourcePresentation(current, updated);
      this.applySourcePresentation(current, synced);
      this.invalidatePlanningPreview();
    } catch (error) {
      this.visualSelectionMessage = `Could not import that remote image: ${errorMessage(error)}`;
      new Notice(this.visualSelectionMessage, 8_000);
    } finally {
      this.visualSelectionBusy = false;
      this.render();
    }
  }

  private async setGifFrameDefault(position: GifFramePosition): Promise<void> {
    if (this.visualSelectionBusy) return;
    const previous = this.gifFrameDefault;
    this.visualSelectionBusy = true;
    this.gifFrameDefault = position;
    this.visualSelectionMessage = `Newly selected GIFs will use the ${displayGifFramePosition(position).toLowerCase()}. Existing per-GIF choices are unchanged.`;
    this.render();
    try {
      await this.options.callbacks.updateGifFrameDefault?.(position);
    } catch (error) {
      this.gifFrameDefault = previous;
      this.visualSelectionMessage = `Could not save the GIF default: ${errorMessage(error)}`;
      new Notice(this.visualSelectionMessage, 8_000);
    } finally {
      this.visualSelectionBusy = false;
      this.render();
    }
  }

  private async selectAllSourceImages(): Promise<void> {
    if (this.visualSelectionBusy || this.busy !== null) return;
    const choose = this.options.callbacks.chooseMediaFrame;
    const originals = this.approvedSources();
    this.visualSelectionBusy = true;
    this.visualSelectionMessage = null;
    this.render();
    let selectedCount = 0;
    let skippedCount = 0;
    const failures: string[] = [];
    try {
      for (const original of originals) {
        let updated = original;
        for (const visual of original.visuals) {
          if (visual.state === "ready") {
            updated = replaceLearningPathVisual(updated, { ...visual, selected: true });
            selectedCount += 1;
            continue;
          }
          if (visual.state === "frame-required" && isGifVisual(visual) && choose !== undefined) {
            try {
              const resolved = await choose(visual, this.gifFrameDefault);
              if (resolved !== null) {
                updated = replaceLearningPathVisual(updated, resolved);
                selectedCount += 1;
                continue;
              }
            } catch (error) {
              failures.push(`${displayVisualName(visual)}: ${errorMessage(error)}`);
            }
          }
          skippedCount += 1;
        }
        const synced = await this.syncSourcePresentation(original, updated);
        this.applySourcePresentation(original, synced);
      }
      this.invalidatePlanningPreview();
      this.visualSelectionMessage = skippedCount === 0
        ? `Selected all ${selectedCount} detected visuals.`
        : `Selected ${selectedCount} available visuals. ${skippedCount} ${skippedCount === 1 ? "visual still requires" : "visuals still require"} explicit review or is unavailable.`;
      for (const failure of failures) new Notice(`Could not prepare ${failure}`, 8_000);
    } catch (error) {
      for (const original of originals) {
        const current = this.currentSource(original);
        if (current !== null) this.applySourcePresentation(current, original);
        try {
          await this.options.callbacks.updateSourceVisuals?.(original);
        } catch {
          // Preserve the local approved bundle and surface the original failure.
        }
      }
      this.visualSelectionMessage = `The bulk visual selection was not saved: ${errorMessage(error)}`;
      new Notice(this.visualSelectionMessage, 8_000);
    } finally {
      this.visualSelectionBusy = false;
      this.render();
    }
  }

  private async deselectAllSourceImages(): Promise<void> {
    if (this.visualSelectionBusy || this.busy !== null) return;
    const originals = this.approvedSources();
    this.visualSelectionBusy = true;
    this.visualSelectionMessage = null;
    this.render();
    try {
      for (const original of originals) {
        const updated = setLearningPathVisualSelection(original, false);
        const synced = await this.syncSourcePresentation(original, updated);
        this.applySourcePresentation(original, synced);
      }
      this.invalidatePlanningPreview();
      this.visualSelectionMessage = "All visuals are excluded from the AI payload. Original files are unchanged.";
    } catch (error) {
      for (const original of originals) {
        const current = this.currentSource(original);
        if (current !== null) this.applySourcePresentation(current, original);
        try {
          await this.options.callbacks.updateSourceVisuals?.(original);
        } catch {
          // Preserve the local approved bundle and surface the original failure.
        }
      }
      this.visualSelectionMessage = `The bulk visual change was not saved: ${errorMessage(error)}`;
      new Notice(this.visualSelectionMessage, 8_000);
    } finally {
      this.visualSelectionBusy = false;
      this.render();
    }
  }

  private renderActivity(container: HTMLElement): void {
    const events = [...this.activity.values()].flat().slice(-12);
    if (events.length === 0) return;
    const details = container.createEl("details", { cls: "practice-learning-path-activity", attr: { open: "" } });
    details.createEl("summary", { text: "Live agent activity" });
    const list = details.createEl("ol");
    for (const event of events) list.createEl("li", { text: `${event.phase}: ${event.message}` });
  }

  private async choosePrimarySource(mode: "note" | "selection" | "pdf"): Promise<void> {
    if (this.busy !== null) return;
    this.busy = "source";
    this.error = null;
    this.render();
    try {
      const source = await this.options.callbacks.requestPrimarySource(mode);
      if (source !== null) this.setPrimarySource(source);
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private async addSupportingSource(): Promise<void> {
    if (this.busy !== null || this.supporting.length >= 4) return;
    this.busy = "source";
    this.error = null;
    this.render();
    try {
      const source = await this.options.callbacks.requestSupportingSource();
      if (source !== null) {
        const duplicate = [this.primary, ...this.supporting].some((candidate) => (
          candidate?.path === source.path && candidate.mode === source.mode && candidate.detail === source.detail
        ));
        if (duplicate) throw new Error("That exact source scope is already in the approved bundle.");
        this.supporting = [...this.supporting, source];
        this.resetAfterSourceChange();
      }
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private async previewPlanningPayload(): Promise<void> {
    const primary = this.primary;
    if (primary === null || this.busy !== null) return;
    this.busy = "preview";
    this.error = null;
    this.render();
    try {
      this.preview = await this.options.callbacks.previewBlueprint(primary, this.supporting, this.blueprintConfiguration);
      this.previewAccepted = false;
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private async generateBlueprint(): Promise<void> {
    const primary = this.primary;
    if (primary === null || this.busy !== null || !this.previewAccepted) return;
    if (this.quickGenerationRecovery !== null) {
      this.error = "Resolve the saved Quick set recovery above before starting Guided path generation.";
      this.render();
      return;
    }
    this.busy = "blueprint";
    this.error = null;
    this.activity.clear();
    this.render();
    try {
      const result = await this.options.callbacks.generateBlueprint(
        primary,
        this.supporting,
        this.blueprintConfiguration,
        (event) => {
          this.activity.set("blueprint", [...(this.activity.get("blueprint") ?? []), event].slice(-40));
        },
      );
      this.blueprint = result;
      this.setStates = result.draft.sets.map((set) => this.editableSetState(
        set.id,
        this.defaultSetConfiguration(
          set.recommendedQuantity,
          set.recommendedDifficulty,
          result.planningInput,
        ),
        false,
      ));
      this.stage = "map";
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private async previewSetPayloads(): Promise<void> {
    const blueprint = this.blueprint;
    if (blueprint === null || this.busy !== null || this.mapProblem() !== null) return;
    this.busy = "payloads";
    this.error = null;
    this.render();
    try {
      this.setPayloadPreviews = await this.options.callbacks.previewSetPayloads(blueprint, this.setConfigurations());
      this.setPayloadsAccepted = false;
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private async generateAllSets(): Promise<void> {
    const blueprint = this.blueprint;
    if (blueprint === null || this.busy !== null || !this.setPayloadsAccepted) return;
    if (this.quickGenerationRecovery !== null) {
      this.error = "Resolve the saved Quick set recovery above before generating the guided sets.";
      this.render();
      return;
    }
    this.busy = "batch";
    this.error = null;
    this.stage = "review";
    this.statuses = new Map(this.setStates.map((state) => [state.id, { state: "queued" as const }]));
    this.generatedSets = [];
    this.render();
    try {
      const result = await this.options.callbacks.generateAllSets(
        blueprint,
        this.setConfigurations(),
        (setId, status) => {
          this.statuses.set(setId, status);
          this.render();
        },
        (setId, event) => {
          this.activity.set(setId, [...(this.activity.get(setId) ?? []), event].slice(-40));
        },
      );
      this.generatedSets = result.map((set) => ({
        ...set,
        exercises: set.exercises.map(editableDraft),
      }));
      this.approvedBySet = new Map(result.map((set) => [set.setId, new Set<string>()]));
      this.activeReviewSetId = result[0]?.setId ?? null;
      for (const set of result) this.statuses.set(set.setId, { state: "review" });
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private async saveLearningPath(): Promise<void> {
    const primary = this.primary;
    const blueprint = this.blueprint;
    if (primary === null || blueprint === null || this.busy !== null || this.reviewProblem() !== null) return;
    this.busy = "save";
    this.error = null;
    this.render();
    try {
      this.savedWorkspace = await this.options.callbacks.saveLearningPath({
        primary,
        supporting: this.supporting,
        blueprint: blueprint.draft,
        planningInput: blueprint.planningInput,
        configurations: this.setConfigurations(),
        sets: this.generatedSets.map((set) => ({
          ...set,
          approvedExerciseIds: [...(this.approvedBySet.get(set.setId) ?? [])],
        })),
      });
      this.savedWorkspaceDirty = false;
      this.stage = "saved";
      this.recoveryAvailable = false;
      for (const state of this.setStates) this.statuses.set(state.id, { state: "saved" });
      new Notice("Guided learning path saved in the source practice workspace.", 8_000);
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private defaultSetConfiguration(
    quantity: number,
    difficulty: Difficulty,
    planning: LearningBlueprintPlanningInputV1,
  ): GenerationConfiguration {
    return {
      provider: this.blueprintConfiguration.provider,
      model: this.blueprintConfiguration.model,
      reasoningEffort: this.blueprintConfiguration.reasoningEffort,
      focusInstructions: "",
      quantity,
      difficulty,
      exerciseTypes: enabledExerciseTypes(RECOMMENDED_EXERCISE_TYPE_PERCENTAGES),
      exerciseTypePercentages: copyExerciseTypePercentages(RECOMMENDED_EXERCISE_TYPE_PERCENTAGES),
      selectedVisualIds: planning.sources.flatMap((source) => source.visuals.map((visual) => visual.id)),
    };
  }

  private setConfigurations(): Array<{ readonly setId: string; readonly configuration: GenerationConfiguration }> {
    return this.setStates.map((state) => ({
      setId: state.id,
      configuration: {
        ...state.configuration,
        exerciseTypes: enabledExerciseTypes(state.configuration.exerciseTypePercentages),
        exerciseTypePercentages: { ...state.configuration.exerciseTypePercentages },
        selectedVisualIds: [...state.configuration.selectedVisualIds],
      },
    }));
  }

  private updateSetConfiguration(setId: string, patch: Partial<GenerationConfiguration>): void {
    const state = this.setStates.find((candidate) => candidate.id === setId);
    if (state === undefined) return;
    state.configuration = {
      ...state.configuration,
      ...patch,
      exerciseTypes: enabledExerciseTypes(
        patch.exerciseTypePercentages ?? state.configuration.exerciseTypePercentages,
      ),
    };
    this.invalidateSetPayloads();
  }

  private updateBrief(setId: string, patch: { readonly title?: string; readonly purpose?: string }): void {
    const blueprint = this.blueprint;
    if (blueprint === null) return;
    this.blueprint = {
      ...blueprint,
      draft: {
        ...blueprint.draft,
        sets: blueprint.draft.sets.map((set) => set.id === setId ? { ...set, ...patch } : set),
      },
    };
    this.invalidateSetPayloads();
  }

  private moveSet(setId: string, targetIndex: number): void {
    const from = this.setStates.findIndex((state) => state.id === setId);
    if (from < 0 || targetIndex < 0 || targetIndex >= this.setStates.length || from === targetIndex) return;
    const states = [...this.setStates];
    const removed = states.splice(from, 1)[0];
    if (removed === undefined) return;
    states.splice(targetIndex, 0, removed);
    this.setStates = states;
    this.reorderBlueprintSets();
    this.invalidateSetPayloads();
    this.render();
  }

  private addSet(): void {
    const blueprint = this.blueprint;
    if (blueprint === null || this.setStates.length >= MAX_LEARNING_PATH_SETS) return;
    const id = `set-custom-${crypto.randomUUID()}`;
    const supported = blueprint.draft.aspects.filter((aspect) => aspect.status === "supported").map((aspect) => aspect.id);
    const set = {
      id,
      title: `Focused set ${this.setStates.length + 1}`,
      purpose: "Define the distinct source-grounded objective for this set.",
      instructionalRole: "general" as const,
      order: this.setStates.length,
      aspectIds: supported,
      tutorLessonBriefIds: [],
      recommendedQuantity: Math.min(10, Math.max(1, MAX_LEARNING_PATH_EXERCISES - this.totalExercises())),
      recommendedDifficulty: "deep-exam" as const,
    };
    this.blueprint = { ...blueprint, draft: { ...blueprint.draft, sets: [...blueprint.draft.sets, set] } };
    this.setStates.push(this.editableSetState(
      id,
      this.defaultSetConfiguration(
        set.recommendedQuantity,
        set.recommendedDifficulty,
        blueprint.planningInput,
      ),
      true,
    ));
    this.invalidateSetPayloads();
    this.render();
  }

  private removeSet(setId: string): void {
    const blueprint = this.blueprint;
    if (blueprint === null || this.setStates.length <= MIN_LEARNING_PATH_SETS) return;
    const removed = blueprint.draft.sets.find((set) => set.id === setId);
    const lessonIds = new Set(removed?.tutorLessonBriefIds ?? []);
    this.setStates = this.setStates.filter((state) => state.id !== setId);
    this.blueprint = {
      ...blueprint,
      draft: {
        ...blueprint.draft,
        sets: blueprint.draft.sets.filter((set) => set.id !== setId),
        tutorLessonBriefs: blueprint.draft.tutorLessonBriefs.filter((lesson) => !lessonIds.has(lesson.id)),
      },
    };
    this.reorderBlueprintSets();
    this.invalidateSetPayloads();
    this.render();
  }

  private removeGap(aspectId: string): void {
    const blueprint = this.blueprint;
    if (blueprint === null) return;
    this.blueprint = {
      ...blueprint,
      draft: {
        ...blueprint.draft,
        aspects: blueprint.draft.aspects
          .filter((aspect) => aspect.id !== aspectId)
          .map((aspect) => ({ ...aspect, prerequisiteAspectIds: aspect.prerequisiteAspectIds.filter((id) => id !== aspectId) })),
      },
    };
    this.invalidateSetPayloads();
    this.render();
  }

  private reorderBlueprintSets(): void {
    const blueprint = this.blueprint;
    if (blueprint === null) return;
    const byId = new Map(blueprint.draft.sets.map((set) => [set.id, set]));
    this.blueprint = {
      ...blueprint,
      draft: {
        ...blueprint.draft,
        sets: this.setStates.map((state, order) => ({ ...byId.get(state.id)!, order })),
      },
    };
  }

  private updateReviewExercise(setId: string, exerciseId: string, patch: Partial<EditableDraftExercise>): void {
    this.generatedSets = this.generatedSets.map((set) => set.setId !== setId ? set : {
      ...set,
      exercises: set.exercises.map((exercise) => exercise.id === exerciseId ? { ...exercise, ...patch } : exercise),
    });
  }

  private totalExercises(): number {
    return this.setStates.reduce((total, state) => total + state.configuration.quantity, 0);
  }

  private mapProblem(): string | null {
    const blueprint = this.blueprint;
    if (blueprint === null) return "Generate an aspect map first.";
    const gaps = blueprint.draft.aspects.filter((aspect) => aspect.status === "source-gap");
    if (gaps.length > 0) return `${gaps.length} unresolved source ${gaps.length === 1 ? "gap remains" : "gaps remain"}. Remove each gap or return to Source and add material.`;
    if (this.setStates.length < MIN_LEARNING_PATH_SETS || this.setStates.length > MAX_LEARNING_PATH_SETS) return `Keep ${MIN_LEARNING_PATH_SETS}-${MAX_LEARNING_PATH_SETS} sets.`;
    if (this.totalExercises() > MAX_LEARNING_PATH_EXERCISES) return `The batch requests ${this.totalExercises()} exercises; reduce it to ${MAX_LEARNING_PATH_EXERCISES} or fewer.`;
    const blank = blueprint.draft.sets.find((set) => set.title.trim().length === 0 || set.purpose.trim().length === 0);
    if (blank !== undefined) return "Every set needs a distinct title and purpose.";
    return null;
  }

  private reviewProblem(): string | null {
    if (this.busy === "batch") return "Wait for the current set generation to finish or cancel it.";
    if (this.generatedSets.length !== this.setStates.length) return "Every approved set must finish generation before the complete path can be saved.";
    for (const set of this.generatedSets) {
      const kept = set.exercises.filter((exercise) => !exercise.rejected);
      if (kept.length === 0) return `Keep at least one exercise in ${set.setId}.`;
      const approved = this.approvedBySet.get(set.setId) ?? new Set<string>();
      for (const exercise of kept) {
        if (exercise.prompt.trim().length === 0 || exercise.groundedAnswer.trim().length === 0) return "Every kept exercise needs a prompt and grounded answer.";
        if (!approved.has(exercise.id)) return "Approve or reject every exercise in every set before saving.";
        if (exercise.type === "image-occlusion" && (!exercise.occlusionReviewed || !validateOcclusionMasks(exercise.masks ?? []).valid)) return "Every kept image occlusion needs explicitly accepted valid masks.";
      }
    }
    return null;
  }

  private invalidatePlanningPreview(): void {
    this.preview = null;
    this.previewAccepted = false;
    this.blueprint = null;
    this.setStates = [];
    this.invalidateSetPayloads();
  }

  private invalidateSetPayloads(): void {
    this.setPayloadPreviews = [];
    this.setPayloadsAccepted = false;
  }

  private resetAfterSourceChange(): void {
    this.stage = "source";
    this.error = null;
    this.invalidatePlanningPreview();
  }

  private editableSetState(
    id: string,
    configuration: GenerationConfiguration,
    advancedOpen: boolean,
  ): EditableSetState {
    const percentages = copyExerciseTypePercentages(configuration.exerciseTypePercentages);
    return {
      id,
      advancedOpen,
      configuration: {
        ...configuration,
        exerciseTypes: [...configuration.exerciseTypes],
        exerciseTypePercentages: percentages,
        selectedVisualIds: [...configuration.selectedVisualIds],
      },
      intendedTypes: new Set(enabledExerciseTypes(percentages)),
      rememberedPercentages: copyExerciseTypePercentages(percentages),
    };
  }

  private async discardRecovery(): Promise<void> {
    const discard = this.options.callbacks.discardRecoverableBatch;
    if (discard === undefined || this.busy !== null) return;
    this.busy = "source";
    this.error = null;
    this.render();
    try {
      if (await discard()) {
        this.recoveryAvailable = false;
        this.statuses.clear();
        this.activity.clear();
        this.generatedSets = [];
      }
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private section(container: HTMLElement, title: string, description: string): HTMLElement {
    const section = container.createEl("section", { cls: "practice-learning-path-section" });
    const heading = section.createDiv({ cls: "practice-learning-path-section-heading" });
    heading.createEl("h3", { text: title });
    heading.createEl("p", { text: description });
    return section;
  }

  private iconButton(
    container: HTMLElement,
    icon: string,
    tooltip: string,
    disabled: boolean,
    action: () => void,
  ): void {
    const button = container.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": tooltip, title: tooltip } });
    setIcon(button, icon);
    button.disabled = disabled;
    button.addEventListener("click", action);
  }

  private clearOcclusionEditors(): void {
    for (const editor of this.occlusionEditors.splice(0)) this.removeChild(editor);
  }
}

function statusIcon(status: LearningSetGenerationStatusV1["state"]): string {
  if (status === "queued") return "clock-3";
  if (status === "generating") return "loader-circle";
  if (status === "validating") return "shield-check";
  if (status === "review") return "clipboard-check";
  if (status === "saved") return "check-circle-2";
  return "circle-alert";
}

function statusLabel(status: LearningSetGenerationStatusV1): string {
  if (status.state === "queued") return "Queued";
  if (status.state === "generating") return status.message ?? "Generating";
  if (status.state === "validating") return status.message ?? "Validating";
  if (status.state === "review") return "Ready for review";
  if (status.state === "saved") return "Saved";
  return status.message;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
