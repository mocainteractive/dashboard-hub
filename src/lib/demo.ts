import { newLocalId } from './format';
import type { Api } from './api';
import type { MocaSession } from './moca-sdk';
import type {
  CacheStats,
  ChatMessage,
  Conversation,
  ConversationMeta,
  Dashboard,
  DashboardMeta,
  Dataset,
  Row,
  RunEvent,
  VizSpec,
} from '../shared/types';

/**
 * Demo locale (solo localhost senza `netlify dev`): dati di esempio generati
 * nel browser per vedere e provare l'interfaccia. Nessuna chiamata MCP o AI.
 */

export function demoSession(): MocaSession {
  return {
    client: { id: 'demo-client', name: 'Cliente Demo', logo_url: 'https://placehold.co/100/E52217/FFFFFF?text=DEMO' },
    user: { id: 'demo-user', name: 'Sviluppatore', role: 'super_admin' },
    application: { id: 'demo-app', name: 'Dashboard Hub' },
    timestamp: Date.now(),
    demo: true,
    info: {
      scope: {
        slug: 'cliente_demo',
        displayName: 'Cliente Demo',
        gcpProject: 'moca-cliente-demo',
        timezone: 'Europe/Rome',
        currency: 'EUR',
        accounts: [
          { platform: 'ga4', id: '338073799', validFrom: '2020-01-01', validTo: null },
          { platform: 'search_console', id: 'sc-domain:clientedemo.it', validFrom: '2026-01-01', validTo: null },
          { platform: 'google_ads', id: '6669481939', validFrom: '2020-01-01', validTo: null },
          { platform: 'meta_ads', id: 'act_36311415', validFrom: '2020-01-01', validTo: null },
          { platform: 'tiktok_ads', id: '7012345678901234567', validFrom: '2024-01-01', validTo: null },
        ],
      },
      providers: ['anthropic', 'openai', 'gemini'],
      mcpPlatforms: ['ga4', 'search_console', 'google_ads', 'meta_ads'],
    },
  };
}

// Generatore pseudo-casuale con seme: demo stabile tra un caricamento e l'altro.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const DAY = 86400000;
const days = (n: number) => {
  const end = Date.UTC(2026, 9, 20);
  return Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * DAY).toISOString().slice(0, 10));
};

function buildDatasets(): Dataset[] {
  const r = rng(42);
  const now = '2026-10-21T08:00:00.000Z';
  const base = { createdAt: now, updatedAt: now, createdBy: 'Assistente', sourceCalls: [] };
  const dates = days(90);

  const channels: [string, number, number][] = [
    ['Organic Search', 820, 0.024],
    ['Paid Search', 430, 0.038],
    ['Paid Social', 380, 0.017],
    ['Direct', 260, 0.031],
    ['Email', 120, 0.052],
    ['Referral', 70, 0.02],
  ];
  const ga4Rows: Row[] = [];
  dates.forEach((d, i) => {
    const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
    const season = 1 + 0.25 * Math.sin(i / 9) + (weekday === 0 || weekday === 6 ? -0.18 : 0.05);
    for (const [ch, base0, cr] of channels) {
      const sessions = Math.round(base0 * season * (0.85 + r() * 0.3) * (1 + i / 400));
      const conv = Math.round(sessions * cr * (0.8 + r() * 0.4));
      ga4Rows.push({ date: d, channel: ch, sessions, conversions: conv, revenue: Math.round(conv * (62 + r() * 25)), cr: Math.round((conv / sessions) * 10000) / 100 });
    }
  });

  const campaigns: [string, number][] = [
    ['Prospecting Autunno', 210],
    ['Retargeting Catalogo', 120],
    ['Lookalike Acquirenti', 95],
    ['Brand Awareness Video', 70],
  ];
  const metaRows: Row[] = [];
  dates.forEach((d, i) => {
    for (const [c, spend0] of campaigns) {
      const spend = Math.round(spend0 * (0.8 + r() * 0.4) * (1 + 0.15 * Math.sin(i / 11)) * 100) / 100;
      const impressions = Math.round(spend * (95 + r() * 40));
      const clicks = Math.round(impressions * (0.009 + r() * 0.008));
      const purchases = Math.round(clicks * (c.startsWith('Retarget') ? 0.07 : 0.025) * (0.7 + r() * 0.6));
      const value = Math.round(purchases * (70 + r() * 20));
      metaRows.push({ date: d, campaign: c, spend, impressions, clicks, purchases, ctr: Math.round((clicks / impressions) * 10000) / 100, roas: spend ? Math.round((value / spend) * 100) / 100 : 0 });
    }
  });

  const queries = ['scarpe running donna', 'scarpe trail', 'clientedemo', 'scarpe da corsa offerte', 'running uomo ammortizzate', 'calze tecniche running', 'scarpe running pronatore', 'guida taglie scarpe', 'scarpe running leggere', 'outlet running'];
  const gscRows: Row[] = queries.map((q, i) => {
    const impressions = Math.round((18000 / (i + 1)) * (0.8 + r() * 0.4));
    const clicks = Math.round(impressions * (q === 'clientedemo' ? 0.42 : 0.02 + r() * 0.05));
    return { query: q, clicks, impressions, ctr: Math.round((clicks / impressions) * 10000) / 100, position: Math.round((q === 'clientedemo' ? 1.1 : 3 + r() * 12) * 10) / 10 };
  });

  const ds = (d: Omit<Dataset, keyof typeof base | 'rowCount'>): Dataset => ({ ...base, ...d, rowCount: d.rows.length });
  return [
    ds({
      id: 'demo_ga4_canali',
      title: 'GA4, sessioni e conversioni per canale',
      description: 'Google Analytics 4, proprietà 338073799, ultimi 90 giorni, per giorno e canale.',
      platforms: ['ga4'],
      accounts: ['ga4:338073799'],
      dateFrom: dates[0],
      dateTo: dates[dates.length - 1],
      columns: [
        { key: 'date', label: 'Data', type: 'date' },
        { key: 'channel', label: 'Canale', type: 'dimension' },
        { key: 'sessions', label: 'Sessioni', type: 'metric', format: 'number' },
        { key: 'conversions', label: 'Conversioni', type: 'metric', format: 'number' },
        { key: 'revenue', label: 'Ricavi', type: 'metric', format: 'currency' },
        { key: 'cr', label: 'Tasso di conversione', type: 'metric', format: 'percent', agg: 'avg' },
      ],
      rows: ga4Rows,
    }),
    ds({
      id: 'demo_meta_campagne',
      title: 'Meta Ads, performance campagne',
      description: 'Meta Ads, account act_36311415, ultimi 90 giorni, per giorno e campagna.',
      platforms: ['meta_ads'],
      accounts: ['meta_ads:36311415'],
      dateFrom: dates[0],
      dateTo: dates[dates.length - 1],
      columns: [
        { key: 'date', label: 'Data', type: 'date' },
        { key: 'campaign', label: 'Campagna', type: 'dimension' },
        { key: 'spend', label: 'Spesa', type: 'metric', format: 'currency' },
        { key: 'impressions', label: 'Impression', type: 'metric', format: 'number' },
        { key: 'clicks', label: 'Clic', type: 'metric', format: 'number' },
        { key: 'purchases', label: 'Acquisti', type: 'metric', format: 'number' },
        { key: 'ctr', label: 'CTR', type: 'metric', format: 'percent', agg: 'avg' },
        { key: 'roas', label: 'ROAS', type: 'metric', format: 'decimal', agg: 'avg' },
      ],
      rows: metaRows,
    }),
    ds({
      id: 'demo_gsc_query',
      title: 'Search Console, query principali',
      description: 'Search Console, sc-domain:clientedemo.it, ultimi 28 giorni, prime 10 query.',
      platforms: ['search_console'],
      accounts: ['search_console:sc-domain:clientedemo.it'],
      dateFrom: '2026-09-23',
      dateTo: '2026-10-20',
      columns: [
        { key: 'query', label: 'Query', type: 'dimension' },
        { key: 'clicks', label: 'Clic', type: 'metric', format: 'number' },
        { key: 'impressions', label: 'Impression', type: 'metric', format: 'number' },
        { key: 'ctr', label: 'CTR', type: 'metric', format: 'percent', agg: 'avg' },
        { key: 'position', label: 'Posizione media', type: 'metric', format: 'decimal', agg: 'avg' },
      ],
      rows: gscRows,
    }),
  ];
}

function demoDashboard(): Dashboard {
  const now = '2026-10-21T08:00:00.000Z';
  const w = (spec: Omit<VizSpec, 'id'>, width: 1 | 2 | 3) => ({ id: newLocalId(), spec: { ...spec, id: newLocalId() }, w: width });
  return {
    id: 'demo_panoramica',
    title: 'Panoramica performance',
    description: 'Traffico, conversioni e investimento media del cliente.',
    createdAt: now,
    updatedAt: now,
    updatedBy: 'Sviluppatore',
    filters: { dateFrom: '2026-07-27', dateTo: '2026-10-18', dims: [] },
    widgets: [
      w({ title: 'Sessioni', type: 'kpi', datasetId: 'demo_ga4_canali', x: 'date', metrics: ['sessions'] }, 1),
      w({ title: 'Ricavi', type: 'kpi', datasetId: 'demo_ga4_canali', x: 'date', metrics: ['revenue'] }, 1),
      w({ title: 'Spesa Meta', type: 'kpi', datasetId: 'demo_meta_campagne', x: 'date', metrics: ['spend'] }, 1),
      w({ title: 'Sessioni per canale', type: 'area', datasetId: 'demo_ga4_canali', x: 'date', metrics: ['sessions'], seriesBy: 'channel', dateGrain: 'week', note: 'Organic Search resta il primo canale, Paid Search in crescita nelle ultime settimane.' }, 2),
      w({ title: 'Conversioni per canale', type: 'hbar', datasetId: 'demo_ga4_canali', x: 'channel', metrics: ['conversions'] }, 1),
      w({ title: 'Sessioni e spesa Meta', type: 'line', datasetId: 'demo_ga4_canali', join: { datasetId: 'demo_meta_campagne', on: ['date'] }, x: 'date', metrics: ['sessions', 'spend'], dateGrain: 'week', note: 'Incrocio GA4 e Meta sulla data: unità diverse, un grafico per metrica sulla stessa scala temporale.' }, 2),
      w({ title: 'ROAS per campagna', type: 'bar', datasetId: 'demo_meta_campagne', x: 'campaign', metrics: ['roas'] }, 1),
      w({ title: 'Query principali', type: 'table', datasetId: 'demo_gsc_query', x: 'query', metrics: ['clicks', 'impressions', 'ctr', 'position'] }, 3),
    ],
  };
}

const LS_KEY = 'dashboard-hub-demo-v1';

interface DemoState {
  dashboards: Dashboard[];
  conversations: Conversation[];
}

function load(): DemoState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Archivio del browser non disponibile: si riparte dai dati di esempio.
  }
  return { dashboards: [demoDashboard()], conversations: [] };
}

function save(s: DemoState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    // Ignorato: la demo funziona anche senza persistenza.
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createDemoApi(): Api {
  const datasets = buildDatasets();
  const state = load();
  const stats: CacheStats = { hits: 12, misses: 5, blocked: 1, lastHitAt: new Date().toISOString() };
  const runs = new Map<string, { started: number; conversationId: string; question: string; events: RunEvent[]; message?: ChatMessage }>();

  const metaOf = (d: Dashboard): DashboardMeta => ({ id: d.id, title: d.title, widgetCount: d.widgets.length, updatedAt: d.updatedAt, updatedBy: d.updatedBy });
  const convMeta = (c: Conversation): ConversationMeta => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, createdBy: c.createdBy, messageCount: c.messages.length });

  function answer(question: string): { text: string; viz: VizSpec; events: string[] } {
    const q = question.toLowerCase();
    if (/meta|facebook|instagram|campagn|roas|spesa/.test(q)) {
      return {
        text: 'Negli ultimi 90 giorni la spesa Meta si concentra su Prospecting Autunno, mentre Retargeting Catalogo ha il ROAS migliore. Valuta di spostare parte del budget dal prospecting al retargeting e di rinnovare le creatività di Brand Awareness Video.',
        viz: { id: newLocalId(), title: 'Spesa per campagna Meta', type: 'bar', datasetId: 'demo_meta_campagne', x: 'campaign', metrics: ['spend'], note: 'Spesa totale degli ultimi 90 giorni.' },
        events: ['Uso i dati già salvati: Meta Ads, performance campagne', 'Grafico creato: Spesa per campagna Meta'],
      };
    }
    if (/seo|search console|query|organic|posizion/.test(q)) {
      return {
        text: 'La query di brand porta la quota maggiore di clic con CTR alto. Tra le non brand, "scarpe running donna" ha molte impression ma CTR basso: migliorare title e meta description può portare clic in più senza nuovi contenuti.',
        viz: { id: newLocalId(), title: 'Clic per query', type: 'hbar', datasetId: 'demo_gsc_query', x: 'query', metrics: ['clicks'], limit: 8 },
        events: ['Uso i dati già salvati: Search Console, query principali', 'Grafico creato: Clic per query'],
      };
    }
    return {
      text: 'Il traffico è in crescita costante, trainato da Organic Search e Paid Search. Email ha il tasso di conversione più alto pur con pochi volumi: conviene spingere la raccolta contatti.',
      viz: { id: newLocalId(), title: 'Tasso di conversione per canale', type: 'bar', datasetId: 'demo_ga4_canali', x: 'channel', metrics: ['cr'] },
      events: ['Uso i dati già salvati: GA4, sessioni e conversioni per canale', 'Grafico creato: Tasso di conversione per canale'],
    };
  }

  return {
    info: async () => ({ info: demoSession().info, stats, canManageCache: true }),
    listDatasets: async () => datasets.map(({ rows: _r, sourceCalls: _s, ...m }) => m),
    getDataset: async (id) => {
      await wait(120);
      const d = datasets.find((x) => x.id === id);
      if (!d) throw new Error('Dataset non trovato');
      return d;
    },
    deleteDataset: async (id) => {
      const i = datasets.findIndex((x) => x.id === id);
      if (i >= 0) datasets.splice(i, 1);
    },
    listDashboards: async () => state.dashboards.map(metaOf),
    getDashboard: async (id) => {
      const d = state.dashboards.find((x) => x.id === id);
      if (!d) throw new Error('Dashboard non trovata');
      return structuredClone(d);
    },
    saveDashboard: async (d) => {
      const now = new Date().toISOString();
      const full: Dashboard = {
        id: d.id ?? newLocalId(),
        title: d.title ?? 'Nuova dashboard',
        description: d.description,
        widgets: d.widgets ?? [],
        filters: d.filters ?? { dims: [] },
        createdAt: d.createdAt ?? now,
        updatedAt: now,
        updatedBy: 'Sviluppatore',
      };
      state.dashboards = [full, ...state.dashboards.filter((x) => x.id !== full.id)];
      save(state);
      return structuredClone(full);
    },
    deleteDashboard: async (id) => {
      state.dashboards = state.dashboards.filter((x) => x.id !== id);
      save(state);
    },
    listConversations: async () => state.conversations.map(convMeta),
    getConversation: async (id) => {
      const c = state.conversations.find((x) => x.id === id);
      if (!c) throw new Error('Conversazione non trovata');
      return structuredClone(c);
    },
    deleteConversation: async (id) => {
      state.conversations = state.conversations.filter((x) => x.id !== id);
      save(state);
    },
    chatStart: async ({ conversationId, message }) => {
      const now = new Date().toISOString();
      let conv = state.conversations.find((c) => c.id === conversationId);
      if (!conv) {
        conv = { id: newLocalId(), title: message.slice(0, 70), createdAt: now, updatedAt: now, createdBy: 'Sviluppatore', messageCount: 0, messages: [] };
        state.conversations.unshift(conv);
      }
      conv.messages.push({ id: newLocalId(), role: 'user', text: message, at: now, author: 'Sviluppatore' });
      conv.updatedAt = now;
      save(state);
      const runId = newLocalId();
      runs.set(runId, { started: Date.now(), conversationId: conv.id, question: message, events: [] });
      return { runId, conversationId: conv.id };
    },
    runStatus: async (runId, after) => {
      const run = runs.get(runId);
      if (!run) throw new Error('Elaborazione non trovata');
      const a = answer(run.question);
      const plan = ['Analizzo la richiesta', ...a.events];
      const elapsed = Date.now() - run.started;
      const n = Math.min(plan.length, Math.floor(elapsed / 900) + 1);
      while (run.events.length < n) {
        const text = plan[run.events.length];
        run.events.push({ at: new Date().toISOString(), kind: run.events.length === 0 ? 'thinking' : text.startsWith('Uso') ? 'query' : 'viz', text });
      }
      const done = elapsed > plan.length * 900 + 400;
      if (done && !run.message) {
        run.message = { id: newLocalId(), role: 'assistant', text: a.text, at: new Date().toISOString(), provider: 'anthropic', vizs: [a.viz], datasetIds: [a.viz.datasetId], events: run.events };
        const conv = state.conversations.find((c) => c.id === run.conversationId);
        if (conv) {
          conv.messages.push(run.message);
          conv.updatedAt = run.message.at;
          save(state);
        }
        stats.hits++;
      }
      return { status: done ? 'done' : 'running', events: run.events.slice(after), total: run.events.length, message: run.message ?? null };
    },
    clearCache: async () => {
      stats.hits = 0;
      stats.misses = 0;
      return 17;
    },
  };
}
