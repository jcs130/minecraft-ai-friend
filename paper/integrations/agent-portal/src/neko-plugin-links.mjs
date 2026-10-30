import {timingSafeEqual} from 'node:crypto';
import {digest} from './store.mjs';
import {UUID} from './game-data.mjs';

const fail=(status,reason)=>Object.assign(new Error('请核对猫娘计划授权和原接入请求；未重新创建角色。'),{status,reason});
const name=value=>typeof value==='string'&&/^ag_[A-Za-z0-9_]{1,13}$/.test(value);
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));

// A desktop-created request delegates exactly one NEW game character after a
// browser confirms its own Neko identity. No Auth/website token leaves the site.
export class NekoPluginLinks{
  constructor(config,store,accounts,nekoAuth,{now=Date.now}={}){
    Object.assign(this,{config,store,accounts,nekoAuth,now});
    store.db.exec(`CREATE TABLE IF NOT EXISTS neko_plugin_links(client_id TEXT PRIMARY KEY,secret_hash TEXT NOT NULL,username TEXT NOT NULL,game_request_id TEXT NOT NULL UNIQUE,owner_id TEXT REFERENCES owners(id),activation_attempted INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);`);
  }
  create(body){
    this.nekoAuth.requireEnabled();
    if(!UUID.test(body.clientId||'')||!UUID.test(body.requestId||'')||body.clientId!==body.clientId.toLowerCase()||body.requestId!==body.requestId.toLowerCase()||!name(body.username)
      ||typeof body.clientSecret!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.clientSecret))throw fail(400,'NEKO_LINK_INVALID_REQUEST');
    const previous=this.store.db.prepare('SELECT * FROM neko_plugin_links WHERE client_id=?').get(body.clientId);
    if(previous){
      if(!equal(previous.secret_hash,digest(body.clientSecret))||previous.username!==body.username||previous.game_request_id!==body.requestId)throw fail(409,'NEKO_LINK_CONFLICT');
      if(previous.expires_at<=this.now())throw fail(410,'NEKO_LINK_EXPIRED');
    }else{
      if(this.store.db.prepare('SELECT 1 FROM neko_plugin_links WHERE game_request_id=?').get(body.requestId))throw fail(409,'NEKO_LINK_CONFLICT');
      this.accounts.checkName?.(body.username);
      if(this.store.db.prepare('SELECT count(*) AS n FROM neko_plugin_links WHERE expires_at>?').get(this.now()).n>=10000)throw fail(429,'NEKO_LINK_BUSY');
      this.store.db.prepare('INSERT INTO neko_plugin_links VALUES(?,?,?,?,NULL,0,?,?)').run(body.clientId,digest(body.clientSecret),body.username,body.requestId,this.now(),this.now()+10*60000);
    }
    return{clientId:body.clientId,username:body.username,phase:previous?.owner_id?'approved':'authorization_required',
      verificationUrl:this.config.publicOrigin+'/join?neko_request='+body.clientId};
  }
  row(id,{allowExpired=false}={}){
    if(!UUID.test(id||''))throw fail(404,'NEKO_LINK_NOT_FOUND');
    const row=this.store.db.prepare('SELECT * FROM neko_plugin_links WHERE client_id=?').get(id);
    if(!row)throw fail(404,'NEKO_LINK_NOT_FOUND');
    if(!allowExpired&&row.expires_at<=this.now())throw fail(410,'NEKO_LINK_EXPIRED');
    return row;
  }
  preview(id){const row=this.row(id);return{clientId:id,username:row.username,phase:row.owner_id?'approved':'authorization_required',expiresAt:new Date(row.expires_at).toISOString()};}
  approve(id,owner){
    this.nekoAuth.requireEnabled();
    const row=this.row(id);
    if(!this.nekoAuth.capabilities(owner).linked)throw fail(403,'NEKO_LOGIN_REQUIRED');
    if(row.owner_id&&row.owner_id!==owner.id)throw fail(409,'NEKO_LINK_OTHER_OWNER');
    if(this.store.db.prepare('UPDATE neko_plugin_links SET owner_id=?,expires_at=? WHERE client_id=? AND (owner_id IS NULL OR owner_id=?)').run(owner.id,this.now()+7*86400000,id,owner.id).changes!==1)throw fail(409,'NEKO_LINK_OTHER_OWNER');
    this.store.audit(owner.id,'account.neko.plugin-approved',id);
    return{approved:true,username:row.username,gameConnectionStarted:false};
  }
  authorize(id,authorization,options){
    const row=this.row(id,options),token=/^Bearer qnp_([A-Za-z0-9_-]{43})$/.exec(authorization||'')?.[1];
    if(!token||!equal(row.secret_hash,digest(token)))throw fail(401,'NEKO_LINK_UNAUTHORIZED');
    return row;
  }
  owner(row){
    const owner=this.store.ownerById(row.owner_id);
    if(!owner||!this.nekoAuth.capabilities(owner).linked)throw fail(403,'NEKO_LOGIN_REQUIRED');
    return owner;
  }
  async job(row){
    try{return await this.accounts.job(this.owner(row),row.game_request_id);}
    catch(error){if(error.status===404&&error.reason==='JOB_NOT_FOUND')return null;throw error;}
  }
  async status(row){
    const base={clientId:row.client_id,username:row.username,gameAddress:this.config.publicGameAddress,gameVersion:'1.21.1',gameConnectionStarted:false};
    // Expiry blocks new activation, not recovery of this exact submitted job.
    const job=row.owner_id?await this.job(row):null,ready=job?.state==='succeeded';
    if(!job&&row.expires_at<=this.now())return{...base,phase:row.activation_attempted?'unknown':'expired',ready:false,renewable:!row.activation_attempted};
    if(!row.owner_id)return{...base,phase:'authorization_required',ready:false};
    return{...base,phase:ready?'ready':job?.state||(row.activation_attempted?'unknown':'approved'),ready,
      gameAccountCreated:ready,playerUuid:ready?job.playerUuid:null,provider:'neko'};
  }
  async activate(row,body){
    this.nekoAuth.requireEnabled();
    if(body.requestId!==row.game_request_id||body.username!==row.username)throw fail(409,'NEKO_LINK_CONFLICT');
    const old=await this.job(row);
    if(old)return this.status(row);
    if(row.activation_attempted)throw fail(409,'NEKO_LINK_RESULT_UNKNOWN');
    if(typeof body.gamePassword!=='string'||body.gamePassword.length<6||body.gamePassword.length>64||/\s/.test(body.gamePassword))throw fail(400,'INVALID_GAME_PASSWORD');
    // The receiver is fenced too: missing/unknown jobs never authorize a replay.
    if(this.store.db.prepare('UPDATE neko_plugin_links SET activation_attempted=1 WHERE client_id=? AND activation_attempted=0').run(row.client_id).changes!==1)throw fail(409,'NEKO_LINK_RESULT_UNKNOWN');
    await this.accounts.start(this.owner(row),'create',{requestId:row.game_request_id,username:row.username,gamePassword:body.gamePassword});
    return this.status({...row,activation_attempted:1});
  }
  async renew(row){
    this.nekoAuth.requireEnabled();
    if(row.expires_at>this.now())return this.status(row);
    if(row.activation_attempted||row.owner_id&&await this.job(row))throw fail(409,'NEKO_LINK_RESULT_UNKNOWN');
    if(this.store.db.prepare('UPDATE neko_plugin_links SET owner_id=NULL,expires_at=? WHERE client_id=? AND activation_attempted=0 AND expires_at=?')
      .run(this.now()+10*60000,row.client_id,row.expires_at).changes!==1)throw fail(409,'NEKO_LINK_CONFLICT');
    return this.status(this.row(row.client_id));
  }
}
