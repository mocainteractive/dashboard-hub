import type { Agg, Cell, Column, Computed, DashboardFilters, DateGrain, Filter, JoinKey, JoinMode, QuerySpec, Row, VizSpec } from './types';

/**
 * Motore dei dati: filtri, aggregazioni, incroci e preparazione dei grafici.
 * Gira nel browser (dashboard istantanee, senza chiamate di rete) e nelle
 * Functions (strumento query_dataset dell'assistente).
 */

export interface Table {
  columns: Column[];
  rows: Row[];
}

/**
 * Numero da testo, anche in formato italiano: "1.234,50" -> 1234.5,
 * "1,234.50" -> 1234.5, "3,5%" -> 3.5, "€ 800" -> 800.
 */
export function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let t = v.replace(/[^\d.,-]/g, '');
  if (!/\d/.test(t)) return null;
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    t = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (lastComma >= 0) {
    t = /^-?\d{1,3}(,\d{3})+$/.test(t) && !/,\d{1,2}$/.test(t) ? t.replace(/,/g, '') : t.replace(/,/g, '.');
  } else if ((t.match(/\./g) ?? []).length > 1) {
    t = t.replace(/\./g, '');
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const num = (v: Cell): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

function cmp(a: Cell, b: Cell): number {
  const na = num(a);
  const nb = num(b);
  if (na !== null && nb !== null) return na - nb;
  return String(a ?? '').localeCompare(String(b ?? ''), 'it');
}

function matches(row: Row, f: Filter): boolean {
  const v = row[f.column];
  const target = f.value;
  switch (f.op) {
    case 'eq':
      return String(v ?? '') === String(target ?? '');
    case 'neq':
      return String(v ?? '') !== String(target ?? '');
    case 'in':
      return Array.isArray(target) && target.map(String).includes(String(v ?? ''));
    case 'contains':
      return String(v ?? '').toLowerCase().includes(String(target ?? '').toLowerCase());
    case 'not_contains': {
      // Un elenco di termini: la riga passa se non ne contiene nessuno (es. query non di brand).
      const terms = (Array.isArray(target) ? target : [target]).map((x) => String(x ?? '').toLowerCase()).filter(Boolean);
      const text = String(v ?? '').toLowerCase();
      return !terms.some((t) => text.includes(t));
    }
    case 'not_in':
      return !(Array.isArray(target) && target.map(String).includes(String(v ?? '')));
    case 'gt':
      return cmp(v, target as Cell) > 0;
    case 'gte':
      return cmp(v, target as Cell) >= 0;
    case 'lt':
      return cmp(v, target as Cell) < 0;
    case 'lte':
      return cmp(v, target as Cell) <= 0;
    case 'between':
      return Array.isArray(target) && cmp(v, target[0]) >= 0 && cmp(v, target[1]) <= 0;
    default:
      return true;
  }
}

/** Filtra ignorando le colonne che il dataset non ha. */
export function applyFilters(table: Table, filters: Filter[] = []): Table {
  const keys = new Set(table.columns.map((c) => c.key));
  const active = filters.filter((f) => keys.has(f.column));
  if (!active.length) return table;
  return { columns: table.columns, rows: table.rows.filter((r) => active.every((f) => matches(r, f))) };
}

/** Riporta una data AAAA-MM-GG alla granularità richiesta. */
export function bucketDate(value: Cell, grain: DateGrain = 'day'): Cell {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}(-\d{2})?/.test(value)) return value;
  if (grain === 'month') return value.slice(0, 7);
  if (grain === 'week' && value.length >= 10) {
    const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    const day = (d.getUTCDay() + 6) % 7; // lunedì = 0
    d.setUTCDate(d.getUTCDate() - day);
    return d.toISOString().slice(0, 10);
  }
  return value.slice(0, 10);
}

function aggregateValues(values: Cell[], agg: Agg): number | null {
  if (agg === 'count') return values.length;
  const nums = values.map(num).filter((n): n is number => n !== null);
  if (!nums.length) return null;
  switch (agg) {
    case 'sum':
      return nums.reduce((s, n) => s + n, 0);
    case 'avg':
      return nums.reduce((s, n) => s + n, 0) / nums.length;
    case 'min':
      return Math.min(...nums);
    case 'max':
      return Math.max(...nums);
  }
}

export function defaultAgg(col: Column | undefined): Agg {
  return col?.agg ?? (col?.format === 'percent' || col?.format === 'decimal' ? 'avg' : 'sum');
}

/** Filtri, raggruppamento, aggregazione, ordinamento e limite. */
export function runQuery(table: Table, spec: QuerySpec): Table {
  let t = applyFilters(addComputed(table, spec.computed), spec.filters);
  const byKey = new Map(t.columns.map((c) => [c.key, c]));
  const groupBy = (spec.groupBy ?? []).filter((k) => byKey.has(k));
  const metrics = (spec.metrics ?? []).filter((m) => byKey.has(m.key) || m.agg === 'count');

  if (groupBy.length || metrics.length) {
    const groups = new Map<string, { keys: Row; rows: Row[] }>();
    for (const r of t.rows) {
      const keys: Row = {};
      for (const g of groupBy) keys[g] = byKey.get(g)?.type === 'date' ? bucketDate(r[g], spec.dateGrain) : r[g];
      const id = JSON.stringify(groupBy.map((g) => keys[g]));
      const entry = groups.get(id) ?? { keys, rows: [] };
      entry.rows.push(r);
      groups.set(id, entry);
    }
    const rows: Row[] = [];
    for (const { keys, rows: members } of groups.values()) {
      const out: Row = { ...keys };
      for (const m of metrics) out[m.key] = aggregateValues(members.map((r) => r[m.key]), m.agg ?? defaultAgg(byKey.get(m.key)));
      rows.push(out);
    }
    const columns: Column[] = [
      ...groupBy.map((g) => byKey.get(g)!),
      ...metrics.map((m) => byKey.get(m.key) ?? { key: m.key, label: 'Conteggio', type: 'metric' as const, format: 'number' as const }),
    ];
    t = { columns, rows };
  }

  if (spec.sort && t.columns.some((c) => c.key === spec.sort!.key)) {
    const { key, dir } = spec.sort;
    t = { ...t, rows: [...t.rows].sort((a, b) => (dir === 'asc' ? 1 : -1) * cmp(a[key], b[key])) };
  }
  if (spec.limit && spec.limit > 0) t = { ...t, rows: t.rows.slice(0, spec.limit) };
  return t;
}

// --- Metriche calcolate ---

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokenize(expr: string): Tok[] {
  const out: Tok[] = [];
  const re = /\s*(?:(\d+(?:[.,]\d+)?)|([a-z_][a-z0-9_]*)|([-+*/()]))/gy;
  let m: RegExpExecArray | null;
  let pos = 0;
  while (pos < expr.length) {
    re.lastIndex = pos;
    m = re.exec(expr);
    if (!m || m[0].length === 0) {
      if (/^\s*$/.test(expr.slice(pos))) break;
      throw new Error(`Formula non valida vicino a "${expr.slice(pos, pos + 10)}"`);
    }
    if (m[1]) out.push({ t: 'num', v: Number(m[1].replace(',', '.')) });
    else if (m[2]) out.push({ t: 'id', v: m[2] });
    else if (m[3]) out.push({ t: 'op', v: m[3] });
    pos = re.lastIndex;
  }
  return out;
}

type Node = { k: 'num'; v: number } | { k: 'col'; v: string } | { k: 'neg'; e: Node } | { k: 'bin'; op: string; l: Node; r: Node };

/** Formula aritmetica sicura: numeri, colonne, + - * / e parentesi. Nessun codice eseguito. */
export function compileExpr(expr: string, columns: string[]): (row: Row) => number | null {
  const toks = tokenize(expr.toLowerCase());
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];
  const primary = (): Node => {
    const t = take();
    if (!t) throw new Error('Formula incompleta');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'id') {
      if (!columns.includes(t.v)) throw new Error(`Colonna "${t.v}" inesistente. Colonne: ${columns.join(', ')}`);
      return { k: 'col', v: t.v };
    }
    if (t.v === '(') {
      const e = sum();
      if (take()?.v !== ')') throw new Error('Parentesi non chiusa');
      return e;
    }
    if (t.v === '-') return { k: 'neg', e: primary() };
    throw new Error(`Simbolo inatteso "${t.v}"`);
  };
  const product = (): Node => {
    let l = primary();
    while (peek()?.t === 'op' && (peek()!.v === '*' || peek()!.v === '/')) {
      const op = String(take()!.v);
      l = { k: 'bin', op, l, r: primary() };
    }
    return l;
  };
  const sum = (): Node => {
    let l = product();
    while (peek()?.t === 'op' && (peek()!.v === '+' || peek()!.v === '-')) {
      const op = String(take()!.v);
      l = { k: 'bin', op, l, r: product() };
    }
    return l;
  };
  const tree = sum();
  if (i < toks.length) throw new Error('Formula non valida');
  const ev = (n: Node, r: Row): number | null => {
    switch (n.k) {
      case 'num':
        return n.v;
      case 'col':
        return num(r[n.v]);
      case 'neg': {
        const v = ev(n.e, r);
        return v === null ? null : -v;
      }
      case 'bin': {
        const a = ev(n.l, r);
        const b = ev(n.r, r);
        if (a === null || b === null) return null;
        if (n.op === '+') return a + b;
        if (n.op === '-') return a - b;
        if (n.op === '*') return a * b;
        return b === 0 ? null : a / b;
      }
    }
  };
  return (r) => {
    const v = ev(tree, r);
    return v === null || !Number.isFinite(v) ? null : Math.round(v * 1e6) / 1e6;
  };
}

/** Aggiunge le metriche calcolate come nuove colonne. */
export function addComputed(t: Table, computed: Computed[] = []): Table {
  if (!computed.length) return t;
  let columns = [...t.columns];
  let rows = t.rows;
  for (const c of computed) {
    const fn = compileExpr(c.expr, columns.map((x) => x.key));
    columns = [...columns.filter((x) => x.key !== c.key), { key: c.key, label: c.label || c.key, type: 'metric', format: c.format ?? 'decimal', agg: c.agg ?? 'sum' }];
    rows = rows.map((r) => ({ ...r, [c.key]: fn(r) }));
  }
  return { columns, rows };
}

// --- Incroci ---

const PATH_KEY = /(page|pagina|url|landing|path|link|percorso)/;

/** Indirizzo o percorso nella forma "/percorso" (senza dominio, parametri e slash finale). */
export function normalizePath(v: string): string {
  let s = v.trim().toLowerCase();
  try {
    s = decodeURI(s);
  } catch {
    // Percorso non codificato: si tiene così.
  }
  s = s.replace(/^[a-z]+:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/\/{2,}/g, '/');
  if (!s.startsWith('/')) s = `/${s}`;
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s;
}

/** Valore di confronto: date al giorno, percorsi normalizzati, testo senza maiuscole e spazi superflui. */
function joinValue(v: Cell, kind: 'date' | 'path' | 'text'): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (kind === 'date') return s.slice(0, 10);
  if (kind === 'path') return normalizePath(s);
  return s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^["“«]|["”»]$/g, '');
}

/** Coppie di colonne da far corrispondere, da "on" (stesso nome) o da "pairs". */
export function joinKeysOf(j: { on?: string[]; pairs?: JoinKey[] }): JoinKey[] {
  if (j.pairs?.length) return j.pairs;
  return (j.on ?? []).map((k) => ({ a: k, b: k }));
}

/**
 * Incrocia due tabelle.
 *  - merge: ogni lato aggregato sulle chiavi, poi unito (full outer join): es. sessioni GA4 e spesa Meta per data.
 *  - lookup: tutte le righe della prima, con le metriche della seconda che corrispondono (aggregate per chiave):
 *    es. query GSC per pagina + sessioni e conversioni GA4 della landing page.
 * Le chiavi si confrontano normalizzate (date, percorsi, maiuscole). Le metriche del secondo lato con lo stesso nome
 * ricevono il prefisso "b__".
 */
export function joinTables(a: Table, b: Table, on: string[] | JoinKey[], labels: { a: string; b: string }, mode: JoinMode = 'merge'): Table {
  const pairs: JoinKey[] = (on as (string | JoinKey)[]).map((k) => (typeof k === 'string' ? { a: k, b: k } : k));
  const colA = new Map(a.columns.map((c) => [c.key, c]));
  const colB = new Map(b.columns.map((c) => [c.key, c]));
  const keys = pairs.filter((p) => colA.has(p.a) && colB.has(p.b));
  if (!keys.length) throw new Error('Scegli le colonne da far corrispondere tra i due dataset.');
  const kinds = keys.map((p) => (colA.get(p.a)!.type === 'date' || colB.get(p.b)!.type === 'date' ? 'date' : PATH_KEY.test(p.a) || PATH_KEY.test(p.b) ? 'path' : 'text') as 'date' | 'path' | 'text');
  const idA = (r: Row) => JSON.stringify(keys.map((p, i) => joinValue(r[p.a], kinds[i])));
  const idB = (r: Row) => JSON.stringify(keys.map((p, i) => joinValue(r[p.b], kinds[i])));
  const keyB = new Set(keys.map((p) => p.b));
  const keyA = new Set(keys.map((p) => p.a));

  // Metriche del secondo lato aggregate per chiave normalizzata.
  const bMetrics = b.columns.filter((c) => c.type === 'metric' && !keyB.has(c.key));
  const aKeys = new Set(a.columns.map((c) => c.key));
  const rename = new Map<string, string>();
  const bCols: Column[] = [];
  for (const c of bMetrics) {
    const key = aKeys.has(c.key) ? `b__${c.key}` : c.key;
    rename.set(c.key, key);
    bCols.push({ ...c, key, label: aKeys.has(c.key) ? `${c.label} (${labels.b})` : c.label });
  }
  const groupsB = new Map<string, Row[]>();
  for (const r of b.rows) {
    const id = idB(r);
    if (!groupsB.has(id)) groupsB.set(id, []);
    groupsB.get(id)!.push(r);
  }
  const aggB = new Map<string, Row>();
  for (const [id, rows] of groupsB) {
    const out: Row = {};
    for (const c of bMetrics) out[rename.get(c.key)!] = aggregateValues(rows.map((r) => r[c.key]), defaultAgg(c));
    aggB.set(id, { ...out, __first: JSON.stringify(keys.map((p) => rows[0][p.b])) });
  }

  if (mode === 'lookup') {
    const rows = a.rows.map((r) => {
      const hit = aggB.get(idA(r));
      const extra: Row = {};
      for (const c of bCols) extra[c.key] = hit ? (hit[c.key] ?? null) : null;
      return { ...r, ...extra };
    });
    const aCols = a.columns.map((c) => (c.type === 'metric' && rename.has(c.key) ? { ...c, label: `${c.label} (${labels.a})` } : c));
    return { columns: [...aCols, ...bCols], rows };
  }

  const aMetrics = a.columns.filter((c) => c.type === 'metric' && !keyA.has(c.key));
  const groupsA = new Map<string, Row[]>();
  for (const r of a.rows) {
    const id = idA(r);
    if (!groupsA.has(id)) groupsA.set(id, []);
    groupsA.get(id)!.push(r);
  }
  const merged = new Map<string, Row>();
  for (const [id, rows] of groupsA) {
    const out: Row = {};
    keys.forEach((p) => (out[p.a] = kinds[keys.indexOf(p)] === 'date' ? joinValue(rows[0][p.a], 'date') : rows[0][p.a]));
    for (const c of aMetrics) out[c.key] = aggregateValues(rows.map((r) => r[c.key]), defaultAgg(c));
    merged.set(id, out);
  }
  for (const [id, row] of aggB) {
    const target = merged.get(id) ?? Object.fromEntries(keys.map((p, i) => [p.a, (JSON.parse(row.__first as string) as Cell[])[i]]));
    for (const c of bCols) target[c.key] = row[c.key];
    merged.set(id, target);
  }
  const aCols = [...keys.map((p) => colA.get(p.a)!), ...aMetrics.map((c) => (rename.has(c.key) ? { ...c, label: `${c.label} (${labels.a})` } : c))];
  // Valori mancanti su un lato: null esplicito, non colonna assente.
  const all = [...aCols, ...bCols].map((c) => c.key);
  const rows = [...merged.values()]
    .map((r) => Object.fromEntries(all.map((k) => [k, r[k] ?? null])) as Row)
    .sort((x, y) => cmp(x[keys[0].a], y[keys[0].a]));
  return { columns: [...aCols, ...bCols], rows };
}

/** Colonna data principale, se esiste. */
export function dateColumn(t: Table): Column | undefined {
  return t.columns.find((c) => c.type === 'date');
}

/** Applica i filtri globali della dashboard (periodo e dimensioni). */
export function applyDashboardFilters(t: Table, f?: DashboardFilters): Table {
  if (!f) return t;
  const filters: Filter[] = [...(f.dims ?? [])];
  const dc = dateColumn(t);
  if (dc && f.dateFrom) filters.push({ column: dc.key, op: 'gte', value: f.dateFrom });
  if (dc && f.dateTo) filters.push({ column: dc.key, op: 'lte', value: f.dateTo });
  return applyFilters(t, filters);
}

export const OTHER_SERIES = 'Altro';
export const MAX_SERIES = 5;

export interface ChartData {
  /** Righe per Recharts: una chiave per asse X e una per serie. */
  rows: Row[];
  /** Serie da disegnare (chiavi in rows). */
  series: { key: string; label: string; column: Column }[];
  xColumn?: Column;
  /** Tabella aggregata, per la vista tabellare. */
  table: Table;
}

/** Prepara i dati di una visualizzazione a partire dalla tabella già filtrata. */
export function chartData(t: Table, spec: VizSpec): ChartData {
  const byKey = new Map(t.columns.map((c) => [c.key, c]));
  const metrics = spec.metrics.filter((m) => byKey.has(m));
  const metricSpecs = metrics.map((key) => ({ key, agg: spec.agg ?? defaultAgg(byKey.get(key)) }));
  const xColumn = spec.x ? byKey.get(spec.x) : undefined;

  if (spec.type === 'kpi' || !xColumn) {
    const table = runQuery(t, { filters: spec.filters, metrics: metricSpecs });
    return { rows: table.rows, series: metrics.map((k) => ({ key: k, label: byKey.get(k)!.label, column: byKey.get(k)! })), table };
  }

  const isDate = xColumn.type === 'date';
  const seriesCol = spec.seriesBy && spec.seriesBy !== spec.x ? byKey.get(spec.seriesBy) : undefined;
  const groupBy = seriesCol ? [xColumn.key, seriesCol.key] : [xColumn.key];
  const table = runQuery(t, { filters: spec.filters, groupBy, metrics: metricSpecs, dateGrain: spec.dateGrain });

  if (!seriesCol) {
    let rows = table.rows;
    if (isDate) rows = [...rows].sort((a, b) => cmp(a[xColumn.key], b[xColumn.key]));
    else if (metrics[0]) rows = [...rows].sort((a, b) => cmp(b[metrics[0]], a[metrics[0]]));
    if (spec.sort) rows = [...rows].sort((a, b) => (spec.sort!.dir === 'asc' ? 1 : -1) * cmp(a[spec.sort!.key], b[spec.sort!.key]));
    if (spec.limit) rows = rows.slice(0, spec.limit);
    return { rows, series: metrics.map((k) => ({ key: k, label: byKey.get(k)!.label, column: byKey.get(k)! })), xColumn, table: { columns: table.columns, rows } };
  }

  // Una metrica divisa per serie: le prime MAX_SERIES per totale, il resto in "Altro".
  const metric = metrics[0];
  const metricCol = byKey.get(metric)!;
  const totals = new Map<string, number>();
  for (const r of table.rows) {
    const s = String(r[seriesCol.key] ?? 'n.d.');
    totals.set(s, (totals.get(s) ?? 0) + (num(r[metric]) ?? 0));
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const keep = new Set(ranked.slice(0, MAX_SERIES));
  const pivot = new Map<string, Row>();
  for (const r of table.rows) {
    const x = String(r[xColumn.key] ?? '');
    const sName = String(r[seriesCol.key] ?? 'n.d.');
    const s = keep.has(sName) ? sName : OTHER_SERIES;
    const row = pivot.get(x) ?? { [xColumn.key]: r[xColumn.key] };
    row[s] = (num(row[s] as Cell) ?? 0) + (num(r[metric]) ?? 0);
    pivot.set(x, row);
  }
  let rows = [...pivot.values()];
  rows.sort((a, b) => (isDate ? cmp(a[xColumn.key], b[xColumn.key]) : 0));
  if (spec.limit) rows = rows.slice(0, spec.limit);
  const names = ranked.filter((s) => keep.has(s));
  if (ranked.some((s) => !keep.has(s))) names.push(OTHER_SERIES);
  return {
    rows,
    series: names.map((n) => ({ key: n, label: n, column: metricCol })),
    xColumn,
    table,
  };
}

/** Valori distinti di una colonna, per i menu dei filtri. */
export function distinctValues(t: Table, key: string, max = 200): string[] {
  const out = new Set<string>();
  for (const r of t.rows) {
    const v = r[key];
    if (v !== null && v !== undefined && v !== '') out.add(String(v));
    if (out.size >= max) break;
  }
  return [...out].sort((a, b) => a.localeCompare(b, 'it'));
}

/** CSV con separatore punto e virgola (Excel italiano). */
export function toCsv(t: Table): string {
  const esc = (v: Cell) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [t.columns.map((c) => esc(c.label)).join(';'), ...t.rows.map((r) => t.columns.map((c) => esc(r[c.key])).join(';'))].join('\n');
}
