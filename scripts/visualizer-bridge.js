'use strict'

const CONTROL_URL = trimSlash(process.env.AI_FRIEND_CONTROL_URL || 'http://127.0.0.1:4177')
const VISUALIZER_URL = trimSlash(process.env.MINECRAFT_VISUALIZER_URL || 'http://127.0.0.1:3010')
const INTERVAL_MS = clampNumber(process.env.VISUALIZER_BRIDGE_INTERVAL_MS || 2000, 500, 60000, 2000)

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
  const context = await fetchJson(`${CONTROL_URL}/api/commander/context?limit=20`)
  const payload = mapContextToVisualizer(context)
  const result = await postJson(`${VISUALIZER_URL}/api/status`, payload)
  const names = payload.agents.map(agent => `${agent.name}:${agent.status}`).join(', ')
  console.log(`[visualizer-bridge] pushed ${payload.agents.length} agents (${names}) ok=${Boolean(result.ok)}`)
}

function mapContextToVisualizer(context) {
  const agents = (context.agents || []).map(mapAgent)
  return {
    agents,
    sharedResources: sharedResources(context, agents),
    bulletins: bulletins(context),
    events: events(context)
  }
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
    inventory: (state.inventory && state.inventory.counts) || {},
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
    if (/思考[:：]|Thought[:：]|HAVE|NEED|DOING|DONE|BLOCKED|已有|需要|完成|受阻|正在做/.test(text)) {
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
    .replace(/\.\s*[A-Z][A-Za-z0-9 ,.'"_=:/()-]{20,}/g, '')
    .replace(/\s+[A-Za-z][A-Za-z0-9 ,.'"_=:/()-]{24,}(?=$|[。！？；，])/g, '')
    .replace(/Thought\s*[:：]\s*/gi, '思考：')
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
function sharedResources(context, agents) {
  const ledger = {}
  for (const agent of agents) {
    for (const [name, count] of Object.entries(agent.inventory || {})) {
      ledger[name] = (ledger[name] || 0) + Number(count || 0)
    }
  }
  if (Object.keys(ledger).length > 0) return sortObjectByValue(ledger)

  const resources = context.village && Array.isArray(context.village.resources) ? context.village.resources : []
  for (const resource of resources) {
    ledger[resource.name || resource.id] = Number(resource.current || 0)
  }
  return sortObjectByValue(ledger)
}

function bulletins(context) {
  const reports = (context.recent && context.recent.agentStatusReports) || []
  const notes = (context.recent && context.recent.agentMemories) || []
  return [...reports.slice(0, 20).map(report => ({
    id: report.id,
    time: report.at,
    kind: report.status || 'status',
    agentId: report.agent,
    agentName: report.agent,
    title: report.status || '状态',
    color: COLORS[report.agent] || '#9ca3af',
    message: cleanThought(report.summary || report.task || report.detail || '状态更新', '状态更新')
  })), ...notes.slice(0, 12).map(note => ({
    id: note.id,
    time: note.at,
    kind: note.kind || 'memory',
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
    type: `task:${event.status || event.type}`,
    message: `${event.agent || 'AI'} ${event.title || event.description || ''}`,
    detail: event
  })), ...infrastructure.slice(0, 30).map(report => ({
    id: report.id,
    time: report.updatedAt || report.createdAt,
    type: `infra:${report.status}`,
    message: `${report.agent || 'AI'} ${report.title || report.description || ''}`,
    detail: report
  }))]
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