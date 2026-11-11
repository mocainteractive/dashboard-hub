/**
 * POC locale di Dashboard Hub: app completa sul tuo computer, con i server MCP
 * reali e Claude, senza Netlify (nessun deploy, nessun credito consumato).
 *
 *   npm run poc     ->  http://localhost:5180
 *
 * Un solo processo serve il frontend (Vite) e le API:
 *   POST /api/start-session   sessione dalla configurazione locale (niente Hub)
 *   POST /api/data            dataset, dashboard, conversazioni, cache
 *   POST /api/chat-stream     chat in streaming (Server-Sent Events)
 *
 * Configurazione in .env.poc (vedi .env.poc.example). I dati restano in
 * .poc-data/ (ignorata da git). La stessa struttura è pronta per Cloud Run.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { SCOPE_CONFIG_KEY } from '../src/shared/scope';
import type { StreamEvent } from '../src/shared/types';
import { beginTurn, ChatError, parseTier, runTurn, validateQuestion } from '../netlify/functions/utils/chat-core';
import { handleData, type DataBody } from '../netlify/functions/utils/data-core';
import { issueSession, type HubPayload } from '../netlify/functions/utils/issue-session';
import { McpGateway } from '../netlify/functions/utils/mcp-gateway';
import { MCP_ENV_PREFIX, serverFor } from '../netlify/functions/utils/mcp-client';
import { openSession, type AppSession } from '../netlify/functions/utils/session';
import { TenantStore } from '../netlify/functions/utils/tenant-store';
import { FileBlobStore } from './file-store';

const ROOT = resolve(import.meta.dirname, '..');

// --- Configurazione ---

for (const f of ['.env.poc', '.env']) {
  const p = join(ROOT, f);
  if (existsSync(p)) {
    process.loadEnvFile(p);
    console.log(`[poc] configurazione letta da ${f}`);
    break;
  }
}

const DATA_DIR = resolve(ROOT, process.env.POC_DATA_DIR || '.poc-data');
mkdirSync(DATA_DIR, { recursive: true });

// Segreto della sessione stabile tra un riavvio e l'altro.
if (!process.env.SESSION_SECRET) {
  const f = join(DATA_DIR, 'session-secret');
  if (!existsSync(f)) writeFileSync(f, randomBytes(32).toString('hex'));
  process.env.SESSION_SECRET = readFileSync(f, 'utf8').trim();
}
const SECRET = process.env.SESSION_SECRET;
process.env.CHAT_STREAMING = 'true';

const PORT = Number(process.env.POC_PORT || 5180);
const TIME_BUDGET_MS = 10 * 60 * 1000;

function clientJson(): string {
  const file = process.env.POC_CLIENT_FILE?.trim();
  if (file) {
    const p = resolve(ROOT, file);
    if (!existsSync(p)) throw new Error(`POC_CLIENT_FILE non trovato: ${p}`);
    return readFileSync(p, 'utf8');
  }
  return process.env.DEV_DATA_LAKE_CLIENT_JSON ?? '';
}

function hubPayload(): HubPayload {
  const json = clientJson();
  let slug = 'cliente-poc';
  let name = 'Cliente POC';
  try {
    const c = JSON.parse(json) as { client_id?: string; display_name?: string };
    if (c.client_id) slug = c.client_id;
    name = c.display_name || c.client_id || name;
  } catch {
    // JSON non valido: la pagina Perimetro mostrerà l'errore.
  }
  const id = `poc-${slug}`.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 64);
  return {
    success: true,
    client: { id, name, logo_url: 'https://placehold.co/100/E52217/FFFFFF?text=POC' },
    user: { id: 'poc-user', name: process.env.POC_USER_NAME || 'Tester POC', role: 'super_admin' },
    application: { id: 'poc', name: 'Dashboard Hub (POC)' },
    configurations: {
      [SCOPE_CONFIG_KEY]: json,
      ANTHROPIC_API_KEY: process.env.POC_ANTHROPIC_API_KEY || process.env.DEV_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '',
      AI_MODEL_ANTHROPIC: process.env.AI_MODEL_ANTHROPIC ?? '',
      AI_EFFORT: process.env.AI_EFFORT ?? '',
    },
  };
}

const store = new FileBlobStore(join(DATA_DIR, 'blobs'));

// --- Utilità HTTP ---

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1_500_000) return null;
    chunks.push(c as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

async function send(res: ServerResponse, r: Response) {
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => (headers[k] = v));
  res.writeHead(r.status, headers);
  res.end(await r.text());
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sessionOf(req: IncomingMessage): AppSession | null {
  const h = req.headers.authorization ?? '';
  const token = h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : undefined;
  return openSession(token, SECRET);
}

// --- Rotte ---

async function chatStream(req: IncomingMessage, res: ServerResponse, session: AppSession) {
  const body = await readJson(req);
  if (!body) return sendJson(res, 400, { success: false, error: 'Richiesta non valida' });
  const ts = new TenantStore(store, session);
  let started: Awaited<ReturnType<typeof beginTurn>>;
  try {
    const text = validateQuestion(session, body.message);
    started = await beginTurn(ts, session, body.conversation_id, text);
  } catch (err) {
    if (err instanceof ChatError) return sendJson(res, err.status, { success: false, error: err.message });
    throw err;
  }
  const { conversation, run } = started;

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });
  const emit = (e: StreamEvent) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  const ping = setInterval(() => !res.writableEnded && res.write(': ping\n\n'), 15000);

  emit({ type: 'start', conversationId: conversation.id, title: conversation.title });
  const t0 = Date.now();
  console.log(`[poc] domanda: ${conversation.messages[conversation.messages.length - 1]?.text.slice(0, 80)}`);
  try {
    const message = await runTurn({
      session,
      ts,
      gateway: new McpGateway(ts, store, session.scope!),
      run,
      conversation,
      refresh: body.refresh === true,
      timeBudgetMs: TIME_BUDGET_MS,
      emit,
      signal: abort.signal,
      tier: parseTier(body.tier),
    });
    emit({ type: 'done', message });
    const u = message.usage;
    console.log(
      `[poc] risposta in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${run.events.filter((e) => e.kind === 'mcp').length} chiamate MCP, ${run.events.filter((e) => e.kind === 'cache').length} dalla cache` +
        (u ? `, ${u.steps} passaggi Claude, token ingresso ${u.input}+${u.cacheRead} cache+${u.cacheWrite} scritti, uscita ${u.output}, costo stimato ${u.costUsd.toFixed(4)} $` : ''),
    );
  } catch (err) {
    console.error('[poc] chat', err);
    emit({ type: 'error', error: "Si è verificato un errore durante l'elaborazione, riprova." });
  } finally {
    clearInterval(ping);
    res.end();
  }
}

async function api(req: IncomingMessage, res: ServerResponse, path: string) {
  if (req.method !== 'POST') return sendJson(res, 405, { success: false, error: 'Metodo non consentito' });

  if (path === 'start-session') {
    await readJson(req);
    return send(res, issueSession(hubPayload(), SECRET));
  }
  if (path === 'send-feedback') return sendJson(res, 503, { success: false, error: 'Feedback non disponibile nel POC locale.' });

  const session = sessionOf(req);
  if (!session) return sendJson(res, 401, { success: false, error: 'Sessione non valida o scaduta: ricarica la pagina.' });

  if (path === 'data') {
    const body = await readJson(req);
    if (!body) return sendJson(res, 400, { success: false, error: 'Richiesta non valida' });
    return send(res, await handleData(body as DataBody, session, new TenantStore(store, session), store));
  }
  if (path === 'chat-stream') return chatStream(req, res, session);
  return sendJson(res, 404, { success: false, error: 'Endpoint inesistente' });
}

async function main() {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({ root: ROOT, server: { middlewareMode: true }, appType: 'spa' });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      try {
        await api(req, res, url.pathname.slice(5));
      } catch (err) {
        console.error('[poc]', err);
        if (!res.headersSent) sendJson(res, 500, { success: false, error: 'Errore interno del server' });
        else res.end();
      }
      return;
    }
    vite.middlewares(req, res);
  });

  server.listen(PORT, '127.0.0.1', () => {
    const p = hubPayload();
    const servers = Object.keys(MCP_ENV_PREFIX).filter((k) => serverFor(k as keyof typeof MCP_ENV_PREFIX));
    console.log('');
    console.log(`  Dashboard Hub POC  ->  http://localhost:${PORT}`);
    console.log(`  Cliente: ${p.client!.name}`);
    console.log(`  Chiave Anthropic: ${p.configurations!.ANTHROPIC_API_KEY ? 'presente' : 'MANCANTE (POC_ANTHROPIC_API_KEY)'}`);
    console.log(`  Server MCP configurati: ${servers.length ? servers.join(', ') : 'nessuno (MCP_*_URL)'}`);
    console.log(`  Dati locali: ${DATA_DIR}`);
    console.log('');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
