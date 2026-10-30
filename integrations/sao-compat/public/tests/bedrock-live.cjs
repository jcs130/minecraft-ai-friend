'use strict'
// Explicit loopback-only integration fixture. Xbox validation must stay enabled
// on any public listener; this client does not prove a physical phone's render.
const fs = require('node:fs'), assert = require('node:assert/strict')
const { createRequire } = require('node:module'), { setTimeout: sleep } = require('node:timers/promises')
const be = createRequire(process.env.BEDROCK_PROTOCOL_PACKAGE)('bedrock-protocol')
const out = { schemaVersion: 1, observedAt: new Date().toISOString(), fixture: 'loopback_self_signed_bedrock', physicalDeviceVerified: false, checks: {}, texts: [], errors: [], chunks: 0, inventoryPackets: 0, customDefinitions: 0 }
const port = Number(process.env.BEDROCK_TEST_PORT || 38988)
assert.equal(port, 38988, 'offline fixture is restricted to the private candidate')
assert(['login', 'register'].includes(process.env.SAO_AUTH_ACTION))
let client, spawned = false
async function until (fn, name, ms = 45000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return; if (out.disconnect) throw Error('disconnected:' + JSON.stringify(out.disconnect)); await sleep(100) } throw Error('timeout:' + name) }
const redact = value => String(value).split(process.env.SAO_GAME_PASSWORD).join('<redacted>')
;(async () => {
  try {
    client = be.createClient({ host: '127.0.0.1', port, version: '1.26.51', offline: true, username: 'SAOBedProbe', raknetBackend: 'raknet-native', useRaknetWorkers: false, connectTimeout: 15000, viewDistance: 4 })
    client.on('session', packet => { packet.xuid = '90000000301030' })
    client.on('error', error => out.errors.push(redact(error.message)))
    client.on('disconnect', packet => { out.disconnect = packet })
    client.on('spawn', () => { spawned = true })
    client.on('level_chunk', () => out.chunks++)
    client.on('text', packet => { if (out.texts.length < 50) out.texts.push(redact(packet.message)) })
    client.on('resource_packs_info', packet => { out.offeredPacks = packet.texture_packs?.map(p => ({ uuid: p.uuid, version: p.version, size: String(p.size) })); out.mustAccept = packet.must_accept })
    client.on('item_registry', packet => { out.customDefinitions = packet.itemstates?.filter(x => /maw_native/.test(x.name)).length || 0; out.itemRegistryCount = packet.itemstates?.length; out.itemRegistryKeys = Object.keys(packet) })
    client.on('inventory_content', packet => { out.inventoryPackets++; out.lastInventory = { windowId: packet.window_id, count: packet.input?.filter(x => x.network_id !== 0).length, networkIds: packet.input?.filter(x => x.network_id !== 0).slice(0, 20).map(x => x.network_id) } })
    await until(() => spawned && out.chunks > 0, 'spawn and world chunks')
    out.checks.realBedrockUdpSpawn = true
    await until(() => out.texts.some(s => /register|login|注册|登录/.test(s)), 'private auth prompt')
    out.checks.authPromptPrivate = true
    assert(out.checks.authPromptPrivate, 'authentication prompt before game use')
    // DirectAuth intentionally delays first registration. This is a single
    // explicit attempt after its configured gate, never a blind retry loop.
    if (process.env.SAO_AUTH_ACTION === 'register') await sleep(6000)
    client.queue('command_request', { command: '/' + process.env.SAO_AUTH_ACTION + ' ' + process.env.SAO_GAME_PASSWORD, origin: { type: 'player', uuid: client.profile.uuid, request_id: '', player_entity_id: 0n }, internal: false, version: '66' })
    await until(() => out.texts.some(s => /登录成功|注册成功|successfully|success/i.test(s)), 'native authenticated result')
    out.checks.nativeAuthentication = true
    out.checks.resourcePackOffered = out.mustAccept === true && out.offeredPacks?.length >= 2
    await sleep(6000)
    out.checks.realInventory = out.inventoryPackets > 0
    out.checks.staysConnected = !out.disconnect && out.errors.length === 0
    assert(Object.values(out.checks).every(Boolean), 'all Bedrock checks')
    out.passed = true
  } catch (error) { out.failure = redact(error.stack); process.exitCode = 1 }
  finally { client?.close(); await sleep(400); fs.writeFileSync(process.env.BEDROCK_EVIDENCE, JSON.stringify(out, (_k, v) => typeof v === 'bigint' ? String(v) : v, 2), { flag: 'wx' }); console.log(JSON.stringify({ passed: out.passed || false, checks: out.checks, failure: out.failure, disconnect: out.disconnect, chunks: out.chunks })); process.exit(process.exitCode || 0) }
})()
