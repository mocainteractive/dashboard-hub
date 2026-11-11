import type {
  CacheStats,
  ChatMessage,
  Conversation,
  ConversationMeta,
  Dashboard,
  DashboardMeta,
  Dataset,
  DatasetMeta,
  PeriodData,
  RunEvent,
  RunStatus,
  SessionInfo,
  StreamEvent,
} from '../shared/types';

/**
 * Client delle Functions dell'app. Ogni richiesta porta solo la sessione
 * cifrata: il cliente lo decide il server, mai il browser.
 */

export interface RunStatusResponse {
  status: RunStatus;
  events: RunEvent[];
  total: number;
  message: ChatMessage | null;
}

export interface Api {
  info(): Promise<{ info: SessionInfo; stats: CacheStats; canManageCache: boolean }>;
  listDatasets(): Promise<DatasetMeta[]>;
  getDataset(id: string): Promise<Dataset>;
  deleteDataset(id: string): Promise<void>;
  /** Dataset riletto dal server per un altro periodo (stessa chiamata MCP, con cache). */
  datasetForPeriod(id: string, dateFrom: string, dateTo: string): Promise<PeriodData>;
  listDashboards(): Promise<DashboardMeta[]>;
  getDashboard(id: string): Promise<Dashboard>;
  saveDashboard(d: Partial<Dashboard>): Promise<Dashboard>;
  deleteDashboard(id: string): Promise<void>;
  listConversations(): Promise<ConversationMeta[]>;
  getConversation(id: string): Promise<Conversation>;
  deleteConversation(id: string): Promise<void>;
  /** Flusso con polling (Netlify Functions). */
  chatStart(p: { conversationId?: string; message: string; refresh?: boolean }): Promise<{ runId: string; conversationId: string }>;
  runStatus(runId: string, after: number): Promise<RunStatusResponse>;
  cancelRun(runId: string): Promise<void>;
  /** Chat in streaming (POC locale, Cloud Run): eventi in tempo reale. */
  chatStream(p: { conversationId?: string; message: string; refresh?: boolean }, onEvent: (e: StreamEvent) => void, signal: AbortSignal): Promise<void>;
  clearCache(): Promise<number>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const isLocal = () => window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

/** In locale una sessione non più valida (server riavviato, cliente cambiato) si rinnova da sola. */
function sessionExpired(status: number) {
  if (status !== 401 || !isLocal()) return;
  try {
    sessionStorage.removeItem('moca_session');
  } catch {
    // Nessun effetto: si ricarica comunque.
  }
  window.location.reload();
}

export function createApi(appSession: string): Api {
  async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`/api/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${appSession}` },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiError('Connessione non riuscita, controlla la rete.', 0);
    }
    const data = await res.json().catch(() => null);
    sessionExpired(res.status);
    if (!res.ok || !data?.success) throw new ApiError(data?.error ?? 'Errore imprevisto, riprova.', res.status);
    return data as T;
  }

  async function chatStream(p: { conversationId?: string; message: string; refresh?: boolean }, onEvent: (e: StreamEvent) => void, signal: AbortSignal) {
    let res: Response;
    try {
      res = await fetch('/api/chat-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${appSession}` },
        body: JSON.stringify({ conversation_id: p.conversationId, message: p.message, refresh: p.refresh }),
        signal,
      });
    } catch {
      if (signal.aborted) return;
      throw new ApiError('Connessione non riuscita, controlla la rete.', 0);
    }
    if (!res.ok || !res.body || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
      const data = await res.json().catch(() => null);
      sessionExpired(res.status);
      throw new ApiError(data?.error ?? 'Errore imprevisto, riprova.', res.status);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const data = chunk
            .split('\n')
            .filter((l) => l.startsWith('data: '))
            .map((l) => l.slice(6))
            .join('\n');
          if (data) onEvent(JSON.parse(data) as StreamEvent);
        }
      }
    } catch {
      if (signal.aborted) return;
      throw new ApiError('Connessione interrotta durante la risposta.', 0);
    }
  }
  const data = <T>(action: string, extra: Record<string, unknown> = {}) => post<T>('data', { action, ...extra });

  return {
    info: () => data('info'),
    listDatasets: async () => (await data<{ datasets: DatasetMeta[] }>('datasets.list')).datasets,
    getDataset: async (id) => (await data<{ dataset: Dataset }>('datasets.get', { id })).dataset,
    deleteDataset: async (id) => void (await data('datasets.delete', { id })),
    datasetForPeriod: async (id, dateFrom, dateTo) => (await data<{ data: PeriodData }>('datasets.period', { id, dateFrom, dateTo })).data,
    listDashboards: async () => (await data<{ dashboards: DashboardMeta[] }>('dashboards.list')).dashboards,
    getDashboard: async (id) => (await data<{ dashboard: Dashboard }>('dashboards.get', { id })).dashboard,
    saveDashboard: async (dashboard) => (await data<{ dashboard: Dashboard }>('dashboards.save', { dashboard })).dashboard,
    deleteDashboard: async (id) => void (await data('dashboards.delete', { id })),
    listConversations: async () => (await data<{ conversations: ConversationMeta[] }>('conversations.list')).conversations,
    getConversation: async (id) => (await data<{ conversation: Conversation }>('conversations.get', { id })).conversation,
    deleteConversation: async (id) => void (await data('conversations.delete', { id })),
    chatStart: async ({ conversationId, message, refresh }) => {
      const r = await post<{ run_id: string; conversation_id: string }>('chat-start', { conversation_id: conversationId, message, refresh });
      return { runId: r.run_id, conversationId: r.conversation_id };
    },
    runStatus: (runId, after) => data<RunStatusResponse>('run.status', { id: runId, after }),
    cancelRun: async (runId) => void (await data('run.cancel', { id: runId })),
    chatStream,
    clearCache: async () => (await data<{ removed: number }>('cache.clear')).removed,
  };
}
