import assert from "node:assert/strict";
import test from "node:test";

import {
  isGifVisual,
  selectAllVisuals,
} from "../src/ui/visual-selection";
import { normalizeGifFrameDefault } from "../src/settings-values";
import type { DetectedVisual } from "../src/visuals";

function visual(
  id: string,
  kind: DetectedVisual["kind"],
  state: DetectedVisual["state"],
  overrides: Partial<DetectedVisual> = {},
): DetectedVisual {
  return {
    id,
    kind,
    state,
    start: 0,
    end: 10,
    selected: false,
    ...overrides,
  };
}

test("select all chooses ready images and resolves GIFs with the configured default", async () => {
  const input: readonly DetectedVisual[] = [
    visual("static", "static-image", "ready", {
      resolvedPath: "_Vault/Attachments/static.png",
    }),
    visual("gif", "animated-gif", "frame-required", {
      resolvedPath: "_Vault/Attachments/animation.gif",
      mimeType: "image/gif",
    }),
    visual("video", "video", "frame-required", {
      resolvedPath: "_Vault/Attachments/video.mp4",
    }),
    visual("remote", "remote-image", "consent-required"),
  ];
  const original = structuredClone(input);
  const calls: Array<readonly [string, string]> = [];

  const result = await selectAllVisuals(
    input,
    "last",
    async (candidate, position) => {
      calls.push([candidate.id, position]);
      return {
        ...candidate,
        state: "ready",
        selected: true,
        resolvedPath: "_Vault/Attachments/Practice Problem Generator/frame.png",
        ...(candidate.resolvedPath === undefined
          ? {}
          : { frameSourcePath: candidate.resolvedPath }),
        framePosition: position,
        frameTimeSeconds: 1.2,
        mimeType: "image/png",
      };
    },
  );

  assert.deepEqual(calls, [["gif", "last"]]);
  assert.equal(result.selectedCount, 2);
  assert.equal(result.skippedCount, 2);
  assert.deepEqual(result.failures, []);
  assert.equal(result.visuals[0]?.selected, true);
  assert.equal(result.visuals[1]?.framePosition, "last");
  assert.equal(result.visuals[2]?.selected, false);
  assert.equal(result.visuals[3]?.selected, false);
  assert.deepEqual(input, original, "bulk selection must not mutate detected visuals");
});

test("bulk GIF failures are isolated and remote GIF snapshots remain recognizable", async () => {
  const remoteGif = visual("remote-gif", "remote-image", "frame-required", {
    mimeType: "image/gif",
  });
  assert.equal(isGifVisual(remoteGif), true);
  const result = await selectAllVisuals(
    [remoteGif, visual("ready", "notability-region", "ready")],
    "middle",
    async () => {
      throw new Error("synthetic extraction failure");
    },
  );
  assert.equal(result.selectedCount, 1);
  assert.equal(result.skippedCount, 1);
  assert.deepEqual(result.failures, [
    { visualId: "remote-gif", message: "synthetic extraction failure" },
  ]);
});

test("GIF defaults migrate to middle and preserve supported choices", () => {
  assert.equal(normalizeGifFrameDefault(undefined), "middle");
  assert.equal(normalizeGifFrameDefault("unexpected"), "middle");
  assert.equal(normalizeGifFrameDefault("first"), "first");
  assert.equal(normalizeGifFrameDefault("middle"), "middle");
  assert.equal(normalizeGifFrameDefault("last"), "last");
});
