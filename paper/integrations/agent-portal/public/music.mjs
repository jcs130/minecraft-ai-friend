import { uploadMusic } from './music-client.mjs';
const $ = id => document.getElementById(id), escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const state = { mine: false, page: 1, session: null, subject: '', works: [], capability: null, editing: null, busy: false, epoch: 0 };
const message = (value, error = false) => { $('message').textContent = value; $('message').classList.toggle('error', error); };
async function request(route, method = 'GET', body) {
  const response = await fetch('/api/v1' + route, { method, headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': state.session?.csrfToken } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json(); if (!response.ok) throw Error((value.error?.message ?? '请求失败') + ' ' + (value.error?.nextAction ?? '')); return value;
}
const self = (route = '', method = 'GET', body) => request('/self/music' + route + '?agentId=' + encodeURIComponent(state.subject) + '&page=' + state.page, method, body);
const status = work => work.published ? '已公开' : work.state === 'ready' ? '私有成品' : work.state === 'failed' ? '音频需修正' : work.state === 'uploading' ? '待完成上传' : '歌词草稿';
const duration = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
function cards() {
  $('works').innerHTML = state.works.map(work => `<article class="work"><div class="work-mark" aria-hidden="true">♫</div><div class="badges"><span class="badge">${work.aiGenerated ? 'AI 参与生成' : '未使用 AI 生成'}</span>${state.mine ? `<span class="badge">${status(work)}</span>` : ''}</div><h2>${escape(work.title)}</h2><p>${escape(work.author)} · ${work.hasVocals ? '人声歌曲' : '器乐作品'}${work.audio ? ' · ' + duration(work.audio.durationSeconds) : ''}</p><button type="button" data-open="${work.id}">${state.mine ? '查看与管理' : '歌词与试听'}</button></article>`).join('');
}
async function load(append = false) {
  const epoch = ++state.epoch;
  try {
    const list = state.mine ? await self() : await request('/music?page=' + state.page);
    if (epoch !== state.epoch) return;
    state.works = append ? [...state.works, ...list.works] : list.works; cards();
    $('more').hidden = state.page * list.pageSize >= list.total;
    message(list.total ? `${list.total} 首${state.mine ? '本人作品' : '已公开作品'}` : state.mine ? '还没有作品。可以先保存歌词，成品准备好后再上传。' : '还没有公开的歌曲。完成的作品会在这里与大家见面。');
  } catch (error) { if (epoch === state.epoch) message(error.message, true); }
}
function media(work) {
  return work.audio ? `<audio controls preload="none" src="${escape(work.audio.url)}" aria-label="试听${escape(work.title)}"></audio><p id="playback-message" role="status"></p>` : '<p class="credit">这份作品还没有通过验证的成品音频。</p>';
}
async function detail(id) {
  const work = state.mine ? await self('/' + id) : await request('/music/' + id);
  $('detail-content').innerHTML = `<div class="badges"><span class="badge">${work.aiGenerated ? 'AI 参与生成' : '原创作品'}</span><span class="badge">${escape(status(work))}</span></div><h2>${escape(work.title)}</h2><p class="credit">${escape(work.author)}${work.credits ? ' · ' + escape(work.credits) : ''}</p>${media(work)}<pre class="lyrics">${escape(work.lyrics || '作者尚未填写歌词。')}</pre>${state.mine ? `<div class="actions"><button id="edit-work" type="button">编辑歌词 / 补充音频</button><button id="publish-work" type="button" ${!work.published && work.state !== 'ready' ? 'disabled' : ''}>${work.published ? '撤回公开' : '公开这首歌'}</button></div>` : ''}`;
  $('detail').showModal();
  const audio = $('detail-content').querySelector('audio');
  if (audio) {
    let retries = 0, intent = false;
    audio.addEventListener('play', () => { intent = true; });
    audio.addEventListener('pause', () => { if (!audio.error) intent = false; });
    audio.addEventListener('error', () => {
      if (retries++ || !$('detail').open) { $('playback-message').textContent = '音频暂时不可播放，作品可能已撤回；请刷新作品状态。'; return; }
      const position = audio.currentTime, resume = intent;
      audio.src = work.audio.url + (work.audio.url.includes('?') ? '&' : '?') + 'refresh=' + Date.now();
      audio.addEventListener('loadedmetadata', () => { audio.currentTime = position; if (resume && $('detail').open) audio.play().catch(() => {}); }, { once: true }); audio.load();
    });
  }
  if (state.mine) {
    $('edit-work').onclick = () => { $('detail').close(); edit(work); };
    $('publish-work').onclick = async () => {
      $('publish-work').disabled = true;
      try { await self('/' + id + '/publication', 'PUT', { requestId: crypto.randomUUID(), published: !work.published, expectedRevision: work.revision }); $('detail').close(); await load(); }
      catch (error) { message(error.message, true); $('detail').close(); }
    };
  }
}
function edit(work = null) {
  state.editing = work; $('work-form').reset();
  for (const name of ['title', 'lyrics', 'lyricsFormat', 'credits']) if (work) $('work-form').elements[name].value = work[name];
  if (work) { $('work-form').elements.aiGenerated.value = String(work.aiGenerated); $('work-form').elements.hasVocals.checked = work.hasVocals; }
  $('upload-message').textContent = ''; $('editor').showModal();
}
$('public-tab').onclick = () => { if (state.busy) return; state.mine = false; state.page = 1; $('manage').hidden = true; $('public-tab').setAttribute('aria-current', 'page'); $('mine-tab').removeAttribute('aria-current'); load(); };
$('mine-tab').onclick = async () => {
  if (state.busy) return;
  try {
    state.session = await request('/session');
    if (!state.session.owner) { message('请先在官网登录原网站账号，再回到“本人作品”。'); return; }
    const result = await request('/music/subjects');
    if (!result.subjects.length) { message('当前账号尚无已绑定角色，请先在官网认领自己的角色。'); return; }
    $('subject').innerHTML = result.subjects.map(row => `<option value="${escape(row.id)}">${escape(row.name)}</option>`).join('');
    state.subject = result.subjects[0].id; state.page = 1; state.mine = true; $('manage').hidden = false; $('mine-tab').setAttribute('aria-current', 'page'); $('public-tab').removeAttribute('aria-current'); load();
  } catch (error) { message(error.message, true); }
};
$('subject').onchange = () => { state.subject = $('subject').value; state.page = 1; load(); };
$('more').onclick = () => { state.page++; load(true); };
$('works').onclick = event => { const button = event.target.closest('[data-open]'); if (button) detail(button.dataset.open).catch(error => message(error.message, true)); };
$('close-detail').onclick = () => $('detail').close();
$('detail').addEventListener('close', () => { const audio = $('detail-content').querySelector('audio'); if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); } });
$('new-work').onclick = () => edit(); $('cancel-work').onclick = () => { if (!state.busy) $('editor').close(); };
$('editor').addEventListener('cancel', event => { if (state.busy) event.preventDefault(); });
$('work-form').onsubmit = async event => {
  event.preventDefault(); if (state.busy) return;
  const form = event.target, file = form.elements.audio.files[0], old = state.editing;
  const metadata = { title: form.elements.title.value, lyrics: form.elements.lyrics.value, lyricsFormat: form.elements.lyricsFormat.value, aiGenerated: form.elements.aiGenerated.value === 'true', hasVocals: form.elements.hasVocals.checked, credits: form.elements.credits.value, sourceTrackId: old?.sourceTrackId ?? '', description: old?.description ?? '' };
  state.busy = true; $('save-work').disabled = true; $('cancel-work').disabled = true; $('subject').disabled = true;
  try {
    let work = old;
    if (old) work = await self('/' + old.id, 'PATCH', { ...metadata, requestId: crypto.randomUUID(), expectedRevision: old.revision });
    if (!file) {
      if (!work) {
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(metadata)))), b => b.toString(16).padStart(2, '0')).join('');
        const key = `qd.music.draft.${state.session.owner.id}.${state.subject}.${digest}`;
        const requestId = localStorage.getItem(key) ?? crypto.randomUUID(); localStorage.setItem(key, requestId);
        work = await self('', 'POST', { ...metadata, requestId });
      }
    } else {
      if (file.size > state.capability.maximumBytes) throw Error('音频超过128MiB，请先压缩成 MP3 / FLAC。');
      if (work?.state === 'ready') throw Error('已验证成品不可覆盖；本次歌词已保存，如是另一首歌请新建作品。');
      const mime = ({ mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg' })[file.name.split('.').pop().toLowerCase()];
      if (!mime) throw Error('请选择支持的 MP3 / WAV / FLAC / Ogg 文件。');
      $('upload-message').textContent = '正在校验本机文件，随后直传私有存储…';
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
      const key = `qd.music.${state.session.owner.id}.${state.subject}.${sha256}`, receipt = JSON.parse(localStorage.getItem(key) ?? '{}');
      if (work) receipt.workId = work.id;
      work = await uploadMusic({ api: self, state: receipt, save: async value => localStorage.setItem(key, JSON.stringify(value)), metadata, descriptor: { sha256, bytes: file.size, mime }, audio: file, allowLoopback: ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname) });
    }
    $('editor').close(); await load(); message('作品已私有保存；如需分享，请进入作品主动公开。');
  } catch (error) { $('upload-message').textContent = error.message; }
  finally { state.busy = false; $('save-work').disabled = false; $('cancel-work').disabled = false; $('subject').disabled = false; }
};
try { state.capability = await request('/music/capabilities'); if (!state.capability.enabled) message('音乐作品入口正在准备，现有作品仍保存在作者本机。'); else await load(); }
catch { message('暂时无法读取歌曲作品，请稍后刷新。', true); }
