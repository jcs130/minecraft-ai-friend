import { createHash } from 'node:crypto';
import type { FactPart } from '../src/contracts/protocol.ts';

export type FactState = null | boolean | number | string | readonly FactState[] | { readonly [key: string]: FactState };

function canonical(value: FactState, parents = new Set<object>()): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object' || !value || parents.has(value)
    || !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw new TypeError('Fact state must be finite, acyclic JSON values');
  parents.add(value);
  try {
    if (Array.isArray(value)) return '[' + Array.from(value, item => canonical(item, parents)).join(',') + ']';
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':'
      + canonical((value as { readonly [key: string]: FactState })[key], parents)).join(',') + '}';
  } finally { parents.delete(value); }
}

/** The producer explicitly selects semantic state; no field names or timestamps
 * are removed automatically. This does not replace raw content or archive hashes. */
export function withFactState<T extends FactPart>(part: T, state: FactState): T & { stateRevision: string } {
  return { ...part, stateRevision: 'sha256:' + createHash('sha256').update(canonical(state)).digest('hex') };
}
