/**
 * AppHeader: header del Design System v2.0 (3 zone, sticky, moca-black).
 * Sx: logo e nome cliente; centro: titolo app; dx: logo Moca ed Esci.
 */
import { LogOut } from 'lucide-react';
import { useMoca } from '../lib/MocaProvider';

const MOCA_LOGO = 'https://mocainteractive.com/assets/svg/logo-light.svg';

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  manager: 'Manager',
  specialist: 'Specialist',
  external: 'Cliente',
};

export function AppHeader({ appTitle }: { appTitle: string }) {
  const { client, user, logout, demo } = useMoca();
  return (
    <header className="bg-moca-black text-white sticky top-0 z-50 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {client.logo_url && <img src={client.logo_url} alt={client.name} className="h-10 w-10 object-contain bg-white rounded-md p-1" />}
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{client.name}</p>
              <p className="text-xs text-gray-300 truncate">
                {user.name} · {ROLE_LABEL[user.role] ?? user.role}
              </p>
            </div>
          </div>
          <div className="hidden sm:flex flex-1 justify-center items-center gap-2">
            <h1 className="text-lg font-semibold truncate">{appTitle}</h1>
            {demo && <span className="px-2 py-0.5 rounded-full bg-white/10 text-[11px] uppercase tracking-wide">Demo locale</span>}
          </div>
          <div className="flex-1 flex items-center justify-end gap-4">
            <img src={MOCA_LOGO} alt="Moca" className="h-6 opacity-80" />
            <button onClick={logout} className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-moca-red transition-colors" title="Esci">
              <LogOut size={18} />
              <span className="hidden sm:inline text-sm">Esci</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
