/** Report only original paired evidence. Unknown observations/work never become zero/success. */
export function connectedCraftingReport({result,journal,readEvidence,modelCosts,source}){
  const sum=(rows,key)=>rows.length&&rows.every(r=>Number.isSafeInteger(r[key])&&r[key]>=0)?rows.reduce((n,r)=>n+r[key],0):null;
  const rows=result.evidenceRefs.map(id=>{
    const record=journal.rpc[id],evidence=readEvidence(id),trial=record?.value?.trial,assessment=record?.value?.assessment;
    if(record?.kind!=='trial'||record.phase!=='returned'||evidence.trial?.trialId!==id
      ||evidence.trial.executionId!==trial?.executionId||evidence.trial.candidateHash!==trial?.candidateHash)throw Error('Original trial evidence mismatch');
    return {trialId:id,executionId:trial.executionId,reference:trial.reference,reviewId:trial.reviewId,caseId:trial.caseId,
      group:record.group,role:record.role,assessment,actionSteps:evidence.actionSteps??null,failedActions:evidence.failedActions??null,
      sdkCalls:trial.sdkCalls??null,feedback:trial.feedback??null};
  });
  const aggregate=rows=>({executions:rows.length,successes:rows.filter(r=>r.assessment.achieved===true).length,
    failures:rows.filter(r=>r.assessment.achieved===false).length,unknown:rows.filter(r=>r.assessment.achieved===null).length,
    successRate:rows.length&&rows.every(r=>typeof r.assessment.achieved==='boolean')?rows.filter(r=>r.assessment.achieved).length/rows.length:null,
    requestedActionSteps:sum(rows,'actionSteps'),failedActionGroups:sum(rows,'failedActions'),sdkCalls:sum(rows,'sdkCalls')});
  const measurements=group=>Object.fromEntries(['baseline','candidate'].map(role=>[role,aggregate(rows.filter(r=>r.group===group&&r.role===role))]));
  return {schema:'agent-mc.connected-model-practice/v1',environment:'two-isolated-official-java-1.21.1-servers',
    source,selectedParams:result.selected?.params??null,result,rows,
    measuredExecutions:{training:measurements('train'),holdout:measurements('holdout')},
    pairedComparison:{training:result.train,holdout:result.holdout},modelCosts,adopted:false,liveAgentsModified:false,
    limitations:['A newly created limited reference method, not an A/B test of the four online Agents.',
      'Training includes repeated optimizer probes; use pairedComparison for the selected candidate and distinct holdout scenes.',
      'Two holdout scenes are small deterministic checks, not a general survival success rate.',
      'Action steps count requests; failedActions counts unsuccessful mc.do groups. Model calls and tokens are separate costs.',
      'Host model stream receipts do not independently verify a provider invoice. Unknown monetary charges remain null.']};
}
