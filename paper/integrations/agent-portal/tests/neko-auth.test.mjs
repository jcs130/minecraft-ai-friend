import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store,hashPassword} from '../src/store.mjs';
import {NekoAuth,NEKO_ISSUER,NEKO_CALLBACK,verifyNekoIdentity} from '../src/neko-auth.mjs';
import {NekoPluginLinks} from '../src/neko-plugin-links.mjs';

const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...keys.publicKey.export({format:'jwk'}),kid:'fixture',use:'sig',alg:'RS256'};
const now=Date.now(),clientId='qiandengji-test-client';
function token(overrides={},header={}){
  const body={iss:NEKO_ISSUER,sub:'fixture-subject',aud:clientId,nonce:'a'.repeat(43),iat:Math.floor(now/1000),exp:Math.floor(now/1000)+300,...overrides};
  const value=[{alg:'RS256',kid:'fixture',...header},body].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  return value+'.'+sign('RSA-SHA256',Buffer.from(value),keys.privateKey).toString('base64url');
}
async function fixture(t,extra={}){
  const base=path.resolve(os.tmpdir()),root=await fs.mkdtemp(path.join(base,'qd-neko-auth-'));
  const store=new Store(root);
  store.createOwner('fixture-admin',await hashPassword('fixture-private-password'),'admin');
  const requests=[];let nonce='a'.repeat(43);
  const config={allowRegistration:true,publicOrigin:'https://portal.example',publicGameAddress:'micro.kangqiang.site:25702',nekoAuth:{enabled:true,clientId},...extra};
  const auth=new NekoAuth(config,store,{now:()=>now,fetcher:async(url,options)=>{
    requests.push({url,options});
    return new Response(JSON.stringify(url.endsWith('/oauth2/token')?{token_type:'Bearer',access_token:'fixture-access-token',id_token:token({nonce})}:{keys:[jwk]}));
  }});
  t.after(async()=>{store.close();assert.ok(path.resolve(root).startsWith(base+path.sep));await fs.rm(root,{recursive:true,force:true});});
  function flow(owner=null,options={}){
    const session=store.createSession(owner?.id).session;
    const begin=auth.begin(session,options),url=new URL(begin.authorizationUrl);
    nonce=url.searchParams.get('nonce');
    return{session,begin,url,callback:new URL(config.publicOrigin+NEKO_CALLBACK+'?code=fixture-code&state='+url.searchParams.get('state')),
      cookies:begin.cookie.split(';')[0]};
  }
  return{store,auth,config,requests,flow};
}

test('official Neko identity requires exact issuer, audience, nonce and signed valid lifetime',()=>{
  assert.deepEqual(verifyNekoIdentity(token(),{keys:[jwk]},{clientId,nonce:'a'.repeat(43),now}),{issuer:NEKO_ISSUER,subject:'fixture-subject'});
  for(const bad of [{iss:'https://attacker.example/'},{aud:'neko-desktop'},{nonce:'wrong'},{sub:''},{exp:Math.floor(now/1000)-60},{iat:Math.floor(now/1000)+60},{aud:[clientId,'other']},{nbf:Math.floor(now/1000)+60}])
    assert.throws(()=>verifyNekoIdentity(token(bad),{keys:[jwk]},{clientId,nonce:'a'.repeat(43),now}),/授权尚未完成/);
  for(const header of [{alg:'none'},{alg:'HS256'},{kid:'unknown'},{crit:['custom']}])
    assert.throws(()=>verifyNekoIdentity(token({},header),{keys:[jwk]},{clientId,nonce:'a'.repeat(43),now}));
  assert.throws(()=>verifyNekoIdentity(token().slice(0,-10)+'AAAAAAAAAA',{keys:[jwk]},{clientId,nonce:'a'.repeat(43),now}));
  assert.throws(()=>verifyNekoIdentity(token(),{keys:[jwk,jwk]},{clientId,nonce:'a'.repeat(43),now}));
});

test('Neko OAuth uses own registered client, PKCE and a browser-bound single-use callback',async t=>{
  const f=await fixture(t),flow=f.flow();
  assert.equal(flow.url.origin,'https://auth.project-neko.cn');assert.equal(flow.url.searchParams.get('scope'),'openid');
  assert.equal(flow.url.searchParams.get('redirect_uri'),'https://portal.example'+NEKO_CALLBACK);
  assert.match(flow.begin.cookie,/HttpOnly; Secure; SameSite=Lax/);
  const row=f.store.db.prepare('SELECT * FROM neko_auth_flows').get();
  assert.equal(flow.url.searchParams.get('code_challenge'),createHash('sha256').update(row.verifier).digest('base64url'));
  await assert.rejects(f.auth.complete(flow.callback,'__Host-qd_neko_flow='+'b'.repeat(43)));
  assert.equal(f.requests.length,0);
  const done=await f.auth.complete(flow.callback,flow.cookies);
  assert.equal(done.owner.role,'owner');assert.equal(f.store.countOwners(),2);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM external_identities').get().n,1);
  const exchange=new URLSearchParams(f.requests[0].options.body);
  assert.equal(exchange.get('code_verifier'),row.verifier);assert.equal(exchange.get('client_id'),clientId);
  await assert.rejects(f.auth.complete(flow.callback,flow.cookies));assert.equal(f.requests.length,2);
  assert.ok(!JSON.stringify(done).includes('fixture-access-token'));
  const again=f.flow();assert.equal((await f.auth.complete(again.callback,again.cookies)).owner.id,done.owner.id);
  assert.equal(f.store.countOwners(),2);
});

test('linking preserves the original owner and rejects a Neko identity already bound elsewhere',async t=>{
  const f=await fixture(t),original=f.store.createOwner('OriginalOwner',await hashPassword('unchanged-original-secret'));
  const before=JSON.stringify(original),flow=f.flow(original,{mode:'link'});
  assert.equal((await f.auth.complete(flow.callback,flow.cookies)).owner.id,original.id);
  assert.equal(JSON.stringify(f.store.ownerById(original.id)),before);
  const other=f.store.createOwner('OtherOwner',await hashPassword('other-original-secret'));
  const wrong=f.flow(other,{mode:'link'});await assert.rejects(f.auth.complete(wrong.callback,wrong.cookies));
  assert.equal(f.store.db.prepare('SELECT owner_id FROM external_identities').get().owner_id,original.id);
});

test('logout, disabled registration and disabled provider cannot create or link an owner',async t=>{
  const f=await fixture(t),flow=f.flow();f.store.deleteSession(flow.session.id_hash);
  await assert.rejects(f.auth.complete(flow.callback,flow.cookies));assert.equal(f.requests.length,0);
  const closed=f.flow();f.config.allowRegistration=false;
  await assert.rejects(f.auth.complete(closed.callback,closed.cookies));assert.equal(f.store.countOwners(),1);
  f.config.nekoAuth.enabled=false;
  assert.equal(f.auth.capabilities().available,false);assert.throws(()=>f.flow());
});

test('logout or account switch during the provider exchange cannot commit a binding or a new session',async t=>{
  for(const action of ['logout','switch'])await t.test(action,async t=>{
    const f=await fixture(t),flow=f.flow(),fetcher=f.auth.fetcher;
    let entered,release;
    const waiting=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
    f.auth.fetcher=async(...args)=>{entered();await gate;return fetcher(...args);};
    const result=f.auth.complete(flow.callback,flow.cookies);
    await waiting;
    if(action==='logout')f.store.deleteSession(flow.session.id_hash);
    else f.store.db.prepare('UPDATE sessions SET owner_id=? WHERE id_hash=?').run(f.store.ownerByName('fixture-admin').id,flow.session.id_hash);
    const sessions=f.store.db.prepare('SELECT count(*) AS n FROM sessions').get().n;
    release();await assert.rejects(result,error=>error.reason==='NEKO_AUTH_SESSION_REQUIRED');
    assert.equal(f.store.countOwners(),1);
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM external_identities').get().n,0);
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM sessions').get().n,sessions);
  });
});

test('SSO reauthentication works for an aged session and requires its same linked identity',async t=>{
  const f=await fixture(t),flow=f.flow(),done=await f.auth.complete(flow.callback,flow.cookies);
  f.store.db.prepare('UPDATE sessions SET verified_at=? WHERE id_hash=?').run(now-11*60000,done.session.id_hash);
  const aged=f.store.db.prepare('SELECT * FROM sessions WHERE id_hash=?').get(done.session.id_hash);
  assert.throws(()=>f.auth.begin(aged,{mode:'link'}));
  function reauth(session,subject){
    const begin=f.auth.begin(session,{mode:'reauth'}),url=new URL(begin.authorizationUrl);
    f.auth.fetcher=async target=>new Response(JSON.stringify(target.endsWith('/oauth2/token')?
      {token_type:'Bearer',id_token:token({nonce:url.searchParams.get('nonce'),sub:subject})}:{keys:[jwk]}));
    return f.auth.complete(new URL(f.config.publicOrigin+NEKO_CALLBACK+'?code=fixture-code&state='+url.searchParams.get('state')),begin.cookie.split(';')[0]);
  }
  await assert.rejects(reauth(aged,'another-subject'),error=>error.reason==='NEKO_ACCOUNT_REAUTH_MISMATCH');
  assert.ok(f.store.getSession(done.token));
  const renewed=await reauth(aged,'fixture-subject');
  assert.equal(renewed.owner.id,done.owner.id);assert.ok(renewed.session.verified_at>aged.verified_at);
  assert.equal(f.store.getSession(done.token),undefined);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM external_identities').get().n,1);
  assert.equal(f.store.countOwners(),2);
});

test('plugin approval grants only one fixed new game request and never returns provider credentials',async t=>{
  const f=await fixture(t),flow=f.flow(),owner=(await f.auth.complete(flow.callback,flow.cookies)).owner;
  const jobs=new Map(),calls=[];
  const accounts={job:async(_owner,id)=>{if(!jobs.has(id))throw Object.assign(Error(),{status:404,reason:'JOB_NOT_FOUND'});return jobs.get(id);},
    start:async(o,kind,body)=>{calls.push({o,kind,body});jobs.set(body.requestId,{state:'pending'});}};
  const links=new NekoPluginLinks(f.config,f.store,accounts,f.auth,{now:()=>now});
  const body={clientId:randomUUID(),clientSecret:'c'.repeat(43),username:'ag_NekoTest',requestId:randomUUID()};
  const started=links.create(body);assert.equal(links.create(body).clientId,body.clientId);
  assert.ok(!JSON.stringify(started).includes(body.clientSecret));
  assert.throws(()=>links.authorize(body.clientId,'Bearer fixture-access-token'));
  let row=links.authorize(body.clientId,'Bearer qnp_'+body.clientSecret);
  assert.equal((await links.status(row)).phase,'authorization_required');
  await assert.rejects(links.activate(row,{requestId:body.requestId,username:body.username,gamePassword:'private-game-password'}));
  links.approve(body.clientId,owner);row=links.authorize(body.clientId,'Bearer qnp_'+body.clientSecret);
  await assert.rejects(links.activate(row,{requestId:randomUUID(),username:body.username,gamePassword:'private-game-password'}));
  assert.equal((await links.activate(row,{requestId:body.requestId,username:body.username,gamePassword:'private-game-password'})).ready,false);
  assert.equal(calls.length,1);assert.equal(calls[0].kind,'create');assert.equal(calls[0].o.id,owner.id);
  const known=links.authorize(body.clientId,'Bearer qnp_'+body.clientSecret);
  await links.activate(known,{requestId:body.requestId,username:body.username,gamePassword:'private-game-password'});
  assert.equal(calls.length,1);
  jobs.set(body.requestId,{state:'succeeded',playerUuid:randomUUID()});
  const ready=await links.status(known);assert.equal(ready.ready,true);
  assert.ok(!JSON.stringify(ready).includes('private-game-password'));assert.ok(!JSON.stringify(ready).includes('fixture-access-token'));
});

test('unknown activation is not resubmitted and a second owner cannot steal a pending link',async t=>{
  const f=await fixture(t),flow=f.flow(),owner=(await f.auth.complete(flow.callback,flow.cookies)).owner;
  const other=f.store.createOwner('OtherLinkedOwner',await hashPassword('private-password'));
  f.store.db.prepare("INSERT INTO external_identities VALUES('neko',?,?,?,?,?)").run(NEKO_ISSUER,clientId,'other-subject',other.id,now);
  let writes=0;
  const accounts={job:async()=>{throw Object.assign(Error(),{status:404,reason:'JOB_NOT_FOUND'});},start:async()=>{writes++;throw Error('lost result');}};
  const links=new NekoPluginLinks(f.config,f.store,accounts,f.auth,{now:()=>now});
  const body={clientId:randomUUID(),clientSecret:'d'.repeat(43),username:'ag_Unknown',requestId:randomUUID()};links.create(body);links.approve(body.clientId,owner);
  assert.throws(()=>links.approve(body.clientId,other));
  const row=()=>links.authorize(body.clientId,'Bearer qnp_'+body.clientSecret);
  const action={requestId:body.requestId,username:body.username,gamePassword:'private-game-password'};
  await assert.rejects(links.activate(row(),action));await assert.rejects(links.activate(row(),action));
  assert.equal(writes,1);assert.equal((await links.status(row())).phase,'unknown');
});

test('explicit renewal preserves the same identity and cannot reopen an attempted game request',async t=>{
  const f=await fixture(t);let clock=now;
  const accounts={job:async()=>{throw Object.assign(Error(),{status:404,reason:'JOB_NOT_FOUND'});},start:async()=>assert.fail('renewal must never create a game')};
  const links=new NekoPluginLinks(f.config,f.store,accounts,f.auth,{now:()=>clock});
  const body={clientId:randomUUID(),clientSecret:'e'.repeat(43),username:'ag_Renew',requestId:randomUUID()};
  links.create(body);clock+=11*60000;
  const read=()=>links.authorize(body.clientId,'Bearer qnp_'+body.clientSecret,{allowExpired:true});
  assert.equal((await links.status(read())).phase,'expired');
  assert.equal((await links.renew(read())).phase,'authorization_required');
  const renewed=read();assert.equal(renewed.game_request_id,body.requestId);assert.equal(renewed.username,body.username);
  await links.renew(renewed);assert.equal(read().expires_at,renewed.expires_at);
  f.store.db.prepare('UPDATE neko_plugin_links SET activation_attempted=1,expires_at=? WHERE client_id=?').run(clock-1,body.clientId);
  assert.equal((await links.status(read())).renewable,false);await assert.rejects(links.renew(read()));
  assert.equal(read().activation_attempted,1);
});

test('expired grants can read the original submitted game result but cannot create another character',async t=>{
  const f=await fixture(t),flow=f.flow(),owner=(await f.auth.complete(flow.callback,flow.cookies)).owner;
  let clock=now;const jobs=new Map(),calls=[];
  const accounts={job:async(_owner,id)=>{if(!jobs.has(id))throw Object.assign(Error(),{status:404,reason:'JOB_NOT_FOUND'});return jobs.get(id);},
    start:async(_owner,_kind,body)=>{calls.push(body);jobs.set(body.requestId,{state:'pending'});}};
  const links=new NekoPluginLinks(f.config,f.store,accounts,f.auth,{now:()=>clock});
  const body={clientId:randomUUID(),clientSecret:'f'.repeat(43),username:'ag_Recovery',requestId:randomUUID()};
  links.create(body);links.approve(body.clientId,owner);
  await links.activate(links.row(body.clientId),{requestId:body.requestId,username:body.username,gamePassword:'private-game-password'});
  clock+=8*86400000;
  const read=()=>links.authorize(body.clientId,'Bearer qnp_'+body.clientSecret,{allowExpired:true});
  assert.equal((await links.status(read())).phase,'pending');
  assert.throws(()=>links.authorize(body.clientId,'Bearer qnp_'+body.clientSecret));
  await assert.rejects(links.renew(read()));
  jobs.set(body.requestId,{state:'succeeded',playerUuid:randomUUID()});
  assert.equal((await links.status(read())).ready,true);
  assert.equal(calls.length,1);
});
