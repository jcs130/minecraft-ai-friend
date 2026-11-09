import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import type { Bot } from 'mineflayer';
import type { SkillContext } from '../core/skill-context.ts';
import { assessScaffoldMaterials } from '../core/scaffold-material.ts';
import { scaffoldNames, permittedStockFor } from '../core/placement.ts';
import { defaultPolicy, FALLBACK_DEFAULTS, renderPolicy, renderPolicyEnv } from '../core/policy.ts';

const require = createRequire(import.meta.url);
const registry = createRequire(require.resolve('mineflayer'))('prismarine-registry')('1.21.1') as Bot['registry'];
function rig(scaffold: string[]) {
  const settings = { ...defaultPolicy(), scaffold };
  const ctx = { policy: { get: () => settings, defaults: () => FALLBACK_DEFAULTS } } as unknown as SkillContext;
  const bot = { registry, inventory: { items: () => [{ name: 'dirt', count: 12 }] } } as unknown as Bot;
  return { settings, ctx, bot };
}
it('reports unsupported configured scaffold distinctly from disabled placement, with actual inventory candidates', () => {
  const { settings, ctx, bot } = rig(['scaffolding']);
  expect(scaffoldNames(ctx, bot)).toBeNull();
  for (const text of [renderPolicy(settings, FALLBACK_DEFAULTS, false, [], registry), renderPolicyEnv(settings, false, [], registry)]) {
    expect(text).toContain('已配置但无可执行材料');
    expect(text).toContain('scaffolding');
    expect(text).not.toContain('仍走');
  }
  const result = permittedStockFor(bot, scaffoldNames(ctx, bot), '垫脚', ctx);
  expect(result.why).toContain('不是地形不可达或设置关闭');
  expect(result.why).toContain('dirt');
  expect(bot.inventory.items()[0].count).toBe(12);
  expect(settings.scaffold).toEqual(['scaffolding']);
});
it('keeps explicit disable and unverified offline configuration separate', () => {
  const { settings, ctx, bot } = rig([]);
  expect(permittedStockFor(bot, scaffoldNames(ctx, bot), '垫脚', ctx).why).toContain('设置里关了');
  expect(renderPolicyEnv(settings)).toContain('不垫脚');
  expect(renderPolicyEnv(rig(['scaffolding']).settings)).toContain('尚未核验');
});
it('shares normalized material assessment without adding unauthorized fallback', () => {
  expect(assessScaffoldMaterials(['minecraft:dirt', 'dirt', 'sand', 'scaffolding', 'missing'], registry).accepted).toEqual(['dirt']);
  expect(assessScaffoldMaterials(['missing'], registry).accepted).toEqual([]);
  const { ctx, bot } = rig(['minecraft:dirt', 'scaffolding']);
  expect(scaffoldNames(ctx, bot)).toEqual(['dirt']);
});
