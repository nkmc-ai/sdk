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

function tunnelFilePath(dataDir: string): string {
  return join(dataDir, "tunnel.json");
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
      process.kill(pid, 0); // check if alive
      console.error(
        `Gateway already running (PID ${pid}). Use 'nkmc gateway stop' first.`,
      );
      process.exit(1);
    } catch {
      // Stale PID file, remove it
      unlinkSync(pidFile);
    }
  }

  if (opts.daemon) {
    const args = [
      "gateway",
      "start",
      "--port",
      String(port),
      "--data-dir",
      dataDir,
    ];
    if (opts.tunnel) args.push("--tunnel");

    // Fork a detached child running this same file in --foreground mode
    const child = fork(process.argv[1], args, {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        NKMC_DATA_DIR: dataDir,
        NKMC_PORT: String(port),
      },
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

  // Foreground mode: try to import @nkmc/server
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

  // Override config with CLI options
  const config = loadConfig();
  config.port = port;
  config.dataDir = dataDir;

  // Write PID file for this process
  writeFileSync(pidFile, String(process.pid), "utf-8");

  const handle = await startServer({ config });

  // Track resources that need cleanup
  let cfProcess: ChildProcess | null = null;
  let tunnelId: string | null = null;

  // Clean up on exit
  let cleanup = () => {
    // Kill cloudflared if running
    if (cfProcess) {
      try {
        cfProcess.kill();
      } catch {}
    }
    // Delete tunnel via API (best-effort, fire-and-forget)
    if (tunnelId) {
      cleanupTunnelAsync(tunnelId);
    }
    // Remove tunnel.json
    const tf = tunnelFilePath(dataDir);
    try {
      unlinkSync(tf);
    } catch {}
    // Remove PID file and close server
    try {
      unlinkSync(pidFile);
    } catch {}
    handle.close();
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  // --- Tunnel setup ---
  if (opts.tunnel) {
    try {
      // Use hosted gateway credentials
      const { createClient } = await import("../gateway/client.js");
      const client = await createClient();

      // Discover local gateway's credential domains to advertise
      let advertisedDomains: string[] = [];
      try {
        const adminToken = process.env.NKMC_ADMIN_TOKEN;
        if (adminToken) {
          const credRes = await fetch(`http://localhost:${port}/credentials`, {
            headers: { Authorization: `Bearer ${adminToken}` },
          });
          if (credRes.ok) {
            const credBody = await credRes.json() as { credentials?: { domain: string }[] };
            advertisedDomains = (credBody.credentials ?? []).map((c: { domain: string }) => c.domain);
          }
        }
      } catch {
        // Local gateway may not have credentials endpoint — that's fine
      }

      console.log("Creating Cloudflare Tunnel...");
      const { tunnelId: tid, tunnelToken, publicUrl } =
        await client.createTunnel({
          advertisedDomains,
          gatewayName: process.env.NKMC_GATEWAY_NAME,
        });
      tunnelId = tid;

      // Download cloudflared if needed
      const { ensureCloudflared } = await import(
        "../tunnel/cloudflared.js"
      );
      const bin = await ensureCloudflared();

      // Spawn cloudflared with the tunnel token
      cfProcess = spawn(
        bin,
        ["tunnel", "--url", `http://localhost:${port}`, "run", "--token", tunnelToken],
        {
          stdio: "ignore",
          detached: false,
        },
      );

      cfProcess.on("exit", (code) => {
        console.error(`cloudflared exited with code ${code}`);
        cfProcess = null;
      });

      // Save tunnel info for cleanup on stop
      writeFileSync(
        tunnelFilePath(dataDir),
        JSON.stringify({ tunnelId: tid, publicUrl }),
      );

      console.log(`  Public:  ${publicUrl}`);
      if (advertisedDomains.length > 0) {
        console.log(`  Domains: ${advertisedDomains.join(", ")}`);
      }
    } catch (err: any) {
      console.error(`Tunnel setup failed: ${err.message}`);
      console.error("Gateway is running without tunnel. Use 'nkmc gateway stop' to stop.");
    }
  }
}

/** Best-effort async tunnel deletion (used during cleanup). */
async function cleanupTunnelAsync(id: string): Promise<void> {
  try {
    const { createClient } = await import("../gateway/client.js");
    const client = await createClient();
    await client.deleteTunnel(id);
  } catch {
    // Ignore errors during cleanup
  }
}

export function runGatewayStop(opts: { dataDir?: string }): void {
  const dataDir = resolveDataDir(opts.dataDir);
  const pidFile = pidFilePath(dataDir);

  // Clean up tunnel if present
  const tf = tunnelFilePath(dataDir);
  if (existsSync(tf)) {
    try {
      const info = JSON.parse(readFileSync(tf, "utf-8"));
      if (info.tunnelId) {
        console.log(`Cleaning up tunnel ${info.tunnelId}...`);
        // Fire-and-forget async cleanup
        cleanupTunnelAsync(info.tunnelId).then(
          () => console.log("Tunnel deleted."),
          () => console.log("Tunnel cleanup failed (may need manual cleanup)."),
        );
      }
      unlinkSync(tf);
    } catch {
      try {
        unlinkSync(tf);
      } catch {}
    }
  }

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

    // Show tunnel info if available
    const tf = tunnelFilePath(dataDir);
    if (existsSync(tf)) {
      try {
        const info = JSON.parse(readFileSync(tf, "utf-8"));
        if (info.publicUrl) {
          console.log(`  Tunnel: ${info.publicUrl}`);
        }
      } catch {}
    }
  } catch {
    unlinkSync(pidFile);
    console.log("Gateway is not running (stale PID file cleaned up).");
  }
}
