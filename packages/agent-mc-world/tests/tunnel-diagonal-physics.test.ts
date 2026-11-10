import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { afterEach, expect, it, vi } from 'vitest';
import type { TaskReport } from '../core/executor.ts';
import { installPathfinderPerf } from '../core/pathfinder-perf.ts';
import { methodHarness } from './method-harness.ts';

afterEach(() => vi.useRealTimers());

it.each([
  { version: '1.21.1', x: 3, z: 3 }, { version: '1.20.6', x: 3, z: 3 },
  { version: '1.21.1', x: -3, z: 3 }, { version: '1.21.1', x: 3, z: -3 },
  { version: '1.21.1', x: -3, z: -3 },
])('digs and physically walks a diagonal tunnel without leaving impassable corners on $version ($x,$z)', async ({ version, x, z }) => {
  vi.useFakeTimers();
  const h = methodHarness(version), bot = h.bot as unknown as Bot, reports: TaskReport[] = [];
  const dug: string[] = [];
  try {
    for (let bx = -6; bx <= 6; bx++) for (let bz = -6; bz <= 6; bz++) {
      for (let y = 64; y <= 67; y++) h.set(bx, y, bz, 'dirt');
    }
    h.set(0, 64, 0, 'air'); h.set(0, 65, 0, 'air');
    Object.assign(h.bot, {
      supportFeature: (name: string) => h.bot.registry.supportFeature(name),
      getControlState: (key: string) => h.keys[key], isAlive: true,
      canDigBlock: () => true, digTime: () => 100,
      dig: vi.fn(async (block: { position: { x: number; y: number; z: number } }) => {
        const p = block.position;
        dug.push(`${p.x},${p.y},${p.z}`); h.set(p.x, p.y, p.z, 'air');
      }), placeBlock: vi.fn(() => { throw Error('Unexpected placement'); }),
    });
    Object.assign(h.bot.game, { minY: -64, height: 384 });
    Object.assign(h.bot.world, { getBlockStateId: (at: any) => h.bot.blockAt(at).stateId, getColumn: () => ({}) });
    pathfinderPkg.pathfinder(bot); installPathfinderPerf();
    const movements = new pathfinderPkg.Movements(bot);
    movements.canDig = false; movements.allowParkour = false;
    movements.allow1by1towers = false; movements.scafoldingBlocks = [];
    bot.pathfinder.setMovements(movements); bot.pathfinder.tickTimeout = 20; bot.pathfinder.thinkTimeout = 1000;
    Object.assign((h.exec as any).opts, { report: (r: TaskReport) => reports.push(r), fleeHealth: () => 0 });
    expect(h.exec.submitDetailed([{ skill: 'tunnel', at: [x, 64, z] }]).accepted).toBe(true);
    for (let i = 0; i < 1200 && !reports.length; i++) await vi.advanceTimersByTimeAsync(50);
    const detail = JSON.stringify({ position: h.bot.entity.position, report: reports[0]?.text, dug });
    expect(reports[0]?.kind, detail).toBe('done');
    expect(Math.floor(h.bot.entity.position.x), detail).toBe(x);
    expect(Math.floor(h.bot.entity.position.z), detail).toBe(z);
    expect(h.bot.placeBlock).not.toHaveBeenCalled();
  } finally { h.close(); }
}, 30000);
