import { createHash } from 'node:crypto';

import type { FactValue, FactValues, FactUpdate, FactUpdateState } from '../contracts/fact-updates.ts';
export { FACT_UPDATE_GUIDANCE, type FactValue, type FactValues, type FactUpdate, type FactUpdateState } from '../contracts/fact-updates.ts';

/** JSON only, stable key order, exact array order, explicit nulls. Never coerce
 * unknown values into zero, stringify non-JSON objects, or mutate the caller. */
function canonical(value: unknown): FactValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  throw new Error('Facts updates require finite JSON data');
}
const digest = (values: FactValues) => createHash('sha256').update(JSON.stringify(values)).digest('hex');

/** Apply with an exact baseline check. Missing keys in patches mean unchanged;
 * removed keys mean absent; a present null means explicitly unknown. */
export function applyFactUpdate(previous: FactUpdateState | null, update: FactUpdate): FactUpdateState {
  if (update.schema !== 'agent-mc/fact-update/v1' || !['snapshot', 'patch'].includes(update.kind)) throw new Error('Unknown fact-update contract');
  if (update.kind === 'patch' && (!previous || update.baseRevision !== previous.revision)) throw new Error('Fact-update baseline mismatch');
  if (update.kind === 'snapshot' && (update.baseRevision !== null || update.removed.length)) throw new Error('Invalid fact snapshot');
  if (update.removed.some(key => key === 'at' || Object.hasOwn(update.values, key))) throw new Error('Invalid fact removals');
  const values = Object.fromEntries(Object.entries(update.kind === 'snapshot' ? {} : previous!.values));
  for (const key of update.removed) delete values[key];
  for (const [key, value] of Object.entries(update.values)) Object.defineProperty(values, key, { value, enumerable: true, configurable: true, writable: true });
  const normalized = canonical(values) as FactValues;
  if (digest(normalized) !== update.revision) throw new Error('Fact-update revision mismatch');
  if (update.kind === 'patch' && JSON.stringify(normalized.run ?? null) !== JSON.stringify(previous!.values.run ?? null)) throw new Error('A new run requires a fact snapshot');
  if (update.kind === 'patch' && JSON.stringify(normalized.dimension ?? null) !== JSON.stringify(previous!.values.dimension ?? null)) throw new Error('A new dimension requires a fact snapshot');
  return { revision: update.revision, observedAt: update.observedAt, values: normalized };
}

/** Two-phase presentation: preparing a prompt must not advance the baseline.
 * Commit only the frame admitted to durable host history. Reset after history
 * compaction/reconnect; this class has no body, model, memory or file access. */
export class FactUpdateStream {
  private state: FactUpdateState | null = null;
  private admitted = 0;
  readonly snapshotEvery: number;
  constructor(options: { snapshotEvery?: number } = {}) {
    this.snapshotEvery = options.snapshotEvery ?? 32;
    if (!Number.isSafeInteger(this.snapshotEvery) || this.snapshotEvery < 1) throw new Error('Invalid fact snapshot interval');
  }
  reset(): void { this.state = null; this.admitted = 0; }
  preview(facts: Record<string, unknown>): FactUpdate {
    const normalized = canonical(facts) as FactValues;
    const observedAt = typeof normalized.at === 'string' ? normalized.at : null;
    delete normalized.at;
    const revision = digest(normalized);
    const snapshot = !this.state || this.admitted >= this.snapshotEvery
      || JSON.stringify(normalized.run ?? null) !== JSON.stringify(this.state.values.run ?? null)
      || JSON.stringify(normalized.dimension ?? null) !== JSON.stringify(this.state.values.dimension ?? null);
    const values = snapshot ? normalized : Object.fromEntries(Object.entries(normalized).filter(([key, value]) =>
      !Object.hasOwn(this.state!.values, key) || JSON.stringify(value) !== JSON.stringify(this.state!.values[key])));
    const removed = snapshot ? [] : Object.keys(this.state!.values).filter(key => !Object.hasOwn(normalized, key));
    return { schema: 'agent-mc/fact-update/v1', kind: snapshot ? 'snapshot' : 'patch', revision,
      baseRevision: snapshot ? null : this.state!.revision, observedAt, values, removed };
  }
  commit(update: FactUpdate): void {
    this.state = applyFactUpdate(this.state, update);
    this.admitted = update.kind === 'snapshot' ? 1 : this.admitted + 1;
  }
}

