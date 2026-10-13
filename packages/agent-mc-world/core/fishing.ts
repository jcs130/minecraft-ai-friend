import type { Bot } from 'mineflayer';

interface FishingTask {
  bobberId: number | null;
  resolve: () => void;
  reject: (error: Error) => void;
}

interface FishingState { task: FishingTask | null; }
const connections = new WeakMap<Bot, FishingState>();

/** Only a spawn packet naming this player can establish ownership of a fishing hook. */
export function ownedFishingBobber(bot: Bot): Bot['entity'] | null {
  const id = connections.get(bot)?.task?.bobberId;
  return id == null ? null : bot.entities[id] ?? null;
}

/** Replaces Mineflayer's first-spawn association with the server's hook owner field. */
export function installOwnedFishing(bot: Bot): void {
  if (connections.has(bot)) return;
  const state: FishingState = { task: null };
  connections.set(bot, state);
  const client = bot._client;
  const cancel = (message: string): void => {
    const task = state.task;
    state.task = null;
    task?.reject(new Error(message));
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
    state.task = null;
    bot.activateItem();
    task.resolve();
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
  };
  client.on('spawn_entity', spawn);
  client.on('world_particles', particle);
  client.on('entity_destroy', destroy);
  bot.once('end', end);
  bot.fish = () => {
    cancel('Fishing cancelled due to calling bot.fish() again');
    return new Promise<void>((resolve, reject) => {
      state.task = { bobberId: null, resolve, reject };
      bot.activateItem();
    });
  };
}
