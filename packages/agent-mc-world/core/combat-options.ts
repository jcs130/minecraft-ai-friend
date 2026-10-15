import type { QueueStatus } from './executor.ts';
import type { CombatCandidate } from './combat-decision-types.ts';

/** Only a continuous, explicitly requested follow can yield to proactive combat. */
export function combatMayTakeTask(queue: QueueStatus | undefined): boolean {
  return !queue?.hold && !queue?.waiting.length && (!queue?.running
    || (queue.running.skill === 'follow' && !!queue.running.followTarget));
}

/** Reserve choice space for different capabilities before same-kind variants. */
export function diverseCombatOptions(candidates: CombatCandidate[], limit: number): CombatCandidate[] {
  const selected: CombatCandidate[] = [];
  for (const kind of ['cast', 'engage', 'step', 'retreat', 'track'] as const) {
    const first = candidates.find(c => c.kind === kind);
    if (first && selected.length < limit) selected.push(first);
  }
  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    if (!selected.includes(candidate)) selected.push(candidate);
  }
  return selected;
}
