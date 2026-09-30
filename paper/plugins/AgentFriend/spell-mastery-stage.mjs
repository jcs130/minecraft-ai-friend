// Isolated Paper 25566; use the same fresh account for `first` and `verify` across a JVM restart.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = (command) => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], {encoding:'utf8'});
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check, label, session) => {
  for (let i=0; i<100; i++) { if (check()) return; await sleep(100); }
  throw new Error(`Timed out: ${label}; chat=${session?.chats.slice(-8).join(' | ')}`);
};
const mode=process.argv[2] ?? 'first';
const name=process.argv[3];
assert.match(name ?? '',/^[A-Za-z][A-Za-z0-9_]{2,15}$/,
  'Usage: node spell-mastery-stage.mjs first|verify <fresh-account-name>');
const otherName=`${name.slice(0,14)}O`;
const bots=[];
const login=async (username) => {
  const bot=mineflayer.createBot({host:'127.0.0.1',port:25566,username,auth:'offline',version:'1.20.6'});
  bots.push(bot);
  const chats=[], states=[];
  bot.on('messagestr', line => chats.push(line));
  bot._client.on('custom_payload', packet => {
    if (packet.channel==='mcviewer:state') states.push(JSON.parse(Buffer.from(packet.data).toString('utf8')));
  });
  await new Promise((resolve,reject)=>{bot.once('spawn',resolve);bot.once('error',reject);bot.once('kicked',reject)});
  bot._client.write('custom_payload',{channel:'minecraft:register',data:Buffer.from('mcviewer:state')});
  await sleep(2200);
  rcon(`minecraft:tp ${username} 900.5 150 900.5`);
  await sleep(400);
  return {bot,chats,states};
};
const report=async session => {
  session.chats.length=0;
  session.bot.chat('/mycli mastery');
  await until(()=>session.chats.some(line=>line.startsWith('MC_MASTERY id=starbolt')), 'mastery report');
  return session.chats.find(line=>line.startsWith('MC_MASTERY id=starbolt'));
};
const ability=session=>session.states.at(-1)?.abilities?.find(entry=>entry.id==='mycli:starbolt');
const dummyHealth=()=>{
  const response=rcon('minecraft:data get entity @e[tag=afu_mastery_dummy,limit=1] Health');
  const value=response.match(/entity data: ([\d.]+)f/);
  assert.ok(value,`Could not read dummy health: ${response}`);
  return Number(value[1]);
};
const hitDummy=async session=>{
  rcon('minecraft:kill @e[tag=afu_mastery_dummy]');
  rcon('minecraft:summon minecraft:husk 902.5 150 900.5 {Tags:["afu_mastery_dummy"],NoAI:1b}');
  await sleep(120);
  const before=await dummyHealth();
  const hits=session.chats.filter(line=>line.includes('星芒箭命中')).length;
  session.bot.chat('/mycli cast starbolt');
  await until(()=>session.chats.filter(line=>line.includes('星芒箭命中')).length>hits,'damage cast',session);
  return before-await dummyHealth();
};
try {
  const main=await login(name);
  if (mode==='verify') {
    assert.match(await report(main), /level=2 uses=\d+ requiredUses=24/);
    await until(()=>ability(main)?.level===2,'persistent viewer rank');
    const other=await login(otherName);
    const trained=await hitDummy(main);
    const novice=await hitDummy(other);
    assert.ok(Math.abs(trained/novice-1.2)<0.01,
      `Rank 2 should scale 6:5 after armor: trained=${trained}, novice=${novice}`);
    console.log('PASS persistent rank, personal viewer state, actual damage scaling');
  } else {
    rcon('minecraft:fill 895 149 895 905 149 905 minecraft:stone');
    rcon('minecraft:fill 895 150 895 905 153 905 minecraft:air');
    rcon(`minecraft:tp ${name} 900.5 150 900.5`);
    rcon(`skills skill setlevel ${name} sorcery 50`);
    assert.match(await report(main), /level=1 uses=0 requiredUses=8/);
    const other=await login(otherName);
    assert.match(await report(other), /level=1 uses=0 requiredUses=8/);
    main.bot.chat('/mycli cast starbolt');
    await until(()=>main.chats.some(line=>line.includes('没找到怪物')),'empty spell rejection');
    assert.match(await report(main), /level=1 uses=0 requiredUses=8/);
    for (let i=0;i<8;i++) {
      rcon('minecraft:kill @e[tag=afu_mastery_dummy]');
      rcon('minecraft:summon minecraft:husk 902.5 150 900.5 {Tags:["afu_mastery_dummy"],NoAI:1b}');
      await sleep(120);
      const before=main.chats.filter(line=>line.includes('星芒箭命中')).length;
      main.bot.chat('/mycli cast starbolt');
      await until(()=>main.chats.filter(line=>line.includes('星芒箭命中')).length>before,`cast ${i+1}`,main);
      if (i<7) await sleep(3100);
    }
    assert.match(await report(main), /level=2 uses=8 requiredUses=24/);
    assert.match(await report(other), /level=1 uses=0 requiredUses=8/);
    await until(()=>ability(main)?.level===2,'viewer rank');
    assert.equal(ability(other)?.level,1,'another player must not receive the caster rank');
    const menu=new Promise(resolve=>main.bot.once('windowOpen',resolve));
    main.bot.chat('/mycli menu');
    const window=await menu;
    assert.equal(window.slots[5]?.name,'experience_bottle','controller entry to mastery menu');
    const next=new Promise(resolve=>main.bot.once('windowOpen',resolve));
    await main.bot.clickWindow(5,0,0);
    const masteryMenu=await next;
    assert.equal(masteryMenu.slots[9]?.name,'amethyst_shard','vanilla mastery icon');
    main.bot.closeWindow(masteryMenu);
    console.log('PASS failed-cast exclusion, rank-up, UUID isolation, viewer state, controller menu');
  }
} finally {
  try { rcon('minecraft:kill @e[tag=afu_mastery_dummy]'); } catch { /* server may be restarting */ }
  bots.forEach(bot=>bot.quit());
}
