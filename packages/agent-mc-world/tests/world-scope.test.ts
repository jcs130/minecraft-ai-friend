import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Bot } from 'mineflayer';
import { afterEach, expect, it, vi } from 'vitest';
import { installWorldIdentity, readWorldIdentity, worldScopedRealm } from '../core/world-scope.ts';
import { ChestBook } from '../core/chests.ts';
import { Executor } from '../core/executor.ts';
import { MinecraftWorld } from '../core/world.ts';
import { nullLogger } from '../src/client/index.ts';

const require = createRequire(import.meta.url);
const mf = createRequire(require.resolve('mineflayer'));
const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });
function bot() {
  return Object.assign(new EventEmitter(), {
    _client: Object.assign(new EventEmitter(), { registerChannel: vi.fn(), writeChannel: vi.fn() }),
    game: { dimension: 'overworld' }, username: 'fixture',
  }) as unknown as Bot;
}
function enter(b: Bot, key: string, event = 'login') {
  b._client.emit(event, { worldState: { name: key, dimension: 0, gamemode: 0 } });
}
function file() {
  const dir = mkdtempSync(join(tmpdir(), 'mc-world-scope-')); directories.push(dir);
  return join(dir, 'chests.json');
}
const at = { x: -500, y: 68, z: -475 };

it('retains the native level name with the real pinned Mineflayer game plugin, without changing its physics type', () => {
  const b = bot();
  const registry = require('minecraft-data')('1.21.1');
  // The native server registry_data packet maps dimension index 0 to this type.
  Object.assign(b, { registry: { ...registry, dimensionsArray: [{ name: 'minecraft:overworld' }],
    dimensionsByName: { overworld: { minY: -64, height: 384 } } },
    supportFeature: (name: string) => require('minecraft-data')('1.21.1').supportFeature(name) });
  mf('mineflayer/lib/plugins/game.js')(b, { brand: 'fixture' });
  const dispose = installWorldIdentity(b);
  const observed: unknown[] = [];
  b.on('game', () => observed.push(readWorldIdentity(b).key));
  enter(b, 'minecraft:overworld');
  expect(b.game.dimension).toBe('overworld');
  enter(b, 'minecraft:aincrad', 'respawn');
  expect(b.game.dimension).toBe('overworld');
  expect(readWorldIdentity(b)).toMatchObject({ key: 'minecraft:aincrad', dimensionType: 'overworld',
    uuid: null, instanceId: null, source: 'vanilla-respawn' });
  expect(observed).toEqual(['minecraft:overworld', 'minecraft:aincrad']);
  dispose();
});

it('keeps same-world identity and revision stable on respawn, and changes the namespace for a different world', () => {
  const b = bot(); installWorldIdentity(b); enter(b, 'minecraft:overworld');
  const original = worldScopedRealm('server-A', b), revision = readWorldIdentity(b).revision;
  enter(b, 'minecraft:overworld', 'respawn');
  expect(worldScopedRealm('server-A', b)).toBe(original);
  expect(readWorldIdentity(b).revision).toBe(revision);
  enter(b, 'minecraft:aincrad', 'respawn');
  expect(worldScopedRealm('server-A', b)).not.toBe(original);
  expect(readWorldIdentity(b).revision).toBeGreaterThan(revision);
});

it('restores only a known native world namespace across connections, and never merges different servers', () => {
  const first = bot(), second = bot(); installWorldIdentity(first); installWorldIdentity(second);
  expect(worldScopedRealm('server-A', first)).not.toBe(worldScopedRealm('server-A', second));
  enter(first, 'minecraft:aincrad'); enter(second, 'minecraft:aincrad');
  expect(worldScopedRealm('server-A', first)).toBe(worldScopedRealm('server-A', second));
  expect(worldScopedRealm('server-A', first)).not.toBe(worldScopedRealm('server-B', first));
});

it('accepts legacy worldName fields by payload capability, without mistaking a type for a world key', () => {
  const b = bot(); installWorldIdentity(b);
  b._client.emit('login', { worldName: 'custom:another_world', worldType: 'minecraft:overworld' });
  expect(readWorldIdentity(b).key).toBe('custom:another_world');
  const known = worldScopedRealm('server', b);
  b._client.emit('respawn', { dimension: 'minecraft:overworld' });
  expect(readWorldIdentity(b)).toMatchObject({ key: null, uuid: null, source: 'unknown' });
  const unknown = worldScopedRealm('server', b);
  expect(unknown).not.toBe(known);
  b._client.emit('respawn', {});
  expect(worldScopedRealm('server', b)).not.toBe(unknown);
});

it('does not resample identity timestamps on reads, sends nothing, and removes its listeners on connection end', () => {
  const b = bot(); const before = b._client.listenerCount('login'); installWorldIdentity(b); enter(b, 'minecraft:aincrad');
  const reading = readWorldIdentity(b);
  expect(readWorldIdentity(b)).toEqual(reading);
  expect(b._client.listenerCount('login')).toBe(before + 1);
  b.emit('end', 'fixture');
  expect(b._client.listenerCount('login')).toBe(before);
  expect(readWorldIdentity(b).key).toBeNull();
  expect((b._client as any).writeChannel).not.toHaveBeenCalled();
});

it('keeps identical chest coordinates, item counts and due furnaces separate in two overworld worlds', () => {
  const book = new ChestBook(file());
  const main = book.forRealm('server/world:overworld'), aincrad = book.forRealm('server/world:aincrad');
  main.remember('overworld', at, [{ name: 'arrow', count: 16 }], 1, 27);
  aincrad.remember('overworld', at, [{ name: 'oak_log', count: 2 }], 1, 27);
  aincrad.rememberFurnace('overworld', { ...at, x: at.x + 1 }, 'furnace',
    { input: null, fuel: null, output: { name: 'iron_ingot', count: 1 } }, 1, 2);
  expect(main.get('overworld', at)?.items).toEqual([{ name: 'arrow', count: 16 }]);
  expect(aincrad.get('overworld', at)?.items).toEqual([{ name: 'oak_log', count: 2 }]);
  expect(main.tally('overworld')).toEqual({ arrow: 16 });
  expect(main.itemSources('overworld', 'oak_log')).toEqual([]);
  expect(main.due(3)).toEqual([]);
  expect(aincrad.due(3)).toHaveLength(1);
  expect(main.inCells('overworld', [at])).toHaveLength(1);
  expect(main.loadedFurnaces('overworld')).toEqual([]);
});

it('preserves legacy records without silently assigning them to a newly observed world', () => {
  const path = file(), legacy = new ChestBook(path);
  legacy.remember('overworld', at, [{ name: 'diamond', count: 5 }], 1, 27);
  const bytes = readFileSync(path);
  const restored = new ChestBook(path), modern = restored.forRealm('server/world:overworld');
  expect(modern.get('overworld', at)).toBeUndefined();
  expect(modern.chestsIn('overworld')).toEqual([]);
  expect(readFileSync(path)).toEqual(bytes);
  modern.remember('overworld', at, [{ name: 'arrow', count: 16 }], 1, 27);
  const again = new ChestBook(path);
  expect(again.get('overworld', at)?.items).toEqual([{ name: 'diamond', count: 5 }]);
  expect(again.forRealm('server/world:overworld').get('overworld', at)?.items).toEqual([{ name: 'arrow', count: 16 }]);
  modern.clear();
  expect(new ChestBook(path).get('overworld', at)?.items).toEqual([{ name: 'diamond', count: 5 }]);
});

it('freezes operation views so late old-world window results cannot overwrite the current world', () => {
  const book = new ChestBook(null); let realm = 'world-A';
  const executor = new Executor({ getBot: () => null, report() {}, nextId: () => 1, log: nullLogger(),
    getChests: () => book.forRealm(realm) });
  const oldView = (executor as any).precheckDeps(bot()).chests as ChestBook;
  realm = 'world-B';
  const newView = (executor as any).precheckDeps(bot()).chests as ChestBook;
  newView.remember('overworld', at, [{ name: 'arrow', count: 16 }], 1, 27);
  oldView.remember('overworld', at, [{ name: 'oak_log', count: 2 }], 1, 27);
  expect(newView.get('overworld', at)?.items).toEqual([{ name: 'arrow', count: 16 }]);
  expect(oldView.get('overworld', at)?.items).toEqual([{ name: 'oak_log', count: 2 }]);
});

it('recovers scoped keys after a legacy consumer omits the added record field while preserving old map keys', () => {
  const path = file(), book = new ChestBook(path);
  book.forRealm('world-A').remember('overworld', at, [{ name: 'arrow', count: 16 }], 1, 27);
  book.forRealm('world-B').remember('overworld', at, [{ name: 'oak_log', count: 2 }], 1, 27);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  for (const value of Object.values(data) as Array<Record<string, unknown>>) delete value.realm;
  writeFileSync(path, JSON.stringify(data));
  const restored = new ChestBook(path);
  expect(restored.forRealm('world-A').get('overworld', at)?.items).toEqual([{ name: 'arrow', count: 16 }]);
  expect(restored.forRealm('world-B').get('overworld', at)?.items).toEqual([{ name: 'oak_log', count: 2 }]);
  expect(restored.get('overworld', at)).toBeUndefined();
});

it('the actual World realm key changes for a native level switch even when the dimension type stays overworld', () => {
  const b = bot(); installWorldIdentity(b); enter(b, 'minecraft:overworld');
  const world: any = Object.assign(Object.create(MinecraftWorld.prototype), {
    cfg: { host: 'fixture.test', port: 25565 }, bridge: { bot: b },
    worldIdentity: () => ({ key: 'fixture.test:25565', local: false }),
  });
  const original = world.realmKey();
  enter(b, 'minecraft:aincrad', 'respawn');
  expect(world.realmKey()).not.toBe(original);
  expect(world.realmKey()).toContain('minecraft:aincrad');
  expect(b.game.dimension).toBe('overworld');
});

it('replaces a lost world observation with explicit unknown rather than leaving the prior identity current', () => {
  const world: any = Object.assign(Object.create(MinecraftWorld.prototype), {
    connectionReadiness: () => ({ ready: false, phase: 'retrying' }), goalTable: () => ({ list: [] }),
    lastFinishedTask: null,
  });
  const facts = world.unavailableRequestFacts('disconnected');
  expect(facts.world).toMatchObject({ key: null, uuid: null, instanceId: null, source: 'unknown' });
  expect(JSON.parse(facts.parts.find((part: any) => part.key === 'identity').text).world.key).toBeNull();
});

it.each([false, true])('World invalidates spatial facts only when the native world actually changes (switch=%s)', change => {
  const b = bot(); installWorldIdentity(b); enter(b, 'minecraft:overworld');
  const oldFacts = { world: readWorldIdentity(b) };
  const world: any = Object.assign(Object.create(MinecraftWorld.prototype), {
    cfg: { host: 'fixture.test', port: 25565 }, bridge: { bot: b },
    worldIdentity: () => ({ key: 'fixture.test:25565', local: false }),
    serverQueries: { reset: vi.fn() }, setBodyInhibited: vi.fn(), attention: { reset: vi.fn() },
    extensionRespawn: vi.fn(), bodyLease: { revive: vi.fn() }, resetBodyOwners: vi.fn(),
    idleContext: { clear: vi.fn() }, setPersonalSpawn: vi.fn(), syncRealm: vi.fn(),
    noteWorldSwitch: vi.fn(), scheduleRespawnConfirmation: vi.fn(),
    proximity: { clear: vi.fn() }, playerObservations: { clear: vi.fn() }, flocks: { clear: vi.fn() },
    matureAnnounced: { clear: vi.fn() }, emit: vi.fn(), resyncSpectatorForDimension: vi.fn(),
    executor: { cancelForDimensionChange: vi.fn() },
    combat: { onConnectionLost: vi.fn() }, reflexes: { stop: vi.fn(), start: vi.fn() },
    requestFactsCache: oldFacts, lastReported: oldFacts, journeyBlocks: { dimension: 'overworld' },
  });
  world.spatialRealm = world.realmKey();
  enter(b, change ? 'minecraft:aincrad' : 'minecraft:overworld', 'respawn');
  world.onRespawn();
  expect(world.syncRealm).toHaveBeenCalledTimes(change ? 1 : 0);
  expect(world.noteWorldSwitch).toHaveBeenCalledTimes(change ? 1 : 0);
  expect(world.executor.cancelForDimensionChange).toHaveBeenCalledTimes(change ? 1 : 0);
  expect(world.combat.onConnectionLost).toHaveBeenCalledTimes(change ? 1 : 0);
  expect(world.reflexes.stop).toHaveBeenCalledTimes(change ? 1 : 0);
  expect(world.reflexes.start).toHaveBeenCalledTimes(change ? 1 : 0);
  if (change) expect(world.executor.cancelForDimensionChange).toHaveBeenCalledWith('minecraft:overworld', 'minecraft:overworld',
    { from: 'minecraft:overworld', to: 'minecraft:aincrad' });
  expect(world.lastReported).toBe(change ? null : oldFacts);
  expect(world.requestFactsCache).toBe(change ? null : oldFacts);
  expect(world.idleContext.clear).toHaveBeenCalledTimes(change ? 1 : 0);
});
