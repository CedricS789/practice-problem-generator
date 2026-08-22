import {
  DIFFICULTY_PROFILES,
  type GenerationDifficulty,
} from "../difficulty";

export interface DifficultySelectorOptions {
  readonly value: GenerationDifficulty;
  readonly name: string;
  readonly ariaLabel: string;
  readonly compact?: boolean;
  readonly onChange: (value: GenerationDifficulty) => void;
}

export interface DifficultySelectorHandle {
  readonly setValue: (value: GenerationDifficulty) => void;
}

/** Render a keyboard-accessible profile chooser with the same semantics everywhere. */
export function renderDifficultySelector(
  container: HTMLElement,
  options: DifficultySelectorOptions,
): DifficultySelectorHandle {
  const group = container.createDiv({
    cls: `practice-lab-difficulty-grid${options.compact === true ? " is-compact" : ""}`,
    attr: {
      role: "radiogroup",
      "aria-label": options.ariaLabel,
    },
  });
  let value = options.value;
  const controls: {
    readonly card: HTMLLabelElement;
    readonly input: HTMLInputElement;
    readonly id: GenerationDifficulty;
  }[] = [];

  const sync = (): void => {
    for (const control of controls) {
      const selected = control.id === value;
      control.card.classList.toggle("is-selected", selected);
      control.input.checked = selected;
    }
  };

  for (const profile of DIFFICULTY_PROFILES) {
    const tooltip = `${profile.label}: ${profile.description} ${profile.itemCalibration}`;
    const card = group.createEl("label", {
      cls: "practice-lab-difficulty-option",
      attr: { title: tooltip },
    });
    const input = card.createEl("input", {
      attr: {
        type: "radio",
        name: options.name,
        value: profile.id,
        title: tooltip,
      },
    });
    const copy = card.createDiv({ cls: "practice-lab-difficulty-copy" });
    const heading = copy.createDiv({ cls: "practice-lab-difficulty-heading" });
    heading.createEl("strong", { text: profile.label });
    if (profile.recommended) {
      heading.createSpan({
        cls: "practice-lab-difficulty-recommended",
        text: "Recommended",
      });
    }
    copy.createSpan({
      cls: "practice-lab-difficulty-tagline",
      text: profile.tagline,
    });
    copy.createSpan({
      cls: "practice-lab-difficulty-description",
      text: profile.description,
    });
    copy.createSpan({
      cls: "practice-lab-difficulty-calibration",
      text: profile.itemCalibration,
    });
    controls.push({ card, input, id: profile.id });
    input.addEventListener("change", () => {
      if (!input.checked) return;
      value = profile.id;
      sync();
      options.onChange(profile.id);
    });
  }
  sync();
  return {
    setValue: (next) => {
      value = next;
      sync();
    },
  };
}
