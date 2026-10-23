import { describe, expect, it, vi } from 'vitest';
import { methodHarness } from './method-harness.ts';
import { resolveFindTarget, skillFind, findBlockObservation, findObservedSummary } from '../core/skills-gather.ts';
import { zhName } from '../core/names.ts';

describe('ambiguous entity and item search names', () => {
  it('keeps live chicken search distinct from the chicken food item in all receipts', async () => {
    const r = methodHarness();
    let clock = Date.now();
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      Object.assign((r.world as any).bridge, { connected: true });
      expect(resolveFindTarget(r.bot as never, 'chicken')).toEqual({ ids: [], entityName: 'chicken' });
      const call = () => r.world.tools().find(t => t.name === 'mc_do')!.handler(
        { steps: [{ skill: 'find', target: 'chicken', distance: 32 }] }, { role: 'test', log: r.host.log });
      for (let n = 0; n < 3; n++) {
        const accepted = await call();
        const text = typeof accepted === 'string' ? accepted : accepted.text;
        expect(text).toContain('找鸡');
        expect(text).not.toContain('生鸡肉');
        await vi.waitFor(() => expect(r.exec.status().running).toBeNull(), { interval: 5, timeout: 1000 });
        const last = r.world.requestFacts()!.parts!.find(p => p.key === 'lastTask')!.text;
        expect(last).toContain('没看见鸡');
        expect(last).not.toContain('生鸡肉');
        clock += 21_000;
      }
      const retried = await call();
      expect(retried).not.toHaveProperty('failed');
      expect(retried).toMatchObject({ text: expect.stringContaining('搜索未命中鸡') });
      expect((retried as { text: string }).text).not.toContain('生鸡肉');
      await vi.waitFor(() => expect(r.exec.status().running).toBeNull(), { interval: 5, timeout: 1000 });
      expect(r.world.requestFacts()!.parts!.find(p => p.key === 'lastTask')!.text).toContain('没看见鸡');
      expect(zhName('chicken')).toBe('生鸡肉');
    } finally { now.mockRestore(); r.close(); }
  });
});


it('native full find schema advertises only implemented targets with actionable recovery', async () => {
  const r = methodHarness();
  try {
    const tool = r.world.tools().find(t => t.name === 'mc_do')!;
    expect(JSON.stringify(tool)).not.toContain('敌对生物类别写 hostile');
    expect(resolveFindTarget(r.bot as never, 'log').ids.length).toBeGreaterThan(0);
    expect(resolveFindTarget(r.bot as never, 'zombie')).toEqual({ ids: [], entityName: 'zombie' });
    for (const target of ['hostile', 'tree']) {
      expect(resolveFindTarget(r.bot as never, target)).toEqual({ ids: [], entityName: null });
      await expect(skillFind(r.bot as never, target, undefined, 32, {} as never)).rejects.toThrow(/mc_help.*find.*mc_knowledge/s);
    }
  } finally { r.close(); }
});

it('find drop-index receipts retain source coordinates without claiming visible apples or guaranteed loot',()=>{
 const r=methodHarness();try{
  const leaves=r.bot.registry.blocksByName.oak_leaves;
  expect(resolveFindTarget(r.bot as never,'apple').ids).toContain(leaves.id);
  const source=findBlockObservation(r.bot as never,'apple',leaves.name);
  expect(source.what).toContain('橡木树叶');expect(source.what).toContain('不保证产出');expect(source.sourceItem).toBe('apple');
  const hit={x:1,y:64,z:2,entity:false,...source};
  expect(findObservedSummary([hit],'苹果')).toContain('不是苹果数量');
  expect(findObservedSummary([hit],'苹果')).not.toBe('1 处苹果');
  const exact=findBlockObservation(r.bot as never,'oak_log','oak_log');
  expect(exact).toEqual({what:'橡木原木'});
  expect(findObservedSummary([{...hit,...exact,sourceItem:undefined}],'橡木原木')).toBe('1 处橡木原木');
 }finally{r.close()}
});
