import { randomUUID, createHash } from 'node:crypto';

export const MAX_REFERENCE_BYTES = 4 * 1024 * 1024;
const OWNER_QUOTA = 24 * 1024 * 1024;
const fail = (status, reason, message) => Object.assign(new Error(message), { status, reason });

// Metadata validation never renders or executes an uploaded file. The browser
// also decodes the selected image before upload. SVG/HTML/GIF are not accepted.
export function referenceImage(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24 || bytes.length > MAX_REFERENCE_BYTES) throw fail(413, 'REFERENCE_SIZE', '设定图需为 4MB 以内的 PNG、JPG 或 WebP');
  let width, height, mime;
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND') {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); mime = 'image/png';
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++]; if (marker === 0xda || marker === 0xd9) break;
      if (marker === 1 || marker >= 0xd0 && marker <= 0xd7) continue;
      const size = bytes.readUInt16BE(offset); if (size < 2 || offset + size > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && size >= 8) { height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); mime = 'image/jpeg'; break; }
      offset += size;
    }
  } else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length) {
    const format = bytes.toString('ascii', 12, 16);
    if (format === 'VP8X' && bytes.length >= 30) {
      if (bytes[20] & 2) throw fail(400, 'REFERENCE_ANIMATION', '请使用静态设定图');
      width = 1 + bytes.readUIntLE(24, 3); height = 1 + bytes.readUIntLE(27, 3); mime = 'image/webp';
    } else if (format === 'VP8 ' && bytes.length >= 30 && bytes.subarray(23, 26).equals(Buffer.from('9d012a', 'hex'))) {
      width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff; mime = 'image/webp';
    } else if (format === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; mime = 'image/webp';
    }
  }
  if (!mime || !width || !height || width > 4096 || height > 4096 || width * height > 16777216) throw fail(400, 'REFERENCE_FORMAT', '无法识别设定图，请选择宽高不超过 4096 的静态 PNG、JPG 或 WebP');
  return { width, height, mime, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export class AgentProfiles {
  constructor(store) {
    this.store = store;
    store.db.exec(`CREATE TABLE IF NOT EXISTS agent_profiles(agent_uuid TEXT PRIMARY KEY,display_name TEXT NOT NULL,bio TEXT NOT NULL,use_references INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_reference_images(id TEXT PRIMARY KEY,agent_uuid TEXT NOT NULL,uploader_id TEXT NOT NULL REFERENCES owners(id),mime TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,sha256 TEXT NOT NULL,png BLOB NOT NULL,created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS agent_reference_owner ON agent_reference_images(uploader_id);`);
  }
  get(agent) {
    const row = this.store.db.prepare('SELECT * FROM agent_profiles WHERE agent_uuid=?').get(agent.playerUuid);
    const references = this.store.db.prepare('SELECT id,mime,width,height,sha256,length(png) AS bytes,created_at FROM agent_reference_images WHERE agent_uuid=? ORDER BY created_at,id').all(agent.playerUuid);
    return { displayName: row?.display_name || agent.name, bio: row?.bio || '', useReferences: !row || row.use_references === 1,
      availableForGeneration: (!row || row.use_references === 1) && references.length > 0, visibility: 'owner',
      references: references.map(item => ({ id: item.id, mime: item.mime, width: item.width, height: item.height, sha256: item.sha256, bytes: item.bytes, createdAt: new Date(item.created_at).toISOString(), url: `/api/v1/agents/${agent.id}/references/${item.id}` })),
      limits: { images: 3, maxBytes: MAX_REFERENCE_BYTES },
      usage: '设定图仅本人和网站管理员可读取，供你之后发起的图片创作参考；不会自动调用模型，也不会替换游戏实拍、皮肤或 YSM。' };
  }
  save(agent, owner, body) {
    if (typeof body.displayName !== 'string' || body.displayName.trim().length < 1 || body.displayName.length > 40 || typeof body.bio !== 'string' || body.bio.length > 1600 || typeof body.useReferences !== 'boolean') throw fail(400, 'PROFILE_INVALID', '角色称呼需为 1–40 字，背景设定不超过 1600 字；请选择是否用于之后的图片创作');
    this.store.db.prepare('INSERT INTO agent_profiles VALUES(?,?,?,?,?) ON CONFLICT(agent_uuid) DO UPDATE SET display_name=excluded.display_name,bio=excluded.bio,use_references=excluded.use_references,updated_at=excluded.updated_at').run(agent.playerUuid, body.displayName.trim(), body.bio.trim(), body.useReferences ? 1 : 0, Date.now());
    this.store.audit(owner.id, 'profile.update', agent.id); return this.get(agent);
  }
  upload(agent, owner, bytes, contentType) {
    const metadata = referenceImage(bytes);
    if (contentType !== metadata.mime) throw fail(415, 'REFERENCE_TYPE', '文件类型与图片内容不一致');
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const duplicate = this.store.db.prepare('SELECT id FROM agent_reference_images WHERE agent_uuid=? AND sha256=?').get(agent.playerUuid, metadata.sha256);
      if (!duplicate) {
        if (this.store.db.prepare('SELECT count(*) AS n FROM agent_reference_images WHERE agent_uuid=?').get(agent.playerUuid).n >= 3) throw fail(409, 'REFERENCE_LIMIT', '每个角色最多 3 张设定图，请先移除一张');
        const total = this.store.db.prepare('SELECT COALESCE(sum(length(png)),0) AS n FROM agent_reference_images WHERE uploader_id=?').get(owner.id).n;
        if (total + bytes.length > OWNER_QUOTA) throw fail(409, 'REFERENCE_QUOTA', '你的设定图已达到 24MB，请先移除不再使用的图片');
        this.store.db.prepare('INSERT INTO agent_reference_images VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), agent.playerUuid, owner.id, metadata.mime, metadata.width, metadata.height, metadata.sha256, bytes, Date.now());
      }
      this.store.db.exec('COMMIT');
    } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    this.store.audit(owner.id, 'profile.reference.upload', agent.id); return this.get(agent);
  }
  image(agent, id) {
    const value = this.store.db.prepare('SELECT mime,png FROM agent_reference_images WHERE id=? AND agent_uuid=?').get(id, agent.playerUuid);
    if (!value) throw fail(404, 'REFERENCE_NOT_FOUND', '未找到属于这个角色的设定图');
    return { mime: value.mime, bytes: Buffer.from(value.png) };
  }
  remove(agent, owner, id) {
    const result = this.store.db.prepare('DELETE FROM agent_reference_images WHERE id=? AND agent_uuid=?').run(id, agent.playerUuid);
    if (!result.changes) throw fail(404, 'REFERENCE_NOT_FOUND', '未找到属于这个角色的设定图');
    this.store.audit(owner.id, 'profile.reference.remove', agent.id); return this.get(agent);
  }
}
