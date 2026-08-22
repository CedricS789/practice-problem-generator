import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_ID = "practice-lab-ai";
export const RUNTIME_ARTIFACTS = ["main.js", "manifest.json", "styles.css"];
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(directory) {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function digest(file) {
  if (!(await isFile(file))) return null;
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function resolveVault(env = process.env) {
  const configured = env.PRACTICE_LAB_VAULT?.trim();
  if (!configured) throw new Error("Set PRACTICE_LAB_VAULT to the exact Obsidian vault to deploy.");
  return path.resolve(configured);
}

export function assertAllowedVault(vault, env = process.env) {
  const resolvedVault = path.resolve(vault);
  const configured = env.PRACTICE_LAB_VAULT?.trim();
  if (!configured) throw new Error("Set PRACTICE_LAB_VAULT before deploying.");
  const expected = path.normalize(path.resolve(configured)).toLowerCase();
  const actual = path.normalize(resolvedVault).toLowerCase();
  if (actual !== expected) {
    throw new Error(`Refusing a vault path that does not match PRACTICE_LAB_VAULT: ${vault}`);
  }
  if (path.parse(vault).root === resolvedVault || resolvedVault.length < 12) {
    throw new Error(`Refusing broad or unsafe vault path: ${vault}`);
  }
}

export function resolveObsidianRegistry(
  env = process.env,
  platform = process.platform,
  profileDirectory = homedir()
) {
  const configured = env.PRACTICE_LAB_OBSIDIAN_REGISTRY?.trim();
  if (configured) return path.resolve(configured);
  if (platform === "win32") {
    const applicationData = env.APPDATA?.trim() || path.join(profileDirectory, "AppData", "Roaming");
    return path.join(applicationData, "obsidian", "obsidian.json");
  }
  if (platform === "darwin") {
    return path.join(profileDirectory, "Library", "Application Support", "obsidian", "obsidian.json");
  }
  const configurationRoot = env.XDG_CONFIG_HOME?.trim() || path.join(profileDirectory, ".config");
  return path.join(configurationRoot, "obsidian", "obsidian.json");
}

function comparablePath(candidate, platform = process.platform) {
  const normalized = path.normalize(path.resolve(candidate));
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

export async function assertRegisteredOpenVault(
  vault,
  registryFile = resolveObsidianRegistry(),
  platform = process.platform
) {
  let registry;
  try {
    registry = JSON.parse(await readFile(registryFile, "utf8"));
  } catch (error) {
    throw new Error(`Could not read Obsidian's vault registry at ${registryFile}.`, { cause: error });
  }
  if (typeof registry !== "object" || registry === null || Array.isArray(registry)) {
    throw new Error(`Obsidian's vault registry is malformed: ${registryFile}`);
  }
  const vaults = registry.vaults;
  if (typeof vaults !== "object" || vaults === null || Array.isArray(vaults)) {
    throw new Error(`Obsidian's vault registry has no valid vault map: ${registryFile}`);
  }
  const target = comparablePath(vault, platform);
  const registeredOpen = Object.values(vaults).some((entry) => (
    typeof entry === "object"
      && entry !== null
      && !Array.isArray(entry)
      && typeof entry.path === "string"
      && entry.open === true
      && comparablePath(entry.path, platform) === target
  ));
  if (!registeredOpen) {
    throw new Error(
      `Refusing deployment because the exact target is not an open vault in Obsidian's registry: ${vault}`
    );
  }
}

export function mergeCommunityPlugins(current) {
  if (!Array.isArray(current) || current.some((value) => typeof value !== "string")) {
    throw new Error("community-plugins.json must be an array of plugin IDs.");
  }
  return current.includes(PLUGIN_ID) ? [...current] : [...current, PLUGIN_ID];
}

export function assertPluginEnabled(current) {
  if (!Array.isArray(current) || current.some((value) => typeof value !== "string")) {
    throw new Error("community-plugins.json must be an array of plugin IDs.");
  }
  if (!current.includes(PLUGIN_ID)) {
    throw new Error(
      `Refusing runtime-only deployment because ${PLUGIN_ID} is not enabled in community-plugins.json.`
    );
  }
}

export function parseDeployArguments(argumentsList = process.argv.slice(2)) {
  const unknown = argumentsList.filter((argument) => argument !== "--runtime-only");
  if (unknown.length > 0) {
    throw new Error(`Unknown deployment option: ${unknown.join(", ")}`);
  }
  return { runtimeOnly: argumentsList.includes("--runtime-only") };
}

export async function deploy({
  vault = resolveVault(),
  env = process.env,
  root = projectRoot,
  runtimeOnly = false
} = {}) {
  assertAllowedVault(vault, env);
  await assertRegisteredOpenVault(vault, resolveObsidianRegistry(env));
  const obsidianRoot = path.join(vault, ".obsidian");
  const appFile = path.join(obsidianRoot, "app.json");
  const communityFile = path.join(obsidianRoot, "community-plugins.json");
  const pluginRoot = path.join(obsidianRoot, "plugins", PLUGIN_ID);

  if (!(await isDirectory(obsidianRoot)) || !(await isFile(appFile))) {
    throw new Error(`Not an Obsidian vault with .obsidian/app.json: ${vault}`);
  }

  const sources = new Map();
  for (const artifact of RUNTIME_ARTIFACTS) {
    const source = path.join(root, artifact);
    if (!(await isFile(source))) throw new Error(`Missing built runtime artifact: ${source}`);
    sources.set(artifact, source);
  }

  let currentCommunity = [];
  if (await isFile(communityFile)) currentCommunity = JSON.parse(await readFile(communityFile, "utf8"));
  if (runtimeOnly) assertPluginEnabled(currentCommunity);
  const mergedCommunity = runtimeOnly ? null : mergeCommunityPlugins(currentCommunity);
  const originalCommunityHash = await digest(communityFile);
  const pluginRootExisted = await isDirectory(pluginRoot);
  const operationRoot = path.join(vault, ".tmp", `practice-lab-deploy-${timestamp()}`);
  const stageRoot = path.join(operationRoot, "stage");
  const backupRoot = path.join(operationRoot, "backup");
  await mkdir(stageRoot, { recursive: true });
  await mkdir(backupRoot, { recursive: true });

  const sourceHashes = {};
  for (const [artifact, source] of sources) {
    await copyFile(source, path.join(stageRoot, artifact));
    sourceHashes[artifact] = await digest(source);
  }
  if (!runtimeOnly) await writeJson(path.join(stageRoot, "community-plugins.json"), mergedCommunity);

  const originalArtifacts = {};
  if (pluginRootExisted) {
    for (const artifact of RUNTIME_ARTIFACTS) {
      const existing = path.join(pluginRoot, artifact);
      originalArtifacts[artifact] = await digest(existing);
      if (await isFile(existing)) await copyFile(existing, path.join(backupRoot, artifact));
    }
  }
  if (!runtimeOnly && await isFile(communityFile)) {
    await copyFile(communityFile, path.join(backupRoot, "community-plugins.json"));
  }

  const rollbackManifest = path.join(operationRoot, "rollback-manifest.json");
  await writeJson(rollbackManifest, {
    version: 1,
    createdAt: new Date().toISOString(),
    mode: runtimeOnly ? "runtime-only" : "full",
    vault,
    pluginRoot,
    pluginRootExisted,
    communityFileTouched: !runtimeOnly,
    originalCommunityHash,
    originalArtifacts,
    sourceHashes,
    runtimeArtifacts: RUNTIME_ARTIFACTS
  });

  await mkdir(pluginRoot, { recursive: true });
  try {
    if (await digest(communityFile) !== originalCommunityHash) {
      throw new Error(
        runtimeOnly
          ? "Obsidian configuration changed during deployment staging; retry when that file is stable."
          : "Obsidian configuration changed during deployment staging; retry after closing Obsidian."
      );
    }
    if (runtimeOnly) {
      const enabledPlugins = JSON.parse(await readFile(communityFile, "utf8"));
      assertPluginEnabled(enabledPlugins);
    }
    for (const artifact of RUNTIME_ARTIFACTS) {
      const destination = path.join(pluginRoot, artifact);
      const pending = `${destination}.practice-lab-new`;
      await copyFile(path.join(stageRoot, artifact), pending);
      await rename(pending, destination);
    }
    if (!runtimeOnly) {
      const pendingCommunity = `${communityFile}.practice-lab-new`;
      await copyFile(path.join(stageRoot, "community-plugins.json"), pendingCommunity);
      await rename(pendingCommunity, communityFile);
    }

    const installedHashes = {};
    for (const artifact of RUNTIME_ARTIFACTS) {
      installedHashes[artifact] = await digest(path.join(pluginRoot, artifact));
    }
    if (JSON.stringify(installedHashes) !== JSON.stringify(sourceHashes)) {
      throw new Error("Installed runtime hashes do not match the built artifacts.");
    }
    if (runtimeOnly && await digest(communityFile) !== originalCommunityHash) {
      throw new Error("Obsidian configuration changed during runtime-only deployment.");
    }
  } catch (error) {
    for (const artifact of RUNTIME_ARTIFACTS) {
      const destination = path.join(pluginRoot, artifact);
      const saved = path.join(backupRoot, artifact);
      if (await isFile(saved)) await copyFile(saved, destination);
      else await rm(destination, { force: true });
      await rm(`${destination}.practice-lab-new`, { force: true });
    }
    if (!runtimeOnly) {
      const savedCommunity = path.join(backupRoot, "community-plugins.json");
      if (await isFile(savedCommunity)) await copyFile(savedCommunity, communityFile);
      else await rm(communityFile, { force: true });
      await rm(`${communityFile}.practice-lab-new`, { force: true });
    }
    if (!pluginRootExisted) {
      try {
        await rmdir(pluginRoot);
      } catch {
        // Preserve any concurrently created, non-runtime files in the plugin directory.
      }
    }
    throw error;
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }

  const installedHashes = {};
  for (const artifact of RUNTIME_ARTIFACTS) {
    installedHashes[artifact] = await digest(path.join(pluginRoot, artifact));
  }

  return {
    vault,
    pluginRoot,
    backupRoot,
    rollbackManifest,
    sourceHashes,
    installedHashes,
    communityFileTouched: !runtimeOnly,
    runtimeOnly
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await deploy(parseDeployArguments());
  process.stdout.write(
    `Deployed ${PLUGIN_ID} ${result.runtimeOnly ? "runtime artifacts" : "and enabled it"} at ${result.pluginRoot}\n`
    + `Backup: ${result.backupRoot}\n`
    + `Rollback manifest: ${result.rollbackManifest}\n`
  );
}
