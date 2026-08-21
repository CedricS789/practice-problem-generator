import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [mainSource, settingsSource, bankSource, dashboardSource, modalSource] =
  await Promise.all([
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/settings.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/bank-statistics-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/practice-dashboard-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/ui/destructive-confirmation-modal.ts", import.meta.url), "utf8"),
  ]);

test("destructive settings are grouped, scoped, and never presented as one vague reset", () => {
  assert.match(settingsSource, /"Data management"/u);
  assert.match(settingsSource, /Reset all settings/u);
  assert.match(settingsSource, /Clear all session history/u);
  assert.match(settingsSource, /Delete all practice banks/u);
  assert.match(settingsSource, /requires a typed confirmation/u);
  assert.match(settingsSource, /Generated banks and session history are preserved/u);
  assert.match(settingsSource, /A Markdown backup is created first/u);
});

test("confirmation modal requires an exact phrase and starts disabled", () => {
  assert.match(modalSource, /typed\.trim\(\) !== this\.options\.confirmationPhrase/u);
  assert.match(modalSource, /confirmButton\.disabled/u);
  assert.match(modalSource, /This action is never triggered automatically/u);
  assert.match(modalSource, /setDestructive\(\)/u);
  assert.match(modalSource, /this\.resolve\(false\)/u);
});

test("history entries and bank cards expose secondary data actions", () => {
  assert.match(bankSource, /Manage this history entry/u);
  assert.match(bankSource, /Remove entry…/u);
  assert.match(bankSource, /options\.removeSession\?\.\(session\.id\)/u);
  assert.match(dashboardSource, /Data actions/u);
  assert.match(dashboardSource, /Move bank to trash…/u);
  assert.match(dashboardSource, /this\.options\.deleteBank\?\.\(record\)/u);
});

test("broad history clearing backs up before any revision-safe mutation", () => {
  const backupIndex = mainSource.indexOf(
    "const backupRoot = await this.backupPracticeBanks(affected, \"clear-all-history\")",
  );
  const mutationIndex = mainSource.indexOf("await this.repository.clearSessions(", backupIndex);
  assert.ok(backupIndex >= 0);
  assert.ok(mutationIndex > backupIndex);
  assert.match(mainSource, /severity === "error"/u);
  assert.match(mainSource, /Repair them before clearing all history/u);
  assert.match(mainSource, /discardAnswerReviews/u);
});

test("bank deletion uses Obsidian trash and preserves sources", () => {
  assert.match(mainSource, /this\.app\.fileManager\.trashFile/u);
  assert.match(mainSource, /The source note or PDF and original attachments will not be deleted/u);
  assert.match(mainSource, /Recoverability depends on your Obsidian trash configuration/u);
});
