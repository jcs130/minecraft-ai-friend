'use strict'

const CONTROL_URL = trimSlash(process.env.AI_FRIEND_CONTROL_URL || 'http://127.0.0.1:4177')
const VISUALIZER_URL = trimSlash(process.env.MINECRAFT_VISUALIZER_URL || 'http://127.0.0.1:3010')
const INTERVAL_MS = clampNumber(process.env.VISUALIZER_BRIDGE_INTERVAL_MS || 2000, 500, 60000, 2000)
const RESOURCE_REFRESH_MS = clampNumber(process.env.VISUALIZER_RESOURCE_REFRESH_MS || 60000, 10000, 300000, 60000)

const COLORS = {
  Alex: '#60a5fa',
  Luna: '#c084fc',
  Milo: '#d2a24c',
  Nova: '#43b0ff',
  Ivy: '#69c46d'
}

const TASK_LABELS = {
  'storage-hub': '整理公共仓库',
  'safe-lighting': '基地照明与安全',
  'starter-farm': '建设稳定农场',
  'starter-mine': '维护安全矿点',
  'village-paths': '修建村庄道路',
  'resident-houses': '建设居民小屋',
  mine: '采矿补给',
  farm: '农田和食物',
  build_shelter: '建造和修缮',
  explore: '短距离侦察',
  guard: '安全巡逻',
  chat: '居民协作沟通',
  deposit: '存放和整理物资',
  idle: '等待新任务'
}

const ITEM_LABELS = {
  cobblestone: '圆石',
  stone: '石头',
  dirt: '泥土',
  grass_block: '草方块',
  sand: '沙子',
  gravel: '砂砾',
  granite: '花岗岩',
  diorite: '闪长岩',
  andesite: '安山岩',
  torch: '火把',
  coal: '煤炭',
  charcoal: '木炭',
  raw_iron: '粗铁',
  iron_ingot: '铁锭',
  iron_ore: '铁矿石',
  raw_copper: '粗铜',
  copper_ore: '铜矿石',
  oak_log: '橡木原木',
  oak_wood: '橡木',
  oak_planks: '橡木木板',
  oak_sapling: '橡树树苗',
  oak_door: '橡木门',
  oak_fence: '橡木栅栏',
  oak_stairs: '橡木楼梯',
  oak_slab: '橡木台阶',
  stick: '木棍',
  chest: '箱子',
  crafting_table: '工作台',
  furnace: '熔炉',
  wooden_pickaxe: '木镐',
  wooden_axe: '木斧',
  wooden_shovel: '木锹',
  wooden_hoe: '木锄',
  stone_pickaxe: '石镐',
  stone_axe: '石斧',
  stone_shovel: '石锹',
  stone_hoe: '石锄',
  iron_pickaxe: '铁镐',
  iron_axe: '铁斧',
  glass: '玻璃',
  wheat_seeds: '小麦种子',
  wheat: '小麦',
  hay_block: '干草块',
  apple: '苹果',
  bread: '面包',
  porkchop: '生猪排',
  cooked_porkchop: '熟猪排',
  beef: '生牛肉',
  cooked_beef: '牛排',
  chicken: '生鸡肉',
  cooked_chicken: '熟鸡肉',
  mutton: '生羊肉',
  cooked_mutton: '熟羊肉',
  salmon: '鲑鱼',
  cooked_salmon: '熟鲑鱼',
  cod: '鳕鱼',
  cooked_cod: '熟鳕鱼',
  potato: '马铃薯',
  baked_potato: '烤马铃薯',
  carrot: '胡萝卜',
  leather: '皮革',
  wool: '羊毛',
  white_wool: '白色羊毛',
  bone: '骨头',
  bone_meal: '骨粉',
  arrow: '箭',
  string: '线'
}

const KIND_LABELS = {
  working: '进行中',
  active: '执行中',
  risk: '风险',
  blocked: '受阻',
  done: '完成',
  idle: '空闲',
  info: '信息',
  status: '状态',
  thought: '思考',
  memory: '记忆',
  need_help: '需要帮助',
  system: '系统'
}

let resourceDashboardCache = null
let resourceDashboardCacheAt = 0

const EVENT_TYPE_LABELS = {
  'status:update': '状态更新',
  'task:active': '任务执行中',
  'task:working': '任务进行中',
  'task:done': '任务完成',
  'task:blocked': '任务受阻',
  'task:info': '任务记录',
  'infra:started': '设施开工',
  'infra:done': '设施完成',
  'infra:blocked': '设施受阻',
  'infra:planned': '设施计划'
}
main().catch(error => {
  console.error(`[visualizer-bridge] failed: ${error.stack || error.message}`)
  process.exitCode = 1
})

async function main() {
  console.log(`[visualizer-bridge] control=${CONTROL_URL} visualizer=${VISUALIZER_URL} interval=${INTERVAL_MS}ms`)
  await pushOnce()
  setInterval(() => {
    pushOnce().catch(error => console.warn(`[visualizer-bridge] ${error.message}`))
  }, INTERVAL_MS)
}

async function pushOnce() {
  const shouldRefreshResources = !resourceDashboardCache || Date.now() - resourceDashboardCacheAt >= RESOURCE_REFRESH_MS
  const [context, status, serverProperties, dashboard, liveIntel] = await Promise.all([
    fetchJson(`${CONTROL_URL}/api/commander/context?limit=20`),
    fetchJson(`${CONTROL_URL}/api/status`).catch(error => ({ bridgeStatusError: error.message })),
    fetchJson(`${CONTROL_URL}/api/server-properties`).catch(error => ({ bridgePropertiesError: error.message, values: {} })),
    shouldRefreshResources
      ? fetchJson(`${CONTROL_URL}/api/village/dashboard?refresh=1`).catch(error => ({ bridgeDashboardError: error.message }))
      : Promise.resolve(resourceDashboardCache),
    fetchJson(`${CONTROL_URL}/api/livestream/intel?limit=12`).catch(error => ({ bridgeLiveIntelError: error.message }))
  ])
  if (shouldRefreshResources && dashboard && !dashboard.bridgeDashboardError && !dashboard.error) {
    resourceDashboardCache = dashboard
    resourceDashboardCacheAt = Date.now()
  }
  const payload = mapContextToVisualizer(context, status, serverProperties, resourceDashboardCache || dashboard, liveIntel)
  const result = await postJson(`${VISUALIZER_URL}/api/status`, payload)
  const names = payload.agents.map(agent => `${agent.name}:${agent.status}`).join(', ')
  const target = payload.livestream && payload.livestream.currentTarget ? payload.livestream.currentTarget : '等待'
  const resourceStamp = resourceDashboardCacheAt ? new Date(resourceDashboardCacheAt).toLocaleTimeString() : '未刷新'
  console.log(`[visualizer-bridge] pushed ${payload.agents.length} agents (${names}) target=${target} resources=${resourceStamp} ok=${Boolean(result.ok)}`)
}

function mapContextToVisualizer(context, status = {}, serverProperties = {}, dashboard = null, liveIntel = null) {
  context = mergeDashboardContext(context, dashboard)
  const livestream = mapLivestream(status)
  const agents = (context.agents || []).map(mapAgent).map(agent => ({
    ...agent,
    observed: Boolean(livestream.currentTarget && agent.name === livestream.currentTarget),
    cameraLabel: livestream.currentTarget && agent.name === livestream.currentTarget ? '直播镜头' : ''
  }))
  return {
    agents,
    sharedResources: sharedResources(context, agents, dashboard),
    bulletins: [...macroBulletins(context, status, liveIntel), ...bulletins(context)],
    events: [...macroEvents(context, status), ...events(context)],
    livestream,
    world: mapWorld(context, status, serverProperties, liveIntel),
    village: mapVillage(context),
    models: mapModels(status)
  }
}

function mergeDashboardContext(context = {}, dashboard = null) {
  if (!dashboard || dashboard.bridgeDashboardError || dashboard.error) return context || {}
  const village = { ...((context && context.village) || {}) }
  if (Array.isArray(dashboard.resources)) village.resources = dashboard.resources
  if (Array.isArray(dashboard.projects)) village.projects = dashboard.projects
  if (Array.isArray(dashboard.scoreboard)) village.scoreboard = dashboard.scoreboard
  if (dashboard.settlement) village.settlement = dashboard.settlement
  if (Array.isArray(dashboard.chests)) {
    village.chestInventory = aggregateChestInventory(dashboard.chests)
    village.chestInventoryUpdatedAt = dashboard.generatedAt || new Date().toISOString()
  }
  return {
    ...(context || {}),
    generatedAt: dashboard.generatedAt || (context && context.generatedAt) || new Date().toISOString(),
    village
  }
}
function aggregateChestInventory(chests) {
  const totals = new Map()
  for (const chest of chests || []) {
    if (!chest || !chest.ok || !Array.isArray(chest.items)) continue
    for (const item of chest.items) {
      const id = String(item.id || '').trim()
      if (!id) continue
      const count = Number(item.count || 0)
      if (!Number.isFinite(count) || count <= 0) continue
      totals.set(id, Number(totals.get(id) || 0) + count)
    }
  }
  return Array.from(totals.entries())
    .map(([id, count]) => ({ id, name: readableItemName(id), count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 24)
}

function commanderDirectiveFromLiveIntel(liveIntel) {
  if (!liveIntel || liveIntel.bridgeLiveIntelError) return ''
  const decisions = liveIntel.commander && Array.isArray(liveIntel.commander.decisions) ? liveIntel.commander.decisions : []
  const freshCommander = decisions.find(decision => isCommanderDecision(decision) && decisionAgeMs(decision) <= 180000)
  const decision = freshCommander || decisions[0]
  if (!decision) return ''
  const source = decision.source || 'AI村长'
  const agent = decision.agent ? `给 ${decision.agent}` : ''
  const title = decision.title ? `${decision.title}：` : ''
  const text = commanderDecisionText(decision.text || decision.task || decision.message || '')
  if (!text) return ''
  const at = decision.at ? `${formatShortTime(decision.at)} ` : ''
  return `${at}${source}${agent ? ' ' + agent : ''}｜${title}${text}`
}

function isCommanderDecision(decision) {
  const text = `${decision && decision.source || ''} ${decision && decision.title || ''}`
  return /AI村长|守卫|调度|兜底|commander|guardrail|water|teleport|fallback/i.test(text)
}
function decisionAgeMs(decision) {
  const at = Date.parse(decision && decision.at || '')
  return Number.isFinite(at) ? Date.now() - at : Number.POSITIVE_INFINITY
}

function formatShortTime(value) {
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function commanderDecisionText(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const action = summarizeMindcraftCommand(raw)
  if (action) return action
  return cleanThought(raw, '').slice(0, 220)
}

function summarizeMindcraftCommand(raw) {
  let match = raw.match(/!goToCoordinates\(([^)]*)\)/i)
  if (match) return `前往坐标 ${match[1].replace(/\s+/g, '')}`
  match = raw.match(/!collectBlocks\(["']([^"']+)["']\s*,\s*(\d+)/i)
  if (match) return `采集 ${readableItemName(match[1])} ×${match[2]}`
  match = raw.match(/!placeHere\(["']([^"']+)["']\)/i)
  if (match) return `在当前位置放置 ${readableItemName(match[1])}`
  match = raw.match(/!\w+\(([^)]*)\)/)
  if (match) return `执行动作：${raw.slice(0, 80)}`
  return ''
}
function mapModels(status = {}) {
  const models = status.models || {}
  return {
    commander: slimModel(models.commander),
    residents: slimModel(models.residents),
    vision: slimModel(models.vision),
    memory: models.memory || {},
    profiles: Array.isArray(models.profiles) ? models.profiles.map(profile => ({
      name: profile.name || '',
      active: Boolean(profile.active),
      model: slimModel(profile.model),
      codeModel: slimModel(profile.codeModel),
      visionModel: slimModel(profile.visionModel)
    })).slice(0, 12) : []
  }
}

function slimModel(model = {}) {
  if (!model || typeof model !== 'object') return {}
  return {
    role: model.role || '',
    provider: model.provider || '',
    providerLabel: model.providerLabel || model.api || model.provider || '',
    api: model.api || '',
    model: model.model || '',
    codeModel: model.codeModel || '',
    baseUrl: model.baseUrl || '',
    enabled: Boolean(model.enabled),
    authReady: model.authReady !== false,
    keyDetected: Boolean(model.keyDetected),
    mixed: Boolean(model.mixed),
    source: model.source || '',
    profileCount: Number(model.profileCount || 0),
    activeProfileCount: Number(model.activeProfileCount || 0)
  }
}
function mapLivestream(status = {}) {
  const livestream = status.livestream || {}
  return {
    active: Boolean(livestream.active),
    observer: livestream.observer || 'live',
    currentTarget: livestream.currentTarget || '',
    switchIntervalMs: Number(livestream.switchIntervalMs || 30000),
    lastSwitchedAt: livestream.lastSwitchedAt || '',
    lastError: livestream.lastError || '',
    candidates: Array.isArray(livestream.candidates) ? livestream.candidates : []
  }
}
function mapWorld(context = {}, status = {}, serverProperties = {}, liveIntel = null) {
  const values = serverProperties.values || {}
  const minecraft = status.minecraft || {}
  const mindcraft = status.mindcraft || {}
  const autopilot = status.autopilot || context.autopilot || {}
  return {
    serverOnline: Boolean(minecraft.tcpOpen),
    mindcraftOnline: Boolean(mindcraft.httpOk),
    autopilotActive: Boolean(autopilot.active),
    assistantMode: autopilot.assistantMode || 'survival',
    gamemode: values.gamemode || '',
    difficulty: values.difficulty || '',
    hardcore: values.hardcore === 'true' || values.hardcore === true,
    pvp: values.pvp === 'true' || values.pvp === true,
    onlineMode: values['online-mode'] === 'true' || values['online-mode'] === true,
    maxPlayers: Number(values['max-players'] || 0) || null,
    viewDistance: Number(values['view-distance'] || 0) || null,
    simulationDistance: Number(values['simulation-distance'] || 0) || null,
    motd: values.motd || '',
    lastTickAt: autopilot.lastTickAt || '',
    lastError: autopilot.lastError || '',
    worldDirective: autopilot.worldDirective || '',
    commanderDirective: commanderDirectiveFromLiveIntel(liveIntel),
    commanderDirectiveAt: liveIntel && liveIntel.generatedAt || ''
  }
}

function mapVillage(context = {}) {
  const village = context.village || {}
  const projects = Array.isArray(village.projects) ? village.projects : []
  const infrastructures = Array.isArray(village.infrastructures) ? village.infrastructures : []
  const resources = Array.isArray(village.resources) ? village.resources : []
  const chestInventory = Array.isArray(village.chestInventory) ? village.chestInventory : []
  const scoreboard = Array.isArray(village.scoreboard) ? village.scoreboard : []
  return {
    commander: village.commander || {},
    settlement: village.settlement || {},
    onlineAgents: Array.isArray(context.onlineAgents) ? context.onlineAgents : [],
    resources: resources.map(resource => ({
      id: resource.id || '',
      name: resource.name || resource.id || '',
      current: Number(resource.current || 0),
      target: Number(resource.target || 0),
      chest: Number(resource.chest || 0),
      carried: Number(resource.carried || 0),
      trackedCurrent: Number(resource.trackedCurrent || 0),
      percent: Number(resource.percent || 0),
      status: resource.status || '',
      unit: resource.unit || ''
    })),
    chestInventory: chestInventory.map(item => ({
      id: item.id || '',
      name: item.name || item.id || '',
      count: Number(item.count || 0)
    })),
    chestInventoryUpdatedAt: village.chestInventoryUpdatedAt || '',
    scoreboard: scoreboard.map(row => ({
      agent: row.agent || '',
      online: Boolean(row.online),
      score: Number(row.score || 0),
      deaths: Number(row.deaths || 0),
      monsterKills: Number(row.monsterKills || 0),
      mobKills: Number(row.mobKills || row.kills || 0),
      playerKills: Number(row.playerKills || 0),
      kills: Number(row.kills || 0),
      animalKills: Number(row.animalKills || 0),
      damageDealt: Number(row.damageDealt || 0),
      distanceKm: Number(row.distanceKm || 0),
      action: row.action || '',
      position: row.position || null
    })).slice(0, 8),
    projects: projects.map(project => ({
      id: project.id || '',
      title: project.title || project.id || '',
      status: project.status || '',
      priority: project.priority || '',
      goal: project.goal || '',
      progress: projectProgress(project),
      checklist: Array.isArray(project.checklist) ? project.checklist : []
    })),
    infrastructureCount: infrastructures.length,
    activeInfrastructureCount: infrastructures.filter(item => /active|started|planned/i.test(item.status || '')).length
  }
}

function macroBulletins(context, status = {}, liveIntel = null) {
  const village = context.village || {}
  const settlement = village.settlement || {}
  const base = settlement.base || {}
  const chest = settlement.publicChest || {}
  const commander = village.commander || {}
  const livestream = status.livestream || {}
  const generatedAt = context.generatedAt || new Date().toISOString()
  const directive = commanderDirectiveFromLiveIntel(liveIntel) || (context.autopilot && context.autopilot.worldDirective ? context.autopilot.worldDirective : settlement.policy || '')
  const projects = Array.isArray(village.projects) ? village.projects : []
  const activeProjects = projects
    .filter(project => /active|planned|started/i.test(project.status || ''))
    .slice(0, 4)
    .map(project => `${project.priority || 'P?'} ${project.title || project.id}：${projectProgress(project)}`)
    .join('；')

  return [
    {
      id: 'macro-commander-directive',
      time: generatedAt,
      kind: '村长指令',
      agentId: commander.name || 'Airi',
      agentName: commander.title || 'AI村长',
      title: commanderDirectiveFromLiveIntel(liveIntel) ? '村长最新调度' : '村长宏观指令',
      color: '#f59e0b',
      message: truncate(cleanThought(directive, '围绕基地建设安全、食物、照明、仓储、道路、农田和住宅。'), 220)
    },
    {
      id: 'macro-settlement-location',
      time: generatedAt,
      kind: '基地信息',
      agentId: 'village',
      agentName: settlement.name || 'AI Friend Village',
      title: '基地与公共箱子',
      color: '#22c55e',
      message: `基地 X=${base.x ?? '?'}, Y=${base.y ?? '?'}, Z=${base.z ?? '?'}；公共箱子 X=${chest.x ?? '?'}, Y=${chest.y ?? '?'}, Z=${chest.z ?? '?'}；活动半径 ${settlement.radius || '?'} 格。`
    },
    {
      id: 'macro-live-observer',
      time: livestream.lastSwitchedAt || generatedAt,
      kind: '直播镜头',
      agentId: livestream.observer || 'live',
      agentName: livestream.observer || 'live',
      title: '直播观察者',
      color: '#38bdf8',
      message: livestream.active
        ? `自动轮换已开启，每 ${Math.round(Number(livestream.switchIntervalMs || 0) / 1000) || '?'} 秒切换；当前目标：${livestream.currentTarget || '等待 live 进服'}。`
        : `自动轮换已关闭；当前目标：${livestream.currentTarget || '无'}。`
    },
    {
      id: 'macro-active-projects',
      time: generatedAt,
      kind: '村庄项目',
      agentId: 'village',
      agentName: '村庄计划',
      title: '当前公共项目',
      color: '#a78bfa',
      message: activeProjects || '暂无 active/planned 项目。'
    }
  ]
}

function macroEvents(context, status = {}) {
  const village = context.village || {}
  const resources = Array.isArray(village.resources) ? village.resources : []
  const infrastructures = Array.isArray(village.infrastructures) ? village.infrastructures : []
  const generatedAt = context.generatedAt || new Date().toISOString()
  const online = Array.isArray(context.onlineAgents) ? context.onlineAgents : []
  const livestream = status.livestream || {}
  return [
    {
      id: 'macro-online-agents',
      time: generatedAt,
      type: '居民在线',
      message: `在线居民：${online.join('、') || '暂无'}。自动驾驶：${context.autopilot && context.autopilot.active ? '运行中' : '已停止'}。`,
      detail: { onlineAgents: online, autopilot: context.autopilot || {} }
    },
    {
      id: 'macro-resource-progress',
      time: generatedAt,
      type: '资源目标',
      message: resources.slice(0, 8).map(resource => `${resource.name || resource.id} ${resource.current || 0}/${resource.target || '?'}`).join('；') || '暂无资源目标。',
      detail: resources
    },
    {
      id: 'macro-infrastructure-progress',
      time: generatedAt,
      type: '公共设施',
      message: `已记录公共设施 ${infrastructures.length} 项；进行中 ${infrastructures.filter(item => /active|started|planned/i.test(item.status || '')).length} 项。`,
      detail: infrastructures.slice(0, 12)
    },
    {
      id: 'macro-livestream-state',
      time: livestream.lastSwitchedAt || generatedAt,
      type: '镜头调度',
      message: livestream.lastError ? `镜头切换异常：${livestream.lastError}` : `镜头自动调度正常，当前目标：${livestream.currentTarget || '等待中'}。`,
      detail: livestream
    }
  ]
}

function projectProgress(project) {
  const checklist = Array.isArray(project.checklist) ? project.checklist : []
  if (checklist.length === 0) return project.status || '未开始'
  const done = checklist.filter(item => item.done).length
  return `${done}/${checklist.length}`
}

function truncate(value, maxLength) {
  const text = String(value || '')
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}
function mapAgent(agentContext) {
  const role = agentContext.assignment && agentContext.assignment.role ? agentContext.assignment.role : {}
  const project = agentContext.assignment && agentContext.assignment.project ? agentContext.assignment.project : {}
  const state = agentContext.currentState || {}
  const memory = agentContext.memory || {}
  const statusReport = latest((agentContext.stored && agentContext.stored.statusReports) || []) || latest(memory.statusReports || []) || {}
  const title = role.role || role.roleId || '居民'
  const rawTask = statusReport.task || project.id || normalizeAction(state.currentAction || state.action || 'idle')
  const currentTask = readableTask(rawTask)
  const fallbackThought = `公开思考待上报。当前计划：${currentTask}。下一步会根据库存、坐标和安全情况继续执行。`
  const thought = publicThought(memory.recentOutputs) || cleanThought(statusReport.summary || memory.lastStatusSummary || project.goal || state.currentAction || memory.lastTaskSummary, fallbackThought)

  return {
    id: agentContext.agent,
    name: agentContext.agent,
    title,
    color: COLORS[agentContext.agent] || '#9ca3af',
    objective: project.goal || role.focus || '',
    status: agentContext.online ? 'online' : 'offline',
    health: numberOrNull(state.health),
    food: numberOrNull(state.hunger),
    position: state.position || null,
    dimension: state.dimension || 'overworld',
    currentTask,
    thought,
    inventory: translateInventory((state.inventory && state.inventory.counts) || {}),
    memory: {
      observationsCount: ((agentContext.stored && agentContext.stored.observations) || []).length,
      notesCount: ((agentContext.stored && agentContext.stored.longTermMemories) || []).length,
      openNeeds: memory.openNeeds || []
    },
    lastAction: state.currentAction || state.action || ''
  }
}

function readableTask(value) {
  const raw = String(value || 'idle').trim()
  if (TASK_LABELS[raw]) return TASK_LABELS[raw]
  const normalized = normalizeAction(raw)
  if (TASK_LABELS[normalized]) return TASK_LABELS[normalized]
  return cleanThought(raw, '村庄任务')
}

function publicThought(outputs) {
  const items = Array.isArray(outputs) ? outputs.slice().reverse() : []
  for (const item of items) {
    const text = typeof item === 'string' ? item : item && item.text
    if (!text) continue
    if (/思考[:：]|Thought[:：]|Think[:：]|HAVE|NEED|DOING|DONE|BLOCKED|已有|需要|完成|受阻|正在做/.test(text)) {
      return cleanThought(text, '')
    }
  }
  return ''
}

function cleanThought(value, fallback) {
  const cleaned = String(value || '')
    .replace(/Autonomous\s+(creative-practice|survival)\s+task:\s*/gi, '')
    .replace(/\(To\s+([^\)]+)\)/gi, '（对$1）')
    .replace(/VILLAGE_REPORT\s+\{.*?(?=\s*!|$)/gi, '')
    .replace(/![a-zA-Z_]\w*\([^)]*\)/g, '')
    .replace(/![a-zA-Z_]\w*\([^。！？；\n]*/g, '')
    .replace(/\.\s*[A-Z][A-Za-z0-9 ,.'"_=:/()-]{20,}/g, '')
    .replace(/\s+[A-Za-z][A-Za-z0-9 ,.'"_=:/()-]{24,}(?=$|[。！？；，])/g, '')
    .replace(/Thought\s*[:：]\s*/gi, '思考：')
    .replace(/Think\s*[:：]\s*/gi, '思考：')
    .replace(/想法\s*[:：]\s*/g, '思考：')
    .replace(/公开反思/g, '公开思考')
    .replace(/\black of wool\b/gi, '缺少羊毛')
    .replace(/\bChecking the next level\.{0,3}/gi, '继续检查下一层。')
    .replace(/\btorches\b/gi, '火把')
    .replace(/\bmain road\b/gi, '主路')
    .replace(/\bHAVE\s*[:：]\s*/gi, '已有：')
    .replace(/\bNEED\s*[:：]\s*/gi, '需要：')
    .replace(/\bDOING\s*[:：]\s*/gi, '正在做：')
    .replace(/\bDONE\s*[:：]\s*/gi, '完成：')
    .replace(/\bBLOCKED\s*[:：]\s*/gi, '受阻：')
    .replace(/\bHAVE\s*[\\(（]/gi, '已有（')
    .replace(/\bNEED\s*[\\(（]/gi, '需要（')
    .replace(/\bDOING\s*[\\(（]/gi, '正在做（')
    .replace(/\bDONE\s*[\\(（]/gi, '完成（')
    .replace(/\bBLOCKED\s*[\\(（]/gi, '受阻（')
    .replace(/Survival\s+mode:\s*/gi, '生存模式：')
    .replace(/Creative\s+mode:\s*/gi, '创造模式：')
    .replace(/Long-term\s+world\s+directive:\s*/gi, '长期目标：')
    .replace(/Village\s+plan:\s*/gi, '村庄计划：')
    .replace(/Current\s+assignment\s+for\s+/gi, '当前分工：')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return fallback || ''
  if (/(管理员指令|系统提示|系统指令|提示说|模型规则|内部推理|思想块|这是一个矛盾|不要在聊天中使用英文)/.test(cleaned)) {
    return fallback || '公开思考：我会继续当前任务，并只用中文汇报计划、原因、下一步和材料缺口。'
  }
  if (!/[\u4e00-\u9fff]/.test(cleaned) && cleaned.length > 40) return fallback || '等待中文公开思考。'
  return cleaned
}
function sharedResources(context, agents, dashboard = null) {
  const ledger = {}
  for (const agent of agents) {
    for (const [name, count] of Object.entries(agent.inventory || {})) {
      ledger[name] = (ledger[name] || 0) + Number(count || 0)
    }
  }
  if (Object.keys(ledger).length > 0) return sortObjectByValue(ledger)

  const resources = dashboard && Array.isArray(dashboard.resources)
    ? dashboard.resources
    : context.village && Array.isArray(context.village.resources) ? context.village.resources : []
  for (const resource of resources) {
    ledger[readableItemName(resource.name || resource.id)] = Number(resource.current || 0)
  }
  return sortObjectByValue(ledger)
}

function bulletins(context) {
  const reports = (context.recent && context.recent.agentStatusReports) || []
  const notes = (context.recent && context.recent.agentMemories) || []
  return [...reports.slice(0, 20).map(report => ({
    id: report.id,
    time: report.at,
    kind: statusLabel(report.status || 'status'),
    agentId: report.agent,
    agentName: report.agent,
    title: statusLabel(report.status || 'status'),
    color: COLORS[report.agent] || '#9ca3af',
    message: cleanThought(report.summary || report.task || report.detail || '状态更新', '状态更新')
  })), ...notes.slice(0, 12).map(note => ({
    id: note.id,
    time: note.at,
    kind: statusLabel(note.kind || 'memory'),
    agentId: note.agent,
    agentName: note.agent,
    title: '记忆',
    color: COLORS[note.agent] || '#9ca3af',
    message: cleanThought(note.text || '', '记忆更新')
  }))]
}

function events(context) {
  const taskEvents = (context.recent && context.recent.taskEvents) || []
  const infrastructure = (context.recent && context.recent.infrastructureReports) || []
  return [...taskEvents.slice(0, 40).map(event => ({
    id: event.id,
    time: event.at,
    type: eventTypeLabel(`task:${event.status || event.type}`),
    message: cleanThought(`${event.agent || 'AI'} ${event.title || event.description || ''}`, '任务事件'),
    detail: event
  })), ...infrastructure.slice(0, 30).map(report => ({
    id: report.id,
    time: report.updatedAt || report.createdAt,
    type: eventTypeLabel(`infra:${report.status}`),
    message: cleanThought(`${report.agent || 'AI'} ${report.title || report.description || ''}`, '设施上报'),
    detail: report
  }))]
}

function translateInventory(counts) {
  const translated = {}
  for (const [name, count] of Object.entries(counts || {})) {
    const label = readableItemName(name)
    translated[label] = (translated[label] || 0) + Number(count || 0)
  }
  return translated
}

function readableItemName(value) {
  const key = String(value || '').trim().replace(/^minecraft:/, '')
  if (!key) return '未知物品'
  const lower = key.toLowerCase()
  if (ITEM_LABELS[key] || ITEM_LABELS[lower]) return ITEM_LABELS[key] || ITEM_LABELS[lower]
  if (lower.endsWith('_bed')) return '床'
  if (lower.endsWith('_wool')) return '羊毛'
  if (lower.endsWith('_log')) return '原木'
  if (lower.endsWith('_planks')) return '木板'
  return key
}

function statusLabel(value) {
  const key = String(value || '').trim()
  return KIND_LABELS[key] || KIND_LABELS[key.toLowerCase()] || key || '状态'
}

function eventTypeLabel(value) {
  const key = String(value || '').trim()
  return EVENT_TYPE_LABELS[key] || EVENT_TYPE_LABELS[key.toLowerCase()] || statusLabel(key)
}

async function fetchJson(url) {
  const response = await fetch(url)
  const text = await response.text()
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${text}`)
  return JSON.parse(text)
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`POST ${url} failed: ${response.status} ${text}`)
  return JSON.parse(text)
}

function latest(items) {
  return Array.isArray(items) && items.length > 0 ? items[0] : null
}

function normalizeAction(value) {
  const raw = String(value || 'idle').toLowerCase()
  if (/mine|矿/.test(raw)) return 'mine'
  if (/farm|农|food/.test(raw)) return 'farm'
  if (/build|house|road|建筑|建造/.test(raw)) return 'build_shelter'
  if (/explore|scout|侦察|探索/.test(raw)) return 'explore'
  if (/guard|patrol|安全|巡逻/.test(raw)) return 'guard'
  if (/chat|talk|沟通/.test(raw)) return 'chat'
  if (/deposit|storage|箱|库存/.test(raw)) return 'deposit'
  return raw || 'idle'
}

function sortObjectByValue(value) {
  return Object.fromEntries(Object.entries(value).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0)))
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.round(number)))
}

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}