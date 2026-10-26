import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {siteFixture,testPassword} from './helpers.mjs';
import {runAgentAccess} from '../public/agent-register.mjs';
import {offlineUuid} from '../src/game-accounts.mjs';
import {agentSkill,skillAt} from '../src/agent-skill.mjs';
import {packageAt} from '../src/download-catalog.mjs';

async function joining(t,name='ag_Quick'){
 const f=await siteFixture(t),invited=await f.admin.request('/agent-invites','POST',{username:name});
 assert.equal(invited.status,201);
 const file=path.join(f.root,'private/identity.json'),link=path.join(f.root,'join-link.txt'),outputs=[];
 await fs.writeFile(link,invited.data.onboarding.link,{mode:0o600});
 const args=['join','--username',name,'--invite-url-file',link,'--identity-file',file];
 return{...f,file,link,name,args,outputs,run:timing=>runAgentAccess(args,line=>outputs.push(JSON.parse(line)),timing)};
}
function bridge(f,{ready=true,state='succeeded'}={}){
 const calls={writes:0,reads:0};
 f.portal.accounts.remote={capabilities:async()=>({ready}),writeRequest:async()=>{calls.writes++;},readResult:async id=>{calls.reads++;return{requestId:id,username:f.name,playerUuid:offlineUuid(f.name),state:typeof state==='function'?state(calls.reads):state};}};
 return calls;
}
test('a lightweight owner can issue a default invitation without typing optional fields',async t=>{
 const f=await siteFixture(t),user=f.client();await user.init();
 assert.equal((await user.request('/accounts','POST',{username:'QuickOwner',password:testPassword})).status,201);
 const reply=await user.request('/agent-invites','POST',{});assert.equal(reply.status,201);
 assert.equal(reply.data.label,'我的冒险伙伴');assert.equal(reply.data.username,null);
 assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM account_jobs').get().n,0);
 assert.equal((await f.admin.request('/agent-invites')).data.invites.length,0);
});
test('join completes one account and resumes the same identity without repeating creation or exposing secrets',async t=>{
 const f=await joining(t),calls=bridge(f);assert.equal(await f.run(),0);
 const original=JSON.parse(await fs.readFile(f.file,'utf8'));
 assert.equal(f.outputs.at(-1).state,'ready');assert.equal(f.outputs.at(-1).gameAccountCreated,true);
 assert.equal(await f.run(),0);const after=JSON.parse(await fs.readFile(f.file,'utf8'));
 for(const field of ['clientId','clientSecret','gamePassword','gameRequestId'])assert.equal(after[field],original[field]);
 assert.equal(calls.writes,1);assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM agent_clients').get().n,1);
 const printed=JSON.stringify(f.outputs);for(const secret of [original.clientSecret,original.gamePassword,original.token])assert.ok(!printed.includes(secret));
});
test('join polls only reads while the original game request is pending',async t=>{
 const f=await joining(t,'ag_Pending'),calls=bridge(f,{state:n=>n<4?'waiting':'succeeded'});
 assert.equal(await f.run({pollIntervalMs:2,maxWaitMs:4000}),0);assert.equal(calls.writes,1);assert.ok(calls.reads>=4);
});
test('a lost activation response is queried with the saved identity, never resubmitted',async t=>{
 const f=await joining(t,'ag_Lost'),calls=bridge(f,{state:'waiting'}),original=globalThis.fetch;
 globalThis.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).endsWith('/activate')){await response.arrayBuffer();throw Error('QA lost response');}return response;};
 try{await assert.rejects(f.run(),/RESULT_UNKNOWN/);}finally{globalThis.fetch=original;}
 assert.equal(JSON.parse(await fs.readFile(f.file,'utf8')).joinActivationAttempted,true);
 assert.equal(await f.run({maxWaitMs:0}),2);assert.equal(calls.writes,1);
 bridge(f);assert.equal(await f.run(),0);assert.equal(calls.writes,1);
});
test('an activation that never reaches the server remains unknown and cannot auto-repeat',async t=>{
 const f=await joining(t,'ag_NoPost'),calls=bridge(f),original=globalThis.fetch;
 globalThis.fetch=async(...args)=>{if(String(args[0]).endsWith('/activate'))throw Error('QA interrupted before dispatch');return original(...args);};
 try{await assert.rejects(f.run(),/RESULT_UNKNOWN/);}finally{globalThis.fetch=original;}
 assert.equal(await f.run({maxWaitMs:0}),2);assert.equal(f.outputs.at(-1).state,'unknown');assert.equal(calls.writes,0);
});
test('an offline bridge can resume later without another invitation or API registration',async t=>{
 const f=await joining(t,'ag_Bridge');assert.equal(await f.run(),2);assert.equal(f.outputs.at(-1).state,'awaiting_game_bridge');
 const calls=bridge(f);assert.equal(await f.run(),0);assert.equal(calls.writes,1);
 assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM agent_clients').get().n,1);
});

test('resuming join cannot silently select an old role or another portal, and rejects unknown options',async t=>{
 const f=await joining(t,'ag_Original');bridge(f);assert.equal(await f.run(),0);
 const base=['join','--identity-file',f.file];
 await assert.rejects(runAgentAccess([...base,'--username','ag_Wrong'],()=>{}),/IDENTITY_CONFLICT/);
 await assert.rejects(runAgentAccess([...base,'--portal','https://other.example'],()=>{}),/IDENTITY_CONFLICT/);
 await assert.rejects(runAgentAccess([...base,'--typo','oops'],()=>{}),/INVALID_OPTIONS/);
});
test('stable download entrances resolve reviewed packages and discard arbitrary paths',()=>{
 assert.equal(skillAt('/downloads/agent-skill'),agentSkill);
 for(const[id,alias]of[['cortico-bundle','cortico'],['dsh-bundle','dsh'],['neko-base','neko'],['shared-audio','audio'],['shared-browser','browser']])assert.equal(packageAt('/downloads/'+alias).id,id);
 for(const bad of ['/downloads/../private','/downloads/cortico/else','/downloads/latest-secret'])assert.equal(packageAt(bad),undefined);
});
