import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { Vec3 } from 'vec3';
import { attachHearing, hearingOf, audibleHint } from '../core/perception-hearing.ts';
import { viewerSoundPacket } from '../core/viewer-sound-packets.ts';
import { loadViewerSoundRegistry } from '../core/viewer-sound-registry.ts';
import { assertMinecraftReady, MINECRAFT_CLIENT_DEFAULTS } from '../src/client/config.ts';
const req = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = req('prismarine-registry')('1.20.6'), protocol = req('minecraft-protocol');

// Independent Mojang 1.20.6 datagen --reports registry dump, not client table
// lookups. Server SHA-256: c6d01d018ca782e506f0ec60652d47fd565078be9122b625c1681bc86c29c7ec.
const nativeEntities = { 3: 'armor_stand', 33: 'enderman', 59: 'item_display', 105: 'text_display', 113: 'villager', 126: 'zombie_villager' };
describe('protocol 766 registry and sound evidence', () => {
  it('decodes village/display/monster spawn packets using Mineflayer entity handling', () => {
    const bot = Object.assign(new EventEmitter(), { registry, version: '1.20.6', _client: new EventEmitter(),
      supportFeature: registry.supportFeature, game: { dimension: 'overworld' } });
    req('mineflayer/lib/plugins/entities.js')(bot);
    const serializer = protocol.createSerializer({ state: 'play', isServer: true, version: '1.20.6' });
    const parser = protocol.createDeserializer({ state: 'play', isServer: false, version: '1.20.6' });
    for (const [id, name] of Object.entries(nativeEntities)) {
      const packet = { entityId: 1000 + Number(id), objectUUID: '00000000-0000-0000-0000-000000000001',
        type: Number(id), x: 5, y: 64, z: -3, pitch: 0, yaw: 0, headPitch: 0, objectData: 0,
        velocity: { x: 0, y: 0, z: 0 } };
      const bytes = serializer.createPacketBuffer({ name: 'spawn_entity', params: packet });
      const decoded = parser.parsePacketBuffer(bytes).data;
      bot._client.emit(decoded.name, decoded.params);
      expect((bot as any).entities[packet.entityId].name).toBe(name);
    }
    expect(Object.values((bot as any).entities).filter((e: any) => e.name === 'enderman')).toHaveLength(1);
  });
  it('does not use the inherited 1539-entry sound table for 1.20.6 numeric sounds', async () => {
    const loaded = await loadViewerSoundRegistry('', '1.20.6', registry);
    expect(loaded.source).toBe('unavailable');
    const bot = Object.assign(new EventEmitter(), { registry, version: '1.20.6', _client: new EventEmitter(),
      entities: {}, entity: { id: 1, position: new Vec3(0, 64, 0) } });
    const detach = attachHearing(bot as never, '');
    await vi.waitFor(() => expect(hearingOf(bot)?.source).toBe('named-only'));
    // Raw table says 447 = enderman. Native 1.20.6 enderman ambient is 477.
    bot._client.emit('sound_effect', { sound: { soundId: 447 }, soundCategory: 5, x: 48, y: 512, z: 0, volume: 1, pitch: 1 });
    expect(hearingOf(bot)!.read()).toEqual([]); detach();
  });
  it('resolves a holder index exactly once and never turns a sound into an entity count', () => {
    const exact = { sounds: { 477: { name: 'minecraft:entity.enderman.ambient' }, 1450: { name: 'minecraft:entity.villager.ambient' } } };
    const serializer = protocol.createSerializer({ state: 'play', isServer: true, version: '1.20.6' });
    const parser = protocol.createDeserializer({ state: 'play', isServer: false, version: '1.20.6' });
    const bytes = serializer.createPacketBuffer({ name: 'sound_effect', params: { sound: { soundId: 1450 },
      soundCategory: 6, x: 48, y: 512, z: 0, volume: 1, pitch: 1, seed: 1n } });
    const decoded = parser.parsePacketBuffer(bytes).data.params;
    expect(decoded.sound.soundId).toBe(1450);
    const sound = viewerSoundPacket('sound_effect', decoded, exact, () => null)!;
    expect(sound.name).toBe('entity.villager.ambient');
    const hint = audibleHint(sound, { id: 1, position: new Vec3(0, 64, 0) }, 1)!;
    expect(hint.kind).toBe('生物声'); expect(JSON.stringify(hint)).not.toMatch(/末影人|enderman|count/);
  });
});

afterEach(() => vi.useRealTimers());
it('uses the real minecraft-protocol keepalive timeout and cancels it on disconnect', async () => {
  vi.useFakeTimers();
  const client = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() });
  const error = vi.fn(); client.on('error', error);
  const protoReq = createRequire(req.resolve('minecraft-protocol'));
  protoReq('./client/keepalive.js')(client, { checkTimeoutInterval: 60_000 });
  client.emit('keep_alive', { keepAliveId: 1n });
  await vi.advanceTimersByTimeAsync(30_001); expect(client.end).not.toHaveBeenCalled();
  client.emit('keep_alive', { keepAliveId: 2n });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(client.end).toHaveBeenCalledWith('keepAliveError'); expect(error).toHaveBeenCalledOnce();
  client.emit('keep_alive', { keepAliveId: 3n }); client.emit('end');
  await vi.advanceTimersByTimeAsync(60_000); expect(error).toHaveBeenCalledOnce();
  for (const keepAliveTimeoutMs of [0, 999, 300001, NaN]) expect(() => assertMinecraftReady({ ...structuredClone(MINECRAFT_CLIENT_DEFAULTS),
    host: 'localhost', username: 'Agent', keepAliveTimeoutMs })).toThrow('keepAliveTimeoutMs');
});
