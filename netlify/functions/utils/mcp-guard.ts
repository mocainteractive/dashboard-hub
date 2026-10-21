import { accountsFor, canonicalId, normalizeId } from '../../../src/shared/scope';
import type { ClientScope, McpPlatform } from '../../../src/shared/types';
import type { McpToolDef } from './mcp-client';

/**
 * MCP GUARD: il controllo che rende impossibile vedere i dati di un altro
 * cliente. È deterministico e non dipende dall'AI: anche un modello
 * manipolato da un testo malevolo nei dati non può superarlo.
 *
 * Regole (fail-closed):
 *  1. Strumenti che elencano account dell'agenzia: sempre vietati.
 *  2. Uno strumento è ammesso solo se ha un parametro di account (ancorato al
 *     perimetro) oppure un ID oggetto obbligatorio (ancorato a un oggetto già
 *     visto in una risposta di un account del cliente).
 *  3. Il parametro di account è SEMPRE impostato dal guard: validato contro il
 *     perimetro, riscritto in forma canonica, iniettato se manca (alcuni
 *     server, se manca, usano un account di default).
 *  4. Argomenti non dichiarati dallo schema: rifiutati.
 *  5. ID di account esterni dentro testi liberi (es. query GAQL): rifiutati.
 *  6. ID oggetto (campagne, annunci, ...) ammessi solo se già osservati per
 *     questo cliente.
 *  7. In uscita: riferimenti ad account esterni rimossi; per gli strumenti
 *     ancorati a un oggetto, la risposta viene bloccata per intero.
 */

/** Nomi del parametro di account, per piattaforma. */
export const SCOPE_PARAMS: Record<McpPlatform, string[]> = {
  ga4: ['property_id', 'propertyId', 'property', 'property_ids', 'propertyIds'],
  search_console: ['site_url', 'siteUrl', 'site', 'property', 'site_urls', 'siteUrls'],
  google_ads: ['customer_id', 'customerId', 'customer_ids', 'customerIds'],
  meta_ads: ['ad_account_id', 'adAccountId', 'account_id', 'accountId', 'ad_account_ids'],
  pinterest_ads: ['ad_account_id', 'adAccountId', 'account_id', 'accountId'],
};

/** Strumenti che enumerano clienti/account di tutta l'agenzia. */
const DENY_NAMES = [
  /^list_(ad_)?accounts?$/i,
  /^list_clients?$/i,
  /^list_customers?$/i,
  /^(get|list)_properties$/i,
  /^list_sites$/i,
  /accessible_customers/i,
  /account_summar/i,
  /^list_business(es)?$/i,
  /^search_(accounts|clients|properties|customers)/i,
  /^get_all_/i,
];

const OBJECT_PARAM = /(^id$|_id$|Id$|_ids$|Ids$)/;

export interface ToolPolicy {
  platform: McpPlatform;
  name: string;
  description: string;
  allowed: boolean;
  reason?: string;
  scopeParam?: string;
  scopeIsArray: boolean;
  objectParams: string[];
  properties: Record<string, Record<string, unknown>>;
  required: string[];
}

export function classifyTool(platform: McpPlatform, tool: McpToolDef): ToolPolicy {
  const properties = (tool.inputSchema?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = Array.isArray(tool.inputSchema?.required) ? tool.inputSchema!.required! : [];
  const base = { platform, name: tool.name, description: tool.description ?? '', properties, required, scopeIsArray: false, objectParams: [] as string[] };

  if (!/^[A-Za-z0-9_-]{1,60}$/.test(tool.name)) return { ...base, allowed: false, reason: 'nome non valido' };
  if (DENY_NAMES.some((re) => re.test(tool.name))) return { ...base, allowed: false, reason: 'elenca account di tutta l\'agenzia' };

  const scopeParam = SCOPE_PARAMS[platform].find((p) => p in properties);
  const objectParams = Object.keys(properties).filter((k) => k !== scopeParam && OBJECT_PARAM.test(k));
  const scopeIsArray = !!scopeParam && (properties[scopeParam]?.type === 'array' || /s$/.test(scopeParam));

  if (scopeParam) return { ...base, allowed: true, scopeParam, scopeIsArray, objectParams };
  if (objectParams.some((p) => required.includes(p))) return { ...base, allowed: true, scopeIsArray: false, objectParams };
  return { ...base, allowed: false, reason: 'non ancorato a un account del cliente', objectParams };
}

// --- ID di account dentro testi liberi e risposte ---

interface Pattern {
  re: RegExp;
  /** Gruppo con l'identificativo, 0 = intero match. */
  group: number;
  platform: McpPlatform;
}

const ACCOUNT_PATTERNS: Pattern[] = [
  { re: /\bact_(\d{5,25})\b/g, group: 1, platform: 'meta_ads' },
  { re: /\b(\d{3}-\d{3}-\d{4})\b/g, group: 1, platform: 'google_ads' },
  { re: /\bcustomers\/(\d{10})\b/g, group: 1, platform: 'google_ads' },
  { re: /\bcustomer(?:\.id|_id)\s*=\s*['"]?(\d{10})\b/gi, group: 1, platform: 'google_ads' },
  { re: /\bproperties\/(\d{6,12})\b/g, group: 1, platform: 'ga4' },
  { re: /\bsc-domain:[a-z0-9.-]+\.[a-z]{2,}\b/gi, group: 0, platform: 'search_console' },
];

function allowedSet(scope: ClientScope, platform: McpPlatform): Set<string> {
  return new Set(accountsFor(scope, platform).map((a) => normalizeId(platform, a.id)));
}

/** ID di account (di qualunque piattaforma) citati nel testo e NON nel perimetro. */
export function foreignAccounts(text: string, scope: ClientScope): string[] {
  const out: string[] = [];
  for (const p of ACCOUNT_PATTERNS) {
    const allowed = allowedSet(scope, p.platform);
    for (const m of text.matchAll(p.re)) {
      const n = normalizeId(p.platform, m[p.group]);
      if (!allowed.has(n)) out.push(m[0]);
    }
  }
  return out;
}

export const REDACTED = '[account esterno rimosso]';

export function redactForeign(text: string, scope: ClientScope): { text: string; count: number } {
  let count = 0;
  let outText = text;
  for (const p of ACCOUNT_PATTERNS) {
    const allowed = allowedSet(scope, p.platform);
    outText = outText.replace(p.re, (...m: string[]) => {
      const n = normalizeId(p.platform, m[p.group]);
      if (allowed.has(n)) return m[0];
      count++;
      return REDACTED;
    });
  }
  return { text: outText, count };
}

function* stringsIn(v: unknown, depth = 0): Generator<string> {
  if (depth > 6) return;
  if (typeof v === 'string') yield v;
  else if (Array.isArray(v)) for (const x of v) yield* stringsIn(x, depth + 1);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) yield* stringsIn(x, depth + 1);
}

/** ID oggetto (campagne, annunci, creatività, video...) visti in una risposta. */
export function extractObjectIds(text: string): string[] {
  const out = new Set<string>();
  const res = [
    /"(?:id|[a-z_]*_id)"\s*:\s*"?(\d{5,25})"?/gi,
    /\b(?:[a-z]+_)*id\b\s*[:=#]\s*["']?(\d{5,25})\b/gi,
    /\bID\s+(\d{5,25})\b/g,
  ];
  for (const re of res) for (const m of text.matchAll(re)) out.add(m[1]);
  return [...out];
}

// --- Autorizzazione della chiamata ---

export type GuardResult =
  | { ok: true; args: Record<string, unknown>; anchor: 'account' | 'object'; accounts: string[] }
  | { ok: false; reason: string };

function objectValues(v: unknown): string[] | null {
  if (typeof v === 'string' || typeof v === 'number') return [String(v).trim()];
  if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.map((x) => String(x).trim());
  return null;
}

function styled(platform: McpPlatform, raw: unknown, allowedCanonical: string): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  const n = normalizeId(platform, allowedCanonical);
  if (platform === 'ga4' && /^properties\//i.test(s)) return `properties/${n}`;
  if (platform === 'google_ads' && s.includes('-')) return `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`;
  return canonicalId(platform, n);
}

/**
 * Decide se una chiamata è ammessa e restituisce gli argomenti DA USARE
 * (con il parametro di account imposto dal guard).
 */
export function authorizeCall(policy: ToolPolicy, rawArgs: unknown, scope: ClientScope, observed: Set<string>): GuardResult {
  if (!policy.allowed) return { ok: false, reason: `Strumento ${policy.name} non consentito (${policy.reason}).` };
  if (rawArgs !== undefined && (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs))) {
    return { ok: false, reason: 'Argomenti non validi.' };
  }
  const args: Record<string, unknown> = { ...((rawArgs as Record<string, unknown>) ?? {}) };

  const unknownKeys = Object.keys(args).filter((k) => !(k in policy.properties));
  if (unknownKeys.length) return { ok: false, reason: `Parametri non previsti dallo strumento: ${unknownKeys.join(', ')}.` };

  const platform = policy.platform;
  const accounts = accountsFor(scope, platform);
  if (!accounts.length) return { ok: false, reason: `Nessun account ${platform} nel perimetro del cliente.` };
  const allowed = new Map(accounts.map((a) => [normalizeId(platform, a.id), a.id]));
  const used: string[] = [];

  if (policy.scopeParam) {
    const p = policy.scopeParam;
    const given = args[p];
    if (policy.scopeIsArray) {
      const list = given === undefined ? [...allowed.values()] : Array.isArray(given) ? given : [given];
      const out: string[] = [];
      for (const v of list) {
        const n = normalizeId(platform, String(v));
        const canon = allowed.get(n);
        if (!canon) return { ok: false, reason: `Account ${String(v).slice(0, 40)} non appartiene a questo cliente.` };
        out.push(styled(platform, v, canon));
        used.push(`${platform}:${n}`);
      }
      args[p] = out;
    } else if (given === undefined || given === null || given === '') {
      if (allowed.size !== 1) {
        return { ok: false, reason: `Specifica ${p} tra gli account del cliente: ${[...allowed.values()].join(', ')}.` };
      }
      const [n, canon] = [...allowed.entries()][0];
      args[p] = styled(platform, undefined, canon);
      used.push(`${platform}:${n}`);
    } else {
      if (typeof given !== 'string' && typeof given !== 'number') return { ok: false, reason: `${p} non valido.` };
      const n = normalizeId(platform, String(given));
      const canon = allowed.get(n);
      if (!canon) return { ok: false, reason: `Account ${String(given).slice(0, 40)} non appartiene a questo cliente.` };
      args[p] = styled(platform, given, canon);
      used.push(`${platform}:${n}`);
    }
  }

  for (const op of policy.objectParams) {
    if (args[op] === undefined || args[op] === null || args[op] === '') continue;
    const vals = objectValues(args[op]);
    if (!vals) return { ok: false, reason: `${op} non valido.` };
    const unknown = vals.filter((v) => !observed.has(v));
    if (unknown.length) {
      return {
        ok: false,
        reason: `ID ${unknown[0].slice(0, 30)} (${op}) non verificato per questo cliente: recuperalo prima con uno strumento che parte dall'account del cliente.`,
      };
    }
  }

  if (!policy.scopeParam) {
    const anchored = policy.objectParams.some((p) => args[p] !== undefined && args[p] !== null && args[p] !== '');
    if (!anchored) return { ok: false, reason: 'Chiamata non ancorata a un account o a un oggetto del cliente.' };
  }

  // Testi liberi: nessun riferimento ad account esterni (es. dentro una query).
  for (const [k, v] of Object.entries(args)) {
    if (k === policy.scopeParam) continue;
    for (const s of stringsIn(v)) {
      const foreign = foreignAccounts(s, scope);
      if (foreign.length) return { ok: false, reason: `Il parametro ${k} cita un account esterno al cliente.` };
    }
  }

  // Le chiamate ancorate a un oggetto valgono per gli account della piattaforma.
  if (!used.length) used.push(...[...allowed.keys()].map((n) => `${platform}:${n}`));
  return { ok: true, args, anchor: policy.scopeParam ? 'account' : 'object', accounts: used };
}

/** Controllo in uscita sul testo restituito dal server MCP. */
export function filterResponse(text: string, scope: ClientScope, anchor: 'account' | 'object'): { ok: true; text: string; redacted: number } | { ok: false; reason: string } {
  const { text: clean, count } = redactForeign(text, scope);
  if (anchor === 'object' && count > 0) {
    return { ok: false, reason: 'Risposta bloccata: l\'oggetto richiesto risulta collegato a un account esterno al cliente.' };
  }
  return { ok: true, text: clean, redacted: count };
}

/**
 * Schema dello strumento come lo vede l'AI: il parametro di account è
 * nascosto (un solo account, lo inserisce il guard) oppure limitato
 * all'elenco degli account del cliente.
 */
export function schemaForAi(policy: ToolPolicy, scope: ClientScope): { properties: Record<string, Record<string, unknown>>; required: string[] } {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(policy.properties)) properties[k] = v;
  let required = [...policy.required];
  if (policy.scopeParam) {
    const ids = accountsFor(scope, policy.platform).map((a) => a.id);
    if (ids.length === 1) {
      delete properties[policy.scopeParam];
      required = required.filter((r) => r !== policy.scopeParam);
    } else {
      properties[policy.scopeParam] = policy.scopeIsArray
        ? { type: 'array', items: { type: 'string', enum: ids }, description: 'Account del cliente' }
        : { type: 'string', enum: ids, description: 'Account del cliente' };
    }
  }
  return { properties, required };
}
