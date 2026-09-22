/* Read-only observatory. All untrusted records are rendered as text. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const el=(tag,cls,value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=value;return n;};
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const time=v=>v!==null && v!==undefined && Number.isFinite(new Date(v).getTime())?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(v)):'未记录';
  const ms=v=>!finite(v)?'未记录':v<1000?`${Math.round(v)} ms`:v<60000?`${(v/1000).toFixed(2)} 秒`:`${Math.floor(v/60000)} 分 ${Math.round(v%60000/1000)} 秒`;
  const labels={active:'进行中',completed:'轮次完成',failed:'失败',unknown:'结果未知',accepted:'已受理',in_flight:'执行中',pending:'等待执行',rejected:'已拒绝',observed_ended:'观察到结束'};
  const tones={completed:'good',failed:'bad',rejected:'bad',active:'warn',in_flight:'warn',unknown:'neutral'};
  const source=v=>({llm:'LLM',jev:'Jev',decider:'Decider（历史）'})[v]||'来源未知';
  const tools={goto:'移动',eat:'进食',equip_item:'装备',interact_at:'方块交互',craft:'合成',attack:'攻击',mine:'采矿',place:'放置',drop_items:'丢出物品'};
  let data=null,selected=null,paused=false,busy=false,error=false,lastRead=null,renderKey=null;
  const badge=(s,label)=>el('span','badge '+(tones[s]||'neutral'),label||labels[s]||s);
  function fact(k,v){const n=el('div','trace-fact');n.append(el('span','',k),el('strong','',v??'未记录'));return n;}
  function card(title,kicker){const c=el('article','card trace-stage');if(kicker)c.append(el('p','eyebrow',kicker));c.append(el('h3','',title));return c;}
  function detail(title,value){const d=el('details','trace-json');d.append(el('summary','',title),el('pre','',JSON.stringify(value,null,2)));return d;}
  function metric(title,value,caption){const c=el('div','trace-metric');c.append(el('p','',title),el('strong','',value),el('small','',caption));return c;}
  function bodyText(v){return v?`生命 ${v.hp??'未知'} / 20 · 饥饿 ${v.hunger??'未知'} / 20`:'本轮输入快照未保留';}
  function showStatus(){
    $('trace-live').className='badge '+(error?'bad':paused||data?.stale?'warn':'good');
    $('trace-live').textContent=error?'连接中断 · 保留历史':paused?'刷新已暂停':data?.stale?'状态快照已过期':data?.available?'已连接真实记录':'暂无数据';
    $('trace-updated').textContent=`读取于 ${time(lastRead)} · 状态采样 ${time(data?.generatedAt)} · ${paused?'暂停期间内容保持不变':'每 15 秒刷新'}`;
  }
  function draw(){
    if(!data)return;
    showStatus();
    $('trace-goal').textContent=data.agent?.goal||'尚无当前目标';
    const turns=data.turns||[],allActions=turns.flatMap(t=>t.actions);
    $('trace-metrics').replaceChildren(metric('采样轮次',String(turns.length),'最近保留的至多 20 轮'),metric('游戏工具调用',String(allActions.length),'仅已关联动作回执'),metric('待核对动作',String(allActions.filter(a=>['unknown','observed_ended'].includes(a.status)).length),'未知结果单独保留'),metric('最新轮次耗时',ms(turns[0]?.durationMs),'包含推理、等待与执行'));
    const query=$('trace-search').value.trim().toLowerCase(),filter=$('trace-filter').value;
    const visible=turns.filter(t=>(filter==='all'||t.status===filter)&&(!query||JSON.stringify([t.turnId,t.summary?.goal,t.actions.map(a=>a.tool)]).toLowerCase().includes(query)));
    if(!visible.some(t=>t.turnId===selected))selected=visible[0]?.turnId||null;
    $('trace-count').textContent=String(visible.length);
    $('trace-turns').replaceChildren(...visible.map(t=>{
      const b=el('button','trace-turn'+(selected===t.turnId?' selected':''));b.type='button';b.setAttribute('aria-pressed',String(selected===t.turnId));
      const top=el('div','trace-turn-top');top.append(el('span','',time(t.startedAt)),badge(t.status));
      b.append(top,el('strong','',t.summary?.goal||t.input.mission||'自主生存轮次'),el('small','',`${t.actions.length} 次游戏调用 · ${ms(t.durationMs)}`),el('code','',t.turnId.slice(-12)));
      b.addEventListener('click',()=>{selected=t.turnId;draw();});return b;
    }));
    if(!visible.length)$('trace-turns').append(el('p','empty','没有匹配的轮次'));
    const turn=turns.find(t=>t.turnId===selected),key=JSON.stringify(turn);
    // Keep expanded evidence and focus stable during unrelated polling updates.
    if(key!==renderKey){renderKey=key;drawDetail(turn);}
    const policy=data.systemOne;
    $('trace-policy').replaceChildren(...(policy?[fact('模型',policy.model),fact('选择',policy.choice),fact('置信度',finite(policy.confidence)?`${(policy.confidence*100).toFixed(1)}%`:'未记录'),fact('服务请求耗时',ms(policy.latencyMs)),fact('控制器接收耗时',ms(policy.handoffMs)),fact('记录时间',time(policy.observedAt)),fact('结果',policy.code)]:[el('p','footnote','尚无快系统选择记录。')]));
    const branchLink=el('a','','查看 LLM / Jev 候选分支、概率与回退 ↗');branchLink.href='/observatory?inspect=decision';$('trace-policy').append(branchLink);
    $('trace-coverage').textContent='记录范围：最近保留的 20 个桐人轮次、每轮至多 40 条游戏动作。决策摘要来自 Agent 保存的目标与复盘，不是完整内部思维链。未记录完整模型输入、逐 Token 推理、全部模型工具或单次模型计费。动作耗时为受理到结束观察的间隔；资源变化不等于任务成功。'+(data.coverage?.unavailable?.length?' 部分数据源不可用：'+data.coverage.unavailable.join('、'):'');
  }
  function drawDetail(t){
    const root=$('trace-detail');root.replaceChildren();
    if(!t){root.append(el('div','card empty','没有可展示的轨迹。新记录就绪后会显示在这里。'));return;}
    const header=card('一次自主生存轮次','TRACE / '+t.turnId.slice(-12)),head=el('div','trace-heading');
    head.append(badge(t.status),badge('neutral',source(t.decisionSource)),el('span','',`${time(t.startedAt)} → ${time(t.finishedAt)}`));header.append(head);
    const facts=el('div','trace-facts');facts.append(fact('总耗时',ms(t.durationMs)),fact('模型任务',t.taskId),fact('关联游戏调用',String(t.actions.length)));header.append(facts);
    if(t.failureReason)header.append(el('p','error-text',t.failureReason));
    const flow=el('ol','trace-flow');['输入 / 感知','目标 / 摘要','工具 / 执行','输出 / 反馈'].forEach((s,i)=>{const n=el('li','');n.append(el('span','',String(i+1).padStart(2,'0')),el('strong','',s));flow.append(n);});header.append(flow);root.append(header);
    const overview=el('div','trace-overview');
    const input=card('他接收到了什么','01 / INPUT');input.append(el('p','trace-prose',t.input.mission||'历史完整输入未保存；下方工具卡可查看动作前的身体观察。'),el('p','trace-vitals',bodyText(t.input.body)));
    input.append(fact('输入大小',finite(t.input.bytes)?`${t.input.bytes.toLocaleString()} bytes`:'未记录'),fact('触发事件数',t.input.eventCount),fact('任务用途',t.input.purpose));
    if(t.input.body)input.append(detail('展开输入身体快照',t.input.body));
    const summary=card('他留下的决策摘要','02 / DECISION SUMMARY');
    if(t.summary){summary.append(el('h4','','本轮目标'),el('p','trace-prose',t.summary.goal||'未记录'),el('h4','','观察与复盘'),el('p','trace-prose',t.summary.lesson||'未记录'),el('p','footnote',`Agent 自述 · ${time(t.summary.at)} · 需结合工具回执判断`));}
    else summary.append(el('p','trace-prose','本轮尚未保存决策摘要。'));
    overview.append(input,summary);root.append(overview);
    const calls=card('工具调用与执行时间线','03 / TOOLS & TIMING');calls.append(el('p','footnote','按受理时间排列；展开每一步，查看参数与动作前后观察。'));
    if(!t.actions.length)calls.append(el('div','empty','本轮暂无已关联游戏动作。它可能仍在观察、查阅资料或等待；这里不推断其内部过程。'));
    const max=Math.max(1,...t.actions.map(a=>a.durationMs||0));
    t.actions.forEach((a,i)=>{
      const step=el('details','trace-call');const top=el('summary','trace-call-heading');
      const name=el('div','trace-call-name');name.append(el('strong','',`${source(a.decisionSource)} → ${tools[a.tool]||a.tool||'未知工具'}`),el('code','',a.tool||'unknown'));
      const stateLabel=a.status==='completed'?(a.completionConfirmed?'执行结束':'待确认结束'):labels[a.status]||'结果未知';
      top.append(el('span','trace-step-number',String(i+1).padStart(2,'0')),name,badge(a.status,stateLabel),el('strong','trace-duration',ms(a.durationMs)));
      step.append(top);
      const progress=el('progress','trace-timebar');progress.max=max;progress.value=a.durationMs||0;progress.setAttribute('aria-label',`${a.tool} 耗时 ${ms(a.durationMs)}`);step.append(progress);
      step.append(el('p','footnote',`受理 ${time(a.startedAt)} · 结束观察 ${time(a.observedAt)} · ${a.nativeTaskId?'原生任务 '+a.nativeTaskId:'未记录原生任务号'}`));
      const panels=el('div','trace-call-panels');
      const args=el('div','');args.append(el('h4','','调用参数'),el('pre','',JSON.stringify(a.args,null,2)));if(a.argumentsOmitted)args.append(el('p','footnote','部分非公开参数未展示。'));
      const result=el('div','');result.append(el('h4','','回执与世界反馈'),fact('回执状态',a.status),fact('结束已确认',a.completionConfirmed?'是':'否'),fact('生命变化',finite(a.hpDelta)?a.hpDelta.toFixed(2):'未记录'),fact('饥饿变化',a.hungerDelta));
      const changes=Object.entries(a.inventoryDelta||{});result.append(el('p','trace-prose',a.inventoryDelta===null?'无可比较的物品观察':changes.length?changes.map(([k,v])=>`${k} ${v>0?'+':''}${v}`).join('\n'):'背包物品数量未变化'));
      if(a.navigation)result.append(fact('导航到达',a.navigation.success===true?'已观察到':a.navigation.success===false?'未到达':'未知'));
      panels.append(args,result);step.append(panels,detail('查看动作前后身体观察',{before:a.before,after:a.after}),el('p','footnote',`actionId: ${a.actionId||'未记录'} · 受理回执码: ${a.code||'未记录'}`));calls.append(step);
    });root.append(calls);
    const output=card('本轮输出与下一步','04 / OUTCOME');output.append(el('p','trace-prose',t.summary?.nextFocus||'未保存下一步计划。'),el('p','footnote','“轮次完成”表示模型任务已结束。具体目标是否达成，需要结合世界回执；上面的计划是 Agent 的陈述。'));
    output.append(detail('展开本轮事件记录',t.events));root.append(output);
  }
  async function refresh(force=false){
    if(busy||(!force&&(paused||document.hidden||location.hash!=='#trace')))return;
    busy=true;$('trace-refresh').disabled=true;
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
    try{const response=await fetch('/api/survivor-trace',{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('request');const value=await response.json();if(value.schema!==1||!Array.isArray(value.turns))throw new Error('schema');data=value;lastRead=Date.now();error=false;draw();}
    catch{error=true;showStatus();if(!data)$('trace-detail').replaceChildren(el('div','card empty','轨迹暂时无法读取。请稍后刷新。'));}
    finally{clearTimeout(timeout);busy=false;$('trace-refresh').disabled=false;}
  }
  $('trace-search').addEventListener('input',draw);$('trace-filter').addEventListener('change',draw);
  $('trace-refresh').addEventListener('click',()=>refresh(true));
  $('trace-pause').addEventListener('click',()=>{paused=!paused;$('trace-pause').setAttribute('aria-pressed',String(paused));$('trace-pause').textContent=paused?'恢复刷新':'暂停刷新';showStatus();if(!paused)refresh();});
  document.addEventListener('qiandeng:view',e=>{if(e.detail==='trace')refresh();});
  document.addEventListener('visibilitychange',()=>refresh());
  setInterval(refresh,15000);refresh();
})();
