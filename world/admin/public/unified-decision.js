import {listDecisionRecords,buildDecisionGraph} from './decision-model.js';
import {layoutDecisionGraph,routeDecisionEdge} from './decision-canvas.js';
import {buildArchitectureGraph} from './embodied-architecture.js';

// Every lane remains mounted. Selecting history changes one record, never the topology's visibility.
export function buildUnifiedDecisionGraph(trace,rsi,selections={}) {
 const records=listDecisionRecords(trace), graph={id:'unified',kind:'unified',source:'mixed',title:'一张图，看见完整决策与进化回路',nodes:[],edges:[],steps:[],lanes:[],width:1950,height:1050,empty:false,at:trace?.generatedAt,notice:'各分区同时展示。实线只表示同一记录内的执行顺序；跨系统与跨层虚线是机制，不证明历史记录已关联。'};
 let y=70;
 for(const kind of ['policy','llm']){
  const selected=selections[kind]||records.find(r=>r.kind===kind)?.id;
  const part=buildDecisionGraph(trace,selected||kind+':unavailable'), layout=layoutDecisionGraph(part), offset={x:35,y}, sectionHeight=Math.max(layout.height,300);
  graph.lanes.push({id:kind,x:20,y:y-45,w:1220,h:sectionHeight+35,title:kind==='policy'?'SYSTEM 1 · Jev / 策略分支':'SYSTEM 2 · LLM / 规划与工具',at:part.at,recordId:selected||null,empty:part.empty,notice:part.notice});
  if(part.empty){graph.nodes.push({id:kind+'/waiting',section:kind,kind:'observation',source:kind==='llm'?'llm':'policy_unknown',status:'unknown',title:part.title,subtitle:'此分区始终保留',detail:part.notice,position:{x:offset.x+350,y:offset.y+90,w:300,h:104}});}
  for(const n of part.nodes){const p=layout.map.get(n.id);graph.nodes.push({...n,id:kind+'/'+n.id,section:kind,recordId:part.id,recordAt:part.at,live:kind==='llm'&&n.kind==='llm'&&trace?.stale===false&&trace?.routing?.activeLlmTurnId===selected?.slice(4)&&trace?.routing?.activeSource==='llm',position:{...p,x:p.x+offset.x,y:p.y+offset.y}});}
  for(const e of part.edges){const route=routeDecisionEdge(e,layout,part.kind);graph.edges.push({...e,id:kind+'/'+e.id,from:kind+'/'+e.from,to:kind+'/'+e.to,source:part.source,route:{...route,offset}});}
  graph.steps.push(...part.steps.map(id=>kind+'/'+id));
  y+=sectionHeight+90;
 }
 for(const [index,layer] of ['l2','l3'].entries()){
  const part=buildArchitectureGraph(layer,trace,rsi), x=1290+index*330, ordered=layer==='l3'?['proposal','candidate','compile','evaluate','gate','release','revise']:['episodes','reflect','dream','memory','skills','verify'];
  graph.lanes.push({id:layer,x:x-15,y:25,w:310,h:ordered.length*126+70,title:layer==='l2'?'L2 · 经验进化':'L3 · 框架进化',at:null});
  for(const [i,id] of ordered.entries()){
   const n=part.nodes.find(n=>n.id===id);
   const kinds={episodes:'observation',reflect:'reflection',dream:'reflection',memory:'knowledge',skills:'skill',verify:'test',proposal:'issue',candidate:'engineering',compile:'test',evaluate:'validation',gate:'validation',release:'validation',revise:'engineering'};
   graph.nodes.push({...n,id:layer+'/'+id,section:layer,layer,kind:kinds[id],source:'rsi',status:n.record?'recorded':'unknown',mechanism:true,position:{x:x+15,y:90+i*126,w:250,h:96}});
  }
  for(const e of part.edges){const a=graph.nodes.find(n=>n.id===layer+'/'+e.from).position,b=graph.nodes.find(n=>n.id===layer+'/'+e.to).position;
   const adjacent=b.y===a.y+126,forward=b.y>a.y,side=forward?x+283:x-3;
   const d=adjacent?`M ${a.x+125} ${a.y+a.h} V ${b.y-7}`: `M ${forward?a.x+a.w:a.x} ${a.y+48} H ${side} V ${b.y+48} H ${forward?b.x+b.w+7:b.x-7}`;
   graph.edges.push({...e,id:layer+'/'+e.from+':'+e.to,from:layer+'/'+e.from,to:layer+'/'+e.to,evidence:'mechanism',route:{d,label:null}});
  }
 }
 graph.height=Math.max(y+20,...graph.lanes.map(l=>l.y+l.h+30));
 // These connectors are deliberately mechanisms, never receipt associations.
 const fallback=graph.nodes.find(n=>n.id==='policy/fallback'),observation=graph.nodes.find(n=>n.id==='llm/observation');
 if(fallback&&observation){const a=fallback.position,b=observation.position,between=graph.lanes[0].y+graph.lanes[0].h+17;graph.edges.push({id:'handoff-mechanism',from:fallback.id,to:observation.id,evidence:'mechanism',route:{d:`M ${a.x+a.w} ${a.y+a.h/2} H 1255 V ${between} H 28 V ${b.y+b.h/2} H ${b.x-7}`,label:{x:680,y:between-8,text:'升级到慢系统 · 机制示意，轮次未绑定'}}});}
 const link=(from,to,d,label)=>{if(graph.nodes.some(n=>n.id===from)&&graph.nodes.some(n=>n.id===to))graph.edges.push({id:from+'->'+to,from,to,evidence:'mechanism',label,route:{d,label:null}});};
 const receipt=graph.nodes.find(n=>n.id==='llm/feedback'),experience=graph.nodes.find(n=>n.id==='l2/episodes'),reflection=graph.nodes.find(n=>n.id==='l2/reflect'),proposal=graph.nodes.find(n=>n.id==='l3/proposal');
 if(receipt&&experience){const a=receipt.position,b=experience.position;link(receipt.id,experience.id,`M ${a.x+a.w/2} ${a.y+a.h} V ${a.y+a.h+18} H 1262 V ${b.y+48} H ${b.x-7}`,'行动反馈成为学习材料 · 机制示意');}
 if(reflection&&proposal){const a=reflection.position,b=proposal.position;link(reflection.id,proposal.id,`M ${a.x+a.w} ${a.y+48} H 1595 V ${b.y+48} H ${b.x-7}`,'反思形成框架改进提案 · 机制示意');}
 if(observation){for(const [id,side,bottom,left] of [['l2/verify',1588,graph.height-27,18],['l3/release',1925,graph.height-10,7]]){const n=graph.nodes.find(n=>n.id===id),a=n.position,b=observation.position;link(id,observation.id,`M ${a.x+a.w} ${a.y+48} H ${side} V ${bottom} H ${left} V ${b.y+b.h/2} H ${b.x-7}`,'验证后进入下一轮在线运行 · 机制示意');}}
 return graph;
}

export function attachGraphNavigation(svg,onChange=()=>{}){
 let bounds={width:1950,height:1050},box={x:0,y:0,w:1950,h:1050},zoom=1,drag=null,disposed=false;
 function paint(){if(disposed)return;svg.setAttribute('viewBox',`${box.x} ${box.y} ${box.w} ${box.h}`);onChange(zoom);}
 function fit(){zoom=1;box={x:0,y:0,w:bounds.width,h:bounds.height};paint();}
 function scale(factor,anchor={x:.5,y:.5}){const next=Math.min(5,Math.max(.6,zoom*factor)),ratio=zoom/next;box={x:box.x+box.w*anchor.x*(1-ratio),y:box.y+box.h*anchor.y*(1-ratio),w:box.w*ratio,h:box.h*ratio};zoom=next;paint();}
 const down=e=>{if(e.button!==0||e.target.closest('[data-node]'))return;drag={x:e.clientX,y:e.clientY,box:{...box}};svg.setPointerCapture(e.pointerId);svg.classList.add('panning');};
 const move=e=>{if(!drag)return;const r=svg.getBoundingClientRect(),unit=Math.max(box.w/r.width,box.h/r.height);box.x=drag.box.x-(e.clientX-drag.x)*unit;box.y=drag.box.y-(e.clientY-drag.y)*unit;paint();};
 const up=()=>{drag=null;svg.classList.remove('panning');};
 const wheel=e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();scale(e.deltaY<0?1.12:1/1.12);};
 const key=e=>{if(e.target!==svg)return;if(['+','=','-','0','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))e.preventDefault();if(e.key==='+'||e.key==='=')scale(1.25);else if(e.key==='-')scale(.8);else if(e.key==='0')fit();else if(e.key.startsWith('Arrow')){const delta=box.w*.05;if(e.key==='ArrowLeft')box.x-=delta;if(e.key==='ArrowRight')box.x+=delta;if(e.key==='ArrowUp')box.y-=delta;if(e.key==='ArrowDown')box.y+=delta;paint();}};
 svg.addEventListener('pointerdown',down);svg.addEventListener('pointermove',move);svg.addEventListener('pointerup',up);svg.addEventListener('pointercancel',up);svg.addEventListener('wheel',wheel,{passive:false});svg.addEventListener('keydown',key);
 return {update(width,height){const wasFit=zoom===1&&box.x===0&&box.y===0;bounds={width,height};if(wasFit)fit();else paint();},fit,zoom:scale,dispose(){disposed=true;for(const [type,fn] of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['wheel',wheel],['keydown',key]])svg.removeEventListener(type,fn);}};
}
