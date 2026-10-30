import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {SharedRealmAccess} from './shared-realm-access.mjs';
const token='sra_'+'x'.repeat(43),id='00000000-0000-3000-8000-000000000001';
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE ownerships(owner_id TEXT,agent_uuid TEXT)');db.prepare('INSERT INTO ownerships VALUES(?,?)').run('owner',id);
 const config={sourceMode:'cloud',sharedRealmAccess:{enabled:true,realmId:'sao',tokenHash:createHash('sha256').update(token).digest('hex')}};
 const row={name:'ag_Test',playerUuid:id,kind:'agent'};
 const game={roster:async()=>[row]};const cloud={read:()=>({stale:false})};const req={headers:{authorization:'Bearer '+token}};
 return {db,row,game,cloud,req,service:new SharedRealmAccess(config,{db},game,cloud)};
}
test('only website-owned, exact native identities are exported without secrets',async()=>{
 const f=fixture();f.game.roster=async()=>[f.row,{...f.row,name:'Other',playerUuid:'00000000-0000-3000-8000-000000000002'}];
 const out=await f.service.roles(f.req);assert.deepEqual(out.roles,[{name:'ag_Test',uuid:id}]);assert.ok(out.expiresAt-out.observedAt<=45001);assert.equal(JSON.stringify(out).includes('"owner"'),false);assert.equal(JSON.stringify(out).includes('password'),false);f.db.close();
});
test('unowned, reserved, observer, conflicted and historical rows cannot join by name',async()=>{
 for(const patch of [{isReserved:true},{kind:'observer'},{identityConflict:true},{historical:true}]){const f=fixture();Object.assign(f.row,patch);assert.deepEqual((await f.service.roles(f.req)).roles,[]);f.db.close();}
});
test('service token required and browser context rejected',async()=>{
 for(const headers of [{},{authorization:'Bearer sra_'+'y'.repeat(43)},{authorization:'Bearer '+token,origin:'https://mc.kangqiang.site'},{authorization:'Bearer '+token,cookie:'session=x'}]){
 const f=fixture();await assert.rejects(f.service.roles({headers}),e=>[401,403].includes(e.status));f.db.close();}
});
test('stale source cannot renew ownership leases',async()=>{const f=fixture();f.cloud.read=()=>({stale:true});await assert.rejects(f.service.roles(f.req),e=>e.reason==='PRIMARY_IDENTITIES_STALE');f.db.close();});
test('deleted website ownership takes effect in the next feed',async()=>{const f=fixture();f.db.exec('DELETE FROM ownerships');assert.deepEqual((await f.service.roles(f.req)).roles,[]);f.db.close();});
