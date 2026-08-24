import { editorLivePreviewField } from "obsidian";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

import {
  findHiddenPracticeMetadataRanges,
  HIDDEN_PRACTICE_METADATA_START,
  type HiddenPracticeMetadataRange,
} from "./hidden-practice-metadata";

class HiddenPracticeMetadataWidget extends WidgetType {
  constructor(private readonly documentOffset: number) {
    super();
  }

  override eq(other: HiddenPracticeMetadataWidget): boolean {
    return this.documentOffset === other.documentOffset;
  }

  override toDOM(view: EditorView): HTMLElement {
    const button = createEl("button");
    button.type = "button";
    button.className = "practice-hidden-metadata-widget";
    button.setAttribute(
      "aria-label",
      "Inspect Practice Problem Generator metadata in the editor",
    );
    button.title = "Plugin-managed recovery and generation details. Select to inspect; move the cursor outside the block to collapse it again.";

    const label = createSpan();
    label.className = "practice-hidden-metadata-widget-label";
    label.textContent = "Practice metadata hidden";
    button.append(label);

    const explanation = createSpan();
    explanation.className = "practice-hidden-metadata-widget-explanation";
    explanation.textContent = "Managed data · select to inspect";
    button.append(explanation);

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const inspectionOffset = Math.min(
        this.documentOffset + HIDDEN_PRACTICE_METADATA_START.length,
        view.state.doc.length,
      );
      view.dispatch({
        selection: { anchor: inspectionOffset },
        scrollIntoView: true,
      });
      view.focus();
    });
    return button;
  }
}

function selectionTouchesRange(
  view: EditorView,
  metadataRange: HiddenPracticeMetadataRange,
): boolean {
  return view.state.selection.ranges.some(
    (selectionRange) =>
      selectionRange.from <= metadataRange.to
      && selectionRange.to >= metadataRange.from,
  );
}

function metadataDecorations(
  view: EditorView,
  ranges: readonly HiddenPracticeMetadataRange[],
): DecorationSet {
  if (!view.state.field(editorLivePreviewField, false)) return Decoration.none;
  return Decoration.set(
    ranges
      .filter((range) => !selectionTouchesRange(view, range))
      .map((range) => Decoration.replace({
        block: true,
        inclusive: true,
        widget: new HiddenPracticeMetadataWidget(range.from),
      }).range(range.from, range.to)),
    true,
  );
}

class HiddenPracticeMetadataEditorView {
  decorations: DecorationSet;
  private ranges: readonly HiddenPracticeMetadataRange[];

  constructor(view: EditorView) {
    this.ranges = findHiddenPracticeMetadataRanges(view.state.doc.toString());
    this.decorations = metadataDecorations(view, this.ranges);
  }

  update(update: ViewUpdate): void {
    const livePreviewChanged =
      update.startState.field(editorLivePreviewField, false)
      !== update.state.field(editorLivePreviewField, false);
    if (update.docChanged) {
      this.ranges = findHiddenPracticeMetadataRanges(update.state.doc.toString());
    }
    if (update.docChanged || update.selectionSet || livePreviewChanged) {
      this.decorations = metadataDecorations(update.view, this.ranges);
    }
  }
}

export const hiddenPracticeMetadataEditorExtension = ViewPlugin.fromClass(
  HiddenPracticeMetadataEditorView,
  { decorations: (value) => value.decorations },
);
