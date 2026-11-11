import { useState } from 'react';
import { Database, LayoutDashboard, ShieldCheck, Sparkles } from 'lucide-react';
import { AppHeader } from './components/AppHeader';
import { FeedbackWidget } from './components/FeedbackWidget';
import { DataProvider } from './lib/DataContext';
import { useMoca } from './lib/MocaProvider';
import { ChatView } from './views/ChatView';
import { DashboardsView } from './views/DashboardsView';
import { DataView } from './views/DataView';
import { MissingScope, ScopeView } from './views/ScopeView';

const APP_NAME = 'Dashboard Hub';

type Tab = 'dashboard' | 'chat' | 'data' | 'scope';

const TABS: { key: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'chat', label: 'Chat con i dati', icon: Sparkles },
  { key: 'data', label: 'Dati', icon: Database },
  { key: 'scope', label: 'Perimetro e cache', icon: ShieldCheck },
];

function readTab(): Tab {
  try {
    const t = sessionStorage.getItem('dashboard-hub-tab') as Tab | null;
    return t && TABS.some((x) => x.key === t) ? t : 'dashboard';
  } catch {
    return 'dashboard';
  }
}

export default function App() {
  const { info } = useMoca();
  const [tab, setTabState] = useState<Tab>(readTab);
  const [dashboardId, setDashboardId] = useState<string | null>(null);
  const [chatPrompt, setChatPrompt] = useState<string | null>(null);
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      sessionStorage.setItem('dashboard-hub-tab', t);
    } catch {
      // Preferenza non salvata: nessun effetto sul funzionamento.
    }
  };

  return (
    <DataProvider>
      <div className="flex flex-col min-h-screen bg-moca-bg font-figtree">
        <AppHeader appTitle={APP_NAME} />
        <nav className="bg-white border-b border-moca-line sticky top-16 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex gap-1 overflow-x-auto scrollbar-thin">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`flex items-center gap-2 px-3 sm:px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition ${
                  tab === key ? 'border-moca-red text-moca-red' : 'border-transparent text-moca-text hover:text-moca-black'
                }`}
                aria-current={tab === key ? 'page' : undefined}
              >
                <Icon size={16} />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        </nav>

        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {!info.scope && tab !== 'scope' && (
            <div className="mb-6">
              <MissingScope reason={info.scopeError} />
            </div>
          )}
          {tab === 'dashboard' && (
            <DashboardsView
              openId={dashboardId}
              onOpen={setDashboardId}
              onGoChat={(prompt) => {
                setChatPrompt(prompt ?? null);
                setTab('chat');
              }}
            />
          )}
          {tab === 'chat' && <ChatView initialText={chatPrompt} onInitialUsed={() => setChatPrompt(null)} />}
          {tab === 'data' && <DataView onGoChat={() => setTab('chat')} />}
          {tab === 'scope' && <ScopeView />}
        </main>

        <footer className="bg-white border-t border-moca-line py-4 text-center text-xs text-moca-gray">
          {APP_NAME} · Moca Interactive · {new Date().getFullYear()}
        </footer>
        <FeedbackWidget />
      </div>
    </DataProvider>
  );
}
