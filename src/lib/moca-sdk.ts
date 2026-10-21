/**
 * Moca SDK (TypeScript): integrazione con Moca Hub tramite launch token.
 *
 * Porting di docs/moca-sdk/moca-sdk.js con una differenza voluta: il token
 * viene validato dalla function start-session dell'app, che risponde SENZA
 * configurazioni (chiavi AI e perimetro restano nella sessione cifrata) e
 * aggiunge la sessione dell'app e il riepilogo pubblico del perimetro.
 */
import type { SessionInfo } from '../shared/types';

export interface MocaClient {
  id: string;
  name: string;
  email?: string;
  logo_url?: string;
}

export interface MocaUser {
  id: string;
  name: string;
  email?: string;
  /** Ruoli reali dell'Hub: super_admin | manager | specialist | external */
  role: string;
  level?: number;
  job_title?: string;
}

export interface MocaApplication {
  id: string;
  name: string;
  description?: string;
}

export interface MocaSession {
  client: MocaClient;
  user: MocaUser;
  application: MocaApplication | null;
  timestamp: number;
  /** Sessione cifrata dell'app per le Netlify Functions (assente in demo locale). */
  appSession?: string;
  info: SessionInfo;
  /** Demo locale senza Functions: dati di esempio generati nel browser. */
  demo?: boolean;
}

const SESSION_KEY = 'moca_session';
const MAX_AGE_MS = 8 * 60 * 60 * 1000;

const isLocal = () => window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

export class MocaSDK {
  private session: MocaSession | null = null;

  constructor(
    private readonly startUrl: string,
    private readonly demoSession: () => MocaSession,
  ) {}

  async init(): Promise<boolean> {
    const existing = this.loadSession();
    if (existing) {
      this.session = existing;
      return true;
    }
    const token = new URLSearchParams(window.location.search).get('moca_token');

    if (!token && isLocal()) {
      // Sviluppo locale: prima `netlify dev` (Functions vere), poi demo nel browser.
      const real = await this.start({ mock: true });
      this.session = real ?? this.demoSession();
      this.saveSession();
      return true;
    }
    if (!token) return false;

    const s = await this.start({ token });
    if (!s) return false;
    this.session = s;
    this.saveSession();
    this.cleanUrl();
    return true;
  }

  private async start(body: Record<string, unknown>): Promise<MocaSession | null> {
    try {
      const res = await fetch(this.startUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok || !data.success || !data.app_session) return null;
      return {
        client: data.client,
        user: data.user,
        application: data.application,
        timestamp: Date.now(),
        appSession: data.app_session,
        info: data.session_info,
      };
    } catch {
      return null;
    }
  }

  get(): MocaSession | null {
    return this.session;
  }

  logout(): void {
    sessionStorage.removeItem(SESSION_KEY);
    this.session = null;
  }

  private loadSession(): MocaSession | null {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (!stored) return null;
      const s = JSON.parse(stored) as MocaSession;
      if (Date.now() - s.timestamp > MAX_AGE_MS || !s.info) {
        sessionStorage.removeItem(SESSION_KEY);
        return null;
      }
      return s;
    } catch {
      return null;
    }
  }

  private saveSession(): void {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
    } catch {
      // sessionStorage non disponibile: la sessione vale fino al ricaricamento.
    }
  }

  private cleanUrl(): void {
    const url = new URL(window.location.href);
    url.searchParams.delete('moca_token');
    window.history.replaceState({}, document.title, url.toString());
  }
}
