import type {
  AiProvider,
  CacheStats,
  ChatMessage,
  Conversation,
  ConversationMeta,
  Dashboard,
  DashboardMeta,
  Dataset,
  DatasetMeta,
  RunEvent,
  RunStatus,
  SessionInfo,
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
  listDashboards(): Promise<DashboardMeta[]>;
  getDashboard(id: string): Promise<Dashboard>;
  saveDashboard(d: Partial<Dashboard>): Promise<Dashboard>;
  deleteDashboard(id: string): Promise<void>;
  listConversations(): Promise<ConversationMeta[]>;
  getConversation(id: string): Promise<Conversation>;
  deleteConversation(id: string): Promise<void>;
  chatStart(p: { conversationId?: string; message: string; provider: AiProvider; refresh?: boolean }): Promise<{ runId: string; conversationId: string }>;
  runStatus(runId: string, after: number): Promise<RunStatusResponse>;
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
    if (!res.ok || !data?.success) throw new ApiError(data?.error ?? 'Errore imprevisto, riprova.', res.status);
    return data as T;
  }
  const data = <T>(action: string, extra: Record<string, unknown> = {}) => post<T>('data', { action, ...extra });

  return {
    info: () => data('info'),
    listDatasets: async () => (await data<{ datasets: DatasetMeta[] }>('datasets.list')).datasets,
    getDataset: async (id) => (await data<{ dataset: Dataset }>('datasets.get', { id })).dataset,
    deleteDataset: async (id) => void (await data('datasets.delete', { id })),
    listDashboards: async () => (await data<{ dashboards: DashboardMeta[] }>('dashboards.list')).dashboards,
    getDashboard: async (id) => (await data<{ dashboard: Dashboard }>('dashboards.get', { id })).dashboard,
    saveDashboard: async (dashboard) => (await data<{ dashboard: Dashboard }>('dashboards.save', { dashboard })).dashboard,
    deleteDashboard: async (id) => void (await data('dashboards.delete', { id })),
    listConversations: async () => (await data<{ conversations: ConversationMeta[] }>('conversations.list')).conversations,
    getConversation: async (id) => (await data<{ conversation: Conversation }>('conversations.get', { id })).conversation,
    deleteConversation: async (id) => void (await data('conversations.delete', { id })),
    chatStart: async ({ conversationId, message, provider, refresh }) => {
      const r = await post<{ run_id: string; conversation_id: string }>('chat-start', { conversation_id: conversationId, message, provider, refresh });
      return { runId: r.run_id, conversationId: r.conversation_id };
    },
    runStatus: (runId, after) => data<RunStatusResponse>('run.status', { id: runId, after }),
    clearCache: async () => (await data<{ removed: number }>('cache.clear')).removed,
  };
}
