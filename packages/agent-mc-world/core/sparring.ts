import type { Bot } from 'mineflayer';

type Target = Bot['entities'][number];
const rounds = new WeakMap<Target, { bot: Bot; until: number }>();
const replyWindowMs = 30_000;

/** A late return hit belongs to the same bounded exchange, even after the task releases the hand. */
export function beginPlayerRound(bot: Bot, target: Target, bounded: boolean): () => void {
  if (target.type !== 'player') return () => {};
  if (!bounded) {
    rounds.delete(target);
    return () => {};
  }
  const round = { bot, until: Infinity };
  rounds.set(target, round);
  return () => { round.until = Date.now() + replyWindowMs; };
}

export function inPlayerRound(bot: Bot, target: Target | undefined | null): boolean {
  if (!target) return false;
  const round = rounds.get(target);
  return round?.bot === bot && round.until > Date.now();
}
