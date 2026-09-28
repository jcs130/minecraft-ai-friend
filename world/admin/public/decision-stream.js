import {buildDecisionStreamGraph,streamRuntimeLabel} from './decision-stream-model.js';
import {renderDecisionCanvas} from './decision-canvas.js';
import {attachGraphNavigation} from './unified-decision.js';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),reduced=matchMedia('(prefers-reduced-motion: reduce)');
document.documentElement.classList.toggle('transparent',params.get('background')==='transparent');
document.body.classList.toggle('controls-visible',params.get('controls')==='1');
const navigation=attachGraphNavigation($('stream-dag'));
let trace=null,graph=null,canvas=null,signature='',loading=false,paused=false,failed=false,generation=0,timer=null,index=-1,selected=null;
const format=v=>v?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(v)):'时间未记录';
function status(){
 const stale=failed||trace?.stale||!trace?.available,current=trace?.modelResults?.current;
 const interrupted=trace?.runtime?.enabled===false||Boolean(trace?.runtime?.pauseReason)||(current&&current.availability!=='available');
 document.body.classList.toggle('updates-paused',paused||stale||document.hidden);
 $('stream-status').classList.toggle('warn',Boolean(stale||paused||interrupted));
 $('stream-status').textContent=paused?'更新已暂停':failed?'读取失败 · 保留快照':!trace?.available?'暂无决策数据':trace.stale?'来源快照过期':'● '+streamRuntimeLabel(trace);
 $('stream-time').textContent='每 5 秒更新 · 快照 '+format(trace?.generatedAt);
}
const pct=v=>typeof v==='number'?(v*100).toFixed(0)+'%':'未记录';
function results(){
 const jev=trace?.policyDecisions?.find(p=>p.source==='jev');
 $('jev-result-time').textContent=jev?format(jev.at):'无记录';
 $('jev-result').textContent=jev?`${jev.choice||'未选择'} · 概率 ${pct(jev.selectedProbability)} · 置信度 ${pct(jev.confidence)}\n${jev.outcome==='fallback'?'回退：'+({low_confidence:'置信度不足',selected_handoff:'选择交回慢系统'}[jev.reason]||jev.reason||jev.code):jev.outcome==='dispatch_recorded'?'已关联工具派发':'仅保留选择，未关联派发'}`:'暂无真实 Jev 记录';
 $('jev-result-meta').textContent=jev?`${jev.model||'模型未记录'} · ${jev.skill||'技能未记录'} · ${typeof jev.latencyMs==='number'?jev.latencyMs.toFixed(0)+' ms':'耗时未记录'} · 历史结果，非当前调用`:'';
 const current=trace?.modelResults?.current,result=current?.finalText?current:trace?.modelResults?.last;
 const turn=trace?.turns?.find(t=>t.turnId===result?.turnId);
 $('llm-result-title').textContent=result===current&&result?'LLM 本轮结果':'LLM 上一轮结果';
 $('llm-result-time').textContent=result?format(result.completedAt||turn?.finishedAt):'无记录';
 $('llm-result').textContent=result?.finalText||(!result?'暂无已结束轮次':result.availability!=='available'?'原生结果暂不可读 · 自动重试':result.status==='failed'?'本轮任务失败，未取得最终回复':'本轮没有可展示的最终回复');
 $('llm-result-meta').textContent=result?[result.taskId,typeof turn?.durationMs==='number'?(turn.durationMs/1000).toFixed(1)+' s / 整轮':null,result.tools?.length?'调用 '+result.tools.map(t=>t.name.replace(/^numen_survival__/, '')).join(' → '):null,'模型自述 · 游戏结果以回执为准'].filter(Boolean).join(' · '):'';
}
function stop(){clearTimeout(timer);timer=null;index=-1;canvas?.frame([], -1,false);$('stream-replay').textContent='回放记录';$('stream-note').textContent='实线：已记录路径 · 虚线：机制，非执行关联';}
function select(n){selected=n.id;canvas?.select(n.id);$('stream-node-title').textContent=n.title;$('stream-node-summary').textContent=n.detail;$('stream-node-evidence').textContent=JSON.stringify(n.record||{},null,2);$('stream-detail').hidden=false;}
function render(){status();results();const next=buildDecisionStreamGraph(failed?{...trace,stale:true}:trace),key=JSON.stringify({...next,at:null},(k,v)=>k==='checkedAt'?undefined:v);
 $('stream-empty').hidden=!!trace?.available;$('stream-empty').textContent=failed?'暂时无法读取记录，自动重连中':'暂无保留的决策记录';
 if(key===signature)return;stop();signature=key;graph=next;const focused=document.activeElement?.getAttribute('data-node');canvas=renderDecisionCanvas($('stream-dag'),graph,{onSelect:n=>{stop();select(n);}});navigation.update(graph.width,graph.height);
 for(const lane of graph.lanes)if(lane.empty)$('stream-dag').querySelector(`[data-lane="${lane.id}"] .unified-lane-time`).textContent='暂无该系统保留记录';
 $('stream-replay').disabled=!graph.steps.length;
 if(selected){const n=graph.nodes.find(n=>n.id===selected);if(n)select(n);else{$('stream-detail').hidden=true;selected=null;}}
 if(focused)[...$('stream-dag').querySelectorAll('[data-node]')].find(n=>n.getAttribute('data-node')===focused)?.focus();
}
function replay(){if(timer){stop();return;}if(!graph?.steps.length)return;
 const step=()=>{if(document.hidden||index+1>=graph.steps.length){stop();return;}index++;canvas.frame(graph.steps,index,true);$('stream-note').textContent='历史回放 · 分区时间不同，动画不表示当前调用或实际耗时';$('stream-replay').textContent='停止回放';timer=setTimeout(step,1400);};step();
}
async function refresh(){if(loading||paused||document.hidden)return;loading=true;const batch=generation,abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),9000);
 try{const response=await fetch('/api/survivor-trace',{cache:'no-store',signal:abort.signal});if(!response.ok)throw Error('unavailable');const value=await response.json();if(value.schema!==1||!Array.isArray(value.turns))throw Error('schema');if(batch!==generation||paused||document.hidden)return;trace=value;failed=false;render();}
 catch{if(batch===generation&&!paused&&!document.hidden){failed=true;stop();render();}}finally{clearTimeout(timeout);loading=false;}
}
$('stream-plus').addEventListener('click',()=>navigation.zoom(1.25));$('stream-minus').addEventListener('click',()=>navigation.zoom(.8));$('stream-fit').addEventListener('click',()=>navigation.fit());$('stream-replay').addEventListener('click',replay);
$('stream-pause').addEventListener('click',()=>{paused=!paused;generation++;if(paused)stop();$('stream-pause').textContent=paused?'恢复更新':'暂停更新';$('stream-pause').setAttribute('aria-pressed',String(paused));status();if(!paused)refresh();});
$('stream-close').addEventListener('click',()=>{selected=null;$('stream-detail').hidden=true;canvas?.select(null);});document.addEventListener('keydown',e=>{if(e.key==='Escape')$('stream-close').click();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){generation++;stop();}else refresh();status();});reduced.addEventListener('change',()=>{if(reduced.matches)stop();});refresh();setInterval(refresh,5000);
