import { MCP_PLATFORMS, type ClientScope, type McpPlatform, type PlatformKey, type ScopeAccount } from './types';

/**
 * Perimetro del cliente: lettura dell'output dell'app Onboarding Data Lake
 * (clients/<slug>.json), salvato nell'Hub come configurazione del cliente
 * DATA_LAKE_CLIENT_JSON.
 *
 * È la sola fonte degli account interrogabili: il browser non può né
 * leggerlo né modificarlo, viaggia dentro la sessione cifrata.
 */

export const SCOPE_CONFIG_KEY = 'DATA_LAKE_CLIENT_JSON';

/** Campo identificativo di ogni piattaforma nel JSON del data lake. */
const ID_FIELD: Record<PlatformKey, string> = {
  ga4: 'property_id',
  search_console: 'site',
  google_ads: 'customer_id',
  merchant_center: 'account_id',
  meta_ads: 'account_id',
  bing_ads: 'account_id',
  tiktok_ads: 'account_id',
  pinterest_ads: 'account_id',
  criteo: 'account_id',
  linkedin_ads: 'account_id',
};

export class ScopeError extends Error {}

/** Forma confrontabile di un identificativo: due scritture dello stesso account coincidono. */
export function normalizeId(platform: PlatformKey, raw: string): string {
  const v = String(raw).trim();
  switch (platform) {
    case 'ga4':
      return v.replace(/^properties\//i, '').replace(/\D/g, '');
    case 'google_ads':
    case 'meta_ads':
    case 'pinterest_ads':
      return v.replace(/^act_/i, '').replace(/\D/g, '');
    case 'search_console':
      return v.toLowerCase().replace(/\/+$/, '');
    default:
      return v.toLowerCase();
  }
}

/** Forma da passare al server MCP. */
export function canonicalId(platform: PlatformKey, raw: string): string {
  const n = normalizeId(platform, raw);
  switch (platform) {
    case 'meta_ads':
      return `act_${n}`;
    case 'search_console':
      // Le proprietà a prefisso URL hanno lo slash finale.
      return n.startsWith('sc-domain:') ? n : `${n}/`;
    default:
      return n;
  }
}

function validId(platform: PlatformKey, n: string): boolean {
  switch (platform) {
    case 'ga4':
      return /^\d{6,12}$/.test(n);
    case 'google_ads':
      return /^\d{10}$/.test(n);
    case 'meta_ads':
    case 'pinterest_ads':
      return /^\d{3,25}$/.test(n);
    case 'search_console':
      return /^(sc-domain:[a-z0-9.-]+\.[a-z]{2,}|https?:\/\/[^\s/]+(\/[^\s]*)?)$/.test(n);
    default:
      return n.length > 0 && n.length < 100;
  }
}

/**
 * Legge il JSON del data lake. Lancia ScopeError con un messaggio in italiano
 * se manca o non è valido: in quel caso l'app non fa nessuna chiamata MCP.
 */
export function parseScope(raw: string | null | undefined): ClientScope {
  if (!raw || !raw.trim()) throw new ScopeError(`Configurazione ${SCOPE_CONFIG_KEY} assente per questo cliente.`);
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(raw.trim());
  } catch {
    throw new ScopeError(`${SCOPE_CONFIG_KEY} non è un JSON valido: incolla il contenuto di clients/<slug>.json.`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new ScopeError(`${SCOPE_CONFIG_KEY} deve essere un oggetto JSON.`);
  const slug = typeof doc.client_id === 'string' ? doc.client_id.trim() : '';
  if (!/^[a-z0-9_]{2,64}$/.test(slug)) throw new ScopeError('client_id mancante o non valido nel JSON del data lake.');
  const sources = doc.sources;
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) throw new ScopeError('Sezione "sources" mancante nel JSON del data lake.');

  const accounts: ScopeAccount[] = [];
  const seen = new Set<string>();
  for (const [key, list] of Object.entries(sources as Record<string, unknown>)) {
    if (!(key in ID_FIELD)) continue; // piattaforma sconosciuta: ignorata, mai interrogata
    const platform = key as PlatformKey;
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const rawId = rec[ID_FIELD[platform]];
      if (typeof rawId !== 'string' && typeof rawId !== 'number') continue;
      const n = normalizeId(platform, String(rawId));
      if (!validId(platform, n)) throw new ScopeError(`Identificativo non valido per ${platform}: ${String(rawId).slice(0, 60)}`);
      const dedupe = `${platform}:${n}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      accounts.push({
        platform,
        id: canonicalId(platform, n),
        validFrom: typeof rec.valid_from === 'string' ? rec.valid_from : undefined,
        validTo: typeof rec.valid_to === 'string' ? rec.valid_to : null,
      });
    }
  }
  if (!accounts.length) throw new ScopeError('Nessun account nelle sorgenti del JSON del data lake.');

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return {
    slug,
    displayName: str(doc.display_name) ?? slug,
    gcpProject: str(doc.gcp_project),
    timezone: str(doc.timezone),
    currency: str(doc.currency),
    accounts,
  };
}

/** Account interrogabili di una piattaforma MCP. */
export function accountsFor(scope: ClientScope, platform: McpPlatform): ScopeAccount[] {
  return scope.accounts.filter((a) => a.platform === platform);
}

/** Piattaforme MCP con almeno un account nel perimetro. */
export function scopedPlatforms(scope: ClientScope): McpPlatform[] {
  return MCP_PLATFORMS.filter((p) => accountsFor(scope, p).length > 0);
}

/** Chiavi "piattaforma:id normalizzato" di tutto il perimetro. */
export function scopeKeys(scope: ClientScope): Set<string> {
  return new Set(scope.accounts.map((a) => `${a.platform}:${normalizeId(a.platform, a.id)}`));
}

/** Un dataset resta visibile solo se tutti i suoi account sono ancora nel perimetro. */
export function inScope(scope: ClientScope, accountKeys: string[]): boolean {
  const keys = scopeKeys(scope);
  return accountKeys.every((k) => keys.has(k));
}
