import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { chmod } from "node:fs/promises";

// --- Types ---

interface PublishTokenEntry {
  publishToken: string;
  issuedAt: string;
  expiresAt: string;
}

interface GatewayEntry {
  token: string;
  issuedAt: string;
  expiresAt: string;
  tunnel?: {
    id: string;
    publicUrl: string;
  };
}

export interface KeyEntry {
  auth: { type: string; token?: string; header?: string; key?: string };
  updatedAt: string;
}

interface CredentialStore {
  /** Publish tokens keyed by domain */
  tokens: Record<string, PublishTokenEntry>;
  /** Gateway tokens keyed by gateway URL */
  gateways?: Record<string, GatewayEntry>;
  /** Default gateway URL */
  default?: string;
  /** Local key cache (legacy, not recommended) */
  keys?: Record<string, KeyEntry>;

  // Legacy field — migrated to gateways on read
  agentToken?: {
    token: string;
    gatewayUrl: string;
    issuedAt: string;
    expiresAt: string;
  };
}

// --- Paths ---

function nkmcDir(): string {
  return process.env.NKMC_HOME || join(homedir(), ".nkmc");
}

function credentialsPath(): string {
  return join(nkmcDir(), "credentials.json");
}

// --- Core read/write ---

export async function loadCredentials(): Promise<CredentialStore> {
  try {
    const raw = await readFile(credentialsPath(), "utf-8");
    const creds = JSON.parse(raw) as CredentialStore;

    // Migrate legacy agentToken → gateways
    if (creds.agentToken && !creds.gateways) {
      const { token, gatewayUrl, issuedAt, expiresAt } = creds.agentToken;
      creds.gateways = { [gatewayUrl]: { token, issuedAt, expiresAt } };
      creds.default = gatewayUrl;
      delete creds.agentToken;
    }

    return creds;
  } catch {
    return { tokens: {} };
  }
}

async function saveCredentials(creds: CredentialStore): Promise<void> {
  const dir = nkmcDir();
  await mkdir(dir, { recursive: true });
  const filePath = credentialsPath();
  await writeFile(filePath, JSON.stringify(creds, null, 2) + "\n");
  await chmod(filePath, 0o600);
}

// --- JWT helpers ---

function decodeJwtPayload(token: string): { iat?: number; exp?: number } {
  const payloadB64 = token.split(".")[1];
  return JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
}

// --- Gateway tokens (multi-gateway) ---

export const HOSTED_GATEWAY_URL = "https://api.nkmc.ai";

export async function saveGatewayToken(
  gatewayUrl: string,
  token: string,
): Promise<void> {
  const creds = await loadCredentials();
  const payload = decodeJwtPayload(token);

  if (!creds.gateways) creds.gateways = {};
  creds.gateways[gatewayUrl] = {
    token,
    issuedAt: new Date((payload.iat ?? 0) * 1000).toISOString(),
    expiresAt: new Date((payload.exp ?? 0) * 1000).toISOString(),
  };
  creds.default = gatewayUrl;

  await saveCredentials(creds);
}

export async function getGatewayToken(gatewayUrl: string): Promise<GatewayEntry | null> {
  const creds = await loadCredentials();
  const entry = creds.gateways?.[gatewayUrl];
  if (!entry) return null;
  if (new Date(entry.expiresAt).getTime() < Date.now()) return null;
  return entry;
}

export async function getDefaultGateway(): Promise<{ url: string; token: string } | null> {
  const creds = await loadCredentials();
  const url = creds.default;
  if (!url) return null;
  const entry = creds.gateways?.[url];
  if (!entry) return null;
  if (new Date(entry.expiresAt).getTime() < Date.now()) return null;
  return { url, token: entry.token };
}

export async function listGateways(): Promise<Record<string, GatewayEntry>> {
  const creds = await loadCredentials();
  return creds.gateways ?? {};
}

// --- Tunnel info (stored alongside gateway token) ---

export async function saveTunnelInfo(
  gatewayUrl: string,
  tunnel: { id: string; publicUrl: string },
): Promise<void> {
  const creds = await loadCredentials();
  if (!creds.gateways?.[gatewayUrl]) return;
  creds.gateways[gatewayUrl].tunnel = tunnel;
  await saveCredentials(creds);
}

export async function clearTunnelInfo(gatewayUrl: string): Promise<void> {
  const creds = await loadCredentials();
  if (!creds.gateways?.[gatewayUrl]) return;
  delete creds.gateways[gatewayUrl].tunnel;
  await saveCredentials(creds);
}

export async function getTunnelInfo(
  gatewayUrl: string,
): Promise<{ id: string; publicUrl: string } | null> {
  const creds = await loadCredentials();
  return creds.gateways?.[gatewayUrl]?.tunnel ?? null;
}

// --- Legacy compat: getAgentToken / saveAgentToken ---

export async function saveAgentToken(
  gatewayUrl: string,
  token: string,
): Promise<void> {
  return saveGatewayToken(gatewayUrl, token);
}

export async function getAgentToken(): Promise<{ token: string; gatewayUrl: string } | null> {
  return getDefaultGateway();
}

// --- Publish tokens ---

export async function saveToken(
  domain: string,
  publishToken: string,
): Promise<void> {
  const creds = await loadCredentials();
  const payload = decodeJwtPayload(publishToken);
  creds.tokens[domain] = {
    publishToken,
    issuedAt: new Date((payload.iat ?? 0) * 1000).toISOString(),
    expiresAt: new Date((payload.exp ?? 0) * 1000).toISOString(),
  };
  await saveCredentials(creds);
}

export async function getToken(domain: string): Promise<string | null> {
  const creds = await loadCredentials();
  const entry = creds.tokens[domain];
  if (!entry) return null;
  if (new Date(entry.expiresAt).getTime() < Date.now()) return null;
  return entry.publishToken;
}

// --- BYOK key management (local, legacy) ---

export async function saveKey(
  domain: string,
  auth: KeyEntry["auth"],
): Promise<void> {
  const creds = await loadCredentials();
  if (!creds.keys) creds.keys = {};
  creds.keys[domain] = { auth, updatedAt: new Date().toISOString() };
  await saveCredentials(creds);
}

export async function getKey(domain: string): Promise<KeyEntry | null> {
  const creds = await loadCredentials();
  return creds.keys?.[domain] ?? null;
}

export async function listKeys(): Promise<Record<string, KeyEntry>> {
  const creds = await loadCredentials();
  return creds.keys ?? {};
}

export async function deleteKey(domain: string): Promise<boolean> {
  const creds = await loadCredentials();
  if (!creds.keys?.[domain]) return false;
  delete creds.keys[domain];
  await saveCredentials(creds);
  return true;
}
