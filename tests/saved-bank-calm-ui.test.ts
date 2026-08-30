import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [mainSource, statisticsSource, persistenceSource, editorSource] = await Promise.all([
  readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/bank-statistics-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/persistence.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/practice-bank-editor.ts", import.meta.url), "utf8"),
]);

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  assert.ok(endIndex > startIndex, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("saved banks default to Practice and render only the selected tab panel", () => {
  const renderer = between(
    mainSource,
    "private async renderPracticeBlock(",
    "private renderSavedBankPracticePage(",
  );
  assert.match(mainSource, /\?\.get\(bankId\) \?\? "practice"/u);
  assert.match(renderer, /renderHorizontalTabs<SavedBankPage>/u);
  assert.match(renderer, /renderPanel: \(panel, selected\) =>/u);
  assert.match(renderer, /if \(selected === "practice"\)/u);
  assert.match(renderer, /else if \(selected === "progress"\)/u);
  assert.match(mainSource, /savedBankPagesByLeaf/u);
});

test("Practice exposes one contextual action and keeps alternate guided scopes disclosed", () => {
  const practice = between(
    mainSource,
    "private renderSavedBankPracticePage(",
    "private renderSavedBankProgressPage(",
  );
  assert.match(practice, /savedSessionMatchesBank/u);
  assert.match(practice, /"Resume session"/u);
  assert.match(practice, /"Resolve saved session…"/u);
  assert.match(practice, /"Continue learning"/u);
  assert.match(practice, /"Start practice"/u);
  assert.match(practice, /cls: "mod-cta practice-lab-saved-bank-primary-action"/u);
  assert.match(practice, /"Choose another session…"/u);
});

test("Progress lazy-renders detailed analytics and paginates session history", () => {
  assert.match(statisticsSource, /function renderLazyDetails\(/u);
  assert.match(statisticsSource, /details\.addEventListener\("toggle", ensureContent\)/u);
  assert.match(statisticsSource, /options\.sessionPageSize \?\? 5/u);
  assert.match(statisticsSource, /text: "Show more"/u);
  assert.match(statisticsSource, /sessions\.slice\(0, visibleCount\)/u);
  const progress = between(
    mainSource,
    "private renderSavedBankProgressPage(",
    "private renderSavedBankManagePage(",
  );
  assert.match(progress, /compactOverview: true/u);
  assert.match(progress, /sessionPageSize: 5/u);
  assert.match(progress, /text: "Open full dashboard"/u);
});

test("Manage keeps raw data and destructive actions behind explicit disclosures", () => {
  const manage = between(
    mainSource,
    "private renderSavedBankManagePage(",
    "private renderReadOnlyBlock(",
  );
  assert.match(manage, /text: "Technical details"/u);
  assert.match(manage, /text: "Show raw bank data"/u);
  assert.match(manage, /text: "Danger zone"/u);
  assert.match(manage, /requestClearPracticeBankHistory/u);
  assert.match(manage, /requestDeletePracticeBank/u);
  assert.match(manage, /Platform\.isMobileApp/u);
});

test("serialized notes are clean while Live Preview receives a managed-data widget", () => {
  assert.doesNotMatch(persistenceSource, /Open this note in Reading view/u);
  assert.doesNotMatch(persistenceSource, /\[!info\] Practice Problem Generator bank/u);
  assert.match(persistenceSource, /PRACTICE_BLOCK_LANGUAGE/u);
  assert.match(persistenceSource, /function findPracticeBlock/u);
  assert.match(editorSource, /editorLivePreviewField/u);
  assert.match(editorSource, /Practice data managed by the plugin/u);
  assert.match(editorSource, /if \(!livePreview\)/u);
  assert.match(editorSource, /Decoration\.replace/u);
  assert.match(mainSource, /registerEditorExtension\(practiceBankEditorExtension\)/u);
});

test("plugin-opened Practice notes honor the saved Reading-view preference", () => {
  assert.match(mainSource, /private async openPracticeBank\(/u);
  assert.match(mainSource, /this\.settings\.savedBankOpenMode === "reading"/u);
  assert.match(mainSource, /state: \{ mode: "preview" \}/u);
  assert.match(mainSource, /await this\.openPracticeBank\(saved\.path\)/u);
});
