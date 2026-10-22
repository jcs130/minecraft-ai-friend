import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {siteFixture} from './helpers.mjs';
import {seal,unseal} from '../src/game-accounts.mjs';
import {syncServerAccountsOnce} from '../scripts/sync-server-accounts.mjs';

async function fixture(t){
 const f=await siteFixture(t),directory=path.join(f.root,'mailbox'),local=randomBytes(32),remote=randomBytes(32);
 await fs.mkdir(path.join(directory,'requests'),{recursive:true});await fs.mkdir(path.join(directory,'results'));
 const localFile=path.join(f.root,'local.key'),remoteFile=path.join(f.root,'remote.key'),tokenFile=path.join(f.root,'token');
 await fs.writeFile(localFile,local.toString('hex'));await fs.writeFile(remoteFile,remote.toString('hex'));await fs.writeFile(tokenFile,'acc_'+randomBytes(32).toString('base64url'));
 const settings={serverId:'fom',endpoint:'https://example.test/api/v1/internal/servers/fom/accounts/poll',bridgeDirectory:directory,localKeyFile:localFile,remoteKeyFile:remoteFile,tokenFile,stateFile:path.join(f.root,'sync.json')};
 const heartbeat=async(at=Date.now(),serverId='fom')=>fs.writeFile(path.join(directory,'heartbeat.json'),seal(local,'server:fom:heartbeat',{ready:true,at,serverId}));await heartbeat();
 return {...f,settings,local,remote,directory,heartbeat};
}
test('world account worker persists original IDs before atomic delivery and never overwrites consumed or existing requests',async t=>{
 const f=await fixture(t),id=randomUUID(),state={watch:[]},request={serverId:'fom',requestId:id,username:'ag_Worker',expiresAt:Date.now()+60000,password:'isolated-no-output-password'};
 const response={serverId:'fom',requests:[{id,envelope:seal(f.remote,'server:fom:request:'+id,request)}],watch:[id],acknowledged:[]};
 const fetcher=async(url,options)=>{const sent=JSON.parse(options.body);assert.equal(sent.heartbeat.serverId,'fom');assert.equal(sent.heartbeat.ready,true);return new Response(JSON.stringify(response));};
 assert.equal((await syncServerAccountsOnce(f.settings,state,fetcher)).delivered,1);
 assert.deepEqual(JSON.parse(await fs.readFile(f.settings.stateFile,'utf8')).watch,[id]);
 const file=path.join(f.directory,'requests',id+'.json'),original=await fs.readFile(file,'utf8');assert.ok(!original.includes(request.password));assert.deepEqual(unseal(f.local,'server:fom:request:'+id,original),request);
 assert.equal((await syncServerAccountsOnce(f.settings,state,fetcher)).delivered,0);assert.equal(await fs.readFile(file,'utf8'),original);
 await fs.unlink(file);await fs.writeFile(path.join(f.directory,'results',id+'.json'),seal(f.local,'server:fom:result:'+id,{serverId:'fom',requestId:id,username:'ag_Worker',state:'succeeded',playerUuid:randomUUID(),codeHash:'local-only'}));
 await syncServerAccountsOnce(f.settings,state,async(url,options)=>{const sent=JSON.parse(options.body),receipt=unseal(f.remote,'server:fom:result:'+id,sent.results[0].envelope);assert.ok(!Object.hasOwn(receipt,'codeHash'));assert.deepEqual(sent.delivered,[id]);return new Response(JSON.stringify({...response,requests:[],watch:[],acknowledged:[id]}));});
 assert.deepEqual(state.watch,[]);await assert.rejects(fs.access(file));
});
test('stale or mismatched world heartbeat disables dispatch; wrong routes, crypto scope and HTTP redirects are rejected',async t=>{
 const f=await fixture(t),state={watch:[]};await f.heartbeat(Date.now()-9000);
 await syncServerAccountsOnce(f.settings,state,async(url,options)=>{assert.equal(JSON.parse(options.body).heartbeat.ready,false);return new Response(JSON.stringify({serverId:'fom',requests:[],watch:[],acknowledged:[]}));});
 await f.heartbeat(Date.now(),'other');await syncServerAccountsOnce(f.settings,state,async(url,options)=>{assert.equal(JSON.parse(options.body).heartbeat.ready,false);return new Response(JSON.stringify({serverId:'fom',requests:[],watch:[],acknowledged:[]}));});
 await assert.rejects(syncServerAccountsOnce({...f.settings,endpoint:'https://example.test/api/v1/internal/servers/other/accounts/poll'},state),/INVALID_SERVER_ACCOUNT_ENDPOINT/);
 await f.heartbeat();const id=randomUUID();await assert.rejects(syncServerAccountsOnce(f.settings,state,async()=>new Response(JSON.stringify({serverId:'other',requests:[],watch:[],acknowledged:[]}))),/RESPONSE_SCOPE/);
 await assert.rejects(syncServerAccountsOnce(f.settings,state,async()=>new Response(JSON.stringify({serverId:'fom',requests:[{id,envelope:seal(f.remote,'server:other:request:'+id,{serverId:'other',requestId:id})}],watch:[id],acknowledged:[]}))));
});
