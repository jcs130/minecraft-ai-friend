// Run against the isolated Paper 25566 server with AgentFriend 0.3.44.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rcon = command => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], {encoding: 'utf8'});
const connect = async name => {
  const bot = mineflayer.createBot({host: '127.0.0.1', port: 25566,
    username: name, auth: 'offline', version: '1.20.6'});
  const lines = [];
  bot.on('messagestr', line => lines.push(line));
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reject);
  });
  return {bot, lines};
};
const until = async (test, label, ms = 15000) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    const result = test();
    if (result) return result;
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
};
const ask = async (client, command, action) => {
  client.lines.length = 0;
  client.bot.chat(command);
  return until(() => {
    const values = client.lines.filter(line => line.startsWith('MC_ARENA_ECONOMY '))
      .map(line => JSON.parse(line.slice('MC_ARENA_ECONOMY '.length)));
    return values.find(value => value.action === action);
  }, command);
};
const a = await connect(`EconA${String(Date.now()).slice(-8)}`);
const b = await connect(`EconB${String(Date.now()).slice(-8)}`);
try {
  rcon(`minecraft:give ${a.bot.username} minecraft:iron_sword 2`);
  await until(() => a.bot.inventory.items().filter(item => item.name === 'iron_sword').length >= 2,
    'two swords in bag');
  const listing = await ask(a, '/mycli arena recycle list', 'recycle_list_end');
  assert.ok(listing.total >= 2);
  const candidates = a.lines.filter(line => line.startsWith('MC_ARENA_ECONOMY '))
    .map(line => JSON.parse(line.slice('MC_ARENA_ECONOMY '.length)));
  const sword = candidates.find(value => value.action === 'recycle_list'
    && value.item?.id === 'minecraft:iron_sword' && value.source === 'bag');
  assert.ok(sword);
  assert.ok(sword.item.serializedItemBase64.length > 20);
  const quote = await ask(a, `/mycli arena recycle quote bag ${sword.slot}`, 'quote');
  assert.equal(quote.success, true);
  assert.equal(quote.item.id, 'minecraft:iron_sword');
  assert.ok(quote.price > 0);
  assert.ok(quote.item.componentHash.length === 64);
  const thief = await ask(b, `/mycli arena recycle sell ${quote.quoteId}`, 'sell');
  assert.equal(thief.success, false, 'another player cannot use quote');
  const sold = await ask(a, `/mycli arena recycle sell ${quote.quoteId}`, 'sell');
  assert.equal(sold.success, true);
  assert.equal(sold.balance, quote.price);
  const repeat = await ask(a, `/mycli arena recycle sell ${quote.quoteId}`, 'sell');
  assert.equal(repeat.success, false, 'quote cannot be executed twice');
  await ask(a, '/mycli arena recycle list', 'recycle_list_end');
  const remaining = a.lines.filter(line => line.startsWith('MC_ARENA_ECONOMY '))
    .map(line => JSON.parse(line.slice('MC_ARENA_ECONOMY '.length)))
    .find(value => value.action === 'recycle_list'
      && value.item?.id === 'minecraft:iron_sword' && value.source === 'bag');
  assert.ok(remaining);
  const staleQuote = await ask(a, `/mycli arena recycle quote bag ${remaining.slot}`, 'quote');
  assert.equal(staleQuote.success, true);
  rcon(`minecraft:clear ${a.bot.username} minecraft:iron_sword 1`);
  const staleSell = await ask(a, `/mycli arena recycle sell ${staleQuote.quoteId}`, 'sell');
  assert.equal(staleSell.success, false, 'changing the source slot invalidates the quote');
  assert.equal(staleSell.reason, 'item_changed');
  const wallet = await ask(a, '/mycli arena wallet', 'wallet');
  assert.equal(wallet.balance, sold.balance);
  const otherWallet = await ask(b, '/mycli arena wallet', 'wallet');
  assert.equal(otherWallet.balance, 0);
  const bought = await ask(a, '/mycli arena shop buy arrows', 'buy');
  assert.equal(bought.success, true);
  assert.equal(bought.pending, true);
  assert.equal(bought.item.quantity, 16);
  assert.equal(bought.balance, sold.balance - bought.spent);
  const expensive = await ask(a, '/mycli arena shop buy iron_chestplate', 'buy');
  assert.equal(expensive.success, false);
  assert.equal(expensive.reason, 'insufficient_balance');
  assert.equal(b.lines.some(line => line.includes('MC_ARENA_ECONOMY ') && line.includes(quote.quoteId)), false,
    'economy receipts stay private');
  console.log(JSON.stringify({verdict: 'PASS', quoteId: quote.quoteId,
    sold: sold.quantity, balance: bought.balance, pending: bought.pending}));
} finally {
  a.bot.quit();
  b.bot.quit();
}
