import type { WorldRequestFacts } from '../contracts/host.ts';

/** A recheck authorizes no action. Hosts retain the same lease and classify fresh facts. */
export interface ObservationStability {
  verdict: 'stable' | 'recheck' | 'unsafe';
  tolerated: string[]; changed: string[]; unsafe: string[];
}
export type DecisionObservation = Pick<WorldRequestFacts, 'parts' | 'decisionStability' | 'experience'> & { run?: string };
const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const keys = ['identity', 'deathLifecycle', 'bodyRestriction', 'body', 'place', 'clock', 'queue',
  'foodReserve', 'equip', 'gear', 'inventory', 'menu', 'vehicle', 'flight', 'structure', 'terrain', 'lastTask'];
const hard = new Set(['identity', 'deathLifecycle', 'bodyRestriction', 'queue', 'menu']);

/** Compare full source facts, never truncated prompt text. Unknown changed body facts fail closed.
 * Small pose changes, one ordinary health/food tick and daylight clock ticks are bounded;
 * a host must still validate connection, intent, events and the executable target at admission.
 */
export function assessObservationStability(before: DecisionObservation | null, after: DecisionObservation | null,
  options: { now?: number; maxAgeMs?: number } = {}): ObservationStability {
  const result: ObservationStability = { verdict: 'stable', tolerated: [], changed: [], unsafe: [] };
  if (!before || !after) return { ...result, verdict: 'unsafe', unsafe: ['observation-unavailable'] };
  if (before.run !== after.run) result.unsafe.push('world-run');
  const a = before.decisionStability, b = after.decisionStability;
  if (!!a !== !!b) result.unsafe.push('observation-unavailable');
  if (canonical(before.experience?.scope) !== canonical(after.experience?.scope)) result.unsafe.push('identity');
  if (a && b) {
    const now = options.now ?? Date.now(), age = options.maxAgeMs ?? 5000;
    for (const sample of [a, b]) if (!Number.isFinite(sample.sampledAtMs)
      || now - sample.sampledAtMs > age || sample.sampledAtMs - now > 1000) result.unsafe.push('observation-age');
    if (canonical(a.identity) !== canonical(b.identity)) result.unsafe.push('identity');
    if (a.dimension !== b.dimension) result.unsafe.push('dimension');
    for (const key of ['body', 'place', 'clock']) {
      if (Object.hasOwn(a.guards, key) && Object.hasOwn(b.guards, key)
        && canonical(a.guards[key]) !== canonical(b.guards[key]))
        (key === 'body' ? result.unsafe : result.changed).push(`facts:${key}`);
    }
    if (a.health !== b.health) {
      if (a.health === null || b.health === null || b.health <= 6 || a.health - b.health > 1) result.unsafe.push('health');
      else result.tolerated.push('health-tick');
    }
    if (a.food !== b.food) {
      if (a.food === null || b.food === null || b.food <= 6 || Math.abs(a.food - b.food) > 1) result.changed.push('food');
      else result.tolerated.push('food-tick');
    }
    if (canonical(a.position) !== canonical(b.position)) {
      if (!a.position || !b.position) result.unsafe.push('position-unknown');
      else if (Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]) <= 1.5
        && Math.abs(a.position[1] - b.position[1]) <= 1.25) result.tolerated.push('pose');
      else result.changed.push('position');
    }
  }
  const parts = (facts: DecisionObservation, key: string) => facts.parts?.filter(p => p.key === key).map(p => p.text) ?? [];
  for (const key of keys) {
    if (canonical(parts(before, key)) === canonical(parts(after, key))) continue;
    // A producer explicitly supplies all non-tolerated fields for these rendered segments.
    if (a && b && ['body', 'place', 'clock'].includes(key)
      && Object.hasOwn(a.guards, key) && Object.hasOwn(b.guards, key)
      && canonical(a.guards[key]) === canonical(b.guards[key])) { result.tolerated.push(key); continue; }
    if (hard.has(key) || key === 'body') result.unsafe.push(`facts:${key}`);
    else result.changed.push(`facts:${key}`);
  }
  for (const list of [result.tolerated, result.changed, result.unsafe]) list.splice(0, list.length, ...new Set(list));
  result.verdict = result.unsafe.length ? 'unsafe' : result.changed.length ? 'recheck' : 'stable';
  return result;
}
