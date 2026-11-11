import { describe, expect, it } from 'vitest';
import { chartData, compileExpr, joinTables, normalizePath, parseNumber, runQuery, toCsv, type Table } from '../engine';
import { inScope, parseScope, ScopeError } from '../scope';
import { CLIENT_A_JSON } from '../../../netlify/functions/utils/__tests__/fixtures';

describe('perimetro dal JSON del data lake', () => {
  it('legge gli account di tutte le sorgenti in forma canonica', () => {
    const s = parseScope(CLIENT_A_JSON);
    expect(s.slug).toBe('cliente_a');
    expect(s.accounts.map((a) => `${a.platform}:${a.id}`)).toEqual([
      'ga4:338073799',
      'search_console:sc-domain:clientea.it',
      'google_ads:6669481939',
      'meta_ads:act_36311415',
      'tiktok_ads:7012345678901234567',
    ]);
  });

  it('rifiuta configurazioni mancanti o malformate', () => {
    expect(() => parseScope('')).toThrow(ScopeError);
    expect(() => parseScope('{non json')).toThrow(ScopeError);
    expect(() => parseScope(JSON.stringify({ client_id: 'x_y', sources: {} }))).toThrow(ScopeError);
    expect(() => parseScope(JSON.stringify({ client_id: 'x_y', sources: { ga4: [{ property_id: 'G-ABC' }] } }))).toThrow(ScopeError);
  });

  it('un dataset è visibile solo se tutti i suoi account sono nel perimetro', () => {
    const s = parseScope(CLIENT_A_JSON);
    expect(inScope(s, ['meta_ads:36311415', 'ga4:338073799'])).toBe(true);
    expect(inScope(s, ['meta_ads:36311415', 'ga4:111111111'])).toBe(false);
  });
});

const sessions: Table = {
  columns: [
    { key: 'date', label: 'Data', type: 'date' },
    { key: 'channel', label: 'Canale', type: 'dimension' },
    { key: 'sessions', label: 'Sessioni', type: 'metric', format: 'number' },
    { key: 'cr', label: 'Tasso conv.', type: 'metric', format: 'percent', agg: 'avg' },
  ],
  rows: [
    { date: '2026-10-01', channel: 'Organic', sessions: 100, cr: 2 },
    { date: '2026-10-01', channel: 'Paid', sessions: 50, cr: 4 },
    { date: '2026-10-02', channel: 'Organic', sessions: 120, cr: 3 },
    { date: '2026-10-09', channel: 'Paid', sessions: 70, cr: 5 },
  ],
};

describe('motore dei dati', () => {
  it('aggrega per dimensione con l\'aggregazione naturale della metrica', () => {
    const t = runQuery(sessions, { groupBy: ['channel'], metrics: [{ key: 'sessions' }, { key: 'cr' }], sort: { key: 'sessions', dir: 'desc' } });
    expect(t.rows).toEqual([
      { channel: 'Organic', sessions: 220, cr: 2.5 },
      { channel: 'Paid', sessions: 120, cr: 4.5 },
    ]);
  });

  it('raggruppa le date per settimana e mese', () => {
    const w = runQuery(sessions, { groupBy: ['date'], metrics: [{ key: 'sessions' }], dateGrain: 'week' });
    expect(w.rows.map((r) => r.date)).toEqual(['2026-09-28', '2026-10-05']);
    const m = runQuery(sessions, { groupBy: ['date'], metrics: [{ key: 'sessions' }], dateGrain: 'month' });
    expect(m.rows).toEqual([{ date: '2026-10', sessions: 340 }]);
  });

  it('filtra e ignora le colonne inesistenti', () => {
    const t = runQuery(sessions, { filters: [{ column: 'channel', op: 'eq', value: 'Paid' }, { column: 'nope', op: 'eq', value: 1 }] });
    expect(t.rows).toHaveLength(2);
  });

  it('incrocia due dataset sulla data', () => {
    const spend: Table = {
      columns: [
        { key: 'date', label: 'Data', type: 'date' },
        { key: 'spend', label: 'Spesa', type: 'metric', format: 'currency' },
        { key: 'sessions', label: 'Sessioni', type: 'metric' },
      ],
      rows: [
        { date: '2026-10-01', spend: 30, sessions: 1 },
        { date: '2026-10-03', spend: 10, sessions: 2 },
      ],
    };
    const j = joinTables(sessions, spend, ['date'], { a: 'GA4', b: 'Meta' });
    expect(j.columns.map((c) => c.key)).toEqual(['date', 'sessions', 'cr', 'spend', 'b__sessions']);
    expect(j.rows.find((r) => r.date === '2026-10-01')).toMatchObject({ sessions: 150, spend: 30, b__sessions: 1 });
    expect(j.rows.find((r) => r.date === '2026-10-03')).toMatchObject({ spend: 10 });
    expect(() => joinTables(sessions, spend, ['channel'], { a: 'a', b: 'b' })).toThrow();
  });

  it('prepara le serie divise per dimensione', () => {
    const c = chartData(sessions, { id: 'v', title: 't', type: 'line', datasetId: 'd', x: 'date', metrics: ['sessions'], seriesBy: 'channel' });
    expect(c.series.map((s) => s.key)).toEqual(['Organic', 'Paid']);
    expect(c.rows[0]).toMatchObject({ date: '2026-10-01', Organic: 100, Paid: 50 });
  });

  it('legge numeri in formato italiano e internazionale', () => {
    expect(parseNumber('1.234,50')).toBe(1234.5);
    expect(parseNumber('1,234.50')).toBe(1234.5);
    expect(parseNumber('3,5%')).toBe(3.5);
    expect(parseNumber('€ 800')).toBe(800);
    expect(parseNumber('1.234.567')).toBe(1234567);
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('n.d.')).toBeNull();
  });

  it('esporta CSV con separatore italiano', () => {
    expect(toCsv({ columns: sessions.columns.slice(0, 2), rows: [{ date: '2026-10-01', channel: 'A;B' }] })).toBe('Data;Canale\n2026-10-01;"A;B"');
  });
});

describe('incroci tra fonti diverse', () => {
  const gsc: Table = {
    columns: [
      { key: 'query', label: 'Query', type: 'dimension' },
      { key: 'pagina', label: 'Pagina', type: 'dimension' },
      { key: 'clic', label: 'Clic', type: 'metric' },
    ],
    rows: [
      { query: 'mutuo consap', pagina: 'tipi-di-mutuo/mutuo-consap', clic: 30 },
      { query: 'consap requisiti', pagina: 'https://www.clientea.it/tipi-di-mutuo/mutuo-consap/', clic: 10 },
      { query: 'clientea', pagina: '/', clic: 200 },
      { query: 'pagina senza dati', pagina: 'nuova', clic: 5 },
    ],
  };
  const ga4: Table = {
    columns: [
      { key: 'landing_page', label: 'Landing page', type: 'dimension' },
      { key: 'sessions', label: 'Sessioni', type: 'metric' },
      { key: 'key_events', label: 'Eventi chiave', type: 'metric' },
    ],
    rows: [
      { landing_page: '/tipi-di-mutuo/mutuo-consap', sessions: 80, key_events: 8 },
      { landing_page: '/tipi-di-mutuo/mutuo-consap?utm_source=x', sessions: 20, key_events: 2 },
      { landing_page: '/', sessions: 400, key_events: 4 },
    ],
  };

  it('lookup su colonne con nomi diversi, con percorsi normalizzati', () => {
    const t = joinTables(gsc, ga4, [{ a: 'pagina', b: 'landing_page' }], { a: 'GSC', b: 'GA4' }, 'lookup');
    expect(t.rows).toHaveLength(4);
    expect(t.rows[0]).toMatchObject({ query: 'mutuo consap', clic: 30, sessions: 100, key_events: 10 });
    expect(t.rows[1]).toMatchObject({ query: 'consap requisiti', sessions: 100 });
    expect(t.rows[3]).toMatchObject({ query: 'pagina senza dati', sessions: null });
  });

  it('metrica calcolata: conversioni stimate per query', () => {
    const t = joinTables(gsc, ga4, [{ a: 'pagina', b: 'landing_page' }], { a: 'GSC', b: 'GA4' }, 'lookup');
    const r = runQuery(t, { computed: [{ key: 'conversioni_stimate', label: 'Conversioni stimate', expr: 'clic * key_events / sessions' }], sort: { key: 'conversioni_stimate', dir: 'desc' } });
    expect(r.rows.map((x) => [x.query, x.conversioni_stimate])).toEqual([
      ['mutuo consap', 3],
      ['clientea', 2],
      ['consap requisiti', 1],
      ['pagina senza dati', null],
    ]);
    expect(() => compileExpr('clic * foo', ['clic'])).toThrow(/foo/);
    expect(() => compileExpr('clic; alert(1)', ['clic'])).toThrow();
    expect(compileExpr('(a + b) / 0', ['a', 'b'])({ a: 1, b: 2 })).toBeNull();
  });

  it('merge su date con nomi diversi', () => {
    const a: Table = { columns: [{ key: 'date', label: 'Data', type: 'date' }, { key: 'sessions', label: 'Sessioni', type: 'metric' }], rows: [{ date: '2026-11-01', sessions: 10 }, { date: '2026-11-02', sessions: 20 }] };
    const b: Table = { columns: [{ key: 'date_start', label: 'Data', type: 'date' }, { key: 'spend', label: 'Spesa', type: 'metric' }], rows: [{ date_start: '2026-11-02', spend: 5 }] };
    const t = joinTables(a, b, [{ a: 'date', b: 'date_start' }], { a: 'GA4', b: 'Meta' });
    expect(t.rows).toEqual([
      { date: '2026-11-01', sessions: 10, spend: null },
      { date: '2026-11-02', sessions: 20, spend: 5 },
    ]);
    expect(normalizePath('HTTPS://www.x.it/Mutui/?a=1#b')).toBe('/mutui');
  });
});
