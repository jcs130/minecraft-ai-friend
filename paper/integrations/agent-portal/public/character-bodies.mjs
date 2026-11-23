const api = '/api/v1/character-bodies';
const names = {numen:'Numen', maid:'车万女仆', villager:'村民', mineflayer:'Mineflayer 玩家'};
const messages = {
  SOURCE_NOT_READY:'原身体仍在使用。请稍后重新查看可选身体。',
  TARGET_NOT_READY:'目标身体暂未准备好。可以继续使用原身体。',
  SOURCE_RELEASE_UNCONFIRMED:'原身体的控制权交接仍需核实。',
  TARGET_ACQUIRE_UNCONFIRMED:'目标身体的控制权仍需核实。',
  SERVICE_RESTART:'交接期间服务重启，控制权仍需核实。'
};

export function bodyHandoffPanel(byId, request) {
  const section = byId('body-handoff'), target = byId('handoff-target');
  const confirm = byId('handoff-switch'), check = byId('handoff-check'), result = byId('handoff-result');
  const roles = byId('handoff-role');
  const device = byId('handoff-device'), deviceForm = byId('handoff-device-form');
  const deviceId = byId('handoff-device-id'), deviceStatus = byId('handoff-device-status');
  const deviceRevoke = byId('handoff-device-revoke');
  const drafts = new Map();
  let selected;

  function deviceControls(view) {
    if (!device) return;
    device.hidden = view?.state?.devicePairing !== true;
    deviceRevoke.disabled = deviceForm.querySelector('button').disabled = !!view?.deviceBusy;
  }
  async function deviceAction(action) {
    const view = selected;
    if (!view?.state?.devicePairing || view.deviceBusy) return;
    view.deviceBusy = true;
    deviceControls(view);
    deviceStatus.textContent = '';
    const body = {action,kind:'mineflayer'};
    if (action === 'approve') body.pairId = deviceId.value.trim();
    try {
      await request(api + '/' + encodeURIComponent(view.characterId) + '/device','POST',body);
      if (view === selected) {
        deviceId.value = '';
        deviceStatus.textContent = action === 'approve' ? '已授权，回到本机设备领取。' : '已撤销此角色的设备授权。';
      }
    } catch (error) {
      if (view === selected) deviceStatus.textContent = error.message || '无法确认操作，请刷新后查看。';
    } finally {
      view.deviceBusy = false;
      if (view === selected) deviceControls(view);
    }
  }
  if (deviceForm) {
    deviceForm.onsubmit = event => { event.preventDefault(); void deviceAction('approve'); };
    deviceRevoke.onclick = () => { void deviceAction('revoke'); };
  }

  function remember(view, draft) {
    view.draft = draft;
    if (draft) drafts.set(view.key, draft); else drafts.delete(view.key);
    try {
      if (draft) sessionStorage.setItem(view.key, JSON.stringify(draft)); else sessionStorage.removeItem(view.key);
    } catch { /* Tracking still works for this page while storage is unavailable. */ }
  }
  function controls(view) {
    if (view !== selected) return;
    const ready = view.state?.status === 'ready' && view.state.targetKinds.length > 0;
    deviceControls(view);
    byId('handoff-target-label').hidden = !ready || !!view.draft;
    confirm.hidden = view.retry ? false : !ready || !!view.draft;
    confirm.textContent = view.retry ? '重新提交原请求' : '确认切换';
    check.hidden = !view.draft && !view.refresh;
    check.textContent = view.draft ? '查看原请求' : '刷新身体状态';
    byId('handoff-receipt-id').textContent = view.draft ? '请求编号 ' + view.draft.requestId : '';
    target.disabled = confirm.disabled = check.disabled = !!view.busy;
  }
  async function refresh(view) {
    const data = await request(api);
    if (view !== selected) return;
    const matching = data.characters.find(row => row.characterId === view.characterId);
    view.state = matching ?? (view.targetKind && view.characterId ? null : data.characters[0]);
    const empty = byId('handoff-empty');
    const dedicated = !!empty && new URLSearchParams(location.search).get('flow') === 'bodies';
    section.hidden = dedicated && !view.state;
    if (dedicated) {
      empty.hidden = !section.hidden;
      empty.textContent = data.available
        ? (view.targetKind && view.characterId ? '当前账号无法管理此角色的身体。' : '当前账号还没有可管理身体的角色。')
        : '服务器尚未开放角色换身。';
    }
    if (!data.available || !view.state) {
      byId('handoff-current').textContent = data.available
        ? '这个账号暂时没有可换身的角色。'
        : '服务器尚未开放角色自主换身。';
      if (roles) byId('handoff-role-label').hidden = true;
      view.refresh = false;
      controls(view);
      return;
    }
    if (view.state.characterId !== view.characterId) {
      view.characterId = view.state.characterId;
      view.key = keyOf(view.owner, view.characterId);
      view.draft = pending(view.key);
    }
    if (roles) {
      roles.replaceChildren(...data.characters.map(row => new Option(row.name || row.characterId, row.characterId)));
      roles.value = view.characterId;
      byId('handoff-role-label').hidden = data.characters.length < 2;
    }
    if (!view.draft && view.state.pendingRequestId) remember(view, {requestId:view.state.pendingRequestId});
    target.replaceChildren(...view.state.targetKinds.map(kind => new Option(names[kind], kind)));
    if (view.state.targetKinds.includes(view.targetKind)) target.value = view.targetKind;
    view.targetKind = null;
    const current = names[view.state.activeKind] || '交接待核实';
    byId('handoff-current').textContent = '当前身体 · ' + current + (view.state.autonomous ? '。此角色也可以自主换身。' : '。');
    view.refresh = true;
    controls(view);
  }
  async function fetchReceipt(view, send) {
    const draft = view.draft;
    const url = api + '/' + encodeURIComponent(view.characterId) + '/switch';
    let receipt;
    try {
      receipt = send ? await request(url, 'POST', draft)
        : await request(url + '/' + encodeURIComponent(draft.requestId));
    } catch (error) {
      if (view !== selected) return;
      if (!send && error.reason === 'BODY_HANDOFF_REQUEST_NOT_FOUND') {
        view.retry = !!draft.targetKind;
        result.textContent = view.retry ? '暂未查到原请求。可再次查询，或按原编号重新提交。' : '暂未查到原请求，请稍后再查。';
      } else if (send && ['BODY_HANDOFF_STALE','BODY_HANDOFF_BUSY','BODY_HANDOFF_TARGET_UNAVAILABLE'].includes(error.reason)) {
        remember(view, null);
        result.textContent = '角色或目标身体的状态已变化。请查看最新状态。';
        await refresh(view);
      } else {
        result.textContent = '暂时无法核实结果，请查看原请求。';
      }
      return;
    }
    if (view !== selected) return;
    view.retry = false;
    const status = receipt.status;
    if (status === 'completed' || status === 'blocked') remember(view, null);
    result.textContent = status === 'completed' ? '已切换到' + names[receipt.activeKind] + '。'
      : status === 'switching' ? '正在交接身体，可以查看原请求。'
      : messages[receipt.reason] || (status === 'blocked' ? '这次换身未执行。' : '身体归属待核实，请保留原请求。');
    await refresh(view);
  }
  async function run(view, fn) {
    if (!view || view.busy) return;
    view.busy = true;
    controls(view);
    try { await fn(); }
    catch {
      if (view === selected) {
        section.hidden = false;
        view.refresh = true;
        result.textContent = view.draft ? '暂时无法核实结果，请查看原请求。' : '暂时无法读取身体状态，请稍后刷新。';
      }
    } finally { view.busy = false; controls(view); }
  }
  confirm.onclick = () => {
    const view = selected;
    if (!view || view.busy || (view.draft && !view.retry)) return;
    if (!view.draft) {
      if (view.state?.status !== 'ready' || !view.state.targetKinds.includes(target.value)) return;
      remember(view, {requestId:crypto.randomUUID(), targetKind:target.value, expectedGeneration:view.state.generation});
    }
    view.retry = false;
    void run(view, () => fetchReceipt(view, true));
  };
  check.onclick = () => {
    const view = selected;
    void run(view, () => view.draft ? fetchReceipt(view, false) : refresh(view));
  };
  const keyOf = (owner, characterId) => 'qd.body-switch.' + owner + '.' + characterId;
  function pending(key) {
    if (drafts.has(key)) return drafts.get(key);
    try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; }
  }
  function select(owner, characterId, targetKind = null) {
    const key = owner && keyOf(owner, characterId || '@self');
    if (key && selected?.key === key) return;
    selected = null;
    if (device) {
      deviceId.value = '';
      deviceStatus.textContent = '';
      deviceControls(null);
    }
    section.hidden = true;
    if (byId('handoff-empty')) byId('handoff-empty').hidden = true;
    result.textContent = '';
    byId('handoff-current').textContent = '';
    byId('handoff-receipt-id').textContent = '';
    target.replaceChildren();
    if (!key) return;
    const view = {key, owner, characterId, targetKind, draft:pending(key)};
    selected = view;
    void run(view, async () => {
      await refresh(view);
      if (view === selected && !section.hidden && view.draft) await fetchReceipt(view, false);
    });
  }
  if (roles) roles.onchange = () => { if (selected) select(selected.owner, roles.value); };
  return {select};
}
