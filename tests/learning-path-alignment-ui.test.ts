import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const view = await readFile(
  new URL("../src/ui/learning-path-view.ts", import.meta.url),
  "utf8",
);

test("guided creation confirms every source label before course alignment", () => {
  assert.match(view, /const unconfirmedLabels = approvedSources\.filter/u);
  assert.match(view, /Review \$\{unconfirmedLabels\} source/u);
  assert.match(view, /sourceLabelDetails\.open = true/u);
  assert.match(view, /Preview course alignment/u);
  assert.match(
    view,
    /if \(unconfirmedLabels > 0\)[\s\S]*else if \(this\.alignmentPreview === null && this\.alignmentResult === null\)/u,
  );
});

test("alignment request is exact, collapsed by default, and approved before running", () => {
  assert.match(view, /"Details · exact alignment request"/u);
  assert.match(view, /this\.bindDisclosure\(payload, "source-alignment-payload", false\)/u);
  assert.match(view, /payload\.createEl\("pre", \{ text: preview\.text \}\)/u);
  assert.match(view, /Approve and check alignment/u);
  assert.match(view, /Add supporting context/u);
  assert.match(view, /Continue with selected material only/u);
  assert.match(view, /private async generateSourceAlignment\(\)/u);
  assert.match(view, /this\.options\.callbacks\.generateSourceAlignment/u);
});

test("only confirmed school-source conflicts expand and require explicit exclusion", () => {
  assert.match(
    view,
    /this\.bindDisclosure\(summary, "source-alignment-result", blockers > 0\)/u,
  );
  assert.match(
    view,
    /this\.bindDisclosure\(card, `source-alignment-record:\$\{record\.id\}`, blocking\)/u,
  );
  assert.match(view, /Exclude this disputed claim from practice/u);
  assert.doesNotMatch(view, /Exclude this unsupported claim from practice/u);
  assert.match(view, /Other areas do not block the path/u);
  assert.match(view, /record\.resolution = "excluded"/u);
  assert.match(
    view,
    /blockerRecordIds: result\.blockerRecordIds\.filter\(\(id\) => id !== recordId\)/u,
  );
  assert.match(view, /approveSourceAlignment\(\s*structuredClone\(result\.ledger\)/u);
  assert.match(view, /Conflicting school sources cannot be downgraded/u);
});

test("supporting context is one calm opt-in choice and remains not course-checked", () => {
  assert.match(view, /Use source-led course check/u);
  assert.match(view, /Additional context could strengthen this practice/u);
  assert.match(view, /Add supporting context/u);
  assert.match(view, /Continue with selected material only/u);
  assert.match(view, /Details · Review \$\{informationalRecords\.length\} source/u);
  assert.match(view, /AI-supported context approved · not course-checked/u);
  assert.match(view, /Using selected material only/u);
  assert.match(view, /sourceAlignmentBlockers\(recoveredAlignment\)/u);
});

test("planning stays unavailable until the alignment result is accepted", () => {
  assert.match(
    view,
    /else if \(this\.alignmentAccepted && this\.preview === null\)[\s\S]*Preview planning payload/u,
  );
  assert.match(
    view,
    /if \(primary === null \|\| this\.busy !== null \|\| !this\.alignmentAccepted\) return;/u,
  );
  assert.match(view, /\|\| !this\.alignmentAccepted\s+\|\| !this\.previewAccepted/u);
  assert.match(view, /private invalidateSourceAlignment\(\): void/u);
  assert.match(view, /this\.alignmentAccepted = false/u);
});

test("course-alignment recovery is distinct from generated-set recovery", () => {
  assert.match(view, /inspectRecoverableKind\?:/u);
  assert.match(view, /resumeRecoverableSourceAlignment\?:/u);
  assert.match(view, /if \(kind === "source-alignment"\)/u);
  assert.match(view, /private async resumeSourceAlignmentRecovery\(\)/u);
  assert.match(view, /this\.primary = recovered\.primary/u);
  assert.match(view, /this\.supporting = \[\.\.\.recovered\.supporting\]/u);
  assert.match(view, /this\.alignmentResult = recovered\.result/u);
});

test("alignment summaries stay human-readable while exact claims remain in details", () => {
  for (const label of [
    "Aligned with school material",
    "Your notes differ",
    "School material adds context",
    "Notes-grounded · not course-checked",
    "School sources disagree",
  ]) {
    assert.ok(view.includes(label), `Missing learner-facing alignment state: ${label}`);
  }
  assert.match(view, /School-supported interpretation/u);
  assert.match(view, /Your notes/u);
  assert.match(view, /School material/u);
  assert.match(view, /Your notes are not changed/u);
  assert.doesNotMatch(view, /Your notes are incomplete|incomplete[- ]note/iu);
});
