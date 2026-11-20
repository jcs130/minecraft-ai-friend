export default {panels: {pair: {async mount(ctx) {
  const {root} = ctx;
  root.innerHTML = `
    <p class="resident-status" role="status"></p>
    <form class="authorize">
      <p><a class="official" target="_blank" rel="noopener noreferrer">打开千灯纪官网获取授权码 ↗</a></p>
      <label>官网授权码 <input name="code" type="password" required maxlength="14" autocomplete="off" spellcheck="false"></label>
      <button>授权本机插件</button>
    </form>
    <section class="choices" hidden>
      <label>接入方式 <select name="flow"><option value="connect">连接已有角色</option><option value="create">新建角色</option></select></label>
      <label>身体 <select name="body"><option value="maid">车万女仆</option><option value="numen">Numen</option></select></label>
      <p class="availability"></p>
      <form class="create" hidden>
        <p><label>角色名 <input name="name" maxlength="24" required></label></p>
        <p><label>人设（选填）<textarea name="persona" maxlength="1000" rows="3"></textarea></label></p>
        <button>创建角色</button>
      </form>
      <form class="connect" hidden>
        <label>你的居民 <select name="resident"></select></label>
        <button>连接这个角色</button>
      </form>
      <button class="refresh" type="button">刷新角色列表</button>
    </section>
    <details><summary>使用已有的居民连接码</summary><form class="legacy">
      <label>居民连接码 <input name="code" type="password" required maxlength="14" autocomplete="off" spellcheck="false"></label>
      <button>连接居民</button>
    </form></details>`;
  const el = selector => root.querySelector(selector);
  const status = el('.resident-status'), body = el('[name=body]'), flow = el('[name=flow]'), role = el('[name=resident]');
  let list, selected, timer, disposed = false, busy = false;
  let setup;
  try { setup = await ctx.invoke('status'); }
  catch { status.textContent = '请启用千灯纪居民 World 后重新打开。'; return; }
  el('.official').href = new URL('/resident-connect.html?flow=authorize', setup.origin).href;
  status.textContent = setup.name ? '已配对 ' + setup.name + (setup.connected ? '，官网连接正常。' : '，正在等待官网连接。') : '先到官网授权，再在此选择已有角色或创建新角色。';
  function render() {
    clearTimeout(timer);
    if (!list || disposed) return;
    el('.authorize').hidden = true; el('.choices').hidden = false;
    const creating = flow.value === 'create';
    const residents = list.residents.filter(r => r.bodyKind === body.value);
    const resident = residents.find(r => r.id === selected) || residents[0];
    const retry = list.pendingBirth?.bodyKind === body.value ? list.pendingBirth : null;
    const hasCapacity = list.availableBodies.includes(body.value);
    el('.create').hidden = !creating || !(hasCapacity || retry);
    el('.connect').hidden = creating || !resident;
    const isReady = resident?.state === 'available';
    el('.connect button').disabled = !isReady;
    if (creating) {
      el('[name=name]').readOnly = el('[name=persona]').readOnly = !!retry;
      if (retry) {el('[name=name]').value = retry.name; el('[name=persona]').value = retry.persona;}
      el('.create button').textContent = retry ? '继续上次创建' : '创建角色';
      el('.availability').textContent = retry ? '已有未确认的创建请求，可重试同一角色。' : hasCapacity ? '填写名字和人设后创建。' : '这种身体暂时没有空位，可以稍后刷新或换一种身体。';
    } else {
      role.replaceChildren(...residents.map(r => {
        const option = root.ownerDocument.createElement('option'); option.value = r.id; option.textContent = r.name; return option;
      }));
      if (resident) { selected = resident.id; role.value = selected; }
      el('.availability').textContent = !resident ? '你还没有这种身体的居民，可以切换身体或新建角色。' : isReady
        ? '连接后，旧插件会退出该居民的控制。' : '正在准备身体，准备完成后即可连接。';
      if (resident && !isReady) timer = setTimeout(() => run(refresh), 2500);
    }
  }
  async function refresh() {
    list = await ctx.invoke('list');
    render();
  }
  async function run(fn) {
    if (busy || disposed) return;
    busy = true;
    const controls = [...root.querySelectorAll('button, select')].filter(x => !x.disabled);
    controls.forEach(x => {x.disabled = true;});
    try { await fn(); }
    catch (err) {
      status.textContent = err?.message || '官网请求未完成，请重试。';
      const current = await ctx.invoke('status').catch(() => null);
      if (current && !current.authorized) {list = null; el('.authorize').hidden = false; el('.choices').hidden = true;}
    } finally { busy = false; controls.forEach(x => {x.disabled = false;}); render(); }
  }
  function submit(selector, fn) {
    el(selector).onsubmit = event => { event.preventDefault(); void run(fn); };
  }
  function takeCode(form) {
    const box = el(form + ' input'); const code = box.value.trim().toUpperCase(); box.value = ''; return code;
  }
  function connected(r) {
    status.textContent = '已配对 ' + (r.name || '居民') + '。';
    list = null; clearTimeout(timer); el('.choices').hidden = true; el('.authorize').hidden = false;
  }
  submit('.authorize', async () => {
    await ctx.invoke('authorize', [takeCode('.authorize')]);
    status.textContent = '官网已授权，请选择接入方式和身体。';
    await refresh();
  });
  submit('.legacy', async () => connected(await ctx.invoke('pair', [takeCode('.legacy')])));
  submit('.create', async () => {
    const profile = {bodyKind:body.value, name:el('[name=name]').value.trim(), persona:el('[name=persona]').value.trim()};
    try {
      const {resident} = await ctx.invoke('create', [profile]);
      status.textContent = '已创建 ' + resident.name + '。';
      list.residents = [...list.residents.filter(r => r.id !== resident.id), resident];
      selected = resident.id; flow.value = 'connect';
      el('[name=name]').value = el('[name=persona]').value = '';
    } finally { await refresh(); }
  });
  submit('.connect', async () => {
    const r = list.residents.find(r => r.id === role.value);
    if (r?.state === 'available') connected(await ctx.invoke('connect', [{id:r.id, characterId:r.characterId}]));
  });
  el('.refresh').onclick = () => run(refresh);
  role.onchange = () => { selected = role.value; render(); };
  flow.onchange = body.onchange = () => {selected = null; el('[name=name]').value = el('[name=persona]').value = ''; render();};
  if (setup.authorized) await run(refresh);
  return {dispose() { disposed = true; clearTimeout(timer); }};
}}}};
