import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import { skillAnvil } from '../core/skills-interact.ts';
import { parseSteps } from '../core/skills.ts';
import { itemCustomName } from '../core/item-display.ts';

const station = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../core/containers.ts', async (original) => ({
  ...await original<typeof import('../core/containers.ts')>(),
  openStationWindow: station.open,
}));
const dependency = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = dependency('prismarine-registry')('1.21.1');
const Item = dependency('prismarine-item')(registry);
afterEach(() => { vi.useRealTimers(); station.open.mockReset(); });

function rig(produce = true, take = true) {
  vi.useFakeTimers();
  const main = new Item(registry.itemsByName.iron_sword.id, 1);
  main.componentMap.set('custom_name', { type: 'custom_name', data: { text: '旅途之剑', color: 'gold', italic: false } });
  main.componentMap.set('damage', { type: 'damage', data: 210 });
  main.componentMap.set('custom_data', { type: 'custom_data', data: { owner: 'fixture-player', special: 'keep-opaque' } });
  const spare = new Item(main.type, 1);
  spare.componentMap.set('damage', { type: 'damage', data: 80 });
  const inputs = [main, spare];
  const slots = Array(39).fill(null);
  main.slot = 3; spare.slot = 4; slots[3] = main; slots[4] = spare;
  const win = { id: 7, type: 'minecraft:anvil', slots, inventoryStart: 3, inventoryEnd: 39,
    items: () => slots.slice(3).filter(Boolean) };
  const client = Object.assign(new EventEmitter(), { write: vi.fn((_packet: string, data: { name: string }) => {
    if (slots[2]) slots[2].componentMap.set('custom_name', { type: 'custom_name', data: { text: data.name } });
  }) });
  let opened = false;
  const bot = {
    registry, version: '1.21.1', _client: client, experience: { level: 30 },
    entity: { position: new Vec3(.5, 64, .5) },
    inventory: { items: () => opened ? win.items() : inputs },
    blockAt: () => ({ name: 'anvil' }),
    moveSlotItem: vi.fn(async (from: number, to: number) => {
      slots[to] = slots[from]; slots[from] = null;
      if (produce && slots[0] && slots[1]) {
        const out = new Item(main.type, 1);
        out.componentMap = new Map(slots[0].componentMap);
        out.componentMap.set('damage', { type: 'damage', data: 10 });
        slots[2] = out;
      }
    }),
    clickWindow: vi.fn(async () => {
      if (!take) return;
      const dest = slots.findIndex((it, i) => i >= 3 && it === null);
      slots[dest] = slots[2]; slots[2] = null; slots[0] = null; slots[1] = null;
      bot.experience.level -= 3;
    }),
    closeWindow: vi.fn(),
  };
  station.open.mockImplementation(async () => { opened = true; return { win, blockName: 'anvil' }; });
  return { bot, win, main, spare, client };
}

const call = { skill: 'anvil', op: 'repair', item: 'iron_sword', pick: '旅途之剑',
  with: 'iron_sword', at: [0, 64, 0] } as const;
const context = { aborted: () => false };

it('repairs a named component item without rewriting its name or opaque attributes', async () => {
  const r = rig();
  const componentsBefore = new Map(r.main.componentMap);
  const pending = skillAnvil(r.bot as never, call as never, context as never);
  await vi.runAllTimersAsync();
  const text = await pending;
  expect(r.bot.moveSlotItem.mock.calls).toEqual([[3, 0], [4, 1]]);
  expect(r.client.write).not.toHaveBeenCalled();
  expect(r.main.componentMap).toEqual(componentsBefore);
  const out = r.win.items()[0];
  expect(itemCustomName(out)).toBe('旅途之剑');
  expect(out.componentMap.get('custom_data')).toEqual(componentsBefore.get('custom_data'));
  expect(text).toContain('产物旅途之剑');
  expect(text).toContain('耐久 240/250');
  expect(text).toContain('花了 3 级');
});

it('accepts the exact displayed item name as well as its registry ID', async () => {
  const r = rig();
  const pending = skillAnvil(r.bot as never, { ...call, item: '旅途之剑', pick: undefined } as never, context as never);
  await vi.runAllTimersAsync();
  expect(await pending).toContain('产物旅途之剑');
  expect(r.bot.moveSlotItem.mock.calls[0]).toEqual([3, 0]);
});

it('admits repair and rename in one operation and reports the actual server product', async () => {
  const r = rig();
  const parsed = parseSteps([{ ...call, name: '归途之剑' }]);
  expect(parsed).toHaveProperty('steps');
  if (!('steps' in parsed)) throw new Error(parsed.error);
  const pending = skillAnvil(r.bot as never, parsed.steps[0] as never, context as never);
  await vi.runAllTimersAsync();
  const text = await pending;
  expect(r.client.write).toHaveBeenCalledOnce();
  expect(r.client.write).toHaveBeenCalledWith('name_item', { name: '归途之剑' });
  expect(text).toContain('产物归途之剑');
  expect(r.main.componentMap.get('custom_name').data.color).toBe('gold');
});

it('does not treat overlapping selectors as two physical items', async () => {
  const r = rig();
  r.bot.inventory.items = () => [r.main];
  await expect(skillAnvil(r.bot as never, { ...call, withPick: '旅途' } as never, context as never))
    .rejects.toThrow('另一件');
  expect(station.open).not.toHaveBeenCalled();
  expect(r.bot.moveSlotItem).not.toHaveBeenCalled();
});

it('reports an absent server output as unknown rather than a named-item or vanilla prohibition', async () => {
  const r = rig(false);
  const result = skillAnvil(r.bot as never, call as never, context as never).catch(error => error);
  await vi.runAllTimersAsync();
  const error = await result;
  expect(error.message).toContain('当前服务端没有返回产物，具体原因未确认');
  expect(error.message).not.toContain('按原版做不出');
  expect(r.bot.clickWindow).not.toHaveBeenCalled();
  expect(r.bot.closeWindow).toHaveBeenCalledOnce();
  expect(r.client.listenerCount('craft_progress_bar')).toBe(0);
});

it('retains the actual name length contract for combined renames', () => {
  expect(parseSteps([{ ...call, name: 'x'.repeat(51) }])).toHaveProperty('error');
});

it('does not call an output preview a completed repair when the server did not deliver it', async () => {
  const r = rig(true, false);
  const result = skillAnvil(r.bot as never, call as never, context as never).catch(error => error);
  await vi.runAllTimersAsync();
  const error = await result;
  expect(error.message).toContain('未确认产物落进背包');
  expect(r.bot.closeWindow).toHaveBeenCalledOnce();
});
