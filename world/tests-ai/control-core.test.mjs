import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createControlServer, defineTopology, inventory, buildPlan } from '../admin/fleet/control-core.mjs';

// A fleet with no Minecraft in it: this is the evidence that the control core
// carries no project knowledge of its own.
const SHOP = defineTopology({
  project:'shop',
  serviceName:'shop-control',
  containerName:id=>'shop_'+id,
  services:['db','cache','api','web','control'],
  immutable:['control'],
  dependencies:{api:['db','cache'],web:['api']},
  startOrder:['db','cache','api','web'],
  healthGated:['db'],
  lockFile:'.shop-operation.lock',
  labels:{stop:id=>'stop '+id,start:id=>'start '+id},
  explanation:'test fleet',
});
const idFor=name=>(SHOP.services.indexOf(name)+1).toString(16).padStart(64,'0');
const runningRows=()=>SHOP.services.map(id=>({id,owned:true,containerId:idFor(id),state:'running',health:'healthy'}));

test('an immutable service is visible but can never be planned against',()=>{
  assert.equal(SHOP.mutable.includes('control'),false);
  assert.throws(()=>buildPlan({action:'stop',services:['control']},runningRows(),SHOP),/unknown_service/);
});

test('stop fan-out follows the dependency graph transitively rather than a hand-written list',()=>{
  // db -> api -> web is two hops; nothing declares "stopping db stops web".
  const plan=buildPlan({action:'stop',services:['db']},runningRows(),SHOP);
  assert.deepEqual(plan.stop,['web','api','db']);
  assert.deepEqual(plan.start,[]);
  assert.equal(plan.explanation,'test fleet');
});

test('restart brings affected running services back and names only missing dependencies as required',()=>{
  const plan=buildPlan({action:'restart',services:['db']},runningRows(),SHOP);
  assert.deepEqual(plan.stop,['web','api','db']);
  assert.deepEqual(plan.start,['db','api','web']);
  assert.deepEqual(plan.required,['cache']);
});

test('a stopped dependent is not started as a side effect of restarting its dependency',()=>{
  const rows=runningRows();
  Object.assign(rows.find(r=>r.id==='web'),{state:'exited'});
  const plan=buildPlan({action:'restart',services:['api']},rows,SHOP);
  assert.deepEqual(plan.stop,['web','api']);
  assert.deepEqual(plan.start,['api']);
});

test('a health-gated dependency must be healthy, an ungated one only running',()=>{
  const gated=runningRows();
  Object.assign(gated.find(r=>r.id==='db'),{health:'starting'});
  assert.throws(()=>buildPlan({action:'start',services:['api']},gated,SHOP),/dependency_not_ready/);
  const ungated=runningRows();
  Object.assign(ungated.find(r=>r.id==='cache'),{health:'starting'});
  assert.equal(buildPlan({action:'start',services:['api']},ungated,SHOP).required.includes('cache'),true);
});

test('inventory derives container names and ownership from the topology, not a fixed prefix',async()=>{
  const asked=[];
  const engine=async(_method,route)=>{
    asked.push(route);
    return {Id:idFor('api'),Config:{Labels:{'com.docker.compose.project':'shop','com.docker.compose.service':'api'}},State:{Status:'running'}};
  };
  const rows=await inventory(engine,SHOP);
  assert.equal(asked[0],'/containers/shop_db/json');
  // Only the row whose service label matches its own id is owned.
  assert.deepEqual(rows.filter(r=>r.owned).map(r=>r.id),['api']);
  assert.equal(rows.find(r=>r.id==='api').canControl,true);
});

test('a pre-stop hook runs after every other stop, before its own service, and only when that service is running',async t=>{
  const hookRuns=[];
  const topology=defineTopology({...{
    project:'shop',serviceName:'shop-control',containerName:id=>'shop_'+id,
    services:SHOP.services,immutable:['control'],
    dependencies:{api:['db','cache'],web:['api']},
    startOrder:['db','cache','api','web'],
    lockFile:'.shop-operation.lock',labels:{stop:id=>'stop '+id,start:id=>'start '+id},
  },preStop:[{service:'db',planFlag:'flushDb',name:'flush db',run:async({containerId})=>{hookRuns.push(containerId);}}]});

  const root=await fs.mkdtemp(path.join(os.tmpdir(),'qd-core-test-'));
  const stateDir=path.join(root,'state'),maintenanceDir=path.join(root,'maintenance');
  await fs.mkdir(stateDir);await fs.mkdir(maintenanceDir);
  const states=new Map(topology.services.map(id=>[id,'running']));
  const engine=async(_method,route)=>{
    const match=route.match(/^\/containers\/([^/]+)\/(json|start|stop)(?:\?|$)/);
    if(!match)throw new Error('unexpected_fake_route');
    const id=topology.services.find(name=>idFor(name)===match[1])||match[1].replace(/^shop_/,'');
    if(match[2]==='json')return {Id:idFor(id),Config:{Labels:{'com.docker.compose.project':'shop','com.docker.compose.service':id}},
      State:{Status:states.get(id),Running:states.get(id)==='running'}};
    states.set(id,match[2]==='start'?'running':'exited');
    return '';
  };
  const server=createControlServer({topology,token:'offline-core-test-token-'.repeat(3),stateDir,maintenanceDir,engine});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${server.address().port}`;
  const call=async(route,body)=>{
    const response=await fetch(url+route,{method:body===undefined?'GET':'POST',
      headers:{Authorization:'Bearer '+'offline-core-test-token-'.repeat(3),'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,value:await response.json()};
  };
  const plan=await call('/plan',{action:'stop',services:['db']});
  assert.equal(plan.status,200,JSON.stringify(plan.value));
  assert.equal(plan.value.plan.flushDb,true);
  assert.equal((await call('/execute',{planId:plan.value.id})).status,202);
  let record;
  for(let attempt=0;attempt<250&&!record;attempt++){
    const result=await call('/operations');
    const found=result.value.operations.find(r=>r.id===plan.value.id);
    if(!result.value.active&&found?.status!=='running')record=found;else await new Promise(r=>setTimeout(r,5));
  }
  assert.equal(record.ok,true,JSON.stringify(record));
  assert.deepEqual(record.steps.map(s=>s.name),['stop web','stop api','flush db','stop db']);
  assert.deepEqual(hookRuns,[idFor('db')]);
  assert.equal(record.plan.explanation,'');

  // With db already stopped the hook must not fire at all.
  states.set('db','exited');
  const second=await call('/plan',{action:'stop',services:['db']});
  assert.equal(second.value.plan.flushDb,false);
});

test('a topology without services or a start order is refused',()=>{
  assert.throws(()=>defineTopology({services:[],startOrder:[]}),/topology_configuration/);
  assert.throws(()=>defineTopology({services:['a']}),/topology_configuration/);
  assert.throws(()=>defineTopology({services:['a'],startOrder:['a'],preStop:[{service:'a'}]}),/topology_configuration/);
});
