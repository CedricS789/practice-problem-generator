const INTERACTIVE_SELECTOR = [
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "a[href]",
  '[role="button"]',
].join(",");

const INSTALLED_ATTRIBUTE = "data-practice-lab-hover-descriptions";

/**
 * Adds concise native hover descriptions to every current and future control
 * in a Grounded Problems surface. Explicit tooltips always win.
 */
export function installHoverDescriptions(root: HTMLElement): void {
  if (root.hasAttribute(INSTALLED_ATTRIBUTE)) {
    applyHoverDescriptions(root);
    return;
  }
  root.setAttribute(INSTALLED_ATTRIBUTE, "true");
  const describeTarget = (event: Event): void => {
    const target = asElement(event.target);
    if (target === null) return;
    const control = target.closest(INTERACTIVE_SELECTOR);
    if (control === null || !control.instanceOf(HTMLElement) || !root.contains(control)) return;
    applyHoverDescription(control);
  };
  root.addEventListener("mouseover", describeTarget);
  root.addEventListener("focusin", describeTarget);
  applyHoverDescriptions(root);
}

function asElement(target: EventTarget | null): Element | null {
  if (target === null || typeof target !== "object") return null;
  const candidate = target as { readonly closest?: unknown };
  return typeof candidate.closest === "function" ? target as Element : null;
}

export function applyHoverDescriptions(root: HTMLElement): void {
  for (const control of Array.from(
    root.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR),
  )) {
    applyHoverDescription(control);
  }
}

export function applyHoverDescription(control: HTMLElement): void {
  if (control.title.trim().length > 0) return;
  const description = explicitDescription(control)
    ?? describedByText(control)
    ?? settingDescription(control)
    ?? actionDescription(control);
  if (description !== null) control.title = compact(description).slice(0, 360);
}

function explicitDescription(control: HTMLElement): string | null {
  return nonempty(control.dataset.practiceLabDescription)
    ?? nonempty(control.getAttribute("aria-description"));
}

function describedByText(control: HTMLElement): string | null {
  const ids = control.getAttribute("aria-describedby")?.split(/\s+/u) ?? [];
  const text = ids
    .map((id) => control.ownerDocument.getElementById(id)?.textContent ?? "")
    .join(" ");
  return nonempty(text);
}

function settingDescription(control: HTMLElement): string | null {
  const setting = control.closest(".setting-item");
  return nonempty(
    setting?.querySelector<HTMLElement>(".setting-item-description")?.textContent,
  );
}

function actionDescription(control: HTMLElement): string | null {
  const label = controlLabel(control);
  if (label === null) return null;
  if (control.instanceOf(HTMLSelectElement)) return `Choose ${label}.`;
  if (control.instanceOf(HTMLTextAreaElement)) return `Enter ${label}.`;
  if (control.instanceOf(HTMLInputElement)) {
    if (control.type === "checkbox" || control.type === "radio") {
      return `Toggle ${label}.`;
    }
    if (control.type === "range") return `Adjust ${label}.`;
    return `Enter ${label}.`;
  }
  if (control.instanceOf(HTMLAnchorElement)) return `Open ${label}.`;
  if (control.tagName === "SUMMARY") return `Expand or collapse ${label}.`;
  return `Activate ${label}.`;
}

function controlLabel(control: HTMLElement): string | null {
  const ariaLabel = nonempty(control.getAttribute("aria-label"));
  if (ariaLabel !== null) return ariaLabel;
  if (
    control.instanceOf(HTMLInputElement)
    || control.instanceOf(HTMLSelectElement)
    || control.instanceOf(HTMLTextAreaElement)
  ) {
    const label = control.labels?.[0] ?? control.closest("label");
    if (label !== null && label !== undefined) {
      const clone = label.cloneNode(true) as HTMLElement;
      for (const nested of Array.from(
        clone.querySelectorAll("button,input,select,textarea,option"),
      )) {
        nested.remove();
      }
      const text = nonempty(clone.textContent);
      if (text !== null) return text;
    }
    const placeholder = nonempty(control.getAttribute("placeholder"));
    if (placeholder !== null) return placeholder;
  }
  return nonempty(control.textContent);
}

function nonempty(value: string | null | undefined): string | null {
  const normalized = value === undefined || value === null ? "" : compact(value);
  return normalized.length === 0 ? null : normalized;
}

function compact(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
