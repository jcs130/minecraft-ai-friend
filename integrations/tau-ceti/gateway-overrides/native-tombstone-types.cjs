'use strict'
// Corail Tombstone 9.5.1 ModDataComponents, checked against the installed JAR.
// SHORT/INT are fixed signed big-endian; a model color is not a VarInt.
// Components with only persistent() use the component builder's NBT fallback,
// including those whose Java field name contains NO_SYNC.
const componentCodecs = {}
for (const name of ['enchanted', 'ancient', 'target_found', 'enchanted_arrow', 'cursed_arrow', 'soulbound']) componentCodecs['tombstone:tb_' + name] = 'bool'
for (const name of ['use_count', 'stored_xp', 'model_texture', 'color', 'content_part', 'corruption_level']) componentCodecs['tombstone:tb_' + name] = 'i32'
for (const name of ['model_color', 'lost_tablet_type', 'effect_amplifier']) componentCodecs['tombstone:tb_' + name] = 'i16'
for (const name of ['engraved_name', 'entity_type', 'capturable_entity_type', 'lost_tablet_id', 'effect_id', 'content_id']) componentCodecs['tombstone:tb_' + name] = 'string'
for (const name of ['health', 'health_max']) componentCodecs['tombstone:tb_' + name] = 'f32'
for (const name of ['is_loot', 'cooldown_time_no_sync', 'lost_tablet_roll', 'unique_identifier', 'additional_data']) componentCodecs['tombstone:tb_' + name] = 'anonymousNbt'
componentCodecs['tombstone:tb_cooldown_time'] = 'MawFarmerVarLong'
componentCodecs['tombstone:tb_location'] = ['container', [
  { name: 'dimension', type: 'string' }, { name: 'position', type: 'position' }
]]
module.exports = { componentCodecs }
