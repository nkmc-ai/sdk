import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerService, resolveToken, runRegister } from "../../src/commands/register.js";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { signPublishToken } from "@nkmc/core";
import { generateGatewayKeyPair } from "@nkmc/core/testing";

describe("registerService", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `nkmc-test-${Date.now()}`);
    await mkdir(join(tempDir, ".well-known"), { recursive: true });
    await writeFile(
      join(tempDir, ".well-known", "skill.md"),
      "---\nname: Test\n---\n# Test Service\nA test.",
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should POST skill.md to gateway with token", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, domain: "test.com", name: "Test" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await registerService({
      gatewayUrl: "http://localhost:3070",
      token: "my-publish-token",
      domain: "test.com",
      skillMdPath: join(tempDir, ".well-known", "skill.md"),
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "http://localhost:3070/registry/services?domain=test.com",
    );
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer my-publish-token");
    expect(opts.headers["Content-Type"]).toBe("text/markdown");
    expect(opts.body).toContain("# Test Service");
  });

  it("should throw on HTTP error", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      registerService({
        gatewayUrl: "http://localhost:3070",
        token: "secret",
        domain: "test.com",
        skillMdPath: join(tempDir, ".well-known", "skill.md"),
      }),
    ).rejects.toThrow("Registration failed (500)");
  });

  it("should throw on empty skill.md", async () => {
    await writeFile(join(tempDir, ".well-known", "skill.md"), "");

    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      registerService({
        gatewayUrl: "http://localhost:3070",
        token: "secret",
        domain: "test.com",
        skillMdPath: join(tempDir, ".well-known", "skill.md"),
      }),
    ).rejects.toThrow("skill.md is empty");

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("resolveToken", () => {
  let tempHome: string;
  const savedEnv = {
    NKMC_HOME: process.env.NKMC_HOME,
    NKMC_PUBLISH_TOKEN: process.env.NKMC_PUBLISH_TOKEN,
    NKMC_ADMIN_TOKEN: process.env.NKMC_ADMIN_TOKEN,
  };

  beforeEach(async () => {
    tempHome = join(tmpdir(), `nkmc-resolve-${Date.now()}`);
    await mkdir(tempHome, { recursive: true });
    process.env.NKMC_HOME = tempHome;
    delete process.env.NKMC_PUBLISH_TOKEN;
    delete process.env.NKMC_ADMIN_TOKEN;
  });

  afterEach(async () => {
    // Restore env
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
    vi.restoreAllMocks();
    await rm(tempHome, { recursive: true, force: true });
  });

  it("should prefer --token flag", async () => {
    const token = await resolveToken({ token: "explicit-token" });
    expect(token).toBe("explicit-token");
  });

  it("should use NKMC_PUBLISH_TOKEN env var", async () => {
    process.env.NKMC_PUBLISH_TOKEN = "env-publish-token";
    const token = await resolveToken({});
    expect(token).toBe("env-publish-token");
  });

  it("should read from credentials file for domain", async () => {
    const { privateKey } = await generateGatewayKeyPair();
    const publishToken = await signPublishToken(privateKey, "api.example.com");

    const { saveToken } = await import("../../src/credentials.js");
    await saveToken("api.example.com", publishToken);

    const token = await resolveToken({ domain: "api.example.com" });
    expect(token).toBe(publishToken);
  });

  it("should fall back to --admin-token with deprecation warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const token = await resolveToken({ adminToken: "old-admin-token" });
    expect(token).toBe("old-admin-token");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("deprecated"),
    );
  });

  it("should fall back to NKMC_ADMIN_TOKEN env var", async () => {
    process.env.NKMC_ADMIN_TOKEN = "env-admin-token";
    const token = await resolveToken({});
    expect(token).toBe("env-admin-token");
  });

  it("should throw when no token source available", async () => {
    await expect(resolveToken({})).rejects.toThrow("No auth token found");
  });

  it("should respect priority: --token > NKMC_PUBLISH_TOKEN > credentials > --admin-token", async () => {
    process.env.NKMC_PUBLISH_TOKEN = "env-token";
    const token = await resolveToken({
      token: "explicit",
      adminToken: "admin",
      domain: "test.com",
    });
    expect(token).toBe("explicit");
  });

  it("should prefer NKMC_PUBLISH_TOKEN over credentials and admin-token", async () => {
    process.env.NKMC_PUBLISH_TOKEN = "env-publish";
    const token = await resolveToken({
      adminToken: "admin",
      domain: "test.com",
    });
    expect(token).toBe("env-publish");
  });
});

describe("runRegister", () => {
  const savedEnv = {
    NKMC_GATEWAY_URL: process.env.NKMC_GATEWAY_URL,
    NKMC_DOMAIN: process.env.NKMC_DOMAIN,
  };

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
    vi.restoreAllMocks();
  });

  it("should default gatewayUrl to https://api.nkmc.ai when missing", async () => {
    delete process.env.NKMC_GATEWAY_URL;
    // Without NKMC_GATEWAY_URL, runRegister defaults to https://api.nkmc.ai
    // and proceeds (no "Gateway URL is required" error).
    // It will fail later because skill.md doesn't exist in cwd.
    await expect(
      runRegister({ domain: "test.com", token: "t" }),
    ).rejects.toThrow("ENOENT");
  });

  it("should throw if domain is missing", async () => {
    delete process.env.NKMC_DOMAIN;
    await expect(
      runRegister({ gatewayUrl: "https://gw.test.com", token: "t" }),
    ).rejects.toThrow("Domain is required");
  });

  it("should use env var fallbacks for gatewayUrl and domain", async () => {
    process.env.NKMC_GATEWAY_URL = "https://env-gw.test.com";
    process.env.NKMC_DOMAIN = "env-domain.com";

    const tempDir = join(tmpdir(), `nkmc-reg-${Date.now()}`);
    await mkdir(join(tempDir, ".well-known"), { recursive: true });
    await writeFile(
      join(tempDir, ".well-known", "skill.md"),
      "---\nname: Test\n---\n# Test",
    );

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, domain: "env-domain.com", name: "Test" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await runRegister({ token: "my-token", dir: tempDir });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("env-gw.test.com");
    expect(url).toContain("env-domain.com");

    await rm(tempDir, { recursive: true, force: true });
  });
});
