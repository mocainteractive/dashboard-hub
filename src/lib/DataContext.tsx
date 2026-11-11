import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createApi, type Api } from './api';
import { createDemoApi } from './demo';
import { useMoca } from './MocaProvider';
import { addComputed, dateColumn, joinKeysOf, joinTables, type Table } from '../shared/engine';
import type { DashboardFilters, DashboardMeta, Dataset, DatasetMeta, McpPlatform, PeriodData, PeriodStatus, VizSpec } from '../shared/types';

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
  /** Cambia quando dei dataset vengono sostituiti o eliminati: i widget si ricaricano. */
  datasetsVersion: number;
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
  const [datasetsVersion, setDatasetsVersion] = useState(0);

  const refreshDatasets = useCallback(async () => {
    try {
      const list = await api.listDatasets();
      // Dataset spariti dall'elenco (sostituiti o eliminati): si rileggono alla prossima richiesta.
      const ids = new Set(list.map((d) => d.id));
      let gone = false;
      for (const k of [...cache.current.keys()]) {
        if (!ids.has(k)) {
          cache.current.delete(k);
          gone = true;
        }
      }
      for (const k of [...periodCache.current.keys()]) if (!ids.has(k.split('|')[0])) periodCache.current.delete(k);
      setDatasets(list);
      if (gone) setDatasetsVersion((v) => v + 1);
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
      const load = (x: string, hops: number): Promise<Dataset> => {
        let p = cache.current.get(x);
        if (!p) {
          // Un dataset sostituito (reso filtrabile in chat) passa da solo al nuovo.
          p = api.getDataset(x).then((ds) => (ds.replacedBy && hops < 3 ? load(ds.replacedBy, hops + 1).catch(() => ds) : ds));
          cache.current.set(x, p);
          p.catch(() => cache.current.delete(x));
        }
        return p;
      };
      return load(id, 0);
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
    () => ({ api, datasets, datasetsLoading, refreshDatasets, dashboards, refreshDashboards, loadDataset, loadPeriod, forgetDataset, datasetsVersion }),
    [api, datasets, datasetsLoading, refreshDatasets, dashboards, refreshDashboards, loadDataset, loadPeriod, forgetDataset, datasetsVersion],
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

type VizState = { table: Table | null; title: string; loading: boolean; error: string | null; period: PeriodStatus; platforms: McpPlatform[] };

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
  spec: Pick<VizSpec, 'datasetId' | 'join' | 'computed'>,
  filters?: DashboardFilters,
): VizState {
  const { loadDataset, loadPeriod, datasetsVersion } = useData();
  const [state, setState] = useState<VizState>({ table: null, title: '', loading: true, error: null, period: { kind: 'none' }, platforms: [] });
  const joinId = spec.join?.datasetId;
  // Chiave stabile dell'incrocio e delle metriche calcolate (per rifare il calcolo solo se cambiano).
  const joinKey = spec.join ? JSON.stringify({ k: joinKeysOf(spec.join), m: spec.join.mode ?? 'merge' }) : '';
  const computedKey = spec.computed?.length ? JSON.stringify(spec.computed) : '';
  const from = filters?.dateFrom;
  const to = filters?.dateTo;

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    const period = from || to ? { dateFrom: from, dateTo: to, dims: [] } : undefined;
    (async () => {
      const dsA = await loadDataset(spec.datasetId);
      const a = await resolveForPeriod(dsA, period, loadPeriod);
      const computed = computedKey ? (JSON.parse(computedKey) as NonNullable<VizSpec['computed']>) : [];
      if (!joinId || !joinKey) return { table: addComputed(a.table, computed), title: a.title, period: a.status, platforms: dsA.platforms };
      const dsB = await loadDataset(joinId);
      const b = await resolveForPeriod(dsB, period, loadPeriod);
      const { k, m } = JSON.parse(joinKey) as { k: { a: string; b: string }[]; m: 'merge' | 'lookup' };
      const joined = joinTables(a.table, b.table, k, { a: a.title.split(',')[0], b: b.title.split(',')[0] }, m);
      return {
        table: addComputed(joined, computed),
        title: `${a.title} + ${b.title}`,
        period: combine(a.status, b.status),
        platforms: [...new Set([...dsA.platforms, ...dsB.platforms])],
      };
    })()
      .then((r) => alive && setState({ ...r, loading: false, error: null }))
      .catch((e: Error) => alive && setState({ table: null, title: '', loading: false, error: e.message || 'Dati non disponibili', period: { kind: 'none' }, platforms: [] }));
    return () => {
      alive = false;
    };
  }, [spec.datasetId, joinId, joinKey, computedKey, from, to, loadDataset, loadPeriod, datasetsVersion]);

  return state;
}
