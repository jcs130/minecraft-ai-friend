import { randomUUID } from 'node:crypto';
import { pngInfo } from './appearance-files.mjs';
import { digest, newSecret } from './store.mjs';

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const UPLOAD_ROLE_LIMIT = 64;
export const UPLOAD_SITE_BYTES = 512 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail = (status, reason, message) => Object.assign(Error(message), { status, reason });
const text = (value, max, required = false) => {
  if (typeof value !== 'string' || [...value.trim()].length > max || required && !value.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw fail(400, 'PHOTO_TEXT', `标题为 1–60 字，描述最多 400 字；请使用普通文字`);
  return value.trim();
};

// Keep pixel chunks only. Browser canvas and Agent uploads follow the same
// bounded PNG validation; camera originals continue through the existing path.
export function uploadPng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_UPLOAD_BYTES) throw fail(413, 'PHOTO_TOO_LARGE', '图片最多 4MB；请缩小到 2048 像素以内后上传');
  pngInfo(bytes);
  const chunks = [bytes.subarray(0, 8)];
  for (let at = 8; at < bytes.length;) {
    const end = at + 12 + bytes.readUInt32BE(at), type = bytes.toString('ascii', at + 4, at + 8);
    if(type==='tRNS'&&(bytes[25]!==2||end-at!==18))throw fail(400,'PNG_FORMAT_UNSUPPORTED','请导出普通 RGB 或 RGBA 的 PNG 图片');
    if (['IHDR', 'IDAT', 'IEND', 'tRNS'].includes(type)) chunks.push(bytes.subarray(at, end));
    at = end;
  }
  return Buffer.concat(chunks);
}

export class PhotoUploads {
  constructor(gallery, { now = Date.now } = {}) { this.gallery = gallery; this.store = gallery.store; this.now = now; }
  context(owner, agent) {
    if (!agent?.playerUuid || !UUID.test(agent.playerUuid) || agent.identityConflict || agent.isReserved || agent.historical) throw fail(409, 'PHOTO_ROLE_REQUIRED', '先绑定一个有效游戏角色，再为这个角色上传图片');
    if (!this.store.ownedUuids(owner.id).some(id => id.toLowerCase() === agent.playerUuid.toLowerCase())) throw fail(403, 'PHOTO_OWNER_REQUIRED', '只能以本人已绑定的游戏角色上传；请先认领自己的角色');
    return { ownerId: owner.id, admin: false, uuids: new Set([agent.playerUuid.toLowerCase()]) };
  }
  upload(owner, agent, bytes, input) {
    const context = this.context(owner, agent);
    if (!UUID.test(input.requestId || '')) throw fail(400, 'PHOTO_REQUEST_ID', '请提供一个 UUID requestId；超时后用同一请求号重试');
    const title = text(input.title, 60, true), story = text(input.story ?? '', 400);
    const png = uploadPng(bytes), info = pngInfo(png), requestDigest = digest(JSON.stringify([info.sha256, title, story]));
    const authorUuid = agent.playerUuid.toLowerCase(), requestId = input.requestId.toLowerCase();
    const prior = this.store.db.prepare('SELECT id,request_digest FROM gallery_uploads WHERE author_uuid=? AND request_id=?').get(authorUuid, requestId);
    if (prior) {
      if (prior.request_digest !== requestDigest) throw fail(409, 'PHOTO_REQUEST_REUSED', '这个请求号已经用于另一张图片或描述；新作品请使用新 requestId');
      this.gallery.manageable(prior.id, context);
      return { id: prior.id, saved: true, replayed: true, published: !!this.store.db.prepare('SELECT visible FROM gallery_catalog WHERE id=?').get(prior.id)?.visible, origin: 'uploaded' };
    }
    if (this.store.db.prepare('SELECT count(*) AS n FROM gallery_uploads WHERE author_uuid=?').get(authorUuid).n >= UPLOAD_ROLE_LIMIT) throw fail(409, 'PHOTO_QUOTA', '这个角色已有 64 张上传图片；请先在“我的照片”删除不需要的上传作品');
    const used = this.store.db.prepare('SELECT coalesce(sum(length(i.png)),0) AS n FROM gallery_images i JOIN gallery_uploads u ON u.id=i.id').get().n;
    if (used + png.length > UPLOAD_SITE_BYTES) throw fail(507, 'PHOTO_STORAGE_FULL', '上传相册暂时已满，请联系管理员扩展图片存储；现有照片与游戏不受影响');
    const id = randomUUID(), now = this.now(), metadata = { id, author: agent.name, authorUuid, title, story, capturedAt: new Date(now).toISOString(), ...info, bytes: png.length, published: false, origin: 'uploaded' };
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      this.store.db.prepare('INSERT INTO gallery_uploads VALUES(?,?,?,?,?)').run(id, authorUuid, requestId, requestDigest, now);
      this.store.db.prepare('INSERT INTO gallery_catalog VALUES(?,?,0,?)').run(id, JSON.stringify(metadata), now);
      this.store.db.prepare('INSERT INTO gallery_images VALUES(?,?,?,?)').run(id, info.sha256, png, now);
      this.store.db.exec('COMMIT');
    } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    this.store.audit(owner.id, 'photo.upload', id);
    return { id, saved: true, replayed: false, published: false, origin: 'uploaded', next: '图片已存入个人相册。可自行公开，或生成五分钟地图导入链接；上传作品不作为游戏实拍或考试凭证。' };
  }
  remove(id, context) {
    this.gallery.manageable(id, context);
    if (!this.store.db.prepare('SELECT id FROM gallery_uploads WHERE id=?').get(id)) throw fail(409, 'CAMERA_ORIGINAL_RETAINED', '游戏实拍原片保留；如不想展示，请设为不公开');
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      for (const table of ['gallery_import_links', 'gallery_publication', 'gallery_images', 'gallery_catalog', 'gallery_uploads']) this.store.db.prepare(`DELETE FROM ${table} WHERE ${table === 'gallery_import_links' ? 'photo_id' : 'id'}=?`).run(id);
      this.store.db.exec('COMMIT');
    } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    return { id, removed: true };
  }
  issue(id, context, origin) {
    const image = this.gallery.image(id, context);
    if (image.bytes.length > MAX_UPLOAD_BYTES) throw fail(409, 'MAP_IMAGE_TOO_LARGE', '这张原片超过地图导入的 4MB 上限；请保留原片，另上传缩小版来制作地图画');
    const base = new URL(origin);
    if (base.pathname !== '/' || base.search || base.hash || base.username || base.password || base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))) throw fail(503, 'PHOTO_PUBLIC_ORIGIN', '管理员需要先配置网站 HTTPS 公网地址，再制作地图画');
    const now = this.now(), expires = now + 5 * 60000, token = newSecret();
    this.store.db.prepare('DELETE FROM gallery_import_links WHERE expires_at<=? OR photo_id=?').run(now, id);
    this.store.db.prepare('INSERT INTO gallery_import_links VALUES(?,?,?,3)').run(digest(token), id, expires);
    const url = base.origin + `/api/v1/gallery/${id}/import/${token}/image.png`, name = 'pic_' + id.replaceAll('-', '').slice(0, 12);
    return { id, expiresAt: new Date(expires).toISOString(), url, command: `/imageframe create ${name} ${url} 1 1`, message: '五分钟内在游戏中执行这条命令，需要 1 张空地图。链接可临时读取原图，请仅交给自己的游戏客户端；命令返回成功并收到地图才算制作完成。上传图片不作为游戏实拍或考试凭证。' };
  }
  imported(id, token, consume = true) {
    const now = this.now();
    this.store.db.prepare('DELETE FROM gallery_import_links WHERE expires_at<=? OR remaining<=0').run(now);
    const row = this.store.db.prepare('SELECT * FROM gallery_import_links WHERE token_hash=? AND photo_id=?').get(digest(token), id);
    if (!row) throw fail(404, 'PHOTO_LINK_EXPIRED', '地图导入链接已过期或已使用，请回到个人相册重新生成');
    const photo = this.gallery.known(id), image = photo && this.store.db.prepare('SELECT png FROM gallery_images WHERE id=? AND sha256=?').get(id, photo.sha256);
    if (!image) throw fail(404, 'PHOTO_NOT_FOUND', '这张图片已不可用，请重新选择');
    if (consume) this.store.db.prepare('UPDATE gallery_import_links SET remaining=remaining-1 WHERE token_hash=?').run(row.token_hash);
    return Buffer.from(image.png);
  }
}
