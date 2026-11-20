import { addressKinds, covered, dimensionIds, directoryIndex, matchingPlaces, placeAddress, placeStreetId, positionText, visiblePlayers, worldNames } from './world-map-model.js';
const $ = id => document.getElementById(id);
const frame = $('world-map-frame');
let state = null, following = null, stopped = false, timer, busy = false;
let addressDirectory, addressesById, selectedPlace, pendingLocation;
let addressFreeFlight = false;
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
  pendingLocation = null;
  following = row.uuid; $('follow-label').textContent = `正在跟随 ${row.name}`; $('follow-bar').hidden = false;
  $('follow-live').hidden=row.kind==='npc';
  $('follow-live').href = '/#live?player=' + encodeURIComponent(row.name);
  const id = dimensionIds[row.dimension], app = engine();
  if (!app?.mapViewer) return;
  if (app.mapViewer.map?.data.id !== id) await selectWorld(id);
  if (addressFreeFlight) {
    app.setPerspectiveView?.(0, 120);
    addressFreeFlight = false;
  }
  const controls = app.mapViewer.controlsManager;
  controls.position.set(row.x, row.y, row.z);
  if (controls.distance > 450) controls.distance = 450;
  const marker = app.playerMarkerManager?.getPlayerMarker(row.uuid);
  if (marker) controls.controls?.followPlayerMarker?.(marker);
  $('world-select').value = id;
}

function showAddresses(enabled) {
  $('address-panel').hidden = !enabled;
  $('online-panel').hidden = enabled;
  $('show-addresses').setAttribute('aria-pressed', String(enabled));
  $('show-players').setAttribute('aria-pressed', String(!enabled));
}
function openAddresses() {
  stopFollowing();
  showAddresses(true);
  void selectWorld('aincrad').catch(showMapError);
}
function setOptions(select, rows, label) {
  const chosen = select.value;
  select.replaceChildren(new Option(label, ''));
  for (const row of rows) select.add(new Option(row.name, row.id));
  if (rows.some(row => row.id === chosen)) select.value = chosen;
}
function refreshStreets() {
  const district = $('address-district').value;
  setOptions($('address-street'), addressDirectory.streets.filter(row => !district || row.districtId === district), '全部街道');
}
function displayText(parent, element, value, className) {
  if (!value) return;
  const child = document.createElement(element);
  if (className) child.className = className;
  child.textContent = value;
  parent.append(child);
}
function addressPositionText({ x, y, z }) {
  return `X ${x} · Y ${y} · Z ${z}`;
}
function renderAddresses({ focusPlace = false } = {}) {
  if (!addressDirectory) return;
  const districtId = $('address-district').value, streetId = $('address-street').value;
  const street = addressDirectory.streets.find(row => row.id === streetId);
  $('locate-street').hidden = !street?.path.length;
  const rows = matchingPlaces(addressDirectory, { districtId, streetId, search: $('address-search').value }, addressesById);
  $('address-count').textContent = rows.length;
  $('address-empty').hidden = rows.length > 0;
  $('address-empty').textContent = '没有匹配的住址或地点。';
  const list = document.createDocumentFragment();
  let active;
  for (const row of rows) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'atlas-address';
    button.dataset.place = row.id;
    if (row.id === selectedPlace?.id) {
      button.setAttribute('aria-current', 'location');
      active = button;
    }
    displayText(button, 'small', addressKinds[row.kind], 'atlas-address-kind');
    displayText(button, 'strong', row.name);
    displayText(button, 'small', placeAddress(row, addressesById));
    const parent = addressesById.places.get(row.parentId);
    displayText(button, 'small', parent?.name);
    displayText(button, 'small', row.residents?.map(resident => [resident.name, resident.profession].filter(Boolean).join(' · ')).join('、'));
    displayText(button, 'small', row.activities?.join('、'));
    displayText(button, 'small', addressPositionText(row.position));
    list.append(button);
  }
  $('address-list').replaceChildren(list);
  if (focusPlace) active?.focus({ preventScroll: true });
}
async function placeCamera() {
  const location = pendingLocation, app = engine();
  if (!location || !app?.mapViewer?.controlsManager || !app.mapsMap?.has('aincrad')) return;
  if (app.mapViewer.map?.data.id !== 'aincrad') await selectWorld('aincrad');
  if (location !== pendingLocation) return;
  const controls = app.mapViewer.controlsManager;
  const { x, y, z } = location.position;
  controls.position.set(x, y, z);
  if (location.room && app.mapViewer.map?.data.freeFlightView && typeof app.setFreeFlight === 'function') {
    app.setFreeFlight(0, y || Number.EPSILON);
    addressFreeFlight = true;
  } else {
    controls.distance = 95;
    if (addressFreeFlight) app.setPerspectiveView?.(0, 95);
    addressFreeFlight = false;
  }
  pendingLocation = null;
}
function bookmarkPlace(placeId) {
  const url = new URL(window.location.href);
  if (placeId) url.searchParams.set('place', placeId);
  else url.searchParams.delete('place');
  history.replaceState(history.state, '', url);
}
function showAddressPoint(name, pointType, position) {
  const label = $('address-selection');
  label.hidden = false;
  label.textContent = [name, pointType, addressPositionText(position)].join(' · ');
}
function setPlace(place, { focusPlace = false } = {}) {
  stopFollowing();
  selectedPlace = place;
  const room = place.kind === 'dungeon-room' || place.kind === 'room';
  pendingLocation = { position: place.position, room };
  bookmarkPlace(place.id);
  showAddressPoint(place.name, room ? '房间定位点' : '地图定位点', place.position);
  renderAddresses({ focusPlace });
  void placeCamera().catch(showMapError);
}
async function loadAddresses() {
  try {
    const response = await fetch('/world-map/aincrad-addresses.json', { cache: 'no-cache', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw Error('ADDRESS_DIRECTORY_UNAVAILABLE');
    const data = await response.json();
    if (data.version !== 1 || data.world !== 'minecraft:aincrad'
        || ![data.districts, data.streets, data.places].every(Array.isArray)) throw Error('ADDRESS_DIRECTORY_INVALID');
    addressDirectory = data;
    addressesById = directoryIndex(data);
    setOptions($('address-district'), data.districts, '全部街区');
    const fromLink = new URLSearchParams(window.location.search).get('place');
    const place = addressesById.places.get(fromLink);
    if (place) $('address-district').value = place.districtId;
    refreshStreets();
    if (place) {
      const street = placeStreetId(place, addressesById);
      if (street) $('address-street').value = street;
      showAddresses(true);
      $('world-select').value = 'aincrad';
      setPlace(place);
    } else renderAddresses();
  } catch {
    $('address-empty').textContent = '暂时无法读取街巷与门牌。';
  }
}
function render() {
  const rows = visiblePlayers(state, $('player-search').value), all = visiblePlayers(state);
  $('player-count').textContent = state?.available ? all.length : '—';
  const list = $('map-player-list'); list.replaceChildren();
  for (const row of rows) {
    const card = document.createElement('div'); card.className = 'atlas-player-card';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'atlas-player';
    if (row.uuid === following) button.classList.add('is-following');
    button.setAttribute('aria-label', `跟随 ${row.name}，${worldNames[dimensionIds[row.dimension]]}，${positionText(row)}`);
    const avatar = document.createElement('img'); avatar.className = 'atlas-avatar'; avatar.alt = ''; avatar.width = 40; avatar.height = 40;
    avatar.src = row.kind==='npc'?'/npc-avatar.svg':`/api/v1/avatars/${encodeURIComponent(row.name)}`;
    const details = document.createElement('span'); details.className = 'atlas-player-info';
    const name = document.createElement('strong'); name.textContent = row.name + (row.kind === 'npc' ? ' · 智能 NPC' : '');
    const place = document.createElement('small'); place.textContent = `${worldNames[dimensionIds[row.dimension]]} · ${positionText(row)}`;
    const hint = document.createElement('small'); hint.className = 'atlas-player-hint'; hint.textContent = covered(row, state.maps) ? '在线 · 点击头像定位' : '在线 · 此处尚未制图';
    details.append(name, place, hint); button.append(avatar, details);
    const live = document.createElement('a'); live.className = 'atlas-live'; live.textContent = '观看直播 ↗'; live.href = '/#live?player=' + encodeURIComponent(row.name);
    live.setAttribute('aria-label', `观看 ${row.name} 的直播`);
    const actions = document.createElement('div'); actions.className = 'atlas-player-actions';
    const locate = document.createElement('button'); locate.type = 'button'; locate.className = 'atlas-locate'; locate.textContent = row.uuid === following ? '正在跟随' : '定位';
    const onLocate = () => { void follow(row).then(render).catch(showMapError); };
    button.addEventListener('click', onLocate); locate.addEventListener('click', onLocate);
    actions.append(locate);if(row.kind!=='npc')actions.append(live); card.append(button, actions); list.append(card);
  }
  $('map-empty').hidden = rows.length > 0;
  $('map-empty').textContent = !state?.available ? '实时位置暂不可用，等待游戏服同步。' : all.length ? '没有匹配的在线居民。' : '此刻没有可显示的在线居民。';
  $('map-status').textContent = state?.available ? '● 实时位置已连接' : '○ 实时位置暂不可用';
  $('map-status').classList.toggle('is-live', !!state?.available);
  $('map-updated').textContent = state?.observedAt ? `位置观测：${new Date(state.observedAt).toLocaleTimeString('zh-CN')}` : '';
  const row = all.find(item => item.uuid === following);
  const doc=frame.contentDocument;
  for(const marker of doc?.querySelectorAll('.bm-marker-player')||[]){
    const name=marker.querySelector('.bm-player-name')?.textContent;
    const img=marker.querySelector('img');
    const resident=all.find(item=>item.name===name);
    if(img&&resident){const src=resident.kind==='npc'?'/npc-avatar.svg':'/api/v1/avatars/'+encodeURIComponent(name);if(img.getAttribute('src')!==src)img.setAttribute('src',src);}
  }
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
  finally { busy = false; render(); void placeCamera().catch(showMapError); if (!stopped) timer = setTimeout(poll, 5000); }
}
$('player-search').addEventListener('input', render);
$('stop-follow').addEventListener('click', () => { stopFollowing(); render(); });
$('world-select').addEventListener('change', () => {
  stopFollowing();
  pendingLocation = null;
  const id = $('world-select').value;
  showAddresses(id === 'aincrad');
  void selectWorld(id).catch(showMapError);
});
$('map-spawn').addEventListener('click', () => { pendingLocation = null; addressFreeFlight = false; stopFollowing(); engine()?.resetCamera?.(); });
$('show-addresses').addEventListener('click', openAddresses);
$('show-players').addEventListener('click', () => { pendingLocation = null; showAddresses(false); });
$('address-district').addEventListener('change', () => {
  if (!addressDirectory) return;
  refreshStreets();
  renderAddresses();
});
$('address-street').addEventListener('change', () => renderAddresses());
$('address-search').addEventListener('input', () => renderAddresses());
$('address-list').addEventListener('click', event => {
  const placeId = event.target.closest('button[data-place]')?.dataset.place;
  const place = addressesById?.places.get(placeId);
  if (place) setPlace(place, { focusPlace: true });
});
$('locate-street').addEventListener('click', () => {
  const street = addressesById?.streets.get($('address-street').value);
  if (!street?.path.length) return;
  stopFollowing();
  selectedPlace = null;
  bookmarkPlace(null);
  const position = street.path[Math.floor(street.path.length / 2)];
  pendingLocation = { position, room: false };
  showAddressPoint(street.name, '街道定位点', position);
  renderAddresses();
  void placeCamera().catch(showMapError);
});
function themeMap() {
  const doc = frame.contentDocument; if (!doc?.head || doc.getElementById('atlas-map-theme')) return;
  const style = doc.createElement('link'); style.id = 'atlas-map-theme'; style.rel = 'stylesheet'; style.href = '/world-map.css'; doc.head.append(style);
  // Marker clicks use the same explicit follow/stream actions as the resident list.
  doc.addEventListener('click', event => {
    const marker = event.target.closest?.('.bm-marker-player'); if (!marker) return;
    const name = marker.querySelector('.bm-player-name')?.textContent;
    const row = visiblePlayers(state).find(item => item.name === name);
    if (row) void follow(row).then(render).catch(showMapError);
  }, true);
}
frame.addEventListener('load', () => { themeMap(); const row = visiblePlayers(state).find(item => item.uuid === following); if (row) void follow(row).catch(showMapError); void placeCamera().catch(showMapError); });
themeMap();
window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); });
window.addEventListener('pageshow', event => { if (event.persisted) { stopped = false; void poll(); } });
void loadAddresses();
void poll();
