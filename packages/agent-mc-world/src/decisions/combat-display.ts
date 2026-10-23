import type { CombatDecisionFrame } from '../../core/combat-decision-types.ts';

export interface CombatDecisionDisplay {
  phase: 'requested' | 'kept' | 'not-applied' | 'dispatched' | 'observed' | 'error' | 'unknown';
  label: string;
  action: string | null;
  reason: string | null;
  target: { entityId: number; type: string | null; relation: string | null; sampledAtMs: number | null } | null;
  text: string;
  effectVerified: false;
  goalCompleted: false;
}
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const labels: Record<string,string> = { engage:'接敌',track:'停火盯防',retreat:'撤离',step:'短步移动',cast:'施法',method:'运行方法',keep:'保持现有动作' };
const reasons: Record<string,string> = { 'scene-changed':'场景变化',moved:'采样原点变化',stale:'结果过期',uncertain:'排序分差不足',shadow:'仅观测模式',rejected:'执行校验未通过',error:'请求失败' };

/** Presentation only. A request or ranked choice never establishes dispatch, effect or ally identity. */
export function describeCombatDecision(event: string, data: Record<string,unknown>, frame?: CombatDecisionFrame | null): CombatDecisionDisplay {
  const application=object(data.application),candidate=object(data.candidate),outcome=typeof data.outcome==='string'?data.outcome:null;
  const action=event==='requested'?null:data.choice==='keep'?'keep':typeof candidate.kind==='string'?candidate.kind:null;
  let phase:CombatDecisionDisplay['phase']='unknown',label='下发状态未提供';
  if(event==='requested'){phase='requested';label='候选待决策';}
  else if(event==='observation'||event==='observed'){phase='observed';label='后续采样，效果待核对';}
  else if(application.dispatched===true){phase='dispatched';label='已下发，效果待验';}
  else if(application.keptCurrent===true){phase='kept';label='保持现有动作';}
  else if(application.dispatched===false||outcome==='shadow'){phase='not-applied';label='未执行';}
  else if(event==='error'||event==='unavailable'){phase='error';label='请求不可用';}
  const reason=typeof application.reason==='string'?application.reason:outcome;
  const targetId=Number.isSafeInteger(candidate.targetId)?Number(candidate.targetId)
    : action==='keep'?frame?.battlefield.action.targetEntityId:null;
  const actor=targetId==null?null:frame?.battlefield.actors.find(a=>a.entityId===targetId);
  const target=targetId==null?null:{entityId:targetId,type:actor?.type??null,relation:actor?.relation??null,sampledAtMs:frame?.battlefield.sampledAtMs??null};
  const relation:Record<string,string>={hostile:'敌对',ally:'已确认队友',neutral:'中立',unknown:'关系未知'};
  const text=[label+(phase==='not-applied'&&reason?`：${reasons[reason]??reason}`:''),action?labels[action]??action:'',
    target?`目标 ${target.type??'类型未知'} #${target.entityId} · ${relation[target.relation??'unknown']??'关系未知'}（请求采样）`:'',
    '选择与下发均不证明完成'].filter(Boolean).join('；');
  return {phase,label,action,reason,target,text,effectVerified:false,goalCompleted:false};
}
