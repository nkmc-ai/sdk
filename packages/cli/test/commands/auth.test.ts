import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runAuth } from "../../src/commands/auth.js";
import { mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("runAuth", () => {
  let tempHome: string;
  const savedNkmcHome = process.env.NKMC_HOME;
  const savedGatewayUrl = process.env.NKMC_GATEWAY_URL;
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  function fakeJwt(iat: number, exp: number): string {
    const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iat, exp, sub: "agent-1" })).toString("base64url");
    return `${header}.${payload}.fakesig`;
  }

  beforeEach(async () => {
    tempHome = join(tmpdir(), `nkmc-auth-${Date.now()}`);
    await mkdir(tempHome, { recursive: true });
    process.env.NKMC_HOME = tempHome;
    delete process.env.NKMC_GATEWAY_URL;
    globalThis.fetch = mockFetch;
  });

  afterEach(async () => {
    if (savedNkmcHome === undefined) {
      delete process.env.NKMC_HOME;
    } else {
      process.env.NKMC_HOME = savedNkmcHome;
    }
    if (savedGatewayUrl === undefined) {
      delete process.env.NKMC_GATEWAY_URL;
    } else {
      process.env.NKMC_GATEWAY_URL = savedGatewayUrl;
    }
    globalThis.fetch = originalFetch;
    mockFetch.mockReset();
    await rm(tempHome, { recursive: true, force: true });
  });

  it("should fetch token from gateway and save to credentials", async () => {
    const iat = Math.floor(Date.now() / 1000);
    const token = fakeJwt(iat, iat + 86400);

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token }),
    });

    await runAuth({ gatewayUrl: "https://gw.test.com" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://gw.test.com/auth/token",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const creds = JSON.parse(
      await readFile(join(tempHome, "credentials.json"), "utf-8"),
    );
    expect(creds.gateways["https://gw.test.com"].token).toBe(token);
    expect(creds.default).toBe("https://gw.test.com");
  });

  it("should use default gateway URL when none provided", async () => {
    const iat = Math.floor(Date.now() / 1000);
    const token = fakeJwt(iat, iat + 86400);

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token }),
    });

    await runAuth({});

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.nkmc.ai/auth/token",
      expect.any(Object),
    );
  });

  it("should prefer NKMC_GATEWAY_URL env var over default", async () => {
    process.env.NKMC_GATEWAY_URL = "https://env-gw.test.com";
    const iat = Math.floor(Date.now() / 1000);
    const token = fakeJwt(iat, iat + 86400);

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token }),
    });

    await runAuth({});

    expect(mockFetch).toHaveBeenCalledWith(
      "https://env-gw.test.com/auth/token",
      expect.any(Object),
    );
  });

  it("should prefer explicit gatewayUrl over env var", async () => {
    process.env.NKMC_GATEWAY_URL = "https://env-gw.test.com";
    const iat = Math.floor(Date.now() / 1000);
    const token = fakeJwt(iat, iat + 86400);

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token }),
    });

    await runAuth({ gatewayUrl: "https://explicit-gw.test.com" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://explicit-gw.test.com/auth/token",
      expect.any(Object),
    );
  });

  it("should throw on non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });

    await expect(runAuth({ gatewayUrl: "https://gw.test.com" })).rejects.toThrow(
      "Auth failed (401): Unauthorized",
    );
  });

  it("should send correct request body", async () => {
    const iat = Math.floor(Date.now() / 1000);
    const token = fakeJwt(iat, iat + 86400);

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token }),
    });

    await runAuth({ gatewayUrl: "https://gw.test.com" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.sub).toMatch(/^agent-\d+$/);
    expect(body.svc).toBe("gateway");
    expect(body.roles).toEqual(["agent"]);
    expect(body.expiresIn).toBe("24h");
  });
});
