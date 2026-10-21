import { getStore } from '@netlify/blobs';
import type { AiProvider, ChatMessage, Conversation, RunState } from '../../src/shared/types';
import { conversationMeta } from './utils/agent';
import { fail, ok, readBody, requireSession, sessionSecret } from './utils/http';
import { bearer, internalSecret } from './utils/session';
import { newId, TenantStore, upsertIndex, validId, type BlobStore } from './utils/tenant-store';

/**
 * Avvia una risposta dell'assistente.
 * POST { conversation_id?, message, provider, refresh? } -> { run_id, conversation_id }
 *
 * Registra il messaggio e l'elaborazione, poi avvia agent-run-background
 * (fino a 15 minuti). Il browser segue l'avanzamento con /api/data run.status.
 */

const STALE_RUN_MS = 15 * 60 * 1000;

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return fail(405, 'Metodo non consentito');
  const auth = requireSession(req);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  if (!session.scope) return fail(400, session.scopeError ?? 'Perimetro del cliente non configurato.');

  const body = await readBody<{ conversation_id?: unknown; message?: unknown; provider?: unknown; refresh?: unknown }>(req);
  if (!body) return fail(400, 'Richiesta non valida');
  const text = typeof body.message === 'string' ? body.message.trim() : '';
  if (!text) return fail(400, 'Scrivi una domanda.');
  if (text.length > 4000) return fail(400, 'Domanda troppo lunga (massimo 4000 caratteri).');
  const provider = body.provider as AiProvider;
  if (!['anthropic', 'openai', 'gemini'].includes(provider) || !session.keys[provider]) {
    return fail(400, 'Provider AI non disponibile per questo cliente: aggiungi la chiave nell\'Hub.');
  }

  const store = getStore({ name: 'dashboard-hub', consistency: 'strong' }) as unknown as BlobStore;
  const ts = new TenantStore(store, session);
  const now = new Date().toISOString();

  try {
    let conversation: Conversation | null = null;
    if (body.conversation_id !== undefined && body.conversation_id !== null) {
      if (!validId(body.conversation_id)) return fail(400, 'Conversazione non valida');
      conversation = await ts.get<Conversation>('conversation', body.conversation_id);
      if (!conversation) return fail(404, 'Conversazione non trovata');
      const last = conversation.messages[conversation.messages.length - 1];
      if (last?.role === 'user' && Date.now() - Date.parse(last.at) < STALE_RUN_MS) {
        return fail(409, 'C\'è già una risposta in preparazione per questa conversazione.');
      }
    }

    const userMsg: ChatMessage = { id: newId(), role: 'user', text, at: now, author: session.uname };
    const convId = conversation?.id ?? newId();
    const saved = await ts.update<Conversation>(
      'conversation',
      convId,
      { id: convId, title: text.slice(0, 70), createdAt: now, updatedAt: now, createdBy: session.uname, messageCount: 0, messages: [] },
      (c) => ({ ...c, messages: [...c.messages, userMsg], updatedAt: now, messageCount: c.messages.length + 1 }),
    );
    await upsertIndex(ts, 'conversation', conversationMeta(saved));

    const run: RunState = { id: newId(), conversationId: convId, status: 'queued', events: [], provider, startedAt: now };
    await ts.set('run', run.id, run);

    const secret = sessionSecret()!;
    const target = new URL('/.netlify/functions/agent-run-background', req.url);
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-moca-internal': internalSecret(secret), Authorization: `Bearer ${bearer(req)}` },
      body: JSON.stringify({ run_id: run.id, refresh: body.refresh === true }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!res || (res.status !== 202 && !res.ok)) {
      run.status = 'error';
      run.message = { id: newId(), role: 'assistant', text: 'Non sono riuscito ad avviare l\'elaborazione, riprova.', at: now, error: true };
      await ts.set('run', run.id, run);
      await ts.update<Conversation>('conversation', convId, saved, (c) => ({ ...c, messages: [...c.messages, run.message!], messageCount: c.messages.length + 1 }));
      return fail(502, 'Elaborazione non avviata, riprova.');
    }
    return ok({ run_id: run.id, conversation_id: convId });
  } catch (err) {
    console.error('[chat-start]', err instanceof Error ? err.message : err);
    return fail(500, 'Errore interno del server');
  }
};
