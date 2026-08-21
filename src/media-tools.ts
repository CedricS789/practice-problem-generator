import type { GifFramePositionV1 } from "./model";

export interface SampledFrame {
  timeSeconds: number;
  bytes: ArrayBuffer;
  mimeType: "image/png";
  label: string;
  position?: GifFramePositionV1;
}

export interface MediaToolOptions {
  ffmpegExecutable: string;
  ffprobeExecutable: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export function gifFrameAtPosition(
  frames: readonly SampledFrame[],
  position: GifFramePositionV1,
): SampledFrame {
  const frame = frames.find((candidate) => candidate.position === position);
  if (frame === undefined) {
    throw new Error(`The ${position} GIF frame is unavailable.`);
  }
  return frame;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
}

interface DesktopMediaModules {
  fs: typeof import("node:fs/promises");
  os: typeof import("node:os");
  path: typeof import("node:path");
  spawn: typeof import("node:child_process").spawn;
}

export async function sampleAnimatedFrames(
  sourceBytes: ArrayBuffer,
  extension: "gif" | "mp4",
  options: MediaToolOptions,
  count = 6
): Promise<SampledFrame[]> {
  const boundedCount = Math.min(12, Math.max(2, Math.round(count)));
  return withMediaJob(async ({ directory, fs, path }) => {
    const input = path.join(directory, `source.${extension}`);
    await fs.writeFile(input, Buffer.from(sourceBytes));
    const probe = await runMediaProcess(
      options.ffprobeExecutable,
      ["-v", "error", "-show_entries", "format=duration", "-of", "json", input],
      options
    );
    const duration = parseDuration(probe.stdout);
    const gifPositions: readonly GifFramePositionV1[] | undefined =
      extension === "gif" && boundedCount === 3
        ? ["first", "middle", "last"]
        : undefined;
    const times = gifPositions === undefined
      ? Array.from({ length: boundedCount }, (_, index) => (
          duration === 0 ? 0 : Math.max(0, (duration * index) / boundedCount)
        ))
      : await exactGifPositionTimes(input, duration, options);
    const frames: SampledFrame[] = [];
    for (const [index, time] of times.entries()) {
      const output = path.join(directory, `frame-${String(index + 1).padStart(2, "0")}.png`);
      await runMediaProcess(
        options.ffmpegExecutable,
        ["-hide_banner", "-loglevel", "error", "-ss", time.toFixed(3), "-i", input, "-frames:v", "1", "-y", output],
        options
      );
      const buffer = await fs.readFile(output);
      const position = gifPositions?.[index];
      frames.push({
        timeSeconds: time,
        bytes: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        mimeType: "image/png",
        label: position === undefined
          ? `${time.toFixed(1)} s`
          : `${position.charAt(0).toUpperCase()}${position.slice(1)} · ${time.toFixed(1)} s`,
        ...(position === undefined ? {} : { position })
      });
    }
    return frames;
  });
}

export async function extractSelectedFrame(
  sourceBytes: ArrayBuffer,
  extension: "gif" | "mp4",
  timeSeconds: number,
  options: MediaToolOptions
): Promise<ArrayBuffer> {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) throw new Error("Frame time must be non-negative.");
  return withMediaJob(async ({ directory, fs, path }) => {
    const input = path.join(directory, `source.${extension}`);
    const output = path.join(directory, "selected-frame.png");
    await fs.writeFile(input, Buffer.from(sourceBytes));
    await runMediaProcess(
      options.ffmpegExecutable,
      ["-hide_banner", "-loglevel", "error", "-ss", timeSeconds.toFixed(3), "-i", input, "-frames:v", "1", "-y", output],
      options
    );
    const buffer = await fs.readFile(output);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  });
}

async function withMediaJob<T>(
  operation: (job: {
    directory: string;
    fs: typeof import("node:fs/promises");
    path: typeof import("node:path");
  }) => Promise<T>
): Promise<T> {
  const { fs, os, path } = loadDesktopMediaModules();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "practice-lab-media-"));
  try {
    return await operation({ directory, fs, path });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function runMediaProcess(
  executable: string,
  args: string[],
  options: MediaToolOptions
): Promise<ProcessResult> {
  if (!executable.trim()) throw new Error("Media executable is not configured.");
  const { spawn } = loadDesktopMediaModules();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    };
    const cancel = (): void => {
      child.kill();
      finish(new Error("Media extraction was cancelled."));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("Media extraction timed out."));
    }, options.timeoutMs ?? 60_000);
    options.signal?.addEventListener("abort", cancel, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => finish(new Error(`Could not start ${executable}: ${error.message}`)));
    child.once("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(`${executable} exited with code ${code ?? "unknown"}: ${stderr.trim() || "no diagnostic"}`));
    });
  });
}

function loadDesktopMediaModules(): DesktopMediaModules {
  if (typeof require !== "function") {
    throw new Error("Media extraction is available only in Obsidian Desktop.");
  }
  return {
    fs: require("node:fs/promises") as typeof import("node:fs/promises"),
    os: require("node:os") as typeof import("node:os"),
    path: require("node:path") as typeof import("node:path"),
    spawn: (require("node:child_process") as typeof import("node:child_process")).spawn
  };
}

function parseDuration(stdout: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("FFprobe returned malformed JSON.");
  }
  const duration = Number((parsed as { format?: { duration?: unknown } }).format?.duration);
  if (!Number.isFinite(duration) || duration < 0) throw new Error("FFprobe did not report a valid duration.");
  return duration;
}

async function exactGifPositionTimes(
  input: string,
  duration: number,
  options: MediaToolOptions,
): Promise<readonly [number, number, number]> {
  const probe = await runMediaProcess(
    options.ffprobeExecutable,
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "frame=best_effort_timestamp_time",
      "-of", "json",
      input,
    ],
    options,
  );
  const frameTimes = parseFrameTimes(probe.stdout);
  if (frameTimes.length > 0) {
    return [
      frameTimes[0] ?? 0,
      frameTimes[Math.floor((frameTimes.length - 1) / 2)] ?? 0,
      frameTimes.at(-1) ?? 0,
    ];
  }
  return [0, duration / 2, duration === 0 ? 0 : duration * 0.9];
}

function parseFrameTimes(stdout: string): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const frames = (parsed as { frames?: unknown }).frames;
  if (!Array.isArray(frames)) return [];
  return frames
    .map((frame) => Number(
      typeof frame === "object" && frame !== null
        ? (frame as { best_effort_timestamp_time?: unknown }).best_effort_timestamp_time
        : Number.NaN,
    ))
    .filter((time) => Number.isFinite(time) && time >= 0);
}
