import { describe, expect, it } from 'vitest';
import { extractTables, previewTable, toIsoDate, toKey } from '../tabular';

/** Risposte reali dei server MCP Moca (valori abbreviati). */

const GA4 = `[Cliente - Sito]

📊 Report Personalizzato - Proprietà 338073799
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Periodo: 2026-11-01 → 2026-11-03
Metriche: sessions, totalUsers

📈 TOTALI (server-side, dataset completo — 13 righe complessive)
  sessions: 445
  totalUsers: 360 (valore unico/medio dedup. dal server)
⚠️ TRONCATO: mostrate 4 di 13 righe.

Righe (4 di 13, ordinate per sessions desc):
date | sessionDefaultChannelGroup | sessions | totalUsers
─────────────────────────────────────────────────────────
20261103 | Organic Social | 160 | 144
20261103 | Organic Search | 86 | 73
20261102 | Direct | 41 | 30
20261101 | Organic Search | 6 | 6
`;

const GSC = `📅 Andamento giornaliero per sc-domain:clientea.it (2026-11-01 - 2026-11-03):

2026-11-01 — Clic: 8 | Impr: 923 | CTR: 0.87% | Pos: 16.3
2026-11-02 — Clic: 46 | Impr: 1,503 | CTR: 3.06% | Pos: 12.5
2026-11-03 — Clic: 68 | Impr: 1,844 | CTR: 3.69% | Pos: 11.9

📌 Totale periodo — Clic: 122 | Impressioni: 4,270
🗓️ Ultima data con dati disponibili: 2026-11-03`;

const META = JSON.stringify({
  account: { id: 'act_36311415', name: 'Cliente A' },
  kpi: { spend: '1234.50', impressions: '98000', clicks: '1520', ctr: '1.55', roas: '3.2' },
  campaigns: [
    { campaign_id: '120200000000000001', campaign_name: 'Prospecting', spend: '900.10', purchases: 12, roas: 3.9 },
    { campaign_id: '120200000000000002', campaign_name: 'Retargeting', spend: '334.40', purchases: 9, roas: 5.1 },
  ],
});

const GSC_QUERIES = `📊 Top 3 query di ricerca per https://www.clientea.it/ (2026-11-01 - 2026-11-07):

1. "clientea"
   Clic: 262 | Impressioni: 688 | CTR: 38.08% | Posizione: 1.1

2. "mutuo consap"
   Clic: 36 | Impressioni: 9,937 | CTR: 0.36% | Posizione: 6.7

3. "intranet clientea"
   Clic: 116 | Impressioni: 149 | CTR: 77.85% | Posizione: 1.0


📌 Totale dalle 3 query visibili:
   Clic: 414 | Impressioni: 10,774

📍 Include fresh data (dati aggiornati di recente).`;

const GSC_STATS = `📊 Statistiche REALI aggregate per https://www.clientea.it/ (2026-11-01 - 2026-11-07):

🔹 Clic totali: 2,180
🔹 Impressioni totali: 142,477
🔹 CTR medio: 1.53%
🔹 Posizione media: 7.1

✅ Questi sono i dati EFFETTIVI che vedi in Google Search Console.`;

const GADS = `resourceName|name|clicks|conversionsValue|conversions|costMicros|impressions
customers/2504833999/campaigns/14292989695|IT-ita-SE-B-BRAND|9457|36200.838088666|87.543935|1658.94|24368
customers/2504833999/campaigns/19026134532|IT-ita-PMax-CONVERSION|7713|11824.249114348|14.817147|1603.82|428965`;

const META_INSIGHTS = JSON.stringify({
  oggetto: 'act_1',
  livello: 'account',
  righe_totali: 2,
  dati: [
    { spend: 10.5, impressions: 1000, clicks: 20, date_start: '2026-10-01', date_stop: '2026-10-01' },
    { spend: 12, impressions: 1200, clicks: 25, date_start: '2026-10-02', date_stop: '2026-10-02' },
  ],
  righe_mostrate: 2,
  totali: { spend: 22.5, impressions: 2200, clicks: 45 },
});

describe('formati reali dei server Moca', () => {
  it('Search Console, elenco numerato: etichetta sulla riga sopra, totale escluso', () => {
    const tables = extractTables(GSC_QUERIES);
    expect(tables).toHaveLength(1);
    const [t] = tables;
    expect(t.columns.map((c) => c.key)).toEqual(['query', 'clic', 'impressioni', 'ctr', 'posizione']);
    expect(t.rows[1]).toEqual({ query: 'mutuo consap', clic: 36, impressioni: 9937, ctr: 0.36, posizione: 6.7 });
    expect(t.rows).toHaveLength(3);
  });

  it('Search Console, statistiche aggregate: una riga di totali', () => {
    const [t] = extractTables(GSC_STATS);
    expect(t.rows).toEqual([{ clic_totali: 2180, impressioni_totali: 142477, ctr_medio: 1.53, posizione_media: 7.1 }]);
    expect(t.columns.find((c) => c.key === 'ctr_medio')?.format).toBe('percent');
  });

  it('Google Ads, GAQL senza separatore', () => {
    const [t] = extractTables(GADS);
    expect(t.rows[0]).toMatchObject({ name: 'IT-ita-SE-B-BRAND', clicks: 9457, cost_micros: 1658.94 });
    expect(t.columns.find((c) => c.key === 'cost_micros')?.format).toBe('currency');
    expect(t.columns.find((c) => c.key === 'resource_name')?.type).toBe('dimension');
  });

  it('Meta, insights giornalieri: righe con data e riepilogo', () => {
    const tables = extractTables(META_INSIGHTS);
    expect(tables[0].label).toBe('dati');
    expect(tables[0].columns.find((c) => c.key === 'date_start')?.type).toBe('date');
    expect(tables.find((t) => t.label.startsWith('totali'))?.rows[0]).toMatchObject({ spend: 22.5 });
  });
});

describe('tabelle dalle risposte MCP', () => {
  it('GA4: tabella con separatore, date AAAAMMGG, metriche numeriche', () => {
    const [t] = extractTables(GA4);
    expect(t.columns.map((c) => [c.key, c.type])).toEqual([
      ['date', 'date'],
      ['session_default_channel_group', 'dimension'],
      ['sessions', 'metric'],
      ['total_users', 'metric'],
    ]);
    expect(t.rows[0]).toEqual({ date: '2026-11-03', session_default_channel_group: 'Organic Social', sessions: 160, total_users: 144 });
    expect(t.rows).toHaveLength(4);
    expect(t.label).toContain('Righe');
  });

  it('Search Console: righe chiave-valore, migliaia e percentuali', () => {
    const tables = extractTables(GSC);
    expect(tables).toHaveLength(1); // la riga dei totali non diventa una tabella
    const [t] = tables;
    expect(t.columns.map((c) => c.key)).toEqual(['date', 'clic', 'impr', 'ctr', 'pos']);
    expect(t.rows[1]).toEqual({ date: '2026-11-02', clic: 46, impr: 1503, ctr: 3.06, pos: 12.5 });
    expect(t.columns.find((c) => c.key === 'ctr')).toMatchObject({ format: 'percent', agg: 'avg' });
    expect(t.columns.find((c) => c.key === 'pos')).toMatchObject({ agg: 'avg' });
  });

  it('Meta: JSON con riepilogo KPI e campagne, ID lunghi restano testo', () => {
    const tables = extractTables(META);
    const kpi = tables.find((t) => t.label.startsWith('kpi'))!;
    expect(kpi.rows[0]).toMatchObject({ spend: 1234.5, clicks: 1520 });
    const camp = tables.find((t) => t.label === 'campaigns')!;
    expect(camp.columns.find((c) => c.key === 'campaign_id')?.type).toBe('dimension');
    expect(camp.columns.find((c) => c.key === 'spend')).toMatchObject({ type: 'metric', format: 'currency', agg: 'sum' });
    expect(camp.columns.find((c) => c.key === 'roas')?.agg).toBe('avg');
    expect(camp.rows[1]).toMatchObject({ campaign_name: 'Retargeting', spend: 334.4, purchases: 9 });
  });

  it('testo senza tabelle: nessun risultato', () => {
    expect(extractTables('Nessun dato per il periodo richiesto.')).toEqual([]);
    expect(extractTables('{"error":"account non trovato"}')).toEqual([]);
  });

  it('anteprima compatta e utilità', () => {
    const [t] = extractTables(GSC);
    const p = previewTable('t1', t, 2);
    expect(p).toContain('Tabella t1');
    expect(p).toContain('[... altre 1 righe');
    expect(toKey('sessionDefaultChannelGroup')).toBe('session_default_channel_group');
    expect(toKey('CTR %')).toBe('ctr_pct');
    expect(toIsoDate('20261340')).toBeNull();
    expect(toIsoDate('2026-11-03T10:00:00Z')).toBe('2026-11-03');
  });
});
