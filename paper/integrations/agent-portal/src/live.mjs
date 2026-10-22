import { randomUUID } from 'node:crypto';
import { digest, newSecret } from './store.mjs';

const fail = (status, reason, message) => Object.assign(new Error(message), { status, reason });

export function jpegSize(bytes) {
  if (bytes.length < 20 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) throw fail(400, 'INVALID_FRAME', '画面必须是完整的 JPEG 图片');
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset++] !== 0xff) break;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if ([0xd8, 0x01].includes(marker) || marker >= 0xd0 && marker <= 0xd7) continue;
    if (marker === 0xda || marker === 0xd9) break;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if ([0xc0, 0xc2].includes(marker) && length >= 8) {
      const height = bytes.readUInt16BE(offset + 3), width = bytes.readUInt16BE(offset + 5);
      if (width < 160 || height < 90 || width > 2560 || height > 1440) throw fail(400, 'FRAME_DIMENSIONS', '直播画面尺寸需在 160×90 到 2560×1440 以内');
      return { width, height };
    }
    offset += length;
  }
  throw fail(400, 'INVALID_FRAME', '无法读取 JPEG 画面尺寸');
}

export class Live {
  constructor(config, store) { this.config = config; this.store = store; this.frames = new Map(); }
  channel(id) { return this.store.db.prepare('SELECT * FROM live_channels WHERE id=?').get(id); }
  publisher(req, id) {
    const channel = this.channel(id);
    const token = /^Bearer (pub_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
    if (!channel || !token || digest(token) !== channel.publisher_hash) throw fail(401, 'PUBLISHER_REQUIRED', '直播发布凭据无效或已撤销');
    return channel;
  }
  create({ title, playerName, playerUuid, visibility }) {
    if (this.store.db.prepare('SELECT id FROM live_channels WHERE player_uuid=?').get(playerUuid)) throw fail(409, 'CHANNEL_EXISTS', '这个角色已有直播频道，请在现有频道管理发布凭据');
    if (this.store.db.prepare('SELECT count(*) AS n FROM live_channels').get().n >= this.config.live.maxChannels) throw fail(409, 'CHANNEL_LIMIT', '直播频道数量已达上限');
    const id = randomUUID(), token = 'pub_' + newSecret();
    this.store.db.prepare('INSERT INTO live_channels VALUES(?,?,?,?,?,?,?)').run(id, title, playerName, playerUuid, visibility, digest(token), Date.now());
    return { id, publisherToken: token, publisherEnv: 'QD_LIVE_PUBLISH_TOKEN' };
  }
  rotate(id) {
    if (!this.channel(id)) throw fail(404, 'CHANNEL_NOT_FOUND', '直播频道不存在');
    const token = 'pub_' + newSecret();
    this.store.db.prepare('UPDATE live_channels SET publisher_hash=? WHERE id=?').run(digest(token), id);
    this.frames.delete(id);
    return { id, publisherToken: token, publisherEnv: 'QD_LIVE_PUBLISH_TOKEN' };
  }
  list(owner = null) {
    const owned = owner ? this.store.ownedUuids(owner.id) : [];
    return this.store.db.prepare('SELECT id,title,player_name,player_uuid,visibility FROM live_channels ORDER BY created_at').all()
      .filter(row => row.visibility === 'public' || owner?.role === 'admin' || owned.includes(row.player_uuid)).map(row => {
      const frame = this.frames.get(row.id);
      const available = !!frame?.bytes && Date.now() - frame.at < this.config.live.staleAfterMs;
      return { id: row.id, title: row.title, playerName: row.player_name, visibility: row.visibility, available, isOwn: owned.includes(row.player_uuid), canManage: owner?.role === 'admin' || owned.includes(row.player_uuid),
        state: available ? 'live' : 'offline', frameAt: available ? new Date(frame.at).toISOString() : null,
        width: available ? frame.width : null, height: available ? frame.height : null, mode: 'canvas-only', readOnly: true };
    });
  }
  open(id) {
    const previous = this.frames.get(id);
    if (previous && Date.now() - previous.at < this.config.live.staleAfterMs) throw fail(409, 'PUBLISHER_BUSY', '已有发布器在线，请先停止它或等待当前直播失效');
    const epoch = randomUUID(); this.frames.set(id, { epoch, seq: 0, at: 0, bytes: null, lastUploadAt: 0 });
    return { epoch, maxFrameBytes: this.config.live.maxFrameBytes, maxFps: 2, staleAfterMs: this.config.live.staleAfterMs };
  }
  async publish(req, id) {
    if (req.headers['content-type'] !== 'image/jpeg') throw fail(415, 'JPEG_REQUIRED', '只接受无界面的 JPEG 游戏画面');
    const frame = this.frames.get(id), epoch = req.headers['x-stream-epoch'], sequence = req.headers['x-frame-sequence'];
    if (!frame || epoch !== frame.epoch) throw fail(409, 'STREAM_EPOCH', '直播连接已更新，请重新打开发布会话');
    if (!/^[1-9]\d{0,12}$/.test(sequence || '') || Number(sequence) <= frame.seq) throw fail(409, 'FRAME_SEQUENCE', '旧帧或重复帧已丢弃');
    if (Date.now() - frame.lastUploadAt < 450) throw fail(429, 'FRAME_RATE', '最多每秒发布两帧');
    if (Number(req.headers['content-length']) > this.config.live.maxFrameBytes) throw fail(413, 'FRAME_TOO_LARGE', '画面文件超过大小限制');
    frame.lastUploadAt = Date.now();
    let size = 0; const parts = [];
    for await (const part of req) {
      size += part.length;
      if (size > this.config.live.maxFrameBytes) throw fail(413, 'FRAME_TOO_LARGE', '画面文件超过大小限制');
      parts.push(part);
    }
    // Another request may have finished/rotated the stream while this one read.
    if (this.frames.get(id) !== frame || Number(sequence) <= frame.seq) throw fail(409, 'FRAME_SEQUENCE', '迟到的画面已丢弃');
    const bytes = Buffer.concat(parts), dimensions = jpegSize(bytes);
    Object.assign(frame, dimensions, { bytes, seq: Number(sequence), at: Date.now() });
    return { accepted: true, sequence: frame.seq, frameAt: new Date(frame.at).toISOString() };
  }
  read(id) {
    const frame = this.frames.get(id);
    if (!frame?.bytes || Date.now() - frame.at >= this.config.live.staleAfterMs) throw fail(503, 'LIVE_OFFLINE', '直播尚未连接或画面已过期');
    return frame;
  }
}
