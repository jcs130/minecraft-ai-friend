import { expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import { methodHarness } from './method-harness.ts';
import { entityObservationNote, snapshotFromBot } from '../core/terrain.ts';
import { AttentionReader } from '../core/perception-tools.ts';
import { useOnce } from '../core/skills-interact.ts';

const uuid = '12345678-1234-4234-8234-123456789abc';
function named(r: ReturnType<typeof methodHarness>, name = 'allay', customName = '同行者') {
  const keys = r.bot.registry.entitiesByName[name].metadataKeys;
  const metadata: unknown[] = [];
  metadata[keys.indexOf('custom_name')] = { type: 'compound', value: { text: { type: 'string', value: customName } } };
  metadata[keys.indexOf('health')] = 20;
  return { id: 7, uuid, name, type: 'mob', metadata, isValid: true, height: 1,
    position: new Vec3(.5, 64, -1), velocity: new Vec3(0, 0, 0) };
}

it.each(['1.21.1', '1.20.6'])('preserves a named non-animal identity in observations without changing its protocol target (%s)', version => {
  const r = methodHarness(version);
  try {
    const e = named(r); Object.assign(r.bot.entities, { 7: e });
    expect(entityObservationNote(r.bot, e)).toContain('同行者');
    const row = snapshotFromBot(r.bot, { scanBlocks: false }).entities.find(x => x.entityId === 7)!;
    expect(row).toMatchObject({ name: 'allay', uuid, customName: '同行者' });
    expect(new AttentionReader().read(r.bot, 3).highlights[0]).toMatchObject({ target: 'allay', uuid, customName: '同行者' });
    expect(row.note).not.toMatch(/主人是你|你的女仆/);
    // Identity metadata is not a new way to see through walls.
    r.set(0, 65, 0, 'stone'); r.set(0, 64, 0, 'stone');
    const hidden = snapshotFromBot(r.bot, { scanBlocks: false }).entities.find(x => x.entityId === 7);
    expect(hidden?.customName).toBeUndefined();
  } finally { r.close(); }
});

it('wakes for a named neutral death with exact identity, while ordinary monster deaths stay piggyback', () => {
  const r = methodHarness('1.21.1');
  try {
    const emit = vi.spyOn(r.world as any, 'emit').mockImplementation(() => undefined);
    (r.world as any).hookBotEvents(r.bot);
    r.bot.emit('entityDead', named(r));
    expect(emit).toHaveBeenCalledWith('minecraft.event', expect.stringContaining('同行者'), false,
      expect.objectContaining({ trigger: 'debounce', meta: expect.objectContaining({
        entityLifecycle: expect.objectContaining({ kind: 'death', entityId: 7, uuid, entityType: 'allay' }),
      }) }));
    emit.mockClear();
    r.bot.emit('entityDead', named(r, 'zombie', '命名僵尸'));
    expect(emit.mock.calls[0]?.[3]).toMatchObject({ trigger: 'piggyback' });
  } finally { r.close(); }
});

it('does not describe a named NPC button menu as its inventory or claim its sword icon can be taken', async () => {
  const r = methodHarness('1.21.1');
  try {
    const e = named(r); Object.assign(r.bot.entities, { 7: e });
    const win = { id: 5, type: 'minecraft:generic_9x6', title: '与 同行者 交谈', inventoryStart: 54,
      inventoryEnd: 90, slots: Array(90).fill(null) };
    win.slots[4] = { name: 'iron_sword', count: 1, type: r.bot.registry.itemsByName.iron_sword.id, metadata: 0 };
    const close = vi.fn();
    Object.assign(r.bot.world, { raycast: () => null });
    Object.assign(r.bot, { lookAt: async () => {}, useOn: async () => {
      r.bot._client.write('use_entity', { target: e.id, mouse: 0, hand: 0 });
      Object.assign(r.bot, { currentWindow: win });
    }, closeWindow: close });
    const result = await useOnce(r.bot as never, { skill: 'use', target: 'allay', entityId: 7 }, { aborted: () => false } as never);
    expect(result).toContain('同行者');
    expect(result).toContain('界面');
    expect(result).not.toMatch(/箱子窗口|要取东西用 take/);
    expect(result).toContain('尚未确认');
    expect(close).toHaveBeenCalledWith(win);
  } finally { r.close(); }
});
