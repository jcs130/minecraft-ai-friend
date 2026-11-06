import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { bestWeapon, attackCooldownMs, skillAttack } from '../core/melee.ts';
import { combatLoadout } from '../core/combat-loadout.ts';
import { parseSteps, SKILL_STEP_SCHEMA } from '../core/skills.ts';
import { validCombatTactic } from '../core/combat-tactics.ts';
import { CombatAbilities } from '../core/combat-abilities.ts';
import { TacticalMinecraftWorld } from '../core/tactical-world.ts';
import { MINECRAFT_DEFAULTS } from '../core/config.ts';
import { methodApiHelp } from '../core/method-api.ts';
import Ajv from 'ajv';

afterEach(() => vi.useRealTimers());
const item = (name:string, damage=0) => ({name,type:1,count:1,componentMap:new Map([['damage',{data:damage}]])});
function fixture(names=['iron_sword','trident','mace']) {
  let items=names.map(name=>item(name));
  const stats={token:{},swings:0,meleeHits:0,arrows:0,rangedHits:0,hurts:0,dead:false,disconnected:false};
  const enemy={id:7,uuid:'enemy-7',name:'zombie',type:'mob',position:new Vec3(2,64,.5),height:1.95,width:.6,isValid:true};
  const controls:Record<string,boolean>={};
  const bot=Object.assign(new EventEmitter(),{
    entity:{id:1,position:new Vec3(.5,64,.5),velocity:new Vec3(0,0,0),onGround:false},
    entities:{7:enemy},players:{},health:20,heldItem:items[0]??null,
    inventory:{items:()=>items,slots:[]},registry:{entitiesByName:{zombie:{name:'zombie'}}},
    pathfinder:{setGoal:vi.fn()},world:{raycast:()=>null},
    blockAt:(p:Vec3)=>({name:p.y<64?'stone':'air',boundingBox:p.y<64?'block':'empty',getProperties:()=>({})}),
    lookAt:vi.fn(async()=>{}),setControlState:(k:string,v:boolean)=>{controls[k]=v;},controlState:controls,
    equip:vi.fn(async(i:any)=>{bot.heldItem=i;}),
    attack:vi.fn(()=>{stats.dead=true;}),
  });
  const ctx={aborted:()=>false,fleeHealth:()=>0,escape:{active:false},attack:{acquire:()=>stats,release:vi.fn()}};
  return {bot,ctx,stats,controls,replace:(next:ReturnType<typeof item>[])=>{items=next;}};
}

it.each(['trident','mace','iron_axe','iron_hoe'])('recognizes %s as armed without a sword or bow', name=>{
  const f=fixture([name]);
  expect(bestWeapon(f.bot as never)?.name).toBe(name);
  expect(combatLoadout(f.bot as never)).toMatchObject({melee:name,canEngage:true,choices:[{item:name,melee:true}]});
});
it('rejects broken weapons and never classifies food as a melee weapon',()=>{
  const f=fixture([]);f.replace([item('trident',250),item('mace',500),item('bread')]);
  expect(bestWeapon(f.bot as never)).toBeNull();
  expect(combatLoadout(f.bot as never).canEngage).toBe(false);
  expect(attackCooldownMs({heldItem:{name:'mace'}} as never)).toBe(1667);
});
it('keeps authored preference and ranged capability separate, skipping unavailable choices',()=>{
  const f=fixture(['iron_sword','trident','crossbow']);
  expect(bestWeapon(f.bot as never,['mace','trident'])?.name).toBe('trident');
  expect(bestWeapon(f.bot as never,['mace','iron_sword'])?.name).toBe('iron_sword');
  expect(combatLoadout(f.bot as never,['trident'])).toMatchObject({melee:'trident',ranged:null,
    choices:expect.arrayContaining([{item:'crossbow',count:1,melee:false,ranged:'native-script-only'}])});
});
it('shares exact weapon selection in the public schema and parser',()=>{
  const call={skill:'attack',target:'zombie',entityId:7,mode:'melee',weapon:'trident'};
  expect(new Ajv({strict:false}).compile(SKILL_STEP_SCHEMA)(call)).toBe(true);
  expect(parseSteps([call])).toMatchObject({steps:[call]});
  expect(parseSteps([{...call,mode:'ranged'}])).toHaveProperty('error');
});
it('uses the named trident rather than silently switching to a better-ranked sword',async()=>{
  vi.useFakeTimers();const f=fixture(['netherite_sword','trident']);
  const task=skillAttack(f.bot as never,'zombie','melee',f.ctx as never,7,'trident');
  await vi.advanceTimersByTimeAsync(2000);await task;
  expect(f.bot.heldItem?.name).toBe('trident');expect(f.bot.attack).toHaveBeenCalledTimes(1);
  expect(f.ctx.attack.release).toHaveBeenCalledTimes(1);
});
it('losing the chosen weapon before the swing never falls back to food or another sword',async()=>{
  vi.useFakeTimers();const f=fixture(['trident','iron_sword']);
  f.bot.lookAt.mockImplementation(async()=>{f.replace([item('iron_sword')]);f.bot.heldItem=item('bread');});
  const task=skillAttack(f.bot as never,'zombie','melee',f.ctx as never,7,'trident').catch(e=>e);
  await vi.advanceTimersByTimeAsync(2000);
  expect(String(await task)).toContain('指定近战武器 trident 不可用');
  expect(f.bot.attack).not.toHaveBeenCalled();expect(Object.values(f.controls).some(Boolean)).toBe(false);
});
class World extends TacticalMinecraftWorld {
  protected override syncRealm(){this.tactics.useRealm('fixture');}
  update(args:Record<string,unknown>){return this.setCombatTactic(args);}
  read(){return this.tactics.getTactic();}
  order(){return this.preferredMeleeWeapons();}
}
it('updates, preserves and clears weapon preference through the actual shared tactic tool',async()=>{
  const world=new World({cfg:structuredClone(MINECRAFT_DEFAULTS)});
  await world.update({meleeWeapons:['trident','iron_axe']});expect(world.order()).toEqual(['trident','iron_axe']);
  await world.update({healAtOrBelow:8});expect(world.read()).toMatchObject({meleeWeapons:['trident','iron_axe'],healAtOrBelow:8});
  const prior=world.read();await world.update({meleeWeapons:['bread']});expect(world.read()).toEqual(prior);
  await world.update({meleeWeapons:[]});expect(world.order()).toEqual([]);
  expect(validCombatTactic({...prior,meleeWeapons:['trident','trident']})).toBe(false);
  const abilities=new CombatAbilities();abilities.setTactic(prior);expect(abilities.preferredMeleeWeapons()).toEqual(['trident','iron_axe']);
});
it('provides bounded capability and authoring routes without pretending native horse input is driving',()=>{
  expect(methodApiHelp('weapons')).toContain('meleeWeapons');
  expect(methodApiHelp('weapons')).toContain('routines');
  expect(methodApiHelp('mobility')).toContain('不支持马/驴/骡驾驶');
  expect(methodApiHelp('mobility')).toContain('ride_route');
  expect(methodApiHelp('mount')).toContain('mount(entityId)');
});
