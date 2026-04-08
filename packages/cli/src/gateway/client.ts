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

  // --- Proxy methods ---

  async proxyExec(
    tool: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const url = `${this.baseUrl()}/proxy/exec`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tool, args }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Proxy exec failed ${res.status}: ${body}`);
    }
    return res.json() as Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
    }>;
  }

  async listTools(): Promise<
    { tools: { name: string; credentialDomain: string }[] }
  > {
    const url = `${this.baseUrl()}/proxy/tools`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`List tools failed ${res.status}: ${body}`);
    }
    return res.json() as Promise<{
      tools: { name: string; credentialDomain: string }[];
    }>;
  }

  // --- Admin: Federation peer management ---

  private getAdminToken(): string {
    const token = process.env.NKMC_ADMIN_TOKEN;
    if (!token) {
      throw new Error(
        "NKMC_ADMIN_TOKEN env var required for admin operations",
      );
    }
    return token;
  }

  private adminHeaders(json = false): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.getAdminToken()}`,
    };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  async addPeer(
    id: string,
    opts: { name: string; url: string; sharedSecret: string },
  ): Promise<void> {
    const url = `${this.baseUrl()}/admin/federation/peers/${id}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: this.adminHeaders(true),
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      throw new Error(
        `Add peer failed ${res.status}: ${await res.text()}`,
      );
    }
  }

  async listPeers(): Promise<{ peers: { id: string; name: string; url: string; status: string }[] }> {
    const url = `${this.baseUrl()}/admin/federation/peers`;
    const res = await fetch(url, {
      headers: this.adminHeaders(),
    });
    if (!res.ok) {
      throw new Error(
        `List peers failed ${res.status}: ${await res.text()}`,
      );
    }
    return res.json() as Promise<{ peers: { id: string; name: string; url: string; status: string }[] }>;
  }

  async deletePeer(id: string): Promise<void> {
    const url = `${this.baseUrl()}/admin/federation/peers/${id}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: this.adminHeaders(),
    });
    if (!res.ok) {
      throw new Error(
        `Delete peer failed ${res.status}: ${await res.text()}`,
      );
    }
  }

  // --- Admin: Federation lending rules ---

  async setRule(
    domain: string,
    opts: {
      allow: boolean;
      peers?: string[] | "*";
      pricing?: { mode: string; amount?: number };
    },
  ): Promise<void> {
    const url = `${this.baseUrl()}/admin/federation/rules/${domain}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: this.adminHeaders(true),
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      throw new Error(
        `Set rule failed ${res.status}: ${await res.text()}`,
      );
    }
  }

  async listRules(): Promise<{
    rules: {
      domain: string;
      allow: boolean;
      peers: string[] | "*";
      pricing: { mode: string; amount?: number };
    }[];
  }> {
    const url = `${this.baseUrl()}/admin/federation/rules`;
    const res = await fetch(url, {
      headers: this.adminHeaders(),
    });
    if (!res.ok) {
      throw new Error(
        `List rules failed ${res.status}: ${await res.text()}`,
      );
    }
    return res.json() as Promise<{
      rules: {
        domain: string;
        allow: boolean;
        peers: string[] | "*";
        pricing: { mode: string; amount?: number };
      }[];
    }>;
  }

  async deleteRule(domain: string): Promise<void> {
    const url = `${this.baseUrl()}/admin/federation/rules/${domain}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: this.adminHeaders(),
    });
    if (!res.ok) {
      throw new Error(
        `Delete rule failed ${res.status}: ${await res.text()}`,
      );
    }
  }

  // --- Tunnel methods ---

  async createTunnel(opts?: {
    advertisedDomains?: string[];
    gatewayName?: string;
  }): Promise<{
    tunnelId: string;
    tunnelToken: string;
    publicUrl: string;
  }> {
    const url = `${this.baseUrl()}/tunnels/create`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        advertisedDomains: opts?.advertisedDomains,
        gatewayName: opts?.gatewayName,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Create tunnel failed ${res.status}: ${body}`);
    }
    return res.json() as Promise<{
      tunnelId: string;
      tunnelToken: string;
      publicUrl: string;
    }>;
  }

  async deleteTunnel(id: string): Promise<void> {
    const url = `${this.baseUrl()}/tunnels/${id}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Delete tunnel failed ${res.status}: ${body}`);
    }
  }

  async listTunnels(): Promise<{
    tunnels: { id: string; name: string; publicUrl: string; status: string }[];
  }> {
    const url = `${this.baseUrl()}/tunnels`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`List tunnels failed ${res.status}: ${body}`);
    }
    return res.json() as Promise<{
      tunnels: { id: string; name: string; publicUrl: string; status: string }[];
    }>;
  }

  async discoverPeers(domain?: string): Promise<{
    gateways: {
      id: string;
      name: string;
      publicUrl: string;
      advertisedDomains: string[];
    }[];
  }> {
    const params = domain ? `?domain=${encodeURIComponent(domain)}` : "";
    const url = `${this.baseUrl()}/tunnels/discover${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Discover peers failed ${res.status}: ${body}`);
    }
    return res.json() as Promise<{
      gateways: {
        id: string;
        name: string;
        publicUrl: string;
        advertisedDomains: string[];
      }[];
    }>;
  }

  async tunnelHeartbeat(opts?: {
    advertisedDomains?: string[];
  }): Promise<void> {
    const url = `${this.baseUrl()}/tunnels/heartbeat`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        advertisedDomains: opts?.advertisedDomains,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Tunnel heartbeat failed ${res.status}: ${body}`);
    }
  }
}

/** Create a client for the default gateway (last one authenticated with). */
export async function createClient(): Promise<GatewayClient> {
  const { getDefaultGateway, HOSTED_GATEWAY_URL } = await import("../credentials.js");

  // Env overrides take precedence
  if (process.env.NKMC_TOKEN) {
    const url = process.env.NKMC_GATEWAY_URL ?? HOSTED_GATEWAY_URL;
    return new GatewayClient(url, process.env.NKMC_TOKEN);
  }

  const stored = await getDefaultGateway();
  if (!stored) {
    throw new Error(
      "No token found. Run 'nkmc auth' first, or set NKMC_TOKEN.",
    );
  }

  return new GatewayClient(stored.url, stored.token);
}

/** Create a client for a specific gateway URL. Auto-authenticates if no token stored. */
export async function createClientFor(gatewayUrl: string): Promise<GatewayClient> {
  const { getGatewayToken, saveGatewayToken } = await import("../credentials.js");

  // Check if we have a valid token for this gateway
  const stored = await getGatewayToken(gatewayUrl);
  if (stored) {
    return new GatewayClient(gatewayUrl, stored.token);
  }

  // Auto-authenticate: get a token from the gateway
  const sub = `agent-${Date.now()}`;
  const res = await fetch(`${gatewayUrl.replace(/\/$/, "")}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sub, svc: "gateway", roles: ["agent"], expiresIn: "24h" }),
  });

  if (!res.ok) {
    throw new Error(`Auto-auth failed for ${gatewayUrl}: ${res.status}`);
  }

  const { token } = (await res.json()) as { token: string };
  await saveGatewayToken(gatewayUrl, token);
  return new GatewayClient(gatewayUrl, token);
}
