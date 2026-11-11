import { joinTables, parseNumber, runQuery, type Table } from '../../../src/shared/engine';
import type { Cell, Dataset, PeriodData, QuerySpec, Row } from '../../../src/shared/types';
import type { McpGateway } from './mcp-gateway';
import { extractTables, toIsoDate, type ParsedTable } from './tabular';

/**
 * Rilettura di un dataset per il periodo scelto nella dashboard.
 *
 * Si ripete la stessa chiamata MCP che lo ha prodotto, cambiando solo le
 * date, e si estrae di nuovo la stessa tabella. Passa dal gateway: perimetro
 * del cliente, guard e cache come ogni altra chiamata (un periodo chiuso già
 * letto non costa una nuova chiamata).
 */

export class PeriodError extends Error {}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 3 * 366;

/** Coppie di parametri data usate dai server MCP (inizio, fine). */
const DATE_PAIRS: [string, string][] = [
  ['start_date', 'end_date'],
  ['startDate', 'endDate'],
  ['date_from', 'date_to'],
  ['dateFrom', 'dateTo'],
  ['from_date', 'to_date'],
  ['since', 'until'],
  ['date_start', 'date_stop'],
];

/** Parametri di periodo "preimpostato" da togliere quando si passano date esplicite. */
const PRESET_KEYS = ['date_preset', 'date_range', 'preset', 'period', 'range', 'time_increment_preset'];

/**
 * Argomenti della chiamata con il nuovo periodo, oppure null se lo strumento
 * non permette di indicarlo.
 */
export function argsForPeriod(args: Record<string, unknown>, schemaProps: Record<string, unknown>, from: string, to: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = structuredClone(args);
  const has = (k: string) => k in schemaProps;
  let changed = false;

  for (const [a, b] of DATE_PAIRS) {
    if (has(a) && has(b)) {
      out[a] = from;
      out[b] = to;
      changed = true;
      break;
    }
  }
  // Meta: time_range { since, until } al posto di date_preset.
  if (!changed && has('time_range')) {
    out.time_range = { since: from, until: to };
    changed = true;
  }
  // Google Ads: periodo dentro la query GAQL.
  for (const [k, v] of Object.entries(out)) {
    if (typeof v !== 'string' || !/segments\.date/i.test(v)) continue;
    const q = v
      .replace(/segments\.date\s+DURING\s+\w+/gi, `segments.date BETWEEN '${from}' AND '${to}'`)
      .replace(/segments\.date\s+BETWEEN\s+'[^']*'\s+AND\s+'[^']*'/gi, `segments.date BETWEEN '${from}' AND '${to}'`)
      .replace(/segments\.date\s*>=\s*'[^']*'/gi, `segments.date >= '${from}'`)
      .replace(/segments\.date\s*<=\s*'[^']*'/gi, `segments.date <= '${to}'`);
    if (q !== v) {
      out[k] = q;
      changed = true;
    }
  }
  if (!changed) return null;
  for (const k of PRESET_KEYS) if (k in out && k !== 'time_range') delete out[k];
  return out;
}

/** Periodo (prima e ultima data) indicato negli argomenti di una chiamata. */
export function periodOfArgs(args: Record<string, unknown>): { from?: string; to?: string } {
  const dates: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') for (const m of v.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) dates.push(m[1]);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(args);
  dates.sort();
  return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : {};
}

/** Colonne che la tabella di partenza deve avere per riprodurre il dataset. */
function neededKeys(ds: Dataset): string[] {
  const t = ds.transform;
  if (!t) return ds.columns.map((c) => ds.renames?.[c.key] ?? c.key);
  const keys = new Set<string>();
  if (t.groupBy?.length || t.metrics?.length) {
    t.groupBy?.forEach((k) => keys.add(k));
    t.metrics?.forEach((m) => m.agg !== 'count' && keys.add(m.key));
  } else ds.columns.forEach((c) => keys.add(ds.renames?.[c.key] ?? c.key));
  t.filters?.forEach((f) => keys.add(f.column));
  return [...keys];
}

/** Sceglie nella nuova risposta la tabella che corrisponde al dataset. */
function pickTable(tables: ParsedTable[], ds: Dataset): ParsedTable | null {
  const keys = ds.sourceKeys?.length ? ds.sourceKeys : neededKeys(ds);
  const complete = tables.filter((t) => keys.every((k) => t.columns.some((c) => c.key === k)));
  return complete.find((t) => t.label === ds.sourceTable) ?? complete[0] ?? null;
}

/** La trasformazione senza i filtri sulle date: il periodo lo decide la dashboard. */
function forPeriod(t: QuerySpec, source: Table): QuerySpec {
  const dateKeys = new Set(source.columns.filter((c) => c.type === 'date').map((c) => c.key));
  return { ...t, filters: (t.filters ?? []).filter((f) => !dateKeys.has(f.column)) };
}

function cast(v: Cell, type: string): Cell {
  if (v === null || v === undefined) return null;
  if (type === 'metric') return typeof v === 'number' ? v : parseNumber(v);
  if (type === 'date') return toIsoDate(v) ?? (typeof v === 'string' ? v : null);
  return String(v);
}

export function validPeriod(from: unknown, to: unknown): { from: string; to: string } {
  if (typeof from !== 'string' || typeof to !== 'string' || !DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    throw new PeriodError('Periodo non valido.');
  }
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  if (days > MAX_DAYS) throw new PeriodError('Periodo troppo lungo (massimo 3 anni).');
  return { from, to };
}

/** Dati del dataset per il periodo [from, to]. */
export async function datasetForPeriod(
  gateway: McpGateway,
  ds: Dataset,
  from: string,
  to: string,
  loadParent?: (id: string) => Promise<Dataset | null>,
  depth = 0,
): Promise<PeriodData> {
  let source: Table;
  let fetchedAt: string;
  let fromCache: boolean;

  if (ds.derivedFrom) {
    // Dataset derivato: si rilegge il padre e si riapplica la trasformazione.
    const parent = depth < 3 && loadParent ? await loadParent(ds.derivedFrom) : null;
    if (!parent) throw new PeriodError('Il dataset di partenza non è più disponibile.');
    const p = await datasetForPeriod(gateway, parent, from, to, loadParent, depth + 1);
    source = { columns: p.columns, rows: p.rows };
    fetchedAt = p.fetchedAt;
    fromCache = p.fromCache;
  } else {
    if (!ds.sourceTable || ds.sourceCalls.length !== 1) throw new PeriodError('Questo dataset è stato scritto a mano in chat e non si può rileggere per un altro periodo.');
    const call = ds.sourceCalls[0];
    const policy = (await gateway.policies(call.platform)).find((p) => p.name === call.tool);
    if (!policy) throw new PeriodError('Strumento non più disponibile.');
    const args = argsForPeriod(call.args, policy.properties, from, to);
    if (!args) throw new PeriodError('Lo strumento usato non permette di scegliere il periodo.');
    const res = await gateway.execute(call.platform, call.tool, args);
    if (!res.ok) throw new PeriodError(res.reason);
    const table = pickTable(extractTables(res.text), ds);
    if (!table) throw new PeriodError('La risposta del server non contiene più la stessa tabella.');
    source = table;
    fetchedAt = res.fetchedAt;
    fromCache = res.fromCache;
  }

  // Incrocio: anche l'altro lato si rilegge per lo stesso periodo.
  if (ds.join) {
    const other = depth < 3 && loadParent ? await loadParent(ds.join.datasetId) : null;
    if (!other) throw new PeriodError("Il dataset incrociato non è più disponibile.");
    const p = await datasetForPeriod(gateway, other, from, to, loadParent, depth + 1);
    source = joinTables(source, { columns: p.columns, rows: p.rows }, ds.join.pairs, { a: ds.title, b: other.title }, ds.join.mode);
    fromCache = fromCache && p.fromCache;
  }

  const result = ds.transform ? runQuery(source, forPeriod(ds.transform, source)) : source;
  const rows: Row[] = result.rows.map((r) => Object.fromEntries(ds.columns.map((c) => [c.key, cast(r[ds.renames?.[c.key] ?? c.key] ?? null, c.type)])));
  return { columns: ds.columns, rows, dateFrom: from, dateTo: to, fetchedAt, fromCache };
}
