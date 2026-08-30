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
import { editorLivePreviewField } from "obsidian";

interface PracticeBankBlockRange {
  readonly from: number;
  readonly to: number;
}

const PRACTICE_BANK_BLOCK = /(?:^|\n)([ \t]*```practice-lab[ \t]*\r?\n[\s\S]*?\r?\n[ \t]*```)(?=\r?\n|$)/gu;

export function findPracticeBankBlockRanges(
  markdown: string,
): readonly PracticeBankBlockRange[] {
  const ranges: PracticeBankBlockRange[] = [];
  for (const match of markdown.matchAll(PRACTICE_BANK_BLOCK)) {
    const block = match[1];
    if (block === undefined || match.index === undefined) continue;
    const from = match.index + (match[0].startsWith("\n") ? 1 : 0);
    ranges.push({ from, to: from + block.length });
  }
  return ranges;
}

class PracticeBankPlaceholderWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  override toDOM(): HTMLElement {
    const widget = createFragment().createDiv({
      cls: "practice-lab-live-preview-placeholder",
      attr: {
        role: "note",
        "aria-label": "Practice data is managed by Practice Problem Generator",
      },
    });
    widget.createEl("strong", { text: "Practice data managed by the plugin" });
    widget.createSpan({
      text: " Use the interactive practice note to study or manage this bank.",
    });
    return widget;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

interface PracticeBankEditorState {
  readonly livePreview: boolean;
  readonly decorations: DecorationSet;
}

function isLivePreview(state: EditorState): boolean {
  return state.field(editorLivePreviewField, false) === true;
}

function createPracticeBankEditorState(
  state: EditorState,
): PracticeBankEditorState {
  const livePreview = isLivePreview(state);
  if (!livePreview) {
    return { livePreview, decorations: Decoration.none };
  }
  const widget = new PracticeBankPlaceholderWidget();
  return {
    livePreview,
    decorations: Decoration.set(
      findPracticeBankBlockRanges(state.doc.toString()).map((range) => (
        Decoration.replace({
          block: true,
          inclusive: true,
          widget,
        }).range(range.from, range.to)
      )),
      true,
    ),
  };
}

function updatePracticeBankEditorState(
  value: PracticeBankEditorState,
  transaction: Transaction,
): PracticeBankEditorState {
  const livePreview = isLivePreview(transaction.state);
  if (!transaction.docChanged && livePreview === value.livePreview) return value;
  return createPracticeBankEditorState(transaction.state);
}

/**
 * Keep the portable fenced bank readable in Source mode while replacing it with
 * one calm, non-editable status widget in Live Preview.
 */
export const practiceBankEditorExtension = StateField.define<PracticeBankEditorState>({
  create: createPracticeBankEditorState,
  update: updatePracticeBankEditorState,
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
  ],
});
