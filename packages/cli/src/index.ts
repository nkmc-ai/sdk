import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runGenerate } from "./commands/generate.js";
import { runRegister } from "./commands/register.js";
import { runClaim } from "./commands/claim.js";
import { runAuth } from "./commands/auth.js";
import { registerFsCommands } from "./commands/fs.js";
import { registerKeysCommand } from "./commands/keys.js";
import { registerPeerCommands } from "./commands/peers.js";
import { runGatewayStart, runGatewayStop, runGatewayStatus } from "./commands/gateway.js";
import { runProxy } from "./commands/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf-8"));

const program = new Command();

program
  .name("nkmc")
  .description(
    `The gateway of internet for all agents.

  Quick start:
    $ npm install -g @nkmc/cli @nkmc/server
    $ nkmc gateway start                    # start local gateway
    $ nkmc keys set github.com --token ghp_ # store a key (encrypted)
    $ nkmc run gh repo list                 # proxy CLI with credentials

  With public tunnel:
    $ nkmc gateway start --tunnel           # auto-auth + CF tunnel
    $ nkmc peers discover                   # find other gateways

  Full reference: https://nkmc.ai/skill.md`,
  )
  .version(version);

program
  .command("init")
  .description("Initialize nkmc in the current project")
  .argument("[dir]", "Project directory", ".")
  .action(async (dir: string) => {
    const projectDir = dir === "." ? process.cwd() : dir;
    await runInit(projectDir);
  });

program
  .command("generate")
  .description("Scan project and generate skill.md")
  .argument("[dir]", "Project directory", ".")
  .option("--register", "Register the service with the gateway after generating")
  .option("--gateway-url <url>", "Gateway URL for registration")
  .option("--token <token>", "Auth token for registration (publish token or admin token)")
  .option("--admin-token <token>", "Admin token for registration (deprecated, use --token)")
  .option("--domain <domain>", "Domain name for the service")
  .action(async (dir: string, opts: Record<string, string | boolean | undefined>) => {
    const projectDir = dir === "." ? process.cwd() : dir;
    await runGenerate(projectDir, {
      register: opts.register as boolean | undefined,
      gatewayUrl: opts.gatewayUrl as string | undefined,
      token: opts.token as string | undefined,
      adminToken: opts.adminToken as string | undefined,
      domain: opts.domain as string | undefined,
    });
  });

program
  .command("claim <domain>")
  .description("Claim domain ownership via DNS verification")
  .option("--verify", "Verify DNS record and obtain publish token")
  .option("--gateway-url <url>", "Gateway URL")
  .action(async (domain: string, opts: Record<string, string | boolean | undefined>) => {
    const gatewayUrl =
      (opts.gatewayUrl as string | undefined) ?? process.env.NKMC_GATEWAY_URL ?? "https://api.nkmc.ai";
    await runClaim({
      gatewayUrl,
      domain,
      verify: opts.verify as boolean | undefined,
    });
  });

program
  .command("register")
  .description("Register a service with the gateway (auto-discover from URL or skill.md)")
  .option("--url <url>", "Service URL — auto-discover OpenAPI spec and register")
  .option("--spec-url <url>", "Direct URL to OpenAPI spec (use with --url)")
  .option("--gateway-url <url>", "Gateway URL")
  .option("--token <token>", "Auth token (publish token or admin token)")
  .option("--admin-token <token>", "Admin token (deprecated, use --token)")
  .option("--domain <domain>", "Domain name for the service")
  .option("--dir <dir>", "Project directory", ".")
  .action(async (opts: Record<string, string | undefined>) => {
    await runRegister({
      gatewayUrl: opts.gatewayUrl,
      token: opts.token,
      adminToken: opts.adminToken,
      domain: opts.domain,
      dir: opts.dir === "." ? process.cwd() : opts.dir,
      url: opts.url,
      specUrl: opts.specUrl,
    });
  });

program
  .command("auth")
  .description("Authenticate with the nkmc gateway")
  .option("--gateway-url <url>", "Gateway URL (default: https://api.nkmc.ai)")
  .action(async (opts: Record<string, string | undefined>) => {
    await runAuth({ gatewayUrl: opts.gatewayUrl });
  });

program
  .command("run <tool> [args...]")
  .description("Proxy a CLI tool through gateway (e.g. nkmc run gh repo list)")
  .allowUnknownOption()
  .action(async (tool: string, args: string[]) => {
    await runProxy(tool, args);
  });

registerFsCommands(program);
registerKeysCommand(program);
registerPeerCommands(program);

const gw = program.command("gateway").description("Start/stop local gateway (nkmc gateway start --tunnel)");

gw.command("start")
  .description("Start a local nkmc gateway (runs in background by default)")
  .option("--port <port>", "Port to listen on", "9090")
  .option("--data-dir <dir>", "Data directory")
  .option("--foreground", "Run in foreground instead of background")
  .option("--tunnel", "Expose gateway via Cloudflare Tunnel")
  .action((opts) => runGatewayStart({ ...opts, daemon: !opts.foreground }));

gw.command("stop")
  .description("Stop the local nkmc gateway")
  .option("--data-dir <dir>", "Data directory")
  .action((opts) => runGatewayStop(opts));

gw.command("status")
  .description("Check if the local gateway is running")
  .option("--data-dir <dir>", "Data directory")
  .action((opts) => runGatewayStatus(opts));

program.parse();
