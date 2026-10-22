import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { NumenOwnerships, validateNumenObservation } from '../src/numen-ownership.mjs';
import { registryIdentities, intArrayTags, readNumenIdentities } from '../scripts/numen-identities.mjs';
import { GameData } from '../src/game-data.mjs';
import { loadConfig } from '../src/config.mjs';
import { siteFixture } from './helpers.mjs';
import { digest } from '../src/store.mjs';
import { seal, GameAccounts } from '../src/game-accounts.mjs';
const creator='11111111-1111-3111-8111-111111111111',body='22222222-2222-3222-8222-222222222222';
const entry=(extra={})=>({playerUuid:body,ownerPlayerUuid:creator,name:'TianYi',source:'Numen.live-owner-tag',...extra});
const observation=(rows=[entry()],time=Date.now())=>validateNumenObservation({schemaVersion:1,observedAt:time,companions:rows},time);
async function local(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'qd-numen-'));const store=new Store(root);new GameAccounts({},store,{});t.after(async()=>{store.close();await fs.rm(root,{recursive:true});});const service=new NumenOwnerships(store);const owner=randomUUID();store.db.prepare('INSERT INTO owners VALUES(?,?,?,?,?,?)').run(owner,'fish-owner','fish-owner','test-only-digest','owner',Date.now());return {root,store,service,owner};}
const bind=(store,owner,uuid)=>store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(owner,uuid,'Verified original game identity fixture',Date.now());

test('native creator relation binds a non-ag companion to the verified creator account, once',async t=>{
 const f=await local(t);bind(f.store,f.owner,creator);const value=observation();f.service.ingest(value);f.service.ingest(value);
 assert.deepEqual(f.store.ownedUuids(f.owner).sort(),[creator,body].sort());assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM audit_events WHERE action=?').get('ownership.numen.creator.bind').n,1);
 assert.equal(f.store.db.prepare('SELECT state FROM numen_creator_relations').get().state,'bound');
});
test('an unregistered creator stays pending until the creator proves and binds the original game UUID',async t=>{
 const f=await local(t);f.service.ingest(observation());assert.equal(f.store.ownedUuids(f.owner).length,0);assert.equal(f.store.db.prepare('SELECT state FROM numen_creator_relations').get().state,'pending_creator');
 bind(f.store,f.owner,creator);f.service.reconcile();assert.ok(f.store.ownedUuids(f.owner).includes(body));
});
test('creator name similarity never grants ownership and an existing explicit owner is preserved',async t=>{
 const f=await local(t);const other=randomUUID();f.store.db.prepare('INSERT INTO owners VALUES(?,?,?,?,?,?)').run(other,'other','other','test-only-digest','owner',Date.now());bind(f.store,f.owner,creator);bind(f.store,other,body);
 f.service.ingest(observation());assert.deepEqual(f.store.ownedUuids(other),[body]);assert.equal(f.store.db.prepare('SELECT state FROM numen_creator_relations').get().state,'ownership_conflict');
});
test('changed native creator UUID, reused name, stale snapshot and conflicting replay cannot steal a body',async t=>{
 const f=await local(t);bind(f.store,f.owner,creator);const value=observation();f.service.ingest(value);
 assert.throws(()=>f.service.ingest({...value,observedAt:value.observedAt-1}));assert.throws(()=>f.service.ingest({...value,companions:[entry({name:'Different'})]}));
 f.service.ingest(observation([entry({ownerPlayerUuid:randomUUID()})],value.observedAt+1));assert.equal(f.store.db.prepare('SELECT state FROM numen_creator_relations').get().state,'identity_conflict');assert.ok(f.store.ownedUuids(f.owner).includes(body));
});
test('untrusted source, manager/Eye name, invalid UUID, duplicate body and self ownership are rejected',()=>{
 for(const row of [entry({source:'chat'}),entry({name:'Goddess'}),entry({name:'TianYi_eye'}),entry({ownerPlayerUuid:'fake'}),entry({ownerPlayerUuid:body})])assert.throws(()=>observation([row]));
 assert.throws(()=>observation([entry(),entry()]));assert.throws(()=>validateNumenObservation({schemaVersion:1,observedAt:1,companions:[]}));
});
test('the native persisted registry exports only bounded identity fields, omitting removed bodies and private task/skin data',()=>{
 const rows=registryIdentities({data:{companions:{[body]:{name:'TianYi',owner:creator,taskLua:'private-task',skinValue:'private-skin'},[randomUUID()]:{name:'OldBody',owner:creator,removedFor:'retired'}}}});
 assert.deepEqual(rows,[entry({source:'Numen.CompanionRegistry'})]);assert.ok(!JSON.stringify(rows).includes('private-'));
});
test('live owner NBT is read by actual entity UUID despite titles; no commands are executed or forwarded',async t=>{
 const f=await local(t);const calls=[];const ownerTag='[I; 286331153, 286339345, -2129587951, 286331153]';const bodyTag='[I; 572662306, 572666402, -2111692254, 572662306]';
 const expectedOwner=intArrayTags(ownerTag)[0],expectedBody=intArrayTags(bodyTag)[0];
 assert.equal(expectedOwner,creator);assert.equal(expectedBody,body);
 const result=await readNumenIdentities({serverDir:f.root},async q=>{calls.push(q);if(q==='minecraft:list uuids')return `There are 1 of a max of 40 players online: TianYi (${expectedBody})`;if(q.includes('run minecraft:data get entity @s UUID'))return '◆黑铁 [Agent] 天依 has the following entity data: '+bodyTag;if(q==='minecraft:data get entity TianYi NumenOwner')return '天依 has the following entity data: '+ownerTag;throw Error('Unexpected mutating command');});
 assert.deepEqual(result.companions,[entry({playerUuid:expectedBody,ownerPlayerUuid:expectedOwner})]);assert.equal(calls.length,3);
});
test('local roster automatically labels a proven non-ag Numen body while the real player and Eye keep their types',async t=>{
 const f=await local(t);await fs.mkdir(path.join(f.root,'game'),{recursive:true});await fs.writeFile(path.join(f.root,'game/usercache.json'),JSON.stringify([{name:'TianYi',uuid:body},{name:'LittleFish0510',uuid:creator}]));await fs.writeFile(path.join(f.root,'identities.json'),JSON.stringify({identities:[{name:'TianYi',uuid:body,kind:'agent',source:'Numen.live-owner-tag'}]}));
 const config=loadConfig({skipLocalConfig:true,serverDir:path.join(f.root,'game'),portalIdentitiesFile:path.join(f.root,'identities.json'),publicRoster:['TianYi','LittleFish0510','TianYi_eye'],agentRegistry:path.join(f.root,'empty-registry'),authHeartbeat:path.join(f.root,'empty-heartbeat')});
 const game=new GameData(config,'test-salt',async()=>({online:true,sample:[],observedAt:new Date().toISOString()}));const rows=await game.roster();assert.equal(rows.find(row=>row.name==='TianYi').kind,'agent');assert.equal(rows.find(row=>row.name==='LittleFish0510').kind,'player');assert.equal(rows.find(row=>row.name==='TianYi_eye').kind,'observer');
 assert.ok(!JSON.stringify(rows.map(row=>game.publicAgent(row))).includes(creator));
});
test('only an authenticated, encrypted account bridge observation can grant native creator ownership',async t=>{
 const token='acc_'+randomBytes(32).toString('base64url'),key=randomBytes(32);const f=await siteFixture(t,{sourceMode:'cloud',cloudAccounts:{enabled:true,tokenHash:digest(token),keyFile:''}});const file=path.join(f.root,'numen-cloud.key');await fs.writeFile(file,key.toString('hex'));f.config.cloudAccounts.keyFile=file;
 const owner=f.portal.store.ownerByName('fixture-admin');bind(f.portal.store,owner.id,creator);
 const payload={heartbeat:{ready:true,at:Date.now()},results:[],numen:seal(key,'numen-identities',{schemaVersion:1,observedAt:Date.now(),companions:[entry()]})};
 const send=(body,bearer)=>fetch(f.origin+'/api/v1/internal/accounts/poll',{method:'POST',headers:{'Content-Type':'application/json',...(bearer?{Authorization:'Bearer '+bearer}:{})},body:JSON.stringify(body)});
 assert.equal((await send(payload)).status,401);
 const forged=await send({...payload,numen:'forged'},token);assert.equal(forged.status,200);assert.equal((await forged.json()).numenAccepted,false);assert.ok(!f.portal.store.ownedUuids(owner.id).includes(body));
 assert.equal(f.portal.store.db.prepare('SELECT ready FROM account_bridge_heartbeat WHERE id=1').get().ready,1,'invalid optional evidence does not disable account bridge');
 const accepted=await send(payload,token);assert.equal(accepted.status,200);assert.equal((await accepted.json()).numenAccepted,true);assert.ok(f.portal.store.ownedUuids(owner.id).includes(body));
 const replay=await send({...payload,numen:seal(key,'numen-identities',{schemaVersion:1,observedAt:Date.now()-40000,companions:[entry({ownerPlayerUuid:randomUUID()})]})},token);
 assert.equal(replay.status,200);assert.equal((await replay.json()).numenAccepted,false);assert.deepEqual(f.portal.store.ownedUuids(owner.id),[creator,body]);
});
