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
  createMindcraftAgentProfile
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
const DEFAULT_RESIDENT_DIRECTIVE = 'AI 是这个 Minecraft 世界的常驻居民，不是跟随宠物。围绕共享基地长期建设村庄：先保证安全、食物、照明、公共箱子和基础工具，再推进道路、农场、住宅和短距离探索。默认运行五个居民：Alex 负责安全和公共库存，Luna 负责建筑，Milo 负责采矿，Nova 负责侦察和道路，Ivy 负责农业和食物。真人玩家求助时优先响应；无人在线时继续在基地半径内采集、整理、建造和互相协作。'
const COLLABORATION_PROTOCOL = '协作协议：只在需要协调时发短句。格式优先用 HAVE(物品/数量)、NEED(物品/数量/用途)、DOING(任务/区域)、DONE(结果/坐标)、BLOCKED(原因/缺什么)。先同步库存和工作区，再行动；一个建筑区域一次只允许一个负责人改动，其他人不要拆或覆盖别人放好的方块。'
const TASK_SUITE_GUIDANCE = {
  construction: '建造任务：先确定蓝图/区域/材料；按地基、墙体、屋顶、门窗、照明、内饰分工；每个负责人只改自己的区域或层级。',
  crafting: '合成任务：先共享库存和配方；拆成原料、半成品、最终合成；缺配方或缺材料时用 NEED/BLOCKED 上报，不要重复试错。',
  cooking: '食物任务：分配采集、烹饪、燃料和入库；先做稳定食物，再做复杂菜品；成品统一放公共箱子或交给需要的人。',
  logistics: '后勤任务：公共箱子是共享事实源；采集者负责入库，管家负责分类，缺口由村长下一轮派工。'
}

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(LOG_DIR, { recursive: true })

const logger = new Logger(LOG_DIR)
const config = loadConfig()
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
  villageState
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
})

process.once('exit', () => dataStore.close())

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
    sendJson(res, 200, commanderContextSnapshot({ limit: Number(url.searchParams.get('limit') || 20) }))
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
    sendJson(res, 200, minecraftServer.sendCommand(body.command))
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
    village: villageState.snapshot(),
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
      longTermNotes: (memory.longTermNotes || []).slice(0, 8)
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
    agentFilter: '',
    assistantMode: 'creative',
    intervalMs: 15000,
    idleCooldownMs: 120000,
    minTaskRuntimeMs: 90000,
    maxConcurrentAgents: Number(process.env.MINDCRAFT_MAX_CONCURRENT_AGENTS || 3),
    liveObserverName: process.env.MINECRAFT_LIVE_OBSERVER || 'live',
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
  if (typeof next.agentFilter === 'string') config.agentFilter = next.agentFilter
  if (typeof next.assistantMode === 'string') config.assistantMode = normalizeAssistantMode(next.assistantMode)
  if (next.intervalMs) config.intervalMs = clampNumber(next.intervalMs, 5000, 600000, config.intervalMs)
  if (next.idleCooldownMs) config.idleCooldownMs = clampNumber(next.idleCooldownMs, 10000, 3600000, config.idleCooldownMs)
  if (next.minTaskRuntimeMs) config.minTaskRuntimeMs = clampNumber(next.minTaskRuntimeMs, 10000, 3600000, config.minTaskRuntimeMs)
  if (next.maxConcurrentAgents) config.maxConcurrentAgents = clampNumber(next.maxConcurrentAgents, 1, 8, config.maxConcurrentAgents || 3)
  if (typeof next.liveObserverName === 'string') config.liveObserverName = next.liveObserverName.trim() || config.liveObserverName
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
  const result = await minecraftServer.queryPlayerPosition(playerName)
  return { ok: true, ...result }
}

async function guideAgentsToPlayer(body) {
  const location = await locatePlayer(body.player)
  const position = location.position
  const targets = parseCsv(body.agent).length > 0 ? parseCsv(body.agent) : client.onlineAgentNames([])
  if (targets.length === 0) throw new Error('没有在线 AI 可召回。')

  if (body.teleport === true) {
    for (const agentName of targets) {
      minecraftServer.sendCommand(`tp ${sanitizeEntityName(agentName)} ${sanitizeEntityName(location.player)}`)
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
  const results = []

  for (const agentName of residents) {
    const current = (client.snapshot().agents || []).find(agent => agent.name === agentName)
    try {
      if (current && current.in_game) {
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
  const target = !rawTarget || rawTarget.toLowerCase() === 'auto'
    ? chooseActiveAgentForObserver(observer)
    : sanitizeEntityName(rawTarget)
  if (!target) throw new Error('没有可观察的在线 AI。')

  await ensureMinecraftServerReady()
  minecraftServer.sendCommand(`gamemode spectator ${observer}`)
  minecraftServer.sendCommand(`spectate ${target} ${observer}`)
  logger.info(`Focused live observer ${observer} on ${target}`)
  return {
    ok: true,
    observer,
    target,
    mode: rawTarget.toLowerCase() === 'auto' ? 'auto-active-agent' : 'explicit-target',
    commands: [`gamemode spectator ${observer}`, `spectate ${target} ${observer}`]
  }
}

function chooseActiveAgentForObserver(observer) {
  const socket = client.snapshot()
  const online = new Set(((socket.agents || []).filter(agent => agent.in_game).map(agent => agent.name)))
  const candidates = villageResidentNames(villageState.snapshot()).filter(agentName => online.has(agentName) && agentName !== observer)
  if (candidates.length === 0) return ''
  return candidates
    .map(agentName => ({ agentName, score: liveActivityScore(agentName) }))
    .sort((a, b) => b.score - a.score || a.agentName.localeCompare(b.agentName))[0].agentName
}

function liveActivityScore(agentName) {
  const rawState = client.latestState && client.latestState[agentName]
  const summarized = (client.snapshot().states || {})[agentName] || {}
  const action = String((rawState && rawState.action && rawState.action.current) || summarized.currentAction || summarized.action || '').toLowerCase()
  const isIdle = Boolean((rawState && rawState.action && rawState.action.isIdle) || summarized.isIdle)
  let score = 10
  if (!isIdle) score += 40
  if (action && !/idle|wait|chat|talk|conversation|等待|聊天/.test(action)) score += 30
  if (/collect|mine|craft|build|place|goto|search|farm|attack|dig|break|deposit|harvest|path|road|house|action:|采|挖|建|放|找|农|路|房/.test(action)) score += 30
  const reports = dataStore.recentAgentStatusReports(agentName, 1)
  const latestReport = reports[0]
  if (latestReport && latestReport.status === 'working') score += 12
  if (latestReport && latestReport.status === 'blocked') score -= 6
  const gameplay = rawState && rawState.gameplay ? rawState.gameplay : {}
  if (Number(gameplay.health || summarized.health || 20) <= 8) score += 10
  return score
}

function buildSocietyResidentTask(agentName, goal) {
  const extraGoal = String(goal || '').trim()
  const context = villageState.taskContextFor(agentName)
  const agentContext = agentContextSnapshot(agentName, { compact: true, limit: 8 })
  return [
    'Autonomous survival task: Survival mode: you are a permanent resident of the AI village, not a pet follower.',
    `Long-term directive: ${config.worldDirective || DEFAULT_RESIDENT_DIRECTIVE}`,
    `Your current village context: ${context}`,
    `Your personal memory and recent reports: ${JSON.stringify(agentContext.memory || {})}`,
    extraGoal ? `Immediate human operator goal: ${extraGoal}` : 'Immediate goal: continue the highest-priority village project for your role.',
    'Stay within the village radius unless scouting; prioritize safety, food, shared storage, lighting, tools, roads, farms, and simple housing.',
    COLLABORATION_PROTOCOL,
    'Use MineCollab-style task discipline: for construction split work by area/layer/material; for crafting/cooking share inventory and recipes before acting; for logistics deposit surplus materials and report shortages.',
    'Coordinate briefly with other AI residents in chat, deposit surplus materials into shared storage, avoid caves/lava/long trips, and report blockers instead of retrying failed recipes.',
    'When you start or finish any public infrastructure, send one exact structured report in chat: VILLAGE_REPORT {"type":"storage|lighting|road|farm|mine|house|wall|landmark|other","title":"short name","status":"started|done|blocked","public":true,"position":{"x":0,"y":64,"z":0},"description":"what changed","projectId":"optional","checklistId":"optional"}.'
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
          { role: 'user', content: JSON.stringify(buildCommanderState(targets, goal), null, 2) }
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
    'You are Airi, the AI village commander for a Minecraft Mindcraft multi-agent society.',
    'You do not directly play the game. You inspect the serverContext, village state, online resident states, projects, resources, agent reports, and operator goal, then assign one concrete autonomous task to each target resident.',
    'Treat serverContext as your global dashboard. It contains live server status, recent resident reports, stored memories, observations, public facilities, and available API/report formats.',
    'Keep assignments useful for a survival village: safety, shared storage, lighting, roads, farms, houses, local resources, and short safe loops near base.',
    'Classify the operator goal into one of these task suites when useful: construction, crafting, cooking, logistics, safety, scouting, maintenance.',
    'For construction, split work by area, layer, material, or checklist item and explicitly protect existing blocks from other residents.',
    'For crafting and cooking, first assign inventory/recipe sharing, ingredient collection, resource handoff, and final assembly/cooking.',
    'Use concise communication. Prefer HAVE/NEED/DOING/DONE/BLOCKED messages over long planning chatter.',
    'Respect each resident role. Avoid duplicate work unless cooperation is needed.',
    'Do not tell residents to follow the human player unless the operator explicitly asks for that.',
    'Do not ask residents to change server settings, run host code, grief, wander far, enter risky caves, or retry missing recipes endlessly.',
    'Each task must be immediately actionable in Minecraft and mention relevant coordinates when known.',
    'If the task creates or changes public infrastructure, include the exact VILLAGE_REPORT JSON instruction in the task.',
    'Return only JSON with this shape: {"assignments":[{"agent":"Alex","title":"short Chinese title","taskType":"construction|crafting|cooking|logistics|safety|scouting|maintenance","projectId":"optional-project-id","task":"complete task text"}]}.'
  ].join(' ')
}

function buildCommanderState(targets, goal) {
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
    serverContext: commanderContextSnapshot({ targets, compact: true, limit: 12 }),
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
  const normalized = /^Autonomous (creative-practice|survival) task:/i.test(task)
    ? task
    : `Autonomous survival task: Survival mode: AI commander assignment. ${task}`
  const withProtocol = /HAVE\(|NEED\(|DOING\(|DONE\(|BLOCKED\(/i.test(normalized)
    ? normalized
    : `${normalized} ${COLLABORATION_PROTOCOL}`
  if (/VILLAGE_REPORT/i.test(withProtocol)) return withProtocol
  return `${withProtocol} If you start, finish, or are blocked on public infrastructure, report in chat with: VILLAGE_REPORT {"type":"storage|lighting|road|farm|mine|house|wall|landmark|other","title":"short name","status":"started|done|blocked","public":true,"position":{"x":0,"y":64,"z":0},"description":"what changed","projectId":"optional","checklistId":"optional"}.`
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

  mindcraftChild = spawn('node', ['main.js'], {
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
