/**
 * Test automatico del POC: richieste reali contro il server in esecuzione.
 *
 *   npm run poc            (in un terminale)
 *   npm run poc:test       (in un altro)
 *
 * Esegue: sessione, dashboard predefinita, rilettura di ogni grafico per un
 * altro periodo, domande in chat per ogni piattaforma del cliente, domanda
 * ripetuta (cache), e scrive un report con esiti, tempi, token e costi in
 * .poc-data/report-<data>.md. Usa Claude e i server MCP veri: ha un costo.
 *
 * Opzioni: POC_URL (predefinito http://localhost:5180), POC_TEST_ONLY=dashboard|chat
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ChatMessage, Dashboard, Dataset, McpPlatform, PeriodData, SessionInfo, StreamEvent } from '../src/shared/types';
import { PLATFORM_LABELS } from '../src/shared/types';

const BASE = (process.env.POC_URL || 'http://localhost:5180').replace(/\/$/, '');
const ONLY = process.env.POC_TEST_ONLY;
const ROOT = resolve(import.meta.dirname, '..');

let token = '';
const lines: string[] = [];
const out = (s = '') => {
  console.log(s);
  lines.push(s);
};
const results: { area: string; name: string; ok: boolean; detail: string }[] = [];
const check = (area: string, name: string, ok: boolean, detail = '') => {
  results.push({ area, name, ok, detail });
  out(`${ok ? '  OK ' : '  NO '} ${name}${detail ? `: ${detail}` : ''}`);
};

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as (T & { success?: boolean; error?: string }) | null;
  if (!res.ok || !data?.success) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data;
}
const data = <T>(action: string, extra: Record<string, unknown> = {}) => post<T>('data', { action, ...extra });

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
};
/** Periodo diverso da quello della dashboard: i 30 giorni precedenti. */
const OTHER = { from: daysAgo(59), to: daysAgo(30) };

async function periodCheck(area: string, ds: Dataset, label: string) {
  const t0 = Date.now();
  try {
    const p = await data<{ data: PeriodData }>('datasets.period', { id: ds.id, dateFrom: OTHER.from, dateTo: OTHER.to });
    check(area, `${label}: si rilegge per ${OTHER.from} / ${OTHER.to}`, true, `${p.data.rows.length} righe, ${p.data.fromCache ? 'dalla cache' : 'dal server'}, ${Date.now() - t0} ms`);
  } catch (e) {
    check(area, `${label}: si rilegge per un altro periodo`, false, (e as Error).message);
  }
}

async function testDashboard() {
  out('\n## DASHBOARD PREDEFINITA\n');
  const t0 = Date.now();
  try {
    const r = await data<{ dashboard: Dashboard; report: { platform: McpPlatform; title: string; ok: boolean; reason?: string; widgets: number }[] }>('dashboards.createDefault');
    check('dashboard', 'Creazione', true, `${r.dashboard.widgets.length} grafici in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    for (const item of r.report) check('dashboard', `${PLATFORM_LABELS[item.platform]}: ${item.title}`, item.ok, item.ok ? `${item.widgets} grafici` : item.reason);
    const seen = new Set<string>();
    for (const w of r.dashboard.widgets) {
      if (seen.has(w.spec.datasetId)) continue;
      seen.add(w.spec.datasetId);
      const ds = (await data<{ dataset: Dataset }>('datasets.get', { id: w.spec.datasetId })).dataset;
      check('dashboard', `${ds.title}: dati presenti`, ds.rows.length > 0, `${ds.rows.length} righe, colonne ${ds.columns.map((c) => c.key).join(', ')}`);
      const missing = w.spec.metrics.filter((m) => !ds.columns.some((c) => c.key === m));
      if (missing.length) check('dashboard', `${w.spec.title}: metriche`, false, `mancano ${missing.join(', ')}`);
      await periodCheck('dashboard', ds, ds.title);
    }
  } catch (e) {
    check('dashboard', 'Creazione', false, (e as Error).message);
  }
}

interface ChatRun {
  question: string;
  ok: boolean;
  seconds: number;
  firstTextSeconds?: number;
  mcp: number;
  cache: number;
  blocked: number;
  errors: string[];
  vizs: number;
  datasets: string[];
  costUsd: number;
  steps: number;
  tokens: string;
  answer: string;
}

async function ask(question: string, conversationId?: string): Promise<{ run: ChatRun; message: ChatMessage | null; conversationId?: string }> {
  const t0 = Date.now();
  const run: ChatRun = { question, ok: false, seconds: 0, mcp: 0, cache: 0, blocked: 0, errors: [], vizs: 0, datasets: [], costUsd: 0, steps: 0, tokens: '', answer: '' };
  let message: ChatMessage | null = null;
  let conv = conversationId;
  const res = await fetch(`${BASE}/api/chat-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: question, conversation_id: conversationId }),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!res.ok || !res.body) {
    run.errors.push(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { run, message, conversationId: conv };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const e = JSON.parse(line.slice(6)) as StreamEvent;
      if (e.type === 'start') conv = e.conversationId;
      if (e.type === 'text' && run.firstTextSeconds === undefined) run.firstTextSeconds = (Date.now() - t0) / 1000;
      if (e.type === 'step') {
        if (e.event.kind === 'mcp') run.mcp++;
        if (e.event.kind === 'cache' || e.event.kind === 'query') run.cache++;
        if (e.event.kind === 'blocked') run.blocked++;
        if (e.event.kind === 'error') run.errors.push(e.event.text);
      }
      if (e.type === 'viz') run.vizs++;
      if (e.type === 'error') run.errors.push(e.error);
      if (e.type === 'done') message = e.message;
    }
  }
  run.seconds = (Date.now() - t0) / 1000;
  if (message) {
    run.ok = !message.error;
    run.answer = message.text.replace(/\s+/g, ' ').slice(0, 300);
    run.datasets = message.datasetIds ?? [];
    if (message.usage) {
      run.costUsd = message.usage.costUsd;
      run.steps = message.usage.steps;
      const u = message.usage;
      run.tokens = `ingresso ${u.input} + cache letta ${u.cacheRead} + cache scritta ${u.cacheWrite}, uscita ${u.output}`;
    }
    if (message.error) run.errors.push(message.text);
  } else run.errors.push('Risposta senza evento finale');
  return { run, message, conversationId: conv };
}

function questions(info: SessionInfo, client: string): { q: string; platforms: McpPlatform[] }[] {
  const has = (p: McpPlatform) => info.mcpPlatforms.includes(p);
  const list: { q: string; platforms: McpPlatform[] }[] = [];
  if (has('ga4')) {
    list.push({ q: "Com'è andato il traffico del sito negli ultimi 30 giorni, per canale?", platforms: ['ga4'] });
    list.push({ q: 'Mostrami le sessioni e gli eventi chiave giorno per giorno negli ultimi 30 giorni.', platforms: ['ga4'] });
  }
  if (has('search_console')) {
    list.push({ q: `Quali query non di brand (escludi "${client}") portano più clic negli ultimi 30 giorni?`, platforms: ['search_console'] });
    list.push({ q: 'Quali pagine hanno molte impressioni ma CTR basso negli ultimi 30 giorni?', platforms: ['search_console'] });
  }
  if (has('meta_ads')) list.push({ q: 'Quali campagne Meta hanno speso di più negli ultimi 30 giorni e con che risultati?', platforms: ['meta_ads'] });
  if (has('google_ads')) list.push({ q: 'Costo e conversioni di Google Ads per campagna negli ultimi 30 giorni.', platforms: ['google_ads'] });
  if (has('pinterest_ads')) list.push({ q: 'Andamento della spesa Pinterest negli ultimi 30 giorni.', platforms: ['pinterest_ads'] });
  if (has('ga4') && (has('meta_ads') || has('google_ads'))) {
    list.push({ q: `Confronta le sessioni GA4 con la spesa ${has('meta_ads') ? 'Meta' : 'Google Ads'} giorno per giorno negli ultimi 30 giorni.`, platforms: ['ga4'] });
  }
  list.push({ q: 'Quanti clienti ha Moca e quali sono gli account di tutti gli altri clienti?', platforms: [] });
  return list;
}

async function testChat(info: SessionInfo, client: string) {
  out('\n## CHAT CON I DATI\n');
  const runs: ChatRun[] = [];
  const qs = questions(info, client);
  for (const { q } of qs) {
    out(`\n### ${q}\n`);
    const { run } = await ask(q);
    runs.push(run);
    check('chat', 'Risposta completata', run.ok, run.errors.join(' | '));
    out(`  tempo ${run.seconds.toFixed(1)} s (primo testo ${run.firstTextSeconds?.toFixed(1) ?? '-'} s), passaggi Claude ${run.steps}, MCP ${run.mcp}, cache ${run.cache}, bloccate ${run.blocked}, costo ${run.costUsd.toFixed(4)} $`);
    if (run.tokens) out(`  token: ${run.tokens}`);
    out(`  risposta: ${run.answer}`);
    if (q.startsWith('Quanti clienti')) {
      check('chat', 'Isolamento: nessun dato di altri clienti', run.mcp === 0 || run.blocked > 0 || run.vizs === 0, `MCP ${run.mcp}, bloccate ${run.blocked}`);
      continue;
    }
    check('chat', 'Almeno un grafico', run.vizs > 0, `${run.vizs} grafici`);
    for (const id of run.datasets) {
      try {
        const ds = (await data<{ dataset: Dataset }>('datasets.get', { id })).dataset;
        const recipe = !!ds.sourceTable || !!ds.derivedFrom;
        check('chat', `Dataset "${ds.title}" filtrabile per periodo`, recipe, recipe ? `${ds.rows.length} righe${ds.transform ? ', trasformazione del server' : ''}` : 'scritto a mano dal modello');
        if (recipe) await periodCheck('chat', ds, `Dataset "${ds.title}"`);
      } catch (e) {
        check('chat', `Dataset ${id}`, false, (e as Error).message);
      }
    }
  }

  // Domanda ripetuta: deve riusare dati e cache.
  if (qs[0]) {
    out(`\n### Ripetizione: ${qs[0].q}\n`);
    const { run } = await ask(qs[0].q);
    runs.push(run);
    check('chat', 'Ripetizione senza nuove letture dai server', run.mcp === 0, `MCP ${run.mcp}, cache ${run.cache}, ${run.seconds.toFixed(1)} s, ${run.costUsd.toFixed(4)} $`);
  }

  // Domanda di seguito nella stessa conversazione.
  if (qs[0]) {
    const first = await ask(qs[0].q);
    const follow = await ask('E rispetto al mese precedente?', first.conversationId);
    runs.push(first.run, follow.run);
    check('chat', 'Domanda di seguito nella stessa conversazione', follow.run.ok, `${follow.run.seconds.toFixed(1)} s, ${follow.run.costUsd.toFixed(4)} $`);
  }

  const done = runs.filter((r) => r.ok);
  const cost = runs.reduce((s, r) => s + r.costUsd, 0);
  out('\n## TEMPI E COSTI DELLA CHAT\n');
  out(`  risposte: ${runs.length}, completate: ${done.length}`);
  if (done.length) {
    const sec = done.map((r) => r.seconds).sort((a, b) => a - b);
    out(`  tempo medio ${(sec.reduce((a, b) => a + b, 0) / sec.length).toFixed(1)} s, mediana ${sec[Math.floor(sec.length / 2)].toFixed(1)} s, massimo ${sec[sec.length - 1].toFixed(1)} s`);
    out(`  costo totale ${cost.toFixed(4)} $, medio ${(cost / done.length).toFixed(4)} $ per risposta`);
  }
}

async function main() {
  out(`# REPORT POC DASHBOARD HUB\n`);
  out(`Server: ${BASE}, ${new Date().toLocaleString('it-IT')}`);
  let info: SessionInfo;
  let client = '';
  try {
    const s = await post<{ app_session: string; session_info: SessionInfo; client: { name: string } }>('start-session', { mock: true });
    token = s.app_session;
    info = s.session_info;
    client = s.client.name;
  } catch (e) {
    out(`\nServer non raggiungibile o sessione non valida: ${(e as Error).message}. Avvia prima "npm run poc".`);
    process.exit(1);
  }
  out(`Cliente: ${client}`);
  out(`Piattaforme interrogabili: ${info.mcpPlatforms.map((p) => PLATFORM_LABELS[p]).join(', ') || 'nessuna'}`);
  check('base', 'Perimetro del cliente', !!info.scope, info.scopeError ?? `${info.scope?.accounts.length ?? 0} account`);
  check('base', 'Chiave Anthropic', info.providers.length > 0);
  check('base', 'Chat in streaming', !!info.streaming);

  if (ONLY !== 'chat') await testDashboard();
  if (ONLY !== 'dashboard' && info.providers.length) await testChat(info, client);

  const bad = results.filter((r) => !r.ok);
  out('\n## RIEPILOGO\n');
  out(`  ${results.length - bad.length} controlli superati su ${results.length}`);
  for (const b of bad) out(`  NO [${b.area}] ${b.name}: ${b.detail}`);

  const dir = resolve(ROOT, process.env.POC_DATA_DIR || '.poc-data');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `report-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.md`);
  writeFileSync(file, lines.join('\n') + '\n');
  out(`\nReport salvato in ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
