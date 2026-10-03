import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i = 0; i < 100; i++) {
    const value = check();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`timeout: ${label}`);
}
const live = process.argv.includes('--live');
const create = name => mineflayer.createBot({host:live ? '192.168.3.163' : '127.0.0.1',port:live ? 25565 : 25567,username:name,
  auth:'offline',version:'1.20.6'});
const one = create(`SpellQA${Date.now().toString(36).slice(-5)}`);
const two = create(`QuietQA${Date.now().toString(36).slice(-5)}`);
const messages = [], otherMessages = [], events = [];
one.on('messagestr', text => messages.push(text));
two.on('messagestr', text => otherMessages.push(text));
one._client.on('custom_payload', packet => {
  if (packet.channel === 'mcagent:event') events.push(JSON.parse(Buffer.from(packet.data).toString('utf8')));
});
const receipt = prefix => messages.filter(text => text.startsWith(prefix)).map(text => JSON.parse(text.slice(prefix.length)));
try {
  await Promise.all([one,two].map(bot => new Promise((resolve,reject) => {
    bot.once('spawn',resolve); bot.once('error',reject); bot.once('kicked',reject);
  })));
  one.setQuickBarSlot(8);
  const expected = new Set(['selfheal','heal','food','home','blink','give','fireworks',
    'starlight','starbolt','frostnova','flamewave','prospect','leap','flight','golem',
    'sense','feather','night']);
  for (const page of [1,2,3]) {
    one.chat(`/mycli spells list ${page}`);
    await until(() => receipt('MC_SPELL_LIST ').some(item => item.page === page), `list page ${page}`);
    await sleep(150);
  }
  const ids = receipt('MC_SPELL_ITEM ').map(item => item.id);
  assert.deepEqual(new Set(ids), expected);
  assert.equal(ids.length, expected.size);
  one.chat('/mycli spells explain starbolt');
  const detail = await until(() => receipt('MC_SPELL_DETAIL ').find(item => item.id === 'starbolt'),
    'starbolt detail');
  assert.equal(detail.command, '/mycli cast starbolt');
  assert.equal(detail.mana, 4);
  assert.equal(detail.cooldownMs, 3000);
  assert.match(detail.target, /敌对怪物/);
  assert.match(detail.onFailure, /不扣魔力/);
  for (const id of ['give','prospect','night']) {
    one.chat(`/mycli spells explain ${id}`);
    const expanded = await until(() => receipt('MC_SPELL_DETAIL ').find(item => item.id === id),
      `${id} full detail`);
    assert.ok(expanded.effect.length > 10);
    assert.ok(expanded.requires.length > 10);
  }
  one.chat('/mycli explain cast.starbolt');
  const catalog = await until(() => receipt('MC_CLI_DETAIL ').find(item => item.id === 'cast.starbolt'),
    'existing CLI detail enriched');
  assert.equal(catalog.spell.id, detail.id);
  assert.equal(catalog.spell.cooldownMs, detail.cooldownMs);
  one.chat('/mycli spells explain bogus');
  await until(() => receipt('MC_SPELL_ERROR ').some(item => item.code === 'UNKNOWN_ID'), 'unknown spell error');
  assert.ok(!otherMessages.some(text => text.startsWith('MC_SPELL_') || text.startsWith('MC_CLI_DETAIL ')),
    'guide must not reach another player');
  assert.equal(events.length,0,'reading descriptions must not cast');

  one.chat('/mycli menu');
  const skills = await until(() => one.currentWindow?.slots[2]?.name === 'written_book'
    ? one.currentWindow : null, 'spell guide entry on compass');
  await one.clickWindow(2,0,0);
  const guide = await until(() => one.currentWindow !== skills && one.currentWindow?.slots[17]?.name === 'amethyst_shard'
    ? one.currentWindow : null, 'spell guide 54-slot menu');
  assert.equal(guide.slots[9]?.name,'golden_apple');
  assert.equal(guide.slots[26]?.name,'lantern');
  await one.clickWindow(17,0,0);
  const info = await until(() => one.currentWindow !== guide && one.currentWindow?.slots[24]?.name === 'blaze_rod'
    ? one.currentWindow : null, 'read-only starbolt detail menu');
  assert.equal(info.slots[10]?.name,'amethyst_shard');
  assert.match(JSON.stringify(info.slots[10]), /优先命中准星/, 'effect lore reaches vanilla client');
  assert.match(JSON.stringify(info.slots[14]), /魔力 4/, 'cost lore reaches vanilla client');
  assert.equal(events.length,0,'opening skill details must not cast');
  if (!live) {
    await one.clickWindow(22,0,0);
    await until(() => one.currentWindow?.slots[15]?.name === 'firework_rocket', 'back to spell guide');
    await one.clickWindow(15,0,0);
    await until(() => one.currentWindow?.slots[10]?.name === 'firework_rocket', 'fireworks detail');
    await one.clickWindow(24,0,0);
    await until(() => events.some(item => item.kind === 'skill' && item.id === 'fireworks'),
      'explicit cast from guide');
  }
  console.log(`PASS spell guide ${live ? 'live read-only' : 'stage cast'}: 18 entries, private detail, CLI enrichment, controller menu`);
} finally {
  one.quit(); two.quit();
}
