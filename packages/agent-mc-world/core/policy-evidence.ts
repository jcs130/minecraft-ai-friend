/** Game-policy provenance is independent of system1/system2 and of method completion. */
export type PolicySource = 'rule' | 'learned' | 'human' | 'unknown';
export type PolicyLayer = 'motor' | 'skill' | 'planner';
export type PolicyMode = 'shadow' | 'canary' | 'active';
export interface PolicyEvidence {
  layer: PolicyLayer;
  /** For an operation: the policy supplying the submitted action. For shadow: proposal only. */
  source: PolicySource;
  policyId: string;
  revision: string;
  mode: PolicyMode;
  experimentId?: string | null;
  episodeId?: string | null;
  action?: string | null;
  baselineAction?: string | null;
  selectedSource?: PolicySource | null;
  candidateProbability?: number | null;
  featureHash?: string | null;
  inputRef?: string | null;
  inferenceMs?: number | null;
}
const id = (v: unknown): v is string => typeof v === 'string' && /^[\w:./@#-]{1,256}$/.test(v)
  && !['__proto__', 'constructor', 'prototype'].includes(v);
export function normalizePolicyEvidence(value: PolicyEvidence): PolicyEvidence {
  if (!value || !['rule', 'learned', 'human', 'unknown'].includes(value.source)
    || !['motor', 'skill', 'planner'].includes(value.layer) || !['shadow', 'canary', 'active'].includes(value.mode)
    || !id(value.policyId) || !id(value.revision)) throw Error('Invalid policy provenance');
  const result: PolicyEvidence = {layer:value.layer, source:value.source, policyId:value.policyId, revision:value.revision, mode:value.mode};
  for (const key of ['experimentId','episodeId','action','baselineAction','inputRef'] as const) {
    if (value[key] != null && !id(value[key])) throw Error('Invalid policy metadata identifier');
    result[key] = value[key] ?? null;
  }
  if (value.selectedSource != null && !['rule','learned','human','unknown'].includes(value.selectedSource)) throw Error('Invalid selected policy source');
  if (value.candidateProbability != null && (!Number.isFinite(value.candidateProbability) || value.candidateProbability < 0 || value.candidateProbability > 1)) throw Error('Invalid rollout probability');
  if (value.featureHash != null && !/^[a-f0-9]{64}$/.test(value.featureHash)) throw Error('Invalid policy feature hash');
  if (value.inferenceMs != null && (!Number.isFinite(value.inferenceMs) || value.inferenceMs < 0)) throw Error('Invalid policy inference time');
  return {...result, selectedSource:value.selectedSource??null, candidateProbability:value.candidateProbability??null,
    featureHash:value.featureHash??null, inferenceMs:value.inferenceMs??null};
}
