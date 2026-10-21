/**
 * MocaProvider: context React per l'integrazione con Moca Hub.
 * Esegue init() una sola volta; senza sessione valida mostra "Accesso Negato".
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { MocaSDK, type MocaClient, type MocaSession, type MocaUser } from './moca-sdk';
import { demoSession } from './demo';
import type { SessionInfo } from '../shared/types';

const HUB_URL = import.meta.env.VITE_MOCA_HUB_URL ?? 'https://moca-central-hub.netlify.app';

interface MocaContextValue {
  client: MocaClient;
  user: MocaUser;
  info: SessionInfo;
  appSession: string | null;
  demo: boolean;
  isInternal: boolean;
  logout: () => void;
}

const MocaContext = createContext<MocaContextValue | null>(null);

export function useMoca(): MocaContextValue {
  const ctx = useContext(MocaContext);
  if (!ctx) throw new Error('useMoca deve essere usato dentro <MocaProvider>');
  return ctx;
}

export function MocaProvider({ children }: { children: ReactNode }) {
  const [sdk] = useState(() => new MocaSDK('/api/start-session', demoSession));
  const [session, setSession] = useState<MocaSession | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'denied'>('loading');

  useEffect(() => {
    sdk.init().then((ok) => {
      setSession(sdk.get());
      setStatus(ok ? 'ok' : 'denied');
    });
  }, [sdk]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex flex-col gap-3 items-center justify-center bg-moca-bg font-figtree">
        <div className="animate-spin h-8 w-8 border-2 border-moca-red border-t-transparent rounded-full" />
        <p className="text-sm text-moca-gray">Verifica dell'accesso in corso</p>
      </div>
    );
  }
  if (status === 'denied' || !session) return <AccessDenied />;

  const value: MocaContextValue = {
    client: session.client,
    user: session.user,
    info: session.info,
    appSession: session.appSession ?? null,
    demo: !!session.demo,
    isInternal: ['super_admin', 'manager', 'specialist'].includes(session.user.role),
    logout: () => {
      sdk.logout();
      window.location.href = HUB_URL;
    },
  };
  return <MocaContext.Provider value={value}>{children}</MocaContext.Provider>;
}

function AccessDenied() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-moca-bg text-center px-4 font-figtree">
      <div className="bg-white rounded-xl shadow-sm p-10 max-w-md">
        <ShieldAlert className="mx-auto mb-4 text-moca-red" size={40} />
        <h1 className="text-2xl font-medium text-moca-black mb-2 uppercase">Accesso negato</h1>
        <p className="text-moca-gray mb-6">
          Questa applicazione si apre solo da <strong className="text-moca-gray">Moca Hub</strong>, scegliendo il cliente.
        </p>
        <a href={HUB_URL} className="inline-block px-6 py-3 bg-moca-red text-white rounded-md font-semibold hover:opacity-90 transition-opacity">
          Vai a Moca Hub
        </a>
      </div>
    </div>
  );
}
