import { existsSync, mkdirSync, createWriteStream, chmodSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform, arch } from "node:os";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execSync } from "node:child_process";

function getBinDir(): string {
  const base = process.env.NKMC_HOME || join(homedir(), ".nkmc");
  const dir = join(base, "bin");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function getBinaryName(): string {
  return platform() === "win32" ? "cloudflared.exe" : "cloudflared";
}

/**
 * Resolve the download URL for cloudflared.
 * macOS uses .tgz archives, Linux/Windows use raw binaries.
 */
async function getDownloadInfo(): Promise<{ url: string; isTgz: boolean }> {
  const os = platform();
  const cpu = arch();

  let osName: string;
  let archName: string;

  if (os === "darwin") {
    osName = "darwin";
    archName = cpu === "arm64" ? "arm64" : "amd64";
  } else if (os === "linux") {
    osName = "linux";
    archName = cpu === "arm64" ? "arm64" : "amd64";
  } else if (os === "win32") {
    osName = "windows";
    archName = cpu === "x64" ? "amd64" : "386";
  } else {
    throw new Error(`Unsupported platform: ${os}`);
  }

  const ext = os === "win32" ? ".exe" : "";
  const isTgz = os === "darwin";
  const filename = isTgz
    ? `cloudflared-${osName}-${archName}.tgz`
    : `cloudflared-${osName}-${archName}${ext}`;

  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${filename}`;
  return { url, isTgz };
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

  const { url, isTgz } = await getDownloadInfo();
  console.log(`Downloading cloudflared...`);
  console.log(`  From: ${url}`);

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download cloudflared: ${res.status}`);
  }

  const binDir = getBinDir();

  if (isTgz) {
    // macOS: download .tgz, extract cloudflared binary
    const tgzPath = join(binDir, "cloudflared.tgz");
    const readable = Readable.fromWeb(res.body as any);
    const ws = createWriteStream(tgzPath);
    await pipeline(readable, ws);

    execSync(`tar -xzf "${tgzPath}" -C "${binDir}" cloudflared`, { stdio: "ignore" });
    try { unlinkSync(tgzPath); } catch {}
  } else {
    // Linux/Windows: direct binary download
    const readable = Readable.fromWeb(res.body as any);
    const ws = createWriteStream(binPath);
    await pipeline(readable, ws);
  }

  chmodSync(binPath, 0o755);
  console.log(`  Saved to: ${binPath}`);
  return binPath;
}
