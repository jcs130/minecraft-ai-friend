import type { ObservedEffect } from '../src/contracts/observed-effect.ts';
import type { StepDecision } from './step-decision.ts';

export interface TaskEffectStep {
  outcome: string;
  skill?: string;
  observedEffect?: ObservedEffect;
  decision?: Partial<StepDecision>;
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
  const observation = (statuses: Array<ObservedEffect['status'] | undefined>) => statuses.includes('changed') ? 'changed' as const
    : statuses.length > 0 && statuses.every(status => status === 'unchanged') ? 'unchanged' as const : 'unknown' as const;
  const quantitativeTransfer = (s: TaskEffectStep | undefined) => s?.decision?.unit === 'items'
    && (s.skill === 'take' || s.skill === 'stow');
  const workStatus = (s: TaskEffectStep, index: number) => {
    // Opening/closing a GUI is visible even when the attempted transfer is unconfirmed.
    if (quantitativeTransfer(s)) {
      return s.decision?.completed == null ? 'unknown' : s.decision.completed > 0 ? 'changed' : 'unchanged';
    }
    const effect = s.observedEffect;
    if (s.skill === 'use' && quantitativeTransfer(work[index + 1]) && effect?.changed.window
      && !effect.changed.inventory && !effect.changed.target && !effect.changed.position) {
      return 'unchanged';
    }
    return effect?.status;
  };
  return { protocol: 'agent-mc-task-effect-progress/v1',
    observation: observation(physical.map(s => s.observedEffect?.status)), workObservation: observation(work.map(workStatus)), workSteps: work.length,
    workNoopSteps: work.filter(s => s.outcome === 'noop').length,
    measuredSteps: measured.length, unknownSteps: unknown.length,
    noopSteps: physical.filter(s => s.outcome === 'noop').length, goalVerified: false };
}
