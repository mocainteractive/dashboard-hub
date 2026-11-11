/**
 * Tipi condivisi tra browser e Netlify Functions.
 */

/** Piattaforme del data lake (stesse chiavi di clients/<slug>.json). */
export type PlatformKey =
  | 'ga4'
  | 'search_console'
  | 'google_ads'
  | 'merchant_center'
  | 'meta_ads'
  | 'bing_ads'
  | 'tiktok_ads'
  | 'pinterest_ads'
  | 'criteo'
  | 'linkedin_ads';

/** Piattaforme con un server MCP interrogabile dall'app. */
export type McpPlatform = 'ga4' | 'search_console' | 'google_ads' | 'meta_ads' | 'pinterest_ads';

export const MCP_PLATFORMS: McpPlatform[] = ['ga4', 'search_console', 'google_ads', 'meta_ads', 'pinterest_ads'];

export const PLATFORM_LABELS: Record<PlatformKey, string> = {
  ga4: 'Google Analytics 4',
  search_console: 'Search Console',
  google_ads: 'Google Ads',
  merchant_center: 'Merchant Center',
  meta_ads: 'Meta Ads',
  bing_ads: 'Microsoft Ads',
  tiktok_ads: 'TikTok Ads',
  pinterest_ads: 'Pinterest Ads',
  criteo: 'Criteo',
  linkedin_ads: 'LinkedIn Ads',
};

export interface ScopeAccount {
  platform: PlatformKey;
  /** Identificativo canonico (property_id, site, customer_id, account_id). */
  id: string;
  validFrom?: string;
  validTo?: string | null;
}

/** Perimetro del cliente, letto da DATA_LAKE_CLIENT_JSON. */
export interface ClientScope {
  slug: string;
  displayName: string;
  gcpProject?: string;
  timezone?: string;
  currency?: string;
  accounts: ScopeAccount[];
}

/** L'app usa solo Claude (Anthropic). */
export type AiProvider = 'anthropic';

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Claude',
};

// --- Dataset e visualizzazioni ---

export type ColumnType = 'date' | 'dimension' | 'metric';
export type ColumnFormat = 'number' | 'decimal' | 'currency' | 'percent' | 'duration';
export type Agg = 'sum' | 'avg' | 'min' | 'max' | 'count';

export interface Column {
  key: string;
  label: string;
  type: ColumnType;
  format?: ColumnFormat;
  /** Aggregazione naturale della metrica: sum per i conteggi, avg per i tassi. */
  agg?: Agg;
}

export type Cell = string | number | null;
export type Row = Record<string, Cell>;

export interface SourceCall {
  platform: McpPlatform;
  tool: string;
  args: Record<string, unknown>;
  fetchedAt: string;
  fromCache: boolean;
}

export interface DatasetMeta {
  id: string;
  title: string;
  description: string;
  platforms: McpPlatform[];
  /** Account usati per produrlo: se escono dal perimetro il dataset sparisce. */
  accounts: string[];
  dateFrom?: string;
  dateTo?: string;
  columns: Column[];
  rowCount: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  /**
   * Tabella della risposta MCP da cui è stato estratto (solo dataset creati
   * dal server, non scritti dal modello): permette di rileggerlo per un altro
   * periodo con la stessa chiamata.
   */
  sourceTable?: string;
}

/** Dati di un dataset riletti per il periodo della dashboard. */
export interface PeriodData {
  columns: Column[];
  rows: Row[];
  dateFrom: string;
  dateTo: string;
  fetchedAt: string;
  fromCache: boolean;
}

/** Come il periodo della dashboard è applicato a un widget. */
export type PeriodStatus =
  /** Nessun periodo selezionato. */
  | { kind: 'none' }
  /** Filtrato sulle righe già presenti (il dataset copre il periodo). */
  | { kind: 'filtered' }
  /** Dati riletti dal server per il periodo scelto. */
  | { kind: 'refetched'; fetchedAt: string }
  /** Non applicabile: dati di un periodo fisso. */
  | { kind: 'fixed'; dateFrom?: string; dateTo?: string; reason: string };

export interface Dataset extends DatasetMeta {
  rows: Row[];
  sourceCalls: SourceCall[];
}

export type FilterOp = 'eq' | 'neq' | 'in' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'between';

export interface Filter {
  column: string;
  op: FilterOp;
  value: Cell | Cell[];
}

export type DateGrain = 'day' | 'week' | 'month';

export interface QuerySpec {
  filters?: Filter[];
  groupBy?: string[];
  metrics?: { key: string; agg?: Agg }[];
  sort?: { key: string; dir: 'asc' | 'desc' };
  limit?: number;
  dateGrain?: DateGrain;
}

export interface JoinSpec {
  datasetId: string;
  /** Colonne comuni su cui unire (es. ["date"]). */
  on: string[];
}

export type VizType = 'kpi' | 'line' | 'area' | 'bar' | 'hbar' | 'stacked' | 'pie' | 'table' | 'scatter';

export interface VizSpec {
  id: string;
  title: string;
  type: VizType;
  datasetId: string;
  join?: JoinSpec;
  /** Asse X o categoria. */
  x?: string;
  metrics: string[];
  /** Divide la metrica in serie per dimensione (es. canale). */
  seriesBy?: string;
  agg?: Agg;
  filters?: Filter[];
  sort?: { key: string; dir: 'asc' | 'desc' };
  limit?: number;
  dateGrain?: DateGrain;
  note?: string;
}

export interface DashboardWidget {
  id: string;
  spec: VizSpec;
  /** Colonne occupate su 3. */
  w: 1 | 2 | 3;
}

export interface DashboardFilters {
  dateFrom?: string;
  dateTo?: string;
  dims: Filter[];
}

export interface Dashboard {
  id: string;
  title: string;
  description?: string;
  widgets: DashboardWidget[];
  filters: DashboardFilters;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface DashboardMeta {
  id: string;
  title: string;
  widgetCount: number;
  updatedAt: string;
  updatedBy: string;
}

// --- Conversazioni ---

export interface RunEvent {
  at: string;
  kind: 'thinking' | 'mcp' | 'cache' | 'dataset' | 'viz' | 'query' | 'blocked' | 'error' | 'info';
  text: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  author?: string;
  provider?: AiProvider;
  vizs?: VizSpec[];
  datasetIds?: string[];
  events?: RunEvent[];
  error?: boolean;
}

export interface ConversationMeta {
  id: string;
  title: string;
  updatedAt: string;
  createdBy: string;
  messageCount: number;
}

export interface Conversation extends ConversationMeta {
  createdAt: string;
  messages: ChatMessage[];
}

export type RunStatus = 'queued' | 'running' | 'done' | 'error';

export interface RunState {
  id: string;
  conversationId: string;
  status: RunStatus;
  events: RunEvent[];
  provider: AiProvider;
  startedAt: string;
  finishedAt?: string;
  /** Messaggio finale dell'assistente, quando status = done/error. */
  message?: ChatMessage;
  /** Richiesta di interruzione dall'utente. */
  cancelRequested?: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
  blocked: number;
  lastHitAt?: string;
  lastMissAt?: string;
}

/** Riepilogo pubblico della sessione, l'unico che arriva al browser. */
export interface SessionInfo {
  scope: ClientScope | null;
  scopeError?: string;
  providers: AiProvider[];
  mcpPlatforms: McpPlatform[];
  /** true quando il server supporta la chat in streaming (POC locale, Cloud Run). */
  streaming?: boolean;
}

/** Eventi della chat in streaming (Server-Sent Events). */
export type StreamEvent =
  | { type: 'start'; conversationId: string; title: string }
  | { type: 'step'; event: RunEvent }
  | { type: 'text'; delta: string }
  | { type: 'turn' }
  | { type: 'viz'; spec: VizSpec }
  | { type: 'done'; message: ChatMessage }
  | { type: 'error'; error: string };
