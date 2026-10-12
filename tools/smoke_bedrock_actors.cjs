'use strict'
// Finite offline UDP acceptance, ONLY the dedicated loopback QA bridge/server.
// Does not change LAN Xbox validation, live accounts, models or Agent actions.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const assert = require('node:assert/strict')
const bedrock = require(process.env.MAW_BEDROCK_CLIENT_MODULE || 'bedrock-protocol')
const mineflayer = require('mineflayer')
const directory = path.resolve(process.argv[2]), login = JSON.parse(fs.readFileSync(path.join(directory, 'login.json')))
assert.equal(login.username, 'MawMotionQA'); assert.ok(fs.existsSync(path.join(directory, 'ready.json')))
const report = { schemaVersion: 1, checks: {}, packs: [], models: [], helpers: [], metadata: [], animations: [], skins: [], removals: [], moves: [], actualPhoneTested: false, pixelParityVerified: false, paidModelCalls: 0, productionActions: 0 }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const command = text => fs.appendFileSync(path.join(directory, 'console.jsonl'), JSON.stringify({ command: text }) + '\n')
const digest = raw => crypto.createHash('sha256').update(raw).digest('hex')
const metaName = p => (p.metadata || []).find(e => e.key === 4 || e.key === 'name' || e.key === 'nametag')?.value
const resourceUuid = value => { const b = Buffer.from(value.replaceAll('-', ''), 'hex'); b.subarray(0, 8).reverse(); b.subarray(8, 16).reverse(); const s = b.toString('hex'); return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}` }
let client, peer, send, spawned = false, caught, readyAuth = false
const packData = new Map(), completed = new Set(), packs = [], playerIdentities = new Map()
async function wait (predicate, ms = 20000) { const end = Date.now() + ms; while (Date.now() < end && !caught && !predicate()) await delay(100); if (caught) throw Error(caught); assert.ok(predicate(), 'wait_expired') }
const say = message => send('text', { type: 'chat', category: 'authored', needs_translation: false, source_name: login.username, message, xuid: '', platform_chat_id: '', has_filtered_message: false })
async function main () {
  client = bedrock.createClient({ host: '127.0.0.1', port: 28993, version: '1.26.51', username: login.username, offline: true, followPort: false, skipPing: true, raknetBackend: 'raknet-native', conLog: () => {} })
  send = client.write.bind(client); client.write = (n, p) => n === 'resource_pack_client_response' ? undefined : send(n, p)
  const response = status => send('resource_pack_client_response', { response_status: status, response_status_name: status === 'send_packs' ? 'askingserverforpacks' : status === 'have_all_packs' ? 'finishedloadingpacks' : 'resourcepackstackfinished', resourcepackids: status === 'send_packs' ? packs.map(p => p.uuid + '_' + p.version) : [] })
  client.on('error', e => { caught = e.message }); client.on('kick', () => { caught = 'bedrock_kicked' })
  client.on('resource_packs_info', p => { packs.push(...p.texture_packs.map(r => ({ ...r, uuid: resourceUuid(r.uuid) }))); report.checks.pack_download_required = p.must_accept; response('send_packs') })
  client.on('resource_pack_data_info', p => { packData.set(p.pack_id, { ...p, chunks: new Map() }); for (let i = 0; i < p.chunk_count; i++) send('resource_pack_chunk_request', { pack_id: p.pack_id, chunk_index: i }) })
  client.on('resource_pack_chunk_data', p => { try {
    const item = packData.get(p.pack_id); item.chunks.set(p.chunk_index, Buffer.from(p.payload))
    if (item.chunks.size !== item.chunk_count || completed.has(p.pack_id)) return
    const raw = Buffer.concat(Array.from({ length: item.chunk_count }, (_, i) => item.chunks.get(i))); assert.equal(BigInt(raw.length), BigInt(item.size)); assert.equal(digest(raw), Buffer.from(item.hash).toString('hex'))
    completed.add(p.pack_id); report.packs.push({ id: p.pack_id, sha256: digest(raw), bytes: raw.length }); if (completed.size === packs.length) response('have_all_packs')
  } catch (e) { caught = e.message } })
  client.on('resource_pack_stack', () => response('completed')); client.on('spawn', () => { spawned = true })
  client.on('text', p => { if (!readyAuth && /login|登录|注册/.test(p.message || '')) { readyAuth = true; say('/login ' + login.password) } })
  client.on('add_entity', p => {
    const row = { at: Date.now(), runtimeId: String(p.runtime_id), identifier: p.entity_type, name: metaName(p), position: p.position, metadata: p.metadata }
    if (p.entity_type?.startsWith('maw_native:')) report.models.push(row)
    if (BigInt(p.runtime_id) >= (1n << 51n)) report.helpers.push(row)
  })
  client.on('set_entity_data', p => { if (report.metadata.length < 600) report.metadata.push({ at: Date.now(), runtimeId: String(p.runtime_entity_id), metadata: p.metadata }) })
  client.on('animate_entity', p => { if (report.animations.length < 100) report.animations.push(p) })
  const skin = (uuid, s) => { if (s) report.skins.push({ uuid: resourceUuid(uuid), geometry: typeof s.geometry_data === 'string' ? digest(Buffer.from(s.geometry_data)) : null, id: s.skin_id, textureBytes: s.skin_data?.data?.length || s.skin_data?.length || 0 }) }
  client.on('player_skin', p => skin(p.uuid, p.skin))
  client.on('player_list', p => { for (const r of (p.records?.records || p.records || [])) if (r.uuid && r.skin_data) {
    skin(r.uuid, r.skin_data)
    if (r.username) playerIdentities.set(r.username, resourceUuid(r.uuid))
  } })
  client.on('remove_entity', p => report.removals.push({ at: Date.now(), id: String(p.entity_id_self || p.entity_id || p.unique_entity_id) }))
  client.on('move_entity', p => { if (report.moves.length < 500) report.moves.push({ at: Date.now(), id: String(p.runtime_entity_id), position: p.position, rotation: p.rotation }) })
  await wait(() => spawned && completed.size === packs.length, 65000)
  peer = mineflayer.createBot({ host: '127.0.0.1', port: 28979, username: 'MawMotionPeer', version: '1.21.1', auth: 'offline' })
  peer.on('error', e => { caught = e.message }); await new Promise((resolve, reject) => { peer.once('spawn', resolve); peer.once('kicked', () => reject(Error('peer_kicked'))) })
  await delay(1500)
  // Mixed authentication may restore a registered UUID. Use the native
  // server's PlayerList identity rather than inventing an offline UUID.
  await wait(() => peer.players[login.username]?.uuid)
  const selfUuid = peer.players[login.username].uuid
  const hash = Buffer.from(selfUuid.replaceAll('-', ''), 'hex')
  const owner = '[I;' + Array.from({ length: 4 }, (_, i) => hash.readInt32BE(i * 4)).join(',') + ']'
  const uid = crypto.randomUUID(); const yuid = crypto.randomUUID()
  const ints = uuid => '[I;' + Array.from({ length: 4 }, (_, i) => Buffer.from(uuid.replaceAll('-', ''), 'hex').readInt32BE(i * 4)).join(',') + ']'
  command('gamerule doDaylightCycle false'); command('time set day'); command('gamemode creative MawMotionQA'); command('gamemode creative MawMotionPeer')
  command('tp MawMotionQA 0 -60 0'); command('tp MawMotionPeer 3 -60 0')
  command('kill @e[type=touhou_little_maid:maid]')
  // Death removal is deferred by Minecraft; do not reuse a previous fixture's
  // UUID or mistake its corpse's last animation for this run's live actor.
  await delay(1400); report.models.length = 0; report.metadata.length = 0
  command(`summon touhou_little_maid:maid 2 -60 2 {UUID:${ints(uid)},Tags:["maw_motion_plain"],Owner:${owner},Sitting:0b,MaidIsHome:0b,PersistenceRequired:1b,CustomName:'{"text":"灵梦 QA"}'}`)
  command(`summon touhou_little_maid:maid 4 -60 2 {UUID:${ints(yuid)},Tags:["maw_motion_ysm"],Owner:${owner},Sitting:0b,MaidIsHome:0b,IsYsmModel:1b,YsmModelId:"misc/3_default_boy",YsmModelTexture:"blue",PersistenceRequired:1b,CustomName:'{"text":"YSM QA"}'}`)
  command('ysm model set MawMotionQA "misc/3_default_boy" red'); command('ysm model set MawMotionPeer "misc/3_default_boy" blue')
  await wait(() => report.models.some(r => r.identifier.startsWith('maw_native:touhou_')) && report.models.some(r => r.identifier.startsWith('maw_native:ysm_')))
  command('tp MawMotionQA 10 -60 0'); await delay(3500)
  command('data merge entity @e[tag=maw_motion_ysm,limit=1] {Sitting:1b}'); await delay(1000)
  // Query UUID from native entity data in the log if the fixed SNBT int form
  // above differs from the displayed string; commands below use an exact selector.
  command('execute as @e[tag=maw_motion_plain,limit=1] run data get entity @s UUID')
  command(`maw_scene bubble ${uid} 原生女仆气泡测试：中文换行，随角色移动，到期自动消失。`)
  say('公开聊天气泡 QA'); await delay(1200)
  command('tp @e[tag=maw_motion_plain,limit=1] 7 -60 2'); command('tp MawMotionQA 11 -60 0'); say('/tell MawMotionPeer PRIVATE_MAW_BUBBLE_SHOULD_NOT_LEAK')
  await delay(9000)
  report.checks.five_packs_downloaded = completed.size === 5
  const expected = JSON.parse(fs.readFileSync(path.join(directory, '../packs/modpack-contract.json')))
  report.checks.exact_animated_packs_downloaded = expected.packs.every(p => report.packs.some(r => r.sha256 === expected.files[p.file].sha256))
  report.checks.native_tlm_and_ysm_entities = report.models.some(r => r.identifier.startsWith('maw_native:touhou_')) && report.models.some(r => r.identifier.startsWith('maw_native:ysm_'))
  const names = report.helpers.map(r => String(r.name || '')).concat(report.metadata.flatMap(r => (r.metadata || []).filter(m => m.key === 4 || m.key === 'nametag').map(m => String(m.value))))
  report.checks.native_maid_speech_bubble = names.some(n => n.includes('原生女仆气泡'))
  report.checks.public_player_speech_bubble = names.some(n => n.includes('公开聊天气泡'))
  report.checks.private_chat_not_in_bubbles = !names.some(n => n.includes('PRIVATE_MAW'))
  report.checks.player_ysm_animation_packets = report.animations.some(p => String(p.animation).startsWith('animation.maw_native.'))
  const selectedSkins = report.skins.filter(s => s.id?.startsWith('maw_native:ysm_'))
  // A valid native default can appear before the explicit QA selection. Check
  // each UUID's final skin against the requested original texture, not a count
  // that incorrectly treats intermediate native appearances as extra players.
  const finalSkins = new Map(selectedSkins.map(s => [s.uuid, s.id]))
  const nativeCatalog = JSON.parse(fs.readFileSync(path.join(directory, '../packs/modpack-catalog.json')))
  const expectedSkin = texture => nativeCatalog.models.find(m => m.kind === 'ysm' && m.modelId === 'misc/3_default_boy' && m.textureId === texture)?.bedrockIdentifier
  // Read the actual Bedrock PlayerList identity too: Geyser's self entry can
  // differ from the Java body identity used for maid ownership.
  const selfBedrockUuid = playerIdentities.get(login.username)
  report.ysmFinalBindings = { selfJavaUuid: selfUuid, selfBedrockUuid, peerUuid: peer._client.uuid, names: Object.fromEntries(playerIdentities), actual: Object.fromEntries(finalSkins), expectedSelf: expectedSkin('red'), expectedPeer: expectedSkin('blue') }
  report.checks.separate_ysm_player_appearances = finalSkins.get(selfBedrockUuid) === expectedSkin('red') && finalSkins.get(peer._client.uuid) === expectedSkin('blue') && expectedSkin('red') !== expectedSkin('blue')
  report.checks.pose_variants_sent = report.metadata.some(r => r.metadata.some(m => (m.key === 2 || m.key === 'variant') && m.value === 4))
  report.checks.walk_to_idle_states = [0, 1].every(v => report.metadata.some(r => r.metadata.some(m => m.key === 'variant' && m.value === v)))
  report.checks.bubbles_follow_positions = report.moves.some(r => BigInt(r.id || 0) >= (1n << 51n))
  report.checks.native_maid_head_rotations = report.models.some(m => report.moves.some(r => r.id === m.runtimeId && r.rotation && (r.rotation.x !== 0 || r.rotation.z !== r.rotation.y)))
  report.checks.bubbles_expire = report.helpers.some(h => report.removals.some(r => r.id === h.runtimeId))
  report.checks.no_errors = !caught; report.ok = Object.values(report.checks).every(Boolean)
}
main().catch(e => { report.error = e.stack; report.ok = false }).finally(async () => {
  if (peer) peer.quit(); if (client) client.close(); await delay(500)
  const resultFile = path.join(directory, 'bedrock-actor-acceptance.json')
  if (fs.existsSync(resultFile)) fs.renameSync(resultFile, path.join(directory, 'bedrock-actor-acceptance-' + Date.now() + '.json'))
  fs.writeFileSync(resultFile, JSON.stringify(report, (_, v) => typeof v === 'bigint' ? String(v) : v, 2))
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks, models: report.models.length, helpers: report.helpers.length, animations: report.animations.length, error: report.error }))
  process.exitCode = report.ok ? 0 : 1
})
