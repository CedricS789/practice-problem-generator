import {
  ButtonComponent,
  Modal,
  Notice,
  Setting,
  setIcon,
  type App,
} from "obsidian";

import type { CliActivityEvent } from "../cli/contracts";
import { formatCliErrorForUi } from "../cli/errors";
import {
  formatGenerationCost,
  formatGenerationDuration,
  formatTokenUsage,
  generationTelemetryFromActivity,
  tokenUsageTotal,
} from "../generation-telemetry";
import {
  balanceExerciseTypes,
  copyExerciseTypePercentages,
  enabledExerciseTypes,
  exerciseTypeDistributionProblem,
  exerciseTypePercentageTotal,
  rebalanceExerciseTypePercentageWithIntent,
  RECOMMENDED_EXERCISE_TYPE_PERCENTAGES,
} from "../exercise-distribution";
import { displayDifficulty } from "../difficulty";
import { focusInstructionsProblem, MAX_FOCUS_INSTRUCTIONS_LENGTH } from "../focus-instructions";
import {
  agyModelForReasoning,
  preferredReasoningEffort,
  reasoningEffortsForModel,
} from "../model-selection";
import type { PracticeSetV1, VisualSourceV1 } from "../model";
import {
  displayReasoningEffort,
  reasoningEffortDescription,
} from "../reasoning";
import type {
  GeneratedSavedSetPresentationV1,
  SavedSetGenerationRequestV1,
  SavedSetReviewV1,
} from "../saved-set-controller";
import type {
  RepairPayloadDisclosureV1,
  RepairSetSeedV1,
} from "../saved-set-generation";
import { repairFocusInstructions } from "../saved-set-generation";
import type {
  EditableDraftExercise,
  ExerciseType,
  GenerationConfiguration,
  PayloadPreview,
  ProviderId,
  ProviderPresentation,
  ReasoningEffort,
} from "./contracts";
import { EXERCISE_TYPES } from "./contracts";
import {
  applyHoverDescriptions,
  installHoverDescriptions,
} from "./hover-descriptions";
import { renderDifficultySelector } from "./difficulty-selector";
import { OcclusionEditor } from "./occlusion-editor";
import { renderLatexMarkup } from "./latex-renderer";

const EXERCISE_LABELS: Readonly<Record<ExerciseType, string>> = {
  "short-answer": "Short answer",
  "causal-explanation": "Causal explanation",
  application: "Application / scenario",
  calculation: "Calculation",
  cloze: "Cloze",
  "single-select": "Single-select MCQ",
  "multi-select": "Multi-select MCQ",
  matching: "Matching",
  ordering: "Ordering",
  "image-occlusion": "Image occlusion",
};

export interface SavedSetGenerationModalCallbacks {
  readonly preview: (request: SavedSetGenerationRequestV1) => Promise<PayloadPreview>;
  readonly generate: (
    request: SavedSetGenerationRequestV1,
    onActivity: (event: CliActivityEvent) => void,
  ) => Promise<GeneratedSavedSetPresentationV1>;
  readonly save: (
    request: SavedSetGenerationRequestV1,
    review: SavedSetReviewV1,
  ) => Promise<{ readonly path: string; readonly bank: SavedSetGenerationRequestV1["bank"] }>;
  readonly cancel?: () => void;
  readonly onSaved: (
    workspace: { readonly path: string; readonly bank: SavedSetGenerationRequestV1["bank"] },
  ) => Promise<void> | void;
}

export interface SavedSetGenerationModalOptions {
  readonly request: SavedSetGenerationRequestV1;
  readonly providers: readonly ProviderPresentation[];
  readonly visuals: readonly VisualSourceV1[];
  readonly repairSeed?: RepairSetSeedV1;
  readonly callbacks: SavedSetGenerationModalCallbacks;
}

type Stage = "configure" | "review";
type Busy = "preview" | "generate" | "save" | null;

/** A focused, consent-first editor for one existing or repair set. */
export class SavedSetGenerationModal extends Modal {
  private stage: Stage = "configure";
  private request: SavedSetGenerationRequestV1;
  private preview: PayloadPreview | null = null;
  private previewAccepted = false;
  private generated: GeneratedSavedSetPresentationV1 | null = null;
  private exercises: EditableDraftExercise[] = [];
  private readonly approved = new Set<string>();
  private activity: CliActivityEvent[] = [];
  private busy: Busy = null;
  private error: string | null = null;
  private intendedTypes: Set<ExerciseType>;
  private rememberedPercentages: Record<ExerciseType, number>;
  private repairDisclosure: RepairPayloadDisclosureV1 = {
    includeSubmittedAnswers: false,
    includeReviewFeedback: false,
  };
  private readonly occlusionEditors: OcclusionEditor[] = [];
  private activityHost: HTMLElement | null = null;
  private activityStartedAt: number | null = null;
  private activityFinishedAt: number | null = null;
  private activityClock: number | undefined;
  private activitySummaryEl: HTMLElement | null = null;
  private activityElapsedEl: HTMLElement | null = null;
  private activityExpanded = false;

  constructor(app: App, private readonly options: SavedSetGenerationModalOptions) {
    super(app);
    this.request = structuredClone(options.request);
    this.intendedTypes = new Set(enabledExerciseTypes(
      this.request.configuration.exerciseTypePercentages,
    ));
    this.rememberedPercentages = copyExerciseTypePercentages(
      this.request.configuration.exerciseTypePercentages,
    );
  }

  public override onOpen(): void {
    this.modalEl.addClass("practice-lab-modal", "practice-learning-path-set-modal");
    installHoverDescriptions(this.modalEl);
    this.render();
  }

  public override onClose(): void {
    for (const editor of this.occlusionEditors.splice(0)) editor.unload();
    this.clearActivityClock();
  }

  private render(): void {
    for (const editor of this.occlusionEditors.splice(0)) editor.unload();
    this.activityHost = null;
    this.activitySummaryEl = null;
    this.activityElapsedEl = null;
    this.contentEl.empty();
    const heading = this.contentEl.createDiv({ cls: "practice-learning-path-set-modal-heading" });
    const icon = heading.createDiv();
    setIcon(icon, this.request.addingSet ? "wrench" : "refresh-cw");
    const text = heading.createDiv();
    text.createEl("h2", {
      text: this.request.addingSet ? "Build repair set" : "Regenerate one set",
    });
    text.createEl("p", {
      text: this.request.addingSet
        ? "Create a fresh, editable set from incomplete independent evidence. Nothing is sent until you inspect and approve the exact payload."
        : "Only this set can change. Sibling sets, tutor content outside this set, and historical evidence remain frozen.",
    });
    const progress = this.contentEl.createDiv({ cls: "practice-learning-path-stage-strip" });
    progress.createSpan({ cls: this.stage === "configure" ? "is-active" : "is-complete", text: "1  Configure and consent" });
    progress.createSpan({ cls: this.stage === "review" ? "is-active" : "", text: "2  Review and save" });
    if (this.error !== null) {
      this.contentEl.createEl("p", {
        cls: "practice-lab-callout is-error",
        attr: { role: "alert" },
        text: this.error,
      });
    }
    if (this.stage === "configure") this.renderConfigure();
    else this.renderReview();
    applyHoverDescriptions(this.modalEl);
  }

  private renderConfigure(): void {
    this.renderIdentity(this.contentEl);
    this.renderProvider(this.contentEl);
    this.renderQuantityAndDifficulty(this.contentEl);
    this.renderFocus(this.contentEl);
    if (this.options.repairSeed !== undefined) this.renderRepairDisclosure(this.contentEl);
    this.renderMix(this.contentEl);
    this.renderVisuals(this.contentEl);
    if (this.preview !== null) this.renderPayloadPreview(this.contentEl);
    this.activityHost = this.contentEl.createDiv({
      cls: "practice-learning-path-modal-activity",
      attr: { "aria-live": "polite" },
    });
    this.renderActivity(this.activityHost);
    const problem = this.configurationProblem();
    if (problem !== null) {
      this.contentEl.createEl("p", { cls: "practice-lab-callout is-error", text: problem });
    }
    const actions = this.contentEl.createDiv({ cls: "practice-learning-path-actions is-sticky" });
    new ButtonComponent(actions)
      .setIcon("scan-search")
      .setButtonText(this.busy === "preview" ? "Preparing preview…" : "Preview exact AI payload")
      .setDisabled(this.busy !== null || problem !== null)
      .onClick(() => void this.previewPayload());
    if (this.preview !== null) {
      new ButtonComponent(actions)
        .setIcon("sparkles")
        .setButtonText(this.busy === "generate" ? "Agent working…" : "Generate this set")
        .setCta()
        .setDisabled(this.busy !== null || !this.previewAccepted)
        .onClick(() => void this.generate());
    }
    if (this.busy === "generate" && this.options.callbacks.cancel !== undefined) {
      new ButtonComponent(actions)
        .setIcon("square")
        .setButtonText("Cancel")
        .onClick(() => this.options.callbacks.cancel?.());
    }
  }

  private renderIdentity(container: HTMLElement): void {
    const section = this.section(container, "Set identity", "Rename or refocus the local brief before its exact payload is built.");
    new Setting(section)
      .setName("Set title")
      .addText((text) => text
        .setValue(this.request.targetSet.title)
        .onChange((value) => {
          this.updateTarget({ title: value });
        }));
    new Setting(section)
      .setName("Purpose")
      .setDesc("This objective is included in the sibling-set map so the agent keeps this set distinct.")
      .addTextArea((text) => text
        .setValue(this.request.targetSet.purpose)
        .onChange((value) => {
          this.updateTarget({ purpose: value });
        }));
  }

  private renderProvider(container: HTMLElement): void {
    const section = this.section(container, "Agent", "Provider, installed model, and reasoning are explicit and are recorded in generation history.");
    const grid = section.createDiv({ cls: "practice-learning-path-provider-grid" });
    const providerLabel = grid.createEl("label");
    providerLabel.createSpan({ text: "Provider" });
    const provider = providerLabel.createEl("select");
    for (const entry of this.options.providers) {
      provider.createEl("option", {
        value: entry.id,
        text: entry.available ? entry.label : `${entry.label} (unavailable)`,
      }).disabled = !entry.available;
    }
    provider.value = this.request.configuration.provider;
    provider.addEventListener("change", () => {
      const id = provider.value as ProviderId;
      const selected = this.options.providers.find((entry) => entry.id === id);
      const nextModel = selected?.defaultModel ?? "";
      const nextEfforts = reasoningEffortsForModel(
        selected?.reasoningEfforts ?? [],
        nextModel,
        selected?.models ?? [],
      );
      this.updateConfiguration({
        provider: id,
        model: nextModel,
        reasoningEffort: preferredReasoningEffort(
          this.request.configuration.reasoningEffort,
          nextEfforts,
          selected?.models.find((entry) => entry.id === nextModel),
        ),
      });
      this.render();
    });
    const selectedProvider = this.options.providers.find((entry) => (
      entry.id === this.request.configuration.provider
    ));
    const modelLabel = grid.createEl("label");
    modelLabel.createSpan({ text: "Model" });
    const model = modelLabel.createEl("select");
    const models = selectedProvider?.models ?? [];
    model.createEl("option", { value: "", text: "Automatic" });
    for (const entry of models) model.createEl("option", { value: entry.id, text: entry.label });
    if (
      this.request.configuration.model.length > 0
      && !models.some((entry) => entry.id === this.request.configuration.model)
    ) {
      model.createEl("option", {
        value: this.request.configuration.model,
        text: this.request.configuration.model,
      });
    }
    model.value = this.request.configuration.model;
    model.addEventListener("change", () => {
      const nextModel = model.value;
      const nextEfforts = reasoningEffortsForModel(
        selectedProvider?.reasoningEfforts ?? [],
        nextModel,
        models,
      );
      this.updateConfiguration({
        model: nextModel,
        reasoningEffort: preferredReasoningEffort(
          this.request.configuration.reasoningEffort,
          nextEfforts,
          models.find((entry) => entry.id === nextModel),
        ),
      });
      this.render();
    });
    const reasoningLabel = grid.createEl("label");
    reasoningLabel.createSpan({ text: "Reasoning" });
    const reasoning = reasoningLabel.createEl("select", {
      attr: { title: reasoningEffortDescription(this.request.configuration.provider) },
    });
    const reasoningEfforts = reasoningEffortsForModel(
      selectedProvider?.reasoningEfforts ?? [],
      this.request.configuration.model,
      models,
    );
    for (const effort of reasoningEfforts) {
      reasoning.createEl("option", {
        value: effort,
        text: displayReasoningEffort(effort),
      });
    }
    reasoning.value = this.request.configuration.reasoningEffort;
    reasoning.addEventListener("change", () => {
      const effort = reasoning.value as ReasoningEffort;
      const currentModel = this.request.configuration.model;
      const alignedModel = this.request.configuration.provider === "agy"
        && currentModel.length > 0
        ? agyModelForReasoning(currentModel, effort, models)
        : currentModel;
      this.updateConfiguration({
        reasoningEffort: effort,
        model: alignedModel,
      });
      if (alignedModel !== currentModel) this.render();
    });
  }

  private renderQuantityAndDifficulty(container: HTMLElement): void {
    const section = this.section(container, "Set size", "Keep the complete learning path below the sixty-problem safety limit.");
    const grid = section.createDiv({ cls: "practice-learning-path-provider-grid" });
    const quantityLabel = grid.createEl("label");
    quantityLabel.createSpan({ text: "Problems" });
    const quantity = quantityLabel.createEl("input", {
      attr: { type: "number", min: "1", max: "30", step: "1" },
    });
    quantity.value = String(this.request.configuration.quantity);
    quantity.addEventListener("change", () => this.updateConfiguration({
      quantity: Math.min(30, Math.max(1, Number.parseInt(quantity.value, 10) || 1)),
    }));
    const difficulty = section.createDiv({
      cls: "practice-learning-path-set-difficulty",
    });
    difficulty.createEl("strong", { text: "Difficulty profile" });
    difficulty.createSpan({
      text: "This changes the reasoning demand for the replacement set, not its approved source boundary.",
    });
    renderDifficultySelector(difficulty, {
      value: this.request.configuration.difficulty,
      name: "practice-lab-saved-set-difficulty",
      ariaLabel: "Saved set generation difficulty profile",
      onChange: (value) => this.updateConfiguration({ difficulty: value }),
    });
  }

  private renderFocus(container: HTMLElement): void {
    const section = this.section(container, "Comments for the agent", "Add local priorities such as focus, exclusions, expected depth, or transfer style.");
    const input = section.createEl("textarea", {
      attr: {
        rows: "5",
        maxlength: String(MAX_FOCUS_INSTRUCTIONS_LENGTH),
        "aria-label": "Set-specific comments for the agent",
      },
    });
    input.value = this.request.configuration.focusInstructions;
    input.addEventListener("input", () => this.updateConfiguration({
      focusInstructions: input.value,
    }));
  }

  private renderRepairDisclosure(container: HTMLElement): void {
    const seed = this.options.repairSeed;
    if (seed === undefined) return;
    const section = this.section(
      container,
      "Repair evidence consent",
      "Outcome labels and supported aspect names are local defaults. Authored answers and AI feedback remain excluded unless you enable their separate switches; the final text still appears in the exact payload preview.",
    );
    new Setting(section)
      .setName("Include my submitted answers")
      .setDesc("Adds only the answers from the identified incomplete attempts to this set's visible focus instructions.")
      .addToggle((toggle) => toggle
        .setValue(this.repairDisclosure.includeSubmittedAnswers)
        .onChange((value) => {
          this.repairDisclosure = { ...this.repairDisclosure, includeSubmittedAnswers: value };
          this.applyRepairFocus(seed);
          this.render();
        }));
    new Setting(section)
      .setName("Include available AI feedback")
      .setDesc("Adds only reviewed feedback attached to those attempts. Pending or failed reviews are never sent.")
      .addToggle((toggle) => toggle
        .setValue(this.repairDisclosure.includeReviewFeedback)
        .onChange((value) => {
          this.repairDisclosure = { ...this.repairDisclosure, includeReviewFeedback: value };
          this.applyRepairFocus(seed);
          this.render();
        }));
  }

  private renderMix(container: HTMLElement): void {
    const section = this.section(container, "Exercise proportions", "Move one slider; the other selected types rebalance to a polished 100% total. Types that reach zero return automatically when room is restored.");
    const presets = section.createDiv({ cls: "practice-learning-path-mix-presets" });
    new ButtonComponent(presets).setButtonText("Deep practice").onClick(() => {
      this.setPercentages(copyExerciseTypePercentages(RECOMMENDED_EXERCISE_TYPE_PERCENTAGES));
      this.render();
    });
    new ButtonComponent(presets).setButtonText("Equal mix").onClick(() => {
      this.setPercentages(balanceExerciseTypes([...EXERCISE_TYPES]));
      this.render();
    });
    const total = section.createEl("strong", {
      text: `Total ${exerciseTypePercentageTotal(this.request.configuration.exerciseTypePercentages)}%`,
    });
    const rows = section.createDiv({ cls: "practice-learning-path-mix" });
    for (const type of EXERCISE_TYPES) {
      const row = rows.createEl("label", {
        cls: `practice-learning-path-mix-row${this.request.configuration.exerciseTypePercentages[type] === 0 ? " is-zero" : ""}`,
      });
      row.createSpan({ text: EXERCISE_LABELS[type] });
      const slider = row.createEl("input", {
        attr: { type: "range", min: "0", max: "100", step: "5", draggable: "false" },
      });
      slider.value = String(this.request.configuration.exerciseTypePercentages[type]);
      const output = row.createEl("output", { text: `${slider.value}%` });
      slider.addEventListener("input", () => {
        const requested = Number.parseInt(slider.value, 10);
        if (requested === 0) this.intendedTypes.delete(type);
        else this.intendedTypes.add(type);
        for (const candidate of enabledExerciseTypes(
          this.request.configuration.exerciseTypePercentages,
        )) {
          this.rememberedPercentages[candidate] =
            this.request.configuration.exerciseTypePercentages[candidate];
        }
        const percentages = rebalanceExerciseTypePercentageWithIntent(
          this.request.configuration.exerciseTypePercentages,
          type,
          requested,
          this.intendedTypes,
          this.rememberedPercentages,
        );
        this.updateConfiguration({
          exerciseTypePercentages: percentages,
          exerciseTypes: enabledExerciseTypes(percentages),
        });
        output.setText(`${percentages[type]}%`);
        total.setText(`Total ${exerciseTypePercentageTotal(percentages)}%`);
        for (const input of Array.from(rows.querySelectorAll<HTMLInputElement>("input[type=range]"))) {
          const candidate = input.dataset.type as ExerciseType | undefined;
          if (candidate === undefined) continue;
          const value = percentages[candidate];
          input.value = String(value);
          input.closest("label")?.classList.toggle("is-zero", value === 0);
          input.parentElement?.querySelector("output")?.setText(`${value}%`);
        }
      });
      slider.dataset.type = type;
    }
  }

  private renderVisuals(container: HTMLElement): void {
    if (this.options.visuals.length === 0) return;
    const section = this.section(container, "Durable visuals", "Choose which saved local snapshots this one set may send under neutral filenames.");
    const actions = section.createDiv({ cls: "practice-learning-path-actions" });
    new ButtonComponent(actions)
      .setIcon("images")
      .setButtonText("Select all images")
      .onClick(() => {
        this.updateConfiguration({ selectedVisualIds: this.options.visuals.map((visual) => visual.id) });
        this.render();
      });
    new ButtonComponent(actions)
      .setIcon("image-off")
      .setButtonText("Clear selection")
      .onClick(() => {
        this.updateConfiguration({ selectedVisualIds: [] });
        this.render();
      });
    const selected = new Set(this.request.configuration.selectedVisualIds);
    for (const visual of this.options.visuals) {
      new Setting(section)
        .setName(visual.altText ?? visual.id)
        .setDesc(`${visual.kind.replaceAll("-", " ")} · ${visual.width} × ${visual.height}`)
        .addToggle((toggle) => toggle
          .setValue(selected.has(visual.id))
          .onChange((value) => {
            const next = new Set(this.request.configuration.selectedVisualIds);
            if (value) next.add(visual.id);
            else next.delete(visual.id);
            this.updateConfiguration({ selectedVisualIds: [...next] });
          }));
    }
  }

  private renderPayloadPreview(container: HTMLElement): void {
    const preview = this.preview;
    if (preview === null) return;
    const section = this.section(container, "Exact payload preview", "This is the complete text plus neutral-media manifest that the selected local CLI may send to its provider.");
    section.createEl("p", {
      cls: "practice-lab-muted",
      text: `${preview.providerLabel} · ${preview.modelLabel} · ${preview.reasoningEffortLabel} · ${displayDifficulty(this.request.configuration.difficulty)}`,
    });
    if (preview.warning !== undefined) section.createEl("p", { cls: "practice-lab-callout", text: preview.warning });
    const details = section.createEl("details", { attr: { open: "" } });
    details.createEl("summary", { text: "Inspect complete payload" });
    details.createEl("pre", { text: preview.text });
    new Setting(section)
      .setName("I approve this exact payload")
      .setDesc("Any later edit invalidates this consent and requires a new preview.")
      .addToggle((toggle) => toggle
        .setValue(this.previewAccepted)
        .onChange((value) => {
          this.previewAccepted = value;
          this.render();
        }));
  }

  private renderReview(): void {
    const generated = this.generated;
    if (generated === null) {
      this.error = "The generated set is unavailable.";
      this.stage = "configure";
      this.render();
      return;
    }
    const intro = this.section(this.contentEl, "Review generated set", "Edit, reject, reorder, and approve every kept exercise. Occlusion masks keep their separate explicit acceptance gate.");
    const actions = intro.createDiv({ cls: "practice-learning-path-actions" });
    new ButtonComponent(actions)
      .setIcon("check-check")
      .setButtonText("Approve all valid text exercises")
      .onClick(() => {
        for (const exercise of this.exercises) {
          if (!exercise.rejected && exercise.type !== "image-occlusion") this.approved.add(exercise.id);
        }
        this.render();
      });
    new ButtonComponent(actions)
      .setIcon("arrow-left")
      .setButtonText("Back to configuration")
      .setDisabled(this.busy !== null)
      .onClick(() => {
        this.stage = "configure";
        this.generated = null;
        this.exercises = [];
        this.approved.clear();
        this.invalidatePreview();
        this.render();
      });
    for (const [index, exercise] of this.exercises.entries()) {
      this.renderExercise(this.contentEl, exercise, index);
    }
    const problem = this.reviewProblem();
    if (problem !== null) this.contentEl.createEl("p", { cls: "practice-lab-callout is-error", text: problem });
    const save = this.contentEl.createDiv({ cls: "practice-learning-path-actions is-sticky" });
    new ButtonComponent(save)
      .setIcon("save")
      .setButtonText(this.busy === "save"
        ? "Saving…"
        : this.request.addingSet ? "Add approved repair set" : "Replace only this set")
      .setCta()
      .setDisabled(this.busy !== null || problem !== null)
      .onClick(() => void this.save());
  }

  private renderExercise(
    container: HTMLElement,
    exercise: EditableDraftExercise,
    index: number,
  ): void {
    const card = container.createEl("article", {
      cls: `practice-learning-path-exercise${exercise.rejected ? " is-rejected" : ""}`,
    });
    const heading = card.createDiv({ cls: "practice-learning-path-set-heading" });
    heading.createSpan({ cls: "practice-learning-path-set-order", text: String(index + 1) });
    const headingText = heading.createDiv();
    headingText.createEl("strong", { text: exercise.title ?? EXERCISE_LABELS[exercise.type] });
    headingText.createSpan({ cls: "practice-lab-badge", text: EXERCISE_LABELS[exercise.type] });
    const controls = heading.createDiv({ cls: "practice-learning-path-card-actions" });
    this.iconButton(controls, "arrow-up", "Move exercise earlier", index === 0, () => this.moveExercise(index, index - 1));
    this.iconButton(controls, "arrow-down", "Move exercise later", index === this.exercises.length - 1, () => this.moveExercise(index, index + 1));
    this.iconButton(controls, exercise.rejected ? "rotate-ccw" : "trash-2", exercise.rejected ? "Restore exercise" : "Reject exercise", false, () => {
      this.updateExercise(exercise.id, { rejected: !exercise.rejected });
      if (!exercise.rejected) this.approved.delete(exercise.id);
      this.render();
    });
    if (exercise.rejected) return;
    const promptPreview = card.createDiv({ cls: "practice-learning-path-exercise-preview" });
    renderLatexMarkup(promptPreview, exercise.prompt);
    const prompt = card.createEl("textarea", {
      attr: { rows: "4", "aria-label": `Prompt for exercise ${index + 1}` },
    });
    prompt.value = exercise.prompt;
    prompt.addEventListener("input", () => {
      this.updateExercise(exercise.id, { prompt: prompt.value });
      this.approved.delete(exercise.id);
      renderLatexMarkup(promptPreview, prompt.value);
    });
    const answerPreview = card.createDiv({ cls: "practice-learning-path-exercise-preview is-answer" });
    renderLatexMarkup(answerPreview, exercise.groundedAnswer);
    const answer = card.createEl("textarea", {
      attr: { rows: "3", "aria-label": `Grounded answer for exercise ${index + 1}` },
    });
    answer.value = exercise.groundedAnswer;
    answer.addEventListener("input", () => {
      this.updateExercise(exercise.id, { groundedAnswer: answer.value });
      this.approved.delete(exercise.id);
      renderLatexMarkup(answerPreview, answer.value);
    });
    if (exercise.type === "image-occlusion") {
      if (exercise.visualUrl === undefined) {
        card.createEl("p", { cls: "practice-lab-callout is-error", text: "The durable occlusion image is unavailable. Reject this exercise or restore the snapshot." });
      } else {
        const editor = new OcclusionEditor(card.createDiv(), {
          imageUrl: exercise.visualUrl,
          imageAlt: exercise.title ?? exercise.prompt,
          masks: exercise.masks ?? [],
          reviewed: exercise.occlusionReviewed,
          onChange: (masks) => {
            this.approved.delete(exercise.id);
            this.updateExercise(exercise.id, { masks, occlusionReviewed: false });
          },
          onReviewed: (masks) => {
            this.updateExercise(exercise.id, { masks, occlusionReviewed: true });
            this.approved.add(exercise.id);
            this.render();
          },
        });
        this.occlusionEditors.push(editor);
      }
    } else {
      new ButtonComponent(card)
        .setIcon(this.approved.has(exercise.id) ? "check" : "circle-check")
        .setButtonText(this.approved.has(exercise.id) ? "Approved" : "Approve exercise")
        .setDisabled(this.approved.has(exercise.id))
        .onClick(() => {
          this.approved.add(exercise.id);
          this.render();
        });
    }
  }

  private renderActivity(container: HTMLElement): void {
    if (this.activity.length === 0) return;
    const details = container.createEl("details", {
      cls: "practice-learning-path-activity",
      ...(this.activityExpanded ? { attr: { open: "" } } : {}),
    });
    details.addEventListener("toggle", () => {
      this.activityExpanded = details.open;
    });
    const summary = details.createEl("summary");
    summary.createSpan({ text: "Live agent activity" });
    this.activitySummaryEl = summary.createSpan({
      cls: "practice-learning-path-activity-summary",
    });
    this.refreshActivitySummary();
    const firstEvent = this.activity[0];
    const startedAt = this.activityStartedAt
      ?? (firstEvent === undefined ? undefined : activityTimestamp(firstEvent))
      ?? Date.now();
    const duration = (this.activityFinishedAt ?? Date.now()) - startedAt;
    const telemetry = generationTelemetryFromActivity(this.activity, duration);
    if (telemetry !== undefined) {
      const metrics = details.createDiv({
        cls: "practice-lab-generation-telemetry",
        attr: { "aria-label": "Set generation usage summary" },
      });
      this.activityElapsedEl = modalTelemetryMetric(
        metrics,
        "Elapsed",
        formatGenerationDuration(duration),
      );
      modalTelemetryMetric(metrics, "Tokens", formatTokenUsage(telemetry.tokenUsage));
      modalTelemetryMetric(metrics, "Cost", formatGenerationCost(telemetry));
      modalTelemetryMetric(
        metrics,
        "Attempts",
        telemetry.attempts === 2 ? "2 · includes schema repair" : "1",
      );
      if (telemetry.tokenUsage.source !== "provider-reported") {
        details.createEl("p", {
          cls: "practice-lab-generation-telemetry-note",
          text: `~ marks a local estimate from submitted text and visible structured output. Hidden reasoning and provider/tool overhead${telemetry.tokenUsage.inputEstimateExcludesMedia ? ", including visual tokenization," : ""} are not included.`,
        });
      }
    }
    const list = details.createEl("ol");
    for (const event of this.activity.slice(-20)) {
      const occurredAt = activityTimestamp(event);
      list.createEl("li", {
        text: `${occurredAt === undefined ? "" : `+${formatGenerationDuration(Math.max(0, occurredAt - startedAt))} · `}${event.phase}: ${event.message}`,
      });
    }
    this.ensureActivityClock();
  }

  private refreshActivity(): void {
    const host = this.activityHost;
    if (host === null) return;
    host.replaceChildren();
    this.renderActivity(host);
  }

  private async previewPayload(): Promise<void> {
    if (this.busy !== null || this.configurationProblem() !== null) return;
    this.busy = "preview";
    this.error = null;
    this.render();
    try {
      this.preview = await this.options.callbacks.preview(this.request);
      this.previewAccepted = false;
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private async generate(): Promise<void> {
    if (this.busy !== null || !this.previewAccepted) return;
    this.busy = "generate";
    this.error = null;
    this.activity = [];
    this.activityExpanded = false;
    this.activityStartedAt = Date.now();
    this.activityFinishedAt = null;
    this.render();
    try {
      const generated = await this.options.callbacks.generate(this.request, (event) => {
        this.activity = [...this.activity, event].slice(-50);
        this.refreshActivity();
      });
      this.generated = generated;
      this.exercises = generated.exercises.map((exercise) => structuredClone(exercise));
      this.stage = "review";
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.activityFinishedAt ??= Date.now();
      this.busy = null;
      this.render();
    }
  }

  private refreshActivitySummary(): void {
    const summary = this.activitySummaryEl;
    if (summary === null || this.activityStartedAt === null) return;
    const duration = (this.activityFinishedAt ?? Date.now()) - this.activityStartedAt;
    const telemetry = generationTelemetryFromActivity(this.activity, duration);
    summary.setText(
      formatGenerationDuration(duration)
      + (telemetry === undefined
        ? ""
        : ` · ${telemetry.tokenUsage.source === "provider-reported" ? "" : "~"}${compactModalTokens(tokenUsageTotal(telemetry.tokenUsage))} tokens`),
    );
    this.activityElapsedEl?.setText(formatGenerationDuration(duration));
  }

  private ensureActivityClock(): void {
    if (this.busy !== "generate" || this.activityClock !== undefined) return;
    this.activityClock = window.setInterval(() => {
      this.refreshActivitySummary();
      if (this.busy !== "generate") this.clearActivityClock();
    }, 1_000);
  }

  private clearActivityClock(): void {
    if (this.activityClock === undefined) return;
    window.clearInterval(this.activityClock);
    this.activityClock = undefined;
  }

  private async save(): Promise<void> {
    const generated = this.generated;
    if (generated === null || this.busy !== null || this.reviewProblem() !== null) return;
    this.busy = "save";
    this.error = null;
    this.render();
    try {
      const review: SavedSetReviewV1 = {
        ...generated,
        exercises: this.exercises.map((exercise) => structuredClone(exercise)),
        approvedExerciseIds: [...this.approved],
      };
      const saved = await this.options.callbacks.save(this.request, review);
      await this.options.callbacks.onSaved(saved);
      new Notice(this.request.addingSet
        ? "Repair set added. Existing sets and historical evidence were preserved."
        : "Set regenerated. Sibling sets and historical evidence were preserved.", 8_000);
      this.close();
    } catch (error) {
      this.error = errorMessage(error);
      this.busy = null;
      this.render();
    }
  }

  private configurationProblem(): string | null {
    if (this.request.targetSet.title.trim().length === 0) return "Enter a set title.";
    if (this.request.targetSet.purpose.trim().length === 0) return "Enter a set purpose.";
    const provider = this.options.providers.find((entry) => (
      entry.id === this.request.configuration.provider
    ));
    if (provider?.available !== true) return "Choose an available provider.";
    if (!provider.reasoningEfforts.includes(this.request.configuration.reasoningEffort)) {
      return "Choose a reasoning level supported by the selected provider and model.";
    }
    const mix = exerciseTypeDistributionProblem(
      this.request.configuration.exerciseTypePercentages,
    );
    if (mix !== null) return mix;
    const focus = focusInstructionsProblem(this.request.configuration.focusInstructions);
    if (focus !== null) return focus;
    if (
      this.request.configuration.exerciseTypePercentages["image-occlusion"] > 0
      && this.request.configuration.selectedVisualIds.length === 0
    ) return "Image occlusion needs at least one selected durable visual.";
    return null;
  }

  private reviewProblem(): string | null {
    const kept = this.exercises.filter((exercise) => !exercise.rejected);
    if (kept.length === 0) return "Keep at least one exercise.";
    const pending = kept.find((exercise) => !this.approved.has(exercise.id));
    if (pending !== undefined) return `Approve or reject ${pending.title ?? pending.id}.`;
    const occlusion = kept.find((exercise) => (
      exercise.type === "image-occlusion" && !exercise.occlusionReviewed
    ));
    if (occlusion !== undefined) return `Accept the occlusion masks for ${occlusion.title ?? occlusion.id}.`;
    return null;
  }

  private updateTarget(patch: Partial<Pick<PracticeSetV1, "title" | "purpose">>): void {
    this.request = {
      ...this.request,
      targetSet: { ...this.request.targetSet, ...patch },
    };
    this.invalidatePreview();
  }

  private updateConfiguration(patch: Partial<GenerationConfiguration>): void {
    const percentages = patch.exerciseTypePercentages
      ?? this.request.configuration.exerciseTypePercentages;
    this.request = {
      ...this.request,
      configuration: {
        ...this.request.configuration,
        ...patch,
        exerciseTypes: patch.exerciseTypes ?? enabledExerciseTypes(percentages),
      },
    };
    this.invalidatePreview();
  }

  private setPercentages(percentages: GenerationConfiguration["exerciseTypePercentages"]): void {
    this.intendedTypes = new Set(enabledExerciseTypes(percentages));
    this.rememberedPercentages = copyExerciseTypePercentages(percentages);
    this.updateConfiguration({
      exerciseTypePercentages: percentages,
      exerciseTypes: enabledExerciseTypes(percentages),
    });
  }

  private applyRepairFocus(seed: RepairSetSeedV1): void {
    this.updateConfiguration({
      focusInstructions: repairFocusInstructions(seed, this.repairDisclosure),
    });
  }

  private updateExercise(
    exerciseId: string,
    patch: Partial<EditableDraftExercise>,
  ): void {
    this.exercises = this.exercises.map((exercise) => (
      exercise.id === exerciseId ? { ...exercise, ...patch } : exercise
    ));
  }

  private moveExercise(from: number, to: number): void {
    if (to < 0 || to >= this.exercises.length || from === to) return;
    const next = [...this.exercises];
    const [exercise] = next.splice(from, 1);
    if (exercise === undefined) return;
    next.splice(to, 0, exercise);
    this.exercises = next;
    this.render();
  }

  private invalidatePreview(): void {
    this.preview = null;
    this.previewAccepted = false;
  }

  private section(
    container: HTMLElement,
    title: string,
    description: string,
  ): HTMLElement {
    const section = container.createEl("section", { cls: "practice-learning-path-section" });
    section.createEl("h3", { text: title });
    section.createEl("p", { cls: "practice-lab-muted", text: description });
    return section;
  }

  private iconButton(
    container: HTMLElement,
    icon: string,
    label: string,
    disabled: boolean,
    onClick: () => void,
  ): void {
    const button = container.createEl("button", {
      cls: "clickable-icon",
      attr: { type: "button", "aria-label": label, title: label },
    });
    setIcon(button, icon);
    button.disabled = disabled;
    button.addEventListener("click", onClick);
  }
}

function errorMessage(error: unknown): string {
  return formatCliErrorForUi(error, "The requested generation step failed.");
}

function activityTimestamp(event: CliActivityEvent): number | undefined {
  const value = Date.parse(event.occurredAt);
  return Number.isFinite(value) ? value : undefined;
}

function compactModalTokens(value: number): string {
  const rounded = Math.max(0, Math.round(value));
  if (rounded < 1_000) return rounded.toLocaleString();
  if (rounded < 1_000_000) {
    return `${(rounded / 1_000).toFixed(rounded < 10_000 ? 1 : 0).replace(/\.0$/u, "")}k`;
  }
  return `${(rounded / 1_000_000).toFixed(rounded < 10_000_000 ? 1 : 0).replace(/\.0$/u, "")}m`;
}

function modalTelemetryMetric(
  container: HTMLElement,
  label: string,
  value: string,
): HTMLElement {
  const metric = container.createDiv({ cls: "practice-lab-generation-telemetry-metric" });
  metric.createSpan({ text: label });
  return metric.createEl("strong", { text: value });
}
