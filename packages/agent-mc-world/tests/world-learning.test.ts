import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { WorldOperationLearning } from '../src/client/world-learning.ts';
import { OperationExperienceBook } from '../core/operation-experience.ts';
import { GameMemoryBook } from '../core/game-memory.ts';
import { nullLogger } from '../src/client/index.ts';
import type { ToolDef, ToolOutcome, WorldHost, WorldRequestFacts } from '../src/contracts/host.ts';

const dirs: string[] = [];
afterEach(() => { for (const directory of dirs.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const scope = { realm: 'test-realm', account: 'offline:test', agent: 'test-agent' };
const accepted = { kind: 'task' as const, id: 'generation:1', phase: 'accepted' as const, terminal: false, goalCompleted: false as const };
const completed = { ...accepted, phase: 'completed' as const, terminal: true };
function setup() {
  const data = mkdtempSync(join(tmpdir(), 'world-learning-')); dirs.push(data);
  let x = 0;
  let facts: WorldRequestFacts | null = null;
  const observe = () => { facts = { text: 'fresh facts', snapshotTypes: [], experience: { scope,
    observation: { at: new Date().toISOString(), dimension: 'overworld', position: { x, y: 64, z: 0 },
      health: 20, food: 18, inventory: { wheat_seeds: 3 } } } }; };
  observe();
  const learning = new WorldOperationLearning(data, () => facts);
  const sink = vi.fn(async event => ({ ...event, cursor: 1, origin: 'external' as const }));
  const original = { pushEvent: sink, log: nullLogger() } as unknown as WorldHost;
  const host = learning.start(original);
  const book = new OperationExperienceBook(join(data, 'minecraft-memory'));
  const ctx = { role: 'main', log: nullLogger(), callId: 'call-1' };
  const wrap = (handler: ToolDef['handler'], name = 'mymc_do') => learning.tools([{ name, tags: ['act'], parameters: {}, description: '', handler }])[0];
  return { data, learning, host, sink, book, ctx, wrap,
    move: (n: number) => { x = n; observe(); }, disconnect: () => { facts = null; } };
}
const experienceId = (out: string | ToolOutcome) => ((out as ToolOutcome).meta!.experience as { id: string }).id;

it('direct World actions retain original receipts and join a terminal preceding admission', async () => {
  const f = setup();
  const action = f.wrap(async () => {
    f.move(3);
    await f.host.pushEvent({ source: 'mymc', type: 'mymc.task', ts: new Date().toISOString(), text: 'original', execution: completed });
    return { text: 'accepted, not completed', execution: accepted, endsTurn: true };
  });
  const out = await action.handler({ steps: [{ skill: 'goto', at: [3, 64, 0] }] }, f.ctx);
  expect(out).toMatchObject({ text: 'accepted, not completed', execution: accepted, endsTurn: true });
  expect(f.book.get(scope, experienceId(out))).toMatchObject({ run: f.learning.status().run,
    requestId: 'call-1', attribution: { controller: 'system2' }, execution: { phase: 'completed' },
    before: { position: { x: 0 } }, after: { position: { x: 3 } }, goalVerified: false });
  expect(f.sink).toHaveBeenCalledTimes(1);
});

it('records later terminals, failed dispatches, inline hashes and host-controlled body choices', async () => {
  const f = setup();
  const out = await f.wrap(async () => ({ text: 'waiting', execution: accepted }), 'mymc_script')
    .handler({ name: 'trial', code: 'await bot.move();' }, f.ctx);
  expect(f.book.get(scope, experienceId(out))).toMatchObject({ execution: { terminal: false },
    attribution: { method: { id: 'trial', revision: expect.stringMatching(/^[a-f0-9]{64}$/) } } });
  f.move(2);
  await f.host.pushEvent({ source: 'mymc', type: 'mymc.method', ts: new Date().toISOString(), text: 'done', execution: completed });
  expect(f.book.get(scope, experienceId(out)).after?.position?.x).toBe(2);
  const choice = await f.wrap(async () => ({ text: 'rejected', failed: true }), 'mc_combat_tactic')
    .handler({ choice: { candidate: { id: 'step', kind: 'step' } } }, { ...f.ctx, role: 'host-decision', callId: 'fast-1' });
  expect(f.book.get(scope, experienceId(choice))).toMatchObject({ dispatch: 'rejected', attribution: { controller: 'system1' } });
  const fail = f.wrap(async () => { throw new Error('transport unknown'); });
  await expect(fail.handler({ skill: 'eat' }, { ...f.ctx, callId: 'unknown' })).rejects.toThrow('transport unknown');
  expect(f.book.list(scope).entries.find(r => r.requestId === 'unknown')?.dispatch).toBe('unknown');
});

it('links a fast selected saved method to its original terminal and measured after-state', async () => {
  const f = setup(), revision = 'a'.repeat(64);
  const methodAccepted = { ...accepted, kind: 'method' as const, id: 'body:method-1' };
  const out = await f.wrap(async () => ({ text: 'method started', execution: methodAccepted }), 'mc_combat_tactic')
    .handler({ choice: { decisionId: 'fast-run:1', candidate: { kind: 'method', id: 'supported-step',
      procedure: { handle: `mem:mc-method/short-step/${revision}`, revision } } } },
    { ...f.ctx, role: 'host-decision', callId: 'fast-method' });
  const id = experienceId(out);
  expect(f.book.get(scope, id)).toMatchObject({ attribution: { controller: 'system1', decisionId: 'fast-run:1',
    method: { id: 'short-step', revision } }, execution: { kind: 'method', terminal: false }, goalVerified: false });
  f.move(2);
  await f.host.pushEvent({ source: 'minecraft', type: 'minecraft.method', text: 'method terminal',
    execution: { ...methodAccepted, phase: 'completed', terminal: true } });
  expect(f.book.get(scope, id)).toMatchObject({ execution: { id: methodAccepted.id, phase: 'completed', terminal: true },
    after: { position: { x: 2 } }, goalVerified: false });
});

it('reflection from real receipts is recalled as history without claiming adoption or mastery', async () => {
  const f = setup(), memory = new GameMemoryBook(join(f.data, 'minecraft-memory'));
  const out = await f.wrap(async () => { f.move(2); return { text: 'done', execution: completed }; })
    .handler({ skill: 'goto' }, f.ctx);
  const saved = await f.book.query({ operation: 'reflect', requestId: 'review-1', input: {
    ids: [experienceId(out)], summary: 'short route', lesson: 'verified two block route',
    conditions: 'same supported ground', counterexample: 'unmeasured height', verdict: 'helpful',
  } }, { scope, dimension: 'overworld' }, memory);
  expect(saved.masteryVerified).toBe(false);
  expect(f.host.recallGameLessons!('short route')).toMatchObject([{ currentWorldVerified: false }]);
  const choice = await f.wrap(async () => JSON.stringify({ decisionId: 'd1', status: 'advice', choice: 'route1',
    probability: 0.8, recalledMemoryRefs: [f.host.recallGameLessons!('short route')[0].reference] }), 'mymc_choose')
    .handler({ category: 'route', candidates: [{ id: 'route1', ready: true }, { id: 'inspect', ready: true }] }, { ...f.ctx, callId: 'choice' });
  const row = f.book.get(scope, experienceId(choice));
  expect(row).toMatchObject({ kind: 'decision', execution: null, goalVerified: false });
  expect(row.decision?.recalledMemoryRefs).toHaveLength(1);
  expect(row.attribution.memoryRefs).toBeUndefined();
});

it('preserves explicit host policy/session attribution through the World adapter', async () => {
  const f=setup();
  const policy={layer:'skill' as const,source:'learned' as const,policyId:'skill-selector',revision:'v2',mode:'canary' as const};
  const out=await f.wrap(async()=>({text:'accepted',execution:accepted})).handler({steps:[{skill:'goto',at:[3,64,0]}]},
    {...f.ctx,attribution:{controller:'system1',sessionId:'agent:conversation',decisionId:'decision-7',policy}});
  expect(f.book.get(scope,experienceId(out)).attribution).toMatchObject({controller:'system1',sessionId:'agent:conversation',decisionId:'decision-7',policy});
});

it('missing identity or a storage failure never changes the body result or guesses a scope', async () => {
  const f = setup(); f.disconnect();
  const original = { text: 'body completed', execution: completed };
  expect(await f.wrap(async () => original).handler({ skill: 'goto' }, f.ctx)).toBe(original);
  expect(existsSync(join(f.data, 'minecraft-memory', 'operations'))).toBe(false);
  f.move(1);
  writeFileSync(join(f.data, 'minecraft-memory'), 'not a directory');
  expect(await f.wrap(async () => original).handler({ skill: 'goto' }, { ...f.ctx, callId: 'disk' })).toBe(original);
  expect(f.learning.status()).toMatchObject({ recordingFailures: 2 });
});

it('old host callbacks after detach cannot attribute a new run observation to an old task', async () => {
  const f = setup();
  const out = await f.wrap(async () => ({ text: 'waiting', execution: accepted })).handler({ skill: 'goto' }, f.ctx);
  f.learning.stop();
  f.learning.start({ pushEvent: f.sink, log: nullLogger() } as unknown as WorldHost);
  f.move(100);
  await f.host.pushEvent({ source: 'mymc', type: 'mymc.task', ts: new Date().toISOString(), text: 'late', execution: completed });
  expect(f.book.get(scope, experienceId(out))).toMatchObject({ execution: { terminal: false }, after: { position: { x: 0 } } });
  expect(f.sink).toHaveBeenCalledTimes(1);
});
