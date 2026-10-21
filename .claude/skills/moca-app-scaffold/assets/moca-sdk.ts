/**
 * Moca SDK (TypeScript) — client per integrare app esterne con Moca Hub.
 *
 * Gestisce il flusso sicuro del launch token:
 *  1. Rileva `moca_token` nei query param dell'URL
 *  2. Valida il token con l'Hub (POST /api/validate-launch-token)
 *  3. Salva contesto cliente + API key in sessionStorage (8h)
 *  4. Espone accesso comodo e tipizzato ai valori di configurazione
 *
 * Porting TypeScript di docs/moca-sdk/moca-sdk.js — stesso contratto di rete.
 */

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

export type MocaConfigurations = Record<string, string>;

export interface MocaSession {
  client: MocaClient;
  user: MocaUser;
  application: MocaApplication | null;
  configurations: MocaConfigurations;
  timestamp: number;
}

export interface MocaMockConfig {
  client?: Partial<MocaClient>;
  user?: Partial<MocaUser>;
  configurations?: MocaConfigurations;
}

const SESSION_KEY = 'moca_session';
const MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 ore

export class MocaSDK {
  private hubUrl: string;
  private session: MocaSession | null = null;
  private mockConfig: MocaMockConfig | null = null;

  constructor(hubUrl: string) {
    this.hubUrl = hubUrl.replace(/\/$/, '');
  }

  /** Abilita il Mock Mode per lo sviluppo locale. Chiamare PRIMA di init(). */
  enableMockMode(config: MocaMockConfig = {}): void {
    this.mockConfig = config;
  }

  /**
   * Inizializza l'SDK: valida il launch token o ripristina la sessione.
   * Va chiamato all'avvio, prima di renderizzare la UID protetta.
   */
  async init(): Promise<boolean> {
    const existing = this.loadSession();
    if (existing) {
      this.session = existing;
      return true;
    }

    const params = new URLSearchParams(window.location.search);
    const token = params.get('moca_token');

    const isLocal =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    if (!token && isLocal && this.mockConfig) {
      console.info('[Moca SDK] MOCK MODE attivo (solo sviluppo locale)');
      this.session = {
        client: {
          id: 'mock-client',
          name: 'Cliente Mock',
          logo_url: 'https://placehold.co/100/E52217/FFFFFF?text=M',
          ...this.mockConfig.client,
        },
        user: {
          id: 'mock-user',
          name: 'Sviluppatore (Mock)',
          role: 'super_admin',
          ...this.mockConfig.user,
        },
        application: { id: 'mock-app', name: 'Local App' },
        configurations: this.mockConfig.configurations ?? {},
        timestamp: Date.now(),
      };
      this.saveSession();
      return true;
    }

    if (!token) {
      console.warn('[Moca SDK] Nessun token nell\'URL e nessuna sessione attiva');
      return false;
    }

    try {
      const res = await fetch(`${this.hubUrl}/api/validate-launch-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        console.error('[Moca SDK] Validazione token fallita:', data.error || data.code);
        return false;
      }

      this.session = {
        client: data.client,
        user: data.user,
        application: data.application,
        configurations: data.configurations,
        timestamp: Date.now(),
      };
      this.saveSession();
      this.cleanUrl();
      return true;
    } catch (err) {
      console.error('[Moca SDK] Errore di rete nella validazione del token:', err);
      return false;
    }
  }

  isAuthenticated(): boolean {
    return this.session !== null;
  }

  /** Recupera una singola configurazione (es. API key) per chiave. */
  getConfig(key: string): string | null {
    return this.session?.configurations?.[key] ?? null;
  }

  getAllConfigs(): MocaConfigurations {
    return { ...(this.session?.configurations ?? {}) };
  }

  getClient(): MocaClient | null {
    return this.session?.client ?? null;
  }

  getUser(): MocaUser | null {
    return this.session?.user ?? null;
  }

  getApplication(): MocaApplication | null {
    return this.session?.application ?? null;
  }

  logout(): void {
    sessionStorage.removeItem(SESSION_KEY);
    this.session = null;
  }

  // --- privati ---

  private loadSession(): MocaSession | null {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (!stored) return null;
      const session = JSON.parse(stored) as MocaSession;
      if (Date.now() - session.timestamp > MAX_AGE_MS) {
        sessionStorage.removeItem(SESSION_KEY);
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }

  private saveSession(): void {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
    } catch (err) {
      console.error('[Moca SDK] Impossibile salvare la sessione:', err);
    }
  }

  private cleanUrl(): void {
    const url = new URL(window.location.href);
    url.searchParams.delete('moca_token');
    window.history.replaceState({}, document.title, url.toString());
  }
}
