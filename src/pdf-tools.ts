export interface PdfDocumentInfo {
  readonly pageCount: number;
  readonly pdfVersion?: string;
}

export interface PdfPageRange {
  readonly firstPage: number;
  readonly lastPage: number;
}

export interface PdfExtractionResult extends PdfPageRange {
  readonly pageCount: number;
  readonly text: string;
  readonly characterCount: number;
  readonly extractedPageCount: number;
  readonly pdfContentHash: string;
}

export interface PdfToolOptions {
  readonly pdfinfoExecutable: string;
  readonly pdftotextExecutable: string;
  readonly maxPages: number;
  readonly maxCharacters: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
}

interface DesktopPdfModules {
  readonly fs: typeof import("node:fs/promises");
  readonly os: typeof import("node:os");
  readonly path: typeof import("node:path");
  readonly spawn: typeof import("node:child_process").spawn;
}

const PROCESS_OUTPUT_LIMIT = 1_000_000;

export async function inspectPdf(
  sourceBytes: ArrayBuffer,
  options: Pick<PdfToolOptions, "pdfinfoExecutable" | "timeoutMs" | "signal">,
): Promise<PdfDocumentInfo> {
  if (options.signal?.aborted === true) {
    throw new Error("PDF extraction was cancelled.");
  }
  return withPdfJob(sourceBytes, async ({ input, run }) => {
    const result = await run(options.pdfinfoExecutable, [input], options);
    return parsePdfInfo(result.stdout);
  });
}

export async function extractPdfPages(
  sourceBytes: ArrayBuffer,
  info: PdfDocumentInfo,
  range: PdfPageRange,
  options: PdfToolOptions,
): Promise<PdfExtractionResult> {
  if (options.signal?.aborted === true) {
    throw new Error("PDF extraction was cancelled.");
  }
  validateRange(info, range, options.maxPages);
  const pageTexts = await withPdfJob(
    sourceBytes,
    async ({ directory, input, fs, path, run }) => {
      const combinedOutput = path.join(directory, "extracted.txt");
      await runPdftotext(
        run,
        options.pdftotextExecutable,
        input,
        combinedOutput,
        range,
        options,
      );
      const combined = await fs.readFile(combinedOutput, "utf8");
      const expected = range.lastPage - range.firstPage + 1;
      const split = splitPages(combined, expected);
      if (split !== null) return split;

      const exact: string[] = [];
      for (let page = range.firstPage; page <= range.lastPage; page += 1) {
        const output = path.join(directory, `page-${String(page).padStart(6, "0")}.txt`);
        await runPdftotext(
          run,
          options.pdftotextExecutable,
          input,
          output,
          { firstPage: page, lastPage: page },
          options,
        );
        exact.push(stripPageBreaks(await fs.readFile(output, "utf8")));
      }
      return exact;
    },
  );

  const text = pageMarkdown(pageTexts, range.firstPage);
  if (text.replace(/^# PDF page \d+$/gmu, "").trim().length < 20) {
    throw new Error(
      "The selected PDF pages contain no usable text. This may be a scanned PDF; OCR is not enabled in Practice Problem Generator.",
    );
  }
  if (text.length > options.maxCharacters) {
    throw new Error(
      `The selected PDF pages contain ${text.length.toLocaleString()} characters, above the remaining ${options.maxCharacters.toLocaleString()}-character PDF budget. Choose a narrower page range, remove other PDFs from the source bundle, or raise the total PDF budget in settings.`,
    );
  }
  return {
    ...range,
    pageCount: info.pageCount,
    text,
    characterCount: text.length,
    extractedPageCount: pageTexts.length,
    pdfContentHash: await hashPdfBytes(sourceBytes),
  };
}

export function parsePdfInfo(stdout: string): PdfDocumentInfo {
  const pages = /^Pages:\s*(\d+)\s*$/imu.exec(stdout)?.[1];
  const pageCount = Number(pages);
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error("PDFinfo did not report a valid page count.");
  }
  const version = /^PDF version:\s*(.+?)\s*$/imu.exec(stdout)?.[1]?.trim();
  return {
    pageCount,
    ...(version === undefined || version.length === 0
      ? {}
      : { pdfVersion: version }),
  };
}

export function validateRange(
  info: PdfDocumentInfo,
  range: PdfPageRange,
  maxPages: number,
): void {
  if (
    !Number.isInteger(range.firstPage)
    || !Number.isInteger(range.lastPage)
    || range.firstPage < 1
    || range.firstPage > range.lastPage
    || range.lastPage > info.pageCount
  ) {
    throw new Error(`Choose a PDF page range between 1 and ${info.pageCount}.`);
  }
  const selected = range.lastPage - range.firstPage + 1;
  if (!Number.isInteger(maxPages) || maxPages < 1 || selected > maxPages) {
    throw new Error(
      `Choose at most ${maxPages} PDF ${maxPages === 1 ? "page" : "pages"} for one generation.`,
    );
  }
}

function pageMarkdown(pages: readonly string[], firstPage: number): string {
  return pages.flatMap((page, index) => {
    const cleaned = normalizeExtractedText(page);
    if (cleaned.length === 0) return [];
    const heading = `# PDF page ${firstPage + index}`;
    return [`${heading}\n\n${cleaned}`];
  }).join("\n\n");
}

function splitPages(raw: string, expected: number): string[] | null {
  const normalized = raw.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  const pieces = normalized.split("\f");
  while (pieces.length > expected && pieces.at(-1)?.trim() === "") pieces.pop();
  return pieces.length === expected ? pieces.map(stripPageBreaks) : null;
}

function stripPageBreaks(value: string): string {
  return value.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n").replace(/\f/gu, "");
}

function normalizeExtractedText(value: string): string {
  return stripPageBreaks(value)
    .split("\n")
    .map((line) => {
      const trimmedEnd = line.replace(/[ \t]+$/gu, "");
      return /^#{1,6}\s/u.test(trimmedEnd) ? ` ${trimmedEnd}` : trimmedEnd;
    })
    .join("\n")
    .replace(/\n{4,}/gu, "\n\n\n")
    .trim();
}

async function runPdftotext(
  run: (
    executable: string,
    args: readonly string[],
    options: Pick<PdfToolOptions, "timeoutMs" | "signal">,
  ) => Promise<ProcessResult>,
  executable: string,
  input: string,
  output: string,
  range: PdfPageRange,
  options: Pick<PdfToolOptions, "timeoutMs" | "signal">,
): Promise<void> {
  await run(executable, [
    "-f",
    String(range.firstPage),
    "-l",
    String(range.lastPage),
    "-layout",
    "-enc",
    "UTF-8",
    input,
    output,
  ], options);
}

async function withPdfJob<T>(
  sourceBytes: ArrayBuffer,
  operation: (job: {
    readonly directory: string;
    readonly input: string;
    readonly fs: typeof import("node:fs/promises");
    readonly path: typeof import("node:path");
    readonly run: typeof runPdfProcess;
  }) => Promise<T>,
): Promise<T> {
  const { fs, os, path } = loadDesktopPdfModules();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "practice-lab-pdf-"));
  try {
    const input = path.join(directory, "source.pdf");
    await fs.writeFile(input, Buffer.from(sourceBytes));
    return await operation({ directory, input, fs, path, run: runPdfProcess });
  } finally {
    await removePdfJob(fs, directory);
  }
}

async function removePdfJob(
  fs: typeof import("node:fs/promises"),
  directory: string,
): Promise<void> {
  const delays = [0, 50, 200, 500] as const;
  let lastError: unknown;
  for (const delay of delays) {
    if (delay > 0) {
      await new Promise<void>((resolve) => { setTimeout(resolve, delay); });
    }
    try {
      await fs.rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Practice Problem Generator could not remove the temporary PDF job.");
}

async function runPdfProcess(
  executable: string,
  args: readonly string[],
  options: Pick<PdfToolOptions, "timeoutMs" | "signal">,
): Promise<ProcessResult> {
  if (!executable.trim()) throw new Error("PDF executable is not configured.");
  const { spawn } = loadDesktopPdfModules();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
      if (error === undefined) resolve({ stdout, stderr });
      else reject(error);
    };
    const append = (current: string, chunk: string): string => {
      const next = current + chunk;
      if (next.length > PROCESS_OUTPUT_LIMIT) {
        child.kill();
        finish(new Error("The PDF utility exceeded Practice Problem Generator's output limit."));
      }
      return next.slice(0, PROCESS_OUTPUT_LIMIT + 1);
    };
    const cancel = (): void => {
      child.kill();
      finish(new Error("PDF extraction was cancelled."));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("PDF extraction timed out."));
    }, options.timeoutMs ?? 120_000);
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted === true) {
      cancel();
      return;
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: string) => { stderr = append(stderr, chunk); });
    child.once("error", (error) => {
      finish(new Error(`Could not start ${executable}: ${error.message}`));
    });
    child.once("close", (code) => {
      if (code === 0) finish();
      else {
        finish(new Error(
          `${executable} exited with code ${code ?? "unknown"}: ${stderr.trim() || "no diagnostic"}`,
        ));
      }
    });
  });
}

async function hashPdfBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice(0));
  return `sha256:${[...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function loadDesktopPdfModules(): DesktopPdfModules {
  if (typeof require !== "function") {
    throw new Error("PDF extraction is available only in Obsidian Desktop.");
  }
  return {
    fs: require("node:fs/promises") as typeof import("node:fs/promises"),
    os: require("node:os") as typeof import("node:os"),
    path: require("node:path") as typeof import("node:path"),
    spawn: (require("node:child_process") as typeof import("node:child_process")).spawn,
  };
}
