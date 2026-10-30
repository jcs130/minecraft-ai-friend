import { createHash, timingSafeEqual } from 'node:crypto';
const fail=(status,reason)=>Object.assign(new Error(reason),{status,reason});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** Only exports verified role identities to the home-side authority, never hashes. */
export class SharedRealmAccess {
  constructor(config,store,game,cloud){Object.assign(this,{config,store,game,cloud});}
  authorize(req){
    const cfg=this.config.sharedRealmAccess;
    if(!cfg?.enabled||cfg.realmId!=='sao')throw fail(404,'NOT_FOUND');
    if(req.headers.origin||req.headers.cookie)throw fail(403,'SERVICE_CREDENTIAL_REQUIRED');
    const token=/^Bearer (sra_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization||'')?.[1];
    if(!token||!/^[a-f0-9]{64}$/.test(cfg.tokenHash||'')||!timingSafeEqual(createHash('sha256').update(token).digest(),Buffer.from(cfg.tokenHash,'hex')))throw fail(401,'SERVICE_CREDENTIAL_REQUIRED');
  }
  async roles(req){
    this.authorize(req);
    const snapshot=this.cloud?.read();
    if(this.config.sourceMode==='cloud'&&(!snapshot||snapshot.stale))throw fail(503,'PRIMARY_IDENTITIES_STALE');
    const roster=await this.game.roster();
    const roles=[];
    for(const row of roster.slice(0,256)){
      if(!uuid.test(row.playerUuid||'')||!/^\.?[A-Za-z0-9_]{1,16}$/.test(row.name||'')||row.isReserved||row.identityConflict||row.historical||!['agent','player'].includes(row.kind))continue;
      if(!this.store.db.prepare('SELECT 1 FROM ownerships WHERE agent_uuid=?').get(row.playerUuid))continue;
      roles.push({name:row.name,uuid:row.playerUuid});
    }
    return {schemaVersion:1,realmId:'sao',observedAt:Date.now(),expiresAt:Date.now()+45000,source:'verified-website-ownership-and-primary-roster',roles};
  }
}
