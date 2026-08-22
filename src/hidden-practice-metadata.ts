export const HIDDEN_PRACTICE_METADATA_VERSION = 1 as const;

const HIDDEN_METADATA_START = "<!-- practice-problem-generator-metadata-v1";
const HIDDEN_METADATA_END = "-->";

export interface HiddenPracticeMetadataV1 {
  readonly schemaVersion: typeof HIDDEN_PRACTICE_METADATA_VERSION;
  readonly generationRecipe?: unknown;
  readonly generationRecipeCatalog?: unknown;
  readonly generationHistory?: unknown;
  readonly sourceImport?: unknown;
}

export type HiddenPracticeMetadataParseResult =
  | { readonly status: "missing" }
  | { readonly status: "invalid"; readonly message: string }
  | { readonly status: "ok"; readonly metadata: HiddenPracticeMetadataV1 };

const ALLOWED_KEYS = new Set<keyof HiddenPracticeMetadataV1>([
  "schemaVersion",
  "generationRecipe",
  "generationRecipeCatalog",
  "generationHistory",
  "sourceImport",
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function serializeHiddenPracticeMetadata(
  values: Omit<HiddenPracticeMetadataV1, "schemaVersion">,
): string | undefined {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return undefined;
  const metadata: HiddenPracticeMetadataV1 = {
    schemaVersion: HIDDEN_PRACTICE_METADATA_VERSION,
    ...Object.fromEntries(entries),
  };
  const json = JSON.stringify(metadata);
  if (json === undefined) {
    throw new Error("Practice Problem Generator metadata could not be serialized.");
  }
  const commentSafeJson = json.replace(/-/gu, "\\u002d");
  return `${HIDDEN_METADATA_START}\n${commentSafeJson}\n${HIDDEN_METADATA_END}`;
}

export function parseHiddenPracticeMetadata(
  markdown: string,
): HiddenPracticeMetadataParseResult {
  const normalized = markdown.replace(/\r\n?/gu, "\n");
  const expression = /(?:^|\n)<!-- practice-problem-generator-metadata-v1\n([\s\S]*?)\n-->(?=\n|$)/gu;
  const matches = [...normalized.matchAll(expression)];
  if (matches.length === 0) return { status: "missing" };
  if (matches.length !== 1) {
    return {
      status: "invalid",
      message: "The note contains more than one hidden Practice Problem Generator metadata block.",
    };
  }
  try {
    const value = JSON.parse(matches[0]?.[1] ?? "") as unknown;
    if (
      !isRecord(value)
      || value.schemaVersion !== HIDDEN_PRACTICE_METADATA_VERSION
      || Object.keys(value).some((key) => !ALLOWED_KEYS.has(key as keyof HiddenPracticeMetadataV1))
    ) {
      throw new Error("Unsupported hidden metadata shape.");
    }
    return {
      status: "ok",
      metadata: structuredClone(value) as unknown as HiddenPracticeMetadataV1,
    };
  } catch {
    return {
      status: "invalid",
      message: "The hidden Practice Problem Generator metadata is malformed or unsupported.",
    };
  }
}
