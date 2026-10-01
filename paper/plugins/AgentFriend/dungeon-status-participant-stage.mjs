// Isolated Paper 25566: an observer must never mistake another party's floor for its own run.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = command => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], {encoding: 'utf8'});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clients = [];
const wait = async (read, label, timeout = 20000) => {
  for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
    const value = read();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`${label}: ${JSON.stringify(clients.map(client => client.lines.slice(-8)))}`);
};
const join = async prefix => {
  const name = `${prefix}${String(Date.now()).slice(-7)}`;
  const bot = mineflayer.createBot({host: '127.0.0.1', port: 25566,
    username: name, auth: 'offline', version: '1.20.6'});
  const client = {name, bot, lines: [], errors: []};
  bot.on('messagestr', line => client.lines.push(line));
  bot.on('error', error => client.errors.push(String(error)));
  bot.on('kicked', reason => client.errors.push(String(reason)));
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  clients.push(client);
  return client;
};
const query = async (client, command) => {
  const start = client.lines.length;
  client.bot.chat(command);
  const status = await wait(() => client.lines.slice(start)
    .find(line => line.startsWith('MC_DUNGEON status ')), `${client.name} ${command}`);
  await wait(() => client.lines.slice(start)
    .some(line => line.startsWith('MC_DUNGEON entrance ')), 'entrance receipt');
  return {status, lines: client.lines.slice(start)};
};

let fighter;
try {
  fighter = await join('FightQA');
  const observer = await join('WatchQA');
  rcon(`minecraft:tp ${fighter.name} -589.5 91 -304.5`);
  rcon(`minecraft:tp ${observer.name} -543.5 68 -439.5`);
  rcon(`minecraft:effect give ${fighter.name} minecraft:resistance 120 4 true`);
  await wait(() => Math.abs(fighter.bot.entity.position.x + 589.5) < 1, 'fighter at entrance');
  await wait(() => Math.abs(observer.bot.entity.position.x + 543.5) < 1, 'observer in village');

  for (const client of [fighter, observer]) {
    const result = await query(client, '/mycli arena status');
    assert.match(result.status, /participant=false selfState=not_participating globalActive=false globalState=idle globalFloor=0/);
    assert.ok(result.lines.some(line => line.includes('本人试炼：未参赛；全服试炼：待命')));
  }

  fighter.bot.chat('/mycli arena start');
  await wait(() => Math.abs(fighter.bot.entity.position.y - 69) < 2, 'fighter on floor one');
  await sleep(3500); // Let the first wave enter its fighting state.
  for (const command of ['/mycli arena status', '/mycli status']) {
    const own = await query(fighter, command);
    const other = await query(observer, command);
    assert.match(own.status, /participant=true selfState=participating globalActive=true globalState=fighting globalFloor=1/);
    assert.match(other.status, /participant=false selfState=not_participating globalActive=true globalState=fighting globalFloor=1/);
    assert.ok(own.lines.some(line => line.includes('本人试炼：参赛中；全服试炼：第 1/10 层')));
    assert.ok(other.lines.some(line => line.includes('本人试炼：未参赛；全服试炼：第 1/10 层')));
    for (const expected of [true, false]) {
      assert.ok((expected ? own : other).lines.some(line =>
        line.startsWith('MC_DUNGEON floor=1 ') && line.includes('scope=global')
        && line.includes(`participant=${expected}`)));
    }
  }
  assert.ok(Math.abs(observer.bot.entity.position.x + 543.5) < 2, 'observer moved from village');
  assert.deepEqual(clients.map(client => client.errors), [[], []]);
  console.log(JSON.stringify({verdict: 'PASS', fighter: fighter.name, observer: observer.name,
    fighterStatus: (await query(fighter, '/mycli arena status')).status,
    observerStatus: (await query(observer, '/mycli arena status')).status}));
} finally {
  if (fighter?.bot.entity?.position?.y < 80) {
    fighter.bot.chat('/mycli arena leave');
    await sleep(1500);
  }
  for (const client of clients) client.bot.quit();
}
