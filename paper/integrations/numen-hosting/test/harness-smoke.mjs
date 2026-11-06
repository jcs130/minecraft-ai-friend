// Explicit integration check: actual core, actual autonomy, actual installed Hub
// adapter; a local synthetic Hub and body. No real model, credential or game.
import {createServer} from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {coreClientFactory} from '../src/core-client.mjs';
import {harnessRuntime} from '../src/harness-runtime.mjs';

const [python,plannerModule]=process.argv.slice(2);
if(!python||!plannerModule)throw new Error('Provide explicit test Python and installed Hub adapter paths');
const directory=await mkdtemp(join(tmpdir(),'numen-hub-smoke-'));
let modelCalls=0,observations=0,run,client,runtime;
const hub=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  assert.equal(req.method,'POST');assert.equal(req.url,'/v1/responses');
  const request=JSON.parse(body),input=JSON.parse(request.input);modelCalls++;
  assert.ok(input.tools.some(tool=>tool.function.name==='mc_numen'));
  const decision=modelCalls===1?{content:null,tool_calls:[{id:'fixture-observe-1',type:'function',function:{name:'mc_numen',arguments:'{"op":"observe"}'}}]}:{content:'Observed the synthetic body.',tool_calls:[]};
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:`resp_fixture_${modelCalls}`,model:'synthetic-fixture',status:'completed',
    output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(decision)}]}]}));
});
await new Promise(resolve=>hub.listen(0,'127.0.0.1',resolve));
const role={serverId:'isolated.test',roleUuid:'00000000-0000-0000-0000-000000000001',name:'HostedTest',ownerId:'fixture-owner'};
try{
  const port={identity:{uuid:role.roleUuid,server:role.serverId,name:role.name},
    connect:async()=>({uuid:role.roleUuid,server:role.serverId,ready:true}),disconnect:async()=>{},
    observe:async()=>{observations++;return{uuid:role.roleUuid,server:role.serverId,sampledAt:Date.now(),text:'Synthetic test body at test-world 0 64 0. No real game is connected.'};},
    catalog:async()=>[{name:'lua',description:'Synthetic native fixture',parameters:{type:'object'}}],
    call:async()=>{throw new Error('No world mutation permitted in this fixture');},result:async id=>({text:id})};
  client=await(await coreClientFactory({coreDirectory:resolve('../../../packages/agent-mc-world'),dataRoot:join(directory,'core')}))(role,port,1);
  runtime=harnessRuntime({python,autonomySource:resolve('../../../packages/agent-mc-autonomy/src'),plannerModule,
    plannerSha256:createHash('sha256').update(await readFile(plannerModule)).digest('hex'),dataRoot:join(directory,'host'),
    settings:{autonomy:{max_decisions:1,max_tool_rounds:2,min_decision_seconds:5,max_output_tokens:512,context_tokens:32768},runtime:{mode:'external'},
      perception:{enabled:false},viewer:{auto_open:false},agent:{persona:'Observe only the synthetic fixture. Never log into a game.'}},
    planner:{base_url:`http://127.0.0.1:${hub.address().port}`,harness_id:'fixture',model:'synthetic-fixture',api_key_env:'QDJ_HOSTED_TEST_KEY',max_step:2,poll_seconds:0.1},
    environment:{QDJ_HOSTED_TEST_KEY:'synthetic-test-value'},goal:'Observe the test body once and report that this is a fixture.',checkControl:()=>{},onProblem:value=>console.log(JSON.stringify(value))});
  run=await runtime.start({role,epoch:1,client});
  const deadline=Date.now()+30000;
  while(run.alive()&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
  assert.equal(run.alive(),false,'existing autonomy did not complete its bounded run');
  assert.ok(modelCalls>=1,'Hub was never asked for a decision');assert.ok(observations>=1,'decision never reached the original core body port');
  console.log(JSON.stringify({realCore:true,realAutonomy:true,existingHubAdapter:true,modelCalls,observations,realGame:false,realModel:false}));
}finally{
  if(run)await run.stop();else if(runtime)await runtime.stopUnknown({role});
  await client?.stop();hub.closeAllConnections();await new Promise(resolve=>hub.close(resolve));
  await rm(directory,{recursive:true,force:true});
}
