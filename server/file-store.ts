import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { BlobStore } from '../netlify/functions/utils/tenant-store';

/**
 * Archivio su file per il POC locale, con la stessa interfaccia di Netlify
 * Blobs usata dall'app (TenantStore, cache MCP). Un file JSON per chiave,
 * etag = hash del contenuto per le scritture condizionali.
 */
export class FileBlobStore implements BlobStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private file(key: string) {
    return join(this.dir, `${encodeURIComponent(key)}.json`);
  }

  private read(key: string): { text: string; etag: string } | null {
    const f = this.file(key);
    if (!existsSync(f)) return null;
    const text = readFileSync(f, 'utf8');
    return { text, etag: createHash('sha1').update(text).digest('hex') };
  }

  async get(key: string): Promise<unknown> {
    const r = this.read(key);
    return r ? JSON.parse(r.text) : null;
  }

  async getWithMetadata(key: string): Promise<{ data: unknown; etag?: string } | null> {
    const r = this.read(key);
    return r ? { data: JSON.parse(r.text), etag: r.etag } : null;
  }

  async setJSON(key: string, value: unknown, opts?: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<{ modified: boolean; etag?: string }> {
    const cur = this.read(key);
    if (opts?.onlyIfNew && cur) return { modified: false };
    if (opts?.onlyIfMatch && cur?.etag !== opts.onlyIfMatch) return { modified: false };
    const text = JSON.stringify(value);
    const f = this.file(key);
    // Scrittura atomica: file temporaneo e rinomina.
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, f);
    return { modified: true, etag: createHash('sha1').update(text).digest('hex') };
  }

  async delete(key: string): Promise<void> {
    rmSync(this.file(key), { force: true });
  }

  async list({ prefix }: { prefix: string }): Promise<{ blobs: { key: string }[] }> {
    const keys = readdirSync(this.dir)
      .filter((n) => n.endsWith('.json'))
      .map((n) => decodeURIComponent(n.slice(0, -5)))
      .filter((k) => k.startsWith(prefix));
    return { blobs: keys.map((key) => ({ key })) };
  }
}
