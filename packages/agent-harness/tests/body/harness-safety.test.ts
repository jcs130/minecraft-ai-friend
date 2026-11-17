import { describe, expect, it } from 'vitest';
import { guardBody, HarnessRuntime } from '../../src/index.ts';
import { until } from '../helpers.ts';
import { mineflayerDriver } from './drivers.ts';

describe('harness + safety hooks', () => {
  it('a server anti-cheat warning pauses the running intent, stops the body and blocks further motion until cleared', async () => {
    const d = await mineflayerDriver();
    try {
      const body = guardBody(d.body);
      await body.spawn();
      const harness = new HarnessRuntime({ self: 'Komi' });
      harness.attachBody(body);
      const long = await harness.submitIntent({ goal: 'walk far', constraints: { steps: [{ tool: 'body:move', args: { x: 100, y: 64, z: 100 } }, { tool: 'body:move', args: { x: 200, y: 64, z: 200 } }] } });
      await until(() => harness.getIntent(long.intentId)!.state === 'active');
      await d.serverWarning(body, '[系统] 检测到你使用自动化模组，继续将被临时封禁');
      await until(() => harness.getIntent(long.intentId)!.state === 'paused');
      expect(harness.getIntent(long.intentId)!.reason).toMatch(/safety halt/);
      const ev = harness.pullEvents({ after: 0 }).events;
      expect(ev.some(e => e.kind === 'safety' && e.severity === 3)).toBe(true);
      expect(ev.find(e => e.kind === 'intent_state' && e.data?.state === 'paused')?.data?.needsHost).toBe(true);
      expect((await harness.getSummary()).text).toContain('安全停止中');
      expect((await body.act({ verb: 'move', args: { x: 1, y: 64, z: 1 } })).status).toBe('blocked_by_safety');
      await harness.close();
    } finally { await d.body.destroy().catch(() => {}); await d.close(); }
  });
});
