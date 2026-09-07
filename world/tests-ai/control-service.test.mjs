import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once, EventEmitter } from 'node:events';
import { createControlServer, SERVICES, inventory, buildPlan, redactLog, dockerRequest } from '../admin/control-service.mjs';

const TOKEN='offline-control-test-token-'.repeat(3);
const EXEC_ID='e'.repeat(64),NO_OVERRIDE=Symbol('no override');
const idFor=name=>(SERVICES.indexOf(name)+1).toString(16).padStart(64,'0');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function fixture(t,options={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'qd-control-test-'));
  const stateDir=path.join(root,'state'),maintenanceDir=path.join(root,'maintenance');
  await fs.mkdir(stateDir);await fs.mkdir(maintenanceDir);
  if(options.prepare)await options.prepare({root,stateDir,maintenanceDir});
  const calls=[],rows=new Map(SERVICES.map(name=>[name,{
    Id:idFor(name),Config:{Labels:{'com.docker.compose.project':'qiandengji','com.docker.compose.service':name}},
    State:{Status:'running',Running:true,StartedAt:'2026-09-07T10:00:00Z',Health:{Status:'healthy'}},
    HostConfig:{RestartPolicy:{Name:'unless-stopped'}}
  }]));
  if(options.rows)options.rows(rows);
  const engine=async(method,route,body,timeout)=>{
    calls.push({method,route,body,timeout});
    if(options.engine){const result=await options.engine({method,route,body,rows,calls,root,stateDir,maintenanceDir});if(result!==NO_OVERRIDE)return result;}
    if(route===`/exec/${EXEC_ID}/start`)return 'Saving the game...\nSaved the game';
    if(route===`/exec/${EXEC_ID}/json`)return {ExitCode:0};
    const match=route.match(/^\/containers\/([^/]+)\/(json|start|stop|exec|logs)(?:\?|$)/);
    if(!match)throw new Error('unexpected_fake_route');
    const row=[...rows.values()].find(row=>row.Id===match[1])||rows.get(match[1].replace(/^qiandengji-/,'').replace(/-1$/,''));
    if(!row)throw new Error('docker_404');
    if(match[2]==='json')return structuredClone(row);
    if(match[2]==='logs')return options.logs||'ordinary safe log';
    if(match[2]==='exec')return {Id:EXEC_ID};
    row.State.Status=match[2]==='start'?'running':'exited';row.State.Running=match[2]==='start';
    return '';
  };
  const server=createControlServer({token:TOKEN,stateDir,maintenanceDir,engine,...options.server});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${server.address().port}`;
  const request=async(route,body,auth=TOKEN)=>{
    const response=await fetch(url+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,value:await response.json()};
  };
  const terminal=async id=>{
    for(let attempt=0;attempt<250;attempt++){
      const result=await request('/operations'),record=result.value.operations.find(r=>r.id===id);
      if(!result.value.active&&record?.status!=='running')return record;
      await wait(5);
    }
    throw new Error('fake operation did not settle');
  };
  const operate=async input=>{
    const plan=await request('/plan',input);assert.equal(plan.status,200,JSON.stringify(plan.value));
    const accepted=await request('/execute',{planId:plan.value.id});assert.equal(accepted.status,202,JSON.stringify(accepted.value));
    return terminal(plan.value.id);
  };
  return {root,stateDir,maintenanceDir,rows,calls,engine,request,terminal,operate};
}

test('log redaction covers quoted JSON keys, nested credentials, text values, URL credentials and escaped strings',()=>{
  const secrets=['SENTINEL_JSON','SENTINEL_NESTED','SENTINEL_SPACED','SENTINEL_ESCAPED','SENTINEL_BEARER','SENTINEL_URL','SENTINEL_QUERY','SENTINEL_IN_MESSAGE'];
  const samples=[
    '2026-09-07T12:00:00Z [INFO] '+JSON.stringify({password:secrets[0],safe:42,nested:{apiKey:[secrets[1]]},credentials:{first:secrets[0],second:secrets[1]}}),
    `token='${secrets[2]} two words'; safe=ok`,
    `prefix {"api_key": "${secrets[3]}\\\" slash\\\\end"} trailing`,
    `Authorization: Bearer ${secrets[4]}`,
    `https://user:${secrets[5]}@example.invalid/path?api_key=${secrets[6]}&safe=ok`,
    JSON.stringify({message:JSON.stringify({token:secrets[7]})}),
  ];
  const output=redactLog(samples.join('\n'));
  for(const secret of secrets)assert.equal(output.includes(secret),false,secret);
  assert.match(output,/"safe":42/);assert.match(output,/safe=ok/);assert.match(output,/\[redacted\]/);
});

test('Docker 304 is success only for start/stop, never for an unrelated request',async()=>{
  const requestImpl=(_options,callback)=>{
    const request=new EventEmitter();request.setTimeout=()=>{};
    request.end=()=>queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=304;response.headers={};callback(response);response.emit('end');});
    return request;
  };
  for(const route of ['/containers/id/start','/containers/id/stop?t=30'])assert.equal(await dockerRequest('POST',route,undefined,100,requestImpl),'');
  await assert.rejects(dockerRequest('GET','/containers/id/json',undefined,100,requestImpl),/docker_304/);
});

test('authentication and service whitelist reject arbitrary commands and self-control without engine writes',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/services',undefined,'wrong')).status,401);
  for(const services of [['shadow-mc'],['control'],['../mc']])assert.equal((await f.request('/plan',{action:'stop',services})).status,400);
  assert.equal((await f.request('/plan',{action:'stop',services:['mc'],command:'arbitrary'})).status,400);
  assert.equal(f.calls.some(c=>c.method==='POST'),false);
});

test('missing/foreign/malformed container identity and stopped required dependencies fail closed',async t=>{
  const f=await fixture(t);
  for(const mutation of [r=>r.Id='',r=>r.Id='not-an-immutable-id',r=>r.Config.Labels['com.docker.compose.project']='shadow',r=>r.State.Status='unknown']){
    const before=structuredClone(f.rows.get('world'));mutation(f.rows.get('world'));
    assert.equal((await f.request('/plan',{action:'stop',services:['world']})).value.error,'unverified_container');f.rows.set('world',before);
  }
  f.rows.get('mc').State.Status='exited';
  assert.equal((await f.request('/plan',{action:'start',services:['world']})).value.error,'dependency_not_ready');
  assert.equal(f.calls.some(c=>c.method==='POST'),false);
});

test('explicit dependency plan does not start an already stopped NPC as a side effect',async t=>{
  const f=await fixture(t);f.rows.get('npc').State.Status='exited';f.rows.get('npc').State.Running=false;
  const plan=buildPlan({action:'restart',services:['world']},await inventory(f.engine));
  assert.deepEqual(plan.stop,['npc','world']);assert.deepEqual(plan.start,['world']);assert.deepEqual(plan.required,['mc']);
  const result=await f.operate({action:'restart',services:['world']});assert.equal(result.ok,true);
  assert.equal(f.calls.some(c=>c.method==='POST'&&c.route===`/containers/${idFor('npc')}/start`),false);
});

test('MC restart stops consumers, acknowledges save, stops MC then starts dependencies in order',async t=>{
  const f=await fixture(t),result=await f.operate({action:'restart',services:['mc']});
  assert.equal(result.ok,true);assert.equal(result.cleanup.lockReleased,true);
  assert.deepEqual(result.steps.map(s=>s.name),['停止 npc','停止 gate','停止 world','保存 Minecraft','停止 mc','启动并检查 mc','启动并检查 world','启动并检查 gate','启动并检查 npc']);
  const exec=f.calls.find(c=>c.route===`/containers/${idFor('mc')}/exec`);assert.deepEqual(exec.body.Cmd,['rcon-cli','save-all','flush']);
  assert.equal((await f.request('/execute',{planId:result.id})).value.error,'plan_expired');
});

test('save output or exec failure prevents MC stop and records consumers already stopped without replay',async t=>{
  for(const failure of ['output','exit','transport'])await t.test(failure,async sub=>{
    const f=await fixture(sub,{engine:({route})=>{
      if(route===`/exec/${EXEC_ID}/start`){if(failure==='transport')throw new Error('PRIVATE_ENGINE_FAILURE');if(failure==='output')return 'not saved';}
      if(route===`/exec/${EXEC_ID}/json`&&failure==='exit')return {ExitCode:1};return NO_OVERRIDE;
    }});
    const result=await f.operate({action:'stop',services:['mc']});
    assert.equal(result.ok,false);assert.equal(result.pendingRecovery,true);assert.equal(result.cleanup.lockReleased,true);
    assert.equal(f.calls.some(c=>c.route===`/containers/${idFor('mc')}/stop?t=30`),false);
    assert.equal(f.rows.get('mc').State.Status,'running');assert.equal(f.rows.get('world').State.Status,'exited');
    assert.equal(JSON.stringify(result).includes('PRIVATE_ENGINE_FAILURE'),false);
    assert.equal(result.steps.find(s=>s.name==='保存 Minecraft').status,'failed');
  });
});

test('already stopped MC is not saved or started by a stop operation',async t=>{
  const f=await fixture(t,{rows:rows=>{rows.get('mc').State.Status='exited';rows.get('mc').State.Running=false;}});
  const result=await f.operate({action:'stop',services:['mc']});assert.equal(result.ok,true);
  assert.equal(f.calls.some(c=>c.method==='POST'&&(c.route.endsWith('/exec')||c.route.endsWith('/start'))),false);
});

test('QA lock refuses all lifecycle actions and is never removed',async t=>{
  const f=await fixture(t),lock=path.join(f.maintenanceDir,'.qiandengji-smoke.lock'),bytes='{"kind":"qa","owner":"another-session"}';
  await fs.writeFile(lock,bytes);const result=await f.operate({action:'stop',services:['world']});
  assert.equal(result.error,'maintenance_busy');assert.equal(result.pendingRecovery,false);
  assert.equal(await fs.readFile(lock,'utf8'),bytes);assert.equal(f.calls.some(c=>c.method==='POST'),false);
});

test('recorder marker or inaccessible marker refuses lifecycle actions and releases only owned lock',async t=>{
  for(const mode of ['present','inaccessible'])await t.test(mode,async sub=>{
    const fileSystem={...fs,stat:async file=>{if(mode==='inaccessible'&&file.endsWith('.qiandengji-recorder-qa.json'))throw Object.assign(new Error('denied'),{code:'EACCES'});return fs.stat(file);}};
    const f=await fixture(sub,{server:{fileSystem}});
    if(mode==='present')await fs.writeFile(path.join(f.maintenanceDir,'.qiandengji-recorder-qa.json'),'{}');
    const result=await f.operate({action:'stop',services:['world']});
    assert.equal(result.error,mode==='present'?'recorder_busy':'maintenance_unavailable');assert.equal(result.cleanup.lockReleased,true);
    assert.equal(f.calls.some(c=>c.method==='POST'),false);
  });
});

test('plan is re-inspected inside the lock and rejects replaced immutable container IDs',async t=>{
  const f=await fixture(t),plan=await f.request('/plan',{action:'stop',services:['world']});
  f.rows.get('world').Id='f'.repeat(64);
  assert.equal((await f.request('/execute',{planId:plan.value.id})).status,202);
  const result=await f.terminal(plan.value.id);assert.equal(result.error,'plan_changed');
  assert.equal(f.calls.some(c=>c.method==='POST'),false);assert.equal(result.cleanup.lockReleased,true);
});

test('plan expiry cannot be extended or replayed',async t=>{
  let time=Date.now();const f=await fixture(t,{server:{clock:()=>time}}),plan=await f.request('/plan',{action:'stop',services:['world']});
  time+=60001;assert.equal((await f.request('/execute',{planId:plan.value.id})).value.error,'plan_expired');
  assert.equal(f.calls.some(c=>c.method==='POST'),false);
});

test('concurrent execution is blocked while an accepted operation is active',async t=>{
  let release;const blocked=new Promise(resolve=>{release=resolve;});
  const f=await fixture(t,{engine:async({method,route})=>{if(method==='POST'&&route===`/containers/${idFor('panel')}/stop?t=30`)await blocked;return NO_OVERRIDE;}});
  const a=await f.request('/plan',{action:'stop',services:['panel']}),b=await f.request('/plan',{action:'stop',services:['asr']});
  assert.equal((await f.request('/execute',{planId:a.value.id})).status,202);
  try{assert.equal((await f.request('/execute',{planId:b.value.id})).value.error,'operation_busy');}finally{release();}
  assert.equal((await f.terminal(a.value.id)).ok,true);
});

test('initial journal failure clears active, keeps a failed memory receipt, blocks writes and does no Docker work',async t=>{
  const f=await fixture(t,{server:{fileSystem:{...fs,writeFile:async()=>{throw new Error('disk full');}}}});
  const plan=await f.request('/plan',{action:'stop',services:['panel']});
  assert.equal((await f.request('/execute',{planId:plan.value.id})).status,503);
  const operations=await f.request('/operations');assert.equal(operations.value.active,null);assert.equal(operations.value.operations[0].status,'failed');
  assert.equal(operations.value.operations[0].pendingRecovery,false);assert.equal((await f.request('/healthz')).status,503);
  assert.equal((await f.request('/plan',{action:'stop',services:['panel']})).status,503);
  assert.equal(f.calls.some(c=>c.method==='POST'),false);
});

test('terminal journal failure reports failed memory state and does not leave active busy',async t=>{
  const fileSystem={...fs,writeFile:async(file,bytes,options)=>{if(file.endsWith('.tmp')&&JSON.parse(bytes).status==='complete')throw new Error('disk full');return fs.writeFile(file,bytes,options);}};
  const f=await fixture(t,{server:{fileSystem}}),result=await f.operate({action:'stop',services:['panel']});
  assert.equal(result.ok,false);assert.equal(result.status,'failed');assert.equal(result.journalError,'journal_write_failed');assert.equal(result.pendingRecovery,true);
  assert.equal(result.steps[0].status,'complete');assert.equal(result.cleanup.lockReleased,true);assert.equal((await f.request('/healthz')).status,503);
});

test('journal failure before an action prevents the action and releases its owned lock',async t=>{
  const fileSystem={...fs,writeFile:async(file,bytes,options)=>{
    if(file.endsWith('.tmp')&&JSON.parse(bytes).steps?.length)throw new Error('disk full');
    return fs.writeFile(file,bytes,options);
  }};
  const f=await fixture(t,{server:{fileSystem}}),result=await f.operate({action:'stop',services:['panel']});
  assert.equal(result.ok,false);assert.equal(result.error,'journal_write_failed');assert.equal(result.steps[0].status,'not_started');
  assert.equal(result.steps[0].attempted,false);assert.equal(result.cleanup.lockReleased,true);
  assert.equal(f.calls.some(c=>c.method==='POST'),false);
});

test('unreadable crash journal keeps read-only service inventory available but blocks new plans',async t=>{
  const f=await fixture(t,{prepare:async({stateDir})=>fs.writeFile(path.join(stateDir,'b'.repeat(32)+'.json'),'{invalid')});
  assert.equal((await f.request('/healthz')).status,503);
  assert.equal((await f.request('/services')).status,200);
  assert.equal((await f.request('/operations')).value.journalError,'journal_unavailable');
  assert.equal((await f.request('/plan',{action:'start',services:['panel']})).status,503);
  assert.equal(f.calls.some(c=>c.method==='POST'),false);
});

test('readiness timeout fails after a single start attempt without waiting on real time',async t=>{
  let time=Date.now();
  const f=await fixture(t,{server:{clock:()=>time,sleep:async()=>{time+=60001;}},rows:rows=>{rows.get('panel').State.Health.Status='starting';}});
  const result=await f.operate({action:'start',services:['panel']});
  assert.equal(result.error,'readiness_timeout');assert.equal(result.pendingRecovery,true);assert.equal(result.cleanup.lockReleased,true);
  assert.equal(f.calls.filter(c=>c.method==='POST'&&c.route===`/containers/${idFor('panel')}/start`).length,1);
});

test('crash history is marked interrupted with uncertain steps; restart never replays or deletes stale lock',async t=>{
  const id='a'.repeat(32),bytes='{"kind":"management","operation":"old","nonce":"old"}';
  const f=await fixture(t,{prepare:async({stateDir,maintenanceDir})=>{
    await fs.writeFile(path.join(stateDir,id+'.json'),JSON.stringify({id,startedAt:'2026-09-07T10:00:00Z',status:'running',ok:false,steps:[{name:'停止 mc',status:'running'}]}));
    await fs.writeFile(path.join(maintenanceDir,'.qiandengji-smoke.lock'),bytes);
  }});
  const result=(await f.request('/operations')).value.operations[0];
  assert.equal(result.status,'failed');assert.equal(result.error,'control_restarted');assert.equal(result.pendingRecovery,true);
  assert.equal(result.steps[0].status,'not_confirmed');assert.equal(result.steps[0].outcomeUncertain,true);
  assert.equal(await fs.readFile(path.join(f.maintenanceDir,'.qiandengji-smoke.lock'),'utf8'),bytes);
  assert.equal(f.calls.length,0);assert.equal(JSON.parse(await fs.readFile(path.join(f.stateDir,id+'.json'),'utf8')).status,'failed');
});

test('replaced lock is preserved and success is not claimed when ownership cannot be verified',async t=>{
  const replacement='{"kind":"qa","owner":"replacement"}';
  const f=await fixture(t,{engine:async({method,route,maintenanceDir})=>{
    if(method==='POST'&&route===`/containers/${idFor('panel')}/stop?t=30`)await fs.writeFile(path.join(maintenanceDir,'.qiandengji-smoke.lock'),replacement);
    return NO_OVERRIDE;
  }}),result=await f.operate({action:'stop',services:['panel']});
  assert.equal(result.ok,false);assert.equal(result.error,'maintenance_lock_changed');assert.equal(result.cleanup.lockReleased,false);
  assert.equal(await fs.readFile(path.join(f.maintenanceDir,'.qiandengji-smoke.lock'),'utf8'),replacement);
});

test('container start failure preserves completed steps and does not auto-replay or conceal uncertain effects',async t=>{
  const f=await fixture(t,{engine:({method,route})=>{if(method==='POST'&&route===`/containers/${idFor('world')}/start`)throw new Error('docker_timeout');return NO_OVERRIDE;}});
  const result=await f.operate({action:'restart',services:['world']});
  assert.equal(result.ok,false);assert.equal(result.error,'docker_timeout');assert.equal(result.pendingRecovery,true);
  assert.equal(result.steps.at(-1).outcomeUncertain,true);assert.equal(result.steps[0].status,'complete');
  assert.equal(f.calls.filter(c=>c.route===`/containers/${idFor('world')}/start`).length,1);
});

test('logs route returns redacted text and rejects unknown services without arbitrary Docker access',async t=>{
  const f=await fixture(t,{logs:'{"password":"PRIVATE_LOG_SENTINEL","state":"running"}'});
  const result=await f.request('/logs?service=world');assert.equal(result.status,200);assert.equal(JSON.stringify(result).includes('PRIVATE_LOG_SENTINEL'),false);
  assert.match(result.value.text,/running/);assert.equal((await f.request('/logs?service=shadow-world')).status,400);
});
