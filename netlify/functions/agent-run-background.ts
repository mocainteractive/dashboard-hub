import { getStore } from '@netlify/blobs';
import type { ChatMessage, Conversation, RunState } from '../../src/shared/types';
import { AgentRunner, conversationMeta } from './utils/agent';
import { sessionSecret } from './utils/http';
import { LlmError } from './utils/llm';
import { McpGateway } from './utils/mcp-gateway';
import { bearer, checkInternal, openSession } from './utils/session';
import { newId, TenantStore, upsertIndex, validId, type BlobStore } from './utils/tenant-store';

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

  let body: { run_id?: unknown; refresh?: unknown };
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
  const userText = [...conversation.messages].reverse().find((m) => m.role === 'user')?.text ?? '';

  run.status = 'running';
  await ts.set('run', run.id, run);
  const persistRun = (r: RunState) => ts.set('run', r.id, r);

  let message: ChatMessage;
  try {
    const runner = new AgentRunner({
      session,
      ts,
      gateway: new McpGateway(ts, store, session.scope),
      run,
      conversation,
      userText,
      refresh: body.refresh === true,
      deadline: Date.now() + TIME_BUDGET_MS,
      persistRun,
    });
    message = await runner.run(run.provider);
    run.status = 'done';
  } catch (err) {
    console.error('[agent-run]', err instanceof Error ? err.message : err);
    message = {
      id: newId(),
      role: 'assistant',
      text: err instanceof LlmError ? err.message : 'Si è verificato un errore durante l\'elaborazione, riprova.',
      at: new Date().toISOString(),
      provider: run.provider,
      events: run.events,
      error: true,
    };
    run.status = 'error';
  }

  run.message = message;
  run.finishedAt = new Date().toISOString();
  const saved = await ts.update<Conversation>('conversation', conversation.id, conversation, (c) => ({
    ...c,
    messages: [...c.messages, message],
    messageCount: c.messages.length + 1,
    updatedAt: run.finishedAt!,
  }));
  await upsertIndex(ts, 'conversation', conversationMeta(saved));
  await ts.set('run', run.id, run);
  return new Response(null, { status: 202 });
};
