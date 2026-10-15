import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import mineflayer from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, expect, it, vi } from 'vitest';
import { Bridge } from '../core/bridge.ts';
import { MinecraftWorld } from '../core/world.ts';
import { biomeAt, type WorldSnapshot } from '../core/terrain.ts';
import { nullLogger } from '../src/client/index.ts';

const require = createRequire(import.meta.url);
const mf = createRequire(require.resolve('mineflayer'));
const bridges: Bridge[] = [];
afterEach(async () => {
  await Promise.all(bridges.splice(0).map(b => b.stop()));
  vi.restoreAllMocks(); vi.useRealTimers();
});

/** Real pinned health/inventory/physics plugins, injected before Bridge's inject_allowed listener. */
function rig(initialX = 0, positionFirst = false) {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T00:00:00Z'));
  const registry = require('minecraft-data')('1.21.1');
  const bot: any = Object.assign(new EventEmitter(), {
    _client: Object.assign(new EventEmitter(), { write: vi.fn() }), registry, version: '1.21.1',
    entity: { position: new Vec3(initialX, 64, 0), velocity: new Vec3(0, 0, 0), effects: {}, yaw: 0, pitch: 0, equipment: [] },
    game: { dimension: 'overworld' }, player: { uuid: 'test-player' }, username: 'tester',
    health: 20, food: 20, entities: {}, players: {},
    biomeName: 'plains',
    supportFeature: (name: string) => registry.supportFeature(name), loadPlugin() {}, quit() {},
  });
  bot.blockAt = () => registry.biomesByName[bot.biomeName]
    ? { biome: { id: registry.biomesByName[bot.biomeName].id } } : null;
  bot.once('inject_allowed', () => {
    mf('mineflayer/lib/plugins/health.js')(bot, { respawn: false });
    mf('mineflayer/lib/plugins/inventory.js')(bot, { hideErrors: true });
    mf('mineflayer/lib/plugins/physics.js')(bot, { physicsEnabled: false });
  });
  const world: any = Object.assign(Object.create(MinecraftWorld.prototype), {
    cfg: { world: { moveThreshold: 5 }, auth: 'offline' }, botName: 'tester', connectionGeneration: 1,
    hookedBots: new WeakSet(), bossQuarter: new Map(), activeEffects: new Map(), lastHealth: null,
    lastDeathEpisodeId: null, pendingDeathCause: null, personalSpawn: undefined,
    diag: { write: vi.fn() }, emit: vi.fn(), attachExtension() {}, hookMessageEvents() {},
    serverActionWait: { observeUses: () => () => {} }, scheduleBlueprintResourceObservation() {},
    interruptIdle() {}, bodyLease: { invalidate() {}, revive() {} }, resetBodyOwners() {},
    methods: { stop() {} }, deaths: { record: () => ({ today: 1, hereToday: 1 }) },
    worldIdentity: () => ({ key: 'test-realm' }), realmKey: () => 'test-realm', nearMarkNote: () => null,
    noticeDamage() {}, extensionLowHealth() {}, setBodyInhibited() {}, attention: { reset() {} },
    syncSpectator: vi.fn(),
  });
  const bridge = new Bridge({ host: 'fixture.test', port: 25565, username: 'tester', version: '1.21.1',
    viewerPort: 0, log: nullLogger(), onSpawn: () => { world.lastReported = world.snapshot(); },
    onRespawn: () => world.onRespawn(), onDisconnect() {},
    onSpawnPosition: (landing: unknown) => world.onSpawnPosition(landing),
  } as any);
  bridges.push(bridge); Object.assign(bridge, { installSpawnGear() {} }); world.bridge = bridge;
  vi.spyOn(mineflayer, 'createBot').mockReturnValue(bot);
  world.snapshot = (): WorldSnapshot => ({ position: { ...bot.entity.position }, dimension: bot.game.dimension,
    biome: biomeAt(bot, bot.entity.position), raining: false, health: bot.health, food: bot.food, xpLevel: 0,
    inventory: bot.inventory.items().map((item: any) => ({ name: item.name, count: item.count })),
    invSynced: bridge.invSynced,
  } as WorldSnapshot);
  bridge.start(); bot.emit('inject_allowed');
  const Item = mf('prismarine-item')(registry);
  let stateId = 0;
  const full = (logs = 0) => bot._client.emit('window_items', { windowId: 0, stateId: ++stateId,
    items: Array.from({ length: 46 }, (_, i) => Item.toNotch(i === 9 && logs
      ? new Item(registry.itemsByName.oak_log.id, logs) : null)), carriedItem: Item.toNotch(null) });
  const health = (value: number, food = 20) => bot._client.emit('update_health', { health: value, food, foodSaturation: 5 });
  const position = (x: number, z = 0) => bot._client.emit('position', {
    x, y: 64, z, yaw: 0, pitch: 0, flags: { x: false, y: false, z: false, yaw: false, pitch: false }, teleportId: 1,
  });
  full(8);
  if (positionFirst) position(0);
  health(20);
  if (!positionFirst) position(0);
  world.hookBotEvents(bot);
  // World snapshots can be requested synchronously by a health reader, before spawn fires.
  bot.on('health', () => world.reportWorldDelta());
  world.emit.mockClear();
  return { bot, bridge, world, full, health, position,
    texts: () => world.emit.mock.calls.map((call: any[]) => call[1] as string),
    die: () => { world.pendingDeathCause = { text: 'tester was slain by Drowned', key: 'death.attack.mob', at: Date.now() }; health(0); },
    walk: (x: number) => { bot.entity.position.x = x; world.reportWorldDelta(); },
  };
}

it.each([true, false])('rebases native landing before positive-health snapshot, inventory-before-health=%s', inventoryFirst => {
  const r = rig(); r.die();
  const episode = r.bot.deathLifecycle.episodeId;
  r.bot.emit('death'); // Duplicate death cannot replace the pending landing confirmation.
  r.bot._client.emit('respawn', {});
  r.position(121);
  if (inventoryFirst) r.full();
  r.health(20, 14);
  if (!inventoryFirst) { r.full(); r.world.reportWorldDelta(); }
  expect(r.bot.deathLifecycle).toMatchObject({ episodeId: episode, inventorySynced: true });
  expect(r.texts().some(text => /走了 121/.test(text))).toBe(false);
  expect(r.texts().some(text => /少了.*橡木原木|少了.*oak_log/.test(text))).toBe(true);
  const death = r.world.emit.mock.calls.find((call: any[]) => call[3]?.meta?.death)?.[3].meta.death;
  expect(death.cause.text).toBe('tester was slain by Drowned');
  r.walk(129);
  expect(r.texts().some(text => text.includes('走了 8 格'))).toBe(true);
});

it('holds only spatial comparison when positive health arrives before the authoritative landing packet', () => {
  const r = rig(); r.die(); r.bot._client.emit('respawn', {});
  r.health(20, 14); // spawn and body facts arrive while the position is still from the old life.
  expect(r.texts().some(text => text.includes('饥饿 14/20'))).toBe(true);
  r.position(121); r.full(); r.world.reportWorldDelta();
  expect(r.texts().some(text => text.includes('走了 121'))).toBe(false);
  r.walk(129);
  expect(r.texts().some(text => text.includes('走了 8 格'))).toBe(true);
});

it('keeps the first landing for delayed confirmation and does not erase accumulated walking', async () => {
  const r = rig(); r.die(); r.bot._client.emit('respawn', {}); r.position(121); r.full(); r.health(20);
  r.bot.entity.position.x = 124; // Less than move threshold; must accumulate across the 3s timer.
  r.world.reportWorldDelta();
  await vi.advanceTimersByTimeAsync(3000);
  expect(r.texts().filter(text => text.includes('实际落在'))).toEqual([
    expect.stringContaining('(121, 64, 0),离死亡点 121 格'),
  ]);
  r.walk(127);
  expect(r.texts().some(text => text.includes('走了 6 格'))).toBe(true);
});

it('does not rebase a later ordinary position packet in the same life', () => {
  const r = rig(); r.die(); r.bot._client.emit('respawn', {}); r.position(121); r.full(); r.health(20);
  r.position(128); r.world.reportWorldDelta();
  expect(r.texts().some(text => text.includes('走了 7 格'))).toBe(true);
});

it.each([
  [false, false], [false, true], [true, false], [true, true],
])('does not call a landing biome walking (late-biome=%s, inventory-before-health=%s)', (lateBiome, inventoryFirst) => {
  const r = rig(); r.die(); r.bot._client.emit('respawn', {});
  r.bot.biomeName = lateBiome ? 'unknown' : 'forest';
  r.position(121);
  expect(r.bridge.invSynced).toBe(false);
  if (inventoryFirst) r.full();
  r.health(20, 14);
  if (!inventoryFirst) { expect(r.bridge.invSynced).toBe(false); r.full(); }
  r.world.reportWorldDelta();
  r.bot.biomeName = 'forest'; r.world.reportWorldDelta(); // Biome chunks may arrive after position and health.
  expect(r.texts().some(text => text.includes('走进了'))).toBe(false);
  expect(r.texts().some(text => text.includes('走了 121'))).toBe(false);
  expect(r.bridge.invSynced).toBe(true);
  expect(r.texts().some(text => /少了.*橡木原木|少了.*oak_log/.test(text))).toBe(true);
  expect(r.texts().some(text => text.includes('饥饿 14/20'))).toBe(true);
  if (lateBiome) expect(r.texts().some(text => text.includes('所在的群系是'))).toBe(true);
  r.bot.biomeName = 'desert'; r.walk(129);
  expect(r.texts().some(text => text.includes('走进了沙漠'))).toBe(true);
  expect(r.texts().some(text => text.includes('走了 8 格'))).toBe(true);
});

it('rebases a dimension landing biome but preserves the next actual crossing', () => {
  const r = rig(); r.bot._client.emit('respawn', {}); r.bot.game.dimension = 'the_nether';
  r.bot.biomeName = 'forest'; r.health(20); r.position(121); r.world.reportWorldDelta();
  expect(r.texts().some(text => text.includes('走进了'))).toBe(false);
  r.bot.biomeName = 'desert'; r.walk(129);
  expect(r.texts().some(text => text.includes('走进了沙漠'))).toBe(true);
});

it.each(['new-death', 'new-generation'])('does not let an old confirmation rewrite the baseline after %s', async boundary => {
  const r = rig(); r.die(); r.bot._client.emit('respawn', {}); r.position(121); r.full(); r.health(20);
  if (boundary === 'new-death') { r.die(); r.bot._client.emit('respawn', {}); r.position(200); r.full(); r.health(20); }
  else { r.world.connectionGeneration++; }
  r.bot.entity.position.x += 3;
  await vi.advanceTimersByTimeAsync(3000);
  expect(r.texts().filter(text => text.includes('实际落在'))).toHaveLength(boundary === 'new-death' ? 1 : 0);
  r.walk(boundary === 'new-death' ? 206 : 127);
  expect(r.texts().some(text => text.includes('走了 6 格'))).toBe(true);
});

it('treats dimension transfer as a position boundary without inventing a death or respawn confirmation', async () => {
  const r = rig();
  r.bot._client.emit('respawn', {}); r.bot.game.dimension = 'the_nether';
  r.health(20); r.position(121); r.world.reportWorldDelta();
  r.walk(129);
  expect(r.texts().some(text => text.includes('走了 8 格'))).toBe(true);
  await vi.advanceTimersByTimeAsync(3000);
  expect(r.texts().some(text => text.includes('实际落在'))).toBe(false);
  expect(r.bot.deathLifecycle).toBeUndefined();
});

it('does not announce an old death again on a later dimension transfer', async () => {
  const r = rig(); r.die(); r.bot._client.emit('respawn', {}); r.position(121); r.full(); r.health(20);
  await vi.advanceTimersByTimeAsync(3000); r.world.emit.mockClear();
  r.bot._client.emit('respawn', {}); r.bot.game.dimension = 'the_nether';
  r.health(20); r.position(200); r.world.reportWorldDelta(); r.walk(206);
  expect(r.texts().some(text => text.includes('走了 6 格'))).toBe(true);
  await vi.advanceTimersByTimeAsync(3000);
  expect(r.texts().some(text => text.includes('重生'))).toBe(false);
});

it('establishes the initial baseline when position arrives before first health/spawn', () => {
  const r = rig(-121, true);
  expect(r.world.lastReported.position.x).toBe(0);
  r.walk(6);
  expect(r.texts().some(text => text.includes('走了 6 格'))).toBe(true);
});

it('uses the first initial-spawn position but ignores packets from a disconnected generation', async () => {
  const r = rig(-121); // Health/spawn preceded the first server position at x=0.
  expect(r.world.lastReported.position.x).toBe(0);
  r.walk(6);
  expect(r.texts().some(text => text.includes('走了 6 格'))).toBe(true);
  await r.bridge.stop();
  r.world.lastReported.position = { x: 500, y: 64, z: 0 };
  r.bot._client.emit('respawn', {}); r.position(900);
  expect(r.world.lastReported.position.x).toBe(500);
});
