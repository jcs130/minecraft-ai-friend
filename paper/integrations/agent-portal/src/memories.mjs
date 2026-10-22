import { createHash } from 'node:crypto';
import { referenceImage, MAX_REFERENCE_BYTES } from './agent-profiles.mjs';
import { UUID } from './game-data.mjs';
import { playerNameValid } from './world-catalog.mjs';

const fail = (status, reason, message) => Object.assign(new Error(message), { status, reason });
const hash = value => createHash('sha256').update(value).digest('hex');
const LIMIT = 128 * 1024 * 1024;
const parts = new Set(['original', 'redraw']);
export const MAX_MEMORY_BYTES = MAX_REFERENCE_BYTES;

function metadata(body) {
  if (!body || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 100 || typeof body.story !== 'string' || body.story.length > 4000 || typeof (body.credit ?? '') !== 'string' || (body.credit || '').length > 160) throw fail(400, 'MEMORY_METADATA', '请填写100字以内的题目、4000字以内的故事和160字以内的创作署名');
  if (!Array.isArray(body.participants) || body.participants.length > 8 || body.participants.some(name => !playerNameValid(name))) throw fail(400, 'MEMORY_PARTICIPANTS', '共同经历最多关联8个游戏角色，请填写真实游戏名');
  const names = [...new Map(body.participants.map(name => [name.toLowerCase(), name])).values()];
  if (!['ai', 'art'].includes(body.redrawType || 'ai')) throw fail(400, 'MEMORY_REDRAW_TYPE', '请选择AI重绘或绘画创作');
  if (body.happenedAt && (typeof body.happenedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.happenedAt) || !Number.isFinite(Date.parse(body.happenedAt)) || new Date(body.happenedAt).toISOString().slice(0, 10) !== body.happenedAt)) throw fail(400, 'MEMORY_DATE', '经历日期请使用有效的年月日，也可以留空');
  return { title: body.title.trim(), story: body.story.trim(), credit: (body.credit || '').trim(), participants: names,
    redrawType: body.redrawType || 'ai', happenedAt: body.happenedAt || null };
}

export class Memories {
  constructor(store) {
    this.store = store;
    store.db.exec(`CREATE TABLE IF NOT EXISTS memory_posts(
      id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES owners(id),actor_uuid TEXT,actor_name TEXT,
      title TEXT NOT NULL,story TEXT NOT NULL,credit TEXT NOT NULL,participants TEXT NOT NULL,redraw_type TEXT NOT NULL,
      happened_at TEXT,state TEXT NOT NULL DEFAULT 'draft',revision INTEGER NOT NULL DEFAULT 1,request_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,published_at INTEGER);
      CREATE INDEX IF NOT EXISTS memory_public ON memory_posts(state,published_at,id);
      CREATE INDEX IF NOT EXISTS memory_owner ON memory_posts(owner_id,actor_uuid);
      CREATE TABLE IF NOT EXISTS memory_images(post_id TEXT NOT NULL REFERENCES memory_posts(id),kind TEXT NOT NULL,
      mime TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,sha256 TEXT NOT NULL,bytes BLOB NOT NULL,PRIMARY KEY(post_id,kind));`);
  }
  row(id) {
    if (!UUID.test(id || '')) throw fail(404, 'MEMORY_NOT_FOUND', '这段回忆不存在或尚未公开');
    const row = this.store.db.prepare('SELECT * FROM memory_posts WHERE id=?').get(id);
    if (!row) throw fail(404, 'MEMORY_NOT_FOUND', '这段回忆不存在或尚未公开');
    return row;
  }
  canEdit(row, context) { return !!context && row.owner_id === context.owner.id && (!context.actor || row.actor_uuid === context.actor.uuid); }
  owned(id, context) {
    const row = this.row(id);
    if (!this.canEdit(row, context)) throw fail(404, 'MEMORY_NOT_FOUND', '请由发布者管理这段回忆；关联参与者不会自动转移编辑权限');
    return row;
  }
  publicRow(row, full = false, imageRoot = '/api/v1/memories') {
    const images = {};
    for (const image of this.store.db.prepare('SELECT kind,mime,width,height,sha256,length(bytes) AS size FROM memory_images WHERE post_id=?').all(row.id)) {
      images[image.kind] = { url: `${imageRoot}/${row.id}/images/${image.kind}?rev=${image.sha256.slice(0, 16)}`, width: image.width, height: image.height, mime: image.mime, bytes: image.size };
    }
    return { id: row.id, title: row.title, ...(full ? { story: row.story } : { excerpt: row.story.slice(0, 180) }),
      credit: row.credit || '玩家分享', publisher: row.actor_name || this.store.ownerById(row.owner_id)?.username || '玩家',
      participants: JSON.parse(row.participants), participantSource: 'author-provided', redrawType: row.redraw_type,
      happenedAt: row.happened_at, state: row.state, revision: row.revision, publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
      originalLabel: '游戏原图', redrawLabel: row.redraw_type === 'ai' ? 'AI重绘' : '绘画创作', images };
  }
  list({ mine = false, context = null, offset = 0, participant = '' } = {}) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000 || participant && !playerNameValid(participant)) throw fail(400, 'MEMORY_QUERY', '请按页查看回忆，或使用真实角色名筛选');
    if (mine && !context) throw fail(401, 'LOGIN_REQUIRED', '登录后查看自己的草稿');
    const clauses = mine ? ['owner_id=?'] : ["state='public'"];
    const args = mine ? [context.owner.id] : [];
    if (mine && context.actor) { clauses.push('actor_uuid=?'); args.push(context.actor.uuid); }
    if (participant) { clauses.push('EXISTS(SELECT 1 FROM json_each(memory_posts.participants) WHERE lower(value)=lower(?))'); args.push(participant); }
    const where = clauses.join(' AND ');
    const total = this.store.db.prepare('SELECT count(*) AS n FROM memory_posts WHERE ' + where).get(...args).n;
    const rows = this.store.db.prepare('SELECT * FROM memory_posts WHERE ' + where + ' ORDER BY COALESCE(published_at,created_at) DESC,id DESC LIMIT 12 OFFSET ?').all(...args, offset);
    return { items: rows.map(row => ({ ...this.publicRow(row, false, mine && context?.actor ? '/api/v1/agent-access/memories' : '/api/v1/memories'), ...(mine ? { canManage: true } : {}) })), total, offset, limit: 12, nextOffset: offset + rows.length < total ? offset + rows.length : null };
  }
  detail(id, context = null) {
    const row = this.row(id);
    if (row.state !== 'public' && !this.canEdit(row, context)) throw fail(404, 'MEMORY_NOT_FOUND', '这段回忆尚未公开，请由发布者查看草稿');
    return { ...this.publicRow(row, true, context?.actor && row.state === 'draft' ? '/api/v1/agent-access/memories' : '/api/v1/memories'), canManage: this.canEdit(row, context) };
  }
  create(context, body) {
    if (!UUID.test(body?.requestId || '')) throw fail(400, 'MEMORY_REQUEST_ID', '先保存本次投稿requestId，超时后查询原回忆，不要重复创建');
    const value = metadata(body), signature = hash(JSON.stringify(value));
    const old = this.store.db.prepare('SELECT * FROM memory_posts WHERE id=?').get(body.requestId);
    if (old) {
      if (!this.canEdit(old, context) || old.request_hash !== signature) throw fail(409, 'MEMORY_REQUEST_CONFLICT', '这个投稿标识已有其他内容，请查询原草稿');
      return { ...this.detail(old.id, context), duplicate: true };
    }
    if (this.store.db.prepare('SELECT count(*) AS n FROM memory_posts WHERE owner_id=?').get(context.owner.id).n >= 100) throw fail(409, 'MEMORY_LIMIT', '每个账号最多100段回忆；请联系服主增加档案容量');
    const now = Date.now();
    this.store.db.prepare('INSERT INTO memory_posts VALUES(?,?,?,?,?,?,?,?,?,?,\'draft\',1,?,?,?,NULL)').run(body.requestId, context.owner.id,
      context.actor?.uuid || null, context.actor?.name || null, value.title, value.story, value.credit, JSON.stringify(value.participants), value.redrawType,
      value.happenedAt, signature, now, now);
    this.store.audit(context.owner.id, 'memory.create', body.requestId);
    return this.detail(body.requestId, context);
  }
  edit(id, context, body) {
    const row = this.owned(id, context), value = metadata(body);
    if (row.state !== 'draft') throw fail(409, 'MEMORY_WITHDRAW_FIRST', '请先撤回为草稿再修改，确认后可以重新公开');
    if (body.revision !== row.revision) throw fail(409, 'MEMORY_REVISION', '草稿已更新，请重新读取后修改，避免覆盖另一个编辑窗口');
    this.store.db.prepare('UPDATE memory_posts SET title=?,story=?,credit=?,participants=?,redraw_type=?,happened_at=?,updated_at=?,revision=revision+1 WHERE id=?')
      .run(value.title, value.story, value.credit, JSON.stringify(value.participants), value.redrawType, value.happenedAt, Date.now(), id);
    this.store.audit(context.owner.id, 'memory.edit', id); return this.detail(id, context);
  }
  upload(id, kind, context, bytes, contentType) {
    const row = this.owned(id, context);
    if (!parts.has(kind)) throw fail(400, 'MEMORY_IMAGE_KIND', '请选择游戏原图或重绘图');
    if (row.state !== 'draft') throw fail(409, 'MEMORY_WITHDRAW_FIRST', '请先撤回为草稿再替换图片');
    let image;
    try { image = referenceImage(bytes); } catch { throw fail(400, 'MEMORY_IMAGE_FORMAT', '图片需为4MB以内、宽高不超过4096的静态PNG、JPG或WebP'); }
    if (image.mime !== contentType) throw fail(415, 'MEMORY_IMAGE_TYPE', '图片内容与上传类型不一致');
    const old = this.store.db.prepare('SELECT sha256,length(bytes) AS size FROM memory_images WHERE post_id=? AND kind=?').get(id, kind);
    if (old?.sha256 === image.sha256) return this.detail(id, context);
    const total = this.store.db.prepare('SELECT COALESCE(sum(length(i.bytes)),0) AS n FROM memory_images i JOIN memory_posts p ON p.id=i.post_id WHERE p.owner_id=?').get(context.owner.id).n;
    if (total - (old?.size || 0) + bytes.length > LIMIT) throw fail(409, 'MEMORY_IMAGE_QUOTA', '回忆图片已达到128MB，请联系服主扩容');
    this.store.db.prepare('INSERT INTO memory_images VALUES(?,?,?,?,?,?,?) ON CONFLICT(post_id,kind) DO UPDATE SET mime=excluded.mime,width=excluded.width,height=excluded.height,sha256=excluded.sha256,bytes=excluded.bytes')
      .run(id, kind, image.mime, image.width, image.height, image.sha256, bytes);
    this.store.db.prepare('UPDATE memory_posts SET revision=revision+1,updated_at=? WHERE id=?').run(Date.now(), id);
    this.store.audit(context.owner.id, 'memory.image.' + kind, id); return this.detail(id, context);
  }
  publish(id, context, body) {
    const row = this.owned(id, context);
    if (body.confirmPublic !== true) throw fail(400, 'MEMORY_CONFIRM_PUBLIC', '请确认将原图、重绘和故事公开，图片中请勿包含私聊或敏感信息');
    if (row.state === 'public') return this.detail(id, context);
    if (body.revision !== row.revision) throw fail(409, 'MEMORY_REVISION', '草稿已更新，请重新预览后发布');
    if (this.store.db.prepare('SELECT count(*) AS n FROM memory_images WHERE post_id=?').get(id).n !== 2) throw fail(409, 'MEMORY_IMAGES_REQUIRED', '请先上传一张游戏原图和一张重绘图，再预览发布');
    const now = Date.now();
    this.store.db.prepare("UPDATE memory_posts SET state='public',published_at=COALESCE(published_at,?),updated_at=?,revision=revision+1 WHERE id=?").run(now, now, id);
    this.store.audit(context.owner.id, 'memory.publish', id); return this.detail(id, context);
  }
  withdraw(id, context) {
    const row = this.owned(id, context);
    if (row.state !== 'draft') {
      this.store.db.prepare("UPDATE memory_posts SET state='draft',updated_at=?,revision=revision+1 WHERE id=?").run(Date.now(), id);
      this.store.audit(context.owner.id, 'memory.withdraw', id);
    }
    return this.detail(id, context);
  }
  image(id, kind, context = null) {
    this.detail(id, context);
    const row = this.store.db.prepare('SELECT mime,bytes FROM memory_images WHERE post_id=? AND kind=?').get(id, kind);
    if (!row) throw fail(404, 'MEMORY_IMAGE_NOT_FOUND', '这张回忆图片尚未上传或已撤回');
    return { mime: row.mime, bytes: Buffer.from(row.bytes) };
  }
}
