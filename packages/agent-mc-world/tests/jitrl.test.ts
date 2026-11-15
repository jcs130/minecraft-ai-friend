import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameMemoryBook, GAME_MEMORY_TOOL, type GameMemoryContext } from '../core/game-memory.ts';
import { GameMemoryService } from '../core/game-memory-service.ts';
import { OperationExperienceBook, operationActionHash, type OperationObservation } from '../core/operation-experience.ts';
import { reweightJitRl } from '../core/jitrl.ts';
import { inspectToolCall } from '../src/contracts/call-capability.ts';
import { nativeOperationObservation } from '../src/client/native-evidence.ts';

let dir: string, context: GameMemoryContext, evidence: OperationExperienceBook, service: GameMemoryService;
const scope = { realm: 'test-world', account: 'offline:learner', agent: 'test-agent' };
const sample = (overrides: Partial<OperationObservation> = {}): OperationObservation => ({ at: new Date().toISOString(), dimension: 'overworld', position: { x: 0, y: 64, z: 0 }, health: 20, food: 10, inventory: { bread: 4, carrot: 3 }, ...overrides });
const actions = [ { id: 'bread', prior: .6, ready: true, tool: 'mymc_act', args: { steps: [{ skill: 'eat', item: 'bread' }] } },
  { id: 'carrot', prior: .4, ready: true, tool: 'mymc_act', args: { steps: [{ skill: 'eat', item: 'carrot' }] } } ];
const rank = (id: string, input: Record<string, unknown> = {}) => service.execute({ action: 'experience', operation: 'rank', requestId: id,
  input: { taskKey: 'food-recovery', phase: 'safe-eat', conditions: { hostile: false }, criterion: { kind: 'food', target: 4 }, candidates: actions, ...input } }, context);
const feedback = (decisionId: unknown, experienceId: string, candidateId = 'bread') => service.execute({ action: 'experience', operation: 'feedback', input: { decisionId, candidateId, experienceId } }, context);
function execution(id: string, action = actions[0]!, change: Partial<OperationObservation> = { food: 14 }, phase: 'completed' | 'blocked' | 'cancelled' = 'completed') {
  const row = evidence.begin(context.scope, 'run-1', id, 'mc_act', action.args, sample(), { controller: 'system2' });
  evidence.finish(context.scope, row.id, { text: 'not retained', execution: { kind: 'task', id, phase, terminal: true, goalCompleted: false } }, sample(change), 5);
  return row.id;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-16T00:00:00Z'));
  dir = mkdtempSync(join(tmpdir(), 'jitrl-'));
  context = { scope, dimension: 'overworld', observation: () => sample() };
  evidence = new OperationExperienceBook(dir); service = new GameMemoryService(new GameMemoryBook(dir), dir);
});
afterEach(() => { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); });

describe('paper-derived local policy update', () => {
  const candidates = actions.map(c => ({ id: c.id, actionHash: c.id, prior: c.prior, ready: c.ready }));
  it('uses log(prior)+beta*normalized advantage, with stable softmax', () => {
    const r = reweightJitRl(candidates, [{ id: 'a', actionHash: 'bread', value: -1 }, { id: 'b', actionHash: 'carrot', value: 1 }]);
    expect(r.candidates[1]!.posterior).toBeCloseTo(.4 * Math.exp(.5) / (.6 * Math.exp(-.5) + .4 * Math.exp(.5)), 12);
    expect(r.candidates[1]!.posterior).toBeGreaterThan(.6);
  });
  it('keeps empty priors but does not preserve a failed action just because alternatives are untried', () => {
    expect(reweightJitRl(candidates, []).candidates[0]!.posterior).toBeCloseTo(.6);
    const n = { id: 'a', actionHash: 'bread', value: -1 };
    const r = reweightJitRl(candidates, [n, n]);
    expect(r.sampleSize).toBe(1); expect(r.candidates[0]!.posterior).toBeLessThan(.5);
    expect(r.candidates[1]).toMatchObject({ q: null, estimatedQ: 0, samples: 0, estimateSource: 'unobserved-neutral' });
    expect(r.candidates[1]!.posterior).toBeCloseTo(.4 * Math.exp(.5) / (.6 + .4 * Math.exp(.5)), 12);
  });
  it('keeps zero priors at zero and never selects an unavailable candidate', () => {
    expect(reweightJitRl([{ ...candidates[0]!, prior: 1 }, { ...candidates[1]!, prior: 0 }], []).candidates[1]!.posterior).toBe(0);
    expect(reweightJitRl([{ ...candidates[0]!, ready: false }, candidates[1]!], []).candidates.map(c => c.id)).toEqual(['carrot']);
  });
});

describe('real memory service, receipt credit and restart', () => {
  it('corrects a held-out decision only after both actions have measured outcomes', async () => {
    const first = await rank('trial-1'); expect(first.suggestedChoice).toBe('bread');
    await feedback(first.decisionId, execution('bad', actions[0], { food: 10, health: 16 }));
    const second = await rank('trial-2'); expect(second.suggestedChoice).toBe('carrot');
    await feedback(second.decisionId, execution('good', actions[1], { food: 14 }), 'carrot');
    service = new GameMemoryService(new GameMemoryBook(dir), dir);
    const heldOut = await rank('held-out');
    expect(heldOut).toMatchObject({ baseChoice: 'bread', suggestedChoice: 'carrot', sampleSize: 2, inferenceCalls: 0, bodyDispatched: false, goalVerified: false });
  });
  it('deduplicates feedback and preserves unknowns rather than awarding zero', async () => {
    const first = await rank('r'), id = execution('unknown', actions[0], { inventory: null, food: null });
    expect(await feedback(first.decisionId, id)).toMatchObject({ recorded: true, value: null, reason: 'missing-measurement' });
    expect(await feedback(first.decisionId, id)).toMatchObject({ deduplicated: true, value: null });
    expect(await service.execute({ action: 'experience', operation: 'policy_status' }, context)).toMatchObject({ samples: 1, validReturns: 0, unknownReturns: 1, goalSuccessRate: null });
  });
  it('waits for the original terminal, never treating accepted as success', async () => {
    const first = await rank('r'), row = evidence.begin(scope, 'run', 'pending', 'mc_act', actions[0]!.args, sample());
    evidence.finish(scope, row.id, { text: '', execution: { kind: 'task', id: 't', phase: 'accepted', terminal: false, goalCompleted: false } }, sample({ food: 14 }), 1);
    expect(await feedback(first.decisionId, row.id)).toMatchObject({ recorded: false, pending: true, value: null });
    evidence.terminal(scope, row.id, { kind: 'task', id: 't', phase: 'completed', terminal: true, goalCompleted: false }, sample({ food: 14 }));
    expect(await feedback(first.decisionId, row.id)).toMatchObject({ recorded: true, value: 1 });
  });
  it('does not reward cancellation or missing prior observations', async () => {
    const first = await rank('r'), id = execution('cancelled', actions[0], { food: 14 }, 'cancelled');
    expect(await feedback(first.decisionId, id)).toMatchObject({ value: null, reason: 'no-measurable-terminal' });
  });
  it('prevents action substitution, old-state credit and pre-decision execution', async () => {
    const old = execution('old'); vi.setSystemTime(Date.now() + 1);
    const first = await rank('r');
    await expect(feedback(first.decisionId, old)).rejects.toThrow('validity');
    await expect(feedback(first.decisionId, execution('wrong', actions[1]))).rejects.toThrow('does not match');
    context.observation = () => sample({ food: 8 });
    const changed = await rank('changed');
    await expect(feedback(changed.decisionId, execution('state'))).rejects.toThrow('state changed');
  });
  it('keeps replayed decisions expired instead of silently refreshing them', async () => {
    const first = await rank('r'); vi.setSystemTime(Date.now() + 31_000);
    expect(await rank('r')).toMatchObject({ decisionId: first.decisionId, replayed: true, expired: true });
    await expect(feedback(first.decisionId, execution('late'))).rejects.toThrow('validity');
    await expect(rank('r', { phase: 'different' })).rejects.toThrow('conflict');
  });
  it('rechecks current state even for an unexpired rank retry', async () => {
    const first = await rank('r'); context.observation = () => null;
    expect(await rank('r')).toMatchObject({ decisionId: first.decisionId, replayed: true, expired: true });
  });
  it('never credits death as progress even when the nominal delta is large', async () => {
    const first = await rank('r');
    expect(await feedback(first.decisionId, execution('dead', actions[0], { food: 20, health: 0 }))).toMatchObject({ value: -1 });
  });
  it('cannot re-credit a physical task under a second request or decision', async () => {
    const first = await rank('r1'), id = execution('physical-task'); await feedback(first.decisionId, id);
    const second = await rank('r2'), row = evidence.begin(scope, 'run-1', 'retry-request', 'mc_act', actions[0]!.args, sample());
    evidence.finish(scope, row.id, { text: '', execution: { kind: 'task', id: 'physical-task', phase: 'completed', terminal: true, goalCompleted: false } }, sample({ food: 14 }), 3);
    await expect(feedback(second.decisionId, row.id)).rejects.toThrow('already credited');
  });
  it.each([{ phase: 'different' }, { taskKey: 'unrelated' }, { conditions: { hostile: true } },
    { candidates: actions.map(c => ({ ...c, args: { ...c.args, revision: 'new' } })) }])('does not transfer across changed semantics: %j', async changed => {
    const first = await rank('r1'); await feedback(first.decisionId, execution('a'));
    expect(await rank('r2', changed)).toMatchObject({ sampleSize: 0 });
  });
  it('isolates account, realm, dimension, distant position and time', async () => {
    const first = await rank('r1'); await feedback(first.decisionId, execution('a'));
    context = { ...context, scope: { ...scope, account: 'other' } };
    expect(await rank('account')).toMatchObject({ sampleSize: 0 });
    context = { ...context, scope: { ...scope, realm: 'different-world' } };
    expect(await rank('realm')).toMatchObject({ sampleSize: 0 });
    context = { scope, dimension: 'the_nether', observation: () => sample({ dimension: 'the_nether' }) };
    expect(await rank('dimension')).toMatchObject({ sampleSize: 0 });
    context = { scope, dimension: 'overworld', observation: () => sample({ position: { x: 20, y: 64, z: 0 } }) };
    expect(await rank('distant')).toMatchObject({ sampleSize: 0 });
    context.observation = () => sample(); vi.setSystemTime(Date.now() + 31 * 86400_000);
    expect(await rank('aged')).toMatchObject({ sampleSize: 0 });
  });
  it('does not persist candidate code, labels, prior requests or full inventory', async () => {
    await rank('r', { candidates: actions.map(c => ({ ...c, tool: 'mc_script', args: { code: `PRIVATE_CODE_${c.id}`, params: { label: 'PRIVATE_TEXT' } } })) });
    const scan = (p: string): string => readdirSync(p, { withFileTypes: true }).map(e => e.isDirectory() ? scan(join(p, e.name)) : readFileSync(join(p, e.name), 'utf8')).join('');
    const stored = scan(dir); expect(stored).not.toContain('PRIVATE_'); expect(stored).not.toContain('"bread":4');
  });
  it('rejects unavailable/fabricated/oversized distributions and offline state', async () => {
    await expect(rank('bad', { candidates: actions.map(c => ({ ...c, prior: .2 })) })).rejects.toThrow('probability');
    await expect(rank('bad', { conditions: { prompt: 'private prose' } })).rejects.toThrow('numbers');
    context.observation = () => null; await expect(rank('offline')).rejects.toThrow('fresh');
    context.observation = () => sample({ at: new Date(Date.now() - 6000).toISOString() }); await expect(rank('stale')).rejects.toThrow('fresh');
  });
  it('declares background feedback and read-only help through the public schema', () => {
    const tool = { ...GAME_MEMORY_TOOL, handler: async () => '' };
    expect(inspectToolCall(tool, tool.name, { action: 'experience', operation: 'feedback', input: {} })).toMatchObject({ valid: true, backgroundLearning: true, requiresBody: false });
    expect(inspectToolCall(tool, tool.name, { action: 'experience', operation: 'policy_help' })).toMatchObject({ valid: true, readOnly: true, requiresBody: false });
    expect(operationActionHash('mc_script', { b: 2, a: 1 })).toBe(operationActionHash('mymc_script', { a: 1, b: 2 }));
  });
});

it('projects native physical stacks without inventing an empty inventory', () => {
  const raw = { connected: true, sampledAt: new Date().toISOString(), dimension: 'minecraft:overworld', position: [0, 64, 0], health: 20, food: 10,
    inventory: [{ slot: 0, name: 'bread', count: 2 }, { slot: 1, name: 'bread', count: 3 }, { slot: 2, empty: true }] };
  expect(nativeOperationObservation(raw)).toMatchObject({ dimension: 'overworld', inventory: { bread: 5 } });
  expect(nativeOperationObservation({ ...raw, inventory: undefined })?.inventory).toBeNull();
  expect(nativeOperationObservation({ ...raw, inventory: [raw.inventory[0], raw.inventory[0]] })?.inventory).toBeNull();
});
