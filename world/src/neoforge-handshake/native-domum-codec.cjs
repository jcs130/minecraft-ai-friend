'use strict'

// Domum Ornamentum 1.0.231 (04c0c902...65610a1), MaterialTextureData:
// ByteBufCodecs.map(ResourceLocation.STREAM_CODEC,
//                   ByteBufCodecs.registry(Registries.BLOCK)).
// The value is a BLOCK registry VarInt, not an item ID, state ID or NBT.
// Keep entry order and IDs as sent; only the vanilla projection omits this
// component. These defensive limits describe decoder support, not native rules.
const MAX_ENTRIES = 256
const MAX_BYTES = 1024 * 1024
const MAX_STRING_CHARS = 32767
const RESOURCE = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/

function readTextureData (buffer, start) {
  let offset = start
  function available (length) {
    if (!Number.isInteger(length) || length < 0 || offset - start + length > MAX_BYTES) throw Error('DOMUM_COMPONENT_TOO_LARGE')
    if (offset < 0 || offset + length > buffer.length) throw Error('TRUNCATED_DOMUM_COMPONENT')
  }
  function varint () {
    let result = 0
    for (let index = 0; index < 5; index++) {
      available(1)
      const byte = buffer[offset++]
      if (index === 4 && byte > 7) throw Error('INVALID_DOMUM_VARINT')
      result += (byte & 127) * 2 ** (7 * index)
      if (!(byte & 128)) {
        if (index > 0 && byte === 0) throw Error('INVALID_DOMUM_VARINT')
        return result
      }
    }
    throw Error('INVALID_DOMUM_VARINT')
  }
  function resource () {
    const length = varint()
    if (length > MAX_STRING_CHARS * 3) throw Error('INVALID_DOMUM_RESOURCE_LENGTH')
    available(length)
    const encoded = buffer.subarray(offset, offset + length)
    const result = encoded.toString('utf8')
    if (result.length > MAX_STRING_CHARS || !Buffer.from(result, 'utf8').equals(encoded) || !RESOURCE.test(result)) throw Error('INVALID_DOMUM_RESOURCE')
    offset += length
    return result
  }
  const count = varint()
  if (count > MAX_ENTRIES) throw Error('UNSUPPORTED_DOMUM_TEXTURE_ENTRY_COUNT')
  const entries = [], names = new Set()
  for (let index = 0; index < count; index++) {
    const componentId = resource()
    if (names.has(componentId)) throw Error('INVALID_DOMUM_DUPLICATE_TEXTURE_COMPONENT')
    names.add(componentId)
    entries.push({ componentId, blockRegistryId: varint() })
  }
  return { value: { entries }, size: offset - start }
}

function encodeTextureData (value, buffer, start) {
  let offset = start
  function advance (length) {
    const from = offset
    offset += length
    if (offset - start > MAX_BYTES) throw Error('DOMUM_COMPONENT_TOO_LARGE')
    if (buffer && (from < 0 || offset > buffer.length)) throw Error('TRUNCATED_DOMUM_COMPONENT')
    return from
  }
  function varint (value) {
    if (!Number.isInteger(value) || value < 0 || value > 2147483647) throw Error('INVALID_DOMUM_VARINT')
    do {
      const from = advance(1), byte = value & 127
      value = Math.floor(value / 128)
      if (buffer) buffer[from] = value ? byte | 128 : byte
    } while (value)
  }
  function resource (value) {
    if (typeof value !== 'string' || value.length > MAX_STRING_CHARS || !RESOURCE.test(value)) throw Error('INVALID_DOMUM_RESOURCE')
    const encoded = Buffer.from(value, 'utf8')
    if (encoded.length > MAX_STRING_CHARS * 3 || encoded.toString('utf8') !== value) throw Error('INVALID_DOMUM_RESOURCE')
    varint(encoded.length)
    const from = advance(encoded.length)
    if (buffer) encoded.copy(buffer, from)
  }
  if (!value || !Array.isArray(value.entries)) throw Error('INVALID_DOMUM_TEXTURE_DATA')
  if (value.entries.length > MAX_ENTRIES) throw Error('UNSUPPORTED_DOMUM_TEXTURE_ENTRY_COUNT')
  varint(value.entries.length)
  const names = new Set()
  for (const entry of value.entries) {
    if (names.has(entry?.componentId)) throw Error('INVALID_DOMUM_DUPLICATE_TEXTURE_COMPONENT')
    names.add(entry?.componentId)
    resource(entry?.componentId)
    varint(entry?.blockRegistryId)
  }
  return offset
}

const domumNativeTypes = {
  Read: { mawDomumTextureDataCodec: ['native', readTextureData] },
  Write: { mawDomumTextureDataCodec: ['native', (value, buffer, offset) => encodeTextureData(value, buffer, offset)] },
  SizeOf: { mawDomumTextureDataCodec: ['native', value => encodeTextureData(value, null, 0)] }
}

module.exports = { domumNativeTypes, MAX_ENTRIES, MAX_BYTES }
