import type { ExerciseV1 } from "./model";

export type LatexMarkupSegment =
  | {
      readonly kind: "text";
      readonly value: string;
      readonly start: number;
      readonly end: number;
    }
  | {
      readonly kind: "math";
      readonly value: string;
      readonly display: boolean;
      readonly start: number;
      readonly end: number;
    };

export type LatexMarkupParseResult =
  | { readonly ok: true; readonly segments: readonly LatexMarkupSegment[] }
  | { readonly ok: false; readonly problem: string; readonly index: number };

const ALTERNATE_MATH_DELIMITERS = ["\\(", "\\)", "\\[", "\\]"] as const;

/**
 * Parse the canonical Obsidian math form used by generated exercises.
 * Plain text remains text; inline math uses $...$ and display math uses $$...$$.
 */
export function parseLatexMarkup(value: string): LatexMarkupParseResult {
  for (const delimiter of ALTERNATE_MATH_DELIMITERS) {
    const index = firstUnescapedToken(value, delimiter);
    if (index >= 0) {
      return {
        ok: false,
        problem: `Use $...$ or $$...$$ instead of ${delimiter}.`,
        index,
      };
    }
  }

  const segments: LatexMarkupSegment[] = [];
  let cursor = 0;
  let textStart = 0;
  while (cursor < value.length) {
    if (value[cursor] !== "$" || isEscaped(value, cursor)) {
      cursor += 1;
      continue;
    }

    const display = value[cursor + 1] === "$";
    const delimiterLength = display ? 2 : 1;
    if (cursor > textStart) {
      segments.push({
        kind: "text",
        value: unescapeLiteralDollars(value.slice(textStart, cursor)),
        start: textStart,
        end: cursor,
      });
    }
    const openingIndex = cursor;
    const contentStart = cursor + delimiterLength;
    cursor = contentStart;
    let closingIndex = -1;
    while (cursor < value.length) {
      const character = value[cursor];
      if (!display && (character === "\n" || character === "\r")) {
        return {
          ok: false,
          problem: "Inline LaTeX cannot span multiple lines; use $$...$$ for a display equation.",
          index: openingIndex,
        };
      }
      if (character !== "$" || isEscaped(value, cursor)) {
        cursor += 1;
        continue;
      }
      const doubleDollar = value[cursor + 1] === "$";
      if (display && !doubleDollar) {
        return {
          ok: false,
          problem: "A display equation contains an unescaped single $ delimiter.",
          index: cursor,
        };
      }
      if (!display && doubleDollar) {
        return {
          ok: false,
          problem: "Close inline LaTeX with one $ before starting a display equation.",
          index: cursor,
        };
      }
      closingIndex = cursor;
      break;
    }
    if (closingIndex < 0) {
      return {
        ok: false,
        problem: `Unclosed ${display ? "display" : "inline"} LaTeX delimiter.`,
        index: openingIndex,
      };
    }

    const content = value.slice(contentStart, closingIndex);
    if (content.trim().length === 0) {
      return {
        ok: false,
        problem: "LaTeX delimiters cannot be empty.",
        index: openingIndex,
      };
    }
    const braceProblem = latexBraceProblem(content);
    if (braceProblem !== null) {
      return {
        ok: false,
        problem: braceProblem.problem,
        index: contentStart + braceProblem.index,
      };
    }
    const end = closingIndex + delimiterLength;
    segments.push({
      kind: "math",
      value: content,
      display,
      start: openingIndex,
      end,
    });
    cursor = end;
    textStart = cursor;
  }

  if (textStart < value.length) {
    segments.push({
      kind: "text",
      value: unescapeLiteralDollars(value.slice(textStart)),
      start: textStart,
      end: value.length,
    });
  }
  return { ok: true, segments };
}

export function latexMarkupProblem(value: string): string | null {
  const result = parseLatexMarkup(value);
  return result.ok ? null : result.problem;
}

export function hasLatexMarkup(value: string): boolean {
  const result = parseLatexMarkup(value);
  return result.ok && result.segments.some((segment) => segment.kind === "math");
}

export function offsetIsInsideLatexMath(value: string, offset: number): boolean {
  const result = parseLatexMarkup(value);
  return result.ok && result.segments.some(
    (segment) =>
      segment.kind === "math"
      && offset > segment.start
      && offset < segment.end,
  );
}

/** Validate every learner-visible generated string before provider output is accepted. */
export function exerciseLatexMarkupProblems(
  exercise: ExerciseV1,
  exerciseIndex: number,
): string[] {
  const prefix = `/exercises/${exerciseIndex}`;
  const problems: string[] = [];
  const check = (path: string, value: string): void => {
    const problem = latexMarkupProblem(value);
    if (problem !== null) problems.push(`${prefix}/${path}: ${problem}`);
  };
  const checkMany = (
    path: string,
    values: readonly string[],
  ): void => values.forEach((value, index) => check(`${path}/${index}`, value));

  check("title", exercise.title);
  check("prompt", exercise.prompt);
  check("groundedAnswer", exercise.groundedAnswer);
  switch (exercise.type) {
    case "short-answer":
      checkMany("acceptableAnswers", exercise.acceptableAnswers);
      checkMany("keyPoints", exercise.keyPoints);
      break;
    case "causal-explanation":
      checkMany("keyPoints", exercise.keyPoints);
      break;
    case "application":
      check("scenario", exercise.scenario);
      checkMany("keyPoints", exercise.keyPoints);
      break;
    case "calculation":
      check("working", exercise.working);
      check("unit", exercise.unit);
      break;
    case "cloze":
      check("clozeText", exercise.clozeText);
      exercise.blanks.forEach((blank, blankIndex) => {
        checkMany(`blanks/${blankIndex}/answers`, blank.answers);
      });
      break;
    case "single-select":
    case "multi-select":
      exercise.choices.forEach((choice, choiceIndex) => {
        check(`choices/${choiceIndex}/text`, choice.text);
      });
      break;
    case "matching":
      exercise.pairs.forEach((pair, pairIndex) => {
        check(`pairs/${pairIndex}/left`, pair.left);
        check(`pairs/${pairIndex}/right`, pair.right);
      });
      break;
    case "ordering":
      exercise.items.forEach((item, itemIndex) => {
        check(`items/${itemIndex}/text`, item.text);
      });
      break;
    case "image-occlusion":
      exercise.masks.forEach((mask, maskIndex) => {
        check(`masks/${maskIndex}/label`, mask.label);
        check(`masks/${maskIndex}/answer`, mask.answer);
      });
      break;
  }
  return problems;
}

function latexBraceProblem(
  value: string,
): { readonly problem: string; readonly index: number } | null {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (isEscaped(value, index)) continue;
    if (value[index] === "{") depth += 1;
    if (value[index] !== "}") continue;
    depth -= 1;
    if (depth < 0) {
      return { problem: "LaTeX contains an unmatched closing brace.", index };
    }
  }
  return depth === 0
    ? null
    : {
        problem: `LaTeX contains ${depth} unclosed ${depth === 1 ? "brace" : "braces"}.`,
        index: value.length,
      };
}

function isEscaped(value: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function firstUnescapedToken(value: string, token: string): number {
  let from = 0;
  while (from < value.length) {
    const index = value.indexOf(token, from);
    if (index < 0) return -1;
    if (!isEscaped(value, index)) return index;
    from = index + token.length;
  }
  return -1;
}

function unescapeLiteralDollars(value: string): string {
  return value.replace(/\\\$/gu, "$");
}
