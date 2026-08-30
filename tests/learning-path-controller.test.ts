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

test("guided recovery inspection restores tabs without running an AI job", () => {
  const inspectStart = controllerSource.indexOf("public async inspectRecoverableBatch()");
  const resumeStart = controllerSource.indexOf("public async resumeRecoverableBatch(", inspectStart);
  assert.ok(inspectStart >= 0 && resumeStart > inspectStart);
  const inspection = controllerSource.slice(inspectStart, resumeStart);
  assert.match(inspection, /restorePendingBatchFromRecovery\(\)/u);
  assert.match(inspection, /presentRecoveredBatch\(\)/u);
  assert.doesNotMatch(inspection, /runPendingBatch/u);

  const restoreStart = controllerSource.indexOf("private async restorePendingBatchFromRecovery()", resumeStart);
  const resume = controllerSource.slice(resumeStart, restoreStart);
  assert.match(resume, /restorePendingBatchFromRecovery\(\)/u);
  assert.match(resume, /runPendingBatch\(pending, onStatus, onActivity, true\)/u);
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

test("single-source guided saves use the primary compatibility snapshot", () => {
  assert.match(controllerSource, /vaultPath: primaryMaterial\.vaultPath/u);
  assert.match(controllerSource, /wikilink: primaryMaterial\.wikilink/u);
  assert.match(
    controllerSource,
    /title: sourceMaterials\.length === 1[\s\S]*?primaryMaterial\.title/u,
  );
  assert.match(
    controllerSource,
    /hash: sourceMaterials\.length === 1[\s\S]*?primaryMaterial\.sourceHash/u,
  );
});

test("legacy completed batches reconcile relationship links before final validation", () => {
  assert.match(controllerSource, /reconcileLearningWorkspaceDrafts\(savedBlueprint, finalDrafts\)/u);
  assert.match(controllerSource, /aspects: reconciliation\.aspects/u);
  assert.match(controllerSource, /reconciledLinkCount: reconciliation\.reconciledLinkCount/u);
});

test("partial guided saves retain durable recovery and merge previously saved sets", () => {
  assert.match(controllerSource, /const previouslySaved = new Set\(pendingBatch\.recovery\.savedSetIds\)/u);
  assert.match(controllerSource, /practiceSetDraftFromBank\(existing, payload\.targetSet\.id\)/u);
  assert.match(controllerSource, /markGenerationBatchSetSaved\(/u);
  assert.match(controllerSource, /completedUnsavedBatchDrafts\(pendingBatch\.recovery\)\.length === 0/u);
  assert.match(controllerSource, /await this\.persistBatchRecovery\(pendingBatch\.recovery, this\.recoveryHandle\)/u);
  assert.match(controllerSource, /readonly batchComplete: boolean/u);
});

test("guided PDF budgets are checked at every new provider boundary", () => {
  assert.match(
    controllerSource,
    /createApprovedSourceBundle\(\s*primary,\s*supporting,\s*this\.options\.pdfSourceBudgetLimits\(\),/u,
  );
  const blueprintStart = controllerSource.indexOf("public async generateBlueprint(");
  const payloadStart = controllerSource.indexOf("public async previewSetPayloads(", blueprintStart);
  const blueprintGeneration = controllerSource.slice(blueprintStart, payloadStart);
  assert.ok(
    blueprintGeneration.indexOf("this.assertPendingPdfBudget(pending)")
      < blueprintGeneration.indexOf("layer.coordinator.generate"),
  );

  const batchStart = controllerSource.indexOf("private async runPendingBatch(");
  const batchEnd = controllerSource.indexOf("private async failActiveSet(", batchStart);
  const batch = controllerSource.slice(batchStart, batchEnd);
  assert.ok(
    batch.indexOf("this.assertPendingPdfBudget(pendingBlueprint)")
      < batch.indexOf("nextGenerationBatchSet"),
  );
});

test("course alignment has a distinct durable recovery route before blueprint generation", () => {
  assert.match(controllerSource, /public async previewSourceAlignment\(/u);
  assert.match(controllerSource, /public async generateSourceAlignment\(/u);
  assert.match(controllerSource, /public async resumeRecoverableSourceAlignment\(/u);
  assert.match(
    controllerSource,
    /SOURCE_ALIGNMENT_RECOVERY_CONTEXT_FILENAME[\s\S]*SOURCE_ALIGNMENT_RECOVERY_RESULT_FILENAME/u,
  );
  assert.match(
    controllerSource,
    /inspectRecoveryKind\(\)[\s\S]*"source-alignment"[\s\S]*"generation-batch"/u,
  );
  assert.match(
    controllerSource,
    /pendingAlignment\.inputHash === sourceAlignmentInputHash\(alignmentInput\)/u,
  );
});

test("guided saves derive alignment links locally and persist V4", () => {
  assert.match(controllerSource, /const sourceAlignment = linkSourceAlignmentTargets\(/u);
  assert.match(controllerSource, /const bank: PracticeBankV4 =/u);
  assert.match(controllerSource, /sourceMaterials,\s*sourceAlignment,/u);
});

test("source classifications are resolved before one atomic controller update", () => {
  const start = controllerSource.indexOf("public confirmSourceClassifications(");
  const end = controllerSource.indexOf("public setRecoveryHandle(", start);
  assert.ok(start >= 0 && end > start);
  const method = controllerSource.slice(start, end);
  assert.match(method, /const resolved = updates\.map/u);
  assert.match(method, /new Set\(originalKeys\)\.size !== originalKeys\.length/u);
  assert.ok(
    method.indexOf("const confirmed = resolved.map") < method.indexOf("for (const key of originalKeys)"),
    "Every source should be validated and classified before the source map is mutated.",
  );
  assert.match(method, /this\.pendingAlignment = undefined/u);
  assert.match(method, /this\.pendingBlueprint = undefined/u);
  assert.match(method, /this\.pendingBatch = undefined/u);
});
