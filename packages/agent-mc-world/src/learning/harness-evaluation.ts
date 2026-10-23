/** Pure quality/work comparison of matched isolated evidence. No inference, dispatch or adoption. */
import type {PracticeAssessment} from './practice.ts';
export interface PracticeVariant {
  id:string;revision:string;cohort:string;train:PracticeAssessment[];holdout:PracticeAssessment[];
}
export interface PracticeFrontier {
  metric:'mean-sdk-calls';scope:'isolated-practice';adopted:false;causalImprovementVerified:false;
  variants:Array<{id:string;revision:string;passRate:number|null;meanSdkCalls:number|null;meanElapsedMs:number|null;eligible:boolean;reason:string}>;
  frontier:string[];recommendations:{lite:string|null;balanced:string|null;quality:string|null};
}
const mean=(values:unknown[]):number|null=>values.length&&values.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0)
  ?values.reduce<number>((sum,v)=>sum+Number(v),0)/values.length:null;
export function evaluatePracticeVariants(baseline:PracticeVariant,candidates:readonly PracticeVariant[]):PracticeFrontier {
  if(!baseline.train.length||!baseline.holdout.length||candidates.length>100||new Set([baseline.id,...candidates.map(c=>c.id)]).size!==candidates.length+1)
    throw Error('Distinct bounded variants and train/holdout evidence are required');
  const base=[...baseline.train,...baseline.holdout],known=base.every(a=>typeof a.achieved==='boolean'&&a.reason==='measured');
  const floor=known?base.filter(a=>a.achieved).length/base.length:null;
  const variants=[baseline,...candidates].map((v,index)=>{
    const rows=[...v.train,...v.holdout],matched=v.cohort===baseline.cohort&&v.train.length===baseline.train.length&&v.holdout.length===baseline.holdout.length;
    const measured=rows.every(a=>typeof a.achieved==='boolean'&&a.reason==='measured');
    const passRate=measured?rows.filter(a=>a.achieved).length/rows.length:null;
    const work=mean(rows.map(a=>a.measurements.sdkCalls));
    const preserved=matched&&rows.every((a,i)=>base[i]!.achieved!==true||a.achieved===true);
    const eligible=known&&matched&&measured&&passRate!>=floor!&&preserved&&(index===0||v.holdout.every(a=>a.achieved===true));
    return {id:v.id,revision:v.revision,passRate,meanSdkCalls:work,meanElapsedMs:mean(rows.map(a=>a.measurements.elapsedMs)),
      eligible,reason:!matched?'cohort-mismatch':!known||!measured?'incomplete-evidence':!eligible?'goal-regression':'measured-isolated-evidence'};
  });
  const available=variants.filter(v=>v.eligible&&v.meanSdkCalls!==null&&v.passRate!==null);
  const frontier=available.filter(a=>!available.some(b=>b!==a&&b.passRate!>=a.passRate!&&b.meanSdkCalls!<=a.meanSdkCalls!
    &&(b.passRate!>a.passRate!||b.meanSdkCalls!<a.meanSdkCalls!)));
  const rates=frontier.map(v=>v.passRate!),costs=frontier.map(v=>v.meanSdkCalls!);
  const pMin=Math.min(...rates),pMax=Math.max(...rates),cMin=Math.min(...costs),cMax=Math.max(...costs);
  const select=(qualityWeight:number)=>frontier.map(v=>({id:v.id,score:qualityWeight*(pMax===pMin?0:(pMax-v.passRate!)/(pMax-pMin))**2
    +(1-qualityWeight)*(cMax===cMin?0:(v.meanSdkCalls!-cMin)/(cMax-cMin))**2})).sort((a,b)=>a.score-b.score||a.id.localeCompare(b.id))[0]?.id??null;
  return {metric:'mean-sdk-calls',scope:'isolated-practice',adopted:false,causalImprovementVerified:false,variants,
    frontier:frontier.map(v=>v.id),recommendations:{lite:select(.2),balanced:select(.5),quality:select(.8)}};
}
