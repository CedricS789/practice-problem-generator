import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [mainSource, dashboardViewSource] = await Promise.all([
  readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../src/ui/practice-dashboard-view.ts", import.meta.url),
    "utf8",
  ),
]);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `Missing source marker: ${start}`);
  assert.ok(endIndex > startIndex, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("the plugin registers a dashboard backed by live source-note metadata", () => {
  assert.match(
    mainSource,
    /new PracticeDashboardRepository\(this\.app,\s*\{/u,
  );
  assert.match(mainSource, /frontmatter\?\.\["practice-lab"\] === true/u);
  assert.match(mainSource, /getAllTags\(cache\) \?\? \[\]/u);
  assert.match(
    mainSource,
    /this\.registerView\(\s*PRACTICE_DASHBOARD_VIEW_TYPE,\s*\(leaf\) => new PracticeDashboardView/u,
  );
  assert.match(mainSource, /id: "open-practice-dashboard"/u);
  assert.match(mainSource, /name: "Open practice dashboard"/u);
});

test("dashboard scope state survives workspace restoration and opens in a main tab", () => {
  assert.match(
    dashboardViewSource,
    /export const PRACTICE_DASHBOARD_VIEW_TYPE = "practice-lab-dashboard-view"/u,
  );
  for (const stateKey of [
    "scopeKind",
    "scopeValue",
    "tagPrefix",
    "search",
  ]) {
    assert.match(dashboardViewSource, new RegExp(`${stateKey}:`, "u"));
    assert.match(
      dashboardViewSource,
      new RegExp(`recordValue\\(state, "${stateKey}"\\)`, "u"),
    );
  }
  for (const settingsOwnedKey of [
    "activityRangeWeeks",
    "activityMetric",
    "activityWeekStart",
  ]) {
    assert.doesNotMatch(
      dashboardViewSource,
      new RegExp(`recordValue\\(state, "${settingsOwnedKey}"\\)`, "u"),
    );
  }

  const openDashboard = sourceBetween(
    mainSource,
    "private async openDashboard(",
    "private registerDashboardRefreshEvents(",
  );
  assert.match(openDashboard, /getLeavesOfType\(PRACTICE_DASHBOARD_VIEW_TYPE\)/u);
  assert.match(openDashboard, /getLeaf\("tab"\)/u);
  assert.match(
    openDashboard,
    /setViewState\(\{ type: PRACTICE_DASHBOARD_VIEW_TYPE, active: true \}\)/u,
  );
  assert.match(openDashboard, /revealLeaf\(leaf\)/u);
  assert.match(openDashboard, /leaf\.view\.setScope\(scope\)/u);
});

test("dashboard uses four active-panel pages and keeps page state local to the open view", () => {
  assert.match(
    dashboardViewSource,
    /export type DashboardPage = "practice-now" \| "learning" \| "activity" \| "library"/u,
  );
  assert.match(
    dashboardViewSource,
    /private activePage: DashboardPage = "practice-now"/u,
  );
  const render = sourceBetween(
    dashboardViewSource,
    "private render(): void",
    "private dashboardContainer(",
  );
  assert.match(render, /renderHorizontalTabs\(this\.contentEl, \{/u);
  for (const [id, label] of [
    ["practice-now", "Practice now"],
    ["learning", "Learning"],
    ["activity", "Activity"],
    ["library", "Library"],
  ]) {
    assert.match(
      render,
      new RegExp(`\\{ id: "${id}", label: "${label}" \\}`, "u"),
    );
  }
  assert.match(render, /renderPanel: \(panel\) => \{/u);
  assert.match(render, /this\.activePanelEl = panel/u);
  assert.doesNotMatch(dashboardViewSource, /recordValue\(state, "activePage"\)/u);
});

test("Practice now prefers recovery, then recent guided and regular practice", () => {
  const practiceNow = sourceBetween(
    dashboardViewSource,
    "private renderPracticeNow(",
    "private mostRecentBank(",
  );
  assert.match(dashboardViewSource, /export interface DashboardRecoveryPresentation/u);
  assert.match(dashboardViewSource, /readonly state: "resumable" \| "needs-resolution"/u);
  assert.match(practiceNow, /this\.recoveryPresentation\(\)/u);
  assert.match(practiceNow, /this\.options\.handleRecovery/u);
  assert.match(practiceNow, /this\.mostRecentBank\(summary, true\)/u);
  assert.match(practiceNow, /this\.mostRecentBank\(summary, false\)/u);
  assert.match(practiceNow, /setButtonText\("Choose practice"\)/u);
  for (const summary of ["Performance", "Practised coverage", "Recent activity", "Needs attention"]) {
    assert.ok(practiceNow.includes(summary), `Missing Practice now summary: ${summary}`);
  }
  assert.match(practiceNow, /spaced-repetition schedule/u);
  assert.match(dashboardViewSource, /typeof presentation === "function"/u);
  assert.match(mainSource, /recoveryPresentation: \(\) => this\.dashboardRecoveryPresentation\(\)/u);
  assert.match(mainSource, /handleRecovery: async \(action\)/u);
});

test("dashboard analytics stay scoped, accessible, and descriptive rather than scheduled", () => {
  const analytics = sourceBetween(
    dashboardViewSource,
    "private renderActivityAnalytics(",
    "private renderTypeBreakdown(",
  );
  assert.match(
    analytics,
    /buildPracticeActivity\(summary\.recentSessions, \{/u,
  );
  for (const label of [
    "Practice activity",
    "Activity heatmap",
    "Practice time",
    "Performance by week",
    "Scored answer outcomes",
    "View weekly data table",
  ]) {
    assert.ok(analytics.includes(label), `Missing analytics label: ${label}`);
  }
  assert.match(analytics, /role: "group"/u);
  assert.match(analytics, /role: "img"/u);
  assert.match(analytics, /"aria-label": activityDayLabel\(day\)/u);
  assert.match(analytics, /title: activityDayLabel\(day\)/u);
  assert.match(analytics, /cell\.disabled = true/u);
  assert.match(analytics, /cell\.setAttribute\("aria-hidden", "true"\)/u);
  assert.match(
    analytics,
    /do not create due dates, quotas, or review schedules/u,
  );
  assert.match(analytics, /never turns this history into a due queue/u);
  assert.doesNotMatch(analytics, /setName\("Time window"\)/u);
  assert.doesNotMatch(analytics, /setName\("Weekly volume"\)/u);
  assert.match(analytics, /preferences\.showActivitySummary/u);

  const options = sourceBetween(
    mainSource,
    "private createDashboardViewOptions(",
    "private async previewPayload(",
  );
  assert.match(options, /rangeWeeks: this\.settings\.dashboardActivityRangeWeeks/u);
  assert.match(options, /metric: this\.settings\.dashboardActivityMetric/u);
  assert.match(options, /weekStart: this\.settings\.dashboardWeekStart/u);
});

test("Activity shows one local visualization and Library keeps secondary actions collapsed", () => {
  const analytics = sourceBetween(
    dashboardViewSource,
    "private renderActivityAnalytics(",
    "private renderActivityHeatmap(",
  );
  for (const view of ["Heatmap", "Trend", "Performance", "Outcomes"]) {
    assert.ok(analytics.includes(view), `Missing activity view: ${view}`);
  }
  assert.match(dashboardViewSource, /private activityView: DashboardActivityView = "heatmap"/u);
  assert.match(analytics, /if \(this\.activityView === "heatmap"\)/u);
  assert.match(analytics, /if \(this\.activityView === "trend"\)/u);
  assert.match(analytics, /if \(this\.activityView === "performance"\)/u);
  assert.match(analytics, /if \(this\.activityView === "outcomes"\)/u);
  assert.match(analytics, /Changes this dashboard view only\./u);

  const library = sourceBetween(
    dashboardViewSource,
    "private renderBankSection(",
    "private async runAction(",
  );
  assert.match(library, /"Library"/u);
  assert.match(library, /text: "More…"/u);
  assert.match(library, /recovery\.state === "resumable" \? "Resume" : "Resolve"/u);
  assert.match(library, /setButtonText\("Continue"\)/u);
  assert.match(library, /setButtonText\("Start"\)/u);
  assert.match(library, /this\.options\.openBank\(record\)/u);
  assert.match(library, /this\.options\.openSource\(record\)/u);
});

test("guided-path dashboard separates evidence, assistance, coverage, and advisory next steps", () => {
  const guided = sourceBetween(
    dashboardViewSource,
    "private renderLearningPathAnalytics(",
    "private renderActivityAnalytics(",
  );
  for (const label of [
    "Learning",
    "Guided learning paths",
    "Current step",
    "Independent evidence",
    "Lesson progress",
    "Evidence state",
    "Continue learning",
    "Details",
    "Aspect evidence",
    "Practice-set evidence",
  ]) {
    assert.ok(guided.includes(label), `Missing guided dashboard label: ${label}`);
  }
  assert.match(guided, /selectedLearningBankId/u);
  assert.match(guided, /role: "listbox"/u);
  assert.match(guided, /role: "option"/u);
  assert.match(guided, /recommendation\.reasons/u);
  assert.match(guided, /Guided support never inflates independent performance/u);
  assert.match(guided, /data-practice-lab-description/u);
  assert.match(guided, /cell\.scope = "col"/u);

  const render = sourceBetween(
    dashboardViewSource,
    "private render(): void",
    "private contextualTagOptions(",
  );
  assert.match(render, /display\.showLearningPathAnalytics/u);
  assert.match(render, /this\.renderLearningPathAnalytics\(summary, snapshot\.records\)/u);
});

test("restored unavailable filters stay selected and visible", () => {
  assert.doesNotMatch(dashboardViewSource, /ensureAvailableScope/u);
  const render = sourceBetween(
    dashboardViewSource,
    "private render(): void",
    "private contextualTagOptions(",
  );
  assert.ok(
    render.indexOf("this.renderScopeBar(scopeOptions, tagOptions)")
      < render.indexOf("if (snapshot.records.length === 0)"),
    "The compact scope bar must render even when every saved bank disappeared",
  );
  const scopeBar = sourceBetween(
    dashboardViewSource,
    "private renderScopeBar(",
    "private scopeLabel(",
  );
  assert.match(scopeBar, /showScopeControls/u);
  assert.match(scopeBar, /Change scope…/u);
  assert.match(scopeBar, /scopeEditorOpen/u);

  const filters = sourceBetween(
    dashboardViewSource,
    "private renderFilters(",
    "private renderBreadcrumbs(",
  );
  assert.match(filters, /`\$\{currentPath\} \(unavailable\)`/u);
  assert.match(
    filters,
    /`\$\{sourceNameFromPath\(currentPath\)\} — \$\{location\} \(unavailable\)`/u,
  );
  assert.match(filters, /`#\$\{this\.tagPrefix\} \(unavailable\)`/u);
  assert.match(filters, /dropdown\.setValue\(currentPath\)/u);
  assert.match(filters, /dropdown\.setValue\(this\.tagPrefix \?\? ""\)/u);
});

test("tag counts follow the primary scope and duplicate source titles show location", () => {
  const contextualTags = sourceBetween(
    dashboardViewSource,
    "private contextualTagOptions(",
    "private renderFilters(",
  );
  assert.match(contextualTags, /countDashboardBanks\(records, \{/u);
  assert.match(contextualTags, /primary: this\.primary/u);
  assert.match(contextualTags, /tagPrefix: option\.scope\.tag/u);
  assert.match(contextualTags, /\}\);/u);

  const filters = sourceBetween(
    dashboardViewSource,
    "private renderFilters(",
    "private renderBreadcrumbs(",
  );
  assert.match(filters, /const titleCounts = new Map<string, number>\(\)/u);
  assert.match(filters, /const hasDuplicateTitle =/u);
  assert.match(filters, /sourceFolder\(option\.scope\.path\)/u);
  assert.match(filters, /"Vault root"/u);

  const recentSessions = sourceBetween(
    dashboardViewSource,
    "private renderRecentSessions(",
    "private renderBankSection(",
  );
  assert.match(recentSessions, /const sourcePathsByTitle = new Map<string, Set<string>>\(\)/u);
  assert.match(recentSessions, /sourceFolder\(recent\.sourcePath\)/u);
});

test("dashboard exposes duplicate collision details and accessible load status", () => {
  const diagnostics = sourceBetween(
    dashboardViewSource,
    "private renderDiagnostics(",
    "private dashboardSection(",
  );
  assert.match(diagnostics, /summary\?\.excludedDuplicateRecords \?\? \[\]/u);
  for (const field of ["bankId", "bankPath", "sourceTitle", "sourcePath"]) {
    assert.match(diagnostics, new RegExp(`record\\.${field}`, "u"));
  }

  const renderStatusIndex = dashboardViewSource.indexOf("private renderStatus(");
  assert.ok(renderStatusIndex >= 0, "Missing renderStatus implementation");
  const renderStatus = dashboardViewSource.slice(renderStatusIndex);
  assert.match(renderStatus, /role: "alert" \| "status" = "status"/u);
  assert.match(renderStatus, /"aria-live": role === "alert" \? "assertive" : "polite"/u);
  assert.match(
    dashboardViewSource,
    /`The dashboard could not load: \$\{this\.errorMessage\}`,[\s\S]*?"circle-alert",[\s\S]*?"alert"/u,
  );
  assert.match(dashboardViewSource, /text: "Dashboard refresh failed"/u);
  assert.match(
    dashboardViewSource,
    /text: `Showing the last loaded statistics\. \$\{this\.errorMessage\}`/u,
  );
});

test("dashboard actions reuse saved-bank practice and exact Obsidian links", () => {
  const options = sourceBetween(
    mainSource,
    "private createDashboardViewOptions(",
    "private async previewPayload(",
  );
  assert.match(
    options,
    /startBankStudy\(record\.bankPath, record\.bank\)/u,
  );
  assert.match(
    options,
    /openPracticeBank\(record\.bankPath\)/u,
  );
  assert.match(
    options,
    /openLinkText\(\s*record\.bank\.source\.vaultPath,\s*record\.bankPath,\s*true/u,
  );
  assert.match(
    options,
    /regenerateBank\(record\.bankPath, record\.bank\)/u,
  );

  assert.match(mainSource, /text: "View dashboard"/u);
  assert.match(
    mainSource,
    /openDashboard\(\{ kind: "source", path: bank\.source\.vaultPath \}\)/u,
  );
  assert.match(dashboardViewSource, /this\.options\.startPractice\(record\)/u);
  assert.match(dashboardViewSource, /this\.options\.openBank\(record\)/u);
  assert.match(dashboardViewSource, /this\.options\.openSource\(record\)/u);
  assert.match(dashboardViewSource, /setButtonText\("Regenerate \/ tweak"\)/u);
  assert.match(dashboardViewSource, /this\.options\.regenerate\?\.\(record\)/u);
});

test("saved Practice notes open by exact TFile without an empty mobile link origin", () => {
  const openPracticeBank = sourceBetween(
    mainSource,
    "private async openPracticeBank(",
    "private async requestRemovePracticeSession(",
  );
  assert.match(openPracticeBank, /normalizePath\(bankPath\)/u);
  assert.match(openPracticeBank, /getAbstractFileByPath\(normalized\)/u);
  assert.match(openPracticeBank, /file instanceof TFile/u);
  assert.match(openPracticeBank, /getLeaf\("tab"\)/u);
  assert.match(openPracticeBank, /await leaf\.openFile\(/u);
  assert.match(openPracticeBank, /await this\.app\.workspace\.revealLeaf\(leaf\)/u);
  assert.doesNotMatch(openPracticeBank, /openLinkText/u);
  assert.doesNotMatch(mainSource, /openPracticeBank\([^\n]*,\s*""\)/u);
});

test("open dashboards refresh once after a burst of vault or tag changes", () => {
  const registration = sourceBetween(
    mainSource,
    "private registerDashboardRefreshEvents(",
    "private scheduleDashboardRefresh(",
  );
  for (const eventName of ["create", "modify", "delete", "rename"]) {
    assert.match(
      registration,
      new RegExp(`this\\.app\\.vault\\.on\\("${eventName}"`, "u"),
    );
  }
  for (const eventName of ["changed", "resolved"]) {
    assert.match(
      registration,
      new RegExp(`this\\.app\\.metadataCache\\.on\\("${eventName}"`, "u"),
    );
  }
  assert.match(registration, /this\.register\(\(\) => \{ this\.clearDashboardRefreshTimer\(\); \}\)/u);

  const scheduling = sourceBetween(
    mainSource,
    "private scheduleDashboardRefresh(",
    "private clearDashboardRefreshTimer(",
  );
  assert.match(
    scheduling,
    /getLeavesOfType\(PRACTICE_DASHBOARD_VIEW_TYPE\)\.length === 0/u,
  );
  assert.match(scheduling, /this\.clearDashboardRefreshTimer\(\)/u);
  assert.match(scheduling, /window\.setTimeout/u);
  assert.match(scheduling, /leaf\.view\.refresh\(\)/u);

  const cleanup = sourceBetween(
    mainSource,
    "private clearDashboardRefreshTimer(",
    "private resolveCollectedSource(",
  );
  assert.match(cleanup, /window\.clearTimeout\(this\.dashboardRefreshTimer\)/u);
});
