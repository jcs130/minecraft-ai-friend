/** Conservative native threat hints. A name alone never makes a mob safe. */
import { readWorldIdentity } from './world-scope.ts';
import type { Bot } from 'mineflayer';
import { entityCustomName, metaOf, type FactBot, type FactEntity } from './animal-state.ts';

/** Explicit operator exception, never inferred from a mob's name or stillness. */
export interface NpcThreatAnchor {
  server: string; world: string; uuid: string; type: string;
  position: { x: number; y: number; z: number }; radius: number;
}
const npcPolicies = new WeakMap<object, { server: string; read: () => readonly NpcThreatAnchor[] | undefined }>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A narrow host-configured exception: max 16 identities, each within at most one block. */
export function npcThreatAnchorsError(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length > 16) return 'npcThreatAnchors must be an array of at most 16 exact anchors';
  for (const a of value) {
    if (!a || typeof a !== 'object' || typeof a.server !== 'string' || !/^[a-z0-9.-]+:[0-9]{1,5}$/i.test(a.server)
      || Number(a.server.split(':').at(-1)) < 1 || Number(a.server.split(':').at(-1)) > 65535
      || typeof a.world !== 'string' || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(a.world) || a.world.length > 160
      || typeof a.uuid !== 'string' || !UUID.test(a.uuid)
      || typeof a.type !== 'string' || !/^(?:minecraft:)?[a-z0-9_]+$/.test(a.type)
      || !a.position || !['x','y','z'].every(k => typeof a.position[k] === 'number' && Number.isFinite(a.position[k]))
      || Math.abs(a.position.x) > 30_000_000 || Math.abs(a.position.z) > 30_000_000 || Math.abs(a.position.y) > 2048
      || typeof a.radius !== 'number' || !Number.isFinite(a.radius) || a.radius <= 0 || a.radius > 1) {
      return 'npcThreatAnchors require exact server:port, native world key, UUID, species, finite position and radius in (0,1]';
    }
  }
  return null;
}
/** Host-only configuration; no game tool can add or infer these exceptions. */
export function configureNpcThreatPolicy(bot: object, server: string, read: () => readonly NpcThreatAnchor[] | undefined): void {
  npcPolicies.set(bot, { server: server.toLowerCase(), read });
}
function anchoredNpc(bot: FactBot, entity: FactEntity): boolean {
  const policy = npcPolicies.get(bot), p = (entity as FactEntity & { position?: NpcThreatAnchor['position'] }).position;
  if (!policy || !p || !entity.uuid || !['x','y','z'].every(k => Number.isFinite(p[k as keyof typeof p]))) return false;
  const anchors = policy.read();
  if (!anchors?.length || npcThreatAnchorsError(anchors)) return false;
  const world = readWorldIdentity(bot as Bot).key;
  // Dimension type alone is not an identity for same-dimension multiworld servers.
  if (!world) return false;
  return anchors.some(a => a.server.toLowerCase() === policy.server && a.world === world
    && a.uuid.toLowerCase() === entity.uuid!.toLowerCase() && a.type.replace(/^minecraft:/,'') === entity.name
    && Math.hypot(a.position.x-p.x, a.position.y-p.y, a.position.z-p.z) <= a.radius);
}

const aggressors = new WeakMap<object, WeakMap<object, number>>();
/** Damage evidence is tied to the entity object, not a reusable numeric ID. */
export function noteNativeAggressor(bot: object, entity: object): void {
  let seen = aggressors.get(bot);
  if (!seen) { seen = new WeakMap(); aggressors.set(bot, seen); }
  seen.set(entity, Date.now());
}

/** Only suppress automatic species-based admission, never explicit damage/server hostility. */
export function suppressSpeciesThreat(bot: FactBot, entity: FactEntity, provoked = false): boolean {
  const hit = aggressors.get(bot)?.get(entity);
  if (provoked || (hit !== undefined && Date.now() - hit < 30_000)) return false;
  const flags = metaOf(bot, entity, 'mob_flags');
  const active = (typeof flags === 'number' && (flags & 4) !== 0) || metaOf(bot, entity, 'creepy') === true;
  const swelling = metaOf(bot, entity, 'swell_dir');
  // Danger overrides BOTH native display hints and operator-configured anchors.
  if (active || metaOf(bot, entity, 'is_ignited') === true || (typeof swelling === 'number' && swelling > 0)) return false;
  if (typeof flags === 'number' && (flags & 1) !== 0 && entityCustomName(bot, entity)) return true;
  if (anchoredNpc(bot, entity)) return true;
  // Endermen are neutral until provoked; do not stare at one merely for its species.
  return entity.name === 'enderman';
}

/**
 * Native fuse / ignition evidence only. Species alone is not a lit fuse.
 * Used by combat to hard-separate and stop swinging before blast radius.
 */
export function creeperFuseActive(bot: FactBot, entity: FactEntity): boolean {
  if (entity.name !== 'creeper') return false;
  const flags = metaOf(bot, entity, 'mob_flags');
  const swell = metaOf(bot, entity, 'swell_dir');
  return (typeof flags === 'number' && (flags & 4) !== 0)
    || metaOf(bot, entity, 'is_ignited') === true
    || (typeof swell === 'number' && swell > 0);
}

/** Potential is not NPC recognition. A distant, non-approaching Creeper is watched,
 * not grounds for autonomous attack/retreat merely because its species is hostile.
 * 6/12 block vanilla blast reach plus 2 blocks reaction margin; closing velocity
 * extends that margin. Explicit danger and actual provocation always win. */
export function potentialCreeperOnly(bot: FactBot, entity: FactEntity, provoked=false): boolean {
  if(entity.name!=='creeper'||provoked)return false;
  const hit=aggressors.get(bot)?.get(entity);if(hit!==undefined&&Date.now()-hit<30_000)return false;
  if(creeperFuseActive(bot,entity))return false;
  type P={x:number;y:number;z:number};
  const p=(bot.entity as unknown as {position?:P})?.position,e=entity as FactEntity&{position?:P;velocity?:P};
  if(!p||!e.position)return false;
  const dx=p.x-e.position.x,dz=p.z-e.position.z,d=Math.hypot(dx,dz);if(!Number.isFinite(d)||d===0)return false;
  if(!e.velocity)return false;
  const vx=e.velocity.x,vz=e.velocity.z;
  if(!Number.isFinite(vx)||!Number.isFinite(vz))return false;
  const closing=Math.max(0,(dx*vx+dz*vz)/d)*20; // native velocities are blocks/tick
  const radius=(metaOf(bot,entity,'is_powered')===true?14:8)+Math.min(6,closing*.75);
  return d>radius;
}
