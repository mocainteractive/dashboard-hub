import { getStore } from '@netlify/blobs';
import { handleData, type DataBody } from './utils/data-core';
import { fail, readBody, requireSession } from './utils/http';
import { TenantStore, type BlobStore } from './utils/tenant-store';

/**
 * Dataset, dashboard, conversazioni, avanzamento delle risposte e cache.
 * POST { action, ... } con Authorization: Bearer <sessione dell'app>.
 * Il cliente è sempre quello della sessione.
 */
export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return fail(405, 'Metodo non consentito');
  const auth = requireSession(req);
  if ('response' in auth) return auth.response;
  const body = await readBody<DataBody>(req);
  if (!body) return fail(400, 'Richiesta non valida');
  try {
    const store = getStore({ name: 'dashboard-hub', consistency: 'strong' }) as unknown as BlobStore;
    return await handleData(body, auth.session, new TenantStore(store, auth.session), store);
  } catch (err) {
    console.error('[data]', body.action, err instanceof Error ? err.message : err);
    return fail(500, 'Errore interno del server');
  }
};
