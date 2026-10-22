'use strict'

// Original TF 4.8.3345 UpdateTFMultipartPacket / PartDataHolder StreamCodec.
// These are the same connection's real Naga/Hydra/etc. parts, not invented
// vanilla actors. Metadata is decoded by this server's actual serializer map.
const CHANNEL = 'twilightforest:update_multipart_entity'
const SOURCE_SHA256 = '493da16d10210f9f53a3c33b3d8fcb4ae9b14016ee420d753c894562bd9aba35'
function decodeTwilightMultipart (data, protocol) {
  if (!Buffer.isBuffer(data) || data.length < 8 || data.length > 262144 || typeof protocol?.parsePacketBuffer !== 'function') throw Error('NATIVE_TWILIGHT_MULTIPART_INVALID')
  let offset = 0
  const read = (kind, bytes) => {
    if (offset + bytes > data.length) throw Error('NATIVE_TWILIGHT_MULTIPART_TRUNCATED')
    const value = data[kind](offset); offset += bytes; return value
  }
  const entityId = read('readInt32BE', 4), parts = [], seen = new Set()
  if (entityId <= 0) throw Error('NATIVE_TWILIGHT_MULTIPART_PARENT_INVALID')
  while (true) {
    const partId = read('readInt32BE', 4)
    if (partId === -1) break
    if (partId <= 0 || partId === entityId || seen.has(partId) || parts.length >= 128) throw Error('NATIVE_TWILIGHT_MULTIPART_PART_INVALID')
    seen.add(partId)
    const position = Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, read('readDoubleBE', 8)]))
    const yaw = read('readFloatBE', 4), pitch = read('readFloatBE', 4), width = read('readFloatBE', 4), height = read('readFloatBE', 4), fixed = read('readUInt8', 1)
    if (!Object.values(position).every(x => Number.isFinite(x) && Math.abs(x) <= 30000000) ||
      ![yaw, pitch, width, height].every(Number.isFinite) || width < 0 || height < 0 || width > 128 || height > 128 || fixed > 1) throw Error('NATIVE_TWILIGHT_MULTIPART_VALUE_INVALID')
    const decoded = protocol.parsePacketBuffer('entityMetadata', data.subarray(offset))
    if (!Number.isInteger(decoded.metadata?.size) || decoded.metadata.size < 1 || offset + decoded.metadata.size > data.length || !Array.isArray(decoded.data) || decoded.data.length > 128) throw Error('NATIVE_TWILIGHT_MULTIPART_METADATA_INVALID')
    offset += decoded.metadata.size
    parts.push({ entityId: partId, position, yaw, pitch, width, height, fixed: fixed === 1, metadata: decoded.data })
  }
  if (offset !== data.length) throw Error('NATIVE_TWILIGHT_MULTIPART_TRAILING_BYTES')
  return { entityId, parts, sourceChannel: CHANNEL, sourceJarSha256: SOURCE_SHA256 }
}
module.exports = { CHANNEL, SOURCE_SHA256, decodeTwilightMultipart }
