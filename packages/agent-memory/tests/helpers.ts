import { AgentMemory } from '../src/index.ts';

/** Deterministic system clock: each call advances 1s from a base. */
export function clock(base = '2026-11-16T12:00:00.000Z') {
  let t = Date.parse(base);
  return { now: () => new Date(t), advance: (ms: number) => { t += ms; } };
}
export const SCOPE = { realm: 'weak:micro.kangqiang.site:25702|', account: 'offline:Komi', agent: 'komi' };
export const OVERWORLD = { key: 'minecraft:overworld', dimensionType: 'minecraft:overworld', revision: 1 };
export function memory(now?: () => Date) { return new AgentMemory({ dataDir: ':memory:', ...(now ? { now } : {}) }); }
