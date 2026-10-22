// Integration fixture only: fresh loopback NeoForge + exact MixAuth, never a live world.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{root:{type:'string'},mineflayer:{type:'string'},portal:{type:'string'},cold:{type:'boolean'}}});
const root=path.resolve(values.root);assert.equal((await fs.readFile(path.join(root,'.world-accounts-isolated'),'utf8')).trim(),'fresh-loopback-test-only');
const properties=await fs.readFile(path.join(root,'server.properties'),'utf8');assert.match(properties,/server-ip=127\.0\.0\.1/);assert.match(properties,/server-port=39986/);
const {seal,unseal,offlineUuid}=await import(values.portal);
const mineflayer=createRequire(path.resolve(values.mineflayer))('mineflayer');
const key=Buffer.from((await fs.readFile(path.join(root,'mailbox.key'),'utf8')).trim(),'hex'),mailbox=path.join(root,'mailbox');
const username='ag_NetVerify',oldPassword='isolated-native-original',newPassword='isolated-native-replacement';
let checks=0;const bots=[];const check=(value,label)=>{assert.ok(value,label);checks++;};
async function until(predicate,label,ms=18000){const end=Date.now()+ms;while(Date.now()<end){const value=await predicate();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw Error('FIXTURE_TIMEOUT_'+label);}
async function request(operation,extra={}){
 const id=extra.requestId||randomUUID(),value={schemaVersion:1,serverId:'fom',requestId:id,username,playerUuid:offlineUuid(username),operation,password:newPassword,currentPassword:oldPassword,sharedCredential:true,createdAt:Date.now(),expiresAt:Date.now()+120000,...extra};
 await fs.writeFile(path.join(mailbox,'requests',id+'.json'),seal(key,'server:fom:request:'+id,value),{flag:'wx',mode:0o600});
 return until(async()=>{try{const r=unseal(key,'server:fom:result:'+id,await fs.readFile(path.join(mailbox,'results',id+'.json'),'utf8'));return ['succeeded','failed','unknown'].includes(r.state)?r:null;}catch(e){if(e.code!=='ENOENT')throw e;return null;}},operation);
}
async function login(password){
 const bot=mineflayer.createBot({host:'127.0.0.1',port:39986,username,auth:'offline',version:'1.21.1',hideErrors:true,checkTimeoutInterval:60000});bots.push(bot);const messages=[];let disconnected=false;
 bot.on('messagestr',message=>messages.push(message));bot.on('error',()=>{});bot.on('end',()=>{disconnected=true;});
 await until(()=>!disconnected&&bot._client.state==='play'&&messages.some(m=>m.includes('MC_AUTH_LOGIN')),'native_login_prompt',35000);
 bot.chat('/login '+password);
 await until(()=>!disconnected&&messages.some(m=>m.includes('MC_AUTH_SUCCESS')),'native_auth_success',25000);
 return {bot,messages};
}
try{
 await until(async()=>{try{const h=unseal(key,'server:fom:heartbeat',await fs.readFile(path.join(mailbox,'heartbeat.json'),'utf8'));return h.ready&&h.serverId==='fom'&&Date.now()-h.at<5000;}catch{return false;}},'native_mailbox');
 if(!values.cold){
  let result=await request('create',{password:oldPassword});check(result.state==='succeeded'&&result.playerUuid===offlineUuid(username),'native insert-only create confirms exact offline identity');
  check((await request('create',{password:oldPassword})).reason==='ACCOUNT_EXISTS','existing native user cannot be overwritten');
  check((await request('verify',{password:undefined})).state==='succeeded','readonly native password check succeeds without new password');
  check((await request('verify',{currentPassword:'incorrect-isolated-password',password:undefined})).reason==='PASSWORD_INCORRECT','wrong password rejected');
  const {bot,messages}=await login(oldPassword);check(bot._client.state==='play','standard Mineflayer reaches play and native auth success');
  bot.chat('/auth changepassword '+oldPassword+' ignored-isolated-password');await until(()=>messages.some(m=>m.includes('统一密码')),'native_shared_password_guard');check(true,'managed role cannot diverge via native self password command');
  bot.chat('/fom status');await until(()=>messages.some(m=>m.includes('MC_FOM_AUTH')&&m.includes('"authenticated":true')),'native_fom_status');check(true,'native status confirms actual authorization');
  await fs.writeFile(path.join(root,'need-give.fixture'),'give '+username+' minecraft:iron_ingot 3');console.log('FIXTURE_NEEDS_THREE_INGOTS');
  await until(()=>bot.inventory.items().some(i=>i.name==='iron_ingot'&&i.count===3),'console_test_items',120000);check(true,'fixture inventory has three iron ingots');
  bot.quit();await until(()=>bot._client.state==='disconnected'||!bot._client.socket||bot._client.socket.destroyed,'quit');
  check((await request('password')).state==='succeeded','native authority confirms password rotation');
  check((await request('verify',{currentPassword:oldPassword,password:undefined})).reason==='PASSWORD_INCORRECT','old password no longer verifies');
  check((await request('verify',{currentPassword:newPassword,password:undefined})).state==='succeeded','new password verifies through native authority');
 }
 const {bot,messages}=await login(newPassword);check(bot.inventory.items().some(i=>i.name==='iron_ingot'&&i.count===3),'same UUID inventory survives password rotation and reconnect');
 check(bot.player.uuid===offlineUuid(username),'native client actual UUID preserved');
 if(values.cold){
  check((await request('create',{username:'ag_OpFixture',playerUuid:offlineUuid('ag_OpFixture')})).reason==='RESERVED_ACCOUNT','native OP identity cannot be claimed through website account creation');
  const claimId=randomUUID(),code='c'.repeat(48),claim=request('claim',{requestId:claimId,code,password:undefined,currentPassword:undefined});
  await until(async()=>{try{return unseal(key,'server:fom:result:'+claimId,await fs.readFile(path.join(mailbox,'results',claimId+'.json'),'utf8')).state==='waiting';}catch{return false;}},'native_claim_waiting');
  bot.chat('/portal bind '+claimId+' '+code);check((await claim).state==='succeeded','native authenticated body confirms exact claim');
  await until(()=>messages.some(m=>m.includes('网站绑定已确认')),'native_claim_private_receipt');check(true,'native claim returns a private Chinese receipt');
 }
 if(values.cold){bot.chat('/auth changepassword '+newPassword+' ignored-isolated-password');await until(()=>messages.some(m=>m.includes('统一密码')),'cold_managed_guard');check(true,'managed marker survives native cold start');}
 console.log('PASS '+checks+' real NeoForge/MixAuth '+(values.cold?'cold-start':'registration/login/password')+' checks');
}finally{for(const bot of bots)try{bot.quit();}catch{}}
