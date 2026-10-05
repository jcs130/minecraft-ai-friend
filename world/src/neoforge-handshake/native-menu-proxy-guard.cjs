'use strict'

const { TextDecoder } = require('node:util')
const { decodeAdvancedOpenScreen } = require('./advanced-open-screen.cjs')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MENU_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
const WINDOW_DATA = new Set(['window_items', 'set_slot', 'craft_progress_bar', 'window_data', 'container_data'])
const decoder = new TextDecoder('utf-8', { fatal: true })
const positiveId = value => Number.isInteger(value) && value > 0 && value <= 2147483647

// This ONLY guards Mineflayer's vanilla window parser. Caller must mirror the
// unmodified native packet before asking this guard whether to forward a proxy.
// The SDK and native renderer still consume the original PlayerMenuBridge JSON.
function createNativeMenuProxyGuard ({ windows, getPlayerUuid = () => null }) {
  const parserTypes = new Map()
  for (const [key, layout] of Object.entries(windows || {})) {
    if (key.startsWith('minecraft:') && Number.isInteger(layout?.type) && layout.type >= 0) {
      parserTypes.set(layout.type, key)
    }
  }
  if (parserTypes.size === 0) throw Error('VANILLA_MENU_PARSER_TABLE_UNAVAILABLE')
  const nativeTypes = new Map()
  let active = null
  let proxyWindowId = null

  function learnState (params) {
    if (params.channel !== 'maw_agent:menu_state') return
    try {
      const bytes = Buffer.from(params.data)
      if (bytes.length > 65536) return
      let state = JSON.parse(decoder.decode(bytes))
      const expected = getPlayerUuid()
      if (!UUID.test(expected || '') || !UUID.test(state?.playerUuid || '') ||
          state.playerUuid.toLowerCase() !== expected.toLowerCase()) return
      if (state.kind === 'action_receipt') {
        state = state.state
        if (!UUID.test(state?.playerUuid || '') || state.playerUuid.toLowerCase() !== expected.toLowerCase()) return
      }
      if (state.schemaVersion !== 1 || state.kind !== 'menu_state' || !MENU_ID.test(state.menuType || '') ||
          !Number.isInteger(state.menuTypeId) || state.menuTypeId < -1) return
      if (state.self?.playerUuid && state.self.playerUuid.toLowerCase() !== expected.toLowerCase()) return
      if (state.menuTypeId >= 0) {
        // Actual server MENU registry identity, not a guessed numerical range.
        if (nativeTypes.size >= 256 && !nativeTypes.has(state.menuTypeId)) nativeTypes.delete(nativeTypes.keys().next().value)
        nativeTypes.set(state.menuTypeId, state.menuType)
      }
      if (state.windowId === 0) { active = null; return }
      if (active?.windowId === state.windowId) {
        active.nativeMenuType = state.menuType
        active.nativeMenuTypeId = state.menuTypeId
        active.nativeIdentitySource = 'server_menu_state_registry'
        // If a mod ever occupies a parser-recognized number, do not continue
        // treating its unverified layout as a vanilla menu. No fake replacement.
        if (!state.menuType.startsWith('minecraft:') && active.mode !== 'verified_cooking_pot_adapter') {
          active.mode = 'native_only'
          proxyWindowId = null
        }
      }
    } catch (_error) { /* Invalid state cannot change proxy lifetime; forward raw JSON. */ }
  }

  function open (windowId, menuTypeId, mode) {
    active = { windowId, nativeMenuTypeId: menuTypeId, mode,
      nativeMenuType: nativeTypes.get(menuTypeId) || null,
      nativeIdentitySource: nativeTypes.has(menuTypeId) ? 'server_menu_state_registry' : null }
    // A new native-only screen also retires any previously usable proxy menu.
    // It does not create a replacement, synthetic close or a fake inventory.
    proxyWindowId = mode === 'native_only' ? null : windowId
  }

  function filter (name, params, { cookingPotMenu = null } = {}) {
    if (name === 'login' || name === 'respawn') { active = null; proxyWindowId = null; return { forward: true } }
    if (name === 'custom_payload') {
      learnState(params)
      if (params.channel === 'neoforge:advanced_open_screen') {
        try {
          const screen = decodeAdvancedOpenScreen(params.data)
          if (!positiveId(screen.windowId)) throw Error('INVALID_NATIVE_WINDOW_ID')
          const verifiedPot = cookingPotMenu?.windowId === screen.windowId &&
            parserTypes.get(cookingPotMenu.inventoryType) === 'minecraft:generic_9x1' &&
            screen.title?.value?.translate?.value === 'container.farmersdelight.cooking_pot'
          open(screen.windowId, screen.menuTypeId, verifiedPot ? 'verified_cooking_pot_adapter' : 'native_only')
        } catch (_error) {
          active = { windowId: null, mode: 'native_only', nativeMenuType: null, nativeMenuTypeId: null }
          proxyWindowId = null
        }
        // Preserve original mod payload. Only corresponding vanilla parser
        // events are hidden; the previously verified FD adapter remains narrow.
      }
      return { forward: true }
    }
    if (name === 'open_window') {
      if (!positiveId(params.windowId)) return { forward: false, reason: 'invalid_proxy_window_id' }
      const nativeType = nativeTypes.get(params.inventoryType)
      const supported = parserTypes.has(params.inventoryType) && (!nativeType || nativeType.startsWith('minecraft:'))
      open(params.windowId, params.inventoryType, supported ? 'installed_vanilla_parser' : 'native_only')
      return { forward: supported, reason: supported ? null : 'native_menu_parser_unavailable',
        parserSource: 'installed_prismarine_windows', nativeMenuType: active.nativeMenuType,
        nativeMenuTypeId: active.nativeMenuTypeId }
    }
    if (name === 'open_horse_window') {
      // Keep the existing horse packet path unchanged. This is not a claim of
      // mod menu support or a fabricated chest layout.
      if (positiveId(params.windowId)) open(params.windowId, null, 'existing_horse_packet')
      return { forward: true }
    }
    if (WINDOW_DATA.has(name)) {
      const id = params.windowId
      if (id === 0 || id === -2) return { forward: true }
      if (id === -1) return { forward: active?.mode !== 'native_only', reason: 'native_only_cursor_proxy' }
      if (!positiveId(id)) return { forward: true }
      const supported = active?.windowId === id && active.mode !== 'native_only' && proxyWindowId === id
      return { forward: Boolean(supported), reason: supported ? null : 'native_or_inactive_window_proxy' }
    }
    if (name === 'close_window') {
      if (params.windowId === 0) return { forward: true }
      const supported = params.windowId === proxyWindowId && positiveId(params.windowId)
      if (active?.windowId === params.windowId) active = null
      if (supported) proxyWindowId = null
      // Mineflayer closes currentWindow without checking this ID. An unknown
      // or late old close MUST NOT erase the next legitimate vanilla window.
      return { forward: Boolean(supported), reason: supported ? null : 'native_or_inactive_window_close_proxy' }
    }
    return { forward: true }
  }

  return { filter, diagnostics: () => ({ active: active ? { ...active } : null, proxyWindowId,
    parserSource: 'installed_prismarine_windows', parserTypeCount: parserTypes.size }),
    reset: () => { active = null; proxyWindowId = null; nativeTypes.clear() } }
}

module.exports = { createNativeMenuProxyGuard }
