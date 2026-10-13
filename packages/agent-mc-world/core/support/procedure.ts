/** Portable procedure artifacts. Memory owns versions; Worlds resolve explicitly selected blobs. */
import { createHash } from 'node:crypto';

export const PROCEDURE_SCHEMA = 'agent-mc.procedure/v1' as const;
export const LEGACY_PROCEDURE_SCHEMA = 'cortico.procedure/v1' as const;
export const PROCEDURE_RECEIPT_SCHEMA = 'agent-mc.procedure-run/v1' as const;
export const PROCEDURE_RECEIPT_MIME = 'application/vnd.agent-mc.procedure-run+json';
export const PROCEDURE_LIMITS = Object.freeze({ sourceChars: 12_000, artifactChars: 20_000,
  graphSourceChars: 48_000, versions: 8, depth: 4, invocations: 32 });

export interface ProcedureReference { handle: string; revision: string }
export interface ProcedureVersion {
  schema: typeof PROCEDURE_SCHEMA | typeof LEGACY_PROCEDURE_SCHEMA;
  id: string;
  adapter: string;
  description: string;
  conditions: string[];
  code: string;
  dependencies: Record<string, ProcedureReference>;
  parent: string | null;
  author: { kind: 'agent' | 'operator'; role: string; callId?: string };
  createdAt: string;
  sourceHash: string;
  revision: string;
}
export interface ProcedureGraph { root: string; versions: Record<string, ProcedureVersion> }
export interface ProcedureInvocation {
  invocation: number; revision: string; parent?: number; startedAt: string; endedAt?: string;
  status: 'running' | 'completed' | 'failed'; error?: string;
}
export interface ProcedureReceipt {
  schema: typeof PROCEDURE_RECEIPT_SCHEMA;
  executionId: string;
  root: ProcedureReference;
  adapter: string;
  mode: 'validation' | 'execution';
  status: 'validated' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  endedAt: string;
  invocations: ProcedureInvocation[];
  /** Adapter-defined observed calls and results, not a goal-success judgment. */
  trace: unknown[];
  result?: unknown;
  error?: string;
}

export function procedureHash(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => [key, canonical(child)])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function procedureId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) throw new Error('id must be 1–64 lowercase letters, digits or hyphens, starting with a letter');
  return value;
}
export function procedureRevision(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('revision must be a SHA256 hash');
  return value;
}
export function procedureReference(value: unknown): ProcedureReference {
  const v = value as ProcedureReference;
  if (!v || typeof v !== 'object' || typeof v.handle !== 'string' || v.handle.length > 512
    || !/^(mem|log):[^\s]+$/.test(v.handle)) throw new Error('procedure handle must be an explicit mem: or log: reference');
  return { handle: v.handle, revision: procedureRevision(v.revision) };
}

export function parseProcedure(value: unknown): ProcedureVersion {
  const v = value as ProcedureVersion;
  if (!v || typeof v !== 'object' || ![PROCEDURE_SCHEMA,LEGACY_PROCEDURE_SCHEMA].includes(v.schema)) throw new Error('unsupported procedure schema');
  if (JSON.stringify(v).length > PROCEDURE_LIMITS.artifactChars) throw new Error('procedure artifact is too large');
  procedureId(v.id);
  if (typeof v.adapter !== 'string' || !/^[a-z][a-z0-9-]*\/v[1-9][0-9]*$/.test(v.adapter) || v.adapter.length > 80) throw new Error('adapter must be a versioned capability name');
  if (typeof v.description !== 'string' || !v.description.trim() || v.description.length > 800) throw new Error('description must state the purpose and result contract in at most 800 characters');
  if (!Array.isArray(v.conditions) || v.conditions.length > 8 || v.conditions.some(c => typeof c !== 'string' || !c.trim() || c.length > 400)) throw new Error('conditions must contain at most eight short applicability/failure boundaries');
  if (typeof v.code !== 'string' || !v.code.trim() || v.code.length > PROCEDURE_LIMITS.sourceChars) throw new Error('invalid procedure source length');
  if (!v.dependencies || typeof v.dependencies !== 'object' || Array.isArray(v.dependencies)
    || Object.keys(v.dependencies).length > PROCEDURE_LIMITS.versions - 1) throw new Error('invalid dependencies');
  for (const [alias, ref] of Object.entries(v.dependencies)) { procedureId(alias); procedureReference(ref); }
  if (v.parent !== null) procedureRevision(v.parent);
  if (!v.author || !['agent', 'operator'].includes(v.author.kind) || typeof v.author.role !== 'string'
    || v.author.role.length > 80 || (v.author.callId !== undefined && (typeof v.author.callId !== 'string' || v.author.callId.length > 200))) throw new Error('invalid author provenance');
  if (typeof v.createdAt !== 'string' || !Number.isFinite(Date.parse(v.createdAt))) throw new Error('invalid creation time');
  if (v.sourceHash !== createHash('sha256').update(v.code).digest('hex')) throw new Error('procedure source hash mismatch');
  const { revision, ...body } = v;
  if (procedureRevision(revision) !== procedureHash(body)) throw new Error('procedure revision hash mismatch');
  return structuredClone(v);
}

/** Fetches only the selected dependency graph; never lists or executes a Memory library. */
export function resolveProcedure(root: ProcedureReference, adapter: string,
  blob: (handle: string) => { bytes: Uint8Array; mime: string } | null): ProcedureGraph {
  const versions: Record<string, ProcedureVersion> = {};
  let sourceChars = 0;
  const visit = (raw: ProcedureReference, path: string[]) => {
    const ref = procedureReference(raw);
    if (path.includes(ref.revision)) throw new Error('cyclic procedure dependency');
    if (path.length >= PROCEDURE_LIMITS.depth) throw new Error('procedure dependency depth exceeded');
    if (versions[ref.revision]) {
      for (const dep of Object.values(versions[ref.revision].dependencies)) visit(dep, [...path, ref.revision]);
      return;
    }
    if (Object.keys(versions).length >= PROCEDURE_LIMITS.versions) throw new Error('procedure dependency count exceeded');
    const got = blob(ref.handle);
    if (!got) throw new Error(`procedure blob unavailable: ${ref.handle}`);
    if (got.bytes.byteLength > PROCEDURE_LIMITS.artifactChars * 4) throw new Error('procedure blob is too large');
    const v = parseProcedure(JSON.parse(new TextDecoder().decode(got.bytes)));
    if (v.revision !== ref.revision) throw new Error('dependency reference hash mismatch');
    if (v.adapter !== adapter) throw new Error(`procedure adapter mismatch: ${v.adapter}; expected ${adapter}`);
    sourceChars += v.code.length;
    if (sourceChars > PROCEDURE_LIMITS.graphSourceChars) throw new Error('combined procedure source budget exceeded');
    versions[v.revision] = v;
    for (const dep of Object.values(v.dependencies)) visit(dep, [...path, ref.revision]);
  };
  visit(root, []);
  return { root: root.revision, versions };
}
