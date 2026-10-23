/** Import a measured candidate through the existing script/library contract. Never execute or adopt it. */
import {parseProcedure,procedureHash,type ProcedureVersion} from '../../core/support/procedure.ts';
import {createHash} from 'node:crypto';
import type {PracticeCandidate} from './practice.ts';
export interface PracticeStageRequest {jobId:string;jobHash:string;scope:{realm:string;account:string;agent:string};source:ProcedureVersion;candidate:PracticeCandidate}
export interface PracticeStagePort {
  call(args:Record<string,unknown>,signal:AbortSignal):Promise<{text:string;failed?:boolean;execution?:{evidence?:{localId?:number}}}>;
  scope():PracticeStageRequest['scope']|null;
}
export class PracticeStagingError extends Error {constructor(message:string,readonly writeAttempted:boolean){super(message);}}
export function createPracticeCandidateStager(port:PracticeStagePort) {
  return async(request:PracticeStageRequest,signal:AbortSignal):Promise<Record<string,unknown>>=>{
    let writeAttempted=false;
    const call=(args:Record<string,unknown>)=>{
      signal.throwIfAborted();if(procedureHash(port.scope())!==procedureHash(request.scope))throw Error('Practice staging scope changed');
      if((args.library as {op?:string})?.op==='save')writeAttempted=true;
      return port.call(args,signal);
    };
    try{
    signal.throwIfAborted();
    if(procedureHash(port.scope())!==procedureHash(request.scope))throw Error('Practice staging scope changed');
    const source=parseProcedure(request.source);
    const currentReply=await call({library:{op:'read',id:source.id}});
    if(currentReply.failed)throw Error(currentReply.text);
    const current=parseProcedure(JSON.parse(currentReply.text));
    if(current.revision!==source.revision)throw Error('Source parent changed; inspect and revise against its new head');
    const validated=await call({name:source.id,code:request.candidate.code,validate:true,waitMs:30000});
    if(validated.failed)throw Error(validated.text);
    const runId=validated.execution?.evidence?.localId;
    if(!Number.isSafeInteger(runId)||Number(runId)<1)throw Error('Missing original validation run id');
    const inspected=await call({runId,waitMs:30000});
    if(inspected.failed)throw Error(inspected.text);
    const validation=JSON.parse(inspected.text),hash=createHash('sha256').update(request.candidate.code).digest('hex');
    if(validation.status!=='validated'||validation.sourceHash!==hash)throw Error('Candidate syntax validation is unconfirmed');
    signal.throwIfAborted();
    const saved=await call({library:{op:'save',id:source.id,parent:source.revision,code:request.candidate.code,
      description:request.candidate.guidance.slice(0,800)||source.description,conditions:[...source.conditions.slice(0,7),`Isolated candidate from harness2:${request.jobHash}; live outcome unverified.`],validationRunId:runId}});
    if(saved.failed)throw Error(saved.text);
    const result=JSON.parse(saved.text),reference=result.reference;
    if(!reference||reference.revision===source.revision||typeof reference.handle!=='string')throw Error('Saved candidate reference unconfirmed; inspect the library before retrying');
    return {reference,parent:source.revision,sourceHash:hash,jobId:request.jobId,jobHash:request.jobHash,
      artifactHash:procedureHash(request.candidate),validationRunId:runId,staged:true,adopted:false,changedRunningProgram:false,liveOutcomeVerified:false,
      next:'Run this exact reference in a naturally suitable task, inspect the real terminal and world change, then review/adopt with mc_script library. Retain previous selected version for rollback.'};
    }catch(error){throw new PracticeStagingError(error instanceof Error?error.message:String(error),writeAttempted);}
  };
}
