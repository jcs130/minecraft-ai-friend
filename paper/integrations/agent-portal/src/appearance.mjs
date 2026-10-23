import { randomUUID, timingSafeEqual } from 'node:crypto';
import { digest } from './store.mjs';
import { pngInfo, ysmArchive } from './appearance-files.mjs';

const fail = (status, reason, message) => Object.assign(Error(message), { status, reason });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const active = ['queued', 'waiting_player', 'applying', 'unknown'];
const cleanMessage = value => typeof value === 'string' && value.length <= 300 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
export class Appearance {
  constructor(config, store, game) {
    Object.assign(this, { config, store, game });
    store.db.exec(`CREATE TABLE IF NOT EXISTS appearance_assets(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES owners(id),player_uuid TEXT NOT NULL,kind TEXT NOT NULL,label TEXT NOT NULL,variant TEXT,sha256 TEXT NOT NULL,metadata TEXT NOT NULL,bytes BLOB NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS appearance_jobs(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES owners(id),player_uuid TEXT NOT NULL,name TEXT NOT NULL,asset_id TEXT NOT NULL REFERENCES appearance_assets(id),kind TEXT NOT NULL,texture TEXT,state TEXT NOT NULL,result TEXT,created_at INTEGER NOT NULL,dispatched_at INTEGER,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS appearance_bridge(id INTEGER PRIMARY KEY CHECK(id=1),ready INTEGER NOT NULL,received_at INTEGER NOT NULL);`);
    if (!store.db.prepare('PRAGMA table_info(appearance_assets)').all().some(row => row.name === 'removed_at')) store.db.exec('ALTER TABLE appearance_assets ADD COLUMN removed_at INTEGER');
  }
  capabilities() {
    const row = this.store.db.prepare('SELECT * FROM appearance_bridge WHERE id=1').get();
    const ready = this.config.appearance.bridgeEnabled === true && !!row?.ready && Date.now() - row.received_at < 20000;
    return { upload: this.config.appearance.enabled === true, ready, requiresOnlinePlayer: true,
      skin: '64×64 或 64×32 PNG，原版、兼容 Web 和基岩回退外观', ysm: '公开原始 ZIP；Java 需 YSM，Web 自动转换，基岩按模型投影能力处理',
      message: ready ? '外观同步在线；角色需在游戏内，提交后可查询实际结果。' : '可保存外观文件；应用将等待家庭端外观同步器上线，上传不代表已换装。' };
  }
  assertAgent(agent) { if (agent.kind !== 'agent' || agent.isReserved || agent.historical || !uuid.test(agent.playerUuid) || /eye$/i.test(agent.name)) throw fail(403, 'APPEARANCE_ROLE', '外观仅供已绑定的当前 Agent 使用；历史身体、Eye 与管理身份不能换装'); }
  list(agent) {
    this.assertAgent(agent);
    const assets = this.store.db.prepare('SELECT id,kind,label,variant,sha256,metadata,length(bytes) AS size,created_at FROM appearance_assets WHERE player_uuid=? AND removed_at IS NULL ORDER BY created_at DESC').all(agent.playerUuid)
      .map(row => ({ id: row.id, kind: row.kind, label: row.label, variant: row.variant, sha256: row.sha256, ...JSON.parse(row.metadata), bytes: row.size, createdAt: new Date(row.created_at).toISOString(), ...(row.kind === 'skin' ? { image: `/api/v1/agents/${agent.id}/appearance/assets/${row.id}` } : {}) }));
    const jobs = this.store.db.prepare('SELECT id,asset_id,kind,texture,state,result,created_at,updated_at FROM appearance_jobs WHERE player_uuid=? ORDER BY created_at DESC LIMIT 12').all(agent.playerUuid)
      .map(row => ({ id: row.id, assetId: row.asset_id, kind: row.kind, texture: row.texture, state: row.state, result: row.result ? JSON.parse(row.result) : null, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() }));
    return { capabilities: this.capabilities(), assets, jobs, limits: { maxUploadBytes: 8 * 1024 * 1024, maxAssetsPerKind: 4, ownerBytes: 32 * 1024 * 1024 } };
  }
  upload(agent, owner, kind, bytes, fields) {
    this.assertAgent(agent);
    if (!this.config.appearance.enabled) throw fail(403, 'APPEARANCE_DISABLED', '外观上传暂未开放');
    if (!['skin', 'ysm'].includes(kind)) throw fail(400, 'APPEARANCE_KIND', '请选择普通皮肤或 YSM 模型');
    if (fields.consent !== 'public-game-appearance') throw fail(400, 'APPEARANCE_CONSENT', '请确认有权使用并公开展示这份游戏外观；普通皮肤会送交签名服务生成原版材质');
    if (typeof fields.label !== 'string' || fields.label.length < 1 || fields.label.length > 60 || /[\x00-\x1f]/.test(fields.label)) throw fail(400, 'APPEARANCE_LABEL', '外观名称需为 1–60 字');
    if (kind === 'skin' && !['classic', 'slim'].includes(fields.variant)) throw fail(400, 'SKIN_VARIANT', '请选择标准或纤细手臂');
    const metadata = kind === 'skin' ? pngInfo(bytes, true) : ysmArchive(bytes), duplicate = this.store.db.prepare('SELECT id FROM appearance_assets WHERE player_uuid=? AND kind=? AND sha256=? AND COALESCE(variant,?)=? AND removed_at IS NULL').get(agent.playerUuid, kind, metadata.sha256, '', kind === 'skin' ? fields.variant : '');
    if (duplicate) return this.list(agent);
    if (this.store.db.prepare('SELECT count(*) AS n FROM appearance_assets WHERE player_uuid=? AND kind=? AND removed_at IS NULL').get(agent.playerUuid, kind).n >= 4) throw fail(409, 'APPEARANCE_LIMIT', '每个角色每类最多 4 份外观，请先移除不再使用的文件');
    if (this.store.db.prepare('SELECT COALESCE(sum(length(bytes)),0) AS n FROM appearance_assets WHERE owner_id=?').get(owner.id).n + bytes.length > 32 * 1024 * 1024) throw fail(409, 'APPEARANCE_QUOTA', '你的外观文件已达到 32MB，请先移除旧文件');
    this.store.db.prepare('INSERT INTO appearance_assets(id,owner_id,player_uuid,kind,label,variant,sha256,metadata,bytes,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), owner.id, agent.playerUuid, kind, fields.label, kind === 'skin' ? fields.variant : null, metadata.sha256, JSON.stringify(metadata), bytes, Date.now());
    this.store.audit(owner.id, 'appearance.upload', agent.id); return this.list(agent);
  }
  image(agent, id) {
    const row = this.store.db.prepare("SELECT bytes FROM appearance_assets WHERE id=? AND player_uuid=? AND kind='skin' AND removed_at IS NULL").get(id, agent.playerUuid);
    if (!row) throw fail(404, 'APPEARANCE_NOT_FOUND', '没有这份普通皮肤'); return Buffer.from(row.bytes);
  }
  remove(agent, owner, id) {
    this.assertAgent(agent);
    const row = this.store.db.prepare('SELECT * FROM appearance_assets WHERE id=? AND player_uuid=? AND removed_at IS NULL').get(id, agent.playerUuid);
    if (!row) throw fail(404, 'APPEARANCE_NOT_FOUND', '未找到这份外观');
    const jobs = this.store.db.prepare('SELECT state FROM appearance_jobs WHERE asset_id=? ORDER BY created_at DESC').all(id);
    const current = this.store.db.prepare("SELECT asset_id FROM appearance_jobs WHERE player_uuid=? AND kind=? AND state='applied' ORDER BY updated_at DESC LIMIT 1").get(agent.playerUuid, row.kind);
    if (jobs.some(job => active.includes(job.state)) || current?.asset_id === id) throw fail(409, 'APPEARANCE_IN_USE', '这份外观正在应用或仍是当前绑定；先应用另一份，再移除旧文件');
    // Keep the original receipt identity, including late acknowledgements, but
    // release file storage only after explicit owner removal of an unused file.
    this.store.db.prepare("UPDATE appearance_assets SET removed_at=?,bytes=x'' WHERE id=?").run(Date.now(), id); this.store.audit(owner.id, 'appearance.remove', agent.id); return this.list(agent);
  }
  apply(agent, owner, body) {
    this.assertAgent(agent);
    if (!this.config.appearance.enabled) throw fail(403, 'APPEARANCE_DISABLED', '外观应用暂未开放');
    if (!uuid.test(body.requestId || '')) throw fail(400, 'REQUEST_ID_REQUIRED', '先保存本次应用请求标识，结果未知时查询原请求');
    const asset = this.store.db.prepare('SELECT * FROM appearance_assets WHERE id=? AND player_uuid=? AND removed_at IS NULL').get(body.assetId, agent.playerUuid);
    if (!asset) throw fail(404, 'APPEARANCE_NOT_FOUND', '请先上传属于这个角色的外观文件');
    const textures = JSON.parse(asset.metadata).textures || [];
    const texture = asset.kind === 'ysm' ? body.texture || textures[0].name : null;
    if (asset.kind === 'ysm' && !textures.some(row => row.name === texture)) throw fail(400, 'YSM_TEXTURE_UNKNOWN', '请选择这份模型已有的贴图');
    const previous = this.store.db.prepare('SELECT * FROM appearance_jobs WHERE id=?').get(body.requestId);
    if (previous) {
      if (previous.owner_id !== owner.id || previous.player_uuid !== agent.playerUuid || previous.asset_id !== asset.id || previous.texture !== texture) throw fail(409, 'APPEARANCE_REQUEST_CONFLICT', '请求标识已用于其他外观，请查询原结果');
      return this.list(agent);
    }
    if (this.store.db.prepare("SELECT id FROM appearance_jobs WHERE player_uuid=? AND kind=? AND state IN ('queued','waiting_player','applying','unknown')").get(agent.playerUuid, asset.kind)) throw fail(409, 'APPEARANCE_PENDING', '这类外观已有待确认请求，请刷新查询原结果，不重复应用');
    const now = Date.now();
    this.store.db.prepare('INSERT INTO appearance_jobs VALUES(?,?,?,?,?,?,?,\'queued\',NULL,?,NULL,?)').run(body.requestId, owner.id, agent.playerUuid, agent.name, asset.id, asset.kind, texture, now, now);
    this.store.audit(owner.id, 'appearance.apply', agent.id); return this.list(agent);
  }
  authorize(req) {
    if (!this.config.appearance.bridgeEnabled) throw fail(404, 'NOT_FOUND', '未开放此接口');
    const token = /^Bearer (app_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1], hash = this.config.appearance.tokenHash || '';
    if (!token || !/^[a-f0-9]{64}$/.test(hash) || !timingSafeEqual(Buffer.from(digest(token)), Buffer.from(hash))) throw fail(401, 'APPEARANCE_BRIDGE_CREDENTIAL', '外观同步凭据无效');
  }
  async poll(body) {
    if (typeof body.ready !== 'boolean' || !Number.isFinite(body.at) || Math.abs(Date.now() - body.at) > 10000 || !Array.isArray(body.results) || body.results.length > 8) throw fail(400, 'APPEARANCE_POLL', '外观同步内容无效');
    const acknowledged = [], validated = [];
    for (const result of body.results) {
      const job = uuid.test(result.id || '') ? this.store.db.prepare('SELECT j.*,a.sha256,a.variant,a.metadata FROM appearance_jobs j JOIN appearance_assets a ON a.id=j.asset_id WHERE j.id=?').get(result.id) : null;
      if (!job || !job.dispatched_at || result.playerUuid !== job.player_uuid || result.sha256 !== job.sha256 || !['waiting_player', 'applying', 'applied', 'failed', 'unknown'].includes(result.state) || !cleanMessage(result.message) || !/^[A-Z_]{3,80}$/.test(result.reason || '')) throw fail(400, 'APPEARANCE_RESULT', '外观回执与原角色或文件不一致');
      if (job.state === 'applied' && result.state !== 'applied' || job.state === 'failed' && result.state !== 'failed') throw fail(409, 'APPEARANCE_FINAL', '最终结果不可覆盖');
      const expected = job.kind === 'ysm' ? `qd_${job.player_uuid.replaceAll('-', '').slice(0, 12)}_${job.sha256.slice(0, 12)}` : `web_${job.sha256.slice(0, 20)}_${job.variant}`;
      const reuse = job.kind === 'ysm' && result.reusedExisting === true && /^[A-Za-z0-9_.-]{1,96}$/.test(result.identifier || '') && result.sourceSha256 === JSON.parse(job.metadata).sourceSha256;
      if (result.state === 'applied' && (result.identifier !== expected && !reuse || job.kind === 'ysm' && (result.texture !== job.texture || result.webAvailable !== true))) throw fail(400, 'APPEARANCE_CONFIRMATION', '应用成功需要实际模型、贴图与 Web 转换结果确认');
      validated.push({ job, result }); acknowledged.push(result.id);
    }
    // Recheck ownership at dispatch: a stale upload cannot change a role which
    // has since been transferred to another owner.
    const roster = await this.game.roster();
    for (const { job, result } of validated) this.store.db.prepare('UPDATE appearance_jobs SET state=?,result=?,updated_at=? WHERE id=?').run(result.state, JSON.stringify(result), Date.now(), job.id);
    this.store.db.prepare('INSERT INTO appearance_bridge VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET ready=excluded.ready,received_at=excluded.received_at').run(body.ready ? 1 : 0, Date.now());
      const candidates = body.ready ? this.store.db.prepare("SELECT j.*,a.sha256,a.variant,a.metadata,a.bytes FROM appearance_jobs j JOIN appearance_assets a ON a.id=j.asset_id WHERE j.state IN ('queued','waiting_player','applying','unknown') ORDER BY j.updated_at,j.created_at LIMIT 8").all() : [];
    const requests = [];
    for (const row of candidates) {
      const binding = this.store.db.prepare('SELECT owner_id FROM ownerships WHERE agent_uuid=?').get(row.player_uuid);
      const player = roster.find(agent => agent.playerUuid === row.player_uuid && agent.name === row.name && !agent.identityConflict && !agent.isReserved && agent.kind === 'agent');
      // A changed owner invalidates even admin-created pending requests.
      if (!player || binding?.owner_id !== row.owner_id) {
        if (!row.dispatched_at) this.store.db.prepare('UPDATE appearance_jobs SET state=\'failed\',result=?,updated_at=? WHERE id=?').run(JSON.stringify({ reason: 'APPEARANCE_OWNERSHIP_CHANGED', message: '原角色归属已变化，没有执行；请由当前主人重新申请。' }), Date.now(), row.id);
        continue;
      }
      const first = !row.dispatched_at;
      this.store.db.prepare('UPDATE appearance_jobs SET dispatched_at=COALESCE(dispatched_at,?) WHERE id=?').run(Date.now(), row.id);
      requests.push({ id: row.id, playerUuid: row.player_uuid, username: row.name, kind: row.kind, sha256: row.sha256, variant: row.variant, texture: row.texture,
        ...(row.kind === 'ysm' ? { sourceSha256: JSON.parse(row.metadata).sourceSha256 } : {}),
        // The worker may query/reconcile a delivered operation, never replay it.
        reconciliationOnly: !first, ...(first ? { base64: Buffer.from(row.bytes).toString('base64') } : {}) });
      if (requests.length >= 1) break;
    }
    return { acknowledged, requests };
  }
  signingImage(hash) {
    const row = /^[a-f0-9]{64}$/.test(hash) ? this.store.db.prepare("SELECT a.bytes FROM appearance_assets a JOIN appearance_jobs j ON j.asset_id=a.id WHERE a.kind='skin' AND a.sha256=? AND a.removed_at IS NULL AND j.dispatched_at IS NOT NULL AND j.created_at>? ORDER BY j.created_at DESC LIMIT 1").get(hash, Date.now() - 6 * 3600000) : null;
    if (!row) throw fail(404, 'NOT_FOUND', '图片不存在或签名窗口已结束'); return Buffer.from(row.bytes);
  }
}
