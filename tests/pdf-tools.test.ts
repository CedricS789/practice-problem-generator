import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { runInNewContext } from "node:vm";
import test, { after } from "node:test";
import { build } from "esbuild";

import {
  extractPdfPages,
  inspectPdf,
  parsePdfInfo,
  validateRange,
} from "../src/pdf-tools";

const testGlobal = globalThis as typeof globalThis & { require?: NodeRequire };
const previousRequire = testGlobal.require;
testGlobal.require = createRequire(import.meta.url);
after(() => {
  if (previousRequire) testGlobal.require = previousRequire;
  else delete testGlobal.require;
});

function syntheticPdf(pageTexts: readonly string[]): ArrayBuffer {
  const fontObject = 3 + pageTexts.length * 2;
  const pageObjects = pageTexts.map((_, index) => 3 + index * 2);
  const objects = new Map<number, string>();
  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(2, `<< /Type /Pages /Kids [${pageObjects.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageTexts.length} >>`);
  for (const [index, text] of pageTexts.entries()) {
    const pageId = pageObjects[index];
    assert.ok(pageId);
    const contentId = pageId + 1;
    const escaped = text.replace(/([\\()])/gu, "\\$1");
    const stream = `BT\n/F1 14 Tf\n72 720 Td\n(${escaped}) Tj\nET\n`;
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.set(contentId, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  }
  objects.set(fontObject, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id <= fontObject; id += 1) {
    const object = objects.get(id);
    assert.ok(object);
    offsets[id] = Buffer.byteLength(pdf);
    pdf += `${id} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${fontObject + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= fontObject; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${fontObject + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(pdf, "ascii")).buffer;
}

test("inspects and extracts an exact, page-grounded PDF range locally", async () => {
  const bytes = syntheticPdf([
    "Alpha evidence supports the first relation.",
    "Beta evidence explains the second mechanism.",
    "Gamma evidence supplies the final distinction.",
  ]);
  const original = new Uint8Array(bytes.slice(0));
  const info = await inspectPdf(bytes, {
    pdfinfoExecutable: "pdfinfo",
    timeoutMs: 30_000,
  });
  assert.equal(info.pageCount, 3);
  const extracted = await extractPdfPages(
    bytes,
    info,
    { firstPage: 2, lastPage: 3 },
    {
      pdfinfoExecutable: "pdfinfo",
      pdftotextExecutable: "pdftotext",
      maxPages: 10,
      maxCharacters: 20_000,
      timeoutMs: 30_000,
    },
  );
  assert.match(extracted.text, /^# PDF page 2/mu);
  assert.match(extracted.text, /^# PDF page 3/mu);
  assert.doesNotMatch(extracted.text, /Alpha evidence/u);
  assert.match(extracted.text, /Beta evidence/u);
  assert.match(extracted.text, /Gamma evidence/u);
  assert.equal(extracted.extractedPageCount, 2);
  assert.match(extracted.pdfContentHash, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(new Uint8Array(bytes), original, "PDF extraction must not mutate source bytes");
});

test("PDF range and character limits fail closed without truncation", async () => {
  const info = { pageCount: 4 };
  assert.throws(
    () => validateRange(info, { firstPage: 0, lastPage: 2 }, 4),
    /between 1 and 4/u,
  );
  assert.throws(
    () => validateRange(info, { firstPage: 1, lastPage: 4 }, 2),
    /at most 2 PDF pages/u,
  );
  await assert.rejects(
    () => extractPdfPages(
      syntheticPdf(["A sufficiently long grounded sentence for extraction."]),
      { pageCount: 1 },
      { firstPage: 1, lastPage: 1 },
      {
        pdfinfoExecutable: "pdfinfo",
        pdftotextExecutable: "pdftotext",
        maxPages: 1,
        maxCharacters: 20,
        timeoutMs: 30_000,
      },
    ),
    /above the configured 20-character limit/u,
  );
});

test("PDFinfo parsing rejects malformed output", () => {
  assert.deepEqual(parsePdfInfo("Pages: 12\nPDF version: 1.7\n"), {
    pageCount: 12,
    pdfVersion: "1.7",
  });
  assert.throws(() => parsePdfInfo("Pages: nope\n"), /valid page count/u);
});

test("PDF extraction reports missing tools and cancellation without fallback", async () => {
  const bytes = syntheticPdf(["Grounded content for a local PDF source."]);
  await assert.rejects(
    () => inspectPdf(bytes, {
      pdfinfoExecutable: "missing-practice-lab-pdfinfo",
      timeoutMs: 1_000,
    }),
    /Could not start|ENOENT/u,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => inspectPdf(bytes, {
      pdfinfoExecutable: "pdfinfo",
      signal: controller.signal,
    }),
    /cancelled/u,
  );
});

test("desktop PDF modules compile to lazy CommonJS loads", async () => {
  const result = await build({
    entryPoints: [path.resolve("src/pdf-tools.ts")],
    bundle: true,
    external: ["node:*"],
    format: "cjs",
    platform: "node",
    target: "es2022",
    write: false,
  });
  const bundle = result.outputFiles[0]?.text ?? "";
  assert.doesNotMatch(bundle, /import\(["']node:/u);
  for (const moduleName of ["fs/promises", "os", "path", "child_process"]) {
    assert.match(bundle, new RegExp(`require\\(["']node:${moduleName.replace("/", "\\/")}["']\\)`));
  }
  const module = { exports: {} };
  assert.doesNotThrow(() => runInNewContext(bundle, {
    exports: module.exports,
    module,
    require: (specifier: string): never => {
      throw new Error(`Node module loaded during initial evaluation: ${specifier}`);
    },
  }));
});
