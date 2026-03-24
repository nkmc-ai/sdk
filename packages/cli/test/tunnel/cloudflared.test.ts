import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set NKMC_HOME to temp dir before importing
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "nkmc-cf-test-"));
  process.env.NKMC_HOME = tempDir;
});

afterEach(() => {
  delete process.env.NKMC_HOME;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("cloudflared", () => {
  it("getCloudflaredPath returns path under NKMC_HOME/bin", async () => {
    const { getCloudflaredPath } = await import("../../src/tunnel/cloudflared.js");
    const path = getCloudflaredPath();
    expect(path).toContain(join(tempDir, "bin"));
    expect(path).toContain("cloudflared");
  });

  it("isCloudflaredInstalled returns false when binary missing", async () => {
    const { isCloudflaredInstalled } = await import("../../src/tunnel/cloudflared.js");
    expect(isCloudflaredInstalled()).toBe(false);
  });

  it("isCloudflaredInstalled returns true when binary exists", async () => {
    const { isCloudflaredInstalled, getCloudflaredPath } = await import("../../src/tunnel/cloudflared.js");
    const binPath = getCloudflaredPath();
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(tempDir, "bin"), { recursive: true });
    writeFileSync(binPath, "fake-binary");
    expect(isCloudflaredInstalled()).toBe(true);
  });

  it("ensureCloudflared skips download when already installed", async () => {
    const { ensureCloudflared, getCloudflaredPath } = await import("../../src/tunnel/cloudflared.js");
    const binPath = getCloudflaredPath();
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(tempDir, "bin"), { recursive: true });
    writeFileSync(binPath, "fake-binary");

    const result = await ensureCloudflared();
    expect(result).toBe(binPath);
  });
});
