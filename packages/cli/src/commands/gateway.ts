import { resolve, join } from "node:path";
import { homedir } from "node:os";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { fork, spawn, type ChildProcess } from "node:child_process";

function pidFilePath(dataDir: string): string {
  return join(dataDir, "gateway.pid");
}

function resolveDataDir(dir?: string): string {
  return dir ?? resolve(homedir(), ".nkmc/server");
}

export async function runGatewayStart(opts: {
  port?: string;
  dataDir?: string;
  daemon?: boolean;
  tunnel?: boolean;
}): Promise<void> {
  const dataDir = resolveDataDir(opts.dataDir);
  mkdirSync(dataDir, { recursive: true });
  const port = parseInt(opts.port ?? "9090", 10);

  // Check if already running
  const pidFile = pidFilePath(dataDir);
  if (existsSync(pidFile)) {
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    try {
      process.kill(pid, 0);
      console.error(
        `Gateway already running (PID ${pid}). Use 'nkmc gateway stop' first.`,
      );
      process.exit(1);
    } catch {
      unlinkSync(pidFile);
    }
  }

  if (opts.daemon) {
    const args = ["gateway", "start", "--port", String(port), "--data-dir", dataDir];
    if (opts.tunnel) args.push("--tunnel");

    const child = fork(process.argv[1], args, {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, NKMC_DATA_DIR: dataDir, NKMC_PORT: String(port) },
    });
    child.unref();
    writeFileSync(pidFile, String(child.pid), "utf-8");
    console.log(`Gateway started in background (PID ${child.pid})`);
    console.log(`  Port: ${port}`);
    console.log(`  Data: ${dataDir}`);
    if (opts.tunnel) console.log(`  Tunnel: enabled (connecting...)`);
    console.log(`  Stop: nkmc gateway stop`);
    return;
  }

  // Foreground mode: import @nkmc/server
  let startServer: (opts: any) => Promise<any>;
  let loadConfig: () => any;
  try {
    const serverMod = await import("@nkmc/server");
    startServer = serverMod.startServer;
    const configMod = await import("@nkmc/server/config");
    loadConfig = configMod.loadConfig;
  } catch {
    console.error("@nkmc/server not found.");
    console.error("Install with: npm install -g @nkmc/server");
    process.exit(1);
  }

  const config = loadConfig();
  config.port = port;
  config.dataDir = dataDir;

  writeFileSync(pidFile, String(process.pid), "utf-8");
  const handle = await startServer({ config });

  // Track cleanup resources
  let cfProcess: ChildProcess | null = null;
  let tunnelId: string | null = null;
  const localGatewayUrl = `http://localhost:${port}`;

  const cleanup = () => {
    if (cfProcess) try { cfProcess.kill(); } catch {}
    if (tunnelId) cleanupTunnelAsync(tunnelId);
    try { unlinkSync(pidFile); } catch {}
    handle.close();
  };

  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });

  // --- Tunnel setup ---
  if (opts.tunnel) {
    try {
      const { createClientFor } = await import("../gateway/client.js");
      const {
        saveTunnelInfo,
        clearTunnelInfo,
        HOSTED_GATEWAY_URL,
        saveGatewayToken,
      } = await import("../credentials.js");

      // Auto-auth with hosted gateway (user doesn't need to run nkmc auth separately)
      console.log("Connecting to hosted gateway...");
      const hostedClient = await createClientFor(HOSTED_GATEWAY_URL);

      // Also ensure local gateway is saved in credentials
      // (so nkmc commands default to local)
      const localAuthRes = await fetch(`${localGatewayUrl}/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sub: `local-${Date.now()}`, svc: "gateway", roles: ["agent"], expiresIn: "24h" }),
      });
      if (localAuthRes.ok) {
        const { token } = (await localAuthRes.json()) as { token: string };
        await saveGatewayToken(localGatewayUrl, token);
      }

      // Discover local credential domains to advertise
      let advertisedDomains: string[] = [];
      try {
        const adminToken = readFileSync(join(dataDir, "admin-token"), "utf-8").trim();
        const credRes = await fetch(`${localGatewayUrl}/credentials`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        if (credRes.ok) {
          const { domains } = (await credRes.json()) as { domains: string[] };
          advertisedDomains = domains ?? [];
        }
      } catch {}

      // Create tunnel via hosted gateway
      console.log("Creating Cloudflare Tunnel...");
      const { tunnelId: tid, tunnelToken, publicUrl } =
        await hostedClient.createTunnel({
          advertisedDomains,
          gatewayName: process.env.NKMC_GATEWAY_NAME,
        });
      tunnelId = tid;

      // Save tunnel info to credentials.json (under local gateway entry)
      await saveTunnelInfo(localGatewayUrl, { id: tid, publicUrl });

      // Download + run cloudflared
      const { ensureCloudflared } = await import("../tunnel/cloudflared.js");
      const bin = await ensureCloudflared();

      cfProcess = spawn(bin, ["tunnel", "run", "--token", tunnelToken], {
        stdio: "ignore",
        detached: false,
      });

      cfProcess.on("exit", (code) => {
        console.error(`cloudflared exited with code ${code}`);
        cfProcess = null;
      });

      console.log(`  Public:  ${publicUrl}`);
      if (advertisedDomains.length > 0) {
        console.log(`  Domains: ${advertisedDomains.join(", ")}`);
      }

      // Override cleanup to also clear tunnel info
      const origCleanup = cleanup;
      const enhancedCleanup = () => {
        clearTunnelInfo(localGatewayUrl).catch(() => {});
        origCleanup();
      };
      process.removeAllListeners("SIGINT");
      process.removeAllListeners("SIGTERM");
      process.on("SIGINT", () => { enhancedCleanup(); process.exit(0); });
      process.on("SIGTERM", () => { enhancedCleanup(); process.exit(0); });
    } catch (err: any) {
      console.error(`Tunnel setup failed: ${err.message}`);
      console.error("Gateway is running without tunnel. Use 'nkmc gateway stop' to stop.");
    }
  }
}

/** Best-effort async tunnel deletion. */
async function cleanupTunnelAsync(id: string): Promise<void> {
  try {
    const { createClientFor } = await import("../gateway/client.js");
    const { HOSTED_GATEWAY_URL } = await import("../credentials.js");
    const client = await createClientFor(HOSTED_GATEWAY_URL);
    await client.deleteTunnel(id);
  } catch {}
}

export async function runGatewayStop(opts: { dataDir?: string }): Promise<void> {
  const dataDir = resolveDataDir(opts.dataDir);
  const pidFile = pidFilePath(dataDir);
  const localGatewayUrl = `http://localhost:9090`; // default

  // Clean up tunnel from credentials
  try {
    const { getTunnelInfo, clearTunnelInfo } = await import("../credentials.js");
    const tunnel = await getTunnelInfo(localGatewayUrl);
    if (tunnel) {
      console.log(`Cleaning up tunnel ${tunnel.id}...`);
      cleanupTunnelAsync(tunnel.id).then(
        () => console.log("Tunnel deleted."),
        () => console.log("Tunnel cleanup failed (may need manual cleanup)."),
      );
      await clearTunnelInfo(localGatewayUrl);
    }
  } catch {}

  if (!existsSync(pidFile)) {
    console.log("No running gateway found.");
    return;
  }

  const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
  try {
    process.kill(pid, "SIGTERM");
    unlinkSync(pidFile);
    console.log(`Gateway stopped (PID ${pid})`);
  } catch {
    unlinkSync(pidFile);
    console.log("Gateway was not running (stale PID file removed).");
  }
}

export function runGatewayStatus(opts: { dataDir?: string }): void {
  const dataDir = resolveDataDir(opts.dataDir);
  const pidFile = pidFilePath(dataDir);

  if (!existsSync(pidFile)) {
    console.log("Gateway is not running.");
    return;
  }

  const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
  try {
    process.kill(pid, 0);
    console.log(`Gateway is running (PID ${pid})`);
    console.log(`  Data: ${dataDir}`);

    // Show tunnel info from credentials
    import("../credentials.js").then(async ({ getTunnelInfo }) => {
      const tunnel = await getTunnelInfo(`http://localhost:9090`);
      if (tunnel) {
        console.log(`  Tunnel: ${tunnel.publicUrl}`);
      }
    }).catch(() => {});
  } catch {
    unlinkSync(pidFile);
    console.log("Gateway is not running (stale PID file cleaned up).");
  }
}
