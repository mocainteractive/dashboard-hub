import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createApi, type Api } from './api';
import { createDemoApi } from './demo';
import { useMoca } from './MocaProvider';
import { dateColumn, joinTables, type Table } from '../shared/engine';
import type { DashboardFilters, DashboardMeta, Dataset, DatasetMeta, PeriodData, PeriodStatus, VizSpec } from '../shared/types';

/**
 * Stato condiviso dell'app e cache del browser: i dataset si scaricano una
 * volta per sessione, filtri e aggregazioni si calcolano in locale.
 */

interface DataContextValue {
  api: Api;
  datasets: DatasetMeta[];
  datasetsLoading: boolean;
  refreshDatasets: () => Promise<void>;
  dashboards: DashboardMeta[];
  refreshDashboards: () => Promise<void>;
  loadDataset: (id: string) => Promise<Dataset>;
  loadPeriod: (id: string, from: string, to: string) => Promise<PeriodData>;
  forgetDataset: (id: string) => void;
}

const DataContext = createContext<DataContextValue | null>(null);

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData deve essere usato dentro <DataProvider>');
  return ctx;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { appSession } = useMoca();
  const api = useMemo(() => (appSession ? createApi(appSession) : createDemoApi()), [appSession]);
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(true);
  const [dashboards, setDashboards] = useState<DashboardMeta[]>([]);
  const cache = useRef(new Map<string, Promise<Dataset>>());
  const periodCache = useRef(new Map<string, Promise<PeriodData>>());

  const refreshDatasets = useCallback(async () => {
    try {
      setDatasets(await api.listDatasets());
    } finally {
      setDatasetsLoading(false);
    }
  }, [api]);

  const refreshDashboards = useCallback(async () => {
    setDashboards(await api.listDashboards());
  }, [api]);

  useEffect(() => {
    refreshDatasets().catch(() => undefined);
    refreshDashboards().catch(() => undefined);
  }, [refreshDatasets, refreshDashboards]);

  const loadDataset = useCallback(
    (id: string) => {
      let p = cache.current.get(id);
      if (!p) {
        p = api.getDataset(id);
        cache.current.set(id, p);
        p.catch(() => cache.current.delete(id));
      }
      return p;
    },
    [api],
  );

  // Una sola richiesta per dataset e periodo, condivisa tra i widget.
  const loadPeriod = useCallback(
    (id: string, from: string, to: string) => {
      const key = `${id}|${from}|${to}`;
      let p = periodCache.current.get(key);
      if (!p) {
        p = api.datasetForPeriod(id, from, to);
        periodCache.current.set(key, p);
        p.catch(() => periodCache.current.delete(key));
      }
      return p;
    },
    [api],
  );

  const forgetDataset = useCallback((id: string) => {
    cache.current.delete(id);
    for (const k of periodCache.current.keys()) if (k.startsWith(`${id}|`)) periodCache.current.delete(k);
  }, []);

  const value = useMemo(
    () => ({ api, datasets, datasetsLoading, refreshDatasets, dashboards, refreshDashboards, loadDataset, loadPeriod, forgetDataset }),
    [api, datasets, datasetsLoading, refreshDatasets, dashboards, refreshDashboards, loadDataset, loadPeriod, forgetDataset],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shiftDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Primo e ultimo giorno presenti nei dati (colonna data), oppure il periodo dichiarato. */
function coverage(ds: Dataset): { from?: string; to?: string } {
  const dc = dateColumn(ds);
  if (dc) {
    const dates = ds.rows.map((r) => r[dc.key]).filter((v): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)).map((v) => v.slice(0, 10)).sort();
    if (dates.length) return { from: dates[0], to: dates[dates.length - 1] };
  }
  return { from: ds.dateFrom, to: ds.dateTo };
}

interface Resolved {
  table: Table;
  title: string;
  status: PeriodStatus;
}

/**
 * Dati di un dataset per il periodo della dashboard:
 *  - il dataset ha la colonna data e copre il periodo: si filtrano le righe;
 *  - altrimenti, se è stato estratto da una chiamata MCP, si rilegge dal
 *    server per il nuovo periodo (guard e cache come sempre);
 *  - altrimenti il periodo non è applicabile e lo si dichiara.
 */
async function resolveForPeriod(
  ds: Dataset,
  f: DashboardFilters | undefined,
  loadPeriod: (id: string, from: string, to: string) => Promise<PeriodData>,
): Promise<Resolved> {
  if (!f?.dateFrom && !f?.dateTo) return { table: ds, title: ds.title, status: { kind: 'none' } };
  const today = isoLocal(new Date());
  const cov = coverage(ds);
  const to = f.dateTo && f.dateTo < today ? f.dateTo : today;
  const from = f.dateFrom ?? cov.from ?? shiftDays(to, -29);
  // Tolleranza di 2 giorni sulla fine: le piattaforme pubblicano i dati con ritardo.
  const covered = !!dateColumn(ds) && !!cov.from && !!cov.to && cov.from <= from && cov.to >= shiftDays(to, -2);
  if (covered) return { table: ds, title: ds.title, status: { kind: 'filtered' } };

  let reason = dateColumn(ds) ? 'Il dataset non contiene tutto il periodo scelto.' : 'Il dataset non ha una colonna data.';
  if (ds.sourceTable && ds.sourceCalls?.length === 1) {
    try {
      const p = await loadPeriod(ds.id, from, to);
      return { table: { columns: p.columns, rows: p.rows }, title: ds.title, status: { kind: 'refetched', fetchedAt: p.fetchedAt } };
    } catch (e) {
      reason = (e as Error).message || reason;
    }
  } else {
    reason += ' Non si può rileggere dal server perché è stato composto in chat.';
  }
  return { table: ds, title: ds.title, status: { kind: 'fixed', dateFrom: cov.from, dateTo: cov.to, reason } };
}

/** Stato complessivo di due dataset incrociati: vale il caso peggiore. */
function combine(a: PeriodStatus, b: PeriodStatus): PeriodStatus {
  if (a.kind === 'fixed') return a;
  if (b.kind === 'fixed') return b;
  if (a.kind === 'refetched') return a;
  if (b.kind === 'refetched') return b;
  return a;
}

/** Tabella sorgente di una visualizzazione (con l'eventuale incrocio), per il periodo della dashboard. */
export function useVizTable(
  spec: Pick<VizSpec, 'datasetId' | 'join'>,
  filters?: DashboardFilters,
): { table: Table | null; title: string; loading: boolean; error: string | null; period: PeriodStatus } {
  const { loadDataset, loadPeriod } = useData();
  const [state, setState] = useState<{ table: Table | null; title: string; loading: boolean; error: string | null; period: PeriodStatus }>({
    table: null,
    title: '',
    loading: true,
    error: null,
    period: { kind: 'none' },
  });
  const joinId = spec.join?.datasetId;
  const joinOn = spec.join?.on.join(',');
  const from = filters?.dateFrom;
  const to = filters?.dateTo;

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    const period = from || to ? { dateFrom: from, dateTo: to, dims: [] } : undefined;
    (async () => {
      const a = await resolveForPeriod(await loadDataset(spec.datasetId), period, loadPeriod);
      if (!joinId || !joinOn) return { table: a.table, title: a.title, period: a.status };
      const b = await resolveForPeriod(await loadDataset(joinId), period, loadPeriod);
      return {
        table: joinTables(a.table, b.table, (joinOn ?? '').split(',').filter(Boolean), { a: a.title.split(',')[0], b: b.title.split(',')[0] }),
        title: `${a.title} + ${b.title}`,
        period: combine(a.status, b.status),
      };
    })()
      .then((r) => alive && setState({ ...r, loading: false, error: null }))
      .catch((e: Error) => alive && setState({ table: null, title: '', loading: false, error: e.message || 'Dati non disponibili', period: { kind: 'none' } }));
    return () => {
      alive = false;
    };
  }, [spec.datasetId, joinId, joinOn, from, to, loadDataset, loadPeriod]);

  return state;
}
