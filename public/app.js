'use strict'

const state = {
  status: null,
  config: null,
  busy: false
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
  logsView: byId('logsView'),
  memoryView: byId('memoryView'),
  llmHint: byId('llmHint'),
  minecraftManagerHint: byId('minecraftManagerHint'),
  minecraftLogView: byId('minecraftLogView'),
  mindcraftConfigHint: byId('mindcraftConfigHint'),
  mindcraftProfileHint: byId('mindcraftProfileHint'),
  mindcraftProfileSelect: byId('mindcraftProfileSelect'),
  mindcraftProfileJson: byId('mindcraftProfileJson'),
  serverPropertiesHint: byId('serverPropertiesHint'),
  toast: byId('toast'),
  autopilotBtn: byId('autopilotBtn')
}

const configInputs = [
  'minecraftHost',
  'minecraftPort',
  'minecraftServerDir',
  'mindcraftUrl',
  'mindcraftDir',
  'agentFilter',
  'assistantMode',
  'intervalMs',
  'idleCooldownMs',
  'minTaskRuntimeMs',
  'llmBaseUrl',
  'llmModel',
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
  'free-play': '你现在作为一个自主但友好的玩家行动。不要一直贴身跟随真人玩家；根据世界状态选择有价值的小目标，例如补光、收集基础资源、巡逻、改善基地或探索附近。遇到玩家求助时优先响应。'
}

document.addEventListener('DOMContentLoaded', () => {
  byId('refreshBtn').addEventListener('click', refreshAll)
  byId('startExperienceBtn').addEventListener('click', startExperience)
  byId('heroStartExperienceBtn').addEventListener('click', startExperience)
  byId('firstNightBtn').addEventListener('click', () => sendPresetTask('first-night'))
  byId('freePlayBtn').addEventListener('click', () => sendPresetTask('free-play'))
  document.querySelectorAll('[data-preset-task]').forEach(button => button.addEventListener('click', () => sendPresetTask(button.dataset.presetTask)))
  byId('refreshBtn').addEventListener('click', refreshAll)
  byId('startMinecraftBtn').addEventListener('click', () => postAction('/api/minecraft/start', '已请求启动 Minecraft 服务器'))
  byId('stopMinecraftBtn').addEventListener('click', () => postAction('/api/minecraft/stop', '已请求停止 Minecraft 服务器'))
  byId('restartMinecraftBtn').addEventListener('click', () => postAction('/api/minecraft/restart', '已请求重启 Minecraft 服务器'))
  byId('refreshMinecraftLogBtn').addEventListener('click', refreshMinecraftLog)
  byId('minecraftCommandForm').addEventListener('submit', sendMinecraftCommand)
  document.querySelectorAll('[data-minecraft-command]').forEach(button => button.addEventListener('click', runMinecraftQuickCommand))
  byId('startMindcraftBtn').addEventListener('click', () => postAction('/api/mindcraft/start', '已请求启动 Mindcraft'))
  byId('stopMindcraftBtn').addEventListener('click', () => postAction('/api/mindcraft/stop-owned', '已请求停止本页面启动的 Mindcraft'))
  byId('loadMindcraftConfigBtn').addEventListener('click', () => loadMindcraftConfig())
  byId('saveMindcraftConfigBtn').addEventListener('click', saveMindcraftConfig)
  byId('loadMindcraftProfileBtn').addEventListener('click', () => loadMindcraftConfig(elements.mindcraftProfileSelect.value))
  byId('saveMindcraftProfileBtn').addEventListener('click', saveMindcraftProfile)
  byId('mindcraftProfileSelect').addEventListener('change', () => loadMindcraftConfig(elements.mindcraftProfileSelect.value))
  byId('autopilotBtn').addEventListener('click', toggleAutopilot)
  byId('saveConfigBtn').addEventListener('click', saveConfig)
  byId('refreshLogsBtn').addEventListener('click', refreshLogs)
  byId('loadServerPropertiesBtn').addEventListener('click', loadServerProperties)
  byId('saveServerPropertiesBtn').addEventListener('click', saveServerProperties)
  byId('loadMemoryBtn').addEventListener('click', loadMemory)
  byId('taskForm').addEventListener('submit', sendTask)
  refreshAll()
  loadMindcraftConfig()
  setInterval(refreshAll, 5000)
})

async function refreshAll() {
  if (state.busy) return
  try {
    const [status, logs, minecraftLog] = await Promise.all([
      apiGet('/api/status'),
      apiGet('/api/logs'),
      apiGet('/api/minecraft/logs')
    ])
    state.status = status
    state.config = status.config
    renderStatus(status)
    renderProductHome(status)
    renderConfig(status.config)
    renderMinecraftManager(status, minecraftLog)
    renderLogs(logs.logs || [])
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

  renderAgents(status)
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

function renderAgents(status) {
  const agents = status.socket.agents || []
  const states = status.socket.states || {}
  if (agents.length === 0) {
    elements.agentsList.innerHTML = '<div class="agent-row"><span class="agent-meta">Mindcraft 暂时还没有上报 AI 玩家。</span></div>'
    return
  }

  elements.agentsList.innerHTML = agents.map(agent => {
    const agentState = states[agent.name] || {}
    const pos = agentState.position
      ? `${num(agentState.position.x)}, ${num(agentState.position.y)}, ${num(agentState.position.z)}`
      : '位置未知'
    const online = agent.in_game ? '在线' : '离线'
    const action = agentState.action || '暂无动作'
    const idle = agentState.isIdle ? '（空闲）' : ''
    return [
      '<div class="agent-row">',
      `<div><div class="agent-name">${escapeHtml(agent.name)}</div><div class="agent-meta">${online}</div></div>`,
      `<div class="agent-meta">${escapeHtml(agentState.gamemode || '未知模式')} | ${escapeHtml(agentState.biome || '未知生物群系')} | ${escapeHtml(pos)}</div>`,
      `<div class="agent-action">${escapeHtml(action)} ${idle}</div>`,
      '</div>'
    ].join('')
  }).join('')
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
  const localLlm = isLocalUrl(config.llmBaseUrl)
  const modeText = config.assistantMode === 'survival'
    ? '当前是生存助手模式：会优先考虑安全、食物、庇护所、照明、工具和短距离目标。'
    : '当前是创造练习模式：会优先建造和改善基地，并避免合成物品。'
  const llmText = config.llmApiKeyFromEnv
    ? '已检测到环境变量里的模型密钥，页面不会显示密钥内容。'
    : localLlm
      ? '已检测到本地模型接口，Ollama 这类 localhost 服务不需要 API key。'
      : '没有检测到模型密钥；自动陪玩会使用保守的备用任务轮换。'
  elements.llmHint.textContent = `${modeText} ${llmText}`
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
  elements.minecraftManagerHint.textContent = managed
    ? `服务端由本页面托管，PID ${minecraft.ownedPid}，可以发送控制台命令。${commandText}`
    : minecraft.tcpOpen
      ? `服务端在线，但它是外部进程，PID ${pids}。页面现在只检测状态和读取日志；要发送控制台命令，需要先在原控制台 stop，然后从本页面启动。`
      : '服务端离线。点击顶部“启动服务器”会从 start.bat/start.sh 推断 Java 参数，并直接管理 server.jar。'

  byId('stopMinecraftBtn').disabled = !managed
  byId('restartMinecraftBtn').disabled = minecraft.tcpOpen && !managed
  byId('minecraftCommand').disabled = !canCommand
  byId('minecraftCommandForm').querySelector('button[type="submit"]').disabled = !canCommand
  document.querySelectorAll('[data-minecraft-command]').forEach(button => { button.disabled = !canCommand })
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
    elements.homeSummary.textContent = 'Mindcraft 已在线，正在启动自动陪玩。'
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

async function sendPresetTask(key) {
  const task = presetTasks[key] || ''
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