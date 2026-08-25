import { FuzzySuggestModal, type App, type TFile } from "obsidian";
import { installHoverDescriptions } from "./hover-descriptions";

export function chooseSourceNoteFile(app: App): Promise<TFile | null> {
  return new Promise((resolve) => {
    new SourceMaterialPickerModal(app, resolve, "note").open();
  });
}

export function chooseSourcePdfFile(app: App): Promise<TFile | null> {
  return new Promise((resolve) => {
    new SourceMaterialPickerModal(app, resolve, "pdf").open();
  });
}

class SourceMaterialPickerModal extends FuzzySuggestModal<TFile> {
  private settled = false;
  private chosenFile: TFile | null = null;

  constructor(
    app: App,
    private readonly resolve: (file: TFile | null) => void,
    private readonly kind: "note" | "pdf",
  ) {
    super(app);
    this.setPlaceholder(
      kind === "note"
        ? "Search for the Markdown note to use…"
        : "Search for the PDF whose pages you want to add…",
    );
    this.setInstructions([
      { command: "↑↓", purpose: "navigate" },
      {
        command: "↵",
        purpose: kind === "note"
          ? "use note"
          : "choose pages",
      },
      { command: "esc", purpose: "cancel" },
    ]);
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles()
      .filter((file) => {
        const extension = file.extension.toLowerCase();
        const supported = this.kind === "note"
          ? extension === "md"
          : extension === "pdf";
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
    this.chosenFile = file;
  }

  override onClose(): void {
    super.onClose();
    // FuzzySuggestModal closes in the same selection turn. Resolve on the
    // next task so a caller never opens a PDF page-range modal underneath the
    // picker that is still closing.
    window.setTimeout(() => this.finish(this.chosenFile), 0);
  }

  private finish(file: TFile | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(file);
  }
}
