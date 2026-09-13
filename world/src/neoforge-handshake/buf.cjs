// src/neoforge-handshake/buf.js
// Minecraft 网络字节读写（FriendlyByteBuf 子集）——协商层编解码的地基。
// 参照：NeoForge 21.1 ByteBufCodecs（VarInt / STRING_UTF8 / optional / collection / map）。
'use strict'

class BufWriter {
  constructor () { this.chunks = []; this.len = 0 }
  _push (buf) { this.chunks.push(buf); this.len += buf.length; return this }
  varint (v) {
    const bytes = []
    v = v >>> 0
    while (true) {
      if ((v & ~0x7f) === 0) { bytes.push(v); break }
      bytes.push((v & 0x7f) | 0x80); v >>>= 7
    }
    return this._push(Buffer.from(bytes))
  }
  bool (b) { return this._push(Buffer.from([b ? 1 : 0])) }
  string (s) {
    const data = Buffer.from(s, 'utf8')
    return this.varint(data.length)._push(data)
  }
  resourceLocation (rl) { return this.string(rl) }
  bytes (buf) { return this._push(buf) }
  // optional<T>: bool present + value
  optional (present, writeValue) {
    this.bool(present)
    if (present) writeValue(this)
    return this
  }
  // collection: varint size + each item
  collection (items, writeItem) {
    this.varint(items.length)
    for (const item of items) writeItem(this, item)
    return this
  }
  // map: varint size + entries
  map (entries, writeEntry) {
    this.varint(entries.length)
    for (const e of entries) writeEntry(this, e)
    return this
  }
  finish () { return Buffer.concat(this.chunks, this.len) }
}

class BufReader {
  constructor (buf, offset = 0) { this.buf = buf; this.off = offset }
  get remaining () { return this.buf.length - this.off }
  varint () {
    let value = 0; let shift = 0
    while (true) {
      const b = this.buf[this.off++]
      value |= (b & 0x7f) << shift
      if ((b & 0x80) === 0) break
      shift += 7
      if (shift >= 35) throw new Error('VarInt too big')
    }
    return value >>> 0
  }
  bool () { return this.buf[this.off++] !== 0 }
  string () {
    const len = this.varint()
    const s = this.buf.toString('utf8', this.off, this.off + len)
    this.off += len
    return s
  }
  resourceLocation () { return this.string() }
  bytes (n) { const b = this.buf.subarray(this.off, this.off + n); this.off += n; return b }
  rest () { const b = this.buf.subarray(this.off); this.off = this.buf.length; return b }
  optional (readValue) {
    const present = this.bool()
    return present ? readValue(this) : null
  }
  collection (readItem) {
    const n = this.varint()
    const out = []
    for (let i = 0; i < n; i++) out.push(readItem(this))
    return out
  }
  map (readEntry) {
    const n = this.varint()
    const out = []
    for (let i = 0; i < n; i++) out.push(readEntry(this))
    return out
  }
}

// ConnectionProtocol 枚举序数（1.21.1 原版枚举声明顺序，2026-08-25 冒烟实证）：
// HANDSHAKING(0), PLAY(1), STATUS(2), LOGIN(3), CONFIGURATION(4)
// ⚠️ PLAY 是元老（id 0 时代），CONFIGURATION 是 1.20.2 追加在末尾的——不是按握手流程排序！
// 实证记录：key=1 的通道清单落进 PLAY 桶（id 匹配成功），key=4 落进 CONFIGURATION 桶。
const PROTOCOL = { HANDSHAKING: 0, PLAY: 1, STATUS: 2, LOGIN: 3, CONFIGURATION: 4 }
// PacketFlow 枚举序数：SERVERBOUND(0) CLIENTBOUND(1)（2026-08-25 实证：发 1 被服务器读成 CLIENTBOUND）
const FLOW = { SERVERBOUND: 0, CLIENTBOUND: 1 }
const FLOW_NAME = { SERVERBOUND: 'SERVERBOUND', CLIENTBOUND: 'CLIENTBOUND' }

module.exports = { BufWriter, BufReader, PROTOCOL, FLOW, FLOW_NAME }
