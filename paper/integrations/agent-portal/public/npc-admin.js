const $=id=>document.getElementById(id);
let session=null;
const states={queued:'已提交',dispatched:'正在核对',unknown:'结果未知 · 保留原请求',waiting_body:'等待原角色加载',applied:'已生效',failed:'未生效'};
const planningStates={pending:'规划中',completed:'规划结束',deferred:'规划暂缓',rejected:'规划被拒绝',unavailable:'规划不可用'};
const professions={ranger:'游侠',guardian:'守卫',mage:'法师',healer:'治疗师',artisan:'工匠',farmer:'农夫'};
const reasons={ADMIN_REQUIRED:'仅管理员可以操作。',AUTH_REQUIRED:'请先在官网登录管理员账号。',REAUTH_REQUIRED:'请到“我的账号”重新验证密码后再保存。',NPC_SOURCE_UNAVAILABLE:'游戏服暂未同步，稍后刷新。',NPC_REVISION_CHANGED:'配置已被更新，请刷新后重新编辑。',NPC_REQUEST_PENDING_READ_ORIGINAL:'这个居民已有待核对的请求，请先查看下方结果。',NPC_OPTION_NOT_CONFIGURED:'这个模型或音色尚未在服务器配置，请刷新选项。'};
async function api(route,options={}){
  const r=await fetch('/api/v1'+route,{credentials:'same-origin',...options,headers:{...(options.method?{'Content-Type':'application/json','X-CSRF-Token':session?.csrfToken||''}:{}),...options.headers}});
  const data=await r.json();if(!r.ok)throw Error(reasons[data.error?.reason]||data.error?.message||'操作未完成，请刷新状态核对。');return data;
}
function el(tag,text,cls){const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;}
function field(form,key,title,value,type='text',options=[]){
  const label=el('label',title,key==='persona'?'wide':type==='checkbox'?'check':'');
  const input=el(type==='textarea'?'textarea':type==='select'?'select':'input');input.name=key;
  if(type==='select')for(const option of options){const node=el('option',option.label);node.value=option.id;input.append(node);}
  else if(type!=='textarea')input.type=type;
  if(type==='checkbox')input.checked=value;else input.value=value;
  if(key==='name')input.maxLength=24;if(key==='persona')input.maxLength=1200;
  if(!['checkbox','select'].includes(type))input.required=true;
  label.append(input);form.append(label);
}
function render(data){
  $('notice').textContent=data.available?`已连接游戏服 · ${new Date(data.observedAt).toLocaleTimeString('zh-CN')} 观测`:'游戏服未连接，暂时只能查看上次配置。';
  $('residents').replaceChildren();
  for(const npc of data.residents){
    const card=el('article',null,'resident'),head=el('div',null,'resident-head');head.append(el('h2',npc.profile.name),el('span',professions[npc.profession]||npc.profession,'tag'));card.append(head);
    card.append(el('p',`${npc.loaded?'角色已加载':'角色未加载'} · 配置版本 ${npc.revision}`,'muted'));
    const form=el('form'),fields=el('div',null,'fields');form.append(fields);
    field(fields,'name','角色名称',npc.profile.name);field(fields,'brain','Agent 框架 / 模型',npc.profile.brain,'select',npc.brains.map(b=>({id:b.id,label:`${b.id} · ${b.model}`})));
    field(fields,'persona','人设与行为风格',npc.profile.persona,'textarea');
    field(fields,'appearance','YSM 外观模型',npc.profile.appearance,'select',npc.models);
    field(fields,'voice','配音',npc.profile.voice,'select',npc.voices.map(v=>({id:v,label:v==='none'?'不配音（文字与气泡）':v==='default'?'角色原配音':v})));
    field(fields,'autonomous','自主生活与规划',npc.profile.autonomous,'checkbox');field(fields,'mapVisible','在公开地图显示位置',npc.profile.mapVisible,'checkbox');
    const actions=el('div',null,'form-actions'),save=el('button','保存并应用');save.type='submit';save.disabled=!data.available;
    const result=el('span',null,'form-result');result.setAttribute('role','status');actions.append(save,result);form.append(actions);
    form.addEventListener('submit',async event=>{
      event.preventDefault();save.disabled=true;
      const value=new FormData(form),profile=Object.fromEntries(['name','persona','brain','voice','appearance'].map(k=>[k,value.get(k)]));
      profile.autonomous=value.has('autonomous');profile.mapVisible=value.has('mapVisible');
      try{const r=await api('/admin/npcs/'+npc.id,{method:'PUT',body:JSON.stringify({requestId:crypto.randomUUID(),revision:npc.revision,profile})});result.textContent=states[r.status];await jobs();}
      catch(e){result.textContent=e.message;save.disabled=false;}
    });card.append(form);$('residents').append(card);
  }
  history(data);
  activity(data);
}
function history(data){$('jobs').replaceChildren();for(const job of data.jobs){const npc=data.residents.find(n=>n.id===job.id);const li=el('li',`${npc?.profile.name||job.id} · ${states[job.status]||job.status} · ${new Date(job.createdAt).toLocaleString('zh-CN')}`);li.append(el('div',job.requestId,'muted'));$('jobs').append(li);}}
function activity(data){
  const rows=data.residentActivity||[];
  $('activity-panel').hidden=!rows.length;
  $('resident-activity').replaceChildren(...rows.map(row=>{
    const li=el('li',`${row.name||row.role} · ${planningStates[row.planningStatus]} · 回合 ${row.turnHash}`);
    const summary=`游戏动作回执 · 完成 ${row.completedActions} · 失败 ${row.failedActions} · 待确认 ${row.pendingActions}`;
    li.append(el('div',summary,'muted'));
    if(row.planningError)li.append(el('div',`${row.planningError.step} · ${row.planningError.code}`,'muted'));
    if(row.transferError)li.append(el('div',`传送未派发 · ${row.transferError}`,'muted'));
    return li;
  }));
}
async function jobs(){const data=await api('/admin/npcs');history(data);activity(data);}
async function refresh(){try{session=await api('/session');if(session.owner?.role!=='admin')throw Error('仅管理员可管理居民，请先在官网登录管理员账号。');render(await api('/admin/npcs'));}catch(e){$('notice').textContent=e.message;$('residents').replaceChildren();}}
$('refresh').addEventListener('click',()=>void refresh());
await refresh();setInterval(()=>{if(session?.owner?.role==='admin'&&!document.hidden)void jobs().catch(()=>{});},5000);
