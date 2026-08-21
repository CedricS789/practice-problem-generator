import type {
  CliJobFileSystem,
  CliJobWorkspace,
  CliProcessRunner,
  MediaInput,
  NeutralMedia,
  ProcessRunRequest,
  ProcessRunResult,
} from "./contracts";
import { CliProviderError, normalizeUnknownError } from "./errors";

const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const JOB_PREFIX = "practice-lab-";

type DesktopNodeModuleId =
  | "node:child_process"
  | "node:fs/promises"
  | "node:os"
  | "node:path";

type CommonJsRequire = (specifier: string) => unknown;

/**
 * Obsidian runs desktop plugins as CommonJS inside Electron. A native dynamic
 * `import("node:...")` is instead resolved as an `app://` browser import and is
 * blocked by Electron's CORS policy. Resolve built-ins synchronously and only
 * from desktop-only method bodies so mobile plugin evaluation loads no Node
 * module. `getBuiltinModule` keeps the same code testable from a Node ESM host.
 */
function loadDesktopCommonJsModule<T>(specifier: DesktopNodeModuleId): T {
  const lexicalRequire: CommonJsRequire | undefined =
    typeof require === "function" ? require : undefined;
  if (lexicalRequire !== undefined) {
    return lexicalRequire(specifier) as T;
  }

  const getBuiltinModule = (
    process as unknown as {
      getBuiltinModule?: (moduleSpecifier: string) => unknown;
    }
  ).getBuiltinModule;
  if (typeof getBuiltinModule === "function") {
    const loadedModule = getBuiltinModule(specifier);
    if (loadedModule !== undefined) return loadedModule as T;
  }

  throw new CliProviderError(
    "process-failed",
    "Practice Problem Generator could not access the desktop Node runtime.",
  );
}

/**
 * Node modules are loaded only when a desktop generation action invokes this
 * method. Evaluating the plugin bundle on mobile therefore does not load
 * child_process.
 */
export class DesktopProcessRunner implements CliProcessRunner {
  readonly maxOutputBytes: number;

  constructor(maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES) {
    this.maxOutputBytes = maxOutputBytes;
  }

  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    if (isSignalAborted(request.signal)) {
      throw new CliProviderError("cancelled", "The AI job was cancelled.");
    }

    const { spawn } = loadDesktopCommonJsModule<
      typeof import("node:child_process")
    >("node:child_process");
    const target = await resolveSpawnTarget(request.executable);
    if (isSignalAborted(request.signal)) {
      throw new CliProviderError("cancelled", "The AI job was cancelled.");
    }

    return await new Promise<ProcessRunResult>((resolve, reject) => {
      let settled = false;
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      const child = spawn(target.executable, [...target.prefixArgs, ...request.args], {
        cwd: request.cwd,
        env: { ...process.env, NO_COLOR: "1" },
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const finishReject = (error: unknown): void => {
        if (settled) return;
        settled = true;
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        request.signal?.removeEventListener("abort", cancel);
        reject(normalizeUnknownError(error));
      };

      const terminateChildTree = async (): Promise<void> => {
        if (process.platform !== "win32" || child.pid === undefined) {
          child.kill();
          return;
        }

        await new Promise<void>((finish) => {
          let killerSettled = false;
          const finishKiller = (): void => {
            if (killerSettled) return;
            killerSettled = true;
            clearTimeout(killerTimeout);
            finish();
          };
          const killer = spawn(
            "taskkill.exe",
            ["/pid", String(child.pid), "/t", "/f"],
            {
              shell: false,
              windowsHide: true,
              stdio: "ignore",
            },
          );
          const killerTimeout = setTimeout(() => {
            killer.kill();
            child.kill();
            finishKiller();
          }, 3_000);
          killer.once("error", () => {
            child.kill();
            finishKiller();
          });
          killer.once("close", finishKiller);
        });
      };

      const stopAndReject = (error: unknown): void => {
        if (settled) return;
        settled = true;
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        request.signal?.removeEventListener("abort", cancel);
        void terminateChildTree().finally(() => {
          reject(normalizeUnknownError(error));
        });
      };

      const cancel = (): void => {
        stopAndReject(
          new CliProviderError("cancelled", "The AI job was cancelled."),
        );
      };

      timeoutHandle = setTimeout(() => {
        stopAndReject(
          new CliProviderError(
            "timeout",
            `The CLI did not finish within ${request.timeoutMs} ms.`,
          ),
        );
      }, request.timeoutMs);

      request.signal?.addEventListener("abort", cancel, { once: true });
      if (request.signal?.aborted === true) {
        cancel();
        return;
      }

      const collect = (target: "stdout" | "stderr", chunk: unknown): void => {
        if (settled) return;
        const text = String(chunk);
        outputBytes += Buffer.byteLength(text);
        if (outputBytes > this.maxOutputBytes) {
          stopAndReject(
            new CliProviderError(
              "process-failed",
              "The CLI produced more output than Practice Problem Generator permits.",
            ),
          );
          return;
        }
        if (target === "stdout") stdout += text;
        else stderr += text;
      };

      child.stdout.on("data", (chunk: unknown) => collect("stdout", chunk));
      child.stderr.on("data", (chunk: unknown) => collect("stderr", chunk));
      child.once("error", finishReject);
      child.once("close", (exitCode) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        request.signal?.removeEventListener("abort", cancel);
        resolve({ stdout, stderr, exitCode: exitCode ?? -1 });
      });

      child.stdin.once("error", stopAndReject);
      child.stdin.end(request.stdin, "utf8");
    });
  }
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

interface SpawnTarget {
  readonly executable: string;
  readonly prefixArgs: readonly string[];
}

/**
 * Windows cannot execute npm `.cmd` shims with `shell: false`. Resolve a
 * standard npm shim to its JavaScript entry point and invoke Node directly;
 * arbitrary batch and PowerShell scripts are deliberately never executed.
 */
async function resolveSpawnTarget(
  executable: string,
): Promise<SpawnTarget> {
  if (process.platform !== "win32") {
    return { executable, prefixArgs: [] };
  }

  const { access, readFile } = loadDesktopCommonJsModule<
    typeof import("node:fs/promises")
  >("node:fs/promises");
  const path = loadDesktopCommonJsModule<typeof import("node:path")>(
    "node:path",
  );
  const exists = async (candidate: string): Promise<boolean> => {
    try {
      await access(candidate);
      return true;
    } catch {
      return false;
    }
  };

  const explicitExtension = path.extname(executable).toLowerCase();
  if (explicitExtension === ".exe" || explicitExtension === ".com") {
    return { executable, prefixArgs: [] };
  }

  const pathDirectories = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter((entry) => entry.length > 0);
  const hasDirectory = path.dirname(executable) !== ".";
  const directories = hasDirectory ? [path.dirname(executable)] : pathDirectories;
  const baseName = hasDirectory ? path.basename(executable) : executable;

  for (const directory of directories) {
    const directExecutable = path.join(directory, `${baseName}.exe`);
    if (await exists(directExecutable)) {
      return { executable: directExecutable, prefixArgs: [] };
    }

    const commandShim = path.join(
      directory,
      explicitExtension === ".cmd" ? baseName : `${baseName}.cmd`,
    );
    if (!(await exists(commandShim))) continue;

    const shimText = await readFile(commandShim, "utf8");
    const entryMatch = /%dp0%[\\/]([^"\r\n]+?\.js)/iu.exec(shimText);
    const relativeEntry = entryMatch?.[1];
    if (relativeEntry === undefined) continue;
    const entryPath = path.resolve(
      directory,
      relativeEntry.replaceAll("\\", path.sep),
    );
    if (!(await exists(entryPath))) continue;

    const localNode = path.join(directory, "node.exe");
    let nodeExecutable = (await exists(localNode)) ? localNode : undefined;
    if (nodeExecutable === undefined) {
      for (const nodeDirectory of pathDirectories) {
        const candidate = path.join(nodeDirectory, "node.exe");
        if (await exists(candidate)) {
          nodeExecutable = candidate;
          break;
        }
      }
    }
    if (nodeExecutable !== undefined) {
      return { executable: nodeExecutable, prefixArgs: [entryPath] };
    }
  }

  // Let spawn produce its native ENOENT for ordinary missing executables.
  return { executable, prefixArgs: [] };
}

/** Node filesystem modules are likewise deferred until a desktop job starts. */
export class DesktopJobFileSystem implements CliJobFileSystem {
  async create(): Promise<CliJobWorkspace> {
    try {
      const { mkdtemp, writeFile, copyFile, rm } =
        loadDesktopCommonJsModule<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      const { tmpdir } = loadDesktopCommonJsModule<typeof import("node:os")>(
        "node:os",
      );
      const path = loadDesktopCommonJsModule<typeof import("node:path")>(
        "node:path",
      );
      const absolutePath = await mkdtemp(path.join(tmpdir(), JOB_PREFIX));
      let cleaned = false;

      const assertFilename = (filename: string): void => {
        if (!/^[a-z0-9][a-z0-9._-]*$/u.test(filename)) {
          throw new CliProviderError(
            "workspace-error",
            "An unsafe temporary filename was rejected.",
          );
        }
      };

      return {
        absolutePath,
        async writeText(filename, content) {
          assertFilename(filename);
          const destination = path.join(absolutePath, filename);
          await writeFile(destination, content, "utf8");
          return destination;
        },
        async writeBinary(filename, content) {
          assertFilename(filename);
          const destination = path.join(absolutePath, filename);
          await writeFile(destination, content);
          return destination;
        },
        async copyMedia(media: readonly MediaInput[]) {
          const copies: NeutralMedia[] = [];
          for (const [index, item] of media.entries()) {
            const extension = neutralExtension(item);
            const filename = `media-${String(index + 1).padStart(3, "0")}${extension}`;
            const destination = path.join(absolutePath, filename);
            if (item.bytes !== undefined) {
              const bytes =
                item.bytes instanceof Uint8Array
                  ? item.bytes
                  : new Uint8Array(item.bytes);
              await writeFile(destination, bytes);
            } else {
              await copyFile(item.filePath, destination);
            }
            copies.push(
              item.mimeType === undefined
                ? { absolutePath: destination, filename }
                : { absolutePath: destination, filename, mimeType: item.mimeType },
            );
          }
          return copies;
        },
        async cleanup() {
          if (cleaned) return;
          await rm(absolutePath, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 100,
          });
          cleaned = true;
        },
      };
    } catch (error) {
      throw new CliProviderError(
        "workspace-error",
        "Practice Problem Generator could not create its isolated temporary job.",
        { cause: error },
      );
    }
  }
}

function neutralExtension(media: MediaInput): string {
  const byMime: Readonly<Record<string, string>> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };
  const fromMime =
    media.mimeType === undefined ? undefined : byMime[media.mimeType.toLowerCase()];
  if (fromMime !== undefined) return fromMime;

  if (media.filePath === undefined) return ".bin";
  const match = /\.(png|jpe?g|webp|gif)$/iu.exec(media.filePath);
  if (match === null) return ".bin";
  const extension = match[1]?.toLowerCase();
  return extension === "jpeg" ? ".jpg" : `.${extension ?? "bin"}`;
}
