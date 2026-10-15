import { expect, it, vi } from 'vitest';
import { Vec3 } from 'vec3';
import { TacticalMinecraftWorld as QiandengjiEngine } from '../core/tactical-world.ts';
import { combatProgramHash, type CombatProgram } from '../core/combat-program.ts';
import { MINECRAFT_DEFAULTS } from '../core/config.ts';
import type { CombatDecisionFrame } from '../core/combat-decision-types.ts';

class StatusWorld extends QiandengjiEngine {
  protected override syncRealm() { this.tactics.useRealm('status-test'); }
  update(args: Record<string, unknown>) { return this.setCombatTactic(args); }
  evaluate(program: CombatProgram) {
    Object.assign(this, { bridge: { bot: { entity: { position: new Vec3(0,64,0) } } } });
    const frame: CombatDecisionFrame = {
      battlefield: { sampledAtMs: Date.now(), connectionGeneration: 1, dimension: 'overworld',
        self: { entityId: 1, health: { current: 20, max: 20, source: 'native', updatedAtMs: 0 },
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

it('retries a timed-out program only once on a later sample while ordinary fallback stays available', async () => {
  const world = new StatusWorld({ cfg: structuredClone(MINECRAFT_DEFAULTS) });
  const program={name:'bounded-recovery',code:'return {candidates:[],instructions:"fresh"};'};
  let now=Date.now(); const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
  const run=vi.spyOn(world.runner(),'run');
  try {
    await world.update({program});
    run.mockRejectedValueOnce(new Error('Combat program exceeded evaluation budget'));
    expect((await world.evaluate(program)).policy).toBeUndefined();
    expect((await world.evaluate(program)).policy).toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
    now+=1001;
    expect((await world.evaluate(program)).policy?.name).toBe(program.name);
    run.mockRejectedValueOnce(new Error('Combat program exceeded evaluation budget'));
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
