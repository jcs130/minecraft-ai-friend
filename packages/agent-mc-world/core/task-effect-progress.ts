import type { ObservedEffect } from '../src/contracts/observed-effect.ts';

export interface TaskEffectStep {
  outcome: string;
  skill?: string;
  observedEffect?: ObservedEffect;
}
/** Measured client-visible effects, independent of a task terminal or goal success. */
export interface TaskEffectProgress {
  protocol: 'agent-mc-task-effect-progress/v1';
  observation: 'changed' | 'unchanged' | 'unknown';
  workObservation: 'changed' | 'unchanged' | 'unknown';
  workSteps: number;
  workNoopSteps: number;
  measuredSteps: number;
  unknownSteps: number;
  noopSteps: number;
  goalVerified: false;
}

export function taskEffectProgress(steps: readonly TaskEffectStep[]): TaskEffectProgress {
  const physical = steps.filter(s => !['chat', 'tell', 'look', 'wait', 'observe', 'probe'].includes(s.skill ?? s.observedEffect?.skill ?? '')
    && (s.observedEffect?.schema === 'agent-mc-observed-effect/v1' || !['skip', 'cut'].includes(s.outcome)));
  const measured = physical.filter(s => s.observedEffect?.schema === 'agent-mc-observed-effect/v1');
  const unknown = physical.filter(s => !s.observedEffect || s.observedEffect.status === 'unknown');
  const movement = ['goto', 'follow', 'walk', 'swim', 'control', 'flight', 'ride', 'transit'];
  const work = physical.filter(s => !movement.includes(s.skill ?? s.observedEffect?.skill ?? ''));
  const observation = (list: readonly TaskEffectStep[]) => list.some(s => s.observedEffect?.status === 'changed') ? 'changed' as const
    : list.length > 0 && list.every(s => s.observedEffect?.status === 'unchanged') ? 'unchanged' as const : 'unknown' as const;
  return { protocol: 'agent-mc-task-effect-progress/v1',
    observation: observation(physical), workObservation: observation(work), workSteps: work.length,
    workNoopSteps: work.filter(s => s.outcome === 'noop').length,
    measuredSteps: measured.length, unknownSteps: unknown.length,
    noopSteps: physical.filter(s => s.outcome === 'noop').length, goalVerified: false };
}
