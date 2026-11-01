'use strict'

function strictParser (client) {
  const install = () => {
    const parser = client.deserializer
    if (!parser || parser.mawStrict) return
    parser.mawStrict = true
    const original = parser.parsePacketBuffer.bind(parser)
    parser.parsePacketBuffer = bytes => {
      try {
        const result = original(bytes)
        if (result.metadata.size !== bytes.length) throw new Error(`native_packet_trailing_bytes:${result.metadata.size}/${bytes.length}`)
        return result
      } catch (cause) {
        // FullPacketParser normally swallows PartialReadError. A native body
        // must fail explicitly, never keep operating on a dropped inventory.
        const error = new Error('native_packet_decode_failed:' + cause.message, { cause })
        error.code = 'NATIVE_PACKET_DECODE_FAILED'
        throw error
      }
    }
  }
  install(); client.on('state', install)
  client.on('error', error => { if (error.code === 'NATIVE_PACKET_DECODE_FAILED') client.end('native_packet_decode_failed') })
}

function nativeProtocolOverrides (data, base) {
  const types = structuredClone(base.types)
  const playTypes = structuredClone(base.play.toClient.types)
  const display = playTypes.RecipeDisplay
  const mappings = display[1][0].type[1].mappings
  const fields = display[1][1].type[1].fields
  const displays = data.fabricRegistries?.['minecraft:recipe_display']
  if (!displays || !Number.isInteger(displays['farmersdelight:cooking'])) throw new Error('native_cooking_recipe_display_not_discovered')
  // The exact 3.6.30 supplier STREAM_CODEC is list(SlotDisplay), optional,
  // result, station, INT (not VarInt), FLOAT. Preserve the mod's true ID.
  const id = displays['farmersdelight:cooking']
  mappings[id] = 'farmersdelight:cooking'
  fields['farmersdelight:cooking'] = ['container', [
    { name: 'ingredients', type: ['array', { countType: 'varint', type: 'SlotDisplay' }] },
    { name: 'container', type: ['option', 'SlotDisplay'] },
    { name: 'result', type: 'SlotDisplay' }, { name: 'craftingStation', type: 'SlotDisplay' },
    { name: 'duration', type: 'i32' }, { name: 'experience', type: 'f32' }
  ]]
  const componentMappings = {}
  const componentFields = types.SlotComponent[1][1].type[1].fields
  const knownGaps = new Set(['block_transformer', 'compostable', 'cooking_fuel', 'brewing_fuel', 'provides_pottery_pattern'])
  for (const row of data.components) {
    const name = row.name.replace(/^minecraft:/, '')
    componentMappings[row.id] = name
    if (!componentFields[name] || knownGaps.has(name)) componentFields[name] = ['failNativeCodec', { name: row.name }]
  }
  types.failNativeCodec = 'native'
  types.SlotComponentType[1].mappings = componentMappings
  const MawExtendedMenu = ['container', [
    { name: 'identifier', type: 'string' }, { name: 'containerId', type: 'i8' },
    { name: 'title', type: 'anonymousNbt' }, { name: 'extraData', type: 'restBuffer' }
  ]]
  return { '26.3': { types, play: { toClient: { types: { RecipeDisplay: display, MawExtendedMenu } } } } }
}

module.exports = { strictParser, nativeProtocolOverrides }
