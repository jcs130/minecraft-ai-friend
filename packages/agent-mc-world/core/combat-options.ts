import type { QueueStatus } from './executor.ts';
import type { CombatCandidate } from './combat-decision-types.ts';

/** Native combat suspends resumable work and restores its exact checkpoint. */
export function combatMayTakeTask(queue: QueueStatus | undefined): boolean {
  if (queue?.hold) return false;
  if (!queue?.running) return !queue?.waiting.length;
  return queue.running.resumable === true
    || (queue.running.skill === 'follow' && !!queue.running.followTarget);
}

/** Reserve choice space for different capabilities before same-kind variants. */
export function diverseCombatOptions(candidates: CombatCandidate[], limit: number): CombatCandidate[] {
  const selected: CombatCandidate[] = [];
  for (const kind of ['retreat', 'engage', 'cast', 'method', 'step', 'track'] as const) {
    const first = candidates.find(c => c.kind === kind);
    if (first && selected.length < limit) selected.push(first);
  }
  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    if (!selected.includes(candidate)) selected.push(candidate);
  }
  return selected;
}
