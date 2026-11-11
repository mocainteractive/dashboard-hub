import { useEffect, useMemo, useState } from 'react';
import { AreaChart, BarChart3, BarChartHorizontal, Gauge, LineChart, Merge, PieChart, Plus, ScatterChart, Table2, Trash2, Layers } from 'lucide-react';
import { useData, useVizTable } from '../lib/DataContext';
import { useMoca } from '../lib/MocaProvider';
import { newLocalId } from '../lib/format';
import { distinctValues } from '../shared/engine';
import type { Agg, DashboardWidget, Dataset, Filter, VizSpec, VizType } from '../shared/types';
import { ChartView } from './ChartView';
import { Button, Field, IconButton, Input, Modal, Select, Spinner } from './ui';

/** Editor visuale di un widget: dataset, incrocio, tipo, assi, metriche, filtri. */

const VIZ_OPTIONS: { type: VizType; label: string; icon: typeof LineChart }[] = [
  { type: 'kpi', label: 'Numero chiave', icon: Gauge },
  { type: 'line', label: 'Linee', icon: LineChart },
  { type: 'area', label: 'Aree', icon: AreaChart },
  { type: 'bar', label: 'Barre', icon: BarChart3 },
  { type: 'hbar', label: 'Barre orizzontali', icon: BarChartHorizontal },
  { type: 'stacked', label: 'Barre impilate', icon: Layers },
  { type: 'pie', label: 'Ciambella', icon: PieChart },
  { type: 'scatter', label: 'Dispersione', icon: ScatterChart },
  { type: 'table', label: 'Tabella', icon: Table2 },
];

const AGG_LABELS: Record<Agg, string> = { sum: 'Somma', avg: 'Media', min: 'Minimo', max: 'Massimo', count: 'Conteggio' };

export function WidgetEditor({ initial, onSave, onClose, showWidth = true }: { initial?: DashboardWidget; onSave: (w: DashboardWidget) => void; onClose: () => void; showWidth?: boolean }) {
  const { datasets, loadDataset } = useData();
  const { info } = useMoca();
  const [spec, setSpec] = useState<VizSpec>(
    initial?.spec ?? { id: newLocalId(), title: '', type: 'line', datasetId: datasets[0]?.id ?? '', metrics: [], filters: [] },
  );
  const [w, setW] = useState<1 | 2 | 3>(initial?.w ?? 2);
  const [joinData, setJoinData] = useState<Dataset | null>(null);
  const [baseData, setBaseData] = useState<Dataset | null>(null);
  const { table, loading } = useVizTable(spec);

  useEffect(() => {
    if (spec.datasetId) loadDataset(spec.datasetId).then(setBaseData).catch(() => setBaseData(null));
  }, [spec.datasetId, loadDataset]);
  useEffect(() => {
    if (spec.join?.datasetId) loadDataset(spec.join.datasetId).then(setJoinData).catch(() => setJoinData(null));
    else setJoinData(null);
  }, [spec.join?.datasetId, loadDataset]);

  const columns = table?.columns ?? [];
  const dims = columns.filter((c) => c.type !== 'metric');
  const metrics = columns.filter((c) => c.type === 'metric');
  const commonKeys = useMemo(() => {
    if (!baseData || !joinData) return [];
    return baseData.columns.filter((c) => c.type !== 'metric' && joinData.columns.some((j) => j.key === c.key)).map((c) => c.key);
  }, [baseData, joinData]);

  const set = (patch: Partial<VizSpec>) => setSpec((s) => ({ ...s, ...patch }));
  const toggleMetric = (k: string) => set({ metrics: spec.metrics.includes(k) ? spec.metrics.filter((m) => m !== k) : [...spec.metrics, k].slice(0, 6) });
  const filters = spec.filters ?? [];
  const setFilter = (i: number, f: Filter) => set({ filters: filters.map((x, j) => (j === i ? f : x)) });

  const needsX = spec.type !== 'kpi';
  const valid = !!spec.datasetId && spec.metrics.length > 0 && (!needsX || spec.type === 'table' || !!spec.x) && (spec.type !== 'scatter' || spec.metrics.length >= 2);

  const chooseDataset = (id: string) => setSpec((s) => ({ ...s, datasetId: id, join: undefined, x: undefined, seriesBy: undefined, metrics: [], filters: [] }));

  return (
    <Modal
      title={initial ? 'Modifica widget' : 'Nuovo widget'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annulla
          </Button>
          <Button disabled={!valid} onClick={() => onSave({ id: initial?.id ?? newLocalId(), spec: { ...spec, title: spec.title.trim() || 'Grafico' }, w })}>
            Salva widget
          </Button>
        </>
      }
    >
      <div className="grid lg:grid-cols-[minmax(0,360px)_1fr] gap-6">
        <div className="space-y-4">
          <Field label="Titolo">
            <Input value={spec.title} onChange={(e) => set({ title: e.target.value })} placeholder="Es. Sessioni per canale" maxLength={120} />
          </Field>
          <Field label="Dataset">
            <Select value={spec.datasetId} onChange={(e) => chooseDataset(e.target.value)}>
              {!datasets.length && <option value="">Nessun dataset: creane uno dalla chat</option>}
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </Select>
          </Field>

          <div className="rounded-lg border border-moca-line p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-moca-black flex items-center gap-1.5">
                <Merge size={14} /> Incrocia con un altro dataset
              </span>
              {spec.join && (
                <IconButton label="Rimuovi incrocio" onClick={() => set({ join: undefined, metrics: spec.metrics.filter((m) => baseData?.columns.some((c) => c.key === m)) })}>
                  <Trash2 size={14} />
                </IconButton>
              )}
            </div>
            <Select value={spec.join?.datasetId ?? ''} onChange={(e) => set({ join: e.target.value ? { datasetId: e.target.value, on: [] } : undefined })}>
              <option value="">Nessun incrocio</option>
              {datasets
                .filter((d) => d.id !== spec.datasetId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
            </Select>
            {spec.join && (
              <Field label="Colonna comune" help={commonKeys.length ? 'Le righe vengono unite su questa colonna.' : 'I due dataset non hanno colonne in comune.'}>
                <Select value={spec.join.on[0] ?? ''} onChange={(e) => set({ join: { ...spec.join!, on: e.target.value ? [e.target.value] : [] } })}>
                  <option value="">Scegli</option>
                  {commonKeys.map((k) => (
                    <option key={k} value={k}>
                      {baseData?.columns.find((c) => c.key === k)?.label ?? k}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          <div>
            <span className="block text-xs font-semibold text-moca-black uppercase tracking-wide mb-2">Tipo di grafico</span>
            <div className="grid grid-cols-3 gap-2">
              {VIZ_OPTIONS.map(({ type, label, icon: Icon }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => set({ type })}
                  className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[11px] transition ${spec.type === type ? 'bg-moca-red-light text-moca-red border-moca-red' : 'border-moca-line text-moca-text hover:bg-gray-50'}`}
                >
                  <Icon size={18} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {needsX && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={spec.type === 'scatter' ? 'Etichetta punti' : 'Asse X'}>
                <Select value={spec.x ?? ''} onChange={(e) => set({ x: e.target.value || undefined })}>
                  <option value="">Scegli</option>
                  {dims.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {['line', 'area', 'bar', 'stacked', 'hbar'].includes(spec.type) && (
                <Field label="Dividi per">
                  <Select value={spec.seriesBy ?? ''} onChange={(e) => set({ seriesBy: e.target.value || undefined })}>
                    <option value="">Nessuna divisione</option>
                    {dims
                      .filter((c) => c.key !== spec.x && c.type === 'dimension')
                      .map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                  </Select>
                </Field>
              )}
            </div>
          )}

          <div>
            <span className="block text-xs font-semibold text-moca-black uppercase tracking-wide mb-2">Metriche{spec.seriesBy ? ' (la prima viene divisa)' : ''}</span>
            <div className="flex flex-wrap gap-1.5">
              {loading && <Spinner size={4} />}
              {metrics.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => toggleMetric(c.key)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition ${spec.metrics.includes(c.key) ? 'bg-moca-black text-white border-moca-black' : 'border-gray-300 text-moca-text hover:border-moca-black'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Aggregazione">
              <Select value={spec.agg ?? ''} onChange={(e) => set({ agg: (e.target.value || undefined) as Agg | undefined })}>
                <option value="">Automatica</option>
                {(Object.keys(AGG_LABELS) as Agg[]).map((a) => (
                  <option key={a} value={a}>
                    {AGG_LABELS[a]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Periodo">
              <Select value={spec.dateGrain ?? 'day'} onChange={(e) => set({ dateGrain: e.target.value as VizSpec['dateGrain'] })}>
                <option value="day">Giorno</option>
                <option value="week">Settimana</option>
                <option value="month">Mese</option>
              </Select>
            </Field>
            <Field label="Limite">
              <Input type="number" min={0} max={500} value={spec.limit ?? ''} onChange={(e) => set({ limit: Number(e.target.value) || undefined })} placeholder="Tutte" />
            </Field>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-moca-black">Filtri del widget</span>
              <Button size="sm" variant="ghost" onClick={() => set({ filters: [...filters, { column: dims.find((d) => d.type === 'dimension')?.key ?? '', op: 'eq', value: '' }] })} disabled={!dims.length}>
                <Plus size={14} /> Aggiungi
              </Button>
            </div>
            {filters.map((f, i) => (
              <div key={i} className="flex gap-1.5 items-center">
                <Select value={f.column} onChange={(e) => setFilter(i, { ...f, column: e.target.value, value: '' })} className="!py-1.5 text-xs">
                  {columns.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </Select>
                <Select value={f.op} onChange={(e) => setFilter(i, { ...f, op: e.target.value as Filter['op'] })} className="!py-1.5 text-xs !w-28">
                  <option value="eq">uguale</option>
                  <option value="neq">diverso</option>
                  <option value="contains">contiene</option>
                  <option value="not_contains">non contiene</option>
                  <option value="gte">≥</option>
                  <option value="lte">≤</option>
                </Select>
                {table && columns.find((c) => c.key === f.column)?.type === 'dimension' && (f.op === 'eq' || f.op === 'neq') ? (
                  <Select value={String(f.value ?? '')} onChange={(e) => setFilter(i, { ...f, value: e.target.value })} className="!py-1.5 text-xs">
                    <option value="">Scegli</option>
                    {distinctValues(table, f.column).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input value={String(f.value ?? '')} onChange={(e) => setFilter(i, { ...f, value: e.target.value })} className="!py-1.5 text-xs" />
                )}
                <IconButton label="Rimuovi filtro" onClick={() => set({ filters: filters.filter((_, j) => j !== i) })}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
            ))}
          </div>

          {showWidth && (
            <Field label="Larghezza">
              <div className="flex gap-2">
                {([1, 2, 3] as const).map((n) => (
                  <button key={n} type="button" onClick={() => setW(n)} className={`flex-1 rounded-md border py-1.5 text-xs ${w === n ? 'bg-moca-red-light text-moca-red border-moca-red' : 'border-moca-line text-moca-text'}`}>
                    {n === 1 ? 'Un terzo' : n === 2 ? 'Due terzi' : 'Intera'}
                  </button>
                ))}
              </div>
            </Field>
          )}
        </div>

        <div className="bg-moca-bg rounded-xl p-4 min-h-[320px]">
          <p className="text-xs font-semibold uppercase tracking-wide text-moca-gray mb-3">Anteprima</p>
          <div className="bg-white rounded-xl shadow-card p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-moca-black mb-3">{spec.title || 'Grafico'}</h3>
            {loading ? (
              <div className="flex justify-center py-16">
                <Spinner />
              </div>
            ) : table && valid ? (
              <ChartView spec={spec} table={table} currency={info.scope?.currency ?? 'EUR'} height={260} />
            ) : (
              <p className="text-sm text-moca-gray py-16 text-center">Scegli asse X e almeno una metrica per vedere l'anteprima.</p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
