export interface HorizontalTabDefinition<Id extends string> {
  readonly id: Id;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface HorizontalTabsOptions<Id extends string> {
  readonly tabs: readonly HorizontalTabDefinition<Id>[];
  readonly selected: Id;
  readonly ariaLabel: string;
  readonly onSelect: (id: Id) => void;
  readonly renderPanel: (panel: HTMLElement, id: Id) => void;
  readonly className?: string;
}

export interface HorizontalTabsResult {
  readonly tabListEl: HTMLElement;
  readonly panelEl: HTMLElement;
}

let horizontalTabsInstance = 0;

export function horizontalTabTargetIndex(
  key: string,
  currentIndex: number,
  count: number,
): number | null {
  if (count <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight") return (currentIndex + 1) % count;
  if (key === "ArrowLeft") return (currentIndex - 1 + count) % count;
  return null;
}

export function renderHorizontalTabs<Id extends string>(
  container: HTMLElement,
  options: HorizontalTabsOptions<Id>,
): HorizontalTabsResult {
  if (options.tabs.length === 0) {
    throw new Error("Horizontal tabs require at least one tab.");
  }
  const selected = options.tabs.find((tab) => (
    tab.id === options.selected && tab.disabled !== true
  )) ?? options.tabs.find((tab) => tab.disabled !== true);
  if (selected === undefined) {
    throw new Error("Horizontal tabs require at least one enabled tab.");
  }

  const instanceId = ++horizontalTabsInstance;
  const root = container.createDiv({
    cls: ["practice-lab-horizontal-tabs", options.className]
      .filter((value): value is string => value !== undefined)
      .join(" "),
  });
  const tabListEl = root.createDiv({
    cls: "practice-lab-horizontal-tabs__list",
    attr: { role: "tablist", "aria-label": options.ariaLabel },
  });
  const enabledTabs = options.tabs.filter((tab) => tab.disabled !== true);

  const restoreFocus = (id: Id): void => {
    queueMicrotask(() => {
      const candidates = container.querySelectorAll<HTMLButtonElement>(
        ".practice-lab-horizontal-tabs__tab",
      );
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates.item(index);
        if (candidate.dataset.practiceLabTabId === id) {
          candidate.focus();
          break;
        }
      }
    });
  };

  for (const tab of options.tabs) {
    const tabId = `practice-lab-tabs-${instanceId}-${tab.id}-tab`;
    const panelId = `practice-lab-tabs-${instanceId}-${tab.id}-panel`;
    const button = tabListEl.createEl("button", {
      cls: "practice-lab-horizontal-tabs__tab",
      text: tab.label,
      attr: {
        type: "button",
        id: tabId,
        role: "tab",
        "aria-controls": panelId,
        "aria-selected": String(tab.id === selected.id),
        tabindex: tab.id === selected.id ? "0" : "-1",
        "data-practice-lab-tab-id": tab.id,
      },
    });
    button.disabled = tab.disabled === true;
    const activate = (): void => {
      if (tab.disabled === true || tab.id === selected.id) return;
      options.onSelect(tab.id);
      restoreFocus(tab.id);
    };
    button.addEventListener("click", activate);
    button.addEventListener("keydown", (event) => {
      const currentIndex = enabledTabs.findIndex((candidate) => candidate.id === tab.id);
      const targetIndex = horizontalTabTargetIndex(
        event.key,
        currentIndex,
        enabledTabs.length,
      );
      if (targetIndex === null) return;
      const target = enabledTabs[targetIndex];
      if (target === undefined) return;
      event.preventDefault();
      if (target.id !== selected.id) options.onSelect(target.id);
      restoreFocus(target.id);
    });
  }

  const selectedTabId = `practice-lab-tabs-${instanceId}-${selected.id}-tab`;
  const selectedPanelId = `practice-lab-tabs-${instanceId}-${selected.id}-panel`;
  const panelEl = root.createDiv({
    cls: "practice-lab-horizontal-tabs__panel",
    attr: {
      id: selectedPanelId,
      role: "tabpanel",
      "aria-labelledby": selectedTabId,
      tabindex: "0",
    },
  });
  options.renderPanel(panelEl, selected.id);
  return { tabListEl, panelEl };
}
