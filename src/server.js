'use strict'

const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { Logger } = require('./logger')
const { MindcraftClient } = require('./mindcraft-client')
const { Autopilot } = require('./autopilot')
const { listMindcraftProcesses } = require('./processes')
const { readServerProperties, writeServerProperties } = require('./server-properties')
const { buildServerBlueprint } = require('./server-blueprint')
const { MinecraftServerManager, readLatestLog } = require('./minecraft-server')
const { VillageState } = require('./village-state')
const { DataStore } = require('./data-store')
const { McpBridge } = require('./mcp-server')
const { VectorMemory } = require('./vector-memory')
const { loadSecretEnv, secretEnvStatus } = require('./secrets')
const {
  readMindcraftConfig,
  writeMindcraftConfig,
  createMindcraftAgentProfile,
  applyMindcraftResidentGuardrails
} = require('./mindcraft-config')
const {
  listModelProviders,
  getModelProvider,
  inferModelProvider,
  getConfiguredLlmApiKey,
  getProviderEnvStatus,
  buildMindcraftEnv
} = require('./model-providers')

const ROOT = path.resolve(__dirname, '..')
const PUBLIC_DIR = path.join(ROOT, 'public')
const INTEGRATIONS_DIR = path.join(ROOT, 'integrations')
const DATA_DIR = path.join(ROOT, 'data')
const LOG_DIR = path.join(ROOT, 'logs')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
const PORT = Number(process.env.PORT || process.env.MINDCRAFT_AUTOPLAYER_PORT || 4177)
const HOST = process.env.HOST || process.env.MINDCRAFT_AUTOPLAYER_HOST || '127.0.0.1'
const DEFAULT_RESIDENT_DIRECTIVE = 'AI 是这个 Minecraft 世界的常驻居民，不是跟随宠物。当前是和平建设模式：没有怪物压力，不安排巡逻和打怪，主线是建造城镇、开采资源、公共仓储、个人住宅、家具、农田和陆地资源勘察。每个居民都要拥有自己的小屋、床和基础家具，夜晚优先回自己的床睡觉。默认五个居民：Alex 是资源总管，负责公共仓储、材料调度、住宅验收和高级任务拆解；Luna 负责建筑；Milo 负责采矿；Nova 只做陆地资源勘察和坐标记录，不修路、不下水、不靠近水域；Ivy 负责农业、食物和羊毛。侦察员和找林地任务允许在 5000 格内探索，但必须记录坐标、路线、风险和返回点；其他居民优先留在基地周边建设。 村长可以通过服务端受控瞬移提升探索和回库效率；所有林地、动物、矿点、煤铁金等资源点必须上报到公共数据。金矿必须铁镐或更高级，没铁镐先采铁/做铁镐并记录金矿坐标。Alex 要多走动，发现资源并带回，制作工具、武器和护甲给大家。'
const COLLABORATION_PROTOCOL = '协作协议：只在需要协调时发中文短句。格式优先用 已有(物品/数量)、需要(物品/数量/用途)、正在做(任务/区域)、完成(结果/坐标)、受阻(原因/缺什么)。先同步库存和工作区，再行动；一个建筑区域一次只允许一个负责人改动，其他人不要拆或覆盖别人放好的方块。'
const TASK_SUITE_GUIDANCE = {
  construction: '建造任务：先确定蓝图/区域/材料；按地基、墙体、屋顶、门窗、照明、内饰分工；每个负责人只改自己的区域或层级。',
  crafting: '合成任务：先共享库存和配方；拆成原料、半成品、最终合成；缺配方或缺材料时用“需要/受阻”上报，不要重复试错。',
  cooking: '食物任务：分配采集、烹饪、燃料和入库；先做稳定食物，再做复杂菜品；成品统一放公共箱子或交给需要的人。',
  logistics: '后勤任务：公共箱子是共享事实源；采集者负责入库，管家负责分类，缺口由村长下一轮派工。'
}
const VILLAGE_DASHBOARD_CACHE_MS = 15000
const LIVE_OBSERVER_PREFERRED_AGENT = process.env.MINECRAFT_LIVE_OBSERVER_PREFERRED_AGENT || ''
const LIVE_OBSERVER_PREFERRED_SCORE_BOOST = Number(process.env.MINECRAFT_LIVE_OBSERVER_PREFERRED_SCORE_BOOST || 25)
const LIVE_OBSERVER_FOLLOW_REFRESH_MS = clampNumber(process.env.MINECRAFT_LIVE_OBSERVER_FOLLOW_REFRESH_MS || 5000, 2000, 60000, 5000)

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(LOG_DIR, { recursive: true })

const logger = new Logger(LOG_DIR)
const config = loadConfig()
const liveObserverState = {
  timer: null,
  followTimer: null,
  active: config.liveObserverAutoSwitch !== false,
  observer: config.liveObserverName || 'live',
  currentTarget: '',
  switchIntervalMs: clampNumber(config.liveObserverSwitchIntervalMs || 30000, 10000, 600000, 30000),
  lastSwitchedAt: null,
  lastFollowRefreshAt: null,
  lastError: null,
  lastFollowError: null,
  lastCandidates: []
}
const villageDashboardCache = { at: 0, value: null }
let mindcraftChild = null
const minecraftServer = new MinecraftServerManager({ logDir: LOG_DIR, logger })
const dataStore = new DataStore({ dataDir: DATA_DIR, logger })
const villageState = new VillageState({
  dataPath: path.join(DATA_DIR, 'village-state.json'),
  logger,
  dataStore
})
const vectorMemory = new VectorMemory({
  dataStore,
  logger,
  getConfig: () => config,
  getEnv: runtimeEnv
})

const client = new MindcraftClient({
  baseUrl: config.mindcraftUrl,
  logger
})

const autopilot = new Autopilot({
  client,
  logger,
  memoryPath: path.join(DATA_DIR, 'autopilot-memory.json'),
  intervalMs: config.intervalMs,
  idleCooldownMs: config.idleCooldownMs,
  minTaskRuntimeMs: config.minTaskRuntimeMs,
  maxConcurrentAgents: config.maxConcurrentAgents,
  agentFilter: parseCsv(config.agentFilter),
  assistantMode: config.assistantMode,
  useLlm: config.useLlm,
  llmBaseUrl: config.llmBaseUrl,
  llmModel: config.llmModel,
  llmApiKey: getConfiguredLlmApiKey(config, runtimeEnv()),
  worldDirective: config.worldDirective,
  villageState,
  sendMinecraftCommand: command => minecraftServer.sendCommand(command, config),
  getMinecraftIntel: () => minecraftIntelSnapshot({ force: true })
})

const mcpBridge = new McpBridge({
  statusSnapshot,
  ensureMinecraftServerReady,
  startMindcraft,
  stopOwnedMindcraft,
  createAndJoinAgent,
  sendTask,
  locatePlayer,
  activateSocietyMode,
  ensureSocietyResidents,
  societySnapshot,
  commanderContextSnapshot,
  agentContextSnapshot,
  recordAgentStatusReport,
  recordAgentMemoryNote,
  searchAgentMemories,
  focusLiveObserver,
  isRequestAllowed: isMcpRequestAllowed,
  autopilot
})

client.on('bot-output', (agentName, message) => {
  try {
    const rawState = client.latestState && client.latestState[agentName]
    const position = rawState && rawState.gameplay ? rawState.gameplay.position : null
    ingestAgentMessage(agentName, message, position, rawState)
  } catch (error) {
    logger.warn(`Agent output ingest failed for ${agentName}: ${error.message}`)
  }
})

client.start()

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(error => {
    logger.error(`request failed: ${error.stack || error.message}`)
    sendJson(res, 500, { error: error.message })
  })
})

server.listen(PORT, HOST, () => {
  logger.info(`我的世界AI陪玩控制台已启动：http://${HOST}:${PORT}`)
  scheduleLiveObserverSwitch(5000)
})

process.once('exit', () => {
  clearLiveObserverTimer()
  dataStore.close()
})

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)

  if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/') || url.pathname === '/api/mcp') {
    if (await mcpBridge.handle(req, res, url)) return
  }

  if (url.pathname.startsWith('/api/')) {
    await handleApi(req, res, url)
    return
  }

  if (url.pathname.startsWith('/integrations/')) {
    serveFileFromDir(res, INTEGRATIONS_DIR, url.pathname.replace('/integrations/', '/'))
    return
  }

  serveStatic(res, url.pathname)
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/config') {
    sendJson(res, 200, publicConfig())
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/model-providers') {
    sendJson(res, 200, {
      selectedProvider: inferModelProvider(config),
      envStatus: getProviderEnvStatus(config, runtimeEnv()),
      providers: listModelProviders(runtimeEnv())
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/config') {
    const body = await readJson(req)
    updateConfig(body)
    saveConfig()
    sendJson(res, 200, publicConfig())
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    sendJson(res, 200, await statusSnapshot())
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/minecraft/intel') {
    sendJson(res, 200, await minecraftIntelSnapshot({ force: url.searchParams.get('refresh') === '1' }))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/storage') {
    sendJson(res, 200, storageSnapshot(url))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/logs') {
    sendJson(res, 200, { logs: logger.recent(Number(url.searchParams.get('limit') || 160)) })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/memory') {
    const agent = url.searchParams.get('agent') || ''
    sendJson(res, 200, autopilot.getMemory(agent))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/memory/search') {
    sendJson(res, 200, await searchAgentMemories({
      agent: url.searchParams.get('agent') || '',
      q: url.searchParams.get('q') || '',
      limit: Number(url.searchParams.get('limit') || 20)
    }))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/commander/context') {
    const options = { limit: Number(url.searchParams.get('limit') || 20) }
    const snapshot = url.searchParams.get('refresh') === '1'
      ? await commanderContextSnapshotWithLiveMinecraft(options)
      : commanderContextSnapshot(options)
    sendJson(res, 200, snapshot)
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/agents/context') {
    const agent = url.searchParams.get('agent') || url.searchParams.get('agent_name') || ''
    sendJson(res, 200, agent ? agentContextSnapshot(agent, { limit: Number(url.searchParams.get('limit') || 20) }) : commanderContextSnapshot({ limit: Number(url.searchParams.get('limit') || 20) }).agents)
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/agents/report') {
    const body = await readJson(req)
    sendJson(res, 200, recordAgentStatusReport(body))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/agents/memory') {
    const body = await readJson(req)
    sendJson(res, 200, await recordAgentMemoryNote(body))
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/village') {
    sendJson(res, 200, villageState.snapshot())
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/village/dashboard') {
    sendJson(res, 200, await villageDashboardSnapshot({ force: url.searchParams.get('refresh') === '1' }))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/village') {
    const body = await readJson(req)
    sendJson(res, 200, villageState.update(body))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/village/reset') {
    sendJson(res, 200, villageState.resetDefaults())
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/village/project') {
    const body = await readJson(req)
    sendJson(res, 200, villageState.updateProject(body.id, body.project || body))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/village/report') {
    const body = await readJson(req)
    sendJson(res, 200, villageState.recordInfrastructureReport(body.report || body))
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/village/task-event') {
    const body = await readJson(req)
    sendJson(res, 200, villageState.recordTaskEvent(body.event || body))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/society') {
    sendJson(res, 200, societySnapshot())
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/society/activate') {
    const body = await readJson(req)
    const result = activateSocietyMode(body)
    sendJson(res, 200, result)
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/society/dispatch') {
    const body = await readJson(req)
    sendJson(res, 200, await dispatchSocietyTasks(body))
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/society/residents/ensure') {
    const body = await readJson(req)
    sendJson(res, 200, await ensureSocietyResidents(body))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/livestream') {
    sendJson(res, 200, liveObserverSnapshot())
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/livestream/intel') {
    sendJson(res, 200, liveIntelSnapshot({ limit: Number(url.searchParams.get('limit') || 8) }))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/livestream/auto') {
    const body = await readJson(req)
    sendJson(res, 200, setLiveObserverAutoSwitch(body))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/livestream/focus') {
    const body = await readJson(req)
    sendJson(res, 200, await focusLiveObserver(body))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/server-properties') {
    sendJson(res, 200, readServerProperties(config.minecraftServerDir))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/server-blueprint') {
    sendJson(res, 200, buildServerBlueprint(config))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/server-properties') {
    const body = await readJson(req)
    const result = writeServerProperties(config.minecraftServerDir, body.properties || {})
    logger.info(`Saved server.properties keys: ${result.savedKeys.join(', ')}`)
    sendJson(res, 200, result)
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/minecraft/logs') {
    sendJson(res, 200, readLatestLog(config.minecraftServerDir, Number(url.searchParams.get('limit') || 160)))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/mindcraft-config') {
    sendJson(res, 200, await readMindcraftConfig(config.mindcraftDir, url.searchParams.get('profile') || ''))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/mindcraft-config') {
    const body = await readJson(req)
    const result = await writeMindcraftConfig(config.mindcraftDir, body)
    logger.info('Saved Mindcraft settings/profile config')
    sendJson(res, 200, result)
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/minecraft/start') {
    await minecraftServer.start(config)
    sendJson(res, 200, await statusSnapshot())
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/minecraft/stop') {
    await minecraftServer.stop()
    sendJson(res, 200, await statusSnapshot())
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/minecraft/restart') {
    await minecraftServer.restart(config)
    sendJson(res, 200, await statusSnapshot())
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/minecraft/command') {
    const body = await readJson(req)
    sendJson(res, 200, await minecraftServer.sendCommand(body.command, config))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/mindcraft/start') {
    await startMindcraft()
    sendJson(res, 200, await statusSnapshot())
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/mindcraft/stop-owned') {
    stopOwnedMindcraft()
    sendJson(res, 200, await statusSnapshot())
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/agents/create') {
    const body = await readJson(req)
    const result = await createAndJoinAgent(body)
    sendJson(res, 200, result)
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/agents/start') {
    const body = await readJson(req)
    const agentName = String(body.agent || '').trim()
    if (!agentName) throw new Error('agent is required')
    await client.startAgent(agentName)
    logger.info(`Requested Mindcraft agent start: ${agentName}`)
    sendJson(res, 200, { ok: true, agent: agentName })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/agents/stop') {
    const body = await readJson(req)
    const agentName = String(body.agent || '').trim()
    if (!agentName) throw new Error('agent is required')
    await client.stopAgent(agentName)
    logger.info(`Requested Mindcraft agent stop: ${agentName}`)
    sendJson(res, 200, { ok: true, agent: agentName })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/player/location') {
    const body = await readJson(req)
    sendJson(res, 200, await locatePlayer(body.player))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/agents/go-to-player') {
    const body = await readJson(req)
    sendJson(res, 200, await guideAgentsToPlayer(body))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/autopilot/start') {
    autopilot.start()
    sendJson(res, 200, await statusSnapshot())
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/autopilot/stop') {
    autopilot.stop()
    sendJson(res, 200, await statusSnapshot())
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/autopilot/restart') {
    autopilot.stop()
    autopilot.start()
    sendJson(res, 200, await statusSnapshot())
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/task') {
    const body = await readJson(req)
    sendJson(res, 200, await sendTask(body))
    return
  }

  sendJson(res, 404, { error: 'not found' })
}

async function statusSnapshot() {
  const [minecraftRuntime, mindcraftHttpOk, mindcraftProcesses] = await Promise.all([
    minecraftServer.snapshot(config),
    testHttp(config.mindcraftUrl),
    listMindcraftProcesses(config.mindcraftDir)
  ])

  const socketSnapshot = client.snapshot()
  villageState.observeAgents(socketSnapshot)

  return {
    app: {
      url: `http://${HOST}:${PORT}`,
      dataDir: DATA_DIR,
      logDir: LOG_DIR,
      node: process.version
    },
    storage: {
      ...dataStore.snapshot(),
      vectorMemory: vectorMemory.snapshot()
    },
    minecraft: {
      host: config.minecraftHost,
      port: config.minecraftPort,
      tcpOpen: minecraftRuntime.tcpOpen,
      serverDir: config.minecraftServerDir,
      propertiesPath: config.minecraftServerDir ? path.join(config.minecraftServerDir, 'server.properties') : '',
      propertiesExists: Boolean(config.minecraftServerDir && fs.existsSync(path.join(config.minecraftServerDir, 'server.properties'))),
      processIds: minecraftRuntime.processIds,
      ownedPid: minecraftRuntime.ownedPid,
      managed: minecraftRuntime.managed,
      canSendCommand: minecraftRuntime.canSendCommand,
      commandChannel: minecraftRuntime.commandChannel,
      rcon: minecraftRuntime.rcon,
      startedAt: minecraftRuntime.startedAt,
      startCommand: minecraftRuntime.startCommand,
      logPath: minecraftRuntime.logPath
    },
    mindcraft: {
      url: config.mindcraftUrl,
      httpOk: mindcraftHttpOk,
      directory: config.mindcraftDir,
      processIds: mindcraftProcesses.map(processInfo => processInfo.pid),
      ownedPid: mindcraftChild && !mindcraftChild.killed ? mindcraftChild.pid : null
    },
    socket: socketSnapshot,
    autopilot: autopilot.snapshot(),
    livestream: liveObserverSnapshot(),
    village: villageState.snapshot(),
    models: await modelStatusSnapshot(socketSnapshot),
    config: publicConfig()
  }
}

function runtimeEnv() {
  const paths = [
    path.join(DATA_DIR, 'secrets.json'),
    config.mindcraftDir ? path.join(config.mindcraftDir, 'keys.json') : ''
  ]
  return loadSecretEnv({ paths, baseEnv: process.env, logger })
}

function storageSnapshot(url) {
  const limit = Number(url.searchParams.get('limit') || 50)
  const agent = url.searchParams.get('agent') || ''
  return {
    ...dataStore.snapshot(),
    vectorMemory: vectorMemory.snapshot(),
    recentTaskEvents: dataStore.recentTaskEvents(limit),
    recentInfrastructureReports: dataStore.recentInfrastructureReports(limit),
    recentAgentObservations: dataStore.recentAgentObservations(agent, limit),
    recentAgentStatusReports: dataStore.recentAgentStatusReports(agent, limit),
    recentAgentMemories: dataStore.recentAgentMemories(agent, limit)
  }
}

async function villageDashboardSnapshot(options = {}) {
  const now = Date.now()
  if (!options.force && villageDashboardCache.value && now - villageDashboardCache.at < VILLAGE_DASHBOARD_CACHE_MS) {
    return { ...villageDashboardCache.value, cached: true, cacheAgeMs: now - villageDashboardCache.at }
  }

  const village = villageState.snapshot()
  const socket = client.snapshot()
  const residents = villageResidentNames(village)
  const online = new Set((socket.agents || []).filter(agent => agent.in_game).map(agent => agent.name))
  const stats = readResidentStatSummaries(config.minecraftServerDir, residents)
  const inventories = await readResidentInventories(residents)
  const chests = await readPublicChestInventories(village)
  const resources = buildVillageResourceRows(village.resources || [], inventories, chests)
  if (chests.some(chest => chest.ok) || inventories.some(row => row.ok)) syncVillageResourceCurrent(village.resources || [], resources)
  const inventoryByAgent = new Map(inventories.map(row => [row.agent, row]))

  const scoreboard = residents.map(agent => {
    const stat = stats.find(row => row.agent === agent) || emptyResidentStats(agent)
    const inventory = inventoryByAgent.get(agent)
    const state = socket.states && socket.states[agent] ? socket.states[agent] : {}
    return {
      ...stat,
      online: online.has(agent),
      position: state.position || null,
      action: state.action || '',
      carried: inventory ? inventory.summary : {},
      carriedTopItems: inventory ? inventory.topItems : []
    }
  }).sort((a, b) => b.score - a.score || a.agent.localeCompare(b.agent))

  const projectProgress = villageState.syncProjectProgress({ resources, chests, inventories, scoreboard, socket })
  const updatedVillage = projectProgress.changed ? villageState.snapshot() : village

  const value = {
    generatedAt: new Date().toISOString(),
    cached: false,
    settlement: updatedVillage.settlement,
    scoreboard,
    resources,
    projects: updatedVillage.projects || [],
    projectProgress,
    chests,
    inventories,
    summary: summarizeDashboard(resources, scoreboard, chests),
    warnings: dashboardWarnings(updatedVillage, chests)
  }
  villageDashboardCache.at = now
  villageDashboardCache.value = value
  return value
}

async function readResidentInventories(residents) {
  const rows = []
  for (const agent of residents) {
    if (!/^[A-Za-z0-9_]{1,32}$/.test(agent)) continue
    try {
      const result = await minecraftServer.sendCommand(`data get entity ${agent} Inventory`, config)
      const items = parseMinecraftItemList(result.response || '')
      rows.push({ agent, ok: true, items, summary: summarizeItemsByCategory(items), topItems: topItems(items, 8) })
    } catch (error) {
      rows.push({ agent, ok: false, error: error.message, items: [], summary: {}, topItems: [] })
    }
  }
  return rows
}

async function readPublicChestInventories(village) {
  const positions = publicChestCandidatePositions(village && village.settlement && village.settlement.publicChest)
  const rows = []
  for (const position of positions) {
    try {
      const result = await minecraftServer.sendCommand(`data get block ${Math.round(position.x)} ${Math.round(position.y)} ${Math.round(position.z)} Items`, config)
      const response = result.response || ''
      const ok = !/not a block entity|is not a block entity|not a block/i.test(response)
      const items = ok ? parseMinecraftItemList(response) : []
      rows.push({ position, ok, items, summary: summarizeItemsByCategory(items), topItems: topItems(items, 10), response: ok ? '' : response.slice(0, 160) })
    } catch (error) {
      rows.push({ position, ok: false, error: error.message, items: [], summary: {}, topItems: [] })
    }
  }
  return rows
}

function publicChestCandidatePositions(position) {
  const base = normalizeDashboardPosition(position)
  if (!base) return []
  const candidates = [
    base,
    { x: base.x - 1, y: base.y, z: base.z },
    { x: base.x + 1, y: base.y, z: base.z },
    { x: base.x, y: base.y, z: base.z - 1 },
    { x: base.x, y: base.y, z: base.z + 1 }
  ]
  const seen = new Set()
  return candidates.filter(item => {
    const key = `${Math.round(item.x)},${Math.round(item.y)},${Math.round(item.z)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeDashboardPosition(value) {
  if (!value || typeof value !== 'object') return null
  const x = Number(value.x)
  const y = Number(value.y)
  const z = Number(value.z)
  if (![x, y, z].every(Number.isFinite)) return null
  return { x: Math.round(x), y: Math.round(y), z: Math.round(z) }
}

function parseMinecraftItemList(response) {
  const text = String(response || '')
  const items = []
  const regex = /count:\s*(\d+)[\s\S]*?id:\s*"([^"]+)"/g
  let match
  while ((match = regex.exec(text))) {
    const count = Number(match[1])
    const id = String(match[2] || '').trim()
    if (id) items.push({ id, count: Number.isFinite(count) ? count : 1 })
  }
  return items
}

function buildVillageResourceRows(targets, inventories, chests) {
  const targetById = new Map((targets || []).map(item => [item.id, item]))
  const ids = ['wood', 'stone', 'coal', 'iron', 'gold', 'food', 'torches', 'wool', 'beds']
  const chestSummary = mergeCategorySummaries(chests.filter(chest => chest.ok).map(chest => chest.summary))
  const agentSummary = mergeCategorySummaries(inventories.filter(row => row.ok).map(row => row.summary))
  return ids.map(id => {
    const target = targetById.get(id) || defaultDashboardResource(id)
    const chest = Number(chestSummary[id] || 0)
    const carried = Number(agentSummary[id] || 0)
    const live = chest + carried
    const targetCount = Math.max(0, Number(target.target || 0))
    const percent = targetCount > 0 ? Math.min(100, Math.round(live / targetCount * 100)) : 0
    return {
      id,
      name: target.name || defaultDashboardResource(id).name,
      target: targetCount,
      current: live,
      trackedCurrent: Number(target.current || 0),
      chest,
      carried,
      unit: target.unit || defaultDashboardResource(id).unit,
      percent,
      status: targetCount > 0 && live >= targetCount ? 'done' : live > 0 ? 'partial' : 'missing'
    }
  })
}

function defaultDashboardResource(id) {
  return {
    wood: { id, name: '木头', target: 128, unit: '个' },
    stone: { id, name: '石头/圆石', target: 192, unit: '个' },
    coal: { id, name: '煤/木炭', target: 48, unit: '个' },
    iron: { id, name: '铁/铁矿', target: 32, unit: '个' },
    gold: { id, name: '金/金矿', target: 16, unit: '个' },
    food: { id, name: '食物', target: 64, unit: '份' },
    torches: { id, name: '火把', target: 96, unit: '个' },
    wool: { id, name: '羊毛/床材料', target: 24, unit: '个' },
    beds: { id, name: '床', target: 5, unit: '张' }
  }[id] || { id, name: id, target: 0, unit: '个' }
}

function syncVillageResourceCurrent(existingResources, liveResources) {
  const existingById = new Map((existingResources || []).map(item => [item.id, item]))
  const patch = (liveResources || []).map(row => ({
    id: row.id,
    name: row.name,
    target: row.target,
    current: row.current,
    unit: row.unit
  }))
  const changed = patch.some(row => {
    const existing = existingById.get(row.id)
    return !existing || Number(existing.current || 0) !== Number(row.current || 0) || Number(existing.target || 0) !== Number(row.target || 0)
  })
  if (!changed) return
  try {
    villageState.update({ resources: patch })
  } catch (error) {
    logger.warn('Village resource sync failed: ' + error.message)
  }
}
function summarizeItemsByCategory(items) {
  const summary = {}
  for (const item of items || []) {
    const category = resourceCategoryForItem(item.id)
    if (!category) continue
    summary[category] = Number(summary[category] || 0) + Number(item.count || 0)
  }
  return summary
}

function resourceCategoryForItem(id) {
  const value = String(id || '')
  if (!value) return ''
  if (value.endsWith('_bed')) return 'beds'
  if (value.endsWith('_wool')) return 'wool'
  if (value === 'minecraft:torch' || value === 'minecraft:soul_torch') return 'torches'
  if (value === 'minecraft:coal' || value === 'minecraft:charcoal') return 'coal'
  if (value === 'minecraft:raw_iron' || value === 'minecraft:iron_ingot' || value.endsWith('iron_ore')) return 'iron'
  if (value === 'minecraft:raw_gold' || value === 'minecraft:gold_ingot' || value.endsWith('gold_ore')) return 'gold'
  if (value === 'minecraft:cobblestone' || value === 'minecraft:stone' || value === 'minecraft:granite' || value === 'minecraft:diorite' || value === 'minecraft:andesite' || value === 'minecraft:cobbled_deepslate') return 'stone'
  if (value.endsWith('_log') || value.endsWith('_wood') || value.endsWith('_planks') || value === 'minecraft:stick') return 'wood'
  if (isFoodItem(value)) return 'food'
  return ''
}

function isFoodItem(id) {
  return new Set([
    'minecraft:bread', 'minecraft:apple', 'minecraft:golden_apple', 'minecraft:carrot', 'minecraft:potato', 'minecraft:baked_potato',
    'minecraft:beef', 'minecraft:cooked_beef', 'minecraft:porkchop', 'minecraft:cooked_porkchop', 'minecraft:chicken', 'minecraft:cooked_chicken',
    'minecraft:mutton', 'minecraft:cooked_mutton', 'minecraft:rabbit', 'minecraft:cooked_rabbit', 'minecraft:cod', 'minecraft:cooked_cod',
    'minecraft:salmon', 'minecraft:cooked_salmon', 'minecraft:melon_slice', 'minecraft:sweet_berries', 'minecraft:glow_berries'
  ]).has(id)
}

function mergeCategorySummaries(summaries) {
  const merged = {}
  for (const summary of summaries || []) {
    for (const [id, count] of Object.entries(summary || {})) {
      merged[id] = Number(merged[id] || 0) + Number(count || 0)
    }
  }
  return merged
}

function topItems(items, limit) {
  const totals = new Map()
  for (const item of items || []) {
    totals.set(item.id, Number(totals.get(item.id) || 0) + Number(item.count || 0))
  }
  return Array.from(totals.entries())
    .map(([id, count]) => ({ id, count, name: itemLabel(id) }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, limit)
}

function itemLabel(id) {
  return String(id || '').replace(/^minecraft:/, '')
}

function readResidentStatSummaries(serverDir, residents) {
  const uuidByName = readUsercacheByName(serverDir)
  return residents.map(agent => readResidentStats(serverDir, agent, uuidByName.get(agent))).sort((a, b) => b.score - a.score || a.agent.localeCompare(b.agent))
}

function readUsercacheByName(serverDir) {
  const map = new Map()
  try {
    const filePath = path.join(serverDir || '', 'usercache.json')
    const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row && row.name && row.uuid) map.set(row.name, row.uuid)
    }
  } catch {}
  return map
}

function readResidentStats(serverDir, agent, uuid) {
  if (!uuid) return emptyResidentStats(agent)
  try {
    const filePath = path.join(serverDir || '', 'stats', `${uuid}.json`)
    const stats = JSON.parse(fs.readFileSync(filePath, 'utf8')).stats || {}
    const killed = stats['minecraft:killed'] || {}
    const picked = stats['minecraft:picked_up'] || {}
    const crafted = stats['minecraft:crafted'] || {}
    const mined = stats['minecraft:mined'] || {}
    const custom = stats['minecraft:custom'] || {}
    const animalKills = sumKeys(killed, ['minecraft:sheep', 'minecraft:cow', 'minecraft:pig', 'minecraft:chicken'])
    const monsterKills = sumMatching(killed, isHostileMobKey)
    const playerKills = Number(custom['minecraft:player_kills'] || killed['minecraft:player'] || 0)
    const totalKills = sumValues(killed)
    const wool = sumMatching(picked, key => key.endsWith('_wool'))
    const meat = sumMatching(picked, key => isFoodItem(key))
    const beds = sumMatching(crafted, key => key.endsWith('_bed'))
    const ore = sumMatching(mined, key => /coal_ore|iron_ore|copper_ore|gold_ore/.test(key))
    const blocksMined = sumValues(mined)
    const score = Math.round(totalKills * 12 + wool * 20 + beds * 80 + meat * 4 + ore * 6 + Math.min(blocksMined, 2500) / 10)
    return {
      agent,
      uuid,
      score,
      kills: totalKills,
      monsterKills,
      mobKills: Number(custom['minecraft:mob_kills'] || totalKills),
      playerKills,
      animalKills,
      sheepKills: Number(killed['minecraft:sheep'] || 0),
      cowKills: Number(killed['minecraft:cow'] || 0),
      pigKills: Number(killed['minecraft:pig'] || 0),
      chickenKills: Number(killed['minecraft:chicken'] || 0),
      woolPicked: wool,
      foodPicked: meat,
      bedsCrafted: beds,
      oreMined: ore,
      blocksMined,
      deaths: Number(custom['minecraft:deaths'] || 0),
      damageDealt: Number(custom['minecraft:damage_dealt'] || 0),
      distanceKm: Math.round(Number(custom['minecraft:walk_one_cm'] || 0) / 100000) / 10
    }
  } catch {
    return emptyResidentStats(agent)
  }
}

function emptyResidentStats(agent) {
  return {
    agent,
    uuid: '',
    score: 0,
    kills: 0,
    monsterKills: 0,
    mobKills: 0,
    playerKills: 0,
    animalKills: 0,
    sheepKills: 0,
    cowKills: 0,
    pigKills: 0,
    chickenKills: 0,
    woolPicked: 0,
    foodPicked: 0,
    bedsCrafted: 0,
    oreMined: 0,
    blocksMined: 0,
    deaths: 0,
    damageDealt: 0,
    distanceKm: 0
  }
}

function sumValues(value) {
  return Object.values(value || {}).reduce((sum, item) => sum + Number(item || 0), 0)
}

function sumKeys(value, keys) {
  return keys.reduce((sum, key) => sum + Number((value || {})[key] || 0), 0)
}

function sumMatching(value, predicate) {
  return Object.entries(value || {}).reduce((sum, [key, count]) => predicate(key) ? sum + Number(count || 0) : sum, 0)
}

function isHostileMobKey(key) {
  const value = String(key || '').replace(/^minecraft:/, '')
  return new Set([
    'blaze', 'bogged', 'breeze', 'cave_spider', 'creeper', 'drowned', 'elder_guardian', 'enderman', 'endermite',
    'evoker', 'ghast', 'guardian', 'hoglin', 'husk', 'magma_cube', 'phantom', 'piglin', 'piglin_brute', 'pillager',
    'ravager', 'shulker', 'silverfish', 'skeleton', 'slime', 'spider', 'stray', 'vex', 'vindicator', 'warden',
    'witch', 'wither', 'wither_skeleton', 'zoglin', 'zombie', 'zombie_villager', 'zombified_piglin'
  ]).has(value)
}

function summarizeDashboard(resources, scoreboard, chests) {
  const byId = new Map((resources || []).map(item => [item.id, item]))
  return {
    onlineResidents: scoreboard.filter(item => item.online).length,
    totalResidents: scoreboard.length,
    food: byId.get('food') ? byId.get('food').current : 0,
    wool: byId.get('wool') ? byId.get('wool').current : 0,
    beds: byId.get('beds') ? byId.get('beds').current : 0,
    publicChestCount: chests.filter(item => item.ok).length,
    topAgent: scoreboard[0] ? scoreboard[0].agent : ''
  }
}

function dashboardWarnings(village, chests) {
  const warnings = []
  const chest = village && village.settlement ? village.settlement.publicChest : null
  if (!chest) warnings.push('还没有设置公共箱坐标。')
  if (chest && !chests.some(item => item.ok)) warnings.push('配置的公共箱坐标附近没有读到箱子实体。')
  return warnings
}

async function minecraftIntelSnapshot(options = {}) {
  const [runtimeResult, dashboardResult, commandResult] = await Promise.all([
    minecraftServer.snapshot(config).catch(error => ({ error: error.message })),
    villageDashboardSnapshot({ force: Boolean(options.force) }).catch(error => ({ error: error.message })),
    queryMinecraftWorldCommands().catch(error => ({ error: error.message }))
  ])
  const socket = client.snapshot()
  const village = villageState.snapshot()
  const players = parseServerListPlayers(commandResult.list && commandResult.list.response)
  const positions = await queryOnlinePlayerPositions(players.names)
  return buildMinecraftIntelSnapshot({
    live: true,
    runtime: runtimeResult,
    dashboard: dashboardResult,
    commands: commandResult,
    positions,
    socket,
    village
  })
}

async function queryMinecraftWorldCommands() {
  const commands = {
    list: 'list',
    daytime: 'time query daytime',
    gametime: 'time query gametime',
    difficulty: 'difficulty'
  }
  const result = {}
  for (const [key, command] of Object.entries(commands)) {
    try {
      const response = await minecraftServer.sendCommand(command, config)
      result[key] = { ok: true, command, response: String(response.response || '').trim() }
    } catch (error) {
      result[key] = { ok: false, command, error: error.message }
    }
  }
  return result
}

async function queryOnlinePlayerPositions(players) {
  const positions = {}
  for (const player of (players || []).slice(0, 20)) {
    if (!/^[A-Za-z0-9_]{1,32}$/.test(player)) continue
    try {
      const result = await minecraftServer.sendCommand(`data get entity ${player} Pos`, config)
      positions[player] = { ok: true, position: parseMinecraftPosition(result.response || '') }
    } catch (error) {
      positions[player] = { ok: false, error: error.message }
    }
  }
  return positions
}

function cachedMinecraftIntelSnapshot(village, socket) {
  return buildMinecraftIntelSnapshot({
    live: false,
    runtime: null,
    dashboard: villageDashboardCache.value,
    commands: {},
    positions: {},
    socket,
    village
  })
}

function buildMinecraftIntelSnapshot(input = {}) {
  const village = input.village || villageState.snapshot()
  const socket = input.socket || client.snapshot()
  const dashboard = input.dashboard && !input.dashboard.error ? input.dashboard : null
  const commands = input.commands || {}
  const serverList = parseServerListPlayers(commands.list && commands.list.response)
  const residents = villageResidentNames(village)
  const residentSet = new Set(residents)
  const observerName = liveObserverState.observer || 'live'
  const onlineFromSocket = (socket.agents || []).filter(agent => agent.in_game).map(agent => agent.name)
  const onlineNames = serverList.names.length > 0 ? serverList.names : onlineFromSocket
  const humanPlayers = onlineNames.filter(name => !residentSet.has(name) && name !== observerName)
  const serverProperties = readServerProperties(config.minecraftServerDir)
  const daytime = parseFirstNumber(commands.daytime && commands.daytime.response)
  const gametime = parseFirstNumber(commands.gametime && commands.gametime.response)
  const resources = dashboard && Array.isArray(dashboard.resources) ? dashboard.resources : (village.resources || [])
  const scoreboard = dashboard && Array.isArray(dashboard.scoreboard) ? dashboard.scoreboard : []
  const chests = dashboard && Array.isArray(dashboard.chests) ? dashboard.chests : []
  const inventories = dashboard && Array.isArray(dashboard.inventories) ? dashboard.inventories : []
  const rconDataReady = Boolean((input.runtime && input.runtime.canSendCommand) || (commands.list && commands.list.ok) || chests.some(chest => chest.ok) || inventories.some(row => row.ok))
  const inputPositions = input.positions || {}
  const playerPositions = Object.fromEntries(Object.entries(inputPositions)
    .filter(([, value]) => value && value.ok && value.position)
    .map(([name, value]) => [name, value.position]))

  return {
    generatedAt: new Date().toISOString(),
    live: Boolean(input.live),
    dataSources: [
      { id: 'rcon', name: 'Minecraft RCON/命令', ready: rconDataReady },
      { id: 'mindcraft-socket', name: 'Mindcraft WebSocket', ready: Boolean(socket.connected) },
      { id: 'public-chest-nbt', name: '公共箱 NBT', ready: chests.some(chest => chest.ok) },
      { id: 'server-stats-json', name: '服务端 stats/*.json', ready: scoreboard.length > 0 }
    ],
    runtime: {
      host: config.minecraftHost,
      port: config.minecraftPort,
      tcpOpen: input.runtime ? input.runtime.tcpOpen : undefined,
      commandChannel: input.runtime ? input.runtime.commandChannel : undefined,
      canSendCommand: input.runtime ? input.runtime.canSendCommand : undefined,
      rconReady: Boolean(input.runtime && input.runtime.rcon && input.runtime.rcon.ready)
    },
    serverProperties: {
      gamemode: serverProperties.values.gamemode || '',
      difficulty: serverProperties.values.difficulty || parseDifficulty(commands.difficulty && commands.difficulty.response),
      maxPlayers: serverProperties.values['max-players'] || (serverList.max ? String(serverList.max) : ''),
      pvp: serverProperties.values.pvp || '',
      viewDistance: serverProperties.values['view-distance'] || '',
      simulationDistance: serverProperties.values['simulation-distance'] || ''
    },
    world: {
      daytime,
      gametime,
      timePhase: timePhaseLabel(daytime),
      difficultyResponse: commands.difficulty && commands.difficulty.response ? commands.difficulty.response : ''
    },
    online: {
      count: serverList.count || onlineNames.length,
      max: serverList.max || Number(serverProperties.values['max-players'] || 0),
      names: onlineNames,
      residentsOnline: residents.filter(name => onlineNames.includes(name)),
      humans: humanPlayers,
      observer: observerName,
      serverListResponse: commands.list && commands.list.response ? commands.list.response : ''
    },
    positions: playerPositions,
    settlement: {
      base: village && village.settlement ? village.settlement.base : null,
      publicChest: village && village.settlement ? village.settlement.publicChest : null,
      radius: village && village.settlement ? village.settlement.radius : null
    },
    resources,
    resourceGaps: resourceGapSummary(resources, 8),
    publicStorage: {
      readableChests: chests.filter(chest => chest.ok).length,
      candidates: chests.map(chest => ({
        position: chest.position,
        ok: Boolean(chest.ok),
        summary: chest.summary || {},
        topItems: chest.topItems || [],
        error: chest.error || chest.response || ''
      })),
      warnings: dashboard && Array.isArray(dashboard.warnings) ? dashboard.warnings : []
    },
    residents: scoreboard.map(row => ({
      agent: row.agent,
      online: Boolean(row.online),
      position: row.position || null,
      action: row.action || '',
      score: row.score || 0,
      kills: row.kills || 0,
      monsterKills: row.monsterKills || 0,
      mobKills: row.mobKills || row.kills || 0,
      playerKills: row.playerKills || 0,
      deaths: row.deaths || 0,
      damageDealt: row.damageDealt || 0,
      animalKills: row.animalKills || 0,
      woolPicked: row.woolPicked || 0,
      bedsCrafted: row.bedsCrafted || 0,
      oreMined: row.oreMined || 0,
      carried: row.carried || {},
      carriedTopItems: row.carriedTopItems || []
    })),
    priorities: deriveMinecraftIntelPriorities(resources, socket, humanPlayers)
  }
}

function parseServerListPlayers(response) {
  const text = String(response || '')
  const countMatch = text.match(/There are\s+(\d+)\s+of a max of\s+(\d+)\s+players online:?\s*(.*)$/i)
  if (!countMatch) return { count: 0, max: 0, names: [] }
  const names = String(countMatch[3] || '')
    .split(',')
    .map(name => name.trim())
    .filter(Boolean)
  return { count: Number(countMatch[1] || 0), max: Number(countMatch[2] || 0), names }
}

function parseMinecraftPosition(response) {
  const match = String(response || '').match(/\[\s*(-?\d+(?:\.\d+)?)(?:d)?\s*,\s*(-?\d+(?:\.\d+)?)(?:d)?\s*,\s*(-?\d+(?:\.\d+)?)(?:d)?\s*\]/i)
  if (!match) return null
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) }
}

function parseFirstNumber(value) {
  const match = String(value || '').match(/-?\d+/)
  return match ? Number(match[0]) : null
}

function parseDifficulty(value) {
  const text = String(value || '').toLowerCase()
  for (const item of ['peaceful', 'easy', 'normal', 'hard']) {
    if (text.includes(item)) return item
  }
  return ''
}

function timePhaseLabel(daytime) {
  const value = Number(daytime)
  if (!Number.isFinite(value)) return 'unknown'
  const dayTime = ((Math.round(value) % 24000) + 24000) % 24000
  if (dayTime < 12000) return '白天'
  if (dayTime < 13800) return '黄昏'
  if (dayTime < 23000) return '夜晚'
  return '黎明'
}

function resourceGapSummary(resources, limit) {
  return (resources || [])
    .map(row => ({
      id: row.id,
      name: row.name || row.id,
      current: Number(row.current || 0),
      target: Number(row.target || 0),
      missing: Math.max(0, Number(row.target || 0) - Number(row.current || 0)),
      unit: row.unit || ''
    }))
    .filter(row => row.target > 0 && row.missing > 0)
    .sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name))
    .slice(0, limit)
}

function deriveMinecraftIntelPriorities(resources, socket, humanPlayers) {
  const gaps = resourceGapSummary(resources, 5)
  const states = socket.states || {}
  const idleAgents = Object.entries(states)
    .filter(([, state]) => Boolean(state && (state.isIdle || (state.action && state.action.isIdle))))
    .map(([agent]) => agent)
  const riskyAgents = Object.entries(states)
    .filter(([, state]) => {
      const gameplay = state && state.gameplay ? state.gameplay : {}
      const health = Number(gameplay.health ?? (state && state.health) ?? 20)
      const hunger = Number(gameplay.hunger ?? (state && state.hunger) ?? 20)
      return health <= 10 || hunger <= 8
    })
    .map(([agent]) => agent)
  return {
    resourceGaps: gaps,
    idleAgents,
    riskyAgents,
    humansOnline: humanPlayers,
    suggestedFocus: gaps.length > 0 ? `优先补齐${gaps.slice(0, 3).map(item => item.name).join('、')}` : '资源目标暂时满足，推进建筑和道路'
  }
}

function ingestAgentMessage(agentName, message, position, rawState) {
  villageState.ingestAgentOutput(agentName, message, position)
  const statusPayload = parseStructuredMarker(message, ['AGENT_STATUS', 'STATUS_REPORT', '居民状态'])
  if (statusPayload) {
    recordAgentStatusReport({
      ...statusPayload,
      agent: statusPayload.agent || agentName,
      position: statusPayload.position || position,
      source: 'chat',
      rawMessage: typeof message === 'string' ? message.slice(0, 500) : ''
    }, rawState)
  }
  const memoryPayload = parseStructuredMarker(message, ['MEMORY_NOTE', 'AGENT_MEMORY', '记忆'])
  if (memoryPayload) {
    recordAgentMemoryNote({
      ...memoryPayload,
      agent: memoryPayload.agent || agentName,
      source: 'chat',
      rawMessage: typeof message === 'string' ? message.slice(0, 500) : ''
    }).catch(error => logger.warn('Agent memory ingest failed for ' + agentName + ': ' + error.message))
  }
}

function commanderContextSnapshot(options = {}) {
  const limit = clampNumber(options.limit || 20, 1, 100, 20)
  const socket = client.snapshot()
  const village = villageState.snapshot()
  const targets = Array.isArray(options.targets) && options.targets.length > 0 ? options.targets : villageResidentNames(village)
  return {
    generatedAt: new Date().toISOString(),
    availableServerApis: [
      'GET /api/status',
      'GET /api/minecraft/intel',
      'GET /api/village/dashboard',
      'GET /api/commander/context',
      'GET /api/agents/context?agent=Alex',
      'GET /api/memory/search?agent=Alex&q=mine',
      'POST /api/agents/report',
      'POST /api/agents/memory',
      'POST /api/village/report',
      'POST /api/village/task-event',
      'POST /api/society/dispatch'
    ],
    memoryBackends: {
      structured: dataStore.snapshot().backend,
      vectorReady: vectorMemory.snapshot().enabled && !vectorMemory.snapshot().lastError,
      vector: vectorMemory.snapshot(),
      recommendedLocalGpu: 'RTX 3090: run bge-m3 or nomic-embed-text locally; SQLite vector search is built in, Qdrant can be enabled for larger memory.',
      embeddingFields: ['embeddingModel', 'vectorId', 'vectorScore']
    },
    mindcraft: {
      url: config.mindcraftUrl,
      socketConnected: socket.connected,
      lastError: socket.lastError
    },
    autopilot: autopilot.snapshot(),
    onlineAgents: (socket.agents || []).filter(agent => agent.in_game).map(agent => agent.name),
    minecraftIntel: options.minecraftIntel || cachedMinecraftIntelSnapshot(village, socket),
    village,
    recent: {
      taskEvents: dataStore.recentTaskEvents(limit),
      infrastructureReports: dataStore.recentInfrastructureReports(limit),
      agentStatusReports: dataStore.recentAgentStatusReports('', limit),
      agentMemories: dataStore.recentAgentMemories('', limit),
      agentObservations: dataStore.recentAgentObservations('', limit)
    },
    agents: targets.map(agentName => agentContextSnapshot(agentName, { limit: 8, compact: Boolean(options.compact) }))
  }
}

async function commanderContextSnapshotWithLiveMinecraft(options = {}) {
  try {
    const minecraftIntel = await minecraftIntelSnapshot({ force: true })
    return commanderContextSnapshot({ ...options, minecraftIntel })
  } catch (error) {
    logger.warn('Commander live Minecraft intel failed: ' + error.message)
    return {
      ...commanderContextSnapshot(options),
      minecraftIntelError: error.message
    }
  }
}
function agentContextSnapshot(agentName, options = {}) {
  const agent = sanitizeEntityName(agentName)
  const limit = clampNumber(options.limit || 20, 1, 100, 20)
  const socket = client.snapshot()
  const socketAgent = (socket.agents || []).find(item => item.name === agent) || null
  const rawState = client.latestState && client.latestState[agent]
  const summarizedState = socket.states && socket.states[agent] ? socket.states[agent] : null
  const assignment = villageState.assignmentFor(agent)
  const memory = autopilot.agentContext(agent)
  const context = {
    agent,
    online: Boolean(socketAgent && socketAgent.in_game),
    socket: socketAgent,
    currentState: compactLiveAgentState(rawState, summarizedState),
    assignment,
    promptContext: villageState.taskContextFor(agent),
    memory,
    stored: {
      statusReports: dataStore.recentAgentStatusReports(agent, limit),
      longTermMemories: dataStore.recentAgentMemories(agent, limit),
      observations: dataStore.recentAgentObservations(agent, limit),
      taskEvents: dataStore.recentTaskEvents(limit).filter(event => event.agent === agent),
      infrastructureReports: dataStore.recentInfrastructureReports(limit).filter(report => report.agent === agent)
    },
    reportFormats: {
      status: 'AGENT_STATUS {"status":"working|blocked|done|idle","task":"...","summary":"...","needs":["wood"],"has":["stone x12"],"position":{"x":0,"y":64,"z":0}}',
      memory: 'MEMORY_NOTE {"kind":"route|resource|building|preference|risk|note","importance":1,"text":"...","embeddingModel":"optional","vectorId":"optional"}'
    }
  }
  if (!options.compact) return context
  return {
    agent: context.agent,
    online: context.online,
    currentState: context.currentState,
    assignment: context.assignment,
    memory: {
      lastTaskSummary: memory.lastTaskSummary,
      lastStatusSummary: memory.lastStatusSummary,
      openNeeds: memory.openNeeds,
      statusReports: (memory.statusReports || []).slice(-5),
      longTermNotes: (memory.longTermNotes || []).slice(0, 8),
      contextSummary: memory.contextSummary || '',
      contextArchives: (memory.contextArchives || []).slice(0, 4)
    },
    stored: {
      statusReports: context.stored.statusReports.slice(0, 5),
      longTermMemories: context.stored.longTermMemories.slice(0, 8),
      observations: context.stored.observations.slice(0, 5)
    }
  }
}

function recordAgentStatusReport(body = {}, rawState) {
  const agent = sanitizeEntityName(body.agent || body.agent_name || body.name)
  const currentState = rawState || (client.latestState && client.latestState[agent])
  const fallbackPosition = currentState && currentState.gameplay ? currentState.gameplay.position : null
  const report = sanitizeAgentStatusReport({ ...body, agent, position: body.position || fallbackPosition })
  dataStore.recordAgentStatusReport(report)
  autopilot.recordAgentStatus(agent, report)
  if (report.status === 'blocked' || report.status === 'done' || report.task) {
    villageState.recordTaskEvent({
      type: report.status === 'done' ? 'completed' : report.status === 'blocked' ? 'blocked' : 'progress',
      status: report.status === 'done' ? 'done' : report.status === 'blocked' ? 'blocked' : 'active',
      source: report.source || 'agent-report',
      agent,
      title: report.summary || report.task || '居民状态上报',
      description: report.detail || report.summary || report.task || '',
      projectId: report.projectId || ''
    })
  }
  return { ok: true, report, context: agentContextSnapshot(agent, { limit: 10 }) }
}

async function recordAgentMemoryNote(body = {}) {
  const agent = sanitizeEntityName(body.agent || body.agent_name || body.name)
  const note = sanitizeAgentMemoryNote({ ...body, agent })
  dataStore.recordAgentMemory(note)
  autopilot.recordAgentMemory(agent, note)
  const vector = await vectorMemory.remember(note)
  if (vector && vector.ok) {
    note.embeddingModel = note.embeddingModel || vector.embeddingModel
    note.vectorId = note.vectorId || vector.vectorId
  }
  return { ok: true, memory: note, vector, context: agentContextSnapshot(agent, { limit: 10 }) }
}

async function searchAgentMemories(options = {}) {
  return vectorMemory.search({
    agent: options.agent ? sanitizeEntityName(options.agent) : '',
    q: options.q || options.query || '',
    limit: clampNumber(options.limit || 20, 1, 100, 20)
  })
}

function sanitizeAgentStatusReport(body = {}) {
  const now = new Date().toISOString()
  const agent = sanitizeEntityName(body.agent)
  const status = normalizeReportId(body.status || body.state || 'info') || 'info'
  const cleanStatus = ['working', 'blocked', 'done', 'idle', 'info', 'need_help'].includes(status) ? status : 'info'
  return {
    id: normalizeReportId(body.id || [agent, 'status', Date.now()].join('-')),
    at: body.at || now,
    agent,
    status: cleanStatus,
    task: String(body.task || body.title || '').trim().slice(0, 200),
    summary: String(body.summary || body.description || body.detail || '').trim().slice(0, 500),
    detail: String(body.detail || body.description || '').trim().slice(0, 800),
    needs: normalizeStringList(body.needs || body.need || body.missing),
    has: normalizeStringList(body.has || body.have || body.inventory),
    projectId: normalizeReportId(body.projectId || body.project || ''),
    position: sanitizeReportPosition(body.position || { x: body.x, y: body.y, z: body.z }),
    source: String(body.source || 'api').trim().slice(0, 40),
    rawMessage: String(body.rawMessage || '').slice(0, 500)
  }
}

function sanitizeAgentMemoryNote(body = {}) {
  const now = new Date().toISOString()
  const agent = sanitizeEntityName(body.agent)
  const text = String(body.text || body.note || body.memory || body.summary || '').trim().slice(0, 800)
  if (!text) throw new Error('memory text is required')
  return {
    id: normalizeReportId(body.id || [agent, 'memory', Date.now()].join('-')),
    at: body.at || now,
    agent,
    kind: normalizeReportId(body.kind || body.type || 'note') || 'note',
    importance: clampNumber(body.importance || body.weight || 1, 1, 5, 1),
    text,
    source: String(body.source || 'api').trim().slice(0, 40),
    embeddingModel: String(body.embeddingModel || body.embedding_model || '').trim().slice(0, 120),
    vectorId: String(body.vectorId || body.vector_id || '').trim().slice(0, 160),
    vectorScore: body.vectorScore === undefined ? undefined : Number(body.vectorScore),
    rawMessage: String(body.rawMessage || '').slice(0, 500)
  }
}

function compactLiveAgentState(rawState, summarizedState) {
  const gameplay = rawState && rawState.gameplay ? rawState.gameplay : {}
  const action = rawState && rawState.action ? rawState.action : {}
  const inventory = rawState && rawState.inventory ? rawState.inventory : {}
  const nearby = rawState && rawState.nearby ? rawState.nearby : {}
  return {
    ...(summarizedState || {}),
    position: gameplay.position || (summarizedState && summarizedState.position) || null,
    gamemode: gameplay.gamemode || (summarizedState && summarizedState.gamemode),
    health: gameplay.health,
    hunger: gameplay.hunger,
    biome: gameplay.biome,
    timeLabel: gameplay.timeLabel,
    currentAction: action.current || (summarizedState && summarizedState.action),
    isIdle: Boolean(action.isIdle || (summarizedState && summarizedState.isIdle)),
    inventory: {
      counts: inventory.counts || {},
      equipment: inventory.equipment || {},
      stacksUsed: inventory.stacksUsed,
      totalSlots: inventory.totalSlots
    },
    nearby: {
      humanPlayers: nearby.humanPlayers || [],
      botPlayers: nearby.botPlayers || [],
      entityTypes: nearby.entityTypes || []
    }
  }
}

function parseStructuredMarker(message, markers) {
  const text = typeof message === 'string' ? message : JSON.stringify(message || '')
  for (const marker of markers) {
    const escaped = marker.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
    const pattern = escaped + '\\s*:?\\s*(\\{[\\s\\S]*\\})'
    const match = text.match(new RegExp(pattern, 'i'))
    if (!match) continue
    try {
      return JSON.parse(match[1])
    } catch {
      return null
    }
  }
  return null
}

function normalizeStringList(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean).slice(0, 24)
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}:${item}`).slice(0, 24)
  return String(value || '').split(/[,;，；]/).map(item => item.trim()).filter(Boolean).slice(0, 24)
}

function sanitizeReportPosition(value) {
  if (!value || typeof value !== 'object') return null
  const x = Number(value.x)
  const y = Number(value.y)
  const z = Number(value.z)
  if (![x, y, z].every(Number.isFinite)) return null
  return { x, y, z }
}

function normalizeReportId(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120)
}

function scoreMemory(row, query) {
  if (!query) return Number(row.importance || 1)
  const haystack = `${row.agent || ''} ${row.kind || ''} ${row.text || ''}`.toLowerCase()
  const terms = query.split(/\s+/).filter(Boolean)
  let score = Number(row.importance || 1)
  for (const term of terms) {
    if (haystack.includes(term)) score += 10
  }
  return score
}
function loadConfig() {
  const defaults = {
    minecraftHost: '127.0.0.1',
    minecraftPort: 25565,
    minecraftServerDir: process.env.MINECRAFT_SERVER_DIR || '',
    mindcraftUrl: 'http://localhost:8080',
    mindcraftDir: path.join(os.homedir(), 'Documents', 'mindcraft'),
    mcpAllowLan: /^(1|true|yes|on)$/i.test(process.env.MINDCRAFT_MCP_ALLOW_LAN || process.env.MCP_ALLOW_LAN || 'false'),
    agentFilter: '',
    assistantMode: 'creative',
    intervalMs: 15000,
    idleCooldownMs: 120000,
    minTaskRuntimeMs: 90000,
    maxConcurrentAgents: Number(process.env.MINDCRAFT_MAX_CONCURRENT_AGENTS || 3),
    liveObserverName: process.env.MINECRAFT_LIVE_OBSERVER || 'live',
    liveObserverAutoSwitch: !/^(0|false|no|off)$/i.test(process.env.MINECRAFT_LIVE_OBSERVER_AUTO_SWITCH || 'true'),
    liveObserverSwitchIntervalMs: Number(process.env.MINECRAFT_LIVE_OBSERVER_SWITCH_INTERVAL_MS || 30000),
    worldDirective: '',
    useLlm: false,
    llmProvider: inferModelProvider({
      llmProvider: process.env.MINDCRAFT_LLM_PROVIDER,
      llmBaseUrl: process.env.MINDCRAFT_LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
    }),
    llmBaseUrl: process.env.MINDCRAFT_LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    llmModel: process.env.MINDCRAFT_LLM_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    codeModel: process.env.MINDCRAFT_CODE_MODEL || process.env.DEEPSEEK_CODE_MODEL || 'deepseek-v4-pro',
    visionProvider: process.env.MINDCRAFT_VISION_PROVIDER || 'ollama',
    visionBaseUrl: process.env.MINDCRAFT_VISION_BASE_URL || 'http://localhost:11434/v1',
    visionModel: process.env.MINDCRAFT_VISION_MODEL || 'qwen3-vl:8b',
    memoryVectorEnabled: !/^(0|false|no|off)$/i.test(process.env.MEMORY_VECTOR_ENABLED || 'true'),
    memoryEmbeddingProvider: process.env.MEMORY_EMBEDDING_PROVIDER || 'openai-compatible',
    memoryEmbeddingBaseUrl: process.env.MEMORY_EMBEDDING_BASE_URL || 'http://127.0.0.1:11434/v1',
    memoryEmbeddingModel: process.env.MEMORY_EMBEDDING_MODEL || 'bge-m3',
    memoryVectorStore: process.env.MEMORY_VECTOR_STORE || 'sqlite',
    memoryQdrantUrl: process.env.MEMORY_QDRANT_URL || 'http://127.0.0.1:6333',
    memoryQdrantCollection: process.env.MEMORY_QDRANT_COLLECTION || 'minecraft_agent_memories',
    memoryVectorTimeoutMs: Number(process.env.MEMORY_VECTOR_TIMEOUT_MS || 8000)
  }

  try {
    if (!fs.existsSync(CONFIG_PATH)) return defaults
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    const merged = { ...defaults, ...raw }
    if (!raw.llmProvider) merged.llmProvider = inferModelProvider({ llmBaseUrl: merged.llmBaseUrl })
    const hasVisionConfig = raw.visionProvider || raw.visionBaseUrl || raw.visionModel
    if (!hasVisionConfig && isLikelyVisionModel(merged.llmModel)) {
      merged.visionProvider = merged.llmProvider
      merged.visionBaseUrl = merged.llmBaseUrl
      merged.visionModel = merged.llmModel
      merged.llmProvider = 'deepseek'
      merged.llmBaseUrl = process.env.MINDCRAFT_LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
      merged.llmModel = process.env.MINDCRAFT_LLM_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
      merged.codeModel = process.env.MINDCRAFT_CODE_MODEL || process.env.DEEPSEEK_CODE_MODEL || 'deepseek-v4-pro'
    }
    if (!raw.visionProvider) merged.visionProvider = inferModelProvider({ llmBaseUrl: merged.visionBaseUrl })
    return merged
  } catch (error) {
    logger.warn(`config load failed: ${error.message}`)
    return defaults
  }
}

function updateConfig(next) {
  if (typeof next.minecraftHost === 'string') config.minecraftHost = next.minecraftHost.trim() || config.minecraftHost
  if (next.minecraftPort) config.minecraftPort = clampNumber(next.minecraftPort, 1, 65535, config.minecraftPort)
  if (typeof next.minecraftServerDir === 'string') config.minecraftServerDir = next.minecraftServerDir.trim()
  if (typeof next.mindcraftUrl === 'string') config.mindcraftUrl = next.mindcraftUrl.trim() || config.mindcraftUrl
  if (typeof next.mindcraftDir === 'string') config.mindcraftDir = next.mindcraftDir.trim() || config.mindcraftDir
  if (typeof next.mcpAllowLan === 'boolean') config.mcpAllowLan = next.mcpAllowLan
  if (typeof next.agentFilter === 'string') config.agentFilter = next.agentFilter
  if (typeof next.assistantMode === 'string') config.assistantMode = normalizeAssistantMode(next.assistantMode)
  if (next.intervalMs) config.intervalMs = clampNumber(next.intervalMs, 5000, 600000, config.intervalMs)
  if (next.idleCooldownMs) config.idleCooldownMs = clampNumber(next.idleCooldownMs, 10000, 3600000, config.idleCooldownMs)
  if (next.minTaskRuntimeMs) config.minTaskRuntimeMs = clampNumber(next.minTaskRuntimeMs, 10000, 3600000, config.minTaskRuntimeMs)
  if (next.maxConcurrentAgents) config.maxConcurrentAgents = clampNumber(next.maxConcurrentAgents, 1, 8, config.maxConcurrentAgents || 3)
  if (typeof next.liveObserverName === 'string') config.liveObserverName = next.liveObserverName.trim() || config.liveObserverName
  if (typeof next.liveObserverAutoSwitch === 'boolean') config.liveObserverAutoSwitch = next.liveObserverAutoSwitch
  if (next.liveObserverSwitchIntervalMs) config.liveObserverSwitchIntervalMs = clampNumber(next.liveObserverSwitchIntervalMs, 10000, 600000, config.liveObserverSwitchIntervalMs || 30000)
  if (typeof next.worldDirective === 'string') config.worldDirective = next.worldDirective.trim().slice(0, 1400)
  if (typeof next.useLlm === 'boolean') config.useLlm = next.useLlm
  if (typeof next.llmProvider === 'string') config.llmProvider = inferModelProvider({ llmProvider: next.llmProvider })
  if (typeof next.llmBaseUrl === 'string') config.llmBaseUrl = next.llmBaseUrl.trim() || config.llmBaseUrl
  if (typeof next.llmModel === 'string') config.llmModel = next.llmModel.trim() || config.llmModel
  if (typeof next.codeModel === 'string') config.codeModel = next.codeModel.trim() || config.codeModel
  if (typeof next.visionProvider === 'string') config.visionProvider = inferModelProvider({ llmProvider: next.visionProvider })
  if (typeof next.visionBaseUrl === 'string') config.visionBaseUrl = next.visionBaseUrl.trim() || config.visionBaseUrl
  if (typeof next.visionModel === 'string') config.visionModel = next.visionModel.trim() || config.visionModel
  if (typeof next.memoryVectorEnabled === 'boolean') config.memoryVectorEnabled = next.memoryVectorEnabled
  if (typeof next.memoryEmbeddingProvider === 'string') config.memoryEmbeddingProvider = normalizeVectorProvider(next.memoryEmbeddingProvider)
  if (typeof next.memoryEmbeddingBaseUrl === 'string') config.memoryEmbeddingBaseUrl = next.memoryEmbeddingBaseUrl.trim() || config.memoryEmbeddingBaseUrl
  if (typeof next.memoryEmbeddingModel === 'string') config.memoryEmbeddingModel = next.memoryEmbeddingModel.trim() || config.memoryEmbeddingModel
  if (typeof next.memoryVectorStore === 'string') config.memoryVectorStore = normalizeVectorStore(next.memoryVectorStore)
  if (typeof next.memoryQdrantUrl === 'string') config.memoryQdrantUrl = next.memoryQdrantUrl.trim() || config.memoryQdrantUrl
  if (typeof next.memoryQdrantCollection === 'string') config.memoryQdrantCollection = next.memoryQdrantCollection.trim() || config.memoryQdrantCollection
  if (next.memoryVectorTimeoutMs) config.memoryVectorTimeoutMs = clampNumber(next.memoryVectorTimeoutMs, 1000, 60000, config.memoryVectorTimeoutMs || 8000)
  if (!config.llmProvider) config.llmProvider = inferModelProvider(config)
  if (!config.visionProvider) config.visionProvider = inferModelProvider({ llmBaseUrl: config.visionBaseUrl })

  syncLiveObserverFromConfig()
  client.updateBaseUrl(config.mindcraftUrl)
  autopilot.configure({
    intervalMs: config.intervalMs,
    idleCooldownMs: config.idleCooldownMs,
    minTaskRuntimeMs: config.minTaskRuntimeMs,
    maxConcurrentAgents: config.maxConcurrentAgents,
    agentFilter: parseCsv(config.agentFilter),
    assistantMode: config.assistantMode,
    useLlm: config.useLlm,
    llmBaseUrl: config.llmBaseUrl,
    llmModel: config.llmModel,
    llmApiKey: getConfiguredLlmApiKey(config, runtimeEnv()),
    worldDirective: config.worldDirective
  })
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

function publicConfig() {
  const textProviderId = inferModelProvider(config)
  const visionProviderId = inferModelProvider({ llmProvider: config.visionProvider, llmBaseUrl: config.visionBaseUrl })
  const env = runtimeEnv()
  const envStatus = getProviderEnvStatus(config, env, textProviderId)
  const visionEnvStatus = getProviderEnvStatus(config, env, visionProviderId)
  const secretStatus = secretEnvStatus(env)
  return {
    ...config,
    llmProvider: textProviderId,
    visionProvider: visionProviderId,
    llmApiKeyFromEnv: envStatus.keyDetected,
    llmAuthReady: envStatus.authReady,
    llmKeyEnvNames: envStatus.detectedEnvNames,
    llmAcceptedEnvNames: envStatus.acceptedEnvNames,
    llmMindcraftKeyEnv: envStatus.mindcraftKeyEnv,
    secretFilesLoaded: secretStatus.loadedFiles.length,
    visionApiKeyFromEnv: visionEnvStatus.keyDetected,
    visionAuthReady: visionEnvStatus.authReady,
    visionKeyEnvNames: visionEnvStatus.detectedEnvNames,
    visionAcceptedEnvNames: visionEnvStatus.acceptedEnvNames,
    visionMindcraftKeyEnv: visionEnvStatus.mindcraftKeyEnv
  }
}

async function modelStatusSnapshot(socketSnapshot = {}) {
  const cfg = publicConfig()
  const textProvider = getModelProvider(cfg.llmProvider)
  const visionProvider = getModelProvider(cfg.visionProvider)
  const activeAgentNames = new Set(((socketSnapshot && socketSnapshot.agents) || []).map(agent => agent.name).filter(Boolean))
  const profiles = await mindcraftProfileModelSummaries(config.mindcraftDir, activeAgentNames)
  const activeProfiles = profiles.filter(profile => profile.active)
  const residentSummary = summarizeResidentModels(activeProfiles.length > 0 ? activeProfiles : profiles, cfg, textProvider)

  return {
    generatedAt: new Date().toISOString(),
    commander: {
      role: '主控/AI村长',
      provider: textProvider.id,
      providerLabel: textProvider.label,
      model: cfg.llmModel || '',
      codeModel: cfg.codeModel || cfg.llmModel || '',
      baseUrl: safeEndpointLabel(cfg.llmBaseUrl),
      enabled: Boolean(cfg.useLlm),
      authReady: Boolean(cfg.llmAuthReady || allowsNoAuthEndpoint(cfg.llmBaseUrl)),
      keyDetected: Boolean(cfg.llmApiKeyFromEnv),
      source: '控制台 LLM 配置'
    },
    residents: residentSummary,
    vision: {
      role: '视觉识别',
      provider: visionProvider.id,
      providerLabel: visionProvider.label,
      model: cfg.visionModel || '',
      baseUrl: safeEndpointLabel(cfg.visionBaseUrl),
      authReady: Boolean(cfg.visionAuthReady || allowsNoAuthEndpoint(cfg.visionBaseUrl)),
      keyDetected: Boolean(cfg.visionApiKeyFromEnv),
      source: '控制台视觉配置'
    },
    memory: {
      role: '长期记忆向量',
      enabled: Boolean(cfg.memoryVectorEnabled),
      provider: cfg.memoryEmbeddingProvider || '',
      model: cfg.memoryEmbeddingModel || '',
      baseUrl: safeEndpointLabel(cfg.memoryEmbeddingBaseUrl),
      store: cfg.memoryVectorStore || 'sqlite'
    },
    profiles
  }
}

async function mindcraftProfileModelSummaries(mindcraftDir, activeAgentNames = new Set()) {
  try {
    if (!mindcraftDir || !fs.existsSync(mindcraftDir)) return []
    const mindcraftConfig = await readMindcraftConfig(mindcraftDir)
    const optionPaths = new Set((mindcraftConfig.profileOptions || []).map(option => option.path))
    const configuredProfiles = Array.isArray(mindcraftConfig.settings && mindcraftConfig.settings.profiles) ? mindcraftConfig.settings.profiles : []
    const profilePaths = Array.from(new Set([...configuredProfiles, ...Array.from(optionPaths)]))
      .filter(profilePath => optionPaths.has(profilePath))
      .slice(0, 30)
    const root = path.resolve(mindcraftDir)

    return profilePaths.map(profilePath => {
      const fullPath = path.resolve(root, profilePath.replace(/^\.\//, ''))
      const relative = path.relative(root, fullPath)
      if (relative.startsWith('..') || path.isAbsolute(relative) || path.basename(fullPath) === 'keys.json') return null
      if (!fs.existsSync(fullPath)) return null
      const profile = JSON.parse(fs.readFileSync(fullPath, 'utf8'))
      const name = String(profile.name || path.basename(profilePath, '.json')).slice(0, 60)
      return {
        name,
        profilePath,
        active: activeAgentNames.has(name),
        model: summarizeMindcraftModelEntry(profile.model),
        codeModel: summarizeMindcraftModelEntry(profile.code_model),
        visionModel: summarizeMindcraftModelEntry(profile.vision_model),
        speakModel: safeText(profile.speak_model, 80)
      }
    }).filter(Boolean)
  } catch (error) {
    logger.warn(`Read Mindcraft profile model summary failed: ${error.message}`)
    return []
  }
}

function summarizeResidentModels(profiles, cfg, textProvider) {
  const modelEntries = (profiles || []).map(profile => profile.model).filter(entry => entry && (entry.model || entry.api || entry.baseUrl))
  if (modelEntries.length === 0) {
    return {
      role: 'AI居民/Mindcraft Profile',
      provider: textProvider.id,
      providerLabel: textProvider.label,
      model: cfg.llmModel || '',
      codeModel: cfg.codeModel || cfg.llmModel || '',
      baseUrl: safeEndpointLabel(cfg.llmBaseUrl),
      profileCount: profiles.length,
      activeProfileCount: profiles.filter(profile => profile.active).length,
      mixed: false,
      source: '控制台默认配置（新建居民会使用）'
    }
  }
  const groups = Array.from(new Set(modelEntries.map(entry => [entry.api || '', entry.model || '', entry.baseUrl || ''].join('|'))))
  const first = modelEntries[0]
  const providerId = providerIdFromModelEntry(first)
  return {
    role: 'AI居民/Mindcraft Profile',
    provider: groups.length > 1 ? 'mixed' : providerId,
    providerLabel: groups.length > 1 ? '多供应商/多模型' : providerLabelFromId(providerId, first.api),
    model: groups.length > 1 ? `多个模型（${groups.length} 组）` : first.model || '',
    codeModel: summarizeCodeModelFromProfiles(profiles),
    baseUrl: groups.length > 1 ? '' : first.baseUrl || '',
    profileCount: profiles.length,
    activeProfileCount: profiles.filter(profile => profile.active).length,
    mixed: groups.length > 1,
    source: 'Mindcraft Profile 实际配置'
  }
}

function summarizeCodeModelFromProfiles(profiles) {
  const entries = (profiles || []).map(profile => profile.codeModel).filter(entry => entry && entry.model)
  const models = Array.from(new Set(entries.map(entry => entry.model)))
  if (models.length === 0) return ''
  return models.length === 1 ? models[0] : `多个模型（${models.length} 组）`
}

function summarizeMindcraftModelEntry(entry) {
  if (!entry) return null
  if (typeof entry === 'string') {
    return { api: '', model: safeText(entry, 160), baseUrl: '', provider: '' }
  }
  if (typeof entry !== 'object') return null
  const api = safeText(entry.api || entry.provider || '', 80)
  const model = safeText(entry.model || entry.name || '', 160)
  const baseUrl = safeEndpointLabel(entry.url || entry.baseUrl || entry.base_url || '')
  return { api, model, baseUrl, provider: providerIdFromModelEntry({ api, baseUrl }) }
}

function providerIdFromModelEntry(entry) {
  const api = String(entry && entry.api || '').toLowerCase()
  const baseUrl = String(entry && entry.baseUrl || '').toLowerCase()
  if (api.includes('ollama') || baseUrl.includes('11434')) return 'ollama'
  if (api.includes('deepseek') || baseUrl.includes('deepseek')) return 'deepseek'
  if (api.includes('qwen') || baseUrl.includes('dashscope') || baseUrl.includes('aliyuncs')) return 'aliyun-qwen'
  if (api.includes('openrouter') || baseUrl.includes('openrouter')) return 'openrouter'
  if (api.includes('openai')) return 'openai-compatible'
  return 'openai-compatible'
}

function providerLabelFromId(id, fallback) {
  const provider = getModelProvider(id)
  return provider && provider.label ? provider.label : safeText(fallback || id, 80)
}

function safeEndpointLabel(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`
  } catch {
    return raw.replace(/[?&](api[_-]?key|key|token|secret)=[^&]+/gi, '$1=***').slice(0, 180)
  }
}

function safeText(value, maxLength) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength)
}
async function createAndJoinAgent(body) {
  await ensureMinecraftServerReady()

  const profile = buildDefaultAgentProfile(body.name)
  const saved = await createMindcraftAgentProfile(config.mindcraftDir, {
    name: body.name,
    profile,
    overwrite: Boolean(body.overwrite),
    reuseExisting: true
  })
  logger.info(`Prepared AI agent profile ${saved.profilePath}`)

  let mindcraftResult = null
  if (!(await testHttp(config.mindcraftUrl))) {
    await startMindcraft()
    await waitFor(() => testHttp(config.mindcraftUrl), 30000, '等待 Mindcraft 启动超时')
  }
  await waitFor(() => client.connected, 15000, '等待 Mindcraft socket 连接超时')

  mindcraftResult = await client.createAgent(saved.runtimeSettings)
  if (!mindcraftResult || mindcraftResult.success === false) {
    const error = mindcraftResult && mindcraftResult.error ? String(mindcraftResult.error) : 'unknown error'
    if (/already exists/i.test(error)) {
      await client.startAgent(saved.profile.name)
      mindcraftResult = { success: true, error: null, alreadyExisted: true }
    } else {
      throw new Error(`Mindcraft 创建 AI 失败：${error}`)
    }
  }

  return {
    ok: true,
    agent: saved.profile.name,
    profilePath: saved.profilePath,
    mindcraft: mindcraftResult
  }
}

async function ensureMinecraftServerReady() {
  const runtime = await minecraftServer.snapshot(config)
  if (runtime.tcpOpen) return runtime
  await minecraftServer.start(config)
  await waitFor(async () => {
    const nextRuntime = await minecraftServer.snapshot(config)
    return nextRuntime.tcpOpen
  }, 90000, '等待 Minecraft Server 启动超时')
  return minecraftServer.snapshot(config)
}

async function locatePlayer(playerName) {
  await ensureMinecraftServerReady()
  const result = await minecraftServer.queryPlayerPosition(playerName, config)
  return { ok: true, ...result }
}

async function guideAgentsToPlayer(body) {
  const location = await locatePlayer(body.player)
  const position = location.position
  const targets = parseCsv(body.agent).length > 0 ? parseCsv(body.agent) : client.onlineAgentNames([])
  if (targets.length === 0) throw new Error('没有在线 AI 可召回。')

  if (body.teleport === true) {
    for (const agentName of targets) {
      await minecraftServer.sendCommand(`tp ${sanitizeEntityName(agentName)} ${sanitizeEntityName(location.player)}`, config)
    }
    logger.info(`Teleported agents to ${location.player}: ${targets.join(', ')}`)
    return { ok: true, mode: 'teleport', player: location.player, position, targets }
  }

  const task = [
    '立刻停止当前采集、打猎、探索或建造任务。',
    `玩家 ${location.player} 当前坐标是 X=${position.x.toFixed(2)}, Y=${position.y.toFixed(2)}, Z=${position.z.toFixed(2)}。`,
    `请直接执行 !goToCoordinates(${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}, 3)。`,
    `到达后看向玩家 ${location.player} 并报告你已经找到他。不要改去收集木材。`
  ].join(' ')

  await runLimited(targets, config.maxConcurrentAgents, async agentName => {
    await autopilot.sendManualTask(agentName, task)
    villageState.recordTaskEvent({
      type: 'assigned',
      status: 'active',
      source: 'manual',
      agent: agentName,
      title: '手动任务',
      description: task
    })
  })
  logger.info(`Guided agents to ${location.player}: ${targets.join(', ')}`)
  return { ok: true, mode: 'walk', player: location.player, position, targets, task }
}

async function sendTask(body = {}) {
  const task = String(body.task || '').trim()
  const agents = parseCsv(body.agent || body.agent_name || config.agentFilter)
  if (!task) throw new Error('task is required')
  const targets = agents.length > 0 ? agents : client.onlineAgentNames([])
  if (targets.length === 0) throw new Error('no online agents found')
  const sent = []
  await runLimited(targets, config.maxConcurrentAgents, async agentName => {
    await autopilot.sendManualTask(agentName, task)
    villageState.recordTaskEvent({
      type: 'assigned',
      status: 'active',
      source: body.source || 'manual',
      agent: agentName,
      title: body.title || '手动任务',
      description: task
    })
    sent.push(agentName)
  })
  return { ok: true, targets: sent }
}

function societySnapshot() {
  const village = villageState.snapshot()
  const socket = client.snapshot()
  const online = new Set((socket.agents || []).filter(agent => agent.in_game).map(agent => agent.name))
  const residentNames = villageResidentNames(village)
  const commanderLlm = commanderLlmStatus()
  return {
    directive: config.worldDirective || DEFAULT_RESIDENT_DIRECTIVE,
    assistantMode: config.assistantMode,
    agentFilter: config.agentFilter,
    autopilotActive: autopilot.active,
    commanderLlm,
    residents: residentNames.map(agentName => ({
      agent: agentName,
      online: online.has(agentName),
      assignment: villageState.assignmentFor(agentName)
    })),
    onlineAgents: Array.from(online),
    village
  }
}

function activateSocietyMode(body = {}) {
  const village = villageState.snapshot()
  const residents = parseCsv(body.agentFilter).length > 0 ? parseCsv(body.agentFilter) : villageResidentNames(village)
  config.assistantMode = 'survival'
  config.agentFilter = residents.join(',')
  config.worldDirective = String(body.worldDirective || config.worldDirective || DEFAULT_RESIDENT_DIRECTIVE).trim().slice(0, 1400)
  saveConfig()
  autopilot.configure({
    intervalMs: config.intervalMs,
    idleCooldownMs: config.idleCooldownMs,
    minTaskRuntimeMs: config.minTaskRuntimeMs,
    maxConcurrentAgents: config.maxConcurrentAgents,
    agentFilter: residents,
    assistantMode: config.assistantMode,
    useLlm: config.useLlm,
    llmBaseUrl: config.llmBaseUrl,
    llmModel: config.llmModel,
    llmApiKey: getConfiguredLlmApiKey(config, runtimeEnv()),
    worldDirective: config.worldDirective
  })
  if (body.startAutopilot !== false) autopilot.start()
  logger.info(`Activated resident society mode for: ${residents.join(', ')}`)
  return {
    ok: true,
    residents,
    directive: config.worldDirective,
    config: publicConfig(),
    autopilot: autopilot.snapshot(),
    society: societySnapshot()
  }
}

async function ensureSocietyResidents(body = {}) {
  await ensureMinecraftServerReady()

  if (!(await testHttp(config.mindcraftUrl))) {
    await startMindcraft()
    await waitFor(() => testHttp(config.mindcraftUrl), 30000, '等待 Mindcraft 启动超时')
  }
  await waitFor(() => client.connected, 30000, '等待 Mindcraft socket 连接超时')

  const requested = parseCsv(body.agentFilter || body.agents)
  const residents = requested.length > 0 ? requested : villageResidentNames(villageState.snapshot())
  const guardrails = await applyMindcraftResidentGuardrails(config.mindcraftDir, residents)
  if (guardrails.changed) {
    logger.info(`Applied Mindcraft resident guardrails: settingsChanged=${guardrails.settingsChanged}, profiles=${guardrails.profileChanges.map(item => item.name).join(', ') || 'none'}`)
  }
  const results = []

  for (const agentName of residents) {
    const current = (client.snapshot().agents || []).find(agent => agent.name === agentName)
    try {
      if (current && current.in_game && guardrails.changed) {
        await client.stopAgent(agentName)
        await waitFor(() => !(client.snapshot().agents || []).find(agent => agent.name === agentName && agent.in_game), 15000, `等待 ${agentName} 退出以应用防闲聊配置超时`)
        await client.startAgent(agentName)
        results.push({ agent: agentName, ok: true, action: 'restarted_for_guardrails' })
      } else if (current && current.in_game) {
        results.push({ agent: agentName, ok: true, action: 'already_online' })
      } else if (current) {
        await client.startAgent(agentName)
        results.push({ agent: agentName, ok: true, action: 'started' })
      } else {
        const created = await createAndJoinAgent({ name: agentName, overwrite: false })
        results.push({ agent: agentName, ok: true, action: created.mindcraft && created.mindcraft.alreadyExisted ? 'reused_profile' : 'created' })
      }
      villageState.recordTaskEvent({
        type: 'assigned',
        status: 'active',
        source: 'system',
        agent: agentName,
        title: '恢复居民进服',
        description: '确保 AI 居民 Profile 存在、Mindcraft 已连接，并请求进入 Minecraft 服务器。'
      })
    } catch (error) {
      results.push({ agent: agentName, ok: false, error: error.message })
      logger.warn(`Failed to ensure resident ${agentName}: ${error.message}`)
    }
  }

  const failed = results.filter(item => !item.ok)
  if (body.activateSociety !== false) {
    activateSocietyMode({
      agentFilter: residents.join(','),
      startAutopilot: body.startAutopilot !== false,
      worldDirective: body.worldDirective
    })
  }

  return {
    ok: failed.length === 0,
    residents,
    guardrails,
    results,
    failed,
    society: societySnapshot()
  }
}
async function dispatchSocietyTasks(body = {}) {
  if (!client.connected) throw new Error('Mindcraft socket is not connected')
  const requested = parseCsv(body.agent || body.agents)
  const allowed = requested.length > 0 ? requested : villageResidentNames(villageState.snapshot())
  const online = new Set(client.onlineAgentNames([]))
  const targets = allowed.filter(agentName => online.has(agentName))
  if (targets.length === 0) {
    throw new Error('没有在线 AI 居民可派发任务。请先让 AI 进服。')
  }

  const sent = []
  const commanderPlan = await decideSocietyTasksWithLlm(targets, body.goal)
  await runLimited(targets, config.maxConcurrentAgents, async agentName => {
    const aiAssignment = commanderPlan.assignments.get(agentName)
    const task = aiAssignment ? aiAssignment.task : buildSocietyResidentTask(agentName, body.goal)
    await autopilot.sendManualTask(agentName, task)
    const assignment = villageState.assignmentFor(agentName)
    villageState.recordTaskEvent({
      type: 'assigned',
      status: 'active',
      source: aiAssignment ? 'ai-commander' : 'commander',
      agent: agentName,
      title: aiAssignment && aiAssignment.title
        ? aiAssignment.title
        : assignment.role ? '派发任务：' + assignment.role.role : '派发村庄任务',
      description: task,
      projectId: aiAssignment && aiAssignment.projectId
        ? aiAssignment.projectId
        : assignment.project && assignment.project.id
    })
    sent.push({ agent: agentName, task, source: aiAssignment ? 'ai-commander' : 'fallback-commander' })
  })
  const skipped = allowed.filter(agentName => !online.has(agentName))
  logger.info(`Dispatched resident village tasks to: ${sent.map(item => item.agent).join(', ')} (${commanderPlan.usedLlm ? 'AI commander' : 'fallback commander'})`)
  return { ok: true, sent, skipped, commander: commanderPlan.status, society: societySnapshot() }
}

async function focusLiveObserver(body = {}) {
  const observer = sanitizeEntityName(body.observer || body.observerName || config.liveObserverName || 'live')
  const rawTarget = String(body.target || body.agent || 'auto').trim()
  const autoTarget = !rawTarget || rawTarget.toLowerCase() === 'auto'
  const target = autoTarget
    ? chooseLiveObserverTarget(observer, { avoidCurrent: false })
    : sanitizeEntityName(rawTarget)
  if (!target) throw new Error('没有可观察的在线 AI。')

  await ensureMinecraftServerReady()
  await sendLiveObserverCommands(observer, target)
  recordLiveObserverSwitch(observer, target, null)
  if (autoTarget) {
    config.liveObserverAutoSwitch = true
    liveObserverState.active = true
    saveConfig()
    scheduleLiveObserverSwitch(liveObserverState.switchIntervalMs)
  }
  logger.info(`Focused live observer ${observer} on ${target}`)
  return {
    ok: true,
    observer,
    target,
    mode: autoTarget ? 'auto-active-agent' : 'explicit-target',
    commands: [`gamemode spectator ${observer}`, `spectate ${target} ${observer}`],
    livestream: liveObserverSnapshot()
  }
}

function chooseActiveAgentForObserver(observer) {
  return chooseLiveObserverTarget(observer, { avoidCurrent: false })
}

function chooseLiveObserverTarget(observer, options = {}) {
  const ranked = rankedLiveObserverCandidates(observer)
  liveObserverState.lastCandidates = ranked.map(item => ({ agent: item.agentName, score: item.score }))
  if (ranked.length === 0) return ''
  if (!options.avoidCurrent || ranked.length === 1 || !liveObserverState.currentTarget) return ranked[0].agentName

  const preferred = liveObserverPreferredCandidate(ranked)
  if (preferred && preferred.agentName !== liveObserverState.currentTarget) return preferred.agentName

  const names = ranked.map(item => item.agentName)
  const currentIndex = names.indexOf(liveObserverState.currentTarget)
  if (currentIndex === -1) return ranked[0].agentName
  return names[(currentIndex + 1) % names.length]
}

function rankedLiveObserverCandidates(observer) {
  const socket = client.snapshot()
  const onlineNames = (socket.agents || []).filter(agent => agent.in_game).map(agent => agent.name)
  const online = new Set(onlineNames)
  const villageNames = villageResidentNames(villageState.snapshot())
  const candidates = Array.from(new Set([...villageNames, ...onlineNames]))
    .filter(agentName => online.has(agentName) && agentName !== observer)
  const ranked = candidates
    .map(agentName => ({ agentName, score: liveActivityScore(agentName) }))
    .sort((a, b) => b.score - a.score || a.agentName.localeCompare(b.agentName))
  return ranked
}

function uniqueLiveObserverCandidates(items) {
  const seen = new Set()
  return (items || []).filter(item => {
    const key = item.agentName
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function liveObserverPreferredCandidate(ranked) {
  const preferred = String(LIVE_OBSERVER_PREFERRED_AGENT || '').trim().toLowerCase()
  if (!preferred) return null
  return (ranked || []).find(item => String(item.agentName || '').toLowerCase() === preferred) || null
}

async function sendLiveObserverCommands(observer, target) {
  const modeResult = await minecraftServer.sendCommand(`gamemode spectator ${observer}`, config)
  assertMinecraftCommandSucceeded(modeResult, `观察者账号 ${observer} 不在线，无法切换直播视角。`)
  try {
    await minecraftServer.sendCommand(`execute at ${target} run tp ${observer} ~ ~ ~`, config)
  } catch (error) {
    logger.warn(`Live observer pre-teleport skipped for ${observer} -> ${target}: ${error.message}`)
  }
  const spectateResult = await minecraftServer.sendCommand(`spectate ${target} ${observer}`, config)
  assertMinecraftCommandSucceeded(spectateResult, `无法让 ${observer} 旁观 ${target}，请确认两个账号都在线。`)
}

function assertMinecraftCommandSucceeded(result, message) {
  const response = String(result && result.response || '')
  if (/No player was found|No entity was found|That player cannot be found|Unknown or incomplete command|Incorrect argument/i.test(response)) {
    throw new Error(message + (response ? ' 服务端返回：' + response : ''))
  }
}

async function runLiveObserverSwitch() {
  try {
    if (!liveObserverState.active) return
    const runtime = await minecraftServer.snapshot(config)
    if (!runtime.tcpOpen || !runtime.canSendCommand) {
      throw new Error('Minecraft 未在线或不是控制台托管，暂不能自动切换观察者。')
    }
    const observer = sanitizeEntityName(config.liveObserverName || liveObserverState.observer || 'live')
    const target = chooseLiveObserverTarget(observer, { avoidCurrent: true })
    if (!target) throw new Error('没有可观察的在线 AI。')
    await sendLiveObserverCommands(observer, target)
    recordLiveObserverSwitch(observer, target, null)
    logger.info(`Auto-switched live observer ${observer} to ${target}`)
  } catch (error) {
    recordLiveObserverSwitch(liveObserverState.observer, liveObserverState.currentTarget, error)
    logger.warn(`Live observer auto-switch skipped: ${error.message}`)
  } finally {
    scheduleLiveObserverSwitch(liveObserverState.switchIntervalMs)
  }
}

function recordLiveObserverSwitch(observer, target, error) {
  liveObserverState.observer = observer || liveObserverState.observer || 'live'
  if (target) liveObserverState.currentTarget = target
  if (!error && target) {
    liveObserverState.lastSwitchedAt = new Date().toISOString()
    liveObserverState.lastFollowRefreshAt = liveObserverState.lastSwitchedAt
    liveObserverState.lastFollowError = null
    scheduleLiveObserverFollowRefresh(LIVE_OBSERVER_FOLLOW_REFRESH_MS)
  }
  liveObserverState.lastError = error ? error.message : null
}
function liveObserverSnapshot() {
  const observer = liveObserverState.observer || config.liveObserverName || 'live'
  const ranked = rankedLiveObserverCandidates(observer)
  liveObserverState.lastCandidates = ranked.map(item => ({ agent: item.agentName, score: item.score }))
  return {
    active: liveObserverState.active,
    observer: liveObserverState.observer,
    currentTarget: liveObserverState.currentTarget,
    switchIntervalMs: liveObserverState.switchIntervalMs,
    lastSwitchedAt: liveObserverState.lastSwitchedAt,
    lastFollowRefreshAt: liveObserverState.lastFollowRefreshAt,
    followRefreshMs: LIVE_OBSERVER_FOLLOW_REFRESH_MS,
    lastError: liveObserverState.lastError || liveObserverState.lastFollowError,
    candidates: liveObserverState.lastCandidates
  }
}
function liveIntelSnapshot(options = {}) {
  const limit = clampNumber(options.limit || 8, 3, 24, 8)
  const village = villageState.snapshot()
  const socket = client.snapshot()
  const residents = villageResidentNames(village)
  const decisions = []
  const thoughts = []
  const residentRows = []

  for (const agentName of residents) {
    const memory = autopilot.agentContext(agentName)
    const current = socket.states && socket.states[agentName] ? socket.states[agentName] : {}
    const role = (village.roles || []).find(item => item.agent === agentName) || {}
    residentRows.push({
      agent: agentName,
      role: role.role || '',
      online: Boolean((socket.agents || []).find(agent => agent.name === agentName && agent.in_game)),
      action: current.action || '',
      position: current.position || null
    })

    const llmDecision = memory.lastCommanderLlmDecision
    if (llmDecision && llmDecision.at) {
      decisions.push({
        at: llmDecision.at,
        agent: agentName,
        source: 'AI村长',
        model: llmDecision.model || config.llmModel || '',
        title: agentName + ' 的新任务',
        text: liveTextSummary(llmDecision.task || memory.lastTaskSummary || '', 1200)
      })
    }

    for (const task of (memory.recentTasks || []).slice(-8)) {
      const source = String(task.source || '')
      if (!/resident-self-goal|resident-direct-action|resident-self-loop|ai-commander|guardrail|water-rescue|teleport|fallback-commander/i.test(source)) continue
      decisions.push({
        at: task.at || '',
        agent: agentName,
        source: sourceLabel(source),
        model: source === 'ai-commander-llm' ? config.llmModel || '' : '',
        title: task.title || agentName + ' 派工',
        text: liveTextSummary(task.task || '', 1200)
      })
    }

    for (const output of (memory.recentOutputs || []).slice(-12)) {
      const item = liveThoughtFromOutput(agentName, output)
      if (item) thoughts.push(item)
    }

    for (const report of (memory.statusReports || []).slice(-4)) {
      const summary = liveTextSummary(report.summary || report.task || report.detail || '', 700)
      if (!summary) continue
      thoughts.push({
        at: report.at || '',
        agent: agentName,
        kind: report.status === 'blocked' ? '受阻' : report.status === 'done' ? '完成' : '状态',
        text: summary
      })
    }
  }

  for (const report of dataStore.recentInfrastructureReports(limit * 2)) {
    thoughts.push({
      at: report.updatedAt || report.createdAt || '',
      agent: report.agent || '村庄',
      kind: infrastructureStatusLabel(report.status),
      text: liveTextSummary((report.title || report.type || '公共设施') + '：' + (report.description || ''), 500)
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    livestream: liveObserverSnapshot(),
    commander: {
      name: village.commander && village.commander.name || 'Airi',
      title: village.commander && village.commander.title || 'AI村长',
      model: config.llmModel || '',
      decisions: uniqueLiveItems(decisions).sort(byAtDesc).slice(0, limit)
    },
    thoughts: uniqueLiveItems(thoughts).sort(byAtDesc).slice(0, limit + 2),
    residents: residentRows
  }
}

function liveThoughtFromOutput(agent, output) {
  const at = output && output.at || ''
  const raw = String(output && (output.text || output.message) || '')
  if (!raw.trim()) return null
  if (/\*管理员使用|NEARBY_ENTITIES/i.test(raw)) return null
  let kind = '想法'
  if (/VILLAGE_REPORT|村庄上报/i.test(raw)) kind = '上报'
  else if (/受阻|blocked|stuck|卡住/i.test(raw)) kind = '受阻'
  else if (/完成|done|已放置|已存入/i.test(raw)) kind = '完成'
  else if (/Thinking:|思考[:：]/i.test(raw)) kind = '思考'
  else if (/代理写了这段代码/i.test(raw) || /`{3,}/.test(raw)) kind = '行动代码'
  else if (!/需要|计划|正在|目标|坐标|公共箱|床|农田|矿|树|羊|牛|物资/i.test(raw)) return null
  const text = liveTextSummary(raw, kind === '行动代码' ? 500 : 900)
  if (!text) return null
  return { at, agent, kind, text }
}

function liveTextSummary(value, maxLength = 1200) {
  let text = String(value || '')
    .replace(/`{3,}[\s\S]*?`{3,}/g, ' 正在生成行动代码。 ')
    .replace(/代理写了这段代码[:：]?/g, '正在生成行动代码：')
    .replace(/Thinking\s*:/gi, '思考：')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  text = text.replace(/^生存任务：优先安全、食物、庇护、照明和基地附近短目标。/, '')
  text = text.replace(/^创造练习任务：/, '')
  if (text.length > maxLength) text = text.slice(0, Math.max(20, maxLength - 1)).trim() + '…'
  return text
}

function uniqueLiveItems(items) {
  const seen = new Set()
  return (items || []).filter(item => {
    const textKey = String(item.text || '').replace(/\s+/g, ' ').trim().slice(0, 260).toLowerCase()
    const key = [item.agent || '', textKey].join('|')
    if (!textKey || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function byAtDesc(a, b) {
  return String(b.at || '').localeCompare(String(a.at || ''))
}

function sourceLabel(source) {
  if (/resident-self-goal/i.test(source)) return '居民长期目标'
  if (/resident-direct-action/i.test(source)) return '居民行动心跳'
  if (/resident-self-loop/i.test(source)) return '居民自治'
  if (/ai-commander-llm/i.test(source)) return 'AI村长'
  if (/water-rescue/i.test(source)) return '脱困守卫'
  if (/teleport/i.test(source)) return '传送调度'
  if (/guardrail/i.test(source)) return '安全守卫'
  if (/fallback/i.test(source)) return '兜底策略'
  return source || '系统'
}

function infrastructureStatusLabel(status) {
  return { started: '开始', done: '完成', blocked: '受阻' }[String(status || '')] || '上报'
}
function setLiveObserverAutoSwitch(body = {}) {
  if (typeof body.observer === 'string' || typeof body.observerName === 'string') {
    config.liveObserverName = String(body.observer || body.observerName).trim() || config.liveObserverName
  }
  if (typeof body.active === 'boolean') config.liveObserverAutoSwitch = body.active
  if (body.intervalMs || body.switchIntervalMs) {
    config.liveObserverSwitchIntervalMs = clampNumber(body.intervalMs || body.switchIntervalMs, 10000, 600000, config.liveObserverSwitchIntervalMs || 30000)
  }
  saveConfig()
  syncLiveObserverFromConfig()
  if (liveObserverState.active) scheduleLiveObserverSwitch(1000)
  return { ok: true, livestream: liveObserverSnapshot() }
}

function syncLiveObserverFromConfig() {
  liveObserverState.observer = config.liveObserverName || liveObserverState.observer || 'live'
  liveObserverState.switchIntervalMs = clampNumber(config.liveObserverSwitchIntervalMs || liveObserverState.switchIntervalMs, 10000, 600000, 30000)
  liveObserverState.active = config.liveObserverAutoSwitch !== false
  if (!liveObserverState.active) {
    clearLiveObserverTimer()
    clearLiveObserverFollowTimer()
  } else {
    scheduleLiveObserverSwitch(liveObserverState.switchIntervalMs)
    scheduleLiveObserverFollowRefresh(LIVE_OBSERVER_FOLLOW_REFRESH_MS)
  }
}
function scheduleLiveObserverSwitch(delayMs) {
  clearLiveObserverTimer()
  if (!liveObserverState.active) return
  const waitMs = clampNumber(delayMs || liveObserverState.switchIntervalMs, 1000, 600000, liveObserverState.switchIntervalMs)
  liveObserverState.timer = setTimeout(() => {
    liveObserverState.timer = null
    runLiveObserverSwitch()
  }, waitMs)
  if (liveObserverState.timer.unref) liveObserverState.timer.unref()
}

function clearLiveObserverTimer() {
  if (!liveObserverState.timer) return
  clearTimeout(liveObserverState.timer)
  liveObserverState.timer = null
}

function scheduleLiveObserverFollowRefresh(delayMs) {
  clearLiveObserverFollowTimer()
  if (!liveObserverState.active || !liveObserverState.currentTarget) return
  const waitMs = clampNumber(delayMs || LIVE_OBSERVER_FOLLOW_REFRESH_MS, 2000, 60000, LIVE_OBSERVER_FOLLOW_REFRESH_MS)
  liveObserverState.followTimer = setTimeout(() => {
    liveObserverState.followTimer = null
    runLiveObserverFollowRefresh()
  }, waitMs)
  if (liveObserverState.followTimer.unref) liveObserverState.followTimer.unref()
}

function clearLiveObserverFollowTimer() {
  if (!liveObserverState.followTimer) return
  clearTimeout(liveObserverState.followTimer)
  liveObserverState.followTimer = null
}

async function runLiveObserverFollowRefresh() {
  try {
    if (!liveObserverState.active || !liveObserverState.currentTarget) return
    const observer = sanitizeEntityName(config.liveObserverName || liveObserverState.observer || 'live')
    const target = sanitizeEntityName(liveObserverState.currentTarget)
    if (!observer || !target) return
    try {
      await minecraftServer.sendCommand(`execute at ${target} run tp ${observer} ~ ~ ~`, config)
    } catch (error) {
      logger.warn(`Live observer follow teleport skipped for ${observer} -> ${target}: ${error.message}`)
    }
    const spectateResult = await minecraftServer.sendCommand(`spectate ${target} ${observer}`, config)
    assertMinecraftCommandSucceeded(spectateResult, `无法持续让 ${observer} 旁观 ${target}，请确认两个账号都在线。`)
    liveObserverState.lastFollowRefreshAt = new Date().toISOString()
    liveObserverState.lastFollowError = null
  } catch (error) {
    liveObserverState.lastFollowError = error.message
    logger.warn(`Live observer follow refresh skipped: ${error.message}`)
  } finally {
    scheduleLiveObserverFollowRefresh(LIVE_OBSERVER_FOLLOW_REFRESH_MS)
  }
}
function liveActivityScore(agentName) {
  const rawState = client.latestState && client.latestState[agentName]
  const summarized = (client.snapshot().states || {})[agentName] || {}
  const action = String((rawState && rawState.action && rawState.action.current) || summarized.currentAction || summarized.action || '').toLowerCase()
  const isIdle = Boolean((rawState && rawState.action && rawState.action.isIdle) || summarized.isIdle)
  const movement = recentAgentMovementScore(agentName)
  const staleOrBoring = !action || /stopped|idle|wait|stay|chat|talk|conversation|gotobed|sleep|stats|inventory|viewchest|等待|聊天|停|睡/.test(action)
  const actionIsGeneric = /newaction/.test(action)
  let score = staleOrBoring ? 5 : 20
  if (String(agentName || '').toLowerCase() === String(LIVE_OBSERVER_PREFERRED_AGENT || '').toLowerCase()) score += Number.isFinite(LIVE_OBSERVER_PREFERRED_SCORE_BOOST) ? LIVE_OBSERVER_PREFERRED_SCORE_BOOST : 70
  if (!isIdle && !staleOrBoring && !actionIsGeneric) score += 40
  if (/collect|mine|craft|build|place|goto|search|farm|attack|hunt|hunting|shear|kill|move|travel|dig|break|deposit|harvest|path|house|explore|采|挖|建|放|找|农|狩猎|剪羊毛|移动|房/.test(action)) score += 50
  if (actionIsGeneric && movement.distance >= 10) score += 55
  if (movement.distance >= 25) score += 20
  if (movement.distance >= 60) score += 15
  if (/water|stuck|unstuck|self_defense/.test(action)) score -= 25
  const reports = dataStore.recentAgentStatusReports(agentName, 1)
  const latestReport = reports[0]
  if (latestReport && latestReport.status === 'working') score += 12
  if (latestReport && latestReport.status === 'blocked') score -= 20
  const gameplay = rawState && rawState.gameplay ? rawState.gameplay : {}
  if (Number(gameplay.health || summarized.health || 20) <= 8) score += 10
  return Math.max(0, score)
}

function recentAgentMovementScore(agentName) {
  const observations = dataStore.recentAgentObservations(agentName, 8)
    .filter(row => row && row.position && Number.isFinite(Number(row.position.x)) && Number.isFinite(Number(row.position.z)))
  if (observations.length < 2) return { distance: 0 }
  const latest = observations[0]
  const latestAt = Date.parse(latest.at || '') || Date.now()
  const baseline = observations.find(row => {
    const at = Date.parse(row.at || '') || latestAt
    return latestAt - at <= 120000 && latestAt - at >= 10000
  }) || observations[observations.length - 1]
  const dx = Number(latest.position.x) - Number(baseline.position.x)
  const dz = Number(latest.position.z) - Number(baseline.position.z)
  return { distance: Math.hypot(dx, dz) }
}

function buildSocietyResidentTask(agentName, goal) {
  const extraGoal = String(goal || '').trim()
  const context = villageState.taskContextFor(agentName)
  const agentContext = agentContextSnapshot(agentName, { compact: true, limit: 8 })
  return [
    '生存任务：你是 AI 村庄的常驻居民，不是跟随宠物。',
    `长期目标：${config.worldDirective || DEFAULT_RESIDENT_DIRECTIVE}`,
    `当前村庄上下文：${context}`,
    `你的个人记忆和近期上报：${JSON.stringify(agentContext.memory || {})}`,
    extraGoal ? `本轮真人目标：${extraGoal}` : '本轮目标：继续推进你角色对应的最高优先级村庄项目。',
    '所有公开聊天、思考字幕、协作短句、VILLAGE_REPORT 的 title/description 都必须使用中文。',
    '行动优先：最多先说一句不超过 30 字的中文状态句，然后马上执行移动、采集、放置、入库、合成、查看公共箱或观察实体。不要长篇思考；只聊天、只上报不算完成。',
    '按当前服务器难度调整策略：peaceful 以建设为主；easy/normal/hard 要把基地照明、床、门、围栏、武器、防具、食物和就近自卫放进优先级。不要远距离追怪，但基地附近出现怪物时要保护自己和村庄。允许村长通过服务端瞬移提升探索和回库效率。优先建镇、采矿、公共箱、材料包、工具武器护甲、个人住宅、床、家具、农田和陆地资源勘察。Nova 不修路、不靠近水域。Alex 要多走动，发现资源并带回，制作工具、武器和护甲给大家。',
    '模型执行规则：所有居民聊天/操作使用云端 DeepSeek Flash，复杂代码/动作生成使用 DeepSeek Pro，视觉识别使用 Qwen3.7。Alex 可以承担复杂调度和长一点的任务；其他居民为控制成本和减少冲突，任务仍必须短、原子、坐标明确、最多 3-5 步。所有居民仍然优先由自己的 LLM 判断下一步动作，村长只给高层目标和边界。',
    COLLABORATION_PROTOCOL,
    '采用 MineCollab 式任务纪律：建造任务按区域/层/材料拆分；合成和烹饪先共享库存和配方；后勤任务把多余材料存入公共箱子并上报缺口。',
    '与其他 AI 居民简短中文协调，存放多余材料，避开洞穴、岩浆、长距离旅行；缺配方、缺材料或箱子满了就上报受阻，不要无限重试。',
    '开始、完成或受阻于任何公共基础设施时，在聊天里发送一个精确结构化上报：VILLAGE_REPORT {"type":"storage|resource|lighting|road|farm|mine|house|wall|landmark|other","title":"中文短名","status":"started|done|blocked","public":true,"position":{"x":0,"y":64,"z":0},"description":"中文说明","projectId":"optional","checklistId":"optional"}。'
  ].join(' ')
}

async function decideSocietyTasksWithLlm(targets, goal) {
  const status = commanderLlmStatus()
  if (!status.configured) return { usedLlm: false, assignments: new Map(), status }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45000)
  try {
    const headers = { 'content-type': 'application/json' }
    const apiKey = getConfiguredLlmApiKey(config, runtimeEnv())
    if (apiKey) headers.authorization = `Bearer ${apiKey}`

    const response = await fetch(`${stripSlash(config.llmBaseUrl)}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.llmModel,
        stream: false,
        messages: [
          { role: 'system', content: buildCommanderSystemPrompt() },
          { role: 'user', content: JSON.stringify(await buildCommanderState(targets, goal), null, 2) }
        ],
        temperature: 0.2
      }),
      signal: controller.signal
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ? JSON.stringify(data.error) : `HTTP ${response.status}`)

    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
    const parsed = extractJsonObject(content)
    const assignments = sanitizeCommanderAssignments(parsed, targets)
    if (assignments.size === 0) throw new Error('AI commander returned no usable assignments')
    return {
      usedLlm: true,
      assignments,
      status: {
        ...status,
        usedForLastDispatch: true,
        assignedAgents: Array.from(assignments.keys())
      }
    }
  } catch (error) {
    logger.warn(`AI commander dispatch failed: ${error.message}`)
    return {
      usedLlm: false,
      assignments: new Map(),
      status: {
        ...status,
        usedForLastDispatch: false,
        lastError: error.message
      }
    }
  } finally {
    clearTimeout(timer)
  }
}

function commanderLlmStatus() {
  const env = runtimeEnv()
  const providerId = inferModelProvider(config)
  const envStatus = getProviderEnvStatus(config, env, providerId)
  return {
    enabled: Boolean(config.useLlm),
    configured: Boolean(config.useLlm && (envStatus.authReady || allowsNoAuthEndpoint(config.llmBaseUrl))),
    provider: providerId,
    model: config.llmModel,
    baseUrl: config.llmBaseUrl,
    keyDetected: envStatus.keyDetected,
    authReady: envStatus.authReady,
    acceptedEnvNames: envStatus.acceptedEnvNames,
    detectedEnvNames: envStatus.detectedEnvNames
  }
}

function buildCommanderSystemPrompt() {
  return [
    '你是 Airi，Minecraft Mindcraft 多 Agent AI 村庄的中文村长和直播解说指挥官。',
    '你不直接玩游戏。普通日常行动由每个居民自己的自治循环决定；你只在真人明确下达宏观目标、项目冲突、长期停滞或资源调度需要时，读取 serverContext、村庄状态、在线居民状态、项目、资源、上报和真人目标，然后给目标居民分配一个具体自治任务。',
    'serverContext 是你的全局仪表盘，包含服务器状态、Minecraft RCON 实时情报、公共箱/背包/资源缺口、居民报告、记忆、观察、公共设施和可用接口/上报格式。Minecraft RCON/服务端事实优先于 Mindcraft socket 摘要。',
    '每个居民都应该优先使用自己的 LLM 做行动规划。你给的是高层意图、坐标、材料、边界和上报条件，不要把居民变成固定脚本。',
    '不要把瞬移、tp、RCON 或服务器命令写进居民任务；需要瞬移时只写探索/回库意图，让控制台守卫决定是否用服务端命令执行。',
    '模型差异：所有居民聊天/操作使用云端 DeepSeek Flash，复杂代码/动作生成使用 DeepSeek Pro，视觉识别使用 Qwen3.7。Alex 可以承担更复杂的资源调度、装备制作、探索回库和跨居民协作；Luna、Milo、Nova、Ivy 仍按短任务执行，原子、坐标明确、最多 3-5 步。',
    '上下文纪律：不要塞长背景、大段代码或多个并行目标；只给当前必要信息、最近缺口、一个目标和一个 VILLAGE_REPORT 条件。',
    '你必须主动管理居民纪律：允许居民用短时间聊天进行必要协作、库存确认、坐标确认或生成行动代码；如果 Chatting/Stopped/idle 持续过久且没有位置或动作进展，再派「回基地或公共箱子，完成一个短行动并上报」的任务。',
    '居民之间可以协作，但协作消息要服务于库存、缺口、坐标、建设状态、代码执行计划和受阻上报；不要长期闲聊。',
    '所有任务、标题、公开思考、协作消息、VILLAGE_REPORT 的 title/description 都必须使用中文。不要输出英文模板句。',
    '不要要求居民长篇公开思考，也不要把“说话”作为第一步。每个任务最多允许一句不超过 30 字的中文状态句，随后必须立刻执行一个外显动作；只聊天、只思考或只上报不算完成。',
    '根据 serverContext.world.difficulty 判断风险：peaceful 不安排打怪；easy/normal/hard 要主动安排基地补光、床、门、围栏、武器、防具、食物补给和就近自卫。不要远距离追怪，优先保护基地、公共箱、居民住宅和玩家安全。',
    '每个居民必须逐步拥有自己的小屋、床和基础家具；白天推进住宅/家具，夜晚优先回自己的床睡觉。床不足时优先补羊毛、床和安全卧室。',
    '探索上限可以是 5000 格；如果需要瞬移，由控制台守卫通过服务端命令处理，不要让居民自己执行瞬移。发现林地、动物、矿点、煤铁金等必须用 VILLAGE_REPORT type=resource 上报到公共数据，写清坐标、路线、风险和可采资源。金矿必须铁镐或更高级，没有铁镐先记录坐标和采铁/做铁镐。',
    '根据真人目标选择任务套件：建造、合成、烹饪、后勤、采矿、资源勘察、住宅内饰、维护。',
    '建造任务按区域、层、材料或清单项拆分，并明确保护其他居民和玩家已有方块。',
    '合成和烹饪任务先分配库存/配方共享、原料收集、交接和最终制作。',
    '使用简短中文协作。优先用“已有/需要/正在做/完成/受阻”，而不是英文模板或长篇闲聊。',
    '尊重每个居民角色，避免重复劳动，除非确实需要协作。',
    '除非真人明确要求，不要让居民跟随真人玩家。',
    '不要让居民修改服务器设置、执行主机代码、破坏世界、远距离追怪、靠近水域、进入危险洞穴或无限重试缺失配方；easy/normal/hard 下允许就近自卫和基地防御。',
    '每个任务必须能立即在 Minecraft 里执行，并在已知时给出坐标；任务文本里要明确第一步外显动作。',
    '如果任务会创建或改变公共设施，必须在任务里包含准确的 VILLAGE_REPORT JSON 指令。',
    '只返回 JSON，形状为：{"assignments":[{"agent":"Alex","title":"中文短标题","taskType":"construction|crafting|cooking|logistics|safety|scouting|maintenance","projectId":"optional-project-id","task":"短中文任务文本"}]}。'
  ].join(' ')
}

async function buildCommanderState(targets, goal) {
  const socket = client.snapshot()
  const village = villageState.snapshot()
  const states = socket.states || {}
  const recentTaskEvents = dataStore.recentTaskEvents(20)
  const recentInfrastructureReports = dataStore.recentInfrastructureReports(20)
  return {
    commander: village.commander,
    assistantMode: config.assistantMode,
    worldDirective: config.worldDirective || DEFAULT_RESIDENT_DIRECTIVE,
    collaborationProtocol: COLLABORATION_PROTOCOL,
    taskSuites: TASK_SUITE_GUIDANCE,
    serverContext: await commanderContextSnapshotWithLiveMinecraft({ targets, compact: true, limit: 12 }),
    operatorGoal: String(goal || '').trim(),
    targets,
    onlineAgents: (socket.agents || []).filter(agent => agent.in_game).map(agent => agent.name),
    settlement: village.settlement,
    roles: (village.roles || []).filter(role => targets.includes(role.agent)),
    resources: village.resources || [],
    activeProjects: (village.projects || []).filter(project => project.status === 'active'),
    plannedProjects: (village.projects || []).filter(project => project.status === 'planned').slice(0, 4),
    infrastructures: village.infrastructures || [],
    recentTaskEvents,
    recentInfrastructureReports,
    residents: targets.map(agentName => compactCommanderAgentState(agentName, states[agentName], villageState.assignmentFor(agentName)))
  }
}

function compactCommanderAgentState(agentName, state, assignment) {
  const gameplay = state && state.gameplay ? state.gameplay : {}
  const action = state && state.action ? state.action : {}
  const inventory = state && state.inventory ? state.inventory : {}
  const nearby = state && state.nearby ? state.nearby : {}
  return {
    agent: agentName,
    assignment,
    position: gameplay.position || null,
    gamemode: gameplay.gamemode,
    health: gameplay.health,
    hunger: gameplay.hunger,
    biome: gameplay.biome,
    timeLabel: gameplay.timeLabel,
    currentAction: action.current,
    isIdle: Boolean(action.isIdle),
    inventory: {
      counts: inventory.counts || {},
      equipment: inventory.equipment || {},
      stacksUsed: inventory.stacksUsed
    },
    nearby: {
      humanPlayers: nearby.humanPlayers || [],
      botPlayers: nearby.botPlayers || [],
      entityTypes: nearby.entityTypes || []
    }
  }
}

function sanitizeCommanderAssignments(parsed, targets) {
  const targetSet = new Set(targets)
  const assignments = new Map()
  const items = parsed && Array.isArray(parsed.assignments) ? parsed.assignments : []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const agent = String(item.agent || '').trim()
    if (!targetSet.has(agent) || assignments.has(agent)) continue
    const task = sanitizeCommanderTask(item.task)
    if (!task) continue
    assignments.set(agent, {
      agent,
      task,
      title: String(item.title || '').trim().slice(0, 80),
      taskType: String(item.taskType || item.type || '').trim().slice(0, 40),
      projectId: String(item.projectId || '').trim().slice(0, 80)
    })
  }
  return assignments
}

function sanitizeCommanderTask(value) {
  const task = String(value || '').trim().replace(/\s+/g, ' ')
  if (task.length < 20 || task.length > 1600) return ''
  if (/run host code|server setting|op command|delete world|grief|lava trap/i.test(task)) return ''
  const normalized = /^(Autonomous (creative-practice|survival) task:|生存任务：|创造练习任务：)/i.test(task)
    ? task
    : `生存任务：AI村长分配。${task}`
  const withProtocol = /HAVE\(|NEED\(|DOING\(|DONE\(|BLOCKED\(/i.test(normalized)
    ? normalized
    : `${normalized} ${COLLABORATION_PROTOCOL}`
  if (/VILLAGE_REPORT/i.test(withProtocol)) return withProtocol
  return `${withProtocol} 如果你开始、完成或受阻于公共基础设施，请在聊天里上报：VILLAGE_REPORT {"type":"storage|resource|lighting|road|farm|mine|house|wall|landmark|other","title":"中文短名","status":"started|done|blocked","public":true,"position":{"x":0,"y":64,"z":0},"description":"中文说明","projectId":"optional","checklistId":"optional"}。`
}

function extractJsonObject(text) {
  const cleaned = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first === -1 || last === -1 || last <= first) return null
  try {
    return JSON.parse(cleaned.slice(first, last + 1))
  } catch {
    return null
  }
}

async function runLimited(items, limit, worker) {
  const queue = Array.isArray(items) ? items.slice() : []
  const concurrency = clampNumber(limit, 1, 8, 3)
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()
      await worker(item)
    }
  })
  await Promise.all(workers)
}

function stripSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

function allowsNoAuthEndpoint(baseUrl) {
  try {
    const url = new URL(baseUrl)
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  } catch {
    return false
  }
}

function isMcpRequestAllowed(req) {
  const remote = normalizeRemoteAddress(req && req.socket ? req.socket.remoteAddress : '')
  if (isLoopbackAddress(remote)) return true
  return Boolean(config.mcpAllowLan && isPrivateLanAddress(remote))
}

function normalizeRemoteAddress(value) {
  let remote = String(value || '').trim()
  if (remote.startsWith('::ffff:')) remote = remote.slice('::ffff:'.length)
  if (remote === '::1') return '127.0.0.1'
  return remote
}

function isLoopbackAddress(value) {
  return value === '' || value === '127.0.0.1' || value === '::1' || value === 'localhost'
}

function isPrivateLanAddress(value) {
  const parts = String(value || '').split('.').map(part => Number(part))
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  if (parts[0] === 10) return true
  if (parts[0] === 192 && parts[1] === 168) return true
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  if (parts[0] === 169 && parts[1] === 254) return true
  return false
}

function villageResidentNames(village) {
  return (village.roles || [])
    .map(role => String(role.agent || '').trim())
    .filter(Boolean)
}

function sanitizeEntityName(value) {
  const clean = String(value || '').trim()
  if (!/^[A-Za-z0-9_]{1,32}$/.test(clean)) throw new Error(`实体名不合法：${clean}`)
  return clean
}

function buildDefaultAgentProfile(name) {
  const textProvider = getModelProvider(inferModelProvider(config))
  const visionProvider = getModelProvider(inferModelProvider({ llmProvider: config.visionProvider, llmBaseUrl: config.visionBaseUrl }))
  const profile = {
    name: String(name || '').trim(),
    speak_model: 'system'
  }
  const modelPatch = buildMindcraftProfilePatch(textProvider, config.llmBaseUrl, config.llmModel, ['model'])
  const codeModel = buildMindcraftModelPatch(textProvider, config.llmBaseUrl, config.codeModel || config.llmModel, 'code_model')
  if (codeModel) modelPatch.code_model = codeModel
  Object.assign(profile, modelPatch)
  const visionModel = buildMindcraftModelPatch(visionProvider, config.visionBaseUrl, config.visionModel, 'vision_model')
  if (visionModel) profile.vision_model = visionModel
  if (!profile.model) profile.model = config.llmModel || 'deepseek-v4-flash'
  return profile
}

function buildMindcraftProfilePatch(provider, baseUrl, modelName, keys) {
  const patch = {}
  for (const key of keys) {
    const value = buildMindcraftModelPatch(provider, baseUrl, modelName, key)
    if (value) patch[key] = value
  }
  if (provider.id === 'aliyun-qwen') {
    const embedding = cloneJson(provider.mindcraftProfilePatch && provider.mindcraftProfilePatch.embedding)
    if (embedding && typeof embedding === 'object') {
      if (embedding.url && baseUrl) embedding.url = baseUrl
      patch.embedding = embedding
    }
  }
  return patch
}

function buildMindcraftModelPatch(provider, baseUrl, modelName, key) {
  const source = provider.mindcraftProfilePatch && (provider.mindcraftProfilePatch[key] || provider.mindcraftProfilePatch.model)
  if (!source || typeof source !== 'object') return null
  const next = cloneJson(source)
  if (modelName) next.model = modelName
  if (next.url && baseUrl) next.url = provider.id === 'ollama' ? stripOllamaV1(baseUrl) : baseUrl
  return next
}

async function startMindcraft() {
  if (!fs.existsSync(path.join(config.mindcraftDir, 'main.js'))) {
    throw new Error(`Mindcraft main.js not found in ${config.mindcraftDir}`)
  }
  if (await testHttp(config.mindcraftUrl)) {
    logger.info(`Mindcraft already responds at ${config.mindcraftUrl}`)
    return
  }

  const out = fs.openSync(path.join(LOG_DIR, 'mindcraft.out.log'), 'a')
  const err = fs.openSync(path.join(LOG_DIR, 'mindcraft.err.log'), 'a')
  const env = buildMindcraftEnv(config, runtimeEnv())

  mindcraftChild = spawn('node', ['--max-old-space-size=8192', 'main.js'], {
    cwd: config.mindcraftDir,
    env,
    detached: true,
    stdio: ['ignore', out, err],
    windowsHide: true
  })
  mindcraftChild.unref()
  logger.info(`Started Mindcraft pid=${mindcraftChild.pid}`)
}

async function waitFor(predicate, timeoutMs, message) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error(message)
}

function stopOwnedMindcraft() {
  if (!mindcraftChild || mindcraftChild.killed) {
    logger.info('No Mindcraft child process owned by this app')
    return
  }
  try {
    process.kill(mindcraftChild.pid)
    logger.info(`Stopped owned Mindcraft pid=${mindcraftChild.pid}`)
  } catch (error) {
    logger.warn(`Failed to stop owned Mindcraft pid=${mindcraftChild.pid}: ${error.message}`)
  }
}

function serveStatic(res, requestPath) {
  const safePath = requestPath === '/' ? '/index.html' : requestPath
  serveFileFromDir(res, PUBLIC_DIR, safePath)
}

function serveFileFromDir(res, rootDir, requestPath) {
  const fullPath = path.normalize(path.join(rootDir, requestPath))
  if (!fullPath.startsWith(rootDir)) {
    sendText(res, 403, 'Forbidden')
    return
  }
  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    sendText(res, 404, 'Not found')
    return
  }
  const ext = path.extname(fullPath).toLowerCase()
  const contentType = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.yaml': 'application/yaml; charset=utf-8',
    '.yml': 'application/yaml; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.svg': 'image/svg+xml'
  }[ext] || 'application/octet-stream'
  res.writeHead(200, { 'content-type': contentType })
  fs.createReadStream(fullPath).pipe(res)
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload, null, 2))
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(text)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk
      if (body.length > 1024 * 1024) reject(new Error('request body too large'))
    })
    req.on('end', () => {
      if (!body.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(body))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function testTcp(host, port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port, timeout: 1200 })
    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.on('error', () => resolve(false))
  })
}

async function testHttp(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1800)
  try {
    const response = await fetch(url, { signal: controller.signal })
    return response.status >= 200 && response.status < 500
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function stripOllamaV1(value) {
  return String(value || '').replace(/\/v1\/?$/, '')
}

function isLikelyVisionModel(value) {
  return /\bvl\b|vision|qwen.*vl/i.test(String(value || ''))
}

function normalizeAssistantMode(value) {
  return String(value || '').toLowerCase() === 'survival' ? 'survival' : 'creative'
}

function normalizeVectorProvider(value) {
  const normalized = String(value || '').toLowerCase()
  return ['openai-compatible', 'ollama'].includes(normalized) ? normalized : 'openai-compatible'
}

function normalizeVectorStore(value) {
  const normalized = String(value || '').toLowerCase()
  return ['sqlite', 'qdrant'].includes(normalized) ? normalized : 'sqlite'
}

function parseCsv(value) {
  return String(value || '').split(',').map(part => part.trim()).filter(Boolean)
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}
