import { describe, expect, it, vi } from 'vitest';
import { handleData } from '../data-core';
import { cacheKey, McpGateway, ttlFor } from '../mcp-gateway';
import { openSession, sealSession, type AppSession } from '../session';
import { TenantStore } from '../tenant-store';
import { META_TOOLS, MemoryBlobStore, scopeA, scopeB } from './fixtures';

const SECRET = 'segreto-di-test-lungo-almeno-32-caratteri';

const sessionFor = (cid: string, scope = scopeA()): AppSession => ({
  v: 1,
  uid: 'u1',
  uname: 'Mario',
  role: 'specialist',
  cid,
  cname: cid,
  scope,
  keys: { anthropic: 'sk-test' },
  models: {},
  exp: Math.floor(Date.now() / 1000) + 3600,
});

describe('sessione cifrata', () => {
  const base = { uid: 'u1', uname: 'Mario', role: 'external', cid: 'aaaa-bbbb', cname: 'A', scope: scopeA(), keys: { anthropic: 'sk-segreta' }, models: {} };

  it('si apre solo con il segreto giusto e non contiene testo in chiaro', () => {
    const t = sealSession(base, SECRET);
    expect(t).not.toContain('sk-segreta');
    expect(Buffer.from(t.split('.')[2], 'base64url').toString()).not.toContain('sk-segreta');
    expect(openSession(t, SECRET)?.cid).toBe('aaaa-bbbb');
    expect(openSession(t, 'un-altro-segreto-lungo-abbastanza-1234')).toBeNull();
  });

  it('rifiuta un token manomesso', () => {
    const t = sealSession(base, SECRET);
    const [v, iv, ct] = t.split('.');
    const buf = Buffer.from(ct, 'base64url');
    buf[0] ^= 1;
    expect(openSession(`${v}.${iv}.${buf.toString('base64url')}`, SECRET)).toBeNull();
  });

  it('scade dopo 8 ore', () => {
    const t = sealSession(base, SECRET, Date.now() - 9 * 3600 * 1000);
    expect(openSession(t, SECRET)).toBeNull();
  });
});

describe('archivio per cliente', () => {
  it('i dati di un cliente non sono leggibili da un altro', async () => {
    const store = new MemoryBlobStore();
    const a = new TenantStore(store, { cid: 'cliente-a' });
    const b = new TenantStore(store, { cid: 'cliente-b' });
    await a.set('dashboard', 'd1', { segreto: 1 });
    expect(await b.get('dashboard', 'd1')).toBeNull();
    expect(await a.get('dashboard', 'd1')).toEqual({ segreto: 1 });
  });

  it('rifiuta identificativi che proverebbero a uscire dal proprio spazio', () => {
    const a = new TenantStore(new MemoryBlobStore(), { cid: 'cliente-a' });
    for (const id of ['../cliente-b/dashboard/d1', 'a/b', '', 'x'.repeat(200), '..']) expect(() => a.key('dashboard', id)).toThrow();
    expect(() => new TenantStore(new MemoryBlobStore(), { cid: '../x' })).toThrow();
  });

  it('l\'API dati ignora qualunque client_id nel body', async () => {
    const store = new MemoryBlobStore();
    const a = new TenantStore(store, { cid: 'cliente-a' });
    await a.set('dashboard', 'd1', { id: 'd1', title: 'Segreta' });
    const sB = sessionFor('cliente-b', scopeB());
    const res = await handleData({ action: 'dashboards.get', id: 'd1', client_id: 'cliente-a' } as never, sB, new TenantStore(store, sB), store);
    expect(res.status).toBe(404);
  });

  it('svuotare la cache tocca solo il cliente della sessione', async () => {
    const store = new MemoryBlobStore();
    const sA = sessionFor('cliente-a');
    const sB = sessionFor('cliente-b', scopeB());
    await new TenantStore(store, sA).set('mcp', 'k1', { text: 'a' });
    await new TenantStore(store, sB).set('mcp', 'k1', { text: 'b' });
    await handleData({ action: 'cache.clear' }, sA, new TenantStore(store, sA), store);
    expect(await new TenantStore(store, sA).get('mcp', 'k1')).toBeNull();
    expect(await new TenantStore(store, sB).get('mcp', 'k1')).toEqual({ text: 'b' });
  });

  it('i dataset con account fuori perimetro non sono visibili', async () => {
    const store = new MemoryBlobStore();
    const s = sessionFor('cliente-a');
    const ts = new TenantStore(store, s);
    await ts.set('index', 'dataset', [
      { id: 'ok1', accounts: ['meta_ads:36311415'] },
      { id: 'no1', accounts: ['meta_ads:99999999'] },
    ]);
    const res = await handleData({ action: 'datasets.list' }, s, ts, store);
    const body = await res.json();
    expect(body.datasets.map((d: { id: string }) => d.id)).toEqual(['ok1']);
  });
});

describe('gateway MCP: guard + cache del cliente', () => {
  const setup = () => {
    const store = new MemoryBlobStore();
    const call = vi.fn(async (_s: unknown, name: string, args: Record<string, unknown>) => `Risultato ${name} per ${String(args.ad_account_id)} campaign_id: 120200000000009 (altro: act_77777777)`);
    const deps = { call, server: () => ({ url: 'https://example.invalid/mcp' }), tools: async () => META_TOOLS, now: () => new Date('2026-10-21T10:00:00Z') };
    return { store, call, deps };
  };

  it('seconda richiesta uguale: nessuna nuova chiamata MCP', async () => {
    const { store, call, deps } = setup();
    const ts = new TenantStore(store, { cid: 'cliente-a' });
    const g1 = new McpGateway(ts, store, scopeA(), deps);
    const r1 = await g1.execute('meta_ads', 'get_account_overview', { date_preset: 'last_month' });
    expect(r1).toMatchObject({ ok: true, fromCache: false });
    const g2 = new McpGateway(ts, store, scopeA(), deps);
    const r2 = await g2.execute('meta_ads', 'get_account_overview', { date_preset: 'last_month' });
    expect(r2).toMatchObject({ ok: true, fromCache: true });
    expect(call).toHaveBeenCalledTimes(1);
    if (r2.ok) expect(r2.text).not.toContain('act_77777777');
  });

  it('la cache non è condivisa tra clienti', async () => {
    const { store, call, deps } = setup();
    await new McpGateway(new TenantStore(store, { cid: 'cliente-a' }), store, scopeA(), deps).execute('meta_ads', 'get_account_overview', {});
    const rB = await new McpGateway(new TenantStore(store, { cid: 'cliente-b' }), store, scopeB(), deps).execute('meta_ads', 'get_account_overview', { ad_account_id: 'act_36311415' });
    expect(rB.ok).toBe(false);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('registra gli ID oggetto visti e li ammette nelle chiamate successive', async () => {
    const { store, deps } = setup();
    const ts = new TenantStore(store, { cid: 'cliente-a' });
    const g = new McpGateway(ts, store, scopeA(), deps);
    expect((await g.execute('meta_ads', 'get_campaign_insights', { campaign_id: '120200000000009' })).ok).toBe(false);
    await g.execute('meta_ads', 'get_account_overview', {});
    const r = await g.execute('meta_ads', 'get_campaign_insights', { campaign_id: '120200000000009' });
    expect(r.ok).toBe(false); // la risposta cita act_77777777: bloccata per intero
    const other = new TenantStore(store, { cid: 'cliente-b' });
    expect(await other.get('observed', 'meta_ads')).toBeNull();
  });

  it('chiave di cache stabile rispetto all\'ordine degli argomenti', () => {
    expect(cacheKey('ga4', 't', { a: 1, b: { c: 2, d: 3 } })).toBe(cacheKey('ga4', 't', { b: { d: 3, c: 2 }, a: 1 }));
  });

  it('scadenza in base al periodo', () => {
    const now = new Date('2026-10-21T10:00:00Z');
    const H = 3600_000;
    expect(ttlFor({ date_preset: 'last_30d' }, now)).toBe(H);
    expect(ttlFor({ time_range: { since: '2026-10-01', until: '2026-10-21' } }, now)).toBe(H);
    expect(ttlFor({ time_range: { since: '2026-10-01', until: '2026-10-19' } }, now)).toBe(6 * H);
    expect(ttlFor({ start_date: '2026-01-01', end_date: '2026-06-30' }, now)).toBe(30 * 24 * H);
  });
});
