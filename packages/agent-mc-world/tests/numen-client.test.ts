import { test } from 'vitest';
import assert from 'node:assert/strict';
import { NumenClientWorld, type NumenBodyPort } from '../src/client/numen-client.ts';
import type { WorldHost, ToolCallContext } from '../src/contracts/host.ts';

function fixture(){
  const calls:unknown[]=[];
  const port:NumenBodyPort={identity:{uuid:'canonical-role-uuid',server:'isolated',name:'HostedTest'},
    connect:async()=>({uuid:'canonical-role-uuid',server:'isolated',ready:true}),disconnect:async()=>{calls.push('disconnect');},
    observe:async()=>({uuid:'canonical-role-uuid',server:'isolated',sampledAt:100,text:'Actual body state'}),
    catalog:async()=>[{name:'lua',description:'Native Lua',parameters:{type:'object'}}],
    call:async r=>{calls.push(r);return{text:'dispatched',meta:{state:'partial'}};},result:async id=>({text:id,meta:{state:'unknown'}})};
  const world=new NumenClientWorld(port);
  return{world,port,calls,tool:world.tools()[0],context:{callId:'stable-call-id'} as ToolCallContext};
}
test('Numen provider binds the same body without creating any login client',async()=>{
  const f=fixture();await f.world.start({}as WorldHost);
  await f.tool.handler({op:'call',tool:'lua',args:{code:'return 1'}},f.context);
  assert.equal((f.calls[0]as {id:string}).id,'stable-call-id');
  assert.equal(f.world.connectionReadiness().phase,'numen-hosted');
  assert.equal(f.world.connectionReadiness().disconnectStopsBody,false);
});
test('unready or mismatched identity is rejected and disconnected',async()=>{
  const f=fixture();f.port.connect=async()=>({ready:true,uuid:'other',server:'isolated'});
  await assert.rejects(f.world.start({}as WorldHost),/identity differs/);assert.deepEqual(f.calls,['disconnect']);
});
test('actions require a host request identity; unknown results are queried only',async()=>{
  const f=fixture();await f.world.start({}as WorldHost);
  const result=await f.tool.handler({op:'call',tool:'lua',args:{}},{}as ToolCallContext);
  assert.equal(typeof result==='object'&&result.failed,true);assert.equal(f.calls.length,0);
  await f.tool.handler({op:'result',requestId:'original-id'},f.context);assert.equal(f.calls.length,0);
});
test('fresh state identity mismatch disables future actions and drops stale facts',async()=>{
  const f=fixture();await f.world.start({}as WorldHost);await f.tool.handler({op:'observe'},f.context);
  assert.match(f.world.requestFacts()?.text??'',/observation at 100 ms/);
  assert.match(f.world.requestFacts()?.text??'',/Actual body state$/);
  f.port.observe=async()=>({uuid:'other',server:'isolated',sampledAt:101,text:'Wrong role'});
  await f.tool.handler({op:'observe'},f.context);assert.equal(f.world.connectionReadiness().ready,false);
  assert.equal(f.world.requestFacts(),null);
});
