import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {installRecipePacketBypass} from 'file:///E:/MC/ops/mineflayer-client-compat.mjs';

const [stage, output] = process.argv.slice(2);
if (!stage || !output || !path.isAbsolute(stage) || !path.isAbsolute(output)
  || !stage.replaceAll('\\','/').startsWith('E:/MC/staging/')
  || fs.readFileSync(stage+'/.communication-qa','utf8').trim() !== '127.0.0.1:29397 20261030'
  || fs.existsSync(output)) throw Error('Fresh isolated marked stage and result path required');
const require = createRequire(process.env.MC_BOT_PACKAGE_JSON ?? 'E:/MC/probe/package.json');
const name = 'ag_BL'+Date.now().toString(36).slice(-8);
const report = {passed:false,productionChanged:false,name,checks:[],cases:[],errors:[]};
const rc = query => command(query,15000,{properties:stage+'/server.properties',port:29398});
const check = (yes, label) => {if (!yes) throw Error(label); report.checks.push(label);console.log('PASS '+label);};
async function until(fn,label,timeout=18000) {const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await sleep(80);}throw Error('TIMEOUT '+label);}
async function qa(action, scenario='') {
  const text=await rc('blinkqa '+action+' '+name+(scenario?' '+scenario:''));
  const payload=text.match(/BLINK_QA (\{[^\r\n]+\})/)?.[1]; if (!payload)throw Error('Fixture not ready: '+text.slice(0,300));
  return JSON.parse(payload);
}
const bot=require('mineflayer').createBot({host:'127.0.0.1',port:29397,username:name,version:'1.21.1',auth:'offline',viewDistance:'far',checkTimeoutInterval:60000});
installRecipePacketBypass(bot._client,{enabled:true});
bot.on('error',e=>report.errors.push(e.name));bot.on('kicked',e=>{report.kick=String(e);});
const messages=[];bot.on('messagestr',s=>messages.push(s));
async function setup(scenario) {
  const state=await qa('case',scenario);
  await until(()=>Math.abs(bot.entity.position.x-205.5)<.05&&Math.abs(bot.entity.position.y-201)<.05,'fixture body position');
  await sleep(1200);
  await bot.lookAt(bot.entity.position.offset(30,1.62,0),true);await sleep(120);
  return state;
}
async function cast(scenario,expectSuccess,aim,cmd='/mycli cast blink') {
  await setup(scenario);
  if(aim){await bot.lookAt(bot.entity.position.offset(...aim),true);await sleep(160);}
  const before=await qa('status'),index=messages.length,at=Date.now();bot.chat(cmd);
  await until(()=>messages.slice(index).some(s=>s.includes('[闪现]')||s.includes('[blink_')||s.includes('[legacy_progression_retired]')||s.includes('魔力不足')||s.includes('旁观者不能施法')),'actual cast result');
  await sleep(200);const after=await qa('status'),delta=Math.hypot(after.position[0]-before.position[0],after.position[1]-before.position[1],after.position[2]-before.position[2]);
  const row={scenario,before,after,delta,ms:Date.now()-at,messages:messages.slice(index)};report.cases.push(row);
  if(expectSuccess) {
    check(delta>.75&&delta<=25.001,scenario+' moves the actual body within range');
    check(before.mana-after.mana>=3&&before.mana-after.mana<=4.01&&after.successEvents===1,scenario+' pays native mana once and publishes one success');
    check(after.cooldown>6&&after.cooldown<=8.01,scenario+' retains the native eight-second cooldown');
  } else check(delta<.001&&after.successEvents===0&&after.cooldown===0&&after.mana>=before.mana,scenario+' rejects without moving, charging or starting cooldown');
  return row;
}
try {
  await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);setTimeout(()=>reject(Error('JOIN_TIMEOUT')),35000).unref();});
  bot.physicsEnabled=false;
  await until(async()=>!(await rc('blinkqa status '+name)).includes('loading'),'native profile');
  let state=await qa('case','flat');check(state.spellClass==='org.qiandengji.magic.SmartBlinkSpell','official MagicSpells addon loader selects the new class');
  check(!state.op,'ordinary non-OP test actor');
  check(JSON.stringify(state.localShape)==='[[0,0,0,1,1,1]]','native VoxelShape uses original block-local collision boxes');
  let mark=messages.length;bot.chat('/mycli skills info blink');await until(()=>messages.slice(mark).some(s=>s.includes('最远安全地面')),'current guide');
  check(!messages.slice(mark).some(s=>s.includes('平视空中可能没有合法落点')),'guide no longer says horizontal air aim fails');
  mark=messages.length;bot.chat('/mycli help cast.blink');await until(()=>messages.slice(mark).some(s=>s.includes('最远安全地面')),'current CLI catalog');
  let row=await cast('flat',true);check(Math.abs(row.after.position[0]-230.5)<.02&&Math.abs(row.after.position[1]-201)<.02,'air aim reaches the farthest flat landing');
  const position=row.after.position,events=row.after.successEvents,mana=row.after.mana;mark=messages.length;bot.chat('/mycli cast blink');await sleep(600);state=await qa('status');
  check(JSON.stringify(state.position)===JSON.stringify(position)&&state.successEvents===events&&state.mana>=mana,'immediate repeat is rejected by the original cooldown');
  row=await cast('aimed',true,[8,-.01,0]);check(row.after.position[0]>212.5&&row.after.position[0]<214.1,'explicit nearby floor wins over the distant forward landing');
  row=await cast('wall',true);check(row.after.position[0]<215&&row.after.position[0]>213&&row.after.position[1]===201,'wall face selects a safe landing on the near side');
  row=await cast('void',true);check(row.after.position[0]<222&&row.after.position[0]>220,'farther unsupported ground is skipped');
  row=await cast('magma',true);check(row.after.position[0]<228&&row.after.position[0]>226,'forward search skips damaging ground');
  row=await cast('slab',true);check(row.after.position[1]===200.5,'half slab uses its actual collision height');
  row=await cast('border',true);check(row.after.position[0]<220.3&&row.after.position[0]>219,'whole standing body remains inside the world border');
  await cast('aim_magma',false,[25,-.01,0]);
  await cast('ceiling',false,[4,6,0]);
  await cast('empty',false);
  await cast('cancel_target',false);
  await cast('redirect',false);
  await cast('cancel_tp',false);
  await cast('no_mana',false);
  await cast('spectator',false);
  await cast('direct',false,undefined,'/cast blink');
  row=await cast('alias',true,undefined,'/mycli cast 闪现术');check(Math.abs(row.after.position[0]-230.5)<.02,'existing Chinese alias shares the same landing selection');
  check(!report.kick&&report.errors.length===0,'no protocol failure or disconnect');
  await qa('restore');report.passed=true;
} catch(error) {report.error=String(error.stack);process.exitCode=1;console.error(report.error);}
finally {bot.quit('Isolated blink verification complete');await sleep(300);fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,error:report.error}));}
