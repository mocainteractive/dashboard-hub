import { describe, expect, it, vi } from 'vitest';
import type { Dataset } from '../../../../src/shared/types';
import { McpGateway } from '../mcp-gateway';
import type { McpToolDef } from '../mcp-client';
import { argsForPeriod, datasetForPeriod, PeriodError, validPeriod } from '../period';
import { TenantStore } from '../tenant-store';
import { MemoryBlobStore, scopeA } from './fixtures';

const props = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, { type: 'string' }]));

describe('argomenti per il nuovo periodo', () => {
  it('GA4 e Search Console: coppie di date', () => {
    expect(argsForPeriod({ property_id: '1', start_date: '30daysAgo', end_date: 'yesterday' }, props('property_id', 'start_date', 'end_date'), '2026-10-01', '2026-10-31')).toEqual({
      property_id: '1',
      start_date: '2026-10-01',
      end_date: '2026-10-31',
    });
    expect(argsForPeriod({ siteUrl: 's' }, props('siteUrl', 'startDate', 'endDate'), '2026-10-01', '2026-10-31')).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-31' });
  });

  it('Meta: time_range al posto di date_preset', () => {
    expect(argsForPeriod({ ad_account_id: 'act_1', date_preset: 'last_30d' }, props('ad_account_id', 'date_preset', 'time_range'), '2026-10-01', '2026-10-31')).toEqual({
      ad_account_id: 'act_1',
      time_range: { since: '2026-10-01', until: '2026-10-31' },
    });
  });

  it('Google Ads: periodo dentro la query GAQL', () => {
    const q = 'SELECT campaign.name, metrics.cost_micros FROM campaign WHERE segments.date DURING LAST_30_DAYS';
    expect(argsForPeriod({ customer_id: '1', query: q }, props('customer_id', 'query'), '2026-10-01', '2026-10-31')?.query).toBe(
      "SELECT campaign.name, metrics.cost_micros FROM campaign WHERE segments.date BETWEEN '2026-10-01' AND '2026-10-31'",
    );
  });

  it('strumento senza periodo: non rileggibile', () => {
    expect(argsForPeriod({ ad_id: '1' }, props('ad_id'), '2026-10-01', '2026-10-31')).toBeNull();
    expect(argsForPeriod({ customer_id: '1', query: 'SELECT campaign.name FROM campaign' }, props('customer_id', 'query'), '2026-10-01', '2026-10-31')).toBeNull();
  });

  it('periodo valido', () => {
    expect(validPeriod('2026-10-01', '2026-10-31')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(() => validPeriod('2026-10-31', '2026-10-01')).toThrow(PeriodError);
    expect(() => validPeriod('ieri', '2026-10-01')).toThrow(PeriodError);
    expect(() => validPeriod('2020-01-01', '2026-10-01')).toThrow(PeriodError);
  });
});

const META_TOOLS: McpToolDef[] = [
  {
    name: 'get_campaign_breakdown',
    description: 'Campagne',
    inputSchema: { type: 'object', properties: { ad_account_id: { type: 'string' }, date_preset: { type: 'string' }, time_range: { type: 'object' } } },
  },
];

describe('rilettura di un dataset', () => {
  it('ripete la chiamata con il nuovo periodo, passando dal guard, e riestrae la stessa tabella', async () => {
    const store = new MemoryBlobStore();
    const ts = new TenantStore(store, { cid: 'cliente-a' });
    const call = vi.fn(async (_s: unknown, _n: string, args: Record<string, unknown>) =>
      JSON.stringify({ campaigns: [{ campaign_name: 'Prospecting', spend: args.time_range ? '500' : '900' }] }),
    );
    const gateway = new McpGateway(ts, store, scopeA(), { call, server: () => ({ url: 'https://x.invalid' }), tools: async () => META_TOOLS });
    const ds: Dataset = {
      id: 'd1',
      title: 'Spesa per campagna',
      description: '',
      platforms: ['meta_ads'],
      accounts: ['meta_ads:36311415'],
      columns: [
        { key: 'campaign_name', label: 'Campagna', type: 'dimension' },
        { key: 'spend', label: 'Spesa', type: 'metric', format: 'currency' },
      ],
      rows: [{ campaign_name: 'Prospecting', spend: 900 }],
      rowCount: 1,
      createdAt: '',
      createdBy: '',
      updatedAt: '',
      sourceTable: 'campaigns',
      sourceCalls: [{ platform: 'meta_ads', tool: 'get_campaign_breakdown', args: { ad_account_id: 'act_36311415', date_preset: 'last_30d' }, fetchedAt: '', fromCache: false }],
    };
    const data = await datasetForPeriod(gateway, ds, '2026-10-01', '2026-10-31');
    expect(call.mock.calls[0][2]).toEqual({ ad_account_id: 'act_36311415', time_range: { since: '2026-10-01', until: '2026-10-31' } });
    expect(data.rows).toEqual([{ campaign_name: 'Prospecting', spend: 500 }]);
    expect(data.columns[1].label).toBe('Spesa');

    // Seconda richiesta per lo stesso periodo: dalla cache, nessuna nuova chiamata.
    const again = await datasetForPeriod(new McpGateway(ts, store, scopeA(), { call, server: () => ({ url: 'https://x.invalid' }), tools: async () => META_TOOLS }), ds, '2026-10-01', '2026-10-31');
    expect(again.fromCache).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);

    // Dataset scritto dal modello: non rileggibile.
    await expect(datasetForPeriod(gateway, { ...ds, sourceTable: undefined }, '2026-10-01', '2026-10-31')).rejects.toThrow(PeriodError);
  });
});
