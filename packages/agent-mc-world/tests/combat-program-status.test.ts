import { expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import { Worker } from 'node:worker_threads';
import { TacticalMinecraftWorld as QiandengjiEngine } from '../core/tactical-world.ts';
import { combatProgramHash, type CombatProgram } from '../core/combat-program.ts';
import { MINECRAFT_DEFAULTS } from '../core/config.ts';
import type { CombatDecisionFrame } from '../core/combat-decision-types.ts';
import { validCombatTactic } from '../core/combat-tactics.ts';
import { combatRuleBlock, validCombatRules } from '../core/combat-rules.ts';
import { combatRequest } from '../src/decisions/combat-request.ts';

class StatusWorld extends QiandengjiEngine {
  protected override syncRealm() { this.tactics.useRealm('status-test'); }
  update(args: Record<string, unknown>) { return this.setCombatTactic(args); }
  evaluate(program: CombatProgram, health = 20) {
    Object.assign(this, { bridge: { bot: { entity: { position: new Vec3(0,64,0) } } } });
    const frame: CombatDecisionFrame = {
      battlefield: { sampledAtMs: Date.now(), connectionGeneration: 1, dimension: 'overworld',
        self: { entityId: 1, health: { current: health, max: 20, source: 'native', updatedAtMs: 0 },
          food: 20, position: [0,64,0], scoreboardTeam: null },
        action: { fighting: false, emergency: false, taskId: null, step: null,
          targetEntityId: null, sinceHitMs: null, canStep: false },
        actors: [], omitted: 0, server: null },
      tacticRevision: 1, mana: null, skills: [], candidates: [], omittedCandidates: 0, program,
    };
    return this.prepareCombatProgram(frame);
  }
  closeProgram() { this.combatProgram.close(); }
  runner() { return this.combatProgram; }
}

it('keeps concurrent battlefield reads fresh without disabling or borrowing the in-flight policy', async () => {
  const world = new StatusWorld({ cfg: structuredClone(MINECRAFT_DEFAULTS) });
  const program = { name: 'fresh-health', code: 'return {candidates:[],instructions:String(frame.battlefield.self.health.current)};' };
  const emit = Worker.prototype.emit;
  let release: (() => void) | undefined;
  let observed!: () => void;
  const resultReady = new Promise<void>(resolve => { observed = resolve; });
  const delayed = vi.spyOn(Worker.prototype, 'emit').mockImplementation(function (this: Worker, event, ...args) {
    if (event === 'message' && args[0]?.kind === 'result' && !release) {
      release = () => emit.call(this, event, ...args);
      observed();
      return true;
    }
    return emit.call(this, event, ...args);
  });
  let first: Promise<CombatDecisionFrame> | undefined;
  try {
    await world.update({ program });
    first = world.evaluate(program, 20);
    await resultReady;
    const second = await world.evaluate(program, 7);
    expect(second.battlefield.self.health.current).toBe(7);
    expect(second.policy).toBeUndefined();
    expect(await world.update({})).not.toContain('已停止采用');
    expect(second.programDeferred).toEqual({ reason: 'evaluation-in-progress', sourceHash: combatProgramHash(program) });
    expect(combatRequest(second).state.programDeferred).toEqual(second.programDeferred);
    expect(world.runner().status().error).toBeNull();
    const deliver = release!; release = () => {};
    deliver();
    expect((await first).policy?.instructions).toBe('20');
    const next = await world.evaluate(program, 5);
    expect(next.policy?.instructions).toBe('5');
    expect(next.programDeferred).toBeUndefined();
  } finally {
    release?.();
    await first;
    delayed.mockRestore();
    world.closeProgram();
  }
});

it('accepts actual RPG health thresholds without normalizing them to vanilla 20', async () => {
  const world = new StatusWorld({cfg:structuredClone(MINECRAFT_DEFAULTS)});
  const rules=[{id:'reserve',spell:'spark',when:{healthAtOrAbove:30,healthAtOrBelow:45.5,reserveMana:6}}];
  const receipt=await world.update({healAtOrBelow:35.5,rules});
  expect(receipt).toContain('已设置战术');expect(receipt).not.toContain('/20');
  expect(await world.update({})).toContain('35.5');
  expect(validCombatTactic({spells:null,healAtOrBelow:35.5,rules})).toBe(true);
  const facts={health:35,mana:12,manaLoading:false,cost:4,dimension:'overworld',onGround:true,enemies:[{type:'zombie',distance:3}]};
  expect(combatRuleBlock(rules[0],facts)).toBeNull();
  expect(combatRuleBlock(rules[0],{...facts,health:55})).toBe('未到此分支血线');
  expect(combatRuleBlock(rules[0],{...facts,mana:8})).toBe('施法后保留魔力不足或读数未知');
  for(const value of [Infinity,NaN,0,-1]) {
    expect(await world.update({healAtOrBelow:value})).toContain('未设置');
    expect(validCombatTactic({spells:null,healAtOrBelow:value})).toBe(false);
    expect(validCombatRules([{id:'bad',spell:'spark',when:{healthAtOrBelow:value}}])).toBe(false);
  }
});

it.each(['exceeded evaluation budget', 'worker response timed out', 'startup timed out'])
('retries a program after %s only once on a later sample while ordinary fallback stays available', async reason => {
  const world = new StatusWorld({ cfg: structuredClone(MINECRAFT_DEFAULTS) });
  const program={name:'bounded-recovery',code:'return {candidates:[],instructions:"fresh"};'};
  let now=Date.now(); const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
  const run=vi.spyOn(world.runner(),'run');
  try {
    await world.update({program});
    run.mockRejectedValueOnce(new Error('Combat program '+reason));
    expect((await world.evaluate(program)).policy).toBeUndefined();
    expect((await world.evaluate(program)).policy).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
    now+=1001;
    expect((await world.evaluate(program)).policy?.name).toBe(program.name);
    run.mockRejectedValueOnce(new Error('Combat program '+reason));
    expect((await world.evaluate(program)).policy).toBeUndefined();
    now+=10001;
    expect((await world.evaluate(program)).policy).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(3);
  } finally {clock.mockRestore();run.mockRestore();world.closeProgram();}
});

it('retains an adoption failure in a rule-only receipt until an authored program revision is installed', async () => {
  const world = new StatusWorld({ cfg: structuredClone(MINECRAFT_DEFAULTS) });
  const invalid = { name: 'missing-instructions', code: 'return {candidates:[]};' };
  try {
    await world.update({ program: invalid });
    expect((await world.evaluate(invalid)).policy).toBeUndefined();
    const receipt = await world.update({ healAtOrBelow: 8, rules: [] });
    expect(receipt).toContain(combatProgramHash(invalid));
    expect(receipt).toContain('已停止采用');
    expect(receipt).toContain('Program must return candidates');
    expect(receipt).not.toContain('已编译，实战效果待核验');
    expect(await world.update({})).toContain('Program must return candidates');

    const revision = { name: 'corrected-return', code: 'return {candidates:[],instructions:"No eligible action"};' };
    const revised = await world.update({ program: revision });
    expect(revised).not.toContain('已停止采用');
    const ready = await world.evaluate(revision);
    expect(ready.policy).toMatchObject({ name: revision.name, sourceHash: combatProgramHash(revision) });
    expect(ready.candidates).toEqual([]);
  } finally { world.closeProgram(); }
});
