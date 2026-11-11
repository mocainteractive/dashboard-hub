import { getStore } from '@netlify/blobs';
import type { Conversation, RunState } from '../../src/shared/types';
import { parseTier, runTurn } from './utils/chat-core';
import { stopKey } from './utils/data-core';
import { sessionSecret } from './utils/http';
import { McpGateway } from './utils/mcp-gateway';
import { bearer, checkInternal, openSession } from './utils/session';
import { TenantStore, validId, type BlobStore } from './utils/tenant-store';

/**
 * Esecuzione dell'assistente (background function, fino a 15 minuti).
 * Accetta solo chiamate interne da chat-start, con la sessione cifrata
 * dell'utente: cliente, perimetro e chiavi arrivano da lì.
 */

const TIME_BUDGET_MS = 12 * 60 * 1000;

export default async (req: Request): Promise<Response> => {
  const secret = sessionSecret();
  if (req.method !== 'POST' || !secret || !checkInternal(req.headers.get('x-moca-internal'), secret)) {
    return new Response(null, { status: 403 });
  }
  const session = openSession(bearer(req), secret);
  if (!session?.scope) return new Response(null, { status: 401 });

  let body: { run_id?: unknown; refresh?: unknown; tier?: unknown };
  try {
    body = JSON.parse((await req.text()) || '{}');
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!validId(body.run_id)) return new Response(null, { status: 400 });

  const store = getStore({ name: 'dashboard-hub', consistency: 'strong' }) as unknown as BlobStore;
  const ts = new TenantStore(store, session);
  const run = await ts.get<RunState>('run', body.run_id);
  if (!run || run.status !== 'queued') return new Response(null, { status: 409 });
  const conversation = await ts.get<Conversation>('conversation', run.conversationId);
  if (!conversation) return new Response(null, { status: 404 });

  await runTurn({
    session,
    ts,
    gateway: new McpGateway(ts, store, session.scope),
    run,
    conversation,
    refresh: body.refresh === true,
    timeBudgetMs: TIME_BUDGET_MS,
    persistRun: (r) => ts.set('run', r.id, r),
    isCancelled: async () => !!(await ts.get('run', stopKey(run.id))),
    tier: parseTier(body.tier),
  });
  return new Response(null, { status: 202 });
};
