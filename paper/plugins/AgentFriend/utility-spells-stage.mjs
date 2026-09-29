// Isolated Paper 1.20.6 smoke using unprivileged Mineflayer player connections.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = (cmd) => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', cmd], { encoding:'utf8' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const health = (tag) => {
  const text = rcon(`minecraft:data get entity @e[tag=${tag},limit=1] Health`);
  const match = text.match(/entity data: (\d+(?:\.\d+)?)f/);
  return match ? Number(match[1]) : 0; // An absent entity has died or despawned.
};
const login = async (prefix) => {
  const username = `${prefix}${String(Date.now()).slice(-8)}`;
  const bot = mineflayer.createBot({host:'127.0.0.1',port:25566,
    username,auth:'offline',version:'1.20.6'});
  const log = {chats:[],bars:[],abilities:[],states:[],errors:[]};
  bot.on('messagestr', (line) => log.chats.push(line));
  bot.on('error', (error) => log.errors.push(error.message));
  bot.on('kicked', (reason) => log.errors.push(JSON.stringify(reason)));
  bot._client.on('packet', (packet, meta) => {
    if (meta.name === 'boss_bar') log.bars.push(packet);
    if (meta.name === 'abilities') log.abilities.push(packet);
    if (meta.name === 'custom_payload' && packet.channel === 'mcviewer:state')
      log.states.push(JSON.parse(Buffer.from(packet.data).toString('utf8')));
  });
  await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject)});
  bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcviewer:state')});
  rcon(`minecraft:tp ${username} 317.5 119 17.5 180 0`);
  await sleep(2300); // Starter focus is issued two seconds after join.
  return {bot,log};
};
const sessions=[];
try {
  const mover=await login('MoveQA'); sessions.push(mover);
  const {bot,log}=mover;
  assert.ok(bot.inventory.items().some((item)=>item.name==='blaze_rod'), 'Starter focus missing');
  bot.chat('/mycli help');
  bot.chat('/mycli spells');
  bot.chat('/mycli focus list');
  await sleep(600);
  assert.ok(log.chats.some((line)=>line.includes('千灯纪技能接口 /mycli')), 'Agent help has old world name');
  assert.ok(log.chats.some((line)=>line.includes('focus give|list|bind')), 'Agent help omits focus list');
  assert.ok(log.chats.some((line)=>line.includes('探索咏唱') && line.includes('leap')
    && line.includes('flight') && line.includes('golem') && line.includes('sense')),
    'Spell catalog omits utility spell IDs');
  assert.ok(log.chats.some((line)=>line.includes('prospect') && line.includes('leap')),
    'Text-only focus catalog omits utility spell IDs');
  bot.chat('/mycli focus bind leap');
  await sleep(300);
  await bot.equip(bot.inventory.items().find((item)=>item.name==='blaze_rod'),'hand');
  const groundY=bot.entity.position.y;
  bot.activateItem();
  await sleep(700);
  const leapRise=bot.entity.position.y-groundY;
  assert.ok(leapRise > 2,
    `One-use leap should move the player up: ${groundY} -> ${bot.entity.position.y}`);
  assert.ok(log.chats.some((line)=>line.includes('跃空术：高高跳起')),
    'Focus must cast bound leap');
  assert.ok(log.states.some((state)=>state.abilities?.some((entry)=>
    entry.id==='mycli:leap' && entry.cooldownMs>0)), 'Leap cooldown missing from viewer state');
  bot.chat('/mycli cast flight');
  await sleep(600);
  assert.ok(log.chats.some((line)=>line.includes('飞行术持续 15 秒')),
    `Flight cast failed: ${JSON.stringify(log.chats.slice(-5))}`);
  assert.ok(log.abilities.length>0, 'Flight must send client ability packets');
  assert.ok(log.abilities.some((packet)=>(packet.flags&6)===6),
    'Active flight must grant flying and allowed-flight flags');
  assert.ok(log.states.some((state)=>state.abilities?.some((entry)=>
    entry.id==='mycli:flight' && entry.cooldownMs>0)), 'Flight cooldown missing from viewer state');
  await sleep(15_500);
  assert.equal(log.abilities.at(-1)?.flags&6,0,
    'Flight expiry must revoke flying and allowed-flight flags');
  const sensed=await login('GuardQA'); sessions.push(sensed);
  const fighter=sensed.bot, fighterLog=sensed.log;
  rcon('minecraft:summon minecraft:husk 319.5 119 18.5 {Tags:["afu_qa_husk"],NoAI:1b}');
  rcon('minecraft:summon minecraft:sheep 316.5 119 18.5 {Tags:["afu_qa_guard_sheep"],NoAI:1b}');
  await sleep(450);
  const beforeHusk=health('afu_qa_husk');
  fighter.chat('/mycli cast sense');
  await sleep(650);
  assert.ok(fighterLog.chats.some((line)=>line.includes('探敌术发现附近')),
    `Sense should detect nearby hostile: ${JSON.stringify(fighterLog.chats.slice(-5))}`);
  assert.ok(fighterLog.bars.some((bar)=>JSON.stringify(bar).includes('探敌')),
    'Sense should show vanilla bossbar direction');
  fighter.chat('/mycli cast golem');
  await sleep(4000);
  assert.ok(fighterLog.chats.some((line)=>line.includes('守护傀儡会帮你攻击')),
    `Golem cast failed: ${JSON.stringify(fighterLog.chats.slice(-5))}`);
  const afterHusk=health('afu_qa_husk');
  assert.ok(afterHusk<beforeHusk, `Guardian must hurt hostile: ${beforeHusk} -> ${afterHusk}`);
  assert.equal(health('afu_qa_guard_sheep'),8,'Guardian must not hurt a nearby sheep');
  assert.ok(fighterLog.states.some((state)=>state.abilities?.some((entry)=>
    entry.id==='mycli:golem' && entry.cooldownMs>0)), 'Golem cooldown missing from viewer state');
  assert.ok(sessions.every((session)=>session.log.errors.length===0),
    `Client errors: ${JSON.stringify(sessions.map((session)=>session.log.errors))}`);
  console.log(JSON.stringify({verdict:'PASS',leapRise,
    abilityPackets:log.abilities.length,guardianDamage:beforeHusk-afterHusk,
    flightPackets:log.abilities.slice(-4),friendlySheepHealth:health('afu_qa_guard_sheep'),
    senseBars:fighterLog.bars.length}));
} finally {
  for(const session of sessions) session.bot.quit();
  try { rcon('minecraft:kill @e[tag=afu_qa_husk]'); } catch { }
  try { rcon('minecraft:kill @e[tag=afu_qa_guard_sheep]'); } catch { }
}
