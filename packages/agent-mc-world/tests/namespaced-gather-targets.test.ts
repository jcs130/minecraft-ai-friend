import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { matchBlockIds } from '../core/travel.ts';
import { findBlockObservation, resolveFindTarget, skillCollect } from '../core/skills-gather.ts';
import type { SkillContext } from '../core/skill-context.ts';

const require = createRequire(import.meta.url);
describe.each(['1.21.1', '1.20.6'])('registry gathering targets (%s)', version => {
  const registry = require('minecraft-data')(version);
  const bot = { registry } as Bot;
  it('accepts the vanilla resource ID used by scripts without changing source-block matching', () => {
    for (const name of ['dirt', 'carrots', 'oak_log', 'cobblestone', 'flint']) {
      expect(matchBlockIds(bot, `minecraft:${name}`)).toEqual(matchBlockIds(bot, name));
    }
    expect(matchBlockIds(bot, 'minecraft:oak_log')).not.toContain(registry.blocksByName.stripped_oak_log.id);
  });
  it('does not turn foreign IDs or nonexistent resource IDs into vanilla categories', () => {
    expect(matchBlockIds(bot, 'custom:dirt')).toEqual([]);
    expect(matchBlockIds(bot, 'minecraft:log')).toEqual([]);
    expect(matchBlockIds(bot, 'log')).toContain(registry.blocksByName.oak_log.id);
  });
  it('keeps exact block/entity identity and source-item uncertainty', () => {
    expect(resolveFindTarget(bot, 'minecraft:dirt')).toEqual(resolveFindTarget(bot, 'dirt'));
    expect(resolveFindTarget(bot, 'minecraft:zombie')).toEqual({ ids: [], entityName: 'zombie' });
    expect(findBlockObservation(bot, 'minecraft:dirt', 'dirt')).toEqual(findBlockObservation(bot, 'dirt', 'dirt'));
    expect(findBlockObservation(bot, 'minecraft:flint', 'gravel')).toMatchObject({ sourceItem: 'flint' });
  });
  it('retains the processed-log safeguard when its ID is namespaced', async () => {
    await expect(skillCollect(bot, 'minecraft:stripped_oak_log', 1, {} as SkillContext)).rejects.toThrow('去皮原木是加工过的建筑材料');
  });
});
