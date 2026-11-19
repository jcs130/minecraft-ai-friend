import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger } from '../src/client/index.ts';
import { MethodRunner } from '../core/method-runner.ts';
import { methodHarness } from './method-harness.ts';

describe('method sandbox timing receipts', () => {
  it('keeps the original action receipt when a later timer fails and can continue with an explicit tick wait', async () => {
    const rig = methodHarness();
    const mineflayer = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
    Object.assign(rig.bot, { supportFeature: (name: string) => rig.bot.registry.supportFeature(name) });
    mineflayer('./lib/plugins/physics.js')(rig.bot, { physicsEnabled: true });
    const dataDir = mkdtempSync(join(tmpdir(), 'mc-method-timer-'));
    const cfg = { ...structuredClone(MINECRAFT_CLIENT_DEFAULTS), host: 'fixture.invalid', username: 'TimerFixture' };
    const runtime = new MinecraftAgentClient({ cfg, dataDir, log: nullLogger() }, {
      id: 'fixture', start: async () => {}, stop: async () => {}, envPromptVars: () => ({}), tools: () => rig.world.tools(),
    });
    const script = (args: Record<string, unknown>) => runtime.call('mc_script', args);
    const code = 'await mc.do([{skill:"chat", text:"fixture marker"}]); await new Promise(resolve => setTimeout(resolve, 25));';
    try {
      await runtime.connect();
      await script({ code, validate: true, waitMs: 3000 });
      const validation = rig.runner.read().at(-1)!;
      expect(validation).toMatchObject({ status: 'validated', trace: [], result: { valid: true, scope: 'syntax-only', executed: false } });
      expect(rig.said).toEqual([]);

      const attempted = await script({ code, waitMs: 3000 });
      expect(attempted.failed).toBe(true);
      const failed = rig.runner.read().at(-1)!;
      const receipt = JSON.parse((await script({ runId: failed.id })).text);
      expect(receipt).toMatchObject({ status: 'failed', calls: 1, trace: [{ method: 'do', accepted: true, done: true }] });
      expect(receipt.error).toContain('await bot.waitForTicks(ticks)');
      expect(receipt.error).toContain(`{runId:${failed.id}}`);
      expect(receipt.error).toContain('不会随脚本失败回滚');
      await script({ runId: failed.id, call: 1 });
      expect(rig.said).toEqual(['fixture marker']);

      const help = await script({ api: 'waitForTicks' });
      expect(help.text).toContain('1..200');
      expect(help.text).toContain('setTimeout');
      const continued = await script({ code: 'await bot.waitForTicks(1); return 1;', waitMs: 3000 });
      expect(continued.failed, continued.text).not.toBe(true);
      expect(rig.runner.read().at(-1)).toMatchObject({ status: 'completed', result: 1 });
      expect(rig.said).toEqual(['fixture marker']);
    } finally {
      try { await runtime.disconnect(); } finally {
        rig.close();
        rmSync(dataDir, { recursive: true, force: true });
      }
    }
  });

  it('only suggests a tick wait when the host exports it', async () => {
    const runner = new MethodRunner({ onFinish() {}, call: () => { throw Error('Unexpected World call'); } });
    const { id } = runner.start({ code: 'setTimeout(() => {}, 10);' });
    await runner.wait(id, 3000);
    const [run] = runner.read(id);
    expect(run.status).toBe('failed');
    expect(run.error).toContain('setTimeout');
    expect(run.error).not.toContain('waitForTicks');
    expect(run.trace).toEqual([]);
  });
});
