import assert from "node:assert/strict";
import test from "node:test";

import {
  compactHeadingPath,
  createSourceHash,
  normalizeSourceText,
  prepareSource,
  segmentSource,
  sha256Hex,
} from "../src/segmenter";

test("SHA-256 matches standard vectors without importing Node crypto", () => {
  assert.equal(
    sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(
    createSourceHash("é"),
    "sha256:4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c",
  );
});

test("source hashes canonicalize BOM and Windows newlines", () => {
  assert.equal(normalizeSourceText("\uFEFFa\r\nb\rc"), "a\nb\nc");
  assert.equal(createSourceHash("a\r\nb"), createSourceHash("a\nb"));
});

test("segments headings and paragraphs while omitting YAML frontmatter", () => {
  const source = [
    "---",
    "tags: [private-metadata]",
    "---",
    "# Main",
    "First paragraph",
    "continues here.",
    "",
    "## Detail",
    "- one",
    "- two",
    "",
    "```text",
    "# not a heading",
    "",
    "still code",
    "```",
  ].join("\n");
  const segments = segmentSource(source);
  assert.deepEqual(
    segments.map(({ kind, headingPath, text, ordinal }) => ({
      kind,
      headingPath,
      text,
      ordinal,
    })),
    [
      { kind: "heading", headingPath: ["Main"], text: "Main", ordinal: 0 },
      {
        kind: "paragraph",
        headingPath: ["Main"],
        text: "First paragraph\ncontinues here.",
        ordinal: 1,
      },
      {
        kind: "heading",
        headingPath: ["Main", "Detail"],
        text: "Detail",
        ordinal: 2,
      },
      {
        kind: "paragraph",
        headingPath: ["Main", "Detail"],
        text: "- one\n- two",
        ordinal: 3,
      },
      {
        kind: "paragraph",
        headingPath: ["Main", "Detail"],
        text: "```text\n# not a heading\n\nstill code\n```",
        ordinal: 4,
      },
    ],
  );
  assert.ok(segments.every((segment) => /^seg-[0-9a-f]{16}(?:-\d+)?$/u.test(segment.id)));
  assert.ok(segments.every((segment) => !segment.text.includes("private-metadata")));
});

test("segment IDs are content-stable and duplicate occurrences are unambiguous", () => {
  const original = segmentSource("# A\nSame.\n\nSame.");
  const repeated = segmentSource("# A\nSame.\n\nSame.");
  assert.deepEqual(original, repeated);
  assert.match(original[1]?.id ?? "", /^seg-[0-9a-f]{16}$/u);
  assert.equal(original[2]?.id, `${original[1]?.id}-2`);

  const moved = segmentSource("# A\nNew.\n\nSame.");
  assert.equal(moved[2]?.id, original[1]?.id);
});

test("skipped heading levels never create sparse heading paths", () => {
  const segments = segmentSource([
    "## Starts at level two",
    "Body.",
    "",
    "#### Jumps to level four",
    "Deep body.",
    "",
    "## Peer at level two",
    "Peer body.",
  ].join("\n"));

  assert.deepEqual(
    segments.map(({ kind, headingPath, text }) => ({ kind, headingPath, text })),
    [
      { kind: "heading", headingPath: ["Starts at level two"], text: "Starts at level two" },
      { kind: "paragraph", headingPath: ["Starts at level two"], text: "Body." },
      {
        kind: "heading",
        headingPath: ["Starts at level two", "Jumps to level four"],
        text: "Jumps to level four",
      },
      {
        kind: "paragraph",
        headingPath: ["Starts at level two", "Jumps to level four"],
        text: "Deep body.",
      },
      { kind: "heading", headingPath: ["Peer at level two"], text: "Peer at level two" },
      { kind: "paragraph", headingPath: ["Peer at level two"], text: "Peer body." },
    ],
  );
  assert.ok(
    segments.every((segment) =>
      segment.headingPath.every((heading) => typeof heading === "string" && heading.length > 0),
    ),
  );
});

test("compacts legacy sparse heading paths before persistence", () => {
  const sparse: unknown[] = [];
  sparse[1] = "Second-level heading";
  sparse[3] = "Fourth-level heading";
  sparse[4] = null;
  assert.deepEqual(compactHeadingPath(sparse), [
    "Second-level heading",
    "Fourth-level heading",
  ]);
});

test("prepareSource returns the same deterministic hash and segments", () => {
  const source = "# Topic\nEvidence.";
  assert.deepEqual(prepareSource(source), {
    hash: createSourceHash(source),
    segments: segmentSource(source),
  });
});
