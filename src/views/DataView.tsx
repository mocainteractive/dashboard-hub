import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Database, Download, Merge, Search, Trash2 } from 'lucide-react';
import { AddToDashboard } from '../components/AddToDashboard';
import { DataTable } from '../components/ChartView';
import { WidgetEditor } from '../components/WidgetEditor';
import { Badge, Button, Card, EmptyState, ErrorNote, Input, Select, Spinner } from '../components/ui';
import { useData } from '../lib/DataContext';
import { useMoca } from '../lib/MocaProvider';
import { downloadText, formatDateLabel, formatDateTime, newLocalId } from '../lib/format';
import { applyFilters, joinTables, toCsv, type Table } from '../shared/engine';
import { PLATFORM_LABELS, type Dataset, type VizSpec } from '../shared/types';

/** Catalogo dei dataset del cliente, dettaglio, incrocio ed esportazione. */
export function DataView({ onGoChat }: { onGoChat: () => void }) {
  const { datasets, datasetsLoading, loadDataset, api, refreshDatasets, forgetDataset } = useData();
  const { info, isInternal, user } = useMoca();
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<Dataset | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [joinWith, setJoinWith] = useState('');
  const [joinOn, setJoinOn] = useState('');
  const [other, setOther] = useState<Dataset | null>(null);
  const [chartSpec, setChartSpec] = useState<VizSpec | null>(null);
  const [adding, setAdding] = useState<VizSpec | null>(null);
  const currency = info.scope?.currency ?? 'EUR';

  const current = selected ?? datasets[0]?.id ?? null;

  useEffect(() => {
    setData(null);
    setJoinWith('');
    if (!current) return;
    loadDataset(current).then(setData).catch((e: Error) => setError(e.message));
  }, [current, loadDataset]);

  useEffect(() => {
    setOther(null);
    setJoinOn('');
    if (joinWith) loadDataset(joinWith).then(setOther).catch((e: Error) => setError(e.message));
  }, [joinWith, loadDataset]);

  const common = useMemo(() => (data && other ? data.columns.filter((c) => c.type !== 'metric' && other.columns.some((o) => o.key === c.key)) : []), [data, other]);

  const view: Table | null = useMemo(() => {
    if (!data) return null;
    let t: Table = data;
    if (other && joinOn) {
      try {
        t = joinTables(data, other, [joinOn], { a: data.title.split(',')[0], b: other.title.split(',')[0] });
      } catch {
        t = data;
      }
    }
    const q = query.trim();
    if (!q) return t;
    const dims = t.columns.filter((c) => c.type !== 'metric');
    return { columns: t.columns, rows: t.rows.filter((r) => dims.some((c) => applyFilters({ columns: t.columns, rows: [r] }, [{ column: c.key, op: 'contains', value: q }]).rows.length)) };
  }, [data, other, joinOn, query]);

  const remove = async () => {
    if (!data || !window.confirm(`Eliminare il dataset "${data.title}"? I grafici che lo usano non mostreranno più dati.`)) return;
    try {
      await api.deleteDataset(data.id);
      forgetDataset(data.id);
      setSelected(null);
      await refreshDatasets();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const startChart = () => {
    if (!data || !view) return;
    const x = view.columns.find((c) => c.type === 'date') ?? view.columns.find((c) => c.type === 'dimension');
    setChartSpec({
      id: newLocalId(),
      title: other && joinOn ? `${data.title.split(',')[0]} e ${other.title.split(',')[0]}` : data.title,
      type: x?.type === 'date' ? 'line' : 'bar',
      datasetId: data.id,
      ...(other && joinOn ? { join: { datasetId: other.id, on: [joinOn] } } : {}),
      x: x?.key,
      metrics: view.columns.filter((c) => c.type === 'metric').slice(0, 1).map((c) => c.key),
      filters: [],
    });
  };

  if (datasetsLoading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );
  }
  if (!datasets.length) {
    return (
      <div className="bg-white rounded-xl shadow-card">
        <EmptyState
          icon={<Database size={22} />}
          title="Nessun dataset"
          text="I dataset nascono dalle risposte dell'assistente: ogni volta che legge dati dai server MCP del cliente li salva qui, pronti per grafici e dashboard senza nuove chiamate."
          action={<Button onClick={onGoChat}>Vai alla chat</Button>}
        />
      </div>
    );
  }

  const canDelete = data && (isInternal || data.createdBy === user.name);

  return (
    <div className="grid lg:grid-cols-[300px_1fr] gap-6">
      <aside className="bg-white rounded-xl shadow-card p-2 space-y-1 max-h-[75vh] overflow-y-auto scrollbar-thin">
        <p className="px-2 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-moca-gray">{datasets.length} dataset</p>
        {datasets.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setSelected(d.id)}
            className={`w-full text-left rounded-md px-3 py-2 border transition ${d.id === current ? 'bg-moca-red-light border-moca-red' : 'border-transparent hover:bg-gray-100'}`}
          >
            <span className={`block text-sm font-medium truncate ${d.id === current ? 'text-moca-red' : 'text-moca-black'}`}>{d.title}</span>
            <span className="block text-[11px] text-moca-gray truncate">
              {d.platforms.map((p) => PLATFORM_LABELS[p]).join(' + ')} · {d.rowCount} righe · {formatDateTime(d.updatedAt)}
            </span>
          </button>
        ))}
      </aside>

      <div className="min-w-0 space-y-5">
        {error && <ErrorNote>{error}</ErrorNote>}
        {!data ? (
          <div className="flex justify-center py-24">
            <Spinner />
          </div>
        ) : (
          <>
            <Card
              title={data.title}
              subtitle={data.description}
              actions={
                <>
                  <Button size="sm" variant="secondary" onClick={startChart}>
                    <BarChart3 size={14} /> Crea grafico
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => view && downloadText(`${data.title.replace(/[^\w]+/g, '_')}.csv`, toCsv(view))}>
                    <Download size={14} /> CSV
                  </Button>
                  {canDelete && (
                    <Button size="sm" variant="ghost" onClick={remove} aria-label="Elimina dataset">
                      <Trash2 size={14} />
                    </Button>
                  )}
                </>
              }
            >
              <div className="flex flex-wrap gap-2 mb-4">
                {data.platforms.map((p) => (
                  <Badge key={p} tone="blue">
                    {PLATFORM_LABELS[p]}
                  </Badge>
                ))}
                {(data.dateFrom || data.dateTo) && (
                  <Badge>
                    {formatDateLabel(data.dateFrom ?? '')} - {formatDateLabel(data.dateTo ?? '')}
                  </Badge>
                )}
                <Badge>Creato da {data.createdBy}</Badge>
                {data.sourceCalls.length > 0 && <Badge tone={data.sourceCalls.every((c) => c.fromCache) ? 'green' : 'gray'}>{data.sourceCalls.length} chiamate MCP</Badge>}
              </div>

              <div className="grid sm:grid-cols-[1fr_1fr_1fr] gap-3 mb-4">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-moca-gray" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca nelle righe" className="!pl-8" />
                </div>
                <Select value={joinWith} onChange={(e) => setJoinWith(e.target.value)} aria-label="Incrocia con">
                  <option value="">Incrocia con un altro dataset</option>
                  {datasets
                    .filter((d) => d.id !== data.id)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                </Select>
                <Select value={joinOn} onChange={(e) => setJoinOn(e.target.value)} disabled={!other} aria-label="Colonna comune">
                  <option value="">{other && !common.length ? 'Nessuna colonna in comune' : 'Colonna comune'}</option>
                  {common.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>
              {other && joinOn && (
                <p className="text-xs text-chart-green mb-3 flex items-center gap-1.5">
                  <Merge size={14} /> Dati incrociati per {common.find((c) => c.key === joinOn)?.label.toLowerCase()}: le metriche dei due dataset sono affiancate.
                </p>
              )}
              {view && <DataTable columns={view.columns} rows={view.rows} currency={currency} max={300} />}
            </Card>

            {data.sourceCalls.length > 0 && (
              <Card title="Provenienza" subtitle="Le chiamate ai server MCP che hanno prodotto questo dataset, sempre limitate agli account del cliente.">
                <ul className="space-y-1.5">
                  {data.sourceCalls.map((c, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 text-xs text-moca-text">
                      <Badge tone="blue">{PLATFORM_LABELS[c.platform]}</Badge>
                      <code className="text-moca-black">{c.tool}</code>
                      <span>{formatDateTime(c.fetchedAt)}</span>
                      {c.fromCache && <Badge tone="green">da cache</Badge>}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}
      </div>

      {chartSpec && (
        <WidgetEditor
          showWidth={false}
          initial={{ id: newLocalId(), spec: chartSpec, w: 2 }}
          onClose={() => setChartSpec(null)}
          onSave={(w) => {
            setChartSpec(null);
            setAdding(w.spec);
          }}
        />
      )}
      {adding && <AddToDashboard spec={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}
