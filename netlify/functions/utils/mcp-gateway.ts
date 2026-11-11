import { createHash } from 'node:crypto';
import type { CacheStats, ClientScope, McpPlatform } from '../../../src/shared/types';
import { authorizeCall, classifyTool, extractObjectIds, filterResponse, type ToolPolicy } from './mcp-guard';
import { cachedTools, callTool, McpError, serverFor, type McpServer, type McpToolDef } from './mcp-client';
import type { BlobStore, TenantStore } from './tenant-store';

/**
 * Unico punto da cui l'app chiama i server MCP:
 *   guard (perimetro) -> cache del cliente -> server MCP -> filtro in uscita.
 * La cache è sotto t/<cliente>/mcp: due clienti non condividono mai una
 * risposta, e anche un risultato in cache passa prima dal guard.
 */

export interface CachedCall {
  text: string;
  platform: McpPlatform;
  tool: string;
  args: Record<string, unknown>;
  accounts: string[];
  fetchedAt: string;
  expiresAt: string;
}

export type GatewayResult =
  | { ok: true; text: string; fromCache: boolean; fetchedAt: string; args: Record<string, unknown>; accounts: string[]; redacted: number }
  | { ok: false; reason: string; blocked: boolean };

const HOUR = 3600_000;
const MAX_OBSERVED = 20000;
const MAX_TEXT = 200_000;

function* stringsIn(v: unknown): Generator<string> {
  if (typeof v === 'string') yield v;
  else if (Array.isArray(v)) for (const x of v) yield* stringsIn(x);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) yield* stringsIn(x);
}

/** Data di oggi (AAAA-MM-GG) nel fuso del cliente. */
export function todayIn(tz: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Scadenza della cache in base al periodo richiesto: i dati di periodi chiusi
 * non cambiano più, quelli che includono oggi sì.
 */
export function ttlFor(args: Record<string, unknown>, now: Date, tz = 'Europe/Rome'): number {
  const dates: string[] = [];
  let relative = false;
  for (const s of stringsIn(args)) {
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) dates.push(m[1]);
    else if (/(today|yesterday|oggi|last_|this_|_days|daysago|maximum|lifetime|^last|^this)/i.test(s)) relative = true;
  }
  if (relative || !dates.length) return HOUR;
  const max = dates.sort().pop()!;
  const today = todayIn(tz, now);
  if (max >= today) return HOUR;
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${max}T00:00:00Z`)) / (24 * HOUR);
  return days <= 3 ? 6 * HOUR : 30 * 24 * HOUR;
}

/** JSON con chiavi ordinate: stessi argomenti, stessa chiave di cache. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function cacheKey(platform: McpPlatform, tool: string, args: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson({ platform, tool, args })).digest('hex').slice(0, 48);
}

export interface GatewayDeps {
  now?: () => Date;
  call?: (server: McpServer, name: string, args: Record<string, unknown>) => Promise<string>;
  server?: (p: McpPlatform) => McpServer | null;
  tools?: (p: McpPlatform) => Promise<McpToolDef[]>;
  /** Tempo massimo di ogni chiamata MCP (funzioni sincrone di Netlify: circa 10 secondi in tutto). */
  timeoutMs?: number;
}

/**
 * Limite per le chiamate fatte dalle funzioni sincrone: online la funzione si
 * interrompe dopo circa 10 secondi. Nel POC locale e nelle background
 * function non serve.
 */
export const syncCallTimeout = (): number | undefined => (process.env.CHAT_STREAMING === 'true' ? undefined : 8000);

export class McpGateway {
  private policyCache = new Map<McpPlatform, ToolPolicy[]>();
  private observed = new Map<McpPlatform, Set<string>>();
  private memo = new Map<string, GatewayResult>();
  private readonly now: () => Date;
  private readonly call: NonNullable<GatewayDeps['call']>;
  private readonly server: NonNullable<GatewayDeps['server']>;
  private readonly tools: NonNullable<GatewayDeps['tools']>;

  constructor(
    private readonly ts: TenantStore,
    globalStore: BlobStore,
    private readonly scope: ClientScope,
    deps: GatewayDeps = {},
  ) {
    this.now = deps.now ?? (() => new Date());
    this.call = deps.call ?? ((s, n, a) => callTool(s, n, a, deps.timeoutMs));
    this.server = deps.server ?? serverFor;
    this.tools = deps.tools ?? ((p) => cachedTools(globalStore, p));
  }

  async policies(platform: McpPlatform): Promise<ToolPolicy[]> {
    const hit = this.policyCache.get(platform);
    if (hit) return hit;
    if (!this.server(platform)) return [];
    const list = (await this.tools(platform)).map((t) => classifyTool(platform, t));
    this.policyCache.set(platform, list);
    return list;
  }

  private async observedFor(platform: McpPlatform): Promise<Set<string>> {
    let set = this.observed.get(platform);
    if (!set) {
      set = new Set((await this.ts.get<string[]>('observed', platform)) ?? []);
      this.observed.set(platform, set);
    }
    return set;
  }

  private async remember(platform: McpPlatform, ids: string[]) {
    if (!ids.length) return;
    const set = await this.observedFor(platform);
    const fresh = ids.filter((i) => !set.has(i));
    if (!fresh.length) return;
    fresh.forEach((i) => set.add(i));
    await this.ts.update<string[]>('observed', platform, [], (list) => [...new Set([...list, ...fresh])].slice(-MAX_OBSERVED));
  }

  private async stat(kind: 'hits' | 'misses' | 'blocked') {
    const at = this.now().toISOString();
    try {
      await this.ts.update<CacheStats>('stats', 'mcp', { hits: 0, misses: 0, blocked: 0 }, (s) => ({
        ...s,
        [kind]: (s[kind] ?? 0) + 1,
        ...(kind === 'hits' ? { lastHitAt: at } : kind === 'misses' ? { lastMissAt: at } : {}),
      }));
    } catch {
      // Le statistiche non devono mai far fallire una chiamata.
    }
  }

  async execute(platform: McpPlatform, toolName: string, rawArgs: unknown, opts: { force?: boolean } = {}): Promise<GatewayResult> {
    const server = this.server(platform);
    if (!server) return { ok: false, reason: `Server MCP ${platform} non configurato.`, blocked: false };
    const policy = (await this.policies(platform)).find((p) => p.name === toolName);
    if (!policy) return { ok: false, reason: `Strumento ${toolName} inesistente su ${platform}.`, blocked: true };

    const decision = authorizeCall(policy, rawArgs, this.scope, await this.observedFor(platform));
    if (!decision.ok) {
      await this.stat('blocked');
      return { ok: false, reason: decision.reason, blocked: true };
    }

    const key = cacheKey(platform, toolName, decision.args);
    const memo = this.memo.get(key);
    if (memo && !opts.force) return memo;

    const now = this.now();
    if (!opts.force) {
      const cached = await this.ts.get<CachedCall>('mcp', key);
      if (cached && Date.parse(cached.expiresAt) > now.getTime()) {
        await this.stat('hits');
        const res: GatewayResult = { ok: true, text: cached.text, fromCache: true, fetchedAt: cached.fetchedAt, args: decision.args, accounts: decision.accounts, redacted: 0 };
        this.memo.set(key, res);
        return res;
      }
    }

    let raw: string;
    try {
      raw = await this.call(server, toolName, decision.args);
    } catch (err) {
      const msg = err instanceof McpError ? err.message : 'errore del server';
      return { ok: false, reason: `Server ${platform}: ${msg}`, blocked: false };
    }

    const filtered = filterResponse(raw.slice(0, MAX_TEXT), this.scope, decision.anchor);
    if (!filtered.ok) {
      await this.stat('blocked');
      return { ok: false, reason: filtered.reason, blocked: true };
    }

    const fetchedAt = now.toISOString();
    const entry: CachedCall = {
      text: filtered.text,
      platform,
      tool: toolName,
      args: decision.args,
      accounts: decision.accounts,
      fetchedAt,
      expiresAt: new Date(now.getTime() + ttlFor(decision.args, now, this.scope.timezone)).toISOString(),
    };
    await this.ts.set('mcp', key, entry);
    await this.remember(platform, extractObjectIds(filtered.text));
    await this.stat('misses');
    const res: GatewayResult = { ok: true, text: filtered.text, fromCache: false, fetchedAt, args: decision.args, accounts: decision.accounts, redacted: filtered.redacted };
    this.memo.set(key, res);
    return res;
  }
}
