// Real isolated native-provider regression. Never reads production credentials.
'use strict'
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{createRequire}=require('node:module')
const deps=createRequire(process.env.MAW_TEST_MINEFLAYER_PACKAGE),mineflayer=deps('mineflayer'),protocol=deps('minecraft-protocol')
const cfg=JSON.parse(fs.readFileSync(process.env.MAW_TEST_CREDENTIALS,'utf8')),sleep=ms=>new Promise(r=>setTimeout(r,ms)),live=new Set()
async function until(fn,seconds=20){for(let n=0;n<seconds*10;n++){const result=fn();if(result)return result;await sleep(100)}throw Error('RECEIPT_TIMEOUT')}
async function connect(name,plugin=true){
 const bot=mineflayer.createBot({host:'127.0.0.1',port:cfg.port,username:name,auth:'offline',version:'1.20.1'}),c={bot,messages:[],receipts:[]};live.add(c)
 bot.on('error',()=>{});bot.on('messagestr',m=>c.messages.push(m));bot._client.on('custom_payload',p=>{if(p.channel==='mcagent:account')c.receipts.push(JSON.parse(p.data.toString('utf8')))})
 if(plugin)bot.once('spawn',()=>bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:account')}))
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('SPAWN_TIMEOUT')),25000);bot.once('spawn',()=>{clearTimeout(timer);resolve()});bot.once('kicked',()=>{clearTimeout(timer);reject(Error('UNEXPECTED_KICK'))})});await sleep(400);return c
}
async function receipt(c,command){for(let n=0;n<2;n++){const start=c.receipts.length;c.bot.chat(command);const r=await until(()=>c.receipts[start]);assert.equal(r.bodyUuid,c.bot.player.uuid);if(r.reason==='LOGIN_COOLDOWN'&&r.accepted===false&&n===0){await sleep(r.retryAfterMs+100);continue}return r}}
async function close(c){c.bot.quit();live.delete(c);await sleep(500)}
function otp(secret){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const ch of secret)bits+=alphabet.indexOf(ch).toString(2).padStart(5,'0');const key=Buffer.from(bits.match(/.{8}/g).map(x=>parseInt(x,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const hash=crypto.createHmac('sha1',key).update(counter).digest(),at=hash[19]&15;return ((hash.readUInt32BE(at)&0x7fffffff)%1000000).toString().padStart(6,'0')}
async function premiumImpostor(){
 const client=protocol.createClient({host:'127.0.0.1',port:cfg.port,username:cfg.premiumName,auth:'offline',version:'1.20.1'});let spawned=false,challenged=false;client.on('error',()=>{});client.on('login',()=>{spawned=true});client.once('encryption_begin',()=>{challenged=true;client.end()});await until(()=>challenged,15);await sleep(700);assert.equal(spawned,false)
}
async function main(){
 const checks=[],pass=x=>{checks.push(x);console.log(JSON.stringify({check:x}))}
 const observer=await connect(cfg.oldName);assert.equal((await receipt(observer,'/login '+cfg.password)).authenticated,true);observer.messages=[];observer.receipts=[]
 let c=await connect(cfg.newName),r=await receipt(c,'/login wrong-password');assert.equal(r.reason,'PASSWORD_INCORRECT');assert.equal(r.authenticated,false);pass('wrong-password-real-private-plugin-receipt-before-authentication')
 r=await receipt(c,'/login '+cfg.password);assert.equal(r.state,'succeeded');assert.equal(r.authenticated,true);const body=c.bot.player.uuid;assert.equal((await receipt(c,'/sharedaccount status')).bodyUuid,body);assert(!c.messages.some(m=>m.includes('MC_SHARED_ACCOUNT')));pass('ordinary-offline-login-and-status-without-json-chat')
 c.bot.chat('/sharedaccount format json');await until(()=>c.messages.some(m=>m.includes('json')));c.bot.chat('/sharedaccount status');await until(()=>c.messages.some(m=>m.startsWith('MC_SHARED_ACCOUNT ')));pass('legacy-json-is-explicit-connection-opt-in');await close(c)
 c=await connect(cfg.newName,false);await sleep(3100);const start=c.messages.length;c.bot.chat('/login '+cfg.password);await until(()=>c.messages.slice(start).some(m=>m.includes('验证成功')));c.bot.chat('/sharedaccount status');await until(()=>c.messages.some(m=>m.includes('游戏登录：已完成')));assert.equal(c.bot.player.uuid,body);assert.equal(c.receipts.length,0);assert(!c.messages.some(m=>m.includes('MC_SHARED_ACCOUNT')));pass('human-reconnect-resets-format-and-preserves-uuid');await close(c)
 c=await connect('b_SaoAdm13');r=await receipt(c,'/login '+cfg.adminName+' '+cfg.password);assert.equal(r.reason,'PRIVILEGED_IDENTITY_MISMATCH');assert.equal(r.authenticated,false);pass('primary-administrator-cannot-be-claimed-by-alias');await close(c)
 c=await connect(cfg.adminName);r=await receipt(c,'/login '+cfg.password);assert.equal(r.state,'succeeded');assert.equal(r.authenticated,true);assert.equal(r.identityClass,'administrator');assert.equal((await receipt(c,'/sharedaccount status')).authenticated,true);pass('same-uuid-native-administrator-password-login-without-deop');await close(c)
 c=await connect(cfg.totpName);r=await receipt(c,'/login '+cfg.password);assert.equal(r.reason,'TOTP_REQUIRED');assert.equal(r.authenticated,false);r=await receipt(c,'/sharedaccount login '+cfg.password+' 000000');if(otp(cfg.totpSecret)==='000000')throw Error('SYNTHETIC_CODE_COLLISION');const unavailable=r.reason==='TOTP_PROVIDER_UNAVAILABLE';if(!unavailable)assert.equal(r.reason,'TOTP_INCORRECT');r=await receipt(c,'/sharedaccount login '+cfg.password+' '+otp(cfg.totpSecret));if(unavailable){assert.equal(r.reason,'TOTP_PROVIDER_UNAVAILABLE');assert.equal(r.authenticated,false);pass('native-totp-provider-absent-remains-closed-even-with-correct-code')}else{assert.equal(r.state,'succeeded');assert.equal(r.authenticated,true);pass('native-totp-required-wrong-denied-correct-accepted')}await close(c)
 c=await connect(cfg.totpName);r=await receipt(c,'/login '+cfg.password);assert.equal(r.reason,'TOTP_REQUIRED');assert.equal(r.authenticated,false);pass('reconnect-cannot-reuse-local-grace-to-bypass-totp');await close(c)
 await premiumImpostor();pass('premium-account-demands-native-encryption-challenge-and-offline-impostor-cannot-spawn')
 assert(!observer.messages.some(m=>m.includes('MC_SHARED_ACCOUNT')||m.includes('PRIVILEGED_IDENTITY_MISMATCH')||m.includes('TOTP_')));assert.equal(observer.receipts.length,0);pass('other-authenticated-player-receives-no-account-receipts')
 await close(observer);console.log(JSON.stringify({checks,passed:true}))
}
main().catch(error=>{console.error(JSON.stringify({failed:true,reason:error.message}));process.exitCode=1}).finally(async()=>{for(const c of live)await close(c);setTimeout(()=>process.exit(process.exitCode||0),250)})
