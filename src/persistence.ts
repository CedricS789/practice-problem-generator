import {
  LEGACY_PRACTICE_BANK_SCHEMA_VERSION,
  PRACTICE_BANK_SCHEMA_VERSION,
  PRACTICE_BLOCK_LANGUAGE,
  type AiReviewSessionItemResultV2,
  type FailedAiReviewStateV2,
  type PendingAiReviewStateV2,
  type PracticeBankParseResult,
  type PracticeBankV1,
  type PracticeBankV2,
  type ReviewedAiReviewStateV2,
  type SessionSummaryV2,
} from "./model";
import {
  createAiReviewRequestHash,
  validatePracticeBank,
  validatePracticeBankV1,
} from "./schema";
import { createSourceHash, sha256Hex } from "./segmenter";
import {
  serializeGenerationRecipeFrontmatter,
  type GenerationRecipeV2,
} from "./regeneration";
import {
  serializeGenerationHistoryFrontmatter,
  type GenerationHistoryV1,
} from "./generation-history";
import {
  serializeSourceImportFrontmatter,
  type SourceImportV1,
} from "./source-import";

const READ_ONLY_RECOVERY =
  "Practice Problem Generator will keep this block read-only. Back up the Markdown file, update Practice Problem Generator, then use its recovery or migration command; do not hand-edit the stored JSON unless you are restoring from a known-good backup.";

function normalizeVaultPath(path: string): string {
  const normalized = path.replace(/\\/gu, "/").replace(/^\.\//u, "");
  const parts = normalized.split("/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Expected a safe vault-relative path, received: ${path}`);
  }
  return parts.join("/");
}

/** Derives a safe, deterministic practice-bank path for a note or PDF source. */
export function derivePracticePath(sourceVaultPath: string): string {
  const normalized = normalizeVaultPath(sourceVaultPath);
  const parts = normalized.split("/");
  const filename = parts.at(-1);
  if (filename === undefined) {
    throw new Error("Could not derive the Practice Problem Generator output path.");
  }
  const isPdf = /\.pdf$/iu.test(filename);
  const isMarkdown = /\.md$/iu.test(filename);
  if (!isPdf && !isMarkdown) {
    throw new Error("Practice Problem Generator sources must be Markdown notes or PDF files.");
  }
  const notesIndex = parts.findIndex((part) => part.toLowerCase() === "notes");
  const pdfPathKey = isPdf
    ? sha256Hex(normalized.toLowerCase()).slice(0, 10)
    : undefined;
  if (notesIndex !== 0 || parts.length < 4) {
    if (isPdf) {
      const title = safeFilename(filename.replace(/\.pdf$/iu, ""));
      return `Notes/Practice Sources/Practice/${title} - ${pdfPathKey} - Practice.md`;
    }
    throw new Error(
      "Practice Problem Generator source notes must be under Notes/<term>/<course>/.",
    );
  }
  const term = parts[1];
  const course = parts[2];
  if (term === undefined || course === undefined || filename === undefined) {
    throw new Error("Could not derive the Practice Problem Generator output path.");
  }
  if (parts[3]?.toLowerCase() === "practice") {
    throw new Error("A Practice Problem Generator bank cannot be used as its own source note.");
  }
  const title = safeFilename(filename.replace(/\.(?:md|pdf)$/iu, ""));
  if (title.length === 0) throw new Error("The source note must have a filename.");
  return `Notes/${term}/${course}/Practice/${title}${pdfPathKey === undefined ? "" : ` - ${pdfPathKey}`} - Practice.md`;
}

function safeFilename(value: string): string {
  const withoutControls = [...value].map((character) => (
    (character.codePointAt(0) ?? 0) <= 31 ? "-" : character
  )).join("");
  const cleaned = withoutControls
    .replace(/[<>:"/\\|?*]/gu, "-")
    .replace(/[. ]+$/gu, "")
    .trim();
  return cleaned.length === 0 ? "PDF source" : cleaned;
}

function yamlString(value: string): string {
  return JSON.stringify(value) ?? "undefined";
}

function formatValidationErrors(bank: PracticeBankV2): string {
  const validation = validatePracticeBank(bank);
  if (validation.ok) return "";
  return validation.issues
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join("; ");
}

export function serializePracticeBank(
  bank: PracticeBankV2,
  generationRecipe?: GenerationRecipeV2,
  generationHistory?: GenerationHistoryV1,
  sourceImport?: SourceImportV1,
): string {
  const errors = formatValidationErrors(bank);
  if (errors.length > 0) {
    throw new Error(`Cannot serialize an invalid Practice Problem Generator bank: ${errors}`);
  }
  const title = bank.source.title.replace(/[\r\n]+/gu, " ").trim();
  const pdfSource = /\.pdf$/iu.test(bank.source.vaultPath);
  if (pdfSource !== (sourceImport !== undefined)) {
    throw new Error(
      pdfSource
        ? "Cannot serialize a PDF practice bank without its source-import metadata."
        : "Source-import metadata can be stored only for a PDF practice bank.",
    );
  }
  if (
    sourceImport !== undefined
    && (
      sourceImport.sourceHash !== bank.source.hash
      || bank.source.scope !== "selection"
    )
  ) {
    throw new Error("The PDF source-import metadata does not match the practice bank.");
  }
  const json = JSON.stringify(bank, null, 2);
  return [
    "---",
    "practice-lab: true",
    `practice-lab-version: ${PRACTICE_BANK_SCHEMA_VERSION}`,
    `source: ${yamlString(bank.source.wikilink)}`,
    `source-scope: ${bank.source.scope}`,
    `source-hash: ${yamlString(bank.source.hash)}`,
    `bank-id: ${yamlString(bank.bankId)}`,
    `revision: ${bank.revision}`,
    `updated: ${yamlString(bank.updatedAt)}`,
    ...(generationRecipe === undefined
      ? []
      : serializeGenerationRecipeFrontmatter(generationRecipe)),
    ...(generationHistory === undefined
      ? []
      : [serializeGenerationHistoryFrontmatter(generationHistory)]),
    ...(sourceImport === undefined
      ? []
      : [serializeSourceImportFrontmatter(sourceImport)]),
    "---",
    "",
    `# ${title} - Practice`,
    "",
    "> [!info] Practice Problem Generator bank",
    "> Open this note in Reading view to study. The JSON block below is the portable source of truth; edits made through Practice Problem Generator are preserved across desktop and mobile.",
    "",
    `\`\`\`${PRACTICE_BLOCK_LANGUAGE}`,
    json,
    "```",
    "",
  ].join("\n");
}

function findPracticeBlock(markdown: string): string | undefined {
  const escapedLanguage = PRACTICE_BLOCK_LANGUAGE.replace(
    /[.*+?^${}()|[\]\\]/gu,
    "\\$&",
  );
  const expression = new RegExp(
    "(?:^|\\n)[ \\t]*```" +
      escapedLanguage +
      "[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n[ \\t]*```(?=\\r?\\n|$)",
    "u",
  );
  return expression.exec(markdown)?.[1];
}

function frontmatterValue(markdown: string, key: string): string | undefined {
  const normalized = markdown.replace(/\r\n?/gu, "\n");
  if (!normalized.startsWith("---\n")) return undefined;
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) return undefined;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escapedKey}:\\s*(.+)$`, "mu").exec(
    normalized.slice(4, end),
  )?.[1];
}

export function parsePracticeBankMarkdown(
  markdown: string,
): PracticeBankParseResult {
  const rawJson = findPracticeBlock(markdown);
  if (rawJson === undefined) {
    return {
      status: "missing",
      recoveryMessage:
        "No practice-lab fenced block was found. Restore the block from a backup or generate a new bank from the source note.",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    return {
      status: "invalid",
      errors: [error instanceof Error ? error.message : "Stored JSON is malformed."],
      recoveryMessage: READ_ONLY_RECOVERY,
      rawJson,
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      status: "invalid",
      errors: ["The practice-lab block must contain a JSON object."],
      recoveryMessage: READ_ONLY_RECOVERY,
      rawJson,
    };
  }
  const version = (parsed as Record<string, unknown>).schemaVersion;
  if (
    version !== PRACTICE_BANK_SCHEMA_VERSION
    && version !== LEGACY_PRACTICE_BANK_SCHEMA_VERSION
  ) {
    if (version === undefined) {
      return {
        status: "invalid",
        errors: ["The stored bank has no schemaVersion."],
        recoveryMessage: READ_ONLY_RECOVERY,
        rawJson,
      };
    }
    return {
      status: "unsupported-version",
      schemaVersion: version,
      rawJson,
      recoveryMessage: READ_ONLY_RECOVERY,
    };
  }
  const validation = version === LEGACY_PRACTICE_BANK_SCHEMA_VERSION
    ? validatePracticeBankV1(parsed)
    : validatePracticeBank(parsed);
  if (!validation.ok) {
    return {
      status: "invalid",
      errors: validation.issues.map(
        (issue) => `${issue.path}: ${issue.message}`,
      ),
      recoveryMessage: READ_ONLY_RECOVERY,
      rawJson,
    };
  }
  const bank = version === LEGACY_PRACTICE_BANK_SCHEMA_VERSION
    ? migratePracticeBankV1ToV2(validation.value as PracticeBankV1)
    : validation.value as PracticeBankV2;
  const warnings: string[] = version === LEGACY_PRACTICE_BANK_SCHEMA_VERSION
    ? ["Stored schema version 1 was migrated in memory; the next authorized write will save version 2."]
    : [];
  const frontmatterVersion = frontmatterValue(markdown, "practice-lab-version");
  if (
    frontmatterVersion !== undefined &&
    frontmatterVersion !== String(version)
  ) {
    warnings.push("Frontmatter version does not match the fenced bank version.");
  }
  const frontmatterHash = frontmatterValue(markdown, "source-hash")?.replace(
    /^"|"$/gu,
    "",
  );
  if (frontmatterHash !== undefined && frontmatterHash !== bank.source.hash) {
    warnings.push("Frontmatter source hash does not match the fenced bank.");
  }
  return { status: "ok", bank, storedSchemaVersion: version, warnings };
}

/** Lossless structural migration; no history, timestamps, or revisions are changed. */
export function migratePracticeBankV1ToV2(bank: PracticeBankV1): PracticeBankV2 {
  return {
    ...structuredClone(bank),
    schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
    sessions: bank.sessions.map((session) => ({
      ...structuredClone(session),
      schemaVersion: PRACTICE_BANK_SCHEMA_VERSION,
    })),
  };
}

export interface StaleSourceState {
  stale: boolean;
  storedHash: string;
  currentHash: string;
}

export function getStaleSourceState(
  bank: PracticeBankV1 | PracticeBankV2,
  currentSubmittedSource: string,
): StaleSourceState {
  const currentHash = createSourceHash(currentSubmittedSource);
  return {
    stale: currentHash !== bank.source.hash,
    storedHash: bank.source.hash,
    currentHash,
  };
}

export function isPracticeBankStale(
  bank: PracticeBankV1 | PracticeBankV2,
  currentSubmittedSource: string,
): boolean {
  return getStaleSourceState(bank, currentSubmittedSource).stale;
}

export interface SessionMergeOptions {
  expectedRevision: number;
  updatedAt?: string;
}

export type SessionMergeResult =
  | {
      status: "merged" | "rebased";
      bank: PracticeBankV2;
      previousRevision: number;
    }
  | {
      status: "unchanged";
      bank: PracticeBankV2;
      previousRevision: number;
    }
  | {
      status: "conflict" | "invalid-session";
      bank: PracticeBankV2;
      previousRevision: number;
      message: string;
    };

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameSession(left: SessionSummaryV2, right: SessionSummaryV2): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/**
 * Idempotently merges a completed session into the latest bank read inside
 * Vault.process(). Older expected revisions are safely rebased; future
 * revisions and reused IDs with different content fail closed.
 */
export function mergeSessionSummary(
  bank: PracticeBankV2,
  session: SessionSummaryV2,
  options: SessionMergeOptions,
): SessionMergeResult {
  const previousRevision = bank.revision;
  const existing = bank.sessions.find((item) => item.id === session.id);
  if (existing !== undefined) {
    return sameSession(existing, session)
      ? { status: "unchanged", bank, previousRevision }
      : {
          status: "conflict",
          bank,
          previousRevision,
          message: `Session ID ${session.id} already exists with different content.`,
        };
  }
  if (!Number.isInteger(options.expectedRevision) || options.expectedRevision < 0) {
    return {
      status: "conflict",
      bank,
      previousRevision,
      message: "Expected revision must be a non-negative integer.",
    };
  }
  if (session.bankRevisionAtStart !== options.expectedRevision) {
    return {
      status: "conflict",
      bank,
      previousRevision,
      message:
        "The session's starting revision does not match the expected bank revision.",
    };
  }
  if (options.expectedRevision > bank.revision) {
    return {
      status: "conflict",
      bank,
      previousRevision,
      message: `Expected future revision ${options.expectedRevision}, but the bank is at ${bank.revision}.`,
    };
  }
  const requestedUpdatedAt = options.updatedAt ?? session.finishedAt;
  const requestedUpdatedTime = Date.parse(requestedUpdatedAt);
  const currentUpdatedTime = Date.parse(bank.updatedAt);
  const updatedAt =
    Number.isFinite(requestedUpdatedTime) &&
    Number.isFinite(currentUpdatedTime) &&
    requestedUpdatedTime < currentUpdatedTime
      ? bank.updatedAt
      : requestedUpdatedAt;
  const merged: PracticeBankV2 = {
    ...bank,
    revision: bank.revision + 1,
    updatedAt,
    sessions: [...bank.sessions, session],
  };
  const validation = validatePracticeBank(merged);
  if (!validation.ok) {
    return {
      status: "invalid-session",
      bank,
      previousRevision,
      message: validation.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; "),
    };
  }
  return {
    status: options.expectedRevision === bank.revision ? "merged" : "rebased",
    bank: validation.value,
    previousRevision,
  };
}

export type AiReviewResolutionStateV2 =
  | ReviewedAiReviewStateV2
  | FailedAiReviewStateV2;

export type AiReviewTransitionStateV2 =
  | PendingAiReviewStateV2
  | AiReviewResolutionStateV2;

interface AiReviewPatchIdentityV2 {
  bankId: string;
  sessionId: string;
  requestId: string;
  requestHash: string;
}

export interface AiReviewResolutionPatchV2 extends AiReviewPatchIdentityV2 {
  state: AiReviewResolutionStateV2;
}

export interface AiReviewStateTransitionPatchV2 extends AiReviewPatchIdentityV2 {
  state: AiReviewTransitionStateV2;
}

export interface AiReviewMergeOptions {
  /** Used only to report a safe rebase; unrelated later revisions are accepted. */
  expectedRevision?: number;
  updatedAt?: string;
}

export type AiReviewMergeResult =
  | {
      status: "merged" | "rebased" | "unchanged";
      bank: PracticeBankV2;
      previousRevision: number;
    }
  | {
      status: "conflict" | "invalid-review";
      bank: PracticeBankV2;
      previousRevision: number;
      message: string;
    };

function reviewStateTimestamp(state: AiReviewTransitionStateV2): string {
  if (state.status === "pending") return state.queuedAt;
  return state.status === "reviewed" ? state.reviewedAt : state.failedAt;
}

function findAiReviewResult(
  bank: PracticeBankV2,
  sessionId: string,
  requestId: string,
): {
  sessionIndex: number;
  resultIndex: number;
  result: AiReviewSessionItemResultV2;
} | undefined {
  const sessionIndex = bank.sessions.findIndex((session) => session.id === sessionId);
  if (sessionIndex < 0) return undefined;
  const session = bank.sessions[sessionIndex];
  if (session === undefined) return undefined;
  const resultIndex = session.results.findIndex((result) =>
    result.grading === "ai-review" && result.request.requestId === requestId,
  );
  if (resultIndex < 0) return undefined;
  const result = session.results[resultIndex];
  return result?.grading === "ai-review"
    ? { sessionIndex, resultIndex, result }
    : undefined;
}

/**
 * Applies one allowed AI-review state transition to the latest bank. Identity
 * is based on stable IDs and the locked request hash, not on an exact bank
 * revision, so an unrelated session or regeneration can safely happen while
 * the CLI is busy. A failed request may be requeued without changing its
 * locked request. Reviewed requests are terminal.
 */
export function mergeAiReviewStateTransition(
  bank: PracticeBankV2,
  patch: AiReviewStateTransitionPatchV2,
  options: AiReviewMergeOptions = {},
): AiReviewMergeResult {
  const previousRevision = bank.revision;
  if (patch.bankId !== bank.bankId) {
    return {
      status: "conflict",
      bank,
      previousRevision,
      message: `Expected bank ID ${patch.bankId}, but found ${bank.bankId}.`,
    };
  }
  if (
    options.expectedRevision !== undefined
    && (!Number.isInteger(options.expectedRevision) || options.expectedRevision < 0)
  ) {
    return {
      status: "conflict",
      bank,
      previousRevision,
      message: "Expected revision must be a non-negative integer.",
    };
  }
  if (
    options.expectedRevision !== undefined
    && options.expectedRevision > bank.revision
  ) {
    return {
      status: "conflict",
      bank,
      previousRevision,
      message: `Expected future revision ${options.expectedRevision}, but the bank is at ${bank.revision}.`,
    };
  }
  const located = findAiReviewResult(bank, patch.sessionId, patch.requestId);
  if (located === undefined) {
    return {
      status: "conflict",
      bank,
      previousRevision,
      message: `AI review request ${patch.requestId} was not found in session ${patch.sessionId}.`,
    };
  }
  if (located.result.request.requestHash !== patch.requestHash) {
    return {
      status: "conflict",
      bank,
      previousRevision,
      message: `AI review request ${patch.requestId} has a different locked request hash.`,
    };
  }
  const { requestHash: _requestHash, ...hashInput } = located.result.request;
  void _requestHash;
  if (createAiReviewRequestHash(hashInput) !== located.result.request.requestHash) {
    return {
      status: "conflict",
      bank,
      previousRevision,
      message: `AI review request ${patch.requestId} has a tampered locked request snapshot.`,
    };
  }
  const currentState = located.result.state;
  if (canonicalJson(currentState) === canonicalJson(patch.state)) {
    return { status: "unchanged", bank, previousRevision };
  }
  const allowed = currentState.status === "pending"
    ? patch.state.status !== "pending"
      && patch.state.attempts >= currentState.attempts
    : currentState.status === "failed"
      ? patch.state.status === "pending"
        && patch.state.attempts === currentState.attempts
      : false;
  if (!allowed) {
    return {
      status: "conflict",
      bank,
      previousRevision,
      message: `AI review request ${patch.requestId} cannot transition from ${currentState.status} to ${patch.state.status}.`,
    };
  }

  const sessions = bank.sessions.map((session, sessionIndex) => {
    if (sessionIndex !== located.sessionIndex) return session;
    return {
      ...session,
      results: session.results.map((result, resultIndex) =>
        resultIndex === located.resultIndex && result.grading === "ai-review"
          ? { ...result, state: structuredClone(patch.state) }
          : result,
      ),
    };
  });
  const requestedUpdatedAt = options.updatedAt ?? reviewStateTimestamp(patch.state);
  const requestedUpdatedTime = Date.parse(requestedUpdatedAt);
  const currentUpdatedTime = Date.parse(bank.updatedAt);
  const updatedAt =
    Number.isFinite(requestedUpdatedTime)
    && Number.isFinite(currentUpdatedTime)
    && requestedUpdatedTime < currentUpdatedTime
      ? bank.updatedAt
      : requestedUpdatedAt;
  const merged: PracticeBankV2 = {
    ...bank,
    revision: bank.revision + 1,
    updatedAt,
    sessions,
  };
  const validation = validatePracticeBank(merged);
  if (!validation.ok) {
    return {
      status: "invalid-review",
      bank,
      previousRevision,
      message: validation.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; "),
    };
  }
  return {
    status: options.expectedRevision !== undefined
      && options.expectedRevision !== previousRevision
      ? "rebased"
      : "merged",
    bank: validation.value,
    previousRevision,
  };
}

/** Backward-compatible terminal completion API. */
export function mergeAiReviewResolution(
  bank: PracticeBankV2,
  patch: AiReviewResolutionPatchV2,
  options: AiReviewMergeOptions = {},
): AiReviewMergeResult {
  return mergeAiReviewStateTransition(bank, patch, options);
}
