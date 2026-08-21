import type { PracticeBankV2, SessionSummaryV2 } from "./model";
import { validatePracticeBank } from "./schema";

export const RESET_SETTINGS_CONFIRMATION = "RESET SETTINGS";
export const CLEAR_HISTORY_CONFIRMATION = "CLEAR HISTORY";
export const DELETE_BANK_CONFIRMATION = "DELETE BANK";
export const DELETE_SESSION_CONFIRMATION = "DELETE";

export type SessionRemovalResult =
  | {
      readonly status: "removed";
      readonly bank: PracticeBankV2;
      readonly removed: readonly SessionSummaryV2[];
    }
  | {
      readonly status: "unchanged";
      readonly bank: PracticeBankV2;
      readonly removed: readonly [];
    };

function nextUpdatedAt(current: string, requested: string): string {
  const currentTime = Date.parse(current);
  const requestedTime = Date.parse(requested);
  if (!Number.isFinite(requestedTime)) {
    throw new Error("The data-management timestamp is invalid.");
  }
  return Number.isFinite(currentTime) && requestedTime < currentTime
    ? current
    : requested;
}

function withSessions(
  bank: PracticeBankV2,
  sessions: readonly SessionSummaryV2[],
  removed: readonly SessionSummaryV2[],
  updatedAt: string,
): SessionRemovalResult {
  if (removed.length === 0) {
    return { status: "unchanged", bank, removed: [] };
  }
  const updated: PracticeBankV2 = {
    ...bank,
    revision: bank.revision + 1,
    updatedAt: nextUpdatedAt(bank.updatedAt, updatedAt),
    sessions: sessions.map((session) => structuredClone(session)),
  };
  const validation = validatePracticeBank(updated);
  if (!validation.ok) {
    throw new Error(
      `Removing practice history would create an invalid bank: ${validation.issues[0]?.message ?? "unknown validation error"}`,
    );
  }
  return {
    status: "removed",
    bank: updated,
    removed: removed.map((session) => structuredClone(session)),
  };
}

export function removePracticeSession(
  bank: PracticeBankV2,
  sessionId: string,
  updatedAt: string,
): SessionRemovalResult {
  const removed = bank.sessions.filter((session) => session.id === sessionId);
  return withSessions(
    bank,
    bank.sessions.filter((session) => session.id !== sessionId),
    removed,
    updatedAt,
  );
}

export function clearPracticeSessions(
  bank: PracticeBankV2,
  updatedAt: string,
): SessionRemovalResult {
  return withSessions(bank, [], bank.sessions, updatedAt);
}

export function practiceBankBackupPath(
  backupRoot: string,
  bankPath: string,
): string {
  const root = backupRoot.replace(/\\/gu, "/").replace(/\/+$/u, "");
  const relative = bankPath.replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
  if (
    root.length === 0
    || relative.length === 0
    || relative.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("Could not create a safe Practice Problem Generator backup path.");
  }
  return `${root}/${relative}.bak`;
}
