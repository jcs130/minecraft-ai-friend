import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {EventEmitter} from 'node:events';
import {request as httpRequest} from 'node:http';
import assert from 'node:assert/strict';
import test from 'node:test';
import {DesktopDevices} from '../src/desktop-devices.mjs';
import {ResidentTurns} from '../src/resident-turns.mjs';
import {siteFixture,testPassword} from './helpers.mjs';

const random = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');
const origin = 'https://portal.example';
const redirectUri = 'http://127.0.0.1:39457/qd-desktop/callback';
const bearer = token => 'Bearer ' + token;

function fixture(t) {
  let clock = 100_000;
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE owners(id TEXT PRIMARY KEY); CREATE TABLE ownerships(agent_uuid TEXT PRIMARY KEY,owner_id TEXT NOT NULL)');
  const owner = {id:randomUUID(),username:'Fixture owner'}, stranger = {id:randomUUID(),username:'Fixture stranger'};
  for (const person of [owner,stranger]) db.prepare('INSERT INTO owners VALUES(?)').run(person.id);
  const worker = 'rwt_' + random();
  const role = {id:'existing',name:'结衣',bodyKind:'maid',bodyId:randomUUID(),characterId:randomUUID(),
    ownerGameId:randomUUID(),workerHash:digest(worker)};
  db.prepare('INSERT INTO ownerships VALUES(?,?)').run(role.ownerGameId,owner.id);
  const store = {db,ownerById:id=>[owner,stranger].find(p=>p.id===id),
    ownedUuids:id=>db.prepare('SELECT agent_uuid FROM ownerships WHERE owner_id=?').all(id).map(r=>r.agent_uuid)};
  const config = {residentTurns:[role]};
  const now = () => clock;
  const boot = () => {
    const residents = new ResidentTurns(config,store,{now,waitMs:1000});
    const devices = new DesktopDevices({store,residents,publicOrigin:origin,now});
    return {residents,devices};
  };
  return {...boot(),db,owner,stranger,role,worker,boot,advance:ms=>{clock+=ms;}};
}

function flow(devices, redirect = redirectUri) {
  const request = {headers:{'x-qd-device':randomUUID(),'x-qd-device-proof':random()}};
  const verifier = random(), state = random();
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const login = devices.begin({name:'N.E.K.O. Fixture',challenge,state,redirectUri:redirect},request);
  return {request,login,input:{id:login.id,verifier,state,redirectUri:redirect}};
}

function approve(f, registration, migrate = false) {
  const result = f.devices.approve(f.owner,{id:registration.login.id,role:f.role.id,characterId:f.role.characterId,
    migrate, ...(registration.login.code ? {code:registration.login.code} : {})});
  if (result.redirect) registration.input.code = new URL(result.redirect).searchParams.get('code');
  return result;
}

function exchange(f, registration) {
  const result = f.devices.exchange(registration.input,registration.request);
  registration.request.headers.authorization = bearer(result.accessToken);
  return result;
}

test('loopback consent preserves original UUID and scopes the session to a device and role', async t => {
  const f = fixture(t);
  const login = flow(f.devices);
  assert.equal(login.login.code,undefined);
  assert.equal(f.devices.preview(f.stranger,login.login.id).characters.length,0);
  const shown = f.devices.preview(f.owner,login.login.id);
  assert.equal(shown.account,f.owner.username);
  assert.equal(shown.characters[0].bodyId,f.role.bodyId);
  assert.throws(()=>f.devices.approve(f.stranger,{id:login.login.id,role:f.role.id,characterId:f.role.characterId}),
    {reason:'DESKTOP_CHARACTER_UNAVAILABLE'});
  const consent = approve(f,login);
  const url = new URL(consent.redirect);
  assert.equal(url.origin,new URL(redirectUri).origin);
  assert.equal(url.searchParams.get('iss'),origin);
  assert.equal(url.searchParams.get('state'),login.input.state);
  for (const changes of [{verifier:random()},{state:random()},{redirectUri:redirectUri.replace('39457','39458')},{code:random()}])
    assert.throws(()=>f.devices.exchange({...login.input,...changes},login.request),{reason:'DESKTOP_FLOW_ENDED'});
  assert.throws(()=>f.devices.exchange(login.input,{headers:{}}),{reason:'DESKTOP_FLOW_ENDED'});
  const device = exchange(f,login);
  assert.equal(device.character,f.role.characterId);
  assert.throws(()=>f.devices.exchange(login.input,login.request),{reason:'DESKTOP_FLOW_ENDED'});
  assert.equal(f.residents.roles.get(f.role.id).grant,null);
  const row = f.devices.access(login.request);
  assert.equal((await f.devices.status(row)).character.bodyId,f.role.bodyId);
  assert.throws(()=>f.devices.access({headers:{authorization:bearer(device.accessToken)}}),
    {reason:'DESKTOP_AUTHORIZATION_ENDED'});
});

test('migration hands off only the approved legacy grant and avoids a second controller', async t => {
  const f = fixture(t);
  const role = f.residents.roles.get(f.role.id);
  const old = f.residents.grant(role,f.owner.id,origin);
  const unapproved = flow(f.devices); approve(f,unapproved); exchange(f,unapproved);
  assert.equal((await f.devices.status(f.devices.access(unapproved.request))).controller,'resident_plugin');
  const migrated = flow(f.devices); approve(f,migrated,true); exchange(f,migrated);
  const row = f.devices.access(migrated.request), requestId = randomUUID();
  const play = await f.devices.start(row,{requestId,mode:'maid'},migrated.request);
  assert.equal(play.resident.bodyId,old.resident.bodyId);
  assert.equal(play.resident.characterId,old.resident.characterId);
  assert.throws(()=>f.residents.authorize(role,{headers:{authorization:bearer(old.token)}},false),{status:401});
  assert.throws(()=>f.residents.grant(role,f.owner.id,origin),{reason:'DESKTOP_BODY_BUSY'});
  await assert.rejects(f.devices.start(f.devices.access(unapproved.request),{requestId:randomUUID(),mode:'maid'},unapproved.request),
    {reason:'DESKTOP_BODY_BUSY'});
  assert.deepEqual(await f.devices.start(row,{requestId,mode:'maid'},migrated.request),play);
  assert.throws(()=>f.residents.authorize(role,{headers:{authorization:bearer(play.token)}},false),{status:401});
  f.residents.authorize(role,{headers:{...migrated.request.headers,authorization:bearer(play.token)}},false);
  assert.equal(f.residents.desktopController(role).desktop,row.id);
  f.devices.stop(row,randomUUID());
  assert.notEqual(f.residents.desktopController(role),null);
  f.devices.stop(row,requestId);
  assert.equal(f.residents.desktopController(role),null);
});

test('reopen after legacy sessions expire, rotate after a lost response, and revoke on the website', async t => {
  const f = fixture(t);
  const login = flow(f.devices,null);
  assert.match(login.login.code,/^\d{6}$/);
  assert.deepEqual(f.devices.exchange(login.input,login.request),{pending:true});
  assert.throws(()=>f.devices.approve(f.owner,{id:login.login.id,role:f.role.id,
    characterId:f.role.characterId,code:'xxxxxx'}),{reason:'DESKTOP_CODE_INVALID'});
  approve(f,login);
  const old = exchange(f,login);
  f.advance(13*3600_000);
  const {devices,residents} = f.boot();
  assert.throws(()=>devices.access(login.request),{status:401});
  const rotation = {refreshToken:old.refreshToken,rotationId:randomUUID()};
  const next = devices.refresh(rotation,login.request);
  assert.notEqual(next.refreshToken,old.refreshToken);
  assert.deepEqual(devices.refresh(rotation,login.request),next);
  login.request.headers.authorization = bearer(next.accessToken);
  const row = devices.access(login.request);
  const status = await devices.status(row);
  assert.equal(status.character.bodyId,f.role.bodyId);
  assert.equal(status.controller,null);
  const play = await devices.start(row,{requestId:randomUUID(),mode:'maid'},login.request);
  assert.equal(play.resident.characterId,f.role.characterId);

  // A real portal worker round needs the original body IDs. A fresh login
  // alone never offers a model round.
  const prefix = '/api/v1/resident-turns/' + f.role.id;
  const invoke = async (op, headers, input) => {
    const response = new EventEmitter();
    return new Promise((resolve,reject)=> {
      residents.machine({method:'POST',headers},response,prefix+'/'+op,async()=>input,(_res,_code,result)=>resolve(result)).catch(reject);
    });
  };
  const offer = {bodyId:f.role.bodyId,characterId:f.role.characterId,bodyKind:f.role.bodyKind,
    ownerGameId:f.role.ownerGameId,kind:'plan',instructions:'Fixture',scene:{}};
  const offered = invoke('offer',{authorization:bearer(f.worker)},offer);
  const headers = {...login.request.headers,authorization:bearer(play.token)};
  const {turn} = await invoke('poll',headers,{});
  assert.equal(turn.resident.bodyId,f.role.bodyId);
  assert.deepEqual(await invoke('reply',headers,{id:turn.id,answer:{steps:[]}}),{accepted:true});
  assert.equal((await offered).state,'answered');

  assert.deepEqual(devices.revoke(f.stranger.id,row.id),{revoked:false});
  assert.deepEqual(devices.revoke(f.owner.id,row.id),{revoked:true});
  assert.throws(()=>devices.access(login.request),{status:401});
  assert.throws(()=>devices.refresh({refreshToken:next.refreshToken,rotationId:randomUUID()},login.request),{status:401});
  await assert.rejects(invoke('poll',headers,{}),{status:401});
  const reauth = flow(devices);
  const rebooted = {...f,devices,residents};
  approve(rebooted,reauth);
  assert.equal(exchange(rebooted,reauth).character,f.role.characterId);
  assert.equal((await devices.status(devices.access(reauth.request))).character.bodyId,f.role.bodyId);
});

test('the HTTPS portal requires its own signed-in browser and CSRF for consent and revocation', async t => {
  const role = {id:'resident-qa',name:'已有居民',bodyKind:'maid',bodyId:randomUUID(),characterId:randomUUID(),
    ownerGameId:randomUUID(),workerHash:digest('rwt_' + random())};
  const f = await siteFixture(t,{publicOrigin:origin,trustedProxies:['127.0.0.1'],residentTurns:[role]});
  const owner = (await f.admin.init()).data.owner;
  f.portal.store.db.prepare('INSERT INTO ownerships(owner_id,agent_uuid,proof,created_at) VALUES(?,?,?,?)')
    .run(owner.id,role.ownerGameId,'fixture',Date.now());
  const front = {'Host':new URL(origin).host,'X-Forwarded-Proto':'https'};
  function send(path, {headers = {}, body, local = false} = {}) {
    return new Promise((resolve,reject) => {
      const req = httpRequest(f.origin + path,{method:body === undefined ? 'GET' : 'POST',
        headers:{...(local ? {} : front),...(body === undefined ? {} : {'Content-Type':'application/json'}),...headers}},res => {
        const chunks = [];
        res.on('data',chunk=>chunks.push(chunk));
        res.on('end',()=>resolve({status:res.statusCode,cookie:res.headers['set-cookie']?.[0]?.split(';')[0],
          body:JSON.parse(Buffer.concat(chunks).toString('utf8'))}));
      });
      req.on('error',reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  const endpoint = '/api/v1/desktop-devices';
  const device = {'X-QD-Device':randomUUID(),'X-QD-Device-Proof':random()};
  const verifier = random(),state = random();
  const begin = {state,challenge:createHash('sha256').update(verifier).digest('base64url'),redirectUri,name:'QA device'};
  assert.equal((await send(endpoint + '/begin',{headers:device,body:begin,local:true})).status,403);
  assert.equal((await send(endpoint + '/begin',{headers:{...device,Origin:origin},body:begin})).status,403);
  const {body:login,status} = await send(endpoint + '/begin',{headers:device,body:begin});
  assert.equal(status,200);
  assert.equal((await send(endpoint + '/flows/' + login.id)).status,401);
  const guest = await send('/api/v1/session');
  const signed = await send('/api/v1/sessions',{headers:{Origin:origin,Cookie:guest.cookie,'X-CSRF-Token':guest.body.csrfToken},
    body:{username:owner.username,password:testPassword}});
  assert.equal(signed.status,200);
  const session = await send('/api/v1/session',{headers:{Cookie:signed.cookie}});
  const browser = {Cookie:signed.cookie,Origin:origin,'X-CSRF-Token':session.body.csrfToken};
  const preview = await send(endpoint + '/flows/' + login.id,{headers:{Cookie:signed.cookie}});
  assert.deepEqual(preview.body.characters.map(r=>r.characterId),[role.characterId]);
  const selection = {id:login.id,role:role.id,characterId:role.characterId};
  assert.equal((await send(endpoint + '/approve',{headers:{...browser,'X-CSRF-Token':'wrong'},body:selection})).status,403);
  assert.equal((await send(endpoint + '/approve',{headers:{...browser,Origin:'https://other.example'},body:selection})).status,403);
  const consent = await send(endpoint + '/approve',{headers:browser,body:selection});
  assert.equal(consent.status,200);
  const code = new URL(consent.body.redirect).searchParams.get('code');
  const exchanged = await send(endpoint + '/exchange',{headers:device,body:{id:login.id,state,verifier,redirectUri,code}});
  assert.equal(exchanged.body.character,role.characterId);
  const controlled = {...device,Authorization:bearer(exchanged.body.accessToken)};
  assert.equal((await send(endpoint + '/status',{headers:controlled,body:{}})).body.character.bodyId,role.bodyId);
  const devices = await send(endpoint,{headers:{Cookie:signed.cookie}});
  const revoked = await send(endpoint + '/revoke',{headers:browser,body:{id:devices.body.devices[0].id}});
  assert.equal(revoked.body.revoked,true);
  assert.equal((await send(endpoint + '/status',{headers:controlled,body:{}})).status,401);
});
