import { FuzzySuggestModal, type App, type TFile } from "obsidian";
import { installHoverDescriptions } from "./hover-descriptions";

export function chooseSourceMaterialFile(app: App): Promise<TFile | null> {
  return new Promise((resolve) => {
    new SourceMaterialPickerModal(app, resolve, "material").open();
  });
}

export function chooseSourceNoteFile(app: App): Promise<TFile | null> {
  return new Promise((resolve) => {
    new SourceMaterialPickerModal(app, resolve, "note").open();
  });
}

class SourceMaterialPickerModal extends FuzzySuggestModal<TFile> {
  private settled = false;

  constructor(
    app: App,
    private readonly resolve: (file: TFile | null) => void,
    private readonly kind: "material" | "note",
  ) {
    super(app);
    this.setPlaceholder(kind === "note"
      ? "Search for the Markdown note to use…"
      : "Choose one supporting note or PDF…");
    this.setInstructions([
      { command: "↑↓", purpose: "navigate" },
      { command: "↵", purpose: kind === "note" ? "use note" : "add exact source" },
      { command: "esc", purpose: "cancel" },
    ]);
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles()
      .filter((file) => {
        const extension = file.extension.toLowerCase();
        const supported = this.kind === "note"
          ? extension === "md"
          : extension === "md" || extension === "pdf";
        return supported
          && !/(?:^|\/)Practice(?:\/|$)/iu.test(file.path);
      })
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  override async onOpen(): Promise<void> {
    await super.onOpen();
    installHoverDescriptions(this.modalEl);
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.finish(file);
  }

  override onClose(): void {
    super.onClose();
    this.finish(null);
  }

  private finish(file: TFile | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(file);
  }
}
