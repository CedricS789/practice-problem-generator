import { finishRenderMath, renderMath } from "obsidian";
import { parseLatexMarkup } from "../latex";

/** Render plain prose and canonical LaTeX with Obsidian's bundled MathJax. */
export function renderLatexMarkup(
  container: HTMLElement,
  value: string,
): boolean {
  container.empty();
  container.addClass("practice-lab-latex");
  container.removeClass("is-invalid-latex");
  container.removeAttribute("title");
  const parsed = parseLatexMarkup(value);
  if (!parsed.ok) {
    renderFallback(container, value, parsed.problem);
    return false;
  }

  let renderedMath = false;
  try {
    for (const segment of parsed.segments) {
      if (segment.kind === "text") {
        container.appendChild(
          container.ownerDocument.createTextNode(segment.value),
        );
      } else {
        container.appendChild(renderMath(segment.value, segment.display));
        renderedMath = true;
      }
    }
  } catch (error) {
    const detail = error instanceof Error && error.message.trim().length > 0
      ? error.message
      : "MathJax could not parse this expression.";
    renderFallback(container, value, detail);
    return false;
  }
  if (renderedMath) void finishRenderMath().catch(() => undefined);
  return true;
}

function renderFallback(
  container: HTMLElement,
  value: string,
  problem: string,
): void {
  container.empty();
  container.setText(value);
  container.addClass("is-invalid-latex");
  container.title = `LaTeX preview unavailable: ${problem}`;
}
