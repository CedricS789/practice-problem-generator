import assert from "node:assert/strict";
import test from "node:test";

import {
  applySelectedVisualFrame,
  acceptRemoteSnapshot,
  detectVisuals,
  setVisualSelected,
  validateOcclusionMasks,
  type DetectedVisual,
} from "../src/visuals";

test("detectVisuals classifies local media, remote images, and Notability regions", () => {
  const markdown = [
    "![[diagram.png|640]]",
    "![[animation.gif]]",
    "![clip](media/demo.mp4)",
    "![reference](https://images.example.edu/plot.png)",
    "```notability-region",
    JSON.stringify({
      v: 1,
      id: "nr-example",
      title: "Lecture notes",
      page: 7,
      rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    }),
    "```",
  ].join("\n");
  const requestedTargets: string[] = [];
  const visuals = detectVisuals(markdown, {
    resolveLocal: (target) => {
      requestedTargets.push(target);
      return {
        exists: true,
        path: `vault://${target}`,
        previewUrl: `app://preview/${target}`,
      };
    },
    resolveNotability: (region) => ({ cachePath: `cache://${region.regionId}.png` }),
  });

  assert.deepEqual(requestedTargets, ["diagram.png", "animation.gif", "media/demo.mp4"]);
  assert.deepEqual(
    visuals.map((visual) => [visual.kind, visual.state]),
    [
      ["static-image", "ready"],
      ["animated-gif", "frame-required"],
      ["video", "frame-required"],
      ["remote-image", "consent-required"],
      ["notability-region", "ready"],
    ],
  );
  assert.equal(visuals[3]?.remoteHost, "images.example.edu");
  assert.equal(visuals[0]?.previewUrl, "app://preview/diagram.png");
  assert.deepEqual(visuals[4]?.region?.rect, {
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
  });
});

test("missing local files and Notability caches stay unselectable", () => {
  const markdown = [
    "![[missing.png]]",
    "```notability-region",
    '{"v":1,"id":"nr-missing"}',
    "```",
  ].join("\n");
  const visuals = detectVisuals(markdown, {
    resolveLocal: () => ({ exists: false }),
    resolveNotability: () => null,
  });

  assert.equal(visuals[0]?.state, "missing");
  assert.equal(visuals[0]?.selected, false);
  assert.match(visuals[0]?.reason ?? "", /could not be resolved/u);
  assert.equal(visuals[1]?.state, "cache-missing");
  assert.equal(visuals[1]?.selected, false);
});

test("malformed Notability blocks become explicit invalid records", () => {
  const malformedJson = detectVisuals("```notability-region\n{nope}\n```");
  assert.equal(malformedJson.length, 1);
  assert.equal(malformedJson[0]?.state, "invalid");

  const wrongVersion = detectVisuals(
    '```notability-region\n{"v":2,"id":"later"}\n```',
  );
  assert.equal(wrongVersion[0]?.state, "invalid");
});

test("unsupported embeds and ordinary links are ignored", () => {
  const markdown = [
    "[[diagram.png]]",
    "![[lecture.pdf]]",
    "[image](diagram.png)",
    "![unsupported](archive.zip)",
  ].join("\n");
  assert.deepEqual(detectVisuals(markdown), []);
});

test("selection and remote acceptance helpers do not mutate their inputs", () => {
  const input = Object.freeze([
    Object.freeze({
      id: "remote",
      kind: "remote-image",
      state: "consent-required",
      start: 0,
      end: 10,
      selected: false,
      remoteUrl: "https://example.test/image.png",
      remoteHost: "example.test",
      reason: "Consent required",
    } satisfies DetectedVisual),
  ]);

  const selected = setVisualSelected(input, "remote", true);
  assert.equal(selected[0]?.selected, true);
  assert.equal(input[0]?.selected, false);

  const accepted = acceptRemoteSnapshot(input, "remote", "snapshot.png");
  assert.equal(accepted[0]?.state, "ready");
  assert.equal(accepted[0]?.selected, true);
  assert.equal(accepted[0]?.resolvedPath, "snapshot.png");
  assert.equal(input[0]?.state, "consent-required");
});

test("changing a GIF frame always reuses the original animation", () => {
  const original = {
    id: "gif",
    kind: "animated-gif",
    state: "frame-required",
    start: 0,
    end: 10,
    selected: false,
    resolvedPath: "_Vault/Attachments/animation.gif",
    mimeType: "image/gif",
  } satisfies DetectedVisual;
  const defaultFrame = applySelectedVisualFrame(original, {
    snapshotPath: "_Vault/Attachments/Practice Problem Generator/middle.png",
    previewUrl: "app://middle",
    timeSeconds: 0.6,
    position: "middle",
    label: "Middle · 0.6 s",
    usingDefault: true,
  });
  assert.equal(defaultFrame.frameSourcePath, original.resolvedPath);
  assert.equal(defaultFrame.resolvedPath, "_Vault/Attachments/Practice Problem Generator/middle.png");
  assert.equal(defaultFrame.reason, "Using default Middle · 0.6 s");

  const override = applySelectedVisualFrame(defaultFrame, {
    snapshotPath: "_Vault/Attachments/Practice Problem Generator/last.png",
    previewUrl: "app://last",
    timeSeconds: 1.2,
    position: "last",
    label: "Last · 1.2 s",
    usingDefault: false,
  });
  assert.equal(override.frameSourcePath, original.resolvedPath);
  assert.equal(override.framePosition, "last");
  assert.equal(override.resolvedPath, "_Vault/Attachments/Practice Problem Generator/last.png");
  assert.equal(override.reason, "Selected Last · 1.2 s");
});

test("mask validation rejects bounds, blank labels, and duplicate ids", () => {
  const invalid = validateOcclusionMasks([
    { id: "same", label: "", answer: "A", x: 0.9, y: 0.1, width: 0.2, height: 0.2 },
    { id: "same", label: "Second", answer: "", x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    { id: "tiny", label: "Tiny", answer: "C", x: 0.1, y: 0.1, width: 0.01, height: 0.2 },
  ]);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors.length, 5);
  assert.match(invalid.errors.join(" "), /no label/u);
  assert.match(invalid.errors.join(" "), /outside normalized/u);
  assert.match(invalid.errors.join(" "), /duplicates id/u);
  assert.match(invalid.errors.join(" "), /no answer/u);

  assert.deepEqual(
    validateOcclusionMasks([
      { id: "one", label: "Node A", answer: "A", x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    ]),
    { valid: true, errors: [] },
  );
});

test("mask validation rejects malformed LaTeX without rejecting valid math", () => {
  const invalid = validateOcclusionMasks([
    {
      id: "voltage",
      label: "Voltage $V_{out}",
      answer: "$V_{out}=A_vV_{in}$",
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.2,
    },
  ]);
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join(" "), /label LaTeX: Unclosed inline/iu);

  assert.deepEqual(
    validateOcclusionMasks([
      {
        id: "voltage",
        label: "Voltage $V_{out}$",
        answer: "$V_{out}=A_vV_{in}$",
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.2,
      },
    ]),
    { valid: true, errors: [] },
  );
});
