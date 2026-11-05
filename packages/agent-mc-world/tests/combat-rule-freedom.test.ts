import { expect, it } from 'vitest';
import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import { CombatAbilities } from '../core/combat-abilities.ts';
import { COMBAT_RULES_SCHEMA, combatRulesError, validCombatRules } from '../core/combat-rules.ts';
import { TacticalMinecraftWorld } from '../core/tactical-world.ts';
import { MINECRAFT_DEFAULTS } from '../core/config.ts';
import { validCombatTactic } from '../core/combat-tactics.ts';

class RuleWorld extends TacticalMinecraftWorld {
  protected override syncRealm() { this.tactics.useRealm('rule-test'); }
  update(args: Record<string, unknown>) { return this.setCombatTactic(args); }
  tactic() { return this.tactics.getTactic(); }
}

it('accepts agent-chosen observation and RPG thresholds without inventing engine ceilings', async () => {
  const rules = [{ id: 'range', spell: 'starbolt', when: { within: 20, manaAtLeast: 20000, reserveMana: 12000, hostilesAtMost: 100 } }];
  expect(validCombatRules(rules)).toBe(true);
  expect(validCombatTactic({spells:null,healAtOrBelow:null,rules})).toBe(true);
  for (const key of ['within', 'manaAtLeast', 'reserveMana', 'hostilesAtMost'] as const)
    expect(COMBAT_RULES_SCHEMA.items.properties.when.properties[key]).not.toHaveProperty('maximum');
  const world = new RuleWorld({cfg: structuredClone(MINECRAFT_DEFAULTS)});
  expect(await world.update({rules})).toContain('已设置战术');
  expect(world.tactic()?.rules).toEqual(rules);
});

it.each([
  [{within:Infinity}, 'within'], [{within:NaN}, 'within'], [{within:'20'}, 'within'],
  [{hostilesAtLeast:1.5}, 'hostilesAtLeast'], [{manaAtLeast:-1}, 'manaAtLeast'],
  [{hostilesAtLeast:3,hostilesAtMost:2}, 'hostilesAtMost'],
  [{healthAtOrAbove:60,healthAtOrBelow:50}, 'healthAtOrAbove'],
  [{radius:20}, 'radius'], [{onGround:'true'}, 'onGround'],
])('rejects invalid conditions with an exact field: %j', (when, field) => {
  const rules=[{id:'bad',spell:'starbolt',when}];
  expect(validCombatRules(rules)).toBe(false);
  expect(combatRulesError(rules)?.path).toBe(`rules[0].when.${field}`);
});

it('rejects duplicate IDs and unknown prototype-named conditions without throwing', () => {
  expect(combatRulesError([{id:'a',spell:'starbolt',when:{}},{id:'a',spell:'starbolt',when:{}}])?.path).toBe('rules[1].id');
  expect(combatRulesError([{id:'a',spell:'starbolt',when:{constructor:20}}])?.path).toBe('rules[0].when.constructor');
  expect(validCombatRules([])).toBe(true);
});

it('keeps default spell distance, observed abilities and cooldowns separate from authored radius', () => {
  const abilities = new CombatAbilities();
  const enemy={name:'zombie',isValid:true,position:new Vec3(18,64,0)};
  const bot={health:20,entity:{position:new Vec3(0,64,0)},entities:{7:enemy}} as unknown as Bot;
  abilities.setTactic({spells:['starbolt'],healAtOrBelow:null});
  abilities.noteMana(40,1000);
  abilities.noteAbilities([{id:'starbolt',manaCost:4,cooldownMs:1000,cooldownRemainingMs:0}],1000);
  expect(abilities.next(bot,true,1000)).toBeNull();
  abilities.setTactic({spells:['starbolt'],healAtOrBelow:null,rules:[{id:'r',spell:'starbolt',when:{within:20}}]});
  expect(abilities.next(bot,true,1300)).toBe('starbolt');
  abilities.noteSent('starbolt',1300);
  expect(abilities.next(bot,true,1600)).toBeNull();
  abilities.noteAbilities([],3000);
  expect(abilities.next(bot,true,3000)).toBeNull();
});

it('evaluates an authored 20-block rule against a tracked hostile beyond the former 16-block clip', () => {
  const abilities = new CombatAbilities();
  abilities.setTactic({spells:null, healAtOrBelow:null, rules:[{id:'range',spell:'starbolt',when:{within:20}}]});
  abilities.noteAbilities([{id:'starbolt',manaCost:4,cooldownMs:0}], 1000);
  abilities.noteMana(20,1000);
  const enemy = {name:'zombie',isValid:true,position:new Vec3(18,64,0)};
  const bot = {health:20,entity:{position:new Vec3(0,64,0)},entities:{7:enemy}} as unknown as Bot;
  expect(abilities.next(bot,true,1000)).toBe('starbolt');
  enemy.position.x=21;
  expect(abilities.next(bot,true,1300)).toBeNull();
  enemy.position.x=18; enemy.isValid=false;
  expect(abilities.next(bot,true,1600)).toBeNull();
  enemy.isValid=true;
  expect(abilities.next(bot,false,1900)).toBeNull();
  abilities.noteMana(null,2200);
  expect(abilities.next(bot,true,2200)).toBeNull();
});

it('names the invalid field and leaves the last accepted tactic intact', async () => {
  const world = new RuleWorld({cfg: structuredClone(MINECRAFT_DEFAULTS)});
  const previous = [{id:'near',spell:'starbolt',when:{within:12}}];
  await world.update({rules:previous});
  const result = await world.update({rules:[{id:'near',spell:'starbolt',when:{within:-1}}]});
  expect(result).toContain('rules[0].when.within');
  expect(result).toContain('>= 1');
  expect(world.tactic()?.rules).toEqual(previous);
});
