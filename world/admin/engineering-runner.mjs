// Fixed, one-shot source tests inside the existing managed control process.
// Only this module sees Docker. Candidate code never runs in this process.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const hex = /^[a-f0-9]{64}$/;
const id = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const encoded = value => Buffer.from(JSON.stringify(value));
const fail = code => {throw new Error(code);};
const relative = value => {
  if(typeof value!=='string'||!value||Buffer.byteLength(value)>512||/[\\:\x00-\x1f\x7f]/.test(value)||value.split('/').some(p=>!p||['.','..'].includes(p)||p.replace(/[ .]+$/,'').toLowerCase()==='.git'))fail('invalid_source_path');
  return value;
};
async function unlinked(file){
  for(let current=path.resolve(file);;current=path.dirname(current)){
    try{if((await fs.lstat(current)).isSymbolicLink())fail('linked_engineering_path');}catch(e){if(e.code!=='ENOENT')throw e;}
    if(current===path.dirname(current))break;
  }
  return file;
}
async function read(file,limit=262144){
  await unlinked(file);const stat=await fs.stat(file);
  if(!stat.isFile()||stat.size>limit)fail('invalid_engineering_record');
  return JSON.parse(await fs.readFile(file,'utf8'));
}
async function write(file,value){
  await unlinked(file);await fs.mkdir(path.dirname(file),{recursive:true});
  const temporary=file+'.'+Math.random().toString(16).slice(2)+'.tmp';
  await fs.writeFile(temporary,encoded(value),{flag:'wx',mode:0o600});await fs.rename(temporary,file);
}
export function validatePlan(config,request){
  if(config.schema!==1||config.enabled!==true||config.role!=='mc-god'||request.schema!==1||request.role!=='mc-god'||!id.test(request.jobId)||!hex.test(request.sourceSha256)||request.baseCommit!==config.baseCommit||request.branch!==config.branch)fail('invalid_engineering_request');
  const plan=config.plans?.find(p=>p.id===request.planId);
  if(!plan||!/^sha256:[a-f0-9]{64}$/.test(plan.image)||sha(encoded(plan))!==request.planSha256||!Array.isArray(plan.argv)||!plan.argv.length||plan.argv.some(a=>typeof a!=='string'||!a||a.includes('\0'))||!Number.isInteger(plan.timeoutSeconds)||plan.timeoutSeconds<1||plan.timeoutSeconds>300||!Array.isArray(plan.coverage)||!plan.coverage.length||!plan.checks||!Object.keys(plan.checks).length)fail('invalid_fixed_test_plan');
  if(typeof config.snapshotHostRoot!=='string'||!config.snapshotHostRoot.startsWith('/')||config.snapshotHostRoot.includes('\0')||config.snapshotHostRoot.split('/').includes('..'))fail('docker_snapshot_root_required');
  return plan;
}
export function containerSpec(config,request,plan){
  return {Image:plan.image,Cmd:plan.argv,WorkingDir:'/workspace',User:'65534:65534',
    Env:['HOME=/tmp','TMPDIR=/tmp','PYTHONDONTWRITEBYTECODE=1','PYTHONNOUSERSITE=1','PYTHONPATH=','NODE_OPTIONS='],
    Labels:{'qiandeng.engineering':'1','qiandeng.engineering.job':request.jobId,'qiandeng.engineering.source':request.sourceSha256},
    AttachStdout:false,AttachStderr:false,OpenStdin:false,Tty:false,
    HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,CapDrop:['ALL'],SecurityOpt:['no-new-privileges:true'],
      PidsLimit:64,Memory:536870912,MemorySwap:536870912,NanoCpus:1000000000,Init:true,
      RestartPolicy:{Name:'no'},Tmpfs:{'/tmp':'rw,noexec,nosuid,nodev,size=256m,mode=1777'},
      Mounts:[{Type:'bind',Source:config.snapshotHostRoot.replace(/\/$/,'')+'/'+request.sourceSha256+'/source',Target:'/workspace',ReadOnly:true}],
      Ulimits:[{Name:'nofile',Soft:256,Hard:256}],LogConfig:{Type:'json-file',Config:{'max-size':'1m','max-file':'1'}}}};
}
export async function verifySnapshot(root,request,plan){
  const folder=path.join(root,'snapshots',request.sourceSha256),manifest=await read(path.join(folder,'manifest.json'),16*1024*1024);
  if(manifest.sourceSha256!==request.sourceSha256||sha(encoded(manifest.entries))!==request.sourceSha256||!Array.isArray(manifest.entries)||manifest.entries.length>20000||!Array.isArray(manifest.changed))fail('snapshot_manifest_mismatch');
  const entries=new Map();let bytes=0;
  for(const entry of manifest.entries){
    relative(entry.path);if(entries.has(entry.path)||!hex.test(entry.sha256)||!['100644','100755'].includes(entry.mode)||!Number.isInteger(entry.size)||entry.size<0)fail('invalid_snapshot_entry');
    const file=path.join(folder,'source',entry.path);await unlinked(file);const stat=await fs.stat(file);
    bytes+=stat.size;if(!stat.isFile()||stat.nlink>1||bytes>128*1024*1024||stat.size!==entry.size||sha(await fs.readFile(file))!==entry.sha256)fail('snapshot_bytes_mismatch');
    entries.set(entry.path,entry);
  }
  const seen=[];
  async function walk(directory,prefix=''){
    for(const row of await fs.readdir(directory,{withFileTypes:true})){
      const name=prefix+row.name;relative(name);
      if(row.isSymbolicLink())fail('linked_snapshot');
      if(row.isDirectory())await walk(path.join(directory,row.name),name+'/');
      else if(row.isFile())seen.push(name);else fail('special_snapshot_file');
    }
  }
  await walk(path.join(folder,'source'));
  if(seen.length!==entries.size||seen.some(name=>!entries.has(name)))fail('unlisted_snapshot_file');
  for(const [name,hash] of Object.entries(plan.checks))if(entries.get(relative(name))?.sha256!==hash)fail('fixed_checks_changed');
  for(const name of manifest.changed){relative(name);if(!plan.coverage.some(prefix=>name===prefix||prefix.endsWith('/')&&name.startsWith(prefix)))fail('changes_not_covered');}
  return manifest;
}

export function createEngineeringRunner({root='/engineering',configFile=path.join(root,'config.json'),engine,clock=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),redact=String}={}){
  if(typeof engine!=='function')fail('engineering_engine_required');
  let busy=false,timer=null,stopped=false,error=null,configured=false;
  const receiptFile=job=>path.join(root,'receipts',job+'.json');
  const owned=async(container,job)=>{
    const row=await engine('GET','/containers/'+container+'/json');
    if(row.Config?.Labels?.['qiandeng.engineering']!=='1'||row.Config?.Labels?.['qiandeng.engineering.job']!==job||!/^[a-f0-9]{64}$/.test(row.Id||''))fail('unverified_test_container');
    return row;
  };
  const cleanup=async(record)=>{
    let row;
    try{row=await owned(record.containerId||'qd-engineering-'+record.jobId,record.jobId);}
    catch(e){if(e.message==='docker_404')return;throw e;}
    await engine('DELETE','/containers/'+row.Id+'?force=1&v=1');
  };
  async function execute(config,request){
    const plan=validatePlan(config,request);await verifySnapshot(root,request,plan);
    const record={schema:1,...request,status:'running',startedAt:clock(),imageId:plan.image,exitCode:null};
    // Claim is durable before Docker create. A lost response never creates a
    // second container; restart recovery only inspects/cleans this exact name.
    await write(receiptFile(request.jobId),record);
    await write(path.join(root,'receipts','_runner.json'),{schema:1,enabled:true,busy:true,error:null,
      jobId:request.jobId,updatedAt:clock()});
    try{
      const image=await engine('GET','/images/'+encodeURIComponent(plan.image)+'/json');
      if(image.Id!==plan.image)fail('test_image_changed');
      const created=await engine('POST','/containers/create?name=qd-engineering-'+request.jobId,containerSpec(config,request,plan));
      if(!/^[a-f0-9]{64}$/.test(created?.Id||''))fail('test_create_unknown');
      record.containerId=created.Id;await write(receiptFile(request.jobId),record);
      await engine('POST','/containers/'+created.Id+'/start');
      const deadline=clock()+plan.timeoutSeconds*1000;
      while(true){
        const row=await owned(created.Id,request.jobId);
        if(row.State?.Status==='exited'){
          if(!Number.isInteger(row.State.ExitCode))fail('test_exit_unknown');
          record.exitCode=row.State.ExitCode;record.status=row.State.ExitCode===0&&!row.State.OOMKilled?'passed':'failed';
          if(row.State.OOMKilled)record.code='test_oom';break;
        }
        if(row.State?.Status==='dead')fail('test_container_dead');
        if(clock()>=deadline){record.status='failed';record.code='test_timeout';break;}
        await sleep(500);
      }
      const output=await engine('GET','/containers/'+created.Id+'/logs?stdout=1&stderr=1&tail=160');
      record.log=redact(output).slice(-24000);
      await verifySnapshot(root,request,plan);
    }catch(e){record.status='unknown';record.code=/^[a-z0-9_]{1,80}$/.test(e.message)?e.message:'test_execution_unknown';}
    finally{
      try{await cleanup(record);record.containerRemoved=true;}catch{record.status='unknown';record.code='test_cleanup_unknown';}
      record.finishedAt=clock();await write(receiptFile(request.jobId),record);
    }
    return record;
  }
  async function tick(){
    if(stopped||busy)return;busy=true;
    try{
      const config=await read(configFile);configured=config.enabled===true;error=null;
      if(config.enabled!==true)return;
      await fs.mkdir(path.join(root,'receipts'),{recursive:true});
      const receipts=(await fs.readdir(path.join(root,'receipts'))).filter(n=>id.test(n.slice(0,-5))&&n.endsWith('.json'));
      for(const name of receipts){
        const old=await read(path.join(root,'receipts',name));
        if(old.status==='running'){
          old.status='unknown';old.code='control_restarted';old.finishedAt=clock();
          try{await cleanup(old);old.containerRemoved=true;}catch{old.code='test_cleanup_unknown';}
          await write(receiptFile(old.jobId),old);
        }
        if(old.status==='unknown'){error='engineering_unknown_test_requires_review';return;}
      }
      const jobs=(await fs.readdir(path.join(root,'requests'))).filter(n=>n.endsWith('.json')&&id.test(n.slice(0,-5))).sort();
      for(const name of jobs){
        try{await fs.stat(path.join(root,'receipts',name));continue;}catch(e){if(e.code!=='ENOENT')throw e;}
        const request=await read(path.join(root,'requests',name));
        if(request.jobId!==name.slice(0,-5))fail('engineering_request_name_mismatch');
        try{await execute(config,request);}
        catch(e){
          // A preflight rejection has no Docker side effect; make it visible
          // instead of leaving the agent waiting on a permanently queued job.
          const existing=await fs.stat(receiptFile(request.jobId)).catch(()=>null);
          if(existing)throw e;
          await write(receiptFile(request.jobId),{schema:1,...request,status:'rejected',exitCode:null,
            code:/^[a-z0-9_]{1,80}$/.test(e.message)?e.message:'test_preflight_failed',finishedAt:clock()});
          error=e.message;
        }
        break;
      }
    }catch(e){error=/^[a-z0-9_]{1,80}$/.test(e.message)?e.message:'engineering_runner_unavailable';}
    finally{
      busy=false;
      await write(path.join(root,'receipts','_runner.json'),{schema:1,enabled:configured,busy:false,error,updatedAt:clock()})
        .catch(()=>{error='engineering_health_write_failed';});
    }
  }
  return {tick,status:()=>({enabled:!!timer,busy,error}),start(){if(!timer){timer=setInterval(()=>void tick(),5000);timer.unref();void tick();}},stop(){stopped=true;if(timer)clearInterval(timer);timer=null;}};
}
