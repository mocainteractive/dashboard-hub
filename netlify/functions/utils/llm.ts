import Anthropic from '@anthropic-ai/sdk';
import type { AiProvider } from '../../../src/shared/types';

/**
 * Adattatori per i tre provider AI (chiavi del cliente dall'Hub, dentro la
 * sessione cifrata). Il ciclo dell'agente lavora su un formato neutro; la
 * trascrizione nativa di ogni provider è conservata così com'è e solo
 * aggiunta in coda (necessario per i blocchi di ragionamento dei modelli).
 */

export interface ToolDef {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] };
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

export interface Turn {
  text: string;
  calls: ToolCall[];
  stop: 'tool' | 'end' | 'refusal' | 'max_tokens';
}

export interface Transcript {
  provider: AiProvider;
  model: string;
  messages: unknown[];
}

export class LlmError extends Error {}

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-5',
  gemini: 'gemini-2.5-flash',
};

export interface LlmAdapter {
  addUser(t: Transcript, text: string): void;
  step(t: Transcript, system: string, tools: ToolDef[]): Promise<Turn>;
  addToolResults(t: Transcript, results: ToolResult[]): void;
}

function httpError(provider: string, status: number): LlmError {
  if (status === 401 || status === 403) return new LlmError(`Chiave ${provider} non valida o senza permessi: controllala nell'Hub.`);
  if (status === 429) return new LlmError(`${provider}: limite di richieste raggiunto, riprova tra poco.`);
  if (status === 404) return new LlmError(`${provider}: modello non disponibile.`);
  return new LlmError(`${provider}: errore ${status}.`);
}

// --- Anthropic (SDK ufficiale) ---

function anthropicAdapter(apiKey: string): LlmAdapter {
  const client = new Anthropic({ apiKey, timeout: 240_000, maxRetries: 2 });
  return {
    addUser(t, text) {
      t.messages.push({ role: 'user', content: [{ type: 'text', text }] });
    },
    async step(t, system, tools) {
      let res: Anthropic.Beta.BetaMessage;
      try {
        res = await client.beta.messages.create({
          model: t.model,
          max_tokens: 16000,
          system: [{ type: 'text', text: system }],
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters as Anthropic.Beta.BetaTool.InputSchema,
          })),
          messages: t.messages as Anthropic.Beta.BetaMessageParam[],
          output_config: { effort: 'medium' },
          cache_control: { type: 'ephemeral' },
          // Se il modello principale rifiuta, l'API riprova su un modello di riserva.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        });
      } catch (err) {
        if (err instanceof Anthropic.APIError && typeof err.status === 'number') throw httpError('Anthropic', err.status);
        throw new LlmError('Anthropic non raggiungibile.');
      }
      // Contenuto restituito per intero (ragionamento compreso), mai modificato.
      t.messages.push({ role: 'assistant', content: res.content });
      const text = res.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      const calls = res.content
        .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, args: (b.input ?? {}) as Record<string, unknown> }));
      if (res.stop_reason === 'refusal') return { text, calls: [], stop: 'refusal' };
      if (res.stop_reason === 'max_tokens') return { text, calls: [], stop: 'max_tokens' };
      return { text, calls, stop: calls.length ? 'tool' : 'end' };
    },
    addToolResults(t, results) {
      // Tutti i risultati in un solo messaggio utente.
      t.messages.push({
        role: 'user',
        content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, is_error: r.isError || undefined })),
      });
    },
  };
}

// --- OpenAI (Chat Completions) ---

function openaiAdapter(apiKey: string): LlmAdapter {
  return {
    addUser(t, text) {
      t.messages.push({ role: 'user', content: text });
    },
    async step(t, system, tools) {
      let res: Response;
      try {
        res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: t.model,
            messages: [{ role: 'system', content: system }, ...t.messages],
            tools: tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
            max_completion_tokens: 12000,
          }),
          signal: AbortSignal.timeout(240_000),
        });
      } catch {
        throw new LlmError('OpenAI non raggiungibile.');
      }
      if (!res.ok) throw httpError('OpenAI', res.status);
      const data = (await res.json()) as {
        choices?: { finish_reason?: string; message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
      };
      const choice = data.choices?.[0];
      const msg = choice?.message ?? { content: '' };
      t.messages.push({ role: 'assistant', ...msg });
      const calls: ToolCall[] = (msg.tool_calls ?? []).map((c) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(c.function.arguments || '{}');
        } catch {
          args = { __invalid_json: true };
        }
        return { id: c.id, name: c.function.name, args };
      });
      const text = (msg.content ?? '').trim();
      if (choice?.finish_reason === 'content_filter') return { text, calls: [], stop: 'refusal' };
      if (choice?.finish_reason === 'length' && !calls.length) return { text, calls: [], stop: 'max_tokens' };
      return { text, calls, stop: calls.length ? 'tool' : 'end' };
    },
    addToolResults(t, results) {
      for (const r of results) t.messages.push({ role: 'tool', tool_call_id: r.id, content: r.content });
    },
  };
}

// --- Gemini (generateContent) ---

const GEMINI_KEYS = new Set(['type', 'description', 'properties', 'required', 'items', 'enum', 'nullable', 'format']);

/** Gemini accetta un sottoinsieme di JSON Schema: si tengono solo le chiavi supportate. */
export function geminiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(geminiSchema);
  if (!s || typeof s !== 'object') return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (!GEMINI_KEYS.has(k)) continue;
    if (k === 'type') out.type = Array.isArray(v) ? String(v.find((x) => x !== 'null') ?? 'string').toUpperCase() : String(v).toUpperCase();
    else if (k === 'properties' && v && typeof v === 'object') out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, geminiSchema(pv)]));
    else if (k === 'items') out.items = geminiSchema(v);
    else if (k === 'format') {
      if (v === 'date-time' || v === 'enum') out.format = v;
    } else out[k] = v;
  }
  if (out.type === 'ARRAY' && !out.items) out.items = { type: 'STRING' };
  return out;
}

function geminiAdapter(apiKey: string): LlmAdapter {
  return {
    addUser(t, text) {
      t.messages.push({ role: 'user', parts: [{ text }] });
    },
    async step(t, system, tools) {
      let res: Response;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(t.model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: t.messages,
            tools: [{ functionDeclarations: tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: geminiSchema(tool.parameters) })) }],
            generationConfig: { maxOutputTokens: 12000 },
          }),
          signal: AbortSignal.timeout(240_000),
        });
      } catch {
        throw new LlmError('Gemini non raggiungibile.');
      }
      if (!res.ok) throw httpError('Gemini', res.status);
      const data = (await res.json()) as {
        candidates?: { finishReason?: string; content?: { role?: string; parts?: { text?: string; thought?: boolean; functionCall?: { id?: string; name: string; args?: Record<string, unknown> } }[] } }[];
      };
      const cand = data.candidates?.[0];
      const content = cand?.content ?? { role: 'model', parts: [] };
      // Parti restituite per intero (firme del ragionamento comprese).
      t.messages.push({ role: 'model', parts: content.parts ?? [] });
      const parts = content.parts ?? [];
      const text = parts
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join('\n')
        .trim();
      const calls = parts
        .filter((p) => p.functionCall)
        .map((p, i) => ({ id: p.functionCall!.id ?? `${p.functionCall!.name}#${i}`, name: p.functionCall!.name, args: p.functionCall!.args ?? {} }));
      if (cand?.finishReason === 'SAFETY' || cand?.finishReason === 'PROHIBITED_CONTENT') return { text, calls: [], stop: 'refusal' };
      if (cand?.finishReason === 'MAX_TOKENS' && !calls.length) return { text, calls: [], stop: 'max_tokens' };
      return { text, calls, stop: calls.length ? 'tool' : 'end' };
    },
    addToolResults(t, results) {
      t.messages.push({
        role: 'user',
        parts: results.map((r) => ({ functionResponse: { name: r.name, response: { content: r.content, ...(r.isError ? { error: true } : {}) } } })),
      });
    },
  };
}

export function adapterFor(provider: AiProvider, apiKey: string): LlmAdapter {
  switch (provider) {
    case 'anthropic':
      return anthropicAdapter(apiKey);
    case 'openai':
      return openaiAdapter(apiKey);
    case 'gemini':
      return geminiAdapter(apiKey);
  }
}
