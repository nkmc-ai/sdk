import type { Command } from "commander";
import { getAuthHint } from "../keys/provider-map.js";

export function registerKeysCommand(program: Command): void {
  const keys = program
    .command("keys")
    .description("Manage API keys for authenticated services (BYOK)");

  keys
    .command("set <domain>")
    .description("Set an API key for a domain (stored encrypted in gateway vault)")
    .option("--token <value>", "API key / token value")
    .option("--local", "Store locally only (not recommended — plaintext)")
    .action(async (domain: string, opts: { token?: string; local?: boolean }) => {
      try {
        const hint = getAuthHint(domain);

        let tokenValue = opts.token;
        if (!tokenValue) {
          const envHint = hint ? `(${hint.envVar})` : "";
          console.error(
            `Usage: nkmc keys set ${domain} --token <value> ${envHint}`,
          );
          if (hint?.guideUrl) {
            console.error(`  Get your key: ${hint.guideUrl}`);
          }
          process.exit(1);
        }

        const auth = buildAuth(domain, tokenValue, hint);

        if (opts.local) {
          // Legacy: store in local plaintext file (not recommended)
          const { saveKey } = await import("../credentials.js");
          await saveKey(domain, auth);
          console.log(`Key saved locally for ${domain} (plaintext — consider using gateway vault instead)`);
          return;
        }

        // Default: store in gateway vault (encrypted)
        await syncToGateway(domain, auth);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    });

  keys
    .command("list")
    .description("List all saved API keys")
    .option("--local", "Also list locally stored keys")
    .action(async (opts: { local?: boolean }) => {
      try {
        // Always show gateway keys first
        try {
          const { createClient } = await import("../gateway/client.js");
          const client = await createClient();
          const { domains } = await client.listByok();
          console.log("Gateway vault keys:");
          if (domains.length === 0) {
            console.log("  (none)");
          } else {
            for (const d of domains) {
              console.log(`  ${d}`);
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Could not fetch gateway keys: ${msg}`);
          console.error("  Run 'nkmc auth' first, or start a local gateway.");
        }

        if (opts.local) {
          const { listKeys } = await import("../credentials.js");
          const localKeys = await listKeys();
          const domains = Object.keys(localKeys);
          console.log("\nLocal keys (plaintext):");
          if (domains.length === 0) {
            console.log("  (none)");
          } else {
            for (const domain of domains) {
              const entry = localKeys[domain];
              const maskedAuth = maskAuth(entry.auth);
              console.log(`  ${domain}  ${maskedAuth}  (${entry.updatedAt})`);
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    });

  keys
    .command("remove <domain>")
    .description("Remove an API key for a domain")
    .option("--local", "Also remove locally stored key")
    .action(async (domain: string, opts: { local?: boolean }) => {
      try {
        // Remove from gateway vault
        try {
          const { createClient } = await import("../gateway/client.js");
          const client = await createClient();
          await client.deleteByok(domain);
          console.log(`Key removed from gateway vault for ${domain}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Could not remove from gateway: ${msg}`);
        }

        if (opts.local) {
          const { deleteKey } = await import("../credentials.js");
          const removed = await deleteKey(domain);
          if (removed) {
            console.log(`Local key removed for ${domain}`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    });
}

function buildAuth(
  domain: string,
  token: string,
  hint: ReturnType<typeof getAuthHint>,
): { type: string; token?: string; header?: string; key?: string } {
  if (hint?.authType === "api-key" && hint.headerName) {
    return { type: "api-key", header: hint.headerName, key: token };
  }
  return { type: "bearer", token };
}

function maskAuth(auth: {
  type: string;
  token?: string;
  key?: string;
}): string {
  const value = auth.token ?? auth.key ?? "";
  if (value.length <= 8) return `${auth.type}:****`;
  return `${auth.type}:${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function syncToGateway(
  domain: string,
  auth: { type: string; token?: string; header?: string; key?: string },
): Promise<void> {
  const { createClient } = await import("../gateway/client.js");
  const client = await createClient();
  await client.uploadByok(domain, auth);
  console.log(`Key saved to gateway vault for ${domain}`);
}
