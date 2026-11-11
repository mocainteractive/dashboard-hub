import Anthropic from '@anthropic-ai/sdk';
import type { AiProvider } from '../../../src/shared/types';

/**
 * Adattatore Claude (Anthropic). La chiave è quella del cliente, dall'Hub,
 * dentro la sessione cifrata. La trascrizione nativa è conservata così com'è
 * e solo aggiunta in coda (necessario per i blocchi di ragionamento).
 *
 * Velocità:
 *  - streaming: il testo arriva al browser mentre il modello scrive;
 *  - ricerca degli strumenti: gli strumenti MCP sono dichiarati con
 *    defer_loading e Claude carica solo quelli che servono, invece di
 *    ricevere tutti gli schemi a ogni passaggio;
 *  - prompt caching automatico sul prefisso stabile (strumenti e sistema).
 */

export interface ToolDef {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] };
  /** Caricato solo su richiesta, tramite la ricerca degli strumenti. */
  deferred?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  content: string;
  isError?: boolean;
}

export interface TurnUsage {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface Turn {
  text: string;
  calls: ToolCall[];
  stop: 'tool' | 'end' | 'refusal' | 'max_tokens' | 'pause';
  usage?: TurnUsage;
}

export interface Transcript {
  provider: AiProvider;
  model: string;
  messages: unknown[];
}

export interface StepOptions {
  /** Testo in arrivo, pezzo per pezzo. */
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}

export class LlmError extends Error {}

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const DEFAULT_MODELS: Record<AiProvider, string> = { anthropic: DEFAULT_MODEL };

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export interface LlmAdapter {
  addUser(t: Transcript, text: string): void;
  step(t: Transcript, system: string, tools: ToolDef[], opts?: StepOptions): Promise<Turn>;
  addToolResults(t: Transcript, results: ToolResult[]): void;
}

function httpError(status: number): LlmError {
  if (status === 401 || status === 403) return new LlmError("Chiave Anthropic non valida o senza permessi: controllala nell'Hub.");
  if (status === 429) return new LlmError('Claude: limite di richieste raggiunto, riprova tra poco.');
  if (status === 404) return new LlmError('Claude: modello non disponibile.');
  if (status === 529) return new LlmError('Claude è sovraccarico in questo momento, riprova tra poco.');
  return new LlmError(`Claude: errore ${status}.`);
}

export function toAnthropicTools(tools: ToolDef[]): Anthropic.Beta.BetaToolUnion[] {
  const out: Anthropic.Beta.BetaToolUnion[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Beta.BetaTool.InputSchema,
    ...(tool.deferred ? { defer_loading: true } : {}),
  }));
  if (tools.some((t) => t.deferred)) out.push({ type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' });
  return out;
}

export function claudeAdapter(apiKey: string, effort: Effort = 'medium'): LlmAdapter {
  const client = new Anthropic({ apiKey, timeout: 240_000, maxRetries: 2 });
  return {
    addUser(t, text) {
      t.messages.push({ role: 'user', content: [{ type: 'text', text }] });
    },
    async step(t, system, tools, opts = {}) {
      let res: Anthropic.Beta.BetaMessage;
      try {
        const stream = client.beta.messages.stream(
          {
            model: t.model,
            max_tokens: 32000,
            system: [{ type: 'text', text: system }],
            tools: toAnthropicTools(tools),
            messages: t.messages as Anthropic.Beta.BetaMessageParam[],
            output_config: { effort },
            cache_control: { type: 'ephemeral' },
            // Se il modello principale rifiuta, l'API riprova su un modello di riserva.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
          },
          { signal: opts.signal },
        );
        if (opts.onText) stream.on('text', (delta) => opts.onText!(delta));
        res = await stream.finalMessage();
      } catch (err) {
        if (opts.signal?.aborted) throw new LlmError('Risposta interrotta.');
        if (err instanceof Anthropic.APIError && typeof err.status === 'number') throw httpError(err.status);
        throw new LlmError('Claude non raggiungibile.');
      }
      // Contenuto restituito per intero (ragionamento e ricerca strumenti compresi), mai modificato.
      t.messages.push({ role: 'assistant', content: res.content });
      const usage: TurnUsage = {
        model: res.model || t.model,
        input: res.usage?.input_tokens ?? 0,
        output: res.usage?.output_tokens ?? 0,
        cacheRead: res.usage?.cache_read_input_tokens ?? 0,
        cacheWrite: res.usage?.cache_creation_input_tokens ?? 0,
      };
      const text = res.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      const calls = res.content
        .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, args: (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown> }));
      if (res.stop_reason === 'refusal') return { text, calls: [], stop: 'refusal', usage };
      if (res.stop_reason === 'max_tokens') return { text, calls: [], stop: 'max_tokens', usage };
      if (res.stop_reason === 'pause_turn') return { text, calls: [], stop: 'pause', usage };
      return { text, calls, stop: calls.length ? 'tool' : 'end', usage };
    },
    addToolResults(t, results) {
      // Tutti i risultati in un solo messaggio utente (mantiene le chiamate in parallelo).
      t.messages.push({
        role: 'user',
        content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, is_error: r.isError || undefined })),
      });
    },
  };
}

export function adapterFor(_provider: AiProvider, apiKey: string, effort?: Effort): LlmAdapter {
  return claudeAdapter(apiKey, effort);
}
