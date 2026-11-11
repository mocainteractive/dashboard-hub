import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarCheck, CalendarX, Check, Copy, GripVertical, LayoutDashboard, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { FilterBar } from '../components/FilterBar';
import { VizCard } from '../components/VizCard';
import { WidgetEditor } from '../components/WidgetEditor';
import { WidgetGrid } from '../components/WidgetGrid';
import { COLS_FOR_W, DRAG_CLASS } from '../lib/grid';
import { Button, EmptyState, ErrorNote, IconButton, Input, Spinner } from '../components/ui';
import { useData } from '../lib/DataContext';
import { formatDateTime, newLocalId } from '../lib/format';
import { GRID_COLS, type Cell, type Dashboard, type DashboardWidget, type PeriodStatus, type WidgetLayout } from '../shared/types';

/** Dashboard del cliente: elenco, filtri globali, griglia di widget, editor. */

/** Ultima versione di ogni dashboard modificata in questa sessione (sopravvive al cambio di scheda). */
const drafts = new Map<string, Dashboard>();

/** Riepilogo: a quanti widget è applicato il periodo scelto. */
function PeriodSummary({ statuses, titles }: { statuses: Record<string, PeriodStatus | null>; titles: Record<string, string> }) {
  const entries = Object.entries(statuses);
  if (!entries.length || entries.some(([, s]) => s === null)) return null;
  if (entries.every(([, s]) => s?.kind === 'none')) return null;
  const fixed = entries.filter(([, s]) => s?.kind === 'fixed');
  const applied = entries.length - fixed.length;
  if (!fixed.length) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-chart-green -mt-3 mb-4">
        <CalendarCheck size={14} /> Periodo applicato a tutti i {entries.length} widget.
      </p>
    );
  }
  return (
    <p className="flex items-start gap-1.5 text-xs text-amber-700 -mt-3 mb-4">
      <CalendarX size={14} className="shrink-0 mt-px" />
      <span>
        Periodo applicato a {applied} widget su {entries.length}. Non applicato a: {fixed.map(([id]) => titles[id] ?? 'widget').join(', ')}.
      </span>
    </p>
  );
}

export function DashboardsView({ openId, onOpen, onGoChat }: { openId: string | null; onOpen: (id: string | null) => void; onGoChat: (prompt?: string) => void }) {
  const { api, dashboards, refreshDashboards, datasets } = useData();
  const [current, setCurrent] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [editing, setEditing] = useState<DashboardWidget | 'new' | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [periods, setPeriods] = useState<Record<string, PeriodStatus | null>>({});
  const saveTimer = useRef<number>();

  const selectedId = openId ?? dashboards[0]?.id ?? null;

  useEffect(() => {
    if (!selectedId) {
      setCurrent(null);
      return;
    }
    if (current?.id === selectedId) return;
    // Modifiche fatte in questa sessione: si riparte da lì, senza aspettare il server.
    const draft = drafts.get(selectedId);
    if (draft) {
      setCurrent(draft);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .getDashboard(selectedId)
      .then(setCurrent)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, api]);

  const pending = useRef<Dashboard | null>(null);
  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    const d = pending.current;
    pending.current = null;
    if (!d) return;
    try {
      const saved = await api.saveDashboard(d);
      setCurrent((c) => (c?.id === saved.id ? { ...c, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy } : c));
      setSaveState('saved');
      refreshDashboards();
    } catch (e) {
      setError((e as Error).message);
      setSaveState('idle');
    }
  }, [api, refreshDashboards]);

  const persist = useCallback(
    (d: Dashboard) => {
      setCurrent(d);
      drafts.set(d.id, d);
      pending.current = d;
      setSaveState('saving');
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(flush, 700);
    },
    [flush],
  );

  // Cambio di scheda con un salvataggio in attesa: si salva subito.
  useEffect(() => () => void flush(), [flush]);

  const create = async () => {
    const d = await api.saveDashboard({ title: 'Nuova dashboard', widgets: [], filters: { dims: [] } });
    await refreshDashboards();
    setCurrent(d);
    onOpen(d.id);
  };

  const remove = async () => {
    if (!current || !window.confirm(`Eliminare la dashboard "${current.title}"?`)) return;
    try {
      await api.deleteDashboard(current.id);
      drafts.delete(current.id);
      setCurrent(null);
      onOpen(null);
      await refreshDashboards();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const crossFilter = (column: string, value: Cell) => {
    if (!current || value === null) return;
    const dims = current.filters.dims.filter((f) => f.column !== column);
    const already = current.filters.dims.some((f) => f.column === column && f.value === value);
    persist({ ...current, filters: { ...current.filters, dims: already ? dims : [...dims, { column, op: 'eq', value }] } });
  };

  const commitLayout = (layouts: Record<string, WidgetLayout>) => {
    if (!current) return;
    const changed = current.widgets.some((w) => {
      const l = layouts[w.id];
      return l && (!w.layout || l.x !== w.layout.x || l.y !== w.layout.y || l.w !== w.layout.w || l.h !== w.layout.h);
    });
    if (changed) persist({ ...current, widgets: current.widgets.map((w) => (layouts[w.id] ? { ...w, layout: layouts[w.id] } : w)) });
  };

  // Stati del periodo solo per i widget presenti (dopo una rimozione o un cambio di dashboard).
  const widgetIds = current?.widgets.map((w) => w.id).join(',') ?? '';
  useEffect(() => {
    const ids = new Set(widgetIds.split(',').filter(Boolean));
    setPeriods((p) => Object.fromEntries(Object.entries(p).filter(([id]) => ids.has(id))));
  }, [widgetIds]);
  const reportPeriod = useCallback((id: string, s: PeriodStatus | null) => setPeriods((p) => (p[id] === s ? p : { ...p, [id]: s })), []);

  const upsertWidget = (w: DashboardWidget) => {
    if (!current) return;
    const prev = current.widgets.find((x) => x.id === w.id);
    // Larghezza cambiata dall'editor: si aggiorna anche la posizione nella griglia.
    let layout = prev?.layout;
    if (prev?.layout && prev.w !== w.w) {
      const cols = COLS_FOR_W[w.w];
      layout = { ...prev.layout, w: cols, x: Math.min(prev.layout.x, GRID_COLS - cols) };
    }
    const next = { ...w, ...(layout ? { layout } : {}) };
    persist({ ...current, widgets: prev ? current.widgets.map((x) => (x.id === w.id ? next : x)) : [...current.widgets, next] });
    setEditing(null);
  };

  return (
    <div className="grid lg:grid-cols-[220px_1fr] gap-6">
      <aside className="space-y-2">
        <Button className="w-full" onClick={create}>
          <Plus size={16} /> Nuova dashboard
        </Button>
        <nav className="bg-white rounded-xl shadow-card p-2 space-y-1 max-h-[60vh] overflow-y-auto scrollbar-thin">
          {!dashboards.length && <p className="text-xs text-moca-gray p-2">Ancora nessuna dashboard.</p>}
          {dashboards.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onOpen(d.id)}
              className={`w-full text-left rounded-md px-3 py-2 text-sm transition border ${d.id === selectedId ? 'bg-moca-red-light text-moca-red border-moca-red' : 'border-transparent text-moca-black hover:bg-gray-100'}`}
            >
              <span className="block font-medium truncate">{d.title}</span>
              <span className={`block text-[11px] ${d.id === selectedId ? 'text-moca-red/80' : 'text-moca-gray'}`}>{d.widgetCount} widget · {formatDateTime(d.updatedAt)}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="min-w-0">
        {error && (
          <div className="mb-4">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
        {loading && (
          <div className="flex justify-center py-24">
            <Spinner />
          </div>
        )}
        {!loading && !current && (
          <div className="bg-white rounded-xl shadow-card">
            <EmptyState
              icon={<LayoutDashboard size={22} />}
              title="Crea la prima dashboard"
              text="Le dashboard raccolgono i grafici dei dati del cliente. Puoi costruirle a mano dai dataset oppure chiedere all'assistente AI di preparare le visualizzazioni."
              action={
                <div className="flex gap-2 justify-center">
                  <Button onClick={create}>
                    <Plus size={16} /> Nuova dashboard
                  </Button>
                  <Button variant="secondary" onClick={() => onGoChat()}>
                    <Sparkles size={16} /> Chiedi all'AI
                  </Button>
                </div>
              }
            />
          </div>
        )}
        {!loading && current && (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                {renaming ? (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setRenaming(false);
                    }}
                  >
                    <Input autoFocus value={current.title} maxLength={120} onChange={(e) => persist({ ...current, title: e.target.value })} className="!text-lg !py-1" />
                    <IconButton label="Conferma" type="submit">
                      <Check size={18} />
                    </IconButton>
                  </form>
                ) : (
                  <h1 className="text-2xl font-medium text-moca-black uppercase tracking-wide flex items-center gap-2">
                    <span className="truncate">{current.title}</span>
                    <IconButton label="Rinomina" onClick={() => setRenaming(true)}>
                      <Pencil size={16} />
                    </IconButton>
                  </h1>
                )}
                <p className="text-xs text-moca-gray mt-1">
                  {saveState === 'saving' ? 'Salvataggio in corso' : `Aggiornata il ${formatDateTime(current.updatedAt)} da ${current.updatedBy}`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setEditing('new')} disabled={!datasets.length}>
                  <Plus size={16} /> Widget
                </Button>
                <Button variant="ghost" onClick={remove}>
                  <Trash2 size={16} /> <span className="hidden sm:inline">Elimina</span>
                </Button>
              </div>
            </div>

            <FilterBar value={current.filters} onChange={(filters) => persist({ ...current, filters })} datasetIds={[...new Set(current.widgets.flatMap((w) => [w.spec.datasetId, w.spec.join?.datasetId ?? '']))]} />
            <PeriodSummary statuses={periods} titles={Object.fromEntries(current.widgets.map((w) => [w.id, w.spec.title]))} />

            {!current.widgets.length ? (
              <div className="bg-white rounded-xl shadow-card">
                <EmptyState
                  icon={<Plus size={22} />}
                  title="Dashboard vuota"
                  text={datasets.length ? 'Aggiungi un widget scegliendo un dataset, oppure aggiungi qui i grafici creati in chat.' : "Non ci sono ancora dataset: chiedi all'assistente AI di leggere i dati del cliente."}
                  action={
                    datasets.length ? (
                      <Button onClick={() => setEditing('new')}>
                        <Plus size={16} /> Aggiungi widget
                      </Button>
                    ) : (
                      <Button onClick={() => onGoChat()}>
                        <Sparkles size={16} /> Vai alla chat
                      </Button>
                    )
                  }
                />
              </div>
            ) : (
              <>
              <WidgetGrid widgets={current.widgets} onLayoutCommit={commitLayout}>
                {(w) => (
                  <VizCard
                    spec={w.spec}
                    filters={current.filters}
                    className="h-full"
                    fill
                    dragClass={`${DRAG_CLASS} cursor-move`}
                    onCrossFilter={crossFilter}
                    onPeriodStatus={(st) => reportPeriod(w.id, st)}
                    onRebuild={(prompt) => onGoChat(prompt)}
                    actions={
                      <>
                        <span className={`${DRAG_CLASS} p-1.5 rounded-md text-moca-gray hover:text-moca-black hover:bg-gray-100 cursor-move`} title="Trascina per spostare" aria-label="Sposta il widget" role="button">
                          <GripVertical size={16} />
                        </span>
                        <IconButton label="Modifica" onClick={() => setEditing(w)}>
                          <Pencil size={16} />
                        </IconButton>
                        <IconButton label="Duplica" onClick={() => persist({ ...current, widgets: [...current.widgets, { ...w, id: newLocalId(), layout: undefined, spec: { ...w.spec, id: newLocalId(), title: `${w.spec.title} (copia)` } }] })}>
                          <Copy size={16} />
                        </IconButton>
                        <IconButton label="Rimuovi" onClick={() => persist({ ...current, widgets: current.widgets.filter((x) => x.id !== w.id) })}>
                          <Trash2 size={16} />
                        </IconButton>
                      </>
                    }
                  />
                )}
              </WidgetGrid>
              <p className="text-[11px] text-moca-gray mt-3">Trascina un widget dal titolo per spostarlo, dall'angolo in basso a destra per ridimensionarlo: puoi affiancarne fino a sei per riga.</p>
              </>
            )}
          </>
        )}
      </div>

      {editing && <WidgetEditor initial={editing === 'new' ? undefined : editing} onSave={upsertWidget} onClose={() => setEditing(null)} />}
    </div>
  );
}
