'use strict'
const fs = require('node:fs')

const stateKey = (name, properties) => JSON.stringify([name,
  Object.entries(properties).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, String(value)])])

function matchVanillaStates (nativeRows, vanillaRows) {
  const byState = new Map(vanillaRows.map(row => [stateKey(row.name, row.properties), row.stateId]))
  const names = new Set(vanillaRows.map(row => row.name))
  const states = {}; const reverseVanillaStates = {}; const additionalNames = new Set()
  for (const row of nativeRows) {
    if (!row.name.startsWith('minecraft:')) continue
    // Backport mods may register newer blocks in minecraft:, e.g. pale oak on
    // 1.21.1. They retain the explicitly approximate display mapping; namespace
    // alone does not make them representable as a vanilla block of this version.
    if (!names.has(row.name)) { additionalNames.add(row.name); continue }
    const id = byState.get(stateKey(row.name, row.properties))
    if (id === undefined) throw Error('VANILLA_STATE_NOT_REPRESENTABLE ' + row.name + ' state=' + row.stateId)
    if (Object.hasOwn(states, row.stateId) || Object.hasOwn(reverseVanillaStates, id)) throw Error('DUPLICATE_NATIVE_VANILLA_STATE')
    states[row.stateId] = id; reverseVanillaStates[id] = row.stateId
  }
  return { states, reverseVanillaStates, additionalNames: [...additionalNames].sort() }
}

function exactStateMap (file, blocks, Block) {
  const vanilla = []
  for (const block of blocks) for (let id = block.minStateId; id <= block.maxStateId; id++) {
    vanilla.push({ stateId: id, name: 'minecraft:' + block.name.replace(/^minecraft:/, ''), properties: Block.fromStateId(id).getProperties() })
  }
  const native = []
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    // NativeRegistryDump emits the block's name before nested fluid names.
    const firstName = /"name"\s*:\s*"([^"]+)"/.exec(line)?.[1]
    if (firstName?.startsWith('minecraft:')) native.push(JSON.parse(line))
  }
  return matchVanillaStates(native, vanilla)
}
module.exports = { stateKey, matchVanillaStates, exactStateMap }
