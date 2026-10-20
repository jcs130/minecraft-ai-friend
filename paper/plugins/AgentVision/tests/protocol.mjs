import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from 'file:///E:/MC/ops/rcon-client.mjs';
import {installRecipePacketBypass} from 'file:///E:/MC/ops/mineflayer-client-compat.mjs';
import {fix1206PotionProtocol} from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';

const [stage, output] = process.argv.slice(2);
assert(stage && output, 'Pass isolated stage root and evidence output file');
const properties = stage + '/server.properties';
const text = fs.readFileSync(properties, 'utf8');
assert(/^server-ip=127\.0\.0\.1$/m.test(text), 'Run only against an explicit localhost test server');
const port = Number(text.match(/^server-port=(\d+)/m)[1]);
const rcon = Number(text.match(/^rcon.port=(\d+)/m)[1]);
assert(port !== 25565 && rcon !== 25575, 'Production ports forbidden');
const rc = q => command(q, 20000, {properties, port:rcon});
const req = createRequire('E:/MC/research/mineflayer-client-fixes-20261011/package.json');
fix1206PotionProtocol(req);
const mineflayer = req('mineflayer');
const version=process.argv[4]??'1.21.1';
const bots = [];
const checks = [];
const result = {checks, passed:false, scope:'real protocol clients, not autonomous model load'};
const check = (label, condition) => {assert(condition, label); checks.push(label); console.log('PASS '+label);};
async function until(fn, label, ms=10000) {
  const end=Date.now()+ms;
  while(Date.now()<end) {if(await fn()) return; await sleep(100);}
  throw new Error('Timeout '+label);
}
async function connect(username) {
  const bot = mineflayer.createBot({host:'127.0.0.1',port,username,version,auth:'offline',
    defaultChatPatterns:false,hideErrors:true,checkTimeoutInterval:60000});
  bots.push(bot); bot.physicsEnabled=false;
  bot.notes=[];bot.seen=new Set();bot.failures=[];
  bot.on('entitySpawn',e=>{if(e.uuid)bot.seen.add(e.uuid.toLowerCase());});
  bot.on('messagestr',s=>bot.notes.push(s));
  bot.on('error',e=>bot.failures.push(String(e.message)));
  bot.on('kicked',s=>bot.failures.push('kicked '+JSON.stringify(s)));
  await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);});
  await sleep(1000);
  return bot;
}
const entity = (bot,uuid) => Object.values(bot.entities).find(e=>e.uuid?.toLowerCase()===uuid.toLowerCase());
async function wall(block,minY=81) {
  const reply=await rc(`minecraft:fill 104 ${minY} 94 104 86 106 ${block}`);
  assert(/filled|No blocks were filled/i.test(reply), 'wall fixture failed: '+reply);
}
async function summon(type, at='108.5 81 100.5', suffix='') {
  const uuid=randomUUID();
  const b=Buffer.from(uuid.replaceAll('-',''),'hex');
  const ints=[0,4,8,12].map(i=>b.readInt32BE(i));
  await rc(`minecraft:summon minecraft:${type} ${at} {UUID:[I;${ints.join(',')}],NoAI:1b,NoGravity:1b,Invulnerable:1b,PersistenceRequired:1b,Tags:["vision_qa"]${suffix}}`);
  return uuid;
}
async function notesAfter(bot,commandText,marker) {
  const at=bot.notes.length;
  bot.chat(commandText);
  await until(()=>bot.notes.slice(at).some(s=>s.includes(marker)),commandText);
  return bot.notes.slice(at);
}
try {
  check('plugin enabled', (await rc('agentvision status')).includes('"enabled":true'));
  await rc('minecraft:gamerule doMobSpawning false');
  await rc('minecraft:gamerule doDaylightCycle false');
  await rc('minecraft:gamerule sendCommandFeedback false');
  await rc('minecraft:time set midnight');
  await rc('minecraft:forceload add 94 94 116 108');
  await sleep(500);
  await rc('minecraft:kill @e[tag=vision_qa]');
  await rc('minecraft:fill 94 80 94 116 80 108 minecraft:stone');
  await wall('minecraft:stone');
  const agent=await connect('ag_Vision00');
  const human=await connect('VisionAdmin');
  const eye=await connect('ag_Vision_eye');
  const registered=await connect('fulumu');
  for(const bot of [agent,human,eye,registered]) await rc(`minecraft:tp ${bot.username} 100.5 81 100.5`);
  await rc('minecraft:gamemode spectator ag_Vision_eye');
  await sleep(800);
  const pig=await summon('pig');
  await until(()=>entity(human,pig)&&entity(eye,pig),'unfiltered human/eye entities');
  await sleep(800);
  check('initial opaque-wall pig never spawned for Agent', !agent.seen.has(pig)&&!entity(agent,pig));
  check('registered Agent without ag prefix also filtered',!entity(registered,pig));
  check('human retains vanilla entity tracking',!!entity(human,pig));
  check('spectator Eye retains vanilla entity tracking',!!entity(eye,pig));
  for(const block of ['glass','red_stained_glass','tinted_glass','glass_pane','oak_fence','iron_bars']) {
    await wall('minecraft:'+block);
    await until(()=>entity(agent,pig),'transparent '+block);
    check('Agent sees through '+block,!!entity(agent,pig));
  }
  await until(()=>entity(registered,pig),'registered Agent sees transparent barrier');
  check('registered Agent uses the same transparent rule',!!entity(registered,pig));
  await wall('minecraft:stone');
  await until(()=>!entity(agent,pig),'hide after opaque wall closes');
  check('Agent loses target after wall closes',!entity(agent,pig));
  await wall('minecraft:glass');
  await wall('minecraft:stone',82);
  await until(()=>entity(agent,pig),'partly exposed legs');
  check('Agent sees partly exposed body',!!entity(agent,pig));
  await wall('minecraft:stone');
  await until(()=>!entity(agent,pig),'full cover again');
  await rc('minecraft:tp ag_Vision00 106.5 81 100.5');
  await until(()=>entity(agent,pig),'observer moved around wall');
  check('observer movement reveals target',!!entity(agent,pig));
  await rc('minecraft:tp ag_Vision00 100.5 81 100.5');
  await until(()=>!entity(agent,pig),'observer moved behind wall');
  const source=await connect('VisionSource');
  await rc('minecraft:tp VisionSource 108.5 81 102.5');
  await sleep(1500);
  check('hidden player world entity absent', !entity(agent,source.player.uuid));
  check('hidden player remains in tab/online list',!!agent.players.VisionSource);
  const from=agent.notes.length;
  source.chat('/minecraft:msg ag_Vision00 私聊身份保持测试');
  await until(()=>agent.notes.slice(from).some(s=>s.includes('私聊身份保持测试')),'private message');
  check('vanilla whisper still reaches hidden player recipient',agent.notes.slice(from).some(s=>s.includes('私聊身份保持测试')));
  source.quit();
  await until(()=>!agent.players.VisionSource,'hidden player logout');
  check('hidden player logout removes tab entry',!agent.players.VisionSource);
  await wall('minecraft:glass');
  await until(()=>entity(agent,pig),'reopen');
  const invisible=await summon('pig','108.5 81 99.5',',active_effects:[{id:"minecraft:invisibility",duration:2000,show_particles:0b}]');
  await sleep(1000);
  check('invisibility remains filtered',!entity(agent,invisible));
  await wall('minecraft:stone');
  const zombie=await summon('zombie');
  await sleep(1200);
  check('hidden zombie absent before skill',!entity(agent,zombie));
  await rc('minecraft:gamemode survival ag_Vision00');
  const skillStart=agent.notes.length;
  agent.chat('/mycli skills learn sense'); await sleep(800);
  await rc('skills mana add ag_Vision00 100');
  agent.chat('/mycli cast sense');
  await until(()=>agent.notes.slice(skillStart).some(s=>s.includes('MC_HOSTILE')),'paid sense receipt',15000);
  await until(()=>entity(agent,zombie),'paid sense outline entity');
  check('paid sense reveals only the detected enemy',!!entity(agent,zombie)&&!entity(agent,pig));
  await until(()=>!entity(agent,zombie),'sense expiration',12000);
  check('paid sense expiration restores ordinary occlusion',!entity(agent,zombie));
  const stats=await rc('agentvision status');result.stats=JSON.parse(stats.slice(stats.indexOf('{'),stats.lastIndexOf('}')+1));
  check('native blocker reuse exercised',result.stats.shapeSkips>0);
  check('no protocol client error',bots.every(b=>b.failures.length===0));
  result.passed=true;
} catch(error) {
  result.error=String(error.stack??error);
  result.clientNotes=bots.map(b=>({name:b.username,notes:b.notes.slice(-16),failures:b.failures}));
  throw error;
} finally {
  bots.forEach(b=>b.quit());
  await sleep(500);
  fs.writeFileSync(output,JSON.stringify(result,null,2));
}
