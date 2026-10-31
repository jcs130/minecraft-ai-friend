import { createHash } from 'node:crypto';
import type { TaskEffectProgress } from './task-effect-progress.ts';

export interface NoEffectPlanReview {
  protocol: 'agent-mc-no-effect-plan-review/v1';
  planHash: string;
  completedNoopTasks: number;
  firstTaskId: number;
  latestTaskId: number;
  observedAt: number;
  observation: 'unchanged';
  goalVerified: false;
}
interface Entry { context: string; review: NoEffectPlanReview }
/** A gate on a new selection only. It never changes an accepted task, terminal, or goal. */
export class NoEffectPlanBook {
  private readonly entries = new Map<string, Entry>();
  private readonly seen = new Set<number>();
  constructor(private readonly options: { now?: () => number; limit?: number; windowMs?: number } = {}) {}
  private now() { return this.options.now?.() ?? Date.now(); }
  private hash(key: string) { return createHash('sha256').update(key).digest('hex'); }
  record(input: { key: string; taskId: number; context: string | null; progress: TaskEffectProgress }): void {
    if (this.seen.has(input.taskId)) return;
    this.seen.add(input.taskId); while (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
    const key = this.hash(input.key), old = this.entries.get(key), now = this.now();
    if (input.progress.observation === 'changed') { this.entries.delete(key); return; }
    // Missing coverage is unknown, never a zero-effect trial. Only actual noops
    // with a producer-owned comparable current context can gate a later choice.
    if (input.context === null || input.progress.observation !== 'unchanged' || input.progress.noopSteps === 0) return;
    const continued = old && old.context === input.context && now - old.review.observedAt <= (this.options.windowMs ?? 900000);
    this.entries.delete(key); this.entries.set(key, { context: input.context, review: {
      protocol: 'agent-mc-no-effect-plan-review/v1', planHash: key,
      completedNoopTasks: continued ? old.review.completedNoopTasks + 1 : 1,
      firstTaskId: continued ? old.review.firstTaskId : input.taskId, latestTaskId: input.taskId,
      observedAt: now, observation: 'unchanged', goalVerified: false } });
    while (this.entries.size > 128) this.entries.delete(this.entries.keys().next().value!);
  }
  review(key: string, currentContext: string | null): NoEffectPlanReview | null {
    const entry = this.entries.get(this.hash(key));
    if (!entry || currentContext === null || entry.context !== currentContext
      || this.now() - entry.review.observedAt > (this.options.windowMs ?? 900000)
      || entry.review.completedNoopTasks < (this.options.limit ?? 2)) return null;
    return structuredClone(entry.review);
  }
  clear(): void { this.entries.clear(); this.seen.clear(); }
}
