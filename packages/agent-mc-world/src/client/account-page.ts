/** Small human-only surface also included in engine builds without viewer assets. */
export const accountPage = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Minecraft 账户与连接</title><link rel="stylesheet" href="/account.css">
<main><h1>Minecraft 账户与连接</h1><p>此页绑定一个执行器。授权码仅显示在本机人工页面；请勿复制到聊天或直播。</p>
<p id="status" role="status">正在核对执行器…</p><p id="server"></p><p id="account"></p><p id="profile"></p>
<section id="challenge" hidden><a id="verification" target="_blank" rel="noreferrer noopener">打开微软官方授权页</a>
<p>输入设备码：<strong id="code"></strong></p><p id="expiry"></p></section>
<button id="connect" disabled>连接 / 开始微软授权</button><button id="disconnect" disabled>取消授权 / 断开当前连接</button>
<button id="refresh">刷新账户状态</button><p id="receipt" role="status"></p>
<p>离线昵称仅用于允许离线登录的服务器。Microsoft 模式使用已授权的 Java 账号，不会失败后切换为离线。</p>
<p>取消会断开此执行器的游戏连接，不会注销微软账户或删除原生授权缓存。需要暂停自主运行时，请使用插件的停止游玩。</p>
<p>外观：Web 观战的 YUI slim / YSM / 跟随服务器只影响网页显示。服务器和其他玩家看到的皮肤由服务器或正版账号决定；本页没有全局皮肤修改权限。</p>
</main><script src="/account.js"></script></html>`;

export const accountCss = `body{font:16px/1.6 system-ui;background:#111827;color:#e5e7eb;margin:0}main{max-width:720px;margin:32px auto;padding:24px}a{color:#93c5fd}button{padding:10px;margin:6px;font:inherit}strong{font-size:24px}section{padding:16px;border:1px solid #64748b}[hidden]{display:none}`;

export const accountScript = `(() => {
  const expected = location.pathname.split('/')[2];
  const el = id => document.getElementById(id);
  let state, busy = false;
  const clear = () => { state = null; el('challenge').hidden = true; el('code').textContent = ''; el('verification').removeAttribute('href'); el('connect').disabled = el('disconnect').disabled = true; };
  const official = value => {
    try { const u = new URL(value); return u.protocol === 'https:' && ['microsoft.com','www.microsoft.com','login.microsoftonline.com'].includes(u.hostname) && !u.username && !u.password && !u.search && !u.hash ? u.href : null; } catch { return null; }
  };
  async function refresh() {
    try {
      const reply = await fetch('/api/client', {cache:'no-store', headers:{'x-mc-instance':expected}});
      const next = await reply.json();
      if (!reply.ok || next.instanceId !== expected || next.schema !== 'minecraft-client-console/v1') throw Error();
      state = next;
      const c = state.connection || {}, a = c.accounts?.agent, server = c.server || {};
      el('status').textContent = '执行器：' + state.runtime.phase + ' · 账户：' + (a?.phase || '尚未开始 / 此执行器无账户状态');
      el('server').textContent = '服务器：' + (server.host || '') + ':' + (server.port || '') + ' · 请求 Java ' + (server.requestedVersion || '未知') + ' · 实际版本 ' + (server.actualVersion || '未连接');
      el('account').textContent = (state.configuredAuthentication?.agent === 'microsoft' ? 'Microsoft 授权账户标识：' : '离线昵称：') + (state.configuredAccounts?.agent || '未配置');
      el('profile').textContent = a?.profile ? '实际已授权角色：' + a.profile.name + ' · ' + a.profile.uuid : (a?.detail || '尚无已验证的正版角色');
      el('challenge').hidden = true; el('code').textContent = ''; el('verification').removeAttribute('href');
      const challenge = a?.challenge, uri = official(challenge?.verificationUri);
      if (challenge && uri && /^[A-Z0-9-]{4,24}$/i.test(challenge.userCode) && Date.parse(challenge.expiresAt) > Date.now()) {
        el('challenge').hidden = false; el('code').textContent = challenge.userCode;
        el('verification').href = uri; el('expiry').textContent = '有效期至 ' + new Date(challenge.expiresAt).toLocaleString() + '；过期后取消并重新连接。';
      }
      el('connect').disabled = busy || state.runtime.phase !== 'disconnected';
      el('disconnect').disabled = busy || state.runtime.phase === 'disconnected';
      el('receipt').textContent = Object.entries(state.operations || {}).map(([action, result]) => action + ': ' + result.status).join(' · ');
    } catch { clear(); el('status').textContent = '账户接口不可用或执行器已更换。请回插件刷新入口；没有发起连接。'; }
  }
  async function act(action) {
    if (!state || busy || state.instanceId !== expected) return;
    busy = true; el('connect').disabled = el('disconnect').disabled = true;
    try {
      const response = await fetch('/api/client/action', {method:'POST', headers:{'content-type':'application/json','x-mc-control':state.controlToken,'x-mc-instance':expected}, body:JSON.stringify({action})});
      if (!response.ok) throw Error();
      el('receipt').textContent = '请求已受理；等待实际账户与连接状态。';
    } catch { clear(); el('receipt').textContent = '操作未确认，请刷新后核对状态。'; }
    finally { busy = false; await refresh(); }
  }
  el('connect').onclick = () => act('connect'); el('disconnect').onclick = () => act('disconnect'); el('refresh').onclick = refresh;
  setInterval(() => { if (!document.hidden && !busy) void refresh(); }, 2000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); else void refresh(); });
  void refresh();
})();`;
