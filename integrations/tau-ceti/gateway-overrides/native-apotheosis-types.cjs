'use strict'
// Apotheosis 8.5.4 + Placebo DynamicRegistry original codecs: holders are
// ResourceLocation strings, ItemAffixes is a map(holder, FLOAT), purity VarInt.
const componentCodecs = {
  'apotheosis:affixes': 'MawApothAffixes', 'apotheosis:rarity': 'string',
  'apotheosis:affix_name': 'anonymousNbt', 'apotheosis:sockets': 'varint',
  'apotheosis:socketed_gems': 'MawApothGems', 'apotheosis:gem': 'string',
  'apotheosis:purity': 'varint', 'apotheosis:durability_bonus': 'f32',
  'apotheosis:stoneforming_target': 'varint', 'apotheosis:malice_marker': 'bool',
  'apotheosis:touched_by_malice': 'bool'
}
// With persistent(Codec.BOOL) and no explicit network override, the component
// builder derives an NBT stream codec, unlike the two explicit BOOL codecs.
for (const name of ['from_chest', 'from_trader', 'from_boss', 'from_mob', 'charm_enabled']) componentCodecs['apotheosis:' + name] = 'anonymousNbt'
function install (protocol, fields) {
  protocol.types.MawApothCount = ['mawApothCount', {}]
  protocol.types.MawApothAffixes = ['array', { countType: 'MawApothCount', type: ['container', [
    { name: 'affix', type: 'string' }, { name: 'level', type: 'f32' }
  ]] }]
  protocol.types.MawApothGems = structuredClone(fields.container)
}
const nativeTypes = {
  Read: { mawApothCount: ['parametrizable', compiler => compiler.wrapCode(`
const result = ctx.varint(buffer, offset)
if (result.value < 0 || result.value > 256) throw Error('APOTHEOSIS_AFFIX_BUDGET')
return result`)] },
  Write: { mawApothCount: ['parametrizable', compiler => compiler.wrapCode(`
if (!Number.isInteger(value) || value < 0 || value > 256) throw Error('APOTHEOSIS_AFFIX_BUDGET')
return ctx.varint(value, buffer, offset)`)] },
  SizeOf: { mawApothCount: ['parametrizable', compiler => compiler.wrapCode(`
if (!Number.isInteger(value) || value < 0 || value > 256) throw Error('APOTHEOSIS_AFFIX_BUDGET')
return ctx.varint(value)`)] }
}
module.exports = { componentCodecs, install, nativeTypes }
