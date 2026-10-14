import { afterEach, describe, expect, it, vi } from 'vitest';
import { Worker } from 'node:worker_threads';
import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import { CombatProgramRunner, combatProgramCandidates, COMBAT_PROGRAM_LIMITS } from '../core/combat-program.ts';
import { CombatDecisionLoop, type CombatDecisionFrame } from '../src/decisions/combat-decision.ts';
import { combatReactions } from '../core/combat-reactions.ts';
import { COMBAT_DECISION_DEFAULTS } from '../src/decisions/defaults.ts';
import { CombatTacticBook } from '../core/combat-tactics.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const runners: CombatProgramRunner[] = [];
const dirs: string[] = [];
afterEach(() => { runners.splice(0).forEach(r => r.close()); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });
const runner = () => { const r = new CombatProgramRunner(); runners.push(r); return r; };
function frame(): CombatDecisionFrame {
  return { battlefield: { sampledAtMs: Date.now(), connectionGeneration: 1, dimension: 'overworld',
    self: { entityId: 1, health: { current: 20, max: 20, source: 'native', updatedAtMs: 0 }, food: 20,
      position: [0, 64, 0], scoreboardTeam: null },
    action: { fighting: true, emergency: false, taskId: null, step: null, targetEntityId: 2, sinceHitMs: 20, canStep: true },
    actors: [{ entityId: 2, uuid: null, type: 'skeleton', name: null, relation: 'hostile', relationSource: 'hostile-type',
      scoreboardTeam: null, health: { current: 10, max: 20, source: 'native', updatedAtMs: 0 }, position: [3, 64, 0],
      distance: 3, lineOfSight: true, targetEntityId: null }], omitted: 0, server: null },
    tacticRevision: 1, mana: 12, skills: [], candidates: [], omittedCandidates: 0 };
}

describe('agent-authored combat programs', () => {
  it('executes authored geometry and revised parameters in a real isolated worker', async () => {
    const r = runner(), f = frame();
    const p = { name: 'spacing', code: `const [x,y,z] = frame.battlefield.self.position;
      return {candidates:[{id:'spacing',kind:'step',intent:'Create room to attack',destination:[x+params.dx,y,z]}],instructions:'Prefer space.'};`, params: { dx: .6 } };
    const first = combatProgramCandidates(await r.run(p, f), f, () => true);
    expect(first.candidates[0]).toMatchObject({ destination: [.6, 64, 0] });
    p.params.dx = -.8;
    expect(combatProgramCandidates(await r.run(p, f), f, () => true).candidates[0]).toMatchObject({ destination: [-.8, 64, 0] });
    expect(r.status().error).toBeNull();
  });

  it('has no process, module or network capabilities and cannot mutate an observation', async () => {
    const r = runner();
    const p = { name: 'capabilities', code: `return {candidates:[],instructions:[typeof process,typeof require,typeof fetch,typeof mc,typeof run,typeof Script].join(',')};` };
    expect((await r.run(p, frame())).instructions).toBe('undefined,undefined,undefined,undefined,undefined,undefined');
    await expect(r.run({ ...p, code: `frame.battlefield.self.position[0]=99; return {candidates:[],instructions:''};` }, frame())).rejects.toThrow();
  });

  it('revokes an infinite program without blocking the game clock and accepts a revision', async () => {
    const r = runner();
    const bad = { name: 'bad-loop', code: 'while (true) {}' };
    await r.configure(bad);
    let clockAdvanced = false;
    const clock = new Promise<void>(resolve => setTimeout(() => { clockAdvanced = true; resolve(); }, 5));
    await expect(r.run(bad, frame())).rejects.toThrow('budget');
    await clock; expect(clockAdvanced).toBe(true);
    await expect(r.run(bad, frame())).rejects.toThrow('budget');
    expect((await r.run({ name: 'revision', code: `return {candidates:[],instructions:'Corrected'};` }, frame())).instructions).toBe('Corrected');
  });

  it('keeps a completed worker result when delivery exceeds the evaluation budget', async () => {
    const r = runner(), p = { name: 'simple', code: `return {candidates:[],instructions:'Completed'};` };
    await r.configure(p);
    const emit = Worker.prototype.emit;
    const delayed = vi.spyOn(Worker.prototype, 'emit').mockImplementation(function (this: Worker, event, ...args) {
      if (event === 'message' && args[0]?.kind === 'result') {
        setTimeout(() => emit.call(this, event, ...args), COMBAT_PROGRAM_LIMITS.evaluationMs * 2);
        return true;
      }
      return emit.call(this, event, ...args);
    });
    try {
      await expect(r.run(p, frame())).resolves.toMatchObject({ instructions: 'Completed' });
      expect(r.status().error).toBeNull();
      expect(r.status().evaluationMs).toBeLessThan(COMBAT_PROGRAM_LIMITS.evaluationMs);
      expect(r.status().roundTripMs).toBeGreaterThanOrEqual(COMBAT_PROGRAM_LIMITS.evaluationMs * 2);
    } finally { delayed.mockRestore(); }
  });

  it('limits synchronous code invoked by output serialization inside the worker', async () => {
    const r = runner();
    await expect(r.run({ name: 'getter-loop', code: `return {get candidates(){while(true){}},instructions:''};` }, frame()))
      .rejects.toThrow('evaluation budget');
    expect(r.status().error).toContain('evaluation budget');
  });

  it('cancels worker startup and rejects malformed syntax before changing a tactic', async () => {
    const r = runner();
    const starting = r.configure({ name: 'draft', code: 'return {candidates:[],instructions:""};' });
    const assertion = expect(starting).rejects.toThrow('revoked');
    r.close(); await assertion;
    await expect(r.configure({ name: 'syntax', code: 'return (' })).rejects.toThrow();
  });

  it('checks custom movement against current geometry, body ownership and the physical envelope', () => {
    const f = frame();
    const c = { id: 'custom', kind: 'step', intent: 'Change angle', destination: [.7, 64, 0] };
    const output = { candidates: [c], instructions: 'Change angle.' };
    expect(combatProgramCandidates(output, f, () => true).candidates).toHaveLength(1);
    expect(() => combatProgramCandidates(output, f, () => false)).toThrow('Unsafe');
    c.destination[0] = COMBAT_PROGRAM_LIMITS.stepBlocks + .01;
    expect(() => combatProgramCandidates(output, f, () => true)).toThrow('Unsafe');
    c.destination[0] = .7; f.battlefield.action.canStep = false;
    expect(() => combatProgramCandidates(output, f, () => true)).toThrow('unavailable');
    f.battlefield.action.canStep = true; f.battlefield.action.emergency = true;
    expect(() => combatProgramCandidates(output, f, () => true)).toThrow('Emergency');
  });

  it('cannot invent a learned spell or engage an actor outside the executable pool', () => {
    const f = frame();
    expect(() => combatProgramCandidates({ candidates: [{ id: 'fake', kind: 'cast', spell: 'unknown',
      ruleId: 'fake', manaCost: 0, intent: 'Cast' }], instructions: '' }, f, () => true)).toThrow('Unavailable');
    expect(() => combatProgramCandidates({ candidates: [{ id: 'fake', kind: 'engage', targetId: 2,
      uuid: null, intent: 'Engage' }], instructions: '' }, f, () => true)).toThrow('Unavailable');
  });

  it('offers all safe directions before a stall while the authored program decides which to use', () => {
    const f = frame();
    const bot = { entity: { position: new Vec3(0,64,0), onGround: true }, blockAt: (p: Vec3) => p.y < 64
      ? { boundingBox: 'block', name: 'stone', shapes: [[0,0,0,1,1,1]], getProperties: () => ({}) }
      : { boundingBox: 'empty', name: 'air', shapes: [], getProperties: () => ({}) } } as unknown as Bot;
    const cfg = { ...COMBAT_DECISION_DEFAULTS, allowMovement: true };
    const control = { bodyFree: false, canStep: true, targetId: 2, sinceHitMs: 20, fight: 'armed', fleeHealth: 6, chaseMax: 12 };
    expect(combatReactions(bot, f.battlefield, cfg, control)).toEqual([]);
    const pool = combatReactions(bot, f.battlefield, cfg, control, true);
    expect(pool.filter(c => c.kind === 'step')).toHaveLength(8);
    expect(pool.some(c => c.kind === 'retreat')).toBe(true);
  });

  it('persists authored versions and preserves the old source in an encounter receipt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'combat-program-')); dirs.push(dir);
    const file = join(dir, 'book.json'), book = new CombatTacticBook(file); book.useRealm('test-world');
    const p = { name: 'v1', code: 'return {candidates:[],instructions:""};', params: { distance: .7 } };
    book.set({ spells: null, healAtOrBelow: null, program: p });
    const report = book.record({ startedAt: new Date(0).toISOString(), endedAt: new Date(1000).toISOString(),
      reason: 'flee', healthBefore: 12, healthAfter: 10, kills: {}, swings: 2, meleeLanded: 1, arrows: 0, rangedLanded: 0 }, []);
    book.set({ spells: null, healAtOrBelow: null, program: { ...p, name: 'v2', params: { distance: .9 } } });
    const replacement = new CombatTacticBook(file); replacement.useRealm('test-world');
    expect(replacement.current().tactic?.program?.params).toEqual({ distance: .9 });
    expect(replacement.current().reports.find(r => r.id === report.id)?.tacticAtEnd?.program?.params).toEqual({ distance: .7 });
  });

  it('passes authored instructions to the fast model and records physical change without waiting for main', async () => {
    const r = runner(), f = frame();
    f.program = { name: 'local-step', code: `const [x,y,z] = frame.battlefield.self.position;
      return {candidates:[{id:'local',kind:'step',destination:[x+.5,y,z],intent:'Take room'}],instructions:'Maintain a little space.'};` };
    let applied = false;
    let request: Record<string, unknown> = {};
    const reports: Array<{ event: string; data: Record<string, unknown> }> = [];
    const loop = new CombatDecisionLoop({ config: () => ({ ...COMBAT_DECISION_DEFAULTS,
      enabled: true, mode: 'act', endpoint: 'http://decision.invalid', maxAgeMs: 2000 }),
      sample: () => structuredClone(f), prepare: async input => ({ ...input,
        ...combatProgramCandidates(await r.run(input.program!, input), input, () => true),
        policy: { name: 'local-step', sourceHash: 'test-source', instructions: 'Maintain a little space.' } }),
      fetchImpl: (async (_url, init) => { request = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ answers: { tactic: { type: 'choice', choice: 'option_0', confidence: .99,
          probabilities: { keep: .01, option_0: .99 } } } })); }) as typeof fetch,
      apply: () => { applied = true; f.battlefield.self.position[0] = .5; f.battlefield.self.health.current = 19; return true; },
      report: (event, data) => reports.push({ event, data }) });
    expect(loop.tick()).toBe(true);
    await expect.poll(() => applied).toBe(true);
    expect(JSON.stringify(request)).toContain('Maintain a little space');
    expect(JSON.stringify(request)).not.toContain('const [x');
    await expect.poll(() => reports.some(r => r.event === 'observation'), { timeout: 2500 }).toBe(true);
    expect((loop.inspect(1) as { observation: unknown }).observation).toMatchObject({ verified: true,
      displacement: .5, healthBefore: 20, healthAfter: 19 });
  });
});
