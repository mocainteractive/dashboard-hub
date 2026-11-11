import { useEffect, useMemo, useState } from 'react';
import { CalendarRange, Filter as FilterIcon, Plus, X } from 'lucide-react';
import { useData } from '../lib/DataContext';
import { distinctValues } from '../shared/engine';
import type { Column, DashboardFilters, Dataset } from '../shared/types';
import { Button, Select } from './ui';

/** Filtri globali della dashboard: periodo e valori di dimensione. */

/** Data locale AAAA-MM-GG (non UTC: a mezzanotte italiana il giorno è già cambiato). */
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function presets(): { key: string; label: string; from?: string; to?: string }[] {
  const now = new Date();
  const today = iso(now);
  const daysAgo = (n: number) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
  const y = now.getFullYear();
  const m = now.getMonth();
  return [
    { key: '7', label: 'Ultimi 7 giorni', from: daysAgo(6), to: today },
    { key: '30', label: 'Ultimi 30 giorni', from: daysAgo(29), to: today },
    { key: '90', label: 'Ultimi 90 giorni', from: daysAgo(89), to: today },
    { key: 'mtd', label: 'Mese corrente', from: iso(new Date(y, m, 1)), to: today },
    { key: 'lm', label: 'Mese scorso', from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) },
    { key: 'ytd', label: 'Anno corrente', from: `${y}-01-01`, to: today },
    { key: 'all', label: 'Tutto il periodo' },
  ];
}

export function FilterBar({ value, onChange, datasetIds }: { value: DashboardFilters; onChange: (f: DashboardFilters) => void; datasetIds: string[] }) {
  const { loadDataset } = useData();
  const [loaded, setLoaded] = useState<Dataset[]>([]);
  const [adding, setAdding] = useState<{ column: string; value: string } | null>(null);
  const idsKey = datasetIds.join(',');

  useEffect(() => {
    let alive = true;
    Promise.all(idsKey.split(',').filter(Boolean).map((id) => loadDataset(id).catch(() => null))).then((list) => alive && setLoaded(list.filter((d): d is Dataset => !!d)));
    return () => {
      alive = false;
    };
  }, [idsKey, loadDataset]);

  const dimColumns = useMemo(() => {
    const map = new Map<string, Column>();
    for (const d of loaded) for (const c of d.columns) if (c.type === 'dimension' && !map.has(c.key)) map.set(c.key, c);
    return [...map.values()];
  }, [loaded]);

  const valuesFor = (key: string) => {
    const set = new Set<string>();
    for (const d of loaded) if (d.columns.some((c) => c.key === key)) distinctValues(d, key).forEach((v) => set.add(v));
    return [...set].sort((a, b) => a.localeCompare(b, 'it'));
  };

  const list = presets();
  const active = list.find((p) => p.from === value.dateFrom && p.to === value.dateTo)?.key ?? (value.dateFrom || value.dateTo ? 'custom' : 'all');
  const labelOf = (key: string) => dimColumns.find((c) => c.key === key)?.label ?? key;

  return (
    <div className="bg-white rounded-xl shadow-card px-4 py-3 mb-5 flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarRange size={16} className="text-moca-black" />
        <Select
          aria-label="Periodo"
          value={active}
          onChange={(e) => {
            const p = list.find((x) => x.key === e.target.value);
            if (p) onChange({ ...value, dateFrom: p.from, dateTo: p.to });
          }}
          className="!w-auto !py-1.5 text-xs"
        >
          {list.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
          {active === 'custom' && <option value="custom">Personalizzato</option>}
        </Select>
        <input type="date" aria-label="Dal" value={value.dateFrom ?? ''} onChange={(e) => onChange({ ...value, dateFrom: e.target.value || undefined })} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-moca-black" />
        <span className="text-xs text-moca-gray">al</span>
        <input type="date" aria-label="Al" value={value.dateTo ?? ''} onChange={(e) => onChange({ ...value, dateTo: e.target.value || undefined })} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-moca-black" />
      </div>

      <div className="h-6 w-px bg-moca-line hidden sm:block" />

      <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
        <FilterIcon size={16} className="text-moca-black" />
        {value.dims.map((f, i) => (
          <span key={`${f.column}-${i}`} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-moca-red-light text-moca-red text-xs border border-moca-red/30">
            {labelOf(f.column)}: <strong className="font-semibold">{Array.isArray(f.value) ? f.value.join(', ') : String(f.value)}</strong>
            <button type="button" aria-label="Rimuovi filtro" className="p-0.5 rounded-full hover:bg-moca-red/10" onClick={() => onChange({ ...value, dims: value.dims.filter((_, j) => j !== i) })}>
              <X size={12} />
            </button>
          </span>
        ))}
        {!value.dims.length && !adding && <span className="text-xs text-moca-gray">Nessun filtro. Clicca un elemento di un grafico per filtrare tutta la dashboard.</span>}
        {adding ? (
          <span className="inline-flex items-center gap-1.5">
            <Select value={adding.column} onChange={(e) => setAdding({ column: e.target.value, value: '' })} className="!w-auto !py-1 text-xs">
              {dimColumns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </Select>
            <Select value={adding.value} onChange={(e) => setAdding({ ...adding, value: e.target.value })} className="!w-auto !py-1 text-xs max-w-[200px]">
              <option value="">Valore</option>
              {valuesFor(adding.column).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              disabled={!adding.value}
              onClick={() => {
                onChange({ ...value, dims: [...value.dims.filter((d) => d.column !== adding.column), { column: adding.column, op: 'eq', value: adding.value }] });
                setAdding(null);
              }}
            >
              Applica
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>
              Annulla
            </Button>
          </span>
        ) : (
          dimColumns.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setAdding({ column: dimColumns[0].key, value: '' })}>
              <Plus size={14} /> Filtro
            </Button>
          )
        )}
      </div>
    </div>
  );
}
