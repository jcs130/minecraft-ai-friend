import { expect, it } from 'vitest';
import { NoEffectPlanBook } from '../core/no-effect-plans.ts';
import { taskEffectProgress } from '../core/task-effect-progress.ts';
import { observedEffect } from '../core/observed-effect.ts';
import type { EffectSample } from '../src/contracts/observed-effect.ts';

const sample = (): EffectSample => ({ at: new Date(1000).toISOString(), target: null,
  inventory: { phantom_membrane: 2 }, position: [0.5, 75, 0.5], window: null });
const effect = (skill: string, changed = false) => { const after = sample(); if (changed) after.inventory!.phantom_membrane++;
  return observedEffect(skill, 'overworld', null, sample(), after); };
const steps = () => [{ outcome: 'ok', observedEffect: effect('goto') }, { outcome: 'noop', observedEffect: effect('pickup') }];

it('distinguishes ended mixed goto/pickup from any measured work, without changing either terminal', () => {
  const input = steps(), before = structuredClone(input), p = taskEffectProgress(input);
  expect(p).toMatchObject({ observation: 'unchanged', measuredSteps: 2, noopSteps: 1,
    workObservation: 'unchanged', workSteps: 1, workNoopSteps: 1, goalVerified: false });
  expect(input).toEqual(before);
});
it('does not call arrival movement or unknown coverage a pickup gain', () => {
  const input = steps(); input[0].observedEffect.after.position = [1.5, 75, .5];
  input[0].observedEffect.status = 'changed'; input[0].observedEffect.changed.position = true;
  expect(taskEffectProgress(input)).toMatchObject({ observation: 'changed', workObservation: 'unchanged' });
  expect(taskEffectProgress([{ outcome: 'noop' }])).toMatchObject({ observation: 'unknown', measuredSteps: 0 });
  expect(taskEffectProgress([{ outcome: 'ok', skill: 'chat' }])).toMatchObject({ observation: 'unknown', workSteps: 0 });
  expect(taskEffectProgress([{ outcome: 'ok', skill: 'observe' }])).toMatchObject({ observation: 'unknown', workSteps: 0 });
});
it('gates only a new identical choice after two correlated comparable completed noops', () => {
  const b = new NoEffectPlanBook({ now: () => 2000 }), progress = taskEffectProgress(steps());
  b.record({ key: 'plan', taskId: 1, context: 'same-world', progress }); expect(b.review('plan', 'same-world')).toBeNull();
  b.record({ key: 'plan', taskId: 1, context: 'same-world', progress }); expect(b.review('plan', 'same-world')).toBeNull();
  b.record({ key: 'plan', taskId: 2, context: 'same-world', progress });
  const review = b.review('plan', 'same-world'); expect(review).toMatchObject({ completedNoopTasks: 2,
    firstTaskId: 1, latestTaskId: 2, observation: 'unchanged', goalVerified: false });
  for (let i = 0; i < 50; i++) expect(b.review('plan', 'same-world')).toEqual(review);
  expect(b.review('other-plan', 'same-world')).toBeNull(); expect(b.review('plan', 'new-drop')).toBeNull();
  expect(b.review('plan', null)).toBeNull(); expect(JSON.stringify(review)).not.toContain('same-world');
});
it('unknown measurements do not create a zero-effect trial; actual gains close the episode', () => {
  const b = new NoEffectPlanBook();
  for (let taskId = 1; taskId <= 5; taskId++) b.record({ key: 'p', taskId, context: 'c', progress: taskEffectProgress([{ outcome: 'noop' }]) });
  expect(b.review('p', 'c')).toBeNull();
  for (let taskId = 6; taskId <= 7; taskId++) b.record({ key: 'p', taskId, context: 'c', progress: taskEffectProgress(steps()) });
  expect(b.review('p', 'c')).not.toBeNull();
  b.record({ key: 'p', taskId: 8, context: 'c', progress: taskEffectProgress([{ outcome: 'ok', observedEffect: effect('pickup', true) }]) });
  expect(b.review('p', 'c')).toBeNull();
});
it('new comparable contexts start a new episode and stale evidence permits reconsideration', () => {
  let now = 1000; const b = new NoEffectPlanBook({ now: () => now, windowMs: 1000 }), progress = taskEffectProgress(steps());
  for (let taskId = 1; taskId <= 2; taskId++) b.record({ key: 'p', taskId, context: 'old', progress });
  b.record({ key: 'p', taskId: 3, context: 'new', progress }); expect(b.review('p', 'new')).toBeNull();
  b.record({ key: 'p', taskId: 4, context: 'new', progress }); expect(b.review('p', 'new')?.completedNoopTasks).toBe(2);
  now = 2001; expect(b.review('p', 'new')).toBeNull(); b.clear(); expect(b.review('p', 'old')).toBeNull();
});
