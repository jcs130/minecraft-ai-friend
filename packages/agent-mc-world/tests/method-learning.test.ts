import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MinecraftWorld } from '../core/world.ts';
import { MINECRAFT_DEFAULTS } from '../core/config.ts';
import { applyServerProfile } from '../core/server-profiles.ts';
import { MethodLibrary } from '../core/method-library.ts';
import { methodHarness, methodEnded } from './method-harness.ts';

const decode = (value: any) => {
  if (value.failed) throw Error(value.text);
  return JSON.parse(typeof value === 'string' ? value : value.text);
};
const dependency = createRequire(createRequire(import.meta.url).resolve('mineflayer'));

describe('game method accumulation', () => {
  it('retains an unsuccessful trial, selects a revised action, composes exact children and retrieves evidence after restart', async () => {
    const directory = mkdtempSync(join(tmpdir(),'mc-learning-'));
    const guide = {profile:'alpha',title:'Test guide',revision:'edition-1',entries:[{id:'sneak',title:'Movement',summary:'Sneak on the route',text:'Walk on the marked path.',reference:'fixture:guide'}]};
    let profile = 'alpha';
    const create = () => new MinecraftWorld({cfg:applyServerProfile({...structuredClone(MINECRAFT_DEFAULTS),server:profile,
      servers:profile==='alpha' ? {alpha:{host:'shared.example.test',guide}} : {beta:{host:'shared.example.test'}}},{}),dataDir:directory});
    const rig = () => { const harness=methodHarness('1.21.1',create);
      Object.assign(harness.bot,{supportFeature:(name:string)=>harness.bot.registry.supportFeature(name)});
      dependency('./lib/plugins/physics.js')(harness.bot,{physicsEnabled:true}); return harness; };
    let r = rig();
    try {
      const call = async (args: Record<string,unknown>) => r.world.tools().find(t=>t.name==='mc_script')!.handler(args,{role:'main',log:r.host.log});
      const tool = async (name:string,args:Record<string,unknown>) => decode(await r.world.tools().find(t=>t.name===name)!.handler(args,{role:'main',log:r.host.log}));
      const recall = async (query='please sneak across the route') => (await tool('mc_memory',{action:'scene',operation:'recall',input:{query,limit:2,maxChars:1000}})).skills;
      const {rule} = await tool('mc_knowledge',{source:'server',action:'get',id:'sneak'});
      const library = async (args: Record<string,unknown>) => decode(await call({library:args}));
      const run = async (args: Record<string,unknown>) => { const reply = await call(args); if (reply.failed) throw Error(reply.text);
        return methodEnded(r,r.runner.read().at(-1)!.id); };
      const save = async (id:string,code:string,parent:string|null=null,dependencies={}) => {
        const syntax = await run({name:id,code,validate:true}); expect(syntax.status).toBe('validated');
        return library({op:'save',id,code,parent,dependencies,description:'Conditioned sneak movement, returns observed positions.',
          conditions:['Loaded flat support, free body; not a route or combat planner.'],validationRunId:syntax.id});
      };
      const unchanged = 'const s=await mc.state();return {before:s.snapshot.position,after:s.snapshot.position};';
      const first = await save('measured-step',unchanged);
      expect(await recall()).toContainEqual(expect.objectContaining({id:'measured-step',state:'candidate'}));
      const failedGoal = await run({procedure:first.reference}); expect(failedGoal.status).toBe('completed');
      const firstExecution = failedGoal.procedure!.executionId;
      expect((await recall())[0]).toMatchObject({state:'review',next:{args:{library:{executionId:firstExecution}}}});
      const badReview = await library({op:'review',id:'measured-step',revision:first.reference.revision,executionId:firstExecution,
        outcome:'not-achieved',assessment:'The code only read the scene; no movement occurred.',context:'Offline local flat grid, actual Mineflayer physics.',
        measurements:{'distance-blocks':0},counterexamples:['Program completed without attempting the requested action.']});
      expect(await call({library:{op:'adopt',id:'measured-step',revision:first.reference.revision,reviewId:badReview.id,
        expectedAdopted:null,reason:'Incorrectly treating completion as progress'}})).toMatchObject({failed:true});
      expect((await recall())[0]).toMatchObject({state:'revise',outcome:'not-achieved'});
      const code = `const before=await mc.state();
        try { await bot.setControlState('sneak',true); await bot.setControlState('forward',true);
          await bot.waitForTicks(params.ticks); return {before:before.snapshot.position,after:(await mc.state()).snapshot.position};
        } finally { await bot.clearControlStates(); }`;
      const second = await save('measured-step',code,first.reference.revision);
      const syntax = await run({procedure:second.reference,validate:true});
      expect(await call({library:{op:'review',id:'measured-step',revision:second.reference.revision,executionId:syntax.procedure!.executionId,
        outcome:'achieved',assessment:'Parse only',context:'No execution'}})).toMatchObject({failed:true});
      const execution = await run({procedure:second.reference,params:{ticks:5}});
      expect(execution.status,execution.error).toBe('completed');
      expect(Object.values(r.keys).some(Boolean)).toBe(false);
      const result = execution.result as any, distance = Math.hypot(result.after.x-result.before.x,result.after.z-result.before.z);
      expect(distance).toBeGreaterThan(.05);
      const evidence = await library({op:'evidence',id:'measured-step',executionId:execution.procedure!.executionId,call:2});
      expect(evidence.trace).toMatchObject({method:'mineflayer',args:{name:'setControlState'},procedure:{revision:second.reference.revision}});
      const assessed = await library({op:'review',id:'measured-step',revision:second.reference.revision,executionId:execution.procedure!.executionId,
        outcome:'achieved',assessment:'Actual positions show a short forward displacement; keys released at terminal.',
        context:'One offline flat-grid case; no live-world or general improvement claim.',measurements:{'distance-blocks':distance},
        counterexamples:['Obstructed routes and water are untested.']});
      expect(assessed).toMatchObject({assessmentAuthority:'agent-interpretation',verifiedImprovement:false,goalVerified:false});
      expect(await call({library:{op:'adopt',id:'measured-step',revision:second.reference.revision,reviewId:assessed.id,
        expectedAdopted:null,reason:'wrong server',rule:{...rule,profile:'beta'}}})).toMatchObject({failed:true});
      const adopted = await library({op:'adopt',rule,id:'measured-step',revision:second.reference.revision,reviewId:assessed.id,
        expectedAdopted:null,reason:'Choose the measured revision for another explicit applicable attempt.'});
      expect(adopted).toMatchObject({changedRunningProgram:false,verifiedImprovement:false,author:{kind:'agent',role:'main'}});
      const parent = await save('two-short-steps',`const a=await methods.run('step',params);const b=await methods.run('step',params);return {a,b};`,
        null,{step:second.reference});
      const combined = await run({procedure:parent.reference,params:{ticks:3}});
      expect(combined.status).toBe('completed');
      expect(combined.procedure!.invocations.filter(i=>i.revision===second.reference.revision)).toHaveLength(2);
      // A newer child does not mutate either the selected child or its composed parent.
      const third = await save('measured-step','return 123;',second.reference.revision);
      const listed = await library({op:'list',query:'sneak'});
      expect(listed.methods.find((m:any)=>m.id==='measured-step')).toMatchObject({revision:third.reference.revision,
        selected:{reference:second.reference},verifiedImprovement:false});
      expect((await library({op:'read',id:'two-short-steps'})).dependencies.step).toEqual(second.reference);
      r.close(); r = rig();
      const restored = await library({op:'evidence',id:'measured-step',executionId:firstExecution});
      expect(restored).toMatchObject({status:'completed',root:first.reference,goalVerified:false});
      expect((await library({op:'evidence',id:'measured-step',reviewId:badReview.id})).counterexamples).toHaveLength(1);
      expect(await library({op:'evidence',id:'measured-step',selectionId:adopted.id})).toMatchObject({reason:adopted.reason,author:{role:'main'}});
      const reusable = (await recall()).find((s:any)=>s.id==='measured-step');
      expect(reusable).toMatchObject({state:'adopted',next:{args:{procedure:adopted.reference}}});
      expect(await recall('钻石采矿')).toEqual([]);
      const retry = await run({...reusable.next.args,params:{ticks:3}});
      expect(retry.status).toBe('completed');
      expect(retry.procedure!.versions[0].revision).toBe(second.reference.revision);
      expect((await recall()).find((s:any)=>s.id==='measured-step')).toMatchObject({state:'review'});
      await library({op:'review',id:'measured-step',revision:second.reference.revision,executionId:retry.procedure!.executionId,
        outcome:'not-achieved',assessment:'Distance was below the new target.',context:'Test changed the distance required.'});
      expect((await recall()).find((s:any)=>s.id==='measured-step')).toMatchObject({state:'revise'});
      const facts = r.world.requestFacts()!.parts!.find(p=>p.key==='methods')!.text;
      expect(facts).toContain('measured-step'); expect(facts).toContain('待核验/复盘');
      expect(facts).not.toContain(code); expect(facts.length).toBeLessThan(1100);
      expect(await call({library:{op:'adopt',id:'measured-step',revision:second.reference.revision,reviewId:assessed.id,
        expectedAdopted:null,reason:'stale selection'}})).toMatchObject({failed:true,text:expect.stringContaining('changed')});
      r.close(); guide.entries[0].text='The route was closed.'; r=rig();
      expect((await recall()).find((s:any)=>s.id==='measured-step')).toMatchObject({state:'recheck-rule',next:{tool:'mc_knowledge'}});
      r.close(); profile='beta'; r=rig();
      expect(await recall()).toEqual([]);
      expect(await call({procedure:adopted.reference})).toMatchObject({failed:true});
    } finally { r.close(); rmSync(directory,{recursive:true,force:true}); }
  },20000);

  it('does not accept another scope, missing dependencies or a changed original receipt', () => {
    const directory = mkdtempSync(join(tmpdir(),'mc-learning-integrity-'));
    try {
      const lib = new MethodLibrary(directory), other = new MethodLibrary(null), code='return 1;';
      const validation:any = {id:1,status:'validated',sourceHash:createHash('sha256').update(code).digest('hex'),trace:[]};
      const input = {id:'read-state',code,parent:null,description:'Read actual state',conditions:[]};
      const first:any = lib.save(input,validation,'main');
      expect(()=>other.save({...input,dependencies:{read:first.reference}},validation,'main')).toThrow(/unavailable/);
      expect(()=>lib.save({...input,id:'wrong-child',dependencies:{read:{...first.reference,revision:'a'.repeat(64)}}},validation,'main')).toThrow(/hash/);
      const receipt:any={schema:'agent-mc.procedure-run/v1',executionId:'12345678-1234-1234-1234-123456789abc',root:first.reference,
        adapter:'minecraft-method/v1',mode:'execution',status:'completed',startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),invocations:[],trace:[],result:1};
      lib.recordExecution(receipt);
      const path=join(directory,'evidence','read-state',receipt.executionId+'.json');
      const stored=JSON.parse(readFileSync(path,'utf8'));stored.receipt.result=99;writeFileSync(path,JSON.stringify(stored));
      expect(()=>new MethodLibrary(directory).review({id:'read-state',revision:first.reference.revision,executionId:receipt.executionId,
        outcome:'achieved',assessment:'Tampered',context:'fixture'},'main')).toThrow(/hash/);
      expect(()=>lib.evidence({id:'read-state',executionId:'../other'})).toThrow(/UUID/);
    } finally {rmSync(directory,{recursive:true,force:true});}
  });
});

