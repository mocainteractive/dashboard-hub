import { getStore } from '@netlify/blobs';
import type { Conversation } from '../../src/shared/types';
import { beginTurn, ChatError, validateQuestion } from './utils/chat-core';
import { fail, ok, readBody, requireSession, sessionSecret } from './utils/http';
import { bearer, internalSecret } from './utils/session';
import { newId, TenantStore, type BlobStore } from './utils/tenant-store';

/**
 * Avvia una risposta dell'assistente (flusso Netlify con polling).
 * POST { conversation_id?, message, refresh? } -> { run_id, conversation_id }
 *
 * Registra il messaggio e l'elaborazione, poi avvia agent-run-background
 * (fino a 15 minuti). Il browser segue l'avanzamento con /api/data run.status.
 * Dove il server supporta lo streaming (POC locale, Cloud Run) la chat usa
 * invece /api/chat-stream.
 */

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return fail(405, 'Metodo non consentito');
  const auth = requireSession(req);
  if ('response' in auth) return auth.response;
  const { session } = auth;

  const body = await readBody<{ conversation_id?: unknown; message?: unknown; refresh?: unknown }>(req);
  if (!body) return fail(400, 'Richiesta non valida');

  const store = getStore({ name: 'dashboard-hub', consistency: 'strong' }) as unknown as BlobStore;
  const ts = new TenantStore(store, session);

  try {
    const text = validateQuestion(session, body.message);
    const { conversation, run } = await beginTurn(ts, session, body.conversation_id, text);

    const secret = sessionSecret()!;
    const target = new URL('/.netlify/functions/agent-run-background', req.url);
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-moca-internal': internalSecret(secret), Authorization: `Bearer ${bearer(req)}` },
      body: JSON.stringify({ run_id: run.id, refresh: body.refresh === true }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!res || (res.status !== 202 && !res.ok)) {
      const now = new Date().toISOString();
      run.status = 'error';
      run.message = { id: newId(), role: 'assistant', text: "Non sono riuscito ad avviare l'elaborazione, riprova.", at: now, error: true };
      await ts.set('run', run.id, run);
      await ts.update<Conversation>('conversation', conversation.id, conversation, (c) => ({ ...c, messages: [...c.messages, run.message!], messageCount: c.messages.length + 1 }));
      return fail(502, 'Elaborazione non avviata, riprova.');
    }
    return ok({ run_id: run.id, conversation_id: conversation.id });
  } catch (err) {
    if (err instanceof ChatError) return fail(err.status, err.message);
    console.error('[chat-start]', err instanceof Error ? err.message : err);
    return fail(500, 'Errore interno del server');
  }
};
