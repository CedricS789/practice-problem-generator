import { ButtonComponent, Component, Notice, setIcon } from "obsidian";

import {
  DEFAULT_MIN_MASK_SIZE,
  RESIZE_HANDLES,
  moveRect,
  normalizeRect,
  rectFromPoints,
  resizeRect,
  type NormalizedPoint,
  type ResizeHandle,
} from "../geometry";
import {
  validateOcclusionMasks,
  type OcclusionMaskCandidate,
} from "../visuals";

export interface OcclusionEditorOptions {
  readonly imageUrl: string;
  readonly imageAlt: string;
  readonly masks: readonly OcclusionMaskCandidate[];
  readonly minimumSize?: number;
  readonly reviewed?: boolean;
  readonly onChange?: (
    masks: readonly OcclusionMaskCandidate[],
    reviewed: false,
  ) => void;
  readonly onReviewed?: (masks: readonly OcclusionMaskCandidate[]) => void;
}

type PointerOperation =
  | {
      readonly type: "create";
      readonly pointerId: number;
      readonly start: NormalizedPoint;
      current: NormalizedPoint;
    }
  | {
      readonly type: "move";
      readonly pointerId: number;
      readonly start: NormalizedPoint;
      readonly original: OcclusionMaskCandidate;
    }
  | {
      readonly type: "resize";
      readonly pointerId: number;
      readonly start: NormalizedPoint;
      readonly original: OcclusionMaskCandidate;
      readonly handle: ResizeHandle;
    };

const KEYBOARD_STEP = 0.005;
const KEYBOARD_LARGE_STEP = 0.02;

function cloneMask(mask: OcclusionMaskCandidate): OcclusionMaskCandidate {
  return { ...mask };
}

function nextMaskId(masks: readonly OcclusionMaskCandidate[]): string {
  let index = masks.length + 1;
  while (masks.some((mask) => mask.id === `mask-${index}`)) index += 1;
  return `mask-${index}`;
}

export class OcclusionEditor extends Component {
  private readonly minimumSize: number;
  private masks: OcclusionMaskCandidate[];
  private selectedId: string | null;
  private operation: PointerOperation | null = null;
  private canvasEl: HTMLElement | null = null;
  private maskLayerEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private reviewed: boolean;

  public constructor(
    private readonly containerEl: HTMLElement,
    private readonly options: OcclusionEditorOptions,
  ) {
    super();
    this.minimumSize = options.minimumSize ?? DEFAULT_MIN_MASK_SIZE;
    this.masks = options.masks.map(cloneMask);
    this.selectedId = this.masks[0]?.id ?? null;
    this.reviewed = options.reviewed ?? false;
  }

  public override onload(): void {
    this.renderShell();
    this.registerDomEvent(window, "pointermove", (event) => {
      this.handlePointerMove(event);
    });
    this.registerDomEvent(window, "pointerup", (event) => {
      this.handlePointerUp(event);
    });
    this.registerDomEvent(window, "pointercancel", (event) => {
      this.handlePointerUp(event);
    });
  }

  public override onunload(): void {
    this.operation = null;
    this.containerEl.empty();
  }

  public getMasks(): readonly OcclusionMaskCandidate[] {
    return this.masks.map(cloneMask);
  }

  public isReviewed(): boolean {
    return this.reviewed;
  }

  public replaceMasks(masks: readonly OcclusionMaskCandidate[]): void {
    this.masks = masks.map(cloneMask);
    this.selectedId = this.masks[0]?.id ?? null;
    this.markUnreviewed();
    this.renderMasks();
    this.renderList();
  }

  private renderShell(): void {
    this.containerEl.empty();
    this.containerEl.addClass("practice-lab-occlusion-editor");

    const guidance = this.containerEl.createEl("p", {
      cls: "practice-lab-occlusion-help",
      text: "Draw a rectangle, or select one to move and resize it. Arrow keys make precise changes; Shift + Arrow moves farther.",
    });
    guidance.id = `practice-lab-occlusion-help-${Math.random().toString(36).slice(2)}`;

    const workspace = this.containerEl.createDiv({
      cls: "practice-lab-occlusion-workspace",
    });
    const canvas = workspace.createDiv({
      cls: "practice-lab-occlusion-canvas",
      attr: {
        role: "application",
        tabindex: "0",
        "aria-describedby": guidance.id,
        "aria-label": "Image occlusion rectangle editor",
      },
    });
    this.canvasEl = canvas;
    const image = canvas.createEl("img", {
      cls: "practice-lab-occlusion-image",
      attr: { src: this.options.imageUrl, alt: this.options.imageAlt },
    });
    image.draggable = false;
    this.maskLayerEl = canvas.createDiv({
      cls: "practice-lab-occlusion-layer",
    });
    this.listEl = workspace.createDiv({ cls: "practice-lab-occlusion-list" });

    canvas.addEventListener("pointerdown", (event) => {
      if (event.target !== canvas && event.target !== this.maskLayerEl) return;
      const point = this.clientPoint(event);
      if (point === null) return;
      event.preventDefault();
      this.operation = {
        type: "create",
        pointerId: event.pointerId,
        start: point,
        current: point,
      };
      canvas.setPointerCapture(event.pointerId);
      this.renderMasks();
    });

    const footer = this.containerEl.createDiv({
      cls: "practice-lab-occlusion-footer",
    });
    this.statusEl = footer.createDiv({
      cls: "practice-lab-review-status",
      attr: { role: "status", "aria-live": "polite" },
    });
    new ButtonComponent(footer)
      .setButtonText("Add mask")
      .setTooltip("Add a centered occlusion mask")
      .onClick(() => {
        const id = nextMaskId(this.masks);
        this.masks = [
          ...this.masks,
          { id, label: `Mask ${this.masks.length + 1}`, answer: "", x: 0.4, y: 0.4, width: 0.2, height: 0.12 },
        ];
        this.selectedId = id;
        this.markUnreviewed();
        this.renderMasks();
        this.renderList();
      });
    new ButtonComponent(footer)
      .setButtonText("Review and accept masks")
      .setCta()
      .onClick(() => this.acceptMasks());

    this.renderMasks();
    this.renderList();
    this.updateStatus();
  }

  private clientPoint(event: PointerEvent): NormalizedPoint | null {
    const canvas = this.canvasEl;
    if (canvas === null) return null;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  }

  private handlePointerMove(event: PointerEvent): void {
    const operation = this.operation;
    if (operation === null || operation.pointerId !== event.pointerId) return;
    const point = this.clientPoint(event);
    if (point === null) return;
    event.preventDefault();
    if (operation.type === "create") {
      operation.current = point;
      this.renderMasks();
      return;
    }
    const deltaX = point.x - operation.start.x;
    const deltaY = point.y - operation.start.y;
    const nextRect =
      operation.type === "move"
        ? moveRect(operation.original, deltaX, deltaY, this.minimumSize)
        : resizeRect(
            operation.original,
            operation.handle,
            deltaX,
            deltaY,
            this.minimumSize,
          );
    this.replaceMask(operation.original.id, nextRect);
  }

  private handlePointerUp(event: PointerEvent): void {
    const operation = this.operation;
    if (operation === null || operation.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (operation.type === "create") {
      const rect = rectFromPoints(
        operation.start,
        operation.current,
        this.minimumSize,
      );
      const id = nextMaskId(this.masks);
      this.masks = [
        ...this.masks,
        { ...rect, id, label: `Mask ${this.masks.length + 1}`, answer: "" },
      ];
      this.selectedId = id;
      this.markUnreviewed();
    }
    this.operation = null;
    this.renderMasks();
    this.renderList();
  }

  private renderMasks(): void {
    const layer = this.maskLayerEl;
    if (layer === null) return;
    layer.empty();
    for (const mask of this.masks) this.renderMask(layer, mask);
    if (this.operation?.type === "create") {
      const preview = rectFromPoints(
        this.operation.start,
        this.operation.current,
        this.minimumSize,
      );
      const previewEl = layer.createDiv({
        cls: "practice-lab-mask practice-lab-mask-preview",
      });
      this.positionElement(previewEl, preview);
    }
  }

  private renderMask(layer: HTMLElement, mask: OcclusionMaskCandidate): void {
    const maskEl = layer.createDiv({
      cls: `practice-lab-mask${mask.id === this.selectedId ? " is-selected" : ""}`,
      attr: {
        role: "button",
        tabindex: "0",
        "aria-label": `${mask.label}. Drag to move. Use arrow keys for precise movement.`,
        "aria-pressed": mask.id === this.selectedId ? "true" : "false",
      },
    });
    this.positionElement(maskEl, mask);
    maskEl.createSpan({ cls: "practice-lab-mask-label", text: mask.label });
    maskEl.addEventListener("pointerdown", (event) => {
      if ((event.target as HTMLElement).closest(".practice-lab-mask-handle") !== null) {
        return;
      }
      const point = this.clientPoint(event);
      if (point === null) return;
      event.preventDefault();
      event.stopPropagation();
      this.selectedId = mask.id;
      this.operation = {
        type: "move",
        pointerId: event.pointerId,
        start: point,
        original: cloneMask(mask),
      };
      maskEl.setPointerCapture(event.pointerId);
      this.renderMasks();
      this.renderList();
    });
    maskEl.addEventListener("click", () => {
      this.selectedId = mask.id;
      this.renderMasks();
      this.renderList();
    });
    maskEl.addEventListener("keydown", (event) => this.handleMaskKey(event, mask));

    if (mask.id !== this.selectedId) return;
    for (const handle of RESIZE_HANDLES) {
      const handleEl = maskEl.createSpan({
        cls: `practice-lab-mask-handle is-${handle}`,
        attr: {
          role: "button",
          tabindex: "0",
          "aria-label": `Resize ${mask.label} from ${handle}`,
        },
      });
      handleEl.addEventListener("pointerdown", (event) => {
        const point = this.clientPoint(event);
        if (point === null) return;
        event.preventDefault();
        event.stopPropagation();
        this.operation = {
          type: "resize",
          pointerId: event.pointerId,
          start: point,
          original: cloneMask(mask),
          handle,
        };
        handleEl.setPointerCapture(event.pointerId);
      });
      handleEl.addEventListener("keydown", (event) => {
        this.handleResizeKey(event, mask, handle);
      });
    }
  }

  private renderList(): void {
    const list = this.listEl;
    if (list === null) return;
    list.empty();
    list.createEl("h5", { text: "Masks" });
    if (this.masks.length === 0) {
      list.createEl("p", {
        cls: "setting-item-description",
        text: "No masks yet. Draw on the image or choose add mask.",
      });
      return;
    }
    for (const mask of this.masks) {
      const row = list.createDiv({
        cls: `practice-lab-mask-row${mask.id === this.selectedId ? " is-selected" : ""}`,
      });
      const select = row.createEl("button", {
        cls: "practice-lab-mask-select clickable-icon",
        attr: { type: "button", "aria-label": `Select ${mask.label}` },
      });
      setIcon(select, mask.id === this.selectedId ? "circle-dot" : "circle");
      select.addEventListener("click", () => {
        this.selectedId = mask.id;
        this.renderMasks();
        this.renderList();
      });
      const input = row.createEl("input", {
        cls: "practice-lab-mask-name",
        attr: {
          type: "text",
          value: mask.label,
          "aria-label": `Label for ${mask.label}`,
        },
      });
      input.addEventListener("change", () => {
        const label = input.value.trim();
        this.masks = this.masks.map((entry) =>
          entry.id === mask.id
            ? { ...entry, label: label.length === 0 ? entry.label : label }
            : entry,
        );
        this.markUnreviewed();
        this.renderMasks();
        this.renderList();
      });
      const answer = row.createEl("input", {
        cls: "practice-lab-mask-answer",
        attr: {
          type: "text",
          value: mask.answer,
          placeholder: "Answer",
          "aria-label": `Answer hidden by ${mask.label}`,
        },
      });
      answer.addEventListener("change", () => {
        this.masks = this.masks.map((entry) =>
          entry.id === mask.id ? { ...entry, answer: answer.value.trim() } : entry,
        );
        this.markUnreviewed();
        this.renderMasks();
        this.renderList();
      });
      const remove = row.createEl("button", {
        cls: "clickable-icon",
        attr: { type: "button", "aria-label": `Delete ${mask.label}` },
      });
      setIcon(remove, "trash-2");
      remove.addEventListener("click", () => this.deleteMask(mask.id));
    }
  }

  private handleMaskKey(
    event: KeyboardEvent,
    mask: OcclusionMaskCandidate,
  ): void {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.deleteMask(mask.id);
      return;
    }
    const delta = this.keyboardDelta(event);
    if (delta === null) return;
    event.preventDefault();
    this.replaceMask(mask.id, moveRect(mask, delta.x, delta.y, this.minimumSize));
  }

  private handleResizeKey(
    event: KeyboardEvent,
    mask: OcclusionMaskCandidate,
    handle: ResizeHandle,
  ): void {
    const delta = this.keyboardDelta(event);
    if (delta === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.replaceMask(
      mask.id,
      resizeRect(mask, handle, delta.x, delta.y, this.minimumSize),
    );
  }

  private keyboardDelta(event: KeyboardEvent): NormalizedPoint | null {
    const step = event.shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP;
    switch (event.key) {
      case "ArrowLeft":
        return { x: -step, y: 0 };
      case "ArrowRight":
        return { x: step, y: 0 };
      case "ArrowUp":
        return { x: 0, y: -step };
      case "ArrowDown":
        return { x: 0, y: step };
      default:
        return null;
    }
  }

  private replaceMask(
    id: string,
    rect: Pick<OcclusionMaskCandidate, "x" | "y" | "width" | "height">,
  ): void {
    this.masks = this.masks.map((mask) =>
      mask.id === id ? { ...mask, ...normalizeRect(rect, this.minimumSize) } : mask,
    );
    this.markUnreviewed();
    this.renderMasks();
    this.renderList();
  }

  private deleteMask(id: string): void {
    this.masks = this.masks.filter((mask) => mask.id !== id);
    this.selectedId = this.masks[0]?.id ?? null;
    this.markUnreviewed();
    this.renderMasks();
    this.renderList();
  }

  private markUnreviewed(): void {
    this.reviewed = false;
    this.options.onChange?.(this.getMasks(), false);
    this.updateStatus();
  }

  private acceptMasks(): void {
    const validation = validateOcclusionMasks(this.masks);
    if (!validation.valid) {
      new Notice(validation.errors[0] ?? "The occlusion masks are invalid.");
      this.reviewed = false;
      this.updateStatus();
      return;
    }
    if (this.masks.length === 0) {
      new Notice("Add at least one mask before accepting this occlusion.");
      return;
    }
    this.reviewed = true;
    this.updateStatus();
    this.options.onReviewed?.(this.getMasks());
  }

  private updateStatus(): void {
    if (this.statusEl === null) return;
    this.statusEl.setText(
      this.reviewed
        ? "Masks reviewed and ready to save."
        : "Review required before this exercise can be saved.",
    );
    this.statusEl.toggleClass("is-reviewed", this.reviewed);
  }

  private positionElement(
    element: HTMLElement,
    rect: Pick<NormalizedPoint, "x" | "y"> & { width: number; height: number },
  ): void {
    element.style.left = `${rect.x * 100}%`;
    element.style.top = `${rect.y * 100}%`;
    element.style.width = `${rect.width * 100}%`;
    element.style.height = `${rect.height * 100}%`;
  }
}
