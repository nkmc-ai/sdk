export class GatewayClient {
  constructor(
    private gatewayUrl: string,
    private token: string,
  ) {}

  private baseUrl(): string {
    return this.gatewayUrl.replace(/\/$/, "");
  }

  async execute(command: string): Promise<unknown> {
    const url = `${this.baseUrl()}/execute`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gateway error ${res.status}: ${body}`);
    }
    return res.json();
  }

  // --- BYOK methods ---

  async uploadByok(
    domain: string,
    auth: { type: string; token?: string; header?: string; key?: string },
  ): Promise<void> {
    const url = `${this.baseUrl()}/byok/${domain}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ auth }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`BYOK upload failed ${res.status}: ${body}`);
    }
  }

  async listByok(): Promise<{ domains: string[] }> {
    const url = `${this.baseUrl()}/byok`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`BYOK list failed ${res.status}: ${body}`);
    }
    return res.json() as Promise<{ domains: string[] }>;
  }

  async deleteByok(domain: string): Promise<void> {
    const url = `${this.baseUrl()}/byok/${domain}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`BYOK delete failed ${res.status}: ${body}`);
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
