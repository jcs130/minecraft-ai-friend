import { createHash, timingSafeEqual } from 'node:crypto';
import { GameData, UUID } from './game-data.mjs';
import { WorldCatalog, playerNameValid } from './world-catalog.mjs';

const fail = (status, reason, message) => Object.assign(new Error(message), { status, reason });
const pick = (value, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(value || {}, key)).map(key => [key, value[key]]));
const kinds = ['agent', 'player', 'observer', 'admin'];
const privateStateFields = ['schemaVersion', 'freshness', 'source', 'observedAt', 'savedAt', 'unavailableReason', 'vitals', 'savedPosition', 'inventory', 'stats', 'account', 'progress'];
const rosterFields = ['name', 'playerUuid', 'kind', 'online', 'authenticated', 'statusSource', 'statusObservedAt', 'isReserved', 'identityConflict', 'identitySource', 'available', 'eye', 'observedAt'];
const summaryFields = ['name', 'online', 'version', 'playersOnline', 'playersMax', 'latencyMs', 'observedAt', 'rosterCount', 'agentCount', 'authHealthy', 'source', 'unavailableReason'];
const eventFields = ['id', 'kind', 'playerName', 'title', 'body', 'occurredAt', 'timePrecision', 'source'];
const forbiddenKeys = /^(?:password|password_hash|access_key_id|access_key_secret|api_key|apikey|accesskeyid|accesskeysecret|authorization|cookie|ip-address|ipaddress|lastip)$/i;

function noCredentials(value, depth = 0) {
  if (depth > 24) throw fail(400, 'SNAPSHOT_DEPTH', '同步资料嵌套过深');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.test(key)) throw fail(400, 'SNAPSHOT_PRIVATE_FIELD', '同步资料含不允许传输的凭据或网络字段');
    noCredentials(child, depth + 1);
  }
}

// The producer only reads the existing game projections; it never logs into a
// second body, runs RCON, or reads the authentication/model credential stores.
export async function buildSnapshot(game, world, sequence) {
  const [all, summary, growth] = await Promise.all([game.roster(), game.serverSummary(), world.players()]);
  const roster = all.slice(0, 256).map(row => pick(row, rosterFields));
  const states = {};
  const eligible = all.slice(0, 256).filter(row => row.available && !row.isReserved && row.kind !== 'observer');
  for (let offset = 0; offset < eligible.length; offset += 8) {
    await Promise.all(eligible.slice(offset, offset + 8).map(async row => { states[row.playerUuid] = pick(await game.playerState(row), privateStateFields); }));
  }
  const events = [];
  for (let page = 1; page <= 10; page++) {
    const result = await world.events({ page, limit: 50 });
    events.push(...result.events.filter(event => event.kind !== 'notice').map(row => pick(row, eventFields)));
    if (page >= result.pages) break;
  }
  const result = { schemaVersion: 1, sequence, observedAt: new Date().toISOString(), summary: pick(summary, summaryFields), roster,
    players: growth.players.map(row => pick(row, ['name', 'growth', 'savedAt', 'progressionSavedAt'])), states, events };
  noCredentials(result);
  return result;
}

export class CloudSource {
  constructor(config, store) {
    this.config = config; this.store = store; this.parsed = null;
    store.db.exec('CREATE TABLE IF NOT EXISTS server_snapshot(id INTEGER PRIMARY KEY CHECK(id=1),sequence INTEGER NOT NULL,observed_at INTEGER NOT NULL,received_at INTEGER NOT NULL,body_hash TEXT NOT NULL,payload TEXT NOT NULL)');
  }
  authorize(req) {
    if (this.config.sourceMode !== 'cloud' || !this.config.cloudSync.enabled) throw fail(404, 'NOT_FOUND', '未开放此接口');
    const token = /^Bearer (srv_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
    const expected = this.config.cloudSync.tokenHash;
    if (!token || !/^[a-f0-9]{64}$/.test(expected || '') || !timingSafeEqual(createHash('sha256').update(token).digest(), Buffer.from(expected, 'hex'))) throw fail(401, 'SYNC_CREDENTIAL_REQUIRED', '同步凭据无效');
  }
  read() {
    const row = this.store.db.prepare('SELECT * FROM server_snapshot WHERE id=1').get();
    if (!row) return null;
    if (this.parsed?.sequence !== row.sequence) this.parsed = { sequence: row.sequence, value: JSON.parse(row.payload) };
    return { ...row, value: this.parsed.value, stale: Date.now() - row.observed_at > this.config.cloudSync.staleAfterMs };
  }
  accept(input) {
    const observed = Date.parse(input.observedAt), now = Date.now();
    if (input.schemaVersion !== 1 || !Number.isSafeInteger(input.sequence) || input.sequence < 1 || !Number.isFinite(observed) || observed > now + 30000 || now - observed > 120000) throw fail(400, 'SNAPSHOT_INVALID', '同步版本、序号或采集时间无效');
    if (!Array.isArray(input.roster) || input.roster.length > 256 || !Array.isArray(input.players) || input.players.length > 256 || !Array.isArray(input.events) || input.events.length > 500 || !input.states || typeof input.states !== 'object' || Array.isArray(input.states)) throw fail(400, 'SNAPSHOT_INVALID', '同步目录超出范围');
    const names = new Set(), uuids = new Set();
    const roster = input.roster.map(row => {
      if (!playerNameValid(row.name) || !kinds.includes(row.kind) || row.playerUuid !== null && !UUID.test(row.playerUuid || '') || names.has(row.name.toLowerCase())) throw fail(400, 'SNAPSHOT_IDENTITY', '同步角色身份无效或重复');
      names.add(row.name.toLowerCase()); if (row.playerUuid) uuids.add(row.playerUuid);
      return pick(row, rosterFields);
    });
    const states = {};
    for (const [uuid, state] of Object.entries(input.states)) {
      if (!UUID.test(uuid) || !uuids.has(uuid)) throw fail(400, 'SNAPSHOT_IDENTITY', '角色资料不属于已核实目录');
      if (roster.some(row => row.playerUuid === uuid && (row.isReserved || row.kind === 'observer'))) throw fail(400, 'SNAPSHOT_RESERVED', '管理或观战身份不能同步私有资料');
      states[uuid] = pick(state, privateStateFields);
    }
    const players = input.players.map(row => {
      if (!names.has(String(row.name).toLowerCase())) throw fail(400, 'SNAPSHOT_IDENTITY', '成长记录不属于同步目录');
      return { name: row.name, growth: pick(row.growth, ['level', 'fame', 'completed', 'gradeIndex', 'rank', 'profession', 'certificates']), savedAt: row.savedAt, progressionSavedAt: row.progressionSavedAt };
    });
    const events = input.events.map(row => {
      if (!/^[a-f0-9]{64}$/.test(row.id || '') || !['join', 'leave', 'quest', 'advancement'].includes(row.kind) || !names.has(String(row.playerName).toLowerCase()) || typeof row.title !== 'string' || row.title.length > 400 || typeof row.body !== 'string' || row.body.length > 2000 || !Number.isFinite(Date.parse(row.occurredAt)) || !['day', 'second'].includes(row.timePrecision)) throw fail(400, 'SNAPSHOT_EVENT', '公开事件格式不受支持');
      return pick(row, eventFields);
    });
    const value = { schemaVersion: 1, sequence: input.sequence, observedAt: input.observedAt, roster, states, players, events, summary: pick(input.summary, summaryFields) };
    noCredentials(value);
    const payload = JSON.stringify(value), hash = createHash('sha256').update(payload).digest('hex');
    const previous = this.read();
    if (previous && (input.sequence <= previous.sequence || observed < previous.observed_at)) {
      if (input.sequence === previous.sequence && hash === previous.body_hash) return { accepted: true, duplicate: true, currentSequence: previous.sequence };
      throw Object.assign(fail(409, 'SNAPSHOT_SEQUENCE', '旧同步已拒绝，请采集新资料后使用更大序号'), { currentSequence: previous.sequence });
    }
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      this.store.db.prepare('INSERT OR REPLACE INTO server_snapshot VALUES(1,?,?,?,?,?)').run(input.sequence, observed, now, hash, payload);
      const insert = this.store.db.prepare('INSERT OR IGNORE INTO public_events VALUES(?,?,?,?,?,?,?,?)');
      for (const row of events) insert.run(row.id, row.kind, row.playerName, row.title, row.body, Date.parse(row.occurredAt), row.timePrecision, row.source);
      this.store.db.exec('COMMIT');
    } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    this.parsed = null;
    return { accepted: true, currentSequence: input.sequence, observedAt: input.observedAt };
  }
}

export class CloudGame {
  constructor(config, store, source) { this.config = config; this.salt = store.salt; this.source = source; }
  idFor(uuid, name) { return GameData.prototype.idFor.call(this, uuid, name); }
  publicAgent(row) { return GameData.prototype.publicAgent.call(this, row); }
  async roster() {
    const snapshot = this.source.read();
    return (snapshot?.value.roster || []).map(row => ({ ...row, id: this.idFor(row.playerUuid, row.name),
      online: snapshot.stale ? null : row.online, authenticated: snapshot.stale ? null : row.authenticated }));
  }
  async serverSummary() {
    const snapshot = this.source.read();
    return { name: this.config.siteName, ...(snapshot?.value.summary || {}),
      ...(snapshot?.stale || !snapshot ? { online: null, authHealthy: false, playersOnline: null, unavailableReason: '家庭端同步已离线或尚未连接；保存资料仍可查看' } : {}),
      source: 'home.outbound-snapshot', sync: { stale: !snapshot || snapshot.stale, observedAt: snapshot?.value.observedAt || null } };
  }
  async playerState(agent) {
    const snapshot = this.source.read(), saved = snapshot?.value.states[agent.playerUuid];
    return { ...(saved || { freshness: 'unavailable', unavailableReason: '尚未同步这个角色的保存资料', inventory: [] }), agent,
      liveState: { available: false, reason: '这里是服务器保存资料' },
      sync: { stale: !snapshot || snapshot.stale, observedAt: snapshot?.value.observedAt || null },
      connection: { body: 'external', portalConnected: false, controlAvailable: false, reason: '当前网站提供保存资料与只读直播' } };
  }
}

export class CloudWorld {
  constructor(config, game, store, source) { this.config = config; this.game = game; this.store = store; this.source = source; }
  async players() {
    const snapshot = this.source.read(), roster = await this.game.roster();
    return { players: (snapshot?.value.players || []).map(row => ({ ...this.game.publicAgent(roster.find(agent => agent.name.toLowerCase() === row.name.toLowerCase())), growth: row.growth, savedAt: row.savedAt, progressionSavedAt: row.progressionSavedAt })),
      freshness: 'saved', source: 'home.outbound-snapshot', observedAt: snapshot?.value.observedAt || null };
  }
  async collect() { }
  insert(event, identity) { WorldCatalog.prototype.insert.call(this, event, identity); }
  async events(query) { return WorldCatalog.prototype.events.call(this, query); }
}
