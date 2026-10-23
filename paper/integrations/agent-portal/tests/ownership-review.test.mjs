import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes,randomUUID } from 'node:crypto';
import { siteFixture,testPassword } from './helpers.mjs';
import { reviewOwnerships } from '../src/ownership-review.mjs';
import { GameData,websiteIdentity } from '../src/game-data.mjs';
import { CloudGame,CloudSource } from '../src/cloud-source.mjs';
import { seal } from '../src/game-accounts.mjs';

const proof='Operator verified original UUID from server records and explicit owner instruction; isolated fixture.';
async function ownerFixture(t){
 const f=await siteFixture(t),user=f.client();await user.init();await user.request('/accounts','POST',{username:'FishOwner',password:testPassword});
 return {...f,user,owner:f.portal.store.ownerByName('FishOwner')};
}
test('ordinary game OP can claim via the original authenticated UUID; reserved names and Eye remain protected',async t=>{
 const f=await ownerFixture(t),root=path.join(f.root,'op-game');await fs.mkdir(root);
 await fs.writeFile(path.join(root,'usercache.json'),JSON.stringify([{name:'LittleFish0510',uuid:f.uuid}]));
 await fs.writeFile(path.join(root,'ops.json'),JSON.stringify([{name:'LittleFish0510',uuid:f.uuid}]));
 const data=new GameData({...f.config,serverDir:root,publicRoster:['LittleFish0510','Goddess','Player','live','ag_Goddess','ag_Fish_eye'],includeKnownPlayers:true},'salt',async()=>({online:true,sample:[]}));
 const roles=await data.roster(),op=roles.find(r=>r.name==='LittleFish0510');
 assert.equal(op.kind,'player');assert.equal(op.isOperator,true);assert.equal(op.isReserved,false);
 for(const name of ['Goddess','Player','live','ag_Goddess','ag_Fish_eye'])assert.equal(roles.find(r=>r.name===name).isReserved,true,name);
 f.game.roster=async()=>roles;
 const key=randomBytes(32),directory=path.join(f.root,'bridge'),keyFile=path.join(f.root,'bridge.key');
 await fs.mkdir(path.join(directory,'results'),{recursive:true});await fs.writeFile(keyFile,key.toString('hex'));
 Object.assign(f.config.authBridge,{enabled:true,directory,keyFile});
 await fs.writeFile(path.join(directory,'heartbeat.json'),seal(key,'heartbeat',{ready:true,at:Date.now()}));
 assert.equal((await f.user.request('/roster')).data.agents.find(r=>r.name==='LittleFish0510').claimable,true);
 const id=randomUUID(),start=await f.user.request('/agent-claims','POST',{username:'LittleFish0510',requestId:id});
 assert.equal(start.status,202);assert.equal(f.portal.store.ownedUuids(f.owner.id).length,0);
 await fs.writeFile(path.join(directory,'results',id+'.json'),seal(key,'result:'+id,{requestId:id,username:'LittleFish0510',state:'succeeded',playerUuid:f.uuid}));
 assert.equal((await f.user.request('/jobs/'+id)).data.state,'succeeded');assert.deepEqual(f.portal.store.ownedUuids(f.owner.id),[f.uuid]);
});
test('old cloud projections distinguish ordinary OP from reserved accounts without changing permissions',()=>{
 const raw={name:'LittleFish0510',kind:'admin',isReserved:true,identityConflict:false};
 assert.deepEqual(websiteIdentity(raw),{...raw,kind:'player',isReserved:false,isOperator:true});assert.equal(raw.isReserved,true);
 for(const name of ['Goddess','corti','CortiCam','Player','live','ag_Player','ag_Fish_eye'])assert.equal(websiteIdentity({...raw,name}).isReserved,true);
 assert.equal(websiteIdentity({...raw,kind:'observer',name:'Camera'}).isReserved,true);
});
test('operator ownership review is exact, idempotent and all-or-nothing; preview grants no ownership',async t=>{
 const f=await ownerFixture(t),roles=[{name:'LittleFish0510',playerUuid:f.uuid,kind:'player'},{name:'TianYi',playerUuid:randomUUID(),kind:'agent'}];
 const review={ownerId:f.owner.id,ownerName:'FishOwner',roles,proof};
 assert.equal(reviewOwnerships(f.portal.store,review).length,2);assert.equal(f.portal.store.ownedUuids(f.owner.id).length,0);
 reviewOwnerships(f.portal.store,review,true);reviewOwnerships(f.portal.store,review,true);
 assert.equal(f.portal.store.ownedUuids(f.owner.id).length,2);assert.equal(f.portal.store.db.prepare("SELECT count(*) AS n FROM audit_events WHERE action='ownership.operator.review'").get().n,2);
 assert.throws(()=>reviewOwnerships(f.portal.store,{...review,ownerName:'other'},true),/OWNER_MISMATCH/);
 const admin=f.portal.store.ownerByName('fixture-admin');assert.throws(()=>reviewOwnerships(f.portal.store,{...review,ownerId:admin.id,ownerName:admin.username},true),/OWNERSHIP_CONFLICT/);
 for(const name of ['Goddess','ag_Goddess','Player','Camera_eye'])assert.throws(()=>reviewOwnerships(f.portal.store,{...review,roles:[{name,playerUuid:randomUUID(),kind:'agent'}]},true),/IDENTITY_INVALID/);
 const archived=randomUUID();f.portal.store.db.prepare('INSERT INTO archived_test_roles VALUES(?,?,?,?,?,?,?)').run(archived,'ArchivedRole',admin.id,proof,1,2,'fixture');
 assert.throws(()=>reviewOwnerships(f.portal.store,{...review,roles:[{name:'NewValid',playerUuid:randomUUID(),kind:'agent'},{name:'ArchivedRole',playerUuid:archived,kind:'agent'}]},true),/ARCHIVED_ROLE/);
 assert.equal(f.portal.store.ownedUuids(f.owner.id).length,2);
});
test('same-name historical UUIDs belong only to the verified owner and never become login aliases or public clutter',async t=>{
 const f=await ownerFixture(t),roles=[{name:'Fishy',playerUuid:randomUUID(),kind:'agent'},{name:'Fishy',playerUuid:randomUUID(),kind:'agent'}];
 reviewOwnerships(f.portal.store,{ownerId:f.owner.id,ownerName:f.owner.username,roles,proof},true);
 const source=new CloudSource(f.config,f.portal.store),cloud=new CloudGame(f.config,f.portal.store,source);
 f.game.roster=()=>cloud.roster();f.game.playerState=row=>cloud.playerState(row);
 const roster=await cloud.roster();assert.equal(roster.length,2);assert.notEqual(roster[0].id,roster[1].id);assert.ok(roster.every(r=>r.historical));
 const own=(await f.user.request('/agents')).data.agents;assert.equal(own.length,2);assert.ok(own.every(r=>r.isOwn));
 assert.equal((await f.user.request('/roster')).data.agents.length,0);
 const other=f.client();await other.init();await other.request('/accounts','POST',{username:'OtherOwner',password:testPassword});
 assert.equal((await other.request('/agents')).data.agents.length,0);
 assert.equal((await other.request('/agents/'+own[0].id+'/state')).status,404);
 const read=await f.user.request('/agents/'+own[0].id+'/state');assert.equal(read.status,200);assert.equal(read.data.freshness,'unavailable');assert.equal(read.data.agent.playerUuid,own[0].playerUuid);
 assert.equal((await f.user.request('/agents/'+own[0].id+'/connection-config')).data.error.reason,'HISTORICAL_ROLE_READ_ONLY');
 assert.equal((await f.user.request('/agents/'+own[0].id+'/appearance')).status,403);
});
test('reviewed pre-existing roles do not spend new self-service registration slots',async t=>{
 const f=await ownerFixture(t),roles=Array.from({length:8},(_,i)=>({name:'OldRole'+i,playerUuid:randomUUID(),kind:i?'agent':'player'}));
 reviewOwnerships(f.portal.store,{ownerId:f.owner.id,ownerName:f.owner.username,roles,proof},true);
 assert.doesNotThrow(()=>f.portal.accounts.assertCreateQuota(f.owner));
 for(let i=0;i<5;i++)f.portal.store.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?)').run(f.owner.id,randomUUID(),'Verified normal self-service game claim fixture',Date.now());
 assert.throws(()=>f.portal.accounts.assertCreateQuota(f.owner),/最多/);
});
