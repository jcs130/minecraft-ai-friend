/** Catch receipts inferred from an owned hook, reel, loot flight and confirmed pickup. */
import type mineflayer from 'mineflayer';
import type { EventEmitter } from 'node:events';
import type { ViewerItem } from './viewer-state.ts';

type Position = { x: number; y: number; z: number };
type Hook = { id: number; position: Position; biteAt: number; reelAt: number; before: Map<string, number> };
type Loot = { hook: Hook; position: Position; spawnedAt: number; item: ViewerItem | null;
  collectedAt: number; count: number };
type Protocol = Pick<EventEmitter, 'on' | 'off'> & {
  write(name: string, params?: Record<string, unknown>): void;
};
type WriteObserver = (name: string, params?: Record<string, unknown>) => void;
type WriteDispatch = { originalWrite: Protocol['write']; viewerWrite: Protocol['write'];
  observers: Set<WriteObserver> };
const writeDispatchers = new WeakMap<Protocol, WriteDispatch>();

function observeWrite(protocol: Protocol, onWrite: WriteObserver): () => void {
  let dispatch = writeDispatchers.get(protocol);
  if (!dispatch) {
    const originalWrite = protocol.write;
    const observers = new Set<WriteObserver>();
    const viewerWrite: Protocol['write'] = (name, params) => {
      for (const observer of observers) observer(name, params);
      return originalWrite.call(protocol, name, params);
    };
    dispatch = { originalWrite, viewerWrite, observers };
    writeDispatchers.set(protocol, dispatch);
    protocol.write = viewerWrite;
  }
  const shared = dispatch;
  shared.observers.add(onWrite);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    shared.observers.delete(onWrite);
    if (shared.observers.size) return;
    // Later external wrappers keep their delegate, whose observer set is empty.
    if (protocol.write === shared.viewerWrite) protocol.write = shared.originalWrite;
    writeDispatchers.delete(protocol);
  };
}
export interface ViewerFishingCatch {
  seq: number;
  atMs: number;
  item: ViewerItem;
  count: number;
  position: Position;
}
const pos = (value: unknown): Position | null => {
  const p = value as Position | null;
  return p && [p.x, p.y, p.z].every(part => typeof part === 'number' && Number.isFinite(part))
    ? { x: p.x, y: p.y, z: p.z } : null;
};
const distance = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, part]) => [key, canonical(part)]));
  return value;
};
const itemKey = (item: ViewerItem) => JSON.stringify(canonical({ type: item.type, metadata: item.metadata,
  customName: item.customName, components: item.components, nbt: item.nbt }));

export function viewerDroppedItem(entity: unknown, serializeItem: (item: unknown) => ViewerItem | null): ViewerItem | null {
  if (!entity || typeof entity !== 'object') return null;
  const source = entity as { name?: string; getDroppedItem?: () => unknown };
  if (!['item', 'Item', 'item_stack'].includes(source.name ?? '') || !source.getDroppedItem) return null;
  // The spawn packet precedes the item's metadata, so decoding can be unavailable briefly.
  try { return serializeItem(source.getDroppedItem()); } catch { return null; }
}

export function observeViewerFishingCatch(bot: mineflayer.Bot,
  publish: (event: ViewerFishingCatch) => void, serializeItem: (item: unknown) => ViewerItem | null,
  now = Date.now): () => void {
  const protocol = bot._client as unknown as Protocol;
  const hooks = new Map<number, Hook>();
  const loot = new Map<number, Loot>();
  let seq = 0;
  const inventory = () => {
    const result = new Map<string, number>();
    for (const raw of bot.inventory.slots.slice(bot.inventory.inventoryStart ?? 9)) {
      const item = serializeItem(raw);
      if (item) { const key = itemKey(item); result.set(key, (result.get(key) ?? 0) + item.count); }
    }
    return result;
  };
  const trim = () => {
    const at = now();
    for (const [id, entry] of loot) if (at - entry.spawnedAt > 8000) loot.delete(id);
    for (const [id, hook] of hooks) if (hook.reelAt && at - hook.reelAt > 8000) hooks.delete(id);
    while (loot.size > 32) loot.delete(loot.keys().next().value!);
    while (hooks.size > 4) hooks.delete(hooks.keys().next().value!);
  };
  const confirmed = () => {
    trim();
    const counts = inventory();
    for (const [id, entry] of loot) {
      if (!entry.collectedAt || !entry.item) continue;
      const key = itemKey(entry.item);
      const gained = (counts.get(key) ?? 0) - (entry.hook.before.get(key) ?? 0);
      if (gained < entry.count) continue;
      loot.delete(id);
      publish({ seq: ++seq, atMs: now(), item: { ...entry.item, count: entry.count },
        count: entry.count, position: entry.position });
    }
  };
  const onSpawn = (packet: { entityId?: number; type?: number; objectData?: number;
    x?: number; y?: number; z?: number; velocity?: Position }) => {
    trim();
    if (!Number.isSafeInteger(packet.entityId)) return;
    const id = packet.entityId!;
    loot.delete(id);
    hooks.delete(id);
    const entities = bot.registry.entitiesByName;
    const position = pos(packet);
    if (!position) return;
    if (packet.type === entities.fishing_bobber?.internalId && packet.objectData === bot.entity?.id) {
      hooks.set(id, { id, position, biteAt: 0, reelAt: 0, before: new Map() });
      return;
    }
    if (packet.type !== entities.item?.internalId) return;
    const at = now();
    const hook = [...hooks.values()].reverse().find(entry => entry.reelAt && entry.biteAt &&
      at - entry.reelAt <= 1500 && at - entry.reelAt >= 0 && Math.abs(entry.reelAt - entry.biteAt) <= 2000 &&
      distance(position, entry.position) <= 2);
    if (!hook) return;
    const entity = bot.entities[id];
    const caster = pos(bot.entity?.position);
    const rawVelocity = pos(packet.velocity);
    const velocity = rawVelocity ? { x: rawVelocity.x / 8000, y: rawVelocity.y / 8000,
      z: rawVelocity.z / 8000 } : pos(entity?.velocity);
    if (!caster || !velocity) return;
    const dx = caster.x - position.x, dz = caster.z - position.z;
    // Fishing loot is launched toward its owner. Drops falling beside a hook are unrelated.
    if (Math.hypot(dx, dz) > 1 && (velocity.x * dx + velocity.z * dz <= .01 || velocity.y <= .02)) return;
    loot.set(id, { hook, position, spawnedAt: at, item: viewerDroppedItem(entity, serializeItem), collectedAt: 0, count: 0 });
  };
  const onEntity = (entity: mineflayer.Bot['entity']) => {
    const hook = hooks.get(entity.id);
    if (hook) {
      const position = pos(entity.position);
      if (position) hook.position = position;
      const keys = bot.registry.entitiesByName.fishing_bobber?.metadataKeys;
      const biting = keys?.indexOf('biting') ?? -1;
      if (biting >= 0 && (entity.metadata as unknown[])[biting] === true) hook.biteAt = now();
    }
    const entry = loot.get(entity.id);
    if (entry) { entry.item = viewerDroppedItem(entity, serializeItem) ?? entry.item; confirmed(); }
  };
  const onParticle = (packet: { particle?: { type?: string }; particleId?: number; amount?: number;
    particles?: number; x?: number; y?: number; z?: number }) => {
    const particle = packet.particle?.type;
    const ids = bot.registry.particlesByName;
    if ((packet.amount ?? packet.particles) !== 6 ||
      !(['fishing', 'bubble'].includes(particle ?? '') ||
        (Number.isSafeInteger(packet.particleId) &&
          (packet.particleId === ids.fishing?.id || packet.particleId === ids.bubble?.id)))) return;
    const position = pos(packet);
    if (!position) return;
    for (const hook of hooks.values()) if (Math.hypot(position.x - hook.position.x,
      position.z - hook.position.z) <= 1.23 && Math.abs(position.y - hook.position.y) <= 2) hook.biteAt = now();
  };
  const onCollect = (packet: { collectedEntityId?: number; collectorEntityId?: number; pickupItemCount?: number }) => {
    if (packet.collectorEntityId !== bot.entity?.id || !Number.isSafeInteger(packet.collectedEntityId)) return;
    const entry = loot.get(packet.collectedEntityId!);
    if (!entry) return;
    entry.item = viewerDroppedItem(bot.entities[packet.collectedEntityId!], serializeItem) ?? entry.item;
    if (!entry.item) { loot.delete(packet.collectedEntityId!); return; }
    const count = packet.pickupItemCount ?? entry.item.count;
    if (!Number.isSafeInteger(count) || count < 1 || count > entry.item.count) return;
    entry.count = count;
    entry.collectedAt = now();
    confirmed();
  };
  const onDestroy = (packet: { entityIds?: number[] }) => {
    for (const id of packet.entityIds ?? []) {
      const hook = hooks.get(id);
      // A reeled hook is destroyed before its caught item reaches the inventory.
      if (hook && !hook.reelAt) hooks.delete(id);
    }
    trim();
  };
  const reset = () => { hooks.clear(); loot.clear(); };
  const disposeWrite = observeWrite(protocol, (kind, params) => {
    if (kind === 'use_item') {
      const item = params?.hand === 1 ? bot.inventory.slots[45] : bot.heldItem;
      if (item?.name?.replace(/^minecraft:/, '') === 'fishing_rod') {
        trim();
        for (const hook of hooks.values()) if (!hook.reelAt) {
          hook.reelAt = now();
          hook.before = inventory();
        }
      }
    }
  });
  protocol.on('spawn_entity', onSpawn);
  protocol.on('world_particles', onParticle);
  protocol.on('collect', onCollect);
  protocol.on('entity_destroy', onDestroy);
  bot.on('entityUpdate', onEntity);
  bot.on('entityMoved', onEntity);
  bot.on('itemDrop', onEntity);
  bot.inventory.on('updateSlot', confirmed);
  bot.on('respawn', reset);
  bot.on('end', reset);
  return () => {
    disposeWrite();
    protocol.off('spawn_entity', onSpawn);
    protocol.off('world_particles', onParticle);
    protocol.off('collect', onCollect);
    protocol.off('entity_destroy', onDestroy);
    bot.off('entityUpdate', onEntity);
    bot.off('entityMoved', onEntity);
    bot.off('itemDrop', onEntity);
    bot.inventory.off('updateSlot', confirmed);
    bot.off('respawn', reset);
    bot.off('end', reset);
    reset();
  };
}
