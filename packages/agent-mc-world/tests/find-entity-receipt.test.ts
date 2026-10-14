import { describe, expect, it, vi } from 'vitest';
import { methodHarness } from './method-harness.ts';
import { resolveFindTarget } from '../core/skills-gather.ts';
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
        clock += 21_000; // Stay outside the separate three-in-20s navigation guard.
      }
      const refused = await call();
      expect(refused).toMatchObject({ failed: true, text: expect.stringContaining('没找到鸡') });
      expect((refused as { text: string }).text).not.toContain('生鸡肉');
      expect(zhName('chicken')).toBe('生鸡肉');
    } finally { now.mockRestore(); r.close(); }
  });
});
