import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import { afterEach, expect, it, vi } from 'vitest';
import { skillTrade } from '../core/skills-gather.ts';
import { skillMenuClick } from '../core/skills-menu.ts';
import type { SkillContext } from '../core/skill-context.ts';

const req = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const inject = req('./lib/plugins/villager.js');
const registry = req('prismarine-registry')('1.21.1');
afterEach(() => vi.useRealTimers());

function fixture(kind = 'minecraft:generic_9x5') {
  vi.useFakeTimers();
  const menu = Object.assign(new EventEmitter(), { id: 7, type: kind, title: 'Equipment catalog',
    inventoryStart: 45, inventoryEnd: 81, slots: Array(81).fill(null), trades: null as any });
  menu.slots[13] = { name: 'arrow', count: 1, customName: '查看箭矢', slot: 13 };
  const entity = { id: 9, name: 'villager', entityType: registry.entitiesByName.villager.id,
    position: new Vec3(1, 64, 0), height: 1.9, isValid: true };
  let aborted = false;
  const bot = Object.assign(new EventEmitter(), { registry, entities: { 9: entity },
    entity: { position: new Vec3(0, 64, 0), eyeHeight: 1.62 }, world: { raycast: () => null },
    inventory: { items: () => [], slots: Array(46).fill(null) }, currentWindow: null as any,
    _client: new EventEmitter(), supportFeature: (feature: string) => registry.supportFeature(feature),
    openEntity: vi.fn(async () => { bot.currentWindow = menu; bot.emit('windowOpen', menu); return menu; }),
    closeWindow: vi.fn((win: any) => { if (bot.currentWindow === win) bot.currentWindow = null; win.emit('close'); }),
    clickWindow: vi.fn(async () => { bot.closeWindow(menu); }),
  });
  inject(bot, { version: '1.21.1' });
  const preserved = () => undefined; bot._client.on('trade_list', preserved);
  const ctx = { aborted: () => aborted } as SkillContext;
  return { bot: bot as unknown as Bot, raw: bot, menu, ctx, entity, abort: () => { aborted = true; }, preserved };
}

it('retains the actual plugin window rejected by Mineflayer openVillager and permits a later menu step', async () => {
  const h = fixture();
  const result = await skillTrade(h.bot, { target: 'villager', entityId: 9 }, h.ctx);
  expect(result).toContain('Equipment catalog');
  expect(result).toContain('#13');
  expect(result).toContain('未成交');
  expect(h.raw.currentWindow).toBe(h.menu);
  expect(h.raw.closeWindow).not.toHaveBeenCalled();
  expect(h.raw._client.listeners('trade_list')).toEqual([h.preserved]);
  await expect(skillMenuClick(h.bot, { skill: 'menu_click', slot: 13 }, h.ctx)).resolves.toContain('点了菜单');
  expect(h.raw.clickWindow).toHaveBeenCalledWith(13, 0, 0);
});

it('does not reinterpret a vanilla trade index as a plugin button click', async () => {
  const h = fixture();
  await expect(skillTrade(h.bot, { target: 'villager', index: 13 }, h.ctx)).rejects.toMatchObject({
    decision: { next_safe_read: { tool: 'mc_window', arguments: {} } },
  });
  expect(h.raw.currentWindow).toBe(h.menu);
  expect(h.raw.clickWindow).not.toHaveBeenCalled();
  expect(h.raw._client.listeners('trade_list')).toEqual([h.preserved]);
});

it('closes the newly opened menu on cancellation and clears only its trade listeners', async () => {
  const h = fixture();
  h.raw.openEntity.mockImplementationOnce(async () => { h.raw.currentWindow = h.menu; h.abort(); return h.menu; });
  await expect(skillTrade(h.bot, { target: 'villager' }, h.ctx)).rejects.toThrow('aborted');
  expect(h.raw.currentWindow).toBeNull();
  expect(h.raw._client.listeners('trade_list')).toEqual([h.preserved]);
});

it('does not claim or close a pre-existing window when the entity interaction fails', async () => {
  const h = fixture(); h.raw.currentWindow = h.menu;
  h.raw.openEntity.mockRejectedValueOnce(new Error('interaction failed'));
  await expect(skillTrade(h.bot, { target: 'villager' }, h.ctx)).rejects.toThrow('没打开原版村民报价窗口');
  expect(h.raw.currentWindow).toBe(h.menu);
  expect(h.raw.closeWindow).not.toHaveBeenCalled();
  expect(h.raw._client.listeners('trade_list')).toEqual([h.preserved]);
});

it('keeps native merchant quotation behavior and closes its completed read window', async () => {
  const h = fixture('minecraft:merchant');
  setTimeout(() => { h.menu.trades = [{ inputItem1: { name: 'emerald', count: 1 }, hasItem2: false,
    outputItem: { name: 'arrow', count: 16 }, tradeDisabled: false, nbTradeUses: 0, maximumNbTradeUses: 12 }];
    h.menu.emit('ready'); }, 1);
  const result = skillTrade(h.bot, { target: 'villager' }, h.ctx);
  await vi.advanceTimersByTimeAsync(10);
  expect(await result).toContain('报价:1号');
  expect(h.raw.currentWindow).toBeNull();
  expect(h.raw._client.listeners('trade_list')).toEqual([h.preserved]);
});
