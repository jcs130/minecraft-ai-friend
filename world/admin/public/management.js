(() => {
  'use strict';
  const $=id=>document.getElementById(id),make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  const labels={mc:'Minecraft 世界',world:'世界玩法',gate:'Agent 协议入口',npc:'村务',resources:'配音与模型资源',qwenpaw:'游戏会话 QwenPaw','qwenpaw-ops':'运营组 QwenPaw',voice:'语音回复',asr:'咏唱识别',panel:'管理台',tts:'语音合成',control:'管理执行器',survivor:'桐人 · 自主生存'};
  const explanations={mc:'存档、模组与玩家进度',world:'技能、世界事件与女神会话',gate:'已有 Agent 连接协议',npc:'村民、任务与技能书',resources:'客户端资源分发',qwenpaw:'游戏会话后端，与宿主团队独立','qwenpaw-ops':'六角色运营团队、职责技能与受控协作',voice:'回复语音的队列处理',asr:'真人咏唱的语音识别',panel:'你正在使用的管理页面',tts:'本项目独立 GPU 推理',control:'受控操作与回执；网页不允许停止自身执行器',survivor:'桐人的独立生存身体、自主规划与技能学习'};
  let authenticated=false,csrf=null,authMode='unknown',sessionExpiresAt=0,sessionPending=null,current=location.hash.slice(1)||'overview',services=[],plan=null,eye=null,view='first',lease=null,lastMap=0,busy=false,serviceSignature='',targetSignature='';
  let eyeBusy=false,lastServices=0,lastCompatibility=0,sessionRetryAt=0,sessionFailures=0,sessionError='',previewPending=false,previewVersion=0;
  const nav=document.querySelector('.nav-list'),before=nav.querySelector('[data-view="beings"]');
  for(const [id,label,icon] of [['eye','天神之眼','◉'],['services','服务器管理','◇']]){
    const button=make('button','nav-item');button.dataset.view=id;
    const symbol=make('span','nav-symbol',icon);symbol.setAttribute('aria-hidden','true');button.append(symbol,make('span','',label),make('span','nav-index'));
    button.addEventListener('click',()=>selectView(id));nav.insertBefore(button,before);
  }
  nav.querySelectorAll('.nav-index').forEach((e,i)=>{e.textContent=String(i+1).padStart(2,'0');e.setAttribute('aria-hidden','true');});
  const messages={login_required:'管理会话已失效，连接恢复后请重新预览。',invalid_password:'密码不正确。',login_rate_limit:'尝试次数过多，请一分钟后再试。',dependency_not_ready:'依赖尚未就绪，请先启动对应服务。',plan_expired:'计划已过期，请重新预览。',operation_busy:'已有维护操作正在执行，请查看操作记录。',unverified_container:'容器状态或归属未能核实，操作没有执行。',target_not_online:'目标当前不在线。',observer_offline:'观察者暂未连接。',management_request_unavailable:'管理服务暂不可用，请检查服务状态。',csrf_required:'管理会话已变化，连接恢复后请重新预览。',local_access_required:'管理仅允许从本机入口访问。',management_not_configured:'本机管理连接尚未配置完成。'};
  async function api(route,body){
    if(route!=='/api/manage/session'&&authMode==='local'&&(!authenticated||sessionExpiresAt<Date.now()+30000)){
      await session();if(!authenticated)throw new Error('本机管理连接暂未就绪，请等待连接恢复。');
    }
    let response;try{response=await fetch(route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(20000)});}
    catch{throw Object.assign(new Error(body===undefined?'连接暂未完成，请稍后重试。':'未能确认请求结果。请先查看操作记录，避免重复提交。'),{retryable:true});}
    const data=await response.json().catch(()=>({}));if(!response.ok){
      if(['login_required','csrf_required'].includes(data.error)){authenticated=false;csrf=null;sessionExpiresAt=0;previewVersion++;updateSession();}
      throw Object.assign(new Error(messages[data.error]||('请求未完成：'+(data.error||response.status))),{retryable:!['management_not_configured','local_access_required'].includes(data.error)&&(response.status>=500||response.status===408||response.status===429)});
    }return data;
  }
  function message(value,bad=false){const box=$('management-message');box.hidden=!value;box.textContent=value||'';box.className='notice'+(bad?' error':'');}
  function updateSession(){
    $('admin-session-label').textContent=sessionError?sessionError+(Number.isFinite(sessionRetryAt)?' 将自动重连。':' 请检查配置后点击刷新。')
      :authMode==='local'?(authenticated?'本机管理 · 无需密码，维护操作仍需预览确认':'正在连接本机管理…')
      :authMode==='unknown'?'正在连接本机管理…':authenticated?'管理已解锁 · 操作需要预览确认':'浏览模式 · 观察与查看无需解锁';
    $('admin-unlock').hidden=authMode!=='password'||authenticated;$('admin-logout').hidden=authMode!=='password'||!authenticated;
    document.querySelector('.read-only').textContent=authenticated?(authMode==='local'?'本机管理':'管理模式'):'浏览模式';
    $('eye-follow').disabled=!authenticated||!$('eye-target').value||!eye?.observer?.online;
    $('eye-park').disabled=!authenticated||!eye?.follow?.active;
    renderServices();
  }
  async function session(force=false){
    if(sessionPending)return sessionPending;
    if(!force&&Date.now()<sessionRetryAt)return;
    sessionPending=(async()=>{try{const data=await api('/api/manage/session');
      if(data.configured===false)throw Object.assign(new Error(messages.management_not_configured),{retryable:false});
      if(typeof data.authenticated!=='boolean')throw Object.assign(new Error('管理连接未返回有效会话。'),{retryable:true});
      authMode=data.authMode==='local'?'local':'password';authenticated=data.authenticated===true;csrf=data.csrf;
      sessionExpiresAt=Number.isFinite(data.expiresAt)?data.expiresAt:0;sessionRetryAt=0;sessionFailures=0;sessionError='';updateSession();
    }catch(e){authenticated=false;csrf=null;sessionExpiresAt=0;previewVersion++;sessionError=e.message;
      sessionRetryAt=e.retryable?Date.now()+Math.min(30000,5000*2**Math.min(sessionFailures++,3)):Infinity;updateSession();}})();
    try{return await sessionPending;}finally{sessionPending=null;}
  }
  $('admin-unlock').onclick=()=>{if(authMode!=='password')return;$('login-error').textContent='';$('admin-password').value='';$('admin-login-dialog').showModal();$('admin-password').focus();};
  $('login-cancel').onclick=()=>$('admin-login-dialog').close();
  $('admin-login-form').onsubmit=async event=>{event.preventDefault();try{const data=await api('/api/manage/login',{password:$('admin-password').value});$('admin-password').value='';csrf=data.csrf;authenticated=true;$('admin-login-dialog').close();updateSession();await refresh();}catch(e){$('login-error').textContent=e.message;}};
  $('admin-logout').onclick=async()=>{try{if(lease)await park();await api('/api/manage/logout',{});authenticated=false;csrf=null;updateSession();$('service-logs').textContent='管理已锁定。';$('operation-history').replaceChildren(make('p','footnote','解锁管理后查看操作记录。'));}catch(e){message(e.message,true);}};
  function renderServices(){
    const signature=JSON.stringify([authenticated,previewPending,services]);if(signature===serviceSignature)return;serviceSignature=signature;
    const ready=services.filter(s=>s.state==='running'&&(!s.health||s.health==='healthy')).length;
    $('home-live-services').textContent=services.length?`${ready} / ${services.length} 项服务就绪 · 状态直接来自当前容器`:'管理执行器正在连接…';
    $('services-badge').textContent=services.length?`${ready} / ${services.length} 就绪`:'连接中';
    $('services-badge').className='badge '+(services.length&&ready===services.length?'good':'amber');
    $('managed-services').replaceChildren(...services.map(row=>{
      const card=make('article','card managed-service');const heading=make('div','card-heading');
      heading.append(make('h2','',labels[row.id]||row.id),make('span','badge '+(row.state==='running'&&(!row.health||row.health==='healthy')?'good':'neutral'),row.state==='running'?(row.health==='unhealthy'?'健康异常':'运行中'):row.state==='exited'?'已停止':'尚未就绪'));
      card.append(heading,make('p','card-caption',explanations[row.id]||''),make('code','service-identifier',row.id));
      const actions=make('div','button-row');
      for(const [action,label] of [['start','启动'],['restart','重启'],['stop','停止']]){const b=make('button','button button-secondary compact',label);b.type='button';b.disabled=!authenticated||previewPending||!row.canControl||(action==='start'&&row.state==='running')||(action==='stop'&&row.state==='exited');b.onclick=()=>preview(action,row.id);actions.append(b);}
      card.append(actions);return card;
    }));
    const selected=$('logs-service').value;$('logs-service').replaceChildren(...services.map(row=>{const option=make('option','',labels[row.id]||row.id);option.value=row.id;return option;}));
    if(services.some(s=>s.id===selected))$('logs-service').value=selected;
  }
  async function preview(action,id){
    if(previewPending||!authenticated)return;
    const version=++previewVersion,pendingText='正在准备“'+({start:'启动',stop:'停止',restart:'重启'})[action]+' '+labels[id]+'”的维护预览…';
    previewPending=true;plan=null;message(pendingText);renderServices();
    try{const result=await api('/api/manage/plan',{action,services:[id]});
    if(version!==previewVersion||current!=='services'||!authenticated)return;
    plan=result;message('');
    $('plan-heading').textContent=({start:'启动',stop:'停止',restart:'重启'})[action]+' '+labels[id];
    const details=[plan.plan.explanation,'将停止：'+(plan.plan.stop.map(x=>labels[x]).join('、')||'无'),'将启动：'+(plan.plan.start.map(x=>labels[x]).join('、')||'无'),plan.plan.saveMinecraft?'Minecraft 会先确认保存完成。':'本次不需要停止 Minecraft。'];
    $('plan-description').replaceChildren(...details.map(x=>make('p','',x)));$('plan-execute').disabled=false;$('operation-dialog').showModal();
    }catch(e){if(version===previewVersion)message(e.message,true);}
    finally{previewPending=false;if($('management-message').textContent===pendingText)message('');renderServices();}
  }
  function cancelPlan(){previewVersion++;plan=null;$('operation-dialog').close();}
  $('plan-cancel').onclick=cancelPlan;
  $('operation-dialog').addEventListener('cancel',cancelPlan);
  $('plan-execute').onclick=async()=>{if(!plan)return;const planId=plan.id;plan=null;$('plan-execute').disabled=true;try{const result=await api('/api/manage/execute',{planId});$('operation-dialog').close();message('维护已提交，正在等待实际执行结果。记录编号 '+result.operationId.slice(0,8));await refresh();}catch(e){$('operation-dialog').close();message(e.message,true);}};
  async function history(){if(!authenticated)return;try{const data=await api('/api/manage/operations');$('operation-badge').textContent=data.active?'执行中':'无进行中的操作';
    if(data.journalError)message('操作记录无法可靠保存，管理执行器已暂停新的维护操作。请检查记录目录。',true);
    $('operation-history').replaceChildren(...data.operations.slice(0,10).map(row=>{const card=make('div','operation-record');card.append(make('strong','',({complete:'已完成',running:'执行中',failed:'未完成',interrupted:'执行中断'})[row.status]||row.status),make('p','footnote',new Date(row.startedAt).toLocaleString('zh-CN')+' · '+row.id.slice(0,8)));
      for(const step of row.steps||[])card.append(make('p','operation-step',(step.status==='complete'?'✓ ':step.status==='failed'?'! ':'… ')+step.name));
      if(row.error)card.append(make('p','error-text',messages[row.error]||row.error));if(row.recovery)card.append(make('p','footnote',row.recovery));return card;}));
  }catch(e){message(e.message,true);}}
  $('logs-refresh').onclick=async()=>{if(!authenticated&&authMode==='password'){$('admin-unlock').click();return;}try{const value=await api('/api/manage/logs?service='+encodeURIComponent($('logs-service').value));$('service-logs').textContent=value.text||'暂无日志。';}catch(e){$('service-logs').textContent=e.message;}};
  function showFrame(){if(current!=='eye'||document.hidden){$('eye-frame').removeAttribute('src');return;}const source='http://127.0.0.1:19092/'+(view==='first'?'':view+'/')+(new URLSearchParams(location.search).has('diagnostic')?'?diagnostic':'');if($('eye-frame').getAttribute('src')!==source)$('eye-frame').src=source;}
  document.querySelectorAll('[data-eye-view]').forEach(button=>button.onclick=()=>{view=button.dataset.eyeView;document.querySelectorAll('[data-eye-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));showFrame();});
  $('eye-reload').onclick=()=>{lastCompatibility=0;$('eye-frame').removeAttribute('src');showFrame();void eyeRefresh();};
  $('eye-target').onchange=updateSession;
  function renderEye(data){eye=data;const o=data.observer,pos=o?.position;
    $('eye-badge').textContent=o?.online?'已连接':'离线';$('eye-badge').className='badge '+(o?.online?'good':'neutral');
    $('eye-view-status').textContent=o?.online?'Goddess · '+(dimensionNames[o.dimension]||o.dimension||'未知维度')+' · 观察数据已更新':'观察者未连接，画面正在等待世界';
    const values=[['观察者',o?.name||'Goddess'],['维度',dimensionNames[o?.dimension]||o?.dimension||'—'],['坐标',pos?`${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`:'—']];
    $('eye-observer-facts').replaceChildren(...values.map(([label,value])=>{const p=make('p');p.append(make('span','fact-label',label),make('strong','',value));return p;}));
    const signature=JSON.stringify(data.targets);if(signature!==targetSignature){targetSignature=signature;const selected=$('eye-target').value;$('eye-target').replaceChildren(make('option','','选择在线目标'));$('eye-target').firstChild.value='';
    for(const row of data.targets||[]){const option=make('option','',row.name+(row.nearby?' · 附近':''));option.value=row.name;$('eye-target').append(option);}if((data.targets||[]).some(t=>t.name===selected))$('eye-target').value=selected;}
    const follow=data.follow;$('eye-follow-status').textContent=follow?.active?`正在跟随 ${follow.target} · 租期至 ${new Date(follow.expiresAt).toLocaleTimeString('zh-CN')}`:follow?.parking?'正在返回观察位置…':'未跟随。选择在线目标后开始，只移动观察者。';
    $('eye-world-summary').replaceChildren(make('span','chip',`周边实体 ${data.entities?.total??'—'}`),make('span','chip',`在线可选目标 ${data.targets?.length??0}`),make('span','chip','远程玩家背包尚未接入'));
    if(pos&&Date.now()-lastMap>30000){lastMap=Date.now();$('eye-map').src='/api/eye/map.png?'+new URLSearchParams({cx:Math.round(pos.x),cz:Math.round(pos.z),r:32});$('eye-map').hidden=false;}
    updateSession();
  }
  $('eye-map').onerror=()=>{$('eye-map').hidden=true;$('eye-map-status').textContent='周边地图暂未就绪，下一次更新会重试。';};
  $('eye-map').onload=()=>{$('eye-map').hidden=false;$('eye-map-status').textContent='已加载周边地形';};
  $('eye-follow').onclick=async()=>{try{const value=await api('/api/eye/observer',{action:'follow',target:$('eye-target').value});const data=value.state||value;lease=data.follow?.leaseId?{id:data.follow.leaseId,target:data.follow.target}:null;if(current!=='eye'||document.hidden){await park();return;}await eyeRefresh();}catch(e){$('eye-follow-status').textContent=e.message;}};
  async function park(){lease=null;try{await api('/api/eye/observer',{action:'park'});await eyeRefresh();}catch(e){$('eye-follow-status').textContent=e.message;}}
  $('eye-park').onclick=park;
  async function eyeRefresh(){
    if(current!=='eye'||document.hidden||eyeBusy)return;
    eyeBusy=true;
    const updateCompatibility=Date.now()-lastCompatibility>300000;
    const visible=()=>current==='eye'&&!document.hidden;
    try{await Promise.allSettled([
      api('/api/eye/state').then(data=>{if(visible())renderEye(data);}).catch(e=>{if(visible()){$('eye-badge').textContent='连接中断';$('eye-view-status').textContent=e.message;}}),
      api('/api/eye/renderer').then(data=>{if(visible()&&!data.observerOnline)$('eye-view-status').textContent='渲染器正在等待观察者连接';}),
      updateCompatibility?api('/api/eye/compatibility').then(data=>{
        if(!visible())return;lastCompatibility=Date.now();
        $('eye-compatibility-status').textContent=`当前资源：${data.stats?.blocks??'—'} 种模组方块 · ${data.stats?.fallbackBlocks??'—'} 种使用缺失占位 · YSM 网页动画尚未接入`;
      }).catch(()=>{if(visible())$('eye-compatibility-status').textContent='资源摘要暂未更新，下次自动重试。';}):Promise.resolve()
    ]);}finally{eyeBusy=false;}
  }
  async function refreshServices(){
    if(busy||Date.now()-lastServices<(current==='services'?5000:15000))return;
    busy=true;try{const data=await api('/api/manage/services');services=data.services||[];lastServices=Date.now();renderServices();if(current==='services')await history();}
    catch(e){$('home-live-services').textContent='当前状态未能更新，请稍后重试。';if(current==='services')message(e.message,true);}
    finally{busy=false;}
  }
  async function refresh(){if(document.hidden)return;await Promise.allSettled([
    authMode==='unknown'||(authMode==='local'&&(!authenticated||sessionExpiresAt<Date.now()+30000))?session():Promise.resolve(),refreshServices(),eyeRefresh()]);}
  $('refresh-button').addEventListener('click',()=>{lastServices=0;lastCompatibility=0;void session(true).then(refresh);});
  document.addEventListener('qiandeng:view',event=>{const previous=current;current=event.detail;if(previous==='services'&&current!=='services')cancelPlan();if(previous==='eye'&&current!=='eye'&&lease)void park();showFrame();void refresh();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&lease)void park();showFrame();if(!document.hidden)void refresh();});
  setInterval(()=>{if(current==='eye'&&!document.hidden&&authenticated&&lease)api('/api/eye/observer',{action:'follow',target:lease.target,renew:true,leaseId:lease.id}).catch(()=>{lease=null;});},40000);
  selectView(current,false);showFrame();void session();void refresh();setInterval(refresh,5000);
})();
