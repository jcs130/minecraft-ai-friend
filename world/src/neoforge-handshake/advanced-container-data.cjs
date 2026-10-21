'use strict'
// NeoForge 21.1.250 AdvancedContainerSetDataPayload.STREAM_CODEC:
// BYTE containerId, SHORT dataId, VAR_INT value (signed, up to 32 bits).
// Confirmed against the installed universal JAR, not a later protocol schema.
const CHANNEL = 'neoforge:advanced_container_set_data'
function decodeAdvancedContainerData (bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4 || bytes.length > 8) throw Error('INVALID_ADVANCED_CONTAINER_DATA')
  let value = 0, offset = 3
  for (let shift = 0; shift < 35; shift += 7) {
    if (offset >= bytes.length) throw Error('INVALID_ADVANCED_CONTAINER_DATA')
    const b = bytes[offset++]
    if (shift === 28 && (b & 0xf0)) throw Error('INVALID_ADVANCED_CONTAINER_DATA')
    value |= (b & 127) << shift
    if (!(b & 128)) {
      if (offset !== bytes.length) throw Error('INVALID_ADVANCED_CONTAINER_DATA')
      return { windowId: bytes.readUInt8(0), property: bytes.readInt16BE(1), value }
    }
  }
  throw Error('INVALID_ADVANCED_CONTAINER_DATA')
}
module.exports = { CHANNEL, decodeAdvancedContainerData }
