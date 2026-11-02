import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { parseStream } from 'music-metadata';
import { UUID } from './game-data.mjs';

export const MUSIC_LIMITS = Object.freeze({ maximumBytes: 128 * 1024 * 1024, maximumSeconds: 1800, maximumWorksPerRole: 64, titleCharacters: 100, lyricsCharacters: 20000 });
export const MUSIC_FORMATS = Object.freeze({ 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/flac': 'flac', 'audio/ogg': 'ogg' });
const fail = (status, reason, message, nextAction) => Object.assign(Error(message), { status, reason, nextAction });
const hash = value => createHash('sha256').update(value).digest('hex');
const requestId = value => { if (!UUID.test(value ?? '')) throw fail(400, 'MUSIC_REQUEST_ID', 'requestId 必须是 UUID；超时后保留原值重试。', '查询本人作品，不要为同一作品重复建号或创建新作品。'); return value; };
const text = (value, max, required = false) => {
  if (typeof value !== 'string' || value.length > max || required && !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw fail(400, 'MUSIC_METADATA', `作品文字格式不正确，最多 ${max} 字。`, '按 /api/v1/music/capabilities 的字段要求修正。');
  return value.trim();
};
function metadata(body) {
  if (typeof body.aiGenerated !== 'boolean' || typeof body.hasVocals !== 'boolean') throw fail(400, 'MUSIC_LABEL_REQUIRED', '请明确填写 aiGenerated 和 hasVocals 布尔值。', '标明是否使用 AI 生成，以及是否为人声音轨。');
  if (!['plain', 'lrc'].includes(body.lyricsFormat ?? 'plain')) throw fail(400, 'MUSIC_LYRICS_FORMAT', '歌词格式支持 plain 或 lrc。');
  const sourceTrackId = text(body.sourceTrackId ?? '', 100);
  return { title: text(body.title, MUSIC_LIMITS.titleCharacters, true), lyrics: text(body.lyrics ?? '', MUSIC_LIMITS.lyricsCharacters), lyricsFormat: body.lyricsFormat ?? 'plain',
    aiGenerated: body.aiGenerated, hasVocals: body.hasVocals, sourceTrackId, description: text(body.description ?? '', 1000), credits: text(body.credits ?? '', 1000) };
}

// Metadata only. Audio goes directly from the client to the existing private OSS.
// Feature-off instances do not create these tables or change the image contract.
export class MusicWorks {
  constructor(store, { enabled = false, objects = null, now = Date.now } = {}) {
    this.store = store; this.enabled = enabled; this.objects = objects; this.now = now; this.verifying = new Map();
    if (enabled) store.db.exec(`CREATE TABLE IF NOT EXISTS music_works (
      id TEXT PRIMARY KEY, author_uuid TEXT NOT NULL, author_name TEXT NOT NULL, metadata TEXT NOT NULL,
      state TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL, binding TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS music_author ON music_works(author_uuid,created_at);
      CREATE TABLE IF NOT EXISTS music_requests (author_uuid TEXT NOT NULL, request_id TEXT NOT NULL,
        operation TEXT NOT NULL, digest TEXT NOT NULL, work_id TEXT NOT NULL, result TEXT NOT NULL,
        PRIMARY KEY(author_uuid,request_id));`);
  }
  capabilities() {
    return { version: '1', enabled: this.enabled && !!this.objects, pageUrl: '/music.html', ...MUSIC_LIMITS, formats: MUSIC_FORMATS,
      authentication: ['existing qda_ self session', 'single-role PAT with music.write', 'website owner session + CSRF + agentId'],
      workflow: ['create private draft', 'prepare direct OSS PUT', 'complete and verify', 'explicit publication'],
      defaultPublished: false, generation: false, apiRoot: '/api/v1/self/music' };
  }
  assertEnabled() { if (!this.enabled || !this.objects) throw fail(503, 'MUSIC_UNAVAILABLE', '歌曲作品入口尚未启用，请保留本机成品和歌词。', '等待 /api/v1/music/capabilities 返回 enabled:true；不要改走图片接口。'); }
  context(owner, agent) {
    this.assertEnabled();
    if (!owner || !agent || !UUID.test(agent.playerUuid ?? '') || agent.reserved || agent.isReserved || agent.historical || agent.identityConflict || !this.store.ownedUuids(owner.id).includes(agent.playerUuid)) throw fail(403, 'MUSIC_OWNER_REQUIRED', '只有当前已绑定角色的本人可以管理作品。', '使用原 Agent 本人会话，或在连接中心由当前主人授权 music.write；不要新建角色。');
    return { owner, agent, uuid: agent.playerUuid };
  }
  row(id, context) {
    this.assertEnabled();
    const row = this.store.db.prepare('SELECT * FROM music_works WHERE id=?').get(id);
    if (!row || (context ? row.author_uuid !== context.uuid : !row.published || row.state !== 'ready')) throw fail(404, 'MUSIC_NOT_FOUND', '没有找到可访问的歌曲作品。', '查询 /api/v1/self/music 查看本人的草稿或上传状态。');
    return row;
  }
  view(row, { privateView = false, detail = true } = {}) {
    const meta = JSON.parse(row.metadata), binding = row.binding && JSON.parse(row.binding), root = privateView ? '/api/v1/self/music/' : '/api/v1/music/';
    if (!detail) delete meta.lyrics;
    return { id: row.id, author: row.author_name, ...meta, state: row.state, published: !!row.published, revision: row.revision,
      createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
      audio: row.state === 'ready' ? { bytes: binding.bytes, sha256: binding.sha256, mime: binding.mime, durationSeconds: binding.durationSeconds, url: root + row.id + '/audio' } : null,
      ...(privateView ? { verifying: this.verifying.has(row.id), uploadId: binding?.uploadId ?? null, statusUrl: root + row.id } : {}) };
  }
  page(context, page = 1) {
    this.assertEnabled();
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw fail(400, 'MUSIC_PAGE', 'page 需为正整数。');
    const filter = context ? 'author_uuid=?' : "published=1 AND state='ready'", args = context ? [context.uuid] : [];
    const total = this.store.db.prepare(`SELECT COUNT(*) AS n FROM music_works WHERE ${filter}`).get(...args).n;
    return { total, page, pageSize: 20, works: this.store.db.prepare(`SELECT * FROM music_works WHERE ${filter} ORDER BY created_at DESC,id LIMIT 20 OFFSET ?`).all(...args, (page - 1) * 20).map(row => this.view(row, { privateView: !!context, detail: false })) };
  }
  transaction(fn) { this.store.db.exec('BEGIN IMMEDIATE'); try { const value = fn(); this.store.db.exec('COMMIT'); return value; } catch (e) { this.store.db.exec('ROLLBACK'); throw e; } }
  previous(context, body, operation, content) {
    const key = requestId(body.requestId), digest = hash(JSON.stringify(content));
    const old = this.store.db.prepare('SELECT * FROM music_requests WHERE author_uuid=? AND request_id=?').get(context.uuid, key);
    if (old && (old.operation !== operation || old.digest !== digest)) throw fail(409, 'MUSIC_REQUEST_REUSED', '这个 requestId 已用于不同内容或操作。', '先查询旧作品；仅在确定是新操作时使用新的 requestId。');
    return { key, digest, old };
  }
  remember(context, ticket, operation, id, result = {}) { this.store.db.prepare('INSERT INTO music_requests VALUES(?,?,?,?,?,?)').run(context.uuid, ticket.key, operation, ticket.digest, id, JSON.stringify(result)); }
  create(context, body) {
    const meta = metadata(body), ticket = this.previous(context, body, 'create', meta);
    if (ticket.old) return { ...this.view(this.row(ticket.old.work_id, context), { privateView: true }), replayed: true };
    if (this.store.db.prepare('SELECT COUNT(*) AS n FROM music_works WHERE author_uuid=?').get(context.uuid).n >= MUSIC_LIMITS.maximumWorksPerRole) throw fail(409, 'MUSIC_WORK_LIMIT', '本角色作品空间已满。', '先整理现有作品，勿连续重试创建。');
    const id = randomUUID(), now = this.now();
    this.transaction(() => { this.store.db.prepare('INSERT INTO music_works VALUES(?,?,?,?,?,0,1,NULL,0,?,?)').run(id, context.uuid, context.agent.name, JSON.stringify(meta), 'draft', now, now); this.remember(context, ticket, 'create', id); });
    return { ...this.view(this.row(id, context), { privateView: true }), replayed: false };
  }
  update(context, id, body) {
    const meta = metadata(body), operation = 'metadata:' + id, ticket = this.previous(context, body, operation, { meta, expectedRevision: body.expectedRevision });
    const row = this.row(id, context);
    if (ticket.old) return { ...this.view(row, { privateView: true }), replayed: true };
    this.revision(row, body);
    this.transaction(() => { this.store.db.prepare('UPDATE music_works SET metadata=?,revision=revision+1,updated_at=? WHERE id=?').run(JSON.stringify(meta), this.now(), id); this.remember(context, ticket, operation, id); });
    return this.view(this.row(id, context), { privateView: true });
  }
  revision(row, body) { if (body.expectedRevision !== row.revision) throw fail(409, 'MUSIC_REVISION', '作品已更新，请先查询最新版本。', '/api/v1/self/music/' + row.id); }
  async prepare(context, id, body) {
    if (!/^[a-f0-9]{64}$/.test(body.sha256 ?? '') || !Number.isSafeInteger(body.bytes) || body.bytes < 44 || body.bytes > MUSIC_LIMITS.maximumBytes || !MUSIC_FORMATS[body.mime]) throw fail(400, 'MUSIC_AUDIO_DESCRIPTOR', '请提供真实文件 SHA256、44–134217728 字节的大小，以及支持的音频 MIME。', '支持 MP3、WAV、FLAC、Ogg（Vorbis/Opus）；最长30分钟。');
    const descriptor = { sha256: body.sha256, bytes: body.bytes, mime: body.mime }, operation = 'audio:' + id, ticket = this.previous(context, body, operation, descriptor);
    let row = this.row(id, context), binding = row.binding && JSON.parse(row.binding);
    if (ticket.old) {
      if (JSON.parse(ticket.old.result).uploadId !== binding?.uploadId) throw fail(409, 'MUSIC_UPLOAD_REPLACED', '旧上传已被替换，请查询当前作品。', '/api/v1/self/music/' + id);
    } else {
      if (row.state === 'ready' || row.state === 'uploading') throw fail(409, 'MUSIC_AUDIO_EXISTS', '此作品已有成品或待完成的上传。', '使用原 requestId 刷新上传链接，或对原 uploadId 执行 complete。');
      if (row.attempts >= 5) throw fail(409, 'MUSIC_UPLOAD_LIMIT', '此作品上传已失败多次。', '保留原文件并联系管理员检查格式，不要重复创建。');
      binding = { ...descriptor, uploadId: randomUUID(), objectId: randomBytes(32).toString('hex') };
      this.transaction(() => { this.store.db.prepare("UPDATE music_works SET binding=?,state='uploading',attempts=attempts+1,revision=revision+1,updated_at=? WHERE id=?").run(JSON.stringify(binding), this.now(), id); this.remember(context, ticket, operation, id, { uploadId: binding.uploadId }); });
      row = this.row(id, context);
    }
    const work = this.view(row, { privateView: true });
    if (row.state === 'ready') return { ...work, replayed: true, upload: null };
    if (row.state === 'failed') throw fail(409, 'MUSIC_AUDIO_FAILED', '这次上传未通过文件验证。', '修正音频后用新的音频 requestId 重试；不要重建作品。');
    return { ...work, replayed: !!ticket.old, upload: { method: 'PUT', ...await this.objects.prepare(binding) } };
  }
  async complete(context, id, body, reauthorize = async () => context) {
    const row = this.row(id, context), binding = row.binding && JSON.parse(row.binding);
    if (!UUID.test(body.uploadId ?? '') || binding?.uploadId !== body.uploadId) throw fail(409, 'MUSIC_UPLOAD_ID', 'uploadId 与当前作品不符。', '/api/v1/self/music/' + id);
    if (row.state === 'ready') return { ...this.view(row, { privateView: true }), replayed: true };
    if (row.state !== 'uploading') throw fail(409, 'MUSIC_UPLOAD_STATE', '音频尚未准备好。', '先准备上传并完成 OSS PUT，再调用 complete。');
    if (this.verifying.size >= 1 && !this.verifying.has(id)) throw fail(429, 'MUSIC_VERIFY_BUSY', '正在验证其他音频。', '稍后用相同 uploadId 重试 complete。');
    if (!this.verifying.has(id)) {
      const promise = this.verify(binding).finally(() => this.verifying.delete(id));
      this.verifying.set(id, promise);
    }
    let verified;
    try { verified = await this.verifying.get(id); }
    catch (error) {
      if (error.status === 422) this.store.db.prepare("UPDATE music_works SET state='failed',revision=revision+1,updated_at=? WHERE id=? AND binding=? AND state='uploading'").run(this.now(), id, row.binding);
      if (error.status) throw error;
      throw fail(503, 'MUSIC_STORAGE_RETRY', '暂时无法验证音频；不会自动公开。', '查询原作品，再用相同 uploadId 重试 complete。');
    }
    const renewed = await reauthorize();
    if (renewed.uuid !== context.uuid) throw fail(403, 'MUSIC_OWNER_REQUIRED', '角色归属已变化，未完成发布。');
    const current = this.row(id, renewed);
    if (current.state === 'ready' && JSON.parse(current.binding).uploadId === body.uploadId) return { ...this.view(current, { privateView: true }), replayed: true };
    if (current.binding !== row.binding) throw fail(409, 'MUSIC_UPLOAD_REPLACED', '上传状态已变化，请查询作品。');
    this.store.db.prepare("UPDATE music_works SET binding=?,state='ready',revision=revision+1,updated_at=? WHERE id=? AND state='uploading'").run(JSON.stringify({ ...binding, ...verified }), this.now(), id);
    return this.view(this.row(id, renewed), { privateView: true });
  }
  async verify(binding) {
    const head = await this.objects.head(binding);
    if (!head) throw fail(409, 'MUSIC_UPLOAD_MISSING', 'OSS 中尚未收到完整文件。', '完成原 PUT 后，用原 uploadId 重试 complete。');
    const invalid = message => fail(422, 'MUSIC_AUDIO_INVALID', message, '保留作品，修正音频后使用新的音频 requestId；只有验证通过的成品才能公开。');
    if (head.bytes !== binding.bytes || head.sha256 !== binding.sha256 || !head.etag) throw invalid('上传大小或文件摘要声明不符。');
    // Read actual bytes; client-supplied OSS metadata alone proves nothing.
    const first = await this.objects.open(binding, head.etag), digest = createHash('sha256');
    let size = 0; const timeout = setTimeout(() => first.destroy(Error('MUSIC_VERIFY_TIMEOUT')), 60000); timeout.unref();
    try { for await (const chunk of first) { size += chunk.length; if (size > binding.bytes) throw invalid('上传文件超过声明大小。'); digest.update(chunk); } }
    finally { clearTimeout(timeout); first.destroy(); }
    if (size !== binding.bytes || digest.digest('hex') !== binding.sha256) throw invalid('音频真实 SHA256 或长度不符。');
    const source = await this.objects.open(binding, head.etag);
    let consumed = 0;
    const bounded = new Transform({ transform(chunk, _encoding, callback) { consumed += chunk.length; callback(consumed > binding.bytes ? Error('MUSIC_STREAM_SIZE') : null, chunk); } });
    const timer = setTimeout(() => bounded.destroy(Error('MUSIC_VERIFY_TIMEOUT')), 60000); timer.unref();
    source.on('error', error => bounded.destroy(error)); source.pipe(bounded);
    let format;
    try { ({ format } = await parseStream(bounded, { size: binding.bytes }, { duration: true, skipCovers: true })); }
    catch { throw invalid('无法识别完整可播放的音频文件。'); }
    finally { clearTimeout(timer); source.destroy(); bounded.destroy(); }
    const container = format.container ?? '', codec = format.codec ?? '';
    const actual = /WAVE/.test(container) ? 'audio/wav' : /FLAC/.test(container) ? 'audio/flac' : /Ogg/.test(container) && /Vorbis|Opus/i.test(codec) ? 'audio/ogg' : /MPEG/.test(container) && /Layer 3/.test(codec) ? 'audio/mpeg' : null;
    if (actual !== binding.mime || !Number.isFinite(format.duration) || format.duration <= 0 || format.duration > MUSIC_LIMITS.maximumSeconds || !format.sampleRate || ![1, 2].includes(format.numberOfChannels)) throw invalid('格式、时长或声道不符合要求：仅支持双声道或单声道、最长30分钟的 MP3/WAV/FLAC/Ogg 音频。');
    return { durationSeconds: format.duration, extension: MUSIC_FORMATS[actual] };
  }
  publication(context, id, body) {
    if (typeof body.published !== 'boolean') throw fail(400, 'MUSIC_PUBLICATION', 'published 需为 true 或 false。');
    const operation = 'publication:' + id, ticket = this.previous(context, body, operation, { published: body.published, expectedRevision: body.expectedRevision }), row = this.row(id, context);
    // A delayed replay must never undo the owner's newer withdrawal.
    if (ticket.old) return { ...this.view(row, { privateView: true }), replayed: true };
    this.revision(row, body);
    if (body.published && row.state !== 'ready') throw fail(409, 'MUSIC_NOT_READY', '这还是歌词草稿或未验证的音频，不能公开播放。', '完成音频上传和 complete 后，再主动公开。');
    this.transaction(() => { this.store.db.prepare('UPDATE music_works SET published=?,revision=revision+1,updated_at=? WHERE id=?').run(body.published ? 1 : 0, this.now(), id); this.remember(context, ticket, operation, id); });
    this.store.audit(context.owner.id, body.published ? 'music.publish' : 'music.withdraw', id);
    return this.view(this.row(id, context), { privateView: true });
  }
  async playback(id, context, reauthorize) {
    const row = this.row(id, context);
    if (row.state !== 'ready') throw fail(409, 'MUSIC_NOT_READY', '音频尚未验证完成。');
    const location = await this.objects.playback(JSON.parse(row.binding));
    if (reauthorize) context = await reauthorize();
    this.row(id, context); // Withdrawal/ownership may change while signing.
    return location;
  }
}
