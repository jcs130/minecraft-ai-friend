// Generic container-fleet control plane: plan/execute lifecycle with durable
// audit receipts, crash recovery and "uncertain outcome is terminal" semantics.
// Every project-specific fact (service list, dependency graph, container naming,
// maintenance interlocks, pre-stop hooks) arrives through a `topology` object,
// so this module carries no knowledge of any particular deployment.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export function redactLog(text) {
  const sensitive = key => /(?:password|passwd|secret|token|authorization|api.?key|credential)/i.test(key);
  const redactText=value=>value.replace(/(Bearer\s+)[^\s"']+/gi,'$1[redacted]')
    .replace(/((?:["'][\w.-]*(?:api[_-]?key|password|passwd|secret|token|authorization|credential)[\w.-]*["']|\b[\w.-]*(?:api[_-]?key|password|passwd|secret|token|authorization|credential)[\w.-]*)\s*[=:]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}&]+)/gi,'$1"[redacted]"')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1[redacted]@');
  const redactObject = value => Array.isArray(value) ? value.map(redactObject) : value && typeof value==='object'
    ? Object.fromEntries(Object.entries(value).map(([key,item])=>[key,sensitive(key)?'[redacted]':redactObject(item)]))
    : typeof value==='string'?redactText(value):value;
  // Container logs commonly have a Docker timestamp before a JSON object.
  const structured = String(text).split('\n').map(line=>{
    // A textual [INFO] prefix is not a JSON array; still inspect the following object.
    for(const start of [...new Set([line.indexOf('['),line.indexOf('{')])].filter(n=>n>=0).sort((a,b)=>a-b)) {
      try{return line.slice(0,start)+JSON.stringify(redactObject(JSON.parse(line.slice(start))));}catch{}
    }
    return line;
  }).join('\n');
  return redactText(structured);
}
function unpack(buffer) {
  let at=0,out=[];
  while(at+8<=buffer.length && buffer[at]<=2 && buffer[at+1]===0 && buffer[at+2]===0 && buffer[at+3]===0) {
    const length=buffer.readUInt32BE(at+4); if(at+8+length>buffer.length) break;
    out.push(buffer.subarray(at+8,at+8+length));at+=8+length;
  }
  return (at===buffer.length ? Buffer.concat(out) : buffer).toString('utf8');
}
export function dockerRequest(method, route, body, timeout=15000, requestImpl=http.request) {
  return new Promise((resolve,reject) => {
    const request=requestImpl({socketPath:'/var/run/docker.sock',path:'/v1.47'+route,method,
      headers:body ? {'Content-Type':'application/json'} : {}},response => {
      let size=0,chunks=[];
      response.on('data',part=>{size+=part.length;if(size>1024*1024)request.destroy(new Error('response_limit'));else chunks.push(part);});
      response.on('end',()=>{
        const data=Buffer.concat(chunks);
        // Docker reports an already stopped/started container as 304, with no body.
        if(response.statusCode===304&&method==='POST'&&/^\/containers\/[^/?]+\/(start|stop)(?:\?|$)/.test(route))return resolve('');
        if(response.statusCode>=300) return reject(new Error('docker_'+response.statusCode));
        if(response.headers['content-type']?.includes('application/json')) {
          try {resolve(JSON.parse(data.toString()||'null'));} catch {reject(new Error('docker_json'));}
        } else resolve(unpack(data));
      });
      response.on('error',reject);response.on('aborted',()=>reject(new Error('docker_response_aborted')));
    });
    request.setTimeout(timeout,()=>request.destroy(new Error('docker_timeout')));
    request.on('error',reject);request.end(body ? JSON.stringify(body) : undefined);
  });
}

// A topology names the fleet. `immutable` services are visible but never acted
// on; `dependents` is derived so a new dependency edge cannot be forgotten in
// the stop fan-out. `preStop` hooks run after every other service has stopped
// and before their own service does, each publishing `planFlag` in the plan so
// operators can preview whether the hook will fire.
export function defineTopology(spec) {
  if(!Array.isArray(spec?.services)||!spec.services.length||!Array.isArray(spec.startOrder))throw new Error('topology_configuration');
  const immutable=new Set(spec.immutable||[]);
  const deferredHealth=new Set(spec.deferredHealth||[]);
  if([...deferredHealth].some(id=>!spec.services.includes(id)||(spec.healthGated||[]).includes(id)))throw new Error('topology_configuration');
  const dependencies=spec.dependencies||{};
  const dependents={};
  for(const [service,needs] of Object.entries(dependencies))
    for(const need of needs)(dependents[need]??=[]).push(service);
  const preStop=(spec.preStop||[]).map(hook=>{
    if(!hook.service||!hook.planFlag||!hook.name||typeof hook.run!=='function')throw new Error('topology_configuration');
    return hook;
  });
  return {
    project:spec.project,
    serviceName:spec.serviceName||'control',
    containerName:spec.containerName||(id=>id),
    services:[...spec.services],
    mutable:spec.services.filter(id=>!immutable.has(id)),
    dependencies,dependents,
    startOrder:[...spec.startOrder],
    healthGated:new Set(spec.healthGated||[]),
    deferredHealth,
    lockFile:spec.lockFile||'.control-operation.lock',
    refuseIfPresent:spec.refuseIfPresent||[],
    preStop,
    explanation:spec.explanation||'',
    labels:{stop:id=>'停止 '+id,start:id=>'启动并检查 '+id,...spec.labels},
    errorCodes:spec.errorCodes||[],
  };
}

export async function inventory(engine=dockerRequest, topology) {
  return Promise.all(topology.services.map(async id=>{
    try {
      const row=await engine('GET','/containers/'+topology.containerName(id)+'/json');
      const owned=row.Config?.Labels?.['com.docker.compose.project']===topology.project && row.Config?.Labels?.['com.docker.compose.service']===id;
      return {id,containerId:row.Id,owned,state:row.State?.Status||'unknown',health:row.State?.Health?.Status||null,
        startedAt:row.State?.StartedAt||null,restart:row.HostConfig?.RestartPolicy?.Name||null,canControl:owned&&topology.mutable.includes(id)};
    } catch {return {id,owned:false,state:'unavailable',health:null,canControl:false};}
  }));
}
export function buildPlan(input, rows, topology) {
  const {mutable,startOrder,dependencies,dependents,healthGated,preStop}=topology;
  if(!input || !['start','stop','restart'].includes(input.action) || !Array.isArray(input.services) || !input.services.length || input.services.length>mutable.length || Object.keys(input).some(k=>!['action','services'].includes(k))) throw new Error('invalid_plan');
  const selected=[...new Set(input.services)];
  if(selected.some(n=>!mutable.includes(n))) throw new Error('unknown_service');
  const byId=new Map(rows.map(r=>[r.id,r]));
  const affected=new Set(selected);
  if(input.action!=='start') {
    // Stopping a service takes its dependents down too. Iterating the Set while
    // adding to it walks the transitive closure, so an added dependency edge
    // cannot be missed here.
    for(const name of affected) for(const child of dependents[name]||[]) affected.add(child);
  }
  const deferred=new Set(preStop.map(hook=>hook.service));
  const stop=input.action==='start'?[]:[...startOrder].reverse().filter(n=>affected.has(n));
  const start=input.action==='stop'?[]:startOrder.filter(n=>selected.includes(n)||(affected.has(n)&&byId.get(n)?.state==='running'));
  const required=[...new Set(start.flatMap(n=>dependencies[n]||[]))].filter(n=>!start.includes(n));
  for(const n of new Set([...stop,...start,...required])) {
    const r=byId.get(n);if(!r?.owned || !/^[a-f0-9]{64}$/.test(r.containerId||'') || !['running','exited','created'].includes(r.state)) throw new Error('unverified_container');
  }
  for(const n of required) if(byId.get(n).state!=='running'||(healthGated.has(n)&&byId.get(n).health!=='healthy')) throw new Error('dependency_not_ready');
  const plan={action:input.action,selected,stop,start,required};
  for(const hook of preStop) plan[hook.planFlag]=stop.includes(hook.service)&&byId.get(hook.service).state==='running';
  plan.containers=Object.fromEntries([...new Set([...stop,...start,...required])].map(n=>[n,byId.get(n).containerId]));
  plan.explanation=topology.explanation;
  return plan;
}
const BASE_ERROR_CODES=['invalid_plan','unknown_service','unverified_container','dependency_not_ready',
  'maintenance_busy','maintenance_unavailable','maintenance_lock_changed','recorder_busy','plan_changed',
  'save_not_acknowledged','service_exited','readiness_timeout','journal_write_failed','journal_unavailable',
  'response_limit','docker_json','docker_timeout','docker_response_aborted','operation_failed'];
const RECOVERY='请核对已完成步骤与当前状态后重新生成计划；本次不会自动重放。';

export function createControlServer({topology,token,stateDir,maintenanceDir,engine=dockerRequest,clock=Date.now,fileSystem=fs,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  if(!topology||typeof token!=='string'||token.length<32||!stateDir||!maintenanceDir)throw new Error('control_configuration');
  const errorCodes=new Set([...BASE_ERROR_CODES,...topology.errorCodes]);
  const safeError=(error,fallback='operation_failed')=>errorCodes.has(error?.message)||/^docker_\d{3}$/.test(error?.message||'')?error.message:fallback;
  const plans=new Map(),records=new Map();let active=null,journalError=null,startupError=null;
  const now=()=>new Date(clock()).toISOString();
  const auth=req=>{const actual=Buffer.from(req.headers.authorization||'');const expected=Buffer.from('Bearer '+token);return actual.length===expected.length&&timingSafeEqual(actual,expected);};
  const save=async record=>{
    records.set(record.id,record);
    const dest=path.join(stateDir,record.id+'.json'),temporary=dest+'.'+randomBytes(8).toString('hex')+'.tmp';
    try {
      await fileSystem.mkdir(stateDir,{recursive:true});
      await fileSystem.writeFile(temporary,JSON.stringify(record,null,2),{flag:'wx',mode:0o600});
      await fileSystem.rename(temporary,dest);
    } catch {journalError='journal_write_failed';throw new Error('journal_write_failed');}
    finally {await fileSystem.unlink(temporary).catch(()=>{});}
  };
  // A process restart cannot establish whether the last Docker request completed.
  // Mark interrupted operations explicitly, without replaying requests or removing a stale lock.
  const ready=(async()=>{
    try {
      await fileSystem.mkdir(stateDir,{recursive:true});
      for(const name of await fileSystem.readdir(stateDir)) {
        if(!/^[a-f0-9]{32}\.json$/.test(name))continue;
        let record;try{record=JSON.parse(await fileSystem.readFile(path.join(stateDir,name),'utf8'));}catch{throw new Error('journal_unavailable');}
        if(record?.id!==name.slice(0,-5)||typeof record.startedAt!=='string')throw new Error('journal_unavailable');
        records.set(record.id,record);
        if(record.status==='running') {
          record.status='failed';record.ok=false;record.error='control_restarted';record.interrupted=true;
          record.finishedAt=now();record.pendingRecovery=true;record.recovery=RECOVERY;
          for(const item of record.steps||[])if(item.status==='running'){item.status='not_confirmed';item.outcomeUncertain=true;}
          await save(record);
        }
      }
    } catch {startupError='journal_unavailable';}
  })();
  const execute=async(record,plan)=>{
    const lock=path.join(maintenanceDir,topology.lockFile),nonce=randomBytes(24).toString('hex');
    let lockHandle,lockStat,lockWritten=false;
    record.cleanup={lockAcquired:false,lockReleased:false};
    const step=async(name,fn)=>{
      const item={name,startedAt:now(),status:'running',attempted:false};record.steps.push(item);
      try{await save(record);}catch(error){item.status='not_started';item.finishedAt=now();throw error;}
      item.attempted=true;let failure;
      try{const result=await fn();item.status='complete';return result;}
      catch(error){failure=error;item.status='failed';item.outcomeUncertain=true;item.error=safeError(error);throw error;}
      finally{
        item.finishedAt=now();
        try{await save(record);}catch(error){record.journalError='journal_write_failed';if(!failure)throw error;}
      }
    };
    const fail=error=>{record.status='failed';record.ok=false;record.error=safeError(error);record.pendingRecovery=record.steps.some(s=>s.attempted);record.recovery=RECOVERY;};
    const deferred=new Set(topology.preStop.map(hook=>hook.service));
    try {
      try{lockHandle=await fileSystem.open(lock,'wx',0o600);}catch(error){throw new Error(error.code==='EEXIST'?'maintenance_busy':'maintenance_unavailable');}
      record.cleanup.lockAcquired=true;lockStat=await lockHandle.stat();
      await lockHandle.writeFile(JSON.stringify({kind:'management',operation:record.id,nonce,at:now()}));lockWritten=true;
      for(const marker of topology.refuseIfPresent) {
        try{await fileSystem.stat(path.join(maintenanceDir,marker.file));throw new Error(marker.error);}
        catch(error){if(error.code!=='ENOENT')throw error.message===marker.error?error:new Error('maintenance_unavailable');}
      }
      const fresh=buildPlan({action:plan.action,services:plan.selected},await inventory(engine,topology),topology);
      if(JSON.stringify(fresh)!==JSON.stringify(plan))throw new Error('plan_changed');
      for(const n of plan.stop.filter(n=>!deferred.has(n))) await step(topology.labels.stop(n),()=>engine('POST','/containers/'+plan.containers[n]+'/stop?t=30',null,40000));
      for(const hook of topology.preStop) if(plan[hook.planFlag]) await step(hook.name,()=>hook.run({engine,containerId:plan.containers[hook.service]}));
      for(const n of plan.stop.filter(n=>deferred.has(n))) await step(topology.labels.stop(n),()=>engine('POST','/containers/'+plan.containers[n]+'/stop?t=30',null,40000));
      const waitReady=async(n,health=true)=>{
        const end=clock()+180000;
        while(clock()<end){const r=await engine('GET','/containers/'+plan.containers[n]+'/json');
          if(r.State?.Running && (!health||!r.State.Health||r.State.Health.Status==='healthy'))return;
          if(r.State?.Status==='exited'||r.State?.Status==='dead')throw new Error('service_exited');
          await sleep(1000);}
        throw new Error('readiness_timeout');
      };
      for(const n of plan.start)await step(topology.labels.start(n),async()=>{
        await engine('POST','/containers/'+plan.containers[n]+'/start');
        await waitReady(n,!topology.deferredHealth?.has(n));
      });
      // Cross-service audits may need a later endpoint (Qwen's body MCP).
      // Delay that audit, never omit it or report a partial start as complete.
      for(const n of plan.start.filter(n=>topology.deferredHealth?.has(n)))
        await step('最终健康检查 '+n,()=>waitReady(n));
      record.status='complete';record.ok=true;
    } catch(error){fail(error);record.observed=await inventory(engine,topology);}
    finally {
      try {
        if(lockHandle) {
          try {
            const current=await fileSystem.lstat(lock);
            const owner=JSON.parse(await fileSystem.readFile(lock,'utf8'));
            if(!lockWritten||current.isSymbolicLink()||current.dev!==lockStat.dev||current.ino!==lockStat.ino||owner.kind!=='management'||owner.operation!==record.id||owner.nonce!==nonce)throw new Error('maintenance_lock_changed');
            await lockHandle.close();lockHandle=null;await fileSystem.unlink(lock);record.cleanup.lockReleased=true;
          } catch {record.cleanup.error='maintenance_lock_changed';if(record.ok)fail(new Error('maintenance_lock_changed'));record.pendingRecovery=true;}
        }
      } finally {
        if(lockHandle)await lockHandle.close().catch(()=>{});
        record.finishedAt=now();
        try{await save(record);}catch{record.journalError='journal_write_failed';if(record.ok)fail(new Error('journal_write_failed'));record.pendingRecovery=true;}
        // Keep the terminal in-memory receipt available even if the disk is full.
        // Further executions are blocked until the journal can be inspected/recovered.
        records.set(record.id,record);active=null;
      }
    }
  };
  return http.createServer(async(req,res)=>{
    const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    if(!auth(req))return send(401,{error:'unauthorized'});
    try {
      const url=new URL(req.url,'http://control');await ready;
      if(req.method==='GET'&&url.pathname==='/healthz')return send(startupError||journalError?503:200,{ok:!startupError&&!journalError,service:topology.serviceName,active,error:startupError||journalError});
      if(req.method==='GET'&&url.pathname==='/services')return send(200,{at:now(),services:await inventory(engine,topology),active});
      if(req.method==='GET'&&url.pathname==='/operations'){
        return send(200,{operations:[...records.values()].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0,30),active,journalError:startupError||journalError});
      }
      if(req.method==='GET'&&url.pathname==='/logs'){
        const id=url.searchParams.get('service');if(!topology.services.includes(id))return send(400,{error:'unknown_service'});
        const row=(await inventory(engine,topology)).find(r=>r.id===id);if(!row.owned||!/^[a-f0-9]{64}$/.test(row.containerId||''))throw new Error('unverified_container');
        const text=await engine('GET','/containers/'+row.containerId+'/logs?stdout=1&stderr=1&tail=120&timestamps=1');
        return send(200,{service:id,at:new Date(clock()).toISOString(),text:redactLog(text).slice(-60000)});
      }
      if(req.method!=='POST')return send(404,{error:'not_found'});
      if(startupError||journalError)return send(503,{error:startupError||journalError});
      let body='';for await(const part of req){body+=part;if(Buffer.byteLength(body)>4096)return send(413,{error:'body_limit'});}
      const input=JSON.parse(body);
      if(url.pathname==='/plan'){
        const plan=buildPlan(input,await inventory(engine,topology),topology),id=randomBytes(16).toString('hex');
        for(const [key,value] of plans)if(value.expiresAt<clock())plans.delete(key);
        if(plans.size>=100)return send(429,{error:'plan_limit'});
        const result={id,expiresAt:clock()+60000,plan};plans.set(id,result);return send(200,result);
      }
      if(url.pathname==='/execute'){
        if(!input||Object.keys(input).some(k=>k!=='planId')||typeof input.planId!=='string')return send(400,{error:'invalid_request'});
        if(active)return send(409,{error:'operation_busy'});
        const item=plans.get(input.planId);if(!item||item.expiresAt<clock())return send(409,{error:'plan_expired'});
        plans.delete(input.planId);
        const record={id:input.planId,startedAt:new Date(clock()).toISOString(),status:'running',ok:false,plan:item.plan,steps:[]};
        active=record.id;
        try{await save(record);}catch(error){record.status='failed';record.ok=false;record.error='journal_write_failed';record.finishedAt=now();record.pendingRecovery=false;active=null;throw error;}
        send(202,{accepted:true,operationId:record.id});
        void execute(record,item.plan).catch(()=>{record.status='failed';record.ok=false;record.error='operation_failed';record.pendingRecovery=true;record.finishedAt=now();active=null;});return;
      }
      return send(404,{error:'not_found'});
    }catch(e){return send(e.message==='journal_write_failed'?503:400,{error:safeError(e,'request_failed')});}
  });
}
