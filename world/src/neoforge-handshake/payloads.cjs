// src/neoforge-handshake/payloads.js
// NeoForge 21.1 协商相关 payload 的编解码（参照 neoforged/NeoForge@1.21.1 源码）。
// 源码对照文件在 research/negotiation/*.java。
'use strict'

const { BufWriter, BufReader, PROTOCOL, FLOW } = require('./buf.cjs')

// ── 通道常量（NeoForge 21.1）──────────────────────────────────────
const CH = {
  REGISTER_QUERY: 'neoforge:register', // 双向：服务器空查询 / 客户端回通道清单（ModdedNetworkQueryPayload）
  NETWORK: 'neoforge:network', // 服务器→客户端：协商结果（ModdedNetworkPayload / NetworkPayloadSetup）
  SETUP_FAILED: 'neoforge:modded_network_setup_failed', // 服务器→客户端：协商失败原因表（探测神谕）
  KNOWN_DATA_MAPS: 'neoforge:known_registry_data_maps', // 服务器→客户端
  KNOWN_DATA_MAPS_REPLY: 'neoforge:known_registry_data_maps_reply', // 客户端→服务器
  ENUM_DATA: 'neoforge:extensible_enum_data', // 服务器→客户端
  ENUM_ACK: 'neoforge:extensible_enum_ack', // 客户端→服务器（空体）
  FEATURE_FLAGS: 'neoforge:feature_flags', // 服务器→客户端
  FEATURE_FLAGS_ACK: 'neoforge:feature_flags_ack', // 客户端→服务器（空体）
  // 注册表同步（SyncRegistries 任务）——ID 以 frozen_registry_* 为准（2026-08-25 源码核对）
  FROZEN_SYNC_START: 'neoforge:frozen_registry_sync_start', // 服务器→客户端（哪些注册表要同步）
  FROZEN_REGISTRY: 'neoforge:frozen_registry', // 服务器→客户端（注册表数据本体）
  FROZEN_SYNC_COMPLETED: 'neoforge:frozen_registry_sync_completed', // 双向：服务器发完→客户端回空体确认
  VERSION: 'c:version', // CommonVersionTask：服务器→客户端，客户端回 versions=[1]
  COMMON_REGISTER: 'c:register' // CommonRegisterTask：服务器→客户端，客户端回 {1, PLAY, []}
}

// ── ModdedNetworkQueryPayload（neoforge:register）────────────────
// 结构：map<protocolOrdinal, set<ModdedNetworkQueryComponent>>
// ModdedNetworkQueryComponent = { id:RL, version:string, flow:optional<varint>, optional:bool }
function encodeNetworkQuery (componentsByProtocol) {
  const w = new BufWriter()
  const entries = Object.entries(componentsByProtocol).filter(([, comps]) => comps.length > 0)
  w.map(entries, (w2, [proto, comps]) => {
    w2.varint(Number(proto))
    w2.collection(comps, (w3, c) => {
      w3.resourceLocation(c.id)
      w3.string(c.version || '')
      w3.optional(c.flow !== undefined && c.flow !== null, (w4) => w4.varint(c.flow))
      w3.bool(!!c.optional)
    })
  })
  return w.finish()
}

function decodeNetworkQuery (buf) {
  const r = new BufReader(buf)
  const out = {}
  r.map((r2) => {
    const proto = r2.varint()
    const comps = r2.collection((r3) => ({
      id: r3.resourceLocation(),
      version: r3.string(),
      flow: r3.optional((r4) => r4.varint()),
      optional: r3.bool()
    }))
    out[proto] = comps
    return null
  })
  return out
}

// ── ModdedNetworkPayload（neoforge:network，服务器下发的协商结果）──
// NetworkPayloadSetup = map<protocolOrdinal, map<RL, NetworkChannel{id:RL, version:string}>>
// ⚠️ 内层 map 的值是 NetworkChannel，自带 id 字段——通道 ID 写两遍（key 一份 + 值里一份），别少读！
function decodeNetworkSetup (buf) {
  const r = new BufReader(buf)
  const out = {}
  r.map((r2) => {
    const proto = r2.varint()
    const channels = {}
    r2.map((r3) => {
      const key = r3.resourceLocation()
      r3.resourceLocation() // NetworkChannel.id（与 key 相同）
      channels[key] = { id: key, version: r3.string() }
      return null
    })
    out[proto] = channels
    return null
  })
  return out
}

// ── Component NBT 解析（协商失败原因）────────────────────────────
// 1.20.5+ 网络 NBT = 匿名根：[tagType][payload]，无名称前缀（这就是坑）。
// Component 形如 {translate:"...failure.mod", with:[{"":"模组名"}, {translate:"内层原因",with:[...]}]}
// 纯手写 NBT walker，返回 {value, size}。
function readNbtAt (buf, off) {
  const r = { buf, off }
  const value = readTagPayload(r, buf[r.off++])
  return { value, size: r.off - off }
}

function readTagPayload (r, type) {
  switch (type) {
    case 0: return null // TAG_End（不应单独出现）
    case 1: { const v = r.buf.readInt8(r.off); r.off += 1; return v }
    case 2: { const v = r.buf.readInt16BE(r.off); r.off += 2; return v }
    case 3: { const v = r.buf.readInt32BE(r.off); r.off += 4; return v }
    case 4: { const v = r.buf.readBigInt64BE(r.off); r.off += 8; return v }
    case 5: { const v = r.buf.readFloatBE(r.off); r.off += 4; return v }
    case 6: { const v = r.buf.readDoubleBE(r.off); r.off += 8; return v }
    case 7: { const n = r.buf.readUInt32BE(r.off); r.off += 4; const v = r.buf.subarray(r.off, r.off + n); r.off += n; return v }
    case 8: { const n = r.buf.readUInt16BE(r.off); r.off += 2; const s = r.buf.toString('utf8', r.off, r.off + n); r.off += n; return s }
    case 9: { // TAG_List
      const elemType = r.buf[r.off++]; const n = r.buf.readUInt32BE(r.off); r.off += 4
      const arr = []
      for (let i = 0; i < n; i++) arr.push(readTagPayload(r, elemType))
      return arr
    }
    case 10: { // TAG_Compound
      const obj = {}
      while (true) {
        const t = r.buf[r.off++]
        if (t === 0) break
        const nameLen = r.buf.readUInt16BE(r.off); r.off += 2
        const name = r.buf.toString('utf8', r.off, r.off + nameLen); r.off += nameLen
        obj[name] = readTagPayload(r, t)
      }
      return obj
    }
    case 11: { const n = r.buf.readUInt32BE(r.off); r.off += 4; const arr = []; for (let i = 0; i < n; i++) { arr.push(r.buf.readInt32BE(r.off)); r.off += 4 } return arr }
    case 12: { const n = r.buf.readUInt32BE(r.off); r.off += 4; const arr = []; for (let i = 0; i < n; i++) { arr.push(r.buf.readBigInt64BE(r.off)); r.off += 8 } return arr }
    default: throw new Error('未知 NBT 标签类型 ' + type)
  }
}

// 把 Component NBT 压平成事件序列：{translate, args:[...]} 与 {str}
function flattenComponent (tag, acc) {
  if (tag === null || tag === undefined) return
  if (typeof tag === 'string') { acc.push({ str: tag }); return }
  if (Array.isArray(tag)) { for (const t of tag) flattenComponent(t, acc); return }
  if (typeof tag === 'object') {
    if (typeof tag.translate === 'string') {
      const entry = { translate: tag.translate, args: [] }
      if (Array.isArray(tag.with)) {
        for (const item of tag.with) {
          if (typeof item === 'string') entry.args.push(item)
          else if (item && typeof item === 'object' && item[''] !== undefined && typeof item[''] === 'string' && Object.keys(item).length === 1) entry.args.push(item[''])
          else flattenComponent(item, acc) // 嵌套组件：递归为独立事件
        }
      }
      acc.push(entry)
    } else if (typeof tag.text === 'string') {
      acc.push({ str: tag.text })
    } else if (tag[''] !== undefined && typeof tag[''] === 'string' && Object.keys(tag).length === 1) {
      acc.push({ str: tag[''] })
    } else {
      for (const k of Object.keys(tag)) flattenComponent(tag[k], acc)
    }
  }
}

// ── ModdedNetworkSetupFailedPayload（探测神谕）────────────────────
// 结构：map<RL(通道id), Component(失败原因)>
// 返回：{ [channelId]: { reasons: [...] } }
function decodeSetupFailed (buf) {
  const r = new BufReader(buf)
  const n = r.varint()
  const out = {}
  for (let i = 0; i < n; i++) {
    const id = r.resourceLocation()
    const { value, size } = readNbtAt(r.buf, r.off)
    r.off += size
    const acc = []
    flattenComponent(value, acc)
    out[id] = acc
  }
  return out
}

// ── KnownRegistryDataMapsPayload 解码 ────────────────────────────
// map<registryKey:RL, list<KnownDataMap{id:RL, mandatory:bool}>>
function decodeKnownDataMaps (buf) {
  const r = new BufReader(buf)
  const out = {}
  r.map((r2) => {
    const registry = r2.resourceLocation()
    const maps = r2.collection((r3) => ({ id: r3.resourceLocation(), mandatory: r3.bool() }))
    out[registry] = maps
    return null
  })
  return out
}

// KnownRegistryDataMapsReplyPayload：map<registryKey:RL, collection<RL>>
function encodeDataMapsReply (replyMap) {
  const w = new BufWriter()
  const entries = Object.entries(replyMap)
  w.map(entries, (w2, [registry, ids]) => {
    w2.resourceLocation(registry)
    w2.collection(ids, (w3, id) => w3.resourceLocation(id))
  })
  return w.finish()
}

// FeatureFlagDataPayload：collection<RL>
function decodeFeatureFlags (buf) {
  const r = new BufReader(buf)
  return r.collection((r2) => r2.resourceLocation())
}

// ── 协商失败原因分析（探测循环的大脑）────────────────────────────
// NeoForge 失败翻译键（1.21.1，NetworkComponentNegotiator 源码）：
//   missing.server.client —— 服务器必需通道在客户端清单缺失 → 加入/移到当前桶
//   missing.client.server —— 客户端声明的通道在该桶的服务器侧不存在 → 移到另一桶（两桶都试过错=移除）
//   version.mismatch —— args=[服务器版本, 客户端版本] → 用服务器版本
//   flow.client.missing —— args=[服务器期望flow名] → 补上该 flow
//   flow.client.mismatch —— args=[服务器flow, 客户端flow] → 改用服务器 flow
//   flow.server.missing/mismatch —— 服务器侧没设 flow 而客户端设了 → 清空 flow
//   外层包裹 failure.mod —— args=[模组名, 内层原因]
// 注意：协商按 CONFIGURATION→PLAY 桶序串行，setup_failed 只报第一个失败桶。
// 策略：只要不往 CONFIGURATION 桶塞东西（neoforge 配置通道全 optional 必过），
// 失败桶恒为 PLAY，神谕语义无歧义。
function analyzeFailures (failedByChannel) {
  const advice = {} // channelId -> { action, version?, flow?, ... }
  for (const [channelId, reasons] of Object.entries(failedByChannel)) {
    // reasons 已是压平事件序列（{translate, args} / {str}）
    const flat = reasons.filter(it => it.translate)

    const a = { raw: reasons }
    for (const f of flat) {
      const t = f.translate || ''
      const args = f.args || []
      if (t.endsWith('missing.server.client')) a.action = a.action || 'need-client'
      else if (t.endsWith('missing.client.server')) a.action = 'remove-or-move'
      else if (t.endsWith('version.mismatch')) { a.action = a.action || 'fix-version'; a.version = args[0] }
      else if (t.includes('.flow.') && t.endsWith('.missing')) {
        if (t.includes('flow.client')) { a.action = a.action || 'fix-flow'; a.flow = FLOW[args[0]] }
        else { a.action = a.action || 'clear-flow' } // flow.server.missing：客户端不该设
      } else if (t.includes('.flow.') && t.endsWith('.mismatch')) {
        if (t.includes('flow.client')) { a.action = a.action || 'fix-flow'; a.flow = FLOW[args[0]] }
        else { a.action = a.action || 'clear-flow' }
      } else a.action = a.action || 'unknown'
    }
    advice[channelId] = a
  }
  return advice
}

// ── CommonVersionPayload（c:version）客户端回包：{ versions: [1] } ──
function encodeCommonVersion (versions) {
  const w = new BufWriter()
  w.collection(versions || [1], (w2, v) => w2.varint(v))
  return w.finish()
}

// ── CommonRegisterPayload（c:register）客户端回包：{ version, protocol序数, channels[] } ──
function encodeCommonRegister (version, protocolOrdinal, channels) {
  const w = new BufWriter()
  w.varint(version)
  w.varint(protocolOrdinal)
  w.collection(channels || [], (w2, id) => w2.resourceLocation(id))
  return w.finish()
}

module.exports = {
  CH, PROTOCOL, FLOW,
  encodeNetworkQuery, decodeNetworkQuery,
  decodeNetworkSetup, decodeSetupFailed, analyzeFailures,
  decodeKnownDataMaps, encodeDataMapsReply, decodeFeatureFlags,
  encodeCommonVersion, encodeCommonRegister,
  // 内部工具（测试/调试用）
  _internal: { readNbtAt, flattenComponent }
}
