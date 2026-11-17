import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {CombatProgramProbe, COMBAT_PROBE_RETENTION} from '../core/combat-probe.ts';
import {TacticalMinecraftWorld} from '../core/tactical-world.ts';
import {MINECRAFT_DEFAULTS} from '../core/config.ts';
import {COMBAT_TACTIC_TOOL} from '../core/combat-tool.ts';
import {CombatTacticBook} from '../core/combat-tactics.ts';
import type {CombatDecisionFrame} from '../core/combat-decision-types.ts';
const original={name:'original',code:'return {candidates:frame.actionPool,instructions:"original"};'};
const revised={name:'revised',code:'return {candidates:frame.actionPool.filter(x=>x.kind!=="track"),instructions:"revised"};'};
function frame():CombatDecisionFrame{return {tacticRevision:7,mana:null,skills:[],omittedCandidates:0,program:original,
  battlefield:{sampledAtMs:100000,connectionGeneration:1,dimension:'overworld',
    self:{entityId:1,health:{current:20,max:20,source:'native',updatedAtMs:100000},food:20,position:[0,64,0],scoreboardTeam:null},
    action:{fighting:true,emergency:false,taskId:null,step:null,targetEntityId:2,sinceHitMs:20,canStep:true},
    actors:[{entityId:2,uuid:null,type:'skeleton',name:null,relation:'hostile',relationSource:'hostile-type',scoreboardTeam:null,
      health:{current:20,max:20,source:'native',updatedAtMs:100000},position:[3,64,0],distance:3,lineOfSight:true,targetEntityId:null}],omitted:0,server:null},
  candidates:[],actionPool:[{id:'keep-watch',kind:'track',intent:'Watch',targetId:2}]};}

it('compares programs on the same saved input without adoption and restores bounded samples by world',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'combat-probe-'));
  try{const probe=new CombatProgramProbe(dir);probe.useRealm('a');const input=frame(),id=probe.capture(input)!;
    input.battlefield.self.health.current=1;
    const output=await probe.run({program:revised,samples:[id]},7);
    expect(output).toMatchObject({valid:true,executed:false,adopted:false,improvement:null,parentRevision:7});
    expect(output.rows[0]).toMatchObject({changed:true,baseline:{candidates:[{kind:'track'}]},candidate:{candidates:[]}});
    expect(probe.index().samples[0].health).toBe(20);
    const again=new CombatProgramProbe(dir);again.useRealm('a');expect(again.index().samples[0].id).toBe(id);
    again.useRealm('b');await expect(again.run({program:revised,samples:[id]},7)).rejects.toThrow('Historical sample unavailable');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
it('holds listed inputs across the model turn, live rotation, restart and realm changes',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'probe-turn-'));let now=1_000_000;
  try {
    const probe=new CombatProgramProbe(dir,()=>now);probe.useRealm('a');
    const id=probe.capture(frame())!;const listed=probe.index();
    expect(listed.samples[0]).toMatchObject({id,availableUntil:new Date(now+COMBAT_PROBE_RETENTION.leaseMs).toISOString()});
    for(let i=1;i<=240;i++){const f=frame();f.battlefield.sampledAtMs+=i*1000;f.battlefield.self.health.current=5;probe.capture(f);}
    now+=240_000;
    const result=await probe.run({program:revised,samples:[id]},7);
    expect(result.rows[0]).toMatchObject({sampleId:id,capturedAt:new Date(100000).toISOString(),baseline:{instructions:'original'}});
    const again=new CombatProgramProbe(dir,()=>now);again.useRealm('a');
    expect((await again.run({program:revised,samples:[id]},7)).valid).toBe(true);
    again.useRealm('b');await expect(again.run({program:revised,samples:[id]},7)).rejects.toMatchObject({code:'combat_probe_sample_unavailable',sampleId:id});
    again.useRealm('a');expect((await again.run({program:revised,samples:[id]},7)).valid).toBe(true);
    now+=COMBAT_PROBE_RETENTION.leaseMs;
    await expect(again.run({program:revised,samples:[id]},7)).rejects.toMatchObject({code:'combat_probe_sample_unavailable'});
  } finally {rmSync(dir,{recursive:true,force:true});}
});
it('never evicts an advertised lease to admit fresh samples at capacity',async()=>{
  let now=1_000_000;const probe=new CombatProgramProbe(null,()=>now);probe.useRealm('a');
  const first=probe.capture(frame())!;probe.index();
  for(let i=1;i<=COMBAT_PROBE_RETENTION.retained+32;i++){
    const f=frame();f.battlefield.sampledAtMs+=i*1000;probe.capture(f);probe.index();
  }
  const full=probe.index();expect(full.retention.retained).toBe(COMBAT_PROBE_RETENTION.retained);
  expect(full.retention.omittedRecent).toBeGreaterThan(0);
  expect((await probe.run({program:revised,samples:[first]},7)).valid).toBe(true);
  for(const sample of full.samples.slice(-2))expect((await probe.run({program:revised,samples:[sample.id]},7)).valid).toBe(true);
  now+=60_000;
  const relisted=probe.index();
  expect(relisted.samples.every(s=>s.availableUntil===new Date(now+COMBAT_PROBE_RETENTION.leaseMs).toISOString())).toBe(true);
  now+=COMBAT_PROBE_RETENTION.leaseMs+1;
  expect(probe.index().retention).toMatchObject({omittedRecent:0,retained:32});
});
it('returns a domain rejection through the World tool rather than an engine-offline error',async()=>{
  class ProbeWorld extends TacticalMinecraftWorld {
    protected override syncRealm(){this.tactics.useRealm('offline-receipt-test');}
    update(args:Record<string,unknown>){return this.setCombatTactic(args);}
  }
  const world=new ProbeWorld({cfg:structuredClone(MINECRAFT_DEFAULTS)});
  const result=await world.update({probe:{program:revised,samples:['sample-'+'0'.repeat(24)]}});
  expect(result).toMatchObject({meta:{probe:{status:'rejected',code:'combat_probe_sample_unavailable',executed:false,adopted:false}}});
  expect(typeof result==='object'&&result.text).toContain('Read samples:true again');
});
it('rejects invented geometry and malformed code without changing the baseline; cancellation is not a result',async()=>{
  const probe=new CombatProgramProbe();probe.useRealm('a');probe.capture(frame());
  const result=await probe.run({program:{name:'bad-step',code:'return {candidates:[{id:"unsafe",kind:"step",intent:"cross wall",destination:[1,64,0]}],instructions:""};'}},7);
  expect(result.valid).toBe(false);expect(result.rows[0].baseline.ok).toBe(true);
  expect((await probe.run({program:{name:'syntax',code:'return ! ! {'}},7)).valid).toBe(false);
  const c=new AbortController();c.abort();await expect(probe.run({program:revised},7,c.signal)).rejects.toThrow();
  expect((await probe.run({program:revised},7)).valid).toBe(true);
});
it('never classifies a probe mixed with live configuration as a background learning call',()=>{
  expect(COMBAT_TACTIC_TOOL.learningCall?.({probe:{program:revised}})).toBe(true);
  expect(COMBAT_TACTIC_TOOL.readOnlyCall?.({probe:{program:revised}})).toBe(false);
  expect(COMBAT_TACTIC_TOOL.learningCall?.({probe:{program:revised},program:revised})).toBe(false);
  expect(COMBAT_TACTIC_TOOL.readOnlyCall?.({history:true})).toBe(true);
});
it('records the actual start and end policies and keeps prior source versions across restart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'combat-history-')),file=join(dir,'book.json');
  try{const b=new CombatTacticBook(file);b.useRealm('world');b.set({spells:null,healAtOrBelow:15,program:original},1000);
    b.set({spells:null,healAtOrBelow:26,program:revised},3000);
    const result=b.record({startedAt:new Date(2000).toISOString(),endedAt:new Date(4000).toISOString(),reason:'death',healthBefore:20,healthAfter:0,
      swings:1,meleeLanded:0,arrows:0,rangedLanded:0,kills:null},[]);
    expect(result.policy).toMatchObject({startRevision:1,endRevision:2,changedDuringCombat:true});
    const again=new CombatTacticBook(file);again.useRealm('world');expect(again.history()[0].tactic?.program).toEqual(original);
    expect(again.current().reports[0].policy).toEqual(result.policy);expect(again.current().versions).toBeUndefined();
  }finally{rmSync(dir,{recursive:true,force:true});}
});
