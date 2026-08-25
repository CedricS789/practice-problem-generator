import { editorLivePreviewField } from "obsidian";
import {
  type EditorState,
  StateField,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
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
  state: EditorState,
  metadataRange: HiddenPracticeMetadataRange,
): boolean {
  return state.selection.ranges.some(
    (selectionRange) =>
      selectionRange.from <= metadataRange.to
      && selectionRange.to >= metadataRange.from,
  );
}

function metadataDecorations(
  state: EditorState,
  ranges: readonly HiddenPracticeMetadataRange[],
): DecorationSet {
  if (!state.field(editorLivePreviewField, false)) return Decoration.none;
  return Decoration.set(
    ranges
      .filter((range) => !selectionTouchesRange(state, range))
      .map((range) => Decoration.replace({
        block: true,
        inclusive: true,
        widget: new HiddenPracticeMetadataWidget(range.from),
      }).range(range.from, range.to)),
    true,
  );
}

interface HiddenPracticeMetadataEditorState {
  readonly ranges: readonly HiddenPracticeMetadataRange[];
  readonly decorations: DecorationSet;
}

function createEditorState(state: EditorState): HiddenPracticeMetadataEditorState {
  const ranges = findHiddenPracticeMetadataRanges(state.doc.toString());
  return {
    ranges,
    decorations: metadataDecorations(state, ranges),
  };
}

function updateEditorState(
  value: HiddenPracticeMetadataEditorState,
  transaction: Transaction,
): HiddenPracticeMetadataEditorState {
  const livePreviewChanged =
    transaction.startState.field(editorLivePreviewField, false)
    !== transaction.state.field(editorLivePreviewField, false);
  if (
    !transaction.docChanged
    && transaction.selection === undefined
    && !livePreviewChanged
  ) {
    return value;
  }
  const ranges = transaction.docChanged
    ? findHiddenPracticeMetadataRanges(transaction.state.doc.toString())
    : value.ranges;
  return {
    ranges,
    decorations: metadataDecorations(transaction.state, ranges),
  };
}

/**
 * Multi-line replacement and block decorations must come from editor state.
 * CodeMirror rejects them when a ViewPlugin supplies them while loading a file.
 */
export const hiddenPracticeMetadataEditorExtension = StateField.define<
  HiddenPracticeMetadataEditorState
>({
  create: createEditorState,
  update: updateEditorState,
  provide: (field) => EditorView.decorations.from(
    field,
    (value) => value.decorations,
  ),
});
