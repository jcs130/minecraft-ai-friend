/** Portable evidence for retiring a host intention; never mutates host plans. */
export interface WorkReference {
  scope: { realm: string; account: string; agent: string };
  subject: string;
  /** Exact occurrence, for example the accepted-at identity; not a reusable quest name. */
  instance: string;
  revision: number;
}
export interface WorkState extends WorkReference {
  status: 'active' | 'completed' | 'cancelled';
  observedAt: string;
  evidence: { source: 'server'; reference: string; text: string };
}
export interface WorkResolution {
  reference: WorkReference;
  state: WorkState | null;
  disposition: 'active' | 'retire' | 'unknown' | 'conflict';
}
function valid(value: WorkReference): boolean {
  return !!value && !!value.scope && [value.scope.realm, value.scope.account, value.scope.agent,
    value.subject, value.instance].every(s => typeof s === 'string' && s.trim().length > 0)
    && Number.isSafeInteger(value.revision) && value.revision >= 0;
}
function key(value: WorkReference): string {
  return JSON.stringify([value.scope.realm, value.scope.account, value.scope.agent, value.subject, value.instance]);
}
/**
 * Compare typed references, never keywords, nearby actors, tool acceptance or time elapsed.
 * Conflicting equal revisions remain unknown. Hosts decide whether to adopt each retirement
 * and must retain its evidence/history. A later occurrence never retires an earlier one.
 */
export function resolveWorkReferences(references: readonly WorkReference[], observations: readonly WorkState[]): WorkResolution[] {
  const latest = new Map<string, WorkState>();
  const conflicts = new Set<string>();
  for (const state of observations) {
    if (!valid(state) || !['active', 'completed', 'cancelled'].includes(state.status)
      || typeof state.observedAt !== 'string' || !Number.isFinite(Date.parse(state.observedAt)) || state.evidence?.source !== 'server'
      || typeof state.evidence.reference !== 'string' || !state.evidence.reference.trim()
      || typeof state.evidence.text !== 'string' || !state.evidence.text.trim()) continue;
    const id = key(state), previous = latest.get(id);
    if (!previous || state.revision > previous.revision) { latest.set(id, state); conflicts.delete(id); }
    else if (state.revision === previous.revision && state.status !== previous.status) conflicts.add(id);
  }
  return references.map(reference => {
    const state = valid(reference) ? latest.get(key(reference)) : undefined;
    if (!state || state.revision < reference.revision) return { reference, state: null, disposition: 'unknown' };
    if (conflicts.has(key(reference))) return { reference, state: null, disposition: 'conflict' };
    return { reference, state, disposition: state.status === 'active' ? 'active' : 'retire' };
  });
}
