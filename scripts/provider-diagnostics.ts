import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createCliProviderLayer, type ProviderId } from "../src/cli/index";
import { generationDraftV1JsonSchema, validateGenerationDraft } from "../src/schema";

const execFileAsync = promisify(execFile);
const layer = createCliProviderLayer();
const detections = await layer.detectAll();
const schema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  additionalProperties: false,
  required: ["segmentId", "derivedValue", "observedColor"],
  properties: {
    segmentId: { type: "string", const: "seg-synthetic" },
    derivedValue: { type: "integer", const: 4 },
    observedColor: { type: "string", const: "red" }
  }
} as const;
const { stdout: png } = await execFileAsync("ffmpeg", [
  "-hide_banner", "-loglevel", "error",
  "-f", "lavfi", "-i", "color=c=red:size=32x32:duration=0.1",
  "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"
], { encoding: "buffer", maxBuffer: 2_000_000 });

const prompt = [
  "This is a synthetic Grounded Problems diagnostic; it contains no authored vault content.",
  "Segment seg-synthetic states that two plus two equals four.",
  "Inspect the attached synthetic solid-color PNG.",
  "Return segmentId seg-synthetic, derivedValue 4, and observedColor red."
].join("\n");
const practicePrompt = [
  "This is a synthetic Grounded Problems schema diagnostic; it contains no authored vault content.",
  "Create exactly one short-answer exercise from segment seg-synthetic.",
  "Segment seg-synthetic states: In this synthetic relation, alpha causes beta.",
  "Ask for the effect, ground the answer as beta, and populate every required short-answer field.",
  "Return only the JSON object required by the supplied schema."
].join("\n");
const rows: Array<Record<string, unknown>> = [];
const requestedProvider = process.env.PRACTICE_LAB_DIAGNOSTIC_PROVIDER as ProviderId | undefined;

for (const detection of detections.filter((item) => requestedProvider === undefined || item.id === requestedProvider)) {
  const provider = detection.id as ProviderId;
  if (!detection.available) {
    rows.push({ provider, status: "unavailable", detail: detection.detail });
    continue;
  }
  if (detection.capabilities.vision !== "supported") {
    try {
      const textResult = await layer.coordinator.generate(layer.adapters[provider], {
        prompt: practicePrompt,
        schema: generationDraftV1JsonSchema,
        validate: (value) => validateGenerationDraft(value, {
          segmentIds: ["seg-synthetic"],
          visualIds: []
        }),
        timeoutMs: 180_000
      });
      rows.push({
        provider,
        status: "text-passed",
        version: detection.version,
        vision: detection.capabilities.vision,
        practiceSchemaAttempts: textResult.attempts
      });
    } catch (error) {
      rows.push({
        provider,
        status: "text-failed",
        version: detection.version,
        vision: detection.capabilities.vision,
        detail: typeof error === "object" && error !== null && "detail" in error && typeof error.detail === "string"
          ? error.detail
          : error instanceof Error ? error.message : String(error)
      });
    }
    continue;
  }
  try {
    const result = await layer.coordinator.generate(layer.adapters[provider], {
      prompt,
      schema,
      validate: (value) => ({
        valid: typeof value === "object" && value !== null
          && (value as Record<string, unknown>).segmentId === "seg-synthetic"
          && (value as Record<string, unknown>).derivedValue === 4
          && String((value as Record<string, unknown>).observedColor).toLowerCase() === "red"
      }),
      media: [{ bytes: Uint8Array.from(png), mimeType: "image/png" }],
      timeoutMs: 180_000
    });
    const practiceResult = await layer.coordinator.generate(layer.adapters[provider], {
      prompt: practicePrompt,
      schema: generationDraftV1JsonSchema,
      validate: (value) => validateGenerationDraft(value, {
        segmentIds: ["seg-synthetic"],
        visualIds: []
      }),
      timeoutMs: 180_000
    });
    rows.push({
      provider,
      status: "passed",
      version: detection.version,
      attempts: result.attempts,
      practiceSchemaAttempts: practiceResult.attempts
    });
  } catch (error) {
    rows.push({
      provider,
      status: "failed",
      version: detection.version,
      detail: typeof error === "object" && error !== null && "detail" in error && typeof error.detail === "string"
        ? error.detail
        : error instanceof Error ? error.message : String(error)
    });
  }
}

process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
