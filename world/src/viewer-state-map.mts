import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const safeId = value => Number.isInteger(value) && value >= 0 && value <= 1_000_000
const FALLBACKS = [['trapdoor','oak_trapdoor'],['fence_gate','oak_fence_gate'],['door','oak_door'],['stair','oak_stairs'],['slab','oak_slab'],['fence','oak_fence'],['wall','cobblestone_wall'],['lamp','glowstone'],['lantern','glowstone'],['torch','glowstone'],['glass','glass'],['window','glass_pane'],['shelf','bookshelf'],['log','oak_log'],['plank','oak_planks']]

export function createViewerBlockMapping(mapping, registry, registrySha256, canonical, canonicalBlocksSha256) {
  if (mapping?.schema !== 1 || mapping.minecraft !== '1.21.1' || mapping.registrySha256 !== registrySha256
      || mapping.canonicalBlocksSha256 !== canonicalBlocksSha256 || !Array.isArray(mapping.mappings)
      || !Array.isArray(mapping.serverModRanges) || !Array.isArray(registry?.blocks) || registry.minecraftVersion !== '1.21.1') throw Error('viewer_state_map_mismatch')
  const vanilla = new Map(), mods = new Map(), fallback = new Map()
  for (const pair of mapping.mappings) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(safeId) || vanilla.has(pair[0]) || !canonical.blocksByStateId[pair[1]]) throw Error('viewer_state_map_invalid')
    vanilla.set(pair[0], pair[1])
  }
  let expectedVanilla = 0, expectedMods = 0
  const ranges = new Map(mapping.serverModRanges.map(row => [row.name, row]))
  if (ranges.size !== mapping.serverModRanges.length) throw Error('viewer_state_map_duplicate_range')
  for (const block of registry.blocks) {
    if (!safeId(block.minStateId) || !safeId(block.maxStateId) || block.maxStateId < block.minStateId) throw Error('viewer_registry_invalid')
    if (block.name.startsWith('minecraft:')) {
      for (let state = block.minStateId; state <= block.maxStateId; state++) {
        const target = vanilla.get(state)
        if (target === undefined || canonical.blocksByStateId[target]?.name !== block.name.slice(10)) throw Error('viewer_state_map_incomplete')
        expectedVanilla++
      }
    } else {
      const range = ranges.get(block.name)
      if (!range || range.minStateId !== block.minStateId || range.maxStateId !== block.maxStateId || range.defaultState !== block.defaultState) throw Error('viewer_mod_range_mismatch')
      expectedMods++
      const targetName = FALLBACKS.find(([part]) => block.name.includes(part))?.[1] ?? 'stone'
      const target = canonical.blocksByName[targetName]?.defaultState ?? canonical.blocksByName.stone.defaultState
      for (let state = block.minStateId; state <= block.maxStateId; state++) {
        if (vanilla.has(state) || mods.has(state)) throw Error('viewer_state_ranges_overlap')
        mods.set(state, block.name); fallback.set(state, target)
      }
    }
  }
  if (expectedVanilla !== vanilla.size || expectedMods !== ranges.size) throw Error('viewer_state_map_extra_entries')
  function normalize(stateId, mode = 'modern') {
    if (!safeId(stateId)) throw Error('viewer_state_id_invalid')
    if (vanilla.has(stateId)) return vanilla.get(stateId)
    if (!mods.has(stateId)) throw Error('viewer_state_id_unregistered')
    return mode === 'compat' ? fallback.get(stateId) : stateId
  }
  return { ready: true, normalize, health: { ready: true, registrySha256, canonicalBlocksSha256, vanillaStates: vanilla.size, modStates: mods.size, modBlocks: expectedMods } }
}

export function loadViewerBlockMapping(mapPath, registryPath, canonical) {
  try {
    const registryBytes = readFileSync(registryPath), mapBytes = readFileSync(mapPath)
    if (registryBytes.length > 64 * 1024 * 1024 || mapBytes.length > 2 * 1024 * 1024) throw Error('viewer_state_map_size')
    const canonicalBytes = readFileSync(require.resolve('minecraft-data/minecraft-data/data/pc/1.21.1/blocks.json'))
    const result = createViewerBlockMapping(JSON.parse(mapBytes.toString('utf8')), JSON.parse(registryBytes.toString('utf8')), hash(registryBytes), canonical, hash(canonicalBytes))
    result.health.mappingSha256 = hash(mapBytes)
    return result
  } catch { return { ready: false, health: { ready: false, error: 'viewer_state_map_unavailable_or_mismatched' }, normalize() { throw Error('viewer_state_map_unavailable') } } }
}

/**
 * 门（gate.cjs + idmap.json）已在出站把 NeoForge blockstate 号翻译成原版号 ✓
 * 此时本模块那套「服务端号→原版号」的本地补偿必须整体停用：
 * 实测 vanilla-state-map.json 的键集与值集重叠 26684（26834 条映射）——
 * 门输出的原版号会被这张表当作「服务端号」再查一次，等于二次翻译，世界彻底错乱 ✗
 * 且 normalize() 对不在键域的号直接 throw（表现为 viewerUnavailable）。
 * 所以走门的客户端用这个恒等映射（health.mode = 'gate-translated' 供面板/健康检查辨识）。
 */
export function identityViewerBlockMapping() {
  const normalize = stateId => {
    if (!safeId(stateId)) throw Error('viewer_state_id_invalid')
    return stateId
  }
  return { ready: true, normalize, health: { ready: true, mode: 'gate-translated', vanillaStates: 0, modStates: 0, modBlocks: 0 } }
}
