import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,it,expect} from 'vitest';
import {createPracticeModelAudit,summarizeModelAudit} from '../scripts/practice-model-audit.mjs';
import {connectedCraftingReport} from '../scripts/practice-report.mjs';
import {practicePreflight,runModelPractice} from '../scripts/run-model-practice.mjs';
const directories:string[]=[];
afterEach(()=>{for(const d of directories.splice(0))rmSync(d,{recursive:true,force:true});});
const dir=()=>{const d=mkdtempSync(join(tmpdir(),'model-runner-'));directories.push(d);return d;};
const provenance={kind:'registered-host-llm',provider:'fixture',model:'test',sessionId:'isolated-fixture'};
const request={id:'request-one',stage:'inv1.a1',mission:'game-only',files:{'evidence.json':'{"trialId":"failed-original"}'}};
function audit(model:any){const d=dir(),journal=join(d,'journal.json');writeFileSync(journal,JSON.stringify({rpc:{'failed-original':{
  kind:'trial',phase:'returned',group:'train',role:'baseline',value:{assessment:{achieved:false}},
}}}));return {d,a:createPracticeModelAudit({model,file:join(d,'model.jsonl'),provenance,trainingJournal:journal,requireFailureFeedback:true})};}

it('forwards exact failed training evidence once, preserving actual usage without persisting model text',async()=>{
  let calls=0;const reply={files:{'params.json':'PRIVATE-GAME-ARTIFACT'},usage:{inputTokens:300,outputTokens:50,cachedTokens:100}};
  const {a,d}=audit({id:'fixture',async generate(r:any){calls++;expect(r).toEqual(request);return reply;}});
  expect(await a.model.generate(request,new AbortController().signal)).toEqual(reply);
  await expect(a.model.generate(request,new AbortController().signal)).rejects.toThrow('replayed');expect(calls).toBe(1);
  expect(readFileSync(join(d,'model.jsonl'),'utf8')).not.toContain('PRIVATE-GAME-ARTIFACT');
  expect(summarizeModelAudit(a.snapshot(),a.provenance)).toMatchObject({attemptedCalls:1,returnedCalls:1,callsWithFailedTrainingFeedback:1,inputTokens:300,costUsd:null});
  expect(()=>createPracticeModelAudit({model:{id:'x',generate(){}},file:join(d,'model.jsonl'),provenance})).toThrow('already exists');
});
it('blocks a candidate request with no original failed training observation before calling the host',async()=>{
  let calls=0;const {a}=audit({id:'fixture',async generate(){calls++;return {};}});
  await expect(a.model.generate({...request,files:{}},new AbortController().signal)).rejects.toThrow('failed training');expect(calls).toBe(0);
});
it('preserves cancelled/failed model calls as unknown cost and never retries the host',async()=>{
  let calls=0;const controller=new AbortController();
  const {a}=audit({id:'fixture',async generate(_r:any,signal:AbortSignal){calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('private exception')),{once:true}));}});
  const pending=a.model.generate(request,controller.signal);controller.abort();await expect(pending).rejects.toThrow();
  await expect(a.model.generate(request,new AbortController().signal)).rejects.toThrow('replayed');expect(calls).toBe(1);
  expect(summarizeModelAudit(a.snapshot(),a.provenance)).toMatchObject({failedCalls:1,inputTokens:null,outputTokens:null,costUsd:null});
  expect(JSON.stringify(a.snapshot())).not.toContain('private exception');
});
it('reports baseline and candidate work separately, retains unknowns and rejects mismatched execution evidence',()=>{
  const trial={trialId:'one',executionId:'original-uuid',candidateHash:'original-hash',caseId:'train',sdkCalls:3,reference:{revision:'a'},reviewId:'review'};
  const assessment={achieved:false,measurements:{gained:0}};
  const result:any={evidenceRefs:['one'],selected:{params:{logs:1}},train:{baseline:assessment,candidate:null},holdout:[]};
  const journal={rpc:{one:{kind:'trial',phase:'returned',group:'train',role:'baseline',value:{trial,assessment}}}};
  const options={result,journal,readEvidence:()=>({trial,actionSteps:2,failedActions:1}),modelCosts:{costUsd:null},source:{revision:'a'}};
  const report=connectedCraftingReport(options);expect(report.measuredExecutions.training.baseline).toMatchObject({successRate:0,requestedActionSteps:2,failedActionGroups:1});
  expect(report.measuredExecutions.training.candidate.successRate).toBeNull();expect(report.adopted).toBe(false);
  expect(()=>connectedCraftingReport({...options,readEvidence:()=>({trial:{...trial,executionId:'another'}})})).toThrow('mismatch');
});
it('preflight never loads a model module or starts Minecraft when local inputs are missing',async()=>{
  const d=dir(),module=join(d,'must-not-load.mjs'),marker=join(d,'marker');
  writeFileSync(module,`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'bad');`);
  const options={java:'/missing/java',python:'/missing/python',serverJar:'/missing/server.jar',directory:join(d,'new'),modelModule:module,acceptEula:true};
  expect(practicePreflight(options)).toMatchObject({ready:false,modelCalls:0,gameConnections:0});
  await expect(runModelPractice(options)).rejects.toThrow('preflight');expect(existsSync(marker)).toBe(false);
});
