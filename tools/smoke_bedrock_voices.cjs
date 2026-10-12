'use strict'
// Finite original maid voice UDP acceptance, ONLY the dedicated loopback QA bridge/server.
// Does not change LAN Xbox validation, live accounts, models or Agent actions.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const assert = require('node:assert/strict')
const bedrock = require(process.env.MAW_BEDROCK_CLIENT_MODULE || 'bedrock-protocol')
const mineflayer = require('mineflayer')
const directory = path.resolve(process.argv[2]), login = JSON.parse(fs.readFileSync(path.join(directory, 'login.json')))
assert.equal(login.username, 'MawMotionQA'); assert.ok(fs.existsSync(path.join(directory, 'ready.json')))
const report = { schemaVersion: 1, checks: {}, packs: [], models: [], helpers: [], metadata: [], animations: [], skins: [], removals: [], moves: [], actualPhoneTested: false, actualSpeakerTested: false, pixelParityVerified: false, sounds: [], nativeSounds: [], nativeMetadata: [], paidModelCalls: 0, productionActions: 0 }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const command = text => fs.appendFileSync(path.join(directory, 'console.jsonl'), JSON.stringify({ command: text }) + '\n')
const digest = raw => crypto.createHash('sha256').update(raw).digest('hex')
const metaName = p => (p.metadata || []).find(e => e.key === 4 || e.key === 'name' || e.key === 'nametag')?.value
const resourceUuid = value => { const b = Buffer.from(value.replaceAll('-', ''), 'hex'); b.subarray(0, 8).reverse(); b.subarray(8, 16).reverse(); const s = b.toString('hex'); return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}` }
let client, peer, send, spawned = false, caught, readyAuth = false
const packData = new Map(), completed = new Set(), packs = []
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
  client.on('player_list', p => { for (const r of (p.records?.records || p.records || [])) if (r.uuid && r.skin_data) skin(r.uuid, r.skin_data) })
  client.on('remove_entity', p => report.removals.push({ at: Date.now(), id: String(p.entity_id_self || p.entity_id || p.unique_entity_id) }))
  client.on('move_entity', p => { if (report.moves.length < 500) report.moves.push({ at: Date.now(), id: String(p.runtime_entity_id), position: p.position, rotation: p.rotation }) })
  await wait(() => spawned && completed.size === packs.length, 65000)
  peer = mineflayer.createBot({ host: '127.0.0.1', port: 28979, username: 'MawMotionPeer', version: '1.21.1', auth: 'offline' })
  client.on('play_sound', p => report.sounds.push({ at: Date.now(), ...p }))
  peer._client.on('custom_payload', p => {
    if (!['touhou_little_maid:play_maid_sound', 'touhou_little_maid:play_maid_sound_at_pos'].includes(p.channel)) return
    try {
      const data = Buffer.from(p.data); let at = 0
      const integer = () => { let n = 0; for (let i = 0; i < 5; i++) { const b = data[at++]; n += (b & 127) * 2 ** (i * 7); if (!(b & 128)) return n } throw Error('native_varint') }
      const string = () => { const n = integer(); const s = data.toString('utf8', at, at + n); at += n; return s }
      report.nativeSounds.push({ at: Date.now(), channel: p.channel, event: string(), pack: string(), entityId: p.channel.endsWith('_at_pos') ? null : integer() })
    } catch (e) { caught = e.message }
  })
  peer._client.on('entity_metadata', p => { if (report.nativeMetadata.length < 200) report.nativeMetadata.push({ at: Date.now(), ...p }) })
  peer.on('error', e => { caught = e.message }); await new Promise((resolve, reject) => { peer.once('spawn', resolve); peer.once('kicked', () => reject(Error('peer_kicked'))) })
  await delay(1500)

  const voices = JSON.parse(fs.readFileSync(path.join(directory, '../packs/maid-voices.json')))
  const expected = JSON.parse(fs.readFileSync(path.join(directory, '../packs/modpack-contract.json')))
  const sound = (pack, event = 'maid.ai.hurt') => voices.packs.find(p => p.id === pack).events['touhou_little_maid:' + event].sound
  command('gamerule doDaylightCycle false'); command('time set day')
  command('gamemode creative MawMotionQA'); command('gamemode creative MawMotionPeer')
  command('tp MawMotionQA 0 -60 0'); command('tp MawMotionPeer 3 -60 0')
  command('kill @e[type=touhou_little_maid:maid]'); await delay(1200); report.models.length = 0
  command('summon touhou_little_maid:maid 2 -60 2 {NoAI:1b,Silent:0b,Tags:["maw_voice_first"],PersistenceRequired:1b,Invulnerable:0b,SoundPackId:"touhou_little_maid",MaidSubConfig:{SoundFreq:1.0f}}')
  command('summon touhou_little_maid:maid 4 -60 2 {NoAI:1b,Silent:0b,Tags:["maw_voice_second"],PersistenceRequired:1b,Invulnerable:0b,SoundPackId:"littlemaid_peco",MaidSubConfig:{SoundFreq:1.0f}}')
  await wait(() => report.models.length >= 2); await delay(1200)
  async function hurt (tag) {
    const at = Date.now(); command(`damage @e[tag=${tag},limit=1] 1 minecraft:generic`)
    await delay(1300)
    return { sounds: report.sounds.filter(s => s.at >= at), native: report.nativeSounds.filter(s => s.at >= at) }
  }
  let first = await hurt('maw_voice_first'), second = await hurt('maw_voice_second')
  report.checks.original_first_voice = first.native.some(p => p.pack === 'touhou_little_maid' && p.event.endsWith('.hurt')) && first.sounds.some(p => p.name === sound('touhou_little_maid'))
  report.checks.original_second_voice = second.native.some(p => p.pack === 'littlemaid_peco' && p.event.endsWith('.hurt')) && second.sounds.some(p => p.name === sound('littlemaid_peco'))
  report.checks.spatial_position_from_actual_maid = first.sounds.some(p => p.name === sound('touhou_little_maid') && p.coordinates.x === report.models[0].position.x * 8 && p.coordinates.y === -480 && p.coordinates.z === report.models[0].position.z * 8)
  report.checks.original_gain_pitch = first.sounds.some(p => p.name === sound('touhou_little_maid') && p.volume === 1 && p.pitch === 1)
  command('data merge entity @e[tag=maw_voice_first,limit=1] {MaidSubConfig:{SoundFreq:0.0f}}'); await delay(800)
  let muted = await hurt('maw_voice_first')
  report.checks.zero_frequency_suppresses_received_native_event = muted.native.some(p => p.pack === 'touhou_little_maid' && p.event.endsWith('.hurt')) && !muted.sounds.some(p => p.name === sound('touhou_little_maid'))
  command('data merge entity @e[tag=maw_voice_first,limit=1] {MaidSubConfig:{SoundFreq:1.0f},MaidBaubleInventory:{Size:30,Items:[{Slot:0,id:"touhou_little_maid:mute_bauble",count:1}]}}'); await delay(800)
  muted = await hurt('maw_voice_first')
  report.checks.original_mute_accessory_cancels_event = !muted.native.some(p => p.pack === 'touhou_little_maid' && p.event.endsWith('.hurt')) && !muted.sounds.some(p => p.name === sound('touhou_little_maid'))
  command('data merge entity @e[tag=maw_voice_first,limit=1] {MaidBaubleInventory:{Size:30,Items:[]},SoundPackId:"missing_voice_qa"}'); await delay(800)
  let missing = await hurt('maw_voice_first')
  report.checks.unknown_voice_does_not_borrow_other_pack = missing.native.some(p => p.pack === 'missing_voice_qa') && !missing.sounds.some(p => p.name?.startsWith('maw_maid.') && p.coordinates.x === report.models[0].position.x * 8)
  command('data merge entity @e[tag=maw_voice_first,limit=1] {SoundPackId:"littlemaid_peco"}'); await delay(800)
  let changed = await hurt('maw_voice_first')
  report.checks.changed_native_voice_takes_effect = changed.sounds.some(p => p.name === sound('littlemaid_peco'))
  command('tp MawMotionQA 60 -60 0'); await delay(1200)
  let distant = await hurt('maw_voice_second')
  report.checks.original_sixteen_block_audience = distant.native.some(p => p.pack === 'littlemaid_peco' && p.event.endsWith('.hurt')) && !distant.sounds.some(p => p.name?.startsWith('maw_maid.'))
  report.checks.original_audio_pack_downloaded = expected.packs.every(p => report.packs.some(r => r.sha256 === expected.files[p.file].sha256)) && completed.size === 5
  report.checks.no_errors = !caught; report.ok = Object.values(report.checks).every(Boolean)
}
main().catch(e => { report.error = e.stack; report.ok = false }).finally(async () => {
  if (peer) peer.quit(); if (client) client.close(); await delay(500)
  const resultFile = path.join(directory, 'bedrock-voice-acceptance.json')
  if (fs.existsSync(resultFile)) fs.renameSync(resultFile, path.join(directory, 'bedrock-voice-acceptance-' + Date.now() + '.json'))
  fs.writeFileSync(resultFile, JSON.stringify(report, (_, v) => typeof v === 'bigint' ? String(v) : v, 2))
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks, sounds: report.sounds.length, nativeSounds: report.nativeSounds.length, error: report.error }))
  process.exitCode = report.ok ? 0 : 1
})
