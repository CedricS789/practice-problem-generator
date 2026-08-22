import { FuzzySuggestModal, type App } from "obsidian";

import type { PracticeSetV1 } from "../model";

export function choosePracticeSet(
  app: App,
  sets: readonly PracticeSetV1[],
  purpose = "start",
): Promise<PracticeSetV1 | null> {
  return new Promise((resolve) => {
    new PracticeSetPickerModal(app, sets, purpose, resolve).open();
  });
}

class PracticeSetPickerModal extends FuzzySuggestModal<PracticeSetV1> {
  private settled = false;

  constructor(
    app: App,
    private readonly sets: readonly PracticeSetV1[],
    purpose: string,
    private readonly resolve: (set: PracticeSetV1 | null) => void,
  ) {
    super(app);
    this.setPlaceholder(`Choose a practice set to ${purpose}…`);
    this.setInstructions([
      { command: "↑↓", purpose: "navigate" },
      { command: "↵", purpose: "choose set" },
      { command: "esc", purpose: "cancel" },
    ]);
  }

  getItems(): PracticeSetV1[] {
    return [...this.sets].sort((left, right) => (
      left.order - right.order || left.title.localeCompare(right.title)
    ));
  }

  getItemText(set: PracticeSetV1): string {
    return `${set.title} — ${set.purpose}`;
  }

  onChooseItem(set: PracticeSetV1): void {
    this.finish(set);
  }

  override onClose(): void {
    super.onClose();
    this.finish(null);
  }

  private finish(set: PracticeSetV1 | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(set);
  }
}
