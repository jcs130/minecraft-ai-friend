// Explicit loopback fixture only. Uses normal acceptance, real native movement,
// readonly snapshots, and a separately packaged console-only fixture helper.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import crypto from 'node:crypto';import {createRequire} from 'node:module';import {setTimeout as sleep} from 'node:timers/promises';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {installRecipePacketBypass} from 'file:///E:/MC/ops/mineflayer-client-compat.mjs';
assert(process.env.MC_RPG_QA_ROOT,'An explicit private fixture is required');
const root=path.resolve(process.env.MC_RPG_QA_ROOT).replaceAll('\\','/');
const setup=JSON.parse(fs.readFileSync(root+'/setup.json')),stage=setup.stage.replaceAll('\\','/');
assert.equal(path.dirname(stage),'E:/MC/staging');assert.equal(fs.readFileSync(stage+'/.rpg-quest-guidance-stage','utf8').trim(),'rpg-quest-guidance-20261017');
const props=fs.readFileSync(stage+'/server.properties','utf8');
for(const value of ['server-ip=127.0.0.1','server-port=25830','rcon.port=25831','motd=RPG_QUEST_GUIDANCE_ISOLATED_20261017'])assert(props.split(/\r?\n/).includes(value));
const phase=process.env.MC_RPG_QA_PHASE??'first',file=root+'/'+(process.env.MC_RPG_QA_REPORT??('native-'+phase))+'.json';assert(!fs.existsSync(file),'Preserve previous evidence');
const require=createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json'),yaml=createRequire('E:/MC/ops/yaml-check/package.json')('js-yaml'),{Vec3}=require('vec3');
const identities=JSON.parse(fs.readFileSync(root+'/identities.json'));
const report={at:new Date().toISOString(),phase,checks:[],queries:[],boss:{},messages:{},commands:[],productionChanged:false,
  jarSha256:crypto.createHash('sha256').update(fs.readFileSync(stage+'/plugins/AgentFriend-0.4.47.3.jar')).digest('hex')};
const bots=[],packets={};
const rc=async q=>{const value=await command(q,20000,{properties:stage+'/server.properties',port:25831});report.commands.push({q,response:value});return value;};
const check=(name,pass)=>{report.checks.push({name,pass:!!pass});assert(pass,name);console.log('PASS '+name);};
async function until(fn,label,ms=15000){const started=Date.now();while(Date.now()-started<ms){const value=await fn();if(value)return value;await sleep(100);}throw Error('Timed out: '+label);}
async function connect(username){
  const bot=require('mineflayer').createBot({host:'127.0.0.1',port:25830,username,version:'1.21.1',auth:'offline',hideErrors:true,checkTimeoutInterval:60000,
    fakeHost:'127.0.0.1\0'+'127.0.0.1\0'+identities.ids[username].replaceAll('-','')+'\0[]'});
  bots.push(bot);report.messages[username]=[];report.boss[username]=[];packets[username]=[];
  bot.on('messagestr',s=>report.messages[username].push(s));bot.on('error',e=>{report.errors??=[];report.errors.push({username,error:e.message});});
  bot._client.on('packet',(p,meta)=>{if(meta.name.includes('boss'))report.boss[username].push(p);});
  bot._client.on('custom_payload',p=>{if(p.channel.startsWith('mcagent:'))try{packets[username].push({channel:p.channel,data:JSON.parse(p.data.toString('utf8'))});}catch{}});
  installRecipePacketBypass(bot._client,{enabled:true});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('spawn timeout '+username)),30000);bot.once('spawn',()=>{clearTimeout(timer);resolve();});bot.once('kicked',s=>{clearTimeout(timer);reject(Error(String(s)));});});
  bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcagent:tasks\0mcagent:market\0mcagent:exam')});
  check('actual native identity '+username,bot._client.uuid===identities.ids[username]);return bot;
}
async function ask(bot,q,channel){const n=packets[bot.username].length,m=report.messages[bot.username].length;bot.chat(q);await sleep(650);const result={q,packets:packets[bot.username].slice(n),messages:report.messages[bot.username].slice(m)};report.queries.push(result);return channel?result.packets.filter(p=>p.channel===channel).at(-1)?.data:result;}
async function status(){const raw=await rc('rpgqa status');assert(raw.startsWith('QA_RPG '),raw);return JSON.parse(raw.slice(7));}
const cfg=()=>yaml.load(fs.readFileSync(stage+'/plugins/AgentFriend/config.yml','utf8'));
const actorId=identities.ids.ag_RpgQA17;
async function move(bot,x,z){bot.setControlState('sneak',true);await bot.lookAt(new Vec3(x,5.62,z),true);bot.setControlState('forward',true);try{await until(()=>Math.hypot(bot.entity.position.x-x,bot.entity.position.z-z)<.42,'native walking waypoint',15000);}finally{bot.setControlState('forward',false);}await sleep(150);}
try {
  check('exact RPG release version',(await rc('version AgentFriend')).includes('0.4.47.3'));
  await rc('minecraft:gamerule doMobSpawning false');await rc('minecraft:gamerule fallDamage false');await rc('minecraft:difficulty peaceful');
  const bot=await connect('ag_RpgQA17'),guest=await connect('RpgGuest17'),eye=await connect('ag_RpgQA17_eye');
  await rc('rpgqa attach');await sleep(2200);
  if(phase==='first'){
    await rc('minecraft:clear '+bot.username);await rc('rpgqa home');await sleep(700);
    const exam=await ask(bot,'/mycli guild exam start survey_basic');
    check('survey exam starts through normal command',exam.messages.some(s=>s.includes('survey_basic')||s.includes('已开始')));
    const before=await ask(bot,'/mycli guild exam status --json','mcagent:exam');
    check('survey exam no longer tells user to prepare a skill',before?.reason==='awaiting_contract'&&before?.phase==='choose_contract');
    await ask(bot,'/mycli guild exam supplies claim map');
    await until(()=>cfg()['exam-supplies-issued']?.[actorId]&&Object.values(cfg()['exam-supplies-issued'][actorId]).some(s=>JSON.parse(s).map?.structure==='nova_structures:undead_crypt'),'actual map allocation',20000);
    await ask(bot,'/mycli guild exam supplies take map');
    const map=await until(()=>bot.inventory.items().find(i=>i.name==='filled_map'),'native explorer map in inventory');await bot.equip(map,'hand');
    await ask(bot,'/mycli guild accept tm_map_hunt');
    let s=await status();report.initial=s;
    check('normal original-map task accepted',s.id==='tm_map_hunt'&&s.map.mapId>=0);
    const aggregate=await ask(bot,'/mycli tasks status --json','mcagent:tasks');
    check('aggregate status exposes one shared current phase',aggregate?.adventure?.market?.guidance?.phase==='travel_to_marker');
    check('default aggregate status remains compact',JSON.stringify(aggregate).length<=3200);
    check('known issued crypt starts with travel guidance',s.guidance.phase==='travel_to_marker'&&s.targetKind==='structure');
    check('known map marker not a verified entrance',s.guidance.navigation.entranceVerified===false&&!s.guidance.navigation.y);
    check('private native task bar delivered to actor',report.boss[bot.username].some(p=>JSON.stringify(p).includes('任务')));
    await sleep(1300);check('actual attached eye receives native task bar',report.boss[eye.username].some(p=>JSON.stringify(p).includes('任务')));
    check('unrelated visitor receives no task bar',!report.boss[guest.username].some(p=>JSON.stringify(p).includes('任务')));
    await rc('rpgqa surface');await sleep(750);s=await status();report.surface=s;
    check('surface marker yields find entrance not survey or treasure',s.guidance.phase==='find_entrance'&&!s.guidance.targetMatch&&s.guidance.nextAction.includes('地下遗迹'));
    check('near marker does not fabricate exploration credit',s.guidance.completedObjectives===1);
    check('repeated map and aggregate queries do not write or load',(await rc('rpgqa readonly')).includes('QA_RPG_READONLY_OK'));
    const visible=await ask(bot,'/mycli guild verify');
    check('short fallback gives actual next action',visible.messages.some(s=>s.startsWith('{')&&s.includes('"phase":"find_entrance"')&&s.includes('"command":"/mycli tasks status"')));
    check('map denial never advertises engineering',!visible.messages.some(s=>s.includes('/mycli guild engineering')));
    await rc('rpgqa inside');await sleep(650);s=await status();report.inside=s;
    check('natural crypt metadata recognises actual inside location',s.guidance.targetMatch&&s.guidance.phase==='survey');
    check('ruin survey not required to open fresh buried treasure',(await ask(bot,'/mycli guild map','mcagent:market'))?.requirements?.freshNaturalTreasureRequired===false);
    await move(bot,-429.4,674.6);bot.setControlState('sneak',false);await sleep(300);
    s=await status();report.partial=s;check('native walking produces partial real survey progress',s.guidance.missingConditions.some(v=>v.includes('新路线'))&&s.guidance.phase==='survey');
    fs.writeFileSync(root+'/resume-expected.json',JSON.stringify({map:s.map,frozen:cfg()['guild-players'][actorId].active.market.definition,run:cfg()['guild-players'][actorId].active.market.run,fame:cfg()['guild-players'][actorId].fame},null,2));
  }else{
    const expected=JSON.parse(fs.readFileSync(root+'/resume-expected.json'));
    let s=await status();report.resumed=s;
    check('frozen task and bound map survive normal restart',JSON.stringify(s.map)===JSON.stringify(expected.map)&&cfg()['guild-players'][actorId].active.market.definition===expected.frozen&&cfg()['guild-players'][actorId].active.market.run===expected.run);
    check('native task bar returns after restart',report.boss[bot.username].some(p=>JSON.stringify(p).includes('任务')));
    check('queries after cold restart still readonly',(await rc('rpgqa readonly')).includes('QA_RPG_READONLY_OK'));
    // Resume real movement on the fixture's already prepared native structure floor.
    for(const [x,z] of [[-420.6,674.6],[-420.6,679.4],[-429.4,679.4],[-429.4,677],[-420.6,677]]){await move(bot,x,z);s=await status();if(s.guidance.phase==='photograph')break;}
    bot.setControlState('sneak',false);await sleep(500);s=await status();report.surveyed=s;
    check('real walking completes all frozen survey thresholds',s.guidance.phase==='photograph');
    const checked=await ask(bot,'/mycli guild verify');
    check('missing photo blocks handover with camera command',checked.packets.some(p=>p.channel==='mcagent:market'&&p.data.reason==='exploration_photo_required'&&p.data.guidance?.phase==='photograph'&&p.data.nextCommands?.[0]==='/mycli photo menu'));
    const ex=await ask(bot,'/mycli guild exam status --json','mcagent:exam');
    check('exam, task journal and status share photo phase',ex?.phase==='photograph'&&ex?.guide?.current?.phase==='photograph'&&ex.nextCommand==='/mycli photo menu');
    check('frozen contract preserved when photo is missing',cfg()['guild-players'][actorId].active.market.definition===expected.frozen);
    await rc('rpgqa detach');await sleep(1300);
    check('detached eye receives boss removal',report.boss[eye.username].some(p=>p.action===1));
    const privateStart=report.messages[guest.username].length;await ask(bot,'/mycli tasks status --json');
    check('private task text not broadcast',!report.messages[guest.username].slice(privateStart).some(s=>s.includes('MC_')||s.includes('图上的远行')||s.includes('工程验收')));
    // This fixture has no camera worker. Check its missing-photo gate above,
    // then explicitly cancel only the fixture exam to verify the ordinary map route.
    await ask(bot,'/mycli guild exam cancel');await sleep(500);s=await status();
    check('ordinary contract gains no new photo prerequisite',s.guidance.phase==='return_to_acceptance_point');
    await rc('rpgqa home');await sleep(750);s=await status();report.ready=s;
    check('real return reaches explicit handover stage',s.guidance.phase==='ready_to_submit'&&s.guidance.ready&&s.guidance.nextCommand==='/mycli guild claim');
    await ask(bot,'/mycli guild claim');await sleep(600);
    const after=cfg()['guild-players'][actorId];check('normal handover completes contract exactly once',!after.active&&after.fame===expected.fame+12);
    const stash=JSON.stringify(cfg()['dungeon-rewards']?.[actorId]??{});await ask(bot,'/mycli guild claim');
    check('repeated handover does not duplicate rewards',cfg()['guild-players'][actorId].fame===after.fame&&JSON.stringify(cfg()['dungeon-rewards']?.[actorId]??{})===stash);
    await sleep(1300);check('task bar removed after completion',report.boss[bot.username].some(p=>p.action===1));
    const human=await connect('RpgHuman17');await sleep(650);
    await ask(human,'/mycli guild exam start survey_basic');await ask(human,'/mycli guild exam supplies claim map');
    await until(()=>cfg()['exam-supplies-issued']?.[identities.ids.RpgHuman17]&&Object.values(cfg()['exam-supplies-issued'][identities.ids.RpgHuman17]).some(v=>JSON.parse(v).map),'human original-map allocation',20000);
    await ask(human,'/mycli guild exam supplies take map');
    const humanMap=await until(()=>human.inventory.items().find(i=>i.name==='filled_map'),'human map');await human.equip(humanMap,'hand');await ask(human,'/mycli guild accept tm_map_hunt');
    const h=await ask(human,'/mycli tasks status');
    check('ordinary Java player receives Chinese journal with current marker',h.messages.some(s=>s.includes('【当前阶段】'))&&h.messages.some(s=>s.includes('➤')));
    await ask(human,'/mycli guild exam');await until(()=>human.currentWindow,'human examination menu');
    check('ordinary native examination menu remains usable',human.currentWindow.slots[38]?.name==='clock');
    await human.clickWindow(38,0,0);await until(()=>human.currentWindow&&JSON.stringify(human.currentWindow.title).includes('考试指引'),'RPG checklist menu');
    const objectives=human.currentWindow.slots.slice(0,6);
    check('native checklist shows current and later objectives',objectives.some(i=>i?.name==='yellow_dye')&&objectives.some(i=>i?.name==='gray_dye'));
    check('native menu contains an actionable current step',human.currentWindow.slots[13]?.name==='spyglass');
    human.closeWindow(human.currentWindow);
    check('unrelated visitor still receives no private task bar',!report.boss[guest.username].some(p=>JSON.stringify(p).includes('任务')));
  }
}catch(error){report.error=error.stack;console.error(error.stack);process.exitCode=1;}
finally{for(const bot of bots){bot.clearControlStates();bot.quit('isolated RPG verification complete');}fs.writeFileSync(file,JSON.stringify(report,null,2),{flag:'wx'});await sleep(300);await rc('stop');}
