// B站直播弹幕接收桥（只读·收弹幕，无需登录 cookie）
// 流程：room_id → real_id → getDanmuInfo(token+host) → wss 连接 → 发认证包 → 心跳 → 解 zlib 弹幕包
// 依赖 Node 全局 WebSocket（需 node:22 镜像）。协议细节以首次真实房间号联调为准。
import zlib from 'node:zlib';

const UA = 'Mozilla/5.0 (live-console)';
const HDR = { 'User-Agent': UA, 'Referer': 'https://live.bilibili.com/' };

function pack(op, body) { // 16字节头 + body
  const b = Buffer.from(body);
  const h = Buffer.alloc(16);
  h.writeUInt32BE(16 + b.length, 0); h.writeUInt16BE(16, 4); h.writeUInt16BE(1, 6);
  h.writeUInt32BE(op, 8); h.writeUInt32BE(1, 12);
  return Buffer.concat([h, b]);
}
function unpack(buf, out) {
  let off = 0;
  while (off + 16 <= buf.length) {
    const len = buf.readUInt32BE(off), ver = buf.readUInt16BE(off + 6), op = buf.readUInt32BE(off + 8);
    const chunk = buf.subarray(off, off + len); off += len;
    if (len < 16 || off > buf.length) break;
    let body = chunk.subarray(16);
    if (ver === 2) { try { body = zlib.inflateSync(body); } catch {} }
    if (op === 5 || op === 6) { try { const j = JSON.parse(body.toString('utf8')); if (j.cmd === 'LIVE' || j.cmd === 'PREPARING') out.status?.(j.cmd); for (const d of (j.data || (Array.isArray(j) ? j : []))) emitDanmu(j, d, out); if (Array.isArray(j)) j.forEach(x => emitDanmu(x, x, out)); } catch {} }
  }
}
function emitDanmu(j, d, out) {
  const cmd = j.cmd || d?.cmd;
  if (cmd === 'DANMU_MSG') { const info = d?.info || j?.info || []; out.onDanmaku({ user: info?.[2]?.[1] || info?.[1] || '观众', text: info?.[1] || '', type: 'danmaku' }); }
  else if (cmd === 'SEND_GIFT') { out.onDanmaku({ user: d?.data?.uname || '观众', text: `送出了 ${d?.data?.giftName || '礼物'}×${d?.data?.num || 1}`, type: 'gift' }); }
  else if (cmd === 'INTERACT_WORD') { out.onDanmaku({ user: d?.data?.uname || '', text: '进入直播间', type: 'enter' }); }
}

export async function connectRoom(roomId, { onReady, onDanmaku, onError } = {}) {
  const out = { onDanmaku, status: () => {} };
  try {
    // 1) 短号→真实号
    const gi = await (await fetch(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomId}`, { headers: HDR })).json();
    const real = gi?.data?.room_id || roomId;
    // 2) 弹幕服务器 + token
    const di = await (await fetch(`https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=${real}&type=0`, { headers: HDR })).json();
    const token = di?.data?.token || ''; const host = di?.data?.host_list?.[0];
    if (!host) throw new Error('no danmu host');
    const wsUrl = `wss://${host.host}:${host.wss_port || 443}/sub`;
    let ws, buf = Buffer.alloc(0), alive = true;
    const open = () => new Promise((res, rej) => {
      ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { ws.send(pack(7, JSON.stringify({ uid: 0, roomid: real, protover: 2, platform: 'web', type: 3, key: token }))); res(); };
      ws.onmessage = e => { buf = Buffer.concat([buf, Buffer.from(e.data)]); unpack(buf, out); buf = Buffer.alloc(0); };
      ws.onerror = ev => { alive = false; onError?.(ev?.message || 'ws error'); };
      ws.onclose = () => { alive = false; };
      setTimeout(() => ws.readyState !== 1 ? rej(new Error('ws open timeout')) : res(), 8000);
    });
    await open();
    onReady?.();
    setInterval(() => { try { if (alive && ws.readyState === 1) ws.send(pack(2, '[object Object]')); } catch {} }, 30000);
  } catch (e) { onError?.(e?.message || String(e)); setTimeout(() => connectRoom(roomId, { onReady, onDanmaku, onError }), 15000); }
}
