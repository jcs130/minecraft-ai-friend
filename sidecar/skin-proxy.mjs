#!/usr/bin/env node
// skin-proxy.mjs — MC 皮肤注入代理（服务器侧数据面）
// 拓扑: 客户端 -> [proxy :SKIN_LISTEN_PORT] -> java :SKIN_UPSTREAM_PORT
// 原理: minecraft-protocol 双端各自完成 login+configuration 状态机(官方 proxy 范例模式),
//       仅当【两侧都进入 play 态】后才开始双向转发 —— configuration 包绝不跨侧转发,
//       否则会把 config 包写进仍处于 login 态的对端, 污染握手字节流被 java 判
//       "Failed to decode packet 'serverbound/minecraft:hello'" 踢掉(2026-08-19 repro4 实证)。
// 转发策略(2026-08-22 修正): login/config 阶段走 minecraft-protocol packet 事件转发(简单包无损);
//       play 阶段【完全走字节级 raw】—— upstream 一旦进入 PLAY 立即接管其下行 socket 字节流,
//       缓冲到 client 也进入 PLAY 后建立双向 raw bridge, 绝不用 packet 解析->序列化转发 play 包
//       (旧实现残留竞态: raw bridge 建立前的第一个 play 大包(update_recipes 等)仍走 packet
//        序列化转发, 对 NeoForge mod 扩展字节有损, 实测 vanilla 客户端报
//        "Failed to decode packet 'clientbound/minecraft:update_recipes'" 2026-08-22 实证)。
//       仅当 s->c 帧为 player_info(add_player) 且命中 assignments 时才用 minecraft-protocol
//        解析注入 Mojang 签名 textures 属性, 其余帧(含 update_recipes)原样字节转发。
// 皮肤库/指派: /app/data/skins.json (presets + assignments), 每次登录热读 + fs.watch。
// 离线服 UUID: nmp 服务端与 vanilla java 均按 nameToMcOfflineUUID 派生, 两层天然一致。
import mc from 'minecraft-protocol';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const LISTEN_PORT = parseInt(process.env.SKIN_LISTEN_PORT || '25565', 10);
const UPSTREAM_HOST = process.env.SKIN_UPSTREAM_HOST || '127.0.0.1';
const UPSTREAM_PORT = parseInt(process.env.SKIN_UPSTREAM_PORT || '25599', 10);
const MC_VERSION = process.env.MC_VERSION || '1.21.1';
const DEFAULT_SKINS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/skins.json');
const SKINS_FILE = process.env.SKINS_FILE || DEFAULT_SKINS;
const PLAY = mc.states.PLAY;
const PLAYER_INFO_ID = 0x3e; // 1.21.1 clientbound play: player_info

let assignments = new Map(); // lowercase username -> {value, signature, model, preset}
let skinsStat = { file: SKINS_FILE, presets: 0, assignments: 0, applied: 0, sessions: 0 };

function log(...a) { console.log(`[skin-proxy][${new Date().toISOString().slice(11, 23)}]`, ...a); }

// 常见 vanilla 踢出理由美化(translate key -> 人话), 避免 end() 把裸 JSON 甩玩家脸上
const KICK_I18N = {
  'multiplayer.disconnect.not_whitelisted': '你不在本服白名单中 / Not whitelisted',
  'multiplayer.disconnect.server_full': '服务器已满员 / Server full',
  'multiplayer.disconnect.outdated_client': '客户端版本过旧 / Outdated client',
  'multiplayer.disconnect.outdated_server': '服务器版本过旧 / Outdated server',
  'multiplayer.disconnect.invalid_session': '会话无效, 请重进游戏 / Invalid session',
  'multiplayer.disconnect.unverified_username': '用户名校验失败 / Unverified username',
  'multiplayer.disconnect.banned': '你已被封禁 / Banned',
  'multiplayer.disconnect.kicked': '你被移出了服务器 / Kicked',
};
function prettyKick(d) {
  const r = d?.reason;
  if (typeof r === 'string') {
    try {
      const j = JSON.parse(r);
      if (j?.translate && KICK_I18N[j.translate]) return KICK_I18N[j.translate];
      if (j?.translate) return j.translate;
      if (typeof j?.text === 'string') return j.text;
    } catch { /* 非 JSON 就原样 */ }
    return r;
  }
  if (r && typeof r === 'object') {
    if (r.translate && KICK_I18N[r.translate]) return KICK_I18N[r.translate];
    if (typeof r.text === 'string') return r.text;
  }
  return '服务器断开连接 / Server disconnected';
}

function loadAssignments(tag) {
  try {
    const doc = JSON.parse(fs.readFileSync(SKINS_FILE, 'utf8'));
    const presets = doc.presets || {};
    const next = new Map();
    for (const [user, presetId] of Object.entries(doc.assignments || {})) {
      const p = presets[presetId];
      if (p && p.value && p.signature) {
        next.set(String(user).toLowerCase(), { value: p.value, signature: p.signature, model: p.model || 'classic', preset: presetId });
      } else {
        log(`WARN assignment ${user}->${presetId} preset missing/unsigned, ignored`);
      }
    }
    assignments = next;
    skinsStat.presets = Object.keys(presets).length;
    skinsStat.assignments = next.size;
    log(`skins loaded (${tag}): presets=${skinsStat.presets} assignments=${skinsStat.assignments} [${[...next.keys()].join(',')}]`);
  } catch (e) {
    log(`skins load failed (${tag}): ${e.message} — keep previous map`);
  }
}
loadAssignments('boot');

let watchTimer = null;
try {
  fs.watch(SKINS_FILE, () => {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => loadAssignments('watch'), 300); // 防抖
  });
} catch { /* 文件不存在时忽略 */ }

// ---- player_info 注入 ----
function injectTextures(data) {
  if (!data || !Array.isArray(data.data) || assignments.size === 0) return [];
  // 1.21.11: action 是 bitfield, 解析后可能是 {_value:N}(add_player=bit0) 或 {add_player:bool}
  const acts = data.action || {};
  const isAdd = typeof acts._value === 'number' ? (acts._value & 1) !== 0 : acts.add_player === true;
  if (!isAdd) return [];
  const hits = [];
  for (const entry of data.data) {
    const name = entry?.player?.name;
    if (!name) continue;
    const hit = assignments.get(String(name).toLowerCase());
    if (!hit) continue;
    const props = Array.isArray(entry.player.properties) ? entry.player.properties.filter(p => p?.name !== 'textures') : [];
    props.push({ name: 'textures', value: hit.value, signature: hit.signature });
    entry.player.properties = props;
    skinsStat.applied++;
    hits.push(`${name}->${hit.preset}`);
  }
  return hits;
}

// ---- play 态帧工具（帧级选择性解压注入）----
// raw bridge 之下：字节流按帧切分（VarInt 长度前缀），压缩帧（长度 >= 阈值）解压后
// 读包 ID——只有 player_info 才用 minecraft-protocol 解析注入皮肤，其余包原样字节转发
// （NeoForge mod 扩展字节无损）。任何解析/注入失败都回退原样透传，绝不改包。

function readVarIntAt(buf, offset) {
  let num = 0;
  for (let count = 0; count < 5; count++) {
    if (offset + count >= buf.length) return null;
    const b = buf[offset + count];
    num |= (b & 0x7f) << (7 * count);
    if ((b & 0x80) === 0) return { value: num >>> 0, bytes: count + 1 };
  }
  return null;
}

function writeVarInt(v) {
  const out = [];
  let n = v >>> 0;
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return Buffer.from(out);
}

// 从缓冲切出一帧：{ id, payload, raw, consumed, fail? }；不足一帧返回 null（等更多字节）。
function tryReadFrame(buf, threshold) {
  const len = readVarIntAt(buf, 0);
  if (!len) return null;
  const total = len.bytes + len.value;
  if (buf.length < total) return null;
  const body = buf.subarray(len.bytes, total);
  const raw = buf.subarray(0, total);
  let payload = body;
  if (len.value >= threshold) {
    const cl = readVarIntAt(body, 0);
    if (!cl) return null;
    try {
      payload = zlib.inflateSync(body.subarray(cl.bytes));
    } catch (e) {
      return { id: -1, payload: null, raw, consumed: total, fail: `inflate: ${e.message}` };
    }
  }
  const pid = readVarIntAt(payload, 0);
  return { id: pid ? pid.value : -1, payload, raw, consumed: total };
}

// 重写一帧（注入后的 player_info）：按阈值决定是否压缩。
function wrapFrame(payload, threshold) {
  if (threshold > 0 && payload.length >= threshold) {
    const z = zlib.deflateSync(payload);
    return Buffer.concat([writeVarInt(payload.length), writeVarInt(z.length), z]);
  }
  return Buffer.concat([writeVarInt(payload.length), payload]);
}

// 服务端帧转发：player_info 注入皮肤，其余原样字节。
function forwardServerFrame(client, frame) {
  if (frame.fail) {
    client.socket.write(frame.raw);
    return;
  }
  if (frame.id === PLAYER_INFO_ID && assignments.size > 0) {
    try {
      const { data } = client.deserializer.parsePacketBuffer(frame.payload, 'packet_player_info', 'clientbound', 'play');
      const hits = injectTextures(data);
      if (hits.length) {
        log('skin injected: ' + hits.join(', '));
        const out = client.serializer.createPacketBuffer('packet_player_info', data, 'clientbound', 'play');
        client.socket.write(wrapFrame(out, client.compressionThreshold > 0 ? client.compressionThreshold : 0));
        return;
      }
    } catch (e) {
      log(`! player_info inject failed, raw forward: ${e.message}`);
    }
  }
  client.socket.write(frame.raw);
}

// ---- server list ping 透传 (3参形式: response, client, answerToPing) ----
function proxyPing(response, client, answerToPing) {
  try {
    mc.ping({ host: UPSTREAM_HOST, port: UPSTREAM_PORT, version: MC_VERSION, closeTimeout: 4000 }, (err, res) => {
      answerToPing(null, res ? Object.assign({}, response, res) : response);
    });
  } catch { answerToPing(null, response); }
}

const srv = mc.createServer({
  'online-mode': false,
  version: MC_VERSION,
  port: LISTEN_PORT,
  keepAlive: false,
  beforePing: proxyPing,
});
console.log(`[skin-proxy] listening :${LISTEN_PORT} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT} (v${MC_VERSION})`);

srv.on('login', (client) => {
  loadAssignments('login'); // 每次登录热读, 面板改指派即刻生效
  const addr = `${client.socket?.remoteAddress}:${client.socket?.remotePort}`;
  log(`<- join ${client.username} (${addr})`);
  skinsStat.sessions++;

  let endedClient = false, endedUpstream = false;
  const endBoth = (why) => {
    if (!endedUpstream) { endedUpstream = true; try { upstream.end(why); } catch {} }
    if (!endedClient) { endedClient = true; try { client.end(why); } catch {} }
  };

  client.on('end', () => { endedClient = true; log(`x ${client.username} closed`); if (!endedUpstream) upstream.end('client end'); });
  client.on('error', (e) => { endedClient = true; log(`! ${client.username} err: ${e.message}`); if (!endedUpstream) upstream.end('client err'); });

  const upstream = mc.createClient({
    host: UPSTREAM_HOST, port: UPSTREAM_PORT,
    username: client.username,
    keepAlive: false,
    version: MC_VERSION,
    auth: 'offline',
  });
  // 方向B (2026-08-22 拍板, 决定性验证): NeoForge 1.21.1 config 阶段要进 play,
  // 裸 mc.createClient 必须补齐两件事: ①注册 brand 通道 ②响应 config 态 ping→pong。
  // ①registerChannel('minecraft:brand'): 对齐 mineflayer game.js 的
  //   bot._client.registerChannel('minecraft:brand',['string',[]]). 没有这行 minecraft-protocol
  //   不认识 minecraft:brand 通道, config 阶段连 custom_payload 都不解析, 卡 configuration。
  // ②config 态 ping→pong 已有(下方 upstream.on('ping')), minecraft-protocol keepalive.js
  //   只处理 play 态 keep_alive、不响应 config 态 ping, 缺这行 java 等 config ping 超时踢上游。
  // 实测(exp_b_full): 直连 25599 补这两件事后, config 序列完整跑通
  //   custom_payload(register/unregister/neoforge:register)->ping->[pong]->brand->feature_flags->
  //   select_known_packs->[回空]->registry_data x11->tags->finish_configuration->[ack]->play ✓
  try { upstream.registerChannel('minecraft:brand', ['string', []]); }
  catch (e) { log(`! registerChannel(brand): ${e.message}`); }

  upstream.on('login', () => log(`upstream logged in: ${client.username}`));

  // ---- PLAY 态字节级 raw 管线 (2026-08-22 重写, 根治 update_recipes 有损竞态) ----
  // login/config 走 packet 事件转发; PLAY 完全走字节 raw:
  //   * upstream 一旦进入 PLAY, 立即接管其下行 socket 字节 -> upPlayBuf 缓冲(不再用 packet 序列化转发)
  //   * client 进入 PLAY 后 establishRaw: 双向 socket 字节透传 + s->c 帧级 player_info 注入
  //   * 缓冲在 establishRaw 时并入 serverFrameBuf 统一帧切分转发
  let rawBridged = false;
  let serverFrameBuf = Buffer.alloc(0);
  let upPlayBuf = Buffer.alloc(0);
  let upPlayTaken = false;

  const pumpServerFrames = (threshold) => {
    let frame;
    while ((frame = tryReadFrame(serverFrameBuf, threshold))) {
      serverFrameBuf = serverFrameBuf.subarray(frame.consumed);
      if (endedClient) return;
      try { forwardServerFrame(client, frame); } catch (e) { log(`! s->c frame: ${e.message}`); }
    }
  };

  const establishRaw = () => {
    if (rawBridged || endedClient || endedUpstream) return;
    if (client.state !== PLAY || upstream.state !== PLAY) return;
    rawBridged = true;
    const threshold = upstream.compressionThreshold > 0 ? upstream.compressionThreshold : 0;
    log(`== raw bridge ON: ${client.username} (play 字节透传 + player_info 选择性注入, threshold=${threshold}) ==`);
    try {
      client.socket.removeAllListeners('data');
      upstream.socket.removeAllListeners('data');
    } catch (e) { log(`! removeAllListeners: ${e.message}`); }
    client.socket.on('data', (buf) => {
      if (endedUpstream) return;
      try { upstream.socket.write(buf); } catch (e) { log(`! c->s raw: ${e.message}`); }
    });
    upstream.socket.on('data', (buf) => {
      if (endedClient) return;
      serverFrameBuf = Buffer.concat([serverFrameBuf, buf]);
      pumpServerFrames(threshold);
    });
    // flush 上游缓冲
    if (upPlayBuf.length) {
      serverFrameBuf = Buffer.concat([upPlayBuf, serverFrameBuf]);
      upPlayBuf = Buffer.alloc(0);
      pumpServerFrames(threshold);
    }
    skinsStat.playRaw = true;
    skinsStat.playRawAt = Date.now();
    skinsStat.skinInject = 'selective-frame';
  };

  const tryEstablish = () => {
    try {
      establishRaw();
    } catch (e) { log(`! raw bridge check: ${e.message}`); }
  };

  // upstream 进入 PLAY: 立即接管其下行字节(缓冲), 此后不再走 packet 序列化转发
  upstream.on('state', (s) => {
    if (endedUpstream) return;
    if (upstream.state === PLAY && !upPlayTaken) {
      upPlayTaken = true;
      try {
        upstream.socket.removeAllListeners('data');
        upstream.socket.on('data', (buf) => {
          if (endedClient) return;
          // 已 raw bridge -> 直接进帧切分管线; 未 raw bridge -> 缓冲等 client 就绪
          if (rawBridged) {
            serverFrameBuf = Buffer.concat([serverFrameBuf, buf]);
            pumpServerFrames(upstream.compressionThreshold > 0 ? upstream.compressionThreshold : 0);
          } else {
            upPlayBuf = Buffer.concat([upPlayBuf, buf]);
          }
        });
        log(`upstream play taken: ${client.username} (bytes buffered, raw-bridge=${rawBridged})`);
      } catch (e) { log(`! upstream play takeover: ${e.message}`); }
    }
    tryEstablish();
  });
  client.on('state', tryEstablish);
  client.once('packet', tryEstablish);
  upstream.once('packet', tryEstablish);


  // NeoForge 1.20.5+ config 阶段 keep-alive：mc-protocol 的 keepalive.js 只处理 play 态 keep_alive、
  // 不响应 config 态 ping；缺这行主服会 30s 超时踢上游（2026-08-21 实证，对齐 mineflayer game.js 的做法）。
  upstream.on('ping', (data) => {
    try { upstream.write('pong', { id: data.id }); } catch { /* upstream closing */ }
  });

  // NeoForge 1.20.5+ config 阶段 keep-alive：mc-protocol 的 keepalive.js 只处理 play 态 keep_alive、
  // 不响应 config 态 ping；缺这行服务端 30s 超时踢上游(2026-08-21 实证，对齐 mineflayer game.js)。
  // proxy 自己回 pong，不依赖下游 client(vanilla/mineflayer) 回，保证 proxy->java 的 config 握手健壮。
  upstream.on('ping', (data) => {
    try { upstream.write('pong', { id: data.id }); } catch { /* upstream closing */ }
  });

  // upstream 在 login/config 阶段踢人(白名单/满员) -> end(reason) 由 nmp 按客户端当前状态
  // 打包正确的 disconnect 包(直接 write('disconnect',d) 会因 1.21 NBT 聊天组件序列化崩溃)
  upstream.on('disconnect', (d) => {
    endedUpstream = true;
    const why = prettyKick(d);
    log(`upstream kicked ${client.username}: ${JSON.stringify(d).slice(0, 160)} -> "${why}"`);
    if (!endedClient) { try { client.end(why); } catch {} }
  });

  // c->s / s->c: 仅 login/config 态走 packet 事件转发(简单包无损); PLAY 态一律走 raw(上面管线),
  // 这里对 PLAY 包直接 return —— 绝不用 packet 解析->序列化转发, 避免对 mod 扩展字节有损。
  client.on('packet', (data, meta) => {
    if (endedUpstream || endedClient) return;
    if (process.env.SKIN_DEBUG_FWD) log(`__cl fwd ${meta.state} ${meta.name}`);
    if (meta.state === PLAY) {
      return;
    }
    try { upstream.write(meta.name, data); }
    catch (e) { log(`! c->s write ${meta.name}: ${e.message}`); endBoth('proxy error'); }
  });

  upstream.on('packet', (data, meta) => {
    if (endedClient || endedUpstream) return;
    if (process.env.SKIN_DEBUG_FWD) log(`__up fwd ${meta.state} ${meta.name}`);
    if (meta.state === PLAY) return; // 走 raw, 绝不序列化转发
    try { client.write(meta.name, data); }
    catch (e) {
      log(`! s->c write ${meta.name}: ${e.message}`);
      endBoth('proxy error');
    }
  });

  upstream.on('end', () => { endedUpstream = true; if (!endedClient) client.end('upstream end'); });
  upstream.on('error', (e) => { endedUpstream = true; log(`! upstream err: ${e.message}`); if (!endedClient) client.end('upstream err'); });
});

srv.on('error', (e) => { console.log('[skin-proxy] FATAL server error:', e.message); process.exit(1); });
srv.on('listening', () => console.log('[skin-proxy] ready'));

// 状态文件(面板/看门狗可查)
setInterval(() => {
  try {
    fs.writeFileSync((process.env.SKIN_PROXY_STAT || '/app/data/skin-proxy-status.json'), JSON.stringify({
      ts: Date.now(), listen: LISTEN_PORT, upstream: UPSTREAM_PORT, ...skinsStat,
    }));
  } catch { /* best effort */ }
}, 15000);
