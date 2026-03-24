import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { detectFramework } from "../../src/scanner/detect.js";
import { scanRoutes, type ScannedRoute } from "../../src/scanner/routes.js";

const CODES = join(homedir(), "Codes");

/**
 * E2E tests that scan real local projects in ~/Codes/.
 * Assert against the exact route list to catch regressions
 * (e.g. .wrangler false positives, non-path string leaks).
 *
 * Tests are skipped if the project directory doesn't exist.
 */

/** Sort route pairs for stable comparison */
function toSortedPairs(routes: ScannedRoute[]): [string, string][] {
  return routes
    .map((r) => [r.method, r.path] as [string, string])
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
}

// ─── shipcast ──────────────────────────────────────────────

describe.skipIf(!existsSync(join(CODES, "shipcast")))("E2E: shipcast", () => {
  const projectDir = join(CODES, "shipcast");

  const EXPECTED: [string, string][] = [
    ["DELETE", "/api/products/:id"],
    ["GET", "/api/billing/status"],
    ["GET", "/api/github/installations"],
    ["GET", "/api/github/installations/:id/repos"],
    ["GET", "/api/github/repos/:owner/:repo/commits"],
    ["GET", "/api/history"],
    ["GET", "/api/history/:id"],
    ["GET", "/api/images/*"],
    ["GET", "/api/products"],
    ["GET", "/api/products/:id"],
    ["GET", "/api/products/:id/twitter/connect"],
    ["GET", "/api/tweet-preview/:productId"],
    ["GET", "/api/twitter/callback"],
    ["GET", "/auth/callback"],
    ["GET", "/auth/github"],
    ["GET", "/auth/github-app/callback"],
    ["GET", "/auth/me"],
    ["GET", "/health"],
    ["POST", "/api/billing/checkout"],
    ["POST", "/api/billing/checkout-wechat"],
    ["POST", "/api/billing/portal"],
    ["POST", "/api/billing/webhook"],
    ["POST", "/api/changes"],
    ["POST", "/api/preview/:productId"],
    ["POST", "/api/products"],
    ["POST", "/api/publish/:productId"],
    ["POST", "/api/tweet-preview/:productId"],
    ["POST", "/auth/logout"],
    ["PUT", "/api/products/:id"],
  ];

  it("should detect hono framework", async () => {
    const detected = await detectFramework(projectDir);
    expect(detected.framework).toBe("hono");
  });

  it("should match exact route list", async () => {
    const routes = await scanRoutes(projectDir, "hono");
    expect(toSortedPairs(routes)).toEqual(EXPECTED);
  });

  it("should not include files from .wrangler", async () => {
    const routes = await scanRoutes(projectDir, "hono");
    for (const r of routes) {
      expect(r.filePath).not.toContain(".wrangler");
    }
  });
});

// ─── nakamichi gateway ─────────────────────────────────────

describe.skipIf(!existsSync(join(CODES, "nakamichi/packages/gateway")))("E2E: nakamichi gateway", () => {
  const projectDir = join(CODES, "nakamichi/packages/gateway");

  const EXPECTED: [string, string][] = [
    ["DELETE", "/:domain"],
    ["DELETE", "/:domain"],
    ["DELETE", "/:domain"],
    ["DELETE", "/:id"],
    ["DELETE", "/payment-methods/:id"],
    ["DELETE", "/peers/:id"],
    ["DELETE", "/rules/:domain"],
    ["DELETE", "/services/:domain"],
    ["GET", "/"],
    ["GET", "/"],
    ["GET", "/"],
    ["GET", "/"],
    ["GET", "/"],
    ["GET", "/:domain"],
    ["GET", "/:domain"],
    ["GET", "/:domain{.+\\.md$}"],
    ["GET", "/.well-known/jwks.json"],
    ["GET", "/agents"],
    ["GET", "/balance"],
    ["GET", "/callback"],
    ["GET", "/discover"],
    ["GET", "/github"],
    ["GET", "/installations"],
    ["GET", "/installations/:id/repos"],
    ["GET", "/jobs/:id"],
    ["GET", "/me"],
    ["GET", "/payment-methods"],
    ["GET", "/peers"],
    ["GET", "/rules"],
    ["GET", "/services"],
    ["GET", "/services/:domain"],
    ["GET", "/services/:domain/versions"],
    ["GET", "/services/:domain/versions/:version"],
    ["GET", "/tools"],
    ["GET", "/usage"],
    ["POST", "/announce"],
    ["POST", "/challenge"],
    ["POST", "/claim"],
    ["POST", "/create"],
    ["POST", "/exec"],
    ["POST", "/exec"],
    ["POST", "/execute"],
    ["POST", "/heartbeat"],
    ["POST", "/logout"],
    ["POST", "/query"],
    ["POST", "/repos/:owner/:repo/analyze"],
    ["POST", "/services"],
    ["POST", "/setup-intent"],
    ["POST", "/token"],
    ["POST", "/top-up"],
    ["POST", "/topup-checkout"],
    ["POST", "/verify"],
    ["POST", "/webhook"],
    ["PUT", "/:domain"],
    ["PUT", "/:domain"],
    ["PUT", "/:domain/pricing"],
    ["PUT", "/:domain/status"],
    ["PUT", "/peers/:id"],
    ["PUT", "/rules/:domain"],
  ];

  it("should detect hono framework", async () => {
    const detected = await detectFramework(projectDir);
    expect(detected.framework).toBe("hono");
  });

  it("should match exact route list", async () => {
    const routes = await scanRoutes(projectDir, "hono");
    expect(toSortedPairs(routes)).toEqual(EXPECTED);
  });

  it("should only contain files from src/", async () => {
    const routes = await scanRoutes(projectDir, "hono");
    for (const r of routes) {
      expect(r.filePath).toMatch(/^src\//);
    }
  });
});

// ─── chatben api ───────────────────────────────────────────

describe.skipIf(!existsSync(join(CODES, "chatben/apps/api")))("E2E: chatben api", () => {
  const projectDir = join(CODES, "chatben/apps/api");

  const EXPECTED: [string, string][] = [
    ["DELETE", "/:id"],
    ["DELETE", "/:id"],
    ["DELETE", "/history"],
    ["DELETE", "/queue/:id"],
    ["GET", "/"],
    ["GET", "/"],
    ["GET", "/"],
    ["GET", "/"],
    ["GET", "/:id"],
    ["GET", "/:id"],
    ["GET", "/:id/claude-status"],
    ["GET", "/:id/credentials/status"],
    ["GET", "/:id/download"],
    ["GET", "/:id/messages"],
    ["GET", "/:taskId"],
    ["GET", "/:taskId/:path{.+}"],
    ["GET", "/:taskId/*"],
    ["GET", "/:taskId/download"],
    ["GET", "/callback"],
    ["GET", "/credentials"],
    ["GET", "/credentials/status"],
    ["GET", "/credentials/store"],
    ["GET", "/github"],
    ["GET", "/github-app/callback"],
    ["GET", "/health"],
    ["GET", "/health"],
    ["GET", "/history"],
    ["GET", "/me"],
    ["GET", "/me"],
    ["GET", "/me/github-installations"],
    ["GET", "/me/github-installations/:installationId/repos"],
    ["GET", "/me/github-repos"],
    ["GET", "/me/settings"],
    ["GET", "/payment-method"],
    ["GET", "/plans"],
    ["GET", "/queue"],
    ["GET", "/queue/:id"],
    ["GET", "/running"],
    ["GET", "/sandbox-machine"],
    ["GET", "/skill-pool/machines"],
    ["GET", "/skill-pool/status"],
    ["GET", "/status"],
    ["GET", "/subscription"],
    ["GET", "/task-quota"],
    ["GET", "/tasks/:taskId"],
    ["GET", "/uploads/:userId/:filename"],
    ["GET", "/ws"],
    ["GET", "/ws-token"],
    ["PATCH", "/:id"],
    ["PATCH", "/me"],
    ["PATCH", "/me/settings"],
    ["POST", "/"],
    ["POST", "/"],
    ["POST", "/"],
    ["POST", "/:id/cancel"],
    ["POST", "/:id/claude-login"],
    ["POST", "/:id/credentials/sync"],
    ["POST", "/:id/exec"],
    ["POST", "/:id/exec/stream"],
    ["POST", "/:id/execute"],
    ["POST", "/:id/extend"],
    ["POST", "/:id/messages"],
    ["POST", "/:id/sleep"],
    ["POST", "/:id/stop"],
    ["POST", "/:id/terminal/start"],
    ["POST", "/:id/wake"],
    ["POST", "/chat"],
    ["POST", "/checkout"],
    ["POST", "/credentials/ensure"],
    ["POST", "/credentials/refresh"],
    ["POST", "/credentials/seed"],
    ["POST", "/logout"],
    ["POST", "/magic-link"],
    ["POST", "/me/github-installations/:installationId/access-token"],
    ["POST", "/me/github-installations/:installationId/clone-url"],
    ["POST", "/portal"],
    ["POST", "/queue/join"],
    ["POST", "/sandboxes/destroy"],
    ["POST", "/sandboxes/destroy-all"],
    ["POST", "/setup-checkout"],
    ["POST", "/skill-pool/config"],
    ["POST", "/skill-pool/register"],
    ["POST", "/skill-pool/reset"],
    ["POST", "/skill-pool/unregister"],
    ["POST", "/skill-pool/warmup"],
    ["POST", "/tasks/:id/complete"],
    ["POST", "/tasks/:id/credentials/refresh"],
    ["POST", "/tasks/:id/output"],
    ["POST", "/tasks/:id/step"],
    ["POST", "/tasks/:id/steps"],
    ["POST", "/upload"],
    ["POST", "/verify"],
    ["POST", "/webhook"],
  ];

  it("should detect hono + drizzle", async () => {
    const detected = await detectFramework(projectDir);
    expect(detected.framework).toBe("hono");
    expect(detected.orm).toBe("drizzle");
  });

  it("should match exact route list", async () => {
    const routes = await scanRoutes(projectDir, "hono");
    expect(toSortedPairs(routes)).toEqual(EXPECTED);
  });

  it("should not include build artifacts", async () => {
    const routes = await scanRoutes(projectDir, "hono");
    for (const r of routes) {
      expect(r.filePath).not.toMatch(/node_modules|\.wrangler|dist|build/);
    }
  });
});
