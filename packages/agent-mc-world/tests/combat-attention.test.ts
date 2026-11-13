import { afterEach, expect, it, vi } from 'vitest';
import { CombatDecisionLoop, type CombatDecisionFrame } from '../src/decisions/combat-decision.ts';
import { CombatAbstention, combatAttentionText, combatAttentionEvent, type CombatDecisionAttention } from '../src/decisions/combat-attention.ts';
import { hasExecutionFeedbackContext } from '../src/client/execution-context.ts';
import { COMBAT_DECISION_DEFAULTS } from '../src/decisions/defaults.ts';

function frame(): CombatDecisionFrame {
  return { battlefield: { sampledAtMs: 0, connectionGeneration: 1, dimension: 'overworld',
    self: { entityId: 1, health: { current: 20, max: 20, source: 'native', updatedAtMs: 0 }, food: 20,
      position: [0, 64, 0], scoreboardTeam: null },
    action: { fighting: false, tracking: false, emergency: false, taskId: null, step: null, targetEntityId: null, sinceHitMs: null, canStep: true },
    actors: [{ entityId: 2, uuid: 'enemy', type: 'blaze', name: null, relation: 'hostile', relationSource: 'native',
      scoreboardTeam: null, health: { current: 8, max: 20, source: 'native', updatedAtMs: 0 }, position: [5, 64, 0],
      distance: 5, lineOfSight: true, targetEntityId: 1 }], omitted: 0, server: null },
    tacticRevision: 67, mana: null, skills: [], omittedCandidates: 0,
    candidates: [{ id: 'engage', kind: 'engage', targetId: 2, uuid: 'enemy', intent: 'Attack the visible enemy.' },
      { id: 'track', kind: 'track', targetId: 2, uuid: 'enemy', minDistance: 4, maxDistance: 8, leaseMs: 4000, intent: 'Observe without attacking.' }] };
}
afterEach(() => vi.useRealTimers());

it('reports a repeated idle near-tie to its owner once, and supplies the next decision with actual non-execution', async () => {
  vi.useFakeTimers(); const f = frame(), requests: any[] = [], attention = vi.fn(), apply = vi.fn(() => true), report = vi.fn();
  const loop = new CombatDecisionLoop({ config: () => ({ ...COMBAT_DECISION_DEFAULTS, enabled: true, mode: 'act',
    connection: 'host', endpoint: '', minIntervalMs: 1000, minMargin: .1 }), sample: () => structuredClone(f),
    request: async input => { requests.push(input); return { answers: { tactic: { type: 'choice', choice: 'option_0', confidence: .514,
      probabilities: { option_0: .5142278163609209, option_1: .4575862147575799, keep: .028185968881499216 } } } }; },
    apply, report, attention });
  for (let i = 0; i < 93; i++) { loop.tick(); await vi.advanceTimersByTimeAsync(1000); }
  expect(apply).not.toHaveBeenCalled(); expect(attention).toHaveBeenCalledTimes(1);
  expect(attention.mock.calls[0][0]).toMatchObject({ count: 3, bodyIdle: true, dispatched: false, tacticRevision: 67,
    threats: [{ entityId: 2, type: 'blaze', distance: 5 }] });
  expect(requests[3].state.priorAbstention).toMatchObject({ count: 3, dispatched: false, ownerReviewRequested: true });
  expect(report.mock.calls.filter(([e]) => e === 'result')).toHaveLength(93);
  expect(combatAttentionText(attention.mock.calls[0][0])).toContain('不能解释为自动战斗正在推进');
  const event = combatAttentionEvent(attention.mock.calls[0][0], 'mymc');
  expect(event).toMatchObject({ source: 'mymc', type: 'mymc.tactic', origin: 'external' });
  expect(hasExecutionFeedbackContext(event.text, event.meta?.executionFeedback)).toBe(true);
  expect(hasExecutionFeedbackContext('changed text', event.meta?.executionFeedback)).toBe(false);
  loop.stop(); expect(loop.tick()).toBe(false);
});

it.each(['fight', 'task', 'emergency', 'ally', 'hidden', 'death', 'moved', 'generation', 'tactic', 'gap'])
  ('does not carry an idle episode across %s', change => {
    const f = frame(), a = new CombatAbstention(); a.record(f, 'one', 0); a.record(f, 'two', 1000);
    if (change === 'fight') f.battlefield.action.fighting = true;
    if (change === 'task') f.battlefield.action.taskId = 8;
    if (change === 'emergency') f.battlefield.action.emergency = true;
    if (change === 'ally') f.battlefield.actors[0].relation = 'ally';
    if (change === 'hidden') f.battlefield.actors[0].lineOfSight = false;
    if (change === 'death') f.battlefield.actors[0].health.current = 0;
    if (change === 'moved') f.battlefield.self.position[0] = 2;
    if (change === 'generation') f.battlefield.connectionGeneration++;
    if (change === 'tactic') f.tacticRevision++;
    expect(a.context(f, change === 'gap' ? 12000 : 2000)).toBeNull();
    expect(a.record(f, 'three', 12001)).toBeNull();
  });

it('does not turn a broken notification sink into a false model failure or replay an attack', async () => {
  vi.useFakeTimers(); const f = frame(), report = vi.fn(), apply = vi.fn(() => true);
  const loop = new CombatDecisionLoop({ config: () => ({ ...COMBAT_DECISION_DEFAULTS, enabled: true, mode: 'act',
    connection: 'host', endpoint: '', minIntervalMs: 1000 }), sample: () => f,
    request: async () => ({ answers: { tactic: { type: 'choice', choice: 'option_0', confidence: .5,
      probabilities: { option_0: .5, option_1: .49, keep: .01 } } } }), apply, report,
    attention: async () => { throw Error('host storage unavailable'); } });
  for (let i = 0; i < 3; i++) { loop.tick(); await vi.advanceTimersByTimeAsync(1000); }
  expect(apply).not.toHaveBeenCalled(); expect(report.mock.calls.filter(([e]) => e === 'error')).toHaveLength(0);
  expect(report.mock.calls.filter(([e]) => e === 'attention-delivery-error')).toHaveLength(1); loop.stop();
});

it('keeps ordinary shadow mode silent and stops ranking an unchanged encounter after opt-in review', async () => {
  vi.useFakeTimers();
  const f=frame();
  f.battlefield.actors[0]!.nativeReference='blaze@123456';
  const request=vi.fn(async () => ({answers:{tactic:{type:'choice',choice:'option_0',confidence:.5,
    probabilities:{option_0:.5,option_1:.49,keep:.01}}}}));
  const attention=vi.fn(), apply=vi.fn(() => true);
  const options={config:()=>({...COMBAT_DECISION_DEFAULTS,enabled:true,mode:'shadow' as const,
    connection:'host' as const,minIntervalMs:1000}),sample:()=>f,request,apply,report:vi.fn(),attention};
  const ordinary=new CombatDecisionLoop(options);
  for(let i=0;i<5;i++){ordinary.tick();await vi.advanceTimersByTimeAsync(1000);}
  expect(attention).not.toHaveBeenCalled();
  ordinary.stop();
  request.mockClear();
  const observer=new CombatDecisionLoop({...options,attentionInShadow:true});
  for(let i=0;i<21;i++){observer.tick();await vi.advanceTimersByTimeAsync(1000);}
  expect(request).toHaveBeenCalledTimes(3);
  expect(attention).toHaveBeenCalledTimes(1);
  expect(combatAttentionEvent(attention.mock.calls[0][0]).text).toContain('blaze@123456');
  f.battlefield.self.position=[0,64,3];
  for(let i=0;i<4;i++){observer.tick();await vi.advanceTimersByTimeAsync(1000);}
  expect(attention).toHaveBeenCalledTimes(2);
  expect(apply).not.toHaveBeenCalled();
  observer.stop();
});

it.each(['unavailable sample', 'journal error'])('retries the same feedback after %s and stops after one delivery', async failure => {
  vi.useFakeTimers();
  const f = frame();
  const request = vi.fn(async () => ({ answers: { tactic: { type: 'choice', choice: 'option_0', confidence: .5,
    probabilities: { option_0: .5, option_1: .49, keep: .01 } } } }));
  const delivered: string[] = [];
  const attention = vi.fn(async (evidence: CombatDecisionAttention) => {
    if (attention.mock.calls.length === 1) {
      if (failure === 'journal error') throw Error('journal unavailable');
      return false;
    }
    delivered.push(evidence.decisionId);
  });
  const apply = vi.fn(() => true);
  const loop = new CombatDecisionLoop({ config: () => ({ ...COMBAT_DECISION_DEFAULTS, enabled: true, mode: 'shadow',
    connection: 'host', minIntervalMs: 1000 }), sample: () => f, request, apply, report: vi.fn(), attention, attentionInShadow: true });
  for (let i = 0; i < 10; i++) { loop.tick(); await vi.advanceTimersByTimeAsync(1000); }
  expect(attention).toHaveBeenCalledTimes(2);
  expect(attention.mock.calls[1]![0]).toEqual(attention.mock.calls[0]![0]);
  expect(delivered).toEqual([attention.mock.calls[0]![0].decisionId]);
  expect(request).toHaveBeenCalledTimes(3);
  expect(apply).not.toHaveBeenCalled();
  loop.stop();
});

it.each(['lease changes', 'feedback expires', 'observer stops'])('discards pending feedback when the %s', async condition => {
  vi.useFakeTimers();
  const f = frame();
  const attention = vi.fn(() => false);
  const loop = new CombatDecisionLoop({ config: () => ({ ...COMBAT_DECISION_DEFAULTS, enabled: true, mode: 'shadow',
    connection: 'host', minIntervalMs: 1000 }), sample: () => f, apply: vi.fn(), report: vi.fn(), attention, attentionInShadow: true,
    request: async () => ({ answers: { tactic: { type: 'choice', choice: 'option_0', confidence: .5,
      probabilities: { option_0: .5, option_1: .49, keep: .01 } } } }) });
  for (let i = 0; i < 3; i++) { loop.tick(); await vi.advanceTimersByTimeAsync(1000); }
  expect(attention).toHaveBeenCalledTimes(1);
  if (condition === 'lease changes') f.battlefield.connectionGeneration++;
  if (condition === 'feedback expires') await vi.advanceTimersByTimeAsync(10000);
  if (condition === 'observer stops') loop.stop();
  loop.tick(); await vi.advanceTimersByTimeAsync(1000);
  expect(attention).toHaveBeenCalledTimes(1);
  loop.stop();
});
