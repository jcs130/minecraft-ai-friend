'use strict'
// Connection-scoped opt-in. UTF-8 JSON is never sent through game chat.
const CHANNEL = 'mcagent:account'
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
function attachAccountReceipts (bot) {
  const receipts = new Map()
  bot.sharedAccountReceipts = receipts
  const payload = packet => {
    if (packet.channel !== CHANNEL) return
    try {
      if (!Buffer.isBuffer(packet.data) || packet.data.length > 16384) throw Error('account_receipt_budget')
      const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(packet.data))
      if (result.schemaVersion !== 1 || !UUID.test(result.bodyUuid || '') || result.bodyUuid !== bot.player?.uuid || (result.requestId != null && !UUID.test(result.requestId))) throw Error('account_receipt_identity')
      const key = result.requestId || 'status'
      receipts.set(key, result)
      while (receipts.size > 32) receipts.delete(receipts.keys().next().value)
      bot.emit('sharedAccount', result)
    } catch (error) { bot.emit('sharedAccountReceiptError', { reason: error.message }) }
  }
  bot._client.on('custom_payload', payload)
  bot.once('spawn', () => bot._client.write('custom_payload', { channel: 'minecraft:register', data: Buffer.from(CHANNEL, 'utf8') }))
  bot.once('end', () => bot._client.off('custom_payload', payload))
  return receipts
}
module.exports = { CHANNEL, attachAccountReceipts }
