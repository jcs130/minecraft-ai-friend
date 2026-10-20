import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHarness2Monitor} from '../src/decisions/harness2-monitor.ts';
import type {Harness2Job} from '../src/decisions/harness2.ts';
import {procedureHash} from '../core/support/procedure.ts';
const job={id:'walk',methodId:'walk-method',scope:{realm:'server',account:'Account',agent:'Agent'},mode:'parallel',k:2,
  budget:{modelCalls:12,trials:10,wallMs:60000,trialMs:5000,contextBytes:300000},train:{id:'train'},holdout:[{id:'test'}]} as Harness2Job;
it('samples only explicit jobs, shares the file cache and returns defensive copies',()=>{
  const dir=mkdtempSync(join(tmpdir(),'mc-monitor-'));let now=100000;
  try{
    const path=join(dir,job.id);mkdirSync(path);const monitor=createHarness2Monitor({directory:dir,jobs:[job],now:()=>now});
    expect(monitor.snapshot().jobs[0]).toMatchObject({status:'not-started',modelCalls:null,trials:null});
    const journal={schema:'agent-mc.harness2/v1',status:'running',modelCalls:1,trials:0,memory:'pending',
      progress:{scopeHash:procedureHash(job.scope),configurationHash:procedureHash(job),updatedAt:now,startedAt:now,phase:'propose',budget:{...job.budget,prompt:'private-marker'}},rpc:{}};
    writeFileSync(join(path,'journal.json'),JSON.stringify(journal));
    expect(monitor.snapshot().jobs[0].status).toBe('not-started');now+=2001;
    const first=monitor.snapshot();expect(first.jobs[0].status).toBe('running');first.jobs[0].id='changed';
    expect(monitor.snapshot().jobs[0].id).toBe('walk');expect(JSON.stringify(first)).not.toContain('private-marker');
    expect(createHarness2Monitor({directory:dir,jobs:[{...job,methodId:'other-method'}],now:()=>now}).snapshot().jobs[0]).toMatchObject({status:'unknown',modelCalls:null});
    now+=21000;expect(monitor.snapshot().jobs[0]).toMatchObject({status:'unknown',stale:true});
    writeFileSync(join(path,'journal.json'),JSON.stringify({...journal,progress:{...journal.progress,scopeHash:'another'}}));now+=2001;
    expect(monitor.snapshot().jobs[0]).toMatchObject({status:'unknown',modelCalls:null});
  }finally{rmSync(dir,{recursive:true,force:true});}
});
it('projects only counted metadata and exact results; missing usage stays null',()=>{
  const dir=mkdtempSync(join(tmpdir(),'mc-monitor-'));try{
    mkdirSync(join(dir,'walk'));const hash='a'.repeat(64),assessment={achieved:false,measurements:{distance:5,gained:null,healthLoss:0,elapsedMs:100}};
    const journal={schema:'agent-mc.harness2/v1',jobHash:hash,status:'completed',modelCalls:2,trials:1,memory:'stored',
      progress:{scopeHash:procedureHash(job.scope),configurationHash:procedureHash(job),updatedAt:1000,startedAt:900,endedAt:1000,phase:'settled'},
      prompt:'private-marker',rpc:{[hash]:{kind:'model',phase:'returned',value:{usage:{inputTokens:10,outputTokens:2,cachedTokens:0},reply:'private-marker'}},
        ['b'.repeat(64)]:{kind:'model',phase:'returned',value:{usage:null}},
        ['c'.repeat(64)]:{kind:'trial',phase:'returned',caseId:'test',group:'holdout',role:'baseline',value:{assessment,trial:{before:{chat:'private-marker'}}}}},
      result:{jobId:'walk',jobHash:hash,gate:{eligible:false},selected:{code:'private-marker'},experience:{lesson:'private-marker'},
        evidenceRefs:[hash],train:{baseline:assessment,candidate:null},holdout:[{caseId:'test',baseline:assessment,candidate:assessment}]}};
    writeFileSync(join(dir,'walk','journal.json'),JSON.stringify(journal));
    const view=createHarness2Monitor({directory:dir,jobs:[job]}).snapshot().jobs[0];
    expect(view).toMatchObject({status:'completed',result:{eligible:false,adopted:false,evidenceCount:1},usage:{inputTokens:null,returnedCalls:2,usageSamples:1}});
    expect(view.result!.train.candidate).toBeNull();expect(view.timeline[2].assessment?.achieved).toBe(false);
    expect(JSON.stringify(view)).not.toContain('private-marker');
    writeFileSync(join(dir,'walk','journal.json'),'{');expect(createHarness2Monitor({directory:dir,jobs:[job]}).snapshot().jobs[0].status).toBe('unknown');
    expect(()=>createHarness2Monitor({directory:dir,jobs:[{...job,id:'../outside'}]})).toThrow();
  }finally{rmSync(dir,{recursive:true,force:true});}
});
