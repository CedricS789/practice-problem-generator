import { App, Modal, setIcon } from "obsidian";

import type { OfflineReadinessReport } from "../offline-readiness";
import { installHoverDescriptions } from "./hover-descriptions";

export class OfflineReadinessModal extends Modal {
  public constructor(
    app: App,
    private readonly report: OfflineReadinessReport,
  ) {
    super(app);
  }

  public override onOpen(): void {
    this.setTitle("Prepare for offline practice");
    this.modalEl.addClass("practice-lab-offline-modal");
    const status = this.contentEl.createDiv({
      cls: `practice-lab-offline-status ${this.report.ready ? "is-ready" : "is-blocked"}`,
      attr: { role: "status" },
    });
    setIcon(status.createSpan(), this.report.ready ? "circle-check" : "triangle-alert");
    status.createEl("strong", {
      text: this.report.ready
        ? "Selected practice is ready for the configured offline subset"
        : "Fix the blocking items before relying on offline practice",
    });
    status.createEl("p", {
      text: `${this.report.bankCount} ${this.report.bankCount === 1 ? "bank" : "banks"}, ${this.report.exerciseCount} exercises, ${this.report.occlusionCount} image ${this.report.occlusionCount === 1 ? "occlusion" : "occlusions"}, and ${this.report.referencedImagePaths.length} referenced static ${this.report.referencedImagePaths.length === 1 ? "image" : "images"} were audited locally.`,
    });

    this.contentEl.createEl("p", {
      cls: "practice-lab-muted",
      text: "This audit does not contact or control a sync plugin. It checks the saved Markdown contracts and the files needed to study them after synchronization.",
    });

    if (this.report.issues.length > 0) {
      const list = this.contentEl.createEl("ul", {
        cls: "practice-lab-offline-issues",
      });
      for (const issue of this.report.issues) {
        const item = list.createEl("li", {
          cls: `is-${issue.severity}`,
        });
        item.createEl("strong", {
          text: issue.severity === "error" ? "Blocking: " : "Check: ",
        });
        item.appendText(issue.message);
        item.createDiv({ cls: "practice-lab-muted", text: issue.bankPath });
      }
    }

    const details = this.contentEl.createEl("details");
    details.createEl("summary", { text: "Referenced image transfer list" });
    if (this.report.referencedImagePaths.length === 0) {
      details.createEl("p", { text: "No image files are required by the selected banks." });
    } else {
      const list = details.createEl("ul", { cls: "practice-lab-offline-paths" });
      for (const path of this.report.referencedImagePaths) list.createEl("li", { text: path });
    }

    const footer = this.contentEl.createDiv({ cls: "modal-button-container" });
    const close = footer.createEl("button", { text: "Close" });
    close.addEventListener("click", () => this.close());
    installHoverDescriptions(this.modalEl);
  }

  public override onClose(): void {
    this.contentEl.empty();
  }
}
