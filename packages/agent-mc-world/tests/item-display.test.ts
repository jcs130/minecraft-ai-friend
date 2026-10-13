import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Vec3 } from 'vec3';
import { itemCustomName } from '../core/item-display.ts';
import { bagNow } from '../core/receipt.ts';
import { containerStacks, potionText, slotStack } from '../core/containers.ts';
import { askedLabel, invItemNamed } from '../core/inventory.ts';
import { skillEquip } from '../core/skills-craft.ts';
import { bagStamp, renderBagReadout, renderStoredItemReadout } from '../core/readouts.ts';
import { droppedStackOf, narrateWorld, narrateWorldSegments, snapshotFingerprint, snapshotFromBot, worldDelta } from '../core/terrain.ts';

const worldRequire = createRequire(import.meta.url);
const require = createRequire(worldRequire.resolve('mineflayer'));
const Item = require('prismarine-item')('1.20.6');
const registry = require('minecraft-data')('1.20.6');

function namedItem(name: string, title: string, count = 1) {
  return Item.fromNotch({ itemCount: count, itemId: registry.itemsByName[name].id,
    addedComponentCount: 1, removedComponentCount: 0, removeComponents: [],
    components: [{ type: 'custom_name', data: { type: 'compound', value: {
      text: { type: 'string', value: '' }, extra: { type: 'list', value: { type: 'compound', value: [
        { text: { type: 'string', value: title }, color: { type: 'string', value: 'gold' } },
      ] } },
    } } }],
  });
}

function botWithItems() {
  const sword = namedItem('diamond_sword', '星灯誓约');
  const helmet = namedItem('iron_helmet', '巡林者头盔');
  const backpack = namedItem('player_head', '大背包');
  const scroll = namedItem('paper', '远行卷轴', 2);
  const slots = Array(46).fill(null);
  slots[5] = helmet; slots[36] = sword; slots[9] = scroll; slots[45] = backpack;
  const bot = {
    entity: { position: new Vec3(0.5, 64, 0.5), velocity: new Vec3(0, 0, 0), yaw: 0, onGround: true },
    entities: {}, registry, game: { dimension: 'overworld', gameMode: 'survival' },
    blockAt: () => null, findBlocks: () => [], health: 20, food: 20, oxygenLevel: 20,
    time: { timeOfDay: 6000 }, players: {}, heldItem: sword,
    inventory: { slots, items: () => [sword, scroll], selectedItem: null },
    getEquipmentDestSlot: () => 45,
  };
  return { bot, sword, helmet, backpack, scroll };
}

describe('item instance display names', () => {
  it('keeps server item names in blocked-task inventory evidence without relabeling ordinary heads', () => {
    const { bot, backpack } = botWithItems();
    const plain = new Item(registry.itemsByName.player_head.id, 1);
    bot.inventory.items = () => [plain, backpack];
    const text = bagNow(bot as never);
    expect(text).toContain('大背包×1');
    expect(text).toContain('玩家头×1');
  });
  it.each([
    { customName: '§e大背包§r' },
    { components: [{ type: 'minecraft:custom_name', data: JSON.stringify({ text: '大背包' }) }] },
    { componentMap: new Map([['item_name', { data: { text: '大背包' } }]]) },
    { customName: '', componentMap: new Map([['custom_name', { data: { text: '大背包' } }]]) },
    { customName: '§r', components: [{ type: 'item_name', data: { text: '大背包' } }] },
    { nbt: { type: 'compound', value: { display: { type: 'compound', value: {
      Name: { type: 'string', value: JSON.stringify({ text: '大', extra: [{ text: '背包' }] }) },
    } } } } },
  ])('reads modern or legacy instance text and removes formatting', item => {
    expect(itemCustomName(item)).toBe('大背包');
  });

  it('reads real prismarine-item components and keeps the registry identity separate', () => {
    const item = namedItem('player_head', '大背包');
    expect(item.displayName).toBe('Player Head');
    expect(itemCustomName(item)).toBe('大背包');
    expect(item.name).toBe('player_head');
    const plain = new Item(registry.itemsByName.player_head.id, 1);
    expect(itemCustomName(plain)).toBeNull();
  });

  it('carries names from actual slot items through world and bag context', () => {
    const { bot } = botWithItems();
    const snapshot = snapshotFromBot(bot, { scanBlocks: false });
    expect(snapshot.heldItem).toBe('diamond_sword');
    expect(snapshot.heldItemDisplayName).toBe('星灯誓约');
    expect(snapshot.equipment).toEqual(expect.arrayContaining([
      expect.objectContaining({ slot: 'offhand', name: 'player_head', displayName: '大背包' }),
      expect.objectContaining({ slot: 'head', name: 'iron_helmet', displayName: '巡林者头盔' }),
    ]));
    for (const text of [narrateWorld(snapshot), renderBagReadout(snapshot)]) {
      expect(text).toContain('副手大背包');
      expect(text).toContain('头巡林者头盔');
      expect(text).toContain('手里拿着星灯誓约');
      expect(text).toContain('远行卷轴×2');
      expect(text).not.toContain('副手玩家头');
    }
    expect(renderBagReadout(snapshot)).toContain('diamond_sword');
    expect(renderStoredItemReadout(snapshot, [], '大背包')).toContain('随身大背包×1');
    expect(renderStoredItemReadout(snapshot, [], '大背包')).toContain('player_head');
  });

  it('invalidates equipment and hand context when only the instance name changes', () => {
    const { bot } = botWithItems();
    const before = snapshotFromBot(bot, { scanBlocks: false });
    bot.inventory.slots[45] = namedItem('player_head', '旅行背包');
    bot.heldItem = namedItem('diamond_sword', '旅途之剑');
    const after = snapshotFromBot(bot, { scanBlocks: false });
    expect(snapshotFingerprint(after)).not.toBe(snapshotFingerprint(before));
    expect(bagStamp(after)).not.toBe(bagStamp(before));
    for (const key of ['equip', 'gear']) {
      expect(narrateWorldSegments(after).find(segment => segment.key === key)?.cmp)
        .not.toBe(narrateWorldSegments(before).find(segment => segment.key === key)?.cmp);
    }
  });

  it('keeps differently named or worn stacks distinct in container receipts and storage', () => {
    const first = namedItem('player_head', '大背包');
    const second = namedItem('player_head', '收藏猫头');
    const sword = namedItem('diamond_sword', '星灯誓约');
    const wornSword = namedItem('diamond_sword', '星灯誓约');
    wornSword.componentMap.set('damage', { type: 'damage', data: 10 });
    const contents = containerStacks({ containerItems: () => [first, second, sword, wornSword], inventoryStart: 27 });
    expect(contents.items).toHaveLength(4);
    expect(contents.items.filter(item => item.name === 'player_head').map(item => item.displayName))
      .toEqual(['大背包', '收藏猫头']);
    expect(new Set(contents.items.filter(item => item.name === 'diamond_sword').map(item => item.durability?.left)).size).toBe(2);
    expect(slotStack({ slots: [first] }, 0)).toMatchObject({ name: 'player_head', displayName: '大背包' });
    const { bot } = botWithItems();
    const snapshot = snapshotFromBot(bot, { scanBlocks: false });
    expect(renderStoredItemReadout(snapshot, [], '收藏猫头', { title: '箱子', items: contents.items }))
      .toContain('收藏猫头×1（现读）');
  });

  it('preserves names in dropped items and inventory quantity changes', () => {
    const { bot, backpack, scroll } = botWithItems();
    const dropped = droppedStackOf({ name: 'item', getDroppedItem: () => backpack });
    expect(dropped).toEqual({ name: 'player_head', count: 1, displayName: '大背包' });
    const snapshot = snapshotFromBot(bot, { scanBlocks: false });
    const drops = [dropped!, { name: 'player_head', displayName: '收藏猫头', count: 2 }]
      .map(item => ({ name: 'item', kind: 'other' as const, distance: 1, dy: 0,
        direction: null, visible: true, item }));
    const scene = narrateWorld({ ...snapshot, entities: drops });
    expect(scene).toContain('大背包×1');
    expect(scene).toContain('收藏猫头×2');
    expect(scene).not.toContain('玩家头×3');
    const before = { ...snapshot, inventory: [] };
    expect(worldDelta(before, snapshot, 24).notes.join(' ')).toContain('远行卷轴×2');
    expect(worldDelta(snapshot, before, 24).notes.join(' ')).toContain('远行卷轴×2');
    const renamed = { ...snapshot, inventory: snapshot.inventory.map(item => ({ ...item, displayName: '新名字' })) };
    expect(worldDelta(snapshot, renamed, 24).notes).toEqual([]);
    expect(scroll.name).toBe('paper');
  });

  it('uses instance text in action receipts and still selects by registry ID', async () => {
    const { bot, backpack } = botWithItems();
    expect(askedLabel(bot as never, 'player_head', undefined, backpack)).toBe('大背包');
    expect(invItemNamed(bot as never, 'player_head')).toBe(backpack);
    expect(invItemNamed(bot as never, '大背包')).toBe(backpack);
    expect(potionText(namedItem('potion', '探险补给'))).toContain('探险补给');
    expect(await skillEquip(bot as never, { skill: 'equip', item: 'player_head', hand: 'off' }))
      .toBe('大背包本来就挂在副手');
  });
});
