/** Await pathfinder terminal states, not its per-tick search yield.
 * The pinned pathfinder 2.4.5 goto wrapper resolves every empty path before
 * checking status, including an empty partial search. Use the public events
 * and preserve next-stack cleanup without modifying movement or physics.
 * Upstream event-wrapper reference: Karang, MIT, LICENSE-mineflayer-pathfinder.txt.
 */
import type { Bot } from 'mineflayer';
import type { goals } from 'mineflayer-pathfinder';

export function awaitPathGoal(bot: Bot, goal: goals.Goal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      bot.removeListener('path_update', update);
      bot.removeListener('goal_reached', reached);
      bot.removeListener('goal_updated', changed);
      bot.removeListener('path_stop', stopped);
      setTimeout(() => error ? reject(error) : resolve(), 0);
    };
    const failure = (name: string, message: string): void => {
      const error = new Error(message); error.name = name; finish(error);
    };
    const update = (result: { status: string; path: unknown[] }): void => {
      if (bot.pathfinder.goal !== goal) return;
      if (result.status === 'noPath') failure('NoPath', 'No path to the goal!');
      else if (result.status === 'timeout') failure('Timeout', 'Took too long to decide path to goal!');
      else if (result.status === 'success' && result.path.length === 0) finish();
      // partial, even with no executable prefix, is still an active search.
    };
    const reached = (actual?: goals.Goal): void => { if (!actual || actual === goal) finish(); };
    const changed = (actual: goals.Goal | null): void => {
      if (actual !== goal) failure('GoalChanged', 'The goal changed before completion!');
    };
    const stopped = (): void => failure('PathStopped', 'Path stopped before completion!');
    bot.on('path_update', update); bot.on('goal_reached', reached);
    bot.on('goal_updated', changed); bot.on('path_stop', stopped);
    try { bot.pathfinder.setGoal(goal); } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}
