import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [mainSource, viewSource, settingsSource, codexSource, claudeSource] = await Promise.all([
  readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/ui/practice-lab-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/settings.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/cli/codex.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/cli/claude.ts", import.meta.url), "utf8"),
]);

test("interrupted generation reattaches before other desktop AI queues", () => {
  assert.match(mainSource, /initializeDesktopWork\(\)/u);
  assert.match(
    mainSource,
    /await recovery;[\s\S]*initializeDesktopAnswerReviews\(\)/u,
  );
  assert.match(mainSource, /recovery: \{ mode: "resume", handle \}/u);
  assert.match(mainSource, /readRecoveryDraftCheckpoint\(handle\)/u);
  assert.match(mainSource, /writeDurableRecoveryText/u);
});

test("plugin unload detaches a recoverable generation without cancelling it", () => {
  assert.match(
    mainSource,
    /generationRecoveryHandle !== undefined[\s\S]*coordinator\?\.detach\(this\.activeGenerationJobId\)/u,
  );
  assert.match(mainSource, /coordinator\?\.cancel\(\)/u);
});

test("recovery remains optional, bounded, and explicitly discardable", () => {
  assert.match(settingsSource, /recoverInterruptedGenerations: true/u);
  assert.match(settingsSource, /generationRecoveryRetentionHours: 168/u);
  assert.match(settingsSource, /Recover interrupted generations/u);
  assert.match(settingsSource, /Recovery retention/u);
  assert.match(settingsSource, /Discard interrupted generation/u);
  assert.match(mainSource, /DISCARD INTERRUPTED GENERATION/u);
  assert.match(mainSource, /requestDiscardInterruptedGeneration/u);
});

test("recovered drafts open directly in Review while active jobs remain visible", () => {
  assert.match(viewSource, /prepareRecoveredGeneration/u);
  assert.match(viewSource, /Resumed the exact detached CLI job/u);
  assert.match(viewSource, /Recovered the validated draft/u);
  assert.match(viewSource, /this\.setDrafts\(drafts\)/u);
  assert.match(viewSource, /publishRecoveredGenerationActivity/u);
});

test("crash recovery does not enable provider conversation persistence", () => {
  assert.match(codexSource, /"--ephemeral"/u);
  assert.match(claudeSource, /"--no-session-persistence"/u);
  assert.doesNotMatch(mainSource, /--resume|--conversation|--session-id/u);
});

test("a new approved payload cannot overwrite an unresolved recovery", () => {
  assert.match(
    mainSource,
    /A recoverable generation already exists\. Review, save, or discard it before approving another payload\./u,
  );
  assert.match(
    mainSource,
    /A recoverable generation already exists\.[\s\S]*Review, save, or discard it before starting another generation\./u,
  );
});
