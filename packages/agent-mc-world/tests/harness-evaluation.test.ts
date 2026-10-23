import {expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gatePracticeCandidate,assessPracticeTrial,type PracticeAssessment} from '../src/learning/practice.ts';
import {evaluatePracticeVariants} from '../src/learning/harness-evaluation.ts';
import {physicsPractice,STEP_CODE} from './harness2-fixture.ts';
const a=(achieved:boolean|null,calls:number|null,healthLoss=0):PracticeAssessment=>({achieved,reason:'measured',measurements:{distance:0,gained:null,healthLoss,elapsedMs:100,sdkCalls:calls}});
it('recognizes preserved success with independently measured SDK work savings, not elapsed-time noise',()=>{
  expect(gatePracticeCandidate([a(true,10)],[a(true,5)],[a(true,10)],[a(true,5)],'balanced')).toMatchObject({eligible:true,reason:'isolated-equal-success-less-sdk-work',adopted:false});
  expect(gatePracticeCandidate([a(true,10)],[a(true,5)],[a(true,10)],[a(true,10)],'balanced').eligible).toBe(false);
  expect(gatePracticeCandidate([a(true,null)],[a(true,5)],[a(true,10)],[a(true,5)],'balanced').eligible).toBe(false);
  expect(gatePracticeCandidate([a(true,10)],[a(true,5,1)],[a(true,10)],[a(true,5)],'balanced').eligible).toBe(false);
  expect(gatePracticeCandidate([a(true,10)],[a(false,1)],[a(true,10)],[a(true,1)],'balanced').eligible).toBe(false);
});
it('keeps only non-dominated matched variants and leaves missing work measurements unknown',()=>{
  const base={id:'baseline',revision:'base',cohort:'fixture-v1',train:[a(false,10)],holdout:[a(true,10)]};
  const result=evaluatePracticeVariants(base,[
    {...base,id:'cheap',revision:'a',train:[a(true,5)],holdout:[a(true,5)]},
    {...base,id:'wasteful',revision:'b',train:[a(true,20)],holdout:[a(true,20)]},
    {...base,id:'other',revision:'c',cohort:'other-version',train:[a(true,1)],holdout:[a(true,1)]},
    {...base,id:'unknown',revision:'d',train:[a(true,null)],holdout:[a(true,null)]}]);
  expect(result.frontier).toEqual(['cheap']);expect(result.recommendations).toEqual({lite:'cheap',balanced:'cheap',quality:'cheap'});
  expect(result.variants.find(v=>v.id==='other')?.reason).toBe('cohort-mismatch');
  expect(result.variants.find(v=>v.id==='unknown')?.meanSdkCalls).toBeNull();expect(result.adopted).toBe(false);
});
it('counts SDK work from actual source-version executions with reset collision physics and held-out goals',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'mc-efficiency-'));
  try{const p=physicsPractice(dir),sets:PracticeAssessment[][]=[[],[]];
    for(const [index,code]of ['await mc.state();\n'+STEP_CODE,STEP_CODE].entries())for(const fixture of p.fixtures){
      const trial=await p.executor.execute({trialId:`comparison-${index}-${fixture.id}`,methodId:'walk-efficiency',candidate:{code,params:{},guidance:'Walk to the declared target'},fixture,durationMs:10000},new AbortController().signal);
      sets[index]!.push(assessPracticeTrial(trial,fixture,p.executor.binding));
    }
    expect(sets.flat().every(a=>a.achieved)).toBe(true);
    expect(gatePracticeCandidate([sets[0]![0]!],[sets[1]![0]!],[sets[0]![1]!],[sets[1]![1]!],'balanced').eligible).toBe(true);
    expect(p.stats().heldKeys).toBe(0);expect((p.library.list() as any).methods[0].selected).toBeNull();
  }finally{rmSync(dir,{recursive:true,force:true});}
},20000);
