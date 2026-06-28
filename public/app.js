'use strict'

const state = {
  status: null,
  config: null,
  modelProviders: [],
  busy: false,
  viewerIndex: 0,
  viewerAuto: true,
  viewerGridSignature: '',
  featuredViewerUrl: '',
  lastLiveViewerTarget: '',
  serverBlueprint: null,
  village: null,
  villageDashboard: null,
  liveIntel: null,
  pageLoadedAt: Date.now(),
  lastVoiceAt: ''
}

const elements = {
  minecraftStatus: byId('minecraftStatus'),
  minecraftDetail: byId('minecraftDetail'),
  mindcraftStatus: byId('mindcraftStatus'),
  mindcraftDetail: byId('mindcraftDetail'),
  socketStatus: byId('socketStatus'),
  socketDetail: byId('socketDetail'),
  autopilotStatus: byId('autopilotStatus'),
  autopilotDetail: byId('autopilotDetail'),
  modelStatus: byId('modelStatus'),
  modelDetail: byId('modelDetail'),
  homeSummary: byId('homeSummary'),
  readyServerDot: byId('readyServerDot'),
  readyServerText: byId('readyServerText'),
  readyMindcraftDot: byId('readyMindcraftDot'),
  readyMindcraftText: byId('readyMindcraftText'),
  readyAgentDot: byId('readyAgentDot'),
  readyAgentText: byId('readyAgentText'),
  readyAutopilotDot: byId('readyAutopilotDot'),
  readyAutopilotText: byId('readyAutopilotText'),
  agentsList: byId('agentsList'),
  agentCreateForm: byId('agentCreateForm'),
  newAgentName: byId('newAgentName'),
  humanPlayerName: byId('humanPlayerName'),
  locateAgentName: byId('locateAgentName'),
  playerLocationHint: byId('playerLocationHint'),
  viewerGrid: byId('viewerGrid'),
  featuredViewerTitle: byId('featuredViewerTitle'),
  featuredViewerFrame: byId('featuredViewerFrame'),
  viewerAutoBtn: byId('viewerAutoBtn'),
  viewerNextBtn: byId('viewerNextBtn'),
  viewerOpenBtn: byId('viewerOpenBtn'),
  liveIntelMeta: byId('liveIntelMeta'),
  liveCommanderFeed: byId('liveCommanderFeed'),
  liveThoughtFeed: byId('liveThoughtFeed'),
  logsView: byId('logsView'),
  memoryView: byId('memoryView'),
  llmProviderHint: byId('llmProviderHint'),
  visionProviderHint: byId('visionProviderHint'),
  llmHint: byId('llmHint'),
  minecraftManagerHint: byId('minecraftManagerHint'),
  minecraftRuntimeHint: byId('minecraftRuntimeHint'),
  minecraftLogView: byId('minecraftLogView'),
  mindcraftConfigHint: byId('mindcraftConfigHint'),
  mindcraftProfileHint: byId('mindcraftProfileHint'),
  mindcraftProfileSelect: byId('mindcraftProfileSelect'),
  mindcraftProfileJson: byId('mindcraftProfileJson'),
  serverPropertiesHint: byId('serverPropertiesHint'),
  serverBlueprintHint: byId('serverBlueprintHint'),
  serverBlueprintSummary: byId('serverBlueprintSummary'),
  serverBlueprintReadiness: byId('serverBlueprintReadiness'),
  serverBlueprintNextActions: byId('serverBlueprintNextActions'),
  serverBlueprintProperties: byId('serverBlueprintProperties'),
  serverBlueprintPhases: byId('serverBlueprintPhases'),
  serverBlueprintPlugins: byId('serverBlueprintPlugins'),
  serverBlueprintStreaming: byId('serverBlueprintStreaming'),
  serverBlueprintDryRun: byId('serverBlueprintDryRun'),
  villageName: byId('villageName'),
  villageBaseX: byId('villageBaseX'),
  villageBaseY: byId('villageBaseY'),
  villageBaseZ: byId('villageBaseZ'),
  villageChestX: byId('villageChestX'),
  villageChestY: byId('villageChestY'),
  villageChestZ: byId('villageChestZ'),
  villageRadius: byId('villageRadius'),
  villageCommander: byId('villageCommander'),
  villageRoles: byId('villageRoles'),
  villageTasks: byId('villageTasks'),
  villageResources: byId('villageResources'),
  villageResourceDashboard: byId('villageResourceDashboard'),
  villageDashboardMeta: byId('villageDashboardMeta'),
  villageScoreboard: byId('villageScoreboard'),
  villageProjects: byId('villageProjects'),
  villageInfrastructures: byId('villageInfrastructures'),
  villageReports: byId('villageReports'),
  societyGoal: byId('societyGoal'),
  toast: byId('toast'),
  autopilotBtn: byId('autopilotBtn')
}

const configInputs = [
  'minecraftHost',
  'minecraftPort',
  'minecraftServerDir',
  'mindcraftUrl',
  'mindcraftDir',
  'mcpAllowLan',
  'agentFilter',
  'assistantMode',
  'worldDirective',
  'intervalMs',
  'idleCooldownMs',
  'minTaskRuntimeMs',
  'maxConcurrentAgents',
  'liveObserverName',
  'llmProvider',
  'llmBaseUrl',
  'llmModel',
  'codeModel',
  'visionProvider',
  'visionBaseUrl',
  'visionModel',
  'memoryVectorEnabled',
  'memoryEmbeddingProvider',
  'memoryEmbeddingBaseUrl',
  'memoryEmbeddingModel',
  'memoryVectorStore',
  'memoryQdrantUrl',
  'memoryQdrantCollection',
  'memoryVectorTimeoutMs',
  'useLlm'
]

const presetTasks = {
  'first-night': '你是一个耐心的 Minecraft 新手导师。请陪玩家完成第一晚生存：先确认玩家位置和安全，再引导砍树、做工作台、做木镐/木剑、找食物、搭临时庇护所、插火把或躲避夜晚。不要抢走玩家体验，先解释再示范，遇到怪物时保护玩家。',
  mentor: '你现在扮演新手导师。用简短中文解释玩家当前应该做什么，优先教学和示范，不要无脑跟随，不要替玩家做所有决定。每次完成一个小目标后给出下一步建议。',
  guard: '你现在扮演生存护卫。和玩家保持适当距离，优先保护玩家安全、打退附近怪物、提醒低血量和夜晚风险。不要离玩家太远，不要破坏玩家建筑。',
  builder: '你现在扮演建筑伙伴。观察基地周围，帮忙补光、整理地形、修路、准备基础材料，并提出简单实用的建造建议。不要拆玩家已有建筑。',
  food: '帮玩家寻找稳定食物来源。优先观察附近动物、农作物、水源和安全路线；如果玩家是新手，请解释怎么获取和烹饪食物。',
  fight: '帮玩家处理附近危险怪物。优先保护玩家，不要追太远；战斗后提醒玩家回血、吃东西、补火把。',
  base: '检查并改善当前基地：补火把、封堵危险洞口、整理入口、做简单道路或围栏。动作要保守，不要拆玩家已经建好的结构。',
  explore: '陪玩家进行短距离探索。记录基地大致方向和重要坐标，优先找村庄、动物、矿洞入口或有用资源；天黑或危险时建议返回。',
  'return-home': '帮助玩家回到基地或安全地点。先确认玩家和基地位置，如果不知道基地位置就寻找最近安全处并解释如何避免迷路。',
  'free-play': '你现在作为一个自主但友好的玩家行动。不要一直贴身跟随真人玩家；根据世界状态选择有价值的小目标，例如补光、收集基础资源、巡逻、改善基地或探索附近。遇到玩家求助时优先响应。',
  'collab-sync': '进行一次 60 秒协作同步。每个 AI 用中文短句汇报 已有(关键库存)、正在做(当前任务/区域)、需要(缺口)，然后继续自己的角色任务。不要长篇聊天。',
  'shared-storage': '执行公共库存整理。所有 AI 先用中文“已有/需要”同步关键物资；采集者把多余木头、石头、煤、食物、火把放入公共箱子；Alex 负责分类并用 VILLAGE_REPORT 上报缺口。',
  'craft-tools': '执行协作合成基础工具。先共享库存和缺口，Milo/Alex 准备木头、圆石、煤和木棍，能合成时制作镐、斧、铲或火把；缺配方或材料就用“受阻”上报，不要重复试错。',
  'cook-meal': '执行食物补给任务。Ivy 优先找作物、动物和水源，Alex 负责安全和燃料，其他人只做近距离支援；成品食物放公共箱子并上报。',
  'build-zone': '执行分区建造任务。Luna 先声明“正在做(建筑区域/坐标)”，其他人只供材料和补光，不要拆或覆盖 Luna 的方块；完成阶段后用 VILLAGE_REPORT 上报。',
  'resource-chain': '执行资源接力。Milo 采石煤铁，Nova 标记安全路线，Ivy 保障食物，Alex 整理入库，Luna 只使用公共箱子材料建设；所有人用中文“需要/已有/完成”短句协调。',
  'water-rescue': '水中/卡住脱困'
}

const societyGoalPresets = {
  construction: '按 MineCollab 建造任务方式推进村庄：村长先分配建筑区域、材料和阶段；Luna 负责建筑主体，Alex 补光和公共箱子，Milo 供应石头/煤/铁，Nova 标记路线和危险点，Ivy 保障食物。禁止互相拆方块。',
  crafting: '按 MineCollab 合成任务方式推进：先让居民共享库存和配方缺口，再分配原料、半成品和最终合成。缺材料用“需要”上报，缺配方用“受阻”上报，不要重复试错。',
  cooking: '按 MineCollab 烹饪任务方式推进：Ivy 负责食材，Alex 负责安全/燃料/公共箱子，Milo/Nova 做近距离支援，Luna 只做厨房/农田基础设施。目标是稳定食物库存。',
  logistics: '推进村庄后勤接力：采集者入库，Alex 分类，村长根据公共箱子缺口派工。所有居民用中文“已有/需要/正在做/完成/受阻”短句沟通。'
}

document.addEventListener('DOMContentLoaded', () => {
  byId('refreshBtn').addEventListener('click', refreshAll)
  byId('startExperienceBtn').addEventListener('click', startExperience)
  byId('heroStartExperienceBtn').addEventListener('click', startExperience)
  byId('firstNightBtn').addEventListener('click', () => sendPresetTask('first-night'))
  byId('freePlayBtn').addEventListener('click', () => sendPresetTask('free-play'))
  document.querySelectorAll('[data-preset-task]').forEach(button => button.addEventListener('click', () => sendPresetTask(button.dataset.presetTask)))
  document.querySelectorAll('[data-society-preset]').forEach(button => button.addEventListener('click', () => sendSocietyPreset(button.dataset.societyPreset)))
  byId('refreshBtn').addEventListener('click', refreshAll)
  byId('startMinecraftBtn').addEventListener('click', () => postAction('/api/minecraft/start', '已请求启动 Minecraft 服务器'))
  byId('stopMinecraftBtn').addEventListener('click', () => postAction('/api/minecraft/stop', '已请求停止 Minecraft 服务器'))
  byId('restartMinecraftBtn').addEventListener('click', () => postAction('/api/minecraft/restart', '已请求重启 Minecraft 服务器'))
  byId('refreshMinecraftLogBtn').addEventListener('click', refreshMinecraftLog)
  byId('minecraftCommandForm').addEventListener('submit', sendMinecraftCommand)
  byId('locatePlayerBtn').addEventListener('click', locatePlayer)
  byId('guideAgentsToPlayerBtn').addEventListener('click', () => guideAgentsToPlayer(false))
  byId('teleportAgentsToPlayerBtn').addEventListener('click', () => guideAgentsToPlayer(true))
  byId('rescueAgentsBtn').addEventListener('click', () => rescueAgent(''))
  byId('viewerAutoBtn').addEventListener('click', toggleViewerAuto)
  byId('viewerNextBtn').addEventListener('click', () => advanceFeaturedViewer(true))
  byId('viewerOpenBtn').addEventListener('click', openFeaturedViewer)
  byId('focusLiveObserverBtn').addEventListener('click', focusLiveObserver)
  byId('minecraftRuntimeSettingsForm').addEventListener('submit', applyMinecraftRuntimeSettings)
  document.querySelectorAll('[data-minecraft-command]').forEach(button => button.addEventListener('click', runMinecraftQuickCommand))
  byId('startMindcraftBtn').addEventListener('click', () => postAction('/api/mindcraft/start', '已请求启动 Mindcraft'))
  byId('stopMindcraftBtn').addEventListener('click', () => postAction('/api/mindcraft/stop-owned', '已请求停止本页面启动的 Mindcraft'))
  byId('loadMindcraftConfigBtn').addEventListener('click', () => loadMindcraftConfig())
  byId('saveMindcraftConfigBtn').addEventListener('click', saveMindcraftConfig)
  byId('loadMindcraftProfileBtn').addEventListener('click', () => loadMindcraftConfig(elements.mindcraftProfileSelect.value))
  byId('saveMindcraftProfileBtn').addEventListener('click', saveMindcraftProfile)
  byId('applyModelToProfileBtn').addEventListener('click', applyModelProviderToProfile)
  byId('mindcraftProfileSelect').addEventListener('change', () => loadMindcraftConfig(elements.mindcraftProfileSelect.value))
  byId('autopilotBtn').addEventListener('click', toggleAutopilot)
  byId('llmProvider').addEventListener('change', onModelProviderChange)
  byId('visionProvider').addEventListener('change', onVisionProviderChange)
  byId('applyModelProviderBtn').addEventListener('click', applyModelProviderPreset)
  byId('applyVisionProviderBtn').addEventListener('click', applyVisionProviderPreset)
  byId('saveConfigBtn').addEventListener('click', saveConfig)
  byId('refreshLogsBtn').addEventListener('click', refreshLogs)
  byId('loadServerPropertiesBtn').addEventListener('click', loadServerProperties)
  byId('saveServerPropertiesBtn').addEventListener('click', saveServerProperties)
  byId('loadServerBlueprintBtn').addEventListener('click', loadServerBlueprint)
  byId('copyServerBlueprintBtn').addEventListener('click', copyServerBlueprint)
  byId('activateSocietyBtn').addEventListener('click', activateSocietyMode)
  byId('ensureResidentsBtn').addEventListener('click', ensureVillageResidents)
  byId('dispatchVillageTasksBtn').addEventListener('click', dispatchVillageTasks)
  byId('setVillageBaseFromPlayerBtn').addEventListener('click', setVillageBaseFromPlayer)
  byId('saveVillageBtn').addEventListener('click', saveVillage)
  byId('resetVillageBtn').addEventListener('click', resetVillage)
  elements.villageProjects.addEventListener('change', handleVillageProjectChange)
  byId('loadMemoryBtn').addEventListener('click', loadMemory)
  elements.agentCreateForm.addEventListener('submit', createAgent)
  elements.agentsList.addEventListener('click', handleAgentAction)
  byId('taskForm').addEventListener('submit', sendTask)
  refreshAll()
  loadMindcraftConfig()
  loadServerProperties()
  loadServerBlueprint()
  setInterval(refreshAll, 5000)
  setInterval(() => advanceFeaturedViewer(false), 12000)
})

async function refreshAll() {
  if (state.busy) return
  try {
    const [status, logs, minecraftLog, providerData, villageDashboard, liveIntel, voiceData] = await Promise.all([
      apiGet('/api/status'),
      apiGet('/api/logs'),
      apiGet('/api/minecraft/logs'),
      apiGet('/api/model-providers'),
      apiGet('/api/village/dashboard').catch(error => ({ error: error.message })),
      apiGet('/api/livestream/intel').catch(error => ({ error: error.message })),
      apiGet('/api/voice/latest').catch(error => ({ error: error.message }))
    ])
    state.status = status
    state.config = status.config
    state.modelProviders = providerData.providers || []
    state.villageDashboard = villageDashboard
    state.liveIntel = liveIntel
    renderStatus(status)
    renderProductHome(status)
    renderModelProviders(providerData, status.config)
    renderConfig(status.config)
    renderVillage(status.village)
    renderVillageDashboard(villageDashboard)
    renderMinecraftManager(status, minecraftLog)
    renderLogs(logs.logs || [])
    maybeSpeakCommanderVoice(voiceData.latest)
  } catch (error) {
    showToast(error.message)
  }
}

async function refreshLogs() {
  try {
    const data = await apiGet('/api/logs')
    renderLogs(data.logs || [])
  } catch (error) {
    showToast(error.message)
  }
}

async function refreshMinecraftLog() {
  try {
    const data = await apiGet('/api/minecraft/logs')
    renderMinecraftLog(data)
  } catch (error) {
    showToast(error.message)
  }
}

function renderStatus(status) {
  const props = status.minecraft.propertiesExists ? 'server.properties 已找到' : '未设置 server.properties'
  const pids = status.minecraft.processIds && status.minecraft.processIds.length > 0 ? status.minecraft.processIds.join(', ') : '未识别'
  const source = status.minecraft.managed ? `本页面托管 PID ${status.minecraft.ownedPid}` : status.minecraft.tcpOpen ? `外部进程 PID ${pids}` : '未运行'
  setStatus(elements.minecraftStatus, elements.minecraftDetail, status.minecraft.tcpOpen, status.minecraft.tcpOpen ? '在线' : '离线', `${status.minecraft.host}:${status.minecraft.port} | ${props} | ${source}`)
  setStatus(elements.mindcraftStatus, elements.mindcraftDetail, status.mindcraft.httpOk, status.mindcraft.httpOk ? '在线' : '离线', `${status.mindcraft.url} | 进程: ${status.mindcraft.processIds.join(', ') || '未识别'}`)
  setStatus(elements.socketStatus, elements.socketDetail, status.socket.connected, status.socket.connected ? '已连接' : '未连接', status.socket.lastError || status.socket.lastConnectedAt || '等待连接')

  const auto = status.autopilot.active
  const mode = modeLabel(status.autopilot.assistantMode || 'creative')
  const llm = status.autopilot.llmConfigured && status.autopilot.useLlm ? '模型已启用' : '模型关闭'
  setStatus(elements.autopilotStatus, elements.autopilotDetail, auto, auto ? '运行中' : '已停止', `${mode} | 间隔 ${status.autopilot.intervalMs} ms | ${llm}`)
  elements.autopilotBtn.textContent = auto ? '停止自动陪玩' : '启动自动陪玩'
  elements.autopilotBtn.classList.toggle('primary', !auto)

  renderModelStatus(status.models)
  renderAgents(status)
  renderViewerConsole(status)
}

function renderModelStatus(models) {
  if (!elements.modelStatus || !elements.modelDetail) return
  if (!models) {
    setStatus(elements.modelStatus, elements.modelDetail, false, '未知', '等待 /api/status 返回模型摘要')
    return
  }
  const commander = models.commander || {}
  const residents = models.residents || {}
  const vision = models.vision || {}
  const memory = models.memory || {}
  const authReady = Boolean(commander.authReady) && Boolean(vision.authReady || !vision.provider)
  const residentTag = residents.mixed ? residentProfilesSummary(models.profiles || []) : modelName(residents)
  setStatus(
    elements.modelStatus,
    elements.modelDetail,
    authReady,
    `主控 ${modelName(commander) || '未配置'}`,
    `村长：${modelLine(commander)} | 村民：${residentTag}${residents.baseUrl ? ` @ ${residents.baseUrl}` : ''} | 视觉：${modelLine(vision)} | 记忆：${memory.enabled ? `${memory.model || '未命名'} / ${memory.store || 'sqlite'}` : '关闭'}`
  )
}

function modelName(item) {
  return item && item.model ? item.model : ''
}

function residentProfilesSummary(profiles) {
  const rows = (profiles || [])
    .filter(profile => profile && (profile.active || profile.model && profile.model.model))
    .sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || String(a.name).localeCompare(String(b.name)))
    .slice(0, 4)
    .map(profile => String(profile.name || 'AI') + ':' + String(profile.model && profile.model.model ? profile.model.model : '未知'))
  return rows.length > 0 ? rows.join('，') : '多模型'
}
function modelLine(item) {
  if (!item) return '未知'
  const provider = item.providerLabel || item.provider || ''
  const model = item.model || ''
  const endpoint = item.baseUrl ? ` @ ${item.baseUrl}` : ''
  const auth = item.authReady === false ? '（未就绪）' : ''
  return `${provider}${provider && model ? ' / ' : ''}${model}${endpoint}${auth}` || '未知'
}
function setStatus(titleEl, detailEl, ok, title, detail) {
  titleEl.textContent = title
  titleEl.className = ok ? 'ok' : 'bad'
  detailEl.textContent = detail || ''
}

function renderProductHome(status) {
  const agents = status.socket.agents || []
  const onlineAgents = agents.filter(agent => agent.in_game)
  setReady(elements.readyServerDot, elements.readyServerText, status.minecraft.tcpOpen, status.minecraft.tcpOpen ? '已在线，可以进服' : '未启动')
  setReady(elements.readyMindcraftDot, elements.readyMindcraftText, status.mindcraft.httpOk, status.mindcraft.httpOk ? 'AI 引擎已在线' : '未启动')
  setReady(elements.readyAgentDot, elements.readyAgentText, onlineAgents.length > 0, onlineAgents.length > 0 ? `${onlineAgents.map(agent => agent.name).join(', ')} 已进服` : '等待 AI 玩家进服')
  setReady(elements.readyAutopilotDot, elements.readyAutopilotText, status.autopilot.active, status.autopilot.active ? '已开启自主陪玩' : '可手动启动')

  if (!status.minecraft.tcpOpen) {
    elements.homeSummary.textContent = '服务器未启动。点击“一键启动陪玩”会先拉起 Minecraft Server。'
  } else if (!status.mindcraft.httpOk) {
    elements.homeSummary.textContent = '服务器已在线。下一步启动 Mindcraft，让 AI 队友进入游戏。'
  } else if (onlineAgents.length === 0) {
    elements.homeSummary.textContent = 'Mindcraft 已在线，正在等待 AI 队友进服。'
  } else {
    elements.homeSummary.textContent = `AI 队友 ${onlineAgents.map(agent => agent.name).join(', ')} 已准备好，可以发送陪玩任务。`
  }
}

function setReady(dotEl, textEl, ok, text) {
  dotEl.className = ok ? 'ready-dot ok-dot' : 'ready-dot bad-dot'
  textEl.textContent = text
}

function agentModelLabel(models, agentName) {
  const profiles = models && Array.isArray(models.profiles) ? models.profiles : []
  const profile = profiles.find(item => item && item.name === agentName)
  const model = profile && profile.model && profile.model.model ? profile.model.model : ''
  if (model) return model
  const residents = models && models.residents ? models.residents : {}
  return residents.model || '未知'
}
function renderAgents(status) {
  const agents = status.socket.agents || []
  const states = status.socket.states || {}
  if (agents.length === 0) {
    elements.agentsList.innerHTML = '<div class="agent-row empty"><span class="agent-meta">还没有 AI 玩家。填写名字后点击“新增并进服”。</span></div>'
    return
  }

  elements.agentsList.innerHTML = agents.map(agent => {
    const agentState = states[agent.name] || {}
    const pos = agentState.position
      ? `${num(agentState.position.x)}, ${num(agentState.position.y)}, ${num(agentState.position.z)}`
      : '位置未知'
    const online = agent.in_game ? '已进服' : '未进服'
    const modelLabel = agentModelLabel(status.models, agent.name)
    const action = agentState.action || '暂无动作'
    const idle = agentState.isIdle ? '（空闲）' : ''
    const actionName = agent.in_game ? 'stop' : 'start'
    const actionText = agent.in_game ? '停止' : '进服'
    const actionClass = agent.in_game ? '' : ' class="primary"'
    return [
      '<div class="agent-row">',
      `<div><div class="agent-name">${escapeHtml(agent.name)}</div><div class="agent-meta">${online} | 模型 ${escapeHtml(modelLabel)}</div></div>`,
      `<div class="agent-meta">${escapeHtml(agentState.gamemode || '未知模式')} | ${escapeHtml(agentState.biome || '未知生物群系')} | ${escapeHtml(pos)}</div>`,
      `<div class="agent-action">${escapeHtml(action)} ${idle}</div>`,
      `<div class="agent-controls"><button type="button" data-agent-action="rescue" data-agent-name="${escapeHtml(agent.name)}">脱困</button><button type="button"${actionClass} data-agent-action="${actionName}" data-agent-name="${escapeHtml(agent.name)}">${actionText}</button></div>`,
      '</div>'
    ].join('')
  }).join('')
}


function renderViewerConsole(status) {
  if (!elements.viewerGrid) return
  const agents = (status.socket.agents || []).filter(agent => agent.viewerPort)
  const signature = agents.map(agent => [agent.name, agent.viewerPort, agent.in_game ? 1 : 0].join(':')).join('|')
  if (signature !== state.viewerGridSignature) {
    state.viewerGridSignature = signature
    elements.viewerGrid.innerHTML = agents.length === 0
      ? '<div class="viewer-empty">暂无 AI 视角。确认 Mindcraft 已开启 render_bot_view。</div>'
      : agents.map((agent, index) => {
        const url = viewerUrl(agent)
        const statusText = agent.in_game ? '在线' : '未进服'
        return [
          '<button type="button" class="viewer-card" data-viewer-index="' + index + '">',
          '<span class="viewer-card-head"><strong>' + escapeHtml(agent.name) + '</strong><small>' + statusText + '</small></span>',
          '<iframe src="' + escapeHtml(url) + '" title="' + escapeHtml(agent.name) + ' 视角" loading="lazy"></iframe>',
          '</button>'
        ].join('')
      }).join('')
    elements.viewerGrid.querySelectorAll('[data-viewer-index]').forEach(button => {
      button.addEventListener('click', () => {
        state.viewerIndex = Number(button.dataset.viewerIndex || 0)
        setFeaturedViewer(viewerCandidates(state.status))
      })
    })
  }
  const candidates = viewerCandidates(status)
  syncFeaturedViewerToLiveTarget(candidates, status)
  setFeaturedViewer(candidates, status)
}

function viewerCandidates(status) {
  const agents = status && status.socket ? status.socket.agents || [] : []
  const withViewer = agents.filter(agent => agent.viewerPort)
  const online = withViewer.filter(agent => agent.in_game)
  return online.length > 0 ? online : withViewer
}

function setFeaturedViewer(agents, status = state.status) {
  if (!elements.featuredViewerFrame || !elements.featuredViewerTitle) return
  if (!agents || agents.length === 0) {
    elements.featuredViewerTitle.textContent = '等待 AI 视角'
    elements.featuredViewerFrame.removeAttribute('src')
    state.featuredViewerUrl = ''
    return
  }
  if (state.viewerIndex >= agents.length) state.viewerIndex = 0
  const agent = agents[state.viewerIndex]
  const url = viewerUrl(agent)
  const liveTarget = liveObserverTarget(status)
  const prefix = liveTarget && liveTarget === agent.name ? '直播镜头：' : 'AI 视角：'
  elements.featuredViewerTitle.textContent = prefix + (agent.in_game ? agent.name + ' 正在游戏中' : agent.name + ' 未进服')
  if (state.featuredViewerUrl !== url) {
    state.featuredViewerUrl = url
    elements.featuredViewerFrame.src = url
  }
}

function syncFeaturedViewerToLiveTarget(agents, status) {
  const target = liveObserverTarget(status)
  if (!target || !state.viewerAuto || !Array.isArray(agents) || agents.length === 0) return
  const index = agents.findIndex(agent => agent.name === target)
  if (index === -1) return
  if (state.lastLiveViewerTarget !== target || state.viewerIndex !== index) {
    state.viewerIndex = index
    state.lastLiveViewerTarget = target
  }
}

function liveObserverTarget(status) {
  return status && status.livestream && status.livestream.currentTarget ? String(status.livestream.currentTarget) : ''
}

function advanceFeaturedViewer(force) {
  if (!force && !state.viewerAuto) return
  const agents = viewerCandidates(state.status)
  if (!agents || agents.length === 0) return
  state.viewerIndex = (state.viewerIndex + 1) % agents.length
  setFeaturedViewer(agents, state.status)
}

function toggleViewerAuto() {
  state.viewerAuto = !state.viewerAuto
  elements.viewerAutoBtn.textContent = state.viewerAuto ? '自动轮播：开' : '自动轮播：关'
}

function openFeaturedViewer() {
  if (state.featuredViewerUrl) window.open(state.featuredViewerUrl, '_blank', 'noopener,noreferrer')
}

function viewerUrl(agent) {
  const host = viewerHost()
  return 'http://' + host + ':' + agent.viewerPort + '/'
}

function viewerHost() {
  const host = window.location.hostname || 'localhost'
  if (host.includes(':') && !host.startsWith('[')) return '[' + host + ']'
  return host
}

function renderLiveIntel(data) {
  if (!elements.liveCommanderFeed || !elements.liveThoughtFeed) return
  if (!data || data.error) {
    const message = data && data.error ? data.error : '等待直播信息流'
    elements.liveCommanderFeed.innerHTML = '<div class="live-feed-empty">' + escapeHtml(message) + '</div>'
    elements.liveThoughtFeed.innerHTML = '<div class="live-feed-empty">暂无居民思考。</div>'
    if (elements.liveIntelMeta) elements.liveIntelMeta.textContent = '未连接'
    return
  }
  const currentTarget = data.livestream && data.livestream.currentTarget ? data.livestream.currentTarget : '自动'
  const commander = data.commander || {}
  if (elements.liveIntelMeta) {
    elements.liveIntelMeta.textContent = (commander.title || 'AI村长') + ' ' + (commander.name || '') + ' | ' + (commander.model || '模型未知') + ' | 当前镜头 ' + currentTarget
  }
  const decisions = Array.isArray(commander.decisions) ? commander.decisions : []
  elements.liveCommanderFeed.innerHTML = decisions.length
    ? decisions.slice(0, 6).map(item => renderLiveFeedItem(item, 'decision')).join('')
    : '<div class="live-feed-empty">暂无村长决策。等待自动调度或手动派发任务。</div>'

  const thoughts = Array.isArray(data.thoughts) ? data.thoughts : []
  elements.liveThoughtFeed.innerHTML = thoughts.length
    ? thoughts.slice(0, 10).map(item => renderLiveFeedItem(item, 'thought')).join('')
    : '<div class="live-feed-empty">暂无居民公开思考或上报。</div>'
}

function renderLiveFeedItem(item, type) {
  const label = type === 'decision' ? (item.source || '村长') : (item.kind || '想法')
  const model = item.model ? ' · ' + item.model : ''
  const time = item.at ? formatDateTime(item.at).split(' ').pop() : ''
  return [
    '<div class="live-feed-item">',
    '<div class="live-feed-row">',
    '<strong>' + escapeHtml(item.agent || '村庄') + '</strong>',
    '<span class="pill ' + liveFeedPillClass(label) + '">' + escapeHtml(label) + '</span>',
    '<small>' + escapeHtml(time + model) + '</small>',
    '</div>',
    item.title ? '<div class="live-feed-title">' + escapeHtml(item.title) + '</div>' : '',
    '<p>' + escapeHtml(item.text || '') + '</p>',
    '</div>'
  ].join('')
}

function liveFeedPillClass(label) {
  if (/守卫|受阻|脱困/.test(label)) return 'warn-pill'
  if (/完成|done/.test(label)) return 'ok-pill'
  if (/AI村长|村长/.test(label)) return 'commander-pill'
  return ''
}

function maybeSpeakCommanderVoice(item) {
  if (!item || !item.at || !item.text || item.at === state.lastVoiceAt) return
  state.lastVoiceAt = item.at
  const itemAt = Date.parse(item.at) || 0
  if (itemAt && itemAt + 3000 < state.pageLoadedAt) return
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return

  const utterance = new SpeechSynthesisUtterance(String(item.text || '').slice(0, 180))
  utterance.lang = 'zh-CN'
  utterance.rate = 1
  utterance.pitch = 1
  const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : []
  const savedVoice = localStorage.getItem('minecraftAiFriend.voice') || ''
  const zhVoice = voices.find(voice => `${voice.name || ''}|||${voice.lang || ''}|||${voice.voiceURI || ''}` === savedVoice)
    || voices.find(voice => /zh-CN/i.test(voice.lang || '') && /xiaoxiao|xiaoyi|xiaobei|xiaozhen|xiaoshuang/i.test(voice.name || ''))
    || voices.find(voice => /zh/i.test(voice.lang || '') && /natural|online/i.test(voice.name || ''))
    || voices.find(voice => /zh|Chinese|Mandarin|中文|普通话/i.test(`${voice.lang} ${voice.name}`))
  if (zhVoice) utterance.voice = zhVoice
  window.speechSynthesis.speak(utterance)
}

function renderModelProviders(data, config) {
  const providers = data && data.providers ? data.providers : state.modelProviders
  state.modelProviders = providers || []
  const nextConfig = config || state.config || {}
  renderProviderSelect('llmProvider', nextConfig.llmProvider || data && data.selectedProvider || '')
  renderProviderSelect('visionProvider', nextConfig.visionProvider || 'ollama')
  renderModelProviderHint(nextConfig)
}

function renderProviderSelect(id, selected) {
  const select = byId(id)
  if (!select) return
  const html = state.modelProviders.map(provider => `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.label)}</option>`).join('')
  if (select.innerHTML !== html) select.innerHTML = html
  if (select.dataset.touched !== '1') select.value = selected || (state.modelProviders[0] && state.modelProviders[0].id) || ''
}

function currentModelProvider(id, selectId = 'llmProvider') {
  const selected = id || byId(selectId).value || state.config && state.config[selectId]
  return state.modelProviders.find(provider => provider.id === selected) || state.modelProviders[0] || null
}

function onModelProviderChange() {
  byId('llmProvider').dataset.touched = '1'
  renderModelProviderHint(collectConfigPreview())
}

function onVisionProviderChange() {
  byId('visionProvider').dataset.touched = '1'
  renderModelProviderHint(collectConfigPreview())
}

function applyModelProviderPreset() {
  const provider = currentModelProvider(null, 'llmProvider')
  if (!provider) return
  setConfigInputValue('llmBaseUrl', provider.baseUrl)
  setConfigInputValue('llmModel', defaultChatModel(provider))
  setConfigInputValue('codeModel', defaultCodeModel(provider))
  byId('llmProvider').dataset.touched = '1'
  renderModelProviderHint(collectConfigPreview())
  showToast('聊天/代码模型预设已填入，保存后生效')
}

function applyVisionProviderPreset() {
  const provider = currentModelProvider(null, 'visionProvider')
  if (!provider) return
  setConfigInputValue('visionBaseUrl', provider.baseUrl)
  setConfigInputValue('visionModel', defaultVisionModel(provider))
  byId('visionProvider').dataset.touched = '1'
  renderModelProviderHint(collectConfigPreview())
  showToast('视觉模型预设已填入，保存后生效')
}

function applyModelProviderToProfile() {
  const textProvider = currentModelProvider(null, 'llmProvider')
  const visionProvider = currentModelProvider(null, 'visionProvider')
  if (!textProvider || !textProvider.mindcraftProfilePatch) {
    showToast('当前供应商没有可套用的 Mindcraft Profile 片段')
    return
  }
  try {
    const profile = JSON.parse(elements.mindcraftProfileJson.value || '{}')
    const patch = buildMindcraftProfilePatch(
      textProvider,
      byId('llmBaseUrl').value.trim(),
      byId('llmModel').value.trim(),
      byId('codeModel').value.trim(),
      visionProvider,
      byId('visionBaseUrl').value.trim(),
      byId('visionModel').value.trim()
    )
    Object.assign(profile, patch)
    elements.mindcraftProfileJson.value = JSON.stringify(profile, null, 2)
    showToast('当前聊天/代码/视觉模型已套用到角色 JSON，保存角色并重启 Mindcraft 后生效')
  } catch (error) {
    showToast(`角色 JSON 解析失败：${error.message}`)
  }
}

function buildMindcraftProfilePatch(textProvider, baseUrl, modelName, codeModelName, visionProvider, visionBaseUrl, visionModelName) {
  const patch = {}
  const model = buildProviderModelPatch(textProvider, baseUrl, modelName, 'model')
  const codeModel = buildProviderModelPatch(textProvider, baseUrl, codeModelName || modelName, 'code_model')
  const visionModel = buildProviderModelPatch(visionProvider || textProvider, visionBaseUrl || baseUrl, visionModelName, 'vision_model')
  if (model) patch.model = model
  if (codeModel) patch.code_model = codeModel
  if (visionModel) patch.vision_model = visionModel
  if (textProvider.id === 'aliyun-qwen') {
    const embedding = JSON.parse(JSON.stringify(textProvider.mindcraftProfilePatch.embedding || null))
    if (embedding && typeof embedding === 'object') {
      if (embedding.url && baseUrl) embedding.url = baseUrl
      patch.embedding = embedding
    }
  }
  return patch
}

function buildProviderModelPatch(provider, baseUrl, modelName, key) {
  if (!provider || !provider.mindcraftProfilePatch) return null
  const source = provider.mindcraftProfilePatch[key] || provider.mindcraftProfilePatch.model
  if (!source || typeof source !== 'object') return null
  const next = JSON.parse(JSON.stringify(source))
  if (modelName) next.model = modelName
  if (next.url && baseUrl) next.url = provider.id === 'ollama' ? stripOllamaV1(baseUrl) : baseUrl
  return next
}

function defaultChatModel(provider) {
  return provider.id === 'deepseek' ? 'deepseek-v4-flash' : provider.defaultModel
}

function defaultCodeModel(provider) {
  return provider.id === 'deepseek' ? 'deepseek-v4-pro' : provider.defaultModel
}

function defaultVisionModel(provider) {
  return provider.id === 'ollama' ? 'qwen3-vl:8b' : provider.defaultModel
}

function setConfigInputValue(id, value) {
  const input = byId(id)
  input.value = value || ''
  input.dataset.touched = '1'
}

function collectConfigPreview() {
  return {
    ...(state.config || {}),
    llmProvider: byId('llmProvider').value,
    llmBaseUrl: byId('llmBaseUrl').value,
    llmModel: byId('llmModel').value,
    codeModel: byId('codeModel').value,
    worldDirective: byId('worldDirective') ? byId('worldDirective').value : '',
    visionProvider: byId('visionProvider').value,
    visionBaseUrl: byId('visionBaseUrl').value,
    visionModel: byId('visionModel').value,
    memoryEmbeddingProvider: byId('memoryEmbeddingProvider') ? byId('memoryEmbeddingProvider').value : '',
    memoryEmbeddingBaseUrl: byId('memoryEmbeddingBaseUrl') ? byId('memoryEmbeddingBaseUrl').value : '',
    memoryEmbeddingModel: byId('memoryEmbeddingModel') ? byId('memoryEmbeddingModel').value : ''
  }
}

function renderModelProviderHint(config) {
  const textProvider = currentModelProvider(config.llmProvider, 'llmProvider')
  const visionProvider = currentModelProvider(config.visionProvider, 'visionProvider')
  if (textProvider && elements.llmProviderHint) {
    elements.llmProviderHint.textContent = providerHintText('聊天/代码', textProvider, config.llmKeyEnvNames, config.llmAcceptedEnvNames, config.llmMindcraftKeyEnv)
  }
  if (visionProvider && elements.visionProviderHint) {
    elements.visionProviderHint.textContent = providerHintText('视觉识别', visionProvider, config.visionKeyEnvNames, config.visionAcceptedEnvNames, config.visionMindcraftKeyEnv)
  }
}

function providerHintText(scope, provider, detectedNames, acceptedNames, mindcraftKeyEnv) {
  const detected = detectedNames && detectedNames.length > 0 ? detectedNames.join(', ') : provider.detectedEnvNames.join(', ')
  const accepted = acceptedNames && acceptedNames.length > 0 ? acceptedNames.join(', ') : provider.acceptedEnvNames.join(', ')
  const keyText = provider.authRequired
    ? detected ? `已检测到密钥环境变量：${detected}。` : `未检测到密钥；可设置：${accepted}。`
    : '本地模型不需要 API key。'
  const mindcraftText = mindcraftKeyEnv || provider.mindcraftKeyEnv
    ? `Mindcraft 侧期望：${mindcraftKeyEnv || provider.mindcraftKeyEnv}。`
    : 'Mindcraft 侧使用本地服务。'
  return `${scope} ${provider.label}：${provider.description} ${keyText} ${mindcraftText} ${provider.setupHint || ''}`
}

function stripOllamaV1(value) {
  return String(value || '').replace(/\/v1\/?$/, '')
}

function renderConfig(config) {
  if (!config) return
  for (const name of configInputs) {
    const input = byId(name)
    if (!input || input.dataset.touched === '1') continue
    if (input.type === 'checkbox') input.checked = Boolean(config[name])
    else input.value = config[name] === undefined ? '' : config[name]
    input.addEventListener('input', () => { input.dataset.touched = '1' }, { once: true })
  }
  renderModelProviderHint(config)
  const provider = currentModelProvider(config.llmProvider, 'llmProvider')
  const localLlm = provider ? !provider.authRequired : isLocalUrl(config.llmBaseUrl)
  const modeText = config.assistantMode === 'survival'
    ? '当前是生存助手模式：会优先考虑安全、食物、庇护所、照明、工具和短距离目标。'
    : '当前是创造练习模式：会优先建造和改善基地，并避免合成物品。'
  const llmText = localLlm
    ? '本地模型接口不需要 API key。'
    : config.llmApiKeyFromEnv
      ? '已检测到环境变量里的模型密钥，页面不会显示密钥内容。'
      : '没有检测到模型密钥；自动陪玩会使用保守的备用任务轮换。'
  const memoryText = config.memoryVectorEnabled
    ? `向量记忆：${config.memoryEmbeddingProvider || 'openai-compatible'} ${config.memoryEmbeddingModel || 'bge-m3'}，存储 ${config.memoryVectorStore || 'sqlite'}。`
    : '向量记忆：关闭。'
  const mcpText = config.mcpAllowLan
    ? 'MCP：允许局域网私网地址接入。'
    : 'MCP：仅允许本机 localhost 接入。'
  elements.llmHint.textContent = `${modeText} ${llmText} ${memoryText} ${mcpText}`
}

function renderLogs(logs) {
  elements.logsView.textContent = logs.map(entry => {
    return `${entry.at} ${entry.level.toUpperCase()} ${entry.message}`
  }).join('\n')
}

async function loadMindcraftConfig(profilePath = '') {
  try {
    const query = profilePath ? `?profile=${encodeURIComponent(profilePath)}` : ''
    const data = await apiGet(`/api/mindcraft-config${query}`)
    renderMindcraftConfig(data)
  } catch (error) {
    showToast(error.message)
  }
}

function renderMindcraftConfig(data) {
  const settings = data.settings || {}
  elements.mindcraftConfigHint.textContent = data.settingsExists
    ? `${data.settingsPath}。保存会自动备份；改动需要重启 Mindcraft 后生效。`
    : `没有找到 Mindcraft settings.js：${data.settingsPath}`

  for (const input of document.querySelectorAll('[data-mcfg]')) {
    const key = input.dataset.mcfg
    const value = settings[key]
    if (input.type === 'checkbox') {
      input.checked = Boolean(value)
    } else if (Array.isArray(value)) {
      input.value = value.join('\n')
    } else if (key === 'speak' && value === false) {
      input.value = 'false'
    } else if (value === null || value === undefined) {
      input.value = ''
    } else {
      input.value = value
    }
  }

  const selected = data.selectedProfilePath || ''
  elements.mindcraftProfileSelect.innerHTML = (data.profileOptions || []).map(option => {
    const isSelected = option.path === selected ? ' selected' : ''
    return `<option value="${escapeHtml(option.path)}"${isSelected}>${escapeHtml(option.label || option.path)}</option>`
  }).join('')
  elements.mindcraftProfileJson.value = data.selectedProfileJson || '{}'
  elements.mindcraftProfileHint.textContent = selected
    ? `当前角色文件：${selected}。保存前会自动备份；不要把 API key 写进 profile。`
    : '没有可用的 Agent Profile。'
}

async function saveMindcraftConfig() {
  try {
    state.busy = true
    const payload = {
      settings: collectMindcraftSettings(),
      profilePath: elements.mindcraftProfileSelect.value,
      profileJson: elements.mindcraftProfileJson.value
    }
    const data = await apiPost('/api/mindcraft-config', payload)
    renderMindcraftConfig(data)
    showToast('Mindcraft 配置已保存；重启 Mindcraft 后生效')
  } catch (error) {
    showToast(error.message)
  } finally {
    state.busy = false
  }
}

async function saveMindcraftProfile() {
  try {
    state.busy = true
    const payload = {
      profilePath: elements.mindcraftProfileSelect.value,
      profileJson: elements.mindcraftProfileJson.value
    }
    const data = await apiPost('/api/mindcraft-config', payload)
    renderMindcraftConfig(data)
    showToast('AI 角色配置已保存；重启 Mindcraft 后生效')
  } catch (error) {
    showToast(error.message)
  } finally {
    state.busy = false
  }
}

function collectMindcraftSettings() {
  const settings = {}
  for (const input of document.querySelectorAll('[data-mcfg]')) {
    const key = input.dataset.mcfg
    if (input.type === 'checkbox') {
      settings[key] = input.checked
    } else if (['profiles', 'only_chat_with', 'blocked_actions'].includes(key)) {
      settings[key] = input.value.split(/\r?\n|,/).map(part => part.trim()).filter(Boolean)
    } else if (input.type === 'number') {
      settings[key] = input.value === '' ? '' : Number(input.value)
    } else if (key === 'speak' && input.value === 'false') {
      settings[key] = false
    } else if (key === 'init_message' && !input.value.trim()) {
      settings[key] = null
    } else {
      settings[key] = input.value.trim()
    }
  }
  return settings
}

function renderMinecraftManager(status, logData) {
  const minecraft = status.minecraft || {}
  const canCommand = Boolean(minecraft.canSendCommand)
  const managed = Boolean(minecraft.managed)
  const pids = minecraft.processIds && minecraft.processIds.length > 0 ? minecraft.processIds.join(', ') : '未识别'
  const commandText = minecraft.startCommand ? ` 启动方式：${minecraft.startCommand}。` : ''
  const channel = minecraft.commandChannel || (managed ? 'stdin' : canCommand ? 'rcon' : 'none')
  elements.minecraftManagerHint.textContent = managed
    ? `服务端由本页面托管，PID ${minecraft.ownedPid}，可以发送控制台命令。${commandText}`
    : minecraft.tcpOpen && channel === 'rcon'
      ? `服务端在线，是外部进程 PID ${pids}；RCON 命令通道已可用，可以发送控制台命令和自动切换观察者。`
      : minecraft.tcpOpen
        ? `服务端在线，但它是外部进程，PID ${pids}。当前没有可用命令通道；要发送控制台命令，需要从本页面启动，或开启 RCON。`
        : '服务端离线。点击顶部“启动服务器”会从 start.bat/start.sh 推断 Java 参数，并直接管理 server.jar。'

  byId('stopMinecraftBtn').disabled = !managed
  byId('restartMinecraftBtn').disabled = minecraft.tcpOpen && !managed
  byId('minecraftCommand').disabled = !canCommand
  byId('minecraftCommandForm').querySelector('button[type="submit"]').disabled = !canCommand
  document.querySelectorAll('[data-minecraft-command]').forEach(button => { button.disabled = !canCommand })
  document.querySelectorAll('[data-player-location]').forEach(control => { control.disabled = !canCommand })
  document.querySelectorAll('[data-runtime-control]').forEach(control => { control.disabled = !canCommand })
  if (elements.minecraftRuntimeHint) {
    elements.minecraftRuntimeHint.textContent = canCommand
      ? '这里会立即发送 difficulty、defaultgamemode、gamemode 等控制台命令。持久配置请在下方 server.properties 保存。'
      : '只有通过本页面托管或开启 RCON 后，才能直接应用在线世界设置。'
  }
  renderMinecraftLog(logData)
}

function renderMinecraftLog(data) {
  if (!data || !data.exists) {
    elements.minecraftLogView.textContent = data && data.path ? `未找到服务端日志：${data.path}` : '尚未配置服务器目录。'
    return
  }
  elements.minecraftLogView.textContent = (data.lines || []).join('\n') || '服务端日志为空。'
}

async function saveConfig() {
  const payload = {}
  for (const name of configInputs) {
    const input = byId(name)
    if (!input) continue
    payload[name] = input.type === 'checkbox' ? input.checked : input.value
    input.dataset.touched = ''
  }
  try {
    state.busy = true
    const config = await apiPost('/api/config', payload)
    state.config = config
    showToast('设置已保存')
    await refreshAll()
  } catch (error) {
    showToast(error.message)
  } finally {
    state.busy = false
  }
}

async function toggleAutopilot() {
  const running = state.status && state.status.autopilot.active
  await postAction(running ? '/api/autopilot/stop' : '/api/autopilot/start', running ? '自动陪玩已停止' : '自动陪玩已启动')
}

async function startExperience() {
  try {
    state.busy = true
    elements.homeSummary.textContent = '正在启动 Minecraft Server。'
    await apiPost('/api/minecraft/start', {})
    await waitForStatus(status => status.minecraft.tcpOpen, '等待 Minecraft Server 在线', 90000)
    elements.homeSummary.textContent = '服务器已在线，正在启动 Mindcraft。'
    await apiPost('/api/mindcraft/start', {})
    await waitForStatus(status => status.mindcraft.httpOk, '等待 Mindcraft 在线', 60000)
    elements.homeSummary.textContent = 'Mindcraft 已在线，正在准备 AI 队友进服。'
    await ensureAgentReady()
    elements.homeSummary.textContent = 'AI 队友已准备，正在启动自动陪玩。'
    await apiPost('/api/autopilot/start', {})
    showToast('陪玩流程已启动')
    await refreshAll()
  } catch (error) {
    showToast(error.message)
    await refreshAll()
  } finally {
    state.busy = false
  }
}

async function ensureAgentReady() {
  const connectedStatus = await waitForStatus(status => status.socket.connected, '等待 Mindcraft 通信连接', 30000)
  const agents = connectedStatus.socket.agents || []
  const onlineAgent = agents.find(agent => agent.in_game)
  if (onlineAgent) return onlineAgent

  if (agents.length > 0) {
    const agent = agents[0]
    await apiPost('/api/agents/start', { agent: agent.name })
    await waitForStatus(status => (status.socket.agents || []).some(item => item.name === agent.name && item.in_game), `等待 ${agent.name} 进服`, 60000)
    return agent
  }

  const created = await apiPost('/api/agents/create', { name: 'CodexFriend' })
  await waitForStatus(status => (status.socket.agents || []).some(item => item.name === created.agent && item.in_game), `等待 ${created.agent} 进服`, 60000)
  return created
}


async function waitForStatus(predicate, label, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const status = await apiGet('/api/status')
    state.status = status
    renderStatus(status)
    renderProductHome(status)
    if (predicate(status)) return status
    elements.homeSummary.textContent = `${label}。`
    await sleep(2500)
  }
  throw new Error(`${label}超时，请查看下方日志。`)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function createAgent(event) {
  event.preventDefault()
  const name = elements.newAgentName.value.trim()
  if (!name) {
    showToast('请先填写 AI 名字')
    return
  }
  try {
    state.busy = true
    const response = await apiPost('/api/agents/create', { name })
    elements.newAgentName.value = ''
    showToast(`AI ${response.agent} 已创建并请求进服`)
    await refreshAll()
    await loadMindcraftConfig()
  } catch (error) {
    showToast(error.message)
  } finally {
    state.busy = false
  }
}

async function handleAgentAction(event) {
  const button = event.target.closest('[data-agent-action]')
  if (!button || !elements.agentsList.contains(button)) return
  const agent = button.dataset.agentName || ''
  const action = button.dataset.agentAction || ''
  if (!agent) return
  if (action === 'rescue') {
    await rescueAgent(agent, button)
    return
  }
  const path = action === 'stop' ? '/api/agents/stop' : '/api/agents/start'
  const message = action === 'stop' ? `已请求 ${agent} 停止` : `已请求 ${agent} 进服`
  try {
    state.busy = true
    button.disabled = true
    await apiPost(path, { agent })
    showToast(message)
    await refreshAll()
  } catch (error) {
    showToast(error.message)
  } finally {
    state.busy = false
    button.disabled = false
  }
}


async function sendPresetTask(key) {
  const task = key === 'water-rescue' ? buildRescueTask(byId('taskAgent').value.trim()) : presetTasks[key] || ''
  if (!task) return
  byId('taskText').value = task
  const onlineAgents = state.status && state.status.socket && state.status.socket.agents
    ? state.status.socket.agents.filter(agent => agent.in_game)
    : []
  if (onlineAgents.length === 0) {
    showToast('任务已填入。AI 队友在线后再发送。')
    return
  }
  try {
    state.busy = true
    const response = await apiPost('/api/task', { agent: byId('taskAgent').value.trim(), task })
    showToast(`任务已发送给 ${response.targets.join(', ')}`)
    await refreshAll()
  } catch (error) {
    showToast(error.message)
  } finally {
    state.busy = false
  }
}

async function rescueAgent(agentName = '', button = null) {
  const selectedAgent = agentName || elements.locateAgentName.value.trim() || byId('taskAgent').value.trim()
  const task = buildRescueTask(selectedAgent)
  try {
    state.busy = true
    if (button) button.disabled = true
    const response = await apiPost('/api/task', {
      agent: selectedAgent,
      task,
      title: '水中脱困',
      source: 'rescue'
    })
    elements.playerLocationHint.textContent = `已发送脱困任务给 ${response.targets.join(', ')}。如果 30 秒后仍卡住，再点“传送 AI 到我”。`
    showToast(`脱困任务已发送给 ${response.targets.join(', ')}`)
    await refreshAll()
  } catch (error) {
    showToast(error.message)
  } finally {
    state.busy = false
    if (button) button.disabled = false
  }
}

function buildRescueTask(agentName = '') {
  const base = state.village && state.village.settlement ? state.village.settlement.base : null
  const chest = state.village && state.village.settlement ? state.village.settlement.publicChest : null
  const safeTarget = chest || base
  const targetText = safeTarget ? `安全目标坐标：X=${num(safeTarget.x)}, Y=${num(safeTarget.y)}, Z=${num(safeTarget.z)}。` : '如果不知道基地坐标，先回到最近的岸边、地面、树旁或亮处。'
  const nameText = agentName ? `${agentName}，` : ''
  return [
    `${nameText}立刻执行水中/卡住脱困流程，暂停当前采集、建造、聊天或探索。`,
    '如果你在水里：先看向水面和最近岸边，持续向上游并朝岸边移动，不要继续下潜，不要在水下挖方块。',
    '如果被水流、洞口、藤蔓、门、船、方块边缘或狭窄空间卡住：后退两格，跳跃，转向 90 度，寻找最近的完整方块站上去。',
    '如果身上有泥土、圆石、木板或其他廉价方块，可以在脚下或身边放 1-3 个方块做临时台阶，但不要破坏玩家建筑。',
    targetText,
    '如果 20 秒内坐标几乎不变、仍在水里、生命值低于 12 或即将溺水，马上停止动作，在聊天里用中文说“受阻：我卡住了，需要传送”，然后等待玩家或管理员救援。',
    '脱困后用中文简短汇报当前位置、原因和下一步。'
  ].join(' ')
}

async function locatePlayer() {
  const player = currentHumanPlayerName()
  if (!player) {
    showToast('请先填写真人玩家名，例如 MengMeng')
    return
  }
  try {
    state.busy = true
    const data = await apiPost('/api/player/location', { player })
    elements.playerLocationHint.textContent = `${data.player} 坐标：${formatPosition(data.position)}`
    byId('minecraftPlayerName').value = data.player
    await refreshMinecraftLog()
  } catch (error) {
    showToast(error.message)
  } finally {
    state.busy = false
  }
}

async function guideAgentsToPlayer(teleport) {
  const player = currentHumanPlayerName()
  if (!player) {
    showToast('请先填写真人玩家名，例如 MengMeng')
    return
  }
  try {
    state.busy = true
    const payload = {
      player,
      agent: elements.locateAgentName.value.trim(),
      teleport
    }
    const data = await apiPost('/api/agents/go-to-player', payload)
    const action = teleport ? '已传送' : '已发送坐标给'
    elements.playerLocationHint.textContent = `${data.player} 坐标：${formatPosition(data.position)}；${action} ${data.targets.join(', ')}`
    await refreshMinecraftLog()
    await refreshAll()
  } catch (error) {
    showToast(error.message)
  } finally {
    state.busy = false
  }
}

function currentHumanPlayerName() {
  return elements.humanPlayerName.value.trim() || byId('minecraftPlayerName').value.trim()
}

function formatPosition(position) {
  if (!position) return '未知'
  return `${num(position.x)}, ${num(position.y)}, ${num(position.z)}`
}

async function sendTask(event) {
  event.preventDefault()
  const agent = byId('taskAgent').value.trim()
  const task = byId('taskText').value.trim()
  if (!task) {
    showToast('请先填写任务')
    return
  }
  try {
    state.busy = true
    const response = await apiPost('/api/task', { agent, task })
    showToast(`任务已发送给 ${response.targets.join(', ')}`)
    byId('taskText').value = ''
    await refreshAll()
  } catch (error) {
    showToast(error.message)
  } finally {
    state.busy = false
  }
}

function renderVillage(village) {
  if (!village || !elements.villageRoles) return
  state.village = village
  const settlement = village.settlement || {}
  setUntouchedValue(elements.villageName, settlement.name || '')
  setUntouchedValue(elements.villageRadius, settlement.radius || 120)
  setPositionInputs('villageBase', settlement.base)
  setPositionInputs('villageChest', settlement.publicChest)

  if (elements.villageCommander) elements.villageCommander.innerHTML = renderVillageCommander(village.commander || {})

  elements.villageRoles.innerHTML = (village.roles || []).map(role => {
    const pos = role.lastPosition ? formatPosition(role.lastPosition) : '位置未知'
    const online = role.online ? '<span class="pill ok-pill">在线</span>' : '<span class="pill">离线/未知</span>'
    return [
      '<div class="village-item">',
      `<div><strong>${escapeHtml(role.agent)}</strong> ${online}</div>`,
      `<small>${escapeHtml(role.role)}：${escapeHtml(role.focus || '')}</small>`,
      `<small>人设：${escapeHtml(role.persona || '')}</small>`,
      `<small>资料区：${escapeHtml(role.storageScope || '')}</small>`,
      `<small>${escapeHtml(pos)} ${role.lastAction ? '|' : ''} ${escapeHtml(role.lastAction || '')}</small>`,
      '</div>'
    ].join('')
  }).join('')



  if (elements.villageTasks) {
    elements.villageTasks.innerHTML = renderVillageTaskEvents(village.taskEvents || [])
  }
elements.villageResources.innerHTML = (village.resources || []).map(resource => {
    const current = Number(resource.current || 0)
    const target = Math.max(1, Number(resource.target || 1))
    const percent = Math.max(0, Math.min(100, Math.round(current / target * 100)))
    return [
      '<div class="village-item">',
      `<div><strong>${escapeHtml(resource.name)}</strong><small>${current}/${target} ${escapeHtml(resource.unit || '')}</small></div>`,
      `<div class="resource-bar"><span style="width:${percent}%"></span></div>`,
      '</div>'
    ].join('')
  }).join('')

  elements.villageProjects.innerHTML = (village.projects || []).map(project => renderVillageProject(project)).join('')
  if (elements.villageInfrastructures) {
    elements.villageInfrastructures.innerHTML = renderVillageInfrastructures(village.infrastructures || [])
  }
  if (elements.villageReports) {
    elements.villageReports.innerHTML = renderVillageReports(village.notes || [])
  }
}

function renderVillageDashboard(dashboard) {
  if (!elements.villageResourceDashboard || !elements.villageScoreboard) return
  if (!dashboard || dashboard.error) {
    const message = dashboard && dashboard.error ? dashboard.error : '等待实时看板数据'
    elements.villageResourceDashboard.innerHTML = `<div class="village-item"><small>${escapeHtml(message)}</small></div>`
    elements.villageScoreboard.innerHTML = '<div class="village-item"><small>暂无战绩数据。</small></div>'
    if (elements.villageDashboardMeta) elements.villageDashboardMeta.textContent = '实时数据不可用'
    return
  }

  const summary = dashboard.summary || {}
  const warnings = Array.isArray(dashboard.warnings) ? dashboard.warnings : []
  if (elements.villageDashboardMeta) {
    const cacheText = dashboard.cached ? `缓存 ${Math.round((dashboard.cacheAgeMs || 0) / 1000)} 秒` : '刚刚刷新'
    const warningText = warnings.length ? ` | ${warnings.join('；')}` : ''
    elements.villageDashboardMeta.textContent = `${cacheText} | 公共箱 ${summary.publicChestCount || 0} 个 | 在线 ${summary.onlineResidents || 0}/${summary.totalResidents || 0}${warningText}`
  }

  const resources = Array.isArray(dashboard.resources) ? dashboard.resources : []
  elements.villageResourceDashboard.innerHTML = resources.map(resource => {
    const percent = Math.max(0, Math.min(100, Number(resource.percent || 0)))
    const status = resourceStatusLabel(resource.status)
    return [
      '<div class="resource-dashboard-row">',
      '<div class="resource-dashboard-title">',
      `<strong>${escapeHtml(resource.name || resource.id)}</strong>`,
      `<span class="pill ${resource.status === 'done' ? 'ok-pill' : resource.status === 'missing' ? 'bad-pill' : 'warn-pill'}">${escapeHtml(status)}</span>`,
      '</div>',
      `<div class="resource-dashboard-count">实时 ${num(resource.current)}/${num(resource.target)} ${escapeHtml(resource.unit || '')} · 箱内 ${num(resource.chest)} · 村民携带 ${num(resource.carried)}</div>`,
      `<div class="resource-bar"><span style="width:${percent}%"></span></div>`,
      '</div>'
    ].join('')
  }).join('') || '<div class="village-item"><small>暂无资源数据。</small></div>'

  const scoreboard = Array.isArray(dashboard.scoreboard) ? dashboard.scoreboard : []
  elements.villageScoreboard.innerHTML = scoreboard.map((row, index) => {
    const carried = row.carriedTopItems && row.carriedTopItems.length
      ? row.carriedTopItems.slice(0, 4).map(item => `${item.name} x${item.count}`).join('，')
      : '背包摘要暂无'
    const online = row.online ? '<span class="pill ok-pill">在线</span>' : '<span class="pill">离线</span>'
    return [
      '<div class="scoreboard-row">',
      `<div class="score-rank">#${index + 1}</div>`,
      '<div class="score-main">',
      `<div><strong>${escapeHtml(row.agent)}</strong>${online}<span class="score-value">${num(row.score)} 分</span></div>`,
      `<small>死亡 ${num(row.deaths)} · 怪物 ${num(row.monsterKills)} · 总击杀 ${num(row.kills)} · 玩家 ${num(row.playerKills)} · 动物 ${num(row.animalKills)} · 羊 ${num(row.sheepKills)}</small>`,
      `<small>食物 ${num(row.foodPicked)} · 羊毛 ${num(row.woolPicked)} · 床 ${num(row.bedsCrafted)} · 矿石 ${num(row.oreMined)} · 伤害 ${num(row.damageDealt)}</small>`,
      `<small>当前位置 ${escapeHtml(formatPosition(row.position))} · 当前动作 ${escapeHtml(row.action || '暂无')}</small>`,
      `<small>携带：${escapeHtml(carried)}</small>`,
      '</div>',
      '</div>'
    ].join('')
  }).join('') || '<div class="village-item"><small>暂无战绩数据。</small></div>'
}

function resourceStatusLabel(status) {
  return {
    done: '达标',
    partial: '进行中',
    missing: '缺口'
  }[status] || '记录'
}
function renderVillageCommander(commander) {
  const duties = Array.isArray(commander.duties) ? commander.duties : []
  return [
    '<div class="village-item">',
    `<div><strong>${escapeHtml(commander.title || 'AI村长')} ${escapeHtml(commander.name || '')}</strong><span class="pill">指挥官</span></div>`,
    `<small>${escapeHtml(commander.persona || '')}</small>`,
    `<small>直播观察：${escapeHtml(commander.livestreamRole || '')}</small>`,
    duties.length ? `<small>职责：${duties.map(escapeHtml).join('；')}</small>` : '',
    '</div>'
  ].join('')
}

function renderVillageInfrastructures(items) {
  if (!items.length) return '<div class="village-item"><small>还没有公共设施上报。村民完成公共箱子、照明、道路、农场或房屋后会自动记录在这里。</small></div>'
  return items.slice(-12).reverse().map(item => {
    const status = infrastructureStatusLabel(item.status)
    const position = item.position ? formatPosition(item.position) : '位置未知'
    const publicText = item.public ? '公共' : '私人/临时'
    return [
      '<div class="village-item">',
      `<div><strong>${escapeHtml(item.title || item.type)}</strong><span class="pill">${escapeHtml(status)}</span></div>`,
      `<small>${escapeHtml(publicText)} | ${escapeHtml(infrastructureTypeLabel(item.type))} | ${escapeHtml(position)}</small>`,
      `<small>${escapeHtml(item.agent || '未知居民')}：${escapeHtml(item.description || '无说明')}</small>`,
      '</div>'
    ].join('')
  }).join('')
}

function renderVillageReports(notes) {
  const reports = notes.filter(item => item && item.type === 'infrastructure_report').slice(-10).reverse()
  if (!reports.length) return '<div class="village-item"><small>暂无村民上报。</small></div>'
  return reports.map(note => {
    return [
      '<div class="village-item">',
      `<div><strong>${escapeHtml(note.agent || 'AI')}</strong><small>${escapeHtml(formatDateTime(note.at))}</small></div>`,
      `<small>${escapeHtml(note.text || '')}</small>`,
      '</div>'
    ].join('')
  }).join('')
}

function renderVillageTaskEvents(events) {
  if (!events.length) return '<div class="village-item"><small>暂无任务事件。派发村庄任务或手动任务后会记录在这里。</small></div>'
  return events.slice(-12).reverse().map(event => {
    const status = taskEventStatusLabel(event.status)
    const project = event.projectId ? ` | 项目：${event.projectId}` : ''
    return [
      '<div class="village-item">',
      `<div><strong>${escapeHtml(event.agent || 'AI')}</strong><span class="pill">${escapeHtml(status)}</span></div>`,
      `<small>${escapeHtml(event.title || event.type || '任务事件')} | ${escapeHtml(event.source || 'system')}${escapeHtml(project)}</small>`,
      `<small>${escapeHtml(formatDateTime(event.at))}</small>`,
      `<small>${escapeHtml(truncateText(event.description || '', 180))}</small>`,
      '</div>'
    ].join('')
  }).join('')
}

function taskEventStatusLabel(status) {
  return {
    active: '执行中',
    done: '已完成',
    blocked: '受阻',
    info: '记录'
  }[status] || '记录'
}

function truncateText(value, maxLength) {
  const text = String(value || '')
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 1) + '…'
}
function infrastructureStatusLabel(status) {
  return {
    planned: '计划',
    started: '进行中',
    done: '已完成',
    blocked: '受阻'
  }[status] || '已上报'
}

function infrastructureTypeLabel(type) {
  return {
    storage: '仓储',
    resource: '资源点',
    lighting: '照明',
    road: '道路',
    farm: '农场',
    house: '住宅',
    shelter: '庇护所',
    wall: '安全边界',
    bridge: '桥',
    mine: '矿点',
    landmark: '地标',
    other: '其他'
  }[type] || '其他'
}

function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

function renderVillageProject(project) {
  const checklist = (project.checklist || []).map(item => {
    const checked = item.done ? ' checked' : ''
    return `<label class="checkline"><input type="checkbox" data-village-project-check="${escapeHtml(project.id)}" data-check-id="${escapeHtml(item.id)}"${checked}>${escapeHtml(item.text)}</label>`
  }).join('')
  return [
    '<div class="village-project-card">',
    '<div class="project-head">',
    `<div><strong>${escapeHtml(project.title)}</strong><small>${escapeHtml(project.priority)} | ${escapeHtml(project.ownerRole)}</small></div>`,
    `<select data-village-project-status="${escapeHtml(project.id)}">${projectStatusOptions(project.status)}</select>`,
    '</div>',
    `<p>${escapeHtml(project.goal || '')}</p>`,
    `<div class="project-checklist">${checklist}</div>`,
    '</div>'
  ].join('')
}

function projectStatusOptions(selected) {
  const options = [
    ['planned', '计划中'],
    ['active', '进行中'],
    ['blocked', '受阻'],
    ['done', '完成']
  ]
  return options.map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('')
}

async function saveVillage() {
  try {
    state.busy = true
    const village = await apiPost('/api/village', { settlement: collectVillageSettlement() })
    renderVillage(village)
    showToast('村庄计划已保存到本地共享记忆')
    await refreshAll()
  } catch (error) {
    showToast(error.message)
  } finally {
    state.busy = false
  }
}

async function resetVillage() {
  try {
    state.busy = true
    const village = await apiPost('/api/village/reset', {})
    clearVillageTouched()
    renderVillage(village)
    showToast('已恢复默认村庄计划')
    await refreshAll()
  } catch (error) {
    showToast(error.message)
  } finally {
    state.busy = false
  }
}

async function activateSocietyMode() {
  try {
    state.busy = true
    const response = await apiPost('/api/society/activate', {
      worldDirective: byId('worldDirective') ? byId('worldDirective').value : '',
      startAutopilot: true
    })
    state.config = response.config
    showToast(`已进入常驻生存模式：${response.residents.join(', ')}`)
    await refreshAll()
  } catch (error) {
    showToast(error.message)
  } finally {
    state.busy = false
  }
}

async function ensureVillageResidents() {
  try {
    state.busy = true
    const response = await apiPost('/api/society/residents/ensure', {
      startAutopilot: true,
      activateSociety: true,
      agentFilter: 'Alex,Luna,Milo,Nova,Ivy'
    })
    const failed = response.failed && response.failed.length > 0 ? `；失败：${response.failed.map(item => item.agent).join(', ')}` : ''
    showToast(`已恢复居民：${response.results.map(item => item.agent).join(', ')}${failed}`)
    await refreshAll()
  } catch (error) {
    showToast(error.message)
  } finally {
    state.busy = false
  }
}
async function dispatchVillageTasks(goalOverride = '') {
  try {
    state.busy = true
    const goal = typeof goalOverride === 'string' && goalOverride ? goalOverride : elements.societyGoal ? elements.societyGoal.value.trim() : ''
    const response = await apiPost('/api/society/dispatch', {
      goal
    })
    const skipped = response.skipped && response.skipped.length > 0 ? `；未在线：${response.skipped.join(', ')}` : ''
    showToast(`已派发村庄任务给 ${response.sent.map(item => item.agent).join(', ')}${skipped}`)
    await refreshAll()
  } catch (error) {
    showToast(error.message)
  } finally {
    state.busy = false
  }
}

async function sendSocietyPreset(key) {
  const goal = societyGoalPresets[key] || ''
  if (!goal) return
  if (elements.societyGoal) elements.societyGoal.value = goal
  await dispatchVillageTasks(goal)
}

async function setVillageBaseFromPlayer() {
  const player = currentHumanPlayerName()
  if (!player) {
    showToast('请先填写真人玩家名，再设置基地坐标')
    return
  }
  try {
    state.busy = true
    const data = await apiPost('/api/player/location', { player })
    const current = collectVillageSettlement()
    const village = await apiPost('/api/village', {
      settlement: {
        ...current,
        base: data.position
      }
    })
    clearVillageTouched()
    renderVillage(village)
    elements.playerLocationHint.textContent = `${data.player} 坐标：${formatPosition(data.position)}；已设为村庄基地。`
    showToast('已用玩家当前位置设置村庄基地')
    await refreshAll()
  } catch (error) {
    showToast(error.message)
  } finally {
    state.busy = false
  }
}

async function handleVillageProjectChange(event) {
  const statusId = event.target.dataset.villageProjectStatus
  const checkProjectId = event.target.dataset.villageProjectCheck
  if (!statusId && !checkProjectId) return
  const current = state.village && state.village.projects ? state.village.projects : []
  const project = current.find(item => item.id === (statusId || checkProjectId))
  if (!project) return
  const next = JSON.parse(JSON.stringify(project))
  if (statusId) next.status = event.target.value
  if (checkProjectId) {
    const checkId = event.target.dataset.checkId
    next.checklist = (next.checklist || []).map(item => item.id === checkId ? { ...item, done: event.target.checked } : item)
  }
  try {
    const village = await apiPost('/api/village/project', { id: next.id, project: next })
    renderVillage(village)
    showToast('村庄项目已更新')
  } catch (error) {
    showToast(error.message)
  }
}

function collectVillageSettlement() {
  return {
    name: elements.villageName.value.trim(),
    base: collectPosition('villageBase'),
    publicChest: collectPosition('villageChest'),
    radius: elements.villageRadius.value
  }
}

function collectPosition(prefix) {
  const x = byId(prefix + 'X').value
  const y = byId(prefix + 'Y').value
  const z = byId(prefix + 'Z').value
  if (x === '' && y === '' && z === '') return null
  return { x: Number(x), y: Number(y), z: Number(z) }
}

function setPositionInputs(prefix, position) {
  setUntouchedValue(byId(prefix + 'X'), position ? position.x : '')
  setUntouchedValue(byId(prefix + 'Y'), position ? position.y : '')
  setUntouchedValue(byId(prefix + 'Z'), position ? position.z : '')
}

function setUntouchedValue(input, value) {
  if (!input) return
  if (input.dataset.touched !== '1') input.value = value === undefined || value === null ? '' : value
  if (input.dataset.touchBound === '1') return
  input.dataset.touchBound = '1'
  input.addEventListener('input', () => { input.dataset.touched = '1' })
}

function clearVillageTouched() {
  ['villageName', 'villageBaseX', 'villageBaseY', 'villageBaseZ', 'villageChestX', 'villageChestY', 'villageChestZ', 'villageRadius'].forEach(id => {
    const input = byId(id)
    if (input) input.dataset.touched = ''
  })
}
async function loadMemory() {
  const agent = byId('taskAgent').value.trim()
  try {
    const query = agent ? `?agent=${encodeURIComponent(agent)}` : ''
    const memory = await apiGet(`/api/memory${query}`)
    elements.memoryView.textContent = JSON.stringify(memory, null, 2)
  } catch (error) {
    showToast(error.message)
  }
}

async function loadServerBlueprint() {
  try {
    const data = await apiGet('/api/server-blueprint')
    state.serverBlueprint = data
    renderServerBlueprint(data)
  } catch (error) {
    showToast(error.message)
  }
}

function renderServerBlueprint(data) {
  if (!data || !elements.serverBlueprintSummary) return
  const propertyChanges = data.properties && data.properties.changes ? data.properties.changes : []
  const changed = propertyChanges.filter(item => item.changed)
  const analysis = data.analysis || {}
  elements.serverBlueprintHint.textContent = data.noWrite
    ? `只读蓝图：当前识别为 ${analysis.typeLabel || '未知'}，不会写入 server.properties、替换 jar 或重启服务器。`
    : '蓝图已生成。'

  elements.serverBlueprintSummary.innerHTML = (data.summary || []).map(item => {
    return `<div class="blueprint-chip">${escapeHtml(item)}</div>`
  }).join('')

  elements.serverBlueprintReadiness.innerHTML = (data.readiness || []).map(group => {
    const statusClass = group.status === 'ready' ? 'ok-pill' : group.status === 'partial' ? 'warn-pill' : 'bad-pill'
    const failed = (group.items || []).filter(item => !item.ok).slice(0, 3)
    const details = failed.length > 0
      ? failed.map(item => `<small>待处理：${escapeHtml(item.label)} - ${escapeHtml(item.detail)}</small>`).join('')
      : '<small>关键检查已通过。</small>'
    return [
      '<div class="blueprint-item">',
      `<div><strong>${escapeHtml(group.title)}</strong> <span class="pill ${statusClass}">${escapeHtml(group.statusLabel)} ${Number(group.score || 0)}%</span></div>`,
      details,
      '</div>'
    ].join('')
  }).join('') || '<div class="blueprint-item"><small>暂无就绪度数据。</small></div>'

  elements.serverBlueprintNextActions.innerHTML = (data.nextActions || []).map(item => {
    return [
      '<div class="blueprint-item">',
      `<div><strong>${escapeHtml(item.title)}</strong> <span class="pill">${escapeHtml(item.priority)}</span></div>`,
      `<small>${escapeHtml(item.phase || '')}</small>`,
      `<p>${escapeHtml(item.detail)}</p>`,
      '</div>'
    ].join('')
  }).join('') || '<div class="blueprint-item"><small>暂无下一步。</small></div>'
  elements.serverBlueprintProperties.innerHTML = propertyChanges.map(item => {
    const current = item.current || '未设置'
    const badge = item.changed ? '<span class="pill warn-pill">建议修改</span>' : '<span class="pill ok-pill">已符合</span>'
    const restart = item.requiresRestart ? '需要重启后完全生效' : '可在线生效'
    return [
      '<div class="blueprint-item">',
      `<div><strong>${escapeHtml(item.key)}</strong> ${badge}</div>`,
      `<small>当前：${escapeHtml(current)}；建议：${escapeHtml(item.recommended)}；${restart}</small>`,
      `<p>${escapeHtml(item.reason)}</p>`,
      '</div>'
    ].join('')
  }).join('') || '<div class="blueprint-item"><small>没有可比较的配置。</small></div>'

  const platform = data.platform || {}
  elements.serverBlueprintPhases.innerHTML = [
    '<div class="blueprint-item">',
    `<div><strong>${escapeHtml(platform.recommended || 'Paper')}</strong> <span class="pill">${escapeHtml(platform.urgency || '建议评估')}</span></div>`,
    `<p>${escapeHtml(platform.rationale || '')}</p>`,
    '</div>',
    ...(platform.options || []).map(option => [
      '<div class="blueprint-item">',
      `<strong>${escapeHtml(option.name)}</strong>`,
      `<small>${escapeHtml(option.fit)}</small>`,
      `<p>${escapeHtml(option.tradeoff)}</p>`,
      '</div>'
    ].join(''))
  ].join('')

  elements.serverBlueprintPlugins.innerHTML = (data.plugins || []).map(plugin => {
    return [
      '<div class="blueprint-item">',
      `<div><strong>${escapeHtml(plugin.name)}</strong> <span class="pill">${escapeHtml(plugin.priority)}</span></div>`,
      `<small>${escapeHtml(plugin.status)}</small>`,
      `<p>${escapeHtml(plugin.purpose)}</p>`,
      '</div>'
    ].join('')
  }).join('')

  const livestream = data.livestream || {}
  elements.serverBlueprintStreaming.innerHTML = [
    '<div class="blueprint-item">',
    `<strong>${escapeHtml(livestream.recommendedPath || '')}</strong>`,
    `<p>${escapeHtml(livestream.limitation || '')}</p>`,
    '</div>',
    ...((livestream.stages || []).map(stage => `<div class="blueprint-item"><small>${escapeHtml(stage)}</small></div>`))
  ].join('')

  const dryRun = data.dryRun || {}
  elements.serverBlueprintDryRun.textContent = [
    dryRun.note || '',
    '',
    '[server.properties 预览]',
    dryRun.propertyPreview || '',
    '',
    '[将来可手动执行的控制台命令]',
    (dryRun.futureCommands || []).join('\n'),
    '',
    '[备份范围检查]',
    dryRun.backupChecklist || ''
  ].join('\n')

  if (changed.length === 0) showToast('服务器蓝图已刷新：配置建议都已符合')
}

async function copyServerBlueprint() {
  const text = state.serverBlueprint && state.serverBlueprint.markdown
  if (!text) {
    showToast('请先刷新服务器蓝图')
    return
  }
  await copyText(text)
  showToast('服务器改造方案已复制')
}

async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

async function loadServerProperties() {
  try {
    const data = await apiGet('/api/server-properties')
    renderServerProperties(data)
  } catch (error) {
    showToast(error.message)
  }
}
async function sendMinecraftCommand(event) {
  event.preventDefault()
  const command = byId('minecraftCommand').value.trim()
  if (!command) {
    showToast('请先填写控制台命令')
    return
  }
  await sendMinecraftCommandText(command)
  byId('minecraftCommand').value = ''
}

async function focusLiveObserver() {
  try {
    state.busy = true
    const observer = (state.config && state.config.liveObserverName) || 'live'
    const data = await apiPost('/api/livestream/focus', { observer, target: 'auto' })
    showToast(`${data.observer} 已切到 ${data.target}`)
    await refreshMinecraftLog()
    await refreshAll()
  } catch (error) {
    showToast(error.message)
  } finally {
    state.busy = false
  }
}
function runMinecraftQuickCommand(event) {
  const template = event.currentTarget.dataset.minecraftCommand || ''
  const player = byId('minecraftPlayerName').value.trim()
  if (template.includes('{player}') && !player) {
    showToast('这个快捷命令需要先填写玩家名')
    return
  }
  sendMinecraftCommandText(template.replaceAll('{player}', player))
}

async function sendMinecraftCommandText(command) {
  try {
    state.busy = true
    const data = await apiPost('/api/minecraft/command', { command })
    showToast(`命令已发送：${data.command}`)
    await refreshMinecraftLog()
    await refreshAll()
  } catch (error) {
    showToast(error.message)
  } finally {
    state.busy = false
  }
}

async function applyMinecraftRuntimeSettings(event) {
  event.preventDefault()
  const difficulty = byId('runtimeDifficulty').value
  const defaultGamemode = byId('runtimeDefaultGamemode').value
  const playerGamemode = byId('runtimePlayerGamemode').value
  const player = byId('runtimePlayerName').value.trim() || byId('minecraftPlayerName').value.trim()
  const commands = []
  if (difficulty) commands.push(`difficulty ${difficulty}`)
  if (defaultGamemode) commands.push(`defaultgamemode ${defaultGamemode}`)
  if (playerGamemode && player) commands.push(`gamemode ${playerGamemode} ${player}`)
  if (playerGamemode && !player) {
    showToast('指定玩家模式需要填写玩家名')
    return
  }
  if (commands.length === 0) {
    showToast('请选择要应用的在线设置')
    return
  }
  try {
    state.busy = true
    for (const command of commands) {
      await apiPost('/api/minecraft/command', { command })
    }
    if (difficulty) byId('prop-difficulty').value = difficulty
    if (defaultGamemode) byId('prop-gamemode').value = defaultGamemode
    showToast(`已应用：${commands.join('；')}`)
    await refreshMinecraftLog()
    await refreshAll()
  } catch (error) {
    showToast(error.message)
  } finally {
    state.busy = false
  }
}


async function saveServerProperties() {
  try {
    state.busy = true
    const properties = collectServerProperties()
    const data = await apiPost('/api/server-properties', { properties })
    renderServerProperties(data)
    const backup = data.backupPath ? ` 备份文件: ${data.backupPath}` : ''
    showToast(`server.properties 已保存。${backup}`)
    await refreshAll()
  } catch (error) {
    showToast(error.message)
  } finally {
    state.busy = false
  }
}

function renderServerProperties(data) {
  const values = data.values || {}
  elements.serverPropertiesHint.textContent = data.exists
    ? `${data.path}。保存前会自动备份；大多数服务器配置需要重启 Minecraft Server 才会完全生效。`
    : data.path
      ? `没有找到 server.properties：${data.path}`
      : '先在“设置”里填写服务器目录并保存，然后读取 server.properties。'

  for (const input of document.querySelectorAll('[data-prop]')) {
    const key = input.dataset.prop
    const value = values[key]
    if (input.type === 'checkbox') {
      input.checked = value === 'true'
    } else if (value !== undefined) {
      input.value = value
    } else {
      input.value = ''
    }
  }

  if (values.difficulty && byId('runtimeDifficulty')) byId('runtimeDifficulty').value = values.difficulty
  if (values.gamemode && byId('runtimeDefaultGamemode')) byId('runtimeDefaultGamemode').value = values.gamemode
}

function collectServerProperties() {
  const properties = {}
  for (const input of document.querySelectorAll('[data-prop]')) {
    const key = input.dataset.prop
    properties[key] = input.type === 'checkbox' ? String(input.checked) : input.value
  }
  return properties
}

async function postAction(path, message) {
  try {
    state.busy = true
    await apiPost(path, {})
    showToast(message)
    await refreshAll()
  } catch (error) {
    showToast(error.message)
  } finally {
    state.busy = false
  }
}

async function apiGet(path) {
  const response = await fetch(path)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}

async function apiPost(path, payload) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}

function showToast(message) {
  elements.toast.textContent = message
  elements.toast.hidden = false
  clearTimeout(showToast.timer)
  showToast.timer = setTimeout(() => {
    elements.toast.hidden = true
  }, 3200)
}

function byId(id) {
  return document.getElementById(id)
}

function modeLabel(value) {
  return value === 'survival' ? '生存助手' : '创造练习'
}

function num(value) {
  return Number(value).toFixed(1)
}

function isLocalUrl(value) {
  try {
    const url = new URL(value)
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  } catch {
    return false
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]))
}
