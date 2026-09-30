// Read-only /mycli discovery contract. Defaults to isolated Paper port 25566.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(process.env.MC_PORT ?? 25566),
  username: process.env.MC_USERNAME ?? `CliQA${String(Date.now()).slice(-8)}`,
  auth: 'offline', version: '1.20.6' });
const lines = [];
const failures = [];
bot.on('messagestr', (line) => lines.push(line));
bot.on('error', (error) => failures.push(error.message));
bot.on('kicked', (reason) => failures.push(JSON.stringify(reason)));

const send = async (command, prefix) => {
  const start = lines.length;
  bot.chat(command);
  for (let waited = 0; waited < 8000; waited += 50) {
    const found = lines.slice(start).filter((line) => line.startsWith(prefix));
    if (found.length) { await sleep(180); return lines.slice(start); }
    await sleep(50);
  }
  throw new Error(`No ${prefix} for ${command}: ${JSON.stringify(lines.slice(-8))}`);
};
const json = (line, prefix) => JSON.parse(line.slice(prefix.length));

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  // AgentFriend grants new-player starter items shortly after spawn.
  await sleep(3500);
  const before = { health: bot.health, position: bot.entity.position.clone(),
    inventory: bot.inventory.items().map((item) => `${item.slot}:${item.type}:${item.count}`) };
  const roots = await send('/mycli list', 'MC_CLI_LIST ');
  const rootHead = json(roots.find((line) => line.startsWith('MC_CLI_LIST ')), 'MC_CLI_LIST ');
  assert.equal(rootHead.schemaVersion, 1);
  assert.equal(rootHead.filter, 'roots');
  assert.ok(rootHead.pages > 1);
  assert.ok(roots.some((line) => line.startsWith('MC_CLI_NEXT /mycli list roots 2')));
  const magic = await send('/mycli list cast', 'MC_CLI_LIST ');
  const castHead = json(magic.find((line) => line.startsWith('MC_CLI_LIST ')), 'MC_CLI_LIST ');
  assert.equal(castHead.filter, 'cast');
  assert.ok(castHead.total >= 17);
  const IDs = new Set();
  for (let page = 1; page <= castHead.pages; page++) {
    const batch = page === 1 ? magic : await send(`/mycli list cast ${page}`, 'MC_CLI_LIST ');
    for (const line of batch.filter((line) => line.startsWith('MC_CLI_ITEM '))) {
      const item = json(line, 'MC_CLI_ITEM ');
      assert.match(item.id, /^cast\.[a-z]+$/);
      IDs.add(item.id);
    }
  }
  assert.equal(IDs.size, castHead.total);
  assert.ok(IDs.has('cast.prospect') && IDs.has('cast.selfheal'));
  const explain = await send('/mycli explain cast prospect', 'MC_CLI_DETAIL ');
  const detail = json(explain.find((line) => line.startsWith('MC_CLI_DETAIL ')), 'MC_CLI_DETAIL ');
  assert.equal(detail.id, 'cast.prospect');
  assert.match(detail.usage, /\/mycli cast prospect/);
  assert.match(detail.returns, /dimension\/X\/Y\/Z/);
  const nested = await send('/mycli help arena.stash.take', 'MC_CLI_DETAIL ');
  assert.equal(json(nested.find((line) => line.startsWith('MC_CLI_DETAIL ')), 'MC_CLI_DETAIL ').id,
    'arena.stash.take');
  const unknown = await send('/mycli explain cast unicorn', 'MC_CLI_ERROR ');
  assert.equal(json(unknown.find((line) => line.startsWith('MC_CLI_ERROR ')), 'MC_CLI_ERROR ').code,
    'UNKNOWN_ID');
  const badPage = await send('/mycli list cast 999', 'MC_CLI_ERROR ');
  assert.equal(json(badPage.find((line) => line.startsWith('MC_CLI_ERROR ')), 'MC_CLI_ERROR ').code,
    'INVALID_PAGE');
  assert.equal(bot.health, before.health);
  assert.ok(bot.entity.position.distanceTo(before.position) < 1);
  assert.deepEqual(bot.inventory.items().map((item) => `${item.slot}:${item.type}:${item.count}`), before.inventory);
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ verdict: 'PASS', roots: rootHead.total,
    cast: castHead.total, pages: castHead.pages, detail }));
} finally {
  bot.quit();
}
