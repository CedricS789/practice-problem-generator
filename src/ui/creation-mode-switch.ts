import type { CreationMode } from "./source-picker";

export interface CreationModeSwitchOptions {
  readonly active: CreationMode;
  readonly quickDisabled: boolean;
  readonly guidedDisabled: boolean;
  readonly quickDisabledReason?: string;
  readonly guidedDisabledReason?: string;
  readonly onQuick: () => void;
  readonly onGuided: () => void;
}

const QUICK_DESCRIPTION = "Create one configurable practice set from the selected source.";
const GUIDED_DESCRIPTION = "Create a prerequisite-aware sequence of tutor lessons and focused practice sets.";

export function renderCreationModeSwitch(
  container: HTMLElement,
  options: CreationModeSwitchOptions,
): void {
  const row = container.createDiv({ cls: "practice-creation-mode-row" });
  const switcher = row.createDiv({
    cls: "practice-creation-mode-switch",
    attr: {
      role: "group",
      "aria-label": "Practice creation mode",
    },
  });
  createModeButton(switcher, {
    label: "Quick set",
    selected: options.active === "quick",
    disabled: options.quickDisabled,
    description: options.quickDisabledReason ?? QUICK_DESCRIPTION,
    onClick: options.onQuick,
  });
  createModeButton(switcher, {
    label: "Guided path",
    selected: options.active === "guided",
    disabled: options.guidedDisabled,
    description: options.guidedDisabledReason ?? GUIDED_DESCRIPTION,
    onClick: options.onGuided,
  });
}

function createModeButton(
  container: HTMLElement,
  options: {
    readonly label: string;
    readonly selected: boolean;
    readonly disabled: boolean;
    readonly description: string;
    readonly onClick: () => void;
  },
): void {
  const button = container.createEl("button", {
    cls: options.selected ? "is-selected" : "",
    text: options.label,
    attr: {
      type: "button",
      "aria-pressed": String(options.selected),
      title: options.description,
      "data-practice-lab-description": options.description,
    },
  });
  button.disabled = options.disabled;
  button.addEventListener("click", () => {
    if (!button.disabled) options.onClick();
  });
}
