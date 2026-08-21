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
    "activityRangeWeeks",
    "activityMetric",
    "activityWeekStart",
  ]) {
    assert.match(dashboardViewSource, new RegExp(`${stateKey}:`, "u"));
    assert.match(
      dashboardViewSource,
      new RegExp(`recordValue\\(state, "${stateKey}"\\)`, "u"),
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
    "Answers",
    "Sessions",
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

  const options = sourceBetween(
    mainSource,
    "private createDashboardViewOptions(",
    "private async previewPayload(",
  );
  assert.match(options, /rangeWeeks: this\.settings\.dashboardActivityRangeWeeks/u);
  assert.match(options, /metric: this\.settings\.dashboardActivityMetric/u);
  assert.match(options, /weekStart: this\.settings\.dashboardWeekStart/u);
});

test("restored unavailable filters stay selected and visible", () => {
  assert.doesNotMatch(dashboardViewSource, /ensureAvailableScope/u);
  const render = sourceBetween(
    dashboardViewSource,
    "private render(): void",
    "private contextualTagOptions(",
  );
  assert.ok(
    render.indexOf("this.renderFilters(scopeOptions, tagOptions)")
      < render.indexOf("if (snapshot.records.length === 0)"),
    "Filters must render even when every saved bank disappeared",
  );

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
  assert.match(contextualTags, /aggregatePracticeDashboard\(records, \{/u);
  assert.match(contextualTags, /primary: this\.primary/u);
  assert.match(contextualTags, /tagPrefix: option\.scope\.tag/u);
  assert.match(contextualTags, /\}\)\.bankCount/u);

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

  const renderStatus = sourceBetween(
    dashboardViewSource,
    "private renderStatus(",
    "\n  }\n}",
  );
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
    /openLinkText\(record\.bankPath, "", true\)/u,
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
