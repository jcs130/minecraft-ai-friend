'use strict'
// Easy NPC 7.1.1 / Minecraft 1.21.1 original StreamCodec definitions.
// Compound data uses RegistryFriendlyByteBuf.readNbt; rotations are FFFZ,
// positions/scales FFF, enums VarInt, and root model = rotation + scale.
const row = (name, type) => ({ name, type })
const container = fields => ['container', fields]
const vector = container([row('x', 'f32'), row('y', 'f32'), row('z', 'f32')])
const rotation = container([...vector[1], row('locked', 'bool')])
const count = 'MawEasyNpcCount'
const array = type => ['array', { countType: count, type }]
const metadataCodecs = {}
for (const name of ['action_event_set', 'dialog_data_set', 'entity_attributes', 'objective_data_set',
  'render_data_entry', 'skin_data_entry', 'sound_data_set', 'trading_data_set',
  'model_part_visibility', 'model_part_rotation', 'model_part_position', 'model_part_scale'])
  metadataCodecs['easy_npc:' + name] = 'anonymousNbt'
for (const name of ['model_pose', 'profession', 'skin_type', 'trading_type', 'model_animation_data'])
  metadataCodecs['easy_npc:' + name] = 'varint'
Object.assign(metadataCodecs, {
  'easy_npc:position': 'MawEasyNpcVector', 'easy_npc:scale': 'MawEasyNpcVector',
  'easy_npc:root_model_data': 'MawEasyNpcRootModel', 'easy_npc:rotation': 'MawEasyNpcRotation',
  'easy_npc:skin_uuid': 'UUID', 'easy_npc:uuid': 'UUID',
  'easy_npc:targeted_entity_hash_set': 'MawEasyNpcEntitySet',
  'easy_npc:targeted_player_hash_set': 'MawEasyNpcPlayerSet',
  'easy_npc:display_attribute': 'MawEasyNpcDisplay',
  'easy_npc:progression': 'MawEasyNpcProgression',
  'easy_npc:merchant_offers': 'MawEasyNpcOffers'
})
function install (protocol) {
  const offers = structuredClone(protocol.play.toClient.types.packet_trade_list[1].find(r => r.name === 'trades').type)
  offers[1].countType = count
  Object.assign(protocol.types, {
    MawEasyNpcCount: ['mawEasyNpcCount', {}], MawEasyNpcVector: vector, MawEasyNpcRotation: rotation,
    MawEasyNpcRootModel: container([row('rotation', 'MawEasyNpcRotation'), row('scale', 'MawEasyNpcVector')]),
    MawEasyNpcEntitySet: array('UUID'), MawEasyNpcPlayerSet: array('string'),
    MawEasyNpcProgression: container([row('experience', 'i32'), row('experienceLevel', 'i32'), row('attributeScalingEnabled', 'bool')]),
    MawEasyNpcDisplay: array(container([row('attribute', 'varint'), row('boolValue', 'bool'), row('intValue', 'varint'), row('stringValue', 'string')])),
    MawEasyNpcOffers: offers
  })
}
const nativeTypes = {
  Read: { mawEasyNpcCount: ['parametrizable', compiler => compiler.wrapCode(`
const result = ctx.varint(buffer, offset)
if (result.value < 0 || result.value > 256) throw Error('EASY_NPC_COLLECTION_BUDGET')
return result`)] },
  Write: { mawEasyNpcCount: ['parametrizable', compiler => compiler.wrapCode(`
if (!Number.isInteger(value) || value < 0 || value > 256) throw Error('EASY_NPC_COLLECTION_BUDGET')
return ctx.varint(value, buffer, offset)`)] },
  SizeOf: { mawEasyNpcCount: ['parametrizable', compiler => compiler.wrapCode(`
if (!Number.isInteger(value) || value < 0 || value > 256) throw Error('EASY_NPC_COLLECTION_BUDGET')
return ctx.varint(value)`)] }
}
module.exports = { install, nativeTypes, metadataCodecs }
