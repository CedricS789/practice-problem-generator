const MARKDOWN_HEADING_THEME_VARIABLES = [
  ["--inline-title-color", "--practice-lab-title-color"],
  ["--h2-color", "--practice-lab-section-title-color"],
  ["--h3-color", "--practice-lab-subheading-color"],
  ["--h4-color", "--practice-lab-detail-heading-color"],
  ["--h5-color", "--practice-lab-minor-heading-color"],
] as const;

/**
 * Copies Obsidian's Markdown heading colour roles into a native plugin view.
 *
 * Theme snippets commonly scope their heading variables to `.markdown-rendered`
 * so they do not recolour the rest of Obsidian. Native ItemViews live outside
 * that scope. A short-lived probe reads those resolved variables without adding
 * Markdown layout classes to the plugin itself.
 */
export function applyMarkdownHeadingTheme(target: HTMLElement): void {
  const document = target.ownerDocument;
  const view = document.defaultView;
  if (view === null || document.body === null) return;

  const probe = document.body.createDiv({
    cls: "markdown-rendered practice-lab-theme-probe",
  });
  probe.setAttribute("aria-hidden", "true");

  try {
    const computedStyle = view.getComputedStyle(probe);
    for (const [sourceVariable, targetVariable] of MARKDOWN_HEADING_THEME_VARIABLES) {
      const value = computedStyle.getPropertyValue(sourceVariable).trim();
      if (value === "") {
        target.style.removeProperty(targetVariable);
      } else {
        target.style.setProperty(targetVariable, value);
      }
    }
  } finally {
    probe.remove();
  }
}
