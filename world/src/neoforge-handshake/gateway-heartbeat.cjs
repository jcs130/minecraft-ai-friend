'use strict'
const { randomInt } = require('node:crypto')
function nonceKey (value) {
  if (Number.isSafeInteger(value)) return BigInt.asUintN(64, BigInt(value)).toString()
  if (typeof value === 'bigint') return BigInt.asUintN(64, value).toString()
  if (Array.isArray(value) && value.length === 2 && value.every(Number.isInteger) && value[0] >= -2147483648 && value[0] <= 2147483647 && value[1] >= -2147483648 && value[1] <= 4294967295) return BigInt.asUintN(64, (BigInt(value[0]) << 32n) | BigInt(value[1] >>> 0)).toString()
  throw Error('GATEWAY_HEARTBEAT_ID_INVALID')
}
// Terminate the two transport heartbeats independently. Backend IDs are echoed
// ONLY by Gate and never reach the frontend. Frontend IDs are consumed ONLY
// here and can never be forwarded to Minecraft as a duplicate/foreign nonce.
class GatewayHeartbeat {
  constructor ({ send, expire, now = Date.now, nonce = () => randomInt(1, 2147483647), schedule = setInterval, unschedule = clearInterval, intervalMs = 10000, timeoutMs = 60000 }) {
    if (typeof send !== 'function' || typeof expire !== 'function' || intervalMs < 1000 || timeoutMs < intervalMs * 2) throw Error('GATEWAY_HEARTBEAT_CONFIG_INVALID')
    Object.assign(this, { send, expire, now, nonce, schedule, unschedule, intervalMs, timeoutMs }); this.timer = null; this.pending = null
    this.stats = { frontendSent: 0, frontendAcked: 0, backendAcked: 0, rttMs: null, lastAckAt: null }
  }
  start () { if (this.timer !== null) return; this.tick(); this.timer = this.schedule(() => this.tick(), this.intervalMs); this.timer?.unref?.() }
  tick () {
    const at = this.now()
    if (this.pending) { if (at - this.pending.at >= this.timeoutMs) { this.stop(); this.expire('客户端心跳超时') } return }
    const key=nonceKey(this.nonce()); this.pending = { key, at }; this.stats.frontendSent++
    // ProtoDef 1.21.1's i64 writer accepts bigint or [hi,lo], NOT number.
    // Passing a JS number silently encoded zero in the real wire codec.
    this.send({ keepAliveId: BigInt.asIntN(64,BigInt(key)) })
  }
  acknowledge (id) {
    const key = nonceKey(id)
    if (!this.pending || key !== this.pending.key) throw Error('GATEWAY_HEARTBEAT_UNEXPECTED_ACK')
    const at = this.now(); this.stats.rttMs = Math.max(0, at - this.pending.at); this.stats.lastAckAt = at; this.stats.frontendAcked++; this.pending = null
  }
  backendAck () { this.stats.backendAcked++ }
  stop () { if (this.timer !== null) this.unschedule(this.timer); this.timer = null; this.pending = null }
}
module.exports = { GatewayHeartbeat, nonceKey }
