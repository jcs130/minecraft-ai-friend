'use strict'
const { lines } = require('./bounded-jsonl.cjs')

const stateKey = (name, properties) => JSON.stringify([name,
  Object.entries(properties).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, String(value)])])

function matchVanillaStates (nativeRows, vanillaRows, { reportExtendedStates = false } = {}) {
  const byState = new Map(vanillaRows.map(row => [stateKey(row.name, row.properties), row.stateId]))
  const names = new Set(vanillaRows.map(row => row.name))
  const states = {}; const reverseVanillaStates = {}; const additionalNames = new Set()
  const unrepresentableStates = []
  for (const row of nativeRows) {
    if (!row.name.startsWith('minecraft:')) continue
    if (!names.has(row.name)) { additionalNames.add(row.name); continue }
    const id = byState.get(stateKey(row.name, row.properties))
    if (id === undefined) {
      if (!reportExtendedStates) throw Error('VANILLA_STATE_NOT_REPRESENTABLE ' + row.name + ' state=' + row.stateId)
      unrepresentableStates.push({ stateId: row.stateId, name: row.name, properties: row.properties,
        reason: 'mod_extended_vanilla_properties', exactVanillaState: null })
      continue
    }
    if (Object.hasOwn(states, row.stateId) || Object.hasOwn(reverseVanillaStates, id)) throw Error('DUPLICATE_NATIVE_VANILLA_STATE')
    states[row.stateId] = id; reverseVanillaStates[id] = row.stateId
  }
  return { states, reverseVanillaStates, additionalNames: [...additionalNames].sort(),
    ...(reportExtendedStates ? { unrepresentableStates } : {}) }
}

function * nativeVanillaRows (file) {
  for (const line of lines(file)) {
    if (!line.trim()) continue
    // The native exporter writes the block name before nested fluid names.
    const firstName = /"name"\s*:\s*"([^"]+)"/.exec(line)?.[1]
    if (firstName?.startsWith('minecraft:')) yield JSON.parse(line)
  }
}

function exactStateMap (file, blocks, Block, options) {
  const vanilla = []
  for (const block of blocks) for (let id = block.minStateId; id <= block.maxStateId; id++) {
    vanilla.push({ stateId: id, name: 'minecraft:' + block.name.replace(/^minecraft:/, ''), properties: Block.fromStateId(id).getProperties() })
  }
  return matchVanillaStates(nativeVanillaRows(file), vanilla, options)
}
module.exports = { stateKey, matchVanillaStates, exactStateMap }
