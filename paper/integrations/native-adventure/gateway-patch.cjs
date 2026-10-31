'use strict'
const crypto = require('node:crypto')
const SOURCE_SHA256 = 'f0057a638de450661bc6a0d54ff5ea9b2c461f6273b87844e05926c46d6d2f04'

// Only the new release copy is patched. Never edit the frozen source gateway.
function patchGateway (bytes) {
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== SOURCE_SHA256) throw Error('REVIEWED_GATEWAY_SOURCE_REQUIRED')
  let text = bytes.toString('utf8').replace(/\r\n/g, '\n')
  function replace (before, after) {
    if (text.split(before).length !== 2) throw Error('GATEWAY_PATCH_ANCHOR_CHANGED')
    text = text.replace(before, after)
  }
  replace("const VERSION = '1.21.1'", `const directFactory = process.env.GATE_MINEFLAYER_DIRECT === '1'
  ? require('./direct-gateway.cjs').loadDirectGateway(process.env.GATE_NATIVE_STATES_FILE, nativeViewerHash,
    require('./native-chunk-remap.cjs').visitChunk) : null
if (directFactory && (!vanillaAgentProjection || process.env.GATE_BEDROCK_PROJECTION === '1')) throw Error('DIRECT_MINEFLAYER_PROJECTION_REQUIRED')
const directRegistryChannel = require('./registry-protocol.cjs').CHANNEL

const VERSION = '1.21.1'`)
  replace("  sess.heartbeat=new ", "  sess.direct = directFactory?.()\n  sess.heartbeat=new ")
  replace("function onFrontPacket (sess, name, params) {\n  if (sess.closed) return", `function onFrontPacket (sess, name, params) {
  if (sess.closed) return
  if (name === 'custom_payload' && params.channel === directRegistryChannel && sess.direct) {
    try { sess.direct.subscribe(params.data, sess.phase) }
    catch (error) { kickFront(sess, error.message) }
    return
  }`)
  replace("    if (nativeViewerHash && sess.front.state === states.PLAY) {\n      try {", `    if (nativeViewerHash && sess.front.state === states.PLAY && (!sess.direct || sess.direct.enabled())) {
      try {
        sess.direct?.beforePacket(name, params, p => target.write('custom_payload', p))`)
  replace("    if (REMAP.hasMap()) {\n      try { params = REMAP.remapOut(name, params) }", `    if (sess.direct) {
      try { params = sess.direct.itemNames(name, params, sess.bedrockProjection?.registries.get('minecraft:item')) }
      catch (error) { kickFront(sess, error.message); return }
    }
    if (REMAP.hasMap()) {
      try { params = REMAP.remapOut(name, params) }`)
  replace("    if (sess.bedrockItems) log(`bedrock-items[${sess.username}] ${JSON.stringify(sess.bedrockItems.stats)}`)",
    "    if (sess.bedrockItems) log(`bedrock-items[${sess.username}] ${JSON.stringify(sess.bedrockItems.stats)}`)\n    if (sess.direct) log(`mineflayer-direct[${sess.username}] ${JSON.stringify(sess.direct.stats)}`)")
  return text
}
module.exports = { patchGateway, SOURCE_SHA256 }
