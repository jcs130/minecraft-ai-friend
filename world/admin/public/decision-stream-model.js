import {buildUnifiedDecisionGraph} from './unified-decision.js';

// Reuse the evidence model, but ship only the two online decision systems.
export function buildDecisionStreamGraph(trace) {
 const full=buildUnifiedDecisionGraph(trace,null);
 const nodes=full.nodes.filter(n=>n.section==='policy'||n.section==='llm');
 for(const n of nodes){
  if(n.id!=='llm/llm')continue;
  const result=n.record?.modelResult;
  if(result){
   const running=result.availability==='available'&&['running','pending','queued'].includes(result.status);
   n.live=n.live&&running&&trace?.runtime?.enabled!==false&&!trace?.runtime?.pauseReason;
   n.title=running?'LLM 正在运行':result.finalText?'LLM 已返回结果':'LLM 任务';
   n.subtitle=result.finalText|| (running?'等待本轮最终回复':result.availability!=='available'?'原生结果暂不可读':'本轮未保存最终回复');
   n.detail=result.finalText||n.subtitle;
   if(result.tools?.length)n.detail+='\n本轮已记录调用：'+result.tools.map(t=>t.name).join(' → ');
  }else if(trace?.runtime?.enabled===false||trace?.runtime?.pauseReason)n.live=false;
 }
 const ids=new Set(nodes.map(n=>n.id));
 const lanes=full.lanes.filter(l=>l.id==='policy'||l.id==='llm');
 return {...full,id:'decision-stream',title:'Jev × LLM · 决策链路',nodes,lanes,
  edges:full.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)),steps:full.steps.filter(id=>ids.has(id)),
  width:1280,height:Math.max(...lanes.map(l=>l.y+l.h))+35};
}

export function streamRuntimeLabel(trace){
 const r=trace?.runtime||{},current=trace?.modelResults?.current;
 if(r.enabled===false||r.pauseReason)return 'Agent 已暂停'+(r.pauseReason?' · '+r.pauseReason:'');
 const parts=[];
 if(current){
  if(current.availability!=='available')parts.push('LLM 状态读取中断');
  else if(['running','pending','queued'].includes(current.status))parts.push('LLM '+({running:'运行中',pending:'等待中',queued:'排队中'}[current.status]));
  else parts.push('LLM '+({completed:'已返回',finished:'已结束',failed:'失败',cancelled:'已取消',canceled:'已取消'}[current.status]||'状态未知'));
 }else if(trace?.routing?.activeLlmTurnId)parts.push('LLM 任务已提交');
 if(r.policyPending)parts.push('Jev 请求中');
 if(r.programActive)parts.push('快速程序运行中');
 return parts.join(' · ')||({thinking:'认知任务处理中',waiting:'等待事件',idle:'等待事件',paused:'已暂停',running:'运行中'}[r.status||trace?.agent?.status]||r.status||'等待事件');
}
