'use strict'

const { EventEmitter } = require('node:events')

class MindcraftClient extends EventEmitter {
  constructor(options) {
    super()
    this.baseUrl = trimRightSlash(options.baseUrl)
    this.logger = options.logger
    this.engineSid = null
    this.connected = false
    this.running = false
    this.latestAgents = []
    this.latestState = null
    this.lastError = null
    this.lastConnectedAt = null
    this.lastErrorLoggedAt = 0
    this.lastErrorLoggedMessage = ''
    this.nextAckId = 1
    this.pendingAcks = new Map()
  }

  updateBaseUrl(baseUrl) {
    const next = trimRightSlash(baseUrl)
    if (next === this.baseUrl) return
    this.baseUrl = next
    this.engineSid = null
    this.connected = false
  }

  start() {
    if (this.running) return
    this.running = true
    this.connectLoop().catch(error => {
      this.lastError = error.message
      this.logger.error(`Mindcraft socket loop stopped: ${error.message}`)
    })
  }

  stop() {
    this.running = false
    this.engineSid = null
    this.connected = false
  }

  snapshot() {
    return {
      url: this.baseUrl,
      connected: this.connected,
      lastConnectedAt: this.lastConnectedAt,
      lastError: this.lastError,
      agents: this.latestAgents,
      states: summarizeStates(this.latestState)
    }
  }

  onlineAgentNames(filter) {
    const online = this.latestAgents.filter(agent => agent.in_game).map(agent => agent.name)
    return filter && filter.length > 0 ? online.filter(name => filter.includes(name)) : online
  }

  async sendAgentMessage(agentName, message) {
    if (!this.connected) throw new Error('Mindcraft socket is not connected')
    await this.emitSocket('send-message', agentName, { from: 'ADMIN', message })
  }

  async connectLoop() {
    while (this.running) {
      try {
        await this.open()
        await this.pollUntilDisconnected()
      } catch (error) {
        this.lastError = error.message
        this.logger.warn(`Mindcraft socket reconnecting: ${error.message}`)
      } finally {
        this.engineSid = null
        this.connected = false
      }
      await sleep(4000)
    }
  }

  logReconnectError(message) {
    const now = Date.now()
    if (message !== this.lastErrorLoggedMessage || now - this.lastErrorLoggedAt > 60000) {
      this.logger.warn(`Mindcraft socket reconnecting: `)
      this.lastErrorLoggedAt = now
      this.lastErrorLoggedMessage = message
    }
  }

  socketUrl() {
    const sid = this.engineSid ? `&sid=${encodeURIComponent(this.engineSid)}` : ''
    return `${this.baseUrl}/socket.io/?EIO=4&transport=polling${sid}`
  }

  async open() {
    const text = await getText(this.socketUrl())
    if (!text.startsWith('0')) throw new Error(`unexpected engine handshake: ${text.slice(0, 120)}`)
    const open = JSON.parse(text.slice(1))
    this.engineSid = open.sid
    this.logger.info(`Mindcraft engine connected sid=${this.engineSid}`)
    await this.sendPacket('40')
  }

  async pollUntilDisconnected() {
    while (this.running && this.engineSid) {
      const text = await getText(this.socketUrl())
      for (const packet of text.split('\x1e')) {
        await this.handlePacket(packet)
      }
    }
  }

  async handlePacket(packet) {
    if (!packet) return
    if (packet === '2') {
      this.sendPacket('3').catch(error => this.logger.warn(`Mindcraft pong failed: ${error.message}`))
      return
    }
    if (packet.startsWith('40')) {
      this.connected = true
      this.lastConnectedAt = new Date().toISOString()
      this.lastError = null
      this.logger.info('Mindcraft namespace connected')
      this.emitSocket('listen-to-agents').catch(error => {
        this.logger.warn(`listen-to-agents failed: ${error.message}`)
      })
      return
    }
    if (packet.startsWith('43')) {
      this.handleAckPacket(packet)
      return
    }
    if (!packet.startsWith('42')) return

    let payload
    try {
      payload = JSON.parse(packet.slice(2))
    } catch {
      return
    }
    const [event, ...args] = payload
    if (event === 'agents-status') {
      this.latestAgents = Array.isArray(args[0]) ? args[0] : []
      this.emit('agents-status', this.latestAgents)
      return
    }
    if (event === 'state-update') {
      this.latestState = args[0] || null
      this.emit('state-update', this.latestState)
      return
    }
    this.emit(event, ...args)
  }

  async sendPacket(packet) {
    return postText(this.socketUrl(), packet)
  }

  async emitSocket(event, ...args) {
    return this.sendPacket('42' + JSON.stringify([event, ...args]))
  }

  async emitSocketAck(event, ...args) {
    if (!this.connected) throw new Error('Mindcraft socket is not connected')
    const id = this.nextAckId++
    const packet = '42' + id + JSON.stringify([event, ...args])
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(id)
        reject(new Error(`Mindcraft socket ack timeout for ${event}`))
      }, 30000)
      this.pendingAcks.set(id, { resolve, reject, timer })
      this.sendPacket(packet).catch(error => {
        clearTimeout(timer)
        this.pendingAcks.delete(id)
        reject(error)
      })
    })
  }

  handleAckPacket(packet) {
    const match = packet.slice(2).match(/^(\d+)(.*)$/)
    if (!match) return
    const id = Number(match[1])
    const pending = this.pendingAcks.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pendingAcks.delete(id)
    try {
      const args = match[2] ? JSON.parse(match[2]) : []
      pending.resolve(args[0] === undefined ? args : args[0])
    } catch (error) {
      pending.reject(error)
    }
  }

  async createAgent(settings) {
    return this.emitSocketAck('create-agent', settings)
  }

  async startAgent(agentName) {
    return this.emitSocket('start-agent', agentName)
  }

  async stopAgent(agentName) {
    return this.emitSocket('stop-agent', agentName)
  }
}

async function getText(url) {
  const res = await fetch(url)
  const text = await res.text()
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${text}`)
  return text
}

async function postText(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status} ${text}`)
  return text
}

function summarizeStates(states) {
  const summary = {}
  for (const [agentName, state] of Object.entries(states || {})) {
    const gameplay = state.gameplay || {}
    const action = state.action || {}
    summary[agentName] = {
      position: gameplay.position || null,
      gamemode: gameplay.gamemode,
      biome: gameplay.biome,
      health: gameplay.health,
      hunger: gameplay.hunger,
      timeLabel: gameplay.timeLabel,
      action: action.current || null,
      isIdle: Boolean(action.isIdle)
    }
  }
  return summary
}

function trimRightSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = { MindcraftClient }
