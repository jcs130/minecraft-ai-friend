import {createHash,createPublicKey,randomUUID,timingSafeEqual,verify} from 'node:crypto';
import {digest,newSecret,hashPassword} from './store.mjs';

export const NEKO_ISSUER='https://auth.project-neko.cn/';
export const NEKO_CALLBACK='/api/v1/auth/neko/callback';
const flowCookie='__Host-qd_neko_flow';
const fail=reason=>Object.assign(new Error('猫娘计划授权尚未完成，请从千灯纪重新开始。'),{status:400,reason});
const secret=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&timingSafeEqual(Buffer.from(digest(a)),Buffer.from(digest(b)));

async function remoteJson(fetcher,url,options={}){
  let response;
  try{response=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(10000)});}
  catch{throw fail('NEKO_AUTH_UPSTREAM_UNAVAILABLE');}
  const chunks=[];let bytes=0;
  try{
    for await(const chunk of response.body){bytes+=chunk.length;if(bytes>131072)throw Error();chunks.push(chunk);}
    const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!response.ok||!data||typeof data!=='object'||Array.isArray(data))throw Error();
    return data;
  }catch{throw fail('NEKO_AUTH_INVALID_RESPONSE');}
}

export function verifyNekoIdentity(encoded,jwks,{clientId,nonce,now=Date.now()}){
  try{
    if(typeof encoded!=='string'||encoded.length>16384)throw Error();
    const parts=encoded.split('.');if(parts.length!==3||parts.some(x=>!x||!/^[A-Za-z0-9_-]+$/.test(x)))throw Error();
    const header=JSON.parse(Buffer.from(parts[0],'base64url')),body=JSON.parse(Buffer.from(parts[1],'base64url'));
    if(header.alg!=='RS256'||header.crit||typeof header.kid!=='string'||header.kid.length>128)throw Error();
    if(!Array.isArray(jwks.keys)||jwks.keys.length>32)throw Error();
    const keys=jwks.keys.filter(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig')&&(!k.alg||k.alg==='RS256'));
    if(keys.length!==1||keys[0].d)throw Error();
    const key=createPublicKey({key:keys[0],format:'jwk'});
    if((key.asymmetricKeyDetails?.modulusLength||0)<2048||!verify('RSA-SHA256',Buffer.from(parts.slice(0,2).join('.')),key,Buffer.from(parts[2],'base64url')))throw Error();
    const audiences=typeof body.aud==='string'?[body.aud]:body.aud;
    const seconds=Math.floor(now/1000);
    if(body.iss!==NEKO_ISSUER||!Array.isArray(audiences)||!audiences.includes(clientId)
      ||audiences.some(x=>typeof x!=='string')||audiences.length>1&&body.azp!==clientId
      ||body.azp!==undefined&&body.azp!==clientId||!equal(body.nonce,nonce)
      ||!Number.isInteger(body.exp)||body.exp<=seconds-30||!Number.isInteger(body.iat)||body.iat>seconds+30
      ||body.nbf!==undefined&&(!Number.isInteger(body.nbf)||body.nbf>seconds+30)
      ||typeof body.sub!=='string'||!body.sub||body.sub.length>255||/[\x00-\x20\x7f]/.test(body.sub))throw Error();
    return{issuer:NEKO_ISSUER,subject:body.sub};
  }catch{throw fail('NEKO_AUTH_IDENTITY_REJECTED');}
}

export class NekoAuth{
  constructor(config,store,{fetcher=fetch,now=Date.now}={}){
    Object.assign(this,{config,store,fetcher,now});
    store.db.exec(`CREATE TABLE IF NOT EXISTS neko_auth_flows(state_hash TEXT PRIMARY KEY,cookie_hash TEXT NOT NULL,session_hash TEXT NOT NULL,owner_id TEXT,verifier TEXT NOT NULL,nonce TEXT NOT NULL,expires_at INTEGER NOT NULL,request_id TEXT,mode TEXT NOT NULL DEFAULT 'login');
      CREATE TABLE IF NOT EXISTS external_identities(provider TEXT NOT NULL,issuer TEXT NOT NULL,client_id TEXT NOT NULL,subject TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES owners(id),created_at INTEGER NOT NULL,PRIMARY KEY(provider,issuer,client_id,subject),UNIQUE(provider,owner_id));`);
    if(!store.db.prepare('PRAGMA table_info(neko_auth_flows)').all().some(column=>column.name==='mode'))
      store.db.exec("ALTER TABLE neko_auth_flows ADD COLUMN mode TEXT NOT NULL DEFAULT 'login'");
  }
  capabilities(owner){
    const settings=this.config.nekoAuth||{};
    const available=settings.enabled===true&&typeof settings.clientId==='string'&&/^[A-Za-z0-9._-]{3,128}$/.test(settings.clientId)
      &&!['neko-desktop','neko-servers-desktop-prod','neko-servers-web-prod'].includes(settings.clientId)
      &&!!this.config.publicOrigin&&new URL(this.config.publicOrigin).protocol==='https:';
    const linked=!!owner&&!!this.store.db.prepare("SELECT 1 FROM external_identities WHERE provider='neko' AND issuer=? AND client_id=? AND owner_id=?").get(NEKO_ISSUER,settings.clientId||'',owner.id);
    return{available,linked,provider:'neko',label:'猫娘计划',reason:available?null:'provider_not_configured'};
  }
  requireEnabled(){if(!this.capabilities().available)throw Object.assign(fail('NEKO_AUTH_NOT_CONFIGURED'),{status:503});}
  begin(session,{mode='login',requestId=null}={}){
    this.requireEnabled();
    if(!['login','link','reauth'].includes(mode))throw fail('NEKO_AUTH_MODE_REJECTED');
    if(!session||session.expires_at<=this.now()||mode==='login'&&session.owner_id
      ||mode!=='login'&&!session.owner_id||mode==='link'&&session.verified_at<this.now()-10*60000
      ||mode==='reauth'&&!this.capabilities(this.store.ownerById(session.owner_id)).linked)throw fail('NEKO_AUTH_SESSION_REQUIRED');
    const state=newSecret(),cookie=newSecret(),verifier=newSecret(),nonce=newSecret(),expires=this.now()+5*60000;
    this.store.db.prepare('DELETE FROM neko_auth_flows WHERE expires_at<=?').run(this.now());
    if(this.store.db.prepare('SELECT count(*) AS n FROM neko_auth_flows').get().n>=1000)throw fail('NEKO_AUTH_BUSY');
    this.store.db.prepare('INSERT INTO neko_auth_flows VALUES(?,?,?,?,?,?,?,?,?)').run(digest(state),digest(cookie),session.id_hash,session.owner_id,verifier,nonce,expires,requestId,mode);
    const params=new URLSearchParams({client_id:this.config.nekoAuth.clientId,response_type:'code',scope:'openid',
      redirect_uri:this.config.publicOrigin+NEKO_CALLBACK,state,nonce,code_challenge_method:'S256',
      code_challenge:createHash('sha256').update(verifier).digest('base64url')});
    return{authorizationUrl:NEKO_ISSUER+'oauth2/auth?'+params,expiresAt:new Date(expires).toISOString(),
      cookie:`${flowCookie}=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300`};
  }
  async complete(url,cookies='',device='电脑浏览器'){
    this.requireEnabled();
    const state=url.searchParams.get('state'),code=url.searchParams.get('code');
    const cookie=cookies.split(';').map(v=>v.trim().split('=')).find(([k])=>k===flowCookie)?.[1];
    if(!secret(state)||!secret(cookie)||url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length!==1
      ||typeof code!=='string'||!code||code.length>4096||url.searchParams.has('error'))throw fail('NEKO_AUTH_STATE_REJECTED');
    const row=this.store.db.prepare('SELECT * FROM neko_auth_flows WHERE state_hash=? AND cookie_hash=? AND expires_at>?').get(digest(state),digest(cookie),this.now());
    if(!row)throw fail('NEKO_AUTH_STATE_REJECTED');
    const session=this.store.db.prepare('SELECT * FROM sessions WHERE id_hash=? AND expires_at>?').get(row.session_hash,this.now());
    if(!session||session.owner_id!==row.owner_id)throw fail('NEKO_AUTH_SESSION_REQUIRED');
    // Consume before exchange. A lost provider response never repeats this code.
    if(this.store.db.prepare('DELETE FROM neko_auth_flows WHERE state_hash=?').run(digest(state)).changes!==1)throw fail('NEKO_AUTH_STATE_REJECTED');
    const body=new URLSearchParams({grant_type:'authorization_code',client_id:this.config.nekoAuth.clientId,
      redirect_uri:this.config.publicOrigin+NEKO_CALLBACK,code,code_verifier:row.verifier});
    if(this.config.nekoAuth.clientSecret)body.set('client_secret',this.config.nekoAuth.clientSecret);
    const token=await remoteJson(this.fetcher,NEKO_ISSUER+'oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
    if(String(token.token_type).toLowerCase()!=='bearer')throw fail('NEKO_AUTH_INVALID_RESPONSE');
    const jwks=await remoteJson(this.fetcher,NEKO_ISSUER+'.well-known/jwks.json');
    const identity=verifyNekoIdentity(token.id_token,jwks,{clientId:this.config.nekoAuth.clientId,nonce:row.nonce,now:this.now()});
    const passwordHash=await hashPassword(newSecret());
    this.store.db.exec('BEGIN IMMEDIATE');
    try{
      // No await occurs between this fence, identity mutation and session rotation.
      // Logging out/switching while the provider is responding cannot relogin.
      const current=this.store.db.prepare('SELECT * FROM sessions WHERE id_hash=? AND expires_at>?').get(row.session_hash,this.now());
      if(!current||current.owner_id!==row.owner_id||row.expires_at<=this.now()
        ||row.mode==='link'&&current.verified_at<this.now()-10*60000)throw fail('NEKO_AUTH_SESSION_REQUIRED');
      const owner=this.resolveOwner(identity,row.owner_id,passwordHash,row.mode);
      const created=this.store.createSession(owner.id,device);
      this.store.deleteSession(row.session_hash);
      this.store.audit(owner.id,row.mode==='link'?'account.neko.link':row.mode==='reauth'?'session.neko.reauth':'session.neko.login',owner.id);
      this.store.db.exec('COMMIT');
      return{owner,token:created.token,session:created.session,requestId:row.request_id};
    }catch(error){this.store.db.exec('ROLLBACK');throw error;}
  }
  resolveOwner(identity,requestedOwner,passwordHash,mode){
      const old=this.store.db.prepare("SELECT owner_id FROM external_identities WHERE provider='neko' AND issuer=? AND client_id=? AND subject=?").get(identity.issuer,this.config.nekoAuth.clientId,identity.subject);
      if(old){
        if(requestedOwner&&old.owner_id!==requestedOwner)throw fail('NEKO_ACCOUNT_ALREADY_LINKED');
        const owner=this.store.ownerById(old.owner_id);if(!owner)throw fail('NEKO_ACCOUNT_UNAVAILABLE');
        return owner;
      }
      if(mode==='reauth')throw fail('NEKO_ACCOUNT_REAUTH_MISMATCH');
      let owner;
      if(requestedOwner){
        owner=this.store.ownerById(requestedOwner);
        if(!owner||this.capabilities(owner).linked)throw fail('NEKO_ACCOUNT_ALREADY_LINKED');
      }else{
        if(!this.config.allowRegistration||this.store.countOwners()===0)throw fail('NEKO_ACCOUNT_REGISTRATION_CLOSED');
        const username='neko_'+digest(identity.issuer+'\0'+this.config.nekoAuth.clientId+'\0'+identity.subject).slice(0,16);
        if(this.store.ownerByName(username))throw fail('NEKO_ACCOUNT_CONFLICT');
        owner={id:randomUUID(),username,normalized:username.toLowerCase(),password_hash:passwordHash,role:'owner',created_at:this.now()};
        this.store.db.prepare('INSERT INTO owners(id,username,normalized,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(...Object.values(owner));
      }
      this.store.db.prepare("INSERT INTO external_identities VALUES('neko',?,?,?,?,?)").run(identity.issuer,this.config.nekoAuth.clientId,identity.subject,owner.id,this.now());
      return owner;
  }
  clearCookie(){return`${flowCookie}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;}
}
