import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const stage = 'E:/MC/staging/life-buildings-20261003';
const agentName = process.env.BOARD_AGENT || 'CortiLan';
const rcon = command => execFileSync('node', [`${stage}/rcon-stage.mjs`, command], {
  encoding: 'utf8', timeout: 15000,
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (condition, label, timeout = 10000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (condition()) return;
    await sleep(100);
  }
  throw new Error(`timeout: ${label}`);
};
const make = username => {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25567,
    username, auth: 'offline', version: '1.20.6' });
  const state = { bot, messages: [], packets: [], errors: [] };
  bot.on('messagestr', text => state.messages.push(text));
  bot.on('error', error => state.errors.push(error.message));
  bot.on('kicked', reason => state.errors.push(`kicked: ${reason}`));
  bot._client.on('custom_payload', packet => {
    if (packet.channel !== 'mcagent:board') return;
    state.packets.push(JSON.parse(Buffer.from(packet.data).toString('utf8')));
  });
  return state;
};
const ask = async (state, command) => {
  state.messages.length = 0;
  state.bot.chat(command);
  await sleep(450);
  return state.messages.join('\n');
};
const agent = make(agentName);
const guest = make(`BoardGuest${String(Date.now()).slice(-5)}`);
const yamlPath = `${stage}/plugins/AgentFriend/dynamic-board.yml`;
let originalYaml;

try {
  await Promise.all([agent, guest].map(state => new Promise((resolve, reject) => {
    state.bot.once('spawn', resolve);
    state.bot.once('error', reject);
  })));
  await sleep(2400);
  agent.messages.length = 0;
  guest.messages.length = 0;
  agent.packets.length = 0;
  guest.packets.length = 0;
  rcon('mycli admin board replace 1 supply_torches');
  await until(() => agent.packets.length > 0, 'registered agent private board payload');
  assert.equal(guest.packets.length, 0, 'unregistered player must not receive board channel');
  assert.ok(agent.messages.some(message => message.includes('MC_BOARD_TODAY')));
  assert.ok(!guest.messages.some(message => message.includes('MC_BOARD_TODAY')));
  assert.ok(agent.messages.find(message => message.includes('MC_BOARD_TODAY')).length <= 256);
  assert.match(await ask(guest, '/mycli admin board list'), /只允许控制台或女神观战账号/);
  const payload = agent.packets.at(-1);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.type, 'MC_BOARD_TODAY');
  assert.equal(payload.cards.length, 4);
  assert.equal(payload.cards[0].id, 'db_20261003_supply_torches');

  assert.match(await ask(agent, '/mycli guild board'), /【今日.*动态委托】/);
  const opening = new Promise(resolve => agent.bot.once('windowOpen', resolve));
  agent.bot.chat('/mycli guild menu');
  const window = await opening;
  assert.equal(window.slots.length >= 54, true);
  assert.equal(window.slots[1]?.name, 'torch');
  assert.equal(window.slots[10]?.name, 'bone', 'first static contract remains in place');
  assert.equal(window.slots[49]?.name, 'emerald', 'bottom claim control remains in place');
  agent.bot.closeWindow(window);

  await ask(agent, '/mycli guild abandon'); // Stage player may carry an old contract.
  rcon(`clear ${agentName} minecraft:torch`);
  rcon(`give ${agentName} minecraft:torch 16`);
  await until(() => agent.bot.inventory.items().filter(item => item.name === 'torch')
    .reduce((sum, item) => sum + item.count, 0) >= 16, 'given real torches');
  await ask(agent, '/mycli guild join');
  const before = await ask(agent, '/mycli guild status');
  const fameBefore = Number(before.match(/声望 (\d+)/)?.[1]);
  assert.ok(Number.isFinite(fameBefore), before);
  assert.match(await ask(agent, '/mycli guild accept db_20261003_supply_torches'), /已接公会委托/);
  originalYaml = readFileSync(yamlPath, 'utf8');
  writeFileSync(yamlPath, originalYaml.replace('max-request: 16', 'max-request: 8'));
  assert.match(rcon('mycli admin board reload'), /已热加载/);
  rcon('mycli admin board replace 1 supply_torches');
  assert.match(rcon('mycli admin board list'), /补火把 x8/);
  assert.match(await ask(agent, '/mycli guild status'), /给村庄补火把 \[16\/16\]/);
  const claim = await ask(agent, '/mycli guild claim');
  assert.match(claim, /委托交付成功/);
  assert.match(claim, /村庄伙伴收到了这份帮助/);
  const after = await ask(agent, '/mycli guild status');
  const fameAfter = Number(after.match(/声望 (\d+)/)?.[1]);
  assert.ok(fameAfter - fameBefore === 7 || fameAfter - fameBefore === 9,
    `dynamic base fame 6 ×1.2 rounded plus optional diversity: ${fameBefore} -> ${fameAfter}`);
  assert.equal(agent.bot.inventory.items().filter(item => item.name === 'torch')
    .reduce((sum, item) => sum + item.count, 0), 0, 'supply items removed from player');
  const left = rcon('data get block -473 67 -491 Items');
  const right = rcon('data get block -472 67 -491 Items');
  assert.match(left + right, /minecraft:torch/, 'torches physically deposited in public chest');
  const rewardOpening = new Promise(resolve => agent.bot.once('windowOpen', resolve));
  agent.bot.chat('/mycli guild rewards');
  const rewards = await rewardOpening;
  const emeralds = rewards.slots.slice(0, rewards.inventoryStart).filter(item => item?.name === 'emerald')
    .reduce((sum, item) => sum + item.count, 0);
  assert.ok(emeralds >= 2, `personal reward chest emeralds=${emeralds}`);
  agent.bot.closeWindow(rewards);
  assert.match(await ask(agent, '/mycli life status'), /今日无委托也可|今天可以慢慢来|做完想做的事/);
  assert.equal(agent.errors.length, 0, agent.errors.join('; '));
  assert.equal(guest.errors.length, 0, guest.errors.join('; '));
  console.log(JSON.stringify({ pass: true, fameBefore, fameAfter, channelCards: payload.cards.length,
    gui: { dynamic: window.slots[1]?.name, static: window.slots[10]?.name,
      claim: window.slots[49]?.name }, chest: 'torch deposited', rewardEmeralds: emeralds }));
} finally {
  if (originalYaml) {
    writeFileSync(yamlPath, originalYaml);
    rcon('mycli admin board reload');
    rcon('mycli admin board replace 1 supply_torches');
  }
  agent.bot.quit();
  guest.bot.quit();
}
