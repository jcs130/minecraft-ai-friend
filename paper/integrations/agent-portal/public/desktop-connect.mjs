const at = id => document.getElementById(id);
const base = '/api/v1/desktop-devices';
const flow = location.hash.slice(1);
const preferred = new URLSearchParams(location.search).get('character');
const modeLabel = {maid:'车万女仆', numen:'玩家模式（Numen）', mineflayer:'玩家模式', villager:'村民'};
let session, preview, busy = false;

async function request(path, payload) {
  const response = await fetch(path, {
    method:payload === undefined ? 'GET' : 'POST',
    headers:payload === undefined ? {} : {'Content-Type':'application/json','X-CSRF-Token':session?.csrfToken ?? ''},
    body:payload === undefined ? undefined : JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.message), {code:data.reason ?? data.error});
  return data;
}

const errors = {
  DESKTOP_CODE_INVALID:'六位码不符，请核对插件上的数字。',
  DESKTOP_FLOW_ENDED:'授权申请已结束，请从 N.E.K.O. 重新打开。',
  DESKTOP_CHARACTER_UNAVAILABLE:'角色归属或状态已变化，请重新打开授权页。',
  CSRF_REQUIRED:'网页登录状态已更新，请刷新此页。',
  LOGIN_FAILED:'网站用户名、邮箱或密码有误。',
};
const report = error => { at('message').textContent = errors[error.code] || '连接未完成，请重试。'; };

function selection() {
  const row = preview?.characters.find(c => c.id === at('character').value);
  at('binding').textContent = row ? '原游戏身体 UUID · ' + row.bodyId : '';
  at('migration').hidden = !row?.legacy;
  at('migrate').checked = false;
  at('approve').disabled = !row;
  return row;
}

async function load() {
  session = await request('/api/v1/session');
  at('login').hidden = !!session.owner;
  if (!session.owner) {
    at('message').textContent = '请登录千灯纪官网。';
    return;
  }
  at('message').textContent = '当前账号 · ' + session.owner.username;
  if (flow) {
    preview = await request(base + '/flows/' + encodeURIComponent(flow));
    at('device').textContent = '设备 · ' + preview.device;
    at('character').replaceChildren(...preview.characters.map(c => new Option(c.name + ' · ' + (modeLabel[c.bodyKind] ?? c.bodyKind), c.id)));
    const last = preview.characters.find(c => c.characterId === preferred);
    if (last) at('character').value = last.id;
    at('cross-device').hidden = !preview.codeRequired;
    at('code').required = preview.codeRequired;
    at('consent').hidden = false;
    if (!selection()) at('message').textContent += '。当前没有可授权的角色。';
  } else {
    at('title').textContent = '千灯纪设备授权';
    at('manage').hidden = true;
    const data = await request(base);
    at('device-list').replaceChildren(...data.devices.map(row => {
      const li = document.createElement('li');
      li.append(document.createTextNode(row.name + ' · ' + row.device + (row.active ? ' ' : ' · 已失效')));
      if (row.active) {
        const button = document.createElement('button');
        button.textContent = '撤销';
        button.onclick = () => act(async () => {
          await request(base + '/revoke', {id:row.id});
          await load();
        });
        li.append(button);
      }
      return li;
    }));
    if (!data.devices.length) at('message').textContent += '。当前没有已授权设备。';
    at('devices').hidden = false;
  }
}

async function act(fn) {
  if (busy) return;
  busy = true;
  try { await fn(); } catch (error) { report(error); } finally { busy = false; }
}

at('character').onchange = selection;
at('login').onsubmit = event => {
  event.preventDefault();
  const form = event.currentTarget;
  void act(async () => {
    await request('/api/v1/sessions', Object.fromEntries(new FormData(form)));
    form.reset(); await load();
  });
};
at('consent').onsubmit = event => {
  event.preventDefault();
  void act(async () => {
    const row = preview.characters.find(c => c.id === at('character').value);
    if (!row) return;
    const result = await request(base + '/approve', {id:flow, role:row.id, characterId:row.characterId,
      migrate:at('migrate').checked, ...(preview.codeRequired ? {code:at('code').value} : {})});
    at('consent').hidden = true;
    at('message').textContent = '授权已完成，可以返回 N.E.K.O.。';
    history.replaceState(null,'',location.pathname);
    if (result.redirect && /^http:\/\/127\.0\.0\.1:[1-9]\d{3,4}\/qd-desktop\/callback\?/.test(result.redirect))
      location.replace(result.redirect);
  });
};
window.addEventListener('focus', () => { if (!session?.owner && !busy) void act(load); });
window.addEventListener('hashchange', () => { if (location.hash.slice(1) !== flow) location.reload(); });
void act(load);
