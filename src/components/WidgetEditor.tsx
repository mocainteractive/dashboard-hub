import { useEffect, useMemo, useState } from 'react';
import { AreaChart, BarChart3, BarChartHorizontal, Calculator, CheckCircle2, Gauge, LineChart, Merge, PieChart, Plus, ScatterChart, Table2, Trash2, Layers, AlertTriangle } from 'lucide-react';
import { useData, useVizTable } from '../lib/DataContext';
import { useMoca } from '../lib/MocaProvider';
import { newLocalId } from '../lib/format';
import { compileExpr, distinctValues, joinKeysOf, joinTables } from '../shared/engine';
import type { Agg, Column, Computed, DashboardWidget, Dataset, Filter, JoinKey, JoinMode, VizSpec, VizType } from '../shared/types';
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

const PATH_KEY = /(page|pagina|url|landing|path|link)/;

/** Coppia di colonne più probabile tra due dataset: stesso nome, date, pagine. */
function suggestPair(a: Dataset, b: Dataset): JoinKey | null {
  const da = a.columns.filter((c) => c.type !== 'metric');
  const db = b.columns.filter((c) => c.type !== 'metric');
  const same = da.find((c) => db.some((x) => x.key === c.key));
  if (same) return { a: same.key, b: same.key };
  const dateA = da.find((c) => c.type === 'date');
  const dateB = db.find((c) => c.type === 'date');
  if (dateA && dateB) return { a: dateA.key, b: dateB.key };
  const pathA = da.find((c) => PATH_KEY.test(c.key));
  const pathB = db.find((c) => PATH_KEY.test(c.key));
  if (pathA && pathB) return { a: pathA.key, b: pathB.key };
  return da[0] && db[0] ? { a: da[0].key, b: db[0].key } : null;
}

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
  const pair = spec.join ? joinKeysOf(spec.join)[0] : undefined;
  const joinMode: JoinMode = spec.join?.mode ?? 'merge';

  // Quante righe trovano una corrispondenza nell'altro dataset (calcolato dal vivo).
  const matches = useMemo(() => {
    if (!baseData || !joinData || !pair) return null;
    try {
      const t = joinTables(baseData, joinData, [pair], { a: 'A', b: 'B' }, 'lookup');
      const extra = joinData.columns.filter((c) => c.type === 'metric').map((c) => (baseData.columns.some((x) => x.key === c.key) ? `b__${c.key}` : c.key));
      const hit = t.rows.filter((r) => extra.some((k) => r[k] !== null && r[k] !== undefined)).length;
      return { hit, total: t.rows.length };
    } catch {
      return { hit: 0, total: baseData.rows.length };
    }
  }, [baseData, joinData, pair]);

  const setJoin = (patch: Partial<{ datasetId: string; pair: JoinKey; mode: JoinMode }>) => {
    const datasetId = patch.datasetId ?? spec.join?.datasetId;
    if (!datasetId) return set({ join: undefined });
    const p = patch.pair ?? pair;
    set({ join: { datasetId, on: [], ...(p ? { pairs: [p] } : {}), mode: patch.mode ?? joinMode } });
  };

  // Al cambio del dataset da incrociare, si propone la coppia di colonne più probabile.
  useEffect(() => {
    if (!baseData || !joinData || !spec.join || spec.join.datasetId !== joinData.id) return;
    const current = joinKeysOf(spec.join)[0];
    const ok = current && baseData.columns.some((c) => c.key === current.a) && joinData.columns.some((c) => c.key === current.b);
    if (ok) return;
    const s = suggestPair(baseData, joinData);
    if (s) {
      const looksLikePages = PATH_KEY.test(s.a) || PATH_KEY.test(s.b);
      setSpec((x) => ({ ...x, join: { datasetId: joinData.id, on: [], pairs: [s], mode: looksLikePages ? 'lookup' : (x.join?.mode ?? 'merge') } }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseData, joinData]);

  // Metriche calcolate.
  const computed = spec.computed ?? [];
  const [draft, setDraft] = useState<{ label: string; expr: string }>({ label: '', expr: '' });
  const baseKeys = columns.filter((c) => !computed.some((x) => x.key === c.key)).map((c) => c.key);
  const draftError = useMemo(() => {
    if (!draft.expr.trim()) return null;
    try {
      compileExpr(draft.expr, baseKeys);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [draft.expr, baseKeys]);
  const addComputedMetric = () => {
    const key = (draft.label || 'calcolata')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40) || 'calcolata';
    const c: Computed = { key, label: draft.label || key, expr: draft.expr.trim(), format: 'decimal' };
    set({ computed: [...computed.filter((x) => x.key !== key), c], metrics: [...spec.metrics.filter((m) => m !== key), key].slice(0, 6) });
    setDraft({ label: '', expr: '' });
  };
  const numericCols: Column[] = columns.filter((c) => c.type === 'metric');

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
      <div className="grid lg:grid-cols-[340px_minmax(0,1fr)] gap-6">
        <div className="space-y-4 min-w-0">
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
                <IconButton label="Rimuovi incrocio" onClick={() => set({ join: undefined, metrics: spec.metrics.filter((m) => baseData?.columns.some((c) => c.key === m) || computed.some((c) => c.key === m)) })}>
                  <Trash2 size={14} />
                </IconButton>
              )}
            </div>
            <Select value={spec.join?.datasetId ?? ''} onChange={(e) => (e.target.value ? set({ join: { datasetId: e.target.value, on: [], mode: joinMode } }) : set({ join: undefined }))}>
              <option value="">Nessun incrocio</option>
              {datasets
                .filter((d) => d.id !== spec.datasetId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
            </Select>
            {spec.join && joinData && baseData && (
              <>
                <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Tipo di incrocio">
                  {(
                    [
                      ['merge', 'Unisci per valore', 'Una riga per valore comune, es. data: sessioni GA4 e spesa Meta giorno per giorno.'],
                      ['lookup', 'Aggiungi colonne', 'Tiene le righe del primo dataset e aggiunge le metriche dell\'altro, es. query + conversioni della pagina.'],
                    ] as const
                  ).map(([m, label, hint]) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={joinMode === m}
                      title={hint}
                      onClick={() => setJoin({ mode: m })}
                      className={`rounded-md border px-2 py-1.5 text-left text-xs transition ${joinMode === m ? 'border-moca-red bg-moca-red-light text-moca-black' : 'border-moca-line text-moca-text hover:border-moca-gray'}`}
                    >
                      <span className="block font-semibold">{label}</span>
                      <span className="block text-[10px] text-moca-gray leading-tight mt-0.5">{hint}</span>
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-1.5">
                  <Field label="Colonna qui">
                    <Select value={pair?.a ?? ''} onChange={(e) => setJoin({ pair: { a: e.target.value, b: pair?.b ?? '' } })} className="!text-xs">
                      {baseData.columns
                        .filter((c) => c.type !== 'metric')
                        .map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                    </Select>
                  </Field>
                  <span className="pb-2.5 text-moca-gray text-xs">=</span>
                  <Field label="Colonna là">
                    <Select value={pair?.b ?? ''} onChange={(e) => setJoin({ pair: { a: pair?.a ?? '', b: e.target.value } })} className="!text-xs">
                      {joinData.columns
                        .filter((c) => c.type !== 'metric')
                        .map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                    </Select>
                  </Field>
                </div>
                {matches && (
                  <p className={`flex items-start gap-1.5 text-[11px] ${matches.hit ? 'text-chart-green' : 'text-amber-700'}`}>
                    {matches.hit ? <CheckCircle2 size={13} className="shrink-0 mt-px" /> : <AlertTriangle size={13} className="shrink-0 mt-px" />}
                    {matches.hit
                      ? `${matches.hit} righe su ${matches.total} trovano una corrispondenza. Indirizzi, maiuscole e date vengono confrontati in forma normalizzata.`
                      : 'Nessuna corrispondenza: scegli colonne che contengono gli stessi valori (es. pagina e landing page, data e data).'}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="rounded-lg border border-moca-line p-3 space-y-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-moca-black flex items-center gap-1.5">
              <Calculator size={14} /> Metrica calcolata
            </span>
            {computed.map((c) => (
              <div key={c.key} className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-moca-black">{c.label}</span>
                <code className="text-moca-text truncate flex-1">{c.expr}</code>
                <IconButton label="Rimuovi metrica" onClick={() => set({ computed: computed.filter((x) => x.key !== c.key), metrics: spec.metrics.filter((m) => m !== c.key) })}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
            ))}
            <Input placeholder="Nome, es. Conversioni stimate" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} className="!text-xs" />
            <Input placeholder="Formula, es. clic * key_events / sessions" value={draft.expr} onChange={(e) => setDraft({ ...draft, expr: e.target.value })} className="!text-xs font-mono" />
            {numericCols.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {numericCols.map((c) => (
                  <button key={c.key} type="button" title={c.label} onClick={() => setDraft((d) => ({ ...d, expr: `${d.expr}${d.expr && !/[\s(*/+-]$/.test(d.expr) ? ' ' : ''}${c.key}` }))} className="rounded border border-moca-line px-1.5 py-0.5 text-[10px] font-mono text-moca-text hover:border-moca-red">
                    {c.key}
                  </button>
                ))}
              </div>
            )}
            {draftError && <p className="text-[11px] text-amber-700">{draftError}</p>}
            <Button size="sm" variant="secondary" disabled={!draft.expr.trim() || !!draftError} onClick={addComputedMetric}>
              <Plus size={14} /> Aggiungi metrica
            </Button>
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

        <div className="bg-moca-bg rounded-xl p-4 min-h-[320px] min-w-0 lg:sticky lg:top-0 self-start">
          <p className="text-xs font-semibold uppercase tracking-wide text-moca-gray mb-3">Anteprima</p>
          <div className="bg-white rounded-xl shadow-card p-5 min-w-0 overflow-hidden">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-moca-black mb-3">{spec.title || 'Grafico'}</h3>
            {loading ? (
              <div className="flex justify-center py-16">
                <Spinner />
              </div>
            ) : table && valid ? (
              <ChartView spec={spec} table={table} currency={info.scope?.currency ?? 'EUR'} height={300} fit />
            ) : (
              <p className="text-sm text-moca-gray py-16 text-center">Scegli asse X e almeno una metrica per vedere l'anteprima.</p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
