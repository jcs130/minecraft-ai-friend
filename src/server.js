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
const { MinecraftServerManager, readLatestLog } = require('./minecraft-server')
const { readMindcraftConfig, writeMindcraftConfig } = require('./mindcraft-config')

const ROOT = path.resolve(__dirname, '..')
const PUBLIC_DIR = path.join(ROOT, 'public')
const INTEGRATIONS_DIR = path.join(ROOT, 'integrations')
const DATA_DIR = path.join(ROOT, 'data')
const LOG_DIR = path.join(ROOT, 'logs')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
const PORT = Number(process.env.PORT || process.env.MINDCRAFT_AUTOPLAYER_PORT || 4177)

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(LOG_DIR, { recursive: true })

const logger = new Logger(LOG_DIR)
const config = loadConfig()
let mindcraftChild = null
const minecraftServer = new MinecraftServerManager({ logDir: LOG_DIR, logger })

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
  agentFilter: parseCsv(config.agentFilter),
  assistantMode: config.assistantMode,
  useLlm: config.useLlm,
  llmBaseUrl: config.llmBaseUrl,
  llmModel: config.llmModel,
  llmApiKey: process.env.MINDCRAFT_LLM_API_KEY || process.env.DEEPSEEK_API_KEY || ''
})

client.start()

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(error => {
    logger.error(`request failed: ${error.stack || error.message}`)
    sendJson(res, 500, { error: error.message })
  })
})

server.listen(PORT, '127.0.0.1', () => {
  logger.info(`我的世界AI陪玩控制台已启动：http://127.0.0.1:${PORT}`)
})

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)

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

  if (req.method === 'GET' && url.pathname === '/api/logs') {
    sendJson(res, 200, { logs: logger.recent(Number(url.searchParams.get('limit') || 160)) })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/memory') {
    const agent = url.searchParams.get('agent') || ''
    sendJson(res, 200, autopilot.getMemory(agent))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/server-properties') {
    sendJson(res, 200, readServerProperties(config.minecraftServerDir))
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
    const task = String(body.task || '').trim()
    const agents = parseCsv(body.agent || config.agentFilter)
    if (!task) throw new Error('task is required')
    const targets = agents.length > 0 ? agents : client.onlineAgentNames([])
    if (targets.length === 0) throw new Error('no online agents found')
    for (const agentName of targets) {
      await autopilot.sendManualTask(agentName, task)
    }
    sendJson(res, 200, { ok: true, targets })
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

  return {
    app: {
      url: `http://127.0.0.1:${PORT}`,
      dataDir: DATA_DIR,
      logDir: LOG_DIR,
      node: process.version
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
    socket: client.snapshot(),
    autopilot: autopilot.snapshot(),
    config: publicConfig()
  }
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
    useLlm: false,
    llmBaseUrl: process.env.MINDCRAFT_LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    llmModel: process.env.MINDCRAFT_LLM_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
  }

  try {
    if (!fs.existsSync(CONFIG_PATH)) return defaults
    return { ...defaults, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }
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
  if (typeof next.useLlm === 'boolean') config.useLlm = next.useLlm
  if (typeof next.llmBaseUrl === 'string') config.llmBaseUrl = next.llmBaseUrl.trim() || config.llmBaseUrl
  if (typeof next.llmModel === 'string') config.llmModel = next.llmModel.trim() || config.llmModel

  client.updateBaseUrl(config.mindcraftUrl)
  autopilot.configure({
    intervalMs: config.intervalMs,
    idleCooldownMs: config.idleCooldownMs,
    minTaskRuntimeMs: config.minTaskRuntimeMs,
    agentFilter: parseCsv(config.agentFilter),
    assistantMode: config.assistantMode,
    useLlm: config.useLlm,
    llmBaseUrl: config.llmBaseUrl,
    llmModel: config.llmModel,
    llmApiKey: process.env.MINDCRAFT_LLM_API_KEY || process.env.DEEPSEEK_API_KEY || ''
  })
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

function publicConfig() {
  return {
    ...config,
    llmApiKeyFromEnv: Boolean(process.env.MINDCRAFT_LLM_API_KEY || process.env.DEEPSEEK_API_KEY)
  }
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
  const env = { ...process.env }

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

function normalizeAssistantMode(value) {
  return String(value || '').toLowerCase() === 'survival' ? 'survival' : 'creative'
}

function parseCsv(value) {
  return String(value || '').split(',').map(part => part.trim()).filter(Boolean)
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}
