'use strict'

const crypto = require('node:crypto')

const MCP_PROTOCOL_VERSION = '2025-06-18'
const MCP_SERVER_INFO = {
  name: 'minecraft-ai-friend',
  title: '我的世界AI陪玩',
  version: '0.1.0'
}

const FIRST_NIGHT_TASK = '你是一个耐心的 Minecraft 新手导师。请陪玩家完成第一晚生存：先确认玩家位置和安全，再引导砍树、做工作台、做木镐/木剑、找食物、搭临时庇护所、插火把或躲避夜晚。不要抢走玩家体验，先解释再示范，遇到怪物时保护玩家。'
const FREE_PLAY_TASK = '你现在作为一个自主但友好的玩家行动。不要一直贴身跟随真人玩家；根据世界状态选择有价值的小目标，例如补光、收集基础资源、巡逻、改善基地或探索附近。遇到玩家求助时优先响应。'
const COLLAB_TASKS = {
  sync_status: '生存任务： 进行一次 60 秒协作同步。每个 AI 用中文短句汇报 已有(关键库存)、正在做(当前任务/区域)、需要(缺口)，然后继续自己的角色任务。不要长篇聊天。',
  shared_storage: '生存任务： 执行公共库存整理。所有 AI 先用中文“已有/需要”同步关键物资；采集者把多余木头、石头、煤、食物、火把放入公共箱子；Alex 负责分类并用 VILLAGE_REPORT 上报缺口。',
  craft_tools: '生存任务： 执行协作合成基础工具。先共享库存和缺口，Milo/Alex 准备木头、圆石、煤和木棍，能合成时制作镐、斧、铲或火把；缺配方或材料就用“受阻”上报，不要重复试错。',
  cook_meal: '生存任务： 执行食物补给任务。Ivy 优先找作物/动物/水源，Alex 负责安全和燃料，其他人只做近距离支援；成品食物放公共箱子并上报。',
  build_zone: '生存任务： 执行分区建造任务。Luna 先声明“正在做(建筑区域/坐标)”，其他人只供材料和补光，不要拆或覆盖 Luna 的方块；完成阶段后用 VILLAGE_REPORT 上报。',
  resource_chain: '生存任务： 执行资源接力。Milo 采石煤铁，Nova 标记安全路线，Ivy 保障食物，Alex 整理入库，Luna 只使用公共箱子材料建设；所有人用中文“需要/已有/完成”短句协调。'
}

class McpBridge {
  constructor(handlers) {
    this.handlers = handlers
    this.sseClients = new Map()
  }

  async handle(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/mcp/sse') {
      this.openLegacySse(req, res)
      return true
    }

    if (req.method === 'POST' && url.pathname === '/mcp/messages') {
      await this.handleLegacyMessage(req, res)
      return true
    }

    if (url.pathname === '/mcp' || url.pathname === '/api/mcp') {
      if (req.method === 'GET') {
        this.openStreamableSse(req, res)
        return true
      }
      if (req.method === 'POST') {
        await this.handleStreamablePost(req, res)
        return true
      }
      if (req.method === 'DELETE') {
        sendJson(res, 200, { ok: true })
        return true
      }
    }

    return false
  }

  openLegacySse(req, res) {
    if (!isLocalRequest(req)) {
      sendText(res, 403, 'Forbidden')
      return
    }

    const sessionId = crypto.randomUUID()
    this.writeSseHeaders(res)
    this.sseClients.set(sessionId, res)
    this.sendSse(res, 'endpoint', `/mcp/messages?sessionId=${encodeURIComponent(sessionId)}`)
    this.sendSse(res, 'message', {
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: {
        level: 'info',
        logger: 'minecraft-ai-friend',
        data: 'MCP SSE connected'
      }
    })

    const keepAlive = setInterval(() => {
      if (res.destroyed) return
      res.write(': keepalive\n\n')
    }, 30000)

    req.on('close', () => {
      clearInterval(keepAlive)
      this.sseClients.delete(sessionId)
    })
  }

  openStreamableSse(req, res) {
    if (!isLocalRequest(req)) {
      sendText(res, 403, 'Forbidden')
      return
    }

    this.writeSseHeaders(res)
    this.sendSse(res, 'message', {
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: {
        level: 'info',
        logger: 'minecraft-ai-friend',
        data: 'MCP stream opened'
      }
    })
  }

  async handleLegacyMessage(req, res) {
    if (!isLocalRequest(req)) {
      sendText(res, 403, 'Forbidden')
      return
    }

    const message = await readJson(req)
    const sessionId = new URL(req.url, 'http://127.0.0.1').searchParams.get('sessionId') || ''
    const response = await this.handleRpcMessage(message)
    if (!response) {
      sendText(res, 202, '')
      return
    }

    const sse = sessionId ? this.sseClients.get(sessionId) : null
    if (sse && !sse.destroyed) {
      this.sendSse(sse, 'message', response)
      sendText(res, 202, '')
      return
    }

    sendJson(res, 200, response)
  }

  async handleStreamablePost(req, res) {
    if (!isLocalRequest(req)) {
      sendText(res, 403, 'Forbidden')
      return
    }

    const message = await readJson(req)
    const response = await this.handleRpcMessage(message)
    if (!response) {
      sendText(res, 202, '')
      return
    }

    res.setHeader('MCP-Protocol-Version', MCP_PROTOCOL_VERSION)
    if (message && message.method === 'initialize') {
      res.setHeader('Mcp-Session-Id', crypto.randomUUID())
    }
    sendJson(res, 200, response)
  }

  async handleRpcMessage(message) {
    if (Array.isArray(message)) {
      const responses = []
      for (const item of message) {
        const response = await this.handleRpcMessage(item)
        if (response) responses.push(response)
      }
      return responses.length > 0 ? responses : null
    }

    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return rpcError(message && message.id !== undefined ? message.id : null, -32600, 'Invalid Request')
    }

    if (message.id === undefined || message.id === null) {
      return null
    }

    try {
      if (message.method === 'initialize') return rpcResult(message.id, initializeResult(message.params || {}))
      if (message.method === 'ping') return rpcResult(message.id, {})
      if (message.method === 'tools/list') return rpcResult(message.id, { tools: toolsList() })
      if (message.method === 'tools/call') {
        const result = await this.callTool(message.params || {})
        return rpcResult(message.id, result)
      }
      return rpcError(message.id, -32601, `Method not found: ${message.method}`)
    } catch (error) {
      return rpcResult(message.id, toolError(error.message))
    }
  }

  async callTool(params) {
    const name = String(params.name || '').trim()
    const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {}
    if (!name) return toolError('tool name is required')

    const tool = toolsByName().get(name)
    if (!tool) return toolError(`unknown tool: ${name}`)

    const data = await this.executeTool(name, args)
    return toolSuccess(data.summary || `${name} 执行完成`, data)
  }

  async executeTool(name, args) {
    if (name === 'get_play_status') {
      const status = await this.handlers.statusSnapshot()
      return {
        summary: summarizeStatus(status),
        status
      }
    }

    if (name === 'start_experience') {
      await this.handlers.ensureMinecraftServerReady()
      await this.handlers.startMindcraft()
      await this.handlers.ensureSocietyResidents({
        activateSociety: true,
        startAutopilot: true
      })
      this.handlers.autopilot.start()
      const status = await this.handlers.statusSnapshot()
      return {
        summary: `已启动陪玩体验：服务器 ${status.minecraft.tcpOpen ? '在线' : '未在线'}，Mindcraft ${status.mindcraft.httpOk ? '在线' : '未在线'}，自动陪玩 ${status.autopilot.active ? '运行中' : '未运行'}。`,
        status
      }
    }

    if (name === 'stop_all') {
      this.handlers.autopilot.stop()
      this.handlers.stopOwnedMindcraft()
      const status = await this.handlers.statusSnapshot()
      return {
        summary: '已停止自动陪玩，并请求停止由控制台启动的 Mindcraft。Minecraft 服务器不会被这个工具停止。',
        status
      }
    }

    if (name === 'create_agent') {
      const agentName = requireString(args.agent_name || args.name, 'agent_name')
      const result = await this.handlers.createAndJoinAgent({
        name: agentName,
        overwrite: Boolean(args.overwrite)
      })
      return {
        summary: `已创建或恢复 AI 队友 ${result.agent}，并请求进服。`,
        result
      }
    }

    if (name === 'send_task') {
      const task = normalizePresetTask(requireString(args.task, 'task'), args)
      const agent = String(args.agent_name || args.agent || '').trim()
      const result = await this.handlers.sendTask({
        agent,
        task
      })
      return {
        summary: `已向 ${result.targets.join(', ')} 发送任务。`,
        result
      }
    }

    if (name === 'locate_player') {
      const player = requireString(args.player_name || args.player, 'player_name')
      const result = await this.handlers.locatePlayer(player)
      const position = result.position || {}
      return {
        summary: `玩家 ${result.player || player} 坐标：X=${formatNumber(position.x)}, Y=${formatNumber(position.y)}, Z=${formatNumber(position.z)}。`,
        result
      }
    }

    if (name === 'activate_village') {
      const result = this.handlers.activateSocietyMode({
        agentFilter: args.agent_filter || args.agentFilter || '',
        startAutopilot: args.start_autopilot !== false,
        worldDirective: args.world_directive || args.worldDirective || ''
      })
      return {
        summary: `已激活常驻村庄模式，居民：${result.residents.join(', ') || '未配置'}。`,
        result
      }
    }

    if (name === 'village_report') {
      const status = await this.handlers.statusSnapshot()
      return {
        summary: summarizeVillage(status),
        village: status.village,
        society: this.handlers.societySnapshot()
      }
    }

    if (name === 'get_commander_context') {
      const context = this.handlers.commanderContextSnapshot({ limit: Number(args.limit || 20) })
      return {
        summary: `村长上下文已生成：${context.onlineAgents.length} 个在线居民，${context.recent.agentMemories.length} 条近期记忆。`,
        context
      }
    }

    if (name === 'get_agent_context') {
      const agent = requireString(args.agent_name || args.agent, 'agent_name')
      const context = this.handlers.agentContextSnapshot(agent, { limit: Number(args.limit || 20) })
      return {
        summary: `${agent} 上下文：${context.online ? '在线' : '离线'}，角色 ${context.assignment && context.assignment.role ? context.assignment.role.role : '未知'}。`,
        context
      }
    }

    if (name === 'record_agent_report') {
      const agent = requireString(args.agent_name || args.agent, 'agent_name')
      const result = this.handlers.recordAgentStatusReport({
        agent,
        status: args.status || 'info',
        task: args.task || '',
        summary: args.summary || args.description || '',
        needs: args.needs || [],
        has: args.has || [],
        projectId: args.project_id || args.projectId || '',
        source: 'mcp'
      })
      return {
        summary: `已记录 ${agent} 状态：${result.report.status}。`,
        result
      }
    }

    if (name === 'add_agent_memory') {
      const agent = requireString(args.agent_name || args.agent, 'agent_name')
      const result = await this.handlers.recordAgentMemoryNote({
        agent,
        kind: args.kind || 'note',
        importance: args.importance || 1,
        text: requireString(args.text || args.memory || args.note, 'text'),
        embeddingModel: args.embedding_model || args.embeddingModel || '',
        vectorId: args.vector_id || args.vectorId || '',
        source: 'mcp'
      })
      return {
        summary: `已写入 ${agent} 的长期记忆。`,
        result
      }
    }

    if (name === 'search_agent_memory') {
      const result = await this.handlers.searchAgentMemories({
        agent: args.agent_name || args.agent || '',
        q: args.query || args.q || '',
        limit: Number(args.limit || 20)
      })
      return {
        summary: `找到 ${result.results.length} 条记忆。`,
        result
      }
    }

    if (name === 'focus_live_observer') {
      const result = await this.handlers.focusLiveObserver({
        observer: args.observer || args.observer_name || 'live',
        target: args.target || args.agent_name || args.agent || 'auto'
      })
      return {
        summary: `${result.observer} 已切到 ${result.target}。`,
        result
      }
    }

    if (name === 'start_first_night') {
      const result = await this.handlers.sendTask({
        agent: String(args.agent_name || args.agent || '').trim(),
        task: FIRST_NIGHT_TASK
      })
      return {
        summary: `已开始“第一晚生存”陪玩，目标 AI：${result.targets.join(', ')}。`,
        result
      }
    }

    if (name === 'start_free_play') {
      const result = await this.handlers.sendTask({
        agent: String(args.agent_name || args.agent || '').trim(),
        task: FREE_PLAY_TASK
      })
      return {
        summary: `已切换自由陪玩模式，目标 AI：${result.targets.join(', ')}。`,
        result
      }
    }

    throw new Error(`unhandled tool: ${name}`)
  }

  writeSseHeaders(res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    })
  }

  sendSse(res, event, payload) {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
  }
}

function initializeResult(params) {
  const requested = params && params.protocolVersion ? String(params.protocolVersion) : MCP_PROTOCOL_VERSION
  return {
    protocolVersion: requested,
    capabilities: {
      tools: {
        listChanged: false
      }
    },
    serverInfo: MCP_SERVER_INFO,
    instructions: '这个 MCP server 允许 CoPaw/小智通过自然语言控制本机 Minecraft AI 陪玩控制台。高风险操作仍应由用户确认。'
  }
}

function toolsList() {
  return [
    {
      name: 'get_play_status',
      title: '获取陪玩状态',
      description: '获取完整状态，包括 Minecraft 服务器、Mindcraft、AI bot、自动陪玩和村庄计划。',
      inputSchema: objectSchema({})
    },
    {
      name: 'start_experience',
      title: '一键启动陪玩',
      description: '启动 Minecraft 服务器、Mindcraft、恢复常驻居民并启动自动陪玩。',
      inputSchema: objectSchema({})
    },
    {
      name: 'stop_all',
      title: '停止 AI 服务',
      description: '停止自动陪玩，并停止由控制台启动的 Mindcraft。默认不停止 Minecraft 服务器，避免误关世界。',
      inputSchema: objectSchema({})
    },
    {
      name: 'create_agent',
      title: '创建 AI 队友',
      description: '创建或复用一个 Mindcraft AI Profile，并请求它进入当前服务器。',
      inputSchema: objectSchema({
        agent_name: { type: 'string', description: 'AI 队友名字，只能使用 Minecraft 可接受的名字。' },
        overwrite: { type: 'boolean', description: '是否覆盖已有 profile。默认 false。' }
      }, ['agent_name'])
    },
    {
      name: 'send_task',
      title: '发送 AI 任务',
      description: '给指定 AI 队友发送 Minecraft 任务。有预设任务 first_night、free_play、gather_wood、mine、build_base、guard_base、sync_status、shared_storage、craft_tools、cook_meal、build_zone、resource_chain，也支持自定义任务。',
      inputSchema: objectSchema({
        agent_name: { type: 'string', description: 'AI 队友名字；留空表示所有在线 AI。' },
        task: { type: 'string', description: '任务内容或预设名称。' },
        args: { type: 'object', description: '额外参数。' }
      }, ['task'])
    },
    {
      name: 'locate_player',
      title: '定位真人玩家',
      description: '通过 Minecraft 服务端查询真人玩家坐标。',
      inputSchema: objectSchema({
        player_name: { type: 'string', description: '真人玩家名，例如 MengMeng。' }
      }, ['player_name'])
    },
    {
      name: 'activate_village',
      title: '激活村庄计划',
      description: '激活常驻生存村庄模式，配置村长、居民、资源目标和自动陪玩。',
      inputSchema: objectSchema({
        agent_filter: { type: 'string', description: '居民列表，逗号分隔，例如 Alex,Luna。留空使用当前村庄角色。' },
        world_directive: { type: 'string', description: '长期村庄目标。' },
        start_autopilot: { type: 'boolean', description: '是否启动自动陪玩，默认 true。' }
      })
    },
    {
      name: 'village_report',
      title: '村庄状态报告',
      description: '返回村庄、村长、居民、资源目标、项目和公共设施的精简中文报告。',
      inputSchema: objectSchema({})
    },
    {
      name: 'focus_live_observer',
      title: '直播观察者跟随活跃 AI',
      description: '把 live/ServerTV 等旁观账号切到旁观模式，并自动 spectate 最活跃的 AI，或指定目标 AI。',
      inputSchema: objectSchema({
        observer: { type: 'string', description: '观察者账号，默认 live。' },
        target: { type: 'string', description: '目标 AI 名字；auto 表示自动选择最活跃 AI。' }
      })
    },
    {
      name: 'get_commander_context',
      title: '获取村长全局上下文',
      description: '获取村长用于决策的全局上下文，包括在线居民、项目、资源、状态上报、长期记忆和可用接口。',
      inputSchema: objectSchema({
        limit: { type: 'number', description: '近期事件数量，默认 20。' }
      })
    },
    {
      name: 'get_agent_context',
      title: '获取居民上下文',
      description: '获取单个 AI 居民的当前状态、角色任务、个人记忆、状态上报和公共设施记录。',
      inputSchema: objectSchema({
        agent_name: { type: 'string', description: 'AI 居民名字，例如 Alex。' },
        limit: { type: 'number', description: '近期事件数量，默认 20。' }
      }, ['agent_name'])
    },
    {
      name: 'record_agent_report',
      title: '记录居民状态上报',
      description: '写入一个 AI 居民的结构化状态上报，供村长下次派工使用。',
      inputSchema: objectSchema({
        agent_name: { type: 'string', description: 'AI 居民名字。' },
        status: { type: 'string', description: 'working、blocked、done、idle、info 或 need_help。' },
        task: { type: 'string', description: '当前任务。' },
        summary: { type: 'string', description: '状态摘要。' },
        needs: { type: 'array', items: { type: 'string' }, description: '缺少的物资或帮助。' },
        has: { type: 'array', items: { type: 'string' }, description: '已有的关键物资。' },
        project_id: { type: 'string', description: '关联项目 ID。' }
      }, ['agent_name'])
    },
    {
      name: 'add_agent_memory',
      title: '写入居民长期记忆',
      description: '给指定 AI 居民写入长期记忆。可附带 embedding_model/vector_id，方便接本地向量库。',
      inputSchema: objectSchema({
        agent_name: { type: 'string', description: 'AI 居民名字。' },
        text: { type: 'string', description: '记忆文本。' },
        kind: { type: 'string', description: 'route、resource、building、risk、preference 或 note。' },
        importance: { type: 'number', description: '重要度 1-5。' },
        embedding_model: { type: 'string', description: '可选，生成向量的模型。' },
        vector_id: { type: 'string', description: '可选，外部向量库 ID。' }
      }, ['agent_name', 'text'])
    },
    {
      name: 'search_agent_memory',
      title: '搜索居民记忆',
      description: '搜索单个居民或全局长期记忆。优先使用本地向量记忆检索；向量模型或向量库不可用时自动降级为 SQLite 文本检索。',
      inputSchema: objectSchema({
        agent_name: { type: 'string', description: '可选，AI 居民名字。' },
        query: { type: 'string', description: '检索文本。' },
        limit: { type: 'number', description: '返回数量，默认 20。' }
      })
    },
    {
      name: 'start_first_night',
      title: '第一晚生存',
      description: '启动第一晚生存陪玩任务，适合新玩家入门。',
      inputSchema: objectSchema({
        agent_name: { type: 'string', description: '目标 AI；留空表示所有在线 AI。' }
      })
    },
    {
      name: 'start_free_play',
      title: '自由陪玩',
      description: '让 AI 作为自主玩家自由活动，补光、收集资源、巡逻、改善基地或响应玩家求助。',
      inputSchema: objectSchema({
        agent_name: { type: 'string', description: '目标 AI；留空表示所有在线 AI。' }
      })
    }
  ]
}

function toolsByName() {
  return new Map(toolsList().map(tool => [tool.name, tool]))
}

function objectSchema(properties, required = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false
  }
}

function normalizePresetTask(task, args) {
  const preset = String(task || '').trim().toLowerCase()
  if (preset === 'first_night') return FIRST_NIGHT_TASK
  if (preset === 'free_play') return FREE_PLAY_TASK
  if (preset === 'gather_wood') return '生存任务： 在基地附近安全采集木头，优先砍少量树，避免跑远；采集后把多余木头放进公共箱子，并用 VILLAGE_REPORT 上报进度。'
  if (preset === 'mine' || preset === 'mine_diamond') return '生存任务： 执行安全采矿任务。优先在基地附近寻找低风险矿点，采集石头、煤和铁，补光路线，避免深洞、岩浆和长距离冒险，返回后把材料放进公共箱子并上报。'
  if (preset === 'build_base') return '生存任务： 改善基地。优先公共箱子、照明、门、简单墙体、道路和安全边界；不要拆真人玩家已有建筑，完成公共设施后用 VILLAGE_REPORT 上报。'
  if (preset === 'guard_base') return '生存任务： 巡逻基地周围，补光、处理近距离危险、标记坑洞和水边，夜晚优先留在基地附近保护公共区域。'
  if (COLLAB_TASKS[preset]) return COLLAB_TASKS[preset]

  const extra = args && args.args && typeof args.args === 'object'
    ? ` 额外参数：${JSON.stringify(args.args)}`
    : ''
  return `${task}${extra}`
}

function summarizeStatus(status) {
  const agents = ((status.socket && status.socket.agents) || []).filter(agent => agent.in_game)
  const lines = [
    `Minecraft：${status.minecraft && status.minecraft.tcpOpen ? '在线' : '离线'}，Mindcraft：${status.mindcraft && status.mindcraft.httpOk ? '在线' : '离线'}。`,
    `AI：${agents.length > 0 ? agents.map(agent => agent.name).join(', ') : '没有在线 AI'}。`,
    `自动陪玩：${status.autopilot && status.autopilot.active ? '运行中' : '已停止'}。`
  ]
  if (status.village && status.village.settlement) {
    lines.push(`村庄：${status.village.settlement.name}，基地 ${formatPosition(status.village.settlement.base)}。`)
  }
  return lines.join('\n')
}

function summarizeVillage(status) {
  const village = status.village || {}
  const commander = village.commander || {}
  const settlement = village.settlement || {}
  const socket = status.socket || {}
  const states = socket.states || {}
  const online = new Set(((socket.agents || []).filter(agent => agent.in_game).map(agent => agent.name)))
  const roles = Array.isArray(village.roles) ? village.roles : []
  const resources = Array.isArray(village.resources) ? village.resources : []
  const projects = Array.isArray(village.projects) ? village.projects : []
  const infrastructures = Array.isArray(village.infrastructures) ? village.infrastructures : []

  const lines = []
  lines.push(`🏘️ 村庄 ${settlement.name || 'AI Friend Village'}：${commander.title || 'AI村长'} ${commander.name || ''}`)
  if (settlement.base) lines.push(`📍 基地：${formatPosition(settlement.base)}；公共箱子：${formatPosition(settlement.publicChest)}`)
  if (roles.length > 0) {
    lines.push(`👥 居民：${roles.map(role => {
      const state = states[role.agent] || {}
      const gameplay = state.gameplay || {}
      const inventory = state.inventory || {}
      const action = state.action || {}
      const counts = inventory.counts || {}
      const topItems = Object.entries(counts).slice(0, 3).map(([name, count]) => `${name} ${count}`).join('，')
      const actionText = action.current || role.lastAction || '等待任务'
      return `${role.agent}${online.has(role.agent) ? '在线' : '离线'}：${actionText}${topItems ? `，持有 ${topItems}` : ''}${gameplay.position ? `，${formatPosition(gameplay.position)}` : ''}`
    }).join('；')}`)
  }
  if (resources.length > 0) {
    lines.push(`📦 资源目标：${resources.map(item => `${item.name} ${item.current || 0}/${item.target || 0}${item.unit || ''}`).join('，')}`)
  }
  const activeProjects = projects.filter(project => project.status === 'active').slice(0, 4)
  if (activeProjects.length > 0) {
    lines.push(`🏗️ 项目：${activeProjects.map(project => {
      const checklist = Array.isArray(project.checklist) ? project.checklist : []
      const done = checklist.filter(item => item.done).length
      return `${project.title} ${done}/${checklist.length} (${project.priority || 'P?'})`
    }).join('；')}`)
  }
  if (infrastructures.length > 0) {
    lines.push(`🧱 公共设施：${infrastructures.slice(-5).map(item => `${item.title || item.type}:${item.status}`).join('，')}`)
  }
  return lines.join('\n')
}

function formatPosition(position) {
  if (!position || typeof position !== 'object') return '未知'
  return `X=${formatNumber(position.x)}, Y=${formatNumber(position.y)}, Z=${formatNumber(position.z)}`
}

function formatNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(1) : '?'
}

function requireString(value, name) {
  const text = String(value || '').trim()
  if (!text) throw new Error(`${name} is required`)
  return text
}

function toolSuccess(text, data) {
  return {
    content: [
      { type: 'text', text },
      { type: 'text', text: JSON.stringify(data, null, 2) }
    ],
    structuredContent: data,
    isError: false
  }
}

function toolError(message) {
  return {
    content: [{ type: 'text', text: `MCP tool error: ${message}` }],
    isError: true
  }
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      data
    }
  }
}

function isLocalRequest(req) {
  const remote = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : ''
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1' || remote === ''
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

module.exports = { McpBridge, MCP_PROTOCOL_VERSION }
