// Real loopback Mineflayer consumer. Credentials are read from a private fixture,
// never put in argv, stdout, screenshots or an exported test report.
const fs=require('node:fs');const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const mineflayer=createRequire(process.env.MAW_TEST_MINEFLAYER_PACKAGE)('mineflayer');
const cfg=JSON.parse(fs.readFileSync(process.env.MAW_TEST_CREDENTIALS,'utf8'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function connect(name){
 const bot=mineflayer.createBot({host:'127.0.0.1',port:cfg.port,username:name,auth:'offline',version:'1.20.1'});
 const messages=[];bot.on('messagestr',m=>messages.push(m));bot.on('error',()=>{});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('SPAWN_TIMEOUT')),20000);bot.once('spawn',()=>{clearTimeout(t);resolve();});bot.once('kicked',()=>{clearTimeout(t);reject(Error('UNEXPECTED_KICK'));});});
 await sleep(1000);return {bot,messages};
}
async function until(fn){for(let n=0;n<160;n++){const result=fn();if(result)return result;await sleep(100);}throw Error('RECEIPT_TIMEOUT');}
async function structured(c,command){
 for(let attempt=0;attempt<2;attempt++){
  const start=c.messages.length;c.bot.chat(command);
  const r=await until(()=>c.messages.slice(start).find(m=>m.startsWith('MC_SHARED_ACCOUNT '))&&JSON.parse(c.messages.slice(start).find(m=>m.startsWith('MC_SHARED_ACCOUNT ')).slice('MC_SHARED_ACCOUNT '.length)));
  if(r.reason==='LOGIN_COOLDOWN'&&r.accepted===false&&attempt===0){await sleep(r.retryAfterMs+150);continue;}
  return r;
 }
}
async function close(c){c.bot.quit();await sleep(800);}
async function main(){
 const mode=process.argv[2];const checks=[];const pass=x=>{checks.push(x);console.log(JSON.stringify({check:x}));};
 if(mode==='online-guard'){
  let c=await connect('b_SaoCleanQ');let r=await structured(c,'/login '+cfg.retryName+' '+cfg.password);assert.equal(r.state,'succeeded');assert.equal(r.authenticated,true);
  const id=c.bot.player.uuid;const inventory=()=>JSON.stringify(c.bot.inventory.items().map(x=>({slot:x.slot,type:x.type,count:x.count})));const before=inventory();
  for(const command of ['/online','/unregister '+cfg.password,'/register '+cfg.password]){
   const start=c.messages.length;c.bot.chat(command);await until(()=>c.messages.slice(start).some(m=>m.includes('当前身体使用千灯纪统一账号')));
  }
  assert.equal(c.bot.player.uuid,id);assert.equal(inventory(),before);pass('linked-body-blocks-native-online-register-unregister-without-inventory-or-uuid-change');await close(c);
  c=await connect('b_SaoCleanQ');r=await structured(c,'/login '+cfg.retryName+' '+cfg.password);assert.equal(r.state,'succeeded');assert.equal(r.authenticated,true);assert.equal(c.bot.player.uuid,id);pass('same-native-password-and-body-login-after-blocked-mode-switch');await close(c);console.log(JSON.stringify({mode,checks}));return;
 }
 if(mode==='first-link'){
  const c=await connect('b_SaoCleanQ');const r=await structured(c,'/login '+cfg.retryName+' '+cfg.password);assert.equal(r.state,'succeeded');assert.equal(r.authenticated,true);assert.equal(r.linked,true);pass('pending-first-link-world-starts-and-commits-native-binding');await close(c);console.log(JSON.stringify({mode,checks}));return;
 }
 if(mode==='explicit-alias'){
  let c=await connect('b_SaoAliasQa');let r=await structured(c,'/login '+cfg.retryName+' '+cfg.password);assert.equal(r.state,'succeeded');assert.equal(r.authenticated,true);assert.equal(r.primaryName,cfg.retryName);assert.equal(r.bodyName,'b_SaoAliasQa');pass('fresh-bedrock-style-body-explicit-primary-account-login');await close(c);
  c=await connect('b_AdminQa');r=await structured(c,'/login '+cfg.retryName+' '+cfg.password);assert.equal(r.state,'failed');assert.equal(r.reason,'RESERVED_ACCOUNT');assert.equal(r.accepted,false);pass('ordinary-primary-cannot-enroll-local-op-body');await close(c);console.log(JSON.stringify({mode,checks}));return;
 }
 if(mode==='offline-feed'){
  let c=await connect(cfg.oldName);let r=await structured(c,'/login '+cfg.sitePassword);assert.equal(r.state,'succeeded');assert.equal(r.authenticated,true);pass('established-binding-uses-native-authority-during-website-outage');await close(c);
  c=await connect('ag_NotEnrolled');r=await structured(c,'/login '+cfg.password);assert.equal(r.state,'failed');assert.equal(r.accepted,false);assert.equal(r.reason,'OWNERSHIP_FEED_UNAVAILABLE');pass('expired-ownership-feed-cannot-enroll-new-body');await close(c);console.log(JSON.stringify({mode,checks}));return;
 }
 if(mode==='source-change'){
  const c=await connect(cfg.oldName);let r=await structured(c,'/login '+cfg.password);assert.equal(r.state,'failed');assert.equal(r.reason,'PASSWORD_INCORRECT');pass('primary-website-old-password-rejected-in-sao');
  r=await structured(c,'/login '+cfg.sitePassword);assert.equal(r.state,'succeeded');assert.equal(r.authenticated,true);assert.equal(r.linked,true);assert.equal(c.bot.inventory.items().filter(i=>i.name==='iron_ingot').reduce((s,i)=>s+i.count,0),3);pass('primary-website-new-password-works-in-sao-with-original-inventory');await close(c);console.log(JSON.stringify({mode,checks}));return;
 }
 if(mode==='seed-legacy'){
  const c=await connect(cfg.oldName);await sleep(5000);c.bot.chat('/register '+cfg.legacyPassword);await until(()=>c.messages.some(m=>/autentic|register.*success|registrado|success.*register/i.test(m)));
  fs.writeFileSync(process.env.MAW_TEST_SEED_SIGNAL,JSON.stringify({connected:true}));await until(()=>fs.existsSync(process.env.MAW_TEST_SEED_DONE));
  await sleep(500);assert.equal(c.bot.inventory.items().filter(i=>i.name==='iron_ingot').reduce((s,i)=>s+i.count,0),3);await close(c);
  console.log(JSON.stringify({mode,checks:['legacy-native-registration','three-real-iron-ingots']}));return;
 }
 let c,r;
 if(mode==='resume-shared'){
  c=await connect(cfg.newName);r=await structured(c,'/login '+cfg.changedPassword);assert.equal(r.state,'succeeded');assert.equal(r.authenticated,true);assert.equal(r.linked,true);pass('restart-shared-binding-and-primary-password-persisted');await close(c);
 }else{
 c=await connect(cfg.newName);
 r=await structured(c,'/login wrong-password');assert.equal(r.state,'failed');assert.equal(r.reason,'PASSWORD_INCORRECT');pass('wrong-primary-password-denied');
 await sleep(1500);r=await structured(c,'/login '+cfg.password);assert.equal(r.state,'succeeded');assert.equal(r.authenticated,true);assert.equal(r.linked,true);const uuid=r.bodyUuid;pass('fresh-body-native-shared-login');
 r=await structured(c,'/sharedaccount status');assert.equal(r.authenticated,true);assert.equal(r.primaryName,cfg.newName);assert.equal(r.bodyUuid,uuid);pass('actual-native-authentication-and-identity');
 await sleep(1500);r=await structured(c,'/changepassword '+cfg.password+' '+cfg.changedPassword);assert.equal(r.state,'succeeded');assert.equal(r.reason,'PASSWORD_CHANGED');pass('game-password-change-written-to-primary');
 await close(c);c=await connect(cfg.newName);r=await structured(c,'/login '+cfg.password);assert.equal(r.state,'failed');assert.equal(r.reason,'PASSWORD_INCORRECT');pass('reconnect-old-password-and-local-grace-denied');
 await sleep(1500);r=await structured(c,'/login '+cfg.changedPassword);assert.equal(r.state,'succeeded');assert.equal(r.bodyUuid,uuid);pass('reconnect-new-password-and-same-uuid');await close(c);
 }
 c=await connect(cfg.oldName);c.bot.chat('/login '+cfg.password);await sleep(4000);
 // The old target does not accept a same-name primary password before proof.
 c.bot.chat('/login '+cfg.legacyPassword);await until(()=>c.messages.some(m=>/autenticado|authenticated successfully|登录成功/i.test(m)));
 await sleep(1500);r=await structured(c,'/sharedaccount link '+cfg.oldName+' '+cfg.password);assert.equal(r.state,'succeeded');assert.equal(r.authenticated,true);assert.equal(r.linked,true);pass('old-body-authenticated-then-explicitly-linked');
 assert.equal(c.bot.inventory.items().filter(i=>i.name==='iron_ingot').reduce((s,i)=>s+i.count,0),3);pass('existing-inventory-preserved');await close(c);
 c=await connect(cfg.oldName);r=await structured(c,'/login '+cfg.legacyPassword);assert.equal(r.state,'failed');assert.equal(r.reason,'PASSWORD_INCORRECT');pass('old-local-password-no-longer-authoritative');
 await sleep(1500);r=await structured(c,'/login '+cfg.password);assert.equal(r.state,'succeeded');assert.equal(c.bot.inventory.items().filter(i=>i.name==='iron_ingot').reduce((s,i)=>s+i.count,0),3);pass('old-body-primary-password-login-preserves-items');await close(c);
 if(cfg.retryName){
  c=await connect(cfg.retryName);r=await structured(c,'/login wrong-password');assert.equal(r.reason,'PASSWORD_INCORRECT');await close(c);
  c=await connect(cfg.retryName);r=await structured(c,'/login '+cfg.password);assert.equal(r.state,'succeeded');assert.equal(r.authenticated,true);pass('first-failed-login-then-disconnect-can-complete-original-new-body');await close(c);
 }
 console.log(JSON.stringify({mode,checks}));
}
main().catch(e=>{console.error(JSON.stringify({failed:true,reason:e.message}));process.exitCode=1;setTimeout(()=>process.exit(1),1000);});
