import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PLUGIN_ID,
  RUNTIME_ARTIFACTS,
  assertAllowedVault,
  assertPluginEnabled,
  assertRegisteredOpenVault,
  deploy,
  mergeCommunityPlugins,
  parseDeployArguments,
  resolveObsidianRegistry,
  resolveVault
} from "../scripts/deploy.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("community plugin merge appends only Practice Problem Generator", () => {
  assert.deepEqual(mergeCommunityPlugins(["pdf-plus"]), ["pdf-plus", PLUGIN_ID]);
  assert.deepEqual(mergeCommunityPlugins([PLUGIN_ID, "pdf-plus"]), [PLUGIN_ID, "pdf-plus"]);
  assert.throws(() => mergeCommunityPlugins({}), /array/);
});

test("runtime-only argument and enabled-plugin checks fail closed", () => {
  assert.deepEqual(parseDeployArguments([]), { runtimeOnly: false });
  assert.deepEqual(parseDeployArguments(["--runtime-only"]), { runtimeOnly: true });
  assert.throws(() => parseDeployArguments(["--other"]), /Unknown deployment option/);
  assert.doesNotThrow(() => assertPluginEnabled(["pdf-plus", PLUGIN_ID]));
  assert.throws(() => assertPluginEnabled(["pdf-plus"]), /not enabled/);
  assert.throws(() => assertPluginEnabled({}), /array/);
});

test("deployment requires one exact, non-broad vault", () => {
  assert.throws(() => resolveVault({}), /PRACTICE_LAB_VAULT/);
  const configured = path.join(process.cwd(), "example-vault");
  assert.equal(resolveVault({ PRACTICE_LAB_VAULT: configured }), path.resolve(configured));
  assert.throws(
    () => assertAllowedVault(path.join(process.cwd(), "other"), { PRACTICE_LAB_VAULT: configured }),
    /does not match/
  );
  const root = path.parse(process.cwd()).root;
  assert.throws(() => assertAllowedVault(root, { PRACTICE_LAB_VAULT: root }), /unsafe/);
  assert.throws(() => assertAllowedVault(configured, {}), /PRACTICE_LAB_VAULT/);
});

test("deployment requires the exact target to be an open registered Obsidian vault", async () => {
  const tempRoot = path.join(os.tmpdir(), `practice-lab-registry-${process.pid}-${Date.now()}`);
  const registryFile = path.join(tempRoot, "obsidian.json");
  const vault = path.join(tempRoot, "Example Vault");
  const otherVault = path.join(tempRoot, "Other Vault");
  try {
    await mkdir(tempRoot, { recursive: true });
    await writeFile(registryFile, JSON.stringify({
      vaults: {
        closed: { path: vault, open: false },
        other: { path: otherVault, open: true }
      }
    }));
    await assert.rejects(
      () => assertRegisteredOpenVault(vault, registryFile),
      /not an open vault/
    );

    await writeFile(registryFile, JSON.stringify({
      vaults: { live: { path: vault, open: true } }
    }));
    await assert.doesNotReject(() => assertRegisteredOpenVault(vault, registryFile));
    assert.equal(
      resolveObsidianRegistry({ PRACTICE_LAB_OBSIDIAN_REGISTRY: registryFile }),
      path.resolve(registryFile)
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("atomic deployment preserves data and other enabled plugins, and records hashes", async () => {
  const tempRoot = path.join(os.tmpdir(), `practice-lab-deploy-${process.pid}-${Date.now()}`);
  const vault = path.join(tempRoot, "vault");
  const sourceRoot = path.join(tempRoot, "source");
  const obsidianRoot = path.join(vault, ".obsidian");
  const pluginRoot = path.join(obsidianRoot, "plugins", PLUGIN_ID);
  const registryFile = path.join(tempRoot, "obsidian.json");
  try {
    await mkdir(pluginRoot, { recursive: true });
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(path.join(obsidianRoot, "app.json"), "{}\n");
    await writeFile(path.join(obsidianRoot, "community-plugins.json"), '["pdf-plus","dataview"]\n');
    await writeFile(registryFile, JSON.stringify({ vaults: { live: { path: vault, open: true } } }));
    await writeFile(path.join(pluginRoot, "data.json"), '{"keep":true}\n');
    await writeFile(path.join(pluginRoot, "main.js"), "old-main\n");
    for (const artifact of RUNTIME_ARTIFACTS) {
      await writeFile(path.join(sourceRoot, artifact), `new-${artifact}\n`);
    }

    const result = await deploy({
      vault,
      root: sourceRoot,
      env: {
        PRACTICE_LAB_VAULT: vault,
        PRACTICE_LAB_OBSIDIAN_REGISTRY: registryFile
      }
    });

    assert.equal(await readFile(path.join(pluginRoot, "data.json"), "utf8"), '{"keep":true}\n');
    assert.equal(await readFile(path.join(pluginRoot, "main.js"), "utf8"), "new-main.js\n");
    assert.equal(await readFile(path.join(result.backupRoot, "main.js"), "utf8"), "old-main\n");
    assert.deepEqual(
      JSON.parse(await readFile(path.join(obsidianRoot, "community-plugins.json"), "utf8")),
      ["pdf-plus", "dataview", PLUGIN_ID]
    );
    assert.deepEqual(result.installedHashes, result.sourceHashes);
    const manifest = JSON.parse(await readFile(result.rollbackManifest, "utf8"));
    assert.equal(manifest.pluginRootExisted, true);
    assert.equal(manifest.communityFileTouched, true);
    assert.match(manifest.originalCommunityHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(manifest.sourceHashes).sort(), [...RUNTIME_ARTIFACTS].sort());
    const leftovers = (await readdir(pluginRoot)).filter((name) => name.endsWith(".practice-lab-new"));
    assert.deepEqual(leftovers, []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runtime-only deployment changes only whitelisted runtime artifacts", async () => {
  const tempRoot = path.join(os.tmpdir(), `practice-lab-runtime-deploy-${process.pid}-${Date.now()}`);
  const vault = path.join(tempRoot, "vault");
  const sourceRoot = path.join(tempRoot, "source");
  const obsidianRoot = path.join(vault, ".obsidian");
  const pluginRoot = path.join(obsidianRoot, "plugins", PLUGIN_ID);
  const registryFile = path.join(tempRoot, "obsidian.json");
  const noteFile = path.join(vault, "Notes", "untouched.md");
  const protectedFiles = [
    path.join(obsidianRoot, "app.json"),
    path.join(obsidianRoot, "community-plugins.json"),
    path.join(obsidianRoot, "workspace.json"),
    path.join(pluginRoot, "data.json"),
    noteFile
  ];
  try {
    await mkdir(pluginRoot, { recursive: true });
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(path.dirname(noteFile), { recursive: true });
    await writeFile(path.join(obsidianRoot, "app.json"), '{"theme":"obsidian"}\n');
    await writeFile(
      path.join(obsidianRoot, "community-plugins.json"),
      `["pdf-plus","${PLUGIN_ID}","dataview"]\n`
    );
    await writeFile(path.join(obsidianRoot, "workspace.json"), '{"keep":"workspace"}\n');
    await writeFile(path.join(pluginRoot, "data.json"), '{"keep":"settings"}\n');
    await writeFile(noteFile, "# Authored note must stay byte-identical\n");
    await writeFile(registryFile, JSON.stringify({ vaults: { live: { path: vault, open: true } } }));
    for (const artifact of RUNTIME_ARTIFACTS) {
      await writeFile(path.join(pluginRoot, artifact), `old-${artifact}\n`);
      await writeFile(path.join(sourceRoot, artifact), `new-${artifact}\n`);
    }
    const before = new Map();
    for (const file of protectedFiles) before.set(file, await readFile(file));

    const result = await deploy({
      vault,
      root: sourceRoot,
      runtimeOnly: true,
      env: {
        PRACTICE_LAB_VAULT: vault,
        PRACTICE_LAB_OBSIDIAN_REGISTRY: registryFile
      }
    });

    assert.equal(result.runtimeOnly, true);
    assert.equal(result.communityFileTouched, false);
    for (const file of protectedFiles) {
      assert.deepEqual(await readFile(file), before.get(file), `${file} changed`);
    }
    for (const artifact of RUNTIME_ARTIFACTS) {
      assert.equal(await readFile(path.join(pluginRoot, artifact), "utf8"), `new-${artifact}\n`);
      assert.equal(await readFile(path.join(result.backupRoot, artifact), "utf8"), `old-${artifact}\n`);
    }
    assert.deepEqual(result.installedHashes, result.sourceHashes);
    assert.deepEqual((await readdir(result.backupRoot)).sort(), [...RUNTIME_ARTIFACTS].sort());
    const manifest = JSON.parse(await readFile(result.rollbackManifest, "utf8"));
    assert.equal(manifest.mode, "runtime-only");
    assert.equal(manifest.communityFileTouched, false);
    assert.match(manifest.originalCommunityHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(manifest.sourceHashes, result.sourceHashes);
    assert.deepEqual(
      manifest.originalArtifacts,
      Object.fromEntries(RUNTIME_ARTIFACTS.map((artifact) => [artifact, sha256(`old-${artifact}\n`)]))
    );
    const pendingInPlugin = (await readdir(pluginRoot)).filter((name) => name.endsWith(".practice-lab-new"));
    assert.deepEqual(pendingInPlugin, []);
    const pendingInObsidian = (await readdir(obsidianRoot)).filter((name) => name.endsWith(".practice-lab-new"));
    assert.deepEqual(pendingInObsidian, []);
    const operationRoot = path.dirname(result.rollbackManifest);
    assert.equal((await readdir(operationRoot)).includes("stage"), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runtime-only deployment refuses to enable a disabled plugin", async () => {
  const tempRoot = path.join(os.tmpdir(), `practice-lab-runtime-disabled-${process.pid}-${Date.now()}`);
  const vault = path.join(tempRoot, "vault");
  const sourceRoot = path.join(tempRoot, "source");
  const obsidianRoot = path.join(vault, ".obsidian");
  const registryFile = path.join(tempRoot, "obsidian.json");
  try {
    await mkdir(obsidianRoot, { recursive: true });
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(path.join(obsidianRoot, "app.json"), "{}\n");
    await writeFile(path.join(obsidianRoot, "community-plugins.json"), '["pdf-plus"]\n');
    await writeFile(registryFile, JSON.stringify({ vaults: { live: { path: vault, open: true } } }));
    for (const artifact of RUNTIME_ARTIFACTS) {
      await writeFile(path.join(sourceRoot, artifact), `new-${artifact}\n`);
    }
    await assert.rejects(
      () => deploy({
        vault,
        root: sourceRoot,
        runtimeOnly: true,
        env: {
          PRACTICE_LAB_VAULT: vault,
          PRACTICE_LAB_OBSIDIAN_REGISTRY: registryFile
        }
      }),
      /not enabled/
    );
    assert.equal(await readFile(path.join(obsidianRoot, "community-plugins.json"), "utf8"), '["pdf-plus"]\n');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
