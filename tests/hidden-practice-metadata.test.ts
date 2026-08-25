import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import {
  findHiddenPracticeMetadataRanges,
  parseHiddenPracticeMetadata,
  serializeHiddenPracticeMetadata,
} from "../src/hidden-practice-metadata";
import { hiddenPracticeMetadataEditorExtension } from "../src/hidden-practice-metadata-editor";

test("hidden practice metadata round-trips without creating an HTML comment terminator", () => {
  const serialized = serializeHiddenPracticeMetadata({
    generationRecipe: {
      schemaVersion: 2,
      model: "model--with-hyphens",
      focusInstructions: "Do not expose --> or plugin-owned metadata.",
    },
  });
  assert.ok(serialized);
  const body = serialized.split("\n")[1] ?? "";
  assert.doesNotMatch(body, /-->/u);
  assert.match(body, /\\u002d/u);
  assert.deepEqual(parseHiddenPracticeMetadata(serialized), {
    status: "ok",
    metadata: {
      schemaVersion: 1,
      generationRecipe: {
        schemaVersion: 2,
        model: "model--with-hyphens",
        focusInstructions: "Do not expose --> or plugin-owned metadata.",
      },
    },
  });
});

test("hidden metadata is optional, unique, versioned, and strict", () => {
  assert.equal(serializeHiddenPracticeMetadata({}), undefined);
  assert.deepEqual(parseHiddenPracticeMetadata("# Ordinary note\n"), {
    status: "missing",
  });
  const valid = serializeHiddenPracticeMetadata({ generationHistory: { entries: [] } });
  assert.ok(valid);
  assert.equal(parseHiddenPracticeMetadata(`${valid}\n${valid}\n`).status, "invalid");
  assert.equal(parseHiddenPracticeMetadata(
    "<!-- practice-problem-generator-metadata-v1\n{\"schemaVersion\":2}\n-->",
  ).status, "invalid");
  assert.equal(parseHiddenPracticeMetadata(
    "<!-- practice-problem-generator-metadata-v1\n{\"schemaVersion\":1,\"extra\":true}\n-->",
  ).status, "invalid");
});

test("hidden metadata ranges preserve exact editor offsets and ignore incomplete comments", () => {
  const first = serializeHiddenPracticeMetadata({ generationHistory: { entries: [] } });
  const second = serializeHiddenPracticeMetadata({ sourceImport: { kind: "note" } });
  assert.ok(first);
  assert.ok(second);
  const markdown = `# Practice\n\n${first}\n\nVisible text\n\n${second}\n`;
  const ranges = findHiddenPracticeMetadataRanges(markdown);
  assert.equal(ranges.length, 2);
  assert.equal(markdown.slice(ranges[0]?.from, ranges[0]?.to), first);
  assert.equal(markdown.slice(ranges[1]?.from, ranges[1]?.to), second);
  assert.deepEqual(
    findHiddenPracticeMetadataRanges(
      "Text <!-- practice-problem-generator-metadata-v1\n{}\n-->\n"
    ),
    [],
  );
  assert.deepEqual(
    findHiddenPracticeMetadataRanges(
      "<!-- practice-problem-generator-metadata-v1\n{\"schemaVersion\":1}\n"
    ),
    [],
  );
});

test("hidden metadata stays collapsed and atomic in every editor mode", () => {
  const source = readFileSync(
    new URL("../src/hidden-practice-metadata-editor.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /StateField\.define/u);
  assert.match(source, /EditorView\.decorations\.from/u);
  assert.match(source, /EditorView\.atomicRanges\.of/u);
  assert.doesNotMatch(source, /ViewPlugin\.fromClass/u);
  assert.doesNotMatch(source, /editorLivePreviewField/u);
  assert.doesNotMatch(source, /selectionTouchesRange/u);
  assert.doesNotMatch(source, /WidgetType/u);
  assert.doesNotMatch(source, /practice-hidden-metadata-widget/u);
  assert.match(source, /block:\s*true/u);
});

test("cursor movement cannot reveal a collapsed metadata range", () => {
  const metadata = serializeHiddenPracticeMetadata({
    generationHistory: { entries: [] },
  });
  assert.ok(metadata);
  const document = `# Practice\n\n${metadata}\n\nVisible content\n`;
  const metadataRange = findHiddenPracticeMetadataRanges(document)[0];
  assert.ok(metadataRange);
  const initialState = EditorState.create({
    doc: document,
    extensions: [hiddenPracticeMetadataEditorExtension],
  });
  const initialEditorState = initialState.field(hiddenPracticeMetadataEditorExtension);
  assert.equal(initialEditorState.decorations.size, 1);
  assert.equal(initialState.facet(EditorView.atomicRanges).length, 1);

  const selectedState = initialState.update({
    selection: { anchor: metadataRange.from + 4 },
  }).state;
  const selectedEditorState = selectedState.field(hiddenPracticeMetadataEditorExtension);
  assert.strictEqual(selectedEditorState, initialEditorState);
  assert.equal(selectedEditorState.decorations.size, 1);
});
