/** Host-port receipts only. No prompt, answer, thought, credential or provider client is recorded. */
import {appendFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const count=v=>Number.isSafeInteger(v)&&v>=0?v:null;
export function createPracticeModelAudit({model,file,provenance,trainingJournal,requireFailureFeedback=false}){
  if(!model?.id||typeof model.generate!=='function')throw Error('An explicit host model port is required');
  if(!['registered-host-llm','scripted-test-double'].includes(provenance?.kind))throw Error('Declare model provenance');
  const identity={kind:provenance.kind,...Object.fromEntries(['provider','model','sessionId'].filter(k=>provenance[k]!==undefined).map(k=>{
    if(typeof provenance[k]!=='string'||!provenance[k].trim()||provenance[k].length>256)throw Error('Invalid model provenance');
    return [k,provenance[k]];
  }))};
  // Existing evidence is read by reports, never used to authorize a fresh model request.
  if(existsSync(file))throw Error('Model audit already exists; inspect the original experiment rather than replay it');
  writeFileSync(file,'',{flag:'wx',mode:0o600});
  const seen=new Set(),rows=[];
  const write=row=>{appendFileSync(file,JSON.stringify(row)+'\n',{mode:0o600});rows.push(row);};
  return {provenance:identity,snapshot:()=>structuredClone(rows),model:{id:model.id,async generate(request,signal){
    signal.throwIfAborted();
    if(seen.has(request.id))throw Error('Original host model request must not be replayed');
    const journal=trainingJournal&&existsSync(trainingJournal)?JSON.parse(readFileSync(trainingJournal,'utf8')):null;
    const input=JSON.stringify(request.files);
    const feedbackRefs=Object.entries(journal?.rpc??{}).filter(([,row])=>row.kind==='trial'&&row.group==='train'&&row.role==='baseline'
      &&row.phase==='returned'&&row.value?.assessment?.achieved===false).map(([id])=>id).filter(id=>input.includes(id));
    if(requireFailureFeedback&&!request.stage.startsWith('experience.')&&!feedbackRefs.length)
      throw Error('Original failed training evidence is missing from the model input');
    seen.add(request.id);
    const start={id:request.id,stage:request.stage,phase:'started',at:Date.now(),requestHash:hash(request),trainingFailureRefs:feedbackRefs};
    write(start);
    try{
      const reply=await model.generate(request,signal);signal.throwIfAborted();
      write({id:request.id,stage:request.stage,phase:'returned',at:Date.now(),replyHash:hash(reply),
        usage:Object.fromEntries(['inputTokens','cachedTokens','outputTokens'].map(k=>[k,count(reply?.usage?.[k])]))});
      return reply;
    }catch(error){
      // Even a known parse/cancel failure may have consumed provider tokens. It is not free.
      write({id:request.id,stage:request.stage,phase:'failed',at:Date.now(),usage:null,category:signal.aborted?'cancelled':'host-model-failure'});
      throw error;
    }
  }}};
}

export function summarizeModelAudit(rows,provenance){
  const starts=rows.filter(r=>r.phase==='started'),returned=rows.filter(r=>r.phase==='returned');
  const total=key=>starts.length&&starts.every(s=>returned.some(r=>r.id===s.id&&count(r.usage?.[key])!==null))
    ?returned.reduce((n,r)=>n+r.usage[key],0):null;
  return {provenance,attemptedCalls:starts.length,returnedCalls:returned.length,failedCalls:rows.filter(r=>r.phase==='failed').length,
    unresolvedCalls:starts.filter(s=>!rows.some(r=>r.id===s.id&&['returned','failed'].includes(r.phase))).length,
    callsWithFailedTrainingFeedback:starts.filter(r=>r.trainingFailureRefs?.length).length,
    inputTokens:total('inputTokens'),cachedTokens:total('cachedTokens'),outputTokens:total('outputTokens'),
    costUsd:null,costStatus:'No provider billing receipt; token counts are not a monetary charge.',
    providerInvoiceVerified:false,scripted:provenance.kind==='scripted-test-double'};
}
