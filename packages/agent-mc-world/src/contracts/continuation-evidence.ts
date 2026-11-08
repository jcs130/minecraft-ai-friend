import { createHash } from 'node:crypto';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const parse = (v: unknown): unknown => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return v; } };
const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable)
  : object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const digest = (v: unknown): string => createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');

/** Bounded native evidence for a host inbox. Keep failure/effect/coverage facts
 * beside prose truncation; omit bulk inventories and voxel arrays. Full native
 * records remain in the producer archive, identified by the host envelope.
 */
export function compactWorkExecutionEvidence(value: unknown): Record<string, unknown> | undefined {
  if (!object(value)) return undefined;
  const scalar=(v:unknown,k:string):unknown => typeof v==='string'?v.slice(0,600)
    : v===null||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)?v
    :k==='position'&&Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n))?[...v]:undefined;
  const pick=(v:unknown,keys:readonly string[])=>object(v)?Object.fromEntries(keys
    .map(k=>[k,scalar(v[k],k)]).filter(([,v])=>v!==undefined)):undefined;
  const steps=Array.isArray(value.steps)?value.steps.filter(object):[];
  const selected=steps.length>8?[...steps.slice(0,4),...steps.slice(-4)]:steps;
  const total=value.format==='agent-mc/compact-execution-evidence/v1'&&Number.isSafeInteger(value.totalSteps)&&Number(value.totalSteps)>=steps.length?Number(value.totalSteps):steps.length;
  return {format:'agent-mc/compact-execution-evidence/v1',
    ...(typeof value.outcome==='string'?{outcome:value.outcome.slice(0,80)}:{}),
    steps:selected.map(step=>({step:scalar(step.step,'step'),outcome:scalar(step.outcome,'outcome'),why:typeof step.why==='string'?step.why.slice(0,600):null,
      decision:pick(step.decision,['status','reason','completed','remaining','unit','retryable','retry_after','continue_when']),
      ...(object(step.observation)?{observation:{
        readout:pick(step.observation.readout,['protocol','kind','worldKey','selection','revision','scanComplete','knownComplete','remainingCount','unknownCount','continuationAvailable']),
        summary:pick(step.observation.summary,['observedCells','totalCells','unknownCells','headLayerIncluded']),
      }}:{}),
      ...(object(step.observedEffect)&&step.observedEffect.schema==='agent-mc-observed-effect/v1'?{observedEffect:{
        ...pick(step.observedEffect,['schema','skill','dimension','status','coverage','goalVerified']),
        changed:pick(step.observedEffect.changed,['target','inventory','position','window']),
        before:pick(step.observedEffect.before,['position']),after:pick(step.observedEffect.after,['position']),
      }}:{}),
    })),totalSteps:total,omittedSteps:total-selected.length,goalCompleted:false};
}

/** Content novelty for a host checkpoint, never proof of task/goal progress.
 * Recognized producer envelopes exclude transport IDs/clocks. Unknown formats
 * remain opaque rather than guessing which domain fields can be discarded.
 */
export function workContinuationEvidence(input: {tool: string; arguments: unknown; receipt: unknown; terminal?: unknown}) {
  const value = parse(input.receipt), terminal = parse(input.terminal);
  const result = (kind: string, content?: unknown) => ({schema:'agent-mc/continuation-evidence/v1' as const,
    kind, key: content === undefined ? null : digest([input.tool, content]), goalCompleted:false as const});
  if (object(value) && object(value.readout) && value.readout.protocol === 'agent-mc-spatial-read/v1') {
    if (object(value.summary) && value.summary.observedCells === 0 && Number(value.summary.unknownCells) > 0)
      return result('unobserved-space');
    if (typeof value.readout.revision === 'string' && typeof value.readout.selection === 'string')
      return result('spatial-observation', [value.readout.worldKey, value.readout.selection, value.readout.revision]);
  }
  const queue=object(value)&&object(value.data)?value.data:null;
  if(queue?.protocol==='agent-mc/task-queue-read/v1') {
    const last=object(queue.last)?queue.last:null,current=object(queue.current)?queue.current:null;
    const running=current&&object(current.running)?current.running:null;
    if(running&&(!last||queue.requestedId===null||queue.requestedId===running.id))return result('pending-queue');
    if(last){
      const projected=compactWorkExecutionEvidence(last.evidence),steps=projected&&Array.isArray(projected.steps)?projected.steps:[];
      if(steps.length&&steps.every(s=>object(s)&&object(s.observation)&&object(s.observation.summary)
        &&s.observation.summary.observedCells===0&&Number(s.observation.summary.unknownCells)>0))return result('unobserved-space');
      return result('queue-terminal',{kind:last.kind,evidence:projected,
        ...(!steps.length?{text:typeof last.text==='string'?last.text.replace(/\b\d{2}:\d{2}:\d{2}\b/g,'<clock>').replace(/任务#\d+/g,'任务#<serial>'):last.text}:{})});
    }
    return result('queue-state',current);
  }
  const query = object(value) && object(value.data) ? value.data : value;
  if (object(query) && typeof query.requestId === 'string' && typeof query.query === 'string'
    && typeof query.phase === 'string') {
    if (['pending','sent','queued'].includes(query.phase)) return result('pending-query');
    const reply = object(query.reply) ? query.reply : null;
    return result('query-result', {query:query.query,arguments:query.arguments,generation:query.generation,
      username:query.username,phase:query.phase,outcomeUnknown:query.outcomeUnknown,
      reply:reply ? {ok:reply.ok,data:reply.data ?? reply.text} : null,error:query.error});
  }
  if (object(value) && object(value.execution) && value.execution.terminal === false && !terminal)
    return result('pending-execution');
  if (object(terminal) && object(terminal.execution) && terminal.execution.terminal === true) {
    // Native task prose contains receipt clocks and local task serials. Normalize
    // those only inside this typed producer envelope, never a player's dialogue.
    const text = typeof terminal.text === 'string' && terminal.execution.kind === 'task'
      ? terminal.text.replace(/\b\d{2}:\d{2}:\d{2}\b/g, '<clock>').replace(/任务#\d+/g, '任务#<serial>') : terminal.text;
    const evidence=compactWorkExecutionEvidence(terminal.execution.evidence);
    const steps=evidence && Array.isArray(evidence.steps)?evidence.steps:[];
    if(steps.length && steps.every(s=>object(s)&&object(s.observation)&&object(s.observation.summary)
      &&s.observation.summary.observedCells===0&&Number(s.observation.summary.unknownCells)>0))return result('unobserved-space');
    return result('execution-terminal', {arguments:input.arguments,source:terminal.source,type:terminal.type,
      execution:{kind:terminal.execution.kind,phase:terminal.execution.phase},
      ...(evidence&&steps.length?{evidence}:{text})});
  }
  return result('opaque-result', [input.arguments, value]);
}
