import {UUID} from './game-data.mjs';

const fail = (status, reason, message) => Object.assign(new Error(message), {status, reason});
const text = (value, max) => typeof value === 'string' && value.trim() && [...value.trim()].length <= max
  && !/[\p{Cc}\p{Cf}§]/u.test(value);
const numeric = value => Number.isSafeInteger(value) && value >= 0;

/** Independent body identity is reported by the game worker, never by a website editor. */
export class PlayerCompanions {
  constructor(store, now = Date.now) {
    this.store = store;
    this.db = store.db;
    this.now = now;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS player_companions (
        owner_uuid TEXT PRIMARY KEY, body_uuid TEXT UNIQUE NOT NULL, body_name TEXT NOT NULL,
        observed_at INTEGER NOT NULL, loaded INTEGER NOT NULL, active INTEGER NOT NULL,
        level INTEGER, profession TEXT, sound_pack TEXT, applied_revision INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0, name TEXT, persona TEXT
      );`);
  }

  row(owner, playerId) {
    if (!UUID.test(playerId) || !this.store.ownedUuids(owner.id).includes(playerId))
      throw fail(404, 'COMPANION_NOT_FOUND', '请在本人账号下绑定游戏角色。');
    const row = this.db.prepare('SELECT * FROM player_companions WHERE owner_uuid=?').get(playerId);
    if (!row) throw fail(404, 'COMPANION_NOT_FOUND', '请先进服，在罗盘领取你的伙伴。');
    return row;
  }

  list(owner) {
    return this.store.ownedUuids(owner.id).flatMap(id => {
      const row = this.db.prepare('SELECT * FROM player_companions WHERE owner_uuid=?').get(id);
      if (!row) return [];
      const online = this.now() - row.observed_at < 35_000;
      return [{
        playerId:id, name:row.name ?? row.body_name, persona:row.persona ?? '',
        actualName:row.body_name, bodyKind:'maid', observedAt:new Date(row.observed_at).toISOString(),
        online, active:online && !!row.active, loaded:online && !!row.loaded, level:row.level,
        profession:row.profession, soundPackId:row.sound_pack, revision:row.revision,
        appliedRevision:row.applied_revision,
      }];
    });
  }

  update(owner, playerId, input) {
    const row = this.row(owner, playerId);
    const persona = typeof input?.persona === 'string' ? input.persona.replace(/[\r\n\t]+/g,' ').trim() : null;
    if (!input || Object.keys(input).sort().join() !== 'expectedRevision,name,persona'
        || !numeric(input.expectedRevision) || !text(input.name,24) || !(persona === '' || text(persona,1200)))
      throw fail(400, 'COMPANION_PROFILE_INVALID', '名字限 24 字，人设限 1200 字。');
    if (row.revision !== input.expectedRevision)
      throw fail(409, 'COMPANION_PROFILE_CHANGED', '网站已有更新，请刷新伙伴资料。');
    const result = this.db.prepare('UPDATE player_companions SET name=?,persona=?,revision=revision+1 WHERE owner_uuid=? AND revision=?')
      .run(input.name.trim(),persona,playerId,input.expectedRevision);
    if (!result.changes) throw fail(409, 'COMPANION_PROFILE_CHANGED', '网站已有更新，请刷新伙伴资料。');
    this.store.audit(owner.id, 'companion.profile.saved', playerId);
    return this.list(owner).find(r => r.playerId === playerId);
  }

  poll(body) {
    if (!Array.isArray(body?.guides) || body.guides.length > 128)
      throw fail(400, 'COMPANION_ROSTER_INVALID', '伙伴目录格式无效。');
    const seen = new Set();
    const records = body.guides.map(row => {
      if (!UUID.test(row?.ownerId ?? '') || !UUID.test(row.maidId ?? '') || row.ownerId === row.maidId
          || seen.has(row.ownerId) || !text(row.name,24) || !numeric(row.profileRevision)
          || typeof row.loaded !== 'boolean' || typeof row.active !== 'boolean'
          || (row.level != null && (!numeric(row.level) || row.level > 10000))
          || (row.profession != null && !text(row.profession,48))
          || (row.soundPackId != null && !/^[a-z0-9_.:-]{1,96}$/i.test(row.soundPackId)))
        throw fail(400, 'COMPANION_ROSTER_INVALID', '伙伴身份或游戏状态无效。');
      seen.add(row.ownerId);
      return row;
    });
    const profiles = this.store.transaction(() => {
      const update = this.db.prepare(`INSERT INTO player_companions
        (owner_uuid,body_uuid,body_name,observed_at,loaded,active,level,profession,sound_pack,applied_revision,revision)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_uuid) DO UPDATE SET
        body_name=excluded.body_name,observed_at=excluded.observed_at,loaded=excluded.loaded,active=excluded.active,
        level=coalesce(excluded.level,level),profession=coalesce(excluded.profession,profession),
        sound_pack=coalesce(excluded.sound_pack,sound_pack),
        name=CASE WHEN excluded.applied_revision>revision THEN NULL ELSE name END,
        persona=CASE WHEN excluded.applied_revision>revision THEN NULL ELSE persona END,
        revision=max(revision,excluded.applied_revision),
        applied_revision=max(applied_revision,excluded.applied_revision)
        WHERE body_uuid=excluded.body_uuid`);
      const next = [];
      for (const row of records) {
        const result = update.run(row.ownerId,row.maidId,row.name,this.now(),Number(row.loaded),Number(row.active),
          row.level ?? null,row.profession ?? null,row.soundPackId ?? null,row.profileRevision,row.profileRevision);
        if (!result.changes) throw fail(409, 'COMPANION_BODY_CHANGED', '伙伴身体与原归属不一致。');
        const profile = this.db.prepare('SELECT revision,name,persona FROM player_companions WHERE owner_uuid=?').get(row.ownerId);
        if (profile.name !== null) next.push({ownerId:row.ownerId,maidId:row.maidId,...profile});
      }
      return next;
    });
    return {profiles};
  }
}
