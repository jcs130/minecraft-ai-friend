'use strict'
const { readStateCatalog } = require('./native-world.cjs')
const P = require('./registry-protocol.cjs')
const ITEM_PACKETS = new Set(['window_items', 'set_slot', 'entity_equipment', 'trade_list', 'entity_metadata', 'advancements'])
const KEY = 'mcagent_native'

function loadDirectGateway (stateFile, hash, visitChunk) {
  const source = readStateCatalog(stateFile, hash)
  const catalog = new Map([...source].map(([id, row]) => [id, P.stateRow(row)]))
  if (typeof visitChunk !== 'function') throw Error('NATIVE_CHUNK_VISITOR_REQUIRED')
  return function session () {
    let mode = null, sequence = 0, started = false
    const sent = new Set()
    const stats = { registryMessages: 0, registryBytes: 0, stateDefinitions: 0, nativeItemsNamed: 0 }
    function subscribe (bytes, phase) {
      if (started || !['config', 'play_pending', 'play'].includes(phase)) throw Error('NATIVE_SUBSCRIBE_BEFORE_STREAM_REQUIRED')
      const value = P.decode(bytes)
      if (value.kind !== 'hello' || !['stream_catalog', 'external_catalog'].includes(value.mode) ||
          Object.keys(value).some(k => !['schemaVersion', 'protocol', 'kind', 'mode', 'registrySha256'].includes(k)) ||
          (value.mode === 'external_catalog' && value.registrySha256 !== hash) ||
          (value.mode === 'stream_catalog' && value.registrySha256 !== undefined) || (mode && mode !== value.mode)) throw Error('NATIVE_REGISTRY_HELLO_INVALID')
      mode = value.mode
    }
    function beforePacket (name, params, send) {
      if (!mode) return false
      function emit (value) { const bytes = P.encode(value); send({ channel: P.CHANNEL, data: bytes }); stats.registryMessages++; stats.registryBytes += bytes.length }
      if (!started) {
        started = true
        emit({ schemaVersion: 1, protocol: 1, kind: 'manifest', sequence: 0, minecraftVersion: '1.21.1', registrySha256: hash,
          mode, stateCount: catalog.size, source: 'same_connection_received_states', complete: false,
          maxMessageBytes: P.MAX_BYTES, maxStateDefinitions: P.MAX_ROWS })
      }
      if (mode !== 'stream_catalog') return true
      const ids = new Set()
      if (name === 'map_chunk') visitChunk(params.chunkData, (_section, cells) => { for (const id of cells) if (!sent.has(id)) ids.add(id) })
      else if (name === 'block_change') ids.add(params.type)
      else if (name === 'multi_block_change') for (const value of params.records) {
        if (!Number.isSafeInteger(value) || value < 0) throw Error('NATIVE_SECTION_RECORD_INVALID')
        ids.add(Math.floor(value / 4096))
      }
      const rows = [...ids].filter(id => !sent.has(id)).sort((a, b) => a - b).map(id => {
        const row = catalog.get(id); if (!row) throw Error('NATIVE_STATE_DEFINITION_MISSING ' + id)
        return row
      })
      const envelope = page => ({ schemaVersion: 1, protocol: 1, kind: 'states', sequence: sequence + 1, registrySha256: hash, rows: page })
      let page = []
      function flush () {
        if (!page.length) return
        emit(envelope(page)); sequence++
        for (const row of page) sent.add(row.stateId)
        stats.stateDefinitions += page.length; page = []
      }
      for (const row of rows) {
        if (page.length && (page.length >= P.MAX_PAGE_ROWS || Buffer.byteLength(JSON.stringify(envelope([...page, row]))) > P.MAX_BYTES)) flush()
        page.push(row)
        P.encode(envelope(page)) // One unrepresentable row fails; do not invent geometry.
      }
      flush()
      return true
    }
    function itemNames (name, params, registry) {
      if (!ITEM_PACKETS.has(name)) return params
      function visit (value) {
        if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return value
        if (Array.isArray(value)) return value.map(visit)
        const copy = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visit(v)]))
        if (!Number.isInteger(value.itemCount) || value.itemCount <= 0 || !Number.isInteger(value.itemId)) return copy
        const id = registry?.get(value.itemId)
        if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id || '') || !P.HASH.test(hash)) throw Error('NATIVE_ITEM_REGISTRY_UNAVAILABLE')
        if (id.startsWith('minecraft:')) return copy
        const components = copy.components || (copy.components = [])
        let custom = components.find(c => c.type === 'custom_data')
        if (!custom) { custom = { type: 'custom_data', data: { type: 'compound', value: {} } }; components.push(custom) }
        if (custom.data?.type !== 'compound' || !custom.data.value || KEY in custom.data.value) throw Error('NATIVE_ITEM_MARKER_NAMESPACE_CONFLICT')
        custom.data.value[KEY] = { type: 'compound', value: { schemaVersion: { type: 'int', value: 1 },
          id: { type: 'string', value: id }, registrySha256: { type: 'string', value: hash }, projectionOnly: { type: 'byte', value: 1 } } }
        // Only the wire display gets a fallback. Do not overwrite an actual
        // custom/item name, author an invented translation or change server items.
        if (!components.some(c => c.type === 'custom_name' || c.type === 'item_name')) {
          components.push({ type: 'custom_name', data: { type: 'string', value: id } })
        }
        copy.removeComponents = (copy.removeComponents || []).filter(type => !components.some(c => c.type === type))
        copy.addedComponentCount = components.length; copy.removedComponentCount = copy.removeComponents.length
        stats.nativeItemsNamed++
        return copy
      }
      return visit(params)
    }
    return { subscribe, beforePacket, itemNames, enabled: () => mode !== null, stats }
  }
}
module.exports = { loadDirectGateway, KEY }
