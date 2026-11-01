/** Explicit connected experiment, using the existing core/MCP and dedicated vanilla clients. */
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,appendFileSync,readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {createPracticeModelAudit,summarizeModelAudit} from '../scripts/practice-model-audit.mjs';
import {connectedCraftingReport} from '../scripts/practice-report.mjs';
import assert from 'node:assert/strict';
import {MinecraftAgentClient,MINECRAFT_CLIENT_DEFAULTS,nullLogger} from 'agent-mc-world/client';
import {createClientMethodPractice} from 'agent-mc-world/learning';
import {createMinecraftMcpServer} from 'agent-mc-world/mcp';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';

export async function runConnectedCraftingExperiment(options){
const args={'--java':options.java,'--serverJar':options.serverJar,'--python':options.python,'--directory':options.directory};
for(const [key,value] of Object.entries(args))if(typeof value!=='string'||!value)throw Error(`Required ${key}=absolute-path`);
if(options.acceptEula!==true)throw Error('Explicit Minecraft EULA acceptance required');
const scripted=options.scripted===true;
if(scripted===!!options.model)throw Error('Supply a host model, or explicitly select the scripted integration test');
if(!scripted&&options.provenance?.kind!=='registered-host-llm')throw Error('Real mode requires registered-host-llm provenance');
options.signal?.throwIfAborted();
const root=resolve(args['--directory']),jar=resolve(args['--serverJar']);
if(existsSync(root))throw Error('Use a NEW disposable directory; existing servers and evidence cannot be overwritten');
assert.equal(createHash('sha1').update(readFileSync(jar)).digest('hex'),'59353fb40c36d304f2035d51e7d6e6baa98dc05c','Expected official Java 1.21.1 server');
mkdirSync(root,{recursive:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(check,timeout=30000,cancellable=true){const end=Date.now()+timeout;while(!await check()){if(cancellable)options.signal?.throwIfAborted();if(Date.now()>end)throw Error('Original integration operation timed out');await delay(100);}}
const freePort=()=>new Promise((resolvePort,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolvePort(port));});});
const servers=[],clients=[];
async function startServer(name){
  const directory=join(root,name),port=await freePort();mkdirSync(directory);
  writeFileSync(join(directory,'eula.txt'),'eula=true\n');
  writeFileSync(join(directory,'server.properties'),`server-ip=127.0.0.1\nserver-port=${port}\nonline-mode=false\nenforce-secure-profile=false\nlevel-type=minecraft:flat\nlevel-seed=1\nspawn-protection=0\nview-distance=2\nsimulation-distance=2\nmax-players=2\ndifficulty=peaceful\ngamemode=survival\nsync-chunk-writes=true\n`);
  const child=spawn(resolve(args['--java']),['-Xms256M','-Xmx768M','-jar',jar,'nogui'],{cwd:directory,env:{PATH:process.env.PATH,LANG:'C.UTF-8',TZ:'Asia/Shanghai'},stdio:['pipe','pipe','pipe']});
  const server={child,directory,port,output:'',exited:false};servers.push(server);
  for(const stream of [child.stdout,child.stderr])stream.on('data',v=>{appendFileSync(join(directory,'console.log'),v);server.output=(server.output+v).slice(-300000);});
  child.once('exit',()=>server.exited=true);
  child.once('error',()=>{server.exited=true;});
  child.stdin.on('error',()=>{});
  await wait(()=>{if(server.exited)throw Error('Dedicated server exited; inspect console.log');return server.output.includes('Done (');},120000);
  server.command=async commands=>{const marker='h2-'+randomUUID();child.stdin.write(commands.join('\n')+'\nsay '+marker+'\n');await wait(()=>server.output.includes('[Server] '+marker),10000);};
  await server.command(['gamerule doDaylightCycle false','gamerule doWeatherCycle false','gamerule doMobSpawning false','gamerule spawnChunkRadius 0','time set day','fill -4 63 -4 4 63 4 stone','setblock 1 64 0 crafting_table']);
  return server;
}
function cfg(server,username){const c=structuredClone(MINECRAFT_CLIENT_DEFAULTS);Object.assign(c,{enabled:true,host:'127.0.0.1',port:server.port,username,version:'1.21.1',viewerPort:0});c.idle.enabled=false;c.combat.enabled=false;c.reflex.antiDrown=false;return c;}
async function call(client,args){const r=await client.call('mc_script',args);if(r.failed)throw Error(r.text);return r;}
async function sample(client){
  const r=await call(client,{code:"const state=await mc.state();return {items:await bot.inventory.items(),health:await bot.read('health'),position:await bot.read('entity.position'),dimension:await bot.read('game.dimension'),controls:await bot.getControlState('forward'),queue:state.queue};",durationMs:5000,waitMs:5000});
  const runId=r.execution?.evidence?.localId;
  return JSON.parse((await call(client,{runId,waitMs:5000})).text).result;
}
const code=`const inventory=await bot.inventory.items();
const log=inventory.find(i=>i.name.endsWith('_log'));
const wood=params.wood==='observed'?(log?log.name.replace('_log',''):null):params.wood;
if(!wood)return {blocked:'no observed logs'};
for(const step of [{skill:'craft',item:wood+'_planks',count:params.logs*4},{skill:'craft',item:'stick',count:4},{skill:'craft',item:'wooden_pickaxe',count:1}]){
  const receipt=await mc.do([step]);if(!receipt.done)return {blocked:true};
}
return {attempted:true};`;
const guidance='Craft a new wooden pickaxe from received inventory at a nearby workbench. Dedicated server evidence only.';
let source,mcp,transportClient,audit,acceptedJob=false;
const abort=()=>{if(acceptedJob)void source?.call('mc_practice',{op:'cancel',id:'real-crafting'}).catch(()=>{});};
options.signal?.addEventListener('abort',abort,{once:true});
try{
  const [practiceServer,sourceServer]=await Promise.all([startServer('practice-server'),startServer('source-server')]);
  const body=new MinecraftAgentClient({cfg:cfg(practiceServer,'H2Practice'),dataDir:join(root,'practice-client'),log:nullLogger(),autoAcknowledgeBarriers:true});clients.push(body);
  await body.connect();await wait(()=>body.status().connection?.ready&&body.status().facts?.experience?.scope);
  const fixtures=[{id:'oak-train',wood:'oak',existing:0},{id:'birch-holdout',wood:'birch',existing:0},{id:'spruce-existing-holdout',wood:'spruce',existing:1}]
    .map(f=>({...f,snapshotId:'vanilla-'+f.id,environmentVersion:'java-1.21.1/vanilla-crafting-v1',goal:{kind:'inventory-gain',item:'wooden_pickaxe',count:1,maxHealthLoss:0}}));
  let resets=0;
  const practice=createClientMethodPractice({directory:join(root,'trials'),client:body,fixtures,agent:'H2Practice',
    validate(candidate){assert.equal(candidate.code,code);assert.equal(candidate.guidance,guidance);assert.deepEqual(Object.keys(candidate.params).sort(),['logs','wood']);assert(['oak','birch','spruce','observed'].includes(candidate.params.wood));assert(Number.isInteger(candidate.params.logs)&&candidate.params.logs>=1&&candidate.params.logs<=4);},
    control:{async reset(fixture,signal){
      signal.throwIfAborted();resets++;const f=fixtures.find(f=>f.id===fixture.id);
      await practiceServer.command(['clear H2Practice','kill @e[type=item]','tp H2Practice 0.5 64 0.5','gamemode survival H2Practice','effect give H2Practice instant_health 1 10 true',`give H2Practice ${f.wood}_log 2`,...(f.existing?['give H2Practice wooden_pickaxe 1']:[])]);
      await wait(async()=>{signal.throwIfAborted();const s=await sample(body),stock={};for(const i of s.items)stock[i.name]=(stock[i.name]??0)+i.count;
        const expected={[f.wood+'_log']:2,...(f.existing?{wooden_pickaxe:f.existing}:{})};
        return Object.keys(stock).length===Object.keys(expected).length&&Object.entries(expected).every(([item,count])=>stock[item]===count)
          &&s.health===20&&/(?:^|:)overworld$/.test(s.dimension??'')&&s.position&&Math.hypot(s.position.x-0.5,s.position.y-64,s.position.z-0.5)<0.1;});
      return {snapshotId:fixture.snapshotId,environmentVersion:fixture.environmentVersion,settled:true};
    },async settle(original,signal){signal.throwIfAborted();if(!original.runId)return 'unknown';
      const run=JSON.parse((await call(body,{runId:original.runId,waitMs:1000})).text);
      const s=await sample(body),q=s.queue;
      return run.status!=='running'&&s.controls===false&&q?.running===null&&q.waiting.length===0?'settled':'unknown';}}});
  let modelCalls=0,settled,pauseNext=false,pauseEntered=false;const settlements=[];
  const done=new Promise(r=>settled=r);
  const scriptedModel={id:'scripted-real-server-integration/v1',async generate(request,signal){signal.throwIfAborted();modelCalls++;assert(!JSON.stringify(request).includes('birch-holdout'));assert(!JSON.stringify(request).includes('spruce-existing-holdout'));
    if(pauseNext){pauseEntered=true;return new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(Error('Explicit cancellation fixture')),{once:true}));}
    if(request.stage.startsWith('experience.'))return {};
    return {files:{'skills/minecraft-method/scripts/params.json':'{"wood":"observed","logs":2}'}};}};
  audit=createPracticeModelAudit({model:options.model??scriptedModel,file:join(root,'model-calls.jsonl'),
    provenance:scripted?{kind:'scripted-test-double'}:options.provenance,trainingJournal:join(root,'source-client/harness2/real-crafting/journal.json'),requireFailureFeedback:!scripted});
  const model=audit.model;
  source=new MinecraftAgentClient({cfg:cfg(sourceServer,'H2Source'),dataDir:join(root,'source-client'),log:nullLogger(),autoAcknowledgeBarriers:true,
    practice:{worker:{command:resolve(args['--python']),script:fileURLToPath(new URL('../bridges/harness2/worker.py',import.meta.url)),workspace:join(root,'optimizer')},
      practice:practice.executor,fixtures,capability:'Real dedicated vanilla Java 1.21.1: received logs, nearby workbench, real crafting and independent inventory snapshots. Edit params.json only; run.js and guidance are immutable.',
      budget:{modelCalls:6,trials:8,wallMs:options.wallMs??600000,trialMs:30000,contextBytes:600000},model,settled:event=>{settlements.push(event);settled();}}});clients.push(source);
  await source.connect();await wait(()=>source.status().connection?.ready&&source.status().facts?.experience?.scope);
  await sourceServer.command(['tp H2Source 0.5 64 0.5']);
  assert.notEqual(source.status().facts.experience.scope.realm,body.status().facts.experience.scope.realm);
  const validation=await call(source,{code,validate:true,waitMs:5000});
  const validationRunId=validation.execution.evidence.localId;
  assert.equal(JSON.parse((await call(source,{runId:validationRunId,waitMs:5000})).text).status,'validated');
  const saved=JSON.parse((await call(source,{library:{op:'save',id:'server-crafting',code,description:guidance,conditions:[],parent:null,validationRunId}})).text);
  const version=JSON.parse((await call(source,{library:{op:'read',id:'server-crafting',revision:saved.reference.revision}})).text);
  mcp=createMinecraftMcpServer(source,'connected-practice-test');transportClient=new Client({name:'practice-agent',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();await mcp.connect(b);await transportClient.connect(a);
  assert((await transportClient.listTools()).tools.some(t=>t.name==='mc_practice'));
  const help=await transportClient.callTool({name:'mc_practice',arguments:{op:'help'}});assert.equal(JSON.parse(help.structuredContent.text).available,true);
  const accepted=await transportClient.callTool({name:'mc_practice',arguments:{op:'start',id:'real-crafting',methodId:version.id,revision:version.revision,task:'Craft one new wooden_pickaxe using received logs at the workbench. Only params.json wood/logs may change.',params:{wood:'oak',logs:1},objective:'success'}});
  assert.equal(JSON.parse(accepted.structuredContent.text).accepted,true);acceptedJob=true;if(options.signal?.aborted)abort();await done;acceptedJob=false;options.signal?.throwIfAborted();
  const expanded=await transportClient.callTool({name:'mc_practice',arguments:{op:'result',id:'real-crafting'}}),result=JSON.parse(expanded.structuredContent.text).result;
  const raw=JSON.parse(readFileSync(join(root,'source-client/harness2/real-crafting/journal.json'),'utf8'));
  if(!result)throw Error('Practice failed: '+JSON.stringify({status:raw.status,reason:raw.reason,failure:raw.failure}));
  if(scripted){assert.equal(result.gate.eligible,true);assert.equal(result.trials,8);assert.equal(modelCalls,4);}
  assert.equal(result.adopted,false);
  assert.equal(result.train.baseline.achieved,false);
  if(scripted){assert.equal(result.train.candidate.achieved,true);assert(result.holdout.every(p=>p.candidate.achieved===true));}
  assert.equal(resets,result.trials);assert.equal(source.experiments().jobs[0].status,'completed');
  const after=JSON.parse((await call(source,{library:{op:'read',id:version.id}})).text);assert.equal(after.revision,version.revision);
  assert.equal(JSON.parse((await call(source,{library:{op:'list'}})).text).methods[0].selected,null);
  const before={resets,modelCalls:audit.snapshot().length};await transportClient.callTool({name:'mc_practice',arguments:{op:'result',id:'real-crafting'}});assert.deepEqual({resets,modelCalls:audit.snapshot().length},before);
  const completedModelRows=audit.snapshot();
  const trialRows=result.evidenceRefs.map(id=>JSON.parse(readFileSync(join(root,'trials',id+'.json'),'utf8')));
  assert(trialRows.every(r=>r.actionSteps>0&&r.trace.length===r.trial.sdkCalls));
  assert.equal(trialRows.filter(r=>r.assessment.achieved).reduce((n,r)=>n+r.failedActions,0),0);
  // Actual public cancellation, followed by runtime/service reconstruction with original durable evidence.
  let cancelJournal=null;
  if(scripted){
  pauseNext=true;
  await transportClient.callTool({name:'mc_practice',arguments:{op:'start',id:'cancelled-crafting',methodId:version.id,revision:version.revision,task:'Same bounded crafting experiment; explicit cancellation test.',params:{wood:'oak',logs:1},objective:'success'}});
  await wait(()=>pauseEntered);
  const cancelled=await transportClient.callTool({name:'mc_practice',arguments:{op:'cancel',id:'cancelled-crafting'}});
  assert.equal(JSON.parse(cancelled.structuredContent.text).cancelRequested,true);await wait(()=>settlements.length===2);
  cancelJournal=JSON.parse(readFileSync(join(root,'source-client/harness2/cancelled-crafting/journal.json'),'utf8'));
  assert.equal(cancelJournal.status,'failed');assert.equal(cancelJournal.trials,1);
  }
  const noReplay={resets,modelCalls:audit.snapshot().length};pauseNext=false;
  await source.disconnect();await source.connect();await wait(()=>source.status().connection?.ready);
  const restored=await transportClient.callTool({name:'mc_practice',arguments:{op:'result',id:'real-crafting'}});
  assert.deepEqual(JSON.parse(restored.structuredContent.text).result,result);
  if(scripted){
  const retry=await transportClient.callTool({name:'mc_practice',arguments:{op:'start',id:'cancelled-crafting',methodId:version.id,revision:version.revision,task:'Must not replay'}});
  assert.equal(retry.isError,true);}
  assert.deepEqual({resets,modelCalls:audit.snapshot().length},noReplay);
  const report=connectedCraftingReport({result,journal:raw,readEvidence:id=>JSON.parse(readFileSync(join(root,'trials',id+'.json'),'utf8')),
    modelCosts:summarizeModelAudit(completedModelRows,audit.provenance),source:{methodId:version.id,revision:version.revision,params:{wood:'oak',logs:1}}});
  Object.assign(report,{serverSha1:'59353fb40c36d304f2035d51e7d6e6baa98dc05c',mcpDiscovered:true,mcpStartAccepted:true,
    mcpCancellationVerified:scripted?true:null,serviceRestartDidNotReplay:true,sourceMethodUnchanged:true,completedReadDidNotReplay:true,
    cancelledJobTrials:cancelJournal?.trials??null,realModelApiCalls:scripted?0:null});
  writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  return report;
}catch(error){
  writeFileSync(join(root,'failure.json'),JSON.stringify({status:'failed',category:options.signal?.aborted?'cancelled':'experiment-failed',
    modelCosts:audit?summarizeModelAudit(audit.snapshot(),audit.provenance):null,adopted:false,liveAgentsModified:false})+'\n',{flag:'wx',mode:0o600});
  throw error;

}finally{
  options.signal?.removeEventListener('abort',abort);
  await transportClient?.close();await mcp?.close();
  for(const client of clients.reverse())await client.disconnect().catch(()=>{});
  for(const s of servers){if(!s.exited)s.child.stdin.write('stop\n');}
  for(const s of servers){try{await wait(()=>s.exited,30000,false);}catch{s.child.kill();}}
}

}
