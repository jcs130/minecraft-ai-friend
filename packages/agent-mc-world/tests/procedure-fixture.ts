import { createHash } from 'node:crypto';
import { PROCEDURE_SCHEMA, procedureHash, type ProcedureVersion } from '../core/support/procedure.ts';

export function procedureFixture(id: string, code: string, overrides: Partial<ProcedureVersion> = {}): ProcedureVersion {
  const {revision: _revision, ...body} = {schema: PROCEDURE_SCHEMA, id, code, adapter: 'minecraft-method/v1',
    description: 'Fixture operation returning observed results', conditions: ['Offline fixture; inspect actual result'],
    dependencies: {}, parent: null, author: {kind: 'agent' as const, role: 'main', callId: 'fixture-call'},
    createdAt: '2026-01-01T00:00:00Z', sourceHash: createHash('sha256').update(code).digest('hex'), ...overrides};
  return {...body, revision: procedureHash(body)};
}
export const procedureRef = (v: ProcedureVersion) => ({handle: `mem:${v.id}-${v.revision}.json`, revision: v.revision});
export function fixtureBlobs(versions: ProcedureVersion[]) {
  const blobs = new Map(versions.map(v => [procedureRef(v).handle, {bytes: Buffer.from(JSON.stringify(v)), mime: 'application/json'}]));
  return (handle: string) => blobs.get(handle) ?? null;
}
