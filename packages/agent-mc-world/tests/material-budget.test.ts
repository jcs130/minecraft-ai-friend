import { describe, expect, it } from 'vitest';
import { methodHarness } from './method-harness.ts';
import { precheckStep } from '../core/precheck.ts';

describe('mc_bag material planning on the existing tool', () => {
  it.each(['1.20.6', '1.21.1'])('keeps caller reserves distinct from player stock and tracks new observations on %s', async version => {
    const r = methodHarness(version);
    try {
      const tool = r.world.tools().find(t => t.name === 'mc_bag')!;
      const ctx = { role: 'test', log: r.host.log };
      const args = { requirements: [{ item: 'minecraft:quartz', required: 6, keep: 2 }, { item: 'stick', required: 3 }] };
      const current = [{ name: 'quartz', count: 5 }, { name: 'stick', count: 2 }];
      const bot = r.bot as any;
      bot.inventory.items = () => [{ name: 'quartz', count: 45 }];
      bot.currentWindow = { items: () => current, containerItems: () => [{ name: 'quartz', count: 64 }] };
      const before = r.exec.status();
      const read = async () => (await tool.handler(args, ctx) as any).data;
      expect((await read()).rows).toEqual([
        { item:'quartz', status:'observed', held:5, required:6, keep:2, spendable:3, missing:3 },
        { item:'stick', status:'observed', held:2, required:3, keep:0, spendable:2, missing:1 },
      ]);
      current[0]!.count++;
      expect((await read()).rows[0]).toMatchObject({ held:6, spendable:4, missing:2 });
      current[0]!.count = 1;
      expect((await read()).rows[0]).toMatchObject({ held:1, spendable:0, missing:6 });
      current.pop();
      expect((await read()).rows[1]).toMatchObject({ status:'observed', held:0, missing:3 });
      (r.world as any).bridge.invSynced = false;
      expect((await read()).rows[0]).toMatchObject({ status:'unobserved', held:null, spendable:null, missing:null });
      expect(r.exec.status()).toEqual(before);
    } finally { r.close(); }
  });

  it('distinguishes absent registry IDs and invalid requests from zero stock', async () => {
    const r = methodHarness('1.21.1');
    try {
      const tool = r.world.tools().find(t => t.name === 'mc_bag')!;
      const read = async (requirements: unknown) => await tool.handler({ requirements }, { role:'test', log:r.host.log }) as any;
      expect((await read([{ item:'made_up_fixture_ore', required:2 }])).data.rows[0]).toMatchObject({ status:'unknown-item', held:null, missing:null });
      for (const req of [[], [{ item:'stone', required:-1 }], [{ item:'stone', required:1, keep:0.5 }],
        [{ item:'stone', required:1 }, { item:'minecraft:stone', required:2 }]]) {
        expect((await read(req)).failed).toBe(true);
      }
    } finally { r.close(); }
  });

  it('computes a craft shortage for all requested output items after rounding to whole recipe batches', () => {
    const r = methodHarness('1.21.1');
    try {
      const bot = r.bot as any;
      bot.recipesAll = () => [{ result: { count:9 }, delta: [{ id:bot.registry.itemsByName.iron_ingot.id, count:-1 }] }];
      const note = precheckStep(bot, { skill:'craft', item:'iron_nugget', count:20 }, {} as never);
      expect(note).toMatchObject({ rule:'craft.short', level:'hard' });
      expect(note?.text).toContain('铁锭×3');
    } finally { r.close(); }
  });
});
