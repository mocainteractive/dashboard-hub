import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, BarChart3, CalendarCheck, CalendarX, Table2 } from 'lucide-react';
import { useData, useVizTable } from '../lib/DataContext';
import { useMoca } from '../lib/MocaProvider';
import type { Cell, DashboardFilters, PeriodStatus, VizSpec } from '../shared/types';
import { PLATFORM_LABELS } from '../shared/types';
import { ChartView } from './ChartView';
import { IconButton, Spinner } from './ui';

/** Card di una visualizzazione, usata in dashboard e chat. */
export function VizCard({
  spec,
  filters,
  actions,
  height = 240,
  onCrossFilter,
  onPeriodStatus,
  className = '',
}: {
  spec: VizSpec;
  filters?: DashboardFilters;
  actions?: ReactNode;
  height?: number;
  onCrossFilter?: (column: string, value: Cell) => void;
  /** Come il periodo della dashboard è applicato a questo widget. */
  onPeriodStatus?: (s: PeriodStatus | null) => void;
  className?: string;
}) {
  const { table, loading, error, period } = useVizTable(spec, filters);
  useEffect(() => {
    onPeriodStatus?.(loading ? null : period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, period]);
  const { datasets } = useData();
  const { info } = useMoca();
  const [asTable, setAsTable] = useState(false);
  const sources = new Set<string>();
  for (const id of [spec.datasetId, spec.join?.datasetId]) {
    datasets.find((d) => d.id === id)?.platforms.forEach((p) => sources.add(PLATFORM_LABELS[p]));
  }
  const canToggle = spec.type !== 'kpi' && spec.type !== 'table';

  return (
    <section className={`bg-white rounded-xl shadow-card p-5 flex flex-col min-w-0 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1 mb-3">
        <div className="min-w-[10rem] flex-1">
          <h3 className="text-sm font-semibold text-moca-black uppercase tracking-wide line-clamp-2" title={spec.title}>
            {spec.title}
          </h3>
          <p className="text-[11px] text-moca-gray mt-0.5 truncate">
            {[...sources].join(' + ') || 'Dataset'}
            {spec.join ? ' · dati incrociati' : ''}
          </p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 ml-auto">
          {canToggle && (
            <IconButton label={asTable ? 'Mostra grafico' : 'Mostra tabella'} onClick={() => setAsTable((v) => !v)}>
              {asTable ? <BarChart3 size={16} /> : <Table2 size={16} />}
            </IconButton>
          )}
          {actions}
        </div>
      </div>
      {!loading && <PeriodNote status={period} />}
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center" style={{ height: spec.type === 'kpi' ? 80 : height }}>
            <Spinner />
          </div>
        ) : error || !table ? (
          <div className="flex items-center gap-2 text-sm text-moca-gray py-8 justify-center">
            <AlertTriangle size={16} /> {error === 'Dataset non trovato' ? 'Dataset non più disponibile.' : (error ?? 'Dati non disponibili.')}
          </div>
        ) : (
          <ChartView spec={spec} table={table} filters={filters} currency={info.scope?.currency ?? 'EUR'} height={height} showTable={asTable} onCrossFilter={onCrossFilter} />
        )}
      </div>
      {spec.note && <p className="text-xs text-moca-text mt-3 pt-3 border-t border-moca-line">{spec.note}</p>}
    </section>
  );
}

const fmtDay = (iso?: string) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '?');

/** Indica se il periodo della dashboard è applicato ai dati del widget. */
function PeriodNote({ status }: { status: PeriodStatus }) {
  if (status.kind === 'none') return null;
  if (status.kind === 'fixed') {
    return (
      <p className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mb-3" title={status.reason}>
        <CalendarX size={13} className="shrink-0 mt-px" />
        <span>
          Periodo non applicato: dati dal {fmtDay(status.dateFrom)} al {fmtDay(status.dateTo)}. {status.reason}
        </span>
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-chart-green mb-2">
      <CalendarCheck size={13} />
      {status.kind === 'refetched' ? 'Periodo applicato, dati riletti per il periodo scelto' : 'Periodo applicato'}
    </p>
  );
}
