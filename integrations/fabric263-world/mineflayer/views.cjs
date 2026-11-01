'use strict'
const crypto = require('node:crypto')

function viewChannels (native) {
  const bridge = native?.viewBridge
  if (bridge?.schemaVersion !== 1 || bridge.villageQuestVersion !== '2.6.3' ||
      bridge.channel !== 'maw_agent:view_state' || bridge.channels?.length !== 6 ||
      new Set(bridge.channels).size !== 6 || bridge.channels.some(c => !/^village-quest:[a-z0-9_./-]+$/.test(c))) {
    throw new Error('unsupported_native_view_bridge')
  }
  return [...bridge.channels, bridge.channel]
}

function attachViews (client, getNative) {
  const pending = new Map(); const original = new Map(); const views = new Map()
  function reconcile (channel) {
    const row = pending.get(channel); const wire = original.get(channel)
    if (!row || !wire || row.wireSha256 !== wire.hash) return
    views.set(channel, { ...row, receivedAt: wire.receivedAt, wireVerified: true })
    pending.delete(channel)
    client.emit('maw_native_view', { channel, complete: row.complete, wireVerified: true })
  }
  client.on('custom_payload', packet => {
    const native = getNative()
    if (!native?.viewBridge) return
    if (packet.channel === 'maw_agent:view_state') {
      try {
        if (!Buffer.isBuffer(packet.data) || packet.data.length > 262144) throw new Error('native_view_budget_exceeded')
        const row = JSON.parse(packet.data.toString('utf8'))
        if (row.schemaVersion !== 1 || row.bodyId !== client.uuid || row.complete !== true ||
            !native.viewBridge.channels.includes(row.channel) || !/^[a-f0-9]{64}$/.test(row.wireSha256) || !Number.isFinite(Date.parse(row.observedAt))) throw new Error('invalid_native_view')
        pending.set(row.channel, row); reconcile(row.channel)
      } catch (error) { client.emit('error', error); client.end('invalid_native_view') }
    } else if (native.viewBridge.channels.includes(packet.channel)) {
      if (!Buffer.isBuffer(packet.data) || packet.data.length > 1024 * 1024) { client.emit('error', new Error('native_view_wire_budget')); return }
      original.set(packet.channel, { hash: crypto.createHash('sha256').update(packet.data).digest('hex'), receivedAt: new Date().toISOString() })
      reconcile(packet.channel)
    }
  })
  return {
    list: () => [...views.keys()],
    get: channel => views.has(channel) ? structuredClone(views.get(channel)) : {
      schemaVersion: 1, channel, status: 'unknown', reason: 'not_observed_on_this_connection', complete: false
    }
  }
}

module.exports = { viewChannels, attachViews }
