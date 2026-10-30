import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {command} from '../../../ops/rcon-client.mjs';
const [stage,out,actor,phase='initial']=process.argv.slice(2);
assert.equal(stage.replaceAll('\\','/'),'E:/MC/staging/aincrad-architecture-youer-20261030');
assert.match(actor,/^ag_RG[a-z0-9]{3,10}$/);
const require=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');
const rc=q=>command(q,15000,{properties:stage+'/server.properties',port:29398});
const bot=require('mineflayer').createBot({host:'127.0.0.1',port:29397,username:actor,version:'1.21.1',auth:'offline',hideErrors:true});
const report={passed:false,phase,checks:[],errors:[],messages:[],titles:[]};
const check=(name,ok)=>{assert(ok,name);report.checks.push(name);console.log('PASS '+name);};
bot.on('messagestr',s=>report.messages.push(s));bot.on('error',e=>report.errors.push(String(e)));bot.on('kicked',e=>report.kick=JSON.stringify(e));
bot._client.on('packet',(p,m)=>{if(m.name.includes('title_text'))report.titles.push(JSON.stringify(p));});
async function until(fn,label){for(let i=0;i<180;i++){if(await fn())return;await sleep(100);}throw Error('Timeout '+label);}
async function qa(action){const s=await rc('growthqa '+action.split(' ')[0]+' '+actor+(action.includes(' ')?' '+action.split(' ').slice(1).join(' '):''));const at=s.indexOf('GROWTH_QA {');if(at<0)throw Error('Missing fixture receipt: '+s);const data=JSON.parse(s.slice(at+10));report.lastReceipt={action,data};return data;}
async function say(cmd,test){const start=report.messages.length;bot.chat(cmd);await until(()=>report.messages.slice(start).some(test),cmd);return report.messages.slice(start);}
async function fall(){await qa('fall');await until(()=>bot.entity?.position.y>84,'fall teleport received');await until(()=>bot.entity?.position.y<81.05&&bot.entity.onGround,'physical fall landed');return qa('status');}
try{
 await until(()=>bot.entity,'spawn');await sleep(2000);await until(async()=>!(await rc('growthqa status '+actor)).includes('GROWTH_QA loading'),'profile loaded');
 if(phase==='restart'){
  const state=await qa('status'),saved=JSON.parse(fs.readFileSync(out.replace(/\.json$/,'.saved.json')));
  check('native level and cumulative XP survive normal cold restart',state.level===saved.level&&state.xpTotal===saved.xpTotal);
  check('foundation proficiency and unspent XP survive normal cold restart',state.legacyLevel===saved.legacyLevel&&Math.abs(state.legacyXp-saved.legacyXp)<.0001);
  check('native configured foundation passives remain available',state.foundation.passives.length===6);
  report.passed=true;
 }else{
  let state=await qa('setup');check('actual client is survival non-OP with no selected class',!state.op&&bot.game.gameMode==='survival');
  const old=state;await say('/mycli cast home',s=>s.includes('[unsafe_destination]'));state=await qa('status');
  check('blocked home never moves player or consumes mana',JSON.stringify(state.position)===JSON.stringify(old.position)&&state.mana===old.mana);
  check('home rejection has one explanation without redundant red failure',!report.messages.some(s=>s.includes('公共传送点未受理')));
  await qa('homefix');await qa('refill');const mana=(await qa('status')).mana;
  await say('/mycli cast home',s=>s.startsWith('MC_TRAVEL id=home'));state=await qa('status');
  check('actual home command reaches corrected passable surface',Math.abs(state.position[0]+543.5)<.1&&state.position[1]===67&&state.world==='minecraft:overworld');
  check('successful home uses one native mana payment',mana-state.mana>=5&&mana-state.mana<=6.01);
  await qa('pad');await qa('xp 8353');
  const messages=await say('/mycli status --json',s=>s.startsWith('MC_RPG ')&&s.includes('xpProgress'));
  const rpg=JSON.parse(messages.find(s=>s.startsWith('MC_RPG ')&&s.includes('xpProgress')).slice(7));
  check('actual status route returns cumulative XP separately from progress',rpg.class==='none'&&rpg.level===5&&rpg.xpTotal===8353&&rpg.xpProgress===3373&&rpg.xpRequired===5745&&rpg.xpRemaining===2372);
  await say('/mycli status',s=>s.includes('本级经验 3373/5745'));
  await until(async()=>(await qa('status')).scoreboard.some(s=>s.includes('3373/5745')),'native scoreboard progress');
  check('native sidebar and CLI use identical current-level progress',true);
  await qa('xp 10724');state=await qa('grant 1');check('native exact XP threshold levels up without manual correction',state.level===6&&state.xpProgress===0&&state.xpTotal===10725);
  state=await qa('grant 90000');check('overflow XP still advances through multiple native levels',state.level>6&&state.xpTotal===100725&&state.xpProgress<state.xpRequired);
  await qa('pad');await qa('proficiency agility 50');const before=await qa('status'),baseline=await fall();
  check('real movement still awards foundation XP without class XP',baseline.legacyXp>before.legacyXp&&baseline.xpTotal===before.xpTotal);
  report.baselineFall=baseline;
  const patch=spawnSync('E:/MC/runtime/python-3.12.14/python.exe',['-X','utf8',path.join(path.dirname(out),'apply-foundation.py')],{encoding:'utf8'});assert.equal(patch.status,0,patch.stderr);
  await qa('reload');await sleep(700);state=await qa('status');
  check('official AuraSkills reload retains eleven proficiency tracks and all historical XP',state.legacyEnabled===11&&state.legacyLevel===baseline.legacyLevel&&state.legacyXp===baseline.legacyXp);
  check('six selected passives are native configured abilities',state.foundation.passives.length===6&&state.foundation.passives.every(p=>!p.description.includes('{value}')));
  const light=state.foundation.passives.find(p=>p.id.endsWith('light_fall'));check('native passive value is capped and descriptions show real values',light.value<=11&&light.level<=10&&light.unlocked);
  const reduced=await fall();report.passiveFall=reduced;
  check('actual physical fall damage is reduced by existing passive engine',reduced.health>baseline.health+.1&&reduced.health<state.health);
  await say('/mycli skills list passive',s=>s.includes('[成长分工]'));
  await say('/mycli skills list passive --json',s=>s.startsWith('MC_RPG ')&&s.includes('"kind":"foundation"'));
  await say('/mycli skills list passive bad',s=>s.includes('[invalid_argument]'));
  check('passive queries are compact, explicit and reject extra arguments',true);
  await qa('pad');await qa('wound');const hurt=await qa('status');bot.chat('/mycli cast selfheal');await until(async()=>(await qa('status')).health>hurt.health,'actual self-heal');state=await qa('status');check('classless self-heal has a real health effect and pays native mana',state.mana<=15&&state.mana>=14);
  await qa('hungry');bot.chat('/mycli cast food');await until(async()=>(await qa('status')).food===16,'actual food');check('classless food restores four hunger points',true);
  await qa('refill');const torches=(await qa('status')).torches;bot.chat('/mycli cast give torch');await until(async()=>(await qa('status')).torches===torches+4,'real conjured items');check('classless creation deposits four real torches',true);
  await qa('refill');bot.chat('/mycli cast night');await until(async()=>(await qa('status')).night,'night effect');state=await qa('status');check('classless night vision applies real potion effect and pays native mana',state.mana<=19&&state.mana>=18);
  await say('/mycli cast night',s=>s.includes('[cooldown]'));const cooling=await qa('status');check('night cooldown rejection does not pay again',cooling.mana>=state.mana&&cooling.mana-state.mana<=1);
  await qa('refill');bot.chat('/mycli cast feather');await until(async()=>(await qa('status')).feather,'slow falling effect');check('classless feather applies real potion effect',true);
  await qa('pad');let targetHealth=(await qa('targets')).targets;await bot.look(-Math.PI/2,0,true);bot.chat('/mycli cast starbolt');await until(async()=>(await qa('status')).targets.some((n,i)=>n<targetHealth[i]),'starbolt hit');check('classless starbolt damages an actual hostile target',true);
  targetHealth=(await qa('targets')).targets;bot.chat('/mycli cast frostnova');await until(async()=>(await qa('status')).targets.some((n,i)=>n<targetHealth[i]),'frost hit');check('classless frost nova damages actual nearby targets',true);
  await qa('ore');bot.chat('/mycli cast prospect coal');await until(async()=>(await qa('status')).mana<=15,'actual prospecting payment');check('prospecting marks a real nearby ore and pays native mana',true);
  await qa('pad');const origin=(await qa('status')).position;await until(()=>Math.abs(bot.entity.position.x-origin[0])<.1,'blink origin received');await bot.lookAt(bot.entity.position.offset(12,-.5,0),true);await sleep(300);report.blinkAim=await qa('status');check('blink aim reaches a real solid floor',report.blinkAim.sight?.[3]==='STONE');bot.chat('/mycli cast blink');await until(async()=>{const p=(await qa('status')).position;return Math.hypot(p[0]-origin[0],p[2]-origin[2])>1;},'actual blink');check('classless blink moves to a safe visible floor',true);
  await say('/mycli skills --help',s=>s.includes('passive'));check('actual help advertises the retained foundation system',true);
  await qa('cold');await until(async()=>!(await qa('status')).coldLoaded,'existing entry chunk unload');await qa('asyncprobe');await until(async()=>(await qa('status')).coldAsyncNull!==undefined,'native async probe');state=await qa('status');
  check('current kernel reproduces null async result for generated cold chunk',state.coldGenerated&&state.coldAsyncNull===true&&!state.coldAsyncError);
  const travelMana=state.mana;bot.chat('/mycli dungeon travel qa_growth');await until(async()=>{const p=(await qa('status')).position;return p[0]<-540&&p[2]<-435;},'cold dungeon travel');state=await qa('status');
  check('real dungeon command loads existing entry without teleport bypass',state.coldLoaded&&state.position[1]===67&&travelMana-state.mana>=7&&travelMana-state.mana<=8.01);
  state=await qa('status');fs.writeFileSync(out.replace(/\.json$/,'.saved.json'),JSON.stringify(state));report.passed=true;
 }
 check('no protocol disconnect or client error during gameplay',!report.kick&&report.errors.length===0);
}catch(error){report.error=String(error.stack);throw error;}
finally{if(!bot._client.ended)bot.quit();fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');}
