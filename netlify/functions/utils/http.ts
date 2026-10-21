import { bearer, openSession, type AppSession } from './session';

/** Risposte uniformi { success, ... } e lettura sicura delle richieste. */

export function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const ok = (body: Record<string, unknown> = {}) => json(200, { success: true, ...body });
export const fail = (status: number, error: string) => json(status, { success: false, error });

const MAX_BODY = 1_500_000;

export async function readBody<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return null;
    const v = JSON.parse(text || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : null;
  } catch {
    return null;
  }
}

export function sessionSecret(): string | null {
  const s = process.env.SESSION_SECRET;
  return s && s.length >= 16 ? s : null;
}

/** Sessione verificata o risposta d'errore pronta. */
export function requireSession(req: Request): { session: AppSession } | { response: Response } {
  const secret = sessionSecret();
  if (!secret) return { response: fail(503, 'App non configurata (SESSION_SECRET mancante).') };
  const session = openSession(bearer(req), secret);
  if (!session) return { response: fail(401, "Sessione non valida o scaduta: riapri l'app dal Moca Hub.") };
  return { session };
}
