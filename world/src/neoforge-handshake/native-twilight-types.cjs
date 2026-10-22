'use strict'

// Audited from Twilight Forest 4.8.3345 (MC 1.21.1), original JAR SHA256
// 493da16d10210f9f53a3c33b3d8fcb4ae9b14016ee420d753c894562bd9aba35.
// TFDataComponents and each referenced component's STREAM_CODEC are the wire
// authority; persistent JSON codecs are used only when the builder defaults to
// ByteBufCodecs.fromCodec. Registry IDs always come from this server's export.
function count(value) {
  if (!Number.isInteger(value) || value < 0 || value > 4096) throw Error('INVALID_TWILIGHT_COMPONENT_COUNT')
  return value
}
function readCount(buffer, offset) {
  let value = 0
  for (let i = 0; i < 5; i++) {
    if (offset + i >= buffer.length) throw Error('TRUNCATED_TWILIGHT_COMPONENT_COUNT')
    const byte = buffer[offset + i]
    value += (byte & 127) * 2 ** (7 * i)
    if (!(byte & 128)) return { value: count(value), size: i + 1 }
  }
  throw Error('INVALID_TWILIGHT_COMPONENT_COUNT')
}
function encodeCount(value, buffer, offset) {
  value = count(value)
  const start = offset
  do {
    const byte = value & 127
    value >>>= 7
    if (buffer) buffer[offset] = byte | (value ? 128 : 0)
    offset++
  } while (value)
  return offset - start
}
const twilightNativeTypes = {
  Read: { mawTwilightCount: ['native', readCount] },
  Write: { mawTwilightCount: ['native', (value, buffer, offset) => offset + encodeCount(value, buffer, offset)] },
  SizeOf: { mawTwilightCount: ['native', value => encodeCount(value, null, 0)] }
}
const list = type => ['array', { countType: 'MawTwilightCount', type }]
const tuple = fields => ['container', fields.map(([name, type]) => ({ name, type }))]
function twilightComponentCodecs(vanillaFields) {
  const rows = {}
  const set = (names, type) => { for (const name of names.split(' ')) rows['twilightforest:' + name] = type }
  set('emperors_cloth infinite_glass_sword translatable_book travellers_armor has_travellers_chestplate has_travellers_gloves has_travellers_belt has_travellers_wings has_travellers_boots red_thread_vision stealth_crouching arrow_magnetism swap_hotbar_ability swap_hotbar_modifier double_jump water_walk all_night_goggles unrestrained swift_swim high_step aquatic_agility', 'void')
  set('auto_repair_probability zoom_ability_modifier efficient_eater perfect_dodge_probability gradually_gliding_multiplier agile_ranger_modifier slimy_soles_coefficient', 'f32')
  set('casket_damage haste_amplifier high_jump_amplifier', 'i32')
  set('ore_loading ore_range ore_filter magic_painting_variant', 'varint')
  set('e115_variant', 'string')
  set('thrown_projectile', 'UUID')
  set('straight_ahead_multiplier', 'f64')
  // VAR_LONG must keep all 64 bits; the pinned protocol's varlong is 32-bit.
  set('sidestep_cooldown', 'MawFarmerVarLong')
  set('candelabra_data jar_lid ore_scanner', 'anonymousNbt')
  set('stored_broken_attributes', vanillaFields.attribute_modifiers)
  set('flask_contents', tuple([
    ['potion', vanillaFields.potion_contents], ['doses', 'i32'], ['breakage', 'i32'], ['breakable', 'bool']
  ]))
  set('skull_candles', tuple([['color', 'varint'], ['count', 'i32']]))
  set('ore_data', tuple([
    ['counts', list(tuple([['name', 'string'], ['count', 'i32']]))],
    ['scannedChunk', 'MawFarmerVarLong'], ['scannedBlockCount', 'i32'], ['universalId', 'MawFarmerVarLong']
  ]))
  set('item_display', tuple([['items', list('Slot')], ['chosenMapSlot', 'varint']]))
  return rows
}
// TFDataSerializers uses holderRegistry -> registry -> VarInt for all three
// variants; string_list is ByteBufCodecs.STRING_UTF8.apply(list()). A holder
// registry is reference-only, unlike the separate inline-holder codec.
const twilightEntityCodecs = {
  'twilightforest:tiny_bird_variant': 'varint',
  'twilightforest:dwarf_rabbit_variant': 'varint',
  'twilightforest:magic_painting_variant': 'varint',
  'twilightforest:string_list': list('string')
}
module.exports = { twilightComponentCodecs, twilightEntityCodecs, twilightNativeTypes }
