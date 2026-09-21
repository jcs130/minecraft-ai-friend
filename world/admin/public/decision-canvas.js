const NS='http://www.w3.org/2000/svg';
const s=(tag,attrs={},value)=>{const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));if(value!==undefined)n.textContent=value;return n;};
const abbreviate=(v,n=25)=>typeof v==='string'&&v.length>n?v.slice(0,n-1)+'…':v||'';
const glyphs={observation:'◎',llm:'✳',policy:'✦',candidate:'⑂',gate:'◇',fallback:'↩',action:'⌘',feedback:'↻',reflection:'▤',experience:'▤',skill:'✧',test:'✓',issue:'◇',engineering:'⌘',validation:'◉',life:'◎'};
const labels={observation:'PERCEPTION',llm:'LLM / REASONING',policy:'POLICY / SELECTION',candidate:'CANDIDATE',gate:'CONFIDENCE',fallback:'HANDOFF',action:'TOOL CALL',feedback:'WORLD FEEDBACK',reflection:'MEMORY',experience:'EXPERIENCE',skill:'SKILL',test:'VALIDATION',issue:'PROPOSAL',engineering:'ENGINEERING',validation:'EVALUATION',life:'LIFE LOOP'};
function color(n){if(n.layer==='l1')return 'cyan';if(n.layer==='l2')return 'purple';if(n.layer==='l3')return 'amber';if(['gate','fallback'].includes(n.kind)&&['blocked','fallback'].includes(n.status))return 'amber';if(n.source==='rsi')return 'amber';if(n.kind==='observation'||n.kind==='feedback')return 'blue';if(n.source==='llm')return 'cyan';if(n.source==='decider')return 'slate';return 'purple';}
export function layoutDecisionGraph(graph,vertical=false){
 const map=new Map(),put=(n,x,y,w=185,h=104)=>map.set(n.id,{...n,x,y,w,h});let height=650;
 if(vertical){
  let y=25;
  if(graph.kind==='policy'){
   const before=graph.nodes.filter(n=>!['candidate','gate','fallback','action','feedback','reflection'].includes(n.kind));before.forEach(n=>{put(n,145,y,190,86);y+=106;});
   const candidates=graph.nodes.filter(n=>n.kind==='candidate');candidates.forEach((n,i)=>put(n,i%2?250:25,y+Math.floor(i/2)*106,205,86));if(candidates.length)y+=Math.ceil(candidates.length/2)*106;
   graph.nodes.filter(n=>!map.has(n.id)).forEach(n=>{put(n,145,y,190,86);y+=106;});
  }else graph.nodes.forEach(n=>{put(n,145,y,190,86);y+=106;});
  height=y+35;
 }else if(graph.kind==='policy'){
  const candidates=graph.nodes.filter(n=>n.kind==='candidate');
  const end=graph.nodes.filter(n=>!['observation','policy','gate'].includes(n.id)&&n.kind!=='candidate');
  const step=135,center=Math.max(195,(candidates.length-1)*step/2+125,(end.length-1)*128/2+127),start=center-(candidates.length-1)*step/2;
  graph.nodes.forEach(n=>{if(n.id==='observation')put(n,25,center-52,168,104);else if(n.id==='policy')put(n,239,center-52,174,104);else if(n.kind==='candidate'){const i=candidates.indexOf(n);put(n,470,start+i*step-50,225,104);}else if(n.id==='gate')put(n,750,center-65,174,130);});
  end.forEach((n,i)=>put(n,980,center-(end.length-1)*64-52+i*128,195,104));height=Math.max(380,...[...map.values()].map(n=>n.y+n.h+70));
 }else if(graph.kind==='rsi'){
  const rows={l1:65,l2:210,l3:355};const grouped={};graph.nodes.forEach(n=>(grouped[n.layer||'l1']??=[]).push(n));
  Object.entries(grouped).forEach(([layer,nodes])=>nodes.forEach((n,i)=>put(n,75+i*(1050/Math.max(nodes.length,1)),rows[layer]||135,235,100)));
  height=510;
 }else{
  graph.nodes.forEach((n,i)=>{const row=Math.floor(i/4),col=row%2?3-i%4:i%4;put(n,45+col*295,70+row*145,225,108);});height=Math.max(380,Math.ceil(graph.nodes.length/4)*145+100);
 }
 return {map,height,width:vertical?480:1200};
}
function pathFor(a,b,loop,vertical,width,height){
 if(loop){if(vertical)return `M ${a.x} ${a.y+a.h/2} H 10 Q 5 ${a.y+a.h/2} 5 ${a.y+a.h/2-10} V ${b.y+b.h/2+10} Q 5 ${b.y+b.h/2} 15 ${b.y+b.h/2} H ${b.x-5}`;return `M ${a.x+a.w/2} ${a.y+a.h} V ${height-46} Q ${a.x+a.w/2} ${height-26} ${a.x+a.w/2-20} ${height-26} H 16 Q 6 ${height-26} 6 ${height-46} V ${b.y+b.h/2+14} Q 6 ${b.y+b.h/2} 20 ${b.y+b.h/2} H ${b.x-5}`;}
 if(vertical){const ax=a.x+a.w/2,ay=a.y+a.h,bx=b.x+b.w/2,by=b.y-7;return `M ${ax} ${ay} C ${ax} ${(ay+by)/2} ${bx} ${(ay+by)/2} ${bx} ${by}`;}
 if(b.x>a.x){const ax=a.x+a.w,ay=a.y+a.h/2,bx=b.x-7,by=b.y+b.h/2;return `M ${ax} ${ay} C ${ax+(bx-ax)/2} ${ay} ${ax+(bx-ax)/2} ${by} ${bx} ${by}`;}
 if(b.x<a.x&&Math.abs(a.y-b.y)<20){return `M ${a.x} ${a.y+a.h/2} H ${b.x+b.w+7}`;}
 const ax=a.x+a.w/2,ay=a.y+a.h,bx=b.x+b.w/2,by=b.y-7;return `M ${ax} ${ay} C ${ax} ${(ay+by)/2} ${bx} ${(ay+by)/2} ${bx} ${by}`;
}
export function routeDecisionEdge(edge,layout,graphKind,vertical=false){
 const {map,width,height}=layout,a=map.get(edge.from),b=map.get(edge.to);if(!a||!b)return null;
 const returning=graphKind==='rsi'&&edge.to==='life'&&['test','validation'].includes(edge.from);
 const issueBranch=graphKind==='rsi'&&edge.from==='experience'&&edge.to==='issue';
 if(returning||issueBranch){
  let points,label=null;
  if(returning){
   const outer=edge.from==='validation',fromY=a.y+a.h/2,toY=b.y+b.h/2;
   if(vertical){const lane=width-(outer?30:75);points=[[a.x+a.w,fromY],[lane,fromY],[lane,toY],[b.x+b.w+7,toY]];}
   else {const lane=width-(outer?30:90),top=b.y-(outer?50:20),approach=b.x+b.w+(outer?56:32);points=[[a.x+a.w,fromY],[lane,fromY],[lane,top],[approach,top],[approach,toY],[b.x+b.w+7,toY]];label={x:width-155,y:top+16,text:edge.label||'反馈循环 · 机制示意'};}
  }else if(vertical){points=[[a.x,a.y+a.h/2],[30,a.y+a.h/2],[30,b.y+b.h/2],[b.x-7,b.y+b.h/2]];}
  else {const lane=38,nextRow=Math.min(...[...map.values()].filter(n=>n.y>a.y+a.h).map(n=>n.y)),between=(a.y+a.h+nextRow)/2;points=[[a.x+a.w/2,a.y+a.h],[a.x+a.w/2,between],[lane,between],[lane,b.y+b.h/2],[b.x-7,b.y+b.h/2]];}
  return {d:points.map(([x,y],i)=>`${i?'L':'M'} ${x} ${y}`).join(' '),loop:returning,label,points};
 }
 const loop=edge.to==='observation'&&edge.from!=='observation';
 return {d:pathFor(a,b,loop,vertical,width,height),loop,label:loop&&!vertical?{x:width/2,y:height-22,text:edge.label||'反馈循环 · 机制示意'}:null};
}
export function renderDecisionCanvas(svg,graph,{vertical=false,onSelect=()=>{}}={}){
 svg.replaceChildren();const layout=layoutDecisionGraph(graph,vertical),{map,width,height}=layout;svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.dataset.kind=graph.kind||'empty';
 const defs=s('defs');for(const tone of ['purple','cyan','amber','muted']){const m=s('marker',{id:'arrow-'+tone,viewBox:'0 0 10 10',refX:8,refY:5,markerWidth:5,markerHeight:5,orient:'auto-start-reverse'});m.append(s('path',{d:'M0 1L9 5L0 9Z',class:'arrow-'+tone}));defs.append(m);}svg.append(defs);
 if(!graph.empty&&!vertical){const head=s('g',{class:'lane-labels'});const rows=graph.kind==='rsi'?[[75,35,'L1  ·  行动闭环'],[75,180,'L2  ·  经验沉淀'],[75,325,'L3  ·  机制改进']]:graph.kind==='policy'?[[25,35,'01  感知'],[239,35,'02  策略模型'],[470,35,'03  候选分支'],[750,35,'04  检查'],[980,35,'05  去向']]:[[45,35,'L1  ·  已记录的执行顺序']];for(const [x,y,t] of rows)head.append(s('text',{x,y},t));svg.append(head);}
 const lines=s('g',{class:'graph-lines'}),edgeMap=new Map();
 graph.edges.forEach(e=>{const a=map.get(e.from),b=map.get(e.to),route=routeDecisionEdge(e,layout,graph.kind,vertical);if(!route)return;const tone=e.evidence==='mechanism'||e.disabled?'muted':e.tone==='warning'?'amber':graph.source==='llm'?'cyan':'purple';const {d,label}=route;const g=s('g',{class:`edge ${tone} ${e.evidence}${e.disabled?' disabled':''}`,'data-edge':e.id});g.append(s('path',{d,class:'edge-base','marker-end':`url(#arrow-${tone})`}));if((e.evidence==='recorded'||graph.kind==='rsi')&&!e.disabled)g.append(s('path',{d,class:'edge-signal'}));
  if(label){g.append(s('rect',{x:label.x-133,y:label.y-17,width:266,height:25,rx:12,class:'loop-label-bg'}),s('text',{x:label.x,y:label.y,'text-anchor':'middle',class:'edge-label'},label.text));}
  else if(e.disabled&&!vertical&&graph.kind==='policy'){g.append(s('text',{x:(a.x+a.w+b.x)/2,y:b.y+b.h/2-13,'text-anchor':'middle',class:'edge-label'},'未选'));}lines.append(g);edgeMap.set(e.id,g);});svg.append(lines);
 const nodeMap=new Map();graph.nodes.forEach(n=>{const p=map.get(n.id),tone=color(n),g=s('g',{class:`decision-node ${tone}${n.status==='unselected'?' unselected':''}`,'data-node':n.id,transform:`translate(${p.x} ${p.y})`,role:'button',tabindex:'0','aria-label':`${n.title} · ${n.subtitle}`,'aria-pressed':'false'});
  g.append(s('rect',{x:-5,y:-5,width:p.w+10,height:p.h+10,rx:17,class:'node-halo'}),s('rect',{width:p.w,height:p.h,rx:12,class:'node-box'}),s('rect',{x:0,y:20,width:3,height:p.h-40,rx:2,class:'node-accent'}));
  g.append(s('text',{x:15,y:24,class:'node-glyph'},glyphs[n.kind]||'◇'),s('text',{x:40,y:23,class:'node-kicker'},labels[n.kind]||String(n.layer||'RSI').toUpperCase()));
  const long=n.kind==='candidate',max=Math.min(long?12:13,Math.floor((p.w-30)/16)),title=abbreviate(n.title,Math.min(long?24:22,max*2)),chunks=title.length>max?[title.slice(0,max),title.slice(max)]:[title];chunks.forEach((t,i)=>g.append(s('text',{x:15,y:vertical?43+i*16:long?48+i*19:53+i*19,class:'node-title'},t)));
  const subtitle=n.kind==='candidate'?`${n.selected?'✓ 已选':'未选择'} · ${n.subtitle}`:n.subtitle;
  g.append(s('text',{x:15,y:p.h-14,class:'node-subtitle'},abbreviate(subtitle,Math.floor((p.w-30)/11))));
  if(n.kind==='candidate'&&typeof n.probability==='number'){g.append(s('rect',{x:15,y:p.h-5,width:p.w-30,height:2,rx:1,class:'probability-track'}),s('rect',{x:15,y:p.h-5,width:(p.w-30)*n.probability,height:2,rx:1,class:'probability-fill'}));}
  const activate=()=>onSelect(n);g.addEventListener('click',activate);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}});svg.append(g);nodeMap.set(n.id,g);
 });
 return {select(id){nodeMap.forEach((g,key)=>{g.classList.toggle('selected',key===id);g.setAttribute('aria-pressed',String(key===id));});},frame(steps,index,playing){const seen=new Set(steps.slice(0,index+1)),current=steps[index],previous=steps[index-1];nodeMap.forEach((g,key)=>{g.classList.toggle('visited',seen.has(key));g.classList.toggle('playhead',playing&&key===current);});graph.edges.forEach(e=>{const g=edgeMap.get(e.id);if(!g)return;const active=playing&&e.from===previous&&e.to===current&&(e.evidence==='recorded'||graph.kind==='rsi')&&!e.disabled;g.classList.toggle('flowing',active);g.classList.toggle('traversed',seen.has(e.from)&&seen.has(e.to)&&!e.disabled&&e.evidence==='recorded');});}};
}
