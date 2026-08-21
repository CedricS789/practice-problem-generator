import type { App, TFile } from "obsidian";

import type { DashboardBankRecord } from "./dashboard-model";
import type { PracticeBankParseResult } from "./model";
import { parsePracticeBankMarkdown } from "./persistence";

export interface DashboardLoadIssue {
  readonly bankPath: string;
  readonly severity: "warning" | "error";
  readonly message: string;
}

export interface PracticeDashboardSnapshot {
  readonly loadedAt: string;
  readonly records: readonly DashboardBankRecord[];
  readonly issues: readonly DashboardLoadIssue[];
}

export interface PracticeDashboardRepositoryOptions {
  readonly hasPracticeBankMarker?: (file: TFile) => boolean;
  readonly sourceTags?: (file: TFile) => readonly string[];
}

interface FileStatSnapshot {
  readonly mtime: number;
  readonly size: number;
}

type StableParseResult =
  | { readonly status: "parsed"; readonly parsed: PracticeBankParseResult }
  | { readonly status: "unstable" };

function snapshotFileStat(file: TFile): FileStatSnapshot {
  return {
    mtime: file.stat.mtime,
    size: file.stat.size,
  };
}

function sameFileStat(
  left: FileStatSnapshot,
  right: FileStatSnapshot,
): boolean {
  return left.mtime === right.mtime && left.size === right.size;
}

function isMarkdownFile(value: unknown): value is TFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TFile>;
  return typeof candidate.path === "string"
    && typeof candidate.basename === "string"
    && candidate.extension?.toLowerCase() === "md";
}

function normalizeTags(tags: readonly string[]): string[] {
  const byKey = new Map<string, string>();
  for (const value of tags) {
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    const tag = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
    if (tag === "#") continue;
    const key = tag.toLocaleLowerCase();
    if (!byKey.has(key)) byKey.set(key, tag);
  }
  return [...byKey.values()].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  );
}

function isContractPracticePath(path: string): boolean {
  return /(?:^|\/)Practice\/[^/]+\.md$/iu.test(path);
}

function parseFailureMessage(
  parsed: Exclude<
    ReturnType<typeof parsePracticeBankMarkdown>,
    { status: "ok" }
  >,
): string {
  if (parsed.status === "invalid") return parsed.errors.join("; ");
  if (parsed.status === "unsupported-version") {
    return `Unsupported schema version ${String(parsed.schemaVersion)}.`;
  }
  return parsed.recoveryMessage;
}

export class PracticeDashboardRepository {
  private readonly parsedCache = new Map<
    string,
    FileStatSnapshot & { readonly parsed: PracticeBankParseResult }
  >();

  public constructor(
    private readonly app: App,
    private readonly options: PracticeDashboardRepositoryOptions = {},
  ) {}

  private async readStableParse(file: TFile): Promise<StableParseResult> {
    const initialStat = snapshotFileStat(file);
    const cached = this.parsedCache.get(file.path);
    if (cached !== undefined && sameFileStat(cached, initialStat)) {
      return { status: "parsed", parsed: cached.parsed };
    }
    this.parsedCache.delete(file.path);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const beforeRead = snapshotFileStat(file);
      const markdown = await this.app.vault.cachedRead(file);
      const afterRead = snapshotFileStat(file);
      if (!sameFileStat(beforeRead, afterRead)) {
        this.parsedCache.delete(file.path);
        continue;
      }

      const parsed = parsePracticeBankMarkdown(markdown);
      this.parsedCache.set(file.path, {
        ...afterRead,
        parsed,
      });
      return { status: "parsed", parsed };
    }

    return { status: "unstable" };
  }

  public async load(): Promise<PracticeDashboardSnapshot> {
    const records: DashboardBankRecord[] = [];
    const issues: DashboardLoadIssue[] = [];
    const candidates = this.app.vault.getMarkdownFiles().filter((file) =>
      isContractPracticePath(file.path)
      || this.options.hasPracticeBankMarker?.(file) === true,
    );
    const candidatePaths = new Set(candidates.map((file) => file.path));
    for (const path of this.parsedCache.keys()) {
      if (!candidatePaths.has(path)) this.parsedCache.delete(path);
    }

    await Promise.all(candidates.map(async (file) => {
      const marked = this.options.hasPracticeBankMarker?.(file) === true;
      try {
        const stableParse = await this.readStableParse(file);
        if (stableParse.status === "unstable") {
          issues.push({
            bankPath: file.path,
            severity: "warning",
            message: "The practice bank changed while the dashboard was reading it. Refresh the dashboard to retry.",
          });
          return;
        }
        const { parsed } = stableParse;
        if (parsed.status !== "ok") {
          if (parsed.status !== "missing" || marked) {
            issues.push({
              bankPath: file.path,
              severity: "error",
              message: parseFailureMessage(parsed),
            });
          }
          return;
        }
        const source = this.app.vault.getAbstractFileByPath(
          parsed.bank.source.vaultPath,
        );
        const sourceExists = isMarkdownFile(source);
        records.push({
          bankPath: file.path,
          bank: parsed.bank,
          sourceExists,
          sourceTags: sourceExists
            ? normalizeTags(this.options.sourceTags?.(source) ?? [])
            : [],
        });
        for (const warning of parsed.warnings) {
          issues.push({
            bankPath: file.path,
            severity: "warning",
            message: warning,
          });
        }
      } catch (error) {
        issues.push({
          bankPath: file.path,
          severity: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }));

    records.sort((left, right) => left.bank.source.title.localeCompare(
      right.bank.source.title,
      undefined,
      { sensitivity: "base" },
    ));
    issues.sort((left, right) => left.bankPath.localeCompare(right.bankPath));
    return {
      loadedAt: new Date().toISOString(),
      records,
      issues,
    };
  }
}
