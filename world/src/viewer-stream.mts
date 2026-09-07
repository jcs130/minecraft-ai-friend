/** Bounded, cancellable observation streams over Mineflayer's already-loaded world. */
const turn = () => new Promise(resolve => setTimeout(resolve, 0))
const keyFor = (x, z) => `${Math.floor(x / 16) * 16},${Math.floor(z / 16) * 16}`
export function viewerTransportWritable(socket) {
  return socket.connected && socket.conn?.transport?.writable !== false && (socket.conn?.writeBuffer?.length ?? 0) <= 4
}
export function createViewerChunkStream({ bot, socket, emit, viewDistance = 3, onError = () => {}, now = Date.now }) {
  const world = bot.world, loaded = new Map(), pending = new Map(), blocks = new Map()
  let center = null, active = null, closed = false, stallAt = null, epoch = 0
  const counters = { sentChunks: 0, sentBytes: 0, sentBlockUpdates: 0, coalescedChunks: 0, error: null }
  const allowed = (x, z) => center && Math.abs(Math.floor(x / 16) - center.x) < viewDistance && Math.abs(Math.floor(z / 16) - center.z) < viewDistance
  function remove(x, z) {
    const key = keyFor(x, z); pending.delete(key)
    if (loaded.delete(key) && socket.connected) emit('unloadChunk', { x: Math.floor(x / 16) * 16, z: Math.floor(z / 16) * 16 })
  }
  function enqueue(pos) {
    if (closed || !Number.isFinite(pos?.x) || !Number.isFinite(pos?.z) || !allowed(pos.x, pos.z)) return
    const key = keyFor(pos.x, pos.z)
    if (pending.has(key)) counters.coalescedChunks++
    pending.set(key, { x: Math.floor(pos.x / 16) * 16, z: Math.floor(pos.z / 16) * 16 })
    void drive()
  }
  async function drain() {
    while (!closed && socket.connected && bot.world === world && (pending.size || blocks.size)) {
      if (!viewerTransportWritable(socket)) {
        stallAt ??= now()
        if (now() - stallAt > 10000) throw Error('viewer_backpressure_timeout')
        await new Promise(resolve => setTimeout(resolve, 20)); continue
      }
      stallAt = null
      if (pending.size) {
        const [key, pos] = pending.entries().next().value; pending.delete(key)
        if (!allowed(pos.x, pos.z)) continue
        // Mineflayer uses WorldSync.getColumn: getLoadedColumn, never disk or generation.
        const column = world.getColumn?.(pos.x / 16, pos.z / 16) ?? world.getColumnAt?.(pos)
        if (!column || typeof column.then === 'function' || typeof column.toJson !== 'function' || loaded.get(key) === column) continue
        const generation = epoch, chunk = column.toJson()
        if (typeof chunk !== 'string' || Buffer.byteLength(chunk) > 4 * 1024 * 1024) throw Error('viewer_chunk_size_invalid')
        const minY = column.minY, worldHeight = column.worldHeight
        if (!Number.isInteger(minY) || !Number.isInteger(worldHeight) || worldHeight <= 0 || worldHeight > 4096) throw Error('viewer_world_bounds_invalid')
        if (closed || generation !== epoch || !socket.connected || !allowed(pos.x, pos.z)) continue
        for (const [blockKey, update] of blocks) if (keyFor(update.pos.x, update.pos.z) === key) blocks.delete(blockKey)
        // The auxiliary field is optional; the original column JSON remains intact.
        emit('loadChunk', { ...pos, chunk, worldConfig: { minY, worldHeight }, blockEntities: {}, isLightUpdate: false })
        loaded.set(key, column); counters.sentChunks++; counters.sentBytes += Buffer.byteLength(chunk)
      } else {
        for (const [key, update] of [...blocks].slice(0, 64)) {
          blocks.delete(key)
          if (allowed(update.pos.x, update.pos.z) && loaded.has(keyFor(update.pos.x, update.pos.z))) { emit('blockUpdate', update); counters.sentBlockUpdates++ }
        }
      }
      await turn() // one column per turn; do not monopolize the game's command process.
    }
  }
  function drive() {
    if (closed) return Promise.resolve()
    if (!active) active = Promise.resolve().then(drain).catch(error => {
      counters.error = error.message === 'viewer_backpressure_timeout' ? error.message : 'viewer_chunk_stream_failed'; close(); onError(counters.error)
    }).finally(() => { active = null; if (!closed && socket.connected && (pending.size || blocks.size)) void drive() })
    return active
  }
  async function updatePosition(pos) {
    if (closed || !pos || ![pos.x, pos.y, pos.z].every(Number.isFinite)) return
    const next = { x: Math.floor(pos.x / 16), z: Math.floor(pos.z / 16) }
    if (!center || next.x !== center.x || next.z !== center.z) {
      center = next; epoch++
      for (const key of new Set([...loaded.keys(), ...pending.keys()])) { const [x, z] = key.split(',').map(Number); if (!allowed(x, z)) remove(x, z) }
      const positions = []
      for (let dx = 1 - viewDistance; dx < viewDistance; dx++) for (let dz = 1 - viewDistance; dz < viewDistance; dz++) positions.push({ x: (next.x + dx) * 16, z: (next.z + dz) * 16, priority: dx * dx + dz * dz })
      positions.sort((a, b) => a.priority - b.priority)
      for (const pos of positions) if (!loaded.has(keyFor(pos.x, pos.z))) enqueue(pos)
    }
    return drive()
  }
  function blockUpdate(oldBlock, newBlock) {
    const pos = newBlock?.position ?? oldBlock?.position, stateId = newBlock?.stateId
    if (!pos || ![pos.x, pos.y, pos.z].every(Number.isFinite) || !Number.isInteger(stateId) || stateId < 0 || !allowed(pos.x, pos.z)) return
    if (blocks.size >= 2048) { loaded.delete(keyFor(pos.x, pos.z)); enqueue(pos); return }
    blocks.set(`${pos.x},${pos.y},${pos.z}`, { pos: { x: pos.x, y: pos.y, z: pos.z }, stateId }); void drive()
  }
  const chunkUnload = pos => { if (pos) remove(pos.x, pos.z) }
  bot.on('chunkColumnLoad', enqueue); bot.on('chunkColumnUnload', chunkUnload); bot.on('blockUpdate', blockUpdate)
  function close() {
    closed = true; epoch++; pending.clear(); blocks.clear(); loaded.clear()
    bot.off('chunkColumnLoad', enqueue); bot.off('chunkColumnUnload', chunkUnload); bot.off('blockUpdate', blockUpdate)
  }
  return { init: updatePosition, updatePosition, close,
    stats: () => ({ ...counters, pendingColumns: pending.size, loadedColumns: loaded.size, pendingBlockUpdates: blocks.size, maxVisibleColumns: (viewDistance * 2 - 1) ** 2 }) }
}

/** Coalesce per-entity changes; send compact movement instead of repeated NBT/equipment. */
export function createViewerEntityStream({ bot, socket, serialize, isHidden = () => false, distance = 48, maxEntities = 128 }) {
  const pending = new Map(), known = new Map(); let closed = false
  const counters = { sent: 0, coalesced: 0, filtered: 0 }
  const visible = entity => entity && entity !== bot.entity && entity.id !== undefined && entity.position && bot.entity?.position
    && Math.hypot(entity.position.x - bot.entity.position.x, entity.position.z - bot.entity.position.z) <= distance && !isHidden(entity)
  function remove(entity) {
    const id = String(entity?.id ?? entity); pending.delete(id)
    if (known.delete(id) && socket.connected) socket.emit('entity', { id: entity?.id ?? entity, delete: true })
  }
  function queue(entity, full = false) {
    if (closed || !entity) return
    const id = String(entity.id)
    if (!visible(entity)) { counters.filtered++; remove(entity); return }
    if (pending.has(id)) counters.coalesced++
    if (pending.size >= 512 && !pending.has(id)) { counters.filtered++; return }
    pending.set(id, { entity, full: full || pending.get(id)?.full === true })
  }
  function flush() {
    if (closed || !viewerTransportWritable(socket)) return
    for (const [id, row] of known) if (!visible(row.entity)) remove(row.entity)
    const distanceToBot = entity => Math.hypot(entity.position.x - bot.entity.position.x, entity.position.z - bot.entity.position.z)
    const entries = [...pending.values()].sort((a, b) => Number(b.entity.type === 'player') - Number(a.entity.type === 'player')
      || distanceToBot(a.entity) - distanceToBot(b.entity))
    pending.clear()
    for (const { entity, full } of entries) {
      const id = String(entity.id); if (!visible(entity)) { remove(entity); continue }
      if (!known.has(id) && known.size >= maxEntities) { counters.filtered++; continue }
      const initial = !known.has(id), previous = known.get(id), complete = initial || full ? serialize(entity) : null
      const properties = complete ? { ...complete } : null
      if (properties) for (const key of ['pos', 'position', 'yaw', 'pitch', 'headYaw', 'velocity']) delete properties[key]
      const fullSignature = properties ? JSON.stringify(properties) : previous?.fullSignature
      const changedProperties = initial || fullSignature !== previous?.fullSignature
      const value = changedProperties ? complete : {
        id: entity.id, pos: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
        position: { x: entity.position.x, y: entity.position.y, z: entity.position.z }, yaw: entity.yaw, pitch: entity.pitch, headYaw: entity.headYaw }
      const signature = JSON.stringify(value)
      if (previous?.signature === signature) continue
      socket.emit(changedProperties ? 'entity' : 'entityMoved', value); known.set(id, { entity, signature, fullSignature }); counters.sent++
    }
  }
  const timer = setInterval(flush, 100); timer.unref()
  return { queue, remove, visible, flush, stats: () => ({ ...counters, pendingEntities: pending.size, visibleEntities: known.size, maxEntities }),
    close() { closed = true; clearInterval(timer); pending.clear(); known.clear() } }
}
