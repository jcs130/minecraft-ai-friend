const state = {
  snapshot: null,
  connected: false,
  lastTarget: ''
};

const elements = {
  subtitle: document.querySelector('#studioSubtitle'),
  liveBadge: document.querySelector('#liveBadge'),
  worldBadge: document.querySelector('#worldBadge'),
  onlineBadge: document.querySelector('#onlineBadge'),
  videoPanel: document.querySelector('#videoPanel'),
  videoTarget: document.querySelector('#videoTarget'),
  commanderName: document.querySelector('#commanderName'),
  directiveText: document.querySelector('#directiveText'),
  worldUpdated: document.querySelector('#worldUpdated'),
  worldGrid: document.querySelector('#worldGrid'),
  modelUpdated: document.querySelector('#modelUpdated'),
  modelList: document.querySelector('#modelList'),
  projectCount: document.querySelector('#projectCount'),
  projectList: document.querySelector('#projectList'),
  stripProjectCount: document.querySelector('#stripProjectCount'),
  stripProjectList: document.querySelector('#stripProjectList'),
  resourceCount: document.querySelector('#resourceCount'),
  resourceList: document.querySelector('#resourceList'),
  taskSummary: document.querySelector('#taskSummary'),
  agentTasks: document.querySelector('#agentTasks'),
  leaderboardUpdated: document.querySelector('#leaderboardUpdated'),
  leaderboardList: document.querySelector('#leaderboardList')
};

connectEvents();

function connectEvents() {
  const events = new EventSource('/events');
  events.addEventListener('update', (event) => {
    state.connected = true;
    const payload = JSON.parse(event.data);
    state.snapshot = payload.snapshot;
    render();
  });
  events.onerror = () => {
    state.connected = false;
    elements.liveBadge.textContent = '状态重连中';
    elements.liveBadge.classList.remove('ok');
  };
}

function render() {
  const snapshot = state.snapshot;
  if (!snapshot) return;

  const agents = Array.isArray(snapshot.agents) ? snapshot.agents : [];
  const world = snapshot.world || {};
  const village = snapshot.village || {};
  const livestream = snapshot.livestream || {};
  const targetName = livestream.currentTarget || '';
  const targetAgent = targetName ? agents.find((agent) => agent.name === targetName || agent.id === targetName) : null;
  const onlineCount = agents.filter((agent) => agent.status === 'online').length;

  if (targetName && targetName !== state.lastTarget) {
    state.lastTarget = targetName;
    elements.videoPanel.classList.add('switching');
    window.clearTimeout(render.switchTimer);
    render.switchTimer = window.setTimeout(() => elements.videoPanel.classList.remove('switching'), 1400);
  }

  const settlement = village.settlement || {};
  elements.subtitle.textContent = `${settlement.name || 'AI Friend Village'}｜基地 ${formatPosition(settlement.base)}`;
  elements.liveBadge.textContent = `镜头 ${livestream.observer || 'live'} → ${targetName || '等待'}${livestream.active ? `｜${Math.round(Number(livestream.switchIntervalMs || 0) / 1000) || '?'}s 自动` : '｜手动'}`;
  elements.liveBadge.classList.toggle('ok', Boolean(targetName));
  elements.worldBadge.textContent = `${labelGamemode(world.gamemode)}｜${labelDifficulty(world.difficulty)}`;
  elements.worldBadge.classList.toggle('ok', Boolean(world.serverOnline));
  elements.onlineBadge.textContent = `${onlineCount}/${world.maxPlayers || agents.length || '?'} 在线`;

  elements.videoTarget.textContent = targetAgent
    ? `${livestream.observer || 'live'} 正在观察 ${targetAgent.name}｜${targetAgent.title || '居民'}｜${actionLabel(targetAgent.currentTask)}`
    : `${livestream.observer || 'live'} → 等待观察目标`;

  const commander = village.commander || {};
  elements.commanderName.textContent = commander.title || commander.name || 'AI村长';
  elements.directiveText.textContent = truncate(world.commanderDirective || firstBulletin(snapshot, '村长最新调度') || firstBulletin(snapshot, '村长宏观指令') || world.worldDirective || settlement.policy || '围绕基地推进安全、食物、仓储、照明、道路、农田和住宅。', 150);

  elements.worldUpdated.textContent = formatTime(snapshot.now);
  elements.worldGrid.innerHTML = [
    ['服务端', world.serverOnline ? '在线' : '离线', world.serverOnline],
    ['模式', labelGamemode(world.gamemode), true],
    ['难度', labelDifficulty(world.difficulty), true],
    ['自动驾驶', world.autopilotActive ? '运行中' : '已停止', world.autopilotActive],
    ['人数', `${onlineCount}/${world.maxPlayers || agents.length || '?'}`, onlineCount > 0],
    ['PVP', world.pvp ? '开启' : '关闭', !world.pvp]
  ].map(([label, value, good]) => `
    <div class="status-item ${good ? 'good' : 'warn'}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join('');

  renderModels(snapshot.models || {});
  renderAgents(agents, targetName, snapshot.models || {});
  renderProjects(village.projects || []);
  renderStripProjects(village.projects || []);
  renderResources(village.resources || [], village.chestInventory || []);
  renderLeaderboard(village.scoreboard || []);
}

function renderModels(models) {
  if (!elements.modelList) return;
  const commander = models.commander || {};
  const residents = models.residents || {};
  const vision = models.vision || {};
  if (elements.modelUpdated) elements.modelUpdated.textContent = residents.mixed ? '多模型' : '当前配置';
  const rows = [
    ['主控', compactModelLine(commander)],
    ['村民', compactResidentLine(models)],
    ['视觉', compactModelLine(vision)]
  ];
  elements.modelList.innerHTML = rows.map(([label, value]) => `
    <div class="model-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || '未配置')}</strong>
    </div>
  `).join('');
}

function compactModelLine(model) {
  if (!model) return '';
  const provider = model.providerLabel || model.provider || model.api || '';
  const name = model.model || '';
  if (model.mixed) return `多个模型｜${model.profileCount || 0} 个角色`;
  return [provider, name].filter(Boolean).join('｜');
}

function compactResidentLine(models) {
  const residents = models.residents || {};
  if (!residents.mixed) return compactModelLine(residents);
  const rows = (models.profiles || [])
    .filter(profile => profile && (profile.active || profile.model && profile.model.model))
    .sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || String(a.name).localeCompare(String(b.name)))
    .slice(0, 3)
    .map(profile => String(profile.name || 'AI') + ':' + String(profile.model && profile.model.model ? profile.model.model : '未知'));
  return rows.length > 0 ? rows.join('，') : `多个模型｜${residents.profileCount || 0} 个角色`;
}
function renderResources(resources, chestInventory = []) {
  if (!elements.resourceList) return;
  const targetRows = resources.slice(0, 8).map(resource => ({ ...resource, rowKind: 'target' }));
  const chestRows = chestInventory.slice(0, 12).map(item => ({
    rowKind: 'stock',
    id: item.id,
    name: item.name,
    current: Number(item.count || 0),
    chest: Number(item.count || 0),
    carried: 0,
    target: 0,
    unit: '个',
    status: 'stock'
  }));
  const visible = [...targetRows, ...chestRows];
  if (elements.resourceCount) elements.resourceCount.textContent = `${resources.length} 类目标｜箱内 ${chestInventory.length} 种｜1 分钟刷新`;
  elements.resourceList.innerHTML = visible.length ? visible.map((resource) => {
    if (resource.rowKind === 'stock') return renderChestStockRow(resource);
    return renderTargetResourceRow(resource);
  }).join('') : '<div class="empty">暂无资源目标。</div>';
}

function renderTargetResourceRow(resource) {
  const current = Number(resource.current || 0);
  const target = Number(resource.target || 0);
  const chest = Number(resource.chest || 0);
  const carried = Number(resource.carried || 0);
  const percent = target > 0 ? Math.max(0, Math.min(100, Math.round(current / target * 100))) : Number(resource.percent || 0);
  const unit = resource.unit ? ` ${resource.unit}` : '';
  return `
    <div class="resource-row ${percent >= 100 ? 'done' : percent > 0 ? 'partial' : 'missing'}">
      <div class="resource-head">
        <span>${escapeHtml(resource.name || resource.id || '资源')}</span>
        <strong>${escapeHtml(current)} / ${escapeHtml(target || '-')}${escapeHtml(unit)}</strong>
      </div>
      <small>目标资源｜箱 ${escapeHtml(chest)}｜身上 ${escapeHtml(carried)}｜${escapeHtml(resourceStatusLabel(resource.status, percent))}</small>
      <div class="resource-meter"><span style="width:${percent}%"></span></div>
    </div>
  `;
}

function renderChestStockRow(resource) {
  return `
    <div class="resource-row stock">
      <div class="resource-head">
        <span>${escapeHtml(resource.name || resource.id || '库存')}</span>
        <strong>箱内 ${escapeHtml(resource.current)}${escapeHtml(resource.unit ? ' ' + resource.unit : '')}</strong>
      </div>
      <small>公共箱库存合计</small>
    </div>
  `;
}
function renderStripProjects(projects) {
  if (!elements.stripProjectList) return;
  const active = projects
    .filter(project => /active|planned|started/i.test(project.status || ''))
    .slice(0, 3);
  if (elements.stripProjectCount) elements.stripProjectCount.textContent = `${active.length}/${projects.length} 项`;
  elements.stripProjectList.innerHTML = active.length ? active.map(project => `
    <div class="strip-project-row">
      <strong>${escapeHtml(project.title || project.id || '公共建设')}</strong>
      <span>${escapeHtml(project.progress || project.status || '-')}</span>
      <small>${escapeHtml(project.goal || '')}</small>
    </div>
  `).join('') : '<div class="empty">暂无进行中的公共建设。</div>';
}
function renderProjects(projects) {
  if (!elements.projectList || !elements.projectCount) return;
  const visible = projects.slice(0, 3);
  elements.projectCount.textContent = `${projects.length} 项`;
  elements.projectList.innerHTML = visible.length ? visible.map((project) => `
    <article class="project-row">
      <div>
        <strong>${escapeHtml(project.priority ? `${project.priority} ${project.title}` : project.title)}</strong>
        <span>${escapeHtml(project.goal || project.status || '')}</span>
      </div>
      <b>${escapeHtml(project.progress || project.status || '-')}</b>
    </article>
  `).join('') : '<div class="empty">暂无公共建设项目。</div>';
}

function renderLeaderboard(scoreboard) {
  if (!elements.leaderboardList) return;
  const rows = [...scoreboard]
    .sort((a, b) => Number(b.monsterKills || 0) - Number(a.monsterKills || 0) || Number(a.deaths || 0) - Number(b.deaths || 0) || Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 5);
  if (elements.leaderboardUpdated) elements.leaderboardUpdated.textContent = `${rows.length} 人`;
  elements.leaderboardList.innerHTML = rows.length ? rows.map((row, index) => `
    <div class="leaderboard-row">
      <b>#${index + 1}</b>
      <strong>${escapeHtml(row.agent || 'AI')}</strong>
      <span>怪物 ${escapeHtml(row.monsterKills || 0)}｜死亡 ${escapeHtml(row.deaths || 0)}｜总击杀 ${escapeHtml(row.kills || 0)}</span>
    </div>
  `).join('') : '<div class="empty">暂无战绩。</div>';
}

function renderAgents(agents, targetName, models = {}) {
  const sorted = [...agents].sort((a, b) => {
    if (a.name === targetName) return -1;
    if (b.name === targetName) return 1;
    return String(a.name).localeCompare(String(b.name));
  }).slice(0, 5);

  elements.taskSummary.textContent = targetName ? `镜头跟随 ${targetName}` : `${sorted.length} 个居民`;
  elements.agentTasks.innerHTML = sorted.length ? sorted.map((agent) => {
    const modelLabel = agentModelLabel(models, agent.name);
    return `
      <article class="agent-task ${agent.name === targetName ? 'observed' : ''}" style="--agent-color:${escapeAttr(agent.color || '#49a8f5')}">
        <div class="agent-task-head">
          <span>${escapeHtml(agent.title || '居民')}</span>
          <strong>${escapeHtml(agent.name)}</strong>
        </div>
        ${agent.name === targetName ? '<b>直播中</b>' : ''}
        <div class="agent-task-main">${escapeHtml(actionLabel(agent.currentTask || 'idle'))}</div>
        <p>${escapeHtml(truncate(agent.thought || '等待公开思考。', 70))}</p>
        <footer>${escapeHtml(formatPosition(agent.position))}｜生命 ${escapeHtml(agent.health ?? '-')}｜饱食 ${escapeHtml(agent.food ?? '-')}｜模型 ${escapeHtml(modelLabel)}</footer>
      </article>
    `;
  }).join('') : '<div class="empty">暂无居民状态。</div>';
}

function resourceStatusLabel(status, percent) {
  const key = String(status || '').toLowerCase();
  if (key === 'done' || percent >= 100) return '达标';
  if (key === 'partial' || percent > 0) return '补充中';
  if (key === 'missing') return '缺口';
  return '统计中';
}

function agentModelLabel(models, agentName) {
  const profiles = models && Array.isArray(models.profiles) ? models.profiles : [];
  const profile = profiles.find(item => item && item.name === agentName);
  const model = profile && profile.model && profile.model.model ? profile.model.model : '';
  if (model) return model;
  const residents = models && models.residents ? models.residents : {};
  return residents.model || '未知';
}

function renderInteraction(snapshot) {
  const interaction = snapshot.interaction || {};
  const resources = snapshot.village?.resources || [];
  const needs = resources
    .filter((resource) => Number(resource.target || 0) > Number(resource.current || 0))
    .slice(0, 2)
    .map((resource) => `${resource.name} ${resource.current}/${resource.target}`)
    .join('，');
  elements.interactionText.textContent = truncate(interaction.description || `弹幕互动预留：之后可让观众投票改变村庄目标。当前重点：${needs || '继续建设基地和公共设施'}。`, 90);
}

function firstBulletin(snapshot, title) {
  const item = (snapshot.bulletins || []).find((bulletin) => bulletin.title === title);
  return item ? item.message : '';
}

function labelGamemode(value) {
  return ({ survival: '生存', creative: '创造', adventure: '冒险', spectator: '旁观' })[String(value || '').toLowerCase()] || value || '未知';
}

function labelDifficulty(value) {
  return ({ peaceful: '和平', easy: '简单', normal: '普通', hard: '困难' })[String(value || '').toLowerCase()] || value || '未知';
}

function actionLabel(action) {
  const labels = {
    idle: '观察',
    chat: '沟通',
    explore: '探索',
    gather_wood: '砍树',
    mine: '采矿',
    farm: '种田',
    build_shelter: '建造',
    guard: '巡逻',
    deposit: '整理物资',
    booting: '启动中',
    spawned: '已出生',
    disconnected: '已断开',
    respawning: '重生中',
    storage_hub: '建设公共仓库',
    village_build: '建设村庄',
    survival: '生存建设'
  };
  return labels[String(action || '').replaceAll('-', '_')] ?? action ?? '观察';
}

function formatPosition(position) {
  if (!position) return '未知坐标';
  return `X=${round(position.x)}, Y=${round(position.y)}, Z=${round(position.z)}`;
}

function formatTime(value) {
  if (!value) return '--:--:--';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function round(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : '?';
}

function truncate(value, max) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}