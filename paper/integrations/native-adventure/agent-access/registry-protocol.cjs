'use strict'

// Same game connection, UTF-8 JSON. Only static definitions of states already
// present in this connection's chunk/update packets; no world lookup or scan.
const CHANNEL = 'mcagent:native_registry'
const MAX_BYTES = 16384
const MAX_ROWS = 100000
const MAX_PAGE_ROWS = 128
const RESOURCE = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
const HASH = /^[a-f0-9]{64}$/

function stateRow (row) {
  if (!row || !Number.isSafeInteger(row.stateId) || row.stateId < 0 || !RESOURCE.test(row.name || '') ||
      !Number.isSafeInteger(row.blockId) || row.blockId < 0 || typeof row.canOcclude !== 'boolean' ||
      !row.properties || Array.isArray(row.properties) || typeof row.properties !== 'object' ||
      Object.keys(row.properties).length > 64 || !Object.entries(row.properties).every(([k, v]) =>
        /^[a-z0-9_]+$/.test(k) && typeof v === 'string' && v.length <= 128)) throw Error('NATIVE_STATE_ROW_INVALID')
  if (row.collisionBoxes !== null && (!Array.isArray(row.collisionBoxes) || row.collisionBoxes.length > 64 ||
      !row.collisionBoxes.every(b => Array.isArray(b) && b.length === 6 && b.every(n => Number.isFinite(n) && Math.abs(n) <= 4) &&
        b[0] <= b[3] && b[1] <= b[4] && b[2] <= b[5]))) throw Error('NATIVE_COLLISION_INVALID')
  if (row.destroySpeed !== null && !Number.isFinite(row.destroySpeed)) throw Error('NATIVE_HARDNESS_INVALID')
  return { stateId: row.stateId, blockId: row.blockId, name: row.name, properties: { ...row.properties },
    collisionBoxes: row.collisionBoxes?.map(b => [...b]) ?? null, canOcclude: row.canOcclude,
    destroySpeed: row.destroySpeed, requiresCorrectTool: row.requiresCorrectTool === true,
    dynamicShape: row.dynamicShape === true, hasOffsetFunction: row.hasOffsetFunction === true }
}

function encode (value) {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8')
  if (bytes.length > MAX_BYTES) throw Error('NATIVE_REGISTRY_PAYLOAD_BUDGET')
  return bytes
}
function decode (bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES) throw Error('NATIVE_REGISTRY_PAYLOAD_BUDGET')
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (value?.schemaVersion !== 1 || value.protocol !== 1) throw Error('NATIVE_REGISTRY_PROTOCOL_MISMATCH')
  return value
}
function hello (mode, hash) {
  if (!['stream_catalog', 'external_catalog'].includes(mode) || (mode === 'external_catalog' && !HASH.test(hash || ''))) throw Error('NATIVE_REGISTRY_HELLO_INVALID')
  return { schemaVersion: 1, protocol: 1, kind: 'hello', mode, ...(mode === 'external_catalog' ? { registrySha256: hash } : {}) }
}
module.exports = { CHANNEL, MAX_BYTES, MAX_ROWS, MAX_PAGE_ROWS, HASH, stateRow, encode, decode, hello }
