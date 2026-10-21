import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell as PieCell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  type TooltipProps,
} from 'recharts';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { applyDashboardFilters, chartData, dateColumn, runQuery, type ChartData, type Table } from '../shared/engine';
import type { Cell, Column, DashboardFilters, Row, VizSpec } from '../shared/types';
import { AXIS_TEXT, formatDateLabel, formatValue, GRID_COLOR, seriesColor } from '../lib/format';

/**
 * Rendering di una visualizzazione: segni sottili, una sola scala per
 * grafico, griglia leggera, tooltip su ogni elemento, legenda dalle due
 * serie in su. Metriche con unità diverse diventano piccoli multipli.
 */

interface Props {
  spec: VizSpec;
  table: Table;
  filters?: DashboardFilters;
  currency?: string;
  height?: number;
  showTable?: boolean;
  onCrossFilter?: (column: string, value: Cell) => void;
}

const axisTick = { fill: AXIS_TEXT, fontSize: 11 };

function ChartTooltip({ active, payload, label, xColumn, currency }: TooltipProps<number, string> & { xColumn?: Column; currency: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-moca-line rounded-md shadow-lg px-3 py-2 text-xs min-w-[140px]">
      <p className="font-semibold text-moca-black mb-1">{xColumn?.type === 'date' ? formatDateLabel(label as Cell) : String(label ?? '')}</p>
      {payload.map((p) => {
        const col = (p.payload?.__cols?.[p.dataKey as string] as Column | undefined) ?? undefined;
        return (
          <div key={String(p.dataKey)} className="flex items-center justify-between gap-3 py-0.5">
            <span className="flex items-center gap-1.5 text-moca-text">
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="font-semibold text-moca-black tabular-nums">{formatValue(p.value as number, col, currency)}</span>
          </div>
        );
      })}
    </div>
  );
}

function Legend({ series, onClick }: { series: ChartData['series']; onClick?: (key: string) => void }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
      {series.map((s, i) => (
        <button key={s.key} type="button" onClick={() => onClick?.(s.key)} className="flex items-center gap-1.5 text-xs text-moca-text hover:text-moca-black" title={onClick ? 'Filtra su questo valore' : undefined}>
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: seriesColor(i, s.key) }} />
          {s.label}
        </button>
      ))}
    </div>
  );
}

export function DataTable({ columns, rows, currency, max = 200 }: { columns: Column[]; rows: Row[]; currency: string; max?: number }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      const nx = Number(x);
      const ny = Number(y);
      if (!Number.isNaN(nx) && !Number.isNaN(ny) && x !== null && y !== null) return (nx - ny) * sort.dir;
      return String(x ?? '').localeCompare(String(y ?? ''), 'it') * sort.dir;
    });
  }, [rows, sort]);
  return (
    <div className="overflow-auto scrollbar-thin max-h-[420px] border border-moca-line rounded-lg">
      <table className="w-full text-sm">
        <thead className="bg-moca-bg sticky top-0">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === -1 ? 1 : -1 }))}
                className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-moca-black cursor-pointer select-none whitespace-nowrap ${c.type === 'metric' ? 'text-right' : 'text-left'}`}
              >
                <span className="inline-flex items-center gap-1">
                  {c.label}
                  {sort?.key === c.key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, max).map((r, i) => (
            <tr key={i} className="border-t border-moca-line hover:bg-moca-bg/60">
              {columns.map((c) => (
                <td key={c.key} className={`px-3 py-1.5 whitespace-nowrap ${c.type === 'metric' ? 'text-right tabular-nums text-moca-black' : 'text-moca-text'}`}>
                  {c.type === 'metric' ? formatValue(r[c.key], c, currency) : c.type === 'date' ? formatDateLabel(r[c.key]) : String(r[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="text-xs text-moca-gray px-3 py-2">Mostrate {max} righe su {rows.length}.</p>}
    </div>
  );
}

function Kpi({ spec, table, currency }: { spec: VizSpec; table: Table; currency: string }) {
  const data = chartData(table, { ...spec, type: 'kpi' });
  const dc = dateColumn(table);
  const spark = dc ? runQuery(table, { groupBy: [dc.key], metrics: data.series.map((s) => ({ key: s.key, agg: spec.agg })), dateGrain: 'week', sort: { key: dc.key, dir: 'asc' } }).rows : [];
  return (
    <div className={`grid gap-4 ${data.series.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {data.series.map((s, i) => (
        <div key={s.key} className="min-w-0">
          {data.series.length > 1 && <p className="text-xs text-moca-gray uppercase tracking-wide truncate">{s.label}</p>}
          <p className="text-3xl font-semibold text-moca-black tabular-nums mt-1 truncate">{formatValue(data.rows[0]?.[s.key] ?? null, s.column, currency, true)}</p>
          {spark.length > 2 && (
            <div className="h-10 mt-2" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={spark}>
                  <Line type="monotone" dataKey={s.key} stroke={seriesColor(i)} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function withCols(d: ChartData): Row[] {
  const cols = Object.fromEntries(d.series.map((s) => [s.key, s.column]));
  return d.rows.map((r) => ({ ...r, __cols: cols as unknown as Cell }));
}

function SingleChart({ spec, data, height, currency, onCrossFilter }: { spec: VizSpec; data: ChartData; height: number; currency: string; onCrossFilter?: Props['onCrossFilter'] }) {
  const x = data.xColumn!;
  const rows = withCols(data);
  const yFmt = (v: number) => formatValue(v, data.series[0]?.column, currency, true);
  const xFmt = (v: Cell) => {
    if (x.type === 'date') return formatDateLabel(v);
    const s = String(v ?? '');
    return s.length > 16 ? `${s.slice(0, 15)}…` : s;
  };
  const tooltip = <Tooltip cursor={{ stroke: '#C9CBD0', strokeWidth: 1, fill: 'rgba(25,25,25,0.04)' }} content={<ChartTooltip xColumn={x} currency={currency} />} />;
  const grid = <CartesianGrid stroke={GRID_COLOR} vertical={false} />;
  const legendClick = spec.seriesBy && onCrossFilter ? (key: string) => key !== 'Altro' && onCrossFilter(spec.seriesBy!, key) : undefined;
  const clickX = (payload: { activeLabel?: string } | null) => {
    if (onCrossFilter && x.type !== 'date' && payload?.activeLabel !== undefined) onCrossFilter(x.key, payload.activeLabel);
  };

  if (spec.type === 'line' || spec.type === 'area') {
    const Chart = spec.type === 'line' ? LineChart : AreaChart;
    return (
      <>
        <Legend series={data.series} onClick={legendClick} />
        <ResponsiveContainer width="100%" height={height}>
          <Chart data={rows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            {grid}
            <XAxis dataKey={x.key} tickFormatter={xFmt} tick={axisTick} axisLine={{ stroke: GRID_COLOR }} tickLine={false} minTickGap={24} />
            <YAxis tickFormatter={yFmt} tick={axisTick} axisLine={false} tickLine={false} width={56} />
            {tooltip}
            {data.series.map((s, i) =>
              spec.type === 'line' ? (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={seriesColor(i, s.key)} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} isAnimationActive={false} />
              ) : (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stackId={spec.seriesBy ? 'a' : undefined}
                  stroke={seriesColor(i, s.key)}
                  strokeWidth={2}
                  fill={seriesColor(i, s.key)}
                  fillOpacity={spec.seriesBy ? 0.55 : 0.12}
                  isAnimationActive={false}
                />
              ),
            )}
          </Chart>
        </ResponsiveContainer>
      </>
    );
  }

  if (spec.type === 'bar' || spec.type === 'stacked' || spec.type === 'hbar') {
    const horizontal = spec.type === 'hbar';
    const stacked = spec.type === 'stacked' || (!!spec.seriesBy && spec.type !== 'bar');
    const h = horizontal ? Math.max(height, rows.length * 30 + 30) : height;
    // Etichette lunghe su barre verticali: inclinate, mai sovrapposte.
    const angled = !horizontal && x.type !== 'date' && rows.some((r) => String(r[x.key] ?? '').length > 8) && rows.length > 2;
    return (
      <>
        <Legend series={data.series} onClick={legendClick} />
        <ResponsiveContainer width="100%" height={h}>
          <BarChart data={rows} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 6, right: 12, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%" onClick={clickX}>
            <CartesianGrid stroke={GRID_COLOR} vertical={horizontal} horizontal={!horizontal} />
            {horizontal ? (
              <>
                <XAxis type="number" tickFormatter={yFmt} tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey={x.key} tickFormatter={xFmt} tick={axisTick} axisLine={false} tickLine={false} width={120} />
              </>
            ) : (
              <>
                <XAxis
                  dataKey={x.key}
                  tickFormatter={xFmt}
                  tick={axisTick}
                  angle={angled ? -30 : 0}
                  textAnchor={angled ? 'end' : 'middle'}
                  height={angled ? 64 : 30}
                  axisLine={{ stroke: GRID_COLOR }}
                  tickLine={false}
                  interval={x.type === 'date' ? 'preserveStartEnd' : 0}
                  minTickGap={8}
                />
                <YAxis tickFormatter={yFmt} tick={axisTick} axisLine={false} tickLine={false} width={56} />
              </>
            )}
            {tooltip}
            {data.series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId={stacked ? 'a' : undefined}
                fill={seriesColor(i, s.key)}
                radius={stacked ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                stroke="#fff"
                strokeWidth={stacked ? 1 : 0}
                maxBarSize={44}
                cursor={onCrossFilter && x.type !== 'date' ? 'pointer' : undefined}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </>
    );
  }

  if (spec.type === 'pie') {
    const metric = data.series[0];
    const sorted = [...data.rows].sort((a, b) => Number(b[metric.key] ?? 0) - Number(a[metric.key] ?? 0));
    const top = sorted.slice(0, 5).map((r) => ({ name: String(r[x.key] ?? 'n.d.'), value: Number(r[metric.key] ?? 0) }));
    const rest = sorted.slice(5).reduce((s, r) => s + Number(r[metric.key] ?? 0), 0);
    if (rest > 0) top.push({ name: 'Altro', value: rest });
    const total = top.reduce((s, p) => s + p.value, 0) || 1;
    return (
      <div className="flex flex-col sm:flex-row items-center gap-4">
        <div className="w-full sm:w-1/2" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={top} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="90%" paddingAngle={1.5} stroke="#fff" strokeWidth={2} isAnimationActive={false} onClick={(p) => onCrossFilter && p?.name !== 'Altro' && onCrossFilter(x.key, p.name as string)}>
                {top.map((p, i) => (
                  <PieCell key={p.name} fill={seriesColor(i, p.name)} cursor={onCrossFilter ? 'pointer' : undefined} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => formatValue(v, metric.column, currency)} contentStyle={{ fontFamily: 'Figtree', fontSize: 12, borderRadius: 6, borderColor: GRID_COLOR }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="w-full sm:w-1/2 space-y-1.5">
          {top.map((p, i) => (
            <li key={p.name} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 text-moca-text truncate">
                <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: seriesColor(i, p.name) }} />
                {p.name}
              </span>
              <span className="text-moca-black font-semibold tabular-nums">{Math.round((p.value / total) * 1000) / 10}%</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (spec.type === 'scatter') {
    const [mx, my] = data.series;
    if (!mx || !my) return <p className="text-sm text-moca-gray">Il grafico a dispersione richiede due metriche.</p>;
    return (
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          {grid}
          <XAxis type="number" dataKey={mx.key} name={mx.label} tickFormatter={(v) => formatValue(v, mx.column, currency, true)} tick={axisTick} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
          <YAxis type="number" dataKey={my.key} name={my.label} tickFormatter={(v) => formatValue(v, my.column, currency, true)} tick={axisTick} axisLine={false} tickLine={false} width={56} />
          <ZAxis range={[64, 64]} />
          <Tooltip
            cursor={{ strokeDasharray: '0', stroke: '#C9CBD0' }}
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <div className="bg-white border border-moca-line rounded-md shadow-lg px-3 py-2 text-xs">
                  <p className="font-semibold text-moca-black mb-1">{String(payload[0].payload[x.key] ?? '')}</p>
                  <p className="text-moca-text">
                    {mx.label}: <strong className="text-moca-black">{formatValue(payload[0].payload[mx.key], mx.column, currency)}</strong>
                  </p>
                  <p className="text-moca-text">
                    {my.label}: <strong className="text-moca-black">{formatValue(payload[0].payload[my.key], my.column, currency)}</strong>
                  </p>
                </div>
              ) : null
            }
          />
          <Scatter data={rows} fill={seriesColor(0)} stroke="#fff" strokeWidth={2} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }
  return null;
}

export function ChartView({ spec, table, filters, currency = 'EUR', height = 240, showTable, onCrossFilter }: Props) {
  const filtered = useMemo(() => applyDashboardFilters(table, filters), [table, filters]);
  const byKey = useMemo(() => new Map(filtered.columns.map((c) => [c.key, c])), [filtered]);

  if (!filtered.rows.length) return <p className="text-sm text-moca-gray py-10 text-center">Nessun dato per i filtri selezionati.</p>;
  if (spec.type === 'kpi') return <Kpi spec={spec} table={filtered} currency={currency} />;

  if (spec.type === 'table') {
    const groupBy = spec.x ? [spec.x] : [];
    const t = groupBy.length
      ? runQuery(filtered, { filters: spec.filters, groupBy, metrics: spec.metrics.map((m) => ({ key: m, agg: spec.agg })), dateGrain: spec.dateGrain, sort: spec.sort ?? { key: spec.metrics[0], dir: 'desc' }, limit: spec.limit })
      : runQuery(filtered, { filters: spec.filters, limit: spec.limit });
    return <DataTable columns={t.columns} rows={t.rows} currency={currency} />;
  }

  const metricCols = spec.metrics.map((m) => byKey.get(m)).filter((c): c is Column => !!c);
  const mixedUnits = !spec.seriesBy && spec.type !== 'scatter' && new Set(metricCols.map((c) => c.format ?? 'number')).size > 1;

  if (showTable) {
    const data = chartData(filtered, spec);
    return <DataTable columns={data.table.columns} rows={data.table.rows} currency={currency} />;
  }

  if (mixedUnits) {
    // Unità diverse: un grafico per metrica, mai due scale sullo stesso grafico.
    return (
      <div className="space-y-4">
        {metricCols.map((c) => (
          <div key={c.key}>
            <p className="text-xs font-semibold text-moca-text mb-1">{c.label}</p>
            <SingleChart spec={{ ...spec, metrics: [c.key] }} data={chartData(filtered, { ...spec, metrics: [c.key] })} height={Math.round(height * 0.6)} currency={currency} onCrossFilter={onCrossFilter} />
          </div>
        ))}
      </div>
    );
  }

  const data = chartData(filtered, spec);
  if (!data.xColumn) return <p className="text-sm text-moca-gray">Scegli la colonna dell'asse X.</p>;
  return <SingleChart spec={spec} data={data} height={height} currency={currency} onCrossFilter={onCrossFilter} />;
}
