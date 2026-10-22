// Explicit integration gate; not part of ordinary unit tests. Both native
// authorities must be isolated, marker-guarded, loopback-only fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {siteFixture} from './helpers.mjs';
import {syncServerAccountsOnce} from '../scripts/sync-server-accounts.mjs';
import {digest} from '../src/store.mjs';
import {offlineUuid} from '../src/game-accounts.mjs';

test('actual LibreLogin and MixAuth confirm one website role and shared password through outbound HTTPS protocol',async t=>{
 const root=process.env.NETWORK_ACCOUNT_FIXTURE;
 assert.ok(root&&path.isAbsolute(root),'explicit isolated fixture root required');
 for(const world of ['paper-auth','fom'])assert.equal((await fs.readFile(path.join(root,world,'.world-accounts-isolated'),'utf8')).trim(),'fresh-loopback-test-only');
 const token='acc_'+randomBytes(32).toString('base64url');
 const f=await siteFixture(t,{publicGameAddress:'localhost:27061',networkAccounts:{enabled:true,keyFile:''},authBridge:{enabled:true,directory:path.join(root,'paper-auth/bridge'),keyFile:path.join(root,'paper-auth/bridge.key')},
  gameServers:[{id:'fom',name:'Isolated FOM',core:'NeoForge',version:'1.21.1',state:'testing',addresses:{mineflayer:'localhost:39986'},loginAuthority:'MixAuth',minPasswordLength:8,guide:{help:'/fom help',status:'/fom status'},accountBridge:{enabled:true,keyFile:'',tokenHash:digest(token)}}]});
 const vault=path.join(f.root,'vault.key'),remote=path.join(f.root,'remote.key'),tokenFile=path.join(f.root,'worker.token');
 await fs.writeFile(vault,randomBytes(32).toString('hex'));await fs.writeFile(remote,randomBytes(32).toString('hex'));await fs.writeFile(tokenFile,token);
 f.config.networkAccounts.keyFile=vault;f.portal.network.catalog.get('fom').accountBridge.keyFile=remote;
 const settings={serverId:'fom',endpoint:f.origin+'/api/v1/internal/servers/fom/accounts/poll',bridgeDirectory:path.join(root,'fom/mailbox'),localKeyFile:path.join(root,'fom/mailbox.key'),remoteKeyFile:remote,tokenFile,stateFile:path.join(f.root,'worker.json')},worker={watch:[]};
 const roster=f.game.roster;f.game.roster=async()=>[...await roster(),...f.portal.store.db.prepare('SELECT player_uuid,name FROM portal_agents').all().map(r=>({name:r.name,playerUuid:r.player_uuid,available:true,isReserved:false}))];
 const owner=f.portal.store.ownerByName('fixture-admin'),username=process.env.NETWORK_ACCOUNT_TEST_NAME||'ag_WebCross',password='isolated-web-original',next='isolated-web-replacement';
 async function settle(id){const deadline=Date.now()+25000;while(Date.now()<deadline){await syncServerAccountsOnce(settings,worker);const flow=f.portal.network.flow(owner,id);if(flow.state==='succeeded')return flow;if(['failed','unknown'].includes(flow.state))assert.fail(JSON.stringify(flow));await new Promise(r=>setTimeout(r,350));}assert.fail('Native cross-world receipt timeout');}
 await syncServerAccountsOnce(settings,worker);
 const first=await f.admin.request('/servers/qiandengji/join','POST',{requestId:randomUUID(),username,gamePassword:password});assert.equal(first.status,202);await settle(first.data.id);
 const second=await f.admin.request('/servers/fom/join','POST',{requestId:randomUUID(),username,gamePassword:password});assert.equal(second.status,202);await settle(second.data.id);
 const roles=(await f.admin.request('/network/roles')).data.roles.filter(r=>r.username===username);assert.equal(roles.length,2);assert.notEqual(roles[0].roleId,roles[1].roleId);assert.equal(roles[0].playerUuid,roles[1].playerUuid);
 const rotation=await f.admin.request('/servers/fom/password','POST',{requestId:randomUUID(),username,currentGamePassword:password,newGamePassword:next});assert.equal(rotation.status,202);const confirmed=await settle(rotation.data.id);assert.equal(confirmed.steps.length,2);assert.equal(confirmed.synchronized,true);
 const verify=await f.portal.accounts.start(owner,'verify',{requestId:randomUUID(),username,currentGamePassword:next});
 const deadline=Date.now()+10000;let receipt;while(Date.now()<deadline){receipt=await f.portal.accounts.job(owner,verify.id);if(receipt.state==='succeeded')break;await new Promise(r=>setTimeout(r,300));}assert.equal(receipt.state,'succeeded','real LibreLogin new password verified');
 const native=await f.portal.network.enqueue(owner,'fom',randomUUID(),'verify',username,offlineUuid(username),{password:next,newPassword:next});
 let result;for(let i=0;i<30;i++){await syncServerAccountsOnce(settings,worker);result=f.portal.store.db.prepare('SELECT state FROM network_jobs WHERE id=?').get(native.id);if(result.state==='succeeded')break;await new Promise(r=>setTimeout(r,300));}assert.equal(result.state,'succeeded','real MixAuth verifies same new password');
 assert.equal((await f.portal.network.activeSecret(owner,offlineUuid(username))).password,next);
 await assert.rejects(f.portal.accounts.start(owner,'password',{requestId:randomUUID(),username,currentGamePassword:next,gamePassword:'would-diverge-password'}),e=>e.reason==='SHARED_PASSWORD_REQUIRED');
 assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM network_credentials').get().n,1,'one shared credential for two worlds');
 console.log('PASS actual website → durable per-world jobs → native authorities → uniform password receipts; production unchanged');
});
