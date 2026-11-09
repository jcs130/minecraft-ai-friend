import { dimensionIds, worldNames, positionText, visiblePlayers, covered } from './world-map-model.js';
const $ = id => document.getElementById(id);
const frame = $('world-map-frame');
let state = null, following = null, stopped = false, timer, busy = false;
function engine() { try { return frame.contentWindow?.bluemap; } catch { return null; } }
function stopFollowing() {
  following = null; $('follow-bar').hidden = true;
  engine()?.mapViewer?.controlsManager?.controls?.stopFollowingPlayerMarker?.();
}
async function selectWorld(id) {
  if (!worldNames[id]) return;
  const app = engine();
  if (app?.mapsMap?.has(id)) await app.switchMap(id);
  else frame.contentWindow.location.hash = id;
  $('world-select').value = id;
}
async function follow(row) {
  following = row.name; $('follow-label').textContent = `正在跟随 ${row.name}`; $('follow-bar').hidden = false;
  $('follow-live').href = '/#live?player=' + encodeURIComponent(row.name);
  const id = dimensionIds[row.dimension], app = engine();
  if (!app?.mapViewer) return;
  if (app.mapViewer.map?.data.id !== id) await selectWorld(id);
  const controls = app.mapViewer.controlsManager;
  controls.position.set(row.x, row.y, row.z);
  if (controls.distance > 450) controls.distance = 450;
  const marker = app.playerMarkerManager?.getPlayerMarker(row.uuid);
  if (marker) controls.controls?.followPlayerMarker?.(marker);
  $('world-select').value = id;
}
function render() {
  const rows = visiblePlayers(state, $('player-search').value), all = visiblePlayers(state);
  $('player-count').textContent = state?.available ? all.length : '—';
  const list = $('map-player-list'); list.replaceChildren();
  for (const row of rows) {
    const card = document.createElement('div'); card.className = 'atlas-player-card';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'atlas-player';
    if (row.name === following) button.classList.add('is-following');
    button.setAttribute('aria-label', `跟随 ${row.name}，${worldNames[dimensionIds[row.dimension]]}，${positionText(row)}`);
    const avatar = document.createElement('img'); avatar.className = 'atlas-avatar'; avatar.alt = ''; avatar.width = 40; avatar.height = 40;
    avatar.src = `/world-map/maps/${dimensionIds[row.dimension]}/assets/playerheads/${row.uuid}.png`;
    const details = document.createElement('span'); details.className = 'atlas-player-info';
    const name = document.createElement('strong'); name.textContent = row.name;
    const place = document.createElement('small'); place.textContent = `${worldNames[dimensionIds[row.dimension]]} · ${positionText(row)}`;
    const hint = document.createElement('small'); hint.className = 'atlas-player-hint'; hint.textContent = covered(row, state.maps) ? '点击定位并跟随 →' : '此处尚未制图 · 仍可定位 →';
    details.append(name, place, hint); button.append(avatar, details);
    const live = document.createElement('a'); live.className = 'atlas-live'; live.textContent = '观看直播 ↗'; live.href = '/#live?player=' + encodeURIComponent(row.name);
    live.setAttribute('aria-label', `观看 ${row.name} 的直播`);
    button.addEventListener('click', () => { void follow(row).then(render).catch(showMapError); }); card.append(button, live); list.append(card);
  }
  $('map-empty').hidden = rows.length > 0;
  $('map-empty').textContent = !state?.available ? '实时位置暂不可用，等待游戏服同步。' : all.length ? '没有匹配的在线居民。' : '此刻没有可显示的在线居民。';
  $('map-status').textContent = state?.available ? '● 实时位置已连接' : '○ 实时位置暂不可用';
  $('map-status').classList.toggle('is-live', !!state?.available);
  $('map-updated').textContent = state?.observedAt ? `位置观测：${new Date(state.observedAt).toLocaleTimeString('zh-CN')}` : '';
  const row = all.find(item => item.name === following);
  if (following && !row) stopFollowing();
  if (row) void follow(row).catch(showMapError);
}
function showMapError() { $('map-status').textContent = '地图仍在准备，可稍后重试定位'; }
async function poll() {
  if (busy || stopped) return; busy = true;
  try {
    const response = await fetch('/api/v1/world-map', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw Error('MAP_UNAVAILABLE');
    state = await response.json();
  } catch { state = { ...state, available: false, players: [] }; }
  finally { busy = false; render(); if (!stopped) timer = setTimeout(poll, 5000); }
}
$('player-search').addEventListener('input', render);
$('stop-follow').addEventListener('click', () => { stopFollowing(); render(); });
$('world-select').addEventListener('change', () => { stopFollowing(); void selectWorld($('world-select').value).catch(showMapError); });
$('map-spawn').addEventListener('click', () => { stopFollowing(); engine()?.resetCamera?.(); });
function themeMap() {
  const doc = frame.contentDocument; if (!doc || doc.getElementById('atlas-map-theme')) return;
  const style = doc.createElement('link'); style.id = 'atlas-map-theme'; style.rel = 'stylesheet'; style.href = '/world-map.css'; doc.head.append(style);
  // Marker clicks use the same explicit follow/stream actions as the resident list.
  doc.addEventListener('click', event => {
    const marker = event.target.closest?.('.bm-marker-player'); if (!marker) return;
    const name = marker.querySelector('.bm-player-name')?.textContent;
    const row = visiblePlayers(state).find(item => item.name === name);
    if (row) void follow(row).then(render).catch(showMapError);
  });
}
frame.addEventListener('load', () => { themeMap(); const row = visiblePlayers(state).find(item => item.name === following); if (row) void follow(row).catch(showMapError); });
themeMap();
window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); });
window.addEventListener('pageshow', event => { if (event.persisted) { stopped = false; void poll(); } });
void poll();
