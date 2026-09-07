// src/neoforge-handshake/probe.js
// NeoForge 21.1 协商探测器（PoC 核心）。
//
// 原理（参照 neoforged/NeoForge@1.21.1 源码，见 research/negotiation/*.java）：
//   1. 服务器进入配置阶段先发空查询 neoforge:register + ping(0)；
//   2. 客户端若在 pong 前以 neoforge:register 回通道清单 → 被判定为 NEOFORGE 连接，
//      走完整协商（initializeNeoForgeConnection）；否则走 initializeOtherConnection，
//      拿服务端全部通道对空列表协商——任何「必需通道」都会踢人（原版客户端死因）；
//   3. 协商失败时服务器下发 neoforge:modded_network_setup_failed（通道→原因 Component 表），
//      原因里带期望版本/流向——这是内建的探测神谕：迭代连接即可自动学出完整通道清单。
//   4. 桶序数实证（2026-08-25）：ConnectionProtocol 枚举序 = HANDSHAKING(0) PLAY(1) STATUS(2)
//      LOGIN(3) CONFIGURATION(4)；PacketFlow 序 = SERVERBOUND(0) CLIENTBOUND(1)。
//      协商按 CONFIGURATION→PLAY 桶序串行，神谕只报第一个失败桶。
//   5. 协商通过后还要陪服务器走完配置任务：注册表同步收尾确认（frozen_registry_sync_completed）、
//      c:version 回 [1]、c:register 回 {1,PLAY,[]}、枚举/特性标志/数据映射应答——之后才是 join game。
//
// 用法：node src/neoforge-handshake/probe.js <host> <port> [username]
'use strict'

const mc = require('minecraft-protocol')
const P = require('./payloads.cjs')
const { PROTOCOL } = require('./buf.cjs')

const MAX_ROUNDS = 12

// ── 单次连接尝试 ─────────────────────────────────────────────────
// channelList: { 3: [comp...], 4: [comp...] }（comp = {id, version, flow?, optional?}）
// 返回 { outcome: 'login'|'setup_failed'|'disconnected'|'error', setup?, failures?, reason?, playLogin? }
function attempt (opts, channelList) {
  return new Promise((resolve) => {
    let done = false
    let negotiated = false
    let setup = null
    const finish = (result) => {
      if (done) return
      done = true
      try { client.end() } catch (e) {}
      setTimeout(() => resolve(result), 50)
    }

    const client = mc.createClient({
      host: opts.host,
      port: opts.port,
      username: opts.username || 'NeoProbe',
      version: opts.version || '1.21.1',
      auth: 'offline'
    })
    client.on('error', (e) => finish({ outcome: 'error', reason: e.message }))
    client.on('end', (r) => { if (!done) resolve({ outcome: 'disconnected', reason: 'end:' + r, setup, negotiated }) })

    // 注意：minecraft-protocol 的 createClient 自动加载 client/play.js——
    // 它已处理 login_acknowledged / settings / select_known_packs / finish_configuration。
    // 这里绝不重复写，只补 NeoForge 特有的应答。
    client.on('disconnect', (packet) => {
      let reason = ''
      try { reason = typeof packet.reason === 'string' ? packet.reason : JSON.stringify(packet.reason) } catch (e) {}
      finish({ outcome: 'disconnected', reason, setup, negotiated })
    })

    // 配置阶段：服务器 ping → 必须回 pong（原版行为；mineflayer 的 game.js 会替 bot 做，裸客户端要自己做）
    client.on('ping', (packet) => {
      if (client.state === mc.states.CONFIGURATION) client.write('pong', { id: packet.id })
    })
    client.on('keep_alive', (packet) => {
      // CONFIGURATION/PLAY 的 keep_alive 字段名是 keepAliveId（i64），不是 id
      client.write('keep_alive', { keepAliveId: packet.keepAliveId ?? packet.id })
    })

    client.on('custom_payload', (packet) => {
      if (client.state !== mc.states.CONFIGURATION) return // play 阶段的模组 payload：无视
      const { channel, data } = packet
      switch (channel) {
        case P.CH.REGISTER_QUERY: {
          // 服务器的空查询 → 回我们的通道清单（必须在 pong 之前，同包序即保证）
          const buf = P.encodeNetworkQuery(channelList || {})
          client.write('custom_payload', { channel: P.CH.REGISTER_QUERY, data: buf })
          break
        }
        case P.CH.SETUP_FAILED: {
          let failures = {}
          try { failures = P.decodeSetupFailed(data) } catch (e) { failures = { __decode_error: [{ text: e.message }] } }
          finish({ outcome: 'setup_failed', failures })
          break
        }
        case P.CH.NETWORK: {
          try { setup = P.decodeNetworkSetup(data) } catch (e) {}
          negotiated = true
          break // 继续等配置任务
        }
        case P.CH.ENUM_DATA: {
          client.write('custom_payload', { channel: P.CH.ENUM_ACK, data: Buffer.alloc(0) })
          break
        }
        case P.CH.FEATURE_FLAGS: {
          client.write('custom_payload', { channel: P.CH.FEATURE_FLAGS_ACK, data: Buffer.alloc(0) })
          break
        }
        case P.CH.FROZEN_SYNC_COMPLETED: {
          // 注册表同步收尾：客户端回空体确认（configurationBidirectional 注册）
          client.write('custom_payload', { channel: P.CH.FROZEN_SYNC_COMPLETED, data: Buffer.alloc(0) })
          break
        }
        case P.CH.VERSION: {
          // CommonVersionTask：回 versions=[1]（NeoForge 目前只支持 1）
          client.write('custom_payload', { channel: P.CH.VERSION, data: P.encodeCommonVersion([1]) })
          break
        }
        case P.CH.COMMON_REGISTER: {
          // CommonRegisterTask：回 {version:1, protocol:PLAY, channels:[]}（我们不认领任何 clientbound 可选通道）
          client.write('custom_payload', { channel: P.CH.COMMON_REGISTER, data: P.encodeCommonRegister(1, PROTOCOL.PLAY, []) })
          break
        }
        case P.CH.KNOWN_DATA_MAPS: {
          // 只认领服务器标注 mandatory 的数据映射，其余不要求同步（省流量；服务器也不会踢）
          let reply = {}
          try {
            const maps = P.decodeKnownDataMaps(data)
            for (const [registry, list] of Object.entries(maps)) {
              const mandatory = list.filter(m => m.mandatory).map(m => m.id)
              if (mandatory.length) reply[registry] = mandatory
            }
          } catch (e) {}
          client.write('custom_payload', { channel: P.CH.KNOWN_DATA_MAPS_REPLY, data: P.encodeDataMapsReply(reply) })
          break
        }
        default:
          break // minecraft:register / brand / unregister 等：无视
      }
    })

    // play 阶段 join game = 全链路成功（finish_configuration 由 play.js 自动处理）
    client.once('login', (packet) => {
      finish({
        outcome: 'login',
        setup,
        playLogin: {
          entityId: packet.entityId,
          dimension: packet.dimension,
          gamemode: packet.gameMode
        }
      })
    })

    setTimeout(() => finish({ outcome: 'error', reason: 'timeout 30s', setup, negotiated }), 30000)
  })
}

// ── NeoForge 21.1 核心通道基线（NetworkInitialization 逆向 + jar 常量池核对，2026-08-25）──
// 全 optional（registrar("1").optional()），版本恒 "1"。
// 必须随查询应答一并声明——否则协商后这些通道被剥出 setup，服务器配置任务
// （CheckExtensibleEnums 等）发 payload 时 checkPacket 直接抛异常，任务链崩→超时断开。
// flow 序：0=SERVERBOUND 1=CLIENTBOUND；双向注册的通道不带 flow。
const NEOFORGE_CORE = {
  [PROTOCOL.CONFIGURATION]: [
    { id: 'neoforge:config_file', flow: 1 },
    { id: 'neoforge:frozen_registry_sync_start', flow: 1 },
    { id: 'neoforge:frozen_registry', flow: 1 },
    { id: 'neoforge:frozen_registry_sync_completed' }, // 双向
    { id: 'neoforge:known_registry_data_maps', flow: 1 },
    { id: 'neoforge:extensible_enum_data', flow: 1 },
    { id: 'neoforge:feature_flags', flow: 1 },
    { id: 'neoforge:known_registry_data_maps_reply', flow: 0 },
    { id: 'neoforge:extensible_enum_ack', flow: 0 },
    { id: 'neoforge:feature_flags_ack', flow: 0 }
  ],
  [PROTOCOL.PLAY]: [
    { id: 'neoforge:advanced_add_entity', flow: 1 },
    { id: 'neoforge:advanced_open_screen', flow: 1 },
    { id: 'neoforge:auxiliary_light_data', flow: 1 },
    { id: 'neoforge:registry_data_map_sync', flow: 1 },
    { id: 'neoforge:advanced_container_set_data', flow: 1 },
    { id: 'neoforge:custom_time_packet', flow: 1 },
    { id: 'neoforge:sync_attachments', flow: 1 } // 2026-08-25 神谕修正：服务器按 CLIENTBOUND 注册
  ]
}

function seedKnowledge () {
  const knowledge = new Map()
  for (const [bucket, chans] of Object.entries(NEOFORGE_CORE)) {
    for (const c of chans) {
      knowledge.set(c.id, {
        bucket: Number(bucket), version: '1',
        flow: c.flow !== undefined ? c.flow : null,
        moves: 0, optional: true, core: true
      })
    }
  }
  return knowledge
}

// ── 知识模型与探测循环 ───────────────────────────────────────────
// knowledge: Map<channelId, { bucket, version, flow(null|0|1), moves, optional }>
// 策略（2026-08-25 冒烟实证后重建）：
//  - 桶序数：PLAY=1、CONFIGURATION=4（原版 ConnectionProtocol 枚举声明顺序，不是握手流程顺序）。
//  - NeoForge 核心通道（optional）为静态基线；mod 必需通道由神谕学习，默认进 PLAY 桶。
//  - 协商按 CONFIGURATION→PLAY 桶序串行，神谕只报第一个失败桶。
function buildChannelList (knowledge) {
  const list = {}
  for (const [id, k] of knowledge) {
    if (!list[k.bucket]) list[k.bucket] = []
    const comp = { id, version: k.version, optional: !!k.optional }
    if (k.flow !== null && k.flow !== undefined) comp.flow = k.flow
    list[k.bucket].push(comp)
  }
  return list
}

function applyAdvice (knowledge, advice, log) {
  for (const [id, a] of Object.entries(advice)) {
    const k = knowledge.get(id)
    const bucketName = (b) => (b === PROTOCOL.PLAY ? 'PLAY' : 'CONFIGURATION')
    switch (a.action) {
      case 'need-client': {
        if (!k) {
          knowledge.set(id, { bucket: PROTOCOL.PLAY, version: '1', flow: null, moves: 0 })
          log(`  + 新必需通道 ${id} → PLAY 桶，版本猜 "1"`)
        } else if (k.core) {
          log(`  ! ${id}：核心通道被报缺失，基线有误，请人工核对`)
        } else if (k.moves >= 3) {
          log(`  ! ${id}：搬桶 ${k.moves} 次仍不被认领，放弃（疑似注册在非常规桶）`)
        } else {
          k.bucket = k.bucket === PROTOCOL.PLAY ? PROTOCOL.CONFIGURATION : PROTOCOL.PLAY
          k.moves++
          log(`  ~ ${id}：当前桶不可见 → 搬 ${bucketName(k.bucket)} 桶（第 ${k.moves} 次）`)
        }
        break
      }
      case 'remove-or-move': {
        if (!k) break
        if (k.moves >= 2) { knowledge.delete(id); log(`  - ${id}：两桶都不认，移除`) }
        else {
          k.bucket = k.bucket === PROTOCOL.PLAY ? PROTOCOL.CONFIGURATION : PROTOCOL.PLAY
          k.moves++
          log(`  ~ ${id}：此桶服务器侧无此通道 → 搬 ${bucketName(k.bucket)} 桶（第 ${k.moves} 次）`)
        }
        break
      }
      case 'fix-version':
        if (k) { k.version = a.version; log(`  ~ ${id}：版本修正为 "${a.version}"`) }
        break
      case 'fix-flow':
        if (k) { k.flow = a.flow; log(`  ~ ${id}：流向修正为 ${a.flow === 0 ? 'SERVERBOUND' : 'CLIENTBOUND'}`) }
        break
      case 'clear-flow':
        if (k) { k.flow = null; log(`  ~ ${id}：服务器未设流向，清空`) }
        break
      default:
        log(`  ? ${id}：未知失败类型 ${JSON.stringify(a.raw).slice(0, 200)}`)
    }
  }
}

async function negotiateAndJoin (opts) {
  const log = opts.log || (() => {})
  const knowledge = opts.knowledge || seedKnowledge() // 可携缓存知识入场；缺省=核心基线
  const trace = []
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const channelList = buildChannelList(knowledge)
    log(`[round ${round}] 通道清单：${Object.keys(channelList).map(p => p + ':' + channelList[p].length).join(', ')} 条`)
    const result = await attempt(opts, channelList)
    trace.push({ round, outcome: result.outcome, reason: result.reason })
    if (result.outcome === 'login') {
      log(`[round ${round}] ✅ 协商通过 + 进入 play（entityId=${result.playLogin?.entityId}, dimension=${result.playLogin?.dimension}）`)
      return { success: true, rounds: round, setup: result.setup, trace, knowledge: Object.fromEntries(knowledge) }
    }
    if (result.outcome === 'setup_failed') {
      const advice = P.analyzeFailures(result.failures)
      log(`[round ${round}] 协商失败，神谕 ${Object.keys(advice).length} 条：`)
      applyAdvice(knowledge, advice, log)
      continue
    }
    log(`[round ${round}] ❌ ${result.outcome}: ${result.reason}`)
    return { success: false, outcome: result.outcome, reason: result.reason, rounds: round, trace }
  }
  return { success: false, outcome: 'max-rounds', rounds: MAX_ROUNDS, trace }
}

module.exports = { attempt, negotiateAndJoin, buildChannelList, applyAdvice, seedKnowledge, NEOFORGE_CORE }

if (require.main === module) {
  const [host, port, username] = process.argv.slice(2)
  if (!host || !port) {
    console.log('用法：node probe.js <host> <port> [username]')
    process.exit(1)
  }
  negotiateAndJoin({
    host,
    port: Number(port),
    username: username || 'NeoProbe',
    log: (s) => console.log(s)
  }).then((r) => {
    console.log('\n==== 结果 ====')
    console.log(JSON.stringify(r, (k, v) => (k === 'setup' && v ? Object.fromEntries(Object.entries(v).map(([p, ch]) => [p, Object.keys(ch)])) : v), 2))
    process.exit(r.success ? 0 : 1)
  }).catch((e) => { console.error(e); process.exit(2) })
}
