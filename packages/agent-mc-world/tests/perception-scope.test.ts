import { describe, expect, it } from 'vitest';
import { Vec3 } from 'vec3';
import { configureObservationPolicy, observedEntity, observationView } from '../core/perception-sight.ts';
import { snapshotFromBot } from '../core/terrain.ts';
import { AttentionReader } from '../core/perception-tools.ts';
import { BattlefieldObserver } from '../core/battlefield.ts';
import { assertMinecraftReady, MINECRAFT_CLIENT_DEFAULTS } from '../src/client/config.ts';

const air = { name: 'air', shapes: [] };
const stone = { name: 'stone', shapes: [[0, 0, 0, 1, 1, 1]] };
function rig() {
  const entity = { id: 1, position: new Vec3(.5, 64, .5), yaw: 0, pitch: 0, eyeHeight: 1.62 };
  const mob = (id: number, x: number, z: number) => ({ id, name: 'zombie', height: 1.8, position: new Vec3(x, 64, z) });
  return { entity, entities: { 2: mob(2, .5, -6), 3: mob(3, 8, .5), 4: mob(4, .5, 8) },
    registry: { items: {}, blocksByName: {} }, game: { dimension: 'overworld' }, time: {}, health: 20, food: 20,
    inventory: { items: () => [], slots: [] }, players: {}, findBlocks: () => [],
    blockAt: (p: Vec3): any => ({ ...air, position: p }), world: { raycast: () => null } };
}

describe('surrounding observation scope', () => {
  it('keeps unobstructed nearby actors in snapshot, attention and battlefield when the camera turns', () => {
    const bot = rig();
    const ids = () => ({
      snapshot: snapshotFromBot(bot, { scanBlocks: false }).entities.map(e => e.entityId),
      attention: new AttentionReader().read(bot, 8).highlights.map(e => e.id),
      battlefield: new BattlefieldObserver().sample(bot as never, 1,
        { fighting: false, emergency: false, taskId: null, step: null }, 12).actors.map(e => e.entityId),
    });
    const before = ids();
    for (const rows of Object.values(before)) expect(rows.sort()).toEqual([2, 3, 4]);
    bot.entity.yaw = Math.PI;
    expect(ids()).toEqual(before);
  });

  it('preserves directional observation as an explicit camera policy', () => {
    const bot = rig();
    configureObservationPolicy(bot, () => ({ entityView: 'camera' }));
    expect(Object.values(bot.entities).filter(e => observedEntity(bot, e)).map(e => e.id)).toEqual([2]);
    bot.entity.yaw = Math.PI;
    expect(Object.values(bot.entities).filter(e => observedEntity(bot, e)).map(e => e.id)).toEqual([4]);
    expect(observedEntity(bot, bot.entities[3], false)).toBe(true);
  });

  it('uses the configured entity range in passive snapshots as well as explicit reads', () => {
    const bot = rig();
    bot.entities[2].position = new Vec3(.5, 64, -23.5);
    expect(snapshotFromBot(bot, { scanBlocks: false }).entities.map(e => e.entityId)).toContain(2);
    let entityRange = 16;
    configureObservationPolicy(bot, () => ({ entityRange }));
    expect(snapshotFromBot(bot, { scanBlocks: false }).entities.map(e => e.entityId)).not.toContain(2);
    entityRange = 48;
    bot.entities[2].position.z = -39.5;
    expect(snapshotFromBot(bot, { scanBlocks: false }).entities.map(e => e.entityId)).toContain(2);
    expect(observedEntity(bot, bot.entities[2])).toBe(true);
  });

  it('still rejects obscured, unloaded and invisible actors outside the camera direction', () => {
    const bot = rig();
    expect(observedEntity(bot, bot.entities[4])).toBe(true);
    bot.blockAt = p => p.z === 3 ? { ...stone, position: p } : { ...air, position: p };
    expect(observedEntity(bot, bot.entities[4])).toBe(false);
    bot.blockAt = p => p.z === 3 ? null : { ...air, position: p };
    expect(observedEntity(bot, bot.entities[4])).toBe(false);
    bot.blockAt = p => ({ ...air, position: p });
    expect(observedEntity(bot, { ...bot.entities[4], invisible: true })).toBe(false);
  });

  it('does not discard a requested scan tail before testing which blocks can be seen', () => {
    const bot = rig();
    const hidden = Array.from({ length: 512 }, (_, n) => new Vec3(n % 16 - 8, 64, 2 + Math.floor(n / 16)));
    const visible = new Vec3(-4, 64, -4);
    const all = [...hidden, visible];
    const blocks = new Set(all.map(p => p.toString()));
    bot.blockAt = p => p.z === 1 || blocks.has(p.toString()) ? { ...stone, position: p } : { ...air, position: p };
    const queryBot = { ...bot, findBlocks: (opts: { count: number }) => all.slice(0, opts.count) };
    expect(observationView(queryBot as never).findBlocks({ matching: 1, count: 2048 })).toEqual([visible]);
  });

  it.each([{ entityRange: 0 }, { entityRange: 65 }, { entityRange: 12.5 }, { entityView: 'tracking' }])(
    'rejects invalid perception configuration %j', perception => {
      const cfg = { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), host: 'localhost', username: 'agent', perception };
      expect(() => assertMinecraftReady(cfg as never)).toThrow(/perception/);
    },
  );
});
