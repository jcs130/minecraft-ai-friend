import {createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual} from 'node:crypto';

const url = '/api/v1/desktop-devices';
const callbackPath = '/qd-desktop/callback';
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const secret = /^[A-Za-z0-9_-]{43}$/;
const valid = (pattern, value) => typeof value === 'string' && pattern.test(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const fresh = () => randomBytes(32).toString('base64url');
const derive = (key, label) => createHmac('sha256', key).update(label).digest('base64url');
const minutes = 60_000;
const lifetime = 90 * 24 * 60 * minutes;
const accessLifetime = 15 * minutes;
const denied = (status, reason) => Object.assign(new Error(reason), {status, reason});
const matched = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
const authRequired = () => denied(401, 'DESKTOP_AUTHORIZATION_ENDED');
const flowEnded = () => denied(400, 'DESKTOP_FLOW_ENDED');

function loopback(value) {
  if (typeof value !== 'string') return false;
  const m = /^http:\/\/127\.0\.0\.1:([1-9]\d{3,4})\/qd-desktop\/callback$/.exec(value);
  return !!m && Number(m[1]) >= 1024 && Number(m[1]) <= 65535;
}

export class DesktopDevices {
  constructor({store, residents, publicOrigin, provider, now = Date.now}) {
    Object.assign(this, {store, residents, publicOrigin, provider, now});
    this.db = store.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS desktop_authorization_flows (
      id TEXT PRIMARY KEY, device TEXT NOT NULL, key_hash TEXT NOT NULL, name TEXT NOT NULL,
      state TEXT NOT NULL, challenge TEXT NOT NULL, redirect_uri TEXT, code_hash TEXT,
      owner TEXT, role TEXT, binding TEXT, legacy_hash TEXT, auth_hash TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, expiry INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS desktop_authorizations (
      id TEXT PRIMARY KEY, device TEXT NOT NULL, key_hash TEXT NOT NULL, name TEXT NOT NULL,
      owner TEXT NOT NULL REFERENCES owners(id), role TEXT NOT NULL, binding TEXT NOT NULL,
      refresh_hash TEXT NOT NULL UNIQUE, access_hash TEXT NOT NULL UNIQUE,
      old_refresh_hash TEXT, rotate_id TEXT, retry_until INTEGER,
      access_until INTEGER NOT NULL, refresh_until INTEGER NOT NULL, revoked_at INTEGER, legacy_hash TEXT,
      UNIQUE(owner,device));
      CREATE TABLE IF NOT EXISTS desktop_play_receipts (
      authorization TEXT NOT NULL REFERENCES desktop_authorizations(id) ON DELETE CASCADE,
      request TEXT NOT NULL, character TEXT NOT NULL, mode TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','stopped','expired','rejected')),
      reason TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(authorization,request));`);
    residents.desktopAuthority = (grant, req) => {
      const row = this.db.prepare('SELECT * FROM desktop_authorizations WHERE id=?').get(grant.desktop);
      return !!this.role(row) && (!req || this.proves(row, req));
    };
    residents.desktopPlayEnded = (role, grant, status) => {
      if (!valid(uuid,grant.instance)) return;
      const authorization = this.db.prepare('SELECT id FROM desktop_authorizations WHERE id=?').get(grant.desktop);
      if (!authorization) return;
      const reason = status === 'stopped' ? 'USER_STOPPED' : 'LEASE_EXPIRED';
      const deadline = residents.desktopPlayDeadline(grant);
      const updatedAt = status === 'expired' && Number.isFinite(deadline) ? Math.min(this.now(),deadline) : this.now();
      this.rememberPlay(authorization,role,grant.instance,status,reason,updatedAt);
    };
  }

  binding(role) {
    return JSON.stringify([role.characterId, role.bodyId, role.bodyKind, role.ownerGameId]);
  }

  role(row) {
    if (!row || row.revoked_at !== null || row.refresh_until <= this.now()) return null;
    const role = this.residents.roles.get(row.role);
    return role && (!role.fresh || role.ready) && this.binding(role) === row.binding && this.residents.owns(row.owner, role) ? role : null;
  }

  proves(row, req) {
    const proof = req.headers['x-qd-device-proof'];
    return row.device === req.headers['x-qd-device'] && valid(secret,proof) &&
      matched(row.key_hash, digest(proof));
  }

  begin(input, req) {
    const {state, challenge, redirectUri, name} = input ?? {};
    const device = req.headers['x-qd-device'], proof = req.headers['x-qd-device-proof'];
    if (!valid(uuid,device) || !valid(secret,proof) || !valid(secret,state) || !valid(secret,challenge) ||
        !(redirectUri === null || loopback(redirectUri)) || typeof name !== 'string' ||
        !name.trim() || name.length > 80 || /[\p{C}\p{Zl}\p{Zp}]/u.test(name)) throw flowEnded();
    this.db.prepare('DELETE FROM desktop_authorization_flows WHERE expiry<=?').run(this.now());
    if (this.db.prepare('SELECT count(*) AS count FROM desktop_authorization_flows').get().count >= 1000)
      throw denied(429, 'DESKTOP_FLOW_BUSY');
    const id = fresh(), expiry = this.now() + 5 * minutes;
    const code = redirectUri === null ? String(randomInt(1_000_000)).padStart(6, '0') : null;
    this.db.prepare(`INSERT INTO desktop_authorization_flows
      (id,device,key_hash,name,state,challenge,redirect_uri,code_hash,expiry) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(id,device,digest(proof),name,state,challenge,redirectUri,code && digest(id + code),expiry);
    return {id, expiresAt:expiry, url:this.publicOrigin + '/desktop-connect.html#' + id, ...(code ? {code} : {})};
  }

  flow(id) {
    const row = typeof id === 'string' && secret.test(id) && this.db.prepare(
      'SELECT * FROM desktop_authorization_flows WHERE id=? AND expiry>? AND attempts<5').get(id,this.now());
    if (!row) throw flowEnded();
    return row;
  }

  legacy(role) {
    return this.residents.valid(role) && !role.grant.desktop ? role.grant.hash : null;
  }

  preview(owner, id) {
    const row = this.flow(id);
    if (row.owner) throw flowEnded();
    const characters = [...this.residents.roles.values()]
      .filter(role => this.residents.owns(owner.id,role) && (!role.fresh || role.ready))
      .map(role => ({...this.residents.describe(role), legacy:!!this.legacy(role)}));
    return {account:owner.username, device:row.name, codeRequired:!row.redirect_uri, characters};
  }

  approve(owner, input) {
    const flow = this.flow(input?.id);
    if (flow.owner) throw flowEnded();
    if (!flow.redirect_uri && (!valid(/^\d{6}$/,input.code) || !matched(flow.code_hash,digest(flow.id + input.code)))) {
      this.db.prepare('UPDATE desktop_authorization_flows SET attempts=attempts+1 WHERE id=?').run(flow.id);
      throw denied(400, 'DESKTOP_CODE_INVALID');
    }
    const role = this.residents.roles.get(input.role);
    if (!role || !this.residents.owns(owner.id,role) || role.characterId !== input.characterId ||
        role.fresh && !role.ready) throw denied(404,'DESKTOP_CHARACTER_UNAVAILABLE');
    const authorization = flow.redirect_uri ? fresh() : null;
    const previous = input.migrate === true ? this.legacy(role) : null;
    this.db.prepare(`UPDATE desktop_authorization_flows
      SET owner=?,role=?,binding=?,legacy_hash=?,auth_hash=?,expiry=? WHERE id=? AND owner IS NULL`)
      .run(owner.id,role.id,this.binding(role),previous,authorization && digest(authorization),
        Math.min(flow.expiry,this.now() + (authorization ? 60_000 : 5 * minutes)),flow.id);
    if (!authorization) return {approved:true};
    const target = new URL(flow.redirect_uri);
    target.search = new URLSearchParams({code:authorization,state:flow.state,iss:this.publicOrigin}).toString();
    return {approved:true, redirect:target.href};
  }

  credentials(row, refresh) {
    return {accessToken:'qda2_' + derive(refresh,'access:' + row.id), refreshToken:refresh,
      expiresAt:row.access_until, character:JSON.parse(row.binding)[0], role:row.role};
  }

  exchange(input,req) {
    const flow = this.flow(input?.id);
    if (!this.proves(flow,req) || !valid(/^[A-Za-z0-9_-]{43,128}$/,input.verifier) ||
        !matched(flow.challenge,createHash('sha256').update(input.verifier).digest('base64url')) ||
        input.redirectUri !== flow.redirect_uri || input.state !== flow.state) throw flowEnded();
    if (!flow.owner && !flow.redirect_uri) return {pending:true};
    if (!flow.owner || flow.redirect_uri && (!valid(secret,input.code) || !matched(flow.auth_hash,digest(input.code))) ||
        !flow.redirect_uri && input.code !== undefined) throw flowEnded();
    const role = this.residents.roles.get(flow.role);
    if (!role || !this.residents.owns(flow.owner,role) || this.binding(role) !== flow.binding) throw authRequired();
    const id = randomUUID(), refresh = 'qdr2_' + fresh(), now = this.now();
    const issued = this.credentials({id,access_until:now+accessLifetime,binding:flow.binding,role:flow.role},refresh);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.db.prepare('DELETE FROM desktop_authorization_flows WHERE id=?').run(flow.id).changes) throw flowEnded();
      const previous = this.db.prepare('SELECT id FROM desktop_authorizations WHERE owner=? AND device=?').get(flow.owner,flow.device);
      if (previous) this.db.prepare('DELETE FROM desktop_authorizations WHERE id=?').run(previous.id);
      this.db.prepare(`INSERT INTO desktop_authorizations
        (id,device,key_hash,name,owner,role,binding,refresh_hash,access_hash,access_until,refresh_until,legacy_hash)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id,flow.device,flow.key_hash,flow.name,flow.owner,flow.role,flow.binding,digest(refresh),
          digest(issued.accessToken),issued.expiresAt,now+lifetime,flow.legacy_hash);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return issued;
  }

  refresh(input,req) {
    const old = input?.refreshToken, rotation = input?.rotationId;
    if (!valid(/^qdr2_[A-Za-z0-9_-]{43}$/,old) || !valid(uuid,rotation)) throw authRequired();
    const oldHash = digest(old), now = this.now();
    const row = this.db.prepare(`SELECT * FROM desktop_authorizations
      WHERE refresh_hash=? OR old_refresh_hash=?`).get(oldHash,oldHash);
    if (!this.role(row) || !this.proves(row,req)) throw authRequired();
    const next = 'qdr2_' + derive(old,'rotate:' + rotation);
    if (row.old_refresh_hash === oldHash) {
      if (row.rotate_id === rotation && row.retry_until > now && matched(row.refresh_hash,digest(next))) {
        return this.credentials(row,next);
      }
      this.revoke(row.owner,row.id);
      throw authRequired();
    }
    const issued = this.credentials({...row,access_until:now+accessLifetime},next);
    const updated = this.db.prepare(`UPDATE desktop_authorizations SET refresh_hash=?,access_hash=?,access_until=?,refresh_until=?,
      old_refresh_hash=?,rotate_id=?,retry_until=? WHERE id=? AND refresh_hash=?`)
      .run(digest(next),digest(issued.accessToken),issued.expiresAt,now+lifetime,oldHash,rotation,now+2*minutes,row.id,oldHash);
    if (updated.changes !== 1) throw authRequired();
    return issued;
  }

  access(req) {
    const token = /^Bearer (qda2_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '')?.[1];
    const row = token && this.db.prepare('SELECT * FROM desktop_authorizations WHERE access_hash=? AND access_until>?')
      .get(digest(token),this.now());
    if (!this.role(row) || !this.proves(row,req)) throw authRequired();
    return row;
  }

  async status(row) {
    const role = this.role(row);
    if (!role) throw authRequired();
    let activeKind = role.bodyKind, pendingRequestId = null, modes = [role.bodyKind], coordinatorReady = true;
    if (this.provider) {
      try {
        const state = await this.provider.current(role.characterId,{ownerId:role.ownerGameId});
        if (state.characterId !== role.characterId || state.status !== 'ready' || state.activeKind !== role.bodyKind) coordinatorReady = false;
        activeKind = state.activeKind ?? null;
        pendingRequestId = state.pendingRequestId ?? null;
        modes = [...new Set([...modes,activeKind,...(state.targetKinds ?? [])])].filter(k => ['maid','numen','mineflayer','villager'].includes(k));
      } catch (e) {
        if ((e.code ?? e.reason) !== 'BODY_HANDOFF_NOT_FOUND') coordinatorReady = false;
      }
    }
    if (!this.role(row)) throw authRequired();
    const controller = this.residents.desktopController(role);
    const same = controller?.desktop === row.id;
    const migration = controller && !controller.desktop && row.legacy_hash === controller.hash;
    const controllerName = controller?.desktop ? this.db.prepare(
      'SELECT name FROM desktop_authorizations WHERE id=? AND owner=?').get(controller.desktop,row.owner)?.name : null;
    return {device:{name:row.name}, account:this.store.ownerById(row.owner)?.username, character:this.residents.describe(role), modes, activeKind, pendingRequestId,
      controller:controller ? (same ? 'this_device' : controller.desktop ? 'other_device' : 'resident_plugin')
        : coordinatorReady ? null : 'game_server',
      controllerName:controllerName ?? null,
      canStart:coordinatorReady && (!controller || same || !!migration),
      recoveryUrl:this.publicOrigin + '/resident-connect.html?flow=bodies'};
  }

  rememberPlay(row, role, requestId, status, reason, updatedAt = this.now()) {
    return this.db.prepare(`INSERT INTO desktop_play_receipts(authorization,request,character,mode,status,reason,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(authorization,request) DO UPDATE SET
        status=excluded.status, reason=excluded.reason, updated_at=max(desktop_play_receipts.updated_at,excluded.updated_at)
      WHERE desktop_play_receipts.status='active' AND excluded.status IN ('stopped','expired')`)
      .run(row.id,requestId,role.characterId,role.bodyKind,status,reason,updatedAt).changes;
  }

  playStatus(row, requestId) {
    if (!valid(uuid,requestId)) throw denied(400,'DESKTOP_REQUEST_INVALID');
    const role = this.role(row);
    if (!role) throw authRequired();
    const receipt = this.db.prepare(`SELECT character AS characterId, mode, status, updated_at AS updatedAt, reason
      FROM desktop_play_receipts WHERE authorization=? AND request=?`).get(row.id,requestId);
    if (!receipt) return {requestId,status:'unknown',characterId:null,mode:null,updatedAt:null,reason:'NO_RECEIPT'};
    if (receipt.status !== 'active') return {requestId,...receipt};
    const grant = role.grant;
    const saved = this.db.prepare(`SELECT until,last_seen FROM resident_grants
      WHERE role=? AND desktop=? AND instance=?`).get(role.id,row.id,requestId);
    const sameGrant = grant?.desktop === row.id && grant.instance === requestId;
    const deadline = saved ? this.residents.desktopPlayDeadline({
      until:saved.until, lastPoll:sameGrant ? grant.lastPoll : saved.last_seen ?? -Infinity,
    }) : receipt.updatedAt;
    if (saved && sameGrant && deadline > this.now()) return {requestId,...receipt};
    return {requestId,...receipt,status:'expired',reason:'LEASE_EXPIRED',
      updatedAt:Math.max(receipt.updatedAt,Math.min(this.now(),deadline))};
  }

  async start(row,input,req) {
    const requestId = input?.requestId;
    if (!valid(uuid,requestId)) throw denied(400,'DESKTOP_REQUEST_INVALID');
    const status = await this.status(row);
    const authorized = this.access(req);
    if (authorized.id !== row.id) throw authRequired();
    const role = this.role(authorized), live = this.residents.desktopController(role);
    const prior = this.playStatus(authorized,requestId);
    if (prior.status !== 'unknown' && prior.status !== 'active') throw denied(409,'DESKTOP_PLAY_ENDED');
    const token = 'rdt_' + derive(req.headers['x-qd-device-proof'], row.id + ':' + requestId);
    const same = live?.desktop === row.id && live.instance === requestId && live.hash === digest(token);
    if (!status.canStart || status.character.bodyKind !== input.mode ||
        live && !same && (live.desktop || live.hash !== authorized.legacy_hash)) {
      if (prior.status === 'unknown' && !same) this.rememberPlay(authorized,role,requestId,'rejected','DESKTOP_BODY_BUSY');
      throw denied(409,'DESKTOP_BODY_BUSY');
    }
    if (same)
      return {endpoint:this.publicOrigin + '/api/v1/resident-turns/' + role.id,token,expiresAt:live.until,resident:this.residents.describe(role)};
    return this.residents.grant(role,authorized.owner,this.publicOrigin,token,null,{
      id:authorized.id,instance:requestId,
      record:() => {
        if (!this.rememberPlay(authorized,role,requestId,'active',null)) throw denied(409,'DESKTOP_PLAY_ENDED');
        this.db.prepare('UPDATE desktop_authorizations SET legacy_hash=NULL WHERE id=?').run(authorized.id);
      },
    });
  }

  stop(row, requestId) {
    if (!valid(uuid,requestId)) throw denied(400,'DESKTOP_REQUEST_INVALID');
    const role = this.role(row);
    if (!role) throw authRequired();
    if (role.grant?.desktop === row.id && role.grant.instance === requestId && this.residents.desktopController(role)) {
      this.residents.clear(role,'stopped');
    } else if (this.playStatus(row,requestId).status === 'unknown') {
      // A stop can reach the server while the matching start is still awaiting the body.
      this.rememberPlay(row,role,requestId,'stopped','USER_STOPPED');
    }
    return {stopped:true};
  }

  list(owner) {
    const rows = this.db.prepare('SELECT * FROM desktop_authorizations WHERE owner=? ORDER BY name,id').all(owner);
    return rows.map(row => ({id:row.id, device:row.name, character:JSON.parse(row.binding)[0],
      name:this.role(row)?.name ?? row.role, active:!!this.role(row)}));
  }

  revoke(owner,id) {
    if (!valid(uuid,id)) return {revoked:false};
    const result = this.db.prepare('UPDATE desktop_authorizations SET revoked_at=? WHERE id=? AND owner=? AND revoked_at IS NULL')
      .run(this.now(),id,owner);
    if (result.changes) for (const r of this.residents.roles.values()) {
      if (r.grant?.desktop === id) this.residents.clear(r);
    }
    return {revoked:!!result.changes};
  }

  async route({req,res,pathname,jsonBody,respond,rate,peer,browserAuth,csrf}) {
    if (pathname !== url && !pathname.startsWith(url + '/')) return false;
    if (!req.portalOrigin.secure || req.portalOrigin.origin !== this.publicOrigin) throw denied(403,'DESKTOP_HTTPS_REQUIRED');
    const op = pathname.slice(url.length + 1);
    rate('desktop-authorization:' + peer, 60, minutes);
    if (['begin','exchange','refresh','status','play-status','start','stop','unlink'].includes(op)) {
      if (req.method !== 'POST' || req.headers.origin || req.headers.cookie ||
          !/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw denied(403,'DESKTOP_CLIENT_REQUIRED');
      const input = await jsonBody(req, 2048);
      let result;
      if (op === 'begin') { rate('desktop-new-flow:' + peer, 8, minutes); result = this.begin(input,req); }
      else if (op === 'exchange') result = this.exchange(input,req);
      else if (op === 'refresh') result = this.refresh(input,req);
      else {
        const row = this.access(req);
        if (op === 'status') {
          result = await this.status(row);
          if (this.access(req).id !== row.id) throw authRequired();
        }
        if (op === 'play-status') {
          res.setHeader('Cache-Control','private, no-store');
          result = this.playStatus(row,input?.requestId);
        }
        if (op === 'start') result = await this.start(row,input,req);
        if (op === 'stop') result = this.stop(row,input?.requestId);
        if (op === 'unlink') result = this.revoke(row.owner,row.id);
      }
      respond(res,200,result);
    } else {
      const {owner} = browserAuth(req);
      if (req.method === 'GET' && !op) respond(res,200,{devices:this.list(owner.id)});
      else if (req.method === 'GET' && op.startsWith('flows/')) respond(res,200,this.preview(owner,op.slice(6)));
      else if (req.method === 'POST' && (op === 'approve' || op === 'revoke')) {
        if (req.headers.origin !== req.portalOrigin.origin) throw denied(403,'INVALID_ORIGIN');
        csrf(req);
        const input = await jsonBody(req,1024);
        respond(res,200,op === 'approve' ? this.approve(owner,input) : this.revoke(owner.id,input?.id ?? ''));
      } else throw denied(405,'METHOD_NOT_ALLOWED');
    }
    return true;
  }
}
