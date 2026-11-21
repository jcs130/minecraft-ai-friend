import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import { test } from 'node:test';
import { BodyHandoffCoordinator, BodyHandoffStore } from '../../numen-hosting/src/body-handoff.mjs';
import { createDeviceHandoffBroker } from '../../numen-hosting/src/device-handoff.mjs';
import { hostingServer } from '../../numen-hosting/src/http.mjs';
import { hostedPortalClient } from '../../numen-hosting/src/portal-client.mjs';
import { siteFixture, testPassword } from './helpers.mjs';

const publicOrigin = 'https://world.example.test';
const proxyHeaders = { Host:'world.example.test', 'X-Forwarded-Proto':'https' };
function call(origin, url, { method = 'POST', body, headers = {}, throughProxy = true } = {}) {
  return new Promise((resolve,reject) => {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request(origin + '/api/v1' + url,{
      method,headers:{ ...(throughProxy ? proxyHeaders : {}),...headers,
        ...(encoded ? {'Content-Type':'application/json','Content-Length':Buffer.byteLength(encoded)} : {}) },
    }, response => {
      let text='';
      response.on('data', chunk => {text+=chunk;});
      response.on('end', () => {
        try {resolve({status:response.statusCode,data:JSON.parse(text),headers:response.headers});}
        catch(error){reject(error);}
      });
    });
    request.on('error',reject);
    request.end(encoded);
  });
}

async function signedBrowser(origin) {
  let cookie='',csrf='';
  async function browser(url, options={}) {
    const reply=await call(origin,url,{ ...options,headers:{
      Cookie:cookie, Origin:publicOrigin, 'X-CSRF-Token':csrf, ...options.headers,
    }});
    cookie=reply.headers['set-cookie']?.[0]?.split(';')[0]??cookie;
    csrf=reply.data.csrfToken??csrf;
    return reply;
  }
  assert.equal((await browser('/session',{method:'GET'})).status,200);
  assert.equal((await browser('/sessions',{body:{username:'fixture-admin',password:testPassword}})).status,200);
  return browser;
}

test('explicit HTTPS browser pairing, one-shot desktop redemption and original scope across the real loopback gateway', async t => {
  const handoffStore = new BodyHandoffStore(':memory:');
  const coordinator = new BodyHandoffCoordinator({store:handoffStore,adapters:{}});
  const broker = createDeviceHandoffBroker();
  broker.attach(coordinator);
  const serviceKey = randomBytes(32);
  const host = hostingServer({hosting:{},bodyHandoff:coordinator,deviceBroker:broker,grantKey:randomBytes(32),serviceKey});
  const {port} = await host.listen();
  t.after(async () => {
    const closed = new Promise(resolve=>host.server.close(resolve));
    host.server.closeAllConnections();
    await closed;
    handoffStore.close();
  });
  const endpoint='http://127.0.0.1:'+port+'/v1/hosting';
  assert.equal(hostedPortalClient({endpoint, serviceKey,characterBodies:true}).characterDevices,null);
  const hostedAgents=hostedPortalClient({endpoint,serviceKey,characterBodies:true,characterDevices:true});
  const {origin,uuid,game,portal,agent}=await siteFixture(t,{publicOrigin},{hostedAgents});
  const canPair={kind:'mineflayer',bodyId:uuid,playerUuid:uuid};
  handoffStore.register({characterId:uuid,ownerId:uuid,active:canPair,targets:[{...canPair,kind:'numen'}],autonomous:true});
  const wrongKind=randomUUID(), wrongOwner = randomUUID();
  const resident={kind:'maid',bodyId:'fixture-maid',entityUuid:randomUUID()};
  handoffStore.register({characterId:wrongKind,ownerId:wrongKind,active:resident,
    targets:[{kind:'villager',bodyId:'fixture-villager',entityUuid:randomUUID()}]});
  const wrongOwnerBody={kind:'mineflayer',bodyId:wrongOwner,playerUuid:wrongOwner};
  handoffStore.register({characterId:wrongOwner,ownerId:wrongOwner,active:wrongOwnerBody,targets:[{...wrongOwnerBody,kind:'numen'}]});
  game.roster=async()=>[agent,{...agent,id:'b'.repeat(24),playerUuid:wrongKind}, {...agent,id:'c'.repeat(24),playerUuid:wrongOwner}];
  const owner=portal.store.ownerByName('fixture-admin');
  const own=portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)');
  for (const assigned of [uuid,wrongKind]) own.run(owner.id,assigned,'fixture',Date.now());
  const browser=await signedBrowser(origin);
  const {characters}= (await browser('/character-bodies',{method:'GET'})).data;
  assert.equal(characters.find(row=>row.characterId===uuid).devicePairing,true);
  assert.equal(characters.find(row=>row.characterId===wrongKind).devicePairing,undefined);
  const pairing='/character-device/pair', devices='/character-device', role='/character-bodies/'+uuid+'/device';
  const device=(url,body,token,extra={})=>call(origin,url,{body,headers:{...(token?{Authorization:'Bearer '+token}:{}),...extra}});
  const start=await device(pairing,{op:'start'});
  assert.equal(start.status,201);
  const {pairId,pollSecret}=start.data;
  const approve={action:'approve',kind:'mineflayer',pairId}, redeem={op:'redeem',pairId};
  assert.equal(start.headers['cache-control'],'no-store');
  assert.equal((await call(origin,pairing,{body:{op:'start'},throughProxy:false})).status,403);
  assert.equal((await device(pairing,redeem,pollSecret,{Origin:publicOrigin})).status,403);
  assert.equal((await device(pairing,redeem,'qdp_'+'a'.repeat(43))).status,404);
  assert.deepEqual((await device(pairing,redeem,pollSecret)).data,{state:'pending'});
  assert.equal((await browser(role,{body:approve,headers:{Origin:'https://another.example'}})).status,403);
  assert.equal((await browser(role,{body:approve,headers:{'X-CSRF-Token':'wrong'}})).status,403);
  assert.equal((await browser('/character-bodies/'+wrongOwner+'/device',{body:approve})).status,404);
  assert.equal((await browser('/character-bodies/'+wrongKind+'/device',{body:approve})).status,404);
  assert.equal((await browser(role,{body:{...approve,kind:'numen'}})).status,404);
  const approved=await browser(role,{body:approve});
  assert.equal(approved.status,200);
  assert.deepEqual(Object.keys(approved.data).sort(),['approved','characterId','expiresAt']);
  assert.ok(!JSON.stringify(approved.data).includes(pollSecret));
  assert.equal((await browser(role,{body:approve})).status,404);
  const grant=(await device(pairing,redeem,pollSecret)).data;
  assert.match(grant.token,/^qdh_/);
  assert.equal(grant.endpoint,publicOrigin+'/api/v1/character-device');
  assert.equal(grant.characterId,uuid);
  assert.equal((await device(pairing,redeem,pollSecret)).status,404);
  const hello={op:'hello',characterId:uuid,instanceId:randomUUID()};
  assert.equal((await device(devices,hello,grant.token,{Origin:publicOrigin})).status,403);
  assert.equal((await device(devices,hello,pollSecret)).status,401);
  assert.equal((await device(devices,hello,'rot_'+'a'.repeat(43))).status,401);
  assert.equal((await device(devices,hello,'rdt_'+'a'.repeat(43))).status,401);
  assert.equal((await device(devices,{...hello,characterId:wrongOwner},grant.token)).status,403);
  const separatelyEnrolled=broker.enrollOwned(wrongOwner,{ownerId:wrongOwner});
  assert.equal((await device(devices,{...hello,characterId:wrongOwner},separatelyEnrolled.token)).status,401);
  const live=await device(devices,hello,grant.token);
  assert.deepEqual(live.data,{value:{characterId:uuid,playerUuid:uuid,generation:1}});
  assert.equal((await device(devices,{...hello,instanceId:randomUUID()},grant.token)).status,409);
  const revoke=await browser(role,{body:{action:'revoke',kind:'mineflayer'}});
  assert.deepEqual(revoke.data,{revoked:true,characterId:uuid});
  assert.equal((await device(devices,hello,grant.token)).status,401);
  assert.equal((await hostedAgents.characterDevices.relay('Bearer '+grant.token,hello)).status,401);
  const fresh=(await device(pairing,{op:'start'})).data;
  assert.equal((await browser(role,{body:{...approve,pairId:fresh.pairId}})).status,200);
  const renewed=(await device(pairing,{op:'redeem',pairId:fresh.pairId},fresh.pollSecret)).data;
  assert.equal((await device(devices,hello,renewed.token)).status,200);
  portal.store.db.prepare('DELETE FROM ownerships WHERE agent_uuid=?').run(uuid);
  assert.equal((await device(devices,hello,renewed.token)).status,401);
});
