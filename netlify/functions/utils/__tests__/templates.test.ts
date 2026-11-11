import { describe, expect, it, vi } from 'vitest';
import { parseScope } from '../../../../src/shared/scope';
import type { Dataset } from '../../../../src/shared/types';
import { McpGateway } from '../mcp-gateway';
import type { McpToolDef } from '../mcp-client';
import { datasetForPeriod } from '../period';
import type { AppSession } from '../session';
import { createDefaultDashboard } from '../templates';
import { TenantStore } from '../tenant-store';
import { MemoryBlobStore } from './fixtures';

/** Risposte nel formato reale dei server Moca (GA4 e Search Console). */

function ga4(args: Record<string, unknown>): string {
  const dims = (args.dimensions as string[]) ?? [];
  const metrics = args.metrics as string[];
  const head = `[cliente - GA4]\n\n📊 Report Personalizzato\nPeriodo: ${args.start_date} → ${args.end_date}\n\n📈 TOTALI (server-side)\n  sessions: 100\n  totalUsers: 80\n\nRighe:\n`;
  const header = [...dims, ...metrics].join(' | ');
  const val = (m: string, i: number) => (m === 'engagementRate' ? `${50 + i}.00%` : String(10 * (i + 1)));
  let rows: string[];
  if (!dims.length) rows = [metrics.map((m) => val(m, 0)).join(' | ')];
  else if (dims[0] === 'date') rows = ['20261101', '20261102', '20261103'].map((d, i) => [d, ...metrics.map((m) => val(m, i))].join(' | '));
  else if (dims[0] === 'landingPage') rows = ['/mutui', '/'].map((d, i) => [d, ...metrics.map((m) => val(m, i))].join(' | '));
  else rows = ['Organic Search', 'Direct'].map((d, i) => [d, ...metrics.map((m) => val(m, i))].join(' | '));
  return `${head}${header}\n${'─'.repeat(20)}\n${rows.join('\n')}\n`;
}

const GSC: Record<string, string> = {
  get_property_stats: `📊 Statistiche REALI aggregate:\n\n🔹 Clic totali: 2,180\n🔹 Impressioni totali: 142,477\n🔹 CTR medio: 1.53%\n🔹 Posizione media: 7.1\n\n✅ Dati effettivi.`,
  get_performance_timeseries: `📅 Andamento giornaliero:\n\n2026-11-01 — Clic: 8 | Impr: 923 | CTR: 0.87% | Pos: 16.3\n2026-11-02 — Clic: 46 | Impr: 1,503 | CTR: 3.06% | Pos: 12.5\n\n📌 Totale periodo — Clic: 54 | Impressioni: 2,426`,
  get_search_queries: `📊 Top 2 query di ricerca:\n\n1. "mutuo"\n   Clic: 26 | Impressioni: 688 | CTR: 3.78% | Posizione: 4.1\n\n2. "surroga"\n   Clic: 16 | Impressioni: 149 | CTR: 10.7% | Posizione: 2.0\n`,
  get_query_page_combinations: `🔍 Combinazioni Query × Pagina:\n\n1. "mutuo prima casa" → mutui\n   Clic: 30 | Impressioni: 900 | CTR: 3.3% | Posizione: 4.0\n\n2. "clientea" → /\n   Clic: 50 | Impressioni: 100 | CTR: 50% | Posizione: 1.0\n`,
  get_top_pages: `📄 Top 2 pagine:\n\n1. area-riservata\n   Clic: 376 | Impressioni: 1,333 | CTR: 28.21% | Posizione: 1.3\n\n2. /\n   Clic: 335 | Impressioni: 4,959 | CTR: 6.76% | Posizione: 11.5\n`,
};

const tool = (name: string, props: string[]): McpToolDef => ({ name, description: name, inputSchema: { type: 'object', properties: Object.fromEntries(props.map((p) => [p, { type: 'string' }])) } });
const GA4_TOOLS = [tool('get_custom_report', ['property_id', 'metrics', 'dimensions', 'start_date', 'end_date', 'limit', 'dimension_filter'])];
const GSC_TOOLS = ['get_property_stats', 'get_performance_timeseries', 'get_search_queries', 'get_top_pages', 'get_query_page_combinations'].map((n) => tool(n, ['siteUrl', 'startDate', 'endDate', 'limit']));

describe('dashboard predefinita', () => {
  it('crea i grafici di GA4 e Search Console come ricette rileggibili per periodo', async () => {
    const scope = parseScope(JSON.stringify({ client_id: 'cliente_a', sources: { ga4: [{ property_id: '338073799' }], search_console: [{ site: 'https://www.clientea.it/' }] } }));
    const store = new MemoryBlobStore();
    const session = { v: 1, uid: 'u', uname: 'Mario', role: 'specialist', cid: 'cliente-a', cname: 'A', scope, keys: {}, models: {}, exp: 0 } as AppSession;
    const ts = new TenantStore(store, session);
    const call = vi.fn(async (s: { url: string }, name: string, args: Record<string, unknown>) => (s.url.includes('ga4') ? ga4(args) : GSC[name]));
    const gateway = new McpGateway(ts, store, scope, {
      call,
      server: (p) => (p === 'ga4' ? { url: 'https://ga4.invalid' } : p === 'search_console' ? { url: 'https://gsc.invalid' } : null),
      tools: async (p) => (p === 'ga4' ? GA4_TOOLS : p === 'search_console' ? GSC_TOOLS : []),
    });

    const { dashboard, report } = await createDefaultDashboard({ ts, session, scope, gateway, from: '2026-10-13', to: '2026-11-11', hasServer: () => true });

    expect(report.filter((r) => !r.ok)).toEqual([]);
    expect(dashboard.widgets.map((w) => w.spec.title)).toEqual([
      'GA4, numeri chiave',
      'GA4, sessioni e utenti nel tempo',
      'GA4, sessioni per canale',
      'GA4, landing page principali',
      'Search Console, numeri chiave',
      'Search Console, clic nel tempo',
      'Search Console, impressioni nel tempo',
      'Search Console, query principali',
      'Search Console, pagine principali',
      'Query × conversioni stimate (organico)',
    ]);
    // Incrocio query × conversioni: pagina "mutui" (GSC) = "/mutui" (GA4), conversioni stimate = 30 × 10 / 10.
    const cross = dashboard.widgets.at(-1)!;
    const cds = (await ts.get<Dataset>('dataset', cross.spec.datasetId))!;
    expect(cds.rows.find((r) => r.query === 'mutuo prima casa')).toMatchObject({ pagina: 'mutui', sessions: 10, key_events: 10, conversioni_stimate: 30 });
    expect(cds.join).toMatchObject({ pairs: [{ a: 'pagina', b: 'landing_page' }], mode: 'lookup' });
    const crossPeriod = await datasetForPeriod(gateway, cds, '2026-09-01', '2026-09-30', async (id) => ts.get<Dataset>('dataset', id));
    expect(crossPeriod.rows.length).toBe(2);
    expect(dashboard.filters).toMatchObject({ dateFrom: '2026-10-13', dateTo: '2026-11-11' });
    // Il guard ha imposto l'account del cliente.
    expect(call.mock.calls.find((c) => c[1] === 'get_custom_report')![2]).toMatchObject({ property_id: '338073799' });

    // Layout: nessuna sovrapposizione, KPI a riga intera, due grafici affiancati.
    const l = dashboard.widgets.map((w) => w.layout!);
    expect(l[0]).toMatchObject({ x: 0, w: 12 });
    expect(l[1].y).toBe(l[2].y);
    expect(l[1].x + l[1].w).toBe(l[2].x);
    expect(l.every((a, i) => l.every((b, j) => i === j || a.y + a.h <= b.y || b.y + b.h <= a.y || a.x + a.w <= b.x || b.x + b.w <= a.x))).toBe(true);

    // KPI di Search Console: dati corretti ed etichette in italiano.
    const kpi = dashboard.widgets.find((w) => w.spec.title === 'Search Console, numeri chiave')!;
    const ds = (await ts.get<Dataset>('dataset', kpi.spec.datasetId))!;
    expect(ds.rows[0]).toMatchObject({ clic_totali: 2180, posizione_media: 7.1 });
    expect(ds.columns.find((c) => c.key === 'clic_totali')?.label).toBe('Clic');
    expect(kpi.spec.metrics).toEqual(['clic_totali', 'impressioni_totali', 'ctr_medio', 'posizione_media']);

    // Query: elenco numerato riconosciuto, e il dataset si rilegge per un altro periodo.
    const q = dashboard.widgets.find((w) => w.spec.title === 'Search Console, query principali')!;
    const qds = (await ts.get<Dataset>('dataset', q.spec.datasetId))!;
    expect(qds.rows.map((r) => r.query)).toEqual(['mutuo', 'surroga']);
    const period = await datasetForPeriod(gateway, qds, '2026-09-01', '2026-09-30');
    expect(call.mock.calls.at(-1)![2]).toMatchObject({ siteUrl: 'https://www.clientea.it/', startDate: '2026-09-01', endDate: '2026-09-30' });
    expect(period.rows).toHaveLength(2);
  });

  it('riporta le piattaforme che non rispondono senza bloccare le altre', async () => {
    const scope = parseScope(JSON.stringify({ client_id: 'cliente_a', sources: { ga4: [{ property_id: '338073799' }], search_console: [{ site: 'https://www.clientea.it/' }] } }));
    const store = new MemoryBlobStore();
    const session = { v: 1, uid: 'u', uname: 'Mario', role: 'specialist', cid: 'cliente-a', cname: 'A', scope, keys: {}, models: {}, exp: 0 } as AppSession;
    const ts = new TenantStore(store, session);
    const gateway = new McpGateway(ts, store, scope, {
      call: async (s, _name, args) => {
        if (s.url.includes('gsc')) throw new Error('down');
        return ga4(args);
      },
      server: (p) => (p === 'ga4' ? { url: 'https://ga4.invalid' } : p === 'search_console' ? { url: 'https://gsc.invalid' } : null),
      tools: async (p) => (p === 'ga4' ? GA4_TOOLS : p === 'search_console' ? GSC_TOOLS : []),
    });
    const { dashboard, report } = await createDefaultDashboard({ ts, session, scope, gateway, from: '2026-10-13', to: '2026-11-11', hasServer: () => true });
    expect(dashboard.widgets).toHaveLength(4);
    expect(report.filter((r) => !r.ok).map((r) => r.platform)).toEqual(['search_console', 'search_console', 'search_console', 'search_console', 'search_console']);
  });
});
