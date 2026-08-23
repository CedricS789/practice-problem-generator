import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, view, modal, source, persistence, sourcePicker] = await Promise.all([
  readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/practice-lab-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/pdf-page-range-modal.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/source.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/persistence.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/source-picker.ts", import.meta.url), "utf8"),
]);

test("PDF generation is explicit through commands, active-source UI, or file menu", () => {
  assert.match(main, /id: "generate-from-current-pdf"/u);
  assert.match(main, /name: "Generate from current PDF"/u);
  assert.match(main, /workspace\.on\("file-menu"/u);
  assert.match(main, /Create practice from selected pages…/u);
  assert.match(main, /Start saved practice for this PDF/u);
  assert.doesNotMatch(main, /Practice Problem Generator: Build guided path from PDF/u);
  assert.match(sourcePicker, /Choose an exact page or page range from the active PDF/u);
  assert.doesNotMatch(main, /resolveLinks|linked PDFs|scan.*PDF/iu);
});

test("PDF page selection is bounded, local, previewed, and never rewrites the source", () => {
  assert.match(modal, /Choose PDF pages/u);
  assert.match(modal, /Selection mode/u);
  assert.match(modal, /Single page/u);
  assert.match(modal, /Page range/u);
  assert.match(modal, /Only this page is extracted and sent to the AI\. Adjacent pages are excluded\./u);
  assert.match(modal, /setButtonText\("Previous"\)/u);
  assert.match(modal, /setButtonText\("Next"\)/u);
  assert.match(modal, /setButtonText\("First"\)/u);
  assert.match(modal, /setButtonText\("Last"\)/u);
  assert.match(modal, /firstPage: this\.singlePage, lastPage: this\.singlePage/u);
  assert.match(modal, /single \? "Extract page" : "Extract pages"/u);
  assert.match(modal, /First page/u);
  assert.match(modal, /Last page/u);
  assert.match(modal, /Text extraction runs locally/u);
  assert.match(modal, /never modifies the PDF/u);
  assert.match(main, /vault\.readBinary\(file\)/u);
  assert.match(main, /inspectPdf/u);
  assert.match(main, /extractPdfPages/u);
  assert.match(view, /Review the exact provider payload|inspect the exact provider payload|Preview exactly what will be sent/u);
});

test("PDF regeneration reuses page provenance and external PDFs save under Notes", () => {
  assert.match(source, /createPdfSourceImport/u);
  assert.match(source, /collectRegenerationPdfSource/u);
  assert.match(main, /savedImport\.firstPage/u);
  assert.match(main, /savedImport\.lastPage/u);
  assert.match(main, /same saved page range/u);
  assert.match(main, /PDF source history/u);
  assert.match(main, /revision\.generationId/u);
  assert.match(persistence, /Notes\/Practice Sources\/Practice/u);
  assert.match(persistence, /sha256Hex\(normalized\.toLowerCase\(\)\)\.slice\(0, 10\)/u);
});

test("PDF extraction stays desktop-only while saved banks remain mobile-capable", () => {
  assert.match(main, /PDF source extraction is available in Obsidian desktop only/u);
  assert.match(main, /Platform\.isMobileApp/u);
  assert.match(sourcePicker, /label: "PDF pages"/u);
  assert.match(main, /Saved Practice Problem Generator bank/u);
});
