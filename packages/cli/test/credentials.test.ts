import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadCredentials, saveToken, getToken, saveAgentToken, getAgentToken, saveGatewayToken, getGatewayToken, getDefaultGateway, saveTunnelInfo, getTunnelInfo, clearTunnelInfo } from "../src/credentials.js";
import { mkdir, rm, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { signPublishToken } from "@nkmc/core";
import { generateGatewayKeyPair } from "@nkmc/core/testing";

function fakeJwt(iat: number, exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat, exp, sub: "agent-1" })).toString("base64url");
  return `${header}.${payload}.fakesig`;
}

describe("credentials", () => {
  let tempHome: string;
  const savedNkmcHome = process.env.NKMC_HOME;

  beforeEach(async () => {
    tempHome = join(tmpdir(), `nkmc-cred-${Date.now()}`);
    await mkdir(tempHome, { recursive: true });
    process.env.NKMC_HOME = tempHome;
  });

  afterEach(async () => {
    if (savedNkmcHome === undefined) {
      delete process.env.NKMC_HOME;
    } else {
      process.env.NKMC_HOME = savedNkmcHome;
    }
    await rm(tempHome, { recursive: true, force: true });
  });

  describe("loadCredentials", () => {
    it("should return empty store when file does not exist", async () => {
      const creds = await loadCredentials();
      expect(creds).toEqual({ tokens: {} });
    });

    it("should load existing credentials", async () => {
      const data = {
        tokens: {
          "api.example.com": {
            publishToken: "token123",
            issuedAt: "2025-01-01T00:00:00.000Z",
            expiresAt: "2025-04-01T00:00:00.000Z",
          },
        },
      };
      await writeFile(join(tempHome, "credentials.json"), JSON.stringify(data));
      const creds = await loadCredentials();
      expect(creds.tokens["api.example.com"].publishToken).toBe("token123");
    });

    it("should migrate legacy agentToken to gateways format", async () => {
      const data = {
        tokens: {},
        agentToken: {
          token: "legacy-jwt",
          gatewayUrl: "https://api.nkmc.ai",
          issuedAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2026-01-02T00:00:00.000Z",
        },
      };
      await writeFile(join(tempHome, "credentials.json"), JSON.stringify(data));
      const creds = await loadCredentials();
      expect(creds.agentToken).toBeUndefined();
      expect(creds.gateways?.["https://api.nkmc.ai"]?.token).toBe("legacy-jwt");
      expect(creds.default).toBe("https://api.nkmc.ai");
    });
  });

  describe("saveGatewayToken (multi-gateway)", () => {
    it("should save gateway token under gateways key", async () => {
      const iat = Math.floor(Date.now() / 1000);
      const token = fakeJwt(iat, iat + 86400);

      await saveGatewayToken("https://api.nkmc.ai", token);

      const raw = await readFile(join(tempHome, "credentials.json"), "utf-8");
      const creds = JSON.parse(raw);
      expect(creds.gateways["https://api.nkmc.ai"].token).toBe(token);
      expect(creds.default).toBe("https://api.nkmc.ai");
    });

    it("should support multiple gateways simultaneously", async () => {
      const iat = Math.floor(Date.now() / 1000);
      const token1 = fakeJwt(iat, iat + 86400);
      const token2 = fakeJwt(iat + 1, iat + 86401);

      await saveGatewayToken("https://api.nkmc.ai", token1);
      await saveGatewayToken("http://localhost:9090", token2);

      const raw = await readFile(join(tempHome, "credentials.json"), "utf-8");
      const creds = JSON.parse(raw);
      expect(creds.gateways["https://api.nkmc.ai"].token).toBe(token1);
      expect(creds.gateways["http://localhost:9090"].token).toBe(token2);
      expect(creds.default).toBe("http://localhost:9090"); // last one wins
    });

    it("should set file permissions to 0600", async () => {
      const iat = Math.floor(Date.now() / 1000);
      await saveGatewayToken("https://api.nkmc.ai", fakeJwt(iat, iat + 86400));
      const stats = await stat(join(tempHome, "credentials.json"));
      expect(stats.mode & 0o777).toBe(0o600);
    });
  });

  describe("getGatewayToken", () => {
    it("should return null for unknown gateway", async () => {
      expect(await getGatewayToken("https://unknown.com")).toBeNull();
    });

    it("should return stored token", async () => {
      const iat = Math.floor(Date.now() / 1000);
      const token = fakeJwt(iat, iat + 86400);
      await saveGatewayToken("https://api.nkmc.ai", token);
      const result = await getGatewayToken("https://api.nkmc.ai");
      expect(result?.token).toBe(token);
    });

    it("should return null for expired token", async () => {
      const iat = Math.floor(Date.now() / 1000) - 200000;
      const token = fakeJwt(iat, iat + 1); // expired
      await saveGatewayToken("https://api.nkmc.ai", token);
      expect(await getGatewayToken("https://api.nkmc.ai")).toBeNull();
    });
  });

  describe("getDefaultGateway", () => {
    it("should return null when no gateways", async () => {
      expect(await getDefaultGateway()).toBeNull();
    });

    it("should return the last authenticated gateway", async () => {
      const iat = Math.floor(Date.now() / 1000);
      await saveGatewayToken("https://api.nkmc.ai", fakeJwt(iat, iat + 86400));
      await saveGatewayToken("http://localhost:9090", fakeJwt(iat, iat + 86400));
      const result = await getDefaultGateway();
      expect(result?.url).toBe("http://localhost:9090");
    });
  });

  describe("tunnel info", () => {
    it("should save and retrieve tunnel info", async () => {
      const iat = Math.floor(Date.now() / 1000);
      await saveGatewayToken("http://localhost:9090", fakeJwt(iat, iat + 86400));
      await saveTunnelInfo("http://localhost:9090", { id: "abc", publicUrl: "https://abc.tunnel.nkmc.ai" });

      const info = await getTunnelInfo("http://localhost:9090");
      expect(info?.id).toBe("abc");
      expect(info?.publicUrl).toBe("https://abc.tunnel.nkmc.ai");
    });

    it("should clear tunnel info", async () => {
      const iat = Math.floor(Date.now() / 1000);
      await saveGatewayToken("http://localhost:9090", fakeJwt(iat, iat + 86400));
      await saveTunnelInfo("http://localhost:9090", { id: "abc", publicUrl: "https://abc.tunnel.nkmc.ai" });
      await clearTunnelInfo("http://localhost:9090");
      expect(await getTunnelInfo("http://localhost:9090")).toBeNull();
    });
  });

  describe("saveAgentToken (legacy compat)", () => {
    it("should save as gateway token", async () => {
      const iat = Math.floor(Date.now() / 1000);
      const token = fakeJwt(iat, iat + 86400);
      await saveAgentToken("https://api.nkmc.ai", token);

      const raw = await readFile(join(tempHome, "credentials.json"), "utf-8");
      const creds = JSON.parse(raw);
      expect(creds.gateways["https://api.nkmc.ai"].token).toBe(token);
    });

    it("should preserve existing publish tokens", async () => {
      const { privateKey } = await generateGatewayKeyPair();
      const publishToken = await signPublishToken(privateKey, "example.com");
      await saveToken("example.com", publishToken);

      const iat = Math.floor(Date.now() / 1000);
      await saveAgentToken("https://api.nkmc.ai", fakeJwt(iat, iat + 86400));

      const raw = await readFile(join(tempHome, "credentials.json"), "utf-8");
      const creds = JSON.parse(raw);
      expect(creds.tokens["example.com"].publishToken).toBe(publishToken);
    });
  });

  describe("getAgentToken (legacy compat)", () => {
    it("should return null when no agent token stored", async () => {
      expect(await getAgentToken()).toBeNull();
    });

    it("should return stored agent token via default gateway", async () => {
      const iat = Math.floor(Date.now() / 1000);
      const token = fakeJwt(iat, iat + 86400);
      await saveAgentToken("https://api.nkmc.ai", token);

      const result = await getAgentToken();
      expect(result).not.toBeNull();
      expect(result!.token).toBe(token);
      expect(result!.url).toBe("https://api.nkmc.ai");
    });

    it("should return null for expired agent token", async () => {
      const data = {
        tokens: {},
        gateways: {
          "https://api.nkmc.ai": {
            token: "expired-jwt",
            issuedAt: "2020-01-01T00:00:00.000Z",
            expiresAt: "2020-01-02T00:00:00.000Z",
          },
        },
        default: "https://api.nkmc.ai",
      };
      await writeFile(join(tempHome, "credentials.json"), JSON.stringify(data));
      expect(await getAgentToken()).toBeNull();
    });
  });

  describe("saveToken / getToken (publish tokens)", () => {
    it("should save and retrieve publish token", async () => {
      const { privateKey } = await generateGatewayKeyPair();
      const token = await signPublishToken(privateKey, "api.example.com");
      await saveToken("api.example.com", token);
      expect(await getToken("api.example.com")).toBe(token);
    });

    it("should return null for unknown domain", async () => {
      expect(await getToken("unknown.com")).toBeNull();
    });

    it("should return null for expired token", async () => {
      const data = {
        tokens: {
          "expired.com": {
            publishToken: "old-token",
            issuedAt: "2020-01-01T00:00:00.000Z",
            expiresAt: "2020-04-01T00:00:00.000Z",
          },
        },
      };
      await writeFile(join(tempHome, "credentials.json"), JSON.stringify(data));
      expect(await getToken("expired.com")).toBeNull();
    });

    it("should set file permissions to 0600", async () => {
      const { privateKey } = await generateGatewayKeyPair();
      await saveToken("test.com", await signPublishToken(privateKey, "test.com"));
      const stats = await stat(join(tempHome, "credentials.json"));
      expect(stats.mode & 0o777).toBe(0o600);
    });
  });
});
