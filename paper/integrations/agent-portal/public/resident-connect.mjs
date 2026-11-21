import {bodyHandoffPanel} from './character-bodies.mjs';

const byId = id => document.getElementById(id);
const api = '/api/v1/resident-turns';
const params = new URLSearchParams(location.search);
const legacy = ['create', 'connect'].includes(params.get('flow'));
const browserLogin = params.get('flow') === 'browser';
const bodyManagement = params.get('flow') === 'bodies';
const playerDisclosure = byId('player-authorization');
const sharedPlay = browserLogin && params.get('play') === '1' && !!playerDisclosure;
const bodyRead = browserLogin && params.get('bodyRead') === '1' && byId('body-view-permission');
if (bodyRead) byId('body-view-permission').hidden = false;
const browserId = location.hash.slice(1);
const bodies = {maid: '车万女仆', numen: 'Numen'};
const flow = byId('flow'), kind = byId('kind'), role = byId('role');
const status = byId('status'), result = byId('result');
let session, catalog, loading, poll, expiry, busy = false, selected = params.get('resident');
const drafts = new Map();
const handoff = bodyHandoffPanel(byId, request);

flow.value = params.get('flow') === 'create' ? 'create' : 'connect';
if (bodyManagement) {
  byId('title').textContent = '管理角色身体';
  byId('intro').textContent = '查看你的角色、切换可用身体，或按原请求编号确认结果。';
}
kind.value = params.get('bodyKind') === 'numen' ? 'numen' : 'maid';
if (legacy) {
  byId('title').textContent = '连接居民身体';
  byId('intro').textContent = '选择车万女仆或 Numen，获取仅供这个居民使用的连接码。';
}
if (sharedPlay) {
  byId('title').textContent = '授权千灯纪游戏插件';
  byId('intro').textContent = '登录一次，在 N.E.K.O. 里选择居民或 Mineflayer 玩家模式。';
  playerDisclosure.hidden = false;
}

const errors = {
  INVALID_BROWSER_LOGIN: '数字有误，请核对本机插件里的 6 位数字。',
  MAID_ONLY: '新建角色使用车万女仆。已有 Numen 可从居民列表连接。',
  BROWSER_LOGIN_EXPIRED: '请求已失效，请回到插件重新打开网页登录。',
  INVALID_RESIDENT_PROFILE: '请检查角色名和人设。名字最多 24 个文字、数字、空格、短横线、下划线或间隔号。',
  NO_BODY_CAPACITY: '这种身体暂时没有空位，可稍后刷新或选择另一种身体。',
  RESIDENT_LIMIT: '这个账号已经达到新建居民上限，可以连接已有角色。',
  RESIDENT_NOT_OWNED: '当前账号无法连接这个角色，请刷新角色列表。',
  RESIDENT_NOT_READY: '身体正在准备，准备好后可以领取连接码。',
  CREATION_REQUEST_CHANGED: '上次提交的角色资料与当前资料不同，请刷新后查看已有角色。',
  LOGIN_FAILED: '网站用户名、邮箱或密码有误。',
  LOGIN_REQUIRED: '请重新登录后继续。'
};
async function request(url, method = 'GET', body) {
  const res = await fetch(url, {method, cache:'no-store', headers: {
    ...(session?.csrfToken && method !== 'GET' ? {'X-CSRF-Token':session.csrfToken} : {}),
    ...(body ? {'Content-Type':'application/json'} : {})
  }, ...(body ? {body:JSON.stringify(body)} : {})});
  const data = await res.json();
  if (!res.ok) throw Object.assign(Error(errors[data.error?.reason] || '网站暂未完成请求，请重试。'), {
    reason: data.error?.reason, status: res.status
  });
  return data;
}
function draftKey() { return 'qd.resident.birth.' + session.owner.id + '.' + kind.value; }
function getDraft() {
  const key = draftKey();
  try { return JSON.parse(sessionStorage.getItem(key)) || drafts.get(key); }
  catch { return drafts.get(key); }
}
function setDraft(data) {
  const key = draftKey();
  if (data) drafts.set(key, data); else drafts.delete(key);
  try { if (data) sessionStorage.setItem(key, JSON.stringify(data)); else sessionStorage.removeItem(key); }
  catch { /* The same request can still be retried while this page stays open. */ }
}
function clearCode() {
  clearTimeout(expiry);
  byId('code').value = '';
  byId('delivery').hidden = true;
}
function displayCode(data, account) {
  clearCode();
  byId('code-title').textContent = account ? '插件授权码' : '居民连接码';
  byId('code').value = data.code;
  byId('delivery').hidden = false;
  byId('expires').textContent = '请在 ' + new Date(data.expiresAt).toLocaleTimeString('zh-CN') +
    ' 前复制到本机插件的' + (account ? '官网授权' : '居民连接码') + '输入框，每个码仅可使用一次。';
  expiry = setTimeout(() => { clearCode(); result.textContent = '此码已过期，请重新获取。'; }, Math.max(0, data.expiresAt - Date.now()));
}
function updateUrl() {
  const url = new URL(location.href);
  url.searchParams.set('flow',flow.value);
  url.searchParams.set('bodyKind',kind.value);
  if (flow.value === 'connect' && selected) url.searchParams.set('resident', selected);
  else url.searchParams.delete('resident');
  history.replaceState(null,'',url);
}
function render() {
  clearTimeout(poll);
  if (!catalog || !session?.owner || !legacy) return;
  const creating = flow.value === 'create';
  const maidOnly = creating && catalog.creationMode === 'maid-only';
  byId('kind-label').hidden = maidOnly;
  byId('kind-caption').textContent = creating ? '新角色身体' : '按身体类型筛选居民';
  if (maidOnly) kind.value = 'maid';
  const residents = catalog.residents.filter(r => r.bodyKind === kind.value);
  const current = residents.find(r => r.id === selected) || residents[0];
  const pending = creating && getDraft();
  const capacity = catalog.availableBodies.includes(kind.value);
  const available = byId('availability');
  const ready = current?.state === 'available';
  handoff.select(creating ? null : session.owner.id, ready ? current.characterId : null);
  byId('create').hidden = !creating || !(capacity || pending);
  byId('existing').hidden = creating || !current;
  byId('refresh').hidden = creating ? capacity && !pending : ready;
  if (creating) {
    byId('name').readOnly = byId('persona').readOnly = !!pending;
    if (pending) { byId('name').value = pending.name; byId('persona').value = pending.persona; }
    byId('create-button').textContent = pending ? '继续上次创建' : '创建角色';
    available.textContent = pending ? '上次的创建请求已保存，可继续确认同一角色。'
      : capacity ? '给新' + bodies[kind.value] + '取一个名字。'
      : '当前账号暂无可分配的' + bodies[kind.value] + '身体名额。';
  } else {
    role.replaceChildren(...residents.map(r => new Option(r.name + (r.state === 'preparing' ? ' · 准备中' : ''), r.id)));
    if (current) { selected = current.id; role.value = selected; }
    byId('role-code').disabled = byId('download').disabled = byId('release').disabled = !ready;
    available.textContent = !current ? '当前账号还没有这种身体的居民。可查看其他类型的居民或新建角色。'
      : ready ? '把连接码填入本机插件。兑换后，原有插件连接将结束。'
      : '正在为「' + current.name + '」准备身体，页面会自动更新。';
    if (current && !ready) poll = setTimeout(() => { refresh().catch(report); }, 2500);
  }
}
async function refresh() {
  catalog = await request(api);
  render();
}
async function load() {
  if (loading) return loading;
  loading = (async () => {
    session = await request('/api/v1/session');
    byId('login').hidden = !!session.owner;
    const nekoSignIn = byId('neko-portal-signin');
    if (nekoSignIn) nekoSignIn.hidden = session.nekoAuth?.available !== true;
    byId('authorize').hidden = !session.owner || legacy || browserLogin || bodyManagement;
    byId('browser-approve').hidden = !session.owner || !browserLogin;
    byId('legacy').hidden = !session.owner || !legacy;
    if (!session.owner) {
      handoff.select(null, null);
      clearTimeout(poll); clearCode(); catalog = null;
      status.textContent = '请先登录千灯纪官网。';
      return;
    }
    status.textContent = '当前账号 · ' + session.owner.username;
    if (bodyManagement) handoff.select(session.owner.id, null);
    if (legacy) {
      await refresh();
      if (!params.has('bodyKind') && flow.value === 'connect' && catalog.residents[0]) {
        kind.value = catalog.residents[0].bodyKind; render();
      }
    }
  })().finally(() => { loading = null; });
  return loading;
}
function report(error) {
  result.textContent = error.status ? error.message : '连接中断，请重试。已提交的新建请求可以继续确认。';
  if (error.reason === 'LOGIN_REQUIRED' || error.reason === 'CSRF_REQUIRED') load().catch(() => {});
  else if (!busy && role.value && byId('role-code').disabled && !byId('existing').hidden) {
    clearTimeout(poll); poll = setTimeout(() => refresh().catch(report), 5000);
  }
}
async function action(fn) {
  if (busy) return;
  busy = true; result.textContent = '';
  const controls = [...document.querySelectorAll('button, select')].filter(el => !el.disabled);
  controls.forEach(el => {el.disabled = true;});
  try { await fn(); }
  catch (error) { report(error); }
  finally { busy = false; controls.forEach(el => {el.disabled = false;}); render(); }
}
byId('login').onsubmit = event => {
  event.preventDefault();
  const fields = new FormData(event.currentTarget);
  void action(async () => {
    session = await request('/api/v1/sessions', 'POST', Object.fromEntries(fields));
    byId('login').reset();
    await load();
  });
};
window.addEventListener('focus', () => { if (session && !session.owner && !busy) load().catch(report); });
byId('browser-approve').onsubmit = event => {
  event.preventDefault();
  void action(async () => {
    await request('/api/v1/resident-onboarding/browser-approve', 'POST',
      {id:browserId, code:byId('browser-code').value, ...(sharedPlay ? {player:true} : {}),
        ...(bodyRead && byId('body-view-allowed').checked ? {bodyRead:true} : {})});
    byId('browser-code').value = '';
    byId('browser-approve').hidden = true;
    history.replaceState(null,'',location.pathname + location.search);
    result.textContent = '授权已完成，请关闭此页并返回插件，选择或创建游戏角色。';
  });
};
byId('authorize-code').onclick = () => action(async () => displayCode(await request('/api/v1/resident-onboarding/code', 'POST'), true));
function changeSelection() {
  selected = null; clearCode(); result.textContent = '';
  byId('name').value = ''; byId('persona').value = '';
  render(); updateUrl();
}
flow.onchange = kind.onchange = changeSelection;
role.onchange = () => { selected = role.value; clearCode(); result.textContent = ''; render(); updateUrl(); };
byId('refresh').onclick = () => action(refresh);
byId('create').onsubmit = event => {
  event.preventDefault();
  void action(async () => {
    let draft = getDraft();
    if (!draft) {
      draft = {requestId:crypto.randomUUID(), bodyKind:kind.value, name:byId('name').value.trim(), persona:byId('persona').value.trim()};
      setDraft(draft);
    }
    let data;
    try { data = await request(api, 'POST', draft); }
    catch (e) {
      if (['INVALID_RESIDENT_PROFILE','NO_BODY_CAPACITY','RESIDENT_LIMIT'].includes(e.reason)) { setDraft(null); await refresh(); }
      throw e;
    }
    catalog.residents = [...catalog.residents.filter(r => r.id !== data.resident.id), data.resident];
    selected = data.resident.id; flow.value = 'connect'; updateUrl(); setDraft(null);
    byId('name').value = byId('persona').value = '';
    await refresh();
    if (catalog.creationMode === 'maid-only') {
      result.textContent = '创建请求已保存。身体准备好后，在本机居民插件里授权并连接这个角色。';
    }
  });
};
byId('role-code').onclick = () => action(async () => displayCode(await request(api + '/' + role.value + '/code', 'POST'), false));
byId('copy').onclick = async () => {
  if (!byId('code').value) return;
  try { await navigator.clipboard.writeText(byId('code').value); result.textContent = '已复制，请返回插件粘贴。'; }
  catch { byId('code').focus(); byId('code').select(); result.textContent = '已选中，请使用系统复制。'; }
};
byId('download').onclick = () => action(async () => {
  const data = await request(api + '/' + role.value + '/grant', 'POST');
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], {type:'application/json'}));
  const link = document.createElement('a');
  link.href = url; link.download = 'resident-session.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  clearCode(); result.textContent = '已下载此居民的连接文件。';
});
byId('release').onclick = () => action(async () => {
  await request(api + '/' + role.value + '/grant', 'DELETE');
  clearCode(); result.textContent = '已撤销该居民的连接，后续决策由服务器托管。';
});
load().catch(report);
fetch('/api/v1/downloads', {credentials:'omit'}).then(async response => {
  if (!response.ok) return;
  const {packages} = await response.json();
  byId('install').hidden = !packages.some(row => row.category === 'resident' && row.available && row.url);
}).catch(() => {});
