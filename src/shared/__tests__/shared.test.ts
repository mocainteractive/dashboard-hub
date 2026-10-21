import { describe, expect, it } from 'vitest';
import { chartData, joinTables, parseNumber, runQuery, toCsv, type Table } from '../engine';
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
