import { afterEach, describe, expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import { methodHarness } from './method-harness.ts';
import { renderQueue } from '../core/executor.ts';

const pending = vi.hoisted(() => ({ release: () => {} }));
vi.mock('../core/skills-interact.ts', async original => ({
  ...await original<typeof import('../core/skills-interact.ts')>(),
  skillUse: async () => { await new Promise<void>(resolve => { pending.release = resolve; }); return 'local fixture completed'; },
}));

const rigs: ReturnType<typeof methodHarness>[] = [];
afterEach(() => { for (const h of rigs.splice(0)) h.close(); vi.useRealTimers(); });
describe('task queue feet coordinates', () => {
  it.each([[49.7, 90, 149.7, 49, 90, 149], [-.1, 64.5, -439.5, -1, 64, -440]])(
    'keeps the same occupied cell in acceptance, queue and progress at %s,%s,%s', async (x, y, z, fx, fy, fz) => {
      vi.useFakeTimers();
      const h = methodHarness('1.21.1'); rigs.push(h);
      h.bot.physicsEnabled = false;
      h.bot.entity.position = new Vec3(x, y, z);
      const progress: Array<{ pos: unknown }> = [];
      (h.exec as any).opts.onProgress = (p: { pos: unknown }) => progress.push(p);
      h.exec.submit([{ skill: 'use', at: [fx, fy, fz] }], 'append');
      await vi.advanceTimersByTimeAsync(1);
      expect(h.exec.status().running?.pos).toEqual({ x: fx, y: fy, z: fz });
      expect(renderQueue(h.exec.status())).toContain(`(${fx}, ${fy}, ${fz})`);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(progress.length).toBeGreaterThan(0);
      expect(progress.every(p => JSON.stringify(p.pos) === JSON.stringify({ x: fx, y: fy, z: fz }))).toBe(true);
      pending.release(); await vi.advanceTimersByTimeAsync(1);
    });
});
