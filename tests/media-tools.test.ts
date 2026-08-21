import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";
import test, { after } from "node:test";
import { build } from "esbuild";
import {
  extractSelectedFrame,
  gifFrameAtPosition,
  sampleAnimatedFrames,
} from "../src/media-tools";

const execFileAsync = promisify(execFile);
const testGlobal = globalThis as typeof globalThis & { require?: NodeRequire };
const previousRequire = testGlobal.require;
testGlobal.require = createRequire(import.meta.url);
after(() => {
  if (previousRequire) testGlobal.require = previousRequire;
  else delete testGlobal.require;
});

async function syntheticMedia(): Promise<{
  root: string;
  gif: Buffer;
  mp4: Buffer;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "practice-lab-synthetic-"));
  const gifPath = path.join(root, "large.gif");
  const mp4Path = path.join(root, "clip.mp4");
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=size=820x670:rate=12:duration=1.2",
    "-vf", "fps=12", "-y", gifPath
  ]);
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=12:duration=1.2",
    "-c:v", "mpeg4", "-y", mp4Path
  ]);
  return { root, gif: await readFile(gifPath), mp4: await readFile(mp4Path) };
}

function asArrayBuffer(buffer: Buffer): ArrayBuffer {
  return Uint8Array.from(buffer).buffer;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function assertPng(bytes: ArrayBuffer): void {
  assert.deepEqual([...new Uint8Array(bytes).slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
}

test("samples a large animated GIF without changing the original bytes", async () => {
  const media = await syntheticMedia();
  try {
    const originalHash = sha256(media.gif);
    const frames = await sampleAnimatedFrames(asArrayBuffer(media.gif), "gif", {
      ffmpegExecutable: "ffmpeg",
      ffprobeExecutable: "ffprobe"
    }, 3);
    assert.equal(frames.length, 3);
    assert.deepEqual(frames.map((frame) => frame.position), [
      "first",
      "middle",
      "last",
    ]);
    assert.deepEqual(frames.map((frame) => frame.label.split(" · ")[0]), [
      "First",
      "Middle",
      "Last",
    ]);
    assert.ok(frames[1]!.timeSeconds > frames[0]!.timeSeconds);
    assert.ok(frames[2]!.timeSeconds > frames[0]!.timeSeconds);
    assert.equal(gifFrameAtPosition(frames, "middle"), frames[1]);
    assert.throws(
      () => gifFrameAtPosition(frames.slice(0, 1), "last"),
      /last GIF frame is unavailable/u,
    );
    for (const frame of frames) assertPng(frame.bytes);
    assert.equal(sha256(media.gif), originalHash);
  } finally {
    await rm(media.root, { recursive: true, force: true });
  }
});

test("samples and extracts an explicit MP4 frame without changing the video", async () => {
  const media = await syntheticMedia();
  try {
    const originalHash = sha256(media.mp4);
    const frames = await sampleAnimatedFrames(asArrayBuffer(media.mp4), "mp4", {
      ffmpegExecutable: "ffmpeg",
      ffprobeExecutable: "ffprobe"
    }, 4);
    assert.equal(frames.length, 4);
    const selected = await extractSelectedFrame(asArrayBuffer(media.mp4), "mp4", frames[1]!.timeSeconds, {
      ffmpegExecutable: "ffmpeg",
      ffprobeExecutable: "ffprobe"
    });
    assertPng(selected);
    assert.equal(sha256(media.mp4), originalHash);
  } finally {
    await rm(media.root, { recursive: true, force: true });
  }
});

test("media extraction fails closed for invalid time and missing tools", async () => {
  await assert.rejects(
    () => extractSelectedFrame(new ArrayBuffer(1), "mp4", -1, {
      ffmpegExecutable: "ffmpeg",
      ffprobeExecutable: "ffprobe"
    }),
    /non-negative/
  );
  await assert.rejects(
    () => sampleAnimatedFrames(new ArrayBuffer(1), "gif", {
      ffmpegExecutable: "missing-practice-lab-ffmpeg",
      ffprobeExecutable: "missing-practice-lab-ffprobe",
      timeoutMs: 1_000
    }),
    /Could not start|ENOENT/
  );
});

test("desktop media modules compile to lazy CommonJS loads", async () => {
  const result = await build({
    entryPoints: [path.resolve("src/media-tools.ts")],
    bundle: true,
    external: ["node:*"],
    format: "cjs",
    platform: "node",
    target: "es2022",
    write: false
  });
  const bundle = result.outputFiles[0]?.text ?? "";
  assert.doesNotMatch(bundle, /import\(["']node:/u);
  for (const moduleName of ["fs/promises", "os", "path", "child_process"]) {
    assert.match(bundle, new RegExp(`require\\(["']node:${moduleName.replace("/", "\\/")}["]\\)`));
  }
  const module = { exports: {} };
  assert.doesNotThrow(() => runInNewContext(bundle, {
    exports: module.exports,
    module,
    require: (specifier: string): never => {
      throw new Error(`Node module loaded during initial evaluation: ${specifier}`);
    }
  }));
});
