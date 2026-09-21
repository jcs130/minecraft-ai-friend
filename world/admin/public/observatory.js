(() => {
  'use strict';
  const $=id=>document.getElementById(id),el=(tag,cls,value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=value;return n;};
  const num=v=>typeof v==='number'&&Number.isFinite(v);
  const sources={llm:'LLM',jev:'Jev',decider:'Decider（历史）',policy_unknown:'策略来源未知',unknown:'来源未知'};
  const source=v=>sources[v]||'来源未知';
  const percent=v=>num(v)?`${(v*100).toFixed(0)}%`:'未记录';
  const outcome=p=>p.outcome==='fallback'?'回退慢系统':p.outcome==='dispatch_recorded'?'已记录派发':'仅记录选择';
  const when=v=>v!==null&&v!==undefined&&Number.isFinite(new Date(v).getTime())?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(v)):'未记录';
  const duration=v=>!num(v)?'耗时未记录':v<1000?Math.round(v)+' ms':v<60000?(v/1000).toFixed(2)+' s':Math.floor(v/60000)+'m '+Math.round(v%60000/1000)+'s';
  const short=v=>typeof v==='string'?v.slice(0,10):'未记录';
  const names={goto:'移动到下一个位置',eat:'补充食物',equip_item:'调整随身装备',interact_at:'与世界交互',craft:'合成物品',mine:'采集资源',game_cast:'施放法术',place_block:'放置方块'};
  const statuses={thinking:'认知处理中',acting:'执行中',waiting:'等待下一步',paused:'已暂停',decision_wait:'等待决策',party_reply_wait:'等待交流回执',active:'轮次进行中',completed:'轮次已结束',failed:'轮次失败',unknown:'结果未知',accepted:'已受理',pending:'等待执行',in_flight:'执行中',rejected:'已拒绝',observed_ended:'观察到结束',open:'待分派',working:'处理中',needs_review:'待审查',resolved:'已结案'};
  const skillNames={'qd-learned-action-precheck':'行动前置条件检查','qd-learned-guild-claim-precision':'公会领取条件复核','qd-learned-npc-service-diagnosis':'NPC 服务诊断','qd-learned-hunting-prep-check':'狩猎前的补给检查','qd-learned-stagnation-redirect':'停滞识别与目标调整','qd-learned-review-loop-detection':'重复复盘检测','qd-learned-yui-rescue-inspect-first':'救援前检查','qd-learned-planner-proposal-selfcheck':'规划提案自检'};
  let trace=null,rsi=null,paused=false,loading=false,lastRead=null,failed=false,rsiFailed=false,selectedAction=null,dialogType=null;
  let seenActions=new Set();
  const params=new URLSearchParams(location.search);let sidebar=params.get('layout')==='sidebar';
  function setLayout(){document.body.classList.toggle('mode-sidebar',sidebar);$('mode').textContent=sidebar?'完整观察舱':'OBS 侧栏';const url=new URL(location.href);if(sidebar)url.searchParams.set('layout','sidebar');else url.searchParams.delete('layout');history.replaceState(null,'',url);if(sidebar)setCamera('off');}
  function setCamera(mode){
    const frame=$('world-frame');const url=mode==='first'?'http://127.0.0.1:19092/':mode==='third'?'http://127.0.0.1:19092/third/':null;
    if(url){frame.src=url;frame.hidden=false;$('world-placeholder').hidden=true;}else{frame.removeAttribute('src');frame.hidden=true;$('world-placeholder').hidden=false;}
    document.querySelectorAll('[data-camera]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.camera===mode)));
    const current=new URL(location.href);if(url)current.searchParams.set('camera',mode);else current.searchParams.delete('camera');history.replaceState(null,'',current);
  }
  function latestTurn(){return trace?.turns?.[0];}
  function latestSummary(){return trace?.turns?.find(t=>t.summary);}
  function actions(){return [...new Map([...(trace?.turns||[]).flatMap(t=>t.actions),...(trace?.policyDecisions||[]).flatMap(p=>p.actions)].map(a=>[a.actionId,a])).values()].sort((a,b)=>(b.startedAt||0)-(a.startedAt||0));}
  function connection(){
    const stale=trace?.stale||failed,available=trace?.available;
    $('connection').textContent=failed?'连接中断 · 保留历史':paused?'刷新暂停':stale?'历史快照 · 已过期':available?'实时记录已连接':'等待有效记录';
    $('connection-dot').className='status-light'+(!stale&&!paused&&available?' online':'');
    document.body.classList.toggle('stream-fresh',!!available&&!stale&&!paused);
    $('freshness').textContent=`读取 ${when(lastRead)} · 游戏状态 ${when(trace?.generatedAt)}${rsiFailed?' · RSI 读取失败，保留历史':''}`;
    $('clock').textContent=when(Date.now());
  }
  function empty(root,message){root.replaceChildren(el('p','empty',message));}
  function compact(title,subtitle,handler,symbol='◇'){
    const b=el('button','compact-item');b.type='button';const d=el('div','');d.append(el('strong','',title),el('small','',subtitle));b.append(el('span','',symbol),d);b.addEventListener('click',handler);return b;
  }
  function draw(){
    connection();
    const turn=latestTurn(),summary=latestSummary(),all=actions(),last=all[0],agent=trace?.agent;
    $('mission').textContent=agent?.goal||'尚未取得当前目标';
    $('mission-state').textContent=statuses[agent?.status]||agent?.status||'待读取';
    $('body-state').textContent=agent?`生命 ${agent.hp??'—'}/20　饥饿 ${agent.hunger??'—'}/20`:'身体状态待读取';
    $('body-status').textContent=trace?.stale?'历史采样':'当前采样';
    $('turn-state').textContent=statuses[turn?.status]||'暂无轮次';
    $('current-tool').textContent=last?(names[last.tool]||last.tool):'尚无动作回执';
    $('current-tool-info').textContent=last?`${source(last.decisionSource)} → ${last.tool} · ${last.status==='completed'?'执行结束':statuses[last.status]||last.status}`:'仅根据已记录动作显示，不推断未记录的思考。';
    const latestPolicy=trace?.policyDecisions?.[0];
    $('route-status').textContent=({llm:'当前 LLM 轮次',policy_pending:'当前策略请求中',program:'当前程序执行',idle:'当前等待'})[trace?.routing?.activeSource]||'路由待读取';
    $('route-history').textContent=latestPolicy?`最近 ${source(latestPolicy.source)} · ${outcome(latestPolicy)} ↗`:'查看 LLM / Jev 分支 ↗';
    $('action-time').textContent=when(last?.startedAt);$('action-duration').textContent=duration(last?.durationMs);
    $('decision-summary').textContent=summary?.summary.lesson||'本轮尚无已保存的决策摘要。';
    $('summary-time').textContent=summary?`${when(summary.summary.at)} · ${summary.turnId===turn?.turnId?'本轮摘要':'最近已保存摘要，来自较早轮次'}`:'';
    $('next-step').textContent=summary?.summary.nextFocus||'尚未保存下一步计划';
    const stream=$('tool-stream');stream.replaceChildren(...all.slice(0,3).map((a,i)=>{
      const b=el('button','tool-row'+(!seenActions.has(a.actionId)&&seenActions.size?' new-record':''));b.type='button';
      b.append(el('span','',String(i+1).padStart(2,'0')),el('strong','',`${source(a.decisionSource)} → ${a.tool}`),el('span','outcome '+a.status,a.status==='completed'?'结束':statuses[a.status]||a.status),el('small','',duration(a.durationMs)));
      b.addEventListener('click',()=>{selectedAction=a;inspect('action');});return b;
    }));if(!all.length)empty(stream,'游戏动作回执尚未到达。');seenActions=new Set(all.map(a=>a.actionId));
    $('graph-input').textContent=num(turn?.input.bytes)?`${turn.input.bytes.toLocaleString()} bytes`:'输入未完整保留';
    $('graph-decision').textContent=statuses[agent?.status]||'等待状态';
    $('graph-tools').textContent=`当前轮 ${turn?.actions.length??0} 个游戏动作`;
    $('graph-feedback').textContent=last?.completionConfirmed?'最近动作已结束':'结果待核对';
    $('sample-count').textContent=`${trace?.turns?.length??0} 个采样轮次 / ${all.length} 条游戏回执`;
    if(rsi?.available){
      $('epoch').textContent=short(rsi.l1?.generation?.memoryEpoch?.replace('embodied-',''));
      const l2=rsi.l2,l3=rsi.l3,role=l2.roles.find(r=>r.role==='qd-survivor');
      $('knowledge-count').textContent=role?.knowledge??'—';$('draft-count').textContent=l2.drafts.length;
      $('shared-count').textContent=rsi.sources.shared?l2.sharedSkills.length:'—';
      $('enabled-count').textContent=rsi.sources.learning?l2.localSkills.filter(s=>s.enabled).length:'—';
      $('verified-count').textContent=rsi.sources.learning?l2.localSkills.filter(s=>s.behaviorVerified).length:'—';
      $('knowledge-list').replaceChildren(...l2.knowledge.slice(0,2).map(k=>compact(k.name,`${when(k.at)} · ${(k.size/1024).toFixed(1)} KB`,()=>inspect('knowledge'),'▤')));
      $('knowledge-note').textContent=`知识计数采样 ${when(rsi.sources.boardAt)}；${l2.knowledgePartial?'下列索引为部分近期文件。':'索引来自既有记忆目录。'} 文件数量不代表能力水平。`;
      $('skill-list').replaceChildren(...[...l2.localSkills].sort((a,b)=>Number(b.enabled)-Number(a.enabled)||(b.at||0)-(a.at||0)).slice(0,3).map(s=>{
        const b=el('button','skill-item'),top=el('div','');b.type='button';top.append(el('strong','',skillNames[s.name]||s.name),el('span','pill',s.enabled?'已启用':'已停用'));
        const tags=el('div','skill-tags');tags.append(el('span','',s.behaviorVerified?'有行为验证':'行为待验证'));const shared=l2.sharedSkills.find(p=>p.name===s.name&&p.revision===s.revision);if(shared)tags.append(el('span','','已共享'));
        b.append(top,el('small','',`${s.name} · ${short(s.revision)}`),tags);b.addEventListener('click',()=>inspect('skills'));return b;
      }));if(!l2.localSkills.length)empty($('skill-list'),'暂无可读取的本地技能。');
      $('base-commit').textContent=short(l3.baseCommit);$('engineering-status').textContent=l3.enabled===true?'工程能力可用':l3.enabled===false?'工程能力关闭':'状态未知';
      const pending=l3.cases.items.filter(c=>!['resolved','rejected'].includes(c.status));
      $('graph-engineering').textContent=l3.cases.available?`${pending.length} 条采样未结提案`:'工单暂不可读';
      $('case-list').replaceChildren(...pending.slice(0,2).map(c=>compact(c.title,`${statuses[c.status]||c.status} · ${c.owner||'待指派'}`,()=>inspect('l3'))));
      if(!pending.length)empty($('case-list'),l3.cases.available?'近期样本中没有未结改进提案。':'改进工单暂时不可读取。');
    }
  }
  const para=(root,t)=>root.append(el('p','',t));
  function record(root,title,value){const d=el('details','');d.append(el('summary','',title),el('pre','',typeof value==='string'?value:JSON.stringify(value,null,2)));root.append(d);}
  function branches(root){
    const llm=el('section','branch-card llm');llm.append(el('h3','','LLM · QwenPaw 慢系统'));
    para(llm,trace?.routing?.activeLlmTurnId?`当前轮次：${trace.routing.activeLlmTurnId}`:'当前没有已记录的活动 LLM 轮次。');
    para(llm,'目标 / 输入 → 模型任务 → 已调用工具 → 世界回执。LLM 的未选方案和逐步内部推理没有保存在当前轨迹中。');
    root.append(llm);
    para(root,'下方是独立的策略历史，按记录时间倒序展示。候选概率与决策置信度是两个不同指标；选中候选不代表动作已经派发。');
    (trace?.policyDecisions||[]).forEach((p,i)=>{
      const d=el('details','branch-card '+p.source);d.open=i===0;
      d.append(el('summary','',`${source(p.source)} · ${when(p.at)} · ${outcome(p)}`));
      para(d,`${p.model||'模型未记录'} · 技能 ${p.skill||'未记录'} · 请求 ${duration(p.latencyMs)} · 控制器接收 ${duration(p.handoffMs)}`);
      const graph=el('div','branch-options');
      p.candidates.forEach(c=>{
        const n=el('div','branch-option'+(c.selected?' selected':''));
        n.append(el('strong','',`${c.selected?'✓ 已选':'○ 未选'} · ${c.description||c.id}`),el('small','',`${c.id} · 候选概率 ${percent(c.probability)}`));
        if(num(c.probability)){const bar=el('progress','');bar.max=1;bar.value=c.probability;bar.setAttribute('aria-label',`${c.id} 候选概率 ${percent(c.probability)}`);n.append(bar);}
        para(n,c.action?`候选工具：${c.action.tool}`:'候选去向：交回慢系统');
        graph.append(n);
      });
      if(!p.candidates.length)para(graph,'这条历史没有保留候选列表。');d.append(graph);
      const reason={low_confidence:'置信度低于 75% 阈值',selected_handoff:'选择交回慢系统',policy_unavailable:'策略服务不可用',policy_observation_stale:'输入观察已过期'}[p.reason]||p.reason||'未记录';
      para(d,`↓ 置信度 ${percent(p.confidence)} → ${outcome(p)}${p.outcome==='fallback'?' · '+reason:''}`);
      if(p.outcome==='fallback')para(d,'本次未派发候选动作。后续具体 LLM 轮次没有精确关联记录。');
      else if(p.outcome==='dispatch_recorded')para(d,`派发轮次 ${p.dispatchTurnId} · 已关联 ${p.actions.length} 条动作回执；执行结果以回执为准。`);
      else para(d,'未取得唯一匹配的派发记录，不能据此判断动作已执行。');
      p.actions.forEach(a=>d.append(compact(`${source(a.decisionSource)} → ${a.tool}`,`${a.status} · ${duration(a.durationMs)}`,()=>{selectedAction=a;inspect('action');})));
      record(d,'候选参数与关联证据',p);root.append(d);
    });
    if(!trace?.policyDecisions?.length)para(root,'保留范围内暂无可读取的策略分支。');
  }
  function inspect(type){
    dialogType=type;const root=$('inspector-content');root.replaceChildren();
    const title={perception:'L1 · 输入与感知',decision:'L1 · 决策摘要',tools:'L1 · 工具调度',feedback:'L1 · 世界反馈',action:'工具调用详情',l2:'L2 · 经验与技能沉淀',knowledge:'L2 · 知识库索引',skills:'L2 · 技能库与反馈',l3:'L3 · 机制改进与工程证据',coverage:'数据来源与直播说明'}[type]||'记录详情';
    $('inspector-title').textContent=title;$('inspector-kicker').textContent='RECORDED EVIDENCE / READ ONLY';
    const turn=latestTurn(),summary=latestSummary(),l2=rsi?.l2,l3=rsi?.l3;
    if(type==='perception'){para(root,'当前轮次输入摘要。历史完整 Prompt 未保存，不能用当前身体状态替代过去输入。');record(root,'本轮已保留输入',turn?.input??{});}
    if(type==='decision'){ $('inspector-title').textContent='L1 · LLM / Jev 决策分支';branches(root);record(root,'LLM 最近保存的目标与复盘',summary?.summary??{}); }
    if(['tools','feedback','action'].includes(type)){
      para(root,'耗时为受理到结束观察的间隔，包含调度与查询延迟。已受理不等于已完成；动作完成也不等于目标达成。');
      const list=type==='action'&&selectedAction?[selectedAction]:(turn?.actions||[]);
      if(!list.length)para(root,'本轮尚无游戏动作回执。');
      list.forEach(a=>{root.append(el('h3','',`${source(a.decisionSource)} → ${a.tool} · ${duration(a.durationMs)}`));para(root,`受理 ${when(a.startedAt)} → 结束观察 ${when(a.observedAt)}\n状态 ${a.status} · ${a.completionConfirmed?'结束已确认':'结束尚未确认'}`);record(root,'调用参数',a.args);record(root,'执行结果与实物变化',{inventoryDelta:a.inventoryDelta,hpDelta:a.hpDelta,hungerDelta:a.hungerDelta,navigation:a.navigation});record(root,'身体前后观察与回执标识',{actionId:a.actionId,turnId:a.turnId,nativeTaskId:a.nativeTaskId,before:a.before,after:a.after});});
    }
    if(['l2','skills'].includes(type)){
      para(root,'L2 复用原 learning catalog、共享技能库和记忆目录。草稿、启用、发布与行为验证分别记录。');
      if(l2){l2.localSkills.forEach(s=>record(root,`${skillNames[s.name]||s.name} · ${s.enabled?'已启用':'已停用'}`,s));record(root,'技能草稿目录',l2.drafts);root.append(el('h3','','项目共享技能'));l2.sharedSkills.forEach(s=>record(root,`${skillNames[s.name]||s.name} · ${s.origin}`,s));record(root,'技能反馈与失败反例',l2.feedback);}else para(root,'技能数据暂不可用。');
    }
    if(['knowledge','l2'].includes(type)){
      para(root,'知识库索引展示文件名称与更新时间；知识正文和私有会话不向直播页面公开。概念图表示知识的组织方式，不代表本轮已检索某条记忆。');
      if(l2){l2.knowledge.forEach(k=>record(root,k.name,{updatedAt:when(k.at),bytes:k.size}));record(root,'各角色知识与学习记录（独立采样）',l2.roles);}else para(root,'知识索引暂不可用。');
    }
    if(type==='l3'){
      para(root,'L3：跨任务问题 → 机制候选 → 固定测试 → 审查与收益验收。使用原工程团队、原工单和工程工作区。');
      if(l3){para(root,l3.notice);record(root,'工程基线与固定测试计划',{enabled:l3.enabled,baseCommit:l3.baseCommit,branch:l3.branch,plans:l3.plans});root.append(el('h3','','改进提案 · 最新 24 条'));l3.cases.items.forEach(c=>record(root,`${statuses[c.status]||c.status} · ${c.title}`,c));if(!l3.cases.available)para(root,'工单读取失败，不按零条处理。');root.append(el('h3','','最近工程测试与候选提交回执'));para(root,'列表时间为回执文件更新时间；实际开始、结束时间仅在原记录提供时显示。');l3.receipts.forEach(r=>record(root,`${when(r.fileUpdatedAt)} · ${r.name}`,r));}else para(root,'工程数据暂不可用。');
    }
    if(type==='coverage'){
      para(root,'刷新周期：5 秒读取轨迹，RSI 服务端缓存 15 秒；知识计数、行为统计各自有采样时间。OBS 浏览器源可使用本页的「OBS 侧栏」，建议宽 480、高 1440；完整页建议 1920 × 1080，可按直播场景滚动或裁切。');
      para(root,'L1 展示最近保留的 20 轮、每轮最多 40 条游戏动作。尚不覆盖全部模型工具、原始 Prompt、逐 Token 思考和每次模型调用耗时。L2 展示真实索引与技能版本；L3 展示工程证据，不将工单结案或测试通过当作智能提升。');
      para(root,'图中连线是运行机制示意，不代表已证明每一条历史因果关联。可展开数据源判断记录新鲜度与缺口。直播时只公开摘要、索引与白名单参数。');record(root,'轨迹覆盖',trace?.coverage??{});record(root,'RSI 数据源',rsi?.sources??{});
    }
    const link=el('a','','打开完整执行轨迹 ↗');link.href='/#trace';link.target='_blank';link.rel='noopener';root.append(link);
    if(!$('inspector').open)$('inspector').showModal();
  }
  async function get(url){const c=new AbortController(),timer=setTimeout(()=>c.abort(),9000);try{const response=await fetch(url,{cache:'no-store',signal:c.signal});if(!response.ok)throw new Error('unavailable');const v=await response.json();if(v.schema!==1)throw new Error('schema');return v;}finally{clearTimeout(timer);}}
  async function tick(){
    if(loading||paused||document.hidden)return;loading=true;
    try{const [t,r]=await Promise.allSettled([get('/api/survivor-trace'),get('/api/rsi-observatory')]);
      failed=t.status==='rejected';rsiFailed=r.status==='rejected';if(!failed){trace=t.value;lastRead=Date.now();}if(!rsiFailed)rsi=r.value;draw();
      if(!dialogType&&params.get('inspect')==='decision'&&trace)inspect('decision');
    }finally{loading=false;}
  }
  document.querySelectorAll('[data-inspect]').forEach(b=>b.addEventListener('click',()=>inspect(b.dataset.inspect)));
  document.querySelectorAll('[data-camera]').forEach(b=>b.addEventListener('click',()=>setCamera(b.dataset.camera)));
  $('open-camera').addEventListener('click',()=>setCamera('third'));
  $('inspect-trace').addEventListener('click',()=>inspect('tools'));
  $('close-inspector').addEventListener('click',()=>$('inspector').close());
  $('mode').addEventListener('click',()=>{sidebar=!sidebar;setLayout();});
  $('pause').addEventListener('click',()=>{paused=!paused;$('pause').textContent=paused?'恢复刷新':'暂停刷新';$('pause').setAttribute('aria-pressed',String(paused));connection();if(!paused)tick();});
  $('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('fullscreen').textContent='浏览器不支持全屏';}});
  document.addEventListener('visibilitychange',()=>tick());setLayout();if(!sidebar&&['first','third'].includes(params.get('camera')))setCamera(params.get('camera'));tick();setInterval(tick,5000);setInterval(connection,1000);
})();
