// src/neoforge-handshake/gate.cjs
// 「神社之门」—— NeoForge 握手边车（handshake sidecar）。
//
// 形态：前门说原版协议（mineflayer/天神之眼直连，零改动），后门以 A 路协商层
//       对接 NeoForge 21.1 内容服。CONFIG 阶段拦截 neoforge:*/c:* 通道自答，
//       原版配置任务（注册表同步/已知包/枚举/特性标志等）透传给真客户端，
//       进 PLAY 后全双向透传。
//
// 原理见 probe.cjs 头注（协商机制/桶序数/神谕学习）。本文件只做「持久会话化」：
//   - probe.cjs 是一次性探测（每次 attempt 新开连接、学完即关）；
//   - gate.cjs 把学到的通道清单缓存下来，每个进来的原版客户端配一条后端连接，
//     清单失配时当场走神谕学习（客户端在 CONFIG 里等，通常秒级）。
//
// 用法：node src/neoforge-handshake/gate.cjs [listenPort=25700] [backendHost=127.0.0.1] [backendPort=25799]
// 依赖：仅 minecraft-protocol（与 probe.cjs 同）；mineflayer 侧无需任何改动。
//
// 踩坑纪要（皆已在此代码中固化）：
//   1. 前端状态机必须显式换档：set_protocol 后 front.state=LOGIN/STATUS，
//      否则解包器停在 HANDSHAKE，把 login_start 当握手包硬解。
//   2. 勿用 client.deserializer.on('data')：mcp 的 state setter 会
//      deserializer.removeAllListeners()，换态即成孤儿。用 client 级 'packet' 事件。
//   3. 前端→后端包要排队：后端 socket 未 connect 时 back.write 的字节会排在
//      握手表节之前，服务器见乱序包直接掐线（socketClosed）。等后端进 CONFIG 再放。
//   4. 中继按「包名+字段」重序列化（write），不用 writeRaw 透裸字节——
//      裸字节在压缩/成帧边界极易错位。
'use strict'

const fs = require('fs')
const path = require('path')
const mc = require('minecraft-protocol')
const mcData = require('minecraft-data')('1.21.1')
const states = mc.states
const P = require('./payloads.cjs')
const probe = require('./probe.cjs')

const VERSION = '1.21.1'
const PROTO_VERSION = mcData.version.version // 767
const MAX_LEARN_ROUNDS = 12
const OFFLINE_UUID = require('minecraft-protocol/src/datatypes/uuid')

const [listenPort = '25700', backendHost = '127.0.0.1', backendPort = '25799'] = process.argv.slice(2)
const BACKEND = { host: backendHost, port: Number(backendPort) }

// 【2026-08-29 update_time 断流定谳】后端默认走 vanilla 姿势(GATE_VANILLA=0 切回 forge 协商):
//   forge 协商路径(答 neoforge:register 通道清单)下,NeoForge 21.1 的 forge 网络层
//   不给连接发 update_time(30s 28665 包 0 时间包,探针实证);而 vanilla 姿势
//   (CONFIG 期发 minecraft:brand)走兼容路径,update_time 每秒 1 个正常到账。
//   后果:经门 bot(小芋/Goddess)bot.time 恒 null→判永夜→原地 rest。
//   当前 mod 组合对 vanilla 客户端友好(实测不踢);若日后有 mod 声明必需网络通道,
//   设 GATE_VANILLA=0 切回 forge 协商并另修时间包。
const VANILLA_BACKEND = process.env.GATE_VANILLA !== '0'

const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`)

// ── 通道知识（共享）与缓存 ────────────────────────────────────────
const cacheFile = path.join(__dirname, 'knowledge-cache.json')

// Better Combat 2.3.2 通道（2026-08-29 定谳，javap 反编译挖出）：
//   CONFIGURATION 桶(4)：config_sync/weapon_registry（服务端→客户端，配置任务负载）
//                        ack（客户端→服务端，code 字符串，服务端据此 finishCurrentTask）
//   PLAY 桶(1)：attack_animation/attack_sound（服务端→客户端）、block_hit（客户端→服务端）
// 知识里宣告（协商可见），CONFIG 任务负载在 gate 自答吞掉（vanilla 客户端无需看见）。
const BETTERCOMBAT_CHANNELS = [
  { id: 'bettercombat:config_sync', bucket: 4 },
  { id: 'bettercombat:weapon_registry', bucket: 4 },
  { id: 'bettercombat:ack', bucket: 4 },
  { id: 'bettercombat:attack_animation', bucket: 1 },
  { id: 'bettercombat:attack_sound', bucket: 1 },
  { id: 'bettercombat:block_hit', bucket: 1 }
]

// MC 协议字符串（FriendlyByteBuf.writeUtf）：varint 字节长 + UTF-8
function encodeMCString (s) {
  const body = Buffer.from(s, 'utf8')
  const len = body.length
  const varint = []
  let v = len
  do {
    let b = v & 0x7F
    v >>>= 7
    if (v !== 0) b |= 0x80
    varint.push(b)
  } while (v !== 0)
  return Buffer.concat([Buffer.from(varint), body])
}

function loadKnowledge () {
  const knowledge = probe.seedKnowledge()
  for (const c of BETTERCOMBAT_CHANNELS) {
    knowledge.set(c.id, { bucket: c.bucket, version: '1', flow: null, moves: 0, optional: true, core: true })
  }
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    const backendKey = `${BACKEND.host}:${BACKEND.port}`
    const entries = cached.backends?.[backendKey]
    if (entries) {
      for (const [id, k] of Object.entries(entries)) knowledge.set(id, k)
      log(`已从缓存载入通道知识（${backendKey}，${Object.keys(entries).length} 条）`)
    }
  } catch (e) { /* 无缓存：纯基线起步 */ }
  return knowledge
}

function saveKnowledge () {
  try {
    let cached = {}
    try { cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) } catch (e) {}
    cached.backends = cached.backends || {}
    cached.backends[`${BACKEND.host}:${BACKEND.port}`] = Object.fromEntries(knowledge)
    cached.savedAt = new Date().toISOString()
    fs.writeFileSync(cacheFile, JSON.stringify(cached, null, 2))
  } catch (e) { log(`知识缓存写入失败：${e.message}`) }
}

const knowledge = loadKnowledge()

// ── 神社之门（前端：裸 Server，自驱握手/CONFIG）──────────────────
const server = new mc.Server(VERSION)
server.listen(Number(listenPort), '0.0.0.0')
server.on('listening', () => log(`神社之门开启：0.0.0.0:${listenPort} -> ${BACKEND.host}:${BACKEND.port}（${VERSION}，offline）`))
server.on('error', (e) => log(`门扉出错：${e.message}`))
server.on('connection', (front) => handleConnection(front))

function handleConnection (front) {
  log('DEBUG：前端 TCP 接入')
  front.once('set_protocol', (p) => {
    log(`DEBUG：set_protocol proto=${p.protocolVersion} next=${p.nextState} host=${p.serverHost}`)
    if (p.nextState === 1) { front.state = states.STATUS; return handleStatus(front) } // 状态机换档
    if (p.nextState !== 2) return front.end()
    if (p.protocolVersion !== PROTO_VERSION) {
      front.end(`协议版本不符：门只通 ${VERSION}（${PROTO_VERSION}），你是 ${p.protocolVersion}`)
      return
    }
    front.state = states.LOGIN // 漏了这步，解包器会停在 HANDSHAKE 态
    handleLogin(front)
  })
  front.on('error', (e) => log(`DEBUG：前端错误（登录前）：${(e && e.message || e).toString().slice(0, 300)}`))
}

// 服务器列表查询（客户端/启动器敲门用）
function handleStatus (front) {
  front.once('ping_start', () => {
    front.write('server_info', {
      response: JSON.stringify({
        version: { name: VERSION, protocol: PROTO_VERSION },
        players: { max: 20, online: sessionCount(), sample: [] },
        description: { text: '神社之门 · NeoForge 神使边车' }
      })
    })
    front.once('ping', (p) => { front.write('ping', { time: p.time }); front.end() })
  })
}

// 登录（offline：离线 UUID；压缩阈值 256，与常规服一致）
function handleLogin (front) {
  front.once('login_start', (p) => {
    try {
      const username = p.username
      front.username = username
      front.uuid = OFFLINE_UUID.nameToMcOfflineUUID(username)
      log(`DEBUG：login_start ${username} -> compress+success`)
      front.write('compress', { threshold: 256 })
      front.compressionThreshold = 256
      front.write('success', { uuid: front.uuid, username, properties: [] })
      front.once('login_acknowledged', () => {
        log(`DEBUG：${username} login_acknowledged -> CONFIG`)
        front.state = states.CONFIGURATION
        log(`穿越者 ${username} 叩门 -> 开后端会话`)
        startSession(front, username)
      })
    } catch (e) {
      log(`DEBUG：login_start 处理异常：${e.stack}`)
    }
  })
}

// ── 会话：一条前端连接 <-> 一条后端连接 ──────────────────────────
const sessions = new Set()
const sessionCount = () => sessions.size

function startSession (front, username) {
  const sess = { front, username, phase: 'config', retry: 0, closed: false, reconnecting: false, backReady: false, frontQueue: [], playQueue: [] }
  sessions.add(sess)

  // client 级 'packet' 事件：(params, metadata, buffer, fullBuffer)，不随换态被清
  front.on('packet', (params, metadata) => onFrontPacket(sess, metadata.name, params))
  front.on('error', (e) => {
    const msg = (e && e.message || e).toString()
    log(`DEBUG：前端错误（最后写入=${sess.lastFrontWrite || '?'}）：${msg.slice(0, 300)}`)
    // 序列化流崩了（如 value.copy）= 管道已死，别留僵尸会话
    if (/Serialization|Write error/i.test(msg)) closeSession(sess, '前端序列化流崩：' + msg.slice(0, 80))
  })
  front.on('end', () => closeSession(sess, '前端离开'))

  connectBackend(sess)
}

function closeSession (sess, reason) {
  if (sess.closed) return
  sess.closed = true
  sessions.delete(sess)
  // 【时间包普查】会话收摊:打出 back/front/err 三本账里时间相关与总量
  try {
    const fmt = (c) => c ? Object.entries(c).sort((a, b) => b[1] - a[1]) : []
    const b = fmt(sess.backCensus); const f = fmt(sess.frontCensus); const e = fmt(sess.frontErrCensus)
    const pick = (arr) => arr.filter(([k]) => /time/i.test(k)).map(([k, v]) => k + '=' + v).join(',') || 'NONE'
    log(`census[${sess.username}] back_total=${b.reduce((s, [, v]) => s + v, 0)} time(${pick(b)}) | front_total=${f.reduce((s, [, v]) => s + v, 0)} time(${pick(f)}) | err=${e.length ? e.map(([k, v]) => k + '=' + v).join(',') : 'none'}`)
    const top = b.slice(0, 8).map(([k, v]) => k + '=' + v).join(' ')
    if (top) log(`census[${sess.username}] back top: ${top}`)
    // 【chunk 断流诊断 2026-08-29】chunk 计数随摘要打出（queue=排队期 play=开闸后）
    log(`census[${sess.username}] chunk: queue=${sess.queueChunkCount || 0} play=${sess.playChunkCount || 0}`)
  } catch (err) {}
  try { sess.back?.end() } catch (e) {}
  try { if (!sess.front.ended) sess.front.end(reason) } catch (e) {}
  log(`会话 ${sess.username} 关闭：${reason}`)
}

function kickFront (sess, reason) {
  try {
    if (sess.front.state === states.PLAY) {
      sess.front.write('kick_disconnect', { reason: JSON.stringify({ text: reason }) })
    } else {
      sess.front.write('disconnect', { reason: JSON.stringify({ text: reason }) })
    }
  } catch (e) {}
  setTimeout(() => closeSession(sess, reason), 100)
}

// ── 后端连接（A 路协商，知识缓存失配时当场神谕学习）──────────────
// 后端连接（A 路协商，知识缓存失配时当场神谕学习）
// keepAlive:false 是命门——mcp 的自动应答会与真客户端经门透传的应答叠加，
// 服务端收到两条同 id 应答即断线（表现为 join+15s「Timed out」循环）。
// 应答权必须完全让给真客户端，门只做搬运。
function connectBackend (sess) {
  const back = mc.createClient({
    host: BACKEND.host,
    port: BACKEND.port,
    username: sess.username,
    version: VERSION,
    auth: 'offline',
    hideErrors: true,
    keepAlive: false
  })
  sess.back = back
  sess.backReady = false
  back.on('connect', () => log(`DEBUG：[${sess.username}] 后端 socket 已连`))
  back.on('success', (p) => log(`DEBUG：[${sess.username}] 后端 LOGIN_SUCCESS ${p.username}`))
  // 后端进入 CONFIG（握手+login_ack 已发出）后才可接收前端转来的配置包
  back.on('state', (n) => {
    log(`DEBUG：[${sess.username}] 后端 state -> ${n}`)
    if (n === states.CONFIGURATION && !sess.backReady) {
      // vanilla 姿姿：立刻自报 brand,NeoForge 判 vanilla 走兼容路径(update_time 才会发)
      if (VANILLA_BACKEND) {
        try {
          const brand = Buffer.from('vanilla', 'utf8')
          const buf = Buffer.concat([Buffer.from([brand.length]), brand])
          back.write('custom_payload', { channel: 'minecraft:brand', data: buf })
          log(`DEBUG：[${sess.username}] 后端自报 vanilla brand（update_time 通道保命）`)
        } catch (e) { log(`brand 自报失败：${e.message}`) }
      }
      sess.backReady = true
      const q = sess.frontQueue.splice(0)
      log(`DEBUG：[${sess.username}] 后端就绪，放出排队包 ${q.length} 个`)
      for (const pkt of q) relayTo(sess, back, pkt.name, pkt.params, '前端->后端（补发）')
    }
  })
  // NeoForge 的模组命令会让 mcp 解析 declare_commands 抛 PartialReadError——
  // 那只是单包解析失败（帧对齐不受影响），PLAY 期容忍跳过；仅 CONFIG 期视为致命。
  back.on('error', (e) => {
    if (sess.phase === 'config') { if (!sess.reconnecting) closeSession(sess, '后端错误：' + e.message) }
    else log(`（容忍）后端包解析错误：${e.message.slice(0, 120)}`)
  })
  back.on('end', (r) => { if (!sess.reconnecting && !sess.closed) closeSession(sess, '后端断开：' + r) })
  back.on('disconnect', (p) => {
    let reason = ''
    try { reason = typeof p.reason === 'string' ? p.reason : JSON.stringify(p.reason) } catch (e) {}
    if (!sess.reconnecting) kickFront(sess, 'NeoForge 拒收：' + reason.slice(0, 300))
  })
  back.on('packet', (params, metadata) => onBackPacket(sess, metadata.name, params))
}

// 后端 -> 前端（CONFIG：新约拦截自答、原约透传；play_pending：PLAY 包排队等真客户端收尾；PLAY：全透传）
function onBackPacket (sess, name, params) {
  if (sess.closed) return
  const back = sess.back

  // 后端自己 LOGIN 阶段的包（compress/success 等）是发给门自己的，不透传
  if (back.state === states.LOGIN || back.state === states.HANDSHAKING) return

  if (sess.phase === 'play_pending') {
    // 收尾令已发、真客户端的 ack 还在路上：此间后端 PLAY 包（通道注册、
    // 甚至 join game——NeoForge 注册包先于 join game）先入闸排队，
    // 待 ack 到达、前端真切了 PLAY 再放出，保证前端按 PLAY 的包 id 解。
    if (name === 'login') { sess.joinedEntityId = params.entityId; saveKnowledge() }
    // 【chunk 断流诊断 2026-08-29】排队期 chunk 专项计数（census 只统计开闸后）
    if (/chunk/.test(name)) { sess.queueChunkCount = (sess.queueChunkCount || 0) + 1; if (sess.queueChunkCount <= 3) log(`DEBUG：[chunk-诊断] ${sess.username} playQueue 期 ${name}（累计 ${sess.queueChunkCount}）`) }
    if (name === 'kick_disconnect') { setTimeout(() => closeSession(sess, '后端踢人（PLAY）'), 200) }
    sess.playQueue.push({ name, params })
    return
  }

  if (sess.phase === 'play') {
    if (name === 'kick_disconnect') { setTimeout(() => closeSession(sess, '后端踢人（PLAY）'), 200) }
    // 【chunk 断流诊断 2026-08-29】PLAY 期 chunk 专项计数（不受 census top 名次遮蔽）
    if (/chunk/.test(name)) { sess.playChunkCount = (sess.playChunkCount || 0) + 1; if (sess.playChunkCount <= 3) log(`DEBUG：[chunk-诊断] ${sess.username} PLAY 期 ${name}（累计 ${sess.playChunkCount}）`) }
    // 【时间包普查】后端 PLAY 包名计数,会话关时打摘要——update_time 断流类问题的常驻探针
    sess.backCensus = sess.backCensus || {}
    sess.backCensus[name] = (sess.backCensus[name] || 0) + 1
    relayTo(sess, sess.front, name, params, '后端->前端')
    return
  }

  // phase === 'config'
  switch (name) {
    case 'custom_payload': {
      const { channel, data } = params
      if (handleNeoForgePayload(sess, channel, data)) return // 已自答/有意吞掉
      log(`DEBUG：CONFIG 透传通道 ${channel}`)
      relayTo(sess, sess.front, name, params, '后端->前端')
      return
    }
    case 'ping': back.write('pong', { id: params.id }); return
    case 'keep_alive': back.write('keep_alive', { keepAliveId: params.keepAliveId ?? params.id }); return
    case 'disconnect': {
      let reason = ''
      try { reason = typeof params.reason === 'string' ? params.reason : JSON.stringify(params.reason) } catch (e) {}
      kickFront(sess, 'NeoForge 断开：' + reason.slice(0, 300))
      return
    }
    case 'finish_configuration':
      // 后端 play.js 已自动回 ack；收尾令透传给真客户端，等它的 ack 再开闸
      sess.phase = 'play_pending'
      relayTo(sess, sess.front, name, params, '后端->前端')
      // 保险：ack 久候不至则强行开闸（真客户端异常时宁可错位也别卡死）
      sess.ackTimer = setTimeout(() => { if (sess.phase === 'play_pending') flushPlayQueue(sess, 'ack 超时强开') }, 3000)
      return
    default:
      // registry_data / select_known_packs 查询 / feature_flags / 其余原版任务 -> 透传
      relayTo(sess, sess.front, name, params, '后端->前端')
  }
}

// 开闸：前端真切了 PLAY，把排队的 PLAY 包按序放出
function flushPlayQueue (sess, why) {
  if (sess.phase !== 'play_pending') return
  clearTimeout(sess.ackTimer)
  sess.front.state = states.PLAY
  sess.phase = 'play'
  const q = sess.playQueue.splice(0)
  log(`DEBUG：[${sess.username}] 开闸（${why}），放出 PLAY 排队包 ${q.length} 个`)
  for (const pkt of q) relayTo(sess, sess.front, pkt.name, pkt.params, '后端->前端')
  if (sess.joinedEntityId != null) log(`${sess.username} 经门而入（entityId=${sess.joinedEntityId}）`)
}

// 前端 -> 后端（CONFIG：只透传 vanilla 配置应答；PLAY：全透传）
function onFrontPacket (sess, name, params) {
  if (sess.closed) return
  const back = sess.back
  if (!back || back.ended) return
  if (!sess.backReady) { // 后端未就绪：入队，待其进 CONFIG 后按序放出
    sess.frontQueue.push({ name, params })
    return
  }

  if (sess.phase === 'config') {
    switch (name) {
      case 'finish_configuration':
        // CONFIG 期前端不该发收尾令（它还没收到收尾令）；忽略
        return
      case 'pong': // 后端 ping 由门自答，真客户端的 pong 不透传（防重复/错位）
      case 'keep_alive': // CONFIG 期后端 keep_alive 由门自答
      case 'select_known_packs': // 后端 play.js 已自动回 []，重复应答恐乱任务机
        return
      default:
        relayTo(sess, back, name, params, '前端->后端')
        return
    }
  }

  if (sess.phase === 'play_pending') {
    if (name === 'finish_configuration') { // 真客户端的收尾 ack——开闸！
      flushPlayQueue(sess, '前端收尾确认')
      return
    }
    // 此间前端若抢跑发来 PLAY 包（极少），后端已在 PLAY，照转
    relayTo(sess, back, name, params, '前端->后端')
    return
  }

  // PLAY：全透传
  relayTo(sess, back, name, params, '前端->后端')
}

// 安全重序列化转发：失败只记日志，不炸会话
function relayTo (sess, target, name, params, dir) {
  if (name === 'custom_payload') params = normalizeCustomPayload(params)
  if (target === sess.front) {
    sess.lastFrontWrite = name
    // 【时间包普查】前端方向也计数(与 backCensus 对照找丢包层)
    sess.frontCensus = sess.frontCensus || {}
    sess.frontCensus[name] = (sess.frontCensus[name] || 0) + 1
  }
  try { target.write(name, params) } catch (e) {
    sess.frontErrCensus = sess.frontErrCensus || {}
    sess.frontErrCensus[name] = (sess.frontErrCensus[name] || 0) + 1
    log(`（容忍）${dir} ${name} 重序列化失败：${(e && e.message || e).toString().slice(0, 160)}`)
  }
}

// mcp 的 pluginChannels（createClient 自动装载）会把 minecraft:register/unregister
// 的载荷就地解析成字符串数组——序列化器只认 Buffer，不还原就 value.copy 崩流。
function normalizeCustomPayload (params) {
  let data = params.data
  if (Array.isArray(data)) { // registerarr：逐个 NUL 结尾的通道名
    data = Buffer.concat(data.map(s => Buffer.concat([Buffer.from(String(s), 'utf8'), Buffer.from([0])])))
  } else if (!Buffer.isBuffer(data)) {
    data = Buffer.from(data ?? [])
  }
  return { channel: params.channel, data }
}

// ── NeoForge 新约拦截（与 probe.cjs 同逻辑，会话持久化版）────────
// 返回 true = 已处置（自答或有意吞掉），不透传；false = 非新约通道，照常透传。
function handleNeoForgePayload (sess, channel, data) {
  const back = sess.back
  // vanilla 姿势:mod 通道任务负载一律吞掉不答——服务端已凭 brand 判 vanilla,
  // 不再等这些应答;原版通道(minecraft:brand/register 等)照常透传保真
  if (VANILLA_BACKEND) return !channel.startsWith('minecraft:')
  switch (channel) {
    case P.CH.REGISTER_QUERY:
      back.write('custom_payload', { channel: P.CH.REGISTER_QUERY, data: P.encodeNetworkQuery(probe.buildChannelList(knowledge)) })
      return true
    case P.CH.SETUP_FAILED: {
      let failures = {}
      try { failures = P.decodeSetupFailed(data) } catch (e) { failures = {} }
      return onSetupFailed(sess, failures)
    }
    case P.CH.NETWORK:
      try { P.decodeNetworkSetup(data) } catch (e) {} // 解码仅为验证；协商已过
      return true
    case P.CH.ENUM_DATA:
      back.write('custom_payload', { channel: P.CH.ENUM_ACK, data: Buffer.alloc(0) })
      return true
    case P.CH.FEATURE_FLAGS:
      back.write('custom_payload', { channel: P.CH.FEATURE_FLAGS_ACK, data: Buffer.alloc(0) })
      return true
    case P.CH.FROZEN_SYNC_COMPLETED:
      back.write('custom_payload', { channel: P.CH.FROZEN_SYNC_COMPLETED, data: Buffer.alloc(0) })
      return true
    case P.CH.VERSION:
      back.write('custom_payload', { channel: P.CH.VERSION, data: P.encodeCommonVersion([1]) })
      return true
    case P.CH.COMMON_REGISTER:
      back.write('custom_payload', { channel: P.CH.COMMON_REGISTER, data: P.encodeCommonRegister(1, P.PROTOCOL.PLAY, []) })
      return true
    case P.CH.KNOWN_DATA_MAPS: {
      let reply = {}
      try {
        const maps = P.decodeKnownDataMaps(data)
        for (const [registry, list] of Object.entries(maps)) {
          const mandatory = list.filter(m => m.mandatory).map(m => m.id)
          if (mandatory.length) reply[registry] = mandatory
        }
      } catch (e) {}
      back.write('custom_payload', { channel: P.CH.KNOWN_DATA_MAPS_REPLY, data: P.encodeDataMapsReply(reply) })
      return true
    }
    // Better Combat 配置任务（2026-08-29）：BC 的两个 configuration task 发负载后
    // 靠客户端回 Ack(code) 才 finishCurrentTask——vanilla 客户端不认识这俩负载，
    // 透传只会让它卡死在等 finish_configuration。门代答：吞负载 + 回 Ack。
    case 'bettercombat:config_sync':
      back.write('custom_payload', { channel: 'bettercombat:ack', data: encodeMCString('bettercombat:config') })
      return true
    case 'bettercombat:weapon_registry':
      back.write('custom_payload', { channel: 'bettercombat:ack', data: encodeMCString('bettercombat:weapon_registry') })
      return true
    default:
      return channel.startsWith('neoforge:') // 未识别的 neoforge 通道：吞掉，别惊动原版客户端
  }
}

// 协商失败 -> 神谕学习 -> 换清单重连（真客户端在 CONFIG 里等着）
function onSetupFailed (sess, failures) {
  const advice = P.analyzeFailures(failures)
  const n = Object.keys(advice).length
  sess.retry++
  if (sess.retry > MAX_LEARN_ROUNDS) {
    kickFront(sess, `协商 ${MAX_LEARN_ROUNDS} 轮仍不通，门暂时闭着`)
    return true
  }
  log(`${sess.username}：协商失败（第 ${sess.retry} 轮），神谕 ${n} 条，重学重连`)
  probe.applyAdvice(knowledge, advice, (s) => log(`  ${s}`))
  sess.reconnecting = true
  try { sess.back.end() } catch (e) {}
  sess.reconnecting = false
  sess.phase = 'config'
  sess.backReady = false
  setTimeout(() => { if (!sess.closed) connectBackend(sess) }, 200)
  return true
}

// ── 启动自检：先以探针学一遍，门再开张接客 ───────────────────────
async function bootLearn () {
  if (VANILLA_BACKEND) { // vanilla 姿势无需通道知识,探针反而徒增 timeout 记录
    log('vanilla 后端模式：跳过协商自检（brand 兼容路径无需通道知识）')
    return
  }
  log('启动自检：以探针先行叩门……')
  const r = await probe.negotiateAndJoin({
    host: BACKEND.host,
    port: BACKEND.port,
    username: 'GateLearn',
    knowledge, // 携缓存知识入场：命中缓存时一轮即过
    log
  })
  if (r.success) {
    for (const [id, k] of Object.entries(r.knowledge)) knowledge.set(id, k)
    saveKnowledge()
    log(`自检通过：${r.rounds} 轮协商成功，通道知识已缓存`)
  } else {
    log(`自检未过（${r.outcome}：${r.reason || ''}）——门照开，来客时当场学习`)
  }
}

bootLearn().catch((e) => log('自检异常：' + e.message))

process.on('SIGINT', () => {
  log('闭门。')
  try { server.close() } catch (e) {}
  process.exit(0)
})
