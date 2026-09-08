'use strict';

const views = {
  survivor: ['桐人 · 自主生存', 'AUTONOMOUS ADVENTURE', '桐人 · 自主生存', '跟随他的目标、行动与学习，了解世界里的真实进展。'],
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
serviceNames.survivor = '桐人 · 自主生存';
servicePurposes.survivor = '自主规划、生存与技能学习';
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
  else if (activeView === 'survivor') renderSurvivor(data);
}
function renderSurvivorGameSkills(raw, body) {
  const value = record(raw), available = value.available === true, sources = record(value.sourceObservedAt);
  const queried = stamp => finite(stamp) ? '历史查询：' + formatDate(stamp) : '尚无查询时间';
  setBadge('survivor-game-skills-badge', available ? '历史查询' : '尚未查询', 'neutral');
  byId('survivor-game-skills-freshness').textContent = available ? queried(value.observedAt)
    + (value.truncated ? ' · 列表较长，这里展示部分查询摘要。' : ' · 各项可能来自不同时间的查询。')
    : '等待桐人首次查询自己的法术与成长状态。';
  byId('survivor-legacy-query').textContent = queried(sources.skills);
  byId('survivor-native-query').textContent = queried(sources['spells irons']);
  byId('survivor-attributes-query').textContent = '状态查询：' + formatDate(sources.status)
    + ' · 法术查询：' + formatDate(sources['spells irons']);
  byId('survivor-progression-query').textContent = queried(sources.status);
  facts('survivor-game-levels', [['女神等级', available ? number(value.legacyLevel) : '尚未查询'],
    ['原生等级', available ? number(value.nativeLevel) : '尚未查询'],
    ['女神法力', available ? number(value.legacyMana) + ' / ' + number(value.legacyMaxMana) : '尚未查询'],
    ['铁魔法法力', available ? number(value.nativeMana) + ' / ' + number(value.nativeMaxMana) : '尚未查询']]);
  const spellRows = (id, entries, known, emptyText, native = false) => replace(id,
    known && entries.length ? entries.map(spell => {
      const card = node('div', 'operation-record');
      card.append(node('strong', '', text(spell.name)), node('p', 'footnote', text(spell.id)));
      const details = [finite(spell.level) ? '等级 ' + number(spell.level) : '', finite(spell.mana) ? '法力 ' + number(spell.mana) : ''];
      if (native) details.push(spell.ready === true ? '查询时就绪' : spell.ready === false ? '查询时未就绪' : '',
        finite(spell.cooldownMs) ? '冷却 ' + number(spell.cooldownMs / 1000, 1) + ' 秒' : '');
      if (details.some(Boolean)) card.append(node('p', 'card-caption', details.filter(Boolean).join(' · ')));
      return card;
    }) : [empty(known ? emptyText : '尚未查询，技能情况未知。')]);
  const legacyKnown = available && value.legacySkillsKnown === true;
  spellRows('survivor-learned', rows(value.learned), legacyKnown, '查询摘要中没有已学会的女神技能。');
  spellRows('survivor-eligible', rows(value.eligible), legacyKnown, '查询摘要中没有待学习且已满足等级的技能。');
  spellRows('survivor-native-spells', rows(value.nativeSpells), available && value.nativeSpellsKnown === true,
    value.truncated ? '摘要中没有可展示的已装备法术；完整列表需再次查询。' : '上次查询未装备可用法术或卷轴。', true);
  const progression = record(value.pufferfish);
  if (!available || progression.known !== true) replace('survivor-progression', [empty('尚未查询成长数据。')]);
  else if (progression.ok !== true) replace('survivor-progression', [empty('上次查询未能读取成长数据。')]);
  else if (!rows(progression.categories).length) replace('survivor-progression', [empty('查询摘要中没有成长类别记录。')]);
  else facts('survivor-progression', rows(progression.categories).map(category => [category.id,
    category.available === true ? '等级 ' + number(category.level) + ' · 经验 ' + number(category.experience)
      + ' · 技能点剩余 ' + number(category.pointsLeft) + ' / 共 ' + number(category.pointsTotal)
      + '（已用 ' + number(category.pointsSpent) + '）' : '此成长类别暂不可用']));
  const attributes = record(value.attributes), labels = { health: '生命', maxHealth: '最大生命', maxMana: '最大法力',
    manaRegen: '法力恢复', spellPower: '法术强度', spellResist: '法术抗性', cooldownReduction: '冷却缩减', castTimeReduction: '施法时间缩减' };
  const entries = Object.entries(labels).filter(([key]) => available && finite(attributes[key])).map(([key, label]) => [label, number(attributes[key], 2)]);
  if (entries.length) facts('survivor-game-attributes', entries);
  else replace('survivor-game-attributes', [empty('尚无可用的身体属性查询记录。')]);
  replace('survivor-skill-books', rows(body.ownedSkillBooks).map(book => {
    const card = node('div', 'operation-record');
    card.append(node('strong', '', book.bookName + ' × ' + number(book.count)),
      node('p', 'footnote', '背包槽位 ' + number(book.slot)));
    const unknown = { catalog_unavailable: '等待技能目录查询后识别', ambiguous: '目录存在重名，技能身份待核对', unrecognized: '技能目录暂未识别此书' };
    if (book.recognized === true) {
      card.append(node('p', 'card-caption', text(book.name || book.skillId)
        + (finite(book.requiredLevel) ? ' · 所需等级 ' + number(book.requiredLevel) : '')
        + (book.type === 'passive' ? ' · 被动技能' : book.type === 'active' ? ' · 主动技能' : '')),
        node('p', 'footnote', book.skillId + ' · 目录查询：' + formatDate(book.catalogObservedAt)));
      if (typeof book.knownLearned === 'boolean') card.append(node('p', 'footnote', book.knownLearned ? '目录查询时已学会' : '目录查询时尚未学会'));
    } else card.append(node('p', 'card-caption', unknown[book.recognition] || '技能身份待核对'));
    return card;
  }).concat(rows(body.ownedSkillBooks).length ? [] : [empty(body.online === true ? '背包记录中没有技能书。' : '等待身体连接后读取技能书。')]));
  byId('survivor-skill-books-note').textContent = '携带技能书后仍需满足学习条件并实际参悟。'
    + (body.skillBooksTruncated ? ' 当前仅展示部分技能书。' : '');
}
function renderSurvivorLife(value, stale) {
  const life = record(value.adventure), resources = record(life.resources), gear = record(life.equipment);
  const fresh = life.available === true && life.fresh === true && !stale;
  setBadge('survivor-life-badge', life.available !== true ? '来源未知' : fresh ? '观察摘要' : '历史观察', 'neutral');
  byId('survivor-life-freshness').textContent = life.available !== true ? '尚未收到生活状态，不能判断补给、装备或机会。'
    : (fresh ? '身体观察：' : '历史身体观察：') + formatDate(life.observedAt) + (life.truncated ? ' · 仅展示部分记录' : '')
      + '。下列机会有各自的来源时效。';
  const labels = {food: '携带食物', tools: '工具', materials: '材料', agriculture: '农作物与种子', other: '其他物品'};
  const items = record(resources.items);
  facts('survivor-life-resources', Object.entries(labels).filter(([key]) => key !== 'other' || rows(items[key]).length).map(([key, label]) =>
    [label, resources.known !== true ? '尚未观察' : rows(items[key]).length
      ? rows(items[key]).slice(0, 4).map(row => row.id + ' ×' + number(row.count)).join('、') + (rows(items[key]).length > 4 ? ' …' : '')
      : '摘要中没有记录']));
  const slots = {mainhand: '主手', offhand: '副手', head: '头部', chest: '胸部', legs: '腿部', feet: '脚部'};
  byId('survivor-life-equipment').textContent = gear.known !== true ? '装备情况尚未观察。'
    : '装备：' + (rows(gear.slots).filter(row => row.id !== 'minecraft:air').map(row => slots[row.slot] + ' ' + row.id).join('；') || '观察时为空');
  const guild = record(life.guild), villagers = record(life.villagers);
  facts('survivor-life-opportunities', [['公会公示', guild.known !== true ? '尚未读取'
    : (guild.fresh === true && !stale ? '最近公示 · ' : '历史公示 · ') + (rows(guild.board).slice(0, 3).map(row => '#' + number(row.no) + ' ' + text(row.title)).join('；') || '没有条目')],
    ['附近商人', villagers.known !== true ? '尚未观察' : (villagers.fresh === true && !stale ? '最近观察 · ' : '历史观察 · ')
      + (rows(villagers.nearby).map(row => (row.type === 'minecraft:wandering_trader' ? '流浪商人' : '村民')
        + (finite(row.distance) ? ' ' + number(row.distance, 1) + ' 格' : '')).join('；') || '未发现商人') + '；报价尚未核对']]);
  const areas = rows(value.constructionAreas);
  byId('survivor-life-area').textContent = value.constructionAreasKnown !== true ? '建造范围尚未配置或读取。'
    : !areas.length ? '当前没有授权建造范围。' : '授权建造范围：' + areas.slice(0, 2).map(area =>
      text(area.name, dimensionNames[area.dimension] || area.dimension) + ' X ' + area.minX + '～' + area.maxX
      + ' / Y ' + area.minY + '～' + area.maxY + ' / Z ' + area.minZ + '～' + area.maxZ).join('；')
      + (areas.length > 2 ? '，另有 ' + (areas.length - 2) + ' 处' : '') + '。范围配置不代表已经建成住所。';
  const ownGuild = record(value.guild);
  if (ownGuild.available !== true) replace('survivor-life-contracts', [empty('本人合同进度尚未查询；公示不代表已接单或完成。')]);
  else {
    const contracts = rows(ownGuild.contracts), bodyCounts = record(record(value.body).counts);
    const blocks = {missing_goods: '所需物资不足', npc_not_near: '尚未到交付人附近', quest_expired: '合同已过期',
      claim_refused: '接单条件未满足', quest_not_owned: '不是本人合同', rank_too_low: '阶位不足'};
    const records = contracts.map(contract => {
      const entry = node('div', 'operation-record');
      entry.append(node('strong', '', contract.title || contract.questId));
      entry.append(node('p', 'footnote', '历史状态：' + text(contract.status, '未知') + ' · ' + contract.questId));
      if (contract.itemId && finite(contract.count)) entry.append(node('p', 'footnote',
        '需交付 ' + contract.itemId + ' ×' + number(contract.count) + '；'
        + (resources.known !== true || record(value.body).online !== true ? '携带量尚未观察'
          : (fresh ? '当前携带 ' : '历史携带 ') + number(bodyCounts[contract.itemId] ?? 0)) + '（不是已交付数量）'));
      else entry.append(node('p', 'footnote', '完成进度待公会验收' + (contract.objective?.mobId ? ' · 目标 ' + contract.objective.mobId + ' ×' + number(contract.objective.count) : '')));
      if (contract.blockedReason) entry.append(node('p', 'footnote', '缺少条件：' + (blocks[contract.blockedReason] || contract.blockedReason)));
      return entry;
    });
    replace('survivor-life-contracts', [node('p', 'card-caption', '本人合同 · 历史查询 ' + formatDate(ownGuild.observedAt)),
      ...(records.length ? records : [empty('上次查询没有本人已接合同。')])]);
  }
}
function renderParty(data) {
  const value = record(data.party), budget = record(value.budget), counts = record(value.counts);
  const available = value.available === true, stale = value.stale !== false;
  const labels = { pending: '已听见 · 待思考', unknown: '思考待确认', submitted: '正在回应', answered: '已听见回复', expired: '已过期', failed: '未完成' };
  const reasons = { busy: '队友正在处理其他事情，消息已排队。', budget_blocked: '等待调用额度或冷却恢复。',
    body_unavailable: '等待队友的游戏身体上线。', submission_not_confirmed: '投递结果尚未确认，正在核对，暂不重复发送。',
    binding_changed: '小队成员已变更，旧消息已停止投递。', ttl_expired: '消息已过期。',
    recipient_unavailable: '队友暂时无法接收消息。', task_failed: '上次交流未完成，请查看后续状态。',
    native_framework_interruption: '历史记录中曾误发模型的轮数上限提示；这是系统中断，不是角色的有效回答。' };
  const unconfigured = value.status === 'unconfigured';
  const status = unconfigured ? '尚未配置' : !available || value.status === 'unavailable' ? '暂不可用'
    : stale ? '历史记录 / 待更新' : value.enabled !== true ? '尚未启用'
    : budget.blocked === true ? '等待交流额度' : value.status === 'waiting' ? '等待处理' : '小队已连接';
  setBadge('survivor-party-badge', status, available && !stale && value.enabled && value.status === 'running' && !budget.blocked ? 'good' : 'neutral');
  byId('survivor-party-freshness').textContent = !available ? (unconfigured ? '尚未配置冒险小队。' : '小队状态暂时不可用。')
    : '记录更新：' + formatDate(value.updatedAt) + (stale ? '。已超过 90 秒或连接中断，以下为历史记录。' : '。');
  const members = rows(value.members), memberNames = new Map(members.map(member => [member.agentId, member.displayName]));
  replace('survivor-party-members', members.map(member => node('span', 'chip',
    text(member.displayName, '名称待设置') + ' · ' + (member.kind === 'maid' ? '冒险伙伴' : '冒险者')))
    .concat(members.length ? [] : [empty('队员尚未登记。')]));
  const messages = rows(value.messages), lastDetail = messages.find(message => message.detail)?.detail;
  byId('survivor-party-reason').textContent = !available || unconfigured ? '配置完成后可查看两位队员的交流与等待原因。'
    : stale ? '当前是否同行或正在交流尚未确认。'
    : value.enabled !== true ? '小队交流尚未启用。'
    : budget.blocked ? '等待调用额度或冷却恢复。' + (budget.nextDispatchAt ? ' 最早再次投递：' + formatDate(budget.nextDispatchAt) : '')
    : value.error ? (reasons[value.error] || '小队服务正在等待恢复，请查看服务状态。')
    : counts.unknown > 0 ? reasons.submission_not_confirmed
    : lastDetail && reasons[lastDetail] ? reasons[lastDetail]
    : counts.pending > 0 ? '队友已在游戏中听见说话，等待空闲或额度来思考回应。'
    : counts.submitted > 0 ? '队友正在回应已经听见的话。' : '两人在同一世界的 24 格内交谈；回复会留在感知中，下一次思考时读取。';
  if (available) facts('survivor-party-counts', [
    ['交流队列', ['pending', 'unknown', 'submitted'].map(key => labels[key] + ' ' + number(counts[key])).join(' · ')],
    ['近期记录', ['answered', 'expired', 'failed'].map(key => labels[key] + ' ' + number(counts[key])).join(' · ')],
    ['近 24 小时对话思考', number(budget.reservedDispatches24h) + (budget.unlimited === true ? ' · 不设调用额度' : ' / ' + number(budget.dailyDispatchCap) + ' · 剩余 ' + number(budget.remaining))],
  ]); else replace('survivor-party-counts', []);
  replace('survivor-party-messages', messages.map(message => {
    const item = node('article', 'party-message'), heading = node('div', 'operations-heading');
    heading.append(node('h3', '', text(memberNames.get(message.senderAgentId), '队员') + '在游戏里说'),
      badge(message.frameworkInterruption ? '系统中断' : labels[message.status] || '状态待确认'));
    item.append(heading, node('p', 'footnote', formatDate(message.createdAt)),
      node('p', 'party-message-text', message.text || '尚未确认这句话在游戏中被听见。'));
    if (record(message.hearing).heard) item.append(node('p', 'footnote', message.hearing.channel === 'msg'
      ? '游戏内 /msg 私聊' : '听见时相距 ' + Number(message.hearing.distance).toFixed(1) + ' 格'));
    if (message.reply) {
      const reply = node('div', 'party-reply');
      reply.append(node('h4', '', message.frameworkInterruption ? '历史系统提示' : text(memberNames.get(message.reply.senderAgentId), '队友') + '的回复'),
        node('p', 'party-message-text', message.reply.text), node('p', 'footnote', formatDate(message.reply.createdAt)));
      if (message.frameworkInterruption) reply.append(node('p', 'footnote', reasons.native_framework_interruption));
      item.append(reply);
    } else if (['rejected', 'unknown'].includes(record(message.replyHearing).state))
      item.append(node('p', 'footnote', '尚未确认在游戏中听见回应；离得太远或身体不可用时无法送达。'));
    else if (message.detail && reasons[message.detail]) item.append(node('p', 'footnote', reasons[message.detail]));
    return item;
  }).concat(messages.length ? [] : [empty(available && !unconfigured ? '暂无队伍交流记录。' : '等待小队接入后展示交流。')]));
  let consoleLink;
  try { consoleLink = new URL('/agents', record(data.links).qwenpaw).href; } catch { /* no known console */ }
  setLink('survivor-party-console', consoleLink);
}
function renderSurvivor(data) {
  renderParty(data);
  const value = record(data.survivor), body = record(value.body), budgets = record(value.budgets);
  const stale = value.available !== true || value.stale === true;
  const states = { paused: '已暂停', observing: '观察世界', thinking: '正在思考', acting: '正在行动', waiting: '等待下一步',
    cooldown: '等待下次决策', idle: '等待新任务或环境变化', budget_wait: '等待决策额度恢复', waiting_for_tools: '等待世界工具连接', executing_skill: '正在执行已学技能', body_offline: '等待身体连接', stopped: '服务已停止',
    observation_wait: '等待世界状态恢复', party_wait: '等待队伍任务', party_reply_wait: '核对回复送达', action_confirmation_wait: '核对动作结果' };
  const actionNames = { goto: '移动', mine: '采集', craft: '合成', eat: '进食', equip_item: '装备', game_cast: '施法', game_learn: '参悟技能',
    place_block: '放置', farm: '耕作', open_container: '打开容器', transfer_items: '存取物品', close_container: '关闭容器',
    sleep: '休息', trade: '村民交易', guild_claim: '接取委托', guild_deliver: '交付委托', guild_release: '退回委托' };
  const actionName = tool => actionNames[tool] || text(tool, '身体动作');
  const actionResult = action => action.code === 'accepted' ? '已受理；后续结果见最近的经历'
    : action.code === 'executed' && action.completionConfirmed === true ? '已确认执行'
    : action.code === 'outcome_unknown' ? '结果不明，需要核对'
    : action.ok === false ? '未执行成功' : '等待确认';
  setBadge('survivor-badge', stale ? '历史记录 / 待更新' : (states[value.status] || '状态：' + text(value.status)), !stale && body.online ? 'good' : 'neutral');
  byId('survivor-freshness').textContent = value.available ? '记录更新：' + formatDate(value.generatedAt) + (stale ? '。已过期，请检查服务；以下为上次记录。' : '。每 15 秒读取，身体状态由后台持续观察。') : '尚无桐人的有效状态。请先检查自主生存服务。';
  byId('survivor-goal').textContent = '当前目标：' + text(value.goal, '等待设置目标');
  const reviews = { ongoing: '目标进行中', completed: '将选择下一个目标', blocked: '正在寻找可行办法', resting: '休息并观察' };
  byId('survivor-autonomy').textContent = (value.autonomous ? '持续自主生活 · ' : '单次任务 · ')
    + (reviews[value.goalState] || '观察当前目标')
    + (value.enabled && finite(value.nextReviewAt) ? ' · 最迟复盘：' + formatDate(value.nextReviewAt * 1000) : '')
    + (value.status === 'paused' && value.pauseReason ? ' · 暂停原因：' + value.pauseReason : '');
  const awareness = record(value.perception), environment = record(value.environment);
  facts('survivor-perception', [['环境', environment.available ? [text(environment.biome, '群系未知'), text(environment.weather, '天气未知'), environment.dark === true ? '夜间' : ''].filter(Boolean).join(' · ') : '等待环境读取'],
    ['附近生物', rows(environment.entities).length ? rows(environment.entities).map(row => text(row.name || row.type)).join('、') : '当前没有可用记录'],
    ['听觉通道', rows(awareness.sources).filter(row => row.available).length + ' / ' + rows(awareness.sources).length + ' 已接通'],
    ['待处理事件', number(awareness.pendingCount)]]);
  const eventLabels = { chat: '公屏聊天', goddess: '指名消息', chant_reply: '咏唱回执', system: '世界通知', damage_observed: '受到伤害', environment_changed: '环境变化', dimension_changed: '维度变化' };
  replace('survivor-events', rows(awareness.events).map(event => {
    const card = node('div', 'operation-record');
    card.append(node('strong', '', (eventLabels[event.kind] || '世界事件') + (event.speaker ? ' · ' + event.speaker : '')),
      node('p', 'card-caption', event.text || (event.kind === 'damage_observed' ? '生命 ' + number(event.beforeHp) + ' → ' + number(event.afterHp) : '已观察到变化，将在下一轮判断。')));
    return card;
  }).concat(rows(awareness.events).length ? [] : [empty('正在倾听，新的消息和世界变化会出现在这里。')]));
  const pos = record(body.position);
  replace('survivor-metrics', [metric('身体', body.online === true ? '在线' : body.online === false ? '离线' : '未知', 'Kirito'),
    metric('生命', number(body.hp), '实际生命值'), metric('饥饿', number(body.hunger), '实际饥饿值'),
    metric('位置', finite(pos.x) ? `${number(pos.x)} · ${number(pos.y)} · ${number(pos.z)}` : '未知', '世界坐标')]);
  const decision = record(value.lastDecision);
  byId('survivor-decision').textContent = value.lastDecision
    ? '最近决策：' + formatDate(decision.at) + ' · ' + (decision.completed === true ? '本轮规划已结束' : decision.completed === false ? '本轮规划未完成' : '本轮结果待确认')
      + (rows(decision.actions).length ? '。' + rows(decision.actions).map(action => actionName(action.tool) + '：' + actionResult(action)).join('；') : '。本轮没有身体动作回执。')
    : '最近决策：尚未记录';
  const inventory = Object.entries(record(body.counts));
  if (inventory.length) facts('survivor-inventory', inventory.map(([id, n]) => [id, number(n)]));
  else replace('survivor-inventory', [empty(body.online === true ? '背包暂时没有物品记录。' : '等待身体连接后读取。')]);
  facts('survivor-budgets', [['近24小时决策', number(budgets.decisionsUsed) + (budgets.unlimited === true ? ' · 不设调用额度' : ' / ' + number(budgets.decisionLimit))],
    ['决策间隔', budgets.cooldownSeconds === 0 ? '无人工冷却，按事件和复盘运行' : number(budgets.cooldownSeconds) + ' 秒'], ['累计模型请求', number(budgets.modelRequests)],
    ['累计输入 / 输出 Token', number(budgets.promptTokens) + ' / ' + number(budgets.completionTokens)]]);
  renderSurvivorGameSkills(value.gameSkills, body);
  renderSurvivorLife(value, stale);
  replace('survivor-skills', rows(value.skills).map(skill => {
    const card = node('div', 'operation-record');
    card.append(node('strong', '', text(skill.name)), node('p', 'card-caption', text(skill.description, '暂无描述')),
      node('p', 'footnote', skill.activeVersion ? '已启用版本：' + skill.activeVersion : '尚无启用版本'));
    if (skill.draftVersion) card.append(node('p', 'footnote', '草稿版本：' + skill.draftVersion));
    return card;
  }).concat(rows(value.skills).length ? [] : [empty('尚无技能记录。')]));
  replace('survivor-episodes', rows(value.episodes).slice().reverse().map(row => {
    const title = row.kind === 'decision_finished' ? (row.completed === true ? '一轮规划已结束' : '本轮规划未完成')
      : row.kind === 'action_observed' ? actionName(row.action) + '后的实际观察'
      : row.kind === 'skill_finished' ? (row.status === 'done' ? '技能报告本轮结束' : '技能需要重新规划')
      : row.kind === 'skill_stopped' ? '技能执行已暂停' : row.kind === 'skill_error' ? '技能执行遇到问题' : '运行记录';
    const card = node('div', 'operation-record'); card.append(node('strong', '', title), node('p', 'footnote', formatDate(row.at)));
    if (row.name) card.append(node('p', 'card-caption', row.name + (row.version ? ' · ' + row.version : '')));
    if (row.kind === 'action_observed') {
      const changes = Object.entries(record(row.inventoryDelta)).filter(([, n]) => finite(n) && n !== 0);
      card.append(node('p', 'card-caption', changes.length ? '背包变化：' + changes.map(([id, n]) => id + ' ' + (n > 0 ? '+' : '') + number(n)).join('，') : '背包没有数量变化。'));
      const before = record(row.positionBefore), after = record(row.positionAfter), positionText = pos => `${number(pos.x)} · ${number(pos.y)} · ${number(pos.z)}`;
      if (finite(before.x) && finite(after.x)) card.append(node('p', 'footnote', '位置：' + positionText(before) + ' → ' + positionText(after)));
      const navigation = record(row.navigationOutcome);
      const navigationStates = { success: '导航已完成', failed: '导航失败', timeout: '导航超时', cancelled: '导航已取消' };
      if (navigationStates[navigation.state]) {
        card.append(node('p', 'card-caption', navigationStates[navigation.state] + ' · 原生任务回执'),
          node('p', 'footnote', '回执时间：' + formatDate(navigation.finishedAt)));
        if (navigation.reason) card.append(node('p', 'card-caption', '导航原因：' + navigation.reason));
        card.append(node('p', 'footnote', '任务结果来自匹配的原生回执；上方另列实际位置与背包变化。'));
      } else card.append(node('p', 'footnote', '这些是实际状态变化，不能单独证明任务已完成。'));
    }
    const reasons = { skill_execution_budget: '本次技能执行达到步数或时间限制。', operator_stop: '管理者停止了本次执行。', outcome_unknown: '动作结果仍不明确，请先核对身体。' };
    if (row.reason) card.append(node('p', 'card-caption', reasons[row.reason] || '原因：' + row.reason));
    if (row.errorType) card.append(node('p', 'footnote', '错误类型：' + row.errorType));
    return card;
  }).concat(rows(value.episodes).length ? [] : [empty('最近经历会在行动后出现在这里。')]));
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
    if (snapshot) render({ ...snapshot, stale: true, health: { ...record(snapshot.health), stale: true }, survivor: { ...record(snapshot.survivor), stale: true }, party: { ...record(snapshot.party), stale: true }, operations: { ...record(snapshot.operations), stale: true, staleReason: 'connection' } });
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
