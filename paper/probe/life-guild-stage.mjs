import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const port = Number(process.env.MC_PORT ?? 25567);
assert.equal(port, 25567, 'Life guild test must use the isolated stage');
const suffix = Date.now().toString(36).slice(-5);
const names = [`LifeA${suffix}`, `LifeB${suffix}`];
const bots = names.map(username => mineflayer.createBot({
  host: '127.0.0.1', port, username, auth: 'offline', version: '1.20.6',
}));
const seen = bots.map(() => []);
const chats = bots.map(() => []);
const errors = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(test, label, timeoutMs = 10000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (test()) return;
    await sleep(50);
  }
  throw new Error(`timeout: ${label}`);
}
for (const [index, bot] of bots.entries()) {
  bot.on('error', error => errors.push(`${bot.username}: ${error.message}`));
  bot.on('kicked', reason => errors.push(`${bot.username}: ${JSON.stringify(reason)}`));
  bot.on('messagestr', line => chats[index].push(line));
  bot._client.on('custom_payload', packet => {
    if (packet.channel !== 'mcagent:life') return;
    const raw = Buffer.from(packet.data);
    assert.equal(raw[0], 0x7b, 'expected raw UTF-8 JSON');
    assert.ok(raw.length <= 16384, 'life packet too large');
    seen[index].push(JSON.parse(raw.toString('utf8')));
  });
}
try {
  await Promise.all(bots.map(bot => new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reason => reject(new Error(JSON.stringify(reason))));
  })));
  const [a, b] = bots;
  b._client.write('custom_payload', { channel: 'minecraft:register', data: Buffer.from('mcagent:life') });
  a.chat('/mycli life board');
  await waitFor(() => chats[0].some(line => line.includes('tinkerer_light')), 'six-guild board');
  assert.ok(chats[0].some(line => line.includes('author_story')));
  assert.ok(!chats[1].some(line => line.includes('author_story')), 'board leaked to another player');
  a.chat('/mycli life accept author_story');
  await waitFor(() => seen[0].some(item => item.kind === 'accept' && item.id === 'author_story'), 'accept receipt');
  assert.equal(seen[1].length, 0, 'private receipt leaked to B');
  await waitFor(() => a.inventory.items().some(item => item.name === 'writable_book'), 'starter book');
  const story = '今天我来到千灯纪的樱花树林，看到河边的灯笼和朋友一起钓鱼。我们在村庄做面包，准备把自己的故事写给每位新的旅行者。';
  a.chat(`/mycli life write 樱花游记|${story}`);
  await waitFor(() => seen[0].some(item => item.kind === 'progress' && item.id === 'author_story'
    && item.progress === 1), 'book progress');
  await waitFor(() => a.inventory.items().some(item => item.name === 'written_book'), 'real signed book');
  a.chat('/mycli life claim');
  await waitFor(() => seen[0].some(item => item.kind === 'claim' && item.success), 'claim receipt');
  const claim = seen[0].findLast(item => item.kind === 'claim');
  assert.equal(claim.guildId, 'author');
  assert.equal(claim.rewardLocation, 'personal_trial_stash');
  a.chat('/mycli life accept author_story');
  await waitFor(() => chats[0].some(line => line.includes('今日已完成')), 'daily guard');
  b.chat('/mycli life status');
  await waitFor(() => seen[1].some(item => item.kind === 'status'), 'B private status');
  assert.equal(seen[1].findLast(item => item.kind === 'status').reputation.author, 0,
    'another player inherited A reputation');
  a.chat('/mycli guild menu');
  await waitFor(() => a.currentWindow?.slots[47]?.name === 'sunflower', 'life button on adventure board');
  assert.equal(a.currentWindow.slots[48]?.name, 'barrier', 'adventure controls overwritten by contracts');
  await a.clickWindow(47, 0, 0);
  await waitFor(() => a.currentWindow?.slots[15]?.name === 'redstone_lamp', 'life menu from adventure board');
  assert.equal(a.currentWindow.slots[14]?.name, 'writable_book');
  b.chat('/mycli life menu');
  await waitFor(() => b.currentWindow?.slots[13]?.name === 'cherry_planks', 'controller life menu');
  await b.clickWindow(13, 0, 0);
  await waitFor(() => seen[1].some(item => item.kind === 'accept' && item.id === 'builder_home'),
    'menu accept receipt');
  assert.equal(seen[0].filter(item => item.kind === 'claim').length, 1, 'duplicate claim');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ verdict: 'PASS', guilds: 6, book: true, claim: true,
    dailyGuard: true, menus: true, privatePackets: [seen[0].length, seen[1].length] }));
} finally {
  for (const bot of bots) bot.quit();
}
