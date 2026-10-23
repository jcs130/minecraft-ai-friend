import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { expect, it } from 'vitest';
import { CombatAbilities } from '../core/combat-abilities.ts';
import { combatEntityTypeMatches, combatRuleBlock } from '../core/combat-rules.ts';
import type { Battlefield } from '../core/battlefield.ts';
import { combatReactions } from '../core/combat-reactions.ts';
import { combatRequest } from '../src/decisions/combat-request.ts';

function scene(type = 'zombie') {
  const bot = { entity: { id: 1, position: new Vec3(0,64,0), onGround: true }, health: 24,
    game: { dimension: 'overworld' }, entities: { 7: { id: 7, name: type, position: new Vec3(3,64,0), isValid: true } } } as unknown as Bot;
  const field: Battlefield = { sampledAtMs: 1000, connectionGeneration: 1, dimension: 'overworld',
    self: { entityId: 1, health: { current: 24, max: null, source: 'native', updatedAtMs: 1000 }, food: 20,
      position: [0,64,0], scoreboardTeam: null },
    action: { fighting: true, emergency: false, taskId: null, step: null, targetEntityId: 7, canStep: false },
    actors: [{ entityId: 7, uuid: 'target', type, name: null, relation: 'hostile', relationSource: 'hostile-type',
      scoreboardTeam: null, health: { current: 20, max: null, source: 'native', updatedAtMs: 1000 },
      position: [3,64,0], distance: 3, lineOfSight: true, targetEntityId: null }], omitted: 0, server: null };
  const abilities = new CombatAbilities();
  abilities.setTactic({ spells: null, healAtOrBelow: null, rules: [
    { id: 'bolt', spell: 'starbolt', intent: 'Hit the visible hostile.', when: { enemyTypes: ['minecraft:zombie'], within: 10 } },
  ] });
  abilities.noteAbilities([{ id: 'starbolt', manaCost: 4, cooldownMs: 1000, cooldownRemainingMs: 0 }], 1000);
  abilities.noteMana(42,1000);
  return { bot, field, abilities };
}

it('offers and selects an authored namespaced spell rule against the bare native entity ID without rewriting the tactic', () => {
  const { bot, field, abilities } = scene();
  const before = abilities.getTactic();
  const frame = abilities.decisionFrame(bot,field,6,1000);
  expect(frame.skills).toMatchObject([{ spell:'starbolt',available:true,manaCost:4,cooldownRemainingMs:0,block:null }]);
  expect(frame.candidates).toMatchObject([{ id:'bolt',kind:'cast',spell:'starbolt' }]);
  expect(abilities.next(bot,true,1000)).toBe('starbolt');
  expect(abilities.getTactic()).toEqual(before);
  abilities.noteMana(null,1000);
  expect(abilities.decisionFrame(bot,field,6,1000).candidates).toEqual([]);
});

it('keeps custom namespaces and unknown observations distinct instead of matching by basename', () => {
  expect(combatEntityTypeMatches('zombie','minecraft:zombie')).toBe(true);
  expect(combatEntityTypeMatches('minecraft:zombie','zombie')).toBe(true);
  expect(combatEntityTypeMatches('rpg:zombie','zombie')).toBe(false);
  expect(combatEntityTypeMatches('zombie','rpg:zombie')).toBe(false);
  expect(combatEntityTypeMatches('rpg:zombie','rpg:zombie')).toBe(true);
  expect(combatEntityTypeMatches(null,'zombie')).toBe(false);
  expect(combatEntityTypeMatches('','')).toBe(false);
  const {bot,field,abilities}=scene('rpg:zombie');
  expect(abilities.decisionFrame(bot,field,6,1000).candidates).toEqual([]);
  expect(combatRuleBlock({id:'z',spell:'starbolt',when:{enemyTypes:['minecraft:zombie']}},
    {health:24,mana:42,manaLoading:false,cost:4,dimension:'overworld',onGround:true,
      enemies:[{type:'rpg:zombie',distance:3},{type:'',distance:3}]})).not.toBeNull();
});

it('reserves ceasefire observation for authored programs and exposes the current attack', () => {
  const {bot,field,abilities}=scene();
  const cfg={maxEntities:12,maxCandidates:6,allowMovement:true,allowEngage:true,engageScope:'hostile' as const,movementStallMs:1500};
  const control={bodyFree:false,canStep:false,targetId:7,sinceHitMs:300,fight:'auto',fleeHealth:6,chaseMax:12,trackingTargets:new Set([7])};
  expect(combatReactions(bot,field,cfg,control).some(x=>x.kind==='track')).toBe(false);
  const reaction=combatReactions(bot,field,cfg,control,true);
  const track=reaction.find(x=>x.kind==='track')!;
  expect(track).toMatchObject({targetId:7,minDistance:5,maxDistance:8,leaseMs:4000});
  const request=combatRequest({...abilities.decisionFrame(bot,field,6,1000),candidates:[track]});
  expect(request.questions.tactic.criteria.keep).toContain('attacking entityId:7');
  expect(request.questions.tactic.criteria.option_0).toContain('Stop current attacks');
  expect(request.questions.tactic.criteria.option_0).toContain('hostile zombie');
  expect(request.state.options.option_0).toMatchObject({kind:'track',targetId:7});
  field.action.fighting=false;field.action.followTarget='Companion';field.action.taskId=9;
  const follow=combatRequest({...abilities.decisionFrame(bot,field,6,1000),candidates:[]});
  expect(follow.questions.tactic.criteria.keep).toContain('explicit follow task for Companion');
  expect(follow.questions.tactic.criteria.keep).not.toContain('idle');
});
