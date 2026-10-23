import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { UUID, reservedIdentityName } from './game-data.mjs';
import { newSecret } from './store.mjs';

const fail = (status, reason, message) => Object.assign(new Error(message), { status, reason });
const idFor = uuid => createHash('sha256').update('qiandengji:world-view:' + uuid).digest('hex').slice(0, 32);

/** Website-owned demand/UUID authority. The scene worker receives leases, never
 * game passwords. There is no new Minecraft player and no visitor-supplied URL. */
export class WorldView {
  constructor(config, store, now = Date.now) { this.config=config; this.store=store; this.now=now; this.demands=new Map(); this.sources=new Map(); this.workerAt=0; }
  get enabled() { return this.config.live.worldObserverEnabled === true; }
  authorizeWorker(req) {
    if (!this.enabled) throw fail(404,'NOT_FOUND','观战服务尚未启用');
    const token=/^Bearer (obs_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization||'')?.[1], expected=this.config.live.worldObserverTokenHash;
    if (!token || !/^[a-f0-9]{64}$/.test(expected||'') || !timingSafeEqual(createHash('sha256').update(token).digest(),Buffer.from(expected,'hex'))) throw fail(401,'OBSERVER_REQUIRED','观战服务凭据无效');
    if (req.headers.origin || req.headers.cookie) throw fail(403,'OBSERVER_REQUIRED','仅接受服务端观战服务');
  }
  roles(roster) {
    return new Map(roster.filter(row=>UUID.test(row.playerUuid||'')&&!row.historical&&!row.isReserved&&!row.identityConflict
      &&!reservedIdentityName(row.name)&&['agent','player'].includes(row.kind))
      .map(row=>[idFor(row.playerUuid.toLowerCase()),{...row,playerUuid:row.playerUuid.toLowerCase()}]));
  }
  isPublic(row) { return this.config.live.worldObserverPublicUuids.includes(row.playerUuid); }
  allowed(row, owner) { return this.isPublic(row)||!!owner&&(owner.role==='admin'||this.store.ownedUuids(owner.id).includes(row.playerUuid)); }
  online(row) {
    // Native Numen bodies have no network login session. Require their exact
    // registered UUID to be present in the trusted backend's current sample;
    // an ag_ nickname, historical roster or explicit auth rejection is insufficient.
    return row?.online===true&&(row.authenticated===true || row.authenticated===null
      &&row.statusSource==='minecraft.server-list-ping.uuid'
      &&['Numen.CompanionRegistry','Numen.live-owner-tag'].includes(row.identitySource));
  }
  sessionOwner(hash) {
    const session=this.store.db.prepare('SELECT owner_id FROM sessions WHERE id_hash=? AND expires_at>?').get(hash,this.now());
    return session ? {session,owner:session.owner_id?this.store.ownerById(session.owner_id):null} : null;
  }
  reconcile(roster) {
    const roles=this.roles(roster);
    for(const [key,demand]of this.demands) {
      const actor=this.sessionOwner(demand.session),row=roles.get(demand.id);
      if(this.now()-demand.at>=20000||!actor||!row||!this.online(row)||!this.allowed(row,actor.owner))this.demands.delete(key);
    }
    const needed=new Set([...this.demands.values()].map(d=>d.id));
    for(const [id,source]of this.sources)if(!needed.has(id)||!this.online(roles.get(id))||source.playerUuid!==roles.get(id)?.playerUuid)this.sources.delete(id);
    return roles;
  }
  list(roster, owner, relayState=()=>({available:false})) {
    const roles=this.reconcile(roster),owned=owner?this.store.ownedUuids(owner.id):[];
    return [...roles].filter(([,row])=>this.allowed(row,owner)).map(([id,row])=>{
      const source=this.sources.get(id),state=source?relayState(id):null,online=this.online(row),available=online&&state?.available===true;
      return {id,playerName:row.name,title:row.name+' · 女神之眼',visibility:this.isPublic(row)?'public':'owner',
        managed:true,readOnly:true,mode:'native-3d',canManage:false,isOwn:owned.includes(row.playerUuid),online,available,
        state:available?'live':!online?'offline':source?'preparing':'ready',watchUrl:`/watch/${id}/`,
        scope:this.isPublic(row)?'scene':'owner',extraPlayerSlots:0};
    });
  }
  watch(id, roster, session, viewerId) {
    if(!UUID.test(viewerId||'')||!session||!this.sessionOwner(session.id_hash))throw fail(400,'WATCH_SESSION_REQUIRED','请刷新网页后重新选择角色');
    const roles=this.reconcile(roster),owner=session.owner_id?this.store.ownerById(session.owner_id):null,row=roles.get(id);
    if(!row||!this.allowed(row,owner))throw fail(404,'CHANNEL_NOT_FOUND','角色不存在或尚未授权');
    if(!this.online(row))throw fail(503,'TARGET_OFFLINE','角色尚未登录游戏，在线后即可观战');
    const key=session.id_hash+':'+viewerId;
    if(!this.demands.has(key)&&this.demands.size>=256)throw fail(429,'VIEWER_LIMIT','观战请求较多，请稍后重试');
    if(!this.demands.has(key)&&[...this.demands.values()].filter(d=>d.session===session.id_hash).length>=4)throw fail(429,'VIEWER_LIMIT','同时观看的页面过多，请关闭暂时不用的观战页');
    this.demands.set(key,{id,session:session.id_hash,at:this.now()});this.reconcile(roster);
    return {accepted:true,readOnly:true,extraPlayerSlots:0};
  }
  poll(roster) {
    const roles=this.reconcile(roster);this.workerAt=this.now();
    for(const demand of this.demands.values()) {
      if(this.sources.has(demand.id))continue;
      if(this.sources.size>=this.config.live.worldObserverMaxTargets)break;
      const row=roles.get(demand.id);
      this.sources.set(demand.id,{id:demand.id,lease:randomUUID(),playerUuid:row.playerUuid,playerName:row.name,
        scope:this.isPublic(row)?'scene':'owner',publisherToken:'pub_'+newSecret()});
    }
    return {jobs:[...this.sources.values()].map(row=>({...row,expiresAt:new Date(this.now()+8000).toISOString()})),extraPlayerSlots:0};
  }
  publisher(id,token,roster) {
    this.reconcile(roster);const source=this.sources.get(id);
    if(!source||typeof token!=='string'||token.length!==source.publisherToken.length||!timingSafeEqual(Buffer.from(token),Buffer.from(source.publisherToken)))throw fail(401,'PUBLISHER_REQUIRED','观战发布授权已失效');
    return {playerUuid:source.playerUuid};
  }
  viewer(id,roster,session) {
    const roles=this.reconcile(roster),row=roles.get(id),actor=session?this.sessionOwner(session.id_hash):null;
    if(!row||!this.allowed(row,actor?.owner)||!this.online(row)||!this.sources.has(id))throw fail(404,'CHANNEL_NOT_FOUND','观战角色离线或授权已失效');
  }
}
