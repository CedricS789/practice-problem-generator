import { App, Modal, Setting } from "obsidian";
import { validateRange, type PdfDocumentInfo, type PdfPageRange } from "../pdf-tools";
import { installHoverDescriptions } from "./hover-descriptions";

export interface PdfPageRangeModalOptions {
  readonly title: string;
  readonly info: PdfDocumentInfo;
  readonly defaultPageCount: number;
  readonly maxPages: number;
  readonly maxCharacters: number;
}

export function choosePdfPageRange(
  app: App,
  options: PdfPageRangeModalOptions,
): Promise<PdfPageRange | null> {
  return new Promise((resolve) => {
    new PdfPageRangeModal(app, options, resolve).open();
  });
}

class PdfPageRangeModal extends Modal {
  private selectionMode: "single" | "range" = "range";
  private singlePage = 1;
  private firstPage = 1;
  private lastPage: number;
  private settled = false;
  private status?: HTMLElement;
  private submit?: HTMLButtonElement;
  private singleInput?: HTMLInputElement;
  private firstInput?: HTMLInputElement;
  private lastInput?: HTMLInputElement;
  private singlePageSetting?: HTMLElement;
  private singleQuickSetting?: HTMLElement;
  private firstPageSetting?: HTMLElement;
  private lastPageSetting?: HTMLElement;
  private rangeQuickSetting?: HTMLElement;
  private previousPageButton?: HTMLButtonElement;
  private nextPageButton?: HTMLButtonElement;

  constructor(
    app: App,
    private readonly options: PdfPageRangeModalOptions,
    private readonly resolve: (range: PdfPageRange | null) => void,
  ) {
    super(app);
    this.lastPage = Math.min(options.info.pageCount, options.defaultPageCount);
  }

  override onOpen(): void {
    this.setTitle("Choose PDF pages");
    this.contentEl.addClass("practice-lab-pdf-range-modal");
    this.contentEl.createEl("p", {
      text: `Source: ${this.options.title} · ${this.options.info.pageCount.toLocaleString()} pages`,
    });
    this.contentEl.createEl("p", {
      cls: "setting-item-description",
      text: `Choose exactly what the AI may consider. Text extraction runs locally from a temporary copy. This selection has room for at most ${this.options.maxPages.toLocaleString()} pages and ${this.options.maxCharacters.toLocaleString()} extracted characters in the shared PDF budget; extraction fails instead of truncating evidence. Practice Problem Generator never modifies the PDF. You will inspect the exact provider payload before generation.`,
    });

    new Setting(this.contentEl)
      .setName("Selection mode")
      .setDesc("Single page extracts and sends only that page. Page range keeps a bounded multi-page selection.")
      .addDropdown((dropdown) => dropdown
        .addOption("single", "Single page")
        .addOption("range", "Page range")
        .setValue(this.selectionMode)
        .onChange((value) => {
          if (value !== "single" && value !== "range") return;
          if (value === "single" && this.selectionMode === "range") {
            this.singlePage = Number.isInteger(this.firstPage) ? this.firstPage : 1;
          }
          this.selectionMode = value;
          this.syncInputs();
          this.refreshMode();
          this.focusActiveInput();
        }));

    const singlePage = new Setting(this.contentEl)
      .setName("Page")
      .setDesc("Only this page is extracted and sent to the AI. Adjacent pages are excluded.")
      .addText((text) => {
        this.singleInput = text.inputEl;
        this.configureNumberInput(this.singleInput, this.singlePage);
        text.onChange((value) => {
          this.singlePage = Number.parseInt(value, 10);
          this.refreshValidation();
        });
      });
    this.singlePageSetting = singlePage.settingEl;

    const singleQuick = new Setting(this.contentEl).setName("Move to page");
    singleQuick.addButton((button) => button
      .setButtonText("First")
      .setTooltip("Select page 1.")
      .onClick(() => this.setSinglePage(1)));
    singleQuick.addButton((button) => {
      this.previousPageButton = button.buttonEl;
      button
        .setButtonText("Previous")
        .setTooltip("Select the previous page.")
        .onClick(() => this.setSinglePage(this.singlePage - 1));
    });
    singleQuick.addButton((button) => {
      this.nextPageButton = button.buttonEl;
      button
        .setButtonText("Next")
        .setTooltip("Select the next page.")
        .onClick(() => this.setSinglePage(this.singlePage + 1));
    });
    singleQuick.addButton((button) => button
      .setButtonText("Last")
      .setTooltip(`Select page ${this.options.info.pageCount.toLocaleString()}.`)
      .onClick(() => this.setSinglePage(this.options.info.pageCount)));
    this.singleQuickSetting = singleQuick.settingEl;

    const firstPage = new Setting(this.contentEl)
      .setName("First page")
      .setDesc("PDF page number, starting at 1.")
      .addText((text) => {
        this.firstInput = text.inputEl;
        this.configureNumberInput(this.firstInput, this.firstPage);
        text.onChange((value) => {
          this.firstPage = Number.parseInt(value, 10);
          this.refreshValidation();
        });
      });
    this.firstPageSetting = firstPage.settingEl;
    const lastPage = new Setting(this.contentEl)
      .setName("Last page")
      .setDesc(`This selection can use at most ${this.options.maxPages.toLocaleString()} pages under the current generation budget.`)
      .addText((text) => {
        this.lastInput = text.inputEl;
        this.configureNumberInput(this.lastInput, this.lastPage);
        text.onChange((value) => {
          this.lastPage = Number.parseInt(value, 10);
          this.refreshValidation();
        });
      });
    this.lastPageSetting = lastPage.settingEl;

    const quick = new Setting(this.contentEl).setName("Quick range");
    quick.addButton((button) => button
      .setButtonText(`First ${Math.min(this.options.defaultPageCount, this.options.info.pageCount)}`)
      .setTooltip("Select the first default-sized page range.")
      .onClick(() => {
        this.firstPage = 1;
        this.lastPage = Math.min(this.options.defaultPageCount, this.options.info.pageCount);
        this.syncInputs();
        this.refreshValidation();
      }));
    this.rangeQuickSetting = quick.settingEl;
    quick.addButton((button) => button
      .setButtonText(`Last ${Math.min(this.options.defaultPageCount, this.options.info.pageCount)}`)
      .setTooltip("Select the last default-sized page range.")
      .onClick(() => {
        this.lastPage = this.options.info.pageCount;
        this.firstPage = Math.max(
          1,
          this.lastPage - this.options.defaultPageCount + 1,
        );
        this.syncInputs();
        this.refreshValidation();
      }));
    quick.addButton((button) => button
      .setButtonText("Whole PDF")
      .setDisabled(this.options.info.pageCount > this.options.maxPages)
      .setTooltip(
        this.options.info.pageCount > this.options.maxPages
          ? `Whole PDF exceeds the ${this.options.maxPages}-page limit.`
          : "Select every page in this PDF.",
      )
      .onClick(() => {
        this.firstPage = 1;
        this.lastPage = this.options.info.pageCount;
        this.syncInputs();
        this.refreshValidation();
      }));

    this.status = this.contentEl.createDiv({
      cls: "practice-lab-pdf-range-status",
      attr: { role: "status", "aria-live": "polite" },
    });
    const actions = this.contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = actions.createEl("button", { text: "Cancel", attr: { type: "button" } });
    cancel.addEventListener("click", () => this.close());
    this.submit = actions.createEl("button", {
      text: "Extract pages",
      cls: "mod-cta",
      attr: { type: "button" },
    });
    this.submit.addEventListener("click", () => this.submitRange());
    this.contentEl.addEventListener("keydown", (event) => {
      if (
        event.key !== "Enter"
        || event.shiftKey
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || !this.isActiveInput(event.target)
        || this.submit?.disabled !== false
      ) {
        return;
      }
      event.preventDefault();
      this.submitRange();
    });
    this.refreshMode();
    installHoverDescriptions(this.modalEl);
    this.focusActiveInput();
  }

  override onClose(): void {
    this.contentEl.empty();
    this.finish(null);
  }

  private configureNumberInput(input: HTMLInputElement, value: number): void {
    input.type = "number";
    input.min = "1";
    input.max = String(this.options.info.pageCount);
    input.step = "1";
    input.value = String(value);
  }

  private refreshValidation(): void {
    const range = this.selectedRange();
    try {
      validateRange(this.options.info, range, this.options.maxPages);
      const count = range.lastPage - range.firstPage + 1;
      this.status?.setText(
        this.selectionMode === "single"
          ? `Page ${range.firstPage.toLocaleString()} selected · only this page will be extracted and sent`
          : `${count.toLocaleString()} ${count === 1 ? "page" : "pages"} selected`,
      );
      this.status?.removeClass("is-invalid");
      this.singleInput?.setAttribute("aria-invalid", "false");
      this.firstInput?.setAttribute("aria-invalid", "false");
      this.lastInput?.setAttribute("aria-invalid", "false");
      if (this.submit !== undefined) this.submit.disabled = false;
    } catch (error) {
      this.status?.setText(error instanceof Error ? error.message : "Choose a valid page range.");
      this.status?.addClass("is-invalid");
      this.singleInput?.setAttribute(
        "aria-invalid",
        this.selectionMode === "single" ? "true" : "false",
      );
      this.firstInput?.setAttribute(
        "aria-invalid",
        this.selectionMode === "range" ? "true" : "false",
      );
      this.lastInput?.setAttribute(
        "aria-invalid",
        this.selectionMode === "range" ? "true" : "false",
      );
      if (this.submit !== undefined) this.submit.disabled = true;
    }
    this.refreshSingleNavigation();
  }

  private syncInputs(): void {
    if (this.singleInput !== undefined) {
      this.singleInput.value = String(this.singlePage);
    }
    if (this.firstInput !== undefined) {
      this.firstInput.value = String(this.firstPage);
    }
    if (this.lastInput !== undefined) {
      this.lastInput.value = String(this.lastPage);
    }
  }

  private submitRange(): void {
    const range = this.selectedRange();
    validateRange(this.options.info, range, this.options.maxPages);
    this.finish(range);
    this.close();
  }

  private selectedRange(): PdfPageRange {
    return this.selectionMode === "single"
      ? { firstPage: this.singlePage, lastPage: this.singlePage }
      : { firstPage: this.firstPage, lastPage: this.lastPage };
  }

  private refreshMode(): void {
    const single = this.selectionMode === "single";
    if (this.singlePageSetting !== undefined) this.singlePageSetting.hidden = !single;
    if (this.singleQuickSetting !== undefined) this.singleQuickSetting.hidden = !single;
    if (this.firstPageSetting !== undefined) this.firstPageSetting.hidden = single;
    if (this.lastPageSetting !== undefined) this.lastPageSetting.hidden = single;
    if (this.rangeQuickSetting !== undefined) this.rangeQuickSetting.hidden = single;
    if (this.submit !== undefined) {
      this.submit.textContent = single ? "Extract page" : "Extract pages";
    }
    this.refreshValidation();
  }

  private setSinglePage(page: number): void {
    this.singlePage = Math.min(this.options.info.pageCount, Math.max(1, page));
    this.syncInputs();
    this.refreshValidation();
    this.singleInput?.focus();
    this.singleInput?.select();
  }

  private refreshSingleNavigation(): void {
    const valid = Number.isInteger(this.singlePage);
    if (this.previousPageButton !== undefined) {
      this.previousPageButton.disabled = !valid || this.singlePage <= 1;
    }
    if (this.nextPageButton !== undefined) {
      this.nextPageButton.disabled = !valid || this.singlePage >= this.options.info.pageCount;
    }
  }

  private isActiveInput(target: EventTarget | null): boolean {
    return this.selectionMode === "single"
      ? target === this.singleInput
      : target === this.firstInput || target === this.lastInput;
  }

  private focusActiveInput(): void {
    window.requestAnimationFrame(() => {
      const input = this.selectionMode === "single" ? this.singleInput : this.firstInput;
      input?.focus();
      input?.select();
    });
  }

  private finish(value: PdfPageRange | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(value);
  }
}
