import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

type Miss = { x: number; y: number; z: number; was: string; at: number };
type CachedBot = Bot & { placeMisses?: Miss[] };
type Cell = { x: number; y: number; z: number };
const MARK = Symbol.for('cortico.minecraft.placementMissState');
const AROUND = [[0, 0, 0], [0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]];

/** A rejection applies to the observed placement scene, not just the empty target cell. */
function scene(bot: Bot, at: Cell): string | null {
  const blocks = AROUND.map(([x, y, z]) => bot.blockAt(new Vec3(at.x + x, at.y + y, at.z + z)));
  if (blocks.some(b => b === null)) return null;
  const feet = bot.entity?.position?.floored();
  return JSON.stringify([bot.game?.dimension, bot.heldItem?.name ?? null, feet?.toArray(),
    blocks.map(b => [b!.name, b!.stateId, b!.shapes])]);
}

export interface PlacementMissState {
  invalidations: Array<{ at: number; cell: Cell; trigger: 'block-update' | 'before-place' }>;
  rollback(): void;
}

/** Keep the existing retry budget, TTL, permission checks and native placeBlock implementation. */
export function installPlacementMissState(bot: Bot): PlacementMissState {
  const marked = bot as CachedBot & { [MARK]?: PlacementMissState };
  if (marked[MARK]) return marked[MARK];
  const original = bot.placeBlock;
  const contexts = new WeakMap<Miss, string>();
  const state: PlacementMissState = { invalidations: [], rollback() {
    if (bot.placeBlock === wrapped) bot.placeBlock = original;
    bot.removeListener('blockUpdate', onBlockUpdate);
    delete marked[MARK];
  } };
  function refresh(at: Cell, trigger: 'block-update' | 'before-place') {
    const current = scene(bot, at);
    if (current === null || !marked.placeMisses?.length) return;
    marked.placeMisses = marked.placeMisses.filter(m => {
      if (m.x !== at.x || m.y !== at.y || m.z !== at.z) return true;
      const previous = contexts.get(m);
      // Legacy misses have no observation signature; leave their existing TTL intact.
      if (previous === undefined || previous === current) return true;
      state.invalidations.push({ at: Date.now(), cell: { x: m.x, y: m.y, z: m.z }, trigger });
      if (state.invalidations.length > 16) state.invalidations.shift();
      return false;
    });
  }
  const wrapped: Bot['placeBlock'] = async function(this: Bot, reference, face) {
    const dest = reference.position.plus(face);
    refresh(dest, 'before-place');
    const existing = new Set(marked.placeMisses ?? []);
    try { return await original.call(this, reference, face); }
    finally {
      const current = scene(bot, dest);
      if (current !== null) for (const miss of marked.placeMisses ?? []) {
        if (!existing.has(miss) && miss.x === dest.x && miss.y === dest.y && miss.z === dest.z) contexts.set(miss, current);
      }
    }
  };
  const onBlockUpdate = (_before: unknown, after: { position: Vec3 } | null) => {
    if (!after) return;
    for (const miss of [...(marked.placeMisses ?? [])]) {
      if (Math.abs(miss.x - after.position.x) + Math.abs(miss.y - after.position.y) + Math.abs(miss.z - after.position.z) <= 1) refresh(miss, 'block-update');
    }
  };
  bot.placeBlock = wrapped;
  bot.on('blockUpdate', onBlockUpdate);
  marked[MARK] = state;
  return state;
}
