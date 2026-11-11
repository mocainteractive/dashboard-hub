import { SCOPE_CONFIG_KEY } from '../../src/shared/scope';
import { fail, json, readBody, sessionSecret } from './utils/http';
import { issueSession, type HubPayload } from './utils/issue-session';

/**
 * Apertura dell'app dall'Hub.
 *
 * Valida il launch token con l'Hub (server-to-server) e rilascia la sessione
 * cifrata dell'app. La risposta al browser ha il formato di
 * /api/validate-launch-token ma SENZA configurazioni: chiave AI e JSON del
 * data lake restano dentro la sessione cifrata, leggibile solo dalle Functions.
 *
 * In sviluppo con `netlify dev` accetta { mock: true } e usa le variabili
 * DEV_* (mai impostarle su Netlify).
 */

const HUB_URL = (process.env.MOCA_HUB_URL || 'https://moca-central-hub.netlify.app').replace(/\/$/, '');

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

  return issueSession(data, secret);
};
