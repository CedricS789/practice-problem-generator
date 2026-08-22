import { App, Modal, setIcon } from "obsidian";
import { installHoverDescriptions } from "./hover-descriptions";

export interface PdfExtractionProgressOptions {
  readonly title: string;
  readonly firstPage: number;
  readonly lastPage: number;
}

export interface PdfExtractionProgressHandle {
  readonly signal: AbortSignal;
  finish(): void;
}

export function showPdfExtractionProgress(
  app: App,
  options: PdfExtractionProgressOptions,
): PdfExtractionProgressHandle {
  const modal = new PdfExtractionProgressModal(app, options);
  modal.open();
  return modal;
}

class PdfExtractionProgressModal
  extends Modal
  implements PdfExtractionProgressHandle {
  private readonly controller = new AbortController();
  private completed = false;
  private cancelButton?: HTMLButtonElement;
  private status?: HTMLElement;

  constructor(
    app: App,
    private readonly options: PdfExtractionProgressOptions,
  ) {
    super(app);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  override onOpen(): void {
    this.setTitle("Preparing PDF source");
    this.contentEl.addClass("practice-lab-pdf-progress-modal");
    const progress = this.contentEl.createDiv({
      cls: "practice-lab-pdf-progress",
      attr: { role: "status", "aria-live": "polite" },
    });
    const spinner = progress.createSpan({ cls: "practice-lab-spinner" });
    setIcon(spinner, "loader-circle");
    const range = this.options.firstPage === this.options.lastPage
      ? `page ${this.options.firstPage}`
      : `pages ${this.options.firstPage}–${this.options.lastPage}`;
    const copy = progress.createDiv();
    copy.createEl("strong", { text: this.options.title });
    this.status = copy.createEl("p", {
      text: `Extracting ${range} locally…`,
    });
    copy.createEl("p", {
      cls: "setting-item-description",
      text: "No AI provider is contacted during extraction. The temporary PDF copy is removed when this step finishes.",
    });
    const actions = this.contentEl.createDiv({ cls: "modal-button-container" });
    this.cancelButton = actions.createEl("button", {
      text: "Cancel extraction",
      attr: { type: "button" },
    });
    this.cancelButton.addEventListener("click", () => this.cancel());
    installHoverDescriptions(this.modalEl);
  }

  override onClose(): void {
    if (!this.completed) this.controller.abort();
    this.contentEl.empty();
  }

  finish(): void {
    if (this.completed) return;
    this.completed = true;
    this.close();
  }

  private cancel(): void {
    if (this.controller.signal.aborted) return;
    this.controller.abort();
    this.status?.setText("Cancelling local PDF extraction…");
    if (this.cancelButton !== undefined) {
      this.cancelButton.disabled = true;
      this.cancelButton.setText("Cancelling…");
    }
  }
}
