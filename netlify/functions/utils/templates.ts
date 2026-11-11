import { joinTables, runQuery } from '../../../src/shared/engine';
import { accountsFor, scopedPlatforms } from '../../../src/shared/scope';
import {
  PLATFORM_LABELS,
  type ClientScope,
  type Column,
  type Dashboard,
  type QuerySpec,
  type DashboardMeta,
  type DashboardWidget,
  type Dataset,
  type McpPlatform,
  type VizSpec,
  type VizType,
  type WidgetLayout,
} from '../../../src/shared/types';
import type { McpGateway } from './mcp-gateway';
import type { AppSession } from './session';
import { extractTables, type ParsedTable } from './tabular';
import { newId, upsertIndex, type TenantStore } from './tenant-store';

/**
 * Dashboard predefinita: per ogni piattaforma del cliente, chiamate MCP
 * fisse (senza AI), salvate come ricette. I grafici seguono il periodo
 * della dashboard come tutti gli altri: la ricetta si ripete con le nuove
 * date, passando da guard e cache.
 */

interface WidgetTemplate {
  title: string;
  type: VizType;
  x?: string;
  /** Metriche candidate: si usano quelle presenti nella risposta. */
  metrics: string[];
  layout: { w: number; h: number };
}

interface DatasetTemplate {
  title: string;
  description: string;
  tool: string;
  args: (from: string, to: string) => Record<string, unknown>;
  /** Etichette in italiano per le colonne note. */
  labels?: Record<string, string>;
  widgets: WidgetTemplate[];
}

const GA4_LABELS = {
  sessions: 'Sessioni',
  total_users: 'Utenti',
  key_events: 'Eventi chiave',
  engagement_rate: 'Tasso di coinvolgimento',
  session_default_channel_group: 'Canale',
  landing_page: 'Landing page',
  date: 'Data',
};
const GSC_LABELS = {
  clic_totali: 'Clic',
  impressioni_totali: 'Impressioni',
  ctr_medio: 'CTR',
  posizione_media: 'Posizione media',
  clic: 'Clic',
  impr: 'Impressioni',
  impressioni: 'Impressioni',
  ctr: 'CTR',
  pos: 'Posizione',
  posizione: 'Posizione',
  query: 'Query',
  pagina: 'Pagina',
  date: 'Data',
};
const META_LABELS = {
  spend: 'Spesa',
  impressions: 'Impression',
  reach: 'Copertura',
  clicks: 'Clic',
  ctr: 'CTR',
  cpc: 'CPC',
  cpm: 'CPM',
  campaign_name: 'Campagna',
  date_start: 'Data',
  actions_lead: 'Lead',
  actions_purchase: 'Acquisti',
  cost_per_action_type_lead: 'Costo per lead',
  cost_per_action_type_purchase: 'Costo per acquisto',
};
const GADS_LABELS = {
  cost_micros: 'Costo',
  clicks: 'Clic',
  impressions: 'Impression',
  conversions: 'Conversioni',
  conversions_value: 'Valore conversioni',
  name: 'Campagna',
  date: 'Data',
};
const PIN_LABELS = {
  spend_in_dollar: 'Spesa',
  impression_1: 'Impression',
  clickthrough_1: 'Clic',
  ctr: 'CTR',
  ecpc_in_dollar: 'CPC',
  total_conversions: 'Conversioni',
  date: 'Data',
};

const gaql = (select: string, from: string, where = '') => (a: string, b: string) => ({
  query: `SELECT ${select} FROM ${from} WHERE segments.date BETWEEN '${a}' AND '${b}'${where}`,
});

export const TEMPLATES: Record<McpPlatform, DatasetTemplate[]> = {
  ga4: [
    {
      title: 'GA4, panoramica',
      description: 'Google Analytics 4: sessioni, utenti, eventi chiave e coinvolgimento del periodo.',
      tool: 'get_custom_report',
      args: (start_date, end_date) => ({ metrics: ['sessions', 'totalUsers', 'keyEvents', 'engagementRate'], dimensions: [], start_date, end_date }),
      labels: GA4_LABELS,
      widgets: [{ title: 'GA4, numeri chiave', type: 'kpi', metrics: ['sessions', 'total_users', 'key_events', 'engagement_rate'], layout: { w: 12, h: 4 } }],
    },
    {
      title: 'GA4, andamento giornaliero',
      description: 'Google Analytics 4: sessioni, utenti ed eventi chiave giorno per giorno.',
      tool: 'get_custom_report',
      args: (start_date, end_date) => ({ metrics: ['sessions', 'totalUsers', 'keyEvents'], dimensions: ['date'], start_date, end_date }),
      labels: GA4_LABELS,
      widgets: [{ title: 'GA4, sessioni e utenti nel tempo', type: 'line', x: 'date', metrics: ['sessions', 'total_users'], layout: { w: 8, h: 9 } }],
    },
    {
      title: 'GA4, canali',
      description: 'Google Analytics 4: sessioni ed eventi chiave per canale.',
      tool: 'get_custom_report',
      args: (start_date, end_date) => ({ metrics: ['sessions', 'keyEvents'], dimensions: ['sessionDefaultChannelGroup'], start_date, end_date }),
      labels: GA4_LABELS,
      widgets: [{ title: 'GA4, sessioni per canale', type: 'hbar', x: 'session_default_channel_group', metrics: ['sessions'], layout: { w: 4, h: 9 } }],
    },
    {
      title: 'GA4, landing page',
      description: 'Google Analytics 4: prime 25 landing page per sessioni.',
      tool: 'get_custom_report',
      args: (start_date, end_date) => ({ metrics: ['sessions', 'keyEvents', 'engagementRate'], dimensions: ['landingPage'], start_date, end_date, limit: 25 }),
      labels: GA4_LABELS,
      widgets: [{ title: 'GA4, landing page principali', type: 'table', x: 'landing_page', metrics: ['sessions', 'key_events', 'engagement_rate'], layout: { w: 12, h: 10 } }],
    },
  ],
  search_console: [
    {
      title: 'Search Console, totali',
      description: 'Search Console: clic, impressioni, CTR e posizione media reali del sito.',
      tool: 'get_property_stats',
      args: (startDate, endDate) => ({ startDate, endDate }),
      labels: GSC_LABELS,
      widgets: [{ title: 'Search Console, numeri chiave', type: 'kpi', metrics: ['clic_totali', 'impressioni_totali', 'ctr_medio', 'posizione_media'], layout: { w: 12, h: 4 } }],
    },
    {
      title: 'Search Console, andamento giornaliero',
      description: 'Search Console: clic e impressioni giorno per giorno.',
      tool: 'get_performance_timeseries',
      args: (startDate, endDate) => ({ startDate, endDate }),
      labels: GSC_LABELS,
      widgets: [
        { title: 'Search Console, clic nel tempo', type: 'line', x: 'date', metrics: ['clic'], layout: { w: 6, h: 9 } },
        { title: 'Search Console, impressioni nel tempo', type: 'area', x: 'date', metrics: ['impr'], layout: { w: 6, h: 9 } },
      ],
    },
    {
      title: 'Search Console, query',
      description: 'Search Console: prime 25 query per clic.',
      tool: 'get_search_queries',
      args: (startDate, endDate) => ({ startDate, endDate, limit: 25 }),
      labels: GSC_LABELS,
      widgets: [{ title: 'Search Console, query principali', type: 'table', x: 'query', metrics: ['clic', 'impressioni', 'ctr', 'posizione'], layout: { w: 6, h: 10 } }],
    },
    {
      title: 'Search Console, pagine',
      description: 'Search Console: prime 25 pagine per clic.',
      tool: 'get_top_pages',
      args: (startDate, endDate) => ({ startDate, endDate, limit: 25 }),
      labels: GSC_LABELS,
      widgets: [{ title: 'Search Console, pagine principali', type: 'table', x: 'pagina', metrics: ['clic', 'impressioni', 'ctr', 'posizione'], layout: { w: 6, h: 10 } }],
    },
  ],
  meta_ads: [
    {
      title: 'Meta, panoramica',
      description: 'Meta Ads: spesa, impression, clic, CTR e CPC del periodo.',
      tool: 'get_insights',
      args: (since, until) => ({ level: 'account', time_range: { since, until }, time_increment: 'all_days', fields: ['spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'cpm'], format: 'json' }),
      labels: META_LABELS,
      widgets: [{ title: 'Meta, numeri chiave', type: 'kpi', metrics: ['spend', 'impressions', 'clicks', 'ctr', 'cpc'], layout: { w: 12, h: 4 } }],
    },
    {
      title: 'Meta, andamento giornaliero',
      description: 'Meta Ads: spesa e clic giorno per giorno.',
      tool: 'get_insights',
      args: (since, until) => ({ level: 'account', time_range: { since, until }, time_increment: 'daily', fields: ['spend', 'impressions', 'clicks'], format: 'json', limit: 400 }),
      labels: META_LABELS,
      widgets: [
        { title: 'Meta, spesa nel tempo', type: 'area', x: 'date_start', metrics: ['spend'], layout: { w: 6, h: 9 } },
        { title: 'Meta, clic nel tempo', type: 'line', x: 'date_start', metrics: ['clicks'], layout: { w: 6, h: 9 } },
      ],
    },
    {
      title: 'Meta, campagne',
      description: 'Meta Ads: campagne per spesa, con lead e acquisti.',
      tool: 'get_insights',
      args: (since, until) => ({
        level: 'campaign',
        time_range: { since, until },
        fields: ['campaign_name', 'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'actions', 'cost_per_action_type'],
        action_types: ['lead', 'purchase'],
        sort: ['spend_descending'],
        format: 'json',
        limit: 25,
      }),
      labels: META_LABELS,
      widgets: [
        {
          title: 'Meta, campagne',
          type: 'table',
          x: 'campaign_name',
          metrics: ['spend', 'impressions', 'clicks', 'ctr', 'actions_lead', 'cost_per_action_type_lead', 'actions_purchase'],
          layout: { w: 12, h: 10 },
        },
      ],
    },
  ],
  google_ads: [
    {
      title: 'Google Ads, panoramica',
      description: 'Google Ads: costo, clic, impression, conversioni e valore del periodo.',
      tool: 'run_gaql',
      args: gaql('metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value', 'customer'),
      labels: GADS_LABELS,
      widgets: [{ title: 'Google Ads, numeri chiave', type: 'kpi', metrics: ['cost_micros', 'clicks', 'conversions', 'conversions_value'], layout: { w: 12, h: 4 } }],
    },
    {
      title: 'Google Ads, andamento giornaliero',
      description: 'Google Ads: costo, clic e conversioni giorno per giorno.',
      tool: 'run_gaql',
      args: (a, b) => gaql('segments.date, metrics.cost_micros, metrics.clicks, metrics.conversions', 'customer', ' ORDER BY segments.date')(a, b),
      labels: GADS_LABELS,
      widgets: [
        { title: 'Google Ads, costo nel tempo', type: 'area', x: 'date', metrics: ['cost_micros'], layout: { w: 6, h: 9 } },
        { title: 'Google Ads, conversioni nel tempo', type: 'line', x: 'date', metrics: ['conversions'], layout: { w: 6, h: 9 } },
      ],
    },
    {
      title: 'Google Ads, campagne',
      description: 'Google Ads: prime 25 campagne per costo.',
      tool: 'run_gaql',
      args: gaql('campaign.name, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value', 'campaign', ' AND metrics.impressions > 0 ORDER BY metrics.cost_micros DESC LIMIT 25'),
      labels: GADS_LABELS,
      widgets: [{ title: 'Google Ads, campagne', type: 'table', x: 'name', metrics: ['cost_micros', 'clicks', 'impressions', 'conversions', 'conversions_value'], layout: { w: 12, h: 10 } }],
    },
  ],
  pinterest_ads: [
    {
      title: 'Pinterest, panoramica',
      description: 'Pinterest Ads: spesa, impression, clic e conversioni del periodo.',
      tool: 'get_ad_account_analytics',
      args: (start_date, end_date) => ({ start_date, end_date, granularity: 'TOTAL' }),
      labels: PIN_LABELS,
      widgets: [{ title: 'Pinterest, numeri chiave', type: 'kpi', metrics: ['spend_in_dollar', 'impression_1', 'clickthrough_1', 'ctr', 'total_conversions'], layout: { w: 12, h: 4 } }],
    },
    {
      title: 'Pinterest, andamento giornaliero',
      description: 'Pinterest Ads: spesa e clic giorno per giorno.',
      tool: 'get_ad_account_analytics',
      args: (start_date, end_date) => ({ start_date, end_date, granularity: 'DAY' }),
      labels: PIN_LABELS,
      widgets: [{ title: 'Pinterest, spesa nel tempo', type: 'area', x: 'date', metrics: ['spend_in_dollar'], layout: { w: 12, h: 9 } }],
    },
  ],
};

export interface TemplateReport {
  platform: McpPlatform;
  title: string;
  ok: boolean;
  reason?: string;
  widgets: number;
}

/** Sceglie la tabella con più metriche richieste dai widget. */
function pickTable(tables: ParsedTable[], t: DatasetTemplate): ParsedTable | null {
  const wanted = new Set(t.widgets.flatMap((w) => [...w.metrics, ...(w.x ? [w.x] : [])]));
  let best: ParsedTable | null = null;
  let score = 0;
  for (const tb of tables) {
    const s = tb.columns.filter((c) => wanted.has(c.key)).length;
    if (s > score) {
      best = tb;
      score = s;
    }
  }
  return best;
}

/** Posiziona i widget riga per riga nella griglia a 12 colonne. */
class Placer {
  private x = 0;
  private y = 0;
  private rowH = 0;
  place(w: number, h: number): WidgetLayout {
    if (this.x + w > 12) this.newRow();
    const l = { x: this.x, y: this.y, w, h };
    this.x += w;
    this.rowH = Math.max(this.rowH, h);
    return l;
  }
  newRow() {
    if (this.x === 0) return;
    this.x = 0;
    this.y += this.rowH;
    this.rowH = 0;
  }
}

export async function createDefaultDashboard(o: {
  ts: TenantStore;
  session: AppSession;
  scope: ClientScope;
  gateway: McpGateway;
  from: string;
  to: string;
  hasServer: (p: McpPlatform) => boolean;
}): Promise<{ dashboard: Dashboard; report: TemplateReport[] }> {
  const { ts, session, scope, gateway, from, to } = o;
  const report: TemplateReport[] = [];
  const now = new Date().toISOString();
  const platforms = scopedPlatforms(scope).filter(o.hasServer);

  // Tutte le chiamate in parallelo; un solo account per piattaforma (il primo del perimetro).
  type Built = { platform: McpPlatform; t: DatasetTemplate; ds: Dataset | null; reason?: string };
  const jobs: Promise<Built>[] = [];
  for (const platform of platforms) {
    const account = accountsFor(scope, platform)[0];
    const policy = (await gateway.policies(platform).catch(() => [])).find((p) => p.scopeParam);
    for (const t of TEMPLATES[platform]) {
      jobs.push(
        (async (): Promise<Built> => {
          const args = t.args(from, to);
          if (policy?.scopeParam && account) args[policy.scopeParam] = account.id;
          const res = await gateway.execute(platform, t.tool, args);
          if (!res.ok) return { platform, t, ds: null, reason: res.reason };
          const table = pickTable(extractTables(res.text), t);
          if (!table || !table.rows.length) return { platform, t, ds: null, reason: 'nessun dato nel periodo' };
          const columns: Column[] = table.columns.map((c) => ({ ...c, label: t.labels?.[c.key] ?? c.label }));
          const ds: Dataset = {
            id: newId(),
            title: t.title,
            description: t.description,
            platforms: [platform],
            accounts: res.accounts,
            dateFrom: from,
            dateTo: to,
            columns,
            rows: table.rows,
            rowCount: table.rows.length,
            createdAt: now,
            createdBy: session.uname,
            updatedAt: now,
            sourceCalls: [{ platform, tool: t.tool, args: res.args, fetchedAt: res.fetchedAt, fromCache: res.fromCache }],
            sourceTable: table.label,
          };
          return { platform, t, ds };
        })().catch((e: Error) => ({ platform, t, ds: null, reason: e.message })),
      );
    }
  }
  const built = await Promise.all(jobs);

  const widgets: DashboardWidget[] = [];
  const placer = new Placer();
  for (const platform of platforms) {
    placer.newRow();
    for (const b of built.filter((x) => x.platform === platform)) {
      if (!b.ds) {
        report.push({ platform, title: b.t.title, ok: false, reason: b.reason, widgets: 0 });
        continue;
      }
      const keys = new Set(b.ds.columns.map((c) => c.key));
      let count = 0;
      for (const w of b.t.widgets) {
        const metrics = w.metrics.filter((m) => keys.has(m));
        if (!metrics.length || (w.x && !keys.has(w.x))) continue;
        const spec: VizSpec = {
          id: newId(),
          title: w.title,
          type: w.type,
          datasetId: b.ds.id,
          ...(w.x ? { x: w.x } : {}),
          metrics: w.type === 'kpi' ? metrics.slice(0, 4) : metrics,
          filters: [],
          ...(w.type === 'line' || w.type === 'area' ? { dateGrain: 'day' as const } : {}),
          ...(w.type === 'hbar' ? { limit: 8 } : {}),
        };
        widgets.push({ id: newId(), spec, w: w.layout.w >= 12 ? 3 : w.layout.w >= 8 ? 2 : 1, layout: placer.place(w.layout.w, w.layout.h) });
        count++;
      }
      if (!count) {
        report.push({ platform, title: b.t.title, ok: false, reason: 'le metriche attese non sono nella risposta', widgets: 0 });
        continue;
      }
      await ts.set('dataset', b.ds.id, b.ds);
      const { rows: _r, sourceCalls: _s, ...meta } = b.ds;
      await upsertIndex(ts, 'dataset', meta);
      report.push({ platform, title: b.t.title, ok: true, widgets: count });
    }
  }

  // Incrocio Search Console × GA4: query e conversioni stimate dalla landing page organica.
  if (platforms.includes('ga4') && platforms.includes('search_console')) {
    const cross = await buildQueryConversions({ ts, session, scope, gateway, from, to, now }).catch((e: Error) => ({ error: e.message }));
    if ('error' in cross) report.push({ platform: 'search_console', title: 'Query × conversioni', ok: false, reason: cross.error, widgets: 0 });
    else {
      placer.newRow();
      widgets.push({ id: newId(), spec: cross.spec, w: 3, layout: placer.place(12, 11) });
      report.push({ platform: 'search_console', title: 'Query × conversioni', ok: true, widgets: 1 });
    }
  }

  const id = newId();
  const dashboard: Dashboard = {
    id,
    title: `Panoramica ${platforms.map((p) => PLATFORM_LABELS[p]).join(', ')}`.slice(0, 120),
    description: 'Dashboard predefinita: grafici principali di ogni piattaforma del cliente.',
    widgets,
    filters: { dateFrom: from, dateTo: to, dims: [] },
    createdAt: now,
    updatedAt: now,
    updatedBy: session.uname,
  };
  await ts.set('dashboard', id, dashboard);
  await upsertIndex<DashboardMeta>(ts, 'dashboard', { id, title: dashboard.title, widgetCount: widgets.length, updatedAt: now, updatedBy: session.uname });
  return { dashboard, report };
}

async function saveDs(ts: TenantStore, ds: Dataset) {
  await ts.set('dataset', ds.id, ds);
  const { rows: _r, sourceCalls: _s, ...meta } = ds;
  await upsertIndex(ts, 'dataset', meta);
}

/**
 * GA4 non conosce le query: la chiave comune con Search Console è la pagina.
 * Query × pagina (Search Console) + landing page organiche (GA4), incrociate
 * sulla pagina; conversioni stimate = clic della query × eventi chiave della
 * pagina / sessioni della pagina.
 */
async function buildQueryConversions(o: { ts: TenantStore; session: AppSession; scope: ClientScope; gateway: McpGateway; from: string; to: string; now: string }): Promise<{ spec: VizSpec }> {
  const { ts, session, scope, gateway, from, to, now } = o;
  const call = async (platform: McpPlatform, tool: string, args: Record<string, unknown>) => {
    const policy = (await gateway.policies(platform)).find((p) => p.name === tool);
    if (!policy) throw new Error(`strumento ${tool} non disponibile`);
    const account = accountsFor(scope, platform)[0];
    if (policy.scopeParam && account) args[policy.scopeParam] = account.id;
    const res = await gateway.execute(platform, tool, args);
    if (!res.ok) throw new Error(res.reason);
    return res;
  };
  const [gsc, ga4] = await Promise.all([
    call('search_console', 'get_query_page_combinations', { startDate: from, endDate: to, limit: 500 }),
    call('ga4', 'get_custom_report', {
      metrics: ['sessions', 'keyEvents'],
      dimensions: ['landingPage'],
      dimension_filter: { dimension: 'sessionDefaultChannelGroup', match_type: 'EXACT', value: 'Organic Search' },
      start_date: from,
      end_date: to,
      limit: 1000,
    }),
  ]);
  const gscTable = extractTables(gsc.text).find((t) => t.columns.some((c) => c.key === 'query') && t.columns.some((c) => c.key === 'pagina'));
  const ga4Table = extractTables(ga4.text).find((t) => t.columns.some((c) => c.key === 'landing_page'));
  if (!gscTable || !ga4Table) throw new Error('formato delle risposte non riconosciuto');

  const ga4Ds: Dataset = {
    id: newId(),
    title: 'GA4, landing page organiche',
    description: 'GA4: sessioni ed eventi chiave per landing page, solo canale Organic Search.',
    platforms: ['ga4'],
    accounts: ga4.accounts,
    dateFrom: from,
    dateTo: to,
    columns: ga4Table.columns.map((c) => ({ ...c, label: { landing_page: 'Landing page', sessions: 'Sessioni organiche', key_events: 'Eventi chiave organici' }[c.key] ?? c.label })),
    rows: ga4Table.rows,
    rowCount: ga4Table.rows.length,
    createdAt: now,
    createdBy: session.uname,
    updatedAt: now,
    sourceCalls: [{ platform: 'ga4', tool: 'get_custom_report', args: ga4.args, fetchedAt: ga4.fetchedAt, fromCache: ga4.fromCache }],
    sourceTable: ga4Table.label,
    sourceKeys: ga4Table.columns.map((c) => c.key),
  };
  await saveDs(ts, ga4Ds);

  const pairs = [{ a: 'pagina', b: 'landing_page' }];
  const transform: QuerySpec = {
    computed: [{ key: 'conversioni_stimate', label: 'Conversioni stimate', expr: 'clic * key_events / sessions', format: 'decimal' }],
    sort: { key: 'clic', dir: 'desc' },
    limit: 100,
  };
  const joined = runQuery(joinTables(gscTable, ga4Ds, pairs, { a: 'Search Console', b: 'GA4' }, 'lookup'), transform);
  const keep = ['query', 'pagina', 'clic', 'impressioni', 'sessions', 'key_events', 'conversioni_stimate'].filter((k) => joined.columns.some((c) => c.key === k));
  const labels: Record<string, string> = { query: 'Query', pagina: 'Pagina', clic: 'Clic', impressioni: 'Impressioni', sessions: 'Sessioni organiche pagina', key_events: 'Eventi chiave pagina', conversioni_stimate: 'Conversioni stimate' };
  const columns: Column[] = keep.map((k) => ({ ...joined.columns.find((c) => c.key === k)!, label: labels[k] ?? k }));
  const ds: Dataset = {
    id: newId(),
    title: 'Query × conversioni stimate (organico)',
    description:
      'Search Console query × pagina incrociate con le landing page organiche di GA4 sulla pagina. Conversioni stimate = clic della query × eventi chiave della pagina / sessioni organiche della pagina: ripartisce le conversioni della pagina tra le query in base ai clic.',
    platforms: ['search_console', 'ga4'],
    accounts: [...gsc.accounts, ...ga4.accounts],
    dateFrom: from,
    dateTo: to,
    columns,
    rows: joined.rows.map((r) => Object.fromEntries(keep.map((k) => [k, r[k] ?? null]))),
    rowCount: joined.rows.length,
    createdAt: now,
    createdBy: session.uname,
    updatedAt: now,
    sourceCalls: [{ platform: 'search_console', tool: 'get_query_page_combinations', args: gsc.args, fetchedAt: gsc.fetchedAt, fromCache: gsc.fromCache }],
    sourceTable: gscTable.label,
    sourceKeys: gscTable.columns.map((c) => c.key),
    join: { datasetId: ga4Ds.id, pairs, mode: 'lookup' },
    transform,
  };
  await saveDs(ts, ds);
  return {
    spec: {
      id: newId(),
      title: 'Query × conversioni stimate (organico)',
      type: 'table',
      datasetId: ds.id,
      x: 'query',
      metrics: ['clic', 'conversioni_stimate', 'sessions', 'key_events'].filter((k) => keep.includes(k)),
      filters: [],
      sort: { key: 'clic', dir: 'desc' },
      note: 'Stima: le conversioni organiche di ogni pagina sono ripartite tra le query in base ai clic.',
    },
  };
}
