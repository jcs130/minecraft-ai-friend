// Run against the isolated life-buildings-20261003 stage server on 25567.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = (command, silent = false) => {
  try { return execFileSync('node',
    ['E:/MC/staging/life-buildings-20261003/rcon-stage.mjs', command], {encoding:'utf8'}); }
  catch (error) {
    if (silent && String(error.stdout).includes('RCON TIMEOUT')) return '';
    throw error;
  }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sessions = [];
const pairFile = 'E:/MC/staging/life-buildings-20261003/agent-eye-pairs.json';
const originalPairs = readFileSync(pairFile, 'utf8');
const token = String(Date.now()).slice(-8);
const agentName = `SenseA${token}`;
const eyeName = `SenseE${token}`;
const otherName = `SenseO${token}`;
const login = async (username) => {
  const bot = mineflayer.createBot({host:'127.0.0.1',port:25567,username,
    auth:'offline',version:'1.20.6'});
  const log = {chat:[],metadata:[],particles:[],errors:[]};
  bot.on('messagestr', (line) => log.chat.push(line));
  bot.on('error', (error) => log.errors.push(error.message));
  bot.on('kicked', (reason) => log.errors.push(String(reason)));
  bot._client.on('packet', (packet, meta) => {
    if (meta.name === 'entity_metadata') log.metadata.push(packet);
    if (meta.name === 'world_particles') log.particles.push(packet);
  });
  await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject)});
  sessions.push({bot,log});
  return {bot,log};
};
const flags = (packet, entityId) => {
  if (packet.entityId !== entityId) return null;
  const value = packet.metadata?.find((entry) => entry.key === 0)?.value;
  return typeof value === 'number' ? value : null;
};

try {
  const pairs = JSON.parse(originalPairs);
  pairs.pairs.push({agent:agentName, eye:eyeName});
  writeFileSync(pairFile, JSON.stringify(pairs), 'utf8');
  await sleep(6500); // Both plugins hot-load the new test pairing.
  rcon('minecraft:forceload add 315 15 320 20');
  rcon('minecraft:fill 315 118 15 320 118 20 minecraft:stone', true);
  const caster = await login(agentName);
  const eye = await login(eyeName);
  const stranger = await login(otherName);
  for (const name of [agentName,eyeName,otherName])
    rcon(`minecraft:tp ${name} 317.5 119 17.5`, true);
  rcon(`minecraft:gamemode spectator ${eyeName}`, true);
  rcon(`minecraft:spectate ${agentName} ${eyeName}`, true);
  await sleep(700);
  const spawned = rcon('minecraft:summon minecraft:husk 319.5 119 18.5 {Tags:["afu_sense_husk"],NoAI:1b,NoGravity:1b,Invulnerable:1b,PersistenceRequired:1b}', true);
  rcon(`minecraft:execute at ${agentName} run summon minecraft:sheep ~-2 ~ ~1 {Tags:["afu_sense_sheep"],NoAI:1b,NoGravity:1b}`, true);
  const queried = rcon('minecraft:data get entity @e[tag=afu_sense_husk,limit=1] Tags');
  await sleep(5200); // Let the Eye mirror reconcile its hot-loaded pairing.
  const mob = Object.values(caster.bot.entities).find((entity)=>entity.name==='husk'
    && entity.position.y > 118);
  const sheep = Object.values(caster.bot.entities).find((entity)=>entity.name==='sheep'
    && entity.position.y > 118);
  assert.ok(mob, `caster must track the hostile entity: ${JSON.stringify({spawned,queried,position:caster.bot.entity.position,
    entities:Object.values(caster.bot.entities).filter((entity)=>entity.name==='husk'
      || entity.name==='sheep').map((entity)=>({name:entity.name,id:entity.id,position:entity.position}))})}`);
  assert.ok(sheep, 'caster must track the friendly entity');
  assert.ok(caster.bot.entity.position.y > 118, 'caster must stand on the isolated test platform');
  assert.ok(mob.position.y > 118, 'hostile must be on the isolated test platform');
  const eyeParticlesBefore = eye.log.particles.length;
  caster.bot.chat('/mycli cast sense');
  await sleep(1300);
  const lit = (log,id) => log.metadata.some((packet)=>(flags(packet,id) ?? 0)&0x40);
  assert.ok(caster.log.chat.some((line)=>line.includes('探敌术发现附近')),
    `sense cast failed: ${JSON.stringify(caster.log.chat.slice(-8))}`);
  assert.ok(caster.log.chat.some((line)=>line.includes('MC_HOSTILE type=husk')
    && line.includes('y=119')), 'agent coordinate receipt must point to the staged hostile');
  assert.ok(lit(caster.log,mob.id), 'caster did not receive hostile outline metadata');
  assert.ok(lit(eye.log,mob.id), 'attached registered Eye did not receive hostile outline');
  assert.ok(eye.log.particles.length > eyeParticlesBefore,
    'attached Eye did not receive the sense particle presentation');
  assert.ok(!lit(stranger.log,mob.id), 'unrelated player received private outline');
  assert.ok(!lit(caster.log,sheep.id), 'friendly sheep was outlined');
  assert.match(rcon('minecraft:data get entity @e[tag=afu_sense_husk,limit=1] Glowing'),
    /(?:0b|Found no elements matching Glowing)/,
    'sense must not change the global Glowing flag');
  await sleep(8500);
  const restored = (log,id) => log.metadata.some((packet)=>{
    const value=flags(packet,id);return value!==null && (value&0x40)===0;
  });
  assert.ok(restored(caster.log,mob.id), 'caster outline was not restored');
  assert.ok(restored(eye.log,mob.id), 'Eye outline was not restored');
  rcon('minecraft:setblock 323 119 17 minecraft:coal_ore', true);
  caster.bot.chat('/mycli cast prospect coal');
  await sleep(700);
  const firstTrailPackets = caster.log.particles.length;
  await sleep(1600);
  assert.ok(caster.log.chat.some((line)=>line.includes('探矿术找到煤矿')
    && line.includes('X=323') && line.includes('Y=119') && line.includes('Z=17')),
    `prospect did not target the staged ore: ${JSON.stringify(caster.log.chat.slice(-8))}`);
  assert.ok(caster.log.particles.length - firstTrailPackets >= 8,
    'prospect particle trail did not continue after the initial cast animation');
  assert.ok(sessions.every(({log})=>log.errors.length===0),
    `client errors: ${JSON.stringify(sessions.map(({log})=>log.errors))}`);
  console.log(JSON.stringify({verdict:'PASS',mobId:mob.id,
    casterMetadata:caster.log.metadata.length,eyeMetadata:eye.log.metadata.length,
    strangerMetadata:stranger.log.metadata.length,particles:caster.log.particles.length,
    eyeParticles:eye.log.particles.length,
    casterChat:caster.log.chat.filter((line)=>line.includes('探敌')||line.includes('MC_HOSTILE')),
    eyeHostileChat:eye.log.chat.filter((line)=>line.includes('MC_HOSTILE'))}));
} finally {
  for (const {bot} of sessions) bot.quit();
  try { rcon('minecraft:kill @e[tag=afu_sense_husk]', true); } catch { }
  try { rcon('minecraft:kill @e[tag=afu_sense_sheep]', true); } catch { }
  try { rcon('minecraft:kill @e[tag=afu_sense_probe2]', true); } catch { }
  try { rcon('minecraft:setblock 323 119 17 minecraft:air', true); } catch { }
  try { rcon('minecraft:fill 315 118 15 320 118 20 minecraft:air', true); } catch { }
  try { rcon('minecraft:forceload remove 315 15 320 20', true); } catch { }
  writeFileSync(pairFile, originalPairs, 'utf8');
}
