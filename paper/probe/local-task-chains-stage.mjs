// Real movement/crafting against an explicitly owned loopback fixture only.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from '../ops/rcon-client.mjs';import {installRecipePacketBypass} from '../ops/mineflayer-client-compat.mjs';
assert(process.env.MC_LOCAL_CHAINS_QA_ROOT,'Set a private fixture report directory');
const root=path.resolve(process.env.MC_LOCAL_CHAINS_QA_ROOT).replaceAll('\\','/'),setup=JSON.parse(fs.readFileSync(root+'/setup.json'));
const stage=setup.stage,mode=process.argv[2]??'initial';assert(['initial','resume','repark'].includes(mode));
assert.equal(path.dirname(stage),'E:/MC/staging');assert.equal(fs.readFileSync(stage+'/.local-task-chain-stage','utf8').trim(),'local-task-chains-20261018');
const props=fs.readFileSync(stage+'/server.properties','utf8');for(const line of ['server-ip=127.0.0.1','server-port=25930','rcon.port=25931','motd=TASK_PROGRESS_ISOLATED_20261018'])assert(props.split(/\r?\n/).includes(line));
const sha=crypto.createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.47.6.jar')).digest('hex');assert.equal(sha,setup.sha256);
const req=createRequire('E:/MC/probe/package.json'),mf=req('mineflayer'),{Vec3}=req('vec3'),yaml=createRequire('E:/MC/ops/yaml-check/package.json')('js-yaml');
const rc=q=>command(q,15000,{port:25931,properties:stage+'/server.properties'}),bots=[],out={at:new Date().toISOString(),mode,jarSha256:sha,checks:[],samples:{},productionChanged:false};let closing=false;
const check=(label,pass)=>{out.checks.push({label,pass:!!pass});assert(pass,label);console.log('PASS '+label);};
async function until(fn,label,ms=20000){for(const end=Date.now()+ms;Date.now()<end;){const v=await fn();if(v)return v;await sleep(100);}throw Error('Timeout '+label);}
async function connect(username){const bot=mf.createBot({host:'127.0.0.1',port:25930,version:'1.21.1',auth:'offline',username,hideErrors:true,defaultChatPatterns:false,checkTimeoutInterval:60000});bots.push(bot);installRecipePacketBypass(bot._client);bot.lines=[];bot.packets=[];
 bot.on('messagestr',s=>{s=s.replace(/§[0-9a-fk-or]/gi,'');bot.lines.push(s);try{if(s.startsWith('MC_TASKS '))bot.packets.push(JSON.parse(s.slice(9)));}catch{}});
 bot._client.on('custom_payload',p=>{if(p.channel==='mcagent:tasks')try{bot.packets.push(JSON.parse(p.data.toString()));}catch{}});
 bot.on('error',e=>{if(!closing){out.errors??=[];out.errors.push(username+': '+e.message);}});await until(()=>bot.entity&&bot.player&&bot.entity.position,'spawn '+username,45000);
 bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:tasks\0mcagent:market')});return bot;}
async function send(bot,line){await sleep(Math.max(0,1150-(Date.now()-(bot.sent??0))));bot.sent=Date.now();bot.chat('/mycli '+line);}
async function cli(bot,line,type='status'){const from=bot.packets.length;await send(bot,line);return until(()=>bot.packets.slice(from).find(x=>x.type===type),line);}
const status=bot=>cli(bot,'tasks status --json');
async function text(bot,line){const from=bot.lines.length;await send(bot,line);await sleep(650);return bot.lines.slice(from).join('\n');}
const saved=()=>yaml.load(fs.readFileSync(stage+'/plugins/AgentFriend/config.yml','utf8'));
const own=bot=>saved()['guild-players'][bot.player.uuid];
function pausedCheckpoint(bot){
 // save-all flush persists the world, not the plugin's in-memory survey cache.
 // The atomic pause is the authoritative durable snapshot of that live cache.
 const record=own(bot),snapshot=yaml.load(record['paused-exploration'].snapshot);assert(snapshot.market.exploration,'durable native survey');
 fs.writeFileSync(root+'/before-restart.json',JSON.stringify({id:snapshot.id,stage:snapshot.market.step+1,progress:snapshot.progress,definition:snapshot.market.definition,run:snapshot.market.run,exploration:snapshot.market.exploration,completed:record.completed??0}));
}
async function warp(bot,x,y,z){bot.clearControlStates();await rc(`minecraft:tp ${bot.username} ${x} ${y} ${z}`);await until(()=>Math.hypot(bot.entity.position.x-x,bot.entity.position.z-z)<.5&&Math.abs(bot.entity.position.y-y)<1.2,'position sync');await sleep(1100);}
async function walk(bot,x,z,{slow=true,timeout=60000}={}){
 const start=Date.now(),trace=[];bot.setControlState('sneak',slow);
 try{while(Math.hypot(bot.entity.position.x-x,bot.entity.position.z-z)>.4){if(Date.now()-start>timeout)throw Error('Movement stalled '+JSON.stringify({target:[x,z],position:bot.entity.position}));
  const at=bot.entity.position;trace.push([Date.now(),at.x,at.y,at.z]);
  for(const b of bot.findBlocks({matching:b=>b.name.endsWith('_fence_gate')&&b.getProperties().open===false,maxDistance:3,count:3})){await bot.activateBlock(bot.blockAt(b));await sleep(150);}
  await bot.lookAt(new Vec3(x,at.y+1.3,z),true);bot.setControlState('forward',true);await sleep(100);
 }}finally{bot.clearControlStates();out.samples.traces??=[];out.samples.traces.push({actor:bot.username,target:[x,z],trace});}await sleep(1600);
}
async function finish(bot,stageNumber){let s=await status(bot);check('stage '+stageNumber+' has authoritative completion',s.adventure.market.stage===stageNumber&&s.adventure.market.guidance.ready);await text(bot,'guild claim');return status(bot);}
async function lineSurvey(bot,name){const points=JSON.parse(fs.readFileSync(root+'/native-paths.json'))[name];assert(points,'safe physical corridor');await warp(bot,...points[0]);for(const p of points.slice(1))await walk(bot,p[0],p[2]);}
async function craftTorches(bot){
 await rc(`minecraft:item replace entity ${bot.username} hotbar.6 with minecraft:coal 1`);await rc(`minecraft:item replace entity ${bot.username} hotbar.7 with minecraft:stick 1`);await sleep(400);
 const packets=[],listen=p=>packets.push(p);bot._client.on('set_slot',listen);
 try{const w=bot.inventory,coal=w.slots.findIndex(v=>v?.name==='coal'),stick=w.slots.findIndex(v=>v?.name==='stick');assert(coal>=0&&stick>=0);
  await bot.clickWindow(coal,0,0);await bot.clickWindow(1,0,0);await bot.clickWindow(stick,0,0);await bot.clickWindow(3,0,0);
  await until(()=>packets.some(p=>p.windowId===0&&p.slot===0&&p.item?.itemId===bot.registry.itemsByName.torch.id),'server crafting result');
  await bot.clickWindow(0,0,1);await sleep(500);check('native crafting leaves empty cursor',!bot.inventory.selectedItem);
 }finally{bot._client.off('set_slot',listen);}
}
try{
 const version=await until(async()=>{try{return await rc('version AgentFriend');}catch{return false;}},'owned fixture startup',60000);
 check('fixed candidate is loaded',version.includes('0.4.47.6'));
 if(mode==='repark'){
  const a=await connect('ag_Pause18');check('restored original survey remains ready',(await status(a)).adventure.market.guidance.ready);
  check('explicit repark commits original native evidence',(await cli(a,'tasks pause --json','pause')).durable===true);pausedCheckpoint(a);
 }else if(mode==='resume'){
  const a=await connect('ag_Pause18'),before=JSON.parse(fs.readFileSync(root+'/before-restart.json'));let s=await status(a);
  check('paused expedition survives normal restart',s.pausedExploration.present&&s.pausedExploration.id===before.id&&s.pausedExploration.progress===before.progress);
  const r=await cli(a,'tasks resume --json','resume');check('resume acknowledges durable success',r.status==='success'&&r.durable===true);
  s=await status(a);check('original stage and ready survey survive resume',s.adventure.market.stage===before.stage&&s.adventure.market.progress===before.progress&&s.adventure.market.guidance.ready);
  await rc('save-all flush');const state=own(a).active;
  check('frozen rules, token and native survey evidence unchanged',state.market.definition===before.definition&&state.market.run===before.run&&JSON.stringify(JSON.parse(state.market.exploration))===JSON.stringify(JSON.parse(before.exploration)));
  check('repeat resume does not restart quest',(await cli(a,'tasks resume --json','resume')).status==='already_active');
  await text(a,'guild claim');s=await status(a);check('resume continues next stage rather than issuing final reward',s.adventure.market.stage===2&&own(a).completed==before.completed);
  const guest=await connect('ag_Outside18'),offer=await cli(guest,'tasks info tm_ancient_city_silence --json','info');
  check('new city offer is high level and discloses the long journey',offer.task.minRank===3&&offer.task.status==='rank_required'&&offer.description.includes('六千'));
  await text(guest,'guild accept tm_ancient_city_silence');check('new low rank player is not assigned a far city',!(await status(guest)).adventure.activeId);
  const city=await connect('ag_City18'),old=own(city).active;
  const oldInfo=await cli(city,'tasks info tm_ancient_city_silence --json','info');check('existing city uses its original lower-rank accepted snapshot',oldInfo.task.minRank===0&&oldInfo.task.status==='in_progress');
  check('existing city can be durably parked',(await cli(city,'tasks pause --json','pause')).durable===true);
  check('old accepted city resumes without imposing the new offer gate',(await cli(city,'tasks resume --json','resume')).durable===true);
  await rc('save-all flush');const restored=own(city).active;check('old city rules and run are not migrated',restored.market.definition===old.market.definition&&restored.market.run===old.market.run&&restored.progress===old.progress);
  const routeFile=stage+'/plugins/AgentFriend/route-contracts.yml',original=fs.readFileSync(routeFile),bad=yaml.load(original.toString());
  bad.tasks.local_village_notes.steps[0].area['min-x']=1000;fs.writeFileSync(routeFile,yaml.dump(bad,{lineWidth:-1,noRefs:true}));
  try{out.samples.invalidReload=await rc('mycli admin market reload');const still=await cli(guest,'tasks info tm_local_village_notes --json','info');
   check('invalid area reload retains last valid whole market',still.steps[0].exploration.area.min[0]===-666);
  }finally{fs.writeFileSync(routeFile,original);await rc('mycli admin market reload');}
  check('configuration failure leaves active phase unchanged',(await status(a)).adventure.market.stage===2);
  out.samples.restoredRouteSha256=crypto.createHash('sha256').update(fs.readFileSync(routeFile)).digest('hex');
 }else{
  const a=await connect('ag_Local18'),pause=await connect('ag_Pause18'),guest=await connect('ag_Outside18'),eye=await connect('ag_Local18_eye'),human=await connect('LocalHuman18');
  await rc('minecraft:gamemode spectator ag_Local18_eye');await rc('minecraft:spectate ag_Local18 ag_Local18_eye');
  const beforeRead=JSON.stringify(saved()['guild-players'][a.player.uuid]??null);
  const info=await cli(a,'tasks info tm_local_mine_journal --json','info');out.samples.mineInfo=info;
  check('five ordered stages and actual local bounds are discoverable',info.steps.length===5&&info.steps[2].exploration.area.name.includes('台阶'));
  check('browsing does not accept or write progress',JSON.stringify(saved()['guild-players'][a.player.uuid]??null)===beforeRead&&!(await status(a)).adventure.activeId);
  const help=await text(a,'tasks --help');check('canonical help exposes pause and resume',help.includes('pause')&&help.includes('resume')&&!help.includes('archive'));
  for(const bot of [a,pause,human])await text(bot,'guild join');
  await text(a,'guild accept tm_local_village_notes');await warp(a,-541.5,67,-435.5);
  let s=await status(a);check('wrong nearby area reports exact corrective route',s.adventure.market.progress===0&&s.adventure.market.guidance.phase==='travel_to_stage_area'&&s.adventure.market.guidance.nextAction.includes('-652'));
  const guestFrom=guest.lines.length,eyeFrom=eye.lines.length;
  await lineSurvey(a,'entrance');s=await status(a);check('real local walking counts rather than teleport arrival',s.adventure.market.progress===2&&s.adventure.market.guidance.ready);out.samples.firstStage=s;
  check('nearby survey feedback is private',!guest.lines.slice(guestFrom).some(x=>x.includes('MC_MARKET_SURVEY')||x.includes('走查证据已齐全')));
  check('actual attached eye receives readable local progress',eye.lines.slice(eyeFrom).some(x=>x.includes('走查')||x.includes('当前阶段')));
  s=await finish(a,1);check('first claim only advances phase and resets current count',s.adventure.market.stage===2&&s.adventure.market.progress===0);
  await lineSurvey(a,'gallery');s=await finish(a,2);check('return has its own bounded stage',s.adventure.market.stage===3&&s.adventure.market.guidance.phase==='travel_to_stage_area');
  await rc('minecraft:setblock -542 89 -436 minecraft:stone');await warp(a,-541.5,90,-435.5);await rc(`minecraft:effect give ${a.username} minecraft:resistance 120 4 true`);s=await status(a);
  check('same XZ high above destination is not return',s.adventure.market.progress===0&&!s.adventure.market.guidance.ready);
  await warp(a,-541.5,67,-435.5);await rc('minecraft:setblock -542 89 -436 minecraft:air');s=await status(a);check('physical return to village is ready',s.adventure.market.guidance.ready);const completed=own(a).completed??0;
  await text(a,'guild claim');s=await status(a);check('full local chain settles once',!s.adventure.activeId&&own(a).completed===completed+1);
  await text(a,'guild claim');check('repeated final claim has no extra reward',own(a).completed===completed+1);
  await text(pause,'guild accept tm_local_village_notes');await lineSurvey(pause,'entrance');
  const pre=await status(pause);await rc('save-all flush');const native=own(pause);out.samples.pausedBefore=native.active;
  fs.writeFileSync(root+'/before-restart.json',JSON.stringify({id:native.active.id,stage:pre.adventure.market.stage,progress:pre.adventure.market.progress,definition:native.active.market.definition,run:native.active.market.run,exploration:native.active.market.exploration,completed:native.completed??0}));
  check('pause preserves completed native survey',(await cli(pause,'tasks pause --json','pause')).durable===true);
  pausedCheckpoint(pause);
  s=await status(pause);check('pause frees slot and is visible in status',!s.adventure.activeId&&s.pausedExploration.present&&s.pausedExploration.progress===2);
  check('repeated pause is idempotent',(await cli(pause,'tasks pause --json','pause')).status==='already_paused');
  const reaccept=await text(pause,'guild accept tm_local_village_notes');check('paused contract cannot be accepted twice',reaccept.includes('暂存')&&!(await status(pause)).adventure.activeId);
  await text(pause,'guild accept tm_starter_tools');const denied=await cli(pause,'tasks resume --json','resume');
  check('resume protects another active contract',denied.status==='denied'&&denied.errorCode==='ACTIVE_SLOT_OCCUPIED'&&(await status(pause)).adventure.activeId==='tm_starter_tools');
  await text(pause,'guild abandon');
  await text(a,'guild accept tm_local_mine_journal');s=await status(a);check('mine starts with actual crafting preparation',s.adventure.market.stage===1&&s.adventure.market.progress===0);
  check('mixed action chain is not silently parked',(await cli(a,'tasks pause --json','pause')).errorCode==='TASK_NOT_PAUSABLE');
  await warp(a,-652.5,68,-483.5);await craftTorches(a);s=await finish(a,1);check('preparation keeps crafted torches for the player',a.inventory.items().some(i=>i.name==='torch'&&i.count>=4));
  await lineSurvey(a,'entrance');s=await finish(a,2);
  // Gate occupies block Z=-484: its centre is -483.5, while -484.5
  // is the adjacent fence post. Follow the actual centre of the doorway.
  await warp(a,-652.5,68,-483.5);await walk(a,-700.5,-483.5,{timeout:70000});s=await status(a);out.samples.stairs=s;
  check('existing staircase is traversable without breaking blocks',a.entity.position.y<40);
  s=await finish(a,3);check('stair survey includes actual vertical exploration',out.samples.stairs.adventure.market.guidance.ready);
  await lineSurvey(a,'platform');s=await finish(a,4);check('underground platform cannot substitute for village return',s.adventure.market.stage===5&&!s.adventure.market.guidance.ready);
  await warp(a,-541.5,67,-435.5);await finish(a,5);check('all five mine phases settle',!(await status(a)).adventure.activeId);
  const hu=await text(human,'guild accept tm_local_village_notes');check('ordinary non-agent player can choose local chain',hu.includes('已接公会委托'));
  const city=await connect('ag_City18'),cityState=await status(city);out.samples.city=cityState;
  check('old frozen ancient city remains accepted with optional guidance',cityState.adventure.activeId==='tm_ancient_city_silence'&&cityState.adventure.market.guidance.optionalExpedition===true);
  const rpg=await text(human,'world story info village_notes --json');check('nearby chain is present in NPC story discovery',rpg.includes('tm_local_village_notes'));
 }
}catch(error){out.failure=error.stack;throw error;}finally{closing=true;out.clientMessages=Object.fromEntries(bots.map(b=>[b.username,b.lines.slice(-12)]));for(const bot of bots){try{bot.clearControlStates();bot.quit('local chain validation complete');}catch{}}await sleep(400);fs.writeFileSync(root+'/'+mode+'-'+Date.now()+'.json',JSON.stringify(out,null,2));console.log(JSON.stringify({mode,passed:out.checks.filter(x=>x.pass).length,failed:out.checks.filter(x=>!x.pass).length,failure:out.failure??null}));}
