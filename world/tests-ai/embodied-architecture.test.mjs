import test from 'node:test';
import assert from 'node:assert/strict';
import {buildArchitectureGraph} from '../admin/public/embodied-architecture.js';
import {buildEvolutionGraph} from '../admin/public/decision-model.js';

test('architecture keeps System 1 model and scripts separate from System 2 planning with explicit feedback',()=>{
 const g=buildArchitectureGraph();
 assert.deepEqual(g.nodes.filter(n=>n.tone==='purple').map(n=>n.id),['jev','scripts']);
 assert.deepEqual(g.nodes.filter(n=>n.tone==='cyan').map(n=>n.id),['llm','plan']);
 assert.ok(g.edges.some(e=>e.from==='jev'&&e.to==='llm'));
 assert.ok(g.edges.some(e=>e.from==='perception'&&e.to==='scripts'),'Deterministic scripts do not require a model decision');
 assert.ok(g.edges.some(e=>e.from==='plan'&&e.to==='scripts'),'Slow planning can reuse fast skills');
 assert.ok(g.edges.some(e=>e.from==='feedback'&&e.to==='perception'));
 assert.match(g.nodes.find(n=>n.id==='vision').detail,/结构化世界观察/);
 assert.match(g.nodes.find(n=>n.id==='hearing').detail,/不宣称麦克风/);
});
test('learning and framework evolution never upgrade receipts or closed issues to verified improvement',()=>{
 const rsi={sources:{learning:true,knowledge:true},l2:{localSkills:[{enabled:true}],knowledge:[]},l3:{verifiedImprovement:true,cases:{items:[{status:'resolved'}]},receipts:[{ok:true}]}};
 const l2=buildArchitectureGraph('l2',null,rsi),l3=buildArchitectureGraph('l3',null,rsi);
 assert.match(l2.nodes.find(n=>n.id==='dream').detail,/未提供 Dream 运行回执/);
 assert.equal(l2.nodes.find(n=>n.id==='dream').record,null);
 assert.equal(l3.nodes.find(n=>n.id==='gate').record.verifiedImprovement,null);
 assert.ok(l3.edges.some(e=>e.from==='gate'&&e.to==='revise'));
 assert.ok(l3.edges.some(e=>e.from==='gate'&&e.to==='release'));
 assert.equal(buildEvolutionGraph().nodes.find(n=>n.id==='experience').layer,'l2');
});
test('all three architecture layouts are bounded, non-overlapping and mechanisms only',()=>{
 for(const mode of ['online','l2','l3']){
  const g=buildArchitectureGraph(mode), ids=new Set(g.nodes.map(n=>n.id));
  assert.equal(ids.size,g.nodes.length);
  for(const e of g.edges){assert.equal(e.evidence,'mechanism');assert.ok(ids.has(e.from)&&ids.has(e.to));}
  for(const a of g.nodes){
   assert.ok(a.x>=0&&a.y>=0&&a.x+a.w<=g.width&&a.y+a.h<=g.height);
   for(const b of g.nodes){if(a===b)continue;assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y);}
  }
 }
});
