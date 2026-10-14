import type { Bot } from 'mineflayer';
import { invSnapshot } from './inventory.ts';
import { droppedStackOf } from './terrain.ts';

export const FISH_LOOT_WAIT_MS = 6_000;
export interface FishingDrop {
  entity: Bot['entity'];
  name: string;
  count: number;
  collectedBy: number | null;
}
export interface FishingReel {
  at: number;
  hook: { id: number; x: number; y: number; z: number };
  before: Map<string, number>;
  drops: Map<number, FishingDrop>;
}

interface FishingTask {
  bobberId: number | null;
  resolve: () => void;
  reject: (error: Error) => void;
}

interface FishingState { task: FishingTask | null; reel: FishingReel | null; }
const connections = new WeakMap<Bot, FishingState>();

/** Only a spawn packet naming this player can establish ownership of a fishing hook. */
export function ownedFishingBobber(bot: Bot): Bot['entity'] | null {
  const id = connections.get(bot)?.task?.bobberId;
  return id == null ? null : bot.entities[id] ?? null;
}

/** Snapshot taken before the automatic reel, never at the start of a long cast. */
export function lastFishingReel(bot: Bot): FishingReel | null {
  return connections.get(bot)?.reel ?? null;
}

/** Settle the local promise when the server never acknowledges cancellation. No extra use-item packet. */
export function cancelOwnedFishing(bot: Bot, message: string): void {
  const state = connections.get(bot);
  if (!state) return;
  const task = state.task; state.task = null;
  task?.reject(new Error(message));
}

/** Replaces Mineflayer's first-spawn association with the server's hook owner field. */
export function installOwnedFishing(bot: Bot): void {
  if (connections.has(bot)) return;
  const state: FishingState = { task: null, reel: null };
  connections.set(bot, state);
  const client = bot._client;
  const cancel = (message: string): void => {
    cancelOwnedFishing(bot, message);
  };
  const spawn = (packet: { entityId: number; type: number; objectData: number }): void => {
    const task = state.task;
    if (!task) return;
    const definition = bot.registry.entitiesByName.fishing_bobber;
    const type = definition?.internalId ?? definition?.id ?? 90;
    if (packet.type === type && packet.objectData === bot.entity.id) task.bobberId = packet.entityId;
  };
  const particle = (packet: { particle?: { type?: string }; particleId?: number;
    amount?: number; particles?: number; x: number; y: number; z: number }): void => {
    const task = state.task;
    const hook = ownedFishingBobber(bot);
    if (!task || !hook) return;
    const ids = bot.registry.particlesByName;
    const bite = ['fishing', 'bubble'].includes(packet.particle?.type ?? '')
      || (packet.particleId !== undefined && [ids.fishing?.id, ids.bubble?.id].includes(packet.particleId));
    if (!bite || (packet.amount ?? packet.particles) !== 6
      || Math.hypot(packet.x - hook.position.x, packet.z - hook.position.z) > 1.23
      || Math.abs(packet.y - hook.position.y) > 2) return;
    if (bot.heldItem?.name !== 'fishing_rod') { cancel('Fishing cancelled: hand changed before reel'); return; }
    state.reel = { at: Date.now(), hook: { id: hook.id, x: hook.position.x, y: hook.position.y, z: hook.position.z },
      before: invSnapshot(bot), drops: new Map() };
    state.task = null;
    try { bot.activateItem(); task.resolve(); } catch (error) { task.reject(error instanceof Error ? error : new Error('Fishing reel failed')); }
  };
  // A nearby drop has no owner field. Keep correlation evidence and the actual collector separately.
  const freshDrop = (entity: Bot['entity']): void => {
    const reel = state.reel;
    if (!reel || Date.now() - reel.at > FISH_LOOT_WAIT_MS) return;
    const stack = droppedStackOf(entity, bot.registry.items);
    if (!stack || Math.hypot(entity.position.x - reel.hook.x, entity.position.y - reel.hook.y,
      entity.position.z - reel.hook.z) > 2.5) return;
    reel.drops.set(entity.id, { entity, name: stack.name, count: stack.count, collectedBy: null });
  };
  const updateDrop = (entity: Bot['entity']): void => {
    const drop = state.reel?.drops.get(entity.id);
    if (!drop || drop.entity !== entity) return;
    const stack = droppedStackOf(entity, bot.registry.items);
    if (stack) { drop.name = stack.name; drop.count = stack.count; }
  };
  const collected = (collector: Bot['entity'], entity: Bot['entity']): void => {
    updateDrop(entity);
    const drop = state.reel?.drops.get(entity.id);
    if (drop?.entity === entity) drop.collectedBy = collector.id;
  };
  const destroy = (packet: { entityIds: number[] }): void => {
    const id = state.task?.bobberId;
    if (id != null && packet.entityIds.includes(id)) cancel('Fishing cancelled');
  };
  const end = (): void => {
    cancel('Fishing cancelled: connection ended');
    client.removeListener('spawn_entity', spawn);
    client.removeListener('world_particles', particle);
    client.removeListener('entity_destroy', destroy);
    bot.removeListener('end', end);
    bot.removeListener('entitySpawn', freshDrop);
    bot.removeListener('entityUpdate', updateDrop);
    bot.removeListener('playerCollect', collected);
    state.reel = null;
  };
  client.on('spawn_entity', spawn);
  client.on('world_particles', particle);
  client.on('entity_destroy', destroy);
  bot.on('entitySpawn', freshDrop);
  bot.on('entityUpdate', updateDrop);
  bot.on('playerCollect', collected);
  bot.once('end', end);
  bot.fish = () => {
    cancel('Fishing cancelled due to calling bot.fish() again');
    state.reel = null;
    return new Promise<void>((resolve, reject) => {
      state.task = { bobberId: null, resolve, reject };
      try { bot.activateItem(); } catch (error) { cancel(error instanceof Error ? error.message : 'Fishing cast failed'); }
    });
  };
}
