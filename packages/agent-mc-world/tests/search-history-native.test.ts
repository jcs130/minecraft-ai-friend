import {expect,it,vi} from 'vitest';
import {Vec3} from 'vec3';
import {CombatSearchHistory} from '../core/combat-search.ts';
import {TacticalMinecraftWorld} from '../core/tactical-world.ts';
import {MINECRAFT_DEFAULTS} from '../core/config.ts';
import {methodHarness} from './method-harness.ts';
import type {CombatCandidate} from '../core/combat-decision-types.ts';

const key='["sound-packet","怪物声","南"]';
function search(x:number):CombatCandidate{return {id:'search_3',kind:'search',source:'sound-packet',
  clueKey:key,destination:[x,64,.5],intent:'Inspect one safe side corridor; location unknown'};}

it('replays the observed left-right oscillation without treating the opposite fresh corridor as visited',()=>{
  const h=new CombatSearchHistory();
  h.record('realm:1',key,[1591.43,64,.5],1000);
  // Actual first short step ended at 1592.26; its reverse target is near the old origin.
  expect(h.filter('realm:1',[search(1591.06),search(1593.46)],2000)).toEqual([search(1593.46)]);
  expect(h.filter('realm:1',[{...search(1591.06),clueKey:'new-hostile'} as CombatCandidate],2000)).toHaveLength(1);
  expect(h.filter('realm:1',[search(1591.06)],31_000)).toHaveLength(1);
  h.record('realm:1',key,[1591.43,64,.5],32_000);
  expect(h.filter('realm:2',[search(1591.06)],32_001)).toHaveLength(1);
});

it('native tactical dispatch records a real origin and rejects its immediate reverse without blocking a new side',async()=>{
  vi.useFakeTimers();
  const r=methodHarness('1.21.1',()=>new TacticalMinecraftWorld({cfg:structuredClone(MINECRAFT_DEFAULTS)}));
  const w=r.world as any;
  let selected=search(1.7);
  w.sampleCombatDecision=()=>({battlefield:{connectionGeneration:1,dimension:'minecraft:overworld',
    sampledAtMs:Date.now(),action:{emergency:false}},tacticRevision:1,candidates:[selected]});
  try{
    expect(w.applyCombatDecision(selected,1)).toBe(true);
    await vi.advanceTimersByTimeAsync(700);
    const moved=r.bot.entity.position.x;
    expect(moved).toBeGreaterThan(1);
    selected=search(moved-1.2);
    expect(w.applyCombatDecision(selected,1)).toBe(false);
    selected=search(moved+1.2);
    expect(w.applyCombatDecision(selected,1)).toBe(true);
    await vi.advanceTimersByTimeAsync(700);
    expect(r.bot.entity.position.x).toBeGreaterThan(moved+.4);
  }finally{r.close();vi.useRealTimers();}
});

it('yields successive ambient steps to a pending travel goal after an actual native outcome and re-arms on harm',async()=>{
  vi.useFakeTimers();
  const cfg=structuredClone(MINECRAFT_DEFAULTS);
  cfg.combatOptions={...cfg.combatOptions,allowMovement:true, maxCandidates:16};
  const r=methodHarness('1.21.1',()=>new TacticalMinecraftWorld({cfg}));
  const w=r.world as any;
  const sample=w.battlefield.sample.bind(w.battlefield);
  let bearing='东北',distance='远处（约12格外）',hasObjective=false;
  w.battlefield.sample=(...args:any[])=>{
    const field=sample(...args);
    field.clues=[{source:'sound-packet',kind:'怪物声',direction:bearing,distance,
      origin:field.self.position,heardAt:Date.now(),expiresAt:Date.now()+8000}];
    return field;
  };
  w.extensionCombatSearchObjective=()=>hasObjective
    ? {key:'room-evidence',remaining:1,observedAtMs:Date.now(),expiresAtMs:Date.now()+8000}:null;
  await r.world.tools().find(t=>t.name==='mc_goal')!.handler({add:{text:'leave area',plan:[
    {do:'reach the marked surface',verify:{source:'position',region:[[20,64,20],[23,66,23]],dimension:'minecraft:overworld'}}]}},{} as never);
  const choose=(source:string)=>{
    const frame=w.sampleCombatDecision();
    const candidate=frame.candidates.find((c:any)=>c.kind==='search' && c.source===source);
    return {candidate,revision:frame.tacticRevision};
  };
  try{
    const first=choose('sound-packet');
    expect(first.candidate).toBeTruthy();
    expect(w.applyCombatDecision(first.candidate,first.revision)).toBe(true);
    await vi.advanceTimersByTimeAsync(720);
    expect(r.bot.entity.position.distanceTo(new Vec3(.5,64,.5))).toBeGreaterThan(.4);
    expect(choose('sound-packet').candidate).toBeUndefined();
    bearing='北';expect(choose('sound-packet').candidate).toBeUndefined();
    expect(w.applyCombatDecision(first.candidate,first.revision)).toBe(false);
    hasObjective=true;expect(choose('objective').candidate).toBeTruthy();
    hasObjective=false;distance='近处（约4格内）';expect(choose('sound-packet').candidate).toBeTruthy();
    distance='远处（约12格外）';w.lastReflexHurtAt=Date.now();
    expect(choose('sound-packet').candidate).toBeTruthy();
  }finally{r.close();vi.useRealTimers();}
});
