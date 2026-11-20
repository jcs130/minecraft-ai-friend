const get = id => document.getElementById(id);
const login = get('login');
const approve = get('approve');
const status = get('status');
const prefix = '/maid-connect';
const candidate = new URLSearchParams(location.hash.slice(1)).get('request');
let request = /^[a-f0-9-]{36}$/.test(candidate || '') ? candidate : null;
let session;

async function api(path, method = 'GET', body) {
  const response = await fetch('/api/v1' + path, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken },
    body: body && JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || '请求未完成，请稍后重试。');
  return result;
}

async function showConnections() {
  const { connections } = await api(prefix);
  const list = get('connections');
  list.replaceChildren();
  get('empty').hidden = connections.length !== 0;
  for (const row of connections) {
    const item = document.createElement('li');
    const title = document.createElement('span');
    title.textContent = row.name + ' · ' + new Date(row.expiresAt).toLocaleString() + ' 到期';
    const revoke = document.createElement('button');
    revoke.type = 'button';
    revoke.textContent = '撤销授权';
    revoke.setAttribute('aria-label', '撤销 ' + row.name + ' 的授权');
    revoke.addEventListener('click', async () => {
      revoke.disabled = true;
      try {
        await api(prefix + '/' + row.id, 'DELETE');
        status.textContent = '已撤销授权。';
        await showConnections();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        revoke.disabled = false;
      }
    });
    item.append(title, revoke);
    list.append(item);
  }
  get('management').hidden = false;
}

async function display() {
  login.hidden = !!session.owner;
  approve.hidden = true;
  get('management').hidden = true;
  status.textContent = session.owner ? '当前网站账号为 ' + session.owner.username + '。' : '请使用已有的千灯纪网站账号登录。';
  if (!session.owner) return;
  await showConnections();
  if (!request) return;
  const preview = await api(prefix + '/requests/' + request);
  if (!preview.maids.length) {
    status.textContent = '此账号没有可连接的女仆。请核对网站绑定的游戏角色，或请服主启用该女仆。';
    return;
  }
  approve.elements.maidId.replaceChildren(...preview.maids.map(row => new Option(row.name, row.id)));
  approve.hidden = false;
}

login.addEventListener('submit', async event => {
  event.preventDefault();
  const button = login.querySelector('button');
  button.disabled = true;
  try {
    session = await api('/sessions', 'POST', Object.fromEntries(new FormData(login)));
    login.reset();
    await display();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

approve.addEventListener('submit', async event => {
  event.preventDefault();
  const button = approve.querySelector('button');
  button.disabled = true;
  try {
    const body = Object.fromEntries(new FormData(approve));
    body.confirmationCode = body.confirmationCode.toUpperCase();
    const result = await api(prefix + '/requests/' + request, 'POST', body);
    request = null;
    history.replaceState(null, '', location.pathname);
    approve.reset();
    approve.hidden = true;
    status.textContent = '已授权连接 ' + result.name + '。请返回 N.E.K.O. 查看连接状态。';
    await showConnections();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

try {
  session = await api('/session');
  await display();
} catch (error) {
  status.textContent = error.message;
}
