import { describe, expect, it } from 'vitest';
import { combatRequest } from '../src/decisions/combat-request.ts';
import type { CombatDecisionFrame } from '../core/combat-decision-types.ts';

describe('compact combat inference evidence', () => {
  it('preserves distinct candidate intent for two targets and two short-step directions', () => {
    const f = { battlefield: { sampledAtMs: 100, connectionGeneration: 1, dimension: 'overworld',
      self: { entityId: 1, health: { current: 20, max: 20, source: 'native', updatedAtMs: 100 }, food: 20,
        position: [0,64,0], scoreboardTeam: null }, action: { fighting: true, emergency: false, taskId: null, step: null },
      actors: [], omitted: 0, server: null }, tacticRevision: 1, mana: null, skills: [], omittedCandidates: 0,
      candidates: [
        { id:'a',kind:'engage',targetId:2,uuid:'a',intent:'Attack the ranged skeleton at 6 blocks.' },
        { id:'b',kind:'engage',targetId:3,uuid:'b',intent:'Attack the zombie at 2 blocks.' },
        { id:'c',kind:'step',destination:[0,64,1],intent:'Step sideways while attacking.' },
        { id:'d',kind:'step',destination:[0,64,-1],intent:'Step away while attacking.' },
      ] } as CombatDecisionFrame;
    const input = combatRequest(f);
    f.candidates.forEach((candidate,index)=>expect(input.questions.tactic.criteria[`option_${index}`]).toContain(candidate.intent));
    expect(input.questions.tactic.criteria.option_0).toContain('entityId:2');
    expect(input.questions.tactic.criteria.option_1).toContain('entityId:3');
    f.candidates[1].intent=f.candidates[0].intent;
    const sameWords=combatRequest(f).questions.tactic.criteria;
    expect(sameWords.option_0).not.toEqual(sameWords.option_1);
    expect(input.state.options.option_0).toMatchObject({targetId:2});
    expect(input.state.options.option_1).toMatchObject({targetId:3});
  });
  it('preserves unknown sight/health, relation provenance, controller and option constraints without method source', () => {
    const frame: CombatDecisionFrame = { battlefield: { sampledAtMs: 5000, connectionGeneration: 4, dimension: 'overworld',
      self: { entityId: 1, health: { current: 6, max: null, source: 'native', updatedAtMs: 4990 }, food: 8,
        position: [10, 64, 20], scoreboardTeam: null, equipment: { held: 'wooden_sword', armor: null } },
      action: { fighting: false, emergency: false, taskId: 9, step: 'move', canStep: false },
      actors: [{ entityId: 2, uuid: 'identity-checked-locally', type: 'player', name: 'Visitor', relation: 'unknown',
        relationSource: 'unknown', scoreboardTeam: null, health: { current: null, max: null, source: 'unknown', updatedAtMs: null },
        position: null, distance: null, lineOfSight: null, targetEntityId: 1 }], omitted: 3, server: null },
      tacticRevision: 7, mana: null, skills: [{ spell: 'spark', available: false, manaCost: 4, cooldownRemainingMs: null, block: 'No confirmed cooldown' }],
      candidates: [{ id: 'watch', intent: 'Observe without attacking.', kind: 'track', targetId: 2, uuid: 'identity-checked-locally', minDistance: 5, maxDistance: 8, leaseMs: 1000 }],
      omittedCandidates: 2, policy: { name: 'method', sourceHash: 'version', instructions: 'Never engage unknown players.' } };
    const input = combatRequest(frame);
    expect(input.state).toMatchObject({ mana: null,
      battlefield: { self: { health: [6, null, 'native', 10], equipment: { held: 'wooden_sword' } },
        action: { taskId: 9, canStep: false }, omitted: 3,
        actors: [{ relation: 'unknown', relationSource: 'unknown', distance: null, lineOfSight: null, health: [null, null, 'unknown', null] }] },
      skills: [{ available: false, cooldownRemainingMs: null, blocked: true }], omittedCandidates: 2,
      options: { option_0: { kind: 'track', targetId: 2, minDistance: 5, maxDistance: 8, leaseMs: 1000 } } });
    expect(input.questions.tactic.instructions).toContain('Never engage unknown players.');
    expect(input.state).not.toHaveProperty('sampledAtMs');
    expect(frame.skills[0].block).toBe('No confirmed cooldown');
    expect(input.state.skills[0]).not.toHaveProperty('block');
    expect(JSON.stringify(input)).not.toContain('identity-checked-locally');
    expect(frame.candidates[0]).toHaveProperty('uuid', 'identity-checked-locally');
    frame.battlefield.self.health.current = 0.0000345678;
    frame.mana = 13.880000000000024;
    const precise = combatRequest(frame);
    expect(precise.state.battlefield.self.health[0]).toBeGreaterThan(0);
    expect(precise.state.mana).toBe(13.88);
    expect(frame.battlefield.self.health.current).toBe(0.0000345678);
  });
});
