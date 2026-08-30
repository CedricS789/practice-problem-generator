import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("release metadata keeps the review runtime mobile-installable", async () => {
  const [manifest, packageJson, packageLock] = await Promise.all([
    readFile(new URL("../manifest.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse)
  ]);
  assert.equal(manifest.id, "practice-lab-ai");
  assert.equal(manifest.isDesktopOnly, false);
  assert.equal(packageJson.version, manifest.version);
  assert.equal(packageLock.version, manifest.version);
});

test("production bundle contains the PDF workflow, commands, dashboard, and local usage display without private paths or tracking SDKs", async () => {
  const bundle = await readFile(new URL("../main.js", import.meta.url), "utf8");
  for (const command of [
    "Generate from selection",
    "Generate from current note",
    "Generate from current PDF",
    "Open workspace",
    "Start practice for current note",
    "Start practice for current PDF",
    "Open practice dashboard"
  ]) assert.match(bundle, new RegExp(command));
  assert.match(bundle, /practice-lab/);
  assert.match(bundle, /practice-lab-dashboard-view/);
  assert.match(bundle, /Practice dashboard/);
  assert.match(bundle, /parent tags include nested tags/);
  assert.match(bundle, /Practice now/);
  assert.match(bundle, /Your progress/);
  assert.match(bundle, /Manage this practice/);
  assert.match(bundle, /Practice data managed by the plugin/);
  assert.match(bundle, /Provider default \(not pinned\)/);
  assert.match(bundle, /Choose PDF pages/);
  assert.match(bundle, /text extracted locally/);
  assert.match(bundle, /Practice run/);
  assert.match(bundle, /Best answer streak/);
  assert.match(bundle, /Monetary cost not reported by CLI/);
  assert.match(bundle, /Local text estimate/);
  assert.doesNotMatch(bundle, /C:\\Users\\|\/Users\/|\/home\/|CloudStorage/i);
  assert.doesNotMatch(bundle, /segment\.io|mixpanel|amplitude|posthog|sentry|opentelemetry|applicationinsights/i);
});

test("production bundle has no browser-native Node dynamic imports", async () => {
  const bundle = await readFile(new URL("../main.js", import.meta.url), "utf8");
  assert.doesNotMatch(bundle, /\bimport\s*\(\s*["']node:/u);
});

test("mobile bundle evaluation does not load Node modules", async () => {
  const mainPath = path.resolve(new URL("../main.js", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (value) => value.slice(1)));
  const script = String.raw`
    const Module = require("node:module");
    const builtins = new Set(Module.builtinModules.flatMap((name) => [name, "node:" + name]));
    const originalLoad = Module._load;
    const Empty = class {};
    const obsidian = new Proxy({
      Plugin: Empty,
      ItemView: Empty,
      Modal: Empty,
      PluginSettingTab: Empty,
      Setting: Empty,
      ButtonComponent: Empty,
      MarkdownView: Empty,
      Menu: Empty,
      Notice: Empty,
      TFile: Empty,
      WorkspaceLeaf: Empty,
      Platform: { isMobileApp: true },
      normalizePath: (value) => value,
      requestUrl: async () => { throw new Error("not invoked"); },
      setIcon: () => undefined
    }, { get: (target, key) => key in target ? target[key] : Empty });
    const loadedBuiltins = [];
    Module._load = function(request, parent, isMain) {
      if (request === "obsidian") return obsidian;
      if (builtins.has(request)) {
        loadedBuiltins.push(request);
        throw new Error("Node module loaded during mobile evaluation: " + request);
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    require(process.argv[1]);
    process.stdout.write(JSON.stringify(loadedBuiltins));
  `;
  const { stdout } = await execFileAsync(process.execPath, ["-e", script, mainPath], {
    env: { ...process.env, TMPDIR: os.tmpdir() }
  });
  assert.deepEqual(JSON.parse(stdout), []);
});
