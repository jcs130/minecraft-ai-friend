import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisionStreamGraph} from '../admin/public/decision-stream-model.js';
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
