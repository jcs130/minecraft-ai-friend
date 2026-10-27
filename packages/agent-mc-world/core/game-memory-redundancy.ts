/** Local redundancy metadata. These receipts/caches never replace the versioned notebook. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameMemoryConfig } from './game-memory-service.ts';
import { artifactRef, type ArtifactRef } from './game-memory-learning-contract.ts';

export const memoryHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const canonicalMemoryJson = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export function memoryTarget(cfg: GameMemoryConfig, scope: string): string {
  return memoryHash(canonicalMemoryJson([scope, cfg.mode, cfg.provider, cfg.endpoint.replace(/\/$/, ''), cfg.model,
    cfg.libraryId, cfg.projectId, cfg.scopeId]));
}
export function memoryKnowledgeBinding(cfg: GameMemoryConfig, scope: string): string {
  return memoryHash(canonicalMemoryJson([cfg.provider, new URL(cfg.endpoint).href.replace(/\/$/, ''), cfg.provider === 'powercontext' ? cfg.scopeId : scope]));
}
function pathFor(directory: string | null, folder: string, binding: string) {
  if (!directory || !/^[a-f0-9]{64}$/.test(binding)) throw new Error('Persistent game memory storage required');
  return join(directory, folder, binding + '.json');
}
function read(path: string): any {
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('Memory redundancy metadata exceeds capacity; preserved');
  try { return JSON.parse(bytes.toString()); } catch { throw new Error('Invalid memory redundancy metadata; preserved'); }
}
function save(path: string, value: unknown) {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw new Error('Memory redundancy metadata exceeds capacity; preserved');
  mkdirSync(join(path, '..'), { recursive: true }); const temp = path + '.' + randomUUID() + '.tmp';
  try { writeFileSync(temp, body, { mode: 0o600, flag: 'wx' }); renameSync(temp, path); }
  finally { rmSync(temp, { force: true }); }
}

export interface ReplicaReceipt {
  revision: number; contentHash: string; at: string; status: 'unverified' | 'pending' | 'stored';
  searchVerified: boolean; eventId?: string | null;
  artifacts?: ArtifactRef[]; scopeId?: string;
  pendingCorrection?: boolean;
  nativeRevisions?: boolean;
}
export class MemoryReplicaLedger {
  constructor(private readonly directory: string | null) {}
  private open(binding: string, scope: string): { version: 1; scope: string; entries: Record<string, ReplicaReceipt> } {
    const value = read(pathFor(this.directory, 'replicas', binding));
    if (!value) return { version: 1, scope, entries: {} };
    if (value.version !== 1 || value.scope !== scope || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries)
      || Object.keys(value.entries).length > 2000 || Object.entries(value.entries).some(([id, v]: [string, any]) =>
        !/^[\w-]{36}$/.test(id) || !v || !Number.isInteger(v.revision) || v.revision < 1 || !/^[a-f0-9]{64}$/.test(v.contentHash)
        || !Number.isFinite(Date.parse(v.at)) || !['unverified', 'pending', 'stored'].includes(v.status) || typeof v.searchVerified !== 'boolean'
        || (v.pendingCorrection !== undefined && typeof v.pendingCorrection !== 'boolean')
        || (v.nativeRevisions !== undefined && typeof v.nativeRevisions !== 'boolean')
        || (v.artifacts !== undefined && (!Array.isArray(v.artifacts) || v.artifacts.length > 100 || v.artifacts.some((ref: unknown) => !artifactRef.safeParse(ref).success)))))
      throw new Error('Invalid replication ledger; preserve it and reconcile remote state before retrying');
    return value;
  }
  entries(binding: string, scope: string) { return this.open(binding, scope).entries; }
  put(binding: string, scope: string, id: string, receipt: ReplicaReceipt) {
    const ledger = this.open(binding, scope), old = ledger.entries[id];
    // A slow older request cannot overwrite a newer revision or a confirmed receipt.
    if (old?.revision === receipt.revision && old.contentHash === receipt.contentHash && (old.searchVerified || old.status === 'stored') && !receipt.searchVerified) {
      // A verified native-Artifact reconciliation can improve a legacy stored receipt without claiming a search.
      if (receipt.status !== 'stored' || receipt.nativeRevisions !== true || old.nativeRevisions === true) return;
      receipt = { ...receipt, searchVerified: old.searchVerified };
    }
    if (old && old.revision > receipt.revision) return;
    if (!old && Object.keys(ledger.entries).length >= 2000) throw new Error('Replication ledger capacity reached; preserve/export before rotating');
    ledger.entries[id] = receipt;
    save(pathFor(this.directory, 'replicas', binding), ledger);
  }
}

export const KNOWLEDGE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
type CacheEntry = { at: string; result: Record<string, unknown>; digest: string };
/** Only bounded, already validated historical reads belong here; never capability/state/write acknowledgements. */
export class MemoryKnowledgeCache {
  constructor(private readonly directory: string | null, private readonly now: () => number = Date.now) {}
  private open(binding: string, scope: string): { version: 1; scope: string; entries: Record<string, CacheEntry> } {
    const value = read(pathFor(this.directory, 'knowledge-cache', binding));
    if (!value) return { version: 1, scope, entries: {} };
    if (value.version !== 1 || value.scope !== scope || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries)
      || Object.keys(value.entries).length > 128) throw new Error('Invalid historical knowledge cache');
    return value;
  }
  private key(operation: string, input: unknown) { return memoryHash(canonicalMemoryJson({ operation, input })); }
  invalidatePrepared(binding: string, scope: string) {
    // A local correction can affect any cached prepared summary. This discards replaceable cache, never notebook/server history.
    const path = pathFor(this.directory, 'knowledge-cache', binding);
    if (!existsSync(path)) return;
    const cache = this.open(binding, scope);
    cache.entries = {};
    save(path, cache);
  }
  invalidate(binding: string, scope: string, operation: string, input: unknown) {
    if (!['prepare', 'artifact', 'source'].includes(operation)) return;
    const cache = this.open(binding, scope);
    delete cache.entries[this.key(operation, input)];
    save(pathFor(this.directory, 'knowledge-cache', binding), cache);
  }
  get(binding: string, scope: string, operation: string, input: unknown) {
    if (!['prepare', 'artifact', 'source'].includes(operation)) return null;
    try {
      const item = this.open(binding, scope).entries[this.key(operation, input)];
      if (!item || !item.result || typeof item.result !== 'object' || Array.isArray(item.result)) return null;
      const ageMs = this.now() - Date.parse(item.at);
      if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > KNOWLEDGE_CACHE_MAX_AGE_MS
        || memoryHash(canonicalMemoryJson(item.result)) !== item.digest) return null;
      return { result: item.result, at: item.at, ageMs, maxAgeMs: KNOWLEDGE_CACHE_MAX_AGE_MS };
    } catch { return null; }
  }
  put(binding: string, scope: string, operation: string, input: unknown, result: Record<string, unknown>) {
    if (!['prepare', 'artifact', 'source'].includes(operation)) return;
    const body = canonicalMemoryJson(result);
    if (Buffer.byteLength(body) > 65536) throw new Error('Historical cache result too large');
    const cache = this.open(binding, scope), key = this.key(operation, input);
    cache.entries[key] = { at: new Date(this.now()).toISOString(), result, digest: memoryHash(body) };
    const ordered = Object.keys(cache.entries).sort((a, b) => Date.parse(cache.entries[a].at) - Date.parse(cache.entries[b].at));
    // Only this replaceable cache is bounded by eviction; personal notes and their revisions are never removed.
    for (const oldest of ordered.slice(0, Math.max(0, ordered.length - 128))) delete cache.entries[oldest];
    save(pathFor(this.directory, 'knowledge-cache', binding), cache);
  }
}
