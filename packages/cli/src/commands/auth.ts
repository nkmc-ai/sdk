import { saveAgentToken } from "../credentials.js";

const TIMEOUT_MS = 30000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runAuth(opts: {
  gatewayUrl?: string;
}): Promise<void> {
  const gatewayUrl =
    opts.gatewayUrl ??
    process.env.NKMC_GATEWAY_URL ??
    "https://api.nkmc.ai";

  const sub = `agent-${Date.now()}`;

  try {
    const res = await fetchWithTimeout(
      `${gatewayUrl}/auth/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sub,
          svc: "gateway",
          roles: ["agent"],
          expiresIn: "24h",
        }),
      },
      TIMEOUT_MS,
    );

    if (!res.ok) {
      const body = await res.text();

      if (res.status === 404) {
        console.error("x Gateway not found:", gatewayUrl);
        console.error("");
        console.error("   Check the URL is correct.");
        console.error("   Default: https://api.nkmc.ai");
        process.exit(1);
      }

      if (res.status >= 500) {
        console.error("x Gateway error:", res.status);
        console.error("");
        console.error("   The service might be temporarily unavailable.");
        console.error("   Try again in a few moments.");
        process.exit(1);
      }

      throw new Error(`Auth failed (${res.status}): ${body}`);
    }

    const { token } = (await res.json()) as { token: string };

    await saveAgentToken(gatewayUrl, token);

    console.log("Authenticated with gateway");
    console.log(`   Gateway: ${gatewayUrl}`);
    console.log(`   Token saved to ~/.nkmc/credentials.json`);
    console.log("");
    console.log("   Get started: nkmc ls /");
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.error("x Cannot connect to gateway");
      console.error("   URL:", gatewayUrl);
      console.error("");
      console.error("   Check:");
      console.error("   - Your internet connection");
      console.error("   - The gateway URL is correct");
      console.error("   - Is the gateway service running?");
      process.exit(1);
    }

    if (err instanceof TypeError) {
      console.error("x Cannot connect to gateway");
      console.error("   URL:", gatewayUrl);
      console.error("");
      console.error("   Check:");
      console.error("   - Your internet connection");
      console.error("   - The gateway URL is correct");
      process.exit(1);
    }

    throw err;
  }
}
