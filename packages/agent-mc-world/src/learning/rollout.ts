import { createHash } from 'node:crypto';
import type { PolicyMode, PolicySource } from '../../core/policy-evidence.ts';
export { normalizePolicyEvidence, type PolicyEvidence, type PolicySource, type PolicyLayer, type PolicyMode } from '../../core/policy-evidence.ts';

export interface PolicyProposal { source:'rule'|'learned'; policyId:string; revision:string; action:string }
export interface PolicyRolloutRequest {
  scopeKey:string; experimentId:string; episodeId:string; mode:PolicyMode; candidateFraction:number;
  baseline:PolicyProposal; candidate:PolicyProposal|null;
  /** Host checks current capability, body ownership, observation freshness and task scope. */
  eligible:boolean; stopRequested?:boolean;
}
/** Pure, episode-stable assignment. A proposal never owns a body or authorizes dispatch. */
export function selectPolicyProposal(request:PolicyRolloutRequest) {
  const token=(x:unknown)=>typeof x==='string'&&/^[\w:./@#-]{1,256}$/.test(x);
  if(!/^[a-f0-9]{64}$/.test(request.scopeKey)||!token(request.experimentId)||!token(request.episodeId)
    ||!['shadow','canary','active'].includes(request.mode)||!Number.isFinite(request.candidateFraction)
    ||request.candidateFraction<0||request.candidateFraction>1||typeof request.eligible!=='boolean'
    ||(request.stopRequested!==undefined&&typeof request.stopRequested!=='boolean'))throw Error('Invalid rollout assignment');
  for(const proposal of [request.baseline,request.candidate])if(proposal&&(!token(proposal.policyId)||!token(proposal.revision)||!token(proposal.action)))throw Error('Invalid policy proposal');
  if(request.baseline.source!=='rule'||(request.candidate&&request.candidate.source!=='learned'))throw Error('Rollout requires explicit baseline/candidate provenance');
  const hash=createHash('sha256').update(JSON.stringify([request.scopeKey,request.experimentId,request.episodeId])).digest();
  const bucket=hash.readUInt32BE(0)/0x100000000;
  const available=request.eligible&&!!request.candidate&&!request.stopRequested;
  const candidateProbability=available&&request.mode!=='shadow'?(request.mode==='active'?1:request.candidateFraction):0;
  const chosen:PolicySource=bucket<candidateProbability?'learned':'rule';
  return {proposal:structuredClone(chosen==='learned'?request.candidate!:request.baseline),selectedSource:chosen,
    candidateProbability, bucket, requiresHostDispatch:true as const,
    reason:request.stopRequested?'stopped':!request.candidate?'candidate-missing':!request.eligible?'ineligible':request.mode==='shadow'?'shadow-only':chosen==='learned'?'candidate-cohort':'baseline-cohort'};
}
