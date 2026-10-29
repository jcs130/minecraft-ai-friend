/** Thin PowerContext 1.3 Atomic Replace/forgotten adapter. History, Source capture and lifecycle stay server-owned.
 * Contract: oceanbase/powercontext@95bfbc9/docs/en/docs/workflows/atomic-memory.md.
 */
import { memoryRequest } from './game-memory-http.ts';
import { artifactRef, type ArtifactRef } from './game-memory-learning-contract.ts';
import type { GameMemoryConfig } from './game-memory-service.ts';

type Data = Record<string, any>;
export interface PowerNotebookVersion { revision: number; hash: string; text: string }
export async function revisePowerNotebook(request: typeof fetch, cfg: GameMemoryConfig, scope: string,
  id: string, versions: readonly PowerNotebookVersion[], signal?: AbortSignal, known?: readonly ArtifactRef[], allowInitial = false) {
  signal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(cfg.timeoutMs)]);
  const latest = versions.at(-1)!, kind = `agent-mc:${scope}`, rows: Data[] = [];
  const root = `/v1/scopes/${encodeURIComponent(cfg.scopeId)}/artifacts/atomic-memory/`;
  const call = (path: string, body?: unknown, method: 'GET' | 'POST' | 'PUT' = 'POST', etag?: string) =>
    memoryRequest(request, cfg, path, body, signal, method, {}, etag);
  const exact = (text: string) => versions.find(v => v.text === text);
  if (known?.length) {
    if (known.length > 32 || known.some(ref => ref.family !== 'atomic-memory' || !artifactRef.safeParse(ref).success))
      throw new Error('Invalid notebook ArtifactRefs');
    rows.push(...known.map(artifact => ({ artifact })));
  } else {
    // Bootstrap only this configured game kind. Search cannot establish the absence of an exact note UUID.
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (let page = 0; page < 11; page++) {
      const { data } = await call('/v1/atomic-memory/list', {
        scope_id: cfg.scopeId, kind, states: ['active', 'forgotten', 'merged', 'retired'], limit: 100, ...(cursor ? { cursor } : {}),
      });
      if (!Array.isArray(data.items) || data.items.length > 100 || (data.next_cursor != null && typeof data.next_cursor !== 'string'))
        throw new Error('Invalid notebook replica listing');
      for (const row of data.items) {
        if (row?.kind !== kind || typeof row.text !== 'string') continue;
        let value: Data; try { value = JSON.parse(row.text); } catch { continue; }
        if (value.protocol !== 'agent-mc-memory/v1' || value.mc_scope !== scope || value.mc_id !== id) continue;
        if (!['active', 'forgotten'].includes(row.state)) throw new Error('Notebook memory is merged or retired; no automatic replacement or new identity');
        if (row.artifact?.family !== 'atomic-memory' || !artifactRef.safeParse(row.artifact).success)
          throw new Error('Invalid owned notebook ArtifactRef');
        if (!versions.some(v => v.revision === value.mc_revision && v.hash === value.mc_hash && v.text === row.text))
          throw new Error('Remote notebook content conflicts with local history; preserved for review');
        rows.push(row);
      }
      if (data.next_cursor == null) break;
      if (page === 10 || seen.has(data.next_cursor)) throw new Error('Notebook replica listing incomplete; no mutation dispatched');
      seen.add(data.next_cursor); cursor = data.next_cursor;
    }
  }
  if (!rows.length && allowInitial) {
    // The first replication of a previously local-only revised note is creation, not a failed-replacement retry.
    // The caller has already persisted uncertainty; an unknown dispatch is never allowed into this branch again.
    const { data }: { data: Data } = await call(`/v1/scopes/${encodeURIComponent(cfg.scopeId)}/artifacts`,
      { family: 'atomic-memory', content: { kind, text: latest.text } });
    if (data.scope_id !== cfg.scopeId || data.family !== 'atomic-memory' || data.revision !== 1
      || data.content?.kind !== kind || data.content?.text !== latest.text
      || !artifactRef.safeParse({ family: data.family, artifact_id: data.artifact_id, revision: data.revision }).success)
      throw new Error('Unverified initial notebook replication; inspect current records before retrying');
    rows.push({ artifact: { family: data.family, artifact_id: data.artifact_id, revision: data.revision }, text: latest.text });
  }
  if (!rows.length) throw new Error('No exact predecessor found; no duplicate creation dispatched');
  if (rows.length > 32 || new Set(rows.map(r => r.artifact.artifact_id)).size !== rows.length)
    throw new Error('Invalid notebook replica set; explicit reconciliation required');
  const stateOf = async (ref: ArtifactRef) => {
    const { data }: { data: Data } = await call(root + encodeURIComponent(ref.artifact_id) + '/state', undefined, 'GET');
    if (!['active', 'forgotten'].includes(data.state) || !Number.isInteger(data.state_version) || data.state_version < 0
      || data.artifact?.family !== 'atomic-memory' || data.artifact.artifact_id !== ref.artifact_id || data.artifact.revision !== ref.revision)
      throw new Error('Notebook lifecycle changed; explicit reconciliation required');
    return data;
  };
  // Validate every selected head before the first mutation. Foreign, merged or changed records are preserved.
  const snapshots: Data[] = [];
  for (const row of rows) {
    const head = await call(root + encodeURIComponent(row.artifact.artifact_id), undefined, 'GET'), data: Data = head.data;
    const version = typeof data.content?.text === 'string' ? exact(data.content.text) : null;
    if (!version || data.scope_id !== cfg.scopeId || data.family !== 'atomic-memory' || data.artifact_id !== row.artifact.artifact_id
      || !Number.isInteger(data.revision) || data.revision < row.artifact.revision || data.content.kind !== kind
      || (row.text !== undefined && (row.text !== data.content.text || data.revision !== row.artifact.revision))
      || head.etag !== `"revision:${data.revision}"`)
      throw new Error('Remote notebook head changed; re-read before correction');
    const ref: ArtifactRef = { family: 'atomic-memory', artifact_id: data.artifact_id, revision: data.revision };
    const state = await stateOf(ref);
    snapshots.push({ ref, text: data.content.text, noteRevision: version.revision, etag: head.etag, state: state.state });
  }
  snapshots.sort((a, b) => Number(b.state === 'active') - Number(a.state === 'active') || b.noteRevision - a.noteRevision);
  const primary = snapshots[0];
  if (primary.text !== latest.text) {
    const { data }: { data: Data } = await call(root + encodeURIComponent(primary.ref.artifact_id),
      { content: { kind, text: latest.text } }, 'PUT', primary.etag);
    if (data.scope_id !== cfg.scopeId || data.family !== 'atomic-memory' || data.artifact_id !== primary.ref.artifact_id
      || data.revision !== primary.ref.revision + 1 || data.content?.kind !== kind || data.content?.text !== latest.text)
      throw new Error('Unverified notebook replacement; reconcile its head before retrying');
    primary.ref = { ...primary.ref, revision: data.revision };
  }
  const forget = async (ref: ArtifactRef) => {
    const state = await stateOf(ref);
    if (state.state === 'forgotten') return; // Reconcile a lost reply without another mutation or restoration.
    const { data }: { data: Data } = await call('/v1/atomic-memory/lifecycle', {
      scope_id: cfg.scopeId, target: { artifact: ref, state_version: state.state_version }, state: 'forgotten',
    });
    const record = data.records?.[0];
    if (data.changed !== true || !Array.isArray(data.records) || data.records.length !== 1 || record.state !== 'forgotten'
      || record.state_version !== state.state_version + 1 || record.artifact?.family !== 'atomic-memory'
      || record.artifact.artifact_id !== ref.artifact_id || record.artifact.revision !== ref.revision || record.kind !== kind)
      throw new Error('Unverified notebook forgetting; inspect lifecycle before retrying');
  };
  // Native forgetting preserves obsolete bytes, Sources and history instead of creating identical active copies.
  const forgottenCopies: ArtifactRef[] = [];
  for (const old of snapshots.slice(1)) { if (old.state === 'active') { await forget(old.ref); forgottenCopies.push(old.ref); } }
  const archived = JSON.parse(latest.text).entry.archived === true;
  if (archived) await forget(primary.ref);
  return { artifacts: [primary.ref as ArtifactRef], forgotten: archived, forgottenCopies,
    lifecycle: archived ? 'forgotten' : primary.state };
}
