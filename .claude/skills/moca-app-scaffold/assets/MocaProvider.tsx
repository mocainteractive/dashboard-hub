/**
 * MocaProvider — context React per l'integrazione con Moca Hub.
 *
 * Avvolge l'app, esegue moca.init() una sola volta e fornisce
 * client / user / configurazioni a tutti i componenti tramite useMoca().
 *
 * Stati gestiti:
 *  - loading: validazione token in corso
 *  - authenticated: sessione valida → render dei children
 *  - !authenticated: mostra <AccessDenied /> (apri l'app dal Hub)
 */
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { MocaSDK, MocaClient, MocaUser, MocaConfigurations } from './moca-sdk';

const HUB_URL = import.meta.env.VITE_MOCA_HUB_URL ?? 'https://moca-central-hub.netlify.app';

interface MocaContextValue {
  client: MocaClient;
  user: MocaUser;
  configs: MocaConfigurations;
  getConfig: (key: string) => string | null;
  logout: () => void;
}

const MocaContext = createContext<MocaContextValue | null>(null);

export function useMoca(): MocaContextValue {
  const ctx = useContext(MocaContext);
  if (!ctx) throw new Error('useMoca deve essere usato dentro <MocaProvider>');
  return ctx;
}

export function MocaProvider({ children }: { children: ReactNode }) {
  const [sdk] = useState(() => new MocaSDK(HUB_URL));
  const [status, setStatus] = useState<'loading' | 'ok' | 'denied'>('loading');

  useEffect(() => {
    // --- MOCK MODE: solo sviluppo locale. NON committare chiavi reali. ---
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      sdk.enableMockMode({
        client: { name: 'Cliente Demo', logo_url: 'https://placehold.co/100/E52217/FFFFFF?text=DEMO' },
        user: { name: 'Sviluppatore', role: 'super_admin' },
        configurations: {
          // Inserisci qui le chiavi di test dal tuo .env.local (vedi VITE_ vars)
          OPENAI_API_KEY: import.meta.env.VITE_DEV_OPENAI_API_KEY ?? '',
        },
      });
    }

    sdk.init().then((ok) => setStatus(ok ? 'ok' : 'denied'));
  }, [sdk]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-moca-bg">
        <div className="animate-spin h-8 w-8 border-2 border-moca-red border-t-transparent rounded-full" />
      </div>
    );
  }

  if (status === 'denied') {
    return <AccessDenied hubUrl={HUB_URL} />;
  }

  const value: MocaContextValue = {
    client: sdk.getClient()!,
    user: sdk.getUser()!,
    configs: sdk.getAllConfigs(),
    getConfig: (key) => sdk.getConfig(key),
    logout: () => sdk.logout(),
  };

  return <MocaContext.Provider value={value}>{children}</MocaContext.Provider>;
}

function AccessDenied({ hubUrl }: { hubUrl: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-moca-bg text-center px-4">
      <div className="bg-white rounded-xl shadow-sm p-10 max-w-md">
        <h1 className="text-2xl font-bold text-moca-black mb-2">Accesso Negato</h1>
        <p className="text-moca-gray mb-6">
          Questa applicazione deve essere aperta tramite <strong>Moca Hub</strong>.
        </p>
        <a
          href={hubUrl}
          className="inline-block px-6 py-3 bg-moca-red text-white rounded-md font-semibold hover:opacity-90 transition-opacity"
        >
          Vai a Moca Hub
        </a>
      </div>
    </div>
  );
}
