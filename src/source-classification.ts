import type {
  SourceMaterialClassificationStateV1,
  SourceMaterialClassificationV1,
} from "./model";

export interface SourceClassificationSelectionV1 {
  readonly classification: SourceMaterialClassificationV1;
  readonly classificationState: SourceMaterialClassificationStateV1;
}

export interface ClassifiableSourceV1 {
  readonly mode: "note" | "selection" | "pdf";
  readonly path: string;
  readonly title: string;
  readonly classification?: SourceMaterialClassificationV1;
  readonly classificationState?: SourceMaterialClassificationStateV1;
}

export interface SourceClassificationRulesV1 {
  readonly officialCorrection: readonly string[];
  readonly instructorMaterial: readonly string[];
  readonly assignedReference: readonly string[];
  readonly personalNote: readonly string[];
}

export const DEFAULT_SOURCE_CLASSIFICATION_RULES: SourceClassificationRulesV1 = {
  officialCorrection: [
    "answer key",
    "corrige",
    "corrigé",
    "mark scheme",
    "official correction",
    "solution",
  ],
  instructorMaterial: [
    "course material",
    "exam",
    "handout",
    "instructor",
    "lecture",
    "professor",
    "slide",
    "syllabus",
    "teacher",
  ],
  assignedReference: [
    "assigned reference",
    "book",
    "manual",
    "reference",
    "textbook",
  ],
  personalNote: ["my notes", "personal note", "notes"],
};

export function sourceClassificationSelection(
  source: ClassifiableSourceV1,
): SourceClassificationSelectionV1 {
  if (
    source.classification !== undefined
    && source.classificationState !== undefined
  ) {
    return {
      classification: source.classification,
      classificationState: source.classificationState,
    };
  }
  return suggestSourceClassification(source);
}

export function suggestSourceClassification(input: {
  readonly mode: ClassifiableSourceV1["mode"];
  readonly path: string;
  readonly title: string;
  readonly tags?: readonly string[];
  readonly rules?: SourceClassificationRulesV1;
}): SourceClassificationSelectionV1 {
  const searchable = normalizeClassificationText([
    input.path,
    input.title,
    ...(input.tags ?? []),
  ].join(" "));
  const rules = input.rules ?? DEFAULT_SOURCE_CLASSIFICATION_RULES;
  let classification: SourceMaterialClassificationV1;
  if (matchesConfiguredRule(searchable, rules.officialCorrection)) {
    classification = "official-correction";
  } else if (matchesConfiguredRule(searchable, rules.instructorMaterial)) {
    classification = "instructor-material";
  } else if (matchesConfiguredRule(searchable, rules.assignedReference)) {
    classification = "assigned-reference";
  } else if (matchesConfiguredRule(searchable, rules.personalNote)) {
    classification = "personal-note";
  } else if (input.mode === "note" || input.mode === "selection") {
    classification = "personal-note";
  } else {
    classification = "unclassified";
  }
  return { classification, classificationState: "suggested" };
}

export function normalizeSourceClassificationRules(
  value: unknown,
): SourceClassificationRulesV1 {
  const record = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
  return {
    officialCorrection: normalizedMatchers(
      record.officialCorrection,
      DEFAULT_SOURCE_CLASSIFICATION_RULES.officialCorrection,
    ),
    instructorMaterial: normalizedMatchers(
      record.instructorMaterial,
      DEFAULT_SOURCE_CLASSIFICATION_RULES.instructorMaterial,
    ),
    assignedReference: normalizedMatchers(
      record.assignedReference,
      DEFAULT_SOURCE_CLASSIFICATION_RULES.assignedReference,
    ),
    personalNote: normalizedMatchers(
      record.personalNote,
      DEFAULT_SOURCE_CLASSIFICATION_RULES.personalNote,
    ),
  };
}

export function copySourceClassificationRules(
  value: SourceClassificationRulesV1,
): SourceClassificationRulesV1 {
  return {
    officialCorrection: [...value.officialCorrection],
    instructorMaterial: [...value.instructorMaterial],
    assignedReference: [...value.assignedReference],
    personalNote: [...value.personalNote],
  };
}

function matchesConfiguredRule(searchable: string, values: readonly string[]): boolean {
  return values.some((value) => {
    const matcher = normalizeClassificationText(value).trim();
    return matcher.length > 0 && searchable.includes(matcher);
  });
}

function normalizedMatchers(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const result = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index)
    .slice(0, 100);
  return result;
}

function normalizeClassificationText(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}
