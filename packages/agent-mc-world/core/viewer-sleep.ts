import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

/** Read-only, server-confirmed own sleep state; a nearby bed is not evidence. */
export function viewerSleepState(bot: Bot) {
  const keys = bot.registry?.entitiesByName?.player?.metadataKeys ?? [];
  const metadata = bot.entity.metadata as unknown as Record<number, unknown>;
  const rawPose = metadata?.[keys.indexOf('pose')];
  // Mineflayer clears isSleeping on entityWake, sometimes before pose metadata.
  const sleeping = typeof bot.isSleeping === 'boolean' ? bot.isSleeping : rawPose === 2;
  const result: { sleeping: boolean; bedPosition: { x: number; y: number; z: number } | null;
    bedFacing: 'north' | 'south' | 'east' | 'west' | null } = { sleeping, bedPosition: null, bedFacing: null };
  if (!sleeping) return result;
  const pos = metadata?.[keys.indexOf('sleeping_pos')] as { x?: number; y?: number; z?: number } | null;
  if (!pos || ![pos.x, pos.y, pos.z].every(Number.isInteger)) return result;
  result.bedPosition = { x: pos.x!, y: pos.y!, z: pos.z! };
  const block = bot.blockAt(new Vec3(pos.x!, pos.y!, pos.z!));
  if (!block || !/^(?:[a-z_]+_)?bed$/.test(block.name)) return result;
  const facing = block.getProperties().facing;
  if (facing === 'north' || facing === 'south' || facing === 'east' || facing === 'west') result.bedFacing = facing;
  return result;
}
