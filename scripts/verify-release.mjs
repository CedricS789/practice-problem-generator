import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const json = async (name) => JSON.parse(await readFile(path.join(root, name), "utf8"));
const [manifest, packageJson, packageLock, versions] = await Promise.all([
  json("manifest.json"),
  json("package.json"),
  json("package-lock.json"),
  json("versions.json")
]);

assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.id, "practice-lab-ai");
assert.equal(manifest.name, "Grounded Problems");
assert.equal(manifest.isDesktopOnly, false, "saved banks and review must remain mobile-capable");
assert.equal(packageJson.private, true);
assert.equal(packageJson.version, manifest.version);
assert.equal(packageLock.version, manifest.version);
assert.equal(packageLock.packages?.[""]?.version, manifest.version);
assert.equal(versions[manifest.version], manifest.minAppVersion);
assert.ok(manifest.description.length <= 250);
assert.ok(manifest.description.endsWith("."));
assert.equal(packageJson.dependencies?.ajv, "8.20.0");

for (const artifact of ["README.md", "LICENSE", "manifest.json", "versions.json", "styles.css", "main.js"]) {
  await access(path.join(root, artifact));
}

process.stdout.write(`Release metadata verified for ${manifest.id} ${manifest.version}.\n`);
