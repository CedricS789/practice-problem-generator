import { setIcon } from "obsidian";

import type { SourcePresentation } from "./contracts";

export type SourceChoiceMode = "note" | "selection" | "vault-note" | "pdf";
export type CreationMode = "quick" | "guided";

export interface SourceChoiceOptions {
  readonly availableModes: ReadonlySet<SourceChoiceMode>;
  readonly busyMode: SourceChoiceMode | null;
  readonly disabled: boolean;
  readonly onChoose: (mode: SourceChoiceMode) => void;
}

const SOURCE_CHOICES: ReadonlyArray<{
  readonly mode: SourceChoiceMode;
  readonly label: string;
  readonly loadingLabel: string;
  readonly description: string;
  readonly icon: string;
}> = [
  {
    mode: "note",
    label: "Current note",
    loadingLabel: "Loading note…",
    description: "Use the complete active Markdown note as the approved primary source.",
    icon: "file-text",
  },
  {
    mode: "selection",
    label: "Editor selection",
    loadingLabel: "Loading selection…",
    description: "Use only the text currently selected in the active Markdown editor.",
    icon: "text-select",
  },
  {
    mode: "pdf",
    label: "PDF pages",
    loadingLabel: "Choosing pages…",
    description: "Choose an exact page or page range from the active PDF.",
    icon: "file-scan",
  },
];

export function renderSourceChoices(
  container: HTMLElement,
  options: SourceChoiceOptions,
): void {
  const grid = container.createDiv({
    cls: "practice-source-choice-grid",
    attr: { "aria-label": "Choose the primary source" },
  });
  for (const choice of SOURCE_CHOICES) {
    if (!options.availableModes.has(choice.mode)) continue;
    const busy = options.busyMode === choice.mode;
    const button = grid.createEl("button", {
      cls: "practice-source-choice",
      attr: {
        type: "button",
        title: choice.description,
        "aria-label": `${choice.label}. ${choice.description}`,
        "aria-busy": String(busy),
        "data-practice-lab-description": choice.description,
      },
    });
    button.disabled = options.disabled;
    const icon = button.createSpan({ cls: "practice-source-choice-icon" });
    setIcon(icon, choice.icon);
    const copy = button.createSpan({ cls: "practice-source-choice-copy" });
    copy.createEl("strong", { text: busy ? choice.loadingLabel : choice.label });
    copy.createSpan({ text: choice.description });
    button.addEventListener("click", () => {
      if (!button.disabled) options.onChoose(choice.mode);
    });
  }
}

export function renderSourceSummaryCard(
  container: HTMLElement,
  source: SourcePresentation,
  options: {
    readonly badge: string;
    readonly showPath?: boolean;
    readonly showExcerpt?: boolean;
    readonly removeLabel?: string;
    readonly removeDisabled?: boolean;
    readonly onRemove?: () => void;
    readonly actionLabel?: string;
    readonly actionDescription?: string;
    readonly actionDisabled?: boolean;
    readonly onAction?: () => void;
  },
): HTMLElement {
  const card = container.createEl("article", {
    cls: "practice-source-summary-card practice-learning-path-source-card",
  });
  const icon = card.createDiv({ cls: "practice-learning-path-source-icon" });
  setIcon(
    icon,
    source.mode === "pdf"
      ? "file-scan"
      : source.mode === "selection" ? "text-select" : "file-text",
  );
  const copy = card.createDiv({ cls: "practice-learning-path-source-copy" });
  copy.createSpan({ cls: "practice-lab-badge", text: options.badge });
  copy.createEl("strong", { text: source.title });
  copy.createEl("p", {
    text: source.detail ?? `${source.characterCount.toLocaleString()} submitted characters`,
  });
  if (options.showPath === true) {
    copy.createDiv({ cls: "practice-source-summary-path", text: source.path });
  }
  if (options.showExcerpt === true) {
    copy.createEl("p", {
      cls: "practice-source-summary-excerpt",
      text: source.excerpt,
    });
  }
  copy.createSpan({
    cls: "practice-source-summary-meta",
    text: `${source.characterCount.toLocaleString()} characters submitted`,
  });
  if (
    (options.onAction !== undefined && options.actionLabel !== undefined)
    || (options.onRemove !== undefined && options.removeLabel !== undefined)
  ) {
    const actions = card.createDiv({ cls: "practice-source-summary-actions" });
    if (options.onAction !== undefined && options.actionLabel !== undefined) {
      const description = options.actionDescription ?? options.actionLabel;
      const action = actions.createEl("button", {
        cls: "practice-source-summary-action",
        attr: {
          type: "button",
          "aria-label": description,
          title: description,
          "data-practice-lab-description": description,
        },
      });
      action.disabled = options.actionDisabled ?? false;
      const actionIcon = action.createSpan({ attr: { "aria-hidden": "true" } });
      setIcon(actionIcon, "replace");
      action.createSpan({ text: options.actionLabel });
      action.addEventListener("click", () => options.onAction?.());
    }
    if (options.onRemove !== undefined && options.removeLabel !== undefined) {
      const remove = actions.createEl("button", {
        cls: "clickable-icon practice-source-summary-remove",
        attr: {
          type: "button",
          "aria-label": options.removeLabel,
          title: options.removeLabel,
          "data-practice-lab-description": options.removeLabel,
        },
      });
      remove.disabled = options.removeDisabled ?? false;
      setIcon(remove, "x");
      remove.addEventListener("click", () => options.onRemove?.());
    }
  }
  return card;
}

export function sourceModeLabel(source: SourcePresentation): string {
  if (source.mode === "selection") return "Editor selection";
  if (source.mode === "pdf") return "PDF pages";
  return "Current note";
}
