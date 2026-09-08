import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createEngineeringRunner,containerSpec,validatePlan,verifySnapshot} from '../admin/engineering-runner.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'qd-engineering-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const files={'world/value.py':'VALUE = 2\n','tests/test_value.py':'fixed independent checks\n'};
  const entries=Object.keys(files).sort().map(name=>({path:name,sha256:sha(files[name]),mode:'100644',size:Buffer.byteLength(files[name])}));
  const source=sha(JSON.stringify(entries)),folder=path.join(root,'snapshots',source);
  for(const [name,body] of Object.entries(files)){await fs.mkdir(path.dirname(path.join(folder,'source',name)),{recursive:true});await fs.writeFile(path.join(folder,'source',name),body);}
  await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify({sourceSha256:source,entries,changed:['world/value.py']}));
  const plan={id:'python-fixed',image:'sha256:'+'1'.repeat(64),argv:['python','-m','unittest','discover','-s','tests'],coverage:['world/'],checks:{'tests/test_value.py':sha(files['tests/test_value.py'])},timeoutSeconds:2};
  const config={schema:1,enabled:true,role:'mc-god',repo:'/unused',baseCommit:'a'.repeat(40),branch:'codex/ops-fixture',snapshotHostRoot:'/fixed-host/snapshots',plans:[plan]};
  const request={schema:1,jobId:'request-0001',role:'mc-god',planId:plan.id,sourceSha256:source,planSha256:sha(JSON.stringify(plan)),baseCommit:config.baseCommit,branch:config.branch,head:config.baseCommit};
  await fs.mkdir(path.join(root,'requests'));await fs.mkdir(path.join(root,'receipts'));
  await fs.writeFile(path.join(root,'config.json'),JSON.stringify(config));await fs.writeFile(path.join(root,'requests',request.jobId+'.json'),JSON.stringify(request));
  let state='exited',now=1000,exitCode=0,created=false,foreign=false,loseCreate=false;
  const calls=[],container='c'.repeat(64);
  async function engine(method,route,body){
    calls.push({method,route,body});
    if(route.startsWith('/images/')){
      const health=JSON.parse(await fs.readFile(path.join(root,'receipts','_runner.json'),'utf8'));
      assert.equal(health.busy,true);assert.equal(health.jobId,request.jobId);
      return {Id:plan.image};
    }
    if(route.startsWith('/containers/create')){created=true;if(loseCreate)throw Error('docker_timeout');return {Id:container};}
    if(route.endsWith('/start'))return '';
    if(route.endsWith('/json')){
      if(!created)throw Error('docker_404');
      return {Id:container,Config:{Labels:{'qiandeng.engineering':foreign?'0':'1','qiandeng.engineering.job':request.jobId}},State:{Status:state,ExitCode:exitCode}};
    }
    if(route.includes('/logs?'))return 'fixed checks passed';
    if(method==='DELETE'){created=false;return '';}
    throw Error('unexpected_docker_route');
  }
  const options={root,engine,clock:()=>now,sleep:async ms=>{now+=ms;}};
  return {root,folder,config,request,plan,calls,options,read:async()=>JSON.parse(await fs.readFile(path.join(root,'receipts',request.jobId+'.json'),'utf8')),
    set(values){({state=state,exitCode=exitCode,created=created,foreign=foreign,loseCreate=loseCreate}=values);}};
}

test('fixed Docker contract contains only immutable source, no network or production authority',async t=>{
  const f=await fixture(t);const spec=containerSpec(f.config,f.request,validatePlan(f.config,f.request));
  assert.equal(spec.Image,f.plan.image);assert.deepEqual(spec.Cmd,f.plan.argv);assert.equal(spec.User,'65534:65534');
  assert.equal(spec.HostConfig.NetworkMode,'none');assert.equal(spec.HostConfig.ReadonlyRootfs,true);assert.deepEqual(spec.HostConfig.CapDrop,['ALL']);
  assert.equal(spec.HostConfig.Mounts.length,1);assert.equal(spec.HostConfig.Mounts[0].ReadOnly,true);assert.equal(spec.HostConfig.Mounts[0].Target,'/workspace');
  assert.equal(spec.HostConfig.RestartPolicy.Name,'no');assert.equal(spec.HostConfig.Memory,536870912);assert.equal(spec.HostConfig.PidsLimit,64);
  assert(!JSON.stringify(spec).includes('docker.sock'));assert(!JSON.stringify(spec).includes('secrets'));
  assert.throws(()=>validatePlan(f.config,{...f.request,planSha256:'0'.repeat(64)}),/invalid_fixed_test_plan/);
});

test('passed receipt binds actual exit, source, plan and image; duplicate tick does not repeat',async t=>{
  const f=await fixture(t),runner=createEngineeringRunner(f.options);await runner.tick();
  const result=await f.read();assert.equal(result.status,'passed');assert.equal(result.exitCode,0);assert.equal(result.imageId,f.plan.image);
  assert.equal(result.sourceSha256,f.request.sourceSha256);assert.equal(result.planSha256,f.request.planSha256);assert.equal(result.containerRemoved,true);
  await runner.tick();assert.equal(f.calls.filter(c=>c.route.startsWith('/containers/create')).length,1);
});

test('fixed check modification and extra hidden source fail before Docker',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.folder,'source','tests/test_value.py'),'skip tests');
  await assert.rejects(verifySnapshot(f.root,f.request,f.plan),/snapshot_bytes_mismatch/);
  const runner=createEngineeringRunner(f.options);await runner.tick();assert.equal(f.calls.length,0);assert.equal(runner.status().error,'snapshot_bytes_mismatch');
  assert.equal((await f.read()).status,'rejected');
});

test('unlisted files cannot execute outside the bound snapshot',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.folder,'source','sitecustomize.py'),'unlisted');
  await assert.rejects(verifySnapshot(f.root,f.request,f.plan),/unlisted_snapshot_file/);
});

test('known test failure and timeout are failed, cleaned, never passed',async t=>{
  for(const mode of ['exit','timeout']){
    const f=await fixture(t);f.set(mode==='exit'?{exitCode:1}:{state:'running'});
    await createEngineeringRunner(f.options).tick();const record=await f.read();
    assert.equal(record.status,'failed');assert.equal(record.containerRemoved,true);
    if(mode==='timeout')assert.equal(record.code,'test_timeout');else assert.equal(record.exitCode,1);
  }
});

test('lost create reply is unknown and only exact owned container is cleaned; no auto replay',async t=>{
  const f=await fixture(t);f.set({loseCreate:true});const runner=createEngineeringRunner(f.options);
  await runner.tick();assert.equal((await f.read()).status,'unknown');assert.equal((await f.read()).containerRemoved,true);
  await runner.tick();assert.equal(f.calls.filter(c=>c.route.startsWith('/containers/create')).length,1);
  assert.equal(runner.status().error,'engineering_unknown_test_requires_review');
});

test('restart reconciles running record without issuing a new test',async t=>{
  const f=await fixture(t);f.set({created:true});
  await fs.writeFile(path.join(f.root,'receipts',f.request.jobId+'.json'),JSON.stringify({...f.request,status:'running'}));
  await createEngineeringRunner(f.options).tick();assert.equal((await f.read()).status,'unknown');assert.equal((await f.read()).code,'control_restarted');
  assert.equal(f.calls.filter(c=>c.route.startsWith('/containers/create')).length,0);
});

test('foreign container is never deleted to make a result look successful',async t=>{
  const f=await fixture(t);f.set({foreign:true});await createEngineeringRunner(f.options).tick();
  assert.equal((await f.read()).status,'unknown');assert.equal((await f.read()).code,'test_cleanup_unknown');
  assert.equal(f.calls.filter(c=>c.method==='DELETE').length,0);
});
