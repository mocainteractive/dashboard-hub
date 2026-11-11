import { inScope, scopedPlatforms } from '../../../src/shared/scope';
import type {
  CacheStats,
  Conversation,
  ConversationMeta,
  Dashboard,
  DashboardMeta,
  DashboardWidget,
  Dataset,
  DatasetMeta,
  Filter,
  RunState,
  SessionInfo,
  VizSpec,
} from '../../../src/shared/types';
import { fail, ok } from './http';
import { McpGateway } from './mcp-gateway';
import { datasetForPeriod, PeriodError, validPeriod } from './period';
import { serverFor } from './mcp-client';
import { INTERNAL_ROLES, type AppSession } from './session';
import { newId, readIndex, removeFromIndex, upsertIndex, validId, type BlobStore, type TenantStore } from './tenant-store';

/**
 * Logica dell'endpoint /api/data, separata dal gestore per i test.
 * Ogni azione lavora SOLO sul TenantStore della sessione: il cliente non
 * arriva mai dal body della richiesta.
 */

export type DataBody = { action?: string; id?: unknown; dashboard?: unknown; after?: unknown; dateFrom?: unknown; dateTo?: unknown };

const MAX_DASHBOARD_BYTES = 400_000;
const VIZ_TYPES = ['kpi', 'line', 'area', 'bar', 'hbar', 'stacked', 'pie', 'table', 'scatter'];

const isInternal = (s: AppSession) => INTERNAL_ROLES.includes(s.role);

/** Chiave del segnale di interruzione di un run. */
export const stopKey = (runId: string) => `${runId}_stop`.slice(0, 80);

/** Chat in streaming disponibile (server POC locale o Cloud Run, non Netlify Functions). */
export const streamingEnabled = () => process.env.CHAT_STREAMING === 'true';

export function sessionInfoOf(s: AppSession): SessionInfo {
  return {
    scope: s.scope,
    scopeError: s.scopeError,
    providers: s.keys.anthropic ? ['anthropic'] : [],
    mcpPlatforms: s.scope ? scopedPlatforms(s.scope).filter((p) => !!serverFor(p)) : [],
    streaming: streamingEnabled(),
  };
}

function cleanFilters(v: unknown): Filter[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((f) => f && typeof f === 'object' && typeof f.column === 'string' && typeof f.op === 'string')
    .slice(0, 20)
    .map((f) => ({ column: String(f.column).slice(0, 60), op: f.op, value: f.value }));
}

function cleanSpec(v: unknown, known: Set<string>): VizSpec | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  if (!validId(s.datasetId) || !known.has(s.datasetId as string)) return null;
  if (!VIZ_TYPES.includes(s.type as string)) return null;
  const metrics = Array.isArray(s.metrics) ? s.metrics.filter((m): m is string => typeof m === 'string').slice(0, 6) : [];
  if (!metrics.length) return null;
  const join = s.join as { datasetId?: unknown; on?: unknown } | undefined;
  const validJoin = join && validId(join.datasetId) && known.has(join.datasetId as string) && Array.isArray(join.on);
  return {
    id: validId(s.id) ? (s.id as string) : newId(),
    title: String(s.title ?? '').slice(0, 120) || 'Grafico',
    type: s.type as VizSpec['type'],
    datasetId: s.datasetId as string,
    ...(validJoin ? { join: { datasetId: join!.datasetId as string, on: (join!.on as unknown[]).filter((k): k is string => typeof k === 'string').slice(0, 3) } } : {}),
    ...(typeof s.x === 'string' ? { x: s.x.slice(0, 60) } : {}),
    metrics,
    ...(typeof s.seriesBy === 'string' ? { seriesBy: s.seriesBy.slice(0, 60) } : {}),
    ...(typeof s.agg === 'string' && ['sum', 'avg', 'min', 'max', 'count'].includes(s.agg) ? { agg: s.agg as VizSpec['agg'] } : {}),
    filters: cleanFilters(s.filters),
    ...(s.sort && typeof s.sort === 'object' ? { sort: { key: String((s.sort as Record<string, unknown>).key ?? '').slice(0, 60), dir: (s.sort as Record<string, unknown>).dir === 'asc' ? 'asc' : 'desc' } } : {}),
    ...(Number(s.limit) > 0 ? { limit: Math.min(Number(s.limit), 500) } : {}),
    ...(['day', 'week', 'month'].includes(s.dateGrain as string) ? { dateGrain: s.dateGrain as VizSpec['dateGrain'] } : {}),
    ...(typeof s.note === 'string' ? { note: s.note.slice(0, 300) } : {}),
  };
}

export async function handleData(body: DataBody, session: AppSession, ts: TenantStore, rawStore: BlobStore): Promise<Response> {
  const scope = session.scope;
  const visible = async () => (scope ? (await readIndex<DatasetMeta>(ts, 'dataset')).filter((d) => inScope(scope, d.accounts)) : []);

  switch (body.action) {
    case 'info': {
      const stats = (await ts.get<CacheStats>('stats', 'mcp')) ?? { hits: 0, misses: 0, blocked: 0 };
      return ok({ info: sessionInfoOf(session), stats, canManageCache: isInternal(session) });
    }

    // --- Dataset ---
    case 'datasets.list':
      return ok({ datasets: await visible() });
    case 'datasets.get': {
      if (!validId(body.id)) return fail(400, 'Identificativo non valido');
      const ds = await ts.get<Dataset>('dataset', body.id);
      if (!ds || !scope || !inScope(scope, ds.accounts)) return fail(404, 'Dataset non trovato');
      return ok({ dataset: ds });
    }
    case 'datasets.period': {
      if (!validId(body.id)) return fail(400, 'Identificativo non valido');
      const ds = await ts.get<Dataset>('dataset', body.id);
      if (!ds || !scope || !inScope(scope, ds.accounts)) return fail(404, 'Dataset non trovato');
      try {
        const { from, to } = validPeriod(body.dateFrom, body.dateTo);
        return ok({ data: await datasetForPeriod(new McpGateway(ts, rawStore, scope), ds, from, to) });
      } catch (err) {
        if (err instanceof PeriodError) return fail(422, err.message);
        throw err;
      }
    }

    case 'datasets.delete': {
      if (!validId(body.id)) return fail(400, 'Identificativo non valido');
      const ds = await ts.get<Dataset>('dataset', body.id);
      if (!ds) return fail(404, 'Dataset non trovato');
      if (!isInternal(session) && ds.createdBy !== session.uname) return fail(403, 'Puoi eliminare solo i dataset creati da te.');
      await ts.delete('dataset', body.id);
      await removeFromIndex(ts, 'dataset', body.id);
      return ok();
    }

    // --- Dashboard ---
    case 'dashboards.list':
      return ok({ dashboards: await readIndex<DashboardMeta>(ts, 'dashboard') });
    case 'dashboards.get': {
      if (!validId(body.id)) return fail(400, 'Identificativo non valido');
      const d = await ts.get<Dashboard>('dashboard', body.id);
      return d ? ok({ dashboard: d }) : fail(404, 'Dashboard non trovata');
    }
    case 'dashboards.save': {
      const raw = body.dashboard as Partial<Dashboard> | undefined;
      if (!raw || typeof raw !== 'object') return fail(400, 'Dashboard mancante');
      const known = new Set((await visible()).map((d) => d.id));
      const widgets: DashboardWidget[] = [];
      for (const w of Array.isArray(raw.widgets) ? raw.widgets.slice(0, 40) : []) {
        const spec = cleanSpec(w?.spec, known);
        if (spec) widgets.push({ id: validId(w.id) ? w.id : newId(), spec, w: w.w === 1 || w.w === 3 ? w.w : 2 });
      }
      const id = validId(raw.id) ? raw.id : newId();
      const existing = await ts.get<Dashboard>('dashboard', id);
      const now = new Date().toISOString();
      const f = raw.filters ?? { dims: [] };
      const dashboard: Dashboard = {
        id,
        title: String(raw.title ?? '').slice(0, 120) || 'Nuova dashboard',
        description: typeof raw.description === 'string' ? raw.description.slice(0, 500) : undefined,
        widgets,
        filters: {
          dateFrom: typeof f.dateFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.dateFrom) ? f.dateFrom : undefined,
          dateTo: typeof f.dateTo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.dateTo) ? f.dateTo : undefined,
          dims: cleanFilters(f.dims),
        },
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        updatedBy: session.uname,
      };
      if (JSON.stringify(dashboard).length > MAX_DASHBOARD_BYTES) return fail(413, 'Dashboard troppo grande');
      await ts.set('dashboard', id, dashboard);
      await upsertIndex<DashboardMeta>(ts, 'dashboard', { id, title: dashboard.title, widgetCount: widgets.length, updatedAt: now, updatedBy: session.uname });
      return ok({ dashboard });
    }
    case 'dashboards.delete': {
      if (!validId(body.id)) return fail(400, 'Identificativo non valido');
      if (!isInternal(session)) {
        const d = await ts.get<Dashboard>('dashboard', body.id);
        if (d && d.updatedBy !== session.uname) return fail(403, 'Solo il personale Moca può eliminare dashboard di altri.');
      }
      await ts.delete('dashboard', body.id);
      await removeFromIndex(ts, 'dashboard', body.id);
      return ok();
    }

    // --- Conversazioni ---
    case 'conversations.list':
      return ok({ conversations: await readIndex<ConversationMeta>(ts, 'conversation') });
    case 'conversations.get': {
      if (!validId(body.id)) return fail(400, 'Identificativo non valido');
      const c = await ts.get<Conversation>('conversation', body.id);
      return c ? ok({ conversation: c }) : fail(404, 'Conversazione non trovata');
    }
    case 'conversations.delete': {
      if (!validId(body.id)) return fail(400, 'Identificativo non valido');
      const c = await ts.get<Conversation>('conversation', body.id);
      if (c && !isInternal(session) && c.createdBy !== session.uname) return fail(403, 'Puoi eliminare solo le tue conversazioni.');
      await ts.delete('conversation', body.id);
      await ts.delete('transcript', body.id);
      await removeFromIndex(ts, 'conversation', body.id);
      return ok();
    }

    // --- Avanzamento di una risposta AI ---
    case 'run.status': {
      if (!validId(body.id)) return fail(400, 'Identificativo non valido');
      const run = await ts.get<RunState>('run', body.id);
      if (!run) return fail(404, 'Elaborazione non trovata');
      const after = Math.max(0, Number(body.after) || 0);
      return ok({ status: run.status, events: run.events.slice(after), total: run.events.length, message: run.message ?? null });
    }

    case 'run.cancel': {
      if (!validId(body.id)) return fail(400, 'Identificativo non valido');
      const run = await ts.get<RunState>('run', body.id);
      if (!run) return fail(404, 'Elaborazione non trovata');
      // Segnale separato: la background function riscrive il run a ogni passaggio.
      await ts.set('run', stopKey(body.id), { at: new Date().toISOString(), by: session.uname });
      return ok();
    }

    // --- Cache ---
    case 'cache.clear': {
      if (!isInternal(session)) return fail(403, 'Operazione riservata al personale Moca.');
      const prefixKey = ts.key('mcp', 'x');
      const prefix = prefixKey.slice(0, -1);
      const { blobs } = await rawStore.list({ prefix });
      for (const b of blobs) if (b.key.startsWith(prefix)) await rawStore.delete(b.key);
      return ok({ removed: blobs.length });
    }

    default:
      return fail(400, 'Azione non valida');
  }
}
