import { createHash } from 'node:crypto';
import type { EntityRef, MemoryScope, WorldRef } from './types.ts';

/** Stable opaque partition key. Also valid as a Graphiti `group_id` (alnum + `_`). */
export function scopeKey(scope: MemoryScope): string {
  for (const [k, v] of Object.entries(scope)) {
    if (typeof v !== 'string' || !v.trim() || v.length > 512) throw new Error(`Invalid memory scope field: ${k}`);
  }
  const digest = createHash('sha256').update(JSON.stringify(['agent-mc-memory/scope/v1', scope.realm, scope.account, scope.agent])).digest('hex');
  return `mc_${digest.slice(0, 32)}`;
}

/**
 * World namespace for coordinates. Follows agent-mc-world `worldScopedRealm`: an unknown native world never
 * shares a persistent key, so coordinates seen before identity arrives cannot leak into another world.
 */
export function worldNamespace(world: WorldRef | null | undefined): string {
  if (world?.key) return world.key;
  return `unknown-world:${world?.connection ?? 'unobserved'}:${world?.revision ?? 0}`;
}

export interface BlockPos { x: number; y: number; z: number }
export function formatPos(pos: BlockPos): string {
  return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
}

/** A named place inside one world, e.g. `minecraft:overworld|home:base`. */
export function locationRef(world: WorldRef | null | undefined, label: string): EntityRef {
  return { type: 'Location', name: `${worldNamespace(world)}|${label}` };
}

export function normalizeName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function entityId(ref: EntityRef): string {
  return `${ref.type}:${normalizeName(ref.name)}`;
}

/** Accept `Player:Steve`, `Steve`. */
export function parseEntitySelector(selector: string): { type: string | null; name: string } {
  const m = /^(Agent|Player|Location|Building|Skill|Item|Task|Topic|World):(.+)$/.exec(selector.trim());
  return m ? { type: m[1]!, name: normalizeName(m[2]!) } : { type: null, name: normalizeName(selector) };
}
