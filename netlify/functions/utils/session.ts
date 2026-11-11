import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AiProvider, ClientScope } from '../../../src/shared/types';

/**
 * Sessione dell'app, cifrata e autenticata (AES-256-GCM).
 *
 * La rilascia start-session dopo aver validato il launch token con l'Hub.
 * Contiene il cliente, il perimetro degli account (da DATA_LAKE_CLIENT_JSON)
 * e le chiavi AI del cliente: il browser la conserva come token opaco, non
 * può leggerla né modificarla. Ogni Function ricava il cliente SOLO da qui.
 */

export const MAX_AGE_S = 8 * 60 * 60;

export interface AppSession {
  v: 1;
  uid: string;
  uname: string;
  role: string;
  /** Cliente dell'Hub con cui è stata aperta l'app: l'unico accessibile. */
  cid: string;
  cname: string;
  scope: ClientScope | null;
  scopeError?: string;
  keys: Partial<Record<AiProvider, string>>;
  models: Partial<Record<AiProvider, string>>;
  /** Sforzo di ragionamento di Claude (AI_EFFORT nell'Hub), facoltativo. */
  effort?: string;
  exp: number;
}

const CID_RE = /^[A-Za-z0-9-]{3,64}$/;

function keyFrom(secret: string): Buffer {
  if (!secret || secret.length < 16) throw new Error('SESSION_SECRET mancante o troppo corta');
  return Buffer.from(hkdfSync('sha256', secret, 'moca-dashboard-hub', 'session-v1', 32));
}

export function sealSession(p: Omit<AppSession, 'v' | 'exp'>, secret: string, now = Date.now()): string {
  if (!CID_RE.test(p.cid)) throw new Error('Cliente non valido');
  const payload: AppSession = { ...p, v: 1, exp: Math.floor(now / 1000) + MAX_AGE_S };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `v1.${iv.toString('base64url')}.${ct.toString('base64url')}`;
}

export function openSession(token: string | null | undefined, secret: string, now = Date.now()): AppSession | null {
  if (!token || token.length > 16000) return null;
  const [ver, ivB64, ctB64] = token.split('.');
  if (ver !== 'v1' || !ivB64 || !ctB64) return null;
  try {
    const iv = Buffer.from(ivB64, 'base64url');
    const data = Buffer.from(ctB64, 'base64url');
    if (iv.length !== 12 || data.length < 17) return null;
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), iv);
    decipher.setAuthTag(data.subarray(data.length - 16));
    const plain = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString('utf8');
    const s = JSON.parse(plain) as AppSession;
    if (s.v !== 1 || !s.exp || s.exp * 1000 < now) return null;
    if (typeof s.cid !== 'string' || !CID_RE.test(s.cid)) return null;
    return s;
  } catch {
    return null;
  }
}

export function bearer(req: Request): string | undefined {
  const h = req.headers.get('authorization') ?? '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : undefined;
}

/** Segreto per le chiamate interne tra Functions (avvio della background function). */
export function internalSecret(secret: string): string {
  return createHmac('sha256', keyFrom(secret)).update('internal-chain-v1').digest('base64url');
}

export function checkInternal(given: string | null, secret: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(internalSecret(secret));
  return a.length === b.length && timingSafeEqual(a, b);
}

export const INTERNAL_ROLES = ['super_admin', 'manager', 'specialist'];
