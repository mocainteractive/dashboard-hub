import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, Dataset, RunState } from '../../../../src/shared/types';
import { AgentRunner } from '../agent';
import { McpGateway } from '../mcp-gateway';
import type { AppSession } from '../session';
import { TenantStore } from '../tenant-store';
import { META_TOOLS, MemoryBlobStore, scopeA } from './fixtures';

/** Ciclo completo con AI (OpenAI simulato) e server MCP simulato. */

function openaiReply(message: Record<string, unknown>, finish = 'tool_calls') {
  return new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { role: 'assistant', content: null, ...message } }] }), { status: 200 });
}
const call = (id: string, name: string, args: Record<string, unknown>) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

afterEach(() => vi.unstubAllGlobals());

describe('assistente', () => {
  it('legge solo il proprio account, salva il dataset, crea il grafico e rifiuta un account esterno', async () => {
    const replies = [
      openaiReply({ tool_calls: [call('c0', 'meta__get_account_overview', { ad_account_id: 'act_99999999' }), call('c1', 'meta__get_account_overview', { date_preset: 'last_month' })] }),
      openaiReply({
        tool_calls: [
          call('c2', 'save_dataset', {
            title: 'Meta, spesa per campagna',
            description: 'Mese scorso',
            columns: [
              { key: 'campaign', label: 'Campagna', type: 'dimension' },
              { key: 'spend', label: 'Spesa', type: 'metric', format: 'currency' },
            ],
            rows: [
              ['Prospecting', '1.234,50'],
              ['Retargeting', 800],
            ],
          }),
        ],
      }),
      null, // il grafico usa l'id del dataset appena salvato
      openaiReply({ content: 'Prospecting assorbe la quota maggiore della spesa.' }, 'stop'),
    ];
    const sent: unknown[] = [];
    let datasetId = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)));
        const r = replies.shift();
        if (r) return r;
        return openaiReply({ tool_calls: [call('c3', 'create_visualization', { title: 'Spesa per campagna', type: 'bar', dataset_id: datasetId, x: 'campaign', metrics: ['spend'] })] });
      }),
    );

    const store = new MemoryBlobStore();
    const session: AppSession = { v: 1, uid: 'u', uname: 'Mario', role: 'specialist', cid: 'cliente-a', cname: 'Cliente A', scope: scopeA(), keys: { openai: 'sk-test' }, models: {}, exp: 0 };
    const ts = new TenantStore(store, session);
    const mcpCall = vi.fn(async (_s: unknown, _n: string, args: Record<string, unknown>) => `Spesa account ${String(args.ad_account_id)}: Prospecting 1234,50`);
    const gateway = new McpGateway(ts, store, session.scope!, { call: mcpCall, server: (p) => (p === 'meta_ads' ? { url: 'https://x.invalid/mcp' } : null), tools: async () => META_TOOLS });
    const run: RunState = { id: 'run1', conversationId: 'conv1', status: 'running', events: [], provider: 'openai', startedAt: '' };
    const conversation: Conversation = { id: 'conv1', title: 't', createdAt: '', updatedAt: '', createdBy: 'Mario', messageCount: 1, messages: [{ id: 'm1', role: 'user', text: 'Spesa Meta?', at: '' }] };

    const runner = new AgentRunner({ session, ts, gateway, run, conversation, userText: 'Spesa Meta?', refresh: false, deadline: Date.now() + 60000, persistRun: async () => undefined });
    const origSet = ts.set.bind(ts);
    ts.set = async (kind, id, value) => {
      if (kind === 'dataset') datasetId = id;
      return origSet(kind, id, value);
    };
    const msg = await runner.run('openai');

    // Lo strumento che elenca tutti gli account non viene mai offerto all'AI.
    const toolNames = (sent[0] as { tools: { function: { name: string } }[] }).tools.map((t) => t.function.name);
    expect(toolNames).not.toContain('meta__list_ad_accounts');
    expect(toolNames).toContain('meta__get_account_overview');

    // Una sola chiamata MCP, con l'account del cliente imposto dal guard.
    expect(mcpCall).toHaveBeenCalledTimes(1);
    expect(mcpCall.mock.calls[0][2]).toMatchObject({ ad_account_id: 'act_36311415' });
    expect(run.events.some((e) => e.kind === 'blocked')).toBe(true);

    const ds = await ts.get<Dataset>('dataset', datasetId);
    expect(ds?.accounts).toEqual(['meta_ads:36311415']);
    expect(ds?.rows).toEqual([
      { campaign: 'Prospecting', spend: 1234.5 },
      { campaign: 'Retargeting', spend: 800 },
    ]);
    expect(msg.text).toContain('Prospecting');
    expect(msg.vizs?.[0]).toMatchObject({ type: 'bar', datasetId, x: 'campaign', metrics: ['spend'] });

    // Nessun dato del cliente A nello spazio di un altro cliente.
    const keysB = [...store.data.keys()].filter((k) => k.startsWith('t/cliente-b/'));
    expect(keysB).toEqual([]);
  });
});
