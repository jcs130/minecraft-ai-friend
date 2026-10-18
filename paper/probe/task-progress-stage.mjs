// Deliberately restricted to an owned loopback fixture. No production login or writes.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
assert(process.env.MC_TASK_PROGRESS_QA_ROOT,'Set a private report directory');
const root=path.resolve(process.env.MC_TASK_PROGRESS_QA_ROOT).replaceAll('\\','/'),setup=JSON.parse(fs.readFileSync(root+'/setup.json'));
const stage=setup.stage,mode=process.argv[2]??'initial';assert(['initial','resume'].includes(mode));
assert.equal(path.dirname(stage),'E:/MC/staging');assert.equal(fs.readFileSync(stage+'/.task-progress-stage','utf8').trim(),'task-progress-20261018');
const props=fs.readFileSync(stage+'/server.properties','utf8');
for(const s of ['server-ip=127.0.0.1','server-port=25930','rcon.port=25931','motd=TASK_PROGRESS_ISOLATED_20261018'])assert(props.split(/\r?\n/).includes(s));
const reportFile=root+'/'+mode+'-'+Date.now()+'.json',out={at:new Date().toISOString(),mode,checks:[],samples:{},productionChanged:false};
out.jarSha256=crypto.createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.47.5.jar')).digest('hex');
if(fs.existsSync(root+'/candidate-final.json'))assert.equal(out.jarSha256,JSON.parse(fs.readFileSync(root+'/candidate-final.json','utf8').replace(/^\uFEFF/,'')).sha256,'Test the fixed final artifact');
const req=createRequire('E:/MC/probe/package.json'),mf=req('mineflayer'),{Vec3}=req('vec3'),yaml=createRequire('E:/MC/ops/yaml-check/package.json')('js-yaml');
const rc=q=>command(q,15000,{port:25931,properties:stage+'/server.properties'}),bots=[];let closing=false;
const check=(name,ok)=>{out.checks.push({name,pass:!!ok});assert(ok,name);console.log('PASS '+name);};
async function until(fn,name,ms=15000){for(const end=Date.now()+ms;Date.now()<end;){const x=await fn();if(x)return x;await sleep(80);}throw Error('Timeout: '+name);}
async function connect(username){
 const bot=mf.createBot({host:'127.0.0.1',port:25930,version:'1.21.1',auth:'offline',username,hideErrors:true,defaultChatPatterns:false,checkTimeoutInterval:60000});
 bots.push(bot);installRecipePacketBypass(bot._client);bot.lines=[];bot.packets=[];
 bot.on('messagestr',s=>{s=s.replace(/§[0-9a-fk-or]/gi,'');bot.lines.push(s);try{if(s.startsWith('MC_TASKS '))bot.packets.push(JSON.parse(s.slice(9)));else if(s.startsWith('{'))bot.packets.push(JSON.parse(s));}catch{}});
 bot._client.on('custom_payload',p=>{if(['mcagent:tasks','mcagent:market'].includes(p.channel))try{bot.packets.push(JSON.parse(p.data.toString()));}catch{}});
 bot.on('error',e=>{if(!closing){out.errors??=[];out.errors.push(username+': '+e.message);}});
 bot.on('kicked',reason=>{bot.connectionError=JSON.stringify(reason);});
 await until(()=>{if(bot.connectionError)throw Error(bot.connectionError);return bot.entity&&bot.world.getColumnAt(bot.entity.position);},'spawn '+username,45000);return bot;
}
async function say(bot,line){await sleep(Math.max(0,1100-(Date.now()-(bot.sent??0))));bot.sent=Date.now();bot.chat('/mycli '+line);}
async function cli(bot,line,predicate=p=>p.type==='status'){
 const from=bot.packets.length;await say(bot,line);
 return until(()=>bot.packets.slice(from).find(predicate),line);
}
const status=bot=>cli(bot,'tasks status --json');
async function text(bot,line){const from=bot.lines.length;await say(bot,line);await sleep(650);return bot.lines.slice(from).join('\n');}
const observation=async name=>{const raw=await rc('mycli admin observe '+Buffer.from(JSON.stringify({op:'player',player:name})).toString('base64url'));assert(raw.startsWith('MC_OBSERVATION '),raw);return JSON.parse(raw.slice(15));};
const saved=()=>yaml.load(fs.readFileSync(stage+'/plugins/AgentFriend/config.yml','utf8'));
function own(bot){return saved()['guild-players'][bot.player.uuid];}
async function accept(bot,id){await text(bot,'guild join');const answer=await text(bot,'guild accept '+id);check('accept '+id,answer.includes('已接公会委托'));return status(bot);}
async function target(bot,type,label){
 const tag='guidance18_'+label;
 await rc(`minecraft:summon minecraft:${type} ${bot.entity.position.x+2} ${bot.entity.position.y} ${bot.entity.position.z} {Tags:["${tag}"],NoAI:1b,NoGravity:1b,Silent:1b,PersistenceRequired:1b,Health:0.5f}`);
 const entity=await until(()=>Object.values(bot.entities).filter(e=>e.name===type&&e.position.distanceTo(bot.entity.position)<3).sort((a,b)=>b.id-a.id)[0],'QA '+type);return {entity,tag};
}
async function kill(bot,type,label,weapon='stone_sword',magic=false){
 await rc(`minecraft:item replace entity ${bot.username} hotbar.6 with minecraft:${weapon}`);bot.setQuickBarSlot(6);await sleep(180);
 const mob=await target(bot,type,label);
 if(magic)await rc(`minecraft:damage @e[tag=${mob.tag},limit=1] 100 minecraft:magic by ${bot.username}`);
 else{await bot.lookAt(mob.entity.position.offset(0,.3,0));bot.attack(mob.entity);}
 await until(async()=>(await rc(`minecraft:execute if entity @e[tag=${mob.tag},limit=1]`)).includes('failed'),'actual death '+label);await sleep(180);
}
async function craft(bot,item){
 const table=bot.blockAt(new Vec3(2200,100,2199));assert.equal(table?.name,'crafting_table');
 const recipe=bot.recipesFor(bot.registry.itemsByName[item].id,null,1,table)[0];assert(recipe,'local recipe');
 const packets=[],listen=p=>packets.push(p);bot._client.on('set_slot',listen);
 try{
  await bot.activateBlock(table);const w=await until(()=>bot.currentWindow?.type==='minecraft:crafting'&&bot.currentWindow,'native crafting window');
  for(let y=0;y<recipe.inShape.length;y++)for(let x=0;x<recipe.inShape[y].length;x++){
   const part=recipe.inShape[y][x];if(part.id===-1)continue;
   const slot=w.slots.findIndex((v,i)=>i>=w.inventoryStart&&v?.type===part.id);assert(slot>=0,'native ingredient');
   await bot.clickWindow(slot,0,0);await sleep(90);await bot.clickWindow(1+x+3*y,1,0);await sleep(90);await bot.clickWindow(slot,0,0);await sleep(90);
  }
  await until(()=>packets.some(p=>p.windowId===w.id&&p.slot===0&&p.item?.itemId===bot.registry.itemsByName[item].id),'authoritative output');
  await bot.clickWindow(0,0,1);await sleep(250);assert(!w.selectedItem,'cursor empty after native craft');bot.closeWindow(w);await sleep(200);
 }finally{bot._client.off('set_slot',listen);}
}
try{
 check('candidate loaded',(await rc('version AgentFriend')).includes('0.4.47.5'));
 if(mode==='resume'){
  const a=await connect('ag_Guide18');const state=await status(a),q=state.adventure.market;out.samples.resume=state;
  const before=JSON.parse(fs.readFileSync(root+'/before-restart.json'));
  check('cold restart keeps frozen definition and real progress',q.id==='tm_spider_patrol'&&q.progress===4&&q.guidance.ready===true);
  await rc('save-all flush');check('frozen terms unchanged across restart',own(a).active.market.definition===before.definition);
  check('ephemeral old action not inherited by a new connection',!q.lastAttempt);
  const claim=await text(a,'guild claim');out.samples.claim=claim;
  check('native completed contract can be submitted',!(await status(a)).adventure.activeId);
  await rc('save-all flush');check('reward recorded once',own(a).completed===before.completed+1);
  await text(a,'guild claim');await rc('save-all flush');check('repeated submit cannot issue a second reward',own(a).completed===before.completed+1);
  await text(a,'guild accept high_peak');const legacy=(await status(a)).adventure;
  check('legacy task receives actionable roof guidance',legacy.activeId==='high_peak'&&legacy.guidance.nextAction.includes('屋顶'));
  const goddess=await observation(a.username);check('Goddess reads legacy task identity and progress',goddess.currentContract.available===true&&goddess.currentContract.id==='high_peak'&&goddess.currentContract.progress===legacy.progress);
  await text(a,'life accept builder_home');const both=await status(a);
  check('independent life task names missing building requirements and next action',both.life.activeId==='builder_home'&&both.life.nextAction.includes('屋顶')&&both.life.remaining>0&&both.life.nextCommand==='/mycli life status');
 }else{
  await rc('minecraft:gamerule doMobSpawning false');await rc('minecraft:gamerule doDaylightCycle false');await rc('minecraft:time set midnight');
  const a=await connect('ag_Guide18'),guest=await connect('ag_Outside18'),eye=await connect('ag_Guide18_eye'),city=await connect('ag_City18'),human=await connect('GuideHuman18');
  await rc('minecraft:forceload add 2192 2192 2223 2223');
  await rc('minecraft:fill 2196 99 2196 2212 99 2208 minecraft:stone');await rc('minecraft:fill 2196 100 2196 2212 104 2208 minecraft:air');
  await rc('minecraft:setblock 2200 100 2199 minecraft:crafting_table');
  await rc('minecraft:tp ag_Guide18 2201.5 100 2202.5');await rc('minecraft:effect give ag_Guide18 minecraft:resistance 600 4 true');
  await rc('minecraft:gamemode spectator ag_Guide18_eye');await rc('minecraft:tp ag_Guide18_eye ag_Guide18');await rc('minecraft:spectate ag_Guide18 ag_Guide18_eye');await sleep(2500);
  check('new query does not enroll',!(await status(a)).adventure.activeId);
  const state=await accept(a,'tm_spider_patrol');out.samples.initial=state;
  check('active progress includes current and remaining',state.adventure.market.progress===0&&state.adventure.market.remaining===4);
  check('same species and weapon rules explicit',state.adventure.market.guidance.nextAction.includes('同种')&&state.adventure.market.guidance.nextAction.includes('原版近战'));
  const outside=guest.lines.length,eyeFrom=eye.lines.length;
  await kill(a,'spider','wrong_weapon_1','stick');await kill(a,'spider','wrong_weapon_2','stick');
  let p=(await status(a)).adventure.market;check('wrong weapon leaves count unchanged',p.progress===0&&p.lastAttempt.reason==='WEAPON_MISMATCH');
  check('repeated identical failures do not flood chat',a.lines.filter(s=>s.startsWith('{')&&s.includes('MC_MARKET_ACTION')&&s.includes('WEAPON_MISMATCH')).length===1);
  await kill(a,'zombie','wrong_target');p=(await status(a)).adventure.market;check('wrong mob explained',p.progress===0&&p.lastAttempt.reason==='TARGET_MISMATCH');
  await kill(a,'spider','magic','stone_sword',true);p=(await status(a)).adventure.market;check('magic with a held sword does not fake melee proof',p.progress===0&&p.lastAttempt.reason==='MELEE_EVIDENCE_MISSING');
  for(let n=0;n<4;n++)await kill(a,'spider','valid_'+n);
  p=(await status(a)).adventure.market;out.samples.completed=p;
  check('four regular spiders satisfy OR target',p.progress===4&&p.remaining===0&&p.guidance.ready&&p.guidance.nextCommand==='/mycli guild claim');
  check('final real action sends immediate count receipt',a.lines.some(s=>s.startsWith('{')&&s.includes('MC_MARKET_ACTION')&&JSON.parse(s).progress===4));
  check('success does not auto claim',(await status(a)).adventure.activeId==='tm_spider_patrol');
  check('unrelated Agent receives no private action result',!guest.lines.slice(outside).some(s=>/MC_MARKET_ACTION|【委托未计数】|【委托进度】/.test(s)));
  check('actually attached Eye sees Chinese corrective message',eye.lines.slice(eyeFrom).some(s=>s.includes('【委托未计数】'))&&!eye.lines.slice(eyeFrom).some(s=>s.startsWith('{')&&s.includes('MC_MARKET_ACTION')));
  await rc('save-all flush');const before=own(a);fs.writeFileSync(root+'/before-restart.json',JSON.stringify({definition:before.active.market.definition,completed:before.completed??0,fame:before.fame??0}));
  const h=await text(human,'guild join');await text(human,'guild accept tm_spider_patrol');const from=human.lines.length;await text(human,'tasks status');
  check('human status renders one guidance block',human.lines.slice(from).filter(s=>s.startsWith('【当前阶段】')).length===1);
  check('human receives no raw action JSON',!human.lines.slice(from).some(s=>s.startsWith('MC_TASKS ')||s.startsWith('{')));
  let current=await observation(city.username);out.samples.city=current;
  check('real frozen ancient city task retained',current.currentContract.id===setup.city.active.id&&current.currentContract.progress===setup.city.active.progress);
  check('city reference is real registered type with no invented entrance',current.currentContract.guidance.landmark.structureKey==='minecraft:ancient_city'&&current.currentContract.guidance.landmark.x===5469&&current.currentContract.guidance.landmark.z===630&&current.currentContract.guidance.landmark.entranceVerified===false);
  await rc('minecraft:fill 2199 -52 2199 2203 -52 2203 minecraft:stone');await rc('minecraft:fill 2199 -51 2199 2203 -48 2203 minecraft:air');await rc('minecraft:tp ag_City18 2201.5 -51 2201.5');await sleep(750);
  current=await observation(city.username);check('matching underground depth does not prove ancient city arrival',current.currentContract.guidance.targetMatch===false&&current.currentContract.progress===0&&current.currentContract.guidance.phase==='find_target');
  const info=await cli(a,'tasks info tm_woodland_mansion_survey --json',p=>p.type==='info');out.samples.unknown=info;
  check('unknown landmark offers an honest discovery path',info.steps[0].guidance.reason==='TARGET_LOCATION_UNKNOWN'&&info.steps[0].guidance.nextAction.includes('制图师')&&!info.steps[0].guidance.landmark);
  const catalog=stage+'/plugins/AgentFriend/exploration-landmarks.json',good=fs.readFileSync(catalog);fs.writeFileSync(catalog,'{broken');
  try{check('bad catalog refuses reload',(await rc('mycli admin market reload')).includes('配置校验失败'));check('previous verified hint survives bad reload',(await observation(city.username)).currentContract.guidance.landmark.x===5469);}
  finally{fs.writeFileSync(catalog,good);assert((await rc('mycli admin market reload')).includes('已热加载'));}
  await rc('save-all flush');const cityBefore=JSON.stringify(saved()['guild-players'][setup.city.uuid].active);
  for(let n=0;n<3;n++)await status(city);
  await rc('save-all flush');check('queries retain exact frozen task and evidence',JSON.stringify(saved()['guild-players'][setup.city.uuid].active)===cityBefore);
  const crafter=await connect('ag_Craft18');await rc('minecraft:tp ag_Craft18 2201.5 100 2202.5');await accept(crafter,'tm_shared_tools');
  await rc('minecraft:give ag_Craft18 minecraft:cobblestone 16');await rc('minecraft:give ag_Craft18 minecraft:stick 16');await rc('minecraft:give ag_Craft18 minecraft:coal 4');await sleep(350);
  await craft(crafter,'torch');let c=(await status(crafter)).adventure.market;check('wrong native recipe reports target mismatch',c.progress===0&&c.lastAttempt.reason==='WRONG_ITEM_OR_SITE');
  await craft(crafter,'stone_pickaxe');c=(await status(crafter)).adventure.market;check('right native recipe records and offers claim',c.progress===1&&c.guidance.ready);
  await text(crafter,'guild claim');c=(await status(crafter)).adventure.market;check('new stage excludes old attempt',c.stage===2&&!c.lastAttempt);
  const legacy=await observation(guest.username);check('empty account does not inherit someone else contract',legacy.currentContract.available===false);
 }
}catch(e){out.error=e.stack;process.exitCode=1;}
finally{
 if(out.error)out.diagnostics=bots.map(b=>({name:b.username,lastLines:b.lines.slice(-20),lastPackets:b.packets.slice(-5)}));
 closing=true;for(const bot of bots)bot.quit('isolated task progress checks complete');await sleep(400);
 try{await rc('minecraft:forceload remove 2192 2192 2223 2223');await rc('stop');}catch(e){out.stopError=e.message;process.exitCode=1;}
 fs.writeFileSync(reportFile,JSON.stringify(out,null,2),{flag:'wx'});console.log(JSON.stringify({passed:out.checks.filter(c=>c.pass).length,failed:out.checks.filter(c=>!c.pass),error:out.error,report:reportFile}));
}
