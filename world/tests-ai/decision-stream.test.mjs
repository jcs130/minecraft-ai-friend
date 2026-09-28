import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisionStreamGraph,streamRuntimeLabel} from '../admin/public/decision-stream-model.js';
const trace={available:true,stale:false,routing:{activeSource:'llm',activeLlmTurnId:'active'},turns:[{turnId:'active',decisionSource:'llm',status:'active',startedAt:300,actions:[]}],policyDecisions:[{source:'jev',at:250,model:'jev',choice:'a',outcome:'fallback',candidates:[{id:'a',selected:true,probability:.6}],actions:[]}]};
test('stream contains only online systems, retained branches and correctly bounded connectors',()=>{
 const g=buildDecisionStreamGraph(trace),ids=new Set(g.nodes.map(n=>n.id));
 assert.deepEqual(g.lanes.map(l=>l.id),['policy','llm']);
 assert.ok(g.nodes.some(n=>n.id==='policy/gate'));
 assert.ok(g.nodes.some(n=>n.id==='llm/llm'&&n.live));
 assert.ok(g.edges.some(e=>e.id==='handoff-mechanism'&&e.evidence==='mechanism'));
 assert.ok(g.edges.every(e=>ids.has(e.from)&&ids.has(e.to)));
 assert.ok(g.steps.every(id=>ids.has(id)));
 for(const n of g.nodes){const p=n.position;assert.ok(p.x>=0&&p.y>=0&&p.x+p.w<=g.width&&p.y+p.h<=g.height,n.id);}
 assert.equal(g.nodes.some(n=>['l2','l3'].includes(n.section)),false);
});
test('missing and stale streams never manufacture a current decision',()=>{
 assert.equal(buildDecisionStreamGraph({...trace,stale:true}).nodes.some(n=>n.live),false);
 const g=buildDecisionStreamGraph(null);assert.equal(g.lanes.length,2);
 assert.ok(g.nodes.every(n=>n.id.endsWith('/waiting')));assert.deepEqual(g.steps,[]);
});
test('actual native output and concurrent runtime state update without pretending paused or completed tasks are live',()=>{
 const sample=structuredClone(trace),result={availability:'available',status:'running',finalText:null,tools:[]};
 sample.runtime={enabled:true,policyPending:true,programActive:true};sample.modelResults={current:result};sample.turns[0].modelResult=result;
 assert.match(streamRuntimeLabel(sample),/LLM 运行中 · Jev 请求中 · 快速程序运行中/);
 assert.ok(buildDecisionStreamGraph(sample).nodes.find(n=>n.id==='llm/llm').live);
 result.status='completed';result.finalText='真实原生回复';result.tools=[{name:'numen_survival__look'}];
 const n=buildDecisionStreamGraph(sample).nodes.find(n=>n.id==='llm/llm');
 assert.equal(n.live,false);assert.match(n.detail,/真实原生回复/);assert.match(n.detail,/numen_survival__look/);
 sample.runtime.enabled=false;sample.runtime.pauseReason='controller_error';assert.match(streamRuntimeLabel(sample),/已暂停/);
 result.status='running';assert.equal(buildDecisionStreamGraph(sample).nodes.find(n=>n.id==='llm/llm').live,false);
 sample.runtime.enabled=true;sample.runtime.pauseReason=null;result.availability='unavailable';
 assert.match(streamRuntimeLabel(sample),/读取中断/);assert.equal(buildDecisionStreamGraph(sample).nodes.find(n=>n.id==='llm/llm').live,false);
});
