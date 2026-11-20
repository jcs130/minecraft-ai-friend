import {createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual} from 'node:crypto';

const prefix = '/api/v1/resident-turns';
const hash = value => createHash('sha256').update(value).digest('hex');
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const denied = (status, reason) => Object.assign(new Error(reason), {status, reason});
const idle = {state: 'local'};
const idleExpiry = 12 * 3600_000;
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const codeFormat = /^[2-9A-HJ-NP-Z]{4}(?:-[2-9A-HJ-NP-Z]{4}){2}$/;
const newCode = () => [...randomBytes(12)].map(b => alphabet[b % alphabet.length]).join('').match(/.{4}/g).join('-');
const bindingKey = r => JSON.stringify([r.id,r.bodyId,r.characterId,r.bodyKind,r.ownerGameId]);
const browserLoginExpiry = 300_000;
const accountExpiry = 900_000;
const planningStates = new Set(['pending','completed','deferred','rejected','unavailable']);
const diagnosticPart = /^[a-zA-Z0-9_:-]{1,80}$/;

function residentActivity(value, updatedAt) {
  if (!value || typeof value.turnHash !== 'string' || !/^[0-9a-f]{12}$/.test(value.turnHash)
      || !planningStates.has(value.planningStatus)) return null;
  const {turnHash, planningStatus, completedActions, failedActions, pendingActions, planningError} = value;
  if (![completedActions, failedActions, pendingActions].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 32)) return null;
  const activity = {turnHash, planningStatus, completedActions, failedActions, pendingActions, updatedAt};
  if (typeof planningError?.step === 'string' && diagnosticPart.test(planningError.step)
      && typeof planningError.code === 'string' && diagnosticPart.test(planningError.code)) {
    activity.planningError = {step:planningError.step, code:planningError.code};
  }
  if (typeof value.transferError === 'string' && /^rendezvous_[a-z_]{1,65}$/.test(value.transferError)) {
    activity.transferError = value.transferError;
  }
  return activity;
}

function communicationAllowed(turn, answer) {
  if (!Object.hasOwn(answer, 'communication')) return true;
  const msg = answer.communication, channel = turn.scene.communication;
  return channel && msg && typeof msg === 'object' && Object.keys(answer).length === 1
    && Object.keys(msg).every(key => ['mode','sourceEventId','text'].includes(key))
    && typeof msg.text === 'string' && msg.text.trim() && [...msg.text.trim()].length <= channel.maxTextChars
    && !/[\p{C}\p{Zl}\p{Zp}§]/u.test(msg.text)
    && channel.outputs?.filter(o => o.mode === msg.mode && o.sourceEventId === msg.sourceEventId).length === 1;
}

// One scoped desktop grant and at most one pending decision per original body.
// Grants survive a portal restart. An unfinished turn belongs to its original process.
export class ResidentTurns {
  constructor(config, store, {now = Date.now, waitMs = 35_000} = {}) {
    this.store = store;
    this.now = now;
    this.waitMs = waitMs;
    this.maidOnlyCreation = config.residentCreationMode === 'maid-only';
    if (config.residentCreationMode !== undefined && !this.maidOnlyCreation) {
      throw Error('Invalid resident creation mode');
    }
    this.roles = new Map();
    store.db.exec(`CREATE TABLE IF NOT EXISTS resident_onboarding (
      owner TEXT NOT NULL, code_hash TEXT UNIQUE, code_until INTEGER, token_hash TEXT UNIQUE, token_until INTEGER, connected TEXT)`);
    store.db.exec('CREATE TABLE IF NOT EXISTS resident_grants (role TEXT PRIMARY KEY, body TEXT, character TEXT, kind TEXT, game_owner TEXT, owner TEXT, hash TEXT, until INTEGER)');
    store.db.exec(`CREATE TABLE IF NOT EXISTS resident_births (
      role TEXT PRIMARY KEY, body TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, game_owner TEXT NOT NULL,
      character TEXT UNIQUE NOT NULL, owner TEXT NOT NULL, request TEXT NOT NULL, name TEXT NOT NULL,
      persona TEXT NOT NULL, ready INTEGER NOT NULL DEFAULT 0, UNIQUE(owner,request));
      CREATE TABLE IF NOT EXISTS resident_pair_codes (
      role TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, owner TEXT NOT NULL, until INTEGER NOT NULL, binding TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS resident_browser_logins (
        id TEXT PRIMARY KEY, secret_hash TEXT UNIQUE NOT NULL, code_hash TEXT NOT NULL,
        until INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, owner TEXT, token_until INTEGER)`);
    const bodies = new Set(), keys = new Set(), characters = new Set();
    for (const raw of [...(config.residentTurns ?? []), ...(config.residentCreationSlots ?? []).map(s => ({...s, fresh: true}))]) {
      const r = {...raw};
      const previous = store.db.prepare('SELECT role,body FROM resident_births WHERE role=? OR body=? OR character=?')
        .all(r.id,r.bodyId,r.characterId ?? null);
      if (previous.some(b => !r.fresh || b.role !== r.id || b.body !== r.bodyId)) throw Error('Resident birth binding changed');
      if (r.fresh) {
        const born = store.db.prepare('SELECT * FROM resident_births WHERE role=?').get(r.id);
        if (born && (born.body !== r.bodyId || born.kind !== r.bodyKind || born.game_owner !== r.ownerGameId)) throw Error('Resident birth binding changed');
        r.characterId = born?.character ?? null;
        r.name = born?.name ?? r.id;
        r.creator = born?.owner;
        r.ready = !!born?.ready;
      }
      if (!/^[a-z][a-z0-9_-]{1,31}$/.test(r.id) || !['maid', 'numen'].includes(r.bodyKind)
          || ![r.bodyId, r.ownerGameId].every(v => uuid.test(v)) || r.bodyId === r.ownerGameId
          || (r.websiteOwnerId != null && (r.fresh || !uuid.test(r.websiteOwnerId)))
          || (!(r.fresh && !r.characterId) && !uuid.test(r.characterId))
          || typeof r.name !== 'string' || !r.name.trim() || !/^[a-f0-9]{64}$/.test(r.workerHash)
          || keys.has(r.workerHash) || bodies.has(r.bodyId) || r.characterId && characters.has(r.characterId) || this.roles.has(r.id)) {
        throw Error('Invalid resident turn binding');
      }
      const saved = store.db.prepare('SELECT owner,hash,until FROM resident_grants WHERE role=? AND body=? AND character=? AND kind=? AND game_owner=? AND until>?')
        .get(r.id, r.bodyId, r.characterId, r.bodyKind, r.ownerGameId, this.now());
      this.roles.set(r.id, {...r, grant: saved ? {...saved, lastPoll: -Infinity} : null, pending: null});
      bodies.add(r.bodyId); keys.add(r.workerHash); characters.add(r.characterId);
    }
  }

  owns(owner, r) {
    if (!owner) return false;
    if (r.websiteOwnerId) {
      return r.websiteOwnerId === owner && !!this.store.ownerById(owner) && this.nativeOwnerAllows(r,owner);
    }
    if (!r.fresh) return this.store.ownedUuids(owner).includes(r.ownerGameId);
    return r.creator === owner && !!this.store.ownerById(owner) && this.nativeOwnerAllows(r,owner);
  }
  nativeOwnerAllows(r,owner) {
    const linked = this.store.db.prepare('SELECT owner_id FROM ownerships WHERE agent_uuid=?').get(r.ownerGameId);
    return !linked || linked.owner_id === owner;
  }
  canCreate(owner,r) {
    return r.fresh && !r.creator && this.nativeOwnerAllows(r,owner);
  }
  list(owner) {
    const roles = [...this.roles.values()];
    return {residents: roles.filter(r => this.owns(owner,r)).map(r => this.describe(r)),
            availableBodies: [...new Set(roles.filter(r => this.canCreate(owner,r)
                && (!this.maidOnlyCreation || r.bodyKind === 'maid')).map(r => r.bodyKind))],
            ...(this.maidOnlyCreation ? {creationMode:'maid-only'} : {})};
  }
  describe(r) {
    const {id, name, bodyKind, bodyId, characterId} = r;
    return {id, name, bodyKind, bodyId, characterId, state: r.fresh && !r.ready ? 'preparing' : 'available'};
  }
  clear(r) {
    if (r.grant) this.store.db.prepare('DELETE FROM resident_grants WHERE role=? AND hash=?').run(r.id, r.grant.hash);
    r.grant = null;
    r.wake = null;
    r.pending?.finish(idle);
  }
  grant(r, owner, origin, token = 'rdt_' + randomBytes(32).toString('base64url'), accountTokenHash = null) {
    if (!this.owns(owner, r) || r.fresh && !r.ready) throw denied(409, 'RESIDENT_NOT_READY');
    const grant = {owner, hash: hash(token), until: this.now() + idleExpiry, lastPoll: -Infinity};
    const db = this.store.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT OR REPLACE INTO resident_grants VALUES(?,?,?,?,?,?,?,?)')
        .run(r.id,r.bodyId,r.characterId,r.bodyKind,r.ownerGameId,owner,grant.hash,grant.until);
      db.prepare('DELETE FROM resident_pair_codes WHERE role=?').run(r.id);
      if (accountTokenHash) {
        const result = db.prepare('UPDATE resident_onboarding SET connected=? WHERE token_hash=? AND owner=? AND connected IS NULL AND token_until>?')
          .run(bindingKey(r),accountTokenHash,owner,this.now());
        if (!result.changes) throw denied(401,'ONBOARDING_EXPIRED');
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    r.wake = null;
    r.pending?.finish(idle);
    r.grant = grant;
    return {endpoint: origin + prefix + '/' + r.id, token, expiresAt: r.grant.until, resident: this.describe(r)};
  }
  async exchange(req, res, jsonBody, respond) {
    if (req.method !== 'POST' || req.headers.origin || req.headers.cookie || req.headers.authorization) throw denied(403,'PLUGIN_REQUIRED');
    const {code} = await jsonBody(req, 128);
    if (typeof code !== 'string' || !codeFormat.test(code)) throw denied(400,'INVALID_PAIR_CODE');
    const row = this.store.db.prepare('SELECT role,owner,binding FROM resident_pair_codes WHERE hash=? AND until>?').get(hash(code), this.now());
    const r = row && this.roles.get(row.role);
    if (!r || row.binding !== bindingKey(r) || !this.owns(row.owner, r)) throw denied(403, 'PAIR_CODE_EXPIRED');
    respond(res, 200, this.grant(r, row.owner, req.portalOrigin.origin));
  }
  create(owner, input) {
    if (typeof input.requestId !== 'string' || !uuid.test(input.requestId) || !['maid','numen'].includes(input.bodyKind)
        || typeof input.name !== 'string' || !/^[\p{L}\p{N}_· -]{1,24}$/u.test(input.name) || !input.name.trim()
        || typeof (input.persona ?? '') !== 'string' || (input.persona ?? '').length > 1000) throw denied(400, 'INVALID_RESIDENT_PROFILE');
    const db = this.store.db, name = input.name.trim(), persona = (input.persona ?? '').trim();
    db.exec('BEGIN IMMEDIATE');
    try {
      let born = db.prepare('SELECT * FROM resident_births WHERE owner=? AND request=?').get(owner, input.requestId);
      if (born && (name !== born.name || persona !== born.persona || input.bodyKind !== born.kind)) throw denied(409,'CREATION_REQUEST_CHANGED');
      if (!born) {
        if (this.maidOnlyCreation && input.bodyKind !== 'maid') throw denied(403,'MAID_ONLY');
        const slot = [...this.roles.values()].find(r => this.canCreate(owner,r) && r.bodyKind === input.bodyKind
          && !db.prepare('SELECT 1 FROM resident_births WHERE role=? OR body=?').get(r.id,r.bodyId));
        if (!slot) throw denied(409,'NO_BODY_CAPACITY');
        db.prepare('INSERT INTO resident_births(role,body,kind,game_owner,character,owner,request,name,persona) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(slot.id,slot.bodyId,slot.bodyKind,slot.ownerGameId,randomUUID(),owner,input.requestId,name,persona);
        born = db.prepare('SELECT * FROM resident_births WHERE role=?').get(slot.id);
      }
      const r = this.roles.get(born.role);
      if (!r) throw denied(503,'BODY_CONFIGURATION_UNAVAILABLE');
      db.exec('COMMIT');
      Object.assign(r,{characterId:born.character,creator:born.owner,name:born.name,ready:!!born.ready});
      return this.describe(r);
    } catch(e) { db.exec('ROLLBACK'); throw e; }
  }
  onboardingCode(owner) {
    const code = newCode(), expiresAt = this.now() + 300_000;
    this.store.db.prepare('DELETE FROM resident_onboarding WHERE coalesce(token_until,code_until)<=?').run(this.now());
    this.store.db.prepare('INSERT INTO resident_onboarding(owner,code_hash,code_until) VALUES(?,?,?)')
      .run(owner,hash(code),expiresAt);
    return {code,expiresAt};
  }
  startBrowserLogin() {
    const id = randomUUID();
    const secret = 'rba_' + randomBytes(32).toString('base64url');
    const code = String(randomInt(1_000_000)).padStart(6, '0');
    const expiresAt = this.now() + browserLoginExpiry;
    const db = this.store.db;
    db.prepare('DELETE FROM resident_browser_logins WHERE until<=?').run(this.now());
    db.prepare('INSERT INTO resident_browser_logins(id,secret_hash,code_hash,until) VALUES(?,?,?,?)')
      .run(id,hash(secret),hash(id + code),expiresAt);
    return {id,secret,code,expiresAt};
  }
  approveBrowserLogin(owner, {id, code}) {
    if (typeof id !== 'string' || !uuid.test(id) || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      throw denied(400,'INVALID_BROWSER_LOGIN');
    }
    const db = this.store.db, now = this.now();
    const pending = db.prepare('SELECT * FROM resident_browser_logins WHERE id=? AND until>? AND attempts<5').get(id,now);
    if (!pending || (pending.owner && pending.owner !== owner)) throw denied(403,'BROWSER_LOGIN_EXPIRED');
    if (!timingSafeEqual(Buffer.from(hash(id + code)), Buffer.from(pending.code_hash))) {
      db.prepare('UPDATE resident_browser_logins SET attempts=attempts+1 WHERE id=? AND owner IS NULL').run(id);
      throw denied(400,'INVALID_BROWSER_LOGIN');
    }
    if (!pending.owner) db.prepare('UPDATE resident_browser_logins SET owner=?,token_until=? WHERE id=? AND owner IS NULL')
      .run(owner,now + accountExpiry,id);
    return {authorized:true};
  }
  browserLoginStatus(req) {
    const secret = (req.headers.authorization || '').match(/^Bearer (rba_[A-Za-z0-9_-]{43})$/)?.[1];
    const db = this.store.db, now = this.now();
    const pending = secret && db.prepare('SELECT * FROM resident_browser_logins WHERE secret_hash=? AND until>? AND attempts<5')
      .get(hash(secret),now);
    if (!pending) throw denied(401,'BROWSER_LOGIN_EXPIRED');
    if (!pending.owner) return {state:'pending'};
    // Recover the same account grant after a lost response, without storing a cleartext credential.
    const token = 'rot_' + createHmac('sha256',secret).update('resident-browser-authorization').digest('base64url');
    db.prepare('DELETE FROM resident_onboarding WHERE coalesce(token_until,code_until)<=?').run(now);
    db.prepare('INSERT OR IGNORE INTO resident_onboarding(owner,token_hash,token_until) VALUES(?,?,?)')
      .run(pending.owner,hash(token),pending.token_until);
    return {state:'authorized',onboardingToken:token,expiresAt:pending.token_until};
  }
  async onboarding(req,res,op,jsonBody,respond) {
    if (req.method !== 'POST' || req.headers.origin || req.headers.cookie) throw denied(403,'PLUGIN_REQUIRED');
    const input = await jsonBody(req, op === 'create' ? 8192 : 512), db = this.store.db;
    if (op === 'browser-start') {
      if (req.headers.authorization) throw denied(403,'PLUGIN_REQUIRED');
      return respond(res,201,this.startBrowserLogin());
    }
    if (op === 'browser-status') return respond(res,200,this.browserLoginStatus(req));
    if (op === 'pair') {
      if (req.headers.authorization || typeof input.code !== 'string' || !codeFormat.test(input.code)) throw denied(400,'INVALID_PAIR_CODE');
      const token = 'rot_' + randomBytes(32).toString('base64url'), expiresAt = this.now() + accountExpiry;
      const changed = db.prepare('UPDATE resident_onboarding SET code_hash=NULL,code_until=NULL,token_hash=?,token_until=? WHERE code_hash=? AND code_until>?')
        .run(hash(token), expiresAt, hash(input.code), this.now());
      if (!changed.changes) throw denied(403,'PAIR_CODE_EXPIRED');
      return respond(res,200,{onboardingToken:token,expiresAt});
    }
    const token = (req.headers.authorization || '').match(/^Bearer (rot_[A-Za-z0-9_-]{43})$/)?.[1];
    const auth = token && db.prepare('SELECT owner,connected FROM resident_onboarding JOIN owners ON owners.id=owner WHERE token_hash=? AND token_until>?')
      .get(hash(token),this.now());
    if (!auth || (auth.connected && op !== 'connect')) throw denied(401,'ONBOARDING_EXPIRED');
    const {owner} = auth;
    if (op === 'list') return respond(res,200,this.list(owner));
    if (op === 'create') return respond(res,201,{resident:this.create(owner,input)});
    const r = this.roles.get(input.id);
    if (!r || !this.owns(owner,r) || !r.characterId || r.characterId !== input.characterId) throw denied(404,'RESIDENT_NOT_OWNED');
    const binding = bindingKey(r);
    // A lost HTTP response can recover only the identical, still-active single-body grant.
    const bodyToken = 'rdt_' + createHmac('sha256', token).update(binding).digest('base64url');
    if (auth.connected) {
      if (auth.connected !== binding || !this.valid(r) || r.grant.hash !== hash(bodyToken)) throw denied(401,'ONBOARDING_EXPIRED');
      return respond(res,200,{endpoint:req.portalOrigin.origin + prefix + '/' + r.id,token:bodyToken,expiresAt:r.grant.until,resident:this.describe(r)});
    }
    return respond(res,200,this.grant(r,owner,req.portalOrigin.origin,bodyToken,hash(token)));
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
  pollingPrincipal(req, pathname) {
    const match = /^\/api\/v1\/resident-turns\/([a-z][a-z0-9_-]{1,31})\/(offer|check|activation|poll|begin|reply)$/.exec(pathname);
    const r = match && this.roles.get(match[1]);
    if (!r || req.method !== 'POST') return;
    const worker = ['offer','check','activation'].includes(match[2]);
    try { this.authorize(r,req,worker); return (worker ? 'worker:' : 'desktop:') + r.id; }
    catch { return; }
  }
  operatorActivity() {
    const freshAfter = this.now() - 20_000;
    return [...this.roles.values()]
      .filter(r => r.activity?.updatedAt > freshAfter)
      .map(r => ({role:r.id, name:r.name, ...r.activity}));
  }
  async machine(req, res, pathname, jsonBody, respond) {
    const match = /^\/api\/v1\/resident-turns\/([a-z][a-z0-9_-]{1,31})\/(offer|poll|reply|begin|check|activation)$/.exec(pathname);
    if (!match) return false;
    const r = this.roles.get(match[1]), op = match[2];
    if (req.method !== 'POST' || !r) throw denied(404, 'RESIDENT_NOT_FOUND');
    const worker = ['offer','check','activation'].includes(op);
    this.authorize(r, req, worker);
    const input = await jsonBody(req, op === 'offer' ? 160 * 1024 : op === 'reply' ? 16 * 1024 : 1024);
    this.authorize(r, req, worker);
    let result;
    if (op === 'activation') {
      if (!r.fresh || input.bodyId !== r.bodyId || input.bodyKind !== r.bodyKind || input.ownerGameId !== r.ownerGameId) throw denied(409,'BODY_BINDING_CHANGED');
      const born = this.store.db.prepare('SELECT * FROM resident_births WHERE role=? AND body=? AND game_owner=? AND kind=?').get(r.id,r.bodyId,r.ownerGameId,r.bodyKind);
      if (input.readyCharacterId !== undefined) {
        if (!born || input.readyCharacterId !== born.character) throw denied(409,'CHARACTER_BINDING_CHANGED');
        this.store.db.prepare('UPDATE resident_births SET ready=1 WHERE role=? AND character=?').run(r.id,born.character);
        r.ready = true;
      }
      result = {activation: born ? {characterId:born.character,name:born.name,persona:born.persona} : null};
    } else if (op === 'check') {
      if (input?.activity !== undefined) r.activity = residentActivity(input.activity, this.now());
      result = {requestId: this.valid(r) && r.wake?.until > this.now() ? r.wake.id : null};
    } else if (op === 'begin') {
      r.grant.lastPoll = this.now();
      if (!r.wake || r.wake.until <= this.now()) r.wake = {id: randomUUID(), until: this.now() + 60_000};
      result = {state:'requested',requestId:r.wake.id};
    } else if (op === 'poll') {
      r.grant.lastPoll = this.now();
      if (r.grant.until - this.now() < idleExpiry - 300_000) {
        r.grant.until = this.now() + idleExpiry;
        this.store.db.prepare('UPDATE resident_grants SET until=? WHERE role=? AND hash=?').run(r.grant.until, r.id, r.grant.hash);
      }
      result = {turn: r.pending?.turn ?? null};
    } else if (op === 'reply') {
      const pending = r.pending;
      const id = input?.id;
      const turn = pending?.turn;
      let reason;
      if (!turn || turn.id !== id || this.now() >= turn.until) reason = 'STALE_TURN';
      else if (!input.answer || typeof input.answer !== 'object' || Array.isArray(input.answer)) reason = 'INVALID_DECISION';
      else if (!communicationAllowed(turn,input.answer)) reason = 'COMMUNICATION_UNAVAILABLE';
      if (!reason) pending.finish({state: 'answered', id, answer: input.answer});
      if (typeof id === 'string' && uuid.test(id)) {
        console.info(JSON.stringify({
          event: 'resident_turn', stage: 'portal_reply', role: r.id, turnHash: hash(id).slice(0,12),
          status: reason ? 'rejected' : 'accepted', ...(reason ? {reason} : {kind: turn.kind})
        }));
      }
      if (reason) throw denied(reason === 'STALE_TURN' ? 409 : 400, reason);
      result = {accepted: true};
    } else {
      if (input.bodyId !== r.bodyId || input.characterId !== r.characterId || input.bodyKind !== r.bodyKind || input.ownerGameId !== r.ownerGameId
          || !['plan', 'dialogue'].includes(input.kind) || typeof input.instructions !== 'string'
          || !input.scene || typeof input.scene !== 'object' || Array.isArray(input.scene)) throw denied(400, 'INVALID_RESIDENT_TURN');
      result = idle;
      const requested = input.scene.desktopRequestId;
      const matches = requested === undefined || (r.wake && r.wake.id === requested && r.wake.until > this.now() && input.kind === 'plan');
      if (matches && this.valid(r) && this.now() - r.grant.lastPoll < 15_000 && !r.pending && !res.destroyed) {
        if (requested) r.wake = null;
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
  async browser(req, res, pathname, browserAuth, respond, jsonBody) {
    if (pathname === '/api/v1/resident-onboarding/browser-approve' && req.method === 'POST') {
      const {owner} = browserAuth(req);
      respond(res,200,this.approveBrowserLogin(owner.id, await jsonBody(req,512)));
      return true;
    }
    if (pathname === '/api/v1/resident-onboarding/code' && req.method === 'POST') {
      const {owner} = browserAuth(req);
      respond(res,201,this.onboardingCode(owner.id));
      return true;
    }
    if (pathname === prefix && req.method === 'GET') {
      const {owner} = browserAuth(req);
      respond(res, 200, this.list(owner.id));
      return true;
    }
    if (pathname === prefix && req.method === 'POST') {
      const {owner} = browserAuth(req);
      const input = await jsonBody(req, 8192);
      respond(res, 201, {resident: this.create(owner.id, input)});
      return true;
    }
    const match = /^\/api\/v1\/resident-turns\/([a-z][a-z0-9_-]{1,31})\/(grant|code)$/.exec(pathname);
    if (!match || !['POST', 'DELETE'].includes(req.method)) return false;
    const {owner} = browserAuth(req);
    const r = this.roles.get(match[1]);
    if (!r || !this.owns(owner.id, r)) throw denied(404, 'RESIDENT_NOT_OWNED');
    if (req.method === 'DELETE') {
      this.clear(r);
      this.store.db.prepare('DELETE FROM resident_pair_codes WHERE role=?').run(r.id);
      respond(res, 200, {released:true});
    } else if (match[2] === 'code') {
      if (r.fresh && !r.ready) throw denied(409,'RESIDENT_NOT_READY');
      const code = newCode();
      const until = this.now() + 5 * 60_000;
      this.store.db.prepare('INSERT OR REPLACE INTO resident_pair_codes VALUES(?,?,?,?,?)').run(r.id,hash(code),owner.id,until,bindingKey(r));
      respond(res,201,{code,expiresAt:until});
    } else respond(res, 201, this.grant(r, owner.id, req.portalOrigin.origin));
    return true;
  }
}
