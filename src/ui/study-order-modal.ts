import { App, Modal, Setting, setIcon } from "obsidian";
import {
  normalizeStudyTypeSequence,
  type StudyExerciseType,
  type StudyOrderDefault,
  type StudyOrderSelection,
} from "../preferences";
import {
  applyHoverDescriptions,
  installHoverDescriptions,
} from "./hover-descriptions";

export interface StudyOrderDialogOptions {
  readonly itemTypes: readonly StudyExerciseType[];
  readonly defaults: StudyOrderSelection;
  readonly labels: Readonly<Record<StudyExerciseType, string>>;
}

export interface StudyOrderDialogResult extends StudyOrderSelection {
  readonly rememberAsDefault: boolean;
}

export function chooseStudyOrder(
  app: App,
  options: StudyOrderDialogOptions,
): Promise<StudyOrderDialogResult | null> {
  return new Promise((resolve) => {
    new StudyOrderModal(app, options, resolve).open();
  });
}

class StudyOrderModal extends Modal {
  private mode: StudyOrderDefault;
  private typeSequence: StudyExerciseType[];
  private shuffleWithinTypes: boolean;
  private rememberAsDefault = false;
  private settled = false;
  private modeDescription?: HTMLElement;
  private groupOptions?: HTMLElement;
  private sequencePanel?: HTMLElement;
  private sequenceList?: HTMLElement;
  private sequencePreview?: HTMLElement;

  constructor(
    app: App,
    private readonly options: StudyOrderDialogOptions,
    private readonly resolve: (result: StudyOrderDialogResult | null) => void,
  ) {
    super(app);
    this.mode = options.defaults.mode;
    this.typeSequence = normalizeStudyTypeSequence(options.defaults.typeSequence);
    this.shuffleWithinTypes = options.defaults.shuffleWithinTypes;
  }

  override onOpen(): void {
    this.setTitle("Set up this practice session");
    this.modalEl.addClass("practice-lab-study-order-dialog");
    this.contentEl.addClass("practice-lab-study-order-modal");
    this.contentEl.createEl("p", {
      text: `${this.options.itemTypes.length} ${this.options.itemTypes.length === 1 ? "question" : "questions"} are ready. Choose how exercise types should appear; the saved bank is never reordered.`,
    });

    const mode = new Setting(this.contentEl)
      .setName("Question order")
      .setDesc("Choose a fresh order for this session.")
      .addDropdown((dropdown) => dropdown
        .addOption("bank", "Use saved bank order")
        .addOption("shuffle", "Shuffle every question")
        .addOption("shuffle-types", "Shuffle type blocks")
        .addOption("type-sequence", "Follow custom type sequence")
        .setValue(this.mode)
        .onChange((value) => {
          if (!isStudyOrder(value)) return;
          this.mode = value;
          this.refreshMode();
        }));
    this.modeDescription = mode.descEl.createDiv({
      cls: "practice-lab-study-order-description",
      attr: { role: "status", "aria-live": "polite" },
    });

    const groupOptions = this.contentEl.createDiv({
      cls: "practice-lab-study-order-group-options",
    });
    this.groupOptions = groupOptions;
    new Setting(groupOptions)
      .setName("Shuffle within each type")
      .setDesc("Randomize questions inside each type block as well as controlling the order of the blocks.")
      .addToggle((toggle) => toggle
        .setValue(this.shuffleWithinTypes)
        .onChange((value) => {
          this.shuffleWithinTypes = value;
        }));

    const sequencePanel = this.contentEl.createEl("section", {
      cls: "practice-lab-study-order-sequence",
      attr: { "aria-label": "Exercise type sequence" },
    });
    this.sequencePanel = sequencePanel;
    const heading = sequencePanel.createDiv({ cls: "practice-lab-section-heading" });
    heading.createEl("h3", { text: "Type sequence" });
    heading.createEl("p", {
      text: "Move types into the progression you want. Types with no questions are retained for future banks but skipped in this session.",
    });
    this.sequencePreview = sequencePanel.createEl("p", {
      cls: "practice-lab-study-order-preview",
      attr: { role: "status", "aria-live": "polite" },
    });
    this.sequenceList = sequencePanel.createDiv({
      cls: "practice-lab-study-sequence-list",
    });
    this.renderSequence();

    new Setting(this.contentEl)
      .setName("Remember these defaults")
      .setDesc("Use this mode, sequence, and within-type choice as the starting point next time. You will still confirm each session.")
      .addToggle((toggle) => toggle
        .setValue(this.rememberAsDefault)
        .onChange((value) => {
          this.rememberAsDefault = value;
        }));

    const actions = this.contentEl.createDiv({
      cls: "modal-button-container practice-lab-study-order-actions",
    });
    const cancel = actions.createEl("button", {
      text: "Cancel",
      attr: { type: "button", title: "Close without starting a session" },
    });
    cancel.addEventListener("click", () => this.close());
    const start = actions.createEl("button", {
      text: "Start practice",
      cls: "mod-cta",
      attr: { type: "button", title: "Start with the selected question order" },
    });
    start.addEventListener("click", () => this.submit());

    this.scope.register(["Mod"], "Enter", (event) => {
      event.preventDefault();
      this.submit();
      return false;
    });
    this.refreshMode();
    installHoverDescriptions(this.modalEl);
    window.setTimeout(() => mode.controlEl.querySelector("select")?.focus(), 0);
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.settled) this.resolve(null);
  }

  private refreshMode(): void {
    if (this.modeDescription !== undefined) {
      this.modeDescription.setText(orderDescription(this.mode));
    }
    const grouped = this.mode === "shuffle-types" || this.mode === "type-sequence";
    if (this.groupOptions !== undefined) this.groupOptions.hidden = !grouped;
    if (this.sequencePanel !== undefined) {
      this.sequencePanel.hidden = this.mode !== "type-sequence";
    }
  }

  private renderSequence(): void {
    const list = this.sequenceList;
    if (list === undefined) return;
    list.empty();
    const counts = new Map<StudyExerciseType, number>();
    for (const type of this.options.itemTypes) {
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    for (const [index, type] of this.typeSequence.entries()) {
      const count = counts.get(type) ?? 0;
      const row = list.createDiv({
        cls: `practice-lab-study-sequence-row${count === 0 ? " is-empty" : ""}`,
      });
      row.createSpan({
        cls: "practice-lab-study-sequence-position",
        text: String(index + 1),
      });
      const label = row.createDiv({ cls: "practice-lab-study-sequence-label" });
      label.createEl("strong", { text: this.options.labels[type] });
      label.createSpan({
        text: `${count} ${count === 1 ? "question" : "questions"}`,
      });
      this.sequenceButton(row, "arrow-up", `Move ${this.options.labels[type]} earlier`, index === 0, () => {
        this.moveType(index, index - 1);
      });
      this.sequenceButton(
        row,
        "arrow-down",
        `Move ${this.options.labels[type]} later`,
        index === this.typeSequence.length - 1,
        () => this.moveType(index, index + 1),
      );
    }
    const activeSequence = this.typeSequence.filter((type) => counts.has(type));
    this.sequencePreview?.setText(
      activeSequence.length === 0
        ? "No exercise types are available in this bank."
        : `This session: ${activeSequence.map((type) => `${this.options.labels[type]} (${counts.get(type) ?? 0})`).join(" → ")}`,
    );
  }

  private sequenceButton(
    container: HTMLElement,
    icon: string,
    label: string,
    disabled: boolean,
    onClick: () => void,
  ): void {
    const button = container.createEl("button", {
      cls: "clickable-icon",
      attr: {
        type: "button",
        title: label,
        "aria-label": label,
      },
    });
    button.disabled = disabled;
    setIcon(button, icon);
    button.addEventListener("click", onClick);
  }

  private moveType(from: number, to: number): void {
    if (from < 0 || from >= this.typeSequence.length || to < 0 || to >= this.typeSequence.length) return;
    const next = [...this.typeSequence];
    const [type] = next.splice(from, 1);
    if (type === undefined) return;
    next.splice(to, 0, type);
    this.typeSequence = normalizeStudyTypeSequence(next);
    this.renderSequence();
    applyHoverDescriptions(this.sequenceList ?? this.modalEl);
  }

  private submit(): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve({
      mode: this.mode,
      typeSequence: [...this.typeSequence],
      shuffleWithinTypes: this.shuffleWithinTypes,
      rememberAsDefault: this.rememberAsDefault,
    });
    this.close();
  }
}

function isStudyOrder(value: string): value is StudyOrderDefault {
  return value === "bank"
    || value === "shuffle"
    || value === "shuffle-types"
    || value === "type-sequence";
}

function orderDescription(mode: StudyOrderDefault): string {
  if (mode === "shuffle") {
    return "Every question is randomized independently, so exercise types may alternate freely.";
  }
  if (mode === "shuffle-types") {
    return "Questions stay in type blocks, while the order of those blocks is randomized for this session.";
  }
  if (mode === "type-sequence") {
    return "Questions stay in type blocks and follow the editable progression below.";
  }
  return "Questions follow the exact order saved in the reviewed practice bank.";
}
