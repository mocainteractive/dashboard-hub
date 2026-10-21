import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createApi, type Api } from './api';
import { createDemoApi } from './demo';
import { useMoca } from './MocaProvider';
import { joinTables, type Table } from '../shared/engine';
import type { DashboardMeta, Dataset, DatasetMeta, VizSpec } from '../shared/types';

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

  const forgetDataset = useCallback((id: string) => {
    cache.current.delete(id);
  }, []);

  const value = useMemo(
    () => ({ api, datasets, datasetsLoading, refreshDatasets, dashboards, refreshDashboards, loadDataset, forgetDataset }),
    [api, datasets, datasetsLoading, refreshDatasets, dashboards, refreshDashboards, loadDataset, forgetDataset],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

/** Tabella sorgente di una visualizzazione (con l'eventuale incrocio). */
export function useVizTable(spec: Pick<VizSpec, 'datasetId' | 'join'>): { table: Table | null; title: string; loading: boolean; error: string | null } {
  const { loadDataset } = useData();
  const [state, setState] = useState<{ table: Table | null; title: string; loading: boolean; error: string | null }>({ table: null, title: '', loading: true, error: null });
  const joinId = spec.join?.datasetId;
  const joinOn = spec.join?.on.join(',');

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      const a = await loadDataset(spec.datasetId);
      if (!joinId || !joinOn) return { table: a as Table, title: a.title };
      const b = await loadDataset(joinId);
      return { table: joinTables(a, b, (joinOn ?? '').split(',').filter(Boolean), { a: a.title.split(',')[0], b: b.title.split(',')[0] }), title: `${a.title} + ${b.title}` };
    })()
      .then((r) => alive && setState({ ...r, loading: false, error: null }))
      .catch((e: Error) => alive && setState({ table: null, title: '', loading: false, error: e.message || 'Dati non disponibili' }));
    return () => {
      alive = false;
    };
  }, [spec.datasetId, joinId, joinOn, loadDataset]);

  return state;
}
