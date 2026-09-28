// Isolated integration test: real vitals and camera reattachment after the target dies.
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const require = createRequire('E:/MC/probe/package.json');
const mineflayer = require('mineflayer');
const exec = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rcon = async command => (await exec('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command],
  { timeout: 10000, windowsHide: true })).stdout;
async function until(check, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(250);
  }
  throw new Error(`Timed out: ${label}`);
}
const bots = [];
async function join(username) {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25566,
    version: '1.20.6', username, auth: 'offline', respawn: false });
  bots.push(bot);
  bot.on('error', error => console.error(`${username}: ${error}`));
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('end', reason => reject(new Error(`${username} disconnected: ${reason}`)));
  });
  return bot;
}
try {
  await rcon('gamerule naturalRegeneration false');
  const target = await join('AfuDungeonProbe3');
  const camera = await join('CortiCam');
  const bars = [];
  camera._client.on('boss_bar', data => bars.push(JSON.stringify(data)));
  await until(async () => (await rcon('cortieye')).includes('attached=true'), 'initial attach');
  console.log('initial:', (await rcon('cortieye')).trim());
  if (!(await rcon('cortieye')).includes('vitalsBossBar=false')) {
    throw new Error('Duplicate vitals boss bar was not disabled');
  }
  target.chat('/mycli cast fireworks');
  await until(async () => !/mana=20\.0\/20\.0/.test(await rcon('cortieye')), 'real mana use', 3000);
  console.log('after spell:', (await rcon('cortieye')).trim());
  console.log('attribute:', (await rcon('attribute AfuDungeonProbe3 minecraft:generic.max_health base set 30')).trim());
  await until(async () => (await rcon('cortieye')).includes('health=20.0/30.0'), 'actual health');
  await sleep(500);
  if (bars.some(bar => bar.includes('20.0/30.0') || bar.includes('Corti 状态读取中'))) {
    throw new Error('Duplicate vitals boss bar reached the camera');
  }
  console.log('changed max health:', (await rcon('cortieye')).trim());
  let respawned = false;
  target.once('death', () => {
    console.log('target death packet');
    setTimeout(() => target.respawn(), 500);
  });
  target.once('respawn', () => { respawned = true; console.log('target respawn packet'); });
  await rcon('kill AfuDungeonProbe3');
  await until(() => respawned, 'target respawn', 15000);
  await until(async () => (await rcon('cortieye')).includes('attached=true'), 'reattach after respawn', 15000);
  console.log('reattached:', (await rcon('cortieye')).trim());
  await rcon('title AfuDungeonProbe3 title {"text":"POST_RESPAWN_MIRROR_TEST"}');
  const titles = [];
  camera._client.on('set_title_text', packet => titles.push(JSON.stringify(packet)));
  await rcon('title AfuDungeonProbe3 title {"text":"POST_RESPAWN_MIRROR_TEST_2"}');
  await until(() => titles.some(title => title.includes('POST_RESPAWN_MIRROR_TEST_2')),
    'post-respawn presentation packets');
  console.log('post-respawn title mirrored');
} finally {
  await rcon('attribute AfuDungeonProbe3 minecraft:generic.max_health base set 20');
  for (const bot of bots) bot.quit();
  await rcon('gamerule naturalRegeneration true');
}
