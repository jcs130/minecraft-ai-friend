const api = '/api/v1/resident-turns';
const form = document.querySelector('form'), role = document.querySelector('#role');
const status = document.querySelector('#status'), result = document.querySelector('#result');
let csrf;
async function request(url, method = 'GET') {
  const response = await fetch(url, {method, headers: csrf ? {'X-CSRF-Token': csrf} : {}, cache: 'no-store'});
  if (!response.ok) throw Error('请求未完成，请刷新页面后重试。');
  return response.json();
}
async function load() {
  const session = await request('/api/v1/session');
  if (!session.owner) {
    status.textContent = '登录后可以选择你拥有的居民。';
    document.querySelector('#login').hidden = false;
    return;
  }
  csrf = session.csrfToken;
  const {residents} = await request(api);
  for (const r of residents) role.add(new Option(r.name + ' · ' + (r.bodyKind === 'maid' ? '车万女仆' : 'Numen'), r.id));
  form.hidden = !residents.length;
  status.textContent = residents.length ? '选择角色后，把连接文件交给本机对应的 Agent。重新签发会结束旧连接。' : '当前账号没有已开放接入的居民。';
}
async function grant(release) {
  const buttons = [...form.querySelectorAll('button')];
  buttons.forEach(b => b.disabled = true);
  try {
    const data = await request(api + '/' + role.value + '/grant', release ? 'DELETE' : 'POST');
    if (!release) {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], {type: 'application/json'}));
      const a = document.createElement('a');
      a.href = url; a.download = 'resident-session.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
    result.textContent = release ? '已撤销。后续决策由服务器托管。' : '连接文件已生成，里面的凭据仅供所选居民使用。';
  } catch (e) { result.textContent = e.message; }
  finally { buttons.forEach(b => b.disabled = false); }
}
form.onsubmit = event => { event.preventDefault(); void grant(false); };
document.querySelector('#release').onclick = () => void grant(true);
load().catch(e => status.textContent = e.message);
