import { App, Modal, Setting } from "obsidian";
import type { DownloadedRemoteImage } from "./media";
import { installHoverDescriptions } from "./ui/hover-descriptions";

export class RemoteImageImportModal extends Modal {
  private objectUrl = "";
  private settled = false;

  constructor(
    app: App,
    private readonly image: DownloadedRemoteImage,
    private readonly settle: (approved: boolean) => void
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText("Import remote image");
    this.modalEl.addClass("practice-lab-remote-modal");
    this.contentEl.createEl("p", {
      text: `Preview downloaded from ${this.image.host}. Importing creates a local content-hash snapshot and does not rewrite the source note.`
    });
    this.objectUrl = URL.createObjectURL(new Blob([this.image.bytes], { type: this.image.mimeType }));
    this.contentEl.createEl("img", {
      cls: "practice-lab-remote-preview",
      attr: { src: this.objectUrl, alt: `Remote image preview from ${this.image.host}` }
    });
    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText("Cancel")
        .onClick(() => this.close()))
      .addButton((button) => button
        .setCta()
        .setButtonText("Import local snapshot")
        .onClick(() => {
          this.finish(true);
          this.close();
        }));
    installHoverDescriptions(this.contentEl);
  }

  override onClose(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = "";
    this.contentEl.empty();
    this.finish(false);
  }

  private finish(approved: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.settle(approved);
  }
}

export async function confirmRemoteImageImport(app: App, image: DownloadedRemoteImage): Promise<boolean> {
  return new Promise((resolve) => new RemoteImageImportModal(app, image, resolve).open());
}
