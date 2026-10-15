'use strict'

// Exact server-exported protocol registrations. Optional use preserves the old
// gateway configuration. An invalid explicit manifest must never fall back to
// channel guessing or authentication attempts with a synthetic player.
const fs = require('node:fs')
function readChannelManifest (file) {
  if (!file) return null
  if (fs.statSync(file).size > 1024 * 1024) throw Error('CHANNEL_MANIFEST_TOO_LARGE')
  return channelKnowledge(JSON.parse(fs.readFileSync(file, 'utf8')))
}
function channelKnowledge (raw) {
  if (raw?.schemaVersion !== 1 || raw.minecraft !== '1.21.1' || raw.neoforge !== '21.1.248' ||
      !raw.protocols || Array.isArray(raw.protocols)) throw Error('CHANNEL_MANIFEST_VERSION')
  const result = new Map()
  for (const [bucket, entries] of Object.entries(raw.protocols)) {
    if (!['1', '4'].includes(bucket) || !Array.isArray(entries) || entries.length > 8192) throw Error('CHANNEL_MANIFEST_PROTOCOL')
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(entry.id || '') ||
          typeof entry.version !== 'string' || entry.version.length > 256 ||
          typeof entry.optional !== 'boolean' ||
          (entry.flow !== undefined && ![0, 1].includes(entry.flow))) throw Error('CHANNEL_MANIFEST_ENTRY')
      const key = bucket + '/' + entry.id
      if (result.has(key)) throw Error('CHANNEL_MANIFEST_DUPLICATE ' + entry.id)
      result.set(key, { id: entry.id, bucket: Number(bucket), version: entry.version, optional: entry.optional,
        flow: entry.flow ?? null, moves: 0, core: entry.id.startsWith('neoforge:') })
    }
  }
  if (!result.size) throw Error('CHANNEL_MANIFEST_EMPTY')
  return result
}
module.exports = { readChannelManifest, channelKnowledge }
