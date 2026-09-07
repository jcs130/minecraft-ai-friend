/** Internal observer API. No models, Docker, arbitrary commands or player writes. */
import http from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createObserverInventoryReader, observerEquipmentSlot, observerItemIdentity } from '../src/observer-inventory.mts'

const NAME = /^[A-Za-z0-9_]{1,16}$/
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const DIMENSION = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
const OBSERVER = 'Goddess'
const LEASE_MS = 120_000
const FOLLOW_MS = 1_000
const hidden = new Set([OBSERVER, 'RenderBot', 'ProbeBot', 'QDRenderBot', 'QDSmokeProbe', 'QDSmokeBody'])
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null
const text = (value, max = 128) => typeof value === 'string' ? value.slice(0, max) : null
const position = value => value && [value.x, value.y, value.z].every(v => finite(v) !== null)
  && Math.abs(value.x) <= 30_000_000 && Math.abs(value.z) <= 30_000_000 && Math.abs(value.y) <= 30_000_000
  ? { x: value.x, y: value.y, z: value.z } : null
const dimension = value => typeof value === 'string' && DIMENSION.test(value) ? value
  : ['overworld', 'the_nether', 'the_end'].includes(value) ? 'minecraft:' + value : null
const online = bot => !!(bot?.username === OBSERVER && bot?.entity && position(bot.entity.position)
  && bot._client?.state === 'play' && bot._client?.ended !== true && bot._client?.socket?.destroyed !== true)

class EyeError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status }
}

function item(value, slot, bot, inventorySlot, now) {
  if (!value || typeof value.name !== 'string' || !Number.isInteger(value.count) || value.count <= 0) return null
  const identity = value.name === 'unknown' ? observerItemIdentity(bot, value, inventorySlot, now) : null
  return { slot, name: identity?.name ?? text(value.name), displayName: identity?.displayName ?? text(value.displayName), count: Math.min(value.count, 65536) }
}

export function createEyeController({ getBot, sendCommand, now = Date.now }) {
  if (typeof getBot !== 'function' || typeof sendCommand !== 'function') throw new TypeError('Eye adapters required')
  const readBot = getBot
  getBot = () => { try { return readBot() } catch { return null } }
  let lease = null, home = null, busy = false, pendingPark = false, parkAttempts = 0, closed = false
  let lastFollowAt = -Infinity, lastMovedAt = null, lastError = null, observedBot = null

  function targets(bot = getBot()) {
    if (!online(bot)) return []
    return Object.entries(bot.players ?? {}).slice(0, 1000).flatMap(([key, player]) => {
      const name = player?.username ?? key
      if (!NAME.test(name) || hidden.has(name)) return []
      return [{ name, uuid: UUID.test(player?.uuid ?? '') ? player.uuid.toLowerCase() : null,
        nearby: !!player?.entity?.position, position: position(player?.entity?.position),
        dimension: player?.entity?.position ? dimension(bot.game?.dimension) : null,
        inventoryAvailable: false }]
    }).sort((a, b) => a.name.localeCompare(b.name))
  }
  function resolveTarget(value) {
    if (typeof value !== 'string' || !(NAME.test(value) || UUID.test(value))) throw new EyeError('invalid_target')
    const rows = targets().filter(row => row.name.toLowerCase() === value.toLowerCase() || row.uuid === value.toLowerCase())
    if (rows.length !== 1) throw new EyeError('target_not_online', 409)
    return rows[0]
  }
  function captureHome(bot) {
    const pos = position(bot?.entity?.position), dim = dimension(bot?.game?.dimension)
    if (!pos || !dim) throw new EyeError('observer_location_unavailable', 503)
    return { position: pos, dimension: dim }
  }
  async function command(value, expected) {
    const result = await sendCommand(value)
    if (typeof result !== 'string' || /unknown|incorrect|no entity|not found|unable|cannot|error/i.test(result)
        || !expected.test(result)) throw new EyeError('observer_command_unacknowledged', 502)
  }
  function invalidate(reason) {
    lease = null
    if (home) pendingPark = true
    parkAttempts = 0
    if (reason) lastError = reason
  }
  async function parkStep() {
    if (!pendingPark || !home || busy || closed) return
    const bot = getBot()
    if (!online(bot)) { lastError = 'observer_offline'; return }
    busy = true
    try {
      // Only a validated location captured from the observer is interpolated.
      const pos = position(home.position), dim = dimension(home.dimension)
      if (!pos || !dim) throw new EyeError('park_location_invalid')
      await command(`execute in ${dim} run tp ${OBSERVER} ${pos.x.toFixed(3)} ${pos.y.toFixed(3)} ${pos.z.toFixed(3)}`, /Teleported\s+Goddess\b/i)
      pendingPark = false; home = null; parkAttempts = 0; lastError = null
    } catch {
      lastError = 'observer_park_failed'
      if (++parkAttempts >= 3) pendingPark = false
    } finally { busy = false }
  }
  async function followStep() {
    if (!lease || busy || closed || now() - lastFollowAt < FOLLOW_MS) return
    if (now() >= lease.expiresAt) { invalidate('lease_expired'); await parkStep(); return }
    const current = lease, bot = getBot()
    if (!online(bot) || current.bot !== bot) { invalidate('observer_reconnected_or_offline'); await parkStep(); return }
    try { resolveTarget(current.target.uuid ?? current.target.name) }
    catch { invalidate('target_not_online'); await parkStep(); return }
    busy = true; lastFollowAt = now()
    try {
      if (!current.armed) {
        // Vanilla rejects a no-op gamemode change with "Nothing changed".
        // The current protocol state already proves spectator in this case.
        if (bot.game?.gameMode !== 'spectator') await command(`gamemode spectator ${OBSERVER}`, /spectator/i)
        current.armed = true
      }
      if (lease !== current || now() >= current.expiresAt || !online(getBot()) || getBot() !== bot) return
      resolveTarget(current.target.uuid ?? current.target.name)
      await command(`tp ${OBSERVER} ${current.target.name}`, /Teleported\s+Goddess\b/i)
      lastMovedAt = now(); lastError = null
    } catch {
      invalidate('observer_follow_failed')
    } finally { busy = false }
  }
  async function tick() {
    if (closed) return
    const bot = getBot()
    if (observedBot && observedBot !== bot && lease) invalidate('observer_reconnected_or_offline')
    observedBot = bot
    if (lease && now() >= lease.expiresAt) invalidate('lease_expired')
    if (pendingPark) await parkStep()
    else await followStep()
  }
  async function control(body) {
    if (closed) throw new EyeError('observer_service_closed', 503)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new EyeError('invalid_request')
    if (Object.keys(body).some(key => !['action', 'target', 'renew', 'leaseId'].includes(key))) throw new EyeError('unknown_field')
    if (body.action === 'park') {
      if (Object.keys(body).length !== 1) throw new EyeError('park_takes_no_target')
      invalidate(null)
      await parkStep()
      return state()
    }
    if (body.action !== 'follow') throw new EyeError('invalid_action')
    if (body.renew !== undefined && typeof body.renew !== 'boolean') throw new EyeError('invalid_renew')
    const target = resolveTarget(body.target)
    if (body.renew === true) {
      if (!lease || now() >= lease.expiresAt || body.leaseId !== lease.id
          || target.name !== lease.target.name || target.uuid !== lease.target.uuid) throw new EyeError('lease_mismatch', 409)
      lease.expiresAt = now() + LEASE_MS
      return state()
    }
    if (body.leaseId !== undefined) throw new EyeError('lease_requires_explicit_renew')
    if (lease || busy || pendingPark || home) throw new EyeError('observer_busy_park_first', 409)
    const bot = getBot()
    if (!online(bot) || bot.username !== OBSERVER) throw new EyeError('observer_not_ready', 503)
    home = captureHome(bot)
    observedBot = bot
    lease = { id: randomUUID(), target, bot, expiresAt: now() + LEASE_MS, armed: false }
    lastError = null; lastFollowAt = -Infinity
    await followStep()
    if (!lease) { await parkStep(); throw new EyeError('observer_follow_failed', 502) }
    return state()
  }
  function state() {
    const bot = getBot(), isOnline = online(bot), raw = isOnline ? Object.values(bot.entities ?? {}) : []
    const rows = raw.slice(0, 128).flatMap(entity => {
      const pos = position(entity?.position)
      return pos ? [{ id: text(String(entity.id), 64), name: text(entity.username ?? entity.name),
        type: text(entity.type, 64), position: pos }] : []
    })
    const slots = isOnline && Array.isArray(bot.inventory?.slots) ? bot.inventory.slots : null
    return { schema: 1, project: 'qiandengji', generatedAt: new Date(now()).toISOString(),
      observer: { name: OBSERVER, online: isOnline,
        position: isOnline ? position(bot.entity.position) : null,
        dimension: isOnline ? dimension(bot.game?.dimension) : null,
        health: isOnline ? finite(bot.health) : null, food: isOnline ? finite(bot.food) : null,
        oxygen: isOnline ? finite(bot.oxygenLevel) : null, xpLevel: isOnline ? finite(bot.experience?.level) : null,
        inventory: { available: !!slots, owner: OBSERVER, scope: 'observer_inventory_only',
          slots: slots ? slots.slice(0, 46).flatMap((value, index) => { const row = item(value, index, bot, index, now()); return row ? [row] : [] }) : [] },
        equipment: isOnline && Array.isArray(bot.entity.equipment)
          ? bot.entity.equipment.slice(0, 6).map((value, index) => item(value, index, bot, observerEquipmentSlot(bot, index), now())) : null },
      follow: { active: !!lease && now() < lease.expiresAt, leaseId: lease?.id ?? null,
        target: lease?.target.name ?? null, expiresAt: lease ? new Date(lease.expiresAt).toISOString() : null,
        parked: !lease && !home && !pendingPark, parking: pendingPark, busy,
        lastMovedAt: lastMovedAt === null ? null : new Date(lastMovedAt).toISOString(), error: lastError },
      targets: targets(bot), entities: { available: isOnline, scope: 'observer_loaded_entities',
        total: raw.length, shown: rows.length, truncated: raw.length > 128, rows },
      limits: { leaseSeconds: LEASE_MS / 1000, followIntervalSeconds: FOLLOW_MS / 1000,
        remoteInventoryAvailable: false },
      scope: 'Observed protocol data; not a complete world map or selected player inventory' }
  }
  async function close() {
    invalidate(null)
    // If a command is already in flight, its finally releases busy. Stop
    // admitting new work and allow only this bounded wait before final park.
    const deadline = Date.now() + 6500
    while (busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    await parkStep()
    closed = true
  }
  return { state, control, tick, close }
}

export function startEyeService(options) {
  const token = options.token
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new TypeError('A dedicated observer token is required')
  const controller = createEyeController(options), expected = Buffer.from('Bearer ' + token)
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => {
      if (res.destroyed) return
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" })
      res.end(JSON.stringify(value))
    }
    const auth = Buffer.from(typeof req.headers.authorization === 'string' ? req.headers.authorization : '')
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return send(401, { ok: false, error: 'unauthorized' })
    if (req.headers.origin !== undefined) return send(403, { ok: false, error: 'browser_access_forbidden' })
    try {
      if (req.method === 'GET' && req.url === '/healthz') {
        const state = controller.state()
        return send(200, { ok: state.observer.online && !state.follow.error, service: 'qiandengji-eye', schema: 1,
          observerOnline: state.observer.online, parking: state.follow.parking, error: state.follow.error })
      }
      if (req.method === 'GET' && req.url === '/state') return send(200, controller.state())
      if (req.url !== '/observer') return send(404, { ok: false, error: 'not_found' })
      if (req.method !== 'POST') return send(405, { ok: false, error: 'method_not_allowed' })
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return send(415, { ok: false, error: 'json_required' })
      const chunks = []; let length = 0
      for await (const chunk of req) {
        length += chunk.length
        if (length > 2048) return send(413, { ok: false, error: 'request_too_large' })
        chunks.push(chunk)
      }
      let body
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
      catch { return send(400, { ok: false, error: 'invalid_json' }) }
      const state = await controller.control(body)
      return send(200, { ok: !state.follow.error, state })
    } catch (error) {
      return send(error instanceof EyeError ? error.status : 500,
        { ok: false, error: error instanceof EyeError ? error.code : 'observer_service_failed' })
    }
  })
  server.headersTimeout = 5000; server.requestTimeout = 5000; server.keepAliveTimeout = 1000; server.maxConnections = 12
  const ready = new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 3080, options.host ?? '0.0.0.0', resolve) })
  const timer = setInterval(() => { void controller.tick().catch(() => {}) }, FOLLOW_MS)
  timer.unref()
  const inventoryReader = createObserverInventoryReader(options)
  const inventoryTimer = setInterval(() => { void inventoryReader.refresh().catch(() => {}) }, 5000)
  inventoryTimer.unref()
  const stopInventory = () => { clearInterval(inventoryTimer); inventoryReader.close() }
  return { ready, server, getState: controller.state,
    close: async () => { clearInterval(timer); stopInventory(); await controller.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) },
    dispose: async () => { clearInterval(timer); stopInventory(); await controller.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } }
}
