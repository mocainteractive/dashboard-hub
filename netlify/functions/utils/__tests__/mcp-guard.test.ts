import { describe, expect, it } from 'vitest';
import { authorizeCall, classifyTool, extractObjectIds, filterResponse, foreignAccounts, schemaForAi, REDACTED } from '../mcp-guard';
import { GADS_TOOLS, META_TOOLS, scopeA, scopeB } from './fixtures';

const meta = (name: string) => classifyTool('meta_ads', META_TOOLS.find((t) => t.name === name)!);
const gads = (name: string) => classifyTool('google_ads', GADS_TOOLS.find((t) => t.name === name)!);

describe('classificazione degli strumenti', () => {
  it('vieta gli strumenti che elencano gli account dell\'agenzia', () => {
    expect(meta('list_ad_accounts').allowed).toBe(false);
    expect(gads('list_customers').allowed).toBe(false);
  });

  it('vieta gli strumenti senza ancoraggio (fail-closed)', () => {
    expect(meta('mystery_tool').allowed).toBe(false);
  });

  it('ammette gli strumenti con parametro di account o ID oggetto obbligatorio', () => {
    expect(meta('get_account_overview')).toMatchObject({ allowed: true, scopeParam: 'ad_account_id' });
    expect(meta('get_campaign_insights')).toMatchObject({ allowed: true, objectParams: ['campaign_id'] });
    expect(meta('list_ads')).toMatchObject({ allowed: true, scopeParam: 'ad_account_id', objectParams: ['adset_id', 'campaign_id'] });
  });
});

describe('autorizzazione delle chiamate', () => {
  const none = new Set<string>();

  it('inietta SEMPRE l\'account del cliente quando manca (niente account di default del server)', () => {
    const r = authorizeCall(meta('get_account_overview'), { date_preset: 'last_30d' }, scopeA(), none);
    expect(r).toMatchObject({ ok: true, args: { ad_account_id: 'act_36311415', date_preset: 'last_30d' }, anchor: 'account' });
  });

  it('rifiuta l\'account di un altro cliente', () => {
    const r = authorizeCall(meta('get_account_overview'), { ad_account_id: 'act_99999999' }, scopeA(), none);
    expect(r.ok).toBe(false);
  });

  it('accetta scritture diverse dello stesso account e le riscrive in forma canonica', () => {
    const r = authorizeCall(meta('get_account_overview'), { ad_account_id: '36311415' }, scopeA(), none);
    expect(r).toMatchObject({ ok: true, args: { ad_account_id: 'act_36311415' } });
    const g = authorizeCall(gads('run_gaql'), { customer_id: '6669481939', query: 'SELECT campaign.name FROM campaign' }, scopeA(), none);
    expect(g).toMatchObject({ ok: true, args: { customer_id: '6669481939' } });
  });

  it('non si lascia ingannare da valori costruiti', () => {
    for (const v of ['act_36311415,act_99999999', 'act_3631141599999999', '', ' ', ['act_36311415']]) {
      const r = authorizeCall(meta('get_account_overview'), { ad_account_id: v }, scopeA(), none);
      if (r.ok) expect(r.args.ad_account_id).toBe('act_36311415');
    }
    expect(authorizeCall(meta('get_account_overview'), { ad_account_id: 'act_36311415,act_99999999' }, scopeA(), none).ok).toBe(false);
    expect(authorizeCall(meta('get_account_overview'), { ad_account_id: ['act_36311415'] }, scopeA(), none).ok).toBe(false);
  });

  it('con più account chiede di scegliere tra quelli del cliente', () => {
    const r = authorizeCall(meta('get_account_overview'), {}, scopeB(), none);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('act_99999999');
  });

  it('rifiuta parametri non dichiarati (es. un nome alternativo per l\'account)', () => {
    const r = authorizeCall(meta('get_account_overview'), { accountId: 'act_99999999' }, scopeA(), none);
    expect(r.ok).toBe(false);
  });

  it('rifiuta ID di account esterni nascosti nei testi liberi', () => {
    const r = authorizeCall(gads('run_gaql'), { query: 'SELECT metrics.clicks FROM customer WHERE customer.id = 1112223333' }, scopeA(), none);
    expect(r.ok).toBe(false);
    const r2 = authorizeCall(meta('get_account_overview'), { date_preset: 'act_99999999' }, scopeA(), none);
    expect(r2.ok).toBe(false);
  });

  it('ammette gli ID oggetto solo se già osservati per il cliente', () => {
    const p = meta('get_campaign_insights');
    expect(authorizeCall(p, { campaign_id: '120200000000001' }, scopeA(), none).ok).toBe(false);
    const r = authorizeCall(p, { campaign_id: '120200000000001' }, scopeA(), new Set(['120200000000001']));
    expect(r).toMatchObject({ ok: true, anchor: 'object' });
  });

  it('rifiuta una chiamata a oggetto senza oggetto', () => {
    expect(authorizeCall(meta('get_campaign_insights'), {}, scopeA(), none).ok).toBe(false);
  });

  it('rifiuta gli strumenti vietati anche se chiamati direttamente', () => {
    expect(authorizeCall(meta('list_ad_accounts'), {}, scopeA(), none).ok).toBe(false);
  });

  it('rifiuta se il cliente non ha account sulla piattaforma', () => {
    const r = authorizeCall(gads('run_gaql'), { query: 'SELECT 1' }, scopeB(), none);
    expect(r.ok).toBe(false);
  });

  it('rifiuta argomenti che non sono un oggetto', () => {
    expect(authorizeCall(meta('get_account_overview'), 'act_99999999', scopeA(), none).ok).toBe(false);
    expect(authorizeCall(meta('get_account_overview'), ['x'], scopeA(), none).ok).toBe(false);
  });
});

describe('filtro in uscita', () => {
  it('rimuove gli account esterni dalle risposte', () => {
    const r = filterResponse('Account act_36311415 e act_99999999, MCC 111-222-3333, cliente 666-948-1939', scopeA(), 'account');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toContain('act_36311415');
      expect(r.text).toContain('666-948-1939');
      expect(r.text).not.toContain('act_99999999');
      expect(r.text).not.toContain('111-222-3333');
      expect(r.text).toContain(REDACTED);
      expect(r.redacted).toBe(2);
    }
  });

  it('blocca per intero una risposta a oggetto che cita un account esterno', () => {
    const r = filterResponse('{"campaign":"X","account_id":"act_99999999"}', scopeA(), 'object');
    expect(r.ok).toBe(false);
  });

  it('riconosce gli account esterni', () => {
    expect(foreignAccounts('properties/295033115 e properties/338073799', scopeA())).toEqual(['properties/295033115']);
  });

  it('estrae gli ID oggetto dalle risposte', () => {
    const ids = extractObjectIds('{"id":"120200000000001","name":"Camp"} campaign_id: 120200000000002 (ID 120200000000003)');
    expect(ids).toEqual(expect.arrayContaining(['120200000000001', '120200000000002', '120200000000003']));
  });
});

describe('schema per l\'AI', () => {
  it('nasconde il parametro di account con un solo account', () => {
    const s = schemaForAi(meta('get_account_overview'), scopeA());
    expect(s.properties.ad_account_id).toBeUndefined();
  });
  it('limita il parametro agli account del cliente con più account', () => {
    const s = schemaForAi(meta('get_account_overview'), scopeB());
    expect(s.properties.ad_account_id).toMatchObject({ enum: ['act_99999999', 'act_88888888'] });
  });
});
