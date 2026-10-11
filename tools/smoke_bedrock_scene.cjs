'use strict'
// Finite real Bedrock UDP probe. Use ONLY a dedicated loopback QA bridge with
// offline test authentication; never disable Xbox validation on the LAN bridge.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const assert = require('node:assert/strict')
const bedrock = require(process.env.MAW_BEDROCK_CLIENT_MODULE || 'bedrock-protocol')
const directory = path.resolve(process.argv[2]), login = JSON.parse(fs.readFileSync(path.join(directory, 'login.json')))
const report = { schemaVersion: 1, checks: {}, downloaded: [], entities: [], forms: [], actualPhoneTested: false, pixelParityVerified: false, paidModelRequests: 0, productionActions: 0, ok: false }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let client, caught, authenticated = false, spawn = false, originalWrite
const packData = new Map(), completed = new Set(), packs = []
const send = (name, data) => originalWrite(name, data)
// This pinned probe library reads Bedrock's two little-endian UUID longs as
// network-order UUID bytes. Resource requests carry strings, so normalize the
// advertised UUID here; production Geyser and actual clients need no change.
const resourceUuid = value => { const b = Buffer.from(value.replaceAll('-', ''), 'hex'); b.subarray(0, 8).reverse(); b.subarray(8, 16).reverse(); const s = b.toString('hex'); return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}` }
const response = status => send('resource_pack_client_response', { response_status: status, response_status_name: status === 'send_packs' ? 'askingserverforpacks' : status === 'have_all_packs' ? 'finishedloadingpacks' : 'resourcepackstackfinished', resourcepackids: status === 'send_packs' ? packs.map(p => p.uuid + '_' + p.version) : [] })
async function main () {
  client = bedrock.createClient({ host: '127.0.0.1', port: 28993, version: '1.26.51', username: login.username, offline: true, followPort: false, skipPing: true, raknetBackend: 'raknet-native', conLog: () => {} })
  originalWrite = client.write.bind(client)
  // The library assumes already cached packs. This test actually downloads
  // every chunk before acknowledging, rather than skipping pack acceptance.
  client.write = (name, value) => name === 'resource_pack_client_response' ? undefined : originalWrite(name, value)
  client.on('error', e => { caught = String(e.message) })
  client.on('kick', e => { caught = 'kick:' + JSON.stringify(e) })
  client.on('resource_packs_info', p => {
    packs.push(...p.texture_packs.map(p => ({ ...p, uuid: resourceUuid(p.uuid) }))); report.checks.force_pack_download = p.must_accept === true
    report.advertisedPacks = packs.map(p => ({ uuid: p.uuid, version: p.version, bytes: String(p.size) }))
    response('send_packs')
  })
  client.on('resource_pack_data_info', p => {
    packData.set(p.pack_id, { ...p, chunks: new Map() })
    for (let i = 0; i < p.chunk_count; i++) send('resource_pack_chunk_request', { pack_id: p.pack_id, chunk_index: i })
  })
  client.on('resource_pack_chunk_data', p => {
    try {
      const item = packData.get(p.pack_id); assert.ok(item); item.chunks.set(p.chunk_index, Buffer.from(p.payload))
      if (item.chunks.size !== item.chunk_count || completed.has(p.pack_id)) return
      const raw = Buffer.concat(Array.from({ length: item.chunk_count }, (_, i) => item.chunks.get(i)))
      assert.equal(BigInt(raw.length), BigInt(item.size)); const hash = crypto.createHash('sha256').update(raw).digest()
      assert.deepEqual(hash, Buffer.from(item.hash)); completed.add(p.pack_id)
      report.downloaded.push({ packId: p.pack_id, bytes: raw.length, sha256: hash.toString('hex') })
      if (completed.size === packs.length) response('have_all_packs')
    } catch (e) { caught = e.stack }
  })
  client.on('resource_pack_stack', p => { report.packStack = p.resource_packs; response('completed') })
  client.on('start_game', p => { report.runtimeEntityId = String(p.runtime_entity_id); report.position = p.player_position })
  client.on('spawn', () => { spawn = true })
  client.on('text', p => {
    if (!authenticated && /login|登录|注册/.test(p.message || '')) {
      authenticated = true
      send('text', { type: 'chat', category: 'authored', needs_translation: false, source_name: login.username, message: '/login ' + login.password, xuid: '', platform_chat_id: '', has_filtered_message: false })
    }
  })
  client.on('add_entity', p => {
    if (p.entity_type?.startsWith('maw_scene:')) report.entities.push({ identifier: p.entity_type, position: p.position, runtimeId: String(p.runtime_id), metadata: p.metadata })
  })
  client.on('modal_form_request', p => {
    try {
      const form = JSON.parse(p.data); report.forms.push({ id: p.form_id, title: form.title, images: form.buttons?.filter(b => b.image?.type === 'path').map(b => b.image.data) })
      if (form.title?.includes('同伴面板')) send('modal_form_response', { form_id: p.form_id, has_response_data: true, data: '2', has_cancel_reason: false })
      else if (form.title?.includes('冒险指南')) send('modal_form_response', { form_id: p.form_id, has_response_data: true, data: '1', has_cancel_reason: false })
    } catch (e) { caught = e.stack }
  })
  const deadline = Date.now() + 65000
  while (Date.now() < deadline && !caught && !(report.entities.some(e => e.identifier.startsWith('maw_scene:f') || e.identifier.startsWith('maw_scene:v')) && report.forms.some(f => f.title === '农场与厨房'))) await delay(200)
  report.checks.real_bedrock_spawn = spawn
  report.checks.all_resource_chunks_verified = packs.length >= 4 && completed.size === packs.length
  if (process.argv[3]) {
    const expectedDirectory = path.resolve(process.argv[3])
    const expected = fs.readdirSync(expectedDirectory).filter(n => n.endsWith('.mcpack')).map(n => crypto.createHash('sha256').update(fs.readFileSync(path.join(expectedDirectory, n))).digest('hex'))
    report.checks.downloaded_original_build_bytes = expected.length >= 4 && expected.every(hash => report.downloaded.some(p => p.sha256 === hash))
  }
  report.checks.authenticated_welcome = report.forms.some(f => f.title.includes('同伴面板'))
  report.checks.guide_controller_navigation = report.forms.some(f => f.title === '农场与厨房')
  report.checks.guide_original_icon_paths = report.forms.some(f => f.images?.includes('textures/guide/food'))
  report.checks.actual_scene_block_models = report.entities.some(e => /^maw_scene:b\d+$/.test(e.identifier))
  report.checks.actual_scene_food_models = report.entities.some(e => /^maw_scene:[fv]\d+$/.test(e.identifier))
  report.checks.actual_windmill_parts = report.entities.some(e => /^maw_scene:p\d+[xyz]$/.test(e.identifier))
  report.checks.no_client_error = !caught
  if (caught) report.error = caught
  report.ok = Object.values(report.checks).every(Boolean)
}
main().catch(e => { report.error = e.stack }).finally(async () => {
  if (client) { client.close(); await delay(600) }
  fs.writeFileSync(path.join(directory, 'bedrock-scene-acceptance.json'), JSON.stringify(report, (_, v) => typeof v === 'bigint' ? String(v) : v, 2))
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks, packs: report.downloaded.length, models: report.entities.length, error: report.error }))
  process.exitCode = report.ok ? 0 : 1
})
