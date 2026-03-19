export class GatewayClient {
  private readonly TIMEOUT_MS = 30000;

  constructor(
    private gatewayUrl: string,
    private token: string,
  ) {}

  private baseUrl(): string {
    return this.gatewayUrl.replace(/\/$/, "");
  }

  private async fetchWithTimeout(
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

  private isRetryableError(err: unknown): boolean {
    if (err instanceof TypeError) return true;
    if (err instanceof Error) {
      if (
        /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ENETUNREACH|NETWORK_ERROR/i.test(
          err.message,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  private parseGatewayError(status: number, body: string): Error {
    let message = body;
    try {
      const parsed = JSON.parse(body);
      message = parsed?.error?.message || parsed?.error || body;
    } catch {}
    return new Error(`Gateway error ${status}: ${message}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async execute(command: string, retries = 2): Promise<unknown> {
    const url = `${this.baseUrl()}/execute`;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await this.fetchWithTimeout(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ command }),
        }, this.TIMEOUT_MS);

        if (res.status === 429) {
          const retryAfter = res.headers.get("Retry-After") || "5";
          if (attempt < retries) {
            const waitMs = parseInt(retryAfter, 10) * 1000;
            console.warn(`Rate limited. Retrying in ${waitMs / 1000}s...`);
            await this.sleep(waitMs);
            continue;
          }
          const body = await res.text();
          throw new Error(`Rate limited. Wait ${retryAfter}s before retrying.`);
        }

        if (res.status >= 500 && attempt < retries) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(
            `Server error (${res.status}). Retrying in ${delay / 1000}s... (attempt ${attempt + 1}/${retries + 1})`,
          );
          await this.sleep(delay);
          continue;
        }

        if (!res.ok) {
          const body = await res.text();
          throw this.parseGatewayError(res.status, body);
        }

        return res.json();
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new Error(
            `Request timed out after ${this.TIMEOUT_MS / 1000}s. Check your network connection.`,
          );
        }

        if (attempt === retries) throw err;

        if (this.isRetryableError(err)) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(
            `Network error. Retrying in ${delay / 1000}s... (attempt ${attempt + 1}/${retries + 1})`,
          );
          await this.sleep(delay);
          continue;
        }

        throw err;
      }
    }

    throw new Error("Unexpected error in execute loop");
  }

  async uploadByok(
    domain: string,
    auth: { type: string; token?: string; header?: string; key?: string },
  ): Promise<void> {
    const url = `${this.baseUrl()}/byok/${domain}`;
    const res = await this.fetchWithTimeout(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ auth }),
    }, this.TIMEOUT_MS);

    if (!res.ok) {
      const body = await res.text();
      throw this.parseGatewayError(res.status, body);
    }
  }

  async listByok(): Promise<{ domains: string[] }> {
    const url = `${this.baseUrl()}/byok`;
    const res = await this.fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    }, this.TIMEOUT_MS);

    if (!res.ok) {
      const body = await res.text();
      throw this.parseGatewayError(res.status, body);
    }
    return res.json() as Promise<{ domains: string[] }>;
  }

  async deleteByok(domain: string): Promise<void> {
    const url = `${this.baseUrl()}/byok/${domain}`;
    const res = await this.fetchWithTimeout(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.token}` },
    }, this.TIMEOUT_MS);

    if (!res.ok) {
      const body = await res.text();
      throw this.parseGatewayError(res.status, body);
    }
  }
}

export async function createClient(): Promise<GatewayClient> {
  const { getAgentToken } = await import("../credentials.js");
  const stored = await getAgentToken();

  const gatewayUrl =
    process.env.NKMC_GATEWAY_URL ?? stored?.gatewayUrl ?? "https://api.nkmc.ai";

  const token = process.env.NKMC_TOKEN ?? stored?.token ?? null;

  if (!token) {
    throw new Error(
      "No token found. Run 'nkmc auth' first, or set NKMC_TOKEN.",
    );
  }

  return new GatewayClient(gatewayUrl, token);
}
