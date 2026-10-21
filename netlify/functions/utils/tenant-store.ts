import type { AppSession } from './session';

/**
 * Archivio per cliente su Netlify Blobs.
 *
 * Tutte le chiavi hanno la forma t/<cliente>/<tipo>/<id> e si costruiscono
 * SOLO qui, a partire dalla sessione verificata: nessuna funzione compone
 * chiavi a mano e nessun id arriva dal browser senza validazione. Due
 * clienti non condividono mai una chiave.
 */

export type Kind = 'dataset' | 'dashboard' | 'conversation' | 'run' | 'mcp' | 'observed' | 'stats' | 'index' | 'transcript';

/** Sottoinsieme dell'API di @netlify/blobs usato qui (sostituibile nei test). */
export interface BlobStore {
  get(key: string, opts: { type: 'json' }): Promise<unknown>;
  getWithMetadata(key: string, opts: { type: 'json' }): Promise<{ data: unknown; etag?: string } | null>;
  setJSON(key: string, value: unknown, opts?: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<{ modified: boolean; etag?: string } | void>;
  delete(key: string): Promise<void>;
  list(opts: { prefix: string }): Promise<{ blobs: { key: string }[] }>;
}

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const CID_RE = /^[A-Za-z0-9-]{3,64}$/;

export class TenantError extends Error {}

export function validId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

export class TenantStore {
  private readonly prefix: string;

  constructor(
    private readonly store: BlobStore,
    session: Pick<AppSession, 'cid'>,
  ) {
    if (!CID_RE.test(session.cid)) throw new TenantError('Cliente non valido');
    this.prefix = `t/${session.cid}/`;
  }

  key(kind: Kind, id: string): string {
    if (!validId(id)) throw new TenantError('Identificativo non valido');
    return `${this.prefix}${kind}/${id}`;
  }

  async get<T>(kind: Kind, id: string): Promise<T | null> {
    return ((await this.store.get(this.key(kind, id), { type: 'json' })) as T | null) ?? null;
  }

  async set(kind: Kind, id: string, value: unknown): Promise<void> {
    await this.store.setJSON(this.key(kind, id), value);
  }

  async delete(kind: Kind, id: string): Promise<void> {
    await this.store.delete(this.key(kind, id));
  }

  async listIds(kind: Kind): Promise<string[]> {
    const p = `${this.prefix}${kind}/`;
    const { blobs } = await this.store.list({ prefix: p });
    return blobs.map((b) => b.key.slice(p.length)).filter(validId);
  }

  /**
   * Aggiorna un documento con scrittura condizionale (etag): due modifiche
   * contemporanee non si sovrascrivono, si riprova sulla versione nuova.
   */
  async update<T>(kind: Kind, id: string, fallback: T, mutate: (current: T) => T): Promise<T> {
    const key = this.key(kind, id);
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await this.store.getWithMetadata(key, { type: 'json' });
      const next = mutate(((cur?.data as T | undefined) ?? structuredClone(fallback)) as T);
      const res = await this.store.setJSON(key, next, cur?.etag ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
      if (!res || res.modified !== false) return next;
    }
    throw new TenantError('Salvataggio non riuscito per modifiche concorrenti, riprova.');
  }
}

/** Indice leggero di un tipo di documento, per gli elenchi. */
export type IndexEntry<M> = M & { id: string };

export async function upsertIndex<M extends { id: string }>(ts: TenantStore, kind: Kind, entry: M, max = 500): Promise<void> {
  await ts.update<M[]>('index', kind, [], (list) => [entry, ...list.filter((e) => e.id !== entry.id)].slice(0, max));
}

export async function removeFromIndex(ts: TenantStore, kind: Kind, id: string): Promise<void> {
  await ts.update<{ id: string }[]>('index', kind, [], (list) => list.filter((e) => e.id !== id));
}

export async function readIndex<M>(ts: TenantStore, kind: Kind): Promise<M[]> {
  return (await ts.get<M[]>('index', kind)) ?? [];
}

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}
