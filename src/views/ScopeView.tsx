import { useEffect, useState } from 'react';
import { BarChart, Database, Globe, KeyRound, Lock, Megaphone, Search, ShieldCheck, ShieldAlert, Trash2, TrendingUp, Server } from 'lucide-react';
import { Badge, Button, Card, ErrorNote, Spinner } from '../components/ui';
import { useData } from '../lib/DataContext';
import { useMoca } from '../lib/MocaProvider';
import { formatDateTime } from '../lib/format';
import { SCOPE_CONFIG_KEY } from '../shared/scope';
import { MCP_PLATFORMS, PLATFORM_LABELS, PROVIDER_LABELS, type AiStats, type CacheStats, type McpPlatform, type PlatformKey } from '../shared/types';
import { formatUsd } from '../shared/pricing';

/** Perimetro del cliente (dal Data Lake), sicurezza e cache. */

const PLATFORM_ICON: Partial<Record<PlatformKey, typeof Globe>> = {
  ga4: BarChart,
  search_console: Search,
  google_ads: TrendingUp,
  meta_ads: Megaphone,
  pinterest_ads: Megaphone,
};

export function MissingScope({ reason }: { reason?: string }) {
  return (
    <Card title="Configurazione del cliente mancante">
      <div className="flex gap-4">
        <ShieldAlert className="text-moca-red shrink-0" size={28} />
        <div className="space-y-3 text-sm text-moca-text">
          <p>{reason ?? 'Il perimetro dati di questo cliente non è configurato.'}</p>
          <p>Finché manca, l'app non interroga nessun server MCP: è il comportamento previsto per garantire che ogni cliente veda solo i propri dati.</p>
          <p className="font-semibold text-moca-black uppercase text-xs tracking-wide pt-1">Come si configura</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Apri l'app Onboarding Data Lake sul cliente e copia il JSON prodotto (clients/&lt;slug&gt;.json).</li>
            <li>
              Nell'Hub, scheda del cliente, aggiungi la configurazione <code className="text-moca-black">{SCOPE_CONFIG_KEY}</code> con quel JSON come valore.
            </li>
            <li>Aggiungi la chiave AI del cliente: ANTHROPIC_API_KEY.</li>
            <li>Riapri l'app dall'Hub.</li>
          </ul>
        </div>
      </div>
    </Card>
  );
}

export function ScopeView() {
  const { info, isInternal, demo } = useMoca();
  const { api } = useData();
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [ai, setAi] = useState<AiStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .info()
      .then((r) => {
        setStats(r.stats);
        setAi(r.ai ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, [api]);

  const clear = async () => {
    if (!window.confirm('Svuotare la cache delle chiamate MCP di questo cliente? Le prossime domande rileggeranno i dati dai server.')) return;
    setBusy(true);
    try {
      const n = await api.clearCache();
      setMsg(`Cache svuotata: ${n} risposte rimosse.`);
      setStats((s) => (s ? { ...s, hits: 0, misses: 0 } : s));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const scope = info.scope;
  const total = (stats?.hits ?? 0) + (stats?.misses ?? 0);
  const hitRate = total ? Math.round(((stats?.hits ?? 0) / total) * 100) : 0;

  return (
    <div className="space-y-6">
      {!scope && <MissingScope reason={info.scopeError} />}
      {error && <ErrorNote>{error}</ErrorNote>}

      {scope && (
        <Card
          title="Perimetro dati del cliente"
          subtitle={`Letto dalla configurazione ${SCOPE_CONFIG_KEY} (output dell'app Onboarding Data Lake). Sono gli unici account che l'app può interrogare.`}
          actions={<Badge tone="green"><Lock size={12} /> Blindato</Badge>}
        >
          <div className="grid sm:grid-cols-3 gap-4 mb-5 text-sm">
            <div>
              <p className="text-xs text-moca-gray uppercase tracking-wide">Cliente nel data lake</p>
              <p className="text-moca-black font-medium">{scope.displayName}</p>
              <p className="text-xs text-moca-gray">{scope.slug}</p>
            </div>
            <div>
              <p className="text-xs text-moca-gray uppercase tracking-wide">Progetto GCP</p>
              <p className="text-moca-black font-medium">{scope.gcpProject ?? 'n.d.'}</p>
            </div>
            <div>
              <p className="text-xs text-moca-gray uppercase tracking-wide">Valuta e fuso</p>
              <p className="text-moca-black font-medium">
                {scope.currency ?? 'EUR'} · {scope.timezone ?? 'Europe/Rome'}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-moca-black border-b border-moca-line">
                  <th className="py-2 pr-3">Piattaforma</th>
                  <th className="py-2 pr-3">Account</th>
                  <th className="py-2 pr-3">Validità</th>
                  <th className="py-2">Stato</th>
                </tr>
              </thead>
              <tbody>
                {scope.accounts.map((a) => {
                  const Icon = PLATFORM_ICON[a.platform] ?? Globe;
                  const isMcp = MCP_PLATFORMS.includes(a.platform as McpPlatform);
                  const active = isMcp && info.mcpPlatforms.includes(a.platform as McpPlatform);
                  return (
                    <tr key={`${a.platform}:${a.id}`} className="border-b border-moca-line last:border-0">
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-2 text-moca-black">
                          <Icon size={16} /> {PLATFORM_LABELS[a.platform]}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs text-moca-text">{a.id}</td>
                      <td className="py-2 pr-3 text-xs text-moca-text">
                        dal {a.validFrom ?? 'n.d.'}
                        {a.validTo ? ` al ${a.validTo}` : ''}
                      </td>
                      <td className="py-2">
                        {active ? <Badge tone="green">Interrogabile</Badge> : isMcp ? <Badge tone="amber">Server MCP non configurato</Badge> : <Badge>Nessun server MCP</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <Card title="Come è protetto" subtitle="Controlli applicati lato server, indipendenti dall'AI.">
          <ul className="space-y-3 text-sm text-moca-text">
            {[
              [KeyRound, 'Sessione cifrata', 'Cliente, perimetro e chiavi AI viaggiano in una sessione cifrata (AES-256-GCM): il browser non può leggerla né modificarla.'],
              [ShieldCheck, 'Guardia sulle chiamate MCP', 'Ogni chiamata viene verificata: account sempre imposto dal perimetro, strumenti che elencano altri clienti vietati, ID esterni rifiutati.'],
              [ShieldAlert, 'Filtro sulle risposte', 'Riferimenti ad account esterni rimossi; risposte sospette bloccate per intero.'],
              [Database, 'Archivio separato', 'Dataset, dashboard, conversazioni e cache sono salvati in uno spazio dedicato al cliente.'],
            ].map(([Icon, title, text]) => {
              const I = Icon as typeof Lock;
              return (
                <li key={title as string} className="flex gap-3">
                  <I size={18} className="text-moca-black shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-moca-text">{title as string}.</strong> {text as string}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card
          title="Cache intelligente"
          subtitle="Le risposte dei server MCP restano in cache per cliente: periodi chiusi fino a 30 giorni, periodi che includono oggi per 1 ora."
          actions={
            isInternal && (
              <Button size="sm" variant="secondary" onClick={clear} disabled={busy || demo}>
                {busy ? <Spinner size={4} /> : <Trash2 size={14} />} Svuota
              </Button>
            )
          }
        >
          {!stats ? (
            <Spinner />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-moca-gray uppercase tracking-wide">Riuso cache</p>
                  <p className="text-3xl font-semibold text-moca-black tabular-nums">{hitRate}%</p>
                </div>
                <div>
                  <p className="text-xs text-moca-gray uppercase tracking-wide">Da cache</p>
                  <p className="text-3xl font-semibold text-moca-black tabular-nums">{stats.hits}</p>
                </div>
                <div>
                  <p className="text-xs text-moca-gray uppercase tracking-wide">Dai server</p>
                  <p className="text-3xl font-semibold text-moca-black tabular-nums">{stats.misses}</p>
                </div>
              </div>
              <div className="mt-4 h-2 rounded-full bg-moca-bg overflow-hidden" aria-hidden="true">
                <div className="h-full bg-chart-green rounded-full" style={{ width: `${hitRate}%` }} />
              </div>
              <ul className="mt-4 space-y-1 text-xs text-moca-text">
                {stats.lastHitAt && <li>Ultimo riuso: {formatDateTime(stats.lastHitAt)}</li>}
                {stats.lastMissAt && <li>Ultima lettura dai server: {formatDateTime(stats.lastMissAt)}</li>}
                <li className="flex items-center gap-1.5">
                  <ShieldAlert size={12} /> Chiamate bloccate dalla guardia: {stats.blocked}
                </li>
              </ul>
              {msg && <p className="text-xs text-chart-green mt-3">{msg}</p>}
            </>
          )}
        </Card>
      </div>

      <Card title="Modelli AI disponibili" subtitle="Chiavi del cliente configurate nell'Hub. Restano sul server, non arrivano mai al browser.">
        <div className="flex flex-wrap gap-2">
          {info.providers.length ? (
            info.providers.map((p) => (
              <Badge key={p} tone="green">
                <Server size={12} /> {PROVIDER_LABELS[p]}
              </Badge>
            ))
          ) : (
            <p className="text-sm text-moca-text">Nessuna chiave AI configurata: aggiungi ANTHROPIC_API_KEY nella scheda del cliente.</p>
          )}
        </div>
        {ai && ai.answers > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5">
            <div>
              <p className="text-xs text-moca-gray uppercase tracking-wide">Risposte</p>
              <p className="text-2xl font-semibold text-moca-black tabular-nums">{ai.answers.toLocaleString('it-IT')}</p>
            </div>
            <div>
              <p className="text-xs text-moca-gray uppercase tracking-wide">Costo stimato totale</p>
              <p className="text-2xl font-semibold text-moca-black tabular-nums">{formatUsd(ai.costUsd)}</p>
            </div>
            <div>
              <p className="text-xs text-moca-gray uppercase tracking-wide">Costo medio per risposta</p>
              <p className="text-2xl font-semibold text-moca-black tabular-nums">{formatUsd(ai.costUsd / ai.answers)}</p>
            </div>
            <div>
              <p className="text-xs text-moca-gray uppercase tracking-wide">Token in cache</p>
              <p className="text-2xl font-semibold text-moca-black tabular-nums">
                {Math.round((ai.cacheRead / Math.max(1, ai.input + ai.cacheRead + ai.cacheWrite)) * 100)}%
              </p>
            </div>
            <p className="col-span-full text-[11px] text-moca-gray">Stima ai prezzi di listino Anthropic; la fattura reale è nella Console Anthropic. I dati MCP non hanno costi a consumo per l'app.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
