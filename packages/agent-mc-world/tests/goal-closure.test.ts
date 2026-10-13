import { describe, expect, it } from 'vitest';
import { createGoalClosureHandler, type GoalClosureState } from '../src/client/goal-closure.ts';

function harness() {
  let state: GoalClosureState | null = { slot: 3, identity: 'world/3/created', phase: 'step1:pending' };
  let receipt = '0/2 milestones completed';
  let checks = 0;
  const call = createGoalClosureHandler({
    state: args => args.done === 3 ? state : null,
    invoke: () => { checks++; return receipt; },
    log: (_args, text) => text,
  });
  return { call, get checks() { return checks; },
    update(next: GoalClosureState | null, text = receipt) { state = next; receipt = text; } };
}

describe('rejected goal closure', () => {
  it('rechecks the environment and ends a turn after the same rejected closure', () => {
    const h = harness();
    expect(h.call({ done: 3 })).toMatchObject({ failed: true });
    expect(h.call({ done: 3 })).toMatchObject({ failed: true, endsTurn: true });
    expect(h.checks).toBe(2);
  });
  it('allows a revised milestone, a changed verdict and a replacement goal to be considered', () => {
    const h = harness();
    h.call({ done: 3 });
    h.update({ slot: 3, identity: 'world/3/created', phase: 'step2:pending' });
    expect(h.call({ done: 3 })).not.toHaveProperty('endsTurn');
    h.update({ slot: 3, identity: 'world/3/created', phase: 'step2:pending' }, '1/2 milestones completed');
    expect(h.call({ done: 3 })).not.toHaveProperty('endsTurn');
    h.update({ slot: 3, identity: 'world/3/replacement', phase: 'step2:pending' });
    expect(h.call({ done: 3 })).not.toHaveProperty('endsTurn');
  });
  it('passes successful closure through and leaves ordinary goal operations available', () => {
    const h = harness();
    h.call({ done: 3 });
    h.update(null, 'closed');
    expect(h.call({ done: 3 })).toBe('closed');
    expect(h.call({ milestone: { slot: 3, step: 1, judgment: 'measured' } })).toBe('closed');
    expect(h.call({})).toBe('closed');
  });
  it('accepts completion when the environment changes during the next recheck', () => {
    let state: GoalClosureState | null = { slot: 1, identity: 'world/goal', phase: 'pending' };
    let ready = false;
    const call = createGoalClosureHandler({
      state: () => state,
      invoke: () => { if (ready) state = null; return ready ? 'closed after fresh verification' : 'blocked'; },
      log: (_args, text) => text,
    });
    call({ done: 1 });
    expect(call({ done: 1 })).toHaveProperty('endsTurn', true);
    ready = true;
    expect(call({ done: 1 })).toBe('closed after fresh verification');
  });
});
