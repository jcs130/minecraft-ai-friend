import {buildUnifiedDecisionGraph} from './unified-decision.js';

// Reuse the evidence model, but ship only the two online decision systems.
export function buildDecisionStreamGraph(trace) {
 const full=buildUnifiedDecisionGraph(trace,null);
 const nodes=full.nodes.filter(n=>n.section==='policy'||n.section==='llm');
 const ids=new Set(nodes.map(n=>n.id));
 const lanes=full.lanes.filter(l=>l.id==='policy'||l.id==='llm');
 return {...full,id:'decision-stream',title:'Jev × LLM · 决策链路',nodes,lanes,
  edges:full.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)),steps:full.steps.filter(id=>ids.has(id)),
  width:1280,height:Math.max(...lanes.map(l=>l.y+l.h))+35};
}
