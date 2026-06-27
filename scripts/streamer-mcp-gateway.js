'use strict'

const fs = require('node:fs')
const http = require('node:http')
const crypto = require('node:crypto')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const HOST = process.env.STREAMER_MCP_HOST || '0.0.0.0'
const PORT = Number(process.env.STREAMER_MCP_PORT || 4178)
const CONTROL_URL = trimSlash(process.env.AI_FRIEND_CONTROL_URL || 'http://127.0.0.1:4177')
const TOKEN_PATH = process.env.STREAMER_MCP_TOKEN_FILE || path.join(ROOT, 'data', 'streamer-mcp-token.txt')
const TOKEN = resolveToken()
const MCP_PROTOCOL_VERSION = '2025-06-18'
const sseClients = new Map()

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(error => {
    console.error(`[streamer-mcp] ${error.stack || error.message}`)
    sendJson(res, 500, { error: error.message })
  })
})

server.listen(PORT, HOST, () => {
  console.log(`[streamer-mcp] listening on http://${HOST}:${PORT}`)
  console.log(`[streamer-mcp] control=${CONTROL_URL}`)
  console.log(`[streamer-mcp] auth=${TOKEN ? 'query token required' : 'disabled for LAN use'}`)
})

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)
  setCors(res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (!isAuthorized(req, url)) {
    sendText(res, 403, 'Forbidden')
    return
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health' || url.pathname === '/api/health')) {
    sendJson(res, 200, {
      ok: true,
      name: 'minecraft-ai-friend-streamer-gateway',
      control: CONTROL_URL,
      mcp: `/mcp/sse${TOKEN ? '?token=***' : ''}`,
      tools: toolNames()
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/stream/status') {
    sendJson(res, 200, await streamStatus())
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/stream/focus') {
    const body = await readJson(req)
    sendJson(res, 200, await controlPost('/api/livestream/focus', {
      observer: body.observer || body.observerName || 'live',
      target: body.target || body.agent || 'auto'
    }))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/stream/auto') {
    const body = await readJson(req)
    sendJson(res, 200, await controlPost('/api/livestream/auto', body))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/village/goal') {
    const body = await readJson(req)
    sendJson(res, 200, await controlPost('/api/society/dispatch', { goal: String(body.goal || body.task || '').trim() }))
    return
  }

  if (req.method === 'GET' && url.pathname === '/mcp/sse') {
    openLegacySse(req, res, url)
    return
  }

  if (req.method === 'POST' && url.pathname === '/mcp/messages') {
    await handleLegacyMessage(req, res, url)
    return
  }

  if (url.pathname === '/mcp' || url.pathname === '/api/mcp') {
    if (req.method === 'GET') {
      openStreamableSse(req, res)
      return
    }
    if (req.method === 'POST') {
      const message = await readJson(req)
      const response = await handleRpcMessage(message)
      if (!response) {
        sendText(res, 202, '')
        return
      }
      res.setHeader('MCP-Protocol-Version', MCP_PROTOCOL_VERSION)
      if (message && message.method === 'initialize') res.setHeader('Mcp-Session-Id', crypto.randomUUID())
      sendJson(res, 200, response)
      return
    }
    if (req.method === 'DELETE') {
      sendJson(res, 200, { ok: true })
      return
    }
  }

  sendJson(res, 404, { error: 'not found' })
}

function openLegacySse(req, res, url) {
  const sessionId = crypto.randomUUID()
  writeSseHeaders(res)
  sseClients.set(sessionId, res)
  const tokenSuffix = TOKEN ? `&token=${encodeURIComponent(url.searchParams.get('token') || '')}` : ''
  sendSse(res, 'endpoint', `/mcp/messages?sessionId=${encodeURIComponent(sessionId)}${tokenSuffix}`)
  sendSse(res, 'message', {
    jsonrpc: '2.0',
    method: 'notifications/message',
    params: { level: 'info', logger: 'minecraft-ai-friend-streamer', data: 'Streamer MCP SSE connected' }
  })
  const keepAlive = setInterval(() => {
    if (!res.destroyed) res.write(': keepalive\n\n')
  }, 30000)
  req.on('close', () => {
    clearInterval(keepAlive)
    sseClients.delete(sessionId)
  })
}

function openStreamableSse(req, res) {
  writeSseHeaders(res)
  sendSse(res, 'message', {
    jsonrpc: '2.0',
    method: 'notifications/message',
    params: { level: 'info', logger: 'minecraft-ai-friend-streamer', data: 'Streamer MCP stream opened' }
  })
}

async function handleLegacyMessage(req, res, url) {
  const message = await readJson(req)
  const sessionId = url.searchParams.get('sessionId') || ''
  const response = await handleRpcMessage(message)
  if (!response) {
    sendText(res, 202, '')
    return
  }
  const sse = sessionId ? sseClients.get(sessionId) : null
  if (sse && !sse.destroyed) {
    sendSse(sse, 'message', response)
    sendText(res, 202, '')
    return
  }
  sendJson(res, 200, response)
}

async function handleRpcMessage(message) {
  if (Array.isArray(message)) {
    const responses = []
    for (const item of message) {
      const response = await handleRpcMessage(item)
      if (response) responses.push(response)
    }
    return responses.length > 0 ? responses : null
  }
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return rpcError(message && message.id !== undefined ? message.id : null, -32600, 'Invalid Request')
  }
  if (message.id === undefined || message.id === null) return null
  try {
    if (message.method === 'initialize') return rpcResult(message.id, initializeResult(message.params || {}))
    if (message.method === 'ping') return rpcResult(message.id, {})
    if (message.method === 'tools/list') return rpcResult(message.id, { tools: toolsList() })
    if (message.method === 'tools/call') return rpcResult(message.id, await callTool(message.params || {}))
    return rpcError(message.id, -32601, `Method not found: ${message.method}`)
  } catch (error) {
    return rpcResult(message.id, toolError(error.message))
  }
}

async function callTool(params) {
  const name = String(params.name || '').trim()
  const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {}
  if (!name) return toolError('tool name is required')
  if (!toolNames().includes(name)) return toolError(`unknown tool: ${name}`)
  const data = await executeTool(name, args)
  return toolSuccess(data.summary || `${name} 执行完成`, data)
}

async function executeTool(name, args) {
  if (name === 'get_stream_status') {
    const status = await streamStatus()
    return { summary: summarizeStreamStatus(status), status }
  }
  if (name === 'village_report') {
    const context = await controlGet('/api/commander/context?limit=20')
    return { summary: summarizeVillage(context), context }
  }
  if (name === 'focus_live_observer') {
    const result = await controlPost('/api/livestream/focus', {
      observer: args.observer || args.observer_name || 'live',
      target: args.target || args.agent || args.agent_name || 'auto'
    })
    return { summary: `${result.observer || 'live'} 已切到 ${result.target || 'auto'}。`, result }
  }
  if (name === 'set_live_auto_switch') {
    const result = await controlPost('/api/livestream/auto', {
      observer: args.observer || args.observer_name || undefined,
      active: args.active !== false,
      intervalMs: args.interval_ms || args.intervalMs || args.switch_interval_ms || args.switchIntervalMs
    })
    const live = result.livestream || {}
    return { summary: `直播自动轮换${live.active ? '已开启' : '已关闭'}，间隔 ${Math.round(Number(live.switchIntervalMs || 0) / 1000) || '?'} 秒。`, result }
  }
  if (name === 'send_village_goal') {
    const goal = requireString(args.goal || args.task || args.directive, 'goal')
    const result = await controlPost('/api/society/dispatch', { goal })
    return { summary: `已把宏观目标交给村长/居民：${goal}`, result }
  }
  if (name === 'send_agent_task') {
    const task = requireString(args.task, 'task')
    const result = await controlPost('/api/task', {
      agent_name: String(args.agent_name || args.agent || '').trim(),
      task
    })
    return { summary: `已向 ${Array.isArray(result.targets) ? result.targets.join(', ') : 'AI'} 发送任务。`, result }
  }
  throw new Error(`unhandled tool: ${name}`)
}

async function streamStatus() {
  const [status, context] = await Promise.all([
    controlGet('/api/status'),
    controlGet('/api/commander/context?limit=10')
  ])
  return {
    minecraft: pick(status.minecraft, ['tcpOpen', 'managed', 'canSendCommand', 'host', 'port']),
    mindcraft: pick(status.mindcraft, ['httpOk', 'url']),
    socket: {
      connected: Boolean(status.socket && status.socket.connected),
      agents: ((status.socket && status.socket.agents) || []).map(agent => ({ name: agent.name, in_game: agent.in_game }))
    },
    autopilot: pick(status.autopilot, ['active', 'assistantMode', 'maxConcurrentAgents', 'lastTickAt', 'lastError', 'villageEnabled']),
    livestream: status.livestream || {},
    village: {
      commander: context.village && context.village.commander,
      settlement: context.village && context.village.settlement,
      resources: context.village && context.village.resources,
      projects: context.village && context.village.projects,
      infrastructures: (context.village && context.village.infrastructures || []).slice(0, 30),
      onlineAgents: context.onlineAgents || []
    }
  }
}

function toolsList() {
  return [
    {
      name: 'get_stream_status',
      title: '获取直播状态',
      description: '获取主播端需要的状态：服务器、Mindcraft、在线居民、观察者镜头、村庄项目和资源。',
      inputSchema: objectSchema({})
    },
    {
      name: 'village_report',
      title: '村庄报告',
      description: '返回 AI 村长、基地、公共箱子、居民、资源目标、公共项目和设施进度。',
      inputSchema: objectSchema({})
    },
    {
      name: 'focus_live_observer',
      title: '切换直播镜头',
      description: '把 live 观察账号切到指定 AI，或用 auto 自动选择/轮换。',
      inputSchema: objectSchema({
        observer: { type: 'string', description: '观察者账号，默认 live。' },
        target: { type: 'string', description: '目标 AI 名字；auto 表示自动选择。' }
      })
    },
    {
      name: 'set_live_auto_switch',
      title: '设置自动轮换',
      description: '开启或关闭 live 观察者自动轮换，并可调整轮换间隔。',
      inputSchema: objectSchema({
        observer: { type: 'string', description: '观察者账号，默认 live。' },
        active: { type: 'boolean', description: '是否开启自动轮换。' },
        interval_ms: { type: 'number', description: '轮换间隔毫秒，最小 10000。' }
      })
    },
    {
      name: 'send_village_goal',
      title: '发送村庄宏观目标',
      description: '把一个宏观目标交给 AI 村长/居民系统，例如“今晚优先补光和整理公共箱子”。',
      inputSchema: objectSchema({
        goal: { type: 'string', description: '宏观目标或直播现场指令。' }
      }, ['goal'])
    },
    {
      name: 'send_agent_task',
      title: '发送单个居民任务',
      description: '给指定居民或所有在线 AI 发送任务。',
      inputSchema: objectSchema({
        agent_name: { type: 'string', description: '居民名，留空表示所有在线 AI。' },
        task: { type: 'string', description: '任务内容。' }
      }, ['task'])
    }
  ]
}

function initializeResult(params) {
  return {
    protocolVersion: params && params.protocolVersion ? String(params.protocolVersion) : MCP_PROTOCOL_VERSION,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: 'minecraft-ai-friend-streamer', title: '我的世界AI陪玩主播网关', version: '0.1.0' },
    instructions: '这是给主播端使用的受限 MCP 网关，只开放直播镜头、村庄状态和宏观目标工具。'
  }
}

function summarizeStreamStatus(status) {
  const live = status.livestream || {}
  const village = status.village || {}
  const agents = village.onlineAgents || []
  return `服务器${status.minecraft && status.minecraft.tcpOpen ? '在线' : '离线'}；Mindcraft${status.mindcraft && status.mindcraft.httpOk ? '在线' : '离线'}；在线居民 ${agents.join('、') || '暂无'}；直播镜头 ${live.currentTarget || '未锁定'}；自动轮换${live.active ? '开启' : '关闭'}。`
}

function summarizeVillage(context) {
  const village = context.village || {}
  const settlement = village.settlement || {}
  const base = settlement.base || {}
  const chest = settlement.publicChest || {}
  const projects = Array.isArray(village.projects) ? village.projects : []
  const resources = Array.isArray(village.resources) ? village.resources : []
  const projectText = projects.slice(0, 6).map(project => {
    const checklist = Array.isArray(project.checklist) ? project.checklist : []
    const done = checklist.filter(item => item.done).length
    const progress = checklist.length ? `${done}/${checklist.length}` : project.status || '未知'
    return `${project.priority || ''}${project.title || project.id} ${progress}`.trim()
  }).join('；')
  const resourceText = resources.slice(0, 8).map(resource => `${resource.name || resource.id} ${resource.current || 0}/${resource.target || '?'}`).join('；')
  return `村庄：${settlement.name || 'AI Friend Village'}。基地 X=${base.x ?? '?'},Y=${base.y ?? '?'},Z=${base.z ?? '?'}；公共箱子 X=${chest.x ?? '?'},Y=${chest.y ?? '?'},Z=${chest.z ?? '?'}。在线居民：${(context.onlineAgents || []).join('、') || '暂无'}。项目：${projectText || '暂无'}。资源：${resourceText || '暂无'}。`
}

async function controlGet(path) {
  const response = await fetch(`${CONTROL_URL}${path}`)
  const text = await response.text()
  if (!response.ok) throw new Error(`GET ${path} failed: ${response.status} ${text}`)
  return JSON.parse(text)
}

async function controlPost(path, body) {
  const response = await fetch(`${CONTROL_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {})
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`POST ${path} failed: ${response.status} ${text}`)
  return text ? JSON.parse(text) : { ok: true }
}

function isAuthorized(req, url) {
  if (!TOKEN) return true
  const provided = url.searchParams.get('token') || req.headers['x-streamer-token'] || ''
  return String(provided) === TOKEN
}

function resolveToken() {
  const fromEnv = String(process.env.STREAMER_MCP_TOKEN || '').trim()
  if (fromEnv) return fromEnv
  if (/^(1|true|yes|on)$/i.test(process.env.STREAMER_MCP_ALLOW_NO_TOKEN || '')) return ''
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      const existing = fs.readFileSync(TOKEN_PATH, 'utf8').trim()
      if (existing) return existing
    }
  } catch {}
  const generated = 'mc-' + crypto.randomBytes(18).toString('hex')
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true })
  fs.writeFileSync(TOKEN_PATH, generated + '\n')
  return generated
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk
      if (body.length > 1024 * 1024) {
        req.destroy()
        reject(new Error('request body too large'))
      }
    })
    req.on('end', () => {
      if (!body.trim()) return resolve({})
      try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
    })
    req.on('error', reject)
  })
}

function toolNames() {
  return toolsList().map(tool => tool.name)
}

function toolSuccess(summary, data) {
  return {
    content: [{ type: 'text', text: summary }],
    structuredContent: data || {},
    isError: false
  }
}

function toolError(message) {
  return {
    content: [{ type: 'text', text: `错误：${message}` }],
    structuredContent: { error: message },
    isError: true
  }
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function objectSchema(properties, required = []) {
  return { type: 'object', properties: properties || {}, required, additionalProperties: true }
}

function requireString(value, name) {
  const text = String(value || '').trim()
  if (!text) throw new Error(`${name} is required`)
  return text
}

function pick(value, keys) {
  const source = value || {}
  return Object.fromEntries(keys.map(key => [key, source[key]]))
}

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-streamer-token, mcp-protocol-version')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
}

function writeSseHeaders(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'access-control-allow-origin': '*'
  })
}

function sendSse(res, event, payload) {
  res.write(`event: ${event}\n`)
  res.write(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`)
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function sendText(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(text)
}