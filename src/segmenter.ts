import type { SourceSegmentV1 } from "./model";

const SHA256_INITIAL = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f,
  0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b,
  0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7,
  0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152,
  0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

/** A browser-safe SHA-256 implementation so mobile never imports Node crypto. */
export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const bitLength = bytes.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const state = new Uint32Array(SHA256_INITIAL);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const word15 = words[index - 15] ?? 0;
      const word2 = words[index - 2] ?? 0;
      const small0 =
        rotateRight(word15, 7) ^ rotateRight(word15, 18) ^ (word15 >>> 3);
      const small1 =
        rotateRight(word2, 17) ^ rotateRight(word2, 19) ^ (word2 >>> 10);
      words[index] =
        ((words[index - 16] ?? 0) +
          small0 +
          (words[index - 7] ?? 0) +
          small1) >>>
        0;
    }

    let a = state[0] ?? 0;
    let b = state[1] ?? 0;
    let c = state[2] ?? 0;
    let d = state[3] ?? 0;
    let e = state[4] ?? 0;
    let f = state[5] ?? 0;
    let g = state[6] ?? 0;
    let h = state[7] ?? 0;

    for (let index = 0; index < 64; index += 1) {
      const big1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 =
        (h +
          big1 +
          choose +
          (SHA256_CONSTANTS[index] ?? 0) +
          (words[index] ?? 0)) >>>
        0;
      const big0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (big0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    state[0] = ((state[0] ?? 0) + a) >>> 0;
    state[1] = ((state[1] ?? 0) + b) >>> 0;
    state[2] = ((state[2] ?? 0) + c) >>> 0;
    state[3] = ((state[3] ?? 0) + d) >>> 0;
    state[4] = ((state[4] ?? 0) + e) >>> 0;
    state[5] = ((state[5] ?? 0) + f) >>> 0;
    state[6] = ((state[6] ?? 0) + g) >>> 0;
    state[7] = ((state[7] ?? 0) + h) >>> 0;
  }

  return [...state]
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("");
}

export function normalizeSourceText(source: string): string {
  return source.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
}

export function createSourceHash(source: string): string {
  return `sha256:${sha256Hex(normalizeSourceText(source))}`;
}

export function compactHeadingPath(values: readonly unknown[]): string[] {
  return values.filter(
    (heading): heading is string =>
      typeof heading === "string" && heading.trim().length > 0,
  );
}

interface PendingSegment {
  kind: SourceSegmentV1["kind"];
  headingPath: string[];
  text: string;
}

function stripLeadingFrontmatter(lines: string[]): string[] {
  if (lines[0]?.trim() !== "---") return lines;
  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && (line.trim() === "---" || line.trim() === "..."),
  );
  return closingIndex === -1 ? lines : lines.slice(closingIndex + 1);
}

function createStableSegments(pending: PendingSegment[]): SourceSegmentV1[] {
  const occurrences = new Map<string, number>();
  return pending.map((segment, ordinal) => {
    const digest = sha256Hex(
      JSON.stringify([segment.kind, segment.headingPath, segment.text]),
    ).slice(0, 16);
    const count = (occurrences.get(digest) ?? 0) + 1;
    occurrences.set(digest, count);
    return {
      ...segment,
      id: count === 1 ? `seg-${digest}` : `seg-${digest}-${count}`,
      ordinal,
    };
  });
}

/**
 * Segments Markdown into heading records and paragraph-sized records. YAML
 * frontmatter is intentionally excluded from generated exercise evidence.
 */
export function segmentSource(source: string): SourceSegmentV1[] {
  const lines = stripLeadingFrontmatter(normalizeSourceText(source).split("\n"));
  const headingLevels: Array<string | undefined> = [];
  const pending: PendingSegment[] = [];
  const paragraphLines: string[] = [];
  let fenceCharacter: "`" | "~" | undefined;
  let fenceLength = 0;

  const currentHeadingPath = (): string[] => compactHeadingPath(headingLevels);

  const flushParagraph = (): void => {
    while (paragraphLines[0]?.trim() === "") paragraphLines.shift();
    while (paragraphLines.at(-1)?.trim() === "") paragraphLines.pop();
    const text = paragraphLines.join("\n").trim();
    paragraphLines.length = 0;
    if (text.length > 0) {
      pending.push({ kind: "paragraph", headingPath: currentHeadingPath(), text });
    }
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/u);
    if (fenceCharacter !== undefined) {
      paragraphLines.push(line);
      if (
        fenceMatch?.[1]?.startsWith(fenceCharacter.repeat(fenceLength)) === true
      ) {
        fenceCharacter = undefined;
        fenceLength = 0;
      }
      continue;
    }
    if (fenceMatch?.[1] !== undefined) {
      paragraphLines.push(line);
      fenceCharacter = fenceMatch[1][0] as "`" | "~";
      fenceLength = fenceMatch[1].length;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (headingMatch?.[1] !== undefined && headingMatch[2] !== undefined) {
      flushParagraph();
      const depth = headingMatch[1].length;
      const title = headingMatch[2].trim();
      headingLevels.length = depth - 1;
      headingLevels[depth - 1] = title;
      pending.push({ kind: "heading", headingPath: currentHeadingPath(), text: title });
      continue;
    }

    if (line.trim() === "") flushParagraph();
    else paragraphLines.push(line);
  }
  flushParagraph();
  return createStableSegments(pending);
}

export interface SegmentedSourceV1 {
  hash: string;
  segments: SourceSegmentV1[];
}

export function prepareSource(source: string): SegmentedSourceV1 {
  return { hash: createSourceHash(source), segments: segmentSource(source) };
}
