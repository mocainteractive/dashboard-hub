import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarCheck, CalendarX, Check, Copy, GripVertical, LayoutDashboard, MoveHorizontal, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FilterBar } from '../components/FilterBar';
import { VizCard } from '../components/VizCard';
import { WidgetEditor } from '../components/WidgetEditor';
import { Button, EmptyState, ErrorNote, IconButton, Input, Spinner } from '../components/ui';
import { useData } from '../lib/DataContext';
import { formatDateTime, newLocalId } from '../lib/format';
import type { Cell, Dashboard, DashboardWidget, PeriodStatus } from '../shared/types';

/** Dashboard del cliente: elenco, filtri globali, griglia di widget, editor. */

const SPAN: Record<1 | 2 | 3, string> = { 1: 'lg:col-span-1', 2: 'lg:col-span-2', 3: 'lg:col-span-3' };
const NEXT_W: Record<1 | 2 | 3, 1 | 2 | 3> = { 1: 2, 2: 3, 3: 1 };
const W_LABEL: Record<1 | 2 | 3, string> = { 1: 'un terzo', 2: 'due terzi', 3: 'tutta la riga' };

type HandleProps = Record<string, unknown>;

/** Widget trascinabile: si sposta con la maniglia, così il clic sul grafico resta un filtro. */
function SortableWidget({ id, className, children }: { id: string; className: string; children: (handle: HandleProps, dragging: boolean) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`${className} min-w-0 ${isDragging ? 'relative z-20 opacity-80 ring-2 ring-moca-red rounded-xl' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {children({ ...attributes, ...listeners, ref: setActivatorNodeRef }, isDragging)}
    </div>
  );
}

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

export function DashboardsView({ openId, onOpen, onGoChat }: { openId: string | null; onOpen: (id: string | null) => void; onGoChat: () => void }) {
  const { api, dashboards, refreshDashboards, datasets } = useData();
  const [current, setCurrent] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [editing, setEditing] = useState<DashboardWidget | 'new' | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [periods, setPeriods] = useState<Record<string, PeriodStatus | null>>({});
  const saveTimer = useRef<number>();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const selectedId = openId ?? dashboards[0]?.id ?? null;

  useEffect(() => {
    if (!selectedId) {
      setCurrent(null);
      return;
    }
    if (current?.id === selectedId) return;
    setLoading(true);
    setError(null);
    api
      .getDashboard(selectedId)
      .then(setCurrent)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, api]);

  const persist = useCallback(
    (d: Dashboard) => {
      setCurrent(d);
      setSaveState('saving');
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async () => {
        try {
          const saved = await api.saveDashboard(d);
          setCurrent((c) => (c?.id === saved.id ? { ...c, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy } : c));
          setSaveState('saved');
          refreshDashboards();
        } catch (e) {
          setError((e as Error).message);
          setSaveState('idle');
        }
      }, 700);
    },
    [api, refreshDashboards],
  );

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

  const onDragEnd = (e: DragEndEvent) => {
    if (!current || !e.over || e.active.id === e.over.id) return;
    const from = current.widgets.findIndex((w) => w.id === e.active.id);
    const to = current.widgets.findIndex((w) => w.id === e.over!.id);
    if (from < 0 || to < 0) return;
    persist({ ...current, widgets: arrayMove(current.widgets, from, to) });
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
    const exists = current.widgets.some((x) => x.id === w.id);
    persist({ ...current, widgets: exists ? current.widgets.map((x) => (x.id === w.id ? w : x)) : [...current.widgets, w] });
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
                  <Button variant="secondary" onClick={onGoChat}>
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
                      <Button onClick={onGoChat}>
                        <Sparkles size={16} /> Vai alla chat
                      </Button>
                    )
                  }
                />
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={current.widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                    {current.widgets.map((w) => (
                      <SortableWidget key={w.id} id={w.id} className={SPAN[w.w]}>
                        {(handle) => (
                          <VizCard
                            spec={w.spec}
                            filters={current.filters}
                            className="h-full"
                            height={w.w === 1 ? 220 : 260}
                            onCrossFilter={crossFilter}
                            onPeriodStatus={(st) => reportPeriod(w.id, st)}
                            actions={
                              <>
                                <button
                                  type="button"
                                  {...handle}
                                  aria-label="Sposta il widget"
                                  title="Trascina per spostare"
                                  className="p-1.5 rounded-md text-moca-gray hover:text-moca-black hover:bg-gray-100 cursor-grab active:cursor-grabbing touch-none"
                                >
                                  <GripVertical size={16} />
                                </button>
                                <IconButton label={`Larghezza: ${W_LABEL[w.w]}`} className="hidden lg:inline-flex" onClick={() => persist({ ...current, widgets: current.widgets.map((x) => (x.id === w.id ? { ...x, w: NEXT_W[x.w] } : x)) })}>
                                  <MoveHorizontal size={16} />
                                </IconButton>
                                <IconButton label="Modifica" onClick={() => setEditing(w)}>
                                  <Pencil size={16} />
                                </IconButton>
                                <IconButton label="Duplica" onClick={() => persist({ ...current, widgets: [...current.widgets, { ...w, id: newLocalId(), spec: { ...w.spec, id: newLocalId(), title: `${w.spec.title} (copia)` } }] })}>
                                  <Copy size={16} />
                                </IconButton>
                                <IconButton label="Rimuovi" onClick={() => persist({ ...current, widgets: current.widgets.filter((x) => x.id !== w.id) })}>
                                  <Trash2 size={16} />
                                </IconButton>
                              </>
                            }
                          />
                        )}
                      </SortableWidget>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </>
        )}
      </div>

      {editing && <WidgetEditor initial={editing === 'new' ? undefined : editing} onSave={upsertWidget} onClose={() => setEditing(null)} />}
    </div>
  );
}
