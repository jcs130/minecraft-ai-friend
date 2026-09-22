import test from 'node:test';
import assert from 'node:assert/strict';
import {buildUnifiedDecisionGraph} from '../admin/public/unified-decision.js';
import {listDecisionRecords} from '../admin/public/decision-model.js';
import {layoutDecisionGraph} from '../admin/public/decision-canvas.js';
const trace={stale:false,routing:{activeSource:'llm',activeLlmTurnId:'active'},turns:[{turnId:'active',decisionSource:'llm',status:'active',startedAt:300,actions:[]},{turnId:'old',decisionSource:'llm',status:'completed',startedAt:100,finishedAt:200,actions:[]}],policyDecisions:[{source:'jev',at:250,model:'jev',choice:'a',outcome:'fallback',candidates:[{id:'a',selected:true,probability:.6}],actions:[]}]};
test('all systems share one graph with unique namespaced identities and no fabricated handoff',()=>{
 const g=buildUnifiedDecisionGraph(trace,null);
 assert.deepEqual(g.lanes.map(n=>n.id),['policy','llm','l2','l3']);
 assert.equal(new Set(g.nodes.map(n=>n.id)).size,g.nodes.length);
 assert.ok(g.nodes.some(n=>n.id==='policy/gate'));
 assert.ok(g.nodes.some(n=>n.id==='llm/llm'&&n.live));
 assert.ok(g.nodes.some(n=>n.id==='l2/dream'));
 assert.ok(g.nodes.some(n=>n.id==='l3/gate'));
 assert.equal(g.edges.find(e=>e.id==='handoff-mechanism').evidence,'mechanism');
 assert.ok(g.edges.some(e=>e.from==='llm/feedback'&&e.to==='l2/episodes'&&e.evidence==='mechanism'));
 assert.ok(g.edges.some(e=>e.from==='l2/reflect'&&e.to==='l3/proposal'&&e.evidence==='mechanism'));
 assert.ok(g.edges.some(e=>e.from==='l3/release'&&e.to==='llm/observation'&&e.evidence==='mechanism'));
 assert.ok(g.edges.filter(e=>e.evidence==='recorded').every(e=>e.from.split('/')[0]===e.to.split('/')[0]));
 assert.ok(g.steps.every(id=>!id.startsWith('l2/')&&!id.startsWith('l3/')));
});
test('historical selection changes only its lane and never hides another system or claims it is live',()=>{
 const g=buildUnifiedDecisionGraph(trace,null,{llm:'llm:old'});
 assert.equal(g.lanes.find(n=>n.id==='llm').recordId,'llm:old');
 assert.equal(g.lanes.find(n=>n.id==='policy').recordId,listDecisionRecords(trace).find(r=>r.kind==='policy').id);
 assert.equal(g.nodes.some(n=>n.live),false);
 assert.equal(g.lanes.length,4);
 const expired=buildUnifiedDecisionGraph(trace,null,{llm:'llm:expired'});
 assert.match(expired.nodes.find(n=>n.id==='llm/waiting').detail,/不会自动替换/);
});
test('missing sources never borrow another system record and every layout remains in bounds',()=>{
 for(const data of [null,{turns:trace.turns},trace,{...trace,stale:true}]){
  const g=buildUnifiedDecisionGraph(data,null),layout=layoutDecisionGraph(g,true);
  assert.equal(layout.width,g.width,'OBS uses the same complete graph');
  if(!data?.policyDecisions)assert.ok(g.nodes.some(n=>n.id==='policy/waiting'));
  if(data?.stale)assert.equal(g.nodes.some(n=>n.live),false);
  for(const n of layout.map.values())assert.ok(n.x>=0&&n.y>=0&&n.x+n.w<=layout.width&&n.y+n.h<=layout.height,n.id);
  for(const e of g.edges)assert.ok(layout.map.has(e.from)&&layout.map.has(e.to));
 }
});
