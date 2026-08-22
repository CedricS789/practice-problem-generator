import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const viewSource = await readFile(
  new URL("../src/ui/practice-lab-view.ts", import.meta.url),
  "utf8",
);

function sourceBetween(start: string, end: string): string {
  const startIndex = viewSource.indexOf(start);
  const endIndex = viewSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source boundary: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source boundary: ${end}`);
  return viewSource.slice(startIndex, endIndex);
}

test("close and background lifecycle flush the active study checkpoint", () => {
  const handler = sourceBetween(
    "private readonly handleDocumentVisibilityChange",
    "private answerReviewMode",
  );
  const onOpen = sourceBetween(
    "public override async onOpen",
    "public override async onClose",
  );
  const onClose = sourceBetween(
    "public override async onClose",
    "public setSource",
  );

  assert.match(
    onOpen,
    /document\.addEventListener\([\s\S]*"visibilitychange",[\s\S]*this\.handleDocumentVisibilityChange/u,
  );
  assert.match(
    onClose,
    /document\.removeEventListener\([\s\S]*"visibilitychange",[\s\S]*this\.handleDocumentVisibilityChange/u,
  );
  assert.match(handler, /document\.visibilityState !== "hidden"/u);
  assert.match(
    handler,
    /this\.stage !== "study" \|\| this\.studyIndex >= this\.studyExercises\.length/u,
  );
  assert.match(handler, /void this\.flushStudyCheckpoint\(\)\.catch\(\(\) => undefined\)/u);
  assert.match(
    onClose,
    /try \{[\s\S]*await this\.flushStudyCheckpoint\(\);[\s\S]*\} catch \{[\s\S]*already displayed the actionable warning/u,
  );
  assert.doesNotMatch(onClose, /void this\.flushStudyCheckpoint/u);
});

test("lifecycle flush persists an exact clone of current input without changing normal timing", () => {
  const progress = sourceBetween(
    "private studyProgress",
    "private scheduleStudyCheckpoint",
  );
  const scheduling = sourceBetween(
    "private scheduleStudyCheckpoint",
    "private clearStudyCheckpointTimer",
  );
  const flushing = sourceBetween(
    "private async flushStudyCheckpoint",
    "private async persistStudyCheckpoint",
  );
  const persistence = sourceBetween(
    "private async persistStudyCheckpoint",
    "private studyHasRepairOpportunity",
  );
  const submitted = sourceBetween(
    "private setStudySubmitted",
    "private studyProgress",
  );

  assert.match(progress, /currentInput: structuredClone\(this\.studyCurrentInput\)/u);
  assert.match(flushing, /this\.clearStudyCheckpointTimer\(\);[\s\S]*await this\.persistStudyCheckpoint\(\)/u);
  assert.match(
    persistence,
    /const progress = this\.studyProgress\(\);[\s\S]*await callback\(progress\);/u,
  );
  assert.match(scheduling, /\}, 400\);/u);
  assert.match(submitted, /void this\.flushStudyCheckpoint\(\)\.catch\(\(\) => undefined\)/u);
});
