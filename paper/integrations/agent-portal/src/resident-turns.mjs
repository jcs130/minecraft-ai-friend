import {createHash, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';

const prefix = '/api/v1/resident-turns';
const hash = value => createHash('sha256').update(value).digest('hex');
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const denied = (status, reason) => Object.assign(new Error(reason), {status, reason});
const idle = {state: 'local'};
const idleExpiry = 12 * 3600_000;

// One scoped desktop grant and at most one pending decision per original body.
// Grants survive a portal restart. An unfinished turn belongs to its original process.
export class ResidentTurns {
  constructor(config, store, {now = Date.now, waitMs = 35_000} = {}) {
    this.store = store;
    this.now = now;
    this.waitMs = waitMs;
    this.roles = new Map();
    store.db.exec('CREATE TABLE IF NOT EXISTS resident_grants (role TEXT PRIMARY KEY, body TEXT, character TEXT, kind TEXT, game_owner TEXT, owner TEXT, hash TEXT, until INTEGER)');
    const bodies = new Set(), keys = new Set(), characters = new Set();
    for (const r of config.residentTurns ?? []) {
      if (!/^[a-z][a-z0-9_-]{1,31}$/.test(r.id) || !['maid', 'numen'].includes(r.bodyKind)
          || ![r.bodyId, r.characterId, r.ownerGameId].every(v => uuid.test(v))
          || typeof r.name !== 'string' || !r.name.trim() || !/^[a-f0-9]{64}$/.test(r.workerHash)
          || keys.has(r.workerHash) || bodies.has(r.bodyId) || characters.has(r.characterId) || this.roles.has(r.id)) {
        throw Error('Invalid resident turn binding');
      }
      const saved = store.db.prepare('SELECT owner,hash,until FROM resident_grants WHERE role=? AND body=? AND character=? AND kind=? AND game_owner=? AND until>?')
        .get(r.id, r.bodyId, r.characterId, r.bodyKind, r.ownerGameId, this.now());
      this.roles.set(r.id, {...r, grant: saved ? {...saved, lastPoll: -Infinity} : null, pending: null});
      bodies.add(r.bodyId); keys.add(r.workerHash); characters.add(r.characterId);
    }
  }

  owns(owner, r) { return this.store.ownedUuids(owner).includes(r.ownerGameId); }
  describe(r) {
    const {id, name, bodyKind, bodyId, characterId} = r;
    return {id, name, bodyKind, bodyId, characterId};
  }
  clear(r) {
    if (r.grant) this.store.db.prepare('DELETE FROM resident_grants WHERE role=? AND hash=?').run(r.id, r.grant.hash);
    r.grant = null;
    r.pending?.finish(idle);
  }
  authorize(r, req, worker) {
    if (req.headers.origin || req.headers.cookie) throw denied(403, 'DESKTOP_OR_WORKER_REQUIRED');
    const value = (req.headers.authorization || '').match(/^Bearer (r[dw]t_[A-Za-z0-9_-]{43})$/)?.[1];
    const expected = worker ? r.workerHash : r.grant?.hash;
    if (!value?.startsWith(worker ? 'rwt_' : 'rdt_') || !expected
        || !timingSafeEqual(Buffer.from(hash(value)), Buffer.from(expected))) throw denied(401, 'INVALID_RESIDENT_TOKEN');
    if (!worker && !this.valid(r)) throw denied(401, 'RESIDENT_GRANT_EXPIRED');
  }
  valid(r) {
    if (r.grant && r.grant.until > this.now() && this.owns(r.grant.owner, r)
        && this.store.db.prepare('SELECT 1 FROM resident_grants WHERE role=? AND hash=?').get(r.id, r.grant.hash)) return true;
    this.clear(r);
    return false;
  }
  async machine(req, res, pathname, jsonBody, respond) {
    const match = /^\/api\/v1\/resident-turns\/([a-z][a-z0-9_-]{1,31})\/(offer|poll|reply)$/.exec(pathname);
    if (!match) return false;
    const r = this.roles.get(match[1]), op = match[2];
    if (req.method !== 'POST' || !r) throw denied(404, 'RESIDENT_NOT_FOUND');
    this.authorize(r, req, op === 'offer');
    const input = await jsonBody(req, op === 'offer' ? 160 * 1024 : op === 'reply' ? 16 * 1024 : 128);
    this.authorize(r, req, op === 'offer');
    let result;
    if (op === 'poll') {
      r.grant.lastPoll = this.now();
      if (r.grant.until - this.now() < idleExpiry - 300_000) {
        r.grant.until = this.now() + idleExpiry;
        this.store.db.prepare('UPDATE resident_grants SET until=? WHERE role=? AND hash=?').run(r.grant.until, r.id, r.grant.hash);
      }
      result = {turn: r.pending?.turn ?? null};
    } else if (op === 'reply') {
      if (!r.pending || r.pending.turn.id !== input.id || this.now() >= r.pending.turn.until) throw denied(409, 'STALE_TURN');
      if (!input.answer || typeof input.answer !== 'object' || Array.isArray(input.answer)) throw denied(400, 'INVALID_DECISION');
      r.pending.finish({state: 'answered', id: input.id, answer: input.answer});
      result = {accepted: true};
    } else {
      if (input.bodyId !== r.bodyId || input.characterId !== r.characterId || input.bodyKind !== r.bodyKind || input.ownerGameId !== r.ownerGameId
          || !['plan', 'dialogue'].includes(input.kind) || typeof input.instructions !== 'string'
          || !input.scene || typeof input.scene !== 'object' || Array.isArray(input.scene)) throw denied(400, 'INVALID_RESIDENT_TURN');
      result = idle;
      if (this.valid(r) && this.now() - r.grant.lastPoll < 15_000 && !r.pending && !res.destroyed) {
        const turn = {id: randomUUID(), until: Math.min(this.now() + this.waitMs, r.grant.until),
                      resident: this.describe(r), kind: input.kind, instructions: input.instructions, scene: input.scene};
        result = await new Promise(resolve => {
          const cancel = () => finish(idle);
          const finish = value => {
            clearTimeout(timer);
            res.off('close', cancel);
            r.pending = null;
            resolve(value);
          };
          const timer = setTimeout(cancel, Math.max(0, turn.until - this.now()));
          r.pending = {turn, finish};
          res.once('close', cancel);
        });
      }
    }
    if (!res.destroyed) respond(res, 200, result);
    return true;
  }
  browser(req, res, pathname, browserAuth, respond) {
    if (pathname === prefix && req.method === 'GET') {
      const {owner} = browserAuth(req);
      respond(res, 200, {residents: [...this.roles.values()].filter(r => this.owns(owner.id, r)).map(r => this.describe(r))});
      return true;
    }
    const match = /^\/api\/v1\/resident-turns\/([a-z][a-z0-9_-]{1,31})\/grant$/.exec(pathname);
    if (!match || !['POST', 'DELETE'].includes(req.method)) return false;
    const {owner} = browserAuth(req);
    const r = this.roles.get(match[1]);
    if (!r || !this.owns(owner.id, r)) throw denied(404, 'RESIDENT_NOT_OWNED');
    this.clear(r);
    if (req.method === 'DELETE') respond(res, 200, {released: true});
    else {
      const token = 'rdt_' + randomBytes(32).toString('base64url');
      r.grant = {owner: owner.id, hash: hash(token), until: this.now() + idleExpiry, lastPoll: -Infinity};
      this.store.db.prepare('INSERT OR REPLACE INTO resident_grants VALUES(?,?,?,?,?,?,?,?)')
        .run(r.id, r.bodyId, r.characterId, r.bodyKind, r.ownerGameId, owner.id, r.grant.hash, r.grant.until);
      respond(res, 201, {endpoint: req.portalOrigin.origin + prefix + '/' + r.id, token, expiresAt: r.grant.until, resident: this.describe(r)});
    }
    return true;
  }
}
