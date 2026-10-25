import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {spawn} from 'node:child_process';
import {execFileSync} from 'node:child_process';
import {agentSkill} from '../src/agent-skill.mjs';
import {projectRoot} from '../src/config.mjs';
import {offlineUuid} from '../src/game-accounts.mjs';
import {siteFixture} from './helpers.mjs';

function credentialStoreAvailable(t){
 if(process.platform!=='win32')return true;
 try{execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Add-Type -AssemblyName System.Security; [void][Security.Cryptography.ProtectedData]::Protect([byte[]](1,2,3),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)'],{windowsHide:true,timeout:10000,stdio:'ignore'});return true;}
 catch{t.skip('Windows execution account cannot use CurrentUser DPAPI; run the packaged CLI checks on Linux or a normal Windows user session.');return false;}
}

// Exercise the shipped CLI, not source-only imports. This tiny reader accepts
// only the reviewed ZIP after verifying its digest; no downloaded ZIP is used.
async function unpack(t){
 const root=await fs.mkdtemp(path.join(tmpdir(),'qd-skill-join-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const bytes=await fs.readFile(path.join(projectRoot,'public/downloads',agentSkill.filename));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),agentSkill.sha256);
 const end=bytes.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));assert.ok(end>=0);
 let at=bytes.readUInt32LE(end+16);const count=bytes.readUInt16LE(end+10);
 for(let i=0;i<count;i++){
  assert.equal(bytes.readUInt32LE(at),0x02014b50);
  const method=bytes.readUInt16LE(at+10),size=bytes.readUInt32LE(at+20),plain=bytes.readUInt32LE(at+24);
  const n=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),offset=bytes.readUInt32LE(at+42);
  const name=bytes.subarray(at+46,at+46+n).toString('utf8');
  assert.ok(name.startsWith('qiandengji-agent/')&&!name.includes('\\')&&!name.split('/').includes('..'));
  const start=offset+30+bytes.readUInt16LE(offset+26)+bytes.readUInt16LE(offset+28),data=bytes.subarray(start,start+size);
  assert.ok(method===0||method===8);const content=method===8?inflateRawSync(data):data;assert.equal(content.length,plain);
  const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);
  at+=46+n+extra+comment;
 }
 return path.join(root,'qiandengji-agent');
}
async function cli(root,args){
 const child=spawn(process.execPath,['scripts/setup.mjs',...args],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
 const timer=setTimeout(()=>child.kill(),25000);
 try{return await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve({code,out,err}));});}
 finally{clearTimeout(timer);}
}
async function fixture(t,name){
 const f=await siteFixture(t),root=await unpack(t),reply=await f.admin.request('/agent-invites','POST',{username:name});
 assert.equal(reply.status,201);const link=path.join(f.root,'link.txt'),identity=path.join(f.root,'identity.json'),profile=path.join(f.root,'body');
 await fs.writeFile(link,reply.data.onboarding.link,{mode:0o600});
 const args=['join','--username',name,'--invite-url-file',link,'--identity-file',identity,'--profile',profile,'--skip-install'];
 let writes=0;
 const ready=()=>{f.portal.accounts.remote={capabilities:async()=>({ready:true}),writeRequest:async()=>{writes++;},readResult:async requestId=>({requestId,username:name,playerUuid:offlineUuid(name),state:'succeeded'})};};
 return{...f,root,identity,profile,args,ready,writes:()=>writes};
}

test('the distributed one-command CLI creates the MCP profile and resumes without replacing a body or exposing passwords',async t=>{
 if(!credentialStoreAvailable(t))return;
 const f=await fixture(t,'ag_ZipJoin');f.ready();
 const first=await cli(f.root,f.args);assert.equal(first.code,0,first.err);
 const result=JSON.parse(first.out);assert.equal(result.state,'ready');assert.equal(result.gameConnected,false);assert.equal(result.modelCalled,false);
 const identity=JSON.parse(await fs.readFile(f.identity,'utf8')),config=JSON.parse(await fs.readFile(path.join(f.profile,'client.json'),'utf8'));
 assert.equal(config.world.username,'ag_ZipJoin');assert.equal(config.world.port,25702);
 await fs.writeFile(path.join(config.dataDir,'keep-body.txt'),'preserved');
 const again=await cli(f.root,f.args);assert.equal(again.code,0,again.err);assert.equal(JSON.parse(again.out).reused,true);
 assert.equal(await fs.readFile(path.join(config.dataDir,'keep-body.txt'),'utf8'),'preserved');assert.equal(f.writes(),1);
 const printed=first.out+first.err+again.out+again.err;
 for(const secret of [identity.clientSecret,identity.gamePassword,identity.token])assert.ok(!printed.includes(secret));
 assert.equal((await fs.readdir(path.dirname(f.identity))).filter(name=>name.endsWith('.secret')).length,0);
});

test('the distributed CLI reports a temporarily unavailable bridge with nonzero status and resumes the same registration',async t=>{
 if(!credentialStoreAvailable(t))return;
 const f=await fixture(t,'ag_ZipWait'),pending=await cli(f.root,f.args);
 assert.equal(pending.code,2,pending.err);assert.equal(JSON.parse(pending.out).state,'awaiting_game_bridge');
 await assert.rejects(fs.access(f.profile));const original=JSON.parse(await fs.readFile(f.identity,'utf8'));
 f.ready();const done=await cli(f.root,f.args);assert.equal(done.code,0,done.err);assert.equal(f.writes(),1);
 assert.equal(JSON.parse(await fs.readFile(f.identity,'utf8')).clientId,original.clientId);
 assert.equal(f.portal.store.db.prepare('SELECT count(*) AS n FROM agent_clients').get().n,1);
});
