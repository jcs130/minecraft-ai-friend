import { expect, it } from 'vitest';
import { familiarStepAction, nativeFamiliarAction } from '../src/client/familiar-action.ts';
import { nativeAuthorization } from '../src/client/native-authorization.ts';
import { blockFindRequest } from '../core/block-find-method.ts';
import { methodHarness, methodEnded } from './method-harness.ts';
const state:any={protocol:'agent-mc-java/v1',connected:true,username:'Agent',server:'fixture.test:25565',generation:2,
  dimension:'minecraft:overworld',navigationCapability:'agent-mc-navigation/v1',inventoryPick:'agent-mc-inventory-pick/v1',
  inventory:[{slot:4,empty:false,name:'bread'},{slot:20,empty:false,name:'wheat_seeds',instanceHash:'a'.repeat(64)}],actions:[],messages:[]};
it('recognizes familiar legacy commands with explicit identity while retaining exact dispatch parameters',()=>{
  const command={action_id:'original-id',waitMs:1000,steps:[{skill:'goto',at:[1,64,3],walkOnly:true}]};
  const match=familiarStepAction(command)!;expect(match.command).toEqual(command);expect(match.steps).toEqual(command.steps);
  match.steps[0].skill='changed';expect(command.steps[0].skill).toBe('goto');
  expect(familiarStepAction({...command,queue:'now'})).toBeNull();expect(familiarStepAction({...command,steps:[{skill:'chat',text:'/anything'}]})).toBeNull();
});
it('classifies native navigation losslessly and rejects unknown capability or ambiguous native bounds',()=>{
  const command={action_id:'native-original',operation:'navigate',input:{goal:{x:-5,y:64,z:3,rangeSq:1},timeoutMs:45000},waitMs:1};
  const match=nativeFamiliarAction(command,state)!;expect(match.command).toEqual(command);expect(match.steps).toMatchObject([{skill:'goto',at:[-5,64,3]}]);
  expect(nativeFamiliarAction(command,{...state,navigationCapability:null})).toBeNull();
  expect(nativeFamiliarAction({...command,input:{goal:{x:-5,y:64,z:3,rangeSq:4}}},state)).toBeNull();
  expect(nativeFamiliarAction({...command,input:{goal:{x:'~1',y:64,z:3}}},state)).toBeNull();
});
it('uses current inventory identity for native equip and never promotes arbitrary inputs to familiar work',()=>{
  expect(nativeFamiliarAction({operation:'hotbar',input:{slot:4}},state)?.steps[0]).toMatchObject({skill:'equip',item:'bread'});
  expect(nativeFamiliarAction({operation:'equip',input:{slot:20,instanceHash:'a'.repeat(64)}},state)).not.toBeNull();
  expect(nativeFamiliarAction({operation:'equip',input:{slot:20,instanceHash:'b'.repeat(64)}},state)).toBeNull();
  for(const operation of ['chat','attack','use','method.run','minescript.run'])expect(nativeFamiliarAction({operation,input:{}},state)).toBeNull();
  expect(nativeFamiliarAction({operation:'look',input:{yaw:181,pitch:0}},state)).toBeNull();
});
it('server authorization requires current bridge scope, never chat text or historical success',()=>{
  const proof={protocol:'agent-mc-server-authorization/v1',required:true,username:'Agent',server:'fixture.test',generation:2,phase:'confirmed',authorized:true,connectionMatched:true};
  expect(nativeAuthorization({...state,serverAuthorization:proof}).ready).toBe(true);
  for(const changed of [{generation:1},{username:'Other'},{server:'other.test'},{connectionMatched:false},{phase:'submitted'},{authorized:false}])
    expect(nativeAuthorization({...state,serverAuthorization:{...proof,...changed}}).ready).toBe(false);
  expect(nativeAuthorization({...state,messages:[{text:'MC_AUTH_SUCCESS'}]},true).ready).toBe(false);
  expect(nativeAuthorization(state).ready).toBe(true);expect(nativeAuthorization(state,true).ready).toBe(false);
});
it('bounded block find runs on the real shared Mineflayer worker with actual registry IDs and no body action',async()=>{
  const r=methodHarness();const queries:any[]=[];
  r.bot.findBlocks=(options:any)=>{queries.push(options);return []};
  try{
    const tool=r.world.tools().find(t=>t.name==='mc_script')!;
    const reply:any=await tool.handler({find:{names:['water','water','carrots'],maxDistance:8,count:4},waitMs:1000},{role:'main',log:r.host.log});
    expect(reply.failed).not.toBe(true);const run=await methodEnded(r,1);
    expect(run).toMatchObject({status:'completed',result:{positions:[],observedOnly:true,goalCompleted:false}});
    expect(queries.find(q=>Array.isArray(q.matching))?.matching).toEqual([r.bot.registry.blocksByName.water.id,r.bot.registry.blocksByName.carrots.id]);
    expect(run.trace).toHaveLength(3);expect(r.exec.status().current).toBeFalsy();expect(r.said).toEqual([]);
  }finally{r.close();}
});
it('invalid find cannot smuggle body code into a read-only recipe',()=>{
  expect(()=>blockFindRequest({find:{names:['water']},code:'await bot.look(0,0)'})).toThrow(/separately/);
  expect(()=>blockFindRequest({find:{names:['water'],maxDistance:33}})).toThrow(/1..32/);
  expect(()=>blockFindRequest({find:{names:['water;injected']}})).toThrow(/registry names/);
});
it('inline programs have stable names and missing trace returns the original error without starting another run',async()=>{
  const r=methodHarness();try{
    const a=r.runner.start({code:'throw new Error("pre-call failure");'});await methodEnded(r,a.id);
    expect(()=>r.runner.inspect(a.id,1)).toThrow(/pre-call failure/);
    const b=r.runner.start({code:'throw new Error("pre-call failure");'});await methodEnded(r,b.id);
    expect(a.name).toBe(b.name);expect(a.name).toMatch(/^inline-/);expect(r.runner.read()).toHaveLength(2);
  }finally{r.close();}
});
