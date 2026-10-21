import { parseScope } from '../../../../src/shared/scope';
import type { BlobStore } from '../tenant-store';
import type { McpToolDef } from '../mcp-client';

/** JSON del data lake del cliente A (formato di clients/<slug>.json). */
export const CLIENT_A_JSON = JSON.stringify({
  client_id: 'cliente_a',
  display_name: 'Cliente A',
  gcp_project: 'moca-cliente-a',
  location: 'europe-west1',
  timezone: 'Europe/Rome',
  currency: 'EUR',
  modules: ['base'],
  sources: {
    ga4: [{ property_id: '338073799', export_dataset: 'superform_outputs_338073799', ingestion: 'ga4dataform', valid_from: '2020-01-01', valid_to: null }],
    search_console: [{ site: 'sc-domain:clientea.it', valid_from: '2026-01-01', valid_to: null }],
    google_ads: [{ customer_id: '666-948-1939', valid_from: '2020-01-01', valid_to: null }],
    meta_ads: [{ account_id: 'act_36311415', ingestion: 'funnel', valid_from: '2020-01-01', valid_to: null }],
    tiktok_ads: [{ account_id: '7012345678901234567', ingestion: 'funnel', valid_from: '2020-01-01', valid_to: null }],
  },
  custom: { extra_metrics: [], mart_overrides: false },
});

export const CLIENT_B_JSON = JSON.stringify({
  client_id: 'cliente_b',
  display_name: 'Cliente B',
  sources: {
    meta_ads: [{ account_id: 'act_99999999', valid_from: '2020-01-01' }, { account_id: 'act_88888888', valid_from: '2020-01-01' }],
    ga4: [{ property_id: '295033115', valid_from: '2020-01-01' }],
  },
});

export const scopeA = () => parseScope(CLIENT_A_JSON);
export const scopeB = () => parseScope(CLIENT_B_JSON);

/** Strumenti come li espone il server MCP Meta (schema reale). */
export const META_TOOLS: McpToolDef[] = [
  { name: 'list_ad_accounts', description: 'Lista account', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  {
    name: 'get_account_overview',
    description: 'Panoramica. Se omesso usa il default.',
    inputSchema: { type: 'object', properties: { ad_account_id: { type: 'string' }, date_preset: { type: 'string' }, time_range: { type: 'object' }, include_campaigns: { type: 'boolean' } } },
  },
  { name: 'get_campaign_insights', description: 'Dettagli campagna', inputSchema: { type: 'object', properties: { campaign_id: { type: 'string' }, date_preset: { type: 'string' } }, required: ['campaign_id'] } },
  { name: 'get_ad_creative', description: 'Creatività', inputSchema: { type: 'object', properties: { ad_id: { type: 'string' } }, required: ['ad_id'] } },
  { name: 'list_ads', description: 'Lista ads', inputSchema: { type: 'object', properties: { ad_account_id: { type: 'string' }, adset_id: { type: 'string' }, campaign_id: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'mystery_tool', description: 'Senza ancoraggio', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
];

export const GADS_TOOLS: McpToolDef[] = [
  { name: 'list_customers', description: 'Elenco MCC', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_gaql', description: 'Query GAQL', inputSchema: { type: 'object', properties: { customer_id: { type: 'string' }, query: { type: 'string' } }, required: ['customer_id', 'query'] } },
];

/** Netlify Blobs in memoria, con etag per le scritture condizionali. */
export class MemoryBlobStore implements BlobStore {
  data = new Map<string, { value: unknown; etag: string }>();
  private n = 0;

  async get(key: string) {
    const e = this.data.get(key);
    return e ? structuredClone(e.value) : null;
  }
  async getWithMetadata(key: string) {
    const e = this.data.get(key);
    return e ? { data: structuredClone(e.value), etag: e.etag } : null;
  }
  async setJSON(key: string, value: unknown, opts?: { onlyIfMatch?: string; onlyIfNew?: boolean }) {
    const cur = this.data.get(key);
    if (opts?.onlyIfNew && cur) return { modified: false };
    if (opts?.onlyIfMatch && cur?.etag !== opts.onlyIfMatch) return { modified: false };
    const etag = `e${++this.n}`;
    this.data.set(key, { value: structuredClone(value), etag });
    return { modified: true, etag };
  }
  async delete(key: string) {
    this.data.delete(key);
  }
  async list({ prefix }: { prefix: string }) {
    return { blobs: [...this.data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
  }
}
