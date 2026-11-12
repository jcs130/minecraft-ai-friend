import '../core/dependency-patches.ts';
import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import pathfinder from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { expect, it, vi } from 'vitest';
import { installNavigationBareHand } from '../core/hand-interaction.ts';
import { installDoorWaypointRepair } from '../core/path-waypoints.ts';
import { installPathfinderPerf } from '../core/pathfinder-perf.ts';
import type { TaskReport } from '../core/executor.ts';
import { methodHarness } from './method-harness.ts';

const require = createRequire(createRequire(import.meta.url).resolve('mineflayer'));

it.each([
  { hinge: 'left', serverUpdates: true },
  { hinge: 'right', serverUpdates: true },
  { hinge: 'right', serverUpdates: false },
])('handles a one-block corner with $hinge hinge and server updates $serverUpdates', async ({ hinge, serverUpdates }) => {
  vi.useFakeTimers();
  const harness = methodHarness('1.21.1');
  const bot = harness.bot as unknown as Bot;
  try {
    const Blocks = require('prismarine-block')(bot.registry);
    const door = bot.registry.blocksByName.spruce_door;
    const states = Array.from({ length: door.maxStateId - door.minStateId + 1 },
      (_, offset) => Blocks.fromStateId(door.minStateId + offset, 0));
    const initial = states.find(block => {
      const props = block.getProperties();
      return !props.open && props.half === 'lower' && props.hinge === hinge
        && block.shapes.some(shape => shape[2] === 13 / 16 && shape[5] === 1);
    });
    expect(initial).toBeDefined();
    const doorProps = initial.getProperties();
    let open = false;
    const baseBlockAt = bot.blockAt.bind(bot);
    const blockAt = (at: Vec3) => {
      const position = at.floored();
      if (position.x !== 0 || position.z !== 0 || (position.y !== 64 && position.y !== 65)) return baseBlockAt(at);
      const half = position.y === 64 ? 'lower' : 'upper';
      const state = states.find(block => {
        const props = block.getProperties();
        return props.half === half && props.open === open && props.facing === doorProps.facing && props.hinge === doorProps.hinge;
      });
      const block = Blocks.fromStateId(state.stateId, 0);
      block.position = position;
      return block;
    };
    bot.blockAt = blockAt;
    Object.assign(bot.game, { minY: -64, height: 384 });
    Object.assign(bot.world, { getBlock: blockAt, getBlockStateId: (pos: Vec3) => blockAt(pos)!.stateId, getColumn: () => ({}) });
    bot.entity.position = new Vec3(-0.5, 64, -0.5);
    const passage = new Set(['-1,-1', '0,-1', '0,0', '1,0', '2,0', '3,0', '4,0']);
    for (let x = -2; x <= 5; x++) {
      for (let z = -2; z <= 1; z++) {
        if (passage.has(`${x},${z}`)) continue;
        harness.set(x, 64, z, 'stripped_spruce_log');
        harness.set(x, 65, z, 'stripped_spruce_log');
      }
    }
    const clicks: boolean[] = [];
    let sent = 0;
    bot.activateBlock = async () => {
      sent++;
      if (!serverUpdates) return;
      setTimeout(() => {
        const pos = new Vec3(0, 64, 0);
        const before = blockAt(pos)!;
        open = !open;
        clicks.push(open);
        bot.emit('blockUpdate', before, blockAt(pos)!);
      }, 100);
    };
    installPathfinderPerf();
    pathfinder.pathfinder(bot);
    Object.assign(bot.pathfinder.movements, { canDig: false, allowParkour: false,
      canOpenDoors: true, allow1by1towers: false, scafoldingBlocks: [] });
    installNavigationBareHand(bot);
    installDoorWaypointRepair(bot);
    const reports: TaskReport[] = [];
    (harness.exec as any).opts.report = (report: TaskReport) => reports.push(report);
    (harness.exec as any).opts.fleeHealth = () => 0;
    const resets: string[] = [];
    bot.on('path_reset', reason => resets.push(reason));
    harness.exec.submit([{ skill: 'goto', at: [4, 64, 0], walkOnly: true }], 'append');
    if (!serverUpdates) {
      harness.exec.submit([{ skill: 'chat', text: 'queued recovery' }], 'append');
      await vi.advanceTimersByTimeAsync(2_500);
      expect(sent).toBe(1);
      expect(reports[0]?.text).toMatch(/未确认打开/);
      expect(harness.said).toEqual(['queued recovery']);
      expect(bot.pathfinder.goal).toBeNull();
      return;
    }
    await vi.advanceTimersByTimeAsync(7_000);
    expect(bot.entity.position.x, JSON.stringify({ position: bot.entity.position, clicks, resets, reports })).toBeGreaterThanOrEqual(3);
    expect(clicks).toEqual([true, false]);
    expect(sent).toBe(2);
    expect(resets).not.toContain('stuck');
    expect(reports.some(report => report.text.includes('任务#1完成'))).toBe(true);
  } finally {
    harness.close();
    bot.emit('end', 'fixture');
    vi.useRealTimers();
  }
});
