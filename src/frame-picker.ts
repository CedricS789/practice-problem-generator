import { App, Modal, Setting } from "obsidian";
import type { SampledFrame } from "./media";
import { installHoverDescriptions } from "./ui/hover-descriptions";

export class FramePickerModal extends Modal {
  private readonly objectUrls: string[] = [];
  private settled = false;

  constructor(
    app: App,
    private readonly frames: readonly SampledFrame[],
    private readonly resolveSelection: (frame: SampledFrame | null) => void
  ) {
    super(app);
  }

  override onOpen(): void {
    const gifPositions = this.frames.every((frame) => frame.position !== undefined);
    this.titleEl.setText(
      gifPositions
        ? "Choose the GIF frame"
        : "Choose a frame for occlusion",
    );
    this.modalEl.addClass("practice-lab-frame-modal");
    this.contentEl.createEl("p", {
      text: gifPositions
        ? "Choose First, Middle, or Last. Grounded Problems saves that frame as a new PNG and leaves the original GIF unchanged."
        : "Grounded Problems will save only the selected frame as a new PNG. The original animation or video stays unchanged."
    });
    const grid = this.contentEl.createDiv({ cls: "practice-lab-frame-grid" });
    for (const frame of this.frames) {
      const card = grid.createEl("button", {
        cls: "practice-lab-frame-card",
        attr: { type: "button", "aria-label": `Use frame at ${frame.label}` }
      });
      const url = URL.createObjectURL(new Blob([frame.bytes], { type: frame.mimeType }));
      this.objectUrls.push(url);
      card.createEl("img", { attr: { src: url, alt: `Preview at ${frame.label}` } });
      card.createSpan({ text: frame.label });
      card.addEventListener("click", () => {
        this.finish(frame);
        this.close();
      });
    }
    new Setting(this.contentEl).addButton((button) => button
      .setButtonText("Cancel")
      .onClick(() => this.close()));
    installHoverDescriptions(this.contentEl);
  }

  override onClose(): void {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.length = 0;
    this.contentEl.empty();
    this.finish(null);
  }

  private finish(frame: SampledFrame | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveSelection(frame);
  }
}

export async function chooseFrame(app: App, frames: readonly SampledFrame[]): Promise<SampledFrame | null> {
  return new Promise((resolve) => new FramePickerModal(app, frames, resolve).open());
}
