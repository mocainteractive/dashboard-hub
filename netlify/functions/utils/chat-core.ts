import type { ChatMessage, Conversation, RunState, StreamEvent } from '../../../src/shared/types';
import { AgentRunner, conversationMeta } from './agent';
import { LlmError, type Effort } from './llm';
import type { McpGateway } from './mcp-gateway';
import type { AppSession } from './session';
import { newId, upsertIndex, validId, type TenantStore } from './tenant-store';

/**
 * Turno di chat: registra la domanda, esegue l'assistente, salva la risposta.
 * Usato sia dal flusso Netlify (chat-start + background function con
 * polling) sia dalla chat in streaming (server POC, Cloud Run).
 */

const STALE_RUN_MS = 15 * 60 * 1000;

export class ChatError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function validateQuestion(session: AppSession, message: unknown): string {
  if (!session.scope) throw new ChatError(session.scopeError ?? 'Perimetro del cliente non configurato.', 400);
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) throw new ChatError('Scrivi una domanda.', 400);
  if (text.length > 4000) throw new ChatError('Domanda troppo lunga (massimo 4000 caratteri).', 400);
  if (!session.keys.anthropic) throw new ChatError("Chiave Anthropic non configurata per questo cliente: aggiungila nell'Hub.", 400);
  return text;
}

/** Aggiunge la domanda alla conversazione (nuova o esistente) e crea il run. */
export async function beginTurn(ts: TenantStore, session: AppSession, conversationId: unknown, text: string): Promise<{ conversation: Conversation; run: RunState }> {
  const now = new Date().toISOString();
  let existing: Conversation | null = null;
  if (conversationId !== undefined && conversationId !== null) {
    if (!validId(conversationId)) throw new ChatError('Conversazione non valida', 400);
    existing = await ts.get<Conversation>('conversation', conversationId);
    if (!existing) throw new ChatError('Conversazione non trovata', 404);
    const last = existing.messages[existing.messages.length - 1];
    if (last?.role === 'user' && Date.now() - Date.parse(last.at) < STALE_RUN_MS) {
      throw new ChatError("C'è già una risposta in preparazione per questa conversazione.", 409);
    }
  }
  const userMsg: ChatMessage = { id: newId(), role: 'user', text, at: now, author: session.uname };
  const convId = existing?.id ?? newId();
  const conversation = await ts.update<Conversation>(
    'conversation',
    convId,
    { id: convId, title: text.slice(0, 70), createdAt: now, updatedAt: now, createdBy: session.uname, messageCount: 0, messages: [] },
    (c) => ({ ...c, messages: [...c.messages, userMsg], updatedAt: now, messageCount: c.messages.length + 1 }),
  );
  await upsertIndex(ts, 'conversation', conversationMeta(conversation));
  const run: RunState = { id: newId(), conversationId: convId, status: 'queued', events: [], provider: 'anthropic', startedAt: now };
  await ts.set('run', run.id, run);
  return { conversation, run };
}

export interface RunTurnOptions {
  session: AppSession;
  ts: TenantStore;
  gateway: McpGateway;
  run: RunState;
  conversation: Conversation;
  refresh: boolean;
  timeBudgetMs: number;
  /** Salvataggio del run a ogni passaggio (flusso con polling). */
  persistRun?: (r: RunState) => Promise<void>;
  emit?: (e: StreamEvent) => void;
  signal?: AbortSignal;
  isCancelled?: () => Promise<boolean>;
}

/** Esegue l'assistente e salva la risposta nella conversazione. */
export async function runTurn(o: RunTurnOptions): Promise<ChatMessage> {
  const { ts, run, conversation } = o;
  const userText = [...conversation.messages].reverse().find((m) => m.role === 'user')?.text ?? '';
  run.status = 'running';
  await ts.set('run', run.id, run);

  let message: ChatMessage;
  try {
    const runner = new AgentRunner({
      session: o.session,
      ts,
      gateway: o.gateway,
      run,
      conversation,
      userText,
      refresh: o.refresh,
      deadline: Date.now() + o.timeBudgetMs,
      persistRun: o.persistRun ?? (async () => undefined),
      emit: o.emit,
      signal: o.signal,
      isCancelled: o.isCancelled,
      effort: o.session.effort as Effort | undefined,
    });
    message = await runner.run('anthropic');
    run.status = 'done';
  } catch (err) {
    console.error('[agent-run]', err instanceof Error ? err.message : err);
    message = {
      id: newId(),
      role: 'assistant',
      text: err instanceof LlmError ? err.message : "Si è verificato un errore durante l'elaborazione, riprova.",
      at: new Date().toISOString(),
      provider: 'anthropic',
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
  return message;
}
