import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CalendarRange,
  Coins,
  LayoutDashboard,
  LayoutTemplate,
  Merge,
  MessageSquareText,
  MousePointerClick,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { AddToDashboard } from '../components/AddToDashboard';
import { DataTable } from '../components/ChartView';
import { VizCard } from '../components/VizCard';
import { Button, ErrorNote, Field, Input, Modal, Select, Spinner } from '../components/ui';
import { useData } from '../lib/DataContext';
import { useMoca } from '../lib/MocaProvider';
import { addComputed, compileExpr, dateColumn, joinTables } from '../shared/engine';
import { formatUsd } from '../shared/pricing';
import {
  PLATFORM_LABELS,
  TIER_LABELS,
  type AiStats,
  type CacheStats,
  type Dataset,
  type DashboardFilters,
  type JoinKey,
  type JoinMode,
  type McpPlatform,
  type VizSpec,
  type VizType,
} from '../shared/types';

/**
 * Guida: quando usare cosa, con esempi dal vivo sui dati del cliente.
 * Ogni argomento si apre in un popup con spiegazione e prova reale.
 */

type TopicKey = 'chat' | 'default' | 'widget' | 'period' | 'join' | 'costs' | 'trust';

const TOPICS: { key: TopicKey; icon: LucideIcon; title: string; when: string }[] = [
  { key: 'default', icon: LayoutTemplate, title: 'Dashboard predefinita', when: 'Per partire subito: i grafici principali di ogni piattaforma, senza costi AI.' },
  { key: 'chat', icon: MessageSquareText, title: 'Chat con i dati', when: 'Per domande nuove, analisi e confronti che non hai ancora in dashboard.' },
  { key: 'widget', icon: MousePointerClick, title: 'Widget e griglia', when: 'Per costruire o sistemare una dashboard a mano, senza AI.' },
  { key: 'period', icon: CalendarRange, title: 'Periodo e filtri', when: 'Per vedere ogni grafico della dashboard su un altro periodo.' },
  { key: 'join', icon: Merge, title: 'Incrociare due fonti', when: 'Per mettere insieme dati di piattaforme diverse, es. query e conversioni.' },
  { key: 'costs', icon: Coins, title: 'Costi e modalità', when: 'Per capire quanto costa ogni risposta e come spendere meno.' },
  { key: 'trust', icon: ShieldCheck, title: 'Affidabilità dei dati', when: 'Per sapere da dove arriva un numero e quando è una stima.' },
];

const EXAMPLES: Partial<Record<McpPlatform, string[]>> = {
  ga4: ["Com'è andato il traffico negli ultimi 30 giorni, per canale?", 'Quali landing page portano più eventi chiave?'],
  search_console: ['Quali query non di brand portano più clic negli ultimi 30 giorni?', 'Quali pagine hanno molte impressioni ma CTR basso?'],
  meta_ads: ['Quali campagne Meta hanno il costo per lead migliore questo mese?'],
  google_ads: ['Costo e conversioni per campagna Google Ads negli ultimi 30 giorni.'],
  pinterest_ads: ['Andamento della spesa Pinterest negli ultimi 30 giorni.'],
};

const DEFAULT_CONTENT: Record<McpPlatform, string[]> = {
  ga4: ['Numeri chiave', 'Sessioni e utenti nel tempo', 'Sessioni per canale', 'Landing page principali'],
  search_console: ['Numeri chiave reali', 'Clic e impressioni nel tempo', 'Query principali', 'Pagine principali'],
  meta_ads: ['Numeri chiave', 'Spesa e clic nel tempo', 'Campagne con lead e acquisti'],
  google_ads: ['Numeri chiave', 'Costo e conversioni nel tempo', 'Campagne'],
  pinterest_ads: ['Numeri chiave', 'Spesa nel tempo'],
};

const QUERY_CONVERSIONS_PROMPT =
  'Quali query di Search Console portano più conversioni? Incrocia le query per pagina con le landing page organiche di GA4 (sessioni ed eventi chiave) e calcola le conversioni stimate per query negli ultimi 30 giorni.';

/** Grafico più adatto a un dataset: andamento se c'è una data, barre se c'è una categoria. */
function autoSpec(ds: Dataset, type?: VizType): VizSpec {
  const metric = ds.columns.find((c) => c.type === 'metric');
  const date = dateColumn(ds);
  const dim = ds.columns.find((c) => c.type === 'dimension');
  const t: VizType = type ?? (date ? 'line' : dim ? 'bar' : 'kpi');
  const x = t === 'kpi' ? undefined : t === 'line' || t === 'area' ? (date ?? dim)?.key : (dim ?? date)?.key;
  return { id: `guida-${ds.id}`, title: ds.title, type: t, datasetId: ds.id, ...(x ? { x } : {}), metrics: metric ? [metric.key] : [], filters: [] };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-moca-black">{title}</h3>
      <div className="text-sm text-moca-text space-y-2">{children}</div>
    </section>
  );
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc pl-5 space-y-1">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

function Live({ children, title = 'Prova dal vivo sui dati del cliente' }: { children: ReactNode; title?: string }) {
  return (
    <div className="rounded-xl bg-moca-bg p-4 space-y-3">
      <p className="text-xs font-bold uppercase tracking-wide text-moca-red flex items-center gap-1.5">
        <Sparkles size={13} /> {title}
      </p>
      {children}
    </div>
  );
}

/** Scelta di un dataset del cliente per le prove dal vivo. */
function useDatasetPick() {
  const { datasets, loadDataset } = useData();
  const [id, setId] = useState(datasets[0]?.id ?? '');
  const [ds, setDs] = useState<Dataset | null>(null);
  useEffect(() => {
    if (!id && datasets[0]) setId(datasets[0].id);
  }, [datasets, id]);
  useEffect(() => {
    if (id) loadDataset(id).then(setDs).catch(() => setDs(null));
  }, [id, loadDataset]);
  const select = (
    <Select value={id} onChange={(e) => setId(e.target.value)} className="!text-xs">
      {datasets.map((d) => (
        <option key={d.id} value={d.id}>
          {d.title}
        </option>
      ))}
    </Select>
  );
  return { ds, select, empty: !datasets.length };
}

function NoData({ onDefault }: { onDefault: () => void }) {
  return (
    <p className="text-sm text-moca-text">
      Non ci sono ancora dataset per questo cliente.{' '}
      <button type="button" className="font-semibold text-moca-black underline" onClick={onDefault}>
        Apri la dashboard predefinita
      </button>{' '}
      per crearne alcuni in pochi secondi.
    </p>
  );
}

export function GuideView({ onGoChat, onOpenDashboard }: { onGoChat: (prompt?: string) => void; onOpenDashboard: (id: string | null) => void }) {
  const [open, setOpen] = useState<TopicKey | null>(null);
  const topic = TOPICS.find((t) => t.key === open);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-medium text-moca-black uppercase tracking-wide">Guida</h1>
        <p className="text-sm text-moca-text mt-1">Quando usare cosa, con prove dal vivo sui dati di questo cliente. Apri un argomento.</p>
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {TOPICS.map(({ key, icon: Icon, title, when }) => (
          <button key={key} type="button" onClick={() => setOpen(key)} className="text-left bg-white rounded-xl shadow-card p-5 border border-transparent hover:border-moca-red transition group">
            <span className="h-9 w-9 rounded-lg bg-moca-black text-white flex items-center justify-center mb-3">
              <Icon size={18} />
            </span>
            <span className="block text-sm font-semibold uppercase tracking-wide text-moca-black">{title}</span>
            <span className="block text-sm text-moca-text mt-1">{when}</span>
            <span className="block text-xs font-semibold text-moca-red mt-3 group-hover:underline">Apri e prova</span>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-moca-black mb-3">In breve: cosa usare</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-moca-gray">
                <th className="py-2 pr-4">Ti serve</th>
                <th className="py-2 pr-4">Usa</th>
                <th className="py-2">Costo AI</th>
              </tr>
            </thead>
            <tbody className="text-moca-text">
              {[
                ['Una panoramica di tutte le piattaforme', 'Dashboard predefinita', 'Nessuno'],
                ['Gli stessi grafici su un altro periodo', 'Periodo nella barra dei filtri', 'Nessuno'],
                ['Spostare, allargare, cambiare un grafico', 'Widget e griglia', 'Nessuno'],
                ['Una risposta nuova o un confronto', 'Chat, modalità Bilanciata', 'Circa 0,05 $'],
                ['Una domanda semplice su una fonte', 'Chat, modalità Veloce', 'Circa 0,01 $'],
                ['Un\'analisi complessa tra più fonti', 'Chat, modalità Approfondita', 'Circa 0,15 $'],
                ['Unire due fonti (es. query e conversioni)', 'Incrocio nel widget o in chat', 'Nessuno nel widget'],
              ].map(([a, b, c]) => (
                <tr key={a} className="border-t border-moca-line">
                  <td className="py-2 pr-4">{a}</td>
                  <td className="py-2 pr-4 font-semibold text-moca-black">{b}</td>
                  <td className="py-2">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-moca-gray mt-2">Costi indicativi per risposta; quelli reali sono sotto ogni risposta in chat e in Perimetro e cache.</p>
      </div>

      {topic && (
        <Modal title={topic.title} onClose={() => setOpen(null)} wide>
          <div className="space-y-5">
            {open === 'default' && <DefaultTopic onOpenDashboard={(id) => { setOpen(null); onOpenDashboard(id); }} />}
            {open === 'chat' && <ChatTopic onGoChat={(p) => { setOpen(null); onGoChat(p); }} />}
            {open === 'widget' && <WidgetTopic onDefault={() => setOpen('default')} />}
            {open === 'period' && <PeriodTopic onDefault={() => setOpen('default')} />}
            {open === 'join' && <JoinTopic onGoChat={(p) => { setOpen(null); onGoChat(p); }} onDefault={() => setOpen('default')} />}
            {open === 'costs' && <CostsTopic />}
            {open === 'trust' && <TrustTopic />}
          </div>
        </Modal>
      )}
    </div>
  );
}

function DefaultTopic({ onOpenDashboard }: { onOpenDashboard: (id: string) => void }) {
  const { info } = useMoca();
  const { api, refreshDashboards, refreshDatasets } = useData();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: string; widgets: number; failed: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const platforms = info.mcpPlatforms;
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createDefaultDashboard();
      await Promise.all([refreshDashboards(), refreshDatasets()]);
      setResult({ id: r.dashboard.id, widgets: r.dashboard.widgets.length, failed: r.report.filter((x) => !x.ok).map((x) => `${x.title} (${x.reason})`) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Section title="Quando usarla">
        <Bullets items={['Per un cliente nuovo, o per avere subito il quadro di tutte le piattaforme.', 'Quando vuoi grafici affidabili senza spendere: non usa Claude, legge i dati con chiamate fisse.']} />
      </Section>
      <Section title="Cosa crea per questo cliente">
        <Bullets
          items={[
            ...platforms.map((p) => (
              <span key={p}>
                <strong className="text-moca-black">{PLATFORM_LABELS[p]}</strong>: {DEFAULT_CONTENT[p].join(', ')}.
              </span>
            )),
            ...(platforms.includes('ga4') && platforms.includes('search_console')
              ? [
                  <span key="cross">
                    <strong className="text-moca-black">Query × conversioni</strong>: le query di Search Console con le conversioni stimate dalle landing page organiche di GA4.
                  </span>,
                ]
              : []),
          ]}
        />
      </Section>
      <Live>
        {result ? (
          <div className="space-y-2">
            <p className="text-sm text-moca-black">Creati {result.widgets} grafici.</p>
            {!!result.failed.length && <ErrorNote>Non creati: {result.failed.join('; ')}.</ErrorNote>}
            <Button onClick={() => onOpenDashboard(result.id)}>
              <LayoutDashboard size={16} /> Apri la dashboard
            </Button>
          </div>
        ) : (
          <Button onClick={create} disabled={busy || !platforms.length}>
            {busy ? <Spinner size={4} /> : <LayoutTemplate size={16} />} Crea ora la dashboard predefinita
          </Button>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </Live>
    </>
  );
}

function ChatTopic({ onGoChat }: { onGoChat: (prompt: string) => void }) {
  const { info } = useMoca();
  const examples = [
    ...info.mcpPlatforms.flatMap((p) => EXAMPLES[p] ?? []),
    ...(info.mcpPlatforms.includes('ga4') && info.mcpPlatforms.includes('search_console') ? [QUERY_CONVERSIONS_PROMPT] : []),
  ];
  return (
    <>
      <Section title="Quando usarla">
        <Bullets
          items={[
            'Per una domanda che non ha ancora un grafico: un confronto, un perché, una lista filtrata.',
            'Per preparare grafici nuovi: ogni grafico creato in chat si aggiunge a una dashboard con un clic e segue il periodo.',
            'Non serve per rivedere gli stessi numeri su un altro periodo: per quello basta cambiare il periodo della dashboard.',
          ]}
        />
      </Section>
      <Section title="Come chiedere">
        <Bullets
          items={[
            'Indica fonte, metrica e periodo: "sessioni GA4 per canale negli ultimi 30 giorni".',
            'Per escludere qualcosa dillo in chiaro: "escludi le query con il nome del brand".',
            'Puoi continuare nella stessa conversazione: "e rispetto al mese precedente?".',
            'Scegli la modalità: Veloce per domande semplici, Bilanciata per l\'uso quotidiano, Approfondita per analisi tra più fonti.',
          ]}
        />
      </Section>
      <Live title="Prova una domanda (si apre in chat, pronta da inviare)">
        <div className="grid sm:grid-cols-2 gap-2">
          {examples.map((q) => (
            <button key={q} type="button" onClick={() => onGoChat(q)} className="text-left rounded-lg border border-moca-line bg-white px-3 py-2 text-xs text-moca-text hover:border-moca-red hover:text-moca-black transition">
              {q}
            </button>
          ))}
        </div>
      </Live>
    </>
  );
}

function WidgetTopic({ onDefault }: { onDefault: () => void }) {
  const { ds, select, empty } = useDatasetPick();
  const [type, setType] = useState<VizType>('bar');
  const [adding, setAdding] = useState<VizSpec | null>(null);
  const spec = useMemo(() => (ds ? autoSpec(ds, type) : null), [ds, type]);
  return (
    <>
      <Section title="Quando usarli">
        <Bullets
          items={[
            'Per costruire una dashboard a mano dai dataset già salvati, senza costi AI.',
            'Per spostare un grafico trascinalo dal titolo; per ridimensionarlo trascina l\'angolo in basso a destra. Fino a sei per riga.',
            'Con la matita apri l\'editor: tipo di grafico, metriche, filtri del widget, incrocio con un altro dataset, metriche calcolate.',
            'Un clic su una barra o una fetta filtra tutta la dashboard su quel valore.',
          ]}
        />
      </Section>
      <Live>
        {empty ? (
          <NoData onDefault={onDefault} />
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-2">
              <Field label="Dataset">{select}</Field>
              <Field label="Tipo di grafico">
                <Select value={type} onChange={(e) => setType(e.target.value as VizType)} className="!text-xs">
                  <option value="kpi">Numero chiave</option>
                  <option value="line">Linee</option>
                  <option value="bar">Barre</option>
                  <option value="hbar">Barre orizzontali</option>
                  <option value="table">Tabella</option>
                </Select>
              </Field>
            </div>
            {spec && spec.metrics.length > 0 && <VizCard spec={spec} height={220} />}
            {spec && (
              <Button size="sm" variant="secondary" onClick={() => setAdding(spec)}>
                <LayoutDashboard size={14} /> Aggiungi questo grafico a una dashboard
              </Button>
            )}
          </>
        )}
      </Live>
      {adding && <AddToDashboard spec={{ ...adding, id: `w-${Date.now()}` }} onClose={() => setAdding(null)} />}
    </>
  );
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => iso(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - n));

function PeriodTopic({ onDefault }: { onDefault: () => void }) {
  const { ds, select, empty } = useDatasetPick();
  const [preset, setPreset] = useState('30');
  const filters: DashboardFilters = useMemo(() => {
    const now = new Date();
    if (preset === 'all') return { dims: [] };
    if (preset === 'lm') return { dateFrom: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), dateTo: iso(new Date(now.getFullYear(), now.getMonth(), 0)), dims: [] };
    return { dateFrom: daysAgo(Number(preset) - 1), dateTo: iso(now), dims: [] };
  }, [preset]);
  const spec = useMemo(() => (ds ? autoSpec(ds) : null), [ds]);
  return (
    <>
      <Section title="Come funziona">
        <Bullets
          items={[
            'Il periodo scelto nella barra dei filtri vale per tutti i grafici della dashboard.',
            'Se i dati salvati coprono già il periodo, il grafico si filtra subito. Altrimenti il server rilegge i dati con la stessa chiamata e le nuove date; un periodo già letto arriva dalla cache.',
            'Ogni grafico dice se il periodo è applicato. I dati scritti a mano in chat non si possono rileggere: lo trovi segnalato in arancione, con il pulsante "Rendi filtrabile con l\'AI".',
          ]}
        />
      </Section>
      <Live title="Cambia periodo e guarda il grafico aggiornarsi">
        {empty ? (
          <NoData onDefault={onDefault} />
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-2">
              <Field label="Dataset">{select}</Field>
              <Field label="Periodo">
                <Select value={preset} onChange={(e) => setPreset(e.target.value)} className="!text-xs">
                  <option value="7">Ultimi 7 giorni</option>
                  <option value="30">Ultimi 30 giorni</option>
                  <option value="90">Ultimi 90 giorni</option>
                  <option value="lm">Mese scorso</option>
                  <option value="all">Tutto il periodo salvato</option>
                </Select>
              </Field>
            </div>
            {spec && spec.metrics.length > 0 && <VizCard spec={spec} filters={filters} height={220} />}
          </>
        )}
      </Live>
    </>
  );
}

function JoinTopic({ onGoChat, onDefault }: { onGoChat: (prompt: string) => void; onDefault: () => void }) {
  const { info } = useMoca();
  const { datasets, loadDataset } = useData();
  const [aId, setAId] = useState(datasets[0]?.id ?? '');
  const [bId, setBId] = useState(datasets[1]?.id ?? '');
  const [a, setA] = useState<Dataset | null>(null);
  const [b, setB] = useState<Dataset | null>(null);
  const [pair, setPair] = useState<JoinKey | null>(null);
  const [mode, setMode] = useState<JoinMode>('lookup');
  const [expr, setExpr] = useState('');
  const [adding, setAdding] = useState<VizSpec | null>(null);
  useEffect(() => {
    if (aId) loadDataset(aId).then(setA).catch(() => setA(null));
  }, [aId, loadDataset]);
  useEffect(() => {
    if (bId) loadDataset(bId).then(setB).catch(() => setB(null));
  }, [bId, loadDataset]);
  useEffect(() => {
    if (!a || !b) return;
    const da = a.columns.filter((c) => c.type !== 'metric');
    const db = b.columns.filter((c) => c.type !== 'metric');
    const same = da.find((c) => db.some((x) => x.key === c.key));
    const date = da.find((c) => c.type === 'date') && db.find((c) => c.type === 'date') ? { a: da.find((c) => c.type === 'date')!.key, b: db.find((c) => c.type === 'date')!.key } : null;
    const page = /(page|pagina|url|landing)/;
    const pageA = da.find((c) => page.test(c.key));
    const pageB = db.find((c) => page.test(c.key));
    const p = same ? { a: same.key, b: same.key } : date ?? (pageA && pageB ? { a: pageA.key, b: pageB.key } : da[0] && db[0] ? { a: da[0].key, b: db[0].key } : null);
    setPair(p);
    setMode(p && (page.test(p.a) || page.test(p.b)) ? 'lookup' : date && p?.a === date.a ? 'merge' : 'lookup');
  }, [a, b]);

  const result = useMemo(() => {
    if (!a || !b || !pair) return null;
    try {
      let t = joinTables(a, b, [pair], { a: a.title, b: b.title }, mode);
      let exprError: string | null = null;
      if (expr.trim()) {
        try {
          compileExpr(expr, t.columns.map((c) => c.key));
          t = addComputed(t, [{ key: 'calcolata', label: 'Calcolata', expr }]);
        } catch (e) {
          exprError = (e as Error).message;
        }
      }
      const bMetrics = t.columns.filter((c) => c.type === 'metric' && !a.columns.some((x) => x.key === c.key) && c.key !== 'calcolata').map((c) => c.key);
      const hit = t.rows.filter((r) => bMetrics.some((k) => r[k] !== null && r[k] !== undefined)).length;
      return { t, hit, exprError };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [a, b, pair, mode, expr]);

  const ok = result && !('error' in result);
  const spec: VizSpec | null =
    ok && a && b && pair
      ? {
          id: `incrocio-${a.id}-${b.id}`,
          title: `${a.title} + ${b.title}`,
          type: 'table',
          datasetId: a.id,
          join: { datasetId: b.id, on: [], pairs: [pair], mode },
          x: pair.a,
          metrics: (result as { t: { columns: { key: string; type: string }[] } }).t.columns.filter((c) => c.type === 'metric').slice(0, 5).map((c) => c.key),
          filters: [],
          ...(expr.trim() && !(result as { exprError: string | null }).exprError ? { computed: [{ key: 'calcolata', label: 'Calcolata', expr }] } : {}),
        }
      : null;

  return (
    <>
      <Section title="Due modi di incrociare">
        <Bullets
          items={[
            <span key="m">
              <strong className="text-moca-black">Unisci per valore</strong>: una riga per valore comune, sommando i due lati. Esempio: sessioni GA4 e spesa Meta giorno per giorno, sulla data.
            </span>,
            <span key="l">
              <strong className="text-moca-black">Aggiungi colonne</strong>: tieni le righe del primo dataset e aggiungi le metriche dell'altro dove il valore corrisponde. Esempio: query di Search Console per pagina + sessioni ed eventi chiave GA4 della stessa landing page.
            </span>,
            'Le colonne possono avere nomi diversi (pagina e landing page, date e date_start). Indirizzi, maiuscole e date si confrontano in forma normalizzata: https://sito.it/pagina/, /pagina e pagina coincidono.',
            'Con una metrica calcolata fai i conti riga per riga, es. conversioni stimate = clic * key_events / sessions.',
          ]}
        />
      </Section>
      <Section title="Query e conversioni: perché passare dalla pagina">
        <p>
          GA4 non conosce le query di ricerca e Search Console non conosce le conversioni. La chiave comune è la pagina: si prendono le query per pagina da Search Console, le landing page organiche da GA4, si incrociano sulla pagina e si ripartiscono le conversioni della pagina tra le sue query in base ai clic. È una <strong className="text-moca-black">stima</strong>, utile per capire quali query portano risultati.
        </p>
        {info.mcpPlatforms.includes('ga4') && info.mcpPlatforms.includes('search_console') && (
          <Button size="sm" variant="secondary" onClick={() => onGoChat(QUERY_CONVERSIONS_PROMPT)}>
            <MessageSquareText size={14} /> Chiedi in chat query × conversioni
          </Button>
        )}
      </Section>
      <Live>
        {datasets.length < 2 ? (
          <NoData onDefault={onDefault} />
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-2">
              <Field label="Primo dataset">
                <Select value={aId} onChange={(e) => setAId(e.target.value)} className="!text-xs">
                  {datasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Secondo dataset">
                <Select value={bId} onChange={(e) => setBId(e.target.value)} className="!text-xs">
                  {datasets
                    .filter((d) => d.id !== aId)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                </Select>
              </Field>
              {a && b && (
                <>
                  <Field label="Colonna del primo">
                    <Select value={pair?.a ?? ''} onChange={(e) => setPair({ a: e.target.value, b: pair?.b ?? '' })} className="!text-xs">
                      {a.columns
                        .filter((c) => c.type !== 'metric')
                        .map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                    </Select>
                  </Field>
                  <Field label="Colonna del secondo">
                    <Select value={pair?.b ?? ''} onChange={(e) => setPair({ a: pair?.a ?? '', b: e.target.value })} className="!text-xs">
                      {b.columns
                        .filter((c) => c.type !== 'metric')
                        .map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                    </Select>
                  </Field>
                  <Field label="Tipo di incrocio">
                    <Select value={mode} onChange={(e) => setMode(e.target.value as JoinMode)} className="!text-xs">
                      <option value="lookup">Aggiungi colonne</option>
                      <option value="merge">Unisci per valore</option>
                    </Select>
                  </Field>
                  <Field label="Metrica calcolata (facoltativa)">
                    <Input value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="es. clic * key_events / sessions" className="!text-xs font-mono" />
                  </Field>
                </>
              )}
            </div>
            {result && 'error' in result && <ErrorNote>{result.error}</ErrorNote>}
            {result && !('error' in result) && (
              <>
                <p className={`text-xs ${result.hit ? 'text-chart-green' : 'text-amber-700'}`}>
                  {result.hit ? `${result.hit} righe su ${result.t.rows.length} trovano una corrispondenza.` : 'Nessuna corrispondenza: prova altre colonne.'}
                  {result.exprError ? ` Formula: ${result.exprError}` : ''}
                </p>
                <DataTable columns={result.t.columns} rows={result.t.rows.slice(0, 8)} currency={info.scope?.currency ?? 'EUR'} maxHeight={260} />
                {spec && (
                  <Button size="sm" variant="secondary" onClick={() => setAdding(spec)}>
                    <LayoutDashboard size={14} /> Aggiungi questo incrocio a una dashboard
                  </Button>
                )}
              </>
            )}
          </>
        )}
      </Live>
      {adding && <AddToDashboard spec={adding} onClose={() => setAdding(null)} />}
    </>
  );
}

function CostsTopic() {
  const { api } = useData();
  const [ai, setAi] = useState<AiStats | null>(null);
  const [cache, setCache] = useState<CacheStats | null>(null);
  useEffect(() => {
    api
      .info()
      .then((r) => {
        setAi(r.ai ?? null);
        setCache(r.stats);
      })
      .catch(() => undefined);
  }, [api]);
  const hits = cache ? cache.hits : 0;
  const total = cache ? cache.hits + cache.misses : 0;
  return (
    <>
      <Section title="Da cosa dipende il costo">
        <Bullets
          items={[
            'Si paga solo Claude, in base ai testi che legge e scrive. Le chiamate ai server dei dati, la dashboard predefinita, i filtri, il periodo e i widget non hanno costi AI.',
            'Il contesto fisso (istruzioni e strumenti) resta in cache per un\'ora: dalla seconda domanda costa circa un decimo.',
            'I dati già letti non si rileggono: una domanda ripetuta o un periodo già visto arrivano dalla cache.',
          ]}
        />
      </Section>
      <Section title="Le tre modalità della chat">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-moca-gray">
                <th className="py-2 pr-4">Modalità</th>
                <th className="py-2 pr-4">Modello</th>
                <th className="py-2 pr-4">Quando</th>
                <th className="py-2">Costo indicativo</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['fast', 'circa 0,01 $'],
                  ['balanced', 'circa 0,05 $'],
                  ['deep', 'circa 0,15 $'],
                ] as const
              ).map(([t, cost]) => (
                <tr key={t} className="border-t border-moca-line">
                  <td className="py-2 pr-4 font-semibold text-moca-black">{TIER_LABELS[t].label}</td>
                  <td className="py-2 pr-4">{TIER_LABELS[t].model}</td>
                  <td className="py-2 pr-4">{TIER_LABELS[t].hint}</td>
                  <td className="py-2">{cost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Live title="Consumi reali di questo cliente">
        {ai && ai.answers ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-moca-gray uppercase tracking-wide">Risposte</p>
              <p className="text-2xl font-semibold text-moca-black tabular-nums">{ai.answers}</p>
            </div>
            <div>
              <p className="text-xs text-moca-gray uppercase tracking-wide">Costo totale</p>
              <p className="text-2xl font-semibold text-moca-black tabular-nums">{formatUsd(ai.costUsd)}</p>
            </div>
            <div>
              <p className="text-xs text-moca-gray uppercase tracking-wide">Medio per risposta</p>
              <p className="text-2xl font-semibold text-moca-black tabular-nums">{formatUsd(ai.costUsd / ai.answers)}</p>
            </div>
            <div>
              <p className="text-xs text-moca-gray uppercase tracking-wide">Dati dalla cache</p>
              <p className="text-2xl font-semibold text-moca-black tabular-nums">{total ? Math.round((hits / total) * 100) : 0}%</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-moca-text">Nessuna risposta in chat ancora: i costi reali compariranno qui.</p>
        )}
      </Live>
    </>
  );
}

function TrustTopic() {
  const { info } = useMoca();
  const { datasets } = useData();
  const recipes = datasets.filter((d) => d.sourceTable || d.derivedFrom).length;
  const manual = datasets.length - recipes;
  return (
    <>
      <Section title="Da dove arrivano i numeri">
        <Bullets
          items={[
            'Ogni dato arriva dai server MCP di Moca, solo per gli account del cliente elencati nel perimetro. Le richieste verso altri account vengono rifiutate prima di partire.',
            'Il server trasforma le risposte in tabelle e Claude lavora su quelle: non ricopia i numeri, quindi non li può sbagliare trascrivendoli.',
            'I totali di GA4 e Search Console sono quelli calcolati dalla piattaforma: per le somme fanno fede quelli, non la somma delle righe.',
            'Le metriche calcolate e le conversioni stimate per query sono stime: lo dice il nome del dataset o la nota del grafico.',
          ]}
        />
      </Section>
      <Live title="Stato dei dataset di questo cliente">
        <p className="text-sm text-moca-text">
          {datasets.length} dataset: <strong className="text-moca-black">{recipes} filtrabili per periodo</strong>
          {manual ? `, ${manual} scritti a mano in chat (si possono rendere filtrabili dal grafico)` : ''}.
        </p>
        <p className="text-sm text-moca-text">
          Account nel perimetro: {info.scope?.accounts.map((acc) => `${PLATFORM_LABELS[acc.platform]} ${acc.id}`).join(', ') || 'nessuno'}.
        </p>
      </Live>
    </>
  );
}
