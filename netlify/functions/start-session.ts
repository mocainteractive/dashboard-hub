import { parseScope, SCOPE_CONFIG_KEY, ScopeError, scopedPlatforms } from '../../src/shared/scope';
import type { AiProvider, ClientScope, SessionInfo } from '../../src/shared/types';
import { fail, json, readBody, sessionSecret } from './utils/http';
import { serverFor } from './utils/mcp-client';
import { sealSession } from './utils/session';

/**
 * Apertura dell'app dall'Hub.
 *
 * Valida il launch token con l'Hub (server-to-server) e rilascia la sessione
 * cifrata dell'app. La risposta al browser ha il formato di
 * /api/validate-launch-token ma SENZA configurazioni: chiavi AI e JSON del
 * data lake restano dentro la sessione cifrata, leggibile solo dalle Functions.
 *
 * In sviluppo con `netlify dev` accetta { mock: true } e usa le variabili
 * DEV_* (mai impostarle su Netlify).
 */

const HUB_URL = (process.env.MOCA_HUB_URL || 'https://moca-central-hub.netlify.app').replace(/\/$/, '');

const KEY_NAMES: Record<AiProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};
const MODEL_NAMES: Record<AiProvider, string> = {
  anthropic: 'AI_MODEL_ANTHROPIC',
  openai: 'AI_MODEL_OPENAI',
  gemini: 'AI_MODEL_GEMINI',
};

interface HubPayload {
  success?: boolean;
  client?: { id: string; name: string; email?: string; logo_url?: string };
  user?: { id: string; name: string; email?: string; role: string; level?: number; job_title?: string };
  application?: { id: string; name: string; description?: string };
  configurations?: Record<string, string>;
}

function sessionInfo(scope: ClientScope | null, scopeError: string | undefined, providers: AiProvider[]): SessionInfo {
  return {
    scope,
    scopeError,
    providers,
    mcpPlatforms: scope ? scopedPlatforms(scope).filter((p) => !!serverFor(p)) : [],
  };
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return fail(405, 'Metodo non consentito');
  const secret = sessionSecret();
  if (!secret) return fail(503, 'App non configurata (SESSION_SECRET mancante).');

  const body = await readBody<{ token?: unknown; mock?: unknown }>(req);
  if (!body) return fail(400, 'Richiesta non valida');

  let data: HubPayload;
  if (body.mock === true && process.env.NETLIFY_DEV === 'true') {
    data = {
      success: true,
      client: { id: 'mock-client', name: 'Cliente Demo', logo_url: 'https://placehold.co/100/E52217/FFFFFF?text=DEMO' },
      user: { id: 'mock-user', name: 'Sviluppatore', role: 'super_admin' },
      application: { id: 'mock-app', name: 'Dashboard Hub' },
      configurations: {
        [SCOPE_CONFIG_KEY]: process.env.DEV_DATA_LAKE_CLIENT_JSON ?? '',
        ANTHROPIC_API_KEY: process.env.DEV_ANTHROPIC_API_KEY ?? '',
        OPENAI_API_KEY: process.env.DEV_OPENAI_API_KEY ?? '',
        GEMINI_API_KEY: process.env.DEV_GEMINI_API_KEY ?? '',
      },
    };
  } else {
    if (typeof body.token !== 'string' || !body.token || body.token.length > 200) return fail(400, 'Token richiesto');
    let res: Response;
    try {
      res = await fetch(`${HUB_URL}/api/validate-launch-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: body.token }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      return fail(502, 'Moca Hub non raggiungibile');
    }
    const payload = (await res.json().catch(() => null)) as (HubPayload & { code?: string }) | null;
    if (!res.ok || !payload?.success || !payload.client?.id || !payload.user?.id) {
      return json(res.ok ? 401 : res.status, { success: false, error: 'Token non valido', code: payload?.code });
    }
    data = payload;
  }

  const configs = data.configurations ?? {};
  let scope: ClientScope | null = null;
  let scopeError: string | undefined;
  try {
    scope = parseScope(configs[SCOPE_CONFIG_KEY]);
  } catch (err) {
    scopeError = err instanceof ScopeError ? err.message : 'Configurazione del data lake non leggibile.';
  }

  const keys: Partial<Record<AiProvider, string>> = {};
  const models: Partial<Record<AiProvider, string>> = {};
  for (const p of Object.keys(KEY_NAMES) as AiProvider[]) {
    const k = configs[KEY_NAMES[p]]?.trim();
    if (k) keys[p] = k;
    const m = configs[MODEL_NAMES[p]]?.trim();
    if (m && /^[A-Za-z0-9._:-]{2,80}$/.test(m)) models[p] = m;
  }
  const providers = (Object.keys(keys) as AiProvider[]).sort((a, b) => ['anthropic', 'openai', 'gemini'].indexOf(a) - ['anthropic', 'openai', 'gemini'].indexOf(b));

  let appSession: string;
  try {
    appSession = sealSession(
      {
        uid: data.user!.id,
        uname: data.user!.name,
        role: data.user!.role,
        cid: data.client!.id,
        cname: data.client!.name,
        scope,
        scopeError,
        keys,
        models,
      },
      secret,
    );
  } catch (err) {
    console.error('[start-session] sessione non creata', (err as Error).message);
    return fail(500, 'Sessione non creata');
  }

  return json(200, {
    success: true,
    client: data.client,
    user: data.user,
    application: data.application ?? null,
    // Nessuna configurazione al browser: le chiavi restano nella sessione cifrata.
    configurations: {},
    app_session: appSession,
    session_info: sessionInfo(scope, scopeError, providers),
  });
};
