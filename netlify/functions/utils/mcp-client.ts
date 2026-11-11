import type { McpPlatform } from '../../../src/shared/types';
import type { BlobStore } from './tenant-store';

/**
 * Client JSON-RPC verso i server MCP di Moca (Cloudflare Workers di
 * mocainteractive/server-mcp-remoto), stesso protocollo usato dall'app
 * Onboarding Data Lake. I token dei server restano qui, nelle variabili
 * MCP_<PIATTAFORMA>_URL: non arrivano mai al browser né all'AI.
 *
 * Questo modulo NON applica il perimetro del cliente: ogni chiamata deve
 * passare prima da mcp-guard.
 */

export const MCP_ENV_PREFIX: Record<McpPlatform, string> = {
  ga4: 'MCP_GA4',
  search_console: 'MCP_GSC',
  google_ads: 'MCP_GADS',
  meta_ads: 'MCP_META',
  pinterest_ads: 'MCP_PINTEREST',
};

export interface McpServer {
  url: string;
  token?: string;
}

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
}

export class McpError extends Error {}

export function serverFor(p: McpPlatform): McpServer | null {
  const url = process.env[`${MCP_ENV_PREFIX[p]}_URL`]?.trim();
  const token = process.env[`${MCP_ENV_PREFIX[p]}_TOKEN`]?.trim() || undefined;
  return url ? { url, token } : null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'indirizzo non valido';
  }
}

async function rpc(server: McpServer, method: string, params: Record<string, unknown>, timeoutMs: number) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (server.token) headers.Authorization = `Bearer ${server.token}`;
  const host = hostOf(server.url);
  let res: Response;
  try {
    res = await fetch(server.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const e = err as { name?: string };
    // Mai il percorso dell'URL nei messaggi: contiene il token.
    throw new McpError(e?.name === 'TimeoutError' ? `${host} non ha risposto in tempo` : `${host} non raggiungibile`);
  }
  if (!res.ok) throw new McpError(`${host}: HTTP ${res.status}`);
  const raw = await res.text();
  const payload = (res.headers.get('content-type') ?? '').includes('text/event-stream')
    ? (raw
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .pop() ?? '')
    : raw;
  let msg: { error?: { message?: string }; result?: Record<string, unknown> };
  try {
    msg = JSON.parse(payload);
  } catch {
    throw new McpError(`${host}: risposta non valida`);
  }
  if (msg.error) throw new McpError(`${host}: ${msg.error.message ?? 'errore'}`);
  return msg.result ?? {};
}

export async function callTool(server: McpServer, name: string, args: Record<string, unknown>, timeoutMs = 25000): Promise<string> {
  const result = (await rpc(server, 'tools/call', { name, arguments: args }, timeoutMs)) as {
    content?: { type?: string; text?: string }[];
    isError?: boolean;
  };
  const text = (result.content ?? []).map((c) => c.text ?? '').join('\n');
  if (result.isError || /^\s*(Error:|Errore)/.test(text)) throw new McpError(text.slice(0, 300) || 'Errore del server MCP');
  return text;
}

export async function listTools(server: McpServer, timeoutMs = 15000): Promise<McpToolDef[]> {
  const result = (await rpc(server, 'tools/list', {}, timeoutMs)) as { tools?: McpToolDef[] };
  return Array.isArray(result.tools) ? result.tools : [];
}

const TOOLS_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Elenco strumenti di un server, in cache 6 ore. È solo lo schema degli
 * strumenti (uguale per tutti), non contiene dati dei clienti.
 */
export async function cachedTools(store: BlobStore, platform: McpPlatform, now = Date.now()): Promise<McpToolDef[]> {
  const server = serverFor(platform);
  if (!server) return [];
  const key = `global/tools/${platform}`;
  const hit = (await store.get(key, { type: 'json' })) as { at: number; tools: McpToolDef[] } | null;
  if (hit && now - hit.at < TOOLS_TTL_MS) return hit.tools;
  try {
    const tools = await listTools(server);
    await store.setJSON(key, { at: now, tools });
    return tools;
  } catch (err) {
    if (hit) return hit.tools;
    throw err;
  }
}
