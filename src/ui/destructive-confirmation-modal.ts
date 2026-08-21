import { App, Modal, Setting } from "obsidian";

export interface DestructiveConfirmationOptions {
  readonly title: string;
  readonly warning: string;
  readonly consequences: readonly string[];
  readonly confirmationPhrase: string;
  readonly confirmLabel: string;
}

class DestructiveConfirmationModal extends Modal {
  private resolved = false;

  public constructor(
    app: App,
    private readonly options: DestructiveConfirmationOptions,
    private readonly resolve: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  public override onOpen(): void {
    this.titleEl.setText(this.options.title);
    this.modalEl.addClass("practice-lab-destructive-modal");
    this.contentEl.createEl("p", {
      cls: "practice-lab-destructive-warning",
      text: this.options.warning,
    });
    const list = this.contentEl.createEl("ul");
    for (const consequence of this.options.consequences) {
      list.createEl("li", { text: consequence });
    }
    this.contentEl.createEl("p", {
      text: "This action is never triggered automatically.",
    });
    const phrase = this.contentEl.createEl("p", {
      cls: "practice-lab-confirmation-phrase",
    });
    phrase.appendText("Type ");
    phrase.createEl("code", { text: this.options.confirmationPhrase });
    phrase.appendText(" to continue.");

    let typed = "";
    let confirmButton: HTMLButtonElement | undefined;
    const update = (): void => {
      if (confirmButton !== undefined) {
        confirmButton.disabled = typed.trim() !== this.options.confirmationPhrase;
      }
    };
    new Setting(this.contentEl)
      .setName("Confirmation")
      .setDesc("The phrase must match exactly.")
      .addText((text) => {
        text.inputEl.setAttribute("aria-label", "Destructive action confirmation phrase");
        text.inputEl.autocomplete = "off";
        text.inputEl.spellcheck = false;
        text.onChange((value) => {
          typed = value;
          update();
        });
        window.setTimeout(() => { text.inputEl.focus(); }, 0);
      });
    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText("Cancel")
        .onClick(() => { this.finish(false); }))
      .addButton((button) => {
        button.setButtonText(this.options.confirmLabel).setDestructive();
        confirmButton = button.buttonEl;
        update();
        button.onClick(() => { this.finish(true); });
      });
  }

  public override onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.resolve(false);
    }
  }

  private finish(confirmed: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(confirmed);
    this.close();
  }
}

export function confirmDestructiveAction(
  app: App,
  options: DestructiveConfirmationOptions,
): Promise<boolean> {
  return new Promise((resolve) => {
    new DestructiveConfirmationModal(app, options, resolve).open();
  });
}
