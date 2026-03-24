import { existsSync, mkdirSync, createWriteStream, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform, arch } from "node:os";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const CLOUDFLARED_FALLBACK_VERSION = "2026.3.0";

function getBinDir(): string {
  const base = process.env.NKMC_HOME || join(homedir(), ".nkmc");
  const dir = join(base, "bin");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function getBinaryName(): string {
  return platform() === "win32" ? "cloudflared.exe" : "cloudflared";
}

function getBinaryName_(): { osName: string; archName: string; ext: string } {
  const os = platform();
  const cpu = arch();

  if (os === "darwin") {
    return { osName: "darwin", archName: cpu === "arm64" ? "arm64" : "amd64", ext: "" };
  } else if (os === "linux") {
    return { osName: "linux", archName: cpu === "arm64" ? "arm64" : "amd64", ext: "" };
  } else if (os === "win32") {
    return { osName: "windows", archName: cpu === "x64" ? "amd64" : "386", ext: ".exe" };
  }
  throw new Error(`Unsupported platform: ${os}`);
}

async function getDownloadUrl(): Promise<string> {
  const { osName, archName, ext } = getBinaryName_();
  const filename = `cloudflared-${osName}-${archName}${ext}`;

  // Try latest release URL (follows redirect to actual version)
  const latestUrl = `https://github.com/cloudflare/cloudflared/releases/latest/download/${filename}`;
  const head = await fetch(latestUrl, { method: "HEAD", redirect: "follow" });
  if (head.ok) return latestUrl;

  // Fallback to hardcoded version
  return `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_FALLBACK_VERSION}/${filename}`;
}

export function getCloudflaredPath(): string {
  return join(getBinDir(), getBinaryName());
}

export function isCloudflaredInstalled(): boolean {
  return existsSync(getCloudflaredPath());
}

export async function ensureCloudflared(): Promise<string> {
  const binPath = getCloudflaredPath();
  if (existsSync(binPath)) return binPath;

  const url = await getDownloadUrl();
  console.log(`Downloading cloudflared...`);
  console.log(`  From: ${url}`);

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download cloudflared: ${res.status}`);
  }

  const readable = Readable.fromWeb(res.body as any);
  const ws = createWriteStream(binPath);
  await pipeline(readable, ws);

  chmodSync(binPath, 0o755);
  console.log(`  Saved to: ${binPath}`);
  return binPath;
}
