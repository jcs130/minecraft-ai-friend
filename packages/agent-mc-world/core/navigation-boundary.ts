import type { Bot } from 'mineflayer';
import type { goals } from 'mineflayer-pathfinder';
import type { MinecraftLog } from './log.ts';
import { readWorldIdentity } from './world-scope.ts';

type Point = { x: number; y: number; z: number };
export interface NavigationBoundaryFailure {
  sequence: number;
  goal: goals.Goal;
  kind: 'position-discontinuity' | 'respawn';
  from: Point | null;
  to: Point | null;
  world: string | null;
  reason: string;
}
const failures = new WeakMap<object, NavigationBoundaryFailure>();
const installed = new WeakMap<object, () => void>();
export const navigationBoundaryFailureOf = (bot: object): NavigationBoundaryFailure | null => failures.get(bot) ?? null;
const point = (bot: Bot): Point | null => {
  const p = bot.entity?.position;
  return p && [p.x, p.y, p.z].every(Number.isFinite) ? { x: p.x, y: p.y, z: p.z } : null;
};
const label = (p: Point): string => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;

/** Invalidate a physical route when its coordinate frame no longer applies.
 * Observe the native position packet before and after Mineflayer applies relative
 * flags, rather than polling motion or waiting for forcedMove (delayed at respawn).
 * Small server corrections are not teleports. No destination/terrain blacklist,
 * automatic retry, world alias, model request or server command is introduced.
 */
export function installNavigationBoundaryGuard(bot: Bot, diag?: MinecraftLog): () => void {
  const existing = installed.get(bot);
  if (existing) return existing;
  const client = bot._client;
  if (!client?.prependListener || !client?.on) return () => {};
  let before: Point | null = null;
  let disposed = false;
  const invalidate = (kind: NavigationBoundaryFailure['kind'], from: Point | null, to: Point | null) => {
    const goal = bot.pathfinder?.goal;
    if (disposed || !goal) return;
    const reason = kind === 'respawn'
      ? '收到服务器重生或世界切换包，原寻路的坐标环境已失效；已释放旧路径。先核实当前世界和落点，再决定如何继续原目标。'
      : `服务器将位置从 ${label(from!)} 改到 ${label(to!)}，位移 ${Math.hypot(to!.x - from!.x, to!.y - from!.y, to!.z - from!.z).toFixed(1)} 格；旧路径已失效并释放。可能经过传送门或被服务器传送，先核实落点与原目标，不把它当跳跃失败或原路不可达。`;
    const failure: NavigationBoundaryFailure = { sequence: (failures.get(bot)?.sequence ?? 0) + 1,
      goal, kind, from, to, world: readWorldIdentity(bot).key, reason };
    failures.set(bot, failure); // Publish before setGoal emits the goto rejection.
    diag?.write({ lane: 'path', event: 'navigation-boundary', msg: reason,
      data: { sequence: failure.sequence, kind, from, to, world: failure.world }, incident: true });
    // This clears the pinned plugin's path, A* frontier, return point and controls.
    // stop() is deferred and can stop a replacement goal instead.
    bot.pathfinder.setGoal(null);
  };
  const capture = () => { before = point(bot); };
  const applied = () => {
    const from = before, to = point(bot); before = null;
    if (from && to && Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) >= 8)
      invalidate('position-discontinuity', from, to);
  };
  const respawn = () => { before = null; invalidate('respawn', point(bot), null); };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    client.off('position', capture); client.off('position', applied); client.off('respawn', respawn);
    bot.off('end', dispose); installed.delete(bot); failures.delete(bot);
  };
  client.prependListener('position', capture);
  client.on('position', applied);
  client.on('respawn', respawn);
  bot.once('end', dispose);
  installed.set(bot, dispose);
  return dispose;
}
