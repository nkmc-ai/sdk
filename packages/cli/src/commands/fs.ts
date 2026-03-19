import type { Command } from "commander";
import { createClient } from "../gateway/client.js";
import { getAuthHint } from "../keys/provider-map.js";

function output(result: unknown): void {
  console.log(JSON.stringify(result));
}

interface SearchResult {
  domain: string;
  name: string;
  description: string;
  matchedEndpoints?: { method: string; path: string; description: string }[];
}

interface EndpointResult {
  method: string;
  path: string;
  description: string;
}

export function isSearchResults(data: unknown): data is SearchResult[] {
  if (!Array.isArray(data) || data.length === 0) return false;
  const first = data[0];
  return (
    typeof first === "object" &&
    first !== null &&
    "domain" in first &&
    "name" in first
  );
}

export function isEndpointResults(data: unknown): data is EndpointResult[] {
  if (!Array.isArray(data) || data.length === 0) return false;
  const first = data[0];
  return (
    typeof first === "object" &&
    first !== null &&
    "method" in first &&
    "path" in first
  );
}

export function formatGrepResults(data: unknown): string {
  if (isSearchResults(data)) {
    return data
      .map((s) => {
        const header = `${s.domain} — ${s.name}`;
        if (!s.matchedEndpoints || s.matchedEndpoints.length === 0) {
          return header;
        }
        const endpoints = s.matchedEndpoints
          .map((e) => `  ${e.method.padEnd(6)} ${e.path}  — ${e.description}`)
          .join("\n");
        return `${header} · ${s.matchedEndpoints.length} matched\n${endpoints}`;
      })
      .join("\n\n");
  }

  if (isEndpointResults(data)) {
    if (data.length === 0) return "No matching endpoints.";
    return data
      .map((e) => `${e.method.padEnd(6)} ${e.path}  — ${e.description}`)
      .join("\n");
  }

  return JSON.stringify(data);
}

export function extractDomain(path: string): string | null {
  const segments = path.replace(/^\/+/, "").split("/");
  const first = segments[0];
  if (!first) return null;
  const domain = first.includes("@")
    ? first.slice(0, first.indexOf("@"))
    : first;
  return domain.includes(".") ? domain : null;
}

export function isAuthError(message: string): boolean {
  if (/Gateway error (401|403):/.test(message)) return true;
  if (
    /Gateway error 500:/.test(message) &&
    /\b(Unauthorized|Unauthenticated|authenticate|API key|api[_-]?key)\b/i.test(
      message,
    )
  )
    return true;
  return false;
}

function isNetworkError(message: string): boolean {
  return (
    /fetch|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ENETUNREACH|NETWORK_ERROR/i.test(
      message,
    ) || message.includes("Failed to fetch") ||
    message.includes("NetworkError")
  );
}

function handleError(err: unknown, cmdPath?: string): never {
  const message = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number })?.status;

  if (isNetworkError(message)) {
    console.error("x Network error");
    console.error("");
    console.error("   Cannot reach the gateway. Check:");
    console.error("   - Your internet connection");
    console.error("   - Is the gateway URL correct?");
    console.error("   - Is the gateway service running?");
    console.error("");
    console.error("   Set custom gateway: nkmc auth --gateway-url <URL>");
    process.exit(1);
  }

  if (/timed out|timeout/i.test(message)) {
    console.error("x Request timed out");
    console.error("");
    console.error("   The gateway is slow to respond.");
    console.error("");
    console.error("   Tips:");
    console.error("   - Check your network connection");
    console.error("   - Try again in a moment");
    process.exit(1);
  }

  if (isAuthError(message) || status === 401 || status === 403) {
    const domain = (cmdPath && extractDomain(cmdPath)) ||
      message.match(/([a-z0-9-]+(?:\.[a-z0-9-]+){1,})/i)?.[1] ||
      null;

    if (domain) {
      const hint = getAuthHint(domain);
      console.error(`x Authentication required for ${domain}`);
      if (hint?.guideUrl) {
        console.error(`   Get your key: ${hint.guideUrl}`);
      } else {
        console.error(
          `   Get your key: https://${domain} (check the developer/API settings)`,
        );
      }
      console.error(
        `   Set your key: nkmc keys set ${domain} --token <YOUR_KEY>`,
      );
      console.error("");
      console.error("   Then retry your command.");
    } else {
      console.error("x Authentication required");
      console.error("");
      console.error("   Run: nkmc auth");
    }
    process.exit(1);
  }

  if (status === 404) {
    console.error(`x Not found: ${cmdPath || "resource"}`);
    console.error("");
    console.error("   Tips:");
    console.error("   - Check the path is correct");
    console.error("   - List available services: nkmc ls /");
    console.error("   - Check service endpoints: nkmc ls /<service>/");
    process.exit(1);
  }

  if (status === 429 || /rate limit/i.test(message)) {
    console.error("x Rate limited");
    console.error("");
    console.error("   Too many requests. Wait a moment and try again.");
    process.exit(1);
  }

  if (status && status >= 500) {
    console.error("x Gateway error");
    console.error(`   Server returned status ${status}`);
    console.error("");
    console.error("   The service might be temporarily unavailable.");
    console.error("   Try again in a few moments.");
    process.exit(1);
  }

  console.error(`x Error: ${message}`);
  console.error("");
  console.error("   Run with --verbose for more details.");
  process.exit(1);
}

export function registerFsCommands(program: Command): void {
  program
    .command("ls")
    .description("List files in a directory")
    .argument("<path>", "Directory path")
    .action(async (path: string) => {
      try {
        const client = await createClient();
        const result = await client.execute(`ls ${path}`);
        output(result);
      } catch (err) {
        handleError(err, path);
      }
    });

  program
    .command("cat")
    .description("Read file contents")
    .argument("<path>", "File path")
    .action(async (path: string) => {
      try {
        const client = await createClient();
        const result = await client.execute(`cat ${path}`);
        output(result);
      } catch (err) {
        handleError(err, path);
      }
    });

  program
    .command("write")
    .description("Write data to a file")
    .argument("<path>", "File path")
    .argument("<data>", "Data to write")
    .action(async (path: string, data: string) => {
      try {
        const client = await createClient();
        const result = await client.execute(`write ${path} ${data}`);
        output(result);
      } catch (err) {
        handleError(err, path);
      }
    });

  program
    .command("rm")
    .description("Remove a file")
    .argument("<path>", "File path")
    .action(async (path: string) => {
      try {
        const client = await createClient();
        const result = await client.execute(`rm ${path}`);
        output(result);
      } catch (err) {
        handleError(err, path);
      }
    });

  program
    .command("grep")
    .description("Search file contents")
    .argument("<pattern>", "Search pattern")
    .argument("<path>", "File or directory path")
    .action(async (pattern: string, path: string) => {
      try {
        const client = await createClient();
        const result = await client.execute(`grep ${pattern} ${path}`);
        console.log(formatGrepResults(result));
      } catch (err) {
        handleError(err, path);
      }
    });

  program
    .command("pipe")
    .description("Pipe commands: cat <path> | write <path>")
    .argument("<expression...>", "Pipe expression")
    .action(async (expression: string[]) => {
      try {
        const full = expression.join(" ");
        const parts = full.split("|").map((s) => s.trim());
        if (parts.length !== 2) {
          throw new Error(
            "Pipe expression must have exactly two stages separated by '|'",
          );
        }

        const [source, target] = parts;
