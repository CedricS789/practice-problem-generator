import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const controllerSource = await readFile(
  new URL("../src/learning-path-controller.ts", import.meta.url),
  "utf8",
);

test("guided batch resume preserves the durable job identity in provenance", () => {
  assert.match(
    controllerSource,
    /const resumedHandle = pending\.recovery\.active\.handle;\s*const resumedJobId = resumedHandle\.jobId;/u,
  );
  assert.match(
    controllerSource,
    /completeGenerationBatchSet[\s\S]*?pending\.audits = replaceAudit\([\s\S]*?jobId: resumedJobId,/u,
  );
  assert.doesNotMatch(
    controllerSource,
    /jobId: pending\.recovery\.active\?\.handle\.jobId/u,
  );
});

test("guided batch unload detaches only the matching active durable job", () => {
  assert.match(controllerSource, /public detachActive\(\): boolean/u);
  assert.match(
    controllerSource,
    /active\.handle\.jobId !== recoveryHandle\.jobId[\s\S]*active\.handle\.workspacePath !== recoveryHandle\.workspacePath/u,
  );
  assert.match(
    controllerSource,
    /this\.cliLayer\?\.coordinator\.detach\(active\.handle\.jobId\) \?\? false/u,
  );
  assert.match(
    controllerSource,
    /if \(cliErrorCode\(error\) === "detached"\) throw error;[\s\S]*failActiveSet/u,
  );
});

test("recovered vault files are checked as TFile instances before use", () => {
  assert.match(controllerSource, /import \{ Platform, TFile, type App \} from "obsidian";/u);
  assert.match(controllerSource, /if \(!\(file instanceof TFile\)\)/u);
  assert.doesNotMatch(controllerSource, /as TFile/u);
});

test("learning-path sidecars use explicit set-scoped recipe provenance", () => {
  assert.match(controllerSource, /readonly legacyRecipe: GenerationRecipeV2;/u);
  assert.match(controllerSource, /const liveSetIds = new Set\(bank\.practiceSets/u);
  assert.match(controllerSource, /batchId: pendingBatch\.batchId/u);
  assert.match(controllerSource, /blueprintId: pendingBatch\.blueprint\.draft\.blueprintId/u);
});
