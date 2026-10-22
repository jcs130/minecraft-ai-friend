import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {localProxyConnect} from '../../../ops/auth-proxy.mjs';
import {installRecipePacketBypass} from '../../../ops/mineflayer-client-compat.mjs';

const [stage,output]=process.argv.slice(2);
assert.equal(stage.replaceAll('\\','/'),'E:/MC/staging/portal-accounts-20261022');
assert.match(fs.readFileSync(stage+'/proxy/velocity.toml','utf8'),/bind\s*=\s*"127\.0\.0\.1:27061"/);
const req=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');
const bots=[],report={checks:[],passed:false},secret='isolated-recovery-test-password';
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
async function until(fn,ms=25000){const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await sleep(100);}throw Error('Authentication condition timed out');}
async function connect(version){
 const bot=req('mineflayer').createBot({host:'127.0.0.1',port:27061,username:'ag_AuthFix22',auth:'offline',version,connect:localProxyConnect(27061),defaultChatPatterns:false,hideErrors:true});bots.push(bot);
 bot.physicsEnabled=false;bot.lines=[];bot.errors=[];bot.on('error',e=>bot.errors.push(e.message));bot.on('messagestr',s=>bot.lines.push(s));bot.on('end',()=>bot.ended=true);installRecipePacketBypass(bot._client);
 await until(()=>bot.lines.some(s=>s.includes('MC_AUTH_SUCCESS')||s.includes('MC_AUTH_LOGIN')));
 return bot;
}
async function query(bot,cmd,prefix){await sleep(1100);const at=bot.lines.length;bot.chat(cmd);return until(()=>bot.lines.slice(at).find(s=>s.startsWith(prefix)));}
async function state(bot){const value=await query(bot,'/authstatus','MC_AUTH_STATE ');return JSON.parse(value.slice('MC_AUTH_STATE '.length));}
async function close(bot){bot.quit();await until(()=>bot.ended,8000);await sleep(700);}
const blocker=stage+'/auth-heartbeat.json.tmp';
try{
 let bot=await connect('1.21.1');
 if(!bot.lines.some(s=>s.includes('MC_AUTH_SUCCESS'))){bot.chat('/login '+secret);await until(()=>bot.lines.some(s=>s.includes('MC_AUTH_SUCCESS')));}
 let current=await state(bot);
 if(!current.passwordSet){await query(bot,'/register '+secret+' '+secret,'[MC_AUTH_PASSWORD_SET]');current=await state(bot);}
 check('original verifier stores isolated account password',current.authorized&&current.passwordSet);
 const uuid=current.playerUuid;await close(bot);
 for(const version of ['1.21.1','1.20.6']){
  bot=await connect(version);check(version+' registered identity requires login',bot.lines.some(s=>s.startsWith('[MC_AUTH_LOGIN]'))&&!bot.lines.some(s=>s.includes('MC_AUTH_SUCCESS')));
  const denied=await query(bot,'/mycli status','[MC_AUTH_DENIED]');check(version+' unauthenticated custom command blocked',!!denied);
  bot.chat('/login '+secret);await until(()=>bot.lines.some(s=>s.startsWith('[MC_AUTH_SUCCESS]')));
  current=await state(bot);check(version+' original password verifier authorizes correct UUID',current.authorized&&current.status==='authenticated'&&current.playerUuid===uuid);
  fs.mkdirSync(blocker);
  try{
   await sleep(1800);current=await state(bot);
   check(version+' actual heartbeat filesystem failure preserves real authorization',current.authorized&&current.status==='authenticated');
   const raw=await query(bot,'/login deliberately-wrong-already-authorized','MC_AUTH_STATE ');const recovery=JSON.parse(raw.slice('MC_AUTH_STATE '.length));
   check(version+' repeated login returns authoritative recovery state',recovery.authorized&&recovery.status==='authenticated');
   check(version+' success marker is not replayed',bot.lines.filter(s=>s.startsWith('[MC_AUTH_SUCCESS]')).length===1);
   const paperLog=stage+'/paper/logs/latest.log',offset=fs.readFileSync(paperLog,'utf8').length;
   await sleep(1100);bot.chat('/minecraft:list');
   await until(()=>fs.readFileSync(paperLog,'utf8').slice(offset).includes('ag_AuthFix22 issued server command: /minecraft:list'));
   check(version+' existing gameplay commands still reach Paper',true);
  }finally{fs.rmdirSync(blocker);}
  await sleep(1200);check(version+' connection stays live without reconnect',!bot.ended&&bot.errors.length===0);await close(bot);
 }
 report.passed=true;
}catch(error){report.error=error.stack;throw error;}
finally{for(const bot of bots)if(!bot.ended)bot.quit();await sleep(500);fs.writeFileSync(output,JSON.stringify(report,null,2));}
