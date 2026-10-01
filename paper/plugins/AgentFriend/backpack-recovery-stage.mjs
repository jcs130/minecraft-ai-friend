// Isolated Paper 1.20.6 contract for the Minepacks shortcut and full-inventory recovery.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const username = `Bag${String(Date.now()).slice(-8)}`;
const rcon = command => execFileSync(process.execPath,
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command],
  { encoding: 'utf8', timeout: 10000 });

async function connect() {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566,
    username, auth: 'offline', version: '1.20.6' });
  const messages = [];
  bot.on('messagestr', line => messages.push(line));
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
  });
  return { bot, messages };
}

const head = bot => bot.inventory.items().find(item => item.name === 'player_head'
  && JSON.stringify(item).includes('大背包'));

let client;
try {
  client = await connect();
  await sleep(3500);
  let shortcut = head(client.bot);
  assert.ok(shortcut, 'Minepacks shortcut was not granted on join');
  assert.match(JSON.stringify(shortcut), /minecraft:profile|textures/,
    'Shortcut is missing its texture profile');
  await client.bot.tossStack(shortcut);
  await sleep(500);
  assert.ok(head(client.bot), 'Minepacks shortcut dropped despite protection');

  rcon(`minecraft:give ${username} minecraft:wooden_sword 36`);
  await sleep(600);
  rcon(`minecraft:clear ${username} minecraft:player_head`);
  rcon(`minecraft:give ${username} minecraft:wooden_sword 1`);
  await sleep(200);
  assert.equal(head(client.bot), undefined, 'Shortcut was not removed for recovery fixture');
  assert.equal(client.bot.inventory.items().filter(item => item.slot >= 9 && item.slot <= 44).length,
    36, 'Full-inventory fixture did not fill all main slots');

  client.bot.quit();
  await sleep(700);
  client = await connect();
  await sleep(3600);
  shortcut = head(client.bot);
  assert.ok(shortcut, 'Missing Minepacks shortcut was not restored after full-inventory login');
  assert.match(JSON.stringify(shortcut), /minecraft:profile|textures/,
    'Recovered shortcut has no texture profile');
  assert.ok(client.messages.some(line => line.includes('个人试炼箱')),
    'No notice that one stack moved to the personal chest');

  await client.bot.equip(shortcut, 'hand');
  client.bot.activateItem();
  await sleep(500);
  assert.ok(client.bot.currentWindow, 'Recovered textured shortcut did not open Minepacks');
  client.bot.closeWindow(client.bot.currentWindow);

  client.bot.chat('/mycli arena stash list');
  await sleep(400);
  assert.ok(client.messages.some(line => line.includes('MC_STASH') && line.includes('wooden_sword')),
    'The displaced sword was not preserved in the personal chest');
  await client.bot.tossStack(shortcut);
  await sleep(400);
  assert.ok(head(client.bot), 'Recovered shortcut can still be dropped');

  // Losing the shortcut during an existing session must heal without a relog.
  if (!process.argv.includes('--quick')) {
    rcon(`minecraft:clear ${username} minecraft:player_head`);
    rcon(`minecraft:give ${username} minecraft:wooden_sword 1`);
    await sleep(65000);
    assert.ok(head(client.bot), 'Missing shortcut was not restored by the periodic guard');
  }

  console.log(`PASS ${username}: textured shortcut survives drop; full inventory stores one item; login recovery${process.argv.includes('--quick') ? '' : ' and periodic recovery'} work`);
} finally {
  client?.bot.quit();
}
