'use strict'
const fs = require('node:fs')
const path = require('node:path')
if (!process.argv[2] || !/^[a-z0-9-]{1,64}$/.test(process.argv[3] || '')) throw new Error('independent runtime and fresh ASCII run ID required')
const req = require('node:module').createRequire(path.resolve(process.argv[2], 'package.json'))
const file = path.resolve(process.argv[2], process.argv[3] + '.json')
const fd = fs.openSync(file, 'wx')
const result = { schemaVersion: 1, externalPlugins: [], cases: [], success: false }
const clients = []
let done = false
const deadline = setTimeout(() => finish(new Error('privacy_probe_timeout')), 45000)
function finish (error) {
  if (done) return
  done = true; clearTimeout(deadline)
  result.success = !error; if (error) result.error = error.message
  result.observedAt = new Date().toISOString()
  fs.writeSync(fd, JSON.stringify(result, null, 2)); fs.closeSync(fd)
  for (const client of clients) client.bot.quit?.('privacy_probe_finished')
  console.log(JSON.stringify(result)); setTimeout(() => process.exit(error ? 1 : 0), 500)
}
function need (condition, message) { if (!condition) throw new Error(message) }
function connect (username) {
  return new Promise((resolve, reject) => {
    const bot = req('mineflayer').createBot({ username, host: '127.0.0.1', port: 39786, version: '1.21.1', auth: 'offline', logErrors: false, respawn: false })
    const client = { bot, rows: [], pending: new Map() }; clients.push(client)
    bot.on('error', reject); bot.on('kicked', value => reject(new Error('kicked:' + JSON.stringify(value))))
    bot.on('messagestr', text => {
      if (!text.startsWith('MC_NATIVE ')) return
      const row = JSON.parse(text.slice(10)); client.rows.push(row)
      const pending = client.pending.get(row.requestId)
      if (pending) { client.pending.delete(row.requestId); clearTimeout(pending.timer); pending.resolve(row) }
    })
    client.read = command => new Promise((resolve, reject) => {
      const requestId = command.split(' ')[0]
      const timer = setTimeout(() => { client.pending.delete(requestId); reject(new Error('private_reply_timeout:' + requestId)) }, 4000)
      client.pending.set(requestId, { resolve, timer })
      bot.chat('/agent ' + command)
    })
    bot.once('spawn', async () => { await bot.waitForChunksToLoad(); await bot.waitForTicks(3); resolve(client) })
  })
}
;(async () => {
  const owner = await connect('StockGate1211')
  const observer = await connect('StockOtherProbe')
  const own = await owner.read('owner-inv inventory 0 12 minecraft:crafting_table')
  const other = await observer.read('other-inv inventory 0 12 minecraft:crafting_table')
  need(own.bodyId === owner.bot._client.uuid && other.bodyId === observer.bot._client.uuid, 'body_identity_not_scoped')
  need(own.rows.some(row => row.item?.nativeId === 'minecraft:crafting_table') && other.totalCount === 0, 'cross_body_inventory_leak_or_missing_fixture')
  result.cases.push({ name: 'per_connection_inventory', passed: true, ownCount: own.totalCount, otherCount: other.totalCount })
  const invalid = await owner.read('owner-invalid items 0 99')
  need(invalid.status === 'invalid_argument' && invalid.field === 'limit' && invalid.example, 'inaccurate_argument_diagnostic')
  result.cases.push({ name: 'bounded_query_argument_diagnostic', passed: true, status: invalid.status, field: invalid.field })
  const distant = await owner.read('owner-far block 100000 150 100000')
  need(distant.status === 'denied' && distant.reason === 'outside_actual_player_interaction_range' && !distant.block, 'distant_block_read_exposed_unobserved_world')
  result.cases.push({ name: 'server_authoritative_range_denial', passed: true, reason: distant.reason })
  const page = await owner.read('owner-page items 0 12')
  need(page.status === 'partial' && page.returnedCount === 12 && page.remainingCount === page.totalCount - 12 && page.next.offset === 12, 'catalog_page_coverage_mismatch')
  result.cases.push({ name: 'bounded_partial_catalog', passed: true, returnedCount: page.returnedCount, remainingCount: page.remainingCount })
  owner.bot.chat('/vq journal open'); await owner.bot.waitForTicks(5)
  const views = await owner.read('owner-views views 0 12')
  need(views.rows.some(row => row.channel === 'village-quest:reputation_view_v2'), 'real_quest_view_not_observed')
  const view = await owner.read('owner-view view 0 1 village-quest:reputation_view_v2')
  need(view.status === 'ok' && view.rows[0].wireVerified === true && view.rows[0].bodyId === owner.bot._client.uuid, 'quest_wire_or_owner_not_verified')
  const absent = await observer.read('other-view view 0 1 village-quest:reputation_view_v2')
  need(absent.status === 'unknown' && absent.complete === false, 'other_player_received_owned_quest_view')
  result.cases.push({ name: 'real_quest_view_and_owner_isolation', passed: true, channel: views.rows[0].channel, observerStatus: absent.status })
  need(observer.rows.every(row => !row.requestId?.startsWith('owner-')), 'private_reply_was_broadcast')
  result.cases.push({ name: 'no_private_query_chat_broadcast', passed: true })
  finish()
})().catch(finish)
