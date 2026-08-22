import type {
  CliJobFileSystem,
  CliJobWorkspace,
  CliProcessRunner,
  DurableProcessHandle,
  MediaInput,
  NeutralMedia,
  ProcessRunRequest,
  ProcessRunResult,
} from "./contracts";
import { CliProviderError, normalizeUnknownError } from "./errors";

const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const JOB_PREFIX = "practice-lab-";
const DURABLE_WORKER_FILENAME = "durable-worker.cjs";
const DURABLE_ACTIVE_FILENAME = "durable-active.json";
const DURABLE_POLL_MS = 250;
const DURABLE_START_GRACE_MS = 5_000;
const DURABLE_CANCEL_GRACE_MS = 5_000;

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
    if (request.durable !== undefined) {
      return await this.runDurable(request);
    }
    return await this.runAttached(request);
  }

  private async runAttached(
    request: ProcessRunRequest,
  ): Promise<ProcessRunResult> {
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
        try {
          request.onOutput?.({ stream: target, text });
        } catch {
          // Output observers are informational and must never affect the job.
        }
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

  private async runDurable(
    request: ProcessRunRequest,
  ): Promise<ProcessRunResult> {
    const durable = request.durable;
    if (durable === undefined) return await this.runAttached(request);
    if (isSignalAborted(request.signal)) {
      throw new CliProviderError("cancelled", "The AI job was cancelled.");
    }

    let handle: DurableProcessHandle;
    if (durable.mode === "start") {
      const target = await resolveSpawnTarget(request.executable);
      handle = durable.handle ?? {
          version: 1,
          jobId: durable.jobId,
          workspacePath: request.cwd,
          startedAt: new Date().toISOString(),
        };
      assertDurableHandle(handle);
      if (
        handle.jobId !== durable.jobId
        || comparableRuntimePath(handle.workspacePath) !== comparableRuntimePath(request.cwd)
      ) {
        throw new CliProviderError(
          "workspace-error",
          "The recoverable AI job does not match its isolated workspace.",
        );
      }
      const active = await prepareDurableRun(
        handle,
        durable.attempt,
        target,
        request,
        this.maxOutputBytes,
      );
      await durable.onReady?.(handle);
      await launchDurableWorker(handle, active);
    } else {
      handle = durable.handle;
      assertDurableHandle(handle);
      if (comparableRuntimePath(handle.workspacePath) !== comparableRuntimePath(request.cwd)) {
        throw new CliProviderError(
          "workspace-error",
          "The recoverable AI job does not match its isolated workspace.",
        );
      }
      await ensurePreparedDurableWorker(handle);
    }

    return await pollDurableRun(
      handle,
      request.signal,
      request.onOutput,
      this.maxOutputBytes,
    );
  }
}

interface DurableActiveRecord {
  readonly version: 1;
  readonly jobId: string;
  readonly attempt: 1 | 2;
  readonly startedAt: string;
  readonly deadlineAt: number;
  readonly requestFile: string;
  readonly stdoutFile: string;
  readonly stderrFile: string;
  readonly statusFile: string;
  readonly cancelFile: string;
  readonly workerPid?: number;
}

interface DurableStatusRecord {
  readonly phase: "running" | "completed" | "failed";
  readonly exitCode?: number;
  readonly reason?: "cancelled" | "timeout" | "output-limit" | "spawn-error";
  readonly errorCode?: string;
  readonly detail?: string;
  readonly wrapperPid?: number;
  readonly childPid?: number;
}

async function prepareDurableRun(
  handle: DurableProcessHandle,
  attempt: 1 | 2,
  target: SpawnTarget,
  request: ProcessRunRequest,
  maxOutputBytes: number,
): Promise<DurableActiveRecord> {
  const { writeFile, rm } = loadDesktopCommonJsModule<
    typeof import("node:fs/promises")
  >("node:fs/promises");
  const path = loadDesktopCommonJsModule<typeof import("node:path")>(
    "node:path",
  );
  const prefix = `durable-${attempt}`;
  const stdinFile = path.join(handle.workspacePath, `${prefix}.stdin`);
  const stdoutFile = path.join(handle.workspacePath, `${prefix}.stdout`);
  const stderrFile = path.join(handle.workspacePath, `${prefix}.stderr`);
  const statusFile = path.join(handle.workspacePath, `${prefix}.status.json`);
  const cancelFile = path.join(handle.workspacePath, `${prefix}.cancel`);
  const requestFile = path.join(handle.workspacePath, `${prefix}.request.json`);
  const workerFile = path.join(handle.workspacePath, DURABLE_WORKER_FILENAME);
  await Promise.all([
    writeFile(workerFile, DURABLE_WORKER_SOURCE, "utf8"),
    writeFile(stdinFile, request.stdin, "utf8"),
    writeFile(stdoutFile, "", "utf8"),
    writeFile(stderrFile, "", "utf8"),
    rm(statusFile, { force: true }),
    rm(cancelFile, { force: true }),
  ]);

  const deadlineAt = Date.now() + request.timeoutMs;
  await atomicWriteJson(requestFile, {
    version: 1,
    executable: target.executable,
    args: [...target.prefixArgs, ...request.args],
    cwd: request.cwd,
    stdinFile,
    stdoutFile,
    stderrFile,
    statusFile,
    cancelFile,
    deadlineAt,
    maxOutputBytes,
  });
  const active: DurableActiveRecord = {
    version: 1,
    jobId: handle.jobId,
    attempt,
    startedAt: handle.startedAt,
    deadlineAt,
    requestFile,
    stdoutFile,
    stderrFile,
    statusFile,
    cancelFile,
  };
  await atomicWriteJson(
    path.join(handle.workspacePath, DURABLE_ACTIVE_FILENAME),
    active,
  );
  return active;
}

async function launchDurableWorker(
  handle: DurableProcessHandle,
  active: DurableActiveRecord,
): Promise<void> {
  const { spawn } = loadDesktopCommonJsModule<
    typeof import("node:child_process")
  >("node:child_process");
  const path = loadDesktopCommonJsModule<typeof import("node:path")>(
    "node:path",
  );
  const workerPath = path.join(handle.workspacePath, DURABLE_WORKER_FILENAME);
  let worker;
  try {
    worker = spawn(process.execPath, [workerPath, active.requestFile], {
      cwd: handle.workspacePath,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NO_COLOR: "1",
      },
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: "ignore",
    });
  } catch (error) {
    throw normalizeUnknownError(error);
  }
  const workerPid = worker.pid;
  if (workerPid === undefined) {
    throw new CliProviderError(
      "process-failed",
      "Practice Problem Generator could not start its recoverable local helper.",
    );
  }
  worker.unref();
  await atomicWriteJson(
    path.join(handle.workspacePath, DURABLE_ACTIVE_FILENAME),
    { ...active, workerPid },
  );
}

async function ensurePreparedDurableWorker(
  handle: DurableProcessHandle,
): Promise<void> {
  const path = loadDesktopCommonJsModule<typeof import("node:path")>(
    "node:path",
  );
  const active = parseDurableActiveRecord(
    await readJsonFile(path.join(handle.workspacePath, DURABLE_ACTIVE_FILENAME)),
  );
  assertDurableActivePaths(handle, active);
  if (active.jobId !== handle.jobId || active.startedAt !== handle.startedAt) {
    throw new CliProviderError(
      "workspace-error",
      "The recoverable AI job metadata does not match its saved handle.",
    );
  }
  if (await readDurableStatus(active.statusFile) !== null) return;
  if (active.workerPid !== undefined && isProcessAlive(active.workerPid)) return;

  const ageMs = Date.now() - Date.parse(active.startedAt);
  if (ageMs < DURABLE_START_GRACE_MS) {
    await delay(DURABLE_START_GRACE_MS - Math.max(0, ageMs));
    if (await readDurableStatus(active.statusFile) !== null) return;
    if (active.workerPid !== undefined && isProcessAlive(active.workerPid)) return;
  }

  // The recovery handle is persisted before launch. If Obsidian disappeared
  // in that tiny window, no provider turn exists yet; launch the already
  // prepared exact request instead of asking the user to start over.
  const { workerPid: _formerWorkerPid, ...prepared } = active;
  await launchDurableWorker(handle, prepared);
}

async function pollDurableRun(
  handle: DurableProcessHandle,
  signal: AbortSignal | undefined,
  onOutput: ProcessRunRequest["onOutput"],
  maxOutputBytes: number,
): Promise<ProcessRunResult> {
  const { writeFile } = loadDesktopCommonJsModule<
    typeof import("node:fs/promises")
  >("node:fs/promises");
  const path = loadDesktopCommonJsModule<typeof import("node:path")>(
    "node:path",
  );
  const active = parseDurableActiveRecord(
    await readJsonFile(path.join(handle.workspacePath, DURABLE_ACTIVE_FILENAME)),
  );
  assertDurableActivePaths(handle, active);
  if (active.jobId !== handle.jobId || active.startedAt !== handle.startedAt) {
    throw new CliProviderError(
      "workspace-error",
      "The recoverable AI job metadata does not match its saved handle.",
    );
  }

  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];
  const stdoutDecoder = new TextDecoder();
  const stderrDecoder = new TextDecoder();
  let stdoutOffset = 0;
  let stderrOffset = 0;
  let cancellationRequested = false;
  let timeoutRequested = false;
  let cancellationDeadline = 0;
  const emitNewOutput = async (): Promise<void> => {
    const [nextStdout, nextStderr] = await Promise.all([
      readFileDelta(active.stdoutFile, stdoutOffset, maxOutputBytes),
      readFileDelta(active.stderrFile, stderrOffset, maxOutputBytes),
    ]);
    if (nextStdout.nextOffset + nextStderr.nextOffset > maxOutputBytes) {
      throw new CliProviderError(
        "process-failed",
        "The CLI produced more output than Practice Problem Generator permits.",
      );
    }
    stdoutOffset = nextStdout.nextOffset;
    stderrOffset = nextStderr.nextOffset;
    if (nextStdout.bytes.length > 0) {
      const text = stdoutDecoder.decode(nextStdout.bytes, { stream: true });
      if (text.length > 0) stdoutParts.push(text);
      try {
        onOutput?.({ stream: "stdout", text });
      } catch {
        // Durable output observers are informational only.
      }
    }
    if (nextStderr.bytes.length > 0) {
      const text = stderrDecoder.decode(nextStderr.bytes, { stream: true });
      if (text.length > 0) stderrParts.push(text);
      try {
        onOutput?.({ stream: "stderr", text });
      } catch {
        // Durable output observers are informational only.
      }
    }
  };

  while (true) {
    if (signal?.aborted === true && isDetachReason(signal.reason)) {
      throw new CliProviderError(
        "detached",
        "The recoverable AI job is continuing outside the unloaded plugin.",
      );
    }
    if (signal?.aborted === true && !cancellationRequested) {
      cancellationRequested = true;
      cancellationDeadline = Date.now() + DURABLE_CANCEL_GRACE_MS;
      await writeFile(active.cancelFile, "cancel\n", "utf8");
    }
    if (
      !cancellationRequested
      && !timeoutRequested
      && Date.now() > active.deadlineAt + 1_000
    ) {
      timeoutRequested = true;
      cancellationDeadline = Date.now() + DURABLE_CANCEL_GRACE_MS;
      await writeFile(active.cancelFile, "timeout\n", "utf8");
    }

    await emitNewOutput();
    const status = await readDurableStatus(active.statusFile);
    if (status?.phase === "completed" || status?.phase === "failed") {
      await emitNewOutput();
      const stdoutTail = stdoutDecoder.decode();
      const stderrTail = stderrDecoder.decode();
      if (stdoutTail.length > 0) stdoutParts.push(stdoutTail);
      if (stderrTail.length > 0) stderrParts.push(stderrTail);
      if (cancellationRequested || status.reason === "cancelled") {
        throw new CliProviderError("cancelled", "The AI job was cancelled.");
      }
      if (timeoutRequested || status.reason === "timeout") {
        throw new CliProviderError(
          "timeout",
          "The CLI did not finish before the recoverable job deadline.",
        );
      }
      if (status.reason === "output-limit") {
        throw new CliProviderError(
          "process-failed",
          "The CLI produced more output than Practice Problem Generator permits.",
        );
      }
      if (status.reason === "spawn-error") {
        if (status.errorCode === "ENOENT") {
          throw new CliProviderError(
            "missing-executable",
            "The configured CLI executable was not found.",
          );
        }
        throw new CliProviderError(
          "process-failed",
          "The recoverable CLI process failed to start.",
          { ...(status.detail === undefined ? {} : { detail: status.detail }) },
        );
      }
      return {
        stdout: stdoutParts.join(""),
        stderr: stderrParts.join(""),
        exitCode: status.exitCode ?? -1,
        durableAttempt: active.attempt,
        recoveryHandle: handle,
      };
    }

    if (
      cancellationDeadline > 0
      && Date.now() > cancellationDeadline
    ) {
      const workerPid = status?.wrapperPid ?? active.workerPid;
      if (workerPid !== undefined) await terminateProcessTree(workerPid);
      throw new CliProviderError(
        cancellationRequested ? "cancelled" : "timeout",
        cancellationRequested
          ? "The AI job was cancelled."
          : "The recoverable AI job exceeded its deadline.",
      );
    }

    const workerPid = status?.wrapperPid ?? active.workerPid;
    if (
      Date.now() - Date.parse(active.startedAt) > DURABLE_START_GRACE_MS
      && workerPid !== undefined
      && !isProcessAlive(workerPid)
    ) {
      await delay(DURABLE_POLL_MS);
      const finalStatus = await readDurableStatus(active.statusFile);
      if (finalStatus?.phase !== "completed" && finalStatus?.phase !== "failed") {
        throw new CliProviderError(
          "process-failed",
          "The recoverable local helper stopped before recording a result.",
        );
      }
    }
    if (
      Date.now() - Date.parse(active.startedAt) > DURABLE_START_GRACE_MS
      && workerPid === undefined
      && status === null
    ) {
      throw new CliProviderError(
        "process-failed",
        "The recoverable local helper did not start. The approved request is still available to retry.",
      );
    }
    await delay(DURABLE_POLL_MS);
  }
}

export function parseDurableProcessHandle(
  value: unknown,
): DurableProcessHandle | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.version !== 1
    || typeof value.jobId !== "string"
    || typeof value.workspacePath !== "string"
    || typeof value.startedAt !== "string"
  ) return undefined;
  const handle: DurableProcessHandle = {
    version: 1,
    jobId: value.jobId,
    workspacePath: value.workspacePath,
    startedAt: value.startedAt,
  };
  try {
    assertDurableHandle(handle);
    return handle;
  } catch {
    return undefined;
  }
}

export async function readDurableRecoveryText(
  handle: DurableProcessHandle,
  filename: string,
): Promise<string> {
  const { readFile } = loadDesktopCommonJsModule<
    typeof import("node:fs/promises")
  >("node:fs/promises");
  const path = await durableRecoveryFile(handle, filename);
  return await readFile(path, "utf8");
}

export async function writeDurableRecoveryText(
  handle: DurableProcessHandle,
  filename: string,
  content: string,
): Promise<void> {
  const path = await durableRecoveryFile(handle, filename);
  await atomicWriteText(path, content);
}

export async function cancelDurableRecovery(
  handle: DurableProcessHandle,
): Promise<void> {
  const { writeFile } = loadDesktopCommonJsModule<
    typeof import("node:fs/promises")
  >("node:fs/promises");
  const path = loadDesktopCommonJsModule<typeof import("node:path")>(
    "node:path",
  );
  await assertRecoveryWorkspace(handle);
  const active = parseDurableActiveRecord(
    await readJsonFile(path.join(handle.workspacePath, DURABLE_ACTIVE_FILENAME)),
  );
  assertDurableActivePaths(handle, active);
  if (active.jobId !== handle.jobId || active.startedAt !== handle.startedAt) {
    throw new CliProviderError(
      "workspace-error",
      "The recoverable AI job metadata does not match its saved handle.",
    );
  }
  const terminal = await readDurableStatus(active.statusFile);
  if (terminal?.phase === "completed" || terminal?.phase === "failed") return;

  await writeFile(active.cancelFile, "cancel\n", "utf8");
  const deadline = Date.now() + DURABLE_CANCEL_GRACE_MS;
  while (Date.now() <= deadline) {
    const status = await readDurableStatus(active.statusFile);
    if (status?.phase === "completed" || status?.phase === "failed") return;
    await delay(DURABLE_POLL_MS);
  }
  const latest = await readDurableStatus(active.statusFile);
  const workerPid = latest?.wrapperPid ?? active.workerPid;
  if (workerPid !== undefined) await terminateProcessTree(workerPid);
}

export async function removeDurableRecovery(
  handle: DurableProcessHandle,
): Promise<void> {
  const { rm } = loadDesktopCommonJsModule<
    typeof import("node:fs/promises")
  >("node:fs/promises");
  // Removal is deliberately idempotent. A cancellation may let the adapter
  // clean the workspace just before the UI finishes its explicit discard.
  // The path is still validated before a recursive remove is attempted.
  await assertRecoveryWorkspace(handle, false);
  await rm(handle.workspacePath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

async function durableRecoveryFile(
  handle: DurableProcessHandle,
  filename: string,
): Promise<string> {
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(filename)) {
    throw new CliProviderError(
      "workspace-error",
      "An unsafe recovery filename was rejected.",
    );
  }
  await assertRecoveryWorkspace(handle);
  const path = loadDesktopCommonJsModule<typeof import("node:path")>(
    "node:path",
  );
  return path.join(handle.workspacePath, filename);
}

async function assertRecoveryWorkspace(
  handle: DurableProcessHandle,
  mustExist = true,
): Promise<void> {
  assertDurableHandle(handle);
  const { stat } = loadDesktopCommonJsModule<
    typeof import("node:fs/promises")
  >("node:fs/promises");
  const { tmpdir } = loadDesktopCommonJsModule<typeof import("node:os")>(
    "node:os",
  );
  const path = loadDesktopCommonJsModule<typeof import("node:path")>(
    "node:path",
  );
  const root = path.resolve(tmpdir());
  const candidate = path.resolve(handle.workspacePath);
  const relative = path.relative(root, candidate);
  if (
    relative.length === 0
    || relative.startsWith("..")
    || path.isAbsolute(relative)
    || !path.basename(candidate).startsWith(JOB_PREFIX)
  ) {
    throw new CliProviderError(
      "workspace-error",
      "The recoverable AI workspace is outside the operating-system temporary directory.",
    );
  }
  if (!mustExist) return;
  try {
    if (!(await stat(candidate)).isDirectory()) throw new Error("Not a directory.");
  } catch (error) {
    throw new CliProviderError(
      "workspace-error",
      "The recoverable AI workspace is no longer available.",
      { cause: error },
    );
  }
}

function assertDurableHandle(handle: DurableProcessHandle): void {
  if (
    handle.version !== 1
    || !/^[a-z0-9][a-z0-9._-]{7,159}$/u.test(handle.jobId)
    || handle.workspacePath.trim().length === 0
    || !Number.isFinite(Date.parse(handle.startedAt))
  ) {
    throw new CliProviderError(
      "workspace-error",
      "The recoverable AI job handle is invalid.",
    );
  }
}

function parseDurableActiveRecord(value: unknown): DurableActiveRecord {
  if (!isRecord(value)) throw invalidActiveRecord();
  const attempt = value.attempt;
  if (
    value.version !== 1
    || typeof value.jobId !== "string"
    || (attempt !== 1 && attempt !== 2)
    || typeof value.startedAt !== "string"
    || typeof value.deadlineAt !== "number"
    || !Number.isFinite(value.deadlineAt)
    || typeof value.requestFile !== "string"
    || typeof value.stdoutFile !== "string"
    || typeof value.stderrFile !== "string"
    || typeof value.statusFile !== "string"
    || typeof value.cancelFile !== "string"
    || (value.workerPid !== undefined && !isPositiveInteger(value.workerPid))
  ) throw invalidActiveRecord();
  return {
    version: 1,
    jobId: value.jobId,
    attempt,
    startedAt: value.startedAt,
    deadlineAt: value.deadlineAt,
    requestFile: value.requestFile,
    stdoutFile: value.stdoutFile,
    stderrFile: value.stderrFile,
    statusFile: value.statusFile,
    cancelFile: value.cancelFile,
    ...(value.workerPid === undefined ? {} : { workerPid: value.workerPid }),
  };
}

function invalidActiveRecord(): CliProviderError {
  return new CliProviderError(
    "workspace-error",
    "The recoverable AI run metadata is invalid.",
  );
}

function assertDurableActivePaths(
  handle: DurableProcessHandle,
  active: DurableActiveRecord,
): void {
  const path = loadDesktopCommonJsModule<typeof import("node:path")>(
    "node:path",
  );
  const prefix = `durable-${active.attempt}`;
  const expected = new Map<string, string>([
    ["request", path.join(handle.workspacePath, `${prefix}.request.json`)],
    ["stdout", path.join(handle.workspacePath, `${prefix}.stdout`)],
    ["stderr", path.join(handle.workspacePath, `${prefix}.stderr`)],
    ["status", path.join(handle.workspacePath, `${prefix}.status.json`)],
    ["cancel", path.join(handle.workspacePath, `${prefix}.cancel`)],
  ]);
  const actual = new Map<string, string>([
    ["request", active.requestFile],
    ["stdout", active.stdoutFile],
    ["stderr", active.stderrFile],
    ["status", active.statusFile],
    ["cancel", active.cancelFile],
  ]);
  for (const [label, expectedPath] of expected) {
    const actualPath = actual.get(label);
    if (
      actualPath === undefined
      || comparableRuntimePath(actualPath) !== comparableRuntimePath(expectedPath)
    ) {
      throw new CliProviderError(
        "workspace-error",
        `The recoverable AI ${label} file is outside its isolated workspace.`,
      );
    }
  }
}

async function readDurableStatus(
  filename: string,
): Promise<DurableStatusRecord | null> {
  let value: unknown;
  try {
    value = await readJsonFile(filename);
  } catch (error) {
    if (getNodeErrorCode(error) === "ENOENT") return null;
    // The worker replaces this file atomically. Treat one transient read as no
    // status so a concurrent rename cannot invalidate an otherwise healthy run.
    return null;
  }
  if (!isRecord(value)) return null;
  const phase = value.phase;
  if (phase !== "running" && phase !== "completed" && phase !== "failed") {
    return null;
  }
  const reason = value.reason;
  const allowedReason = reason === "cancelled"
    || reason === "timeout"
    || reason === "output-limit"
    || reason === "spawn-error";
  return {
    phase,
    ...(typeof value.exitCode === "number" && Number.isInteger(value.exitCode)
      ? { exitCode: value.exitCode }
      : {}),
    ...(allowedReason ? { reason } : {}),
    ...(typeof value.errorCode === "string" ? { errorCode: value.errorCode.slice(0, 80) } : {}),
    ...(typeof value.detail === "string" ? { detail: value.detail.slice(0, 1_000) } : {}),
    ...(isPositiveInteger(value.wrapperPid) ? { wrapperPid: value.wrapperPid } : {}),
    ...(isPositiveInteger(value.childPid) ? { childPid: value.childPid } : {}),
  };
}

async function readJsonFile(filename: string): Promise<unknown> {
  const { readFile } = loadDesktopCommonJsModule<
    typeof import("node:fs/promises")
  >("node:fs/promises");
  return JSON.parse(await readFile(filename, "utf8")) as unknown;
}

async function readFileDelta(
  filename: string,
  offset: number,
  maximumBytes: number,
): Promise<{ readonly bytes: Uint8Array; readonly nextOffset: number }> {
  const { open } = loadDesktopCommonJsModule<
    typeof import("node:fs/promises")
  >("node:fs/promises");
  let fileHandle: import("node:fs/promises").FileHandle | undefined;
  try {
    fileHandle = await open(filename, "r");
    const size = (await fileHandle.stat()).size;
    if (size > maximumBytes) {
      throw new CliProviderError(
        "process-failed",
        "The CLI produced more output than Practice Problem Generator permits.",
      );
    }
    if (size < offset) {
      throw new CliProviderError(
        "workspace-error",
        "Recoverable CLI output was truncated while it was being monitored.",
      );
    }
    const length = size - offset;
    if (length === 0) return { bytes: new Uint8Array(), nextOffset: offset };
    const bytes = Buffer.alloc(length);
    let bytesRead = 0;
    while (bytesRead < length) {
      const result = await fileHandle.read(
        bytes,
        bytesRead,
        length - bytesRead,
        offset + bytesRead,
      );
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    return {
      bytes: bytes.subarray(0, bytesRead),
      nextOffset: offset + bytesRead,
    };
  } catch (error) {
    if (getNodeErrorCode(error) === "ENOENT") {
      return { bytes: new Uint8Array(), nextOffset: offset };
    }
    throw error;
  } finally {
    await fileHandle?.close();
  }
}

async function atomicWriteJson(filename: string, value: unknown): Promise<void> {
  await atomicWriteText(filename, `${JSON.stringify(value)}\n`);
}

async function atomicWriteText(filename: string, content: string): Promise<void> {
  const { writeFile, rename, rm } = loadDesktopCommonJsModule<
    typeof import("node:fs/promises")
  >("node:fs/promises");
  const temporary = `${filename}.pending`;
  await writeFile(temporary, content, "utf8");
  await rm(filename, { force: true });
  await rename(temporary, filename);
}

async function terminateProcessTree(pid: number): Promise<void> {
  if (!isPositiveInteger(pid)) return;
  const { spawn } = loadDesktopCommonJsModule<
    typeof import("node:child_process")
  >("node:child_process");
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      });
      const timeout = setTimeout(() => {
        killer.kill();
        resolve();
      }, 3_000);
      const finish = (): void => {
        clearTimeout(timeout);
        resolve();
      };
      killer.once("error", finish);
      killer.once("close", finish);
    });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The helper already exited.
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return getNodeErrorCode(error) === "EPERM";
  }
}

function isDetachReason(reason: unknown): boolean {
  return reason instanceof Error && reason.name === "PracticeLabDetach";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function getNodeErrorCode(error: unknown): string | undefined {
  if (!isRecord(error) || typeof error.code !== "string") return undefined;
  return error.code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function comparableRuntimePath(value: string): string {
  const path = loadDesktopCommonJsModule<typeof import("node:path")>(
    "node:path",
  );
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

const DURABLE_WORKER_SOURCE = String.raw`"use strict";
const fs = require("node:fs");
const fsp = fs.promises;
const cp = require("node:child_process");

const requestFile = process.argv[2];

async function atomicWrite(filename, value) {
  const temporary = filename + ".pending";
  await fsp.writeFile(temporary, JSON.stringify(value) + "\n", "utf8");
  await fsp.rm(filename, { force: true });
  await fsp.rename(temporary, filename);
}

async function exists(filename) {
  try {
    await fsp.access(filename);
    return true;
  } catch {
    return false;
  }
}

async function terminate(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = cp.spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      });
      const timer = setTimeout(() => {
        killer.kill();
        resolve();
      }, 3000);
      const finish = () => {
        clearTimeout(timer);
        resolve();
      };
      killer.once("error", finish);
      killer.once("close", finish);
    });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
}

async function main() {
  const request = JSON.parse(await fsp.readFile(requestFile, "utf8"));
  await atomicWrite(request.statusFile, {
    phase: "running",
    wrapperPid: process.pid,
  });
  const providerEnv = { ...process.env, NO_COLOR: "1" };
  delete providerEnv.ELECTRON_RUN_AS_NODE;
  const inputFd = fs.openSync(request.stdinFile, "r");
  const stdoutFd = fs.openSync(request.stdoutFile, "w");
  const stderrFd = fs.openSync(request.stderrFile, "w");
  let child;
  try {
    child = cp.spawn(request.executable, request.args, {
      cwd: request.cwd,
      env: providerEnv,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: [inputFd, stdoutFd, stderrFd],
    });
  } catch (error) {
    fs.closeSync(inputFd);
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
    await atomicWrite(request.statusFile, {
      phase: "failed",
      reason: "spawn-error",
      errorCode: error && typeof error.code === "string" ? error.code : undefined,
      detail: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
      wrapperPid: process.pid,
    });
    return;
  }
  fs.closeSync(inputFd);
  fs.closeSync(stdoutFd);
  fs.closeSync(stderrFd);

  await atomicWrite(request.statusFile, {
    phase: "running",
    wrapperPid: process.pid,
    childPid: child.pid,
  });

  let reason;
  let spawnError;
  let checking = false;
  let monitorWork = Promise.resolve();
  const monitor = setInterval(() => {
    if (checking || reason !== undefined) return;
    checking = true;
    monitorWork = (async () => {
      try {
        const [stdoutStat, stderrStat] = await Promise.all([
          fsp.stat(request.stdoutFile),
          fsp.stat(request.stderrFile),
        ]);
        if (stdoutStat.size + stderrStat.size > request.maxOutputBytes) {
          reason = "output-limit";
          await terminate(child.pid);
          return;
        }
        if (await exists(request.cancelFile)) {
          const cancelValue = await fsp.readFile(request.cancelFile, "utf8");
          reason = cancelValue.trim() === "timeout" ? "timeout" : "cancelled";
          await terminate(child.pid);
          return;
        }
        if (Date.now() > request.deadlineAt) {
          reason = "timeout";
          await terminate(child.pid);
        }
      } catch (error) {
        spawnError = error;
        reason = "spawn-error";
        await terminate(child.pid);
      } finally {
        checking = false;
      }
    })();
  }, 200);

  child.once("error", (error) => {
    spawnError = error;
    reason = "spawn-error";
  });
  const exitCode = await new Promise((resolve) => {
    child.once("close", (code) => resolve(Number.isInteger(code) ? code : -1));
  });
  clearInterval(monitor);
  await monitorWork;

  if (reason !== undefined) {
    await atomicWrite(request.statusFile, {
      phase: "failed",
      exitCode,
      reason,
      errorCode: spawnError && typeof spawnError.code === "string" ? spawnError.code : undefined,
      detail: spawnError instanceof Error ? spawnError.message.slice(0, 1000) : undefined,
      wrapperPid: process.pid,
      childPid: child.pid,
    });
    return;
  }
  await atomicWrite(request.statusFile, {
    phase: "completed",
    exitCode,
    wrapperPid: process.pid,
    childPid: child.pid,
  });
}

main().catch(async (error) => {
  try {
    const request = JSON.parse(await fsp.readFile(requestFile, "utf8"));
    await atomicWrite(request.statusFile, {
      phase: "failed",
      reason: "spawn-error",
      errorCode: error && typeof error.code === "string" ? error.code : undefined,
      detail: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
      wrapperPid: process.pid,
    });
  } catch {}
  process.exitCode = 1;
});
`;

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
      const { mkdtemp } =
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
      return desktopWorkspaceAt(absolutePath);
    } catch (error) {
      throw new CliProviderError(
        "workspace-error",
        "Practice Problem Generator could not create its isolated temporary job.",
        { cause: error },
      );
    }
  }

  async openRecovery(handle: DurableProcessHandle): Promise<CliJobWorkspace> {
    await assertRecoveryWorkspace(handle);
    return desktopWorkspaceAt(handle.workspacePath);
  }
}

function desktopWorkspaceAt(absolutePath: string): CliJobWorkspace {
  const { writeFile, copyFile, rm, stat } = loadDesktopCommonJsModule<
    typeof import("node:fs/promises")
  >("node:fs/promises");
  const path = loadDesktopCommonJsModule<typeof import("node:path")>(
    "node:path",
  );
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
          const bytes = item.bytes instanceof Uint8Array
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
    async resolveExisting(filename) {
      assertFilename(filename);
      const destination = path.join(absolutePath, filename);
      try {
        if (!(await stat(destination)).isFile()) throw new Error("Not a file.");
      } catch (error) {
        throw new CliProviderError(
          "workspace-error",
          "A required recoverable AI input is no longer available.",
          { cause: error },
        );
      }
      return destination;
    },
    async openMedia(media: readonly MediaInput[]) {
      const reopened: NeutralMedia[] = [];
      for (const [index, item] of media.entries()) {
        const extension = neutralExtension(item);
        const filename = `media-${String(index + 1).padStart(3, "0")}${extension}`;
        assertFilename(filename);
        const destination = path.join(absolutePath, filename);
        try {
          if (!(await stat(destination)).isFile()) throw new Error("Not a file.");
        } catch (error) {
          throw new CliProviderError(
            "workspace-error",
            "A required recoverable AI media copy is no longer available.",
            { cause: error },
          );
        }
        reopened.push(
          item.mimeType === undefined
            ? { absolutePath: destination, filename }
            : { absolutePath: destination, filename, mimeType: item.mimeType },
        );
      }
      return reopened;
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
