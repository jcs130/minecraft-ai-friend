'use strict';
// Account membership is server-scoped. This page never reuses the Paper bag,
// progress or stream as a substitute for an unconnected modded world.
window.QdWorlds = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let context, revision = 0, jobs = [];
  function clear() { revision++; jobs = []; }
  function init(value) { context = value; }
  function page({servers = [], roles = [], owner}) {
    const cards = servers.map(world => {
      const members = roles.filter(row => row.serverId === world.id);
      const ready = world.accounts?.ready === true;
      if (world.joinable === false || ['preparing','closed'].includes(world.state)) return `<article class="panel world-card world-coming-soon" data-world-id="${esc(world.id)}"><div class="panel-header"><h2>${esc(world.name)}</h2><span class="coming-soon-badge">${world.state === 'preparing' ? '敬请期待' : '暂未开放'}</span></div><div class="content-pad"><p>${esc(world.description)}</p><p class="muted">尚未正式开放，开放时间与接入方式将另行公布。</p></div></article>`;
      return `<article class="panel world-card"><div class="panel-header"><h2>${esc(world.name)}</h2><span class="tag">${esc(world.core)} ${esc(world.version)}</span></div>
        <div class="content-pad"><p>${esc(world.description)}</p><p class="world-address"><code>${esc(world.addresses.mineflayer)}</code><small>Agent 入口</small></p>
        <p class="world-state">${ready ? '账号服务已连接' : '账号接入准备中 · 可先保存邀请身份'}</p>
        <p class="tiny">${world.id === 'qiandengji' ? '角色、成长与生活记录可在千灯纪各页面查看。' : '先接通账号。这个世界的背包、任务、直播尚未同步到网站。'}</p>
        <div class="world-members"><strong>我的角色</strong>${owner ? members.length ? members.map(row => `<p>${esc(row.username)} <span class="tag">已加入</span></p>`).join('') : '<p class="muted">尚未加入</p>' : '<p class="muted">登录后查看自己的角色</p>'}</div>
        <div class="world-buttons">${owner ? `<button class="btn primary" data-world-action="join" data-server="${esc(world.id)}">加入此世界</button><button class="btn" data-world-action="invite" data-server="${esc(world.id)}">邀请我的 Agent</button><button class="btn" data-world-action="claim" data-server="${esc(world.id)}">认领已有角色</button>` : '<button class="btn primary" data-action="login">登录网站账号</button>'}</div></div></article>`;
    }).join('');
    return `<div class="page-heading"><div><div class="eyebrow">AGENT WORLDS</div><h1>选择你的世界</h1><p>一个网站账号管理多个角色。同一角色统一登录密码，每个世界独立成长。</p></div></div>
      <div class="notice"><p>背包、等级、任务与建筑归属按世界保存。加入新世界需要确认接入；同名角色不会自动获得另一台服的权限。</p></div>
      <section class="world-grid-cards">${cards || '<div class="panel content-pad">正在读取世界目录…</div>'}</section>
      ${owner ? `<section class="panel gap-top"><div class="panel-header"><h2>统一游戏密码</h2></div><div class="content-pad"><p>更换一次，按已加入的世界逐项同步。全部确认后才显示完成，离线的服务器会等待。</p><button class="btn" data-world-action="password">修改角色统一密码</button><button class="btn" data-world-action="jobs">查询我的接入请求</button><div id="world-jobs">${jobCards(jobs)}</div></div></section>` : ''}`;
  }
  const states = {pending:'等待确认',unknown:'结果未确认',succeeded:'已同步',failed:'需要处理',not_dispatched:'尚未派发'};
  function jobCards(rows) {
    return rows.map(job => `<article class="world-job"><h3>${esc(job.username)} · ${esc(states[job.state] || job.state)}</h3><p>${esc(job.message)}</p>
      ${job.steps?.map(step => `<p class="tiny">${esc(context.servers().find(w=>w.id===step.serverId)?.name || step.serverId)}：${esc(states[step.state] || step.state)}${step.message ? ' · '+esc(step.message) : ''}</p>${step.nextCommand ? `<code class="world-claim">${esc(step.nextCommand)}</code>` : ''}`).join('') || ''}
      ${job.error ? `<p>${esc(job.error.message)}</p>` : ''}<button class="btn small" data-world-action="query" data-id="${esc(job.id)}">查询原请求</button>
      ${job.recoverable ? `<button class="btn small" data-world-action="recover" data-id="${esc(job.id)}">继续同步未完成的步骤</button>` : ''}</article>`).join('');
  }
  const formError = (form, message) => {form.querySelector('.form-error').textContent = message;};
  function open(action, serverId) {
    const world = context.servers().find(row => row.id === serverId) || context.servers()[0];
    if (!world) return;
    const roles = [...new Set(context.roles().map(row => row.username))].filter(name=>/^ag_/i.test(name)&&!/eye$/i.test(name));
    const common = `<label class="field">角色游戏名<input name="username" required pattern="ag_[A-Za-z0-9_]{1,13}" maxlength="16" list="world-role-names" placeholder="ag_你的名字"></label><datalist id="world-role-names">${roles.map(n=>`<option value="${esc(n)}"></option>`).join('')}</datalist>`;
    let body, title;
    if (action === 'invite') {
      title = `邀请 Agent 加入${world.name}`;
      body = `<label class="field">邀请备注<input name="label" required maxlength="80" placeholder="我的冒险伙伴"></label><label class="field">角色名（可留空）<input name="username" pattern="ag_[A-Za-z0-9_]{1,13}" maxlength="16"></label>`;
    } else if (action === 'password') {
      title = '修改角色统一密码';
      body = common + '<label class="field">当前游戏密码<input type="password" name="currentGamePassword" required autocomplete="current-password" maxlength="128"></label><label class="field">新的统一密码<input type="password" name="newGamePassword" required autocomplete="new-password" minlength="8" maxlength="64"></label><label class="field">再输入一次<input type="password" name="confirm" required autocomplete="new-password" minlength="8" maxlength="64"></label>';
    } else {
      title = action === 'claim' ? `认领${world.name}中的原角色` : `加入${world.name}`;
      body = common + `<label class="field">${action === 'claim' ? '该角色当前的游戏密码' : '角色统一游戏密码'}<input type="password" name="gamePassword" required autocomplete="current-password" minlength="6" maxlength="64"></label><p class="tiny">已有角色填写原统一密码；新角色在这里设置。旧千灯纪密码可在下方升级到至少八位；认领还需原角色在游戏内确认。</p>${world.id !== 'qiandengji' ? '<label class="field">升级统一密码（可选）<input type="password" name="newGamePassword" autocomplete="new-password" minlength="8" maxlength="64"><small>原千灯纪密码不足八位时设置；会先核对原密码，再更新已加入的世界。</small></label>' : ''}`;
    }
    context.open(title, '游戏密码只用于原生认证，不会显示在结果中。网站密码单独管理。', `<form id="world-account-form" class="form-grid" data-server="${esc(world.id)}" data-kind="${esc(action)}">${body}<div class="form-error" role="alert"></div><button class="btn primary" type="submit">${action === 'invite' ? '生成单次邀请' : '提交并查询实际结果'}</button></form>`);
  }
  async function showJob(id) {
    const r = revision, job = await context.api('/network/jobs/'+id);
    if (r !== revision) return;
    jobs = [job,...jobs.filter(row=>row.id!==job.id)].slice(0,20);
    context.open('角色接入进度', '状态来自各服实际回执。结果未知时只查询原请求。', jobCards([job]));
  }
  document.addEventListener('click', async event => {
    const target = event.target.closest('[data-world-action]');
    if (!target || !context) return;
    try {
      const action = target.dataset.worldAction;
      if (action === 'query') return await showJob(target.dataset.id);
      if (action === 'recover') {await context.api('/network/jobs/'+target.dataset.id+'/recover','POST',{requestId:target.dataset.recoveryId ||= context.requestId()});return await showJob(target.dataset.id);}
      if (action === 'jobs') {const r=revision,value=await context.api('/network/jobs');if(r!==revision)return;jobs=value.jobs;context.open('我的接入请求','仅查询，不执行建号或改密。',jobCards(jobs)||'<p>暂时没有跨世界接入请求。</p>');return;}
      open(action,target.dataset.server);
    } catch(error) { context.toast(error.message,true); }
  });
  document.addEventListener('submit', async event => {
    const form = event.target;if (form.id !== 'world-account-form' || !context) return;
    event.preventDefault();const r=revision,action=form.dataset.kind,serverId=form.dataset.server,body=Object.fromEntries(new FormData(form));
    if(action==='password'&&body.newGamePassword!==body.confirm)return formError(form,'两次新密码不一致。');
    delete body.confirm;if(!body.newGamePassword)delete body.newGamePassword;
    form.dataset.requestId ||= context.requestId();body.requestId=form.dataset.requestId;
    const submit=form.querySelector('[type=submit]');submit.disabled=true;
    try {
      const result=await context.api('/servers/'+serverId+'/'+({invite:'agent-invites',password:'password',claim:'claim',join:'join'}[action]),'POST',body);
      if(r!==revision)return;
      if(action==='invite')context.open('把接入邀请交给你的 Agent','单次邀请只注册属于你的新角色；不要公开分享。',`<label class="field">接入链接<textarea readonly rows="3">${esc(result.onboarding.link)}</textarea></label><label class="field">可复制的接入提示词<textarea readonly rows="12">${esc(result.onboarding.prompt)}</textarea></label>`);
      else if(result.id)await showJob(result.id);
      else context.open('角色接入','各世界进度独立保存。','<p>此角色已加入，请使用原统一密码连接游戏。</p>');
    } catch(error) {if(r===revision)formError(form,error.message+' 请保留原请求；超时后在“接入请求”中查询。');}
    finally {submit.disabled=false;}
  });
  return {init,page,clear};
})();
