import { App, requestUrl, TFile, normalizePath } from "obsidian";
export {
  extractSelectedFrame,
  gifFrameAtPosition,
  sampleAnimatedFrames,
  type MediaToolOptions,
  type SampledFrame
} from "./media-tools";

const SNAPSHOT_ROOT = "_Vault/Attachments/Grounded Problems";

export interface ImportedSnapshot {
  path: string;
  hash: string;
  bytes: number;
  created: boolean;
}

export interface RemoteImageConsent {
  url: string;
  approvedHost: string;
}

export interface DownloadedRemoteImage {
  readonly bytes: ArrayBuffer;
  readonly extension: "png" | "jpg" | "webp" | "gif";
  readonly mimeType: string;
  readonly host: string;
}

export async function readVaultBinary(app: App, path: string): Promise<ArrayBuffer> {
  const file = app.vault.getAbstractFileByPath(normalizePath(path));
  if (!(file instanceof TFile)) throw new Error(`Visual file is missing: ${path}`);
  return app.vault.readBinary(file);
}

export async function readNotabilityPreview(app: App, regionId: string): Promise<ArrayBuffer> {
  if (!/^nr-[a-f0-9-]{36}$/i.test(regionId)) throw new Error("Invalid Notability region ID.");
  const pluginRoot = normalizePath(`${app.vault.configDir}/plugins/notability-live-region`);
  const manifestPath = `${pluginRoot}/manifest.json`;
  if (!await app.vault.adapter.exists(manifestPath)) {
    throw new Error("Notability Live Region is not installed.");
  }
  const manifest = JSON.parse(await app.vault.adapter.read(manifestPath)) as { version?: unknown };
  if (typeof manifest.version !== "string" || !manifest.version.startsWith("1.1.")) {
    throw new Error("Grounded Problems supports Notability Live Region 1.1.x previews.");
  }
  const cachePath = normalizePath(`${pluginRoot}/cache/${regionId}.png`);
  if (!await app.vault.adapter.exists(cachePath)) {
    throw new Error("The Notability preview is missing. Open the region once, then retry.");
  }
  return app.vault.adapter.readBinary(cachePath);
}

export async function importRemoteImage(
  app: App,
  consent: RemoteImageConsent
): Promise<ImportedSnapshot> {
  const downloaded = await downloadRemoteImage(consent);
  return persistSnapshot(app, downloaded.bytes, downloaded.extension);
}

export async function downloadRemoteImage(
  consent: RemoteImageConsent
): Promise<DownloadedRemoteImage> {
  const parsed = new URL(consent.url);
  if (parsed.protocol !== "https:") throw new Error("Remote images must use HTTPS.");
  if (parsed.host !== consent.approvedHost) throw new Error("The approved host does not match the image URL.");
  const response = await requestUrl({ url: parsed.toString(), method: "GET", throw: false });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Remote image download failed with HTTP ${response.status}.`);
  }
  const contentType = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const extension = extensionForImageMime(contentType);
  if (!extension) throw new Error(`Remote resource is not a supported image (${contentType || "unknown type"}).`);
  return {
    bytes: response.arrayBuffer,
    extension,
    mimeType: contentType,
    host: parsed.host
  };
}

export async function persistPngSnapshot(app: App, bytes: ArrayBuffer): Promise<ImportedSnapshot> {
  return persistSnapshot(app, bytes, "png");
}

export async function persistSnapshot(
  app: App,
  bytes: ArrayBuffer,
  extension: "png" | "jpg" | "webp" | "gif"
): Promise<ImportedSnapshot> {
  const hash = await sha256(bytes);
  const target = normalizePath(`${SNAPSHOT_ROOT}/${hash}.${extension}`);
  await ensureVaultFolder(app, SNAPSHOT_ROOT);
  const existing = app.vault.getAbstractFileByPath(target);
  if (existing) {
    if (!(existing instanceof TFile)) throw new Error(`Snapshot path is occupied by a folder: ${target}`);
    return { path: target, hash, bytes: bytes.byteLength, created: false };
  }
  await app.vault.createBinary(target, bytes.slice(0));
  return { path: target, hash, bytes: bytes.byteLength, created: true };
}

async function ensureVaultFolder(app: App, folder: string): Promise<void> {
  const parts = normalizePath(folder).split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
  }
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function extensionForImageMime(mime: string): "png" | "jpg" | "webp" | "gif" | null {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return null;
}
