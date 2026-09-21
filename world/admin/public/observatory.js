import {buildArchitectureGraph,renderArchitectureGraph} from './embodied-architecture.js';
import {listDecisionRecords,buildDecisionGraph,buildEvolutionGraph} from './decision-model.js';
import {renderDecisionCanvas} from './decision-canvas.js';
const $=id=>document.getElementById(id),el=(tag,cls='',value)=>{const n=document.createElement(tag);n.className=cls;if(value!==undefined)n.textContent=value;return n;};
const finite=v=>typeof v==='number'&&Number.isFinite(v),when=v=>v!==null&&v!==undefined&&Number.isFinite(new Date(v).getTime())?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(v)):'未记录';
const duration=v=>!finite(v)?'未记录':v<1000?Math.round(v)+' ms':(v/1000).toFixed(2)+' s';
const source=v=>({llm:'LLM',jev:'Jev',decider:'Decider · 历史',policy_unknown:'来源待确认',rsi:'RSI / 机制'})[v]||'来源未知';
const percent=v=>finite(v)?Math.round(v*100)+'%':'未记录';
const params=new URLSearchParams(location.search),reduced=matchMedia('(prefers-reduced-motion: reduce)');
let trace=null,rsi=null,records=[],view=params.get('view')==='llm'?'llm':params.get('view')==='rsi'?'rsi':'policy',selectedId=null,selectedNode=null,graph=null,canvas=null,renderKey='',paused=false,loading=false,failed=false,rsiFailed=false,generation=0,lastRead=null,sidebar=params.get('layout')==='sidebar',firstLoad=true;
let playing=false,playIndex=-1,timer=null,speed=1,steps=[],loop=false,historyKey='';
const remember={policy:null,llm:null};
let architectureLayer=['l2','l3'].includes(params.get('layer'))?params.get('layer'):'online',architectureKey='',architectureNode=null,architectureMotion=!reduced.matches;
function renderArchitecture(){
 const next=buildArchitectureGraph(architectureLayer,trace,rsi),key=JSON.stringify(next);if(key===architectureKey)return;architectureKey=key;
 const focused=document.activeElement?.getAttribute('data-architecture-node');
 renderArchitectureGraph($('architecture-canvas'),next,n=>{architectureNode=n;$('architecture-node-title').textContent=n.title;$('architecture-node-copy').textContent=n.detail;$('architecture-evidence').hidden=!n.record;});
 $('architecture-caption').textContent=next.caption;document.querySelectorAll('[data-layer]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.layer===architectureLayer)));
 if(architectureNode){const current=next.nodes.find(n=>n.id===architectureNode.id);if(current){architectureNode=current;$('architecture-node-copy').textContent=current.detail;[...$('architecture-canvas').querySelectorAll('[data-architecture-node]')].find(n=>n.getAttribute('data-architecture-node')===current.id)?.setAttribute('aria-pressed','true');}}
 if(focused)[...$('architecture-canvas').querySelectorAll('[data-architecture-node]')].find(n=>n.getAttribute('data-architecture-node')===focused)?.focus();
}
function architectureState(){document.body.classList.toggle('architecture-animated',architectureMotion&&!paused&&!document.hidden&&!reduced.matches);$('architecture-motion').setAttribute('aria-pressed',String(architectureMotion));$('architecture-motion').textContent=architectureMotion?'◉ 流动':'○ 静止';}
document.querySelectorAll('[data-layer]').forEach(b=>b.addEventListener('click',()=>{architectureLayer=b.dataset.layer;architectureNode=null;$('architecture-node-title').textContent=architectureLayer==='online'?'单轮 DAG × 跨轮反馈':architectureLayer==='l2'?'经验改变行为':'验证通过，才完成进化';$('architecture-node-copy').textContent='点选任意节点查看职责与证据。虚线与流光均为机制示意。';$('architecture-evidence').hidden=true;renderArchitecture();const url=new URL(location.href);url.searchParams.set('layer',architectureLayer);history.replaceState(null,'',url);}));
$('architecture-evidence').hidden=true;
$('architecture-evidence').addEventListener('click',()=>{if(architectureNode)openEvidence(architectureNode);});
$('architecture-motion').addEventListener('click',()=>{architectureMotion=!architectureMotion;architectureState();});

function details(root,title,value){const d=el('details');d.append(el('summary','',title),el('pre','',typeof value==='string'?value:JSON.stringify(value,null,2)));root.append(d);return d;}
function fact(root,title,value){const d=el('div','detail-fact');d.append(el('span','',title),el('strong','',value??'未记录'));root.append(d);}
function status(){const stale=failed||trace?.stale;$('connection').textContent=paused?'更新已暂停':failed?'连接中断':stale?'历史快照':trace?.available?'● 实时连接':'等待记录';$('connection').className='connection'+(!paused&&!stale&&trace?.available?' live':'');$('clock').textContent=when(Date.now());$('freshness').textContent=`快照 ${when(trace?.generatedAt)} · 读取 ${when(lastRead)}${rsiFailed?' · RSI 读取失败':''}`;}
function camera(mode){const on=mode==='third'&&!sidebar;$('world-frame').hidden=!on;$('world-placeholder').hidden=on;if(on)$('world-frame').src='http://127.0.0.1:19092/third/';else $('world-frame').removeAttribute('src');document.querySelectorAll('[data-camera]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.camera===(on?'third':'off'))));}
function filtered(){return records.filter(r=>r.kind===view);}
function chooseDefault(){const list=filtered();return (view==='llm'?list.find(r=>r.record.actions?.length):null)?.id||list[0]?.id||null;}
function setView(next){stop();view=next;selectedId=remember[view]||chooseDefault();if(!filtered().some(r=>r.id===selectedId))selectedId=chooseDefault();renderKey='';selectedNode=null;render();const url=new URL(location.href);url.searchParams.set('view',view);history.replaceState(null,'',url);}
function selectRecord(id){stop();selectedId=id;remember[view]=id;selectedNode=null;renderKey='';render();}
function renderHistory(){const list=filtered(),root=$('history-list'),signature=JSON.stringify([view,selectedId,list.map(r=>[r.id,r.at,r.label,r.record.status,r.record.outcome,r.record.actions?.length])]);if(signature===historyKey)return;historyKey=signature;const focused=root.contains(document.activeElement)?document.activeElement.dataset.record:null;root.replaceChildren();$('history-list').closest('.history-panel').hidden=view==='rsi';
 list.slice(0,10).forEach(r=>{const b=el('button','history-item');b.dataset.record=r.id;b.setAttribute('aria-pressed',String(r.id===selectedId));const top=el('span');top.append(el('span','',source(r.source)),el('span','',when(r.at).slice(-8)));b.append(top,el('strong','',r.kind==='policy'?(r.record.choice||'选择未记录'):(r.record.actions?.length?`${r.record.actions.length} 次工具调用`:'观察与复盘')),el('small','',r.kind==='policy'?(r.record.outcome==='fallback'?'低置信 / 交回慢系统':r.record.outcome==='dispatch_recorded'?'已记录工具派发':'仅选择记录'):(r.record.status==='active'?'轮次进行中':'已保存轮次')));b.addEventListener('click',()=>selectRecord(r.id));root.append(b);});
 if(focused)[...root.children].find(n=>n.dataset.record===focused)?.focus();if(!list.length)root.append(el('p','muted','暂无保留记录'));
 const pick=$('record-select'),old=pick.value;pick.replaceChildren(...list.map(r=>{const o=el('option','',`${when(r.at)} · ${r.label}`);o.value=r.id;return o;}));pick.value=selectedId||old;pick.disabled=!list.length;pick.closest('label').hidden=view==='rsi';
}
function render(){
 status();renderArchitecture();architectureState();document.body.classList.toggle('view-rsi',view==='rsi');records=listDecisionRecords(trace);if(!selectedId&&view!=='rsi')selectedId=chooseDefault();
 document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
 $('hp').textContent=trace?.agent?.hp??'—';$('hunger').textContent=trace?.agent?.hunger??'—';$('mission').textContent=trace?.agent?.goal||'尚无当前目标';
 const count=(trace?.turns||[]).reduce((n,t)=>n+t.actions.length,0);$('action-count').textContent=`${count} 条采样回执`;$('skill-count').textContent=rsi?.sources?.learning?`${rsi.l2.localSkills.filter(s=>s.enabled).length} 个启用技能`:'索引未读取';$('case-count').textContent=rsi?.l3?.cases?.available?`${rsi.l3.cases.items.filter(c=>!['resolved','rejected'].includes(c.status)).length} 条未结提案`:'工单未读取';
 renderHistory();const next=view==='rsi'?buildEvolutionGraph(rsi):buildDecisionGraph(trace,selectedId),key=JSON.stringify([next,sidebar]);if(key===renderKey)return;
 if(playing&&graph?.id===next.id)return;stop();graph=next;renderKey=key;
 $('graph-title').textContent=graph.title;$('graph-subtitle').textContent=view==='llm'?'已记录的执行顺序 · 点击动作查看结果':view==='rsi'?'在线回路、经验进化、框架进化；收益需独立验收':graph.subtitle;
 $('graph-kicker').textContent=({policy:'BRANCHES / DECISION ROUTING',llm:'LOOP / OBSERVE · ACT · REFLECT',rsi:'EVOLUTION / THREE LEVELS'})[view];
 $('graph-mode').textContent=view==='rsi'?'机制示意 · 非执行记录':'历史记录 · '+when(graph.at).slice(0,11);
 $('record-time').textContent=when(graph.at);$('graph-empty').hidden=!graph.empty;$('coverage').textContent=view==='rsi'?'机制示意 · 改进收益待独立验收':'实线为保留记录 · 虚线为机制，未证明循环已发生';
 const focusedNode=document.activeElement?.getAttribute('data-node');canvas=renderDecisionCanvas($('decision-canvas'),graph,{vertical:sidebar,onSelect:n=>{stop();showNode(n);}});
 if(focusedNode)[...$('decision-canvas').querySelectorAll('[data-node]')].find(n=>n.getAttribute('data-node')===focusedNode)?.focus();
 steps=view==='rsi'?['life','experience','knowledge','skill','test','life','experience','issue','engineering','validation','life'].filter(id=>graph.nodes.some(n=>n.id===id)):graph.steps;
 playIndex=-1;$('playback-progress').max=Math.max(steps.length,1);$('playback-progress').value=0;$('play').disabled=!steps.length;$('step').disabled=!steps.length;
 $('playback-note').textContent=loop?'同一记录循环回放 · 非新的执行':view==='rsi'?'机制演示，不代表已发生的进化':'动画节奏不代表实际耗时';
 const initial=graph.nodes.find(n=>n.id===selectedNode)||graph.nodes.find(n=>n.kind==='gate')||graph.nodes.find(n=>n.kind==='llm')||graph.nodes[0];if(initial)showNode(initial);else{$('node-detail').replaceChildren(el('p','muted',graph.notice));$('node-source').textContent='NO RECORD';}
 playbackUI();
}
function showNode(n){selectedNode=n.id;canvas?.select(n.id);$('node-source').textContent=source(n.source);const root=$('node-detail');root.replaceChildren(el('h3','',n.title),el('p','node-caption',n.subtitle));
 if(['fallback','blocked','unknown','unselected'].includes(n.status))root.append(el('span','detail-status warn',({fallback:'未派发动作',blocked:'置信度不足',unknown:'记录不完整',unselected:'未选候选'})[n.status]));else root.append(el('span','detail-status',n.kind==='candidate'?'模型已选 · 尚非执行':'已保存记录'));
 root.append(el('p','',n.detail));const r=n.record||{};
 if(n.kind==='policy'){fact(root,'模型',r.model);fact(root,'服务请求',duration(r.latencyMs));fact(root,'控制器接收',duration(r.handoffMs));}
 if(n.kind==='gate'){fact(root,'决策置信度',percent(r.confidence));fact(root,'已选候选概率',percent(r.selectedProbability));fact(root,'处理结果',r.code);}
 if(n.kind==='candidate'){fact(root,'候选概率',percent(n.probability));fact(root,'去向',r.action?.tool||'慢系统');if(r.action?.args)details(root,'候选参数',r.action.args);}
 if(n.kind==='action'){fact(root,'状态',r.status||n.status);fact(root,'实际记录耗时',duration(r.durationMs));fact(root,'受理时间',when(r.startedAt));if(r.args)details(root,'调用参数',r.args);if(r.inventoryDelta)details(root,'世界变化',{inventoryDelta:r.inventoryDelta,hpDelta:r.hpDelta,hungerDelta:r.hungerDelta});}
 const b=el('button','evidence-link','展开完整节点证据 ↗');b.addEventListener('click',()=>openEvidence(n));root.append(b);
}
function openEvidence(n){const root=$('inspector-content');root.replaceChildren(el('p','',n.detail));$('inspector-title').textContent=n.title;details(root,'已记录证据',n.record||{}).open=true;if(n===architectureNode)root.append(el('p','','架构连线是机制示意，节点证据来自当前公开快照，不能与下方所选历史轮次自动关联。'));else if(graph?.notice)root.append(el('p','',graph.notice));$('inspector').showModal();}
function inspectLayer(layer){const root=$('inspector-content');root.replaceChildren();$('inspector-title').textContent=({l1:'L1 · 行动与反馈',l2:'L2 · 经验与技能',l3:'L3 · 机制与工程',coverage:'数据范围与动画说明'})[layer];
 if(layer==='l1'){root.append(el('p','','按记录顺序展示采样轮次与游戏动作，不还原未保存的内部推理。'));(trace?.turns||[]).slice(0,8).forEach(t=>details(root,`${when(t.startedAt)} · ${t.actions.length} 次游戏调用`,t));}
 if(layer==='l2'){root.append(el('p','','知识文件、技能启用与行为验证分别记录。数量不代表能力提升。'));details(root,'知识索引',rsi?.l2?.knowledge||[]);(rsi?.l2?.localSkills||[]).forEach(s=>details(root,`${s.enabled?'已启用':'已停用'} · ${s.name}`,s));details(root,'共享技能',rsi?.l2?.sharedSkills||[]);}
 if(layer==='l3'){root.append(el('p','',rsi?.l3?.notice||'没有完整的跨任务收益验收。'));details(root,'工程基线',{baseCommit:rsi?.l3?.baseCommit,plans:rsi?.l3?.plans});(rsi?.l3?.cases?.items||[]).forEach(c=>details(root,`${c.status} · ${c.title}`,c));details(root,'最近工程回执',rsi?.l3?.receipts||[]);}
 if(layer==='coverage'){root.append(el('p','','实线表示已保存的记录或执行顺序；虚线表示机制关系，不能据此认定某次循环已发生。Jev 回退后没有绑定具体 LLM 轮次。'),el('p','','动画只回放已记录节点，节奏不等于实际执行时间。RSI 标签下仅演示机制。开启系统“减少动态效果”会关闭流光和脉冲。'),el('p','','每 5 秒读取已有数据，不触发模型或游戏动作。历史 LLM 至多 20 轮；策略至多 12 次。画布至多显示 6 个候选、6 条最近动作，保留选中候选；全部保留数据可在完整轨迹查阅。'));details(root,'当前图覆盖',graph?.notice);details(root,'数据源状态',trace?.coverage);}
 const link=el('a','','打开完整执行轨迹 ↗');link.href='/#trace';root.append(link);$('inspector').showModal();
}
function playbackUI(){const n=graph?.nodes.find(n=>n.id===steps[playIndex]);$('play').textContent=playing?'Ⅱ':'▶';$('play').setAttribute('aria-label',playing?'暂停记录动画':'播放记录动画');$('playback-status').textContent=playing?`${view==='rsi'?'机制演示':'记录回放'} · ${n?.title||'开始'}`:playIndex>=steps.length-1&&steps.length?'回放结束':playIndex>=0?`停在 · ${n?.title||'当前节点'}`:view==='rsi'?'播放进化机制示意':'回放已记录的路径';$('playback-progress').value=Math.max(0,playIndex+1);canvas?.frame(steps,playIndex,playing);}
function stop(){clearTimeout(timer);timer=null;playing=false;playbackUI();}
function advance(){if(!steps.length)return;playIndex=(playIndex+1)%steps.length;const n=graph.nodes.find(n=>n.id===steps[playIndex]);if(n)showNode(n);playbackUI();}
function schedule(){clearTimeout(timer);timer=setTimeout(()=>{if(!playing)return;if(document.hidden){stop();return;}if(playIndex>=steps.length-1){if(loop)playIndex=-1;else{stop();return;}}advance();schedule();},1500/speed);}
function play(){if(playing){stop();return;}if(!steps.length)return;playing=true;if(playIndex>=steps.length-1)playIndex=-1;advance();schedule();}
async function get(url){const c=new AbortController(),timeout=setTimeout(()=>c.abort(),9000);try{const response=await fetch(url,{cache:'no-store',signal:c.signal});if(!response.ok)throw Error('unavailable');const v=await response.json();if(v.schema!==1)throw Error('schema');return v;}finally{clearTimeout(timeout);}}
async function refresh(){if(loading||paused||document.hidden)return;loading=true;const batch=generation;try{const [t,r]=await Promise.allSettled([get('/api/survivor-trace'),get('/api/rsi-observatory')]);if(paused||document.hidden||batch!==generation)return;failed=t.status==='rejected';rsiFailed=r.status==='rejected';if(!failed){trace=t.value;lastRead=Date.now();}if(!rsiFailed)rsi=r.value;render();if(firstLoad&&graph?.nodes.length){firstLoad=false;if(!reduced.matches)play();}}finally{loading=false;}}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
document.querySelectorAll('[data-inspect]').forEach(b=>b.addEventListener('click',()=>inspectLayer(b.dataset.inspect)));
document.querySelectorAll('[data-camera]').forEach(b=>b.addEventListener('click',()=>camera(b.dataset.camera)));
$('open-camera').addEventListener('click',()=>camera('third'));$('record-select').addEventListener('change',e=>selectRecord(e.target.value));$('latest').addEventListener('click',()=>{const id=filtered()[0]?.id;if(id)selectRecord(id);});
$('play').addEventListener('click',play);$('loop').addEventListener('click',()=>{loop=!loop;$('loop').setAttribute('aria-pressed',String(loop));$('playback-note').textContent=loop?'同一记录循环回放 · 非新的执行':view==='rsi'?'机制演示，不代表已发生的进化':'动画节奏不代表实际耗时';});$('step').addEventListener('click',()=>{stop();advance();});$('speed').addEventListener('click',()=>{speed=speed===1?2:speed===2?.5:1;$('speed').textContent=speed+'×';if(playing)schedule();});
$('pause').addEventListener('click',()=>{paused=!paused;generation++;if(paused)stop();architectureState();$('pause').textContent=paused?'恢复更新':'暂停更新';$('pause').setAttribute('aria-pressed',String(paused));status();if(!paused)refresh();});
$('mode').addEventListener('click',()=>{stop();sidebar=!sidebar;applyLayout();renderKey='';render();});
function applyLayout(){document.body.classList.toggle('mode-sidebar',sidebar);$('mode').textContent=sidebar?'完整画布':'OBS 侧栏';const url=new URL(location.href);if(sidebar){url.searchParams.set('layout','sidebar');camera('off');}else url.searchParams.delete('layout');history.replaceState(null,'',url);}
$('coverage-button').addEventListener('click',()=>inspectLayer('coverage'));$('close-inspector').addEventListener('click',()=>$('inspector').close());
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){generation++;stop();}else refresh();architectureState();});reduced.addEventListener('change',()=>{if(reduced.matches){stop();architectureMotion=false;}architectureState();});
applyLayout();camera(params.get('camera')==='off'?'off':'third');renderArchitecture();architectureState();refresh();setInterval(refresh,5000);setInterval(status,1000);
