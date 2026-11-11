import { describe, expect, it, vi } from 'vitest';
import type { Conversation, Dataset, RunState, StreamEvent } from '../../../../src/shared/types';
import { AgentRunner } from '../agent';
import { toAnthropicTools, type LlmAdapter, type StepOptions, type ToolDef, type ToolResult, type Turn } from '../llm';
import { McpGateway } from '../mcp-gateway';
import type { McpToolDef } from '../mcp-client';
import type { AppSession } from '../session';
import { TenantStore } from '../tenant-store';
import { GADS_TOOLS, META_TOOLS, MemoryBlobStore, scopeA } from './fixtures';

/** Ciclo completo con Claude simulato (adattatore a copione) e server MCP simulati. */

type Script = (ctx: { results: ToolResult[][]; tools: ToolDef[]; opts?: StepOptions }) => Turn;

function scriptedAdapter(script: Script[]) {
  const results: ToolResult[][] = [];
  const toolsSeen: ToolDef[][] = [];
  const adapter: LlmAdapter = {
    addUser: () => undefined,
    addToolResults: (_t, r) => void results.push(r),
    async step(_t, _system, tools, opts) {
      toolsSeen.push(tools);
      const next = script.shift();
      if (!next) return { text: 'Fine.', calls: [], stop: 'end' };
      return next({ results, tools, opts });
    },
  };
  return { adapter, results, toolsSeen };
}

const META_JSON = JSON.stringify({
  campaigns: [
    { campaign_id: '120200000000000001', campaign_name: 'Prospecting', spend: '1.234,50', roas: 3.9 },
    { campaign_id: '120200000000000002', campaign_name: 'Retargeting', spend: 800, roas: 5.1 },
  ],
});

function setup(tools: McpToolDef[] = META_TOOLS, mcpText: (args: Record<string, unknown>) => string = () => META_JSON) {
  const store = new MemoryBlobStore();
  const session: AppSession = { v: 1, uid: 'u', uname: 'Mario', role: 'specialist', cid: 'cliente-a', cname: 'Cliente A', scope: scopeA(), keys: { anthropic: 'sk-test' }, models: {}, exp: 0 };
  const ts = new TenantStore(store, session);
  const mcpCall = vi.fn(async (_s: unknown, _n: string, args: Record<string, unknown>) => mcpText(args));
  const gateway = new McpGateway(ts, store, session.scope!, {
    call: mcpCall,
    server: (p) => (p === 'meta_ads' || p === 'google_ads' ? { url: 'https://x.invalid/mcp' } : null),
    tools: async (p) => (p === 'meta_ads' ? tools : p === 'google_ads' ? GADS_TOOLS : []),
  });
  const run: RunState = { id: 'run1', conversationId: 'conv1', status: 'running', events: [], provider: 'anthropic', startedAt: '' };
  const conversation: Conversation = { id: 'conv1', title: 't', createdAt: '', updatedAt: '', createdBy: 'Mario', messageCount: 1, messages: [{ id: 'm1', role: 'user', text: 'Spesa Meta?', at: '' }] };
  return { store, session, ts, mcpCall, gateway, run, conversation };
}

describe('assistente', () => {
  it('estrae la tabella, la salva con table_id senza ricopiare le righe, crea il grafico e rifiuta un account esterno', async () => {
    const env = setup();
    const events: StreamEvent[] = [];
    const { adapter, results, toolsSeen } = scriptedAdapter([
      () => ({
        text: '',
        stop: 'tool',
        calls: [
          { id: 'c0', name: 'meta__get_account_overview', args: { ad_account_id: 'act_99999999' } },
          { id: 'c1', name: 'meta__get_account_overview', args: { date_preset: 'last_month' } },
        ],
      }),
      // Salvataggio e grafico nello stesso passaggio, sulla tabella t1.
      () => ({
        text: '',
        stop: 'tool',
        calls: [
          { id: 'c2', name: 'save_dataset', args: { table_id: 't1', title: 'Meta, spesa per campagna', description: 'Mese scorso', columns: [{ key: 'campaign_name', label: 'Campagna' }, { key: 'spend' }] } },
          { id: 'c3', name: 'create_visualization', args: { table_id: 't1', title: 'Spesa per campagna', type: 'bar', x: 'campaign_name', metrics: ['spend'] } },
        ],
      }),
      ({ opts }) => {
        opts?.onText?.('Prospecting ');
        opts?.onText?.('assorbe la quota maggiore.');
        return { text: 'Prospecting assorbe la quota maggiore.', calls: [], stop: 'end' };
      },
    ]);

    const runner = new AgentRunner({ ...env, userText: 'Spesa Meta?', refresh: false, deadline: Date.now() + 60000, persistRun: async () => undefined, adapter, emit: (e) => events.push(e) });
    const msg = await runner.run('anthropic');

    // Lo strumento che elenca tutti gli account non viene mai offerto all'AI.
    const names = toolsSeen[0].map((t) => t.name);
    expect(names).not.toContain('meta__list_ad_accounts');
    expect(names).toContain('meta__get_account_overview');

    // Una sola chiamata MCP, con l'account del cliente imposto dal guard; l'altra bloccata.
    expect(env.mcpCall).toHaveBeenCalledTimes(1);
    expect(env.mcpCall.mock.calls[0][2]).toMatchObject({ ad_account_id: 'act_36311415' });
    expect(env.run.events.some((e) => e.kind === 'blocked')).toBe(true);

    // Il modello riceve l'anteprima della tabella, non deve ricopiarla.
    expect(results[0][1].content).toContain('Tabella t1');
    expect(results[0][1].content).toContain('campaign_name');

    // Dataset con le righe copiate dal server, colonne scelte e rinominate.
    const datasetId = msg.datasetIds![0];
    const ds = await env.ts.get<Dataset>('dataset', datasetId);
    expect(ds?.accounts).toEqual(['meta_ads:36311415']);
    expect(ds?.sourceTable).toBe('campaigns');
    expect(ds?.columns.map((c) => [c.key, c.label])).toEqual([
      ['campaign_name', 'Campagna'],
      ['spend', 'spend'],
    ]);
    expect(ds?.rows).toEqual([
      { campaign_name: 'Prospecting', spend: 1234.5 },
      { campaign_name: 'Retargeting', spend: 800 },
    ]);
    // Un solo dataset anche se save_dataset e create_visualization usano la stessa tabella.
    expect(msg.datasetIds).toHaveLength(1);
    expect(msg.vizs?.[0]).toMatchObject({ type: 'bar', datasetId, x: 'campaign_name', metrics: ['spend'] });

    // Streaming: passaggi, grafico e testo arrivano in tempo reale.
    expect(events.some((e) => e.type === 'viz')).toBe(true);
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')).toBe('Prospecting assorbe la quota maggiore.');
    expect(events.filter((e) => e.type === 'turn')).toHaveLength(3);
    expect(msg.text).toContain('Prospecting');

    // Nessun dato del cliente A nello spazio di un altro cliente.
    expect([...env.store.data.keys()].filter((k) => k.startsWith('t/cliente-b/'))).toEqual([]);
  });

  it('esegue in parallelo le chiamate MCP dello stesso passaggio', async () => {
    let active = 0;
    let peak = 0;
    const env = setup(META_TOOLS, () => META_JSON);
    env.mcpCall.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return META_JSON;
    });
    const { adapter } = scriptedAdapter([
      () => ({
        text: '',
        stop: 'tool',
        calls: [
          { id: 'a', name: 'meta__get_account_overview', args: { date_preset: 'last_7d' } },
          { id: 'b', name: 'gads__run_gaql', args: { query: 'SELECT campaign.name FROM campaign' } },
        ],
      }),
    ]);
    await new AgentRunner({ ...env, userText: 'x', refresh: false, deadline: Date.now() + 60000, persistRun: async () => undefined, adapter }).run('anthropic');
    expect(env.mcpCall).toHaveBeenCalledTimes(2);
    expect(peak).toBe(2);
  });

  it('salva piccoli dati derivati con rows e rifiuta dataset senza fonte', async () => {
    const env = setup();
    const { adapter, results } = scriptedAdapter([
      () => ({ text: '', stop: 'tool', calls: [{ id: 'x', name: 'save_dataset', args: { title: 'Inventato', description: 'd', columns: [{ key: 'a', label: 'A', type: 'metric' }], rows: [[1]] } }] }),
      () => ({ text: '', stop: 'tool', calls: [{ id: 'y', name: 'meta__get_account_overview', args: {} }] }),
      () => ({
        text: '',
        stop: 'tool',
        calls: [
          {
            id: 'z',
            name: 'save_dataset',
            args: { title: 'Totali', description: 'd', columns: [{ key: 'campagna', label: 'Campagna', type: 'dimension' }, { key: 'spesa', label: 'Spesa', type: 'metric', format: 'currency' }], rows: [['Tutte', '2.034,50']] },
          },
        ],
      }),
    ]);
    const msg = await new AgentRunner({ ...env, userText: 'x', refresh: false, deadline: Date.now() + 60000, persistRun: async () => undefined, adapter }).run('anthropic');
    expect(results[0][0]).toMatchObject({ isError: true });
    const ds = await env.ts.get<Dataset>('dataset', msg.datasetIds![0]);
    expect(ds?.rows).toEqual([{ campagna: 'Tutte', spesa: 2034.5 }]);
  });

  it('si ferma quando la risposta viene interrotta', async () => {
    const env = setup();
    const ctrl = new AbortController();
    const { adapter } = scriptedAdapter([
      () => {
        ctrl.abort();
        return { text: '', stop: 'tool', calls: [{ id: 'a', name: 'meta__get_account_overview', args: {} }] };
      },
      () => ({ text: 'non deve arrivare', calls: [], stop: 'end' }),
    ]);
    const msg = await new AgentRunner({ ...env, userText: 'x', refresh: false, deadline: Date.now() + 60000, persistRun: async () => undefined, adapter, signal: ctrl.signal }).run('anthropic');
    expect(msg.text).toBe('Risposta interrotta.');
    // La trascrizione a metà non viene riusata nella domanda successiva.
    expect(await env.ts.get('transcript', 'conv1')).toBeNull();
  });

  it('con molti strumenti MCP li carica su richiesta (ricerca strumenti)', async () => {
    const many: McpToolDef[] = Array.from({ length: 15 }, (_, i) => ({
      name: `report_${i}`,
      description: 'Report',
      inputSchema: { type: 'object', properties: { ad_account_id: { type: 'string' } } },
    }));
    const env = setup(many);
    const { adapter, toolsSeen } = scriptedAdapter([]);
    await new AgentRunner({ ...env, userText: 'x', refresh: false, deadline: Date.now() + 60000, persistRun: async () => undefined, adapter }).run('anthropic');
    const mcp = toolsSeen[0].filter((t) => t.name.startsWith('meta__'));
    expect(mcp).toHaveLength(15);
    expect(mcp.every((t) => t.deferred)).toBe(true);
    expect(toolsSeen[0].find((t) => t.name === 'save_dataset')?.deferred).toBeUndefined();

    const api = toAnthropicTools(toolsSeen[0]);
    expect(api.at(-1)).toEqual({ type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' });
    expect(api.find((t) => 'name' in t && t.name === 'meta__report_0')).toMatchObject({ defer_loading: true });
  });
});
