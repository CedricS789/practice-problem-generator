import {
  type EditorState,
  StateField,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";

import {
  findHiddenPracticeMetadataRanges,
  type HiddenPracticeMetadataRange,
} from "./hidden-practice-metadata";

function metadataDecorations(
  ranges: readonly HiddenPracticeMetadataRange[],
): DecorationSet {
  return Decoration.set(
    ranges
      .map((range) => Decoration.replace({
        block: true,
        inclusive: true,
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
    decorations: metadataDecorations(ranges),
  };
}

function updateEditorState(
  value: HiddenPracticeMetadataEditorState,
  transaction: Transaction,
): HiddenPracticeMetadataEditorState {
  if (!transaction.docChanged) return value;
  const ranges = findHiddenPracticeMetadataRanges(transaction.state.doc.toString());
  return {
    ranges,
    decorations: metadataDecorations(ranges),
  };
}

/**
 * Multi-line replacement and block decorations must come from editor state.
 * Keeping the same ranges atomic prevents Source mode or cursor movement from
 * exposing plugin-managed recovery data during ordinary note editing.
 */
export const hiddenPracticeMetadataEditorExtension = StateField.define<
  HiddenPracticeMetadataEditorState
>({
  create: createEditorState,
  update: updateEditorState,
  provide: (field) => [
    EditorView.decorations.from(
      field,
      (value) => value.decorations,
    ),
    EditorView.atomicRanges.of(
      (view) => view.state.field(field).decorations,
    ),
  ],
});
