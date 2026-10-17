import { describe, expect, it } from 'vitest';
import { Vec3 } from 'vec3';
import { narrateWorldSegments, snapshotFromBot } from '../core/terrain.ts';

function botAt(position: Vec3, read: (p: Vec3) => any, onGround = true) {
  return { entity: { position, onGround, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0) },
    entities: {}, registry: {}, game: { dimension: 'overworld' }, time: {}, players: {},
    inventory: { items: () => [], slots: [] }, blockAt: (p: Vec3) => read(p.floored()) };
}
const air = { name: 'air', shapes: [] };
const bookshelf = { name: 'bookshelf', shapes: [[0, 0, 0, 1, 1, 1]] };
const place = (snapshot: ReturnType<typeof snapshotFromBot>) =>
  narrateWorldSegments(snapshot).find(part => part.key === 'place')!.text;

describe('actual footing in world facts', () => {
  it('uses the collision footprint when the center is over air at a block edge (live replay)', () => {
    // Captured 1.21.1: center column (-486,67,-506) is air, but the eastern
    // 0.091 blocks of the player's feet are supported by the adjacent bookshelf.
    const bot = botAt(new Vec3(-485.2085608120061, 68, -505.4999999721076),
      p => p.equals(new Vec3(-485, 67, -506)) ? bookshelf : air);
    const snapshot = snapshotFromBot(bot, { scanBlocks: false });
    expect(snapshot.standingOn).toBe('bookshelf');
    expect(place(snapshot)).not.toContain('脚下是空气');
  });

  it('does not narrate an unloaded support cell as empty space', () => {
    const snapshot = snapshotFromBot(botAt(new Vec3(0.5, 64, 0.5), () => null), { scanBlocks: false });
    expect(snapshot.standingOn).toBeNull();
    expect(place(snapshot)).toMatch(/未加载|未知|尚未/);
    expect(place(snapshot)).not.toContain('脚下是空');
  });

  it.each([
    ['stone_slab', 0.5], ['snow', 0.125], ['white_carpet', 0.0625],
    ['oak_fence', 1.5], ['oak_stairs', 0.5], ['oak_trapdoor', 0.1875],
  ])('finds fractional collision support on %s', (name, top) => {
    const bot = botAt(new Vec3(0.5, 64 + Number(top), 0.5),
      p => p.equals(new Vec3(0, 64, 0)) ? { name, shapes: [[0, 0, 0, 1, top, 1]] } : air);
    expect(snapshotFromBot(bot, { scanBlocks: false }).standingOn).toBe(name);
  });

  it('does not use a nearby wall as support, nor imply landing while in the air', () => {
    const bot = botAt(new Vec3(0.5, 64.5, 0.5),
      p => p.equals(new Vec3(0, 63, 0)) ? bookshelf : air, false);
    const snapshot = snapshotFromBot(bot, { scanBlocks: false });
    expect(snapshot.standingOn).toBe('air');
    expect(place(snapshot)).toContain('未接地');
    bot.entity.position = new Vec3(-0.35, 64, 0.5);
    expect(snapshotFromBot(bot, { scanBlocks: false }).standingOn).toBe('air');
  });

  it('reports a fluid at the feet without claiming a solid support', () => {
    const bot = botAt(new Vec3(0.5, 64, 0.5), () => ({ name: 'water', shapes: [] }), false);
    const snapshot = snapshotFromBot(bot, { scanBlocks: false });
    expect(snapshot.footing?.kind).toBe('fluid');
    expect(place(snapshot)).toContain('脚部位于水中');
  });

  it.each(['kelp', 'kelp_plant', 'seagrass', 'tall_seagrass'])('shares the same water-cell classification for %s', name => {
    const bot = botAt(new Vec3(0.5, 64, 0.5), () => ({ name, shapes: [] }), false);
    const snapshot = snapshotFromBot(bot, { scanBlocks: false });
    expect(snapshot.footing).toMatchObject({ kind: 'fluid', block: name, grounded: false });
    expect(snapshot.inWater).toBe(true);
    expect(place(snapshot)).not.toContain('未接地');
  });
});
