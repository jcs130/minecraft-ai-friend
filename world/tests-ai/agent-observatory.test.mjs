import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { projectTraceAction, readSurvivorTrace } from '../admin/survivor-trace.mjs';
import { readRsi } from '../admin/rsi-observatory.mjs';
import { createPanelServer } from '../admin/server.mjs';

test('pending receipts never gain fabricated completion or elapsed time',()=>{
  const r=projectTraceAction({actionId:'a1',tool:'goto',acceptedAt:1000,observedAt:2000,status:'accepted',result:{ok:true},args:{x:12,token:'SECRET',prompt:'SECRET'}});
  assert.equal(r.durationMs,null);assert.equal(r.completionConfirmed,false);assert.equal(r.status,'accepted');
  assert.deepEqual(r.args,{x:12});assert.equal(r.argumentsOmitted,true);assert.ok(!JSON.stringify(r).includes('SECRET'));
});
test('duration is receipt interval; deltas require matching body and dimension',()=>{
  const raw={status:'completed',completionConfirmed:true,acceptedAt:1000,observedAt:1350,
    before:{ok:true,bodyUuid:'a',dimension:'minecraft:overworld',counts:{'minecraft:bread':2},hp:10,hunger:4},
    after:{ok:true,bodyUuid:'a',dimension:'minecraft:overworld',counts:{'minecraft:bread':1},hp:10,hunger:9}};
  assert.equal(projectTraceAction(raw).durationMs,350);assert.deepEqual(projectTraceAction(raw).inventoryDelta,{'minecraft:bread':-1});
  assert.equal(projectTraceAction(raw).hungerDelta,5);
  assert.equal(projectTraceAction({...raw,observedAt:999}).durationMs,null);
  assert.equal(projectTraceAction({...raw,after:{...raw.after,bodyUuid:'b'}}).inventoryDelta,null);
});
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'qd-observatory-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const write=async(name,value)=>{const p=path.join(root,name);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,JSON.stringify(value));};return {root,write};}
test('turn joins are exact and native private messages stay private',async t=>{
  const {root,write}=await fixture(t),now=Date.now();
  await write('survivor.json',{schema:1,project:'qiandengji-survivor',bodyName:'Kirito',generatedAt:new Date(now).toISOString(),lastDecision:{turnId:'t1',at:new Date(now).toISOString(),completed:true}});
  await write('controller.json',{decisions:[{turnId:'t1',startedAt:(now-4000)/1000}],active:null,secret:'SECRET'});
  await write('memory.json',{history:[{turnId:'t1',goal:'get food',lesson:'bread found',at:now}],private:'SECRET'});
  await write('turn-actions/t1.json',{turnId:'t1',actionIds:['a1','a2','../private']});
  await write('action-receipts/a1.json',{actionId:'a1',turnId:'t1',tool:'eat',status:'completed',completionConfirmed:true,acceptedAt:now-2000,observedAt:now-1000,args:{item_id:'minecraft:bread',token:'SECRET'}});
  await write('action-receipts/a2.json',{actionId:'a2',turnId:'other',tool:'goto',args:{x:200}});
  await fs.writeFile(path.join(root,'episodes.jsonl'),JSON.stringify({kind:'decision_finished',turnId:'t1',completed:true,at:new Date(now).toISOString()})+'\n');
  const result=await readSurvivorTrace({stateDir:root,traceDir:root},now);
  assert.equal(result.turns.length,1);assert.equal(result.turns[0].actions.length,1);assert.equal(result.turns[0].durationMs,4000);
  assert.equal(result.turns[0].summary.goal,'get food');assert.equal(result.turns[0].input.body,null);
  assert.ok(!JSON.stringify(result).includes('SECRET'));assert.equal(result.turns[0].coverage.allModelToolsRecorded,false);
});
test('unavailable snapshots and historical timestamps are not live',async t=>{
  const {root,write}=await fixture(t);
  assert.equal((await readSurvivorTrace({stateDir:root})).available,false);
  await write('survivor.json',{schema:1,project:'qiandengji-survivor',bodyName:'Kirito',generatedAt:'2020-01-01T00:00:00Z'});
  const r=await readSurvivorTrace({stateDir:root});assert.equal(r.stale,true);assert.ok(r.coverage.unavailable.includes('trace_directory'));
});
test('RSI uses improvement cases only and preserves unknown validation',async t=>{
  const {root,write}=await fixture(t);const {DatabaseSync}=await import('node:sqlite');
  const db=new DatabaseSync(path.join(root,'team.sqlite3'));
  db.exec('CREATE TABLE cases(id TEXT,author TEXT,owner TEXT,status TEXT,version INTEGER,updated_at REAL,body TEXT)');
  const insert=db.prepare('INSERT INTO cases VALUES(?,?,?,?,?,?,?)');
  insert.run('c1','agent','engineer','needs_review',1,123,JSON.stringify({category:'improvement',title:'better navigation',secret:'SECRET'}));
  insert.run('c2','agent',null,'open',1,124,JSON.stringify({category:'gameplay',title:'not an improvement'}));db.close();
  await write('learning/index.json',{skills:{skill:{enabled:true,behaviorVerified:false,revision:'v1'}}});
  await write('shared/index.json',{skills:{shared:{origin:'agent',revision:'v2'}}});
  await write('config.json',{enabled:true,baseCommit:'base',plans:[{id:'fixed',checks:{one:'hash'}}],secret:'SECRET'});
  const result=await readRsi({notesDir:root,learningDir:path.join(root,'learning'),knowledgeDir:root,sharedSkillsDir:path.join(root,'shared'),engineeringDir:root,teamDir:root,stateDir:root});
  assert.equal(result.l3.cases.items.length,1);assert.equal(result.l3.cases.items[0].id,'c1');assert.equal(result.l3.verifiedImprovement,null);
  assert.equal(result.l2.localSkills[0].behaviorVerified,false);assert.ok(!JSON.stringify(result).includes('SECRET'));
});
test('observatory serves only read-only fixed routes with existing host protection',async t=>{
  const {root}=await fixture(t);const server=createPanelServer({stateDir:root,publicOrigin:'http://127.0.0.1:19091'});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const request=(url,method='GET',host='127.0.0.1:19091')=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:server.address().port,path:url,method,headers:{Host:host}},res=>{let body='';res.on('data',d=>body+=d);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});req.on('error',reject);req.end();});
  const page=await request('/observatory');assert.equal(page.status,200);assert.match(page.body,/L3/);assert.match(page.headers['content-security-policy'],/default-src 'self'/);
  assert.equal((await request('/api/survivor-trace','POST')).status,405);
  assert.equal((await request('/api/rsi-observatory','GET','evil.test')).status,403);
  assert.equal((await request('/survivor-trace/controller.json')).status,404);
  for(const asset of ['/observatory.js','/observatory.css','/trace.js','/trace.css'])assert.equal((await request(asset)).status,200);
  assert.equal(JSON.parse((await request('/api/rsi-observatory')).body).available,false);
});
