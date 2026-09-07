'use strict';

const views = {
  eye: ['天神之眼', 'LIVE WORLD', '天神之眼', '从世界中看见世界。选择视角，观察身边正在发生的故事。'],
  services: ['服务器管理', 'SERVER MANAGEMENT', '服务器管理', '当前状态、日志与维护记录集中管理，每次操作都有清楚的范围。'],
  overview: ['总览', 'WORLD OVERVIEW', '世界运行总览', '查看这片世界的近况，以及每一项记录的更新时间。'],
  beings: ['众生', 'PEOPLE & SKILLS', '众生与修行', '翻阅角色档案、精选秘术与保留下来的旧日技艺。'],
  village: ['村务', 'VILLAGE AFFAIRS', '村务与公会', '查看委托记录、功勋与村务服务的近况。'],
  world: ['世界', 'WORLD & WAYPOINTS', '世界与归途', '保留每一处落脚点，让行旅有迹可循。'],
  operations: ['运营组', 'WORLD OPERATIONS', '世界运营组', '查看角色、运行环境与服务依赖，整理需要处理的事情。'],
  agent: ['Agent 设置', 'AGENT CONNECTION', 'Agent 与模型服务', '世界管理与模型服务分开运行，各自保留清晰的入口。']
};
const serviceNames = { mc: 'Minecraft 世界', world: '世界进程', gate: '协议连接', npc: '村务服务', resources: '资源服务', qwenpaw: 'QwenPaw', voice: '语音回复', asr: '语音识别', panel: '独立管理台', tts: '语音合成', control: '管理执行器' };
const servicePurposes = { mc: '存档与游戏', world: '玩法与世界事件', gate: '角色连接', npc: '村务与公会', resources: '配音资源', qwenpaw: 'Agent 对话', voice: '语音回复队列', asr: '语音识别', panel: '世界管理入口', tts: '本项目 GPU 配音', control: '受控维护与回执' };
const typeNames = { gather: '收购', hunt: '狩猎', visit: '远行', treasure: '藏宝', lair: '营地', boss: '首领', escort: '护送' };
const dimensionNames = { 'minecraft:overworld': '主世界', 'minecraft:the_nether': '下界', 'minecraft:the_end': '末地' };
const operationsSkillNames = { 'qd-evidence-report': '证据与报告', 'qd-team-coordination': '团队协调',
  'qd-service-triage': '服务排障', 'qd-priority-review': '优先级与验收', 'qd-world-events': '世界活动策划',
  'qd-casting-acceptance': '施法与操作验收', 'qd-onboarding-exploration': '新手与探索体验' };
const byId = (id) => document.getElementById(id);
const rows = (value) => Array.isArray(value) ? value : [];
const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = (value, fallback = '—') => typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const number = (value, digits = 0) => finite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: digits }) : '—';
const enabled = (value) => value === true ? '已开启' : value === false ? '已关闭' : '未记录';
let snapshot = null;
let fetching = false;
let activeView = 'overview';
const dateFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = text(content, '');
  return element;
}
function replace(id, children) { byId(id).replaceChildren(...children); }
function badge(label, tone = 'neutral') { return node('span', 'badge ' + tone, label); }
function setBadge(id, label, tone = 'neutral') { const target = byId(id); target.className = 'badge ' + tone; target.textContent = label; }
function empty(message) { return node('div', 'empty empty-span', message); }
function formatDate(value) {
  if (value === null || value === undefined || value === '') return '未记录';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '未记录';
  return dateFormatter.format(date);
}
function freshAt(value, limitSeconds) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  const ageSeconds = (Date.now() - time) / 1000;
  return Number.isFinite(ageSeconds) && ageSeconds >= -5 && ageSeconds <= limitSeconds;
}
function currentRecord(value, data, limitSeconds) {
  return value.available === true && data.stale !== true &&
    (typeof value.stale === 'boolean' ? !value.stale : freshAt(value.updatedAt, limitSeconds));
}
function duration(value) {
  if (!finite(value)) return '未记录';
  const total = Math.max(0, Math.floor(value));
  const days = Math.floor(total / 86400), hours = Math.floor(total % 86400 / 3600), minutes = Math.floor(total % 3600 / 60);
  return (days ? days + ' 天 ' : '') + (hours || days ? hours + ' 小时 ' : '') + minutes + ' 分钟';
}
function fact(label, value) {
  const item = node('div', 'fact-row');
  item.append(node('dt', '', label), node('dd', '', value));
  return item;
}
function facts(id, entries) { const list = node('dl'); entries.forEach((entry) => list.append(fact(...entry))); replace(id, [list]); }
function metric(label, value, detail, words = false) {
  const card = node('div', 'metric');
  card.append(node('p', 'metric-label', label), node('p', 'metric-value' + (words ? ' words' : ''), value), node('p', 'metric-detail', detail), node('div', 'metric-rule'));
  return card;
}
function setLink(id, raw) {
  const target = byId(id);
  let url;
  try { url = new URL(raw); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('unsupported'); } catch { url = null; }
  if (url) {
    target.href = url.href; target.target = '_blank'; target.rel = 'noopener noreferrer';
    target.classList.remove('disabled-link'); target.removeAttribute('aria-disabled');
  } else {
    target.removeAttribute('href'); target.removeAttribute('target'); target.setAttribute('aria-disabled', 'true'); target.classList.add('disabled-link');
  }
  return url ? url.origin : '';
}
function selectView(name, updateHash = true) {
  activeView = Object.hasOwn(views, name) ? name : 'overview';
  const [label, eyebrow, title, description] = views[activeView];
  document.querySelectorAll('[data-view]').forEach((button) => {
    const selected = button.dataset.view === activeView;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('.view').forEach((view) => { view.hidden = view.id !== 'view-' + activeView; });
  byId('breadcrumb-current').textContent = label;
  byId('page-eyebrow').textContent = eyebrow;
  byId('page-title').textContent = title;
  byId('page-description').textContent = description;
  document.title = label + ' · 千灯纪管理台';
  if (snapshot) renderActiveView(snapshot);
  if (updateHash && location.hash !== '#' + activeView) history.replaceState(null, '', '#' + activeView);
  document.dispatchEvent(new CustomEvent('qiandeng:view',{detail:activeView}));
}
function renderOverview(data) {
  const world = record(data.world), health = record(data.health), skills = record(data.skills);
  const currentWorld = currentRecord(world, data, 180);
  byId('world-headline').textContent = currentWorld ? '世界心跳已更新' : world.available ? '世界记录暂未更新' : '等待世界心跳';
  byId('world-subtitle').textContent = currentWorld ? '最近记录于 ' + formatDate(world.updatedAt) + '。查看守望、村务与行旅近况。' : '管理台仍可独立查看档案；世界是否运行，请以新鲜心跳为准。';
  replace('overview-metrics', [
    metric('世界心跳', currentWorld ? '记录新鲜' : world.available ? '记录陈旧' : '暂无记录', '更新于 ' + formatDate(world.updatedAt), true),
    metric('守望名单', number(rows(world.observedPlayers).length), '不含化身，不作为全服人数'),
    metric('精选秘术', skills.available ? number(rows(skills.featured).length) : '—', '原有记录与归档分别保留'),
    metric('已记录传送点', number(rows(data.waypoints).length), '游戏内选择，服务端检查落点')
  ]);
  const healthTone = !health.available || health.stale ? 'neutral' : health.ok ? 'good' : 'bad';
  setBadge('health-badge', !health.available ? '暂无检测' : health.stale ? '历史检测' : health.ok ? '检查通过' : '需留意', healthTone);
  byId('health-caption').textContent = health.available ? (health.stale ? '以下为历史检查结果，不能据此判断当前运行状态。' : '以下为最近一次检查记录。') + ' 检查时间：' + formatDate(health.checkedAt) : '尚未取得服务检查报告；这不影响管理台自身运行。';
  replace('service-list', rows(health.services).map((service) => {
    const item = node('div', 'service-row');
    const main = node('div', 'service-main');
    main.append(node('p', 'service-name', serviceNames[service.name] || text(service.name)), node('p', 'service-purpose', servicePurposes[service.name] || text(service.purpose, text(service.state, '状态未记录'))));
    const status = health.stale ? '历史 · ' + (service.ok ? '正常' : '异常') : service.ok === true ? '正常' : service.ok === false ? '需检查' : '未记录';
    item.append(node('div', 'service-icon', text(service.name, '?').slice(0, 2).toUpperCase()), main, badge(status, health.stale ? 'neutral' : service.ok === true ? 'good' : service.ok === false ? 'bad' : 'neutral'));
    return item;
  }).concat(rows(health.services).length ? [] : [empty('暂无服务检测记录')]));
  setBadge('world-badge', currentWorld ? '心跳新鲜' : world.available ? '心跳陈旧' : '暂无心跳', currentWorld ? 'good' : 'neutral');
  facts('world-facts', [['守望化身', text(world.goddess, '未记录')], ['世界进程运行时长', duration(world.uptimeSec)], ['最近心跳', formatDate(world.updatedAt)]]);
  replace('observed-players', rows(world.observedPlayers).length ? rows(world.observedPlayers).map((name) => node('span', 'chip', name + (currentWorld ? '' : ' · 上次记录'))) : [empty('守望名单暂为空；化身与内部探针另行记录。')]);
  const links = record(data.links);
  setLink('overview-qwenpaw', links.qwenpaw); setLink('resources-link', links.resources);
}
function renderPlayers(data) {
  const all = rows(data.players), query = byId('player-search').value.trim().toLocaleLowerCase('zh-CN');
  const shown = all.filter((player) => text(player.name, '').toLocaleLowerCase('zh-CN').includes(query));
  byId('player-count').textContent = number(all.length) + ' 份';
  replace('player-list', shown.map((player) => {
    const card = node('div', 'player-card'), heading = node('div', 'player-heading'), name = node('div');
    name.append(node('p', 'player-name', player.name), node('p', 'player-level', '档案等级 · ' + number(player.level)));
    heading.append(node('span', 'avatar', Array.from(text(player.name, '人'))[0]), name);
    const mana = node('p', 'mana-label'); mana.append(node('span', '', '秘术魔力'), node('strong', '', number(player.mana, 1) + ' / ' + number(player.maxMana, 1)));
    const track = node('div', 'mana-track'), fill = node('div', 'mana-fill');
    const ratio = finite(player.mana) && finite(player.maxMana) && player.maxMana > 0 ? Math.max(0, Math.min(100, player.mana / player.maxMana * 100)) : 0;
    fill.style.width = ratio + '%'; track.setAttribute('aria-hidden', 'true'); track.append(fill);
    card.append(heading, mana, track, node('p', 'player-details', '已学记录 ' + number(player.learnedCount) + ' 项 · 被动记录 ' + number(player.passiveCount) + ' 项'));
    return card;
  }).concat(shown.length ? [] : [empty(query ? '没有找到匹配的角色档案。' : '暂无可展示的角色档案。')]));
}
function renderSkills(data) {
  const skills = record(data.skills);
  setBadge('skills-badge', skills.available ? rows(skills.featured).length + ' 项精选' : '暂无目录', skills.available ? 'amber' : 'neutral');
  replace('featured-skills', rows(skills.featured).map((skill) => {
    const card = node('div', 'skill-card'), title = node('div', 'skill-title-row');
    title.append(node('h3', 'skill-name', text(skill.name, skill.id)), node('span', 'skill-condition', 'Lv ' + number(skill.requiredLevel) + ' · 魔力 ' + number(skill.mana)));
    const words = node('div', 'skill-words'); rows(skill.words).slice(0, 6).forEach((word) => words.append(node('span', 'word-chip', word)));
    card.append(title, node('p', 'skill-id', skill.id), node('p', 'skill-reason', text(skill.reason, '在游戏内查看当前可用条件。')));
    if (words.childElementCount) card.append(words);
    return card;
  }).concat(rows(skills.featured).length ? [] : [empty('技能目录暂不可用，请稍后刷新。')]));
  setBadge('archive-count', number(skills.archivedCount) + ' 项归档 · ' + number(skills.passiveCount) + ' 项被动');
  replace('archived-skills', rows(skills.archived).map((skill) => {
    const row = node('div', 'archive-row'), top = node('div', 'archive-top');
    const kind = skill.kind === 'passive' ? '被动档案' : '归档';
    top.append(node('strong', '', text(skill.name, skill.id)), badge(kind));
    row.append(top, node('p', '', text(skill.id) + ' · ' + text(skill.reason, '保留原有记录。')));
    if (rows(skill.nativeHints).length) row.append(node('p', '', '原生法术提示：' + rows(skill.nativeHints).map((hint) => text(hint, '')).join('、')));
    return row;
  }).concat(rows(skills.archived).length ? [] : [empty('暂无归档条目。')]));
}
function renderVillage(data) {
  const guild = record(data.guild), npc = record(data.npc), board = rows(guild.board);
  replace('guild-metrics', [metric('今日委托记录', guild.available ? number(board.length) : '—', text(guild.date, '日期未记录')), metric('普通委托', enabled(guild.basicQuests), '普通任务与自动建造分别管理', true), metric('自动生成', enabled(guild.autogenerate), '营地与首领等生成开关', true)]);
  setBadge('guild-badge', !guild.available ? '暂无看板' : guild.stale ? '历史看板' : '当前日期', guild.available && !guild.stale ? 'good' : 'neutral');
  byId('guild-caption').textContent = guild.available ? '看板日期：' + text(guild.date) + ' · 最近轮询：' + formatDate(guild.updatedAt) +
    (guild.pollingError ? '。公会轮询报告错误，以下为上次看板记录。' : guild.stale ? '。以下是历史记录。' : '。保留原委托状态，接取说明单独列出。') : '当日任务板尚不可读取。';
  replace('guild-board', board.map((quest) => {
    const row = node('tr'), title = node('td'), state = node('td'), reward = node('td', 'reward');
    title.append(node('p', 'quest-title', quest.title), node('p', 'quest-sub', text(typeNames[quest.type], text(quest.type)) + (quest.rank !== undefined && quest.rank !== null ? ' · ' + text(quest.rank) : '')));
    const statuses = { open: ['开放记录', 'neutral'], claimed: ['进行中', 'amber'], done: ['已完成', 'good'], paused: ['暂停接取', 'neutral'] };
    const value = statuses[quest.status] || [text(quest.status, '未记录'), 'neutral']; state.append(badge(...value));
    reward.append(node('p', '', number(quest.reward) + ' 绿宝石'), node('p', 'quest-sub', '功勋 ' + number(quest.fame)));
    row.append(node('td', '', '#' + text(quest.no)), title, state, reward, node('td', 'quest-note', text(quest.claimNote, '实际条件请在游戏内核验。')));
    return row;
  }).concat(board.length ? [] : [(() => { const row = node('tr'), cell = node('td'); cell.colSpan = 5; cell.append(empty('暂无委托记录。')); row.append(cell); return row; })()]));
  replace('guild-fame', rows(guild.fame).map((person, index) => {
    const row = node('div', 'reputation-row'), name = node('div', 'reputation-name', person.name), value = node('div', 'reputation-value', number(person.fame));
    name.append(node('small', '', text(person.rank, '档位未记录') + ' · 完成 ' + number(person.done) + ' 单')); value.append(node('small', '', '功勋'));
    row.append(node('span', 'reputation-number', String(index + 1).padStart(2, '0')), name, value); return row;
  }).concat(rows(guild.fame).length ? [] : [empty('暂无功勋记录。')]));
  const currentNpc = currentRecord(npc, data, 100);
  setBadge('npc-badge', currentNpc ? '心跳新鲜' : npc.available ? '历史状态' : '暂无状态', currentNpc ? 'good' : 'neutral');
  facts('npc-facts', [['最近更新', formatDate(npc.updatedAt)], ['NPC 模型调用', enabled(npc.llmEnabled)], ['补召缺失 NPC', enabled(npc.spawnMissing)]]);
  replace('npc-threads', rows(npc.threads).map((thread) => badge(text(thread.name) + ' · ' + (!currentNpc ? '上次记录 ' : '') + (thread.ok === true ? '正常' : thread.ok === false ? '异常' : '未记录'), !currentNpc ? 'neutral' : thread.ok === true ? 'good' : thread.ok === false ? 'bad' : 'neutral')));
}
function renderWaypoints(data) {
  const points = rows(data.waypoints);
  setBadge('waypoint-count', number(points.length) + ' 处记录', 'amber');
  replace('waypoint-list', points.map((point, index) => {
    const card = node('div', 'waypoint-card'), art = node('div', 'waypoint-art'), body = node('div', 'waypoint-body');
    art.setAttribute('aria-hidden', 'true'); art.append(node('span', '', '⌖'), node('span', '', 'WAYPOINT / ' + String(index + 1).padStart(2, '0')));
    body.append(node('h3', 'waypoint-name', point.name), node('p', 'waypoint-dimension', text(dimensionNames[point.dimension], text(point.dimension))));
    const coordinates = node('div', 'coordinate-row');
    ['x', 'y', 'z'].forEach((axis) => { const item = node('span', '', axis.toUpperCase()); item.append(node('strong', '', number(point[axis], 2))); coordinates.append(item); });
    body.append(coordinates); card.append(art, body); return card;
  }).concat(points.length ? [] : [empty('暂无可展示的传送点记录。')]));
}
function renderAgent(data) {
  const agent = record(data.agent), capabilities = record(agent.capabilities), links = record(data.links);
  const world = record(data.world);
  const currentAgent = currentRecord(world, data, 180);
  byId('agent-label').textContent = text(agent.label, '尚未记录接入服务');
  facts('agent-facts', [['接入标识', text(agent.id, '未记录')], ['运行记录', currentAgent ? '来自最近世界心跳' : '上次运行后端，当前状态未确认'], ['最近心跳', formatDate(world.updatedAt)], ['设置入口', '服务原控制台'], ['管理台权限', '只读查看']]);
  replace('agent-capabilities', [['对话', capabilities.chat], ['任务', capabilities.task]].map(([label, value]) => { const item = node('div', 'capability'); item.append(node('strong', '', label), badge((currentAgent ? '' : '历史 · ') + (value === true ? '声明支持' : value === false ? '未声明支持' : '未记录'), currentAgent && value === true ? 'good' : 'neutral')); return item; }));
  const origin = setLink('agent-qwenpaw', links.qwenpaw);
  byId('agent-endpoint').textContent = origin || '尚未配置控制台地址';
}
function operationsState(value, historical = false) {
  const states = { running: ['进程运行', 'good'], healthy: ['健康', 'good'], ready: ['就绪', 'good'],
    stopped: ['已停止', 'neutral'], exited: ['已退出', 'neutral'], disabled: ['已禁用', 'neutral'],
    unhealthy: ['健康异常', 'bad'], error: ['异常', 'bad'], failed: ['失败', 'bad'],
    degraded: ['部分不可用', 'amber'], starting: ['启动中', 'amber'], restarting: ['重启中', 'amber'],
    unknown: ['状态未知', 'neutral'], unavailable: ['不可用', 'bad'], unverified: ['尚未验证', 'neutral'] };
  const status = Object.hasOwn(states, value) ? states[value] : [text(value, '未记录'), 'neutral'];
  return badge((historical ? '历史 · ' : '') + status[0], historical ? 'neutral' : status[1]);
}
function operationsCard(label, id, status, description, entries) {
  const card = node('div', 'operations-card'), heading = node('div', 'operations-heading'), name = node('div');
  name.append(node('h3', '', text(label, text(id, '未命名记录'))), node('p', 'operations-id', id));
  heading.append(name, status);
  const details = node('dl', 'operations-facts'); entries.forEach(entry => details.append(fact(...entry)));
  card.append(heading, node('p', 'operations-description', text(description, '职责尚未记录')), details);
  return card;
}
function renderOperations(data) {
  const ops = record(data.operations), available = ops.available === true, historical = ops.stale !== false;
  // This page is the current world's team. The collector retains the full audit inventory.
  const runtimes = rows(ops.runtimes).filter(runtime => ['qiandengji','qiandengji-ops'].includes(runtime.id));
  const agents = rows(ops.agents).filter(agent => ['qiandengji','qiandengji-ops'].includes(agent.runtimeId)
    && !/^QwenPaw_QA_Agent_/.test(agent.id) && !(agent.runtimeId === 'qiandengji' && agent.id === 'default'));
  const services = rows(ops.services).filter(service => !['legacy-team', 'retired'].includes(service.group));
  const issues = rows(ops.issues).filter(issue => !['runtime_versions_differ', 'host_non_game_jobs'].includes(issue.code));
  setBadge('operations-badge', !available ? '暂无有效快照' : historical ? '历史快照' : '快照新鲜', available && !historical ? 'good' : 'neutral');
  const note = byId('operations-notice'); note.className = historical ? 'notice' : 'operations-timestamp';
  note.textContent = !available ? (ops.staleReason === 'future' ? '运营快照时间晚于当前时间，暂不采用这份记录。' : '运营快照尚不可用；管理台仍可独立使用。')
    : (historical ? (ops.staleReason === 'connection' ? '连接中断，以下保留上次运营记录，当前状态未确认。' : '以下是上次运营记录，已超过 5 分钟，不能据此判断当前状态。') : '最近采集：' + formatDate(ops.generatedAt) + '。')
      + (historical ? ' 记录时间：' + formatDate(ops.generatedAt) : ' 页面只读，启用配置不代表任务正在执行。');
  replace('operations-metrics', [metric('运行环境', available ? number(runtimes.length) : '—', '千灯纪项目'),
    metric('启用角色', available ? number(agents.filter(agent => agent.enabled === true).length) : '—', '共 ' + number(agents.length) + ' 个项目角色'),
    metric('服务记录', available ? number(services.length) : '—', '当前项目及所需依赖'),
    metric('待处理项', available ? number(issues.length) : '—', historical ? '来自历史快照' : '以采集范围为准')]);
  const policy = record(ops.teamPolicy), usage = record(ops.teamUsage);
  const measured = (value, unit = '') => finite(value) ? number(value, 1) + unit : '未知';
  const switchState = value => value === true ? '开启' : value === false ? '关闭' : '未知';
  setBadge('operations-policy-version', policy.packageVersion ? 'QwenPaw ' + policy.packageVersion : '版本未记录');
  byId('operations-policy-summary').textContent = (historical ? '历史配置：' : '')
    + (policy.mode === 'manual' ? '按需触发' : '触发方式未知') + ' · 最多同时 ' + measured(policy.maxConcurrentModels, ' 个模型')
    + ' · 每分钟最多 ' + measured(policy.maxQueriesPerMinute, ' 次请求') + ' · 每次最多 ' + measured(policy.maxIterations, ' 轮迭代')
    + ' · 自动重试' + switchState(policy.automaticRetries) + '。';
  replace('operations-usage-metrics', [metric('模型请求', measured(usage.callCount), usage.window === 'today' ? '今日运营组记录' : '统计时段未知'),
    metric('输入 Token', measured(usage.promptTokens), '供应商返回的用量'), metric('输出 Token', measured(usage.completionTokens), '供应商返回的用量'),
    metric('缓存 Token', measured(usage.cachedTokens), '不另加到输入用量')]);
  byId('operations-policy-delegation').textContent = '角色委派：间隔至少 ' + measured(finite(policy.delegationCooldownSeconds) ? policy.delegationCooldownSeconds / 60 : null, ' 分钟')
    + '，24 小时最多 ' + measured(policy.maxDelegationsPerDay, ' 次') + '。定时任务 ' + measured(policy.scheduledJobs, ' 个') + '，自动心跳' + switchState(policy.heartbeat) + '。';
  byId('operations-usage-note').textContent = (historical ? '历史快照中的用量。' : '') + '用量更新：' + formatDate(usage.generatedAt)
    + '。仅统计独立运营组；缺失数据为未知。Token 记录不等于实际账单，套餐余额以服务商为准。';
  setBadge('operations-issue-count', available ? number(issues.length) + ' 项' : '待采集', historical ? 'neutral' : issues.length ? 'amber' : 'neutral');
  replace('operations-issues', issues.map(issue => {
    const card = node('div', 'operations-issue'), top = node('div', 'operations-heading');
    const severity = { error: ['需处理', 'bad'], warning: ['需留意', 'amber'], info: ['提示', 'neutral'] }[issue.severity] || ['未分级', 'neutral'];
    top.append(node('h3', '', text(issue.title, issue.code)), badge((historical ? '历史 · ' : '') + severity[0], historical ? 'neutral' : severity[1]));
    card.append(top, node('p', 'operations-description', issue.detail), node('p', 'operations-id', issue.code)); return card;
  }).concat(issues.length ? [] : [empty(available ? '这份快照没有记录待处理项。' : '等待采集待处理项。')]));
  replace('operations-runtimes', runtimes.map(runtime => {
    const card = operationsCard(runtime.label, runtime.id, operationsState(runtime.state, historical), runtime.purpose,
      [['运行方式', text(runtime.kind)], ['版本', text(runtime.version)],
        ['项目角色', '启用 ' + number(agents.filter(agent => agent.runtimeId === runtime.id && agent.enabled === true).length)
          + ' / 登记 ' + number(agents.filter(agent => agent.runtimeId === runtime.id).length)]]);
    let url;
    try { url = new URL(runtime.endpoint); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) url = null; } catch { url = null; }
    if (url) {
      const link = node('a', 'operations-console', '打开控制台 ↗');
      link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      card.append(link, node('p', 'operations-id', url.origin));
    } else card.append(node('p', 'footnote', '未记录可用控制台地址'));
    return card;
  }).concat(runtimes.length ? [] : [empty('暂无运行环境记录。')]));
  replace('operations-agents', agents.map(agent => {
    const card = operationsCard(agent.label, agent.id,
    badge((historical ? '历史 · ' : '') + (agent.enabled === true ? '已启用' : agent.enabled === false ? '已禁用' : '启用状态未知'),
      !historical && agent.enabled === true ? 'amber' : 'neutral'), agent.role,
    [['所属职责', agent.runtimeId === 'qiandengji-ops' ? '世界运营组' : '游戏会话'], ['模型服务', text(agent.modelProvider)], ['模型', text(agent.model)],
      ['已配置工具 / MCP', number(agent.toolCount) + ' / ' + number(agent.mcpCount)], ['已登记任务', number(agent.jobCount)]]);
    if (agent.runtimeId === 'qiandengji-ops') {
      const skills = record(policy.roleSkills)[agent.id], chips = node('div', 'chip-list');
      card.append(node('p', 'small-heading', '已配置技能'));
      rows(skills).forEach(skill => {
        const chip = node('span', 'chip', Object.hasOwn(operationsSkillNames, skill) ? operationsSkillNames[skill] : skill);
        chip.title = skill; chips.append(chip);
      });
      card.append(chips.childElementCount ? chips : node('p', 'footnote', Array.isArray(skills) ? '尚未配置技能' : '技能记录未知'));
    }
    return card;
  })
    .concat(agents.length ? [] : [empty('千灯纪项目暂无运营角色配置。')]));
  const round = record(ops.teamRound), results = rows(round.roles);
  setBadge('operations-round-status', !round.runId ? '尚未运行' : (historical ? '历史 · ' : '') + (round.ok === true ? '已完成' : '部分未完成'), !historical && round.ok === true ? 'good' : 'neutral');
  byId('operations-round-note').textContent = (round.runId ? '巡检结束：' + formatDate(round.finishedAt) + '。' : '') + '报告保留各角色的发现与建议；建议不会自动执行。';
  const usageEntries = value => [['模型请求', measured(value.modelCalls, ' 次')], ['输入 / 输出 Token', measured(value.promptTokens) + ' / ' + measured(value.completionTokens)], ['用时', measured(value.elapsedSeconds, ' 秒')]];
  if (round.runId) facts('operations-round-usage', usageEntries(round)); else replace('operations-round-usage', []);
  replace('operations-round-reports', results.map(result => {
    const label = agents.find(agent => agent.runtimeId === 'qiandengji-ops' && agent.id === result.role)?.label || result.role;
    return operationsCard(label, result.requestId || result.role, badge((historical ? '历史 · ' : '') + (result.ok ? '报告已记录' : '需要检查'), historical ? 'neutral' : result.ok ? 'good' : 'amber'),
      text(result.summary, '本轮未取得有效报告，请在运营控制台检查模型与工具状态。'), [['状态', result.ok ? '建议已留档' : text(result.errorType, '未完成')], ...usageEntries(result)]);
  }).concat(results.length ? [] : [empty('尚无巡检报告。可在运营控制台向角色提出任务，或使用下方终端命令运行完整一轮。')]));
  const groups = new Map(); services.forEach(service => { const key = text(service.group, '未分组'); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(service); });
  replace('operations-services', [...groups].map(([label, entries]) => {
    const section = node('section', 'operations-service-group'), grid = node('div', 'operations-grid');
    section.append(node('h3', 'operations-group-title', label + ' · ' + entries.length));
    entries.forEach(service => {
      const card = operationsCard(service.label, service.id, operationsState(service.state, historical), service.purpose,
        [['容器', text(service.container)], ['管理方式', text(service.managedBy)]]);
      const status = node('div', 'operations-health'); status.append(node('span', '', '健康记录'), operationsState(service.health, historical));
      const dependencies = node('div', 'chip-list'); rows(service.dependencies).forEach(id => dependencies.append(node('span', 'chip', id)));
      card.append(status, node('p', 'small-heading', '依赖'), dependencies.childElementCount ? dependencies : node('p', 'footnote', '未列出依赖'));
      grid.append(card);
    });
    section.append(grid); return section;
  }).concat(groups.size ? [] : [empty('暂无服务与依赖记录。')]));
  replace('operations-commands', rows(ops.commands).map(command => {
    const section = node('div', 'operations-command'); section.append(node('h3', '', text(command.label, '管理命令')));
    const pre = node('pre'); pre.setAttribute('tabindex', '0'); pre.setAttribute('aria-label', text(command.label, '管理命令') + '，仅供查看');
    pre.append(node('code', '', text(command.command, '命令未记录'))); section.append(pre); return section;
  }).concat(rows(ops.commands).length ? [] : [empty('暂无已登记的管理命令。')]));
}
function renderActiveView(data) {
  // Keep hidden sections idle while the WebGL view is doing its work.
  if (activeView === 'overview') renderOverview(data);
  else if (activeView === 'beings') { renderPlayers(data); renderSkills(data); }
  else if (activeView === 'village') renderVillage(data);
  else if (activeView === 'world') renderWaypoints(data);
  else if (activeView === 'agent') renderAgent(data);
  else if (activeView === 'operations') renderOperations(data);
}
function render(data) {
  snapshot = data;
  const warnings = rows(data.warnings).slice(0, 12).map((warning) => { const row = node('div', 'warning-row'); row.append(node('span', '', '◈'), node('span', '', text(warning, '状态记录需要留意。'))); return row; });
  replace('warnings', warnings);
  const notice = byId('connection-notice'); notice.className = 'notice';
  notice.hidden = data.available === true && data.stale !== true;
  notice.textContent = data.available !== true ? '世界记录尚不可用。管理台正常运行，已有栏目将在记录就绪后更新。' : '当前显示的世界快照已经陈旧，请留意各项更新时间。';
  byId('refresh-time').textContent = '更新于 ' + formatDate(data.generatedAt) + ' · 每 15 秒刷新';
  renderActiveView(data);
}
async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try { const response = await fetch(url, { cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } }); if (!response.ok) throw new Error('HTTP ' + response.status); return await response.json(); } finally { clearTimeout(timer); }
}
async function refresh(manual = false) {
  if (fetching) return;
  fetching = true; const button = byId('refresh-button'); button.disabled = true; button.setAttribute('aria-busy', 'true');
  const [stateResult, panelResult] = await Promise.allSettled([fetchJson('/api/state'), fetchJson('/healthz')]);
  const panelOk = panelResult.status === 'fulfilled';
  byId('panel-dot').className = 'status-dot ' + (panelOk ? 'good' : 'bad');
  byId('panel-status').textContent = panelOk ? '管理台正常运行' : '管理台连接暂不可用';
  try {
    if (stateResult.status !== 'fulfilled') throw new Error('fetch_failed');
    const data = record(stateResult.value);
    if (data.schema !== 1) throw new Error('schema_unsupported');
    render(data);
    if (manual) byId('live-message').textContent = '记录已刷新。' + (data.stale ? '当前世界记录陈旧。' : '');
  } catch (error) {
    if (snapshot) render({ ...snapshot, stale: true, health: { ...record(snapshot.health), stale: true }, operations: { ...record(snapshot.operations), stale: true, staleReason: 'connection' } });
    const notice = byId('connection-notice'); notice.hidden = false; notice.className = 'notice error';
    notice.textContent = snapshot ? '未能取得新快照，以下保留上次读取的历史记录。请稍后刷新。' : '暂时无法读取世界记录，页面会继续重试。';
    if (snapshot) {
      byId('world-headline').textContent = '正在展示上次记录';
      setBadge('world-badge', '连接中断', 'neutral'); setBadge('health-badge', '上次检查', 'neutral');
    }
    if (manual) byId('live-message').textContent = notice.textContent;
  } finally { fetching = false; button.disabled = false; button.removeAttribute('aria-busy'); }
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => selectView(button.dataset.view)));
document.querySelector('.nav-list').addEventListener('keydown', (event) => {
  if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
  const buttons = Array.from(document.querySelectorAll('[data-view]')), current = buttons.indexOf(document.activeElement);
  if (current < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next].focus(); selectView(buttons[next].dataset.view);
});
byId('refresh-button').addEventListener('click', () => refresh(true));
byId('player-search').addEventListener('input', () => { if (snapshot) renderPlayers(snapshot); });
window.addEventListener('hashchange', () => selectView(location.hash.slice(1), false));
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
selectView(location.hash.slice(1), false);
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 15000);
