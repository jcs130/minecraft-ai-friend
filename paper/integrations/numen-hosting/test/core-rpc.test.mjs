import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {coreClientFactory} from '../src/core-client.mjs';
import {openCoreRpc} from '../src/core-rpc.mjs';

test('real shared MC core carries stable turn/request IDs through private HTTP and rejects a stale controller',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'hosted-core-'));
  let client,rpc;
  t.after(async()=>{try{await rpc?.close();await client?.stop();}finally{await rm(directory,{recursive:true,force:true});}});
  const role={serverId:'isolated.test',roleUuid:'00000000-0000-0000-0000-000000000001',name:'HostedTest'};
  let current=true;const calls=[];
  const port={identity:{uuid:role.roleUuid,server:role.serverId,name:role.name},
    connect:async()=>({uuid:role.roleUuid,server:role.serverId,ready:true}),disconnect:async()=>{},
    observe:async()=>({uuid:role.roleUuid,server:role.serverId,sampledAt:Date.now(),text:'Actual test body'}),
    catalog:async()=>[{name:'lua',description:'Native test tool',parameters:{type:'object'}}],
    call:async args=>{calls.push(args);return{text:'Original test receipt'};},result:async id=>({text:id})};
  const create=await coreClientFactory({coreDirectory:resolve('../../../packages/agent-mc-world'),dataRoot:directory});
  client=await create(role,port,1);
  rpc=await openCoreRpc(client,{check:()=>{if(!current)throw new Error('generation changed');}});
  const request=(operation,args=[],token=rpc.token,extra={})=>fetch(rpc.endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`,...extra},body:JSON.stringify({operation,arguments:args})});
  assert.equal((await request('tools',[],randomBytes(32).toString('base64url'))).status,403);
  assert.equal((await request('tools',[],rpc.token,{origin:'https://untrusted.test'})).status,403);
  assert.ok((await (await request('tools')).json()).tools.some(tool=>tool.name==='mc_numen'));
  assert.equal((await request('tool',['mc_connection',{action:'connect'}])).status,200);
  const env=await(await request('tool',['mc_connection',{action:'environment'}])).json();assert.match(JSON.stringify(env),/Numen server player/);
  const meta={'agent-mc/v1':{requestId:'request-stable-one',turnId:'turn-stable-one'}};
  await request('tool',['mc_protocol',{protocol:'agent-mc/v1',action:'begin_turn',id:'turn-stable-one'}]);
  const response=await(await request('tool',['mc_numen',{op:'call',tool:'lua',args:{code:'return 1'}},meta])).json();
  assert.notEqual(response.isError,true);assert.equal(calls.length,1);assert.equal(calls[0].id,'request-stable-one');
  current=false;
  assert.equal((await request('tool',['mc_numen',{op:'call',tool:'lua',args:{}},meta])).status,409);
  assert.equal(calls.length,1);
});
