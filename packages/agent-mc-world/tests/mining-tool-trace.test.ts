import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { recordToolChoice, toolTraceNote } from '../core/tools.ts';
import type { SkillContext } from '../core/skill-context.ts';

const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const Item = require('prismarine-item')('1.20.6');
const registry = require('minecraft-data')('1.20.6');

function item(left: number, title?: string, efficiency?: number) {
  const components: unknown[] = [{ type: 'damage', data: 131 - left }];
  if (title) components.push({ type: 'custom_name', data: { type: 'compound', value: {
    text: { type: 'string', value: title },
  } } });
  if (efficiency) components.push({ type: 'enchantments', data: {
    enchantments: [{ id: registry.enchantmentsByName.efficiency.id, level: efficiency }],
  } });
  return Item.fromNotch({ itemCount: 1, itemId: registry.itemsByName.stone_pickaxe.id,
    addedComponentCount: components.length, removedComponentCount: 0, removeComponents: [], components });
}

function traceRig() {
  const bot = { registry } as Bot;
  const ctx = { toolTrace: { last: undefined, notes: [], near: new Set<string>() } } as unknown as SkillContext;
  const select = (pick: ReturnType<typeof item>) => recordToolChoice(bot, ctx, 'stone',
    { mode: 'exact', item: 'stone_pickaxe' }, { pick, canDrop: true, need: null, error: null });
  return { ctx, select };
}

describe('mining tool receipt identity', () => {
  it('keeps a worn tool as one selection and retains the observed durability range', () => {
    const { ctx, select } = traceRig();
    for (let left = 97; left >= 58; left--) select(item(left));
    const receipt = toolTraceNote(ctx.toolTrace);
    expect(receipt.match(/本步临时指定/g)).toHaveLength(1);
    expect(receipt).toContain('97→58/131');
    expect(receipt.length).toBeLessThan(180);
  });

  it('reports entering low durability once while retaining later readings', () => {
    const { ctx, select } = traceRig();
    for (let left = 7; left >= 1; left--) select(item(left));
    const receipt = toolTraceNote(ctx.toolTrace);
    expect(receipt.match(/临近损坏/g)).toHaveLength(1);
    expect(receipt).toContain('7→1/131');
  });

  it('preserves actual name and enchantment changes when wear is omitted from identity', () => {
    const { ctx, select } = traceRig();
    select(item(100, '探路镐', 1));
    select(item(99, '探路镐', 1));
    select(item(100, '探路镐', 3));
    select(item(100, '采掘镐', 3));
    const receipt = toolTraceNote(ctx.toolTrace);
    expect(receipt.match(/本步临时指定/g)).toHaveLength(3);
    expect(receipt).toContain('探路镐');
    expect(receipt).toContain('采掘镐');
    expect(receipt).toContain('效率I');
    expect(receipt).toContain('效率III');
  });
});
