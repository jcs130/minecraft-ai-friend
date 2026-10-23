import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { TacticalMinecraftWorld } from '../core/tactical-world.ts';
import { MINECRAFT_DEFAULTS } from '../core/config.ts';
import { HostCombatDriver } from '../src/decisions/combat-driver.ts';
import { validCombatRoutines } from '../core/combat-routines.ts';
import { methodHarness, methodEnded } from './method-harness.ts';
import type { CombatCandidate, CombatDecisionFrame } from '../core/combat-decision-types.ts';
import type { ToolOutcome } from '../src/contracts/host.ts';

class FastWorld extends TacticalMinecraftWorld {
  frame() { return this.sampleCombatDecision(); }
  prepare(frame: CombatDecisionFrame) { return this.prepareCombatProgram(frame); }
}
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'fast-routines-'));
  const world = new FastWorld({ cfg: structuredClone(MINECRAFT_DEFAULTS), dataDir: dir });
  const r = methodHarness('1.21.1', () => world);
  const script = world.tools().find(t => t.name === 'mc_script')!;
  const tactic = world.tools().find(t => t.name === 'mc_combat_tactic')!;
  const call = (args: Record<string, unknown>) => script.handler(args, { role: 'main', log: r.host.log });
  const update = (args: Record<string, unknown>) => tactic.handler(args, { role: 'main', log: r.host.log });
  async function save(code: string, parent: string | null = null) {
    await call({ name: 'short-step', code, validate: true });
    const validation = await methodEnded(r, r.runner.read().at(-1)!.id);
    expect(validation.status).toBe('validated');
    const result = await call({ library: { op: 'save', id: 'short-step', code, description: 'Measure one supported short step',
      conditions: ['Loaded supported floor; no other body task'], parent, validationRunId: validation.id } });
    return JSON.parse(typeof result === 'string' ? result : result.text).reference;
  }
  const choose = (candidate: CombatCandidate, frame = world.frame()!) => tactic.handler({ choice: {
    candidate, tacticRevision: frame.tacticRevision, connectionGeneration: frame.battlefield.connectionGeneration,
    decisionId: 'test-decision:1' } }, { role: 'host-decision', log: r.host.log });
  return { ...r, world, call, update, save, choose, close() { r.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const code = 'const before=await mc.state();const action=await mc.do([{skill:"control",keys:["forward"],durationMs:150}]);return {done:action.done,before:before.snapshot.position,after:action.state.snapshot.position};';

it('a fast choice starts the exact saved script and its real SDK movement before the main model returns', async () => {
  const r = setup(); let finishMain!: () => void, mainReturned = false;
  const main = new Promise<void>(resolve => { finishMain = resolve; }).then(() => { mainReturned = true; });
  const admissions: ToolOutcome[] = [];
  let driver: HostCombatDriver | undefined;
  try {
    const reference = await r.save(code), start = r.bot.entity.position.clone();
    await r.update({ routines: [{ id: 'supported-step', intent: 'Take the saved short step on confirmed supported ground', procedure: reference }] });
    expect(r.bot.entity.position).toEqual(start);
    expect(r.world.frame()?.candidates).toMatchObject([{ kind: 'method', procedure: reference }]);
    driver = new HostCombatDriver(() => ({ hostDecisions: { combat: { enabled: true, connection: 'host', mode: 'act',
      timeoutMs: 1000, maxAgeMs: 1500 } } }), {
      call: async (args, signal) => {
        const result = await r.world.tools().find(t => t.name === 'mc_combat_tactic')!.handler(args, { role: 'host-decision', log: r.host.log, signal });
        if (args.choice && typeof result !== 'string') admissions.push(result);
        return result;
      }, report() {}, decisions: { request: async input => {
        const state = input.state as { options: Record<string, { kind: string }> };
        const choice = Object.keys(state.options).find(key => state.options[key].kind === 'method')!;
        const keys = Object.keys(input.questions.tactic.criteria);
        return { answers: { tactic: { choice, confidence: .99,
          probabilities: Object.fromEntries(keys.map(key => [key, key === choice ? .99 : .01 / (keys.length - 1)])) } } };
      } },
    });
    driver.start();
    await vi.waitFor(() => expect(admissions).toHaveLength(1));
    const admission = admissions[0];
    const receipt = admission.meta?.receipt as { accepted: boolean; runId: number; method: { revision: string } };
    expect(receipt).toMatchObject({ accepted: true, method: { revision: reference.revision } });
    expect(admission.execution).toMatchObject({ kind: 'method', phase: 'accepted', terminal: false, goalCompleted: false });
    const run = await methodEnded(r, receipt.runId);
    expect(run.status).toBe('completed');
    expect(run.procedure?.reference).toEqual(reference);
    expect(run.trace.some(t => t.method === 'do' && (t.result as { done?: boolean })?.done)).toBe(true);
    expect((run.result as { after: { z: number } }).after.z).not.toBe(start.z);
    expect(mainReturned).toBe(false);
  } finally { driver?.stop(); finishMain(); await main; r.close(); }
});

it('method revisions and rollback keep the pinned source; registration never follows the newest same-name code', async () => {
  const r = setup();
  try {
    const first = await r.save(code);
    await r.update({ routines: [{ id: 'step', intent: 'Run version one', procedure: first }] });
    const second = await r.save('return {revision:2};', first.revision);
    const frame = r.world.frame()!, candidate = frame.candidates[0];
    expect(candidate).toMatchObject({ kind: 'method', procedure: first });
    const admission = await r.choose(candidate, frame) as ToolOutcome;
    const run = await methodEnded(r, Number((admission.meta?.receipt as { runId: number }).runId));
    expect(run.procedure?.reference).toEqual(first);
    expect(run.procedure?.versions[0]).toMatchObject({ revision: first.revision, parent: null,
      author: { kind: 'agent', role: 'main' } });
    expect((run.result as { done: boolean }).done).toBe(true);
    await r.update({ routines: [{ id: 'step', intent: 'Run revised version', procedure: second }] });
    const secondAdmission = await r.choose(r.world.frame()!.candidates[0]) as ToolOutcome;
    expect((await methodEnded(r, (secondAdmission.meta?.receipt as { runId: number }).runId)).result).toEqual({ revision: 2 });
    await r.update({ routines: [{ id: 'step', intent: 'Restore original version', procedure: first }] });
    expect(r.world.frame()!.candidates[0]).toMatchObject({ procedure: first });
  } finally { r.close(); }
});

it('an authored candidate order survives preparation; new body work invalidates a late method selection', async () => {
  const r = setup();
  try {
    const reference = await r.save('return await mc.do([{skill:"control",keys:["forward"],durationMs:1000}]);');
    await r.update({ routines: [{ id: 'a', intent: 'First script', procedure: reference }, { id: 'b', intent: 'Second script', procedure: reference }],
      program: { name: 'prefer-b', code: 'return {candidates:frame.actionPool.filter(c=>c.kind==="method").reverse(),instructions:"Choose from my ordered shortlist"};' } });
    const frame = await r.world.prepare(r.world.frame()!);
    expect(frame.candidates.map(c => c.id)).toEqual(['b', 'a']);
    const altered = await r.choose({ ...frame.candidates[0], params: { unregistered: true } } as CombatCandidate, frame) as ToolOutcome;
    expect(altered.meta?.receipt).toMatchObject({ accepted: false });
    expect(r.runner.current).toBeNull();
    const accepted = await r.choose(frame.candidates[0], frame) as ToolOutcome;
    const started = (accepted.meta?.receipt as { runId: number }).runId;
    const late = await r.choose(frame.candidates[1], frame) as ToolOutcome;
    expect(late.meta?.receipt).toMatchObject({ accepted: false });
    expect(late.execution).toBeUndefined();
    expect(r.runner.current?.id).toBe(started);
    await methodEnded(r, started);
  } finally { await r.update({ enabled: false }); r.close(); }
});

it('unresolved, mutable or mismatched references cannot register a substitute method', async () => {
  const r = setup();
  try {
    const reference = await r.save(code);
    const invalid = { id: 'step', intent: 'Move', procedure: { ...reference, revision: '0'.repeat(64) } };
    expect(validCombatRoutines([invalid])).toBe(false);
    await r.update({ routines: [invalid] });
    expect(r.world.frame()!.candidates).toEqual([]);
    const missing = { ...reference, handle: 'mem:mc-method/missing/' + reference.revision };
    const outcome = await r.update({ routines: [{ id: 'missing', intent: 'Unavailable method', procedure: missing }] });
    expect(typeof outcome === 'string' ? outcome : outcome.text).toContain('未设置');
    expect(r.world.frame()!.candidates).toEqual([]);
  } finally { r.close(); }
});
