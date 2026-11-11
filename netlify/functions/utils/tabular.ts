import { parseNumber } from '../../../src/shared/engine';
import type { Agg, Cell, Column, ColumnFormat, Row } from '../../../src/shared/types';

/**
 * Trasforma in tabelle le risposte testuali dei server MCP, senza AI.
 *
 * I server Moca rispondono in tre forme:
 *  - JSON (Meta, Pinterest): elenchi di oggetti, anche annidati;
 *  - tabelle con separatore "|" e riga di intestazione (GA4, Google Ads);
 *  - righe "etichetta — Chiave: valore | Chiave: valore" (Search Console).
 *
 * Così il modello non deve più ricopiare i dati riga per riga: riceve
 * un'anteprima e lavora sull'id della tabella.
 */

export interface ParsedTable {
  /** Da dove arriva la tabella (chiave JSON o intestazione vicina). */
  label: string;
  columns: Column[];
  rows: Row[];
  /** Righe totali presenti nel testo prima del limite. */
  totalRows: number;
}

const MAX_TABLES = 6;
const MAX_ROWS = 5000;
const MAX_COLS = 40;

// --- Inferenza delle colonne ---

const RATE_RE = /(ctr|rate|tasso|percent|perc|cpc|cpm|cpa|cpl|roas|position|posizione|^pos$|frequen|avg|average|media|medio|per_|_per)/;
const CURRENCY_RE = /(spend|spesa|cost|costo|revenue|ricav|fatturato|value|valore|budget|cpc|cpm|cpa|cpl|price|prezzo|amount|importo)/;
const DURATION_RE = /(duration|durata|time_on|tempo)/;
const ID_RE = /(^id$|_id$|^id_|code$|codice|^year$|^anno$)/;

/** camelCase, spazi e simboli in snake_case ASCII. */
export function toKey(header: string): string {
  const k = header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/%/g, '_pct')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return k || 'col';
}

/** Data in AAAA-MM-GG, oppure null se il valore non è una data. */
export function toIsoDate(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/);
  if (!m) m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +y < 1990 || +y > 2100) return null;
  return `${y}-${mo}-${d}`;
}

/** Valore numerico "pulito" (no ID lunghi, no testo con parole). */
function looksNumeric(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s) return false;
  if (/^\d{9,}$/.test(s)) return false; // ID numerici (campagne, account)
  return /^[-+]?[€$£]?\s*[-+]?\d[\d.,\s]*\s*(%|€|\$|£|s|eur|usd)?$/i.test(s);
}

function inferColumns(headers: string[], raw: unknown[][]): { columns: Column[]; rows: Row[] } {
  const used = new Set<string>();
  const columns: Column[] = [];
  const kinds: ('date' | 'metric' | 'dimension')[] = [];
  headers.slice(0, MAX_COLS).forEach((h, i) => {
    let key = toKey(h);
    while (used.has(key)) key = `${key}_${i}`;
    used.add(key);
    const values = raw.map((r) => r[i]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '' && String(v).trim() !== '-');
    let type: Column['type'] = 'dimension';
    if (values.length && values.every((v) => toIsoDate(v) !== null)) type = 'date';
    else if (values.length && !ID_RE.test(key) && values.filter(looksNumeric).length >= Math.ceil(values.length * 0.9)) type = 'metric';
    const col: Column = { key, label: h.trim().slice(0, 80) || key, type };
    if (type === 'metric') {
      const pct = values.some((v) => typeof v === 'string' && v.trim().endsWith('%'));
      const format: ColumnFormat = pct || /(ctr|rate|tasso|percent|_pct)/.test(key) ? 'percent' : CURRENCY_RE.test(key) ? 'currency' : DURATION_RE.test(key) ? 'duration' : values.some((v) => !Number.isInteger(parseNumber(v) ?? 0)) ? 'decimal' : 'number';
      const agg: Agg = format === 'percent' || RATE_RE.test(key) ? 'avg' : 'sum';
      col.format = format;
      col.agg = agg;
    }
    columns.push(col);
    kinds.push(type);
  });
  const rows: Row[] = raw.slice(0, MAX_ROWS).map((r) => {
    const row: Row = {};
    columns.forEach((c, i) => {
      const v = r[i];
      let cell: Cell = null;
      if (v === null || v === undefined || (typeof v === 'string' && (v.trim() === '' || v.trim() === '-'))) cell = null;
      else if (kinds[i] === 'date') cell = toIsoDate(v);
      else if (kinds[i] === 'metric') cell = parseNumber(v);
      else cell = String(typeof v === 'object' ? JSON.stringify(v) : v).trim().slice(0, 300);
      row[c.key] = cell;
    });
    return row;
  });
  return { columns, rows };
}

// --- JSON ---

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isScalar = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/** Appiattisce un oggetto: { a: { b: 1 } } -> { a_b: 1 }, fino a due livelli. */
function flatten(o: Record<string, unknown>, prefix = '', depth = 0, out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}_${k}` : k;
    if (isScalar(v)) out[key] = v;
    else if (isPlain(v) && depth < 2) flatten(v, key, depth + 1, out);
    else if (Array.isArray(v) && v.length <= 10 && v.every(isScalar)) out[key] = v.join(', ');
    // Liste di oggetti annidate: diventano tabelle a sé (vedi walk).
  }
  return out;
}

function tableFromObjects(label: string, items: Record<string, unknown>[]): ParsedTable | null {
  const flat = items.slice(0, MAX_ROWS).map((o) => flatten(o));
  const headers: string[] = [];
  for (const f of flat) for (const k of Object.keys(f)) if (!headers.includes(k)) headers.push(k);
  if (headers.length < 2) return null;
  const raw = flat.map((f) => headers.map((h) => f[h]));
  const { columns, rows } = inferColumns(headers, raw);
  return { label, columns, rows, totalRows: items.length };
}

function walkJson(v: unknown, path: string, out: ParsedTable[]) {
  if (out.length >= MAX_TABLES) return;
  if (Array.isArray(v)) {
    const objs = v.filter(isPlain);
    if (objs.length && objs.length >= v.length * 0.8) {
      const t = tableFromObjects(path || 'dati', objs);
      if (t) out.push(t);
      // Liste annidate dentro gli elementi (es. campagne -> annunci) solo se poche righe.
      if (objs.length <= 3) objs.forEach((o, i) => Object.entries(o).forEach(([k, x]) => Array.isArray(x) && walkJson(x, `${path}[${i}].${k}`, out)));
    }
    return;
  }
  if (!isPlain(v)) return;
  // Oggetto con soli valori scalari numerici (riepilogo KPI): tabella di una riga.
  const scalars = Object.entries(v).filter(([, x]) => isScalar(x));
  const numeric = scalars.filter(([, x]) => looksNumeric(x));
  if (numeric.length >= 3) {
    const headers = scalars.map(([k]) => k);
    const { columns, rows } = inferColumns(headers, [scalars.map(([, x]) => x)]);
    out.push({ label: path ? `${path} (riepilogo)` : 'riepilogo', columns, rows, totalRows: 1 });
  }
  for (const [k, x] of Object.entries(v)) {
    if (Array.isArray(x) || isPlain(x)) walkJson(x, path ? `${path}.${k}` : k, out);
  }
}

function jsonCandidates(text: string): unknown[] {
  const out: unknown[] = [];
  const tryParse = (s: string) => {
    try {
      out.push(JSON.parse(s));
      return true;
    } catch {
      return false;
    }
  };
  const t = text.trim();
  if ((t.startsWith('{') || t.startsWith('[')) && tryParse(t)) return out;
  for (const m of text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)) tryParse(m[1]);
  if (!out.length) {
    // JSON dopo un'intestazione testuale.
    const i = text.search(/^\s*[[{]/m);
    if (i > 0) tryParse(text.slice(i).trim());
  }
  return out;
}

// --- Tabelle con "|" ---

const SEP_RE = /^[\s|─━═\-=+:_]+$/;

function splitPipes(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/** Una riga "Chiave: valore | Chiave: valore" non è una tabella con intestazione. */
const KV_PAIR_RE = /[^|:]{1,40}:\s*[^|]+/g;
const isKvLine = (line: string) => line.includes('|') && (line.match(KV_PAIR_RE) ?? []).length >= 2 && splitPipes(line).every((c) => /:\s*\S/.test(c) || /\s[—–-]\s/.test(c));

function pipeTables(lines: string[]): { tables: ParsedTable[]; used: Set<number> } {
  const tables: ParsedTable[] = [];
  const used = new Set<number>();
  let i = 0;
  while (i < lines.length && tables.length < MAX_TABLES) {
    const line = lines[i];
    if (!line.includes('|') || SEP_RE.test(line) || isKvLine(line)) {
      i++;
      continue;
    }
    const header = splitPipes(line);
    if (header.length < 2) {
      i++;
      continue;
    }
    const block: string[][] = [];
    const idx: number[] = [i];
    let j = i + 1;
    let sawSep = false;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim()) break;
      if (SEP_RE.test(l)) {
        sawSep = true;
        idx.push(j);
        continue;
      }
      if (!l.includes('|')) break;
      const cells = splitPipes(l);
      if (cells.length !== header.length) break;
      block.push(cells);
      idx.push(j);
    }
    // Intestazione credibile: separatore, oppure celle non numeriche.
    const headerOk = sawSep || header.every((h) => !looksNumeric(h));
    if (block.length >= 1 && headerOk) {
      const label = nearestTitle(lines, i);
      const { columns, rows } = inferColumns(header, block);
      tables.push({ label, columns, rows, totalRows: block.length });
      idx.forEach((k) => used.add(k));
    }
    i = Math.max(j, i + 1);
  }
  return { tables, used };
}

/** Titolo più vicino sopra una tabella (riga non vuota, senza "|"). */
function nearestTitle(lines: string[], at: number): string {
  for (let k = at - 1; k >= Math.max(0, at - 4); k--) {
    const l = lines[k].trim();
    if (l && !l.includes('|') && !SEP_RE.test(l)) return l.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[:\s]+$/, '').slice(0, 80) || 'tabella';
  }
  return 'tabella';
}

// --- Righe "etichetta — Chiave: valore | Chiave: valore" ---

function parseKvLine(line: string): { label: string | null; pairs: [string, string][] } | null {
  let body = line.trim().replace(/^[^\p{L}\p{N}]+/u, '');
  let label: string | null = null;
  const m = body.match(/^(.{1,60}?)\s+[—–-]\s+(.+)$/);
  if (m && !m[1].includes(':')) {
    label = m[1].trim();
    body = m[2];
  }
  const parts = body.split('|').map((p) => p.trim());
  const pairs: [string, string][] = [];
  for (const p of parts) {
    const kv = p.match(/^([^:]{1,40}):\s*(.+)$/);
    if (!kv) return null;
    pairs.push([kv[1].trim(), kv[2].trim()]);
  }
  return pairs.length >= 2 ? { label, pairs } : null;
}

/** Riga "1. "testo"" che fa da etichetta alla riga di valori successiva (elenchi di Search Console). */
const NUMBERED_RE = /^\s*\d{1,4}[.)]\s+(.+?)\s*$/;

/** Nome della colonna etichetta, dedotto dal titolo dell'elenco. */
function labelColumn(title: string, isDate: boolean): string {
  if (isDate) return 'date';
  const t = title.toLowerCase();
  if (t.includes('query') || t.includes('ricerc')) return 'query';
  if (t.includes('pagin') || t.includes('page')) return 'pagina';
  if (t.includes('campagn')) return 'campagna';
  if (t.includes('paes') || t.includes('countr')) return 'paese';
  if (t.includes('dispositiv') || t.includes('device')) return 'dispositivo';
  return 'elemento';
}

interface KvRow {
  label: string | null;
  pairs: [string, string][];
  line: number;
}

/**
 * Righe "etichetta — Chiave: valore | Chiave: valore", anche con l'etichetta
 * sulla riga precedente in forma di elenco numerato. Le righe con le stesse
 * chiavi formano una tabella (minimo 2 righe); righe di totale con chiavi
 * diverse non si mescolano.
 */
function kvTables(lines: string[], skip: Set<number>): ParsedTable[] {
  const tables: ParsedTable[] = [];
  let group: KvRow[] = [];
  let sig = '';
  const close = () => {
    if (group.length >= 2 && tables.length < MAX_TABLES) {
      const withLabel = group[0].label !== null;
      const title = nearestTitle(lines, group[0].line - (withLabel && NUMBERED_RE.test(lines[group[0].line - 1] ?? '') ? 1 : 0));
      const labelIsDate = withLabel && group.every((g) => g.label && toIsoDate(g.label));
      const headers = [...(withLabel ? [labelColumn(title, labelIsDate)] : []), ...group[0].pairs.map(([k]) => k)];
      const raw = group.map((g) => [...(withLabel ? [g.label] : []), ...g.pairs.map(([, v]) => v)]);
      const { columns, rows } = inferColumns(headers, raw);
      tables.push({ label: title, columns, rows, totalRows: group.length });
    }
    group = [];
    sig = '';
  };

  for (let i = 0; i < lines.length; i++) {
    if (skip.has(i)) continue;
    const parsed = parseKvLine(lines[i]);
    if (!parsed) {
      // Le righe vuote e le etichette numerate non interrompono un elenco.
      if (lines[i].trim() && !NUMBERED_RE.test(lines[i]) && group.length) close();
      continue;
    }
    let label = parsed.label;
    if (label === null) {
      let k = i - 1;
      while (k >= 0 && !lines[k].trim()) k--;
      const m = k >= 0 ? lines[k].match(NUMBERED_RE) : null;
      if (m) label = m[1].replace(/^["“«]|["”»]$/g, '').trim();
    }
    const rowSig = parsed.pairs.map(([key]) => key).join('|') + (label !== null ? '#L' : '');
    if (rowSig !== sig) {
      close();
      sig = rowSig;
    }
    group.push({ label, pairs: parsed.pairs, line: i });
  }
  close();
  return tables;
}

/**
 * Blocco di totali "🔹 Chiave: valore", una metrica per riga (es. statistiche
 * aggregate di Search Console): diventa una tabella di una riga.
 */
function totalsBlocks(lines: string[]): ParsedTable[] {
  const out: ParsedTable[] = [];
  let block: { key: string; value: string; line: number }[] = [];
  const flush = () => {
    if (block.length >= 3) {
      const { columns, rows } = inferColumns(
        block.map((b) => b.key),
        [block.map((b) => b.value)],
      );
      if (columns.every((c) => c.type === 'metric')) out.push({ label: nearestTitle(lines, block[0].line) || 'totali', columns, rows, totalRows: 1 });
    }
    block = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*[^\p{L}\p{N}\s]*\s*([\p{L}][\p{L}\s.]{1,38}?)\s*:\s*([-+]?[\d.,]+\s*%?)\s*(\([^)]*\))?\s*$/u);
    if (m && !lines[i].includes('|')) block.push({ key: m[1].trim(), value: m[2].trim(), line: i });
    else if (lines[i].trim() || block.length >= 3) flush();
  }
  flush();
  return out;
}

/** Tutte le tabelle riconoscibili nel testo di una risposta MCP. */
export function extractTables(text: string): ParsedTable[] {
  const out: ParsedTable[] = [];
  for (const j of jsonCandidates(text)) walkJson(j, '', out);
  if (out.length) return out.slice(0, MAX_TABLES);
  const lines = text.split(/\r?\n/);
  const { tables, used } = pipeTables(lines);
  // Prima le tabelle vere, poi gli elenchi, infine i blocchi di totali.
  return [...tables, ...kvTables(lines, used), ...totalsBlocks(lines)].slice(0, MAX_TABLES);
}

/** Anteprima compatta di una tabella per il modello. */
export function previewTable(id: string, t: ParsedTable, maxRows = 12): string {
  const cols = t.columns.map((c) => `${c.key}(${c.type}${c.format ? `, ${c.format}` : ''})`).join(', ');
  const head = t.rows.slice(0, maxRows).map((r) => t.columns.map((c) => r[c.key] ?? '').join(' | '));
  return [
    `Tabella ${id}: "${t.label}", ${t.rows.length} righe${t.totalRows > t.rows.length ? ` (di ${t.totalRows})` : ''}.`,
    `Colonne: ${cols}`,
    t.columns.map((c) => c.key).join(' | '),
    ...head,
    ...(t.rows.length > maxRows ? [`[... altre ${t.rows.length - maxRows} righe nella tabella ${id}]`] : []),
  ].join('\n');
}
