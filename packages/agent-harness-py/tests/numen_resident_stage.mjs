// Integration against a disposable new world with the hosted Numen bridge already listening on loopback.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {siteFixture} from '../../../paper/integrations/agent-portal/tests/helpers.mjs';
import {command} from '../../../paper/ops/rcon-client.mjs';

const [labArg, python] = process.argv.slice(2);
const lab = path.resolve(labArg);
assert.equal(await fs.readFile(path.join(lab,'.resident-hybrid-qa'),'utf8'),'SYNTHETIC_RESIDENT_HYBRID_ONLY');
const properties=path.join(lab,'server.properties');
const network=await fs.readFile(properties,'utf8');
assert.match(network,/^server-ip=127\.0\.0\.1\s*$/m);
const rconPort=Number(network.match(/^rcon.port=(\d+)/m)[1]);
assert(rconPort!==25575);
const rc=text=>command(text,5000,{port:rconPort,properties});
await rc('minecraft:difficulty peaceful');
const run = await fs.mkdtemp(path.join(lab,'new-resident-'));
const src = fileURLToPath(new URL('../src/',import.meta.url));
const privateRoot = path.join(lab,'plugins/numen_hosted/server');
const boot = JSON.parse(await fs.readFile(path.join(privateRoot,'hosted-bootstrap.json'),'utf8'));
const key = 'rwt_'+randomBytes(32).toString('base64url');
const slot = {id:'numenslot',bodyKind:'numen',bodyId:randomUUID(),ownerGameId:randomUUID(),
  workerHash:createHash('sha256').update(key).digest('hex')};
const close = [];
const site = await siteFixture({after:fn => close.push(fn)},{residentCreationSlots:[slot]});
const technicalName = 'Qa'+randomUUID().replaceAll('-','').slice(0,11);
const put = async (name,data) => { const file=path.join(run,name); await fs.writeFile(file,JSON.stringify(data)); return file; };
const worker = path.join(run,'worker.token');
await fs.writeFile(worker,key,{mode:0o600});
const base = site.origin+'/api/v1';
const roleURL = base+'/resident-turns/'+slot.id;
const cfg = {schema:1,serverId:'isolated-resident',stateDirectory:path.join(run,'state'),pauseFile:path.join(run,'pause'),
  rolesFile:await put('roles.json',{schema:1,roles:[]}),
  providers:{tokenplan:await put('model.json',{baseUrl:'http://127.0.0.1:9',apiKey:'offline-fixture'})},
  bodies:{[slot.id]:{endpoint:'http://127.0.0.1:'+boot.mcpPort+'/mcp',controllerId:randomUUID(),name:technicalName}},
  residentTurns:{[slot.id]:{endpoint:roleURL,tokenFile:worker}},
  residentCreationSlots:{[slot.id]:{...slot,roleDefaults:{persona:'独立居民',provider:'tokenplan',model:'offline',interval_seconds:600,
    allowed_tools:['body:observe','body:chat']},numenAdmission:{endpoint:'http://127.0.0.1:'+boot.port+'/v1/hosted-role',
    controlKeyFile:path.join(privateRoot,'hosted-model.key')}}}};
const config = await put('service.json',cfg);
async function api(url, data, token) {
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});
  assert(response.ok,'portal '+new URL(url).pathname+' '+response.status);
  return response.json();
}
async function until(fn, ms, label) {
  const end=Date.now()+ms;
  while(Date.now()<end){const value=await fn();if(value)return value;await delay(250);}
  throw new Error(label+' timed out');
}
let service;
let restartedGame;
const start = async () => {
  await fs.rm(cfg.pauseFile,{force:true});
  const logfile=await fs.open(path.join(run,'host.log'),'a');
  service=spawn(python,['-m','agent_mc_harness.npc_service','--config',config],{cwd:run,stdio:['ignore',logfile.fd,logfile.fd],
    env:{...process.env,PYTHONPATH:src,PYTHONUTF8:'1'},windowsHide:true});
  await logfile.close();
};
const stop = async () => {
  if(!service || service.exitCode!==null || service.signalCode!==null)return;
  const exited=new Promise(resolve=>service.once('exit',resolve));
  await fs.writeFile(cfg.pauseFile,'QA');
  const kill=setTimeout(()=>service?.kill(),15_000);
  try { await exited; } finally {clearTimeout(kill);}
};

try {
  const {data:{code}}=await site.admin.request('/resident-onboarding/code','POST',{});
  const {onboardingToken}=await api(base+'/resident-onboarding/pair',{code});
  const create={requestId:randomUUID(),bodyKind:'numen',name:'云灯',persona:'热爱村庄的夜空。'};
  const {resident}=await api(base+'/resident-onboarding/create',create,onboardingToken);
  assert.equal(resident.state,'preparing');
  await start();
  const ready=await until(async () => {
    assert.equal(service.exitCode,null,'NPC service stopped');
    const {residents}=await api(base+'/resident-onboarding/list',{},onboardingToken);
    return residents.find(row=>row.id===slot.id && row.state==='available');
  },120_000,'new game body');
  assert.equal(ready.characterId,resident.characterId);
  assert((await rc('minecraft:list')).includes(technicalName));
  const desktop=await api(base+'/resident-onboarding/connect',{id:slot.id,characterId:ready.characterId},onboardingToken);
  const begin=await api(roleURL+'/begin',{},desktop.token);
  const turn=await until(async () => {
    const {turn}=await api(roleURL+'/poll',{},desktop.token);
    return turn?.scene.desktopRequestId===begin.requestId && turn;
  },70_000,'desktop wake');
  assert.equal(turn.resident.bodyId,slot.bodyId);
  assert.equal(turn.scene.observed.life_state,'alive');
  assert(turn.scene.observed.dimension && turn.scene.observed.position);
  assert(turn.scene.communication.outputs.some(o=>o.mode==='native' && o.scope==='nearby' && !o.sourceEventId));
  const phrase='云灯已在村口等你。';
  const reply=await api(roleURL+'/reply',{id:turn.id,answer:{communication:{text:phrase,mode:'native'}}},desktop.token);
  assert.equal(reply.accepted,true);
  const proof=`
import asyncio,json,sys,time
from pathlib import Path
from agent_mc_harness._reuse import numen_controller
from agent_mc_harness.body.numen import _field
async def main():
 cfg=json.loads(Path(sys.argv[1]).read_text()); body=cfg["residentCreationSlots"]["numenslot"]
 transport=cfg["bodies"]["numenslot"]; token=(Path(cfg["stateDirectory"])/"numenslot/numen/hosted.token").read_text()
 sdk=numen_controller()
 async with sdk.streamablehttp_client(transport["endpoint"],headers={"Authorization":"Bearer "+token},timeout=10) as streams:
  async with sdk.ClientSession(streams[0],streams[1]) as session:
   await session.initialize()
   for _ in range(24):
    args={"op":"web_replies","companion":body["bodyId"],"expectedName":transport["name"],"expectedOwner":body["ownerGameId"],"serverId":cfg["serverId"]}
    result=await session.call_tool("hosted_body",args)
    assert not _field(result,"isError","is_error")
    value=_field(result,"structuredContent","structured_content") or json.loads(result.content[0].text)
    for line in value["replies"]:
     if line["body"]==sys.argv[2] and line["source"] in {"numen.hosted-speech","numen_hosted.hosted-speech"}:
      print(json.dumps({"source":line["source"],"id":line["id"]}));return
    await asyncio.sleep(.5)
   raise AssertionError("No matching speech committed by this native body")
asyncio.run(main())
`;
  const speech=JSON.parse((await promisify(execFile)(python,['-c',proof,config,phrase],
    {cwd:run,env:{...process.env,PYTHONPATH:src,PYTHONUTF8:'1'},windowsHide:true,timeout:30_000})).stdout);
  const tokenPath=path.join(cfg.stateDirectory,slot.id,'numen','hosted.token');
  const issuedBeforeRestart=await fs.readFile(tokenPath,'utf8');
  const supervisorPid=service.pid;
  if(process.env.RESIDENT_QA_JAVA){
    assert.equal(await fs.readFile(path.join(lab,'.numen-admission-restart-qa'),'utf8'),'DISPOSABLE_WORLD');
    await rc('minecraft:stop').catch(()=>{});
    await until(async()=>{try{await rc('minecraft:list');return false;}catch{return true;}},20_000,'isolated server exit');
    const gameLog=await fs.open(path.join(lab,'server-restart-qa.log'),'a');
    restartedGame=spawn(process.env.RESIDENT_QA_JAVA,['-Xms512m','-Xmx2200m','-jar','server.jar','nogui'],{
      cwd:lab,windowsHide:true,stdio:['pipe',gameLog.fd,gameLog.fd]});
    await gameLog.close();
    await until(async()=>{try{return (await rc('minecraft:list')).includes(technicalName);}catch{return false;}},180_000,'same running supervisor re-admits after game restart');
  }else{
    await stop();await start();
  }
  const reboot=await api(roleURL+'/begin',{},desktop.token);
  const after=await until(async () => {
    const {turn}=await api(roleURL+'/poll',{},desktop.token);
    if(turn && turn.scene.desktopRequestId!==reboot.requestId)
      await api(roleURL+'/reply',{id:turn.id,answer:{steps:[]}},desktop.token);
    return turn?.scene.desktopRequestId===reboot.requestId && turn;
  },65_000,'restart control');
  assert.equal(after.resident.characterId,resident.characterId);
  assert.equal(after.resident.bodyId,slot.bodyId);
  if(restartedGame){
    assert.equal(service.pid,supervisorPid);
    assert.notEqual(await fs.readFile(tokenPath,'utf8'),issuedBeforeRestart);
  }
  await api(roleURL+'/reply',{id:after.id,answer:{steps:[]}},desktop.token);
  const evidence={body:slot.bodyId,character:ready.characterId,name:resident.name,technicalName,
    dimension:turn.scene.observed.dimension,position:turn.scene.observed.position,life:turn.scene.observed.life_state,
    gameChat:phrase,nativeSpeech:speech,resumedSameCharacter:true,restartedGame:!!restartedGame};
  await put('evidence.json',evidence);
  console.log(JSON.stringify(evidence));
} finally {
  await stop();
  if(restartedGame && restartedGame.exitCode===null){
    const stopped=once(restartedGame,'exit');
    restartedGame.stdin.end('stop\n');
    const kill=setTimeout(()=>restartedGame.kill(),20_000);
    try{await stopped;}finally{clearTimeout(kill);}
  }
  for(const fn of close)await fn();
}
