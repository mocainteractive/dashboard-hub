import { parseScope, SCOPE_CONFIG_KEY, ScopeError, scopedPlatforms } from '../../../src/shared/scope';
import type { AiProvider, ClientScope, SessionInfo } from '../../../src/shared/types';
import { streamingEnabled } from './data-core';
import { fail, json } from './http';
import { EFFORTS } from './llm';
import { serverFor } from './mcp-client';
import { sealSession } from './session';

/**
 * Rilascio della sessione cifrata dell'app a partire dalla risposta dell'Hub
 * (o dalla configurazione locale del POC). La risposta al browser NON contiene
 * configurazioni: chiave AI e JSON del data lake restano nella sessione.
 */

export interface HubPayload {
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
    streaming: streamingEnabled(),
  };
}

export function issueSession(data: HubPayload, secret: string): Response {
  const configs = data.configurations ?? {};
  let scope: ClientScope | null = null;
  let scopeError: string | undefined;
  try {
    scope = parseScope(configs[SCOPE_CONFIG_KEY]);
  } catch (err) {
    scopeError = err instanceof ScopeError ? err.message : 'Configurazione del data lake non leggibile.';
  }

  const key = configs.ANTHROPIC_API_KEY?.trim();
  const model = configs.AI_MODEL_ANTHROPIC?.trim();
  const effort = configs.AI_EFFORT?.trim().toLowerCase();

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
        keys: key ? { anthropic: key } : {},
        models: model && /^[A-Za-z0-9._:-]{2,80}$/.test(model) ? { anthropic: model } : {},
        ...(effort && (EFFORTS as string[]).includes(effort) ? { effort } : {}),
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
    session_info: sessionInfo(scope, scopeError, key ? ['anthropic'] : []),
  });
}
