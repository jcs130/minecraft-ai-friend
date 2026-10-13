import { createHash } from 'node:crypto';
import type { GoalPlan } from './goal-plan.ts';

/** Earlier milestones retain their evidence; the final result is rechecked at closure. */
export function goalClosureMetadata(goal: { slot: number; at: number; realTime: string; plan: GoalPlan },
  operation: 'done' | 'drop', observedAt: number) {
  const taskId = createHash('sha256').update(`${goal.slot}/${goal.at}/${goal.realTime}`).digest('hex');
  const verified = operation === 'done' && goal.plan.steps.length > 0 && goal.plan.steps.every(step =>
    !!step.verify?.length && step.state === 'verified' && step.evidence && 'verdict' in step.evidence
    && step.evidence.verdict === 'ok' && step.evidence.observedAt <= observedAt)
    && !!goal.plan.steps.at(-1)?.evidence && 'observedAt' in goal.plan.steps.at(-1)!.evidence!
    && (goal.plan.steps.at(-1)!.evidence as { observedAt: number }).observedAt >= observedAt - 1000;
  return { schema: 'task-verification-v1', capability: 'mechanical-goal-closure-v1', task_id: taskId,
    outcome: verified ? 'success' : 'unknown', verified_by: verified ? 'environment' : null,
    evidence_id: verified ? `${taskId}/${observedAt}` : null,
    recovery_case_id: null, strategy_changed: null };
}
