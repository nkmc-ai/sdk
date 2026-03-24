import type { Command } from "commander";
import { createClient } from "../gateway/client.js";

export function registerPeerCommands(program: Command): void {
  const peers = program
    .command("peers")
    .description("Manage federation peer gateways");

  peers
    .command("add")
    .description("Add or update a peer gateway")
    .requiredOption("--id <id>", "Peer ID")
    .requiredOption("--name <name>", "Peer display name")
    .requiredOption("--url <url>", "Peer gateway URL")
    .requiredOption("--secret <secret>", "Shared secret for HMAC auth")
    .action(async (opts: { id: string; name: string; url: string; secret: string }) => {
      try {
        const client = await createClient();
        await client.addPeer(opts.id, {
          name: opts.name,
          url: opts.url,
          sharedSecret: opts.secret,
        });
        console.log(`Peer added: ${opts.id} (${opts.name})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    });

  peers
    .command("list")
    .description("List all peer gateways")
    .action(async () => {
      try {
        const client = await createClient();
        const { peers: peerList } = await client.listPeers();
        if (peerList.length === 0) {
          console.log("No peers configured.");
          return;
        }
        console.log("Peers:");
        for (const p of peerList) {
          console.log(`  ${p.id}  ${p.name}  ${p.url}  [${p.status}]`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    });

  peers
    .command("remove <id>")
    .description("Remove a peer gateway")
    .action(async (id: string) => {
      try {
        const client = await createClient();
        await client.deletePeer(id);
        console.log(`Peer removed: ${id}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    });

  peers
    .command("discover")
    .description("Discover online gateway peers via tunnel network")
    .option("--domain <domain>", "Filter by advertised domain")
    .action(async (opts: { domain?: string }) => {
      try {
        const client = await createClient();
        const { gateways } = await client.discoverPeers(opts.domain);
        if (gateways.length === 0) {
          console.log("No online gateways found.");
          return;
        }
        console.log("Online gateways:");
        for (const gw of gateways) {
          console.log(`  ${gw.name} — ${gw.publicUrl}`);
          if (gw.advertisedDomains.length > 0) {
            console.log(`    Domains: ${gw.advertisedDomains.join(", ")}`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    });

  // --- Lending rules ---
  const rules = program
    .command("rules")
    .description("Manage credential lending rules");

  rules
    .command("set <domain>")
    .description("Set a lending rule for a domain")
    .option("--allow", "Allow lending (default)")
    .option("--deny", "Deny lending")
    .option(
      "--peers <peers>",
      "Allowed peer IDs (comma-separated, or * for all)",
      "*",
    )
    .option(
      "--pricing <mode>",
      "Pricing mode: free, per-request, per-token",
      "free",
    )
    .option("--amount <amount>", "Price amount in USD (for per-request/per-token)")
    .action(async (domain: string, opts: {
      allow?: boolean;
      deny?: boolean;
      peers: string;
      pricing: string;
      amount?: string;
    }) => {
      try {
        const allow = opts.deny ? false : true;
        const peersValue: string[] | "*" =
          opts.peers === "*" ? "*" : opts.peers.split(",").map((s) => s.trim());

        const pricing: { mode: string; amount?: number } = {
          mode: opts.pricing,
        };
        if (opts.amount) {
          pricing.amount = parseFloat(opts.amount);
        }

        const client = await createClient();
        await client.setRule(domain, { allow, peers: peersValue, pricing });
        console.log(
          `Rule set for ${domain}: ${allow ? "allow" : "deny"}, peers=${opts.peers}, pricing=${opts.pricing}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    });

  rules
    .command("list")
    .description("List all lending rules")
    .action(async () => {
      try {
        const client = await createClient();
        const { rules: ruleList } = await client.listRules();
        if (ruleList.length === 0) {
          console.log("No lending rules configured.");
          return;
        }
        console.log("Lending rules:");
        for (const r of ruleList) {
          const peersStr =
            r.peers === "*" ? "*" : (r.peers as string[]).join(", ");
          const priceStr =
            r.pricing.mode === "free"
              ? "free"
              : `${r.pricing.mode} $${r.pricing.amount ?? 0}`;
          console.log(
            `  ${r.domain}  ${r.allow ? "allow" : "deny"}  peers=${peersStr}  pricing=${priceStr}`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    });

  rules
    .command("remove <domain>")
    .description("Remove a lending rule")
    .action(async (domain: string) => {
      try {
        const client = await createClient();
        await client.deleteRule(domain);
        console.log(`Rule removed for ${domain}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    });
}
