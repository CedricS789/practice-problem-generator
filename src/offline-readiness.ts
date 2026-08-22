import type { PracticeBankV2 } from "./model";

const PORTABLE_STATIC_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "svg",
]);

export interface OfflineReadinessBankInput {
  readonly bankPath: string;
  readonly bank: PracticeBankV2;
}

export interface OfflineReadinessFileState {
  readonly exists: boolean;
  readonly extension?: string;
}

export interface OfflineReadinessIssue {
  readonly severity: "error" | "warning";
  readonly bankPath: string;
  readonly exerciseId?: string;
  readonly visualPath?: string;
  readonly message: string;
}

export interface OfflineReadinessReport {
  readonly ready: boolean;
  readonly bankCount: number;
  readonly exerciseCount: number;
  readonly occlusionCount: number;
  readonly referencedImagePaths: readonly string[];
  readonly issues: readonly OfflineReadinessIssue[];
}

function normalizePath(path: string): string {
  return path.replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
}

function extensionFromPath(path: string): string {
  const filename = normalizePath(path).split("/").at(-1) ?? "";
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot + 1).toLocaleLowerCase();
}

function portableAttachmentPath(path: string): boolean {
  return normalizePath(path).toLocaleLowerCase().startsWith("_vault/attachments/");
}

export function auditOfflineReadiness(
  banks: readonly OfflineReadinessBankInput[],
  fileState: (path: string) => OfflineReadinessFileState,
  parseIssues: readonly Pick<OfflineReadinessIssue, "bankPath" | "severity" | "message">[] = [],
): OfflineReadinessReport {
  const issues: OfflineReadinessIssue[] = parseIssues.map((issue) => ({
    ...issue,
    bankPath: normalizePath(issue.bankPath),
  }));
  const referencedImages = new Set<string>();
  let exerciseCount = 0;
  let occlusionCount = 0;

  for (const input of banks) {
    const bankPath = normalizePath(input.bankPath);
    exerciseCount += input.bank.exercises.length;
    const visuals = new Map(input.bank.visuals.map((visual) => [visual.id, visual]));
    for (const exercise of input.bank.exercises) {
      if (exercise.type !== "image-occlusion") continue;
      occlusionCount += 1;
      const visual = visuals.get(exercise.visualId);
      if (visual === undefined) {
        issues.push({
          severity: "error",
          bankPath,
          exerciseId: exercise.id,
          message: `Occlusion ${exercise.id} references missing visual ID ${exercise.visualId}.`,
        });
        continue;
      }
      const visualPath = normalizePath(visual.vaultPath);
      referencedImages.add(visualPath);
      const state = fileState(visualPath);
      if (!state.exists) {
        issues.push({
          severity: "error",
          bankPath,
          exerciseId: exercise.id,
          visualPath,
          message: `Occlusion image is missing from the vault: ${visualPath}.`,
        });
        continue;
      }
      const extension = (state.extension ?? extensionFromPath(visualPath)).toLocaleLowerCase();
      if (!PORTABLE_STATIC_EXTENSIONS.has(extension)) {
        issues.push({
          severity: "error",
          bankPath,
          exerciseId: exercise.id,
          visualPath,
          message: `Occlusion visual ${visualPath} is not a portable static PNG, JPEG, WebP, or SVG snapshot.`,
        });
      }
      if (!portableAttachmentPath(visualPath)) {
        issues.push({
          severity: "error",
          bankPath,
          exerciseId: exercise.id,
          visualPath,
          message: `Referenced image is outside _Vault/Attachments and will not be transferred by the configured commute selector: ${visualPath}.`,
        });
      }
    }
  }

  issues.sort((left, right) =>
    (left.severity === right.severity ? 0 : left.severity === "error" ? -1 : 1)
    || left.bankPath.localeCompare(right.bankPath)
    || (left.exerciseId ?? "").localeCompare(right.exerciseId ?? ""),
  );
  return {
    ready: !issues.some((issue) => issue.severity === "error"),
    bankCount: banks.length,
    exerciseCount,
    occlusionCount,
    referencedImagePaths: [...referencedImages].sort((left, right) => left.localeCompare(right)),
    issues,
  };
}

export function isPortableStaticAttachment(path: string): boolean {
  return portableAttachmentPath(path)
    && PORTABLE_STATIC_EXTENSIONS.has(extensionFromPath(path));
}
