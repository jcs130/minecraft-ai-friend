// Fixed loopback staging instance only. Never writes production inventory.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { command as rcon } from './rcon-client.mjs';
import { deliverGift, giftCatalog } from './goddess-delivery.mjs';
import { fix1206PotionProtocol } from './minecraft-1206-potion.mjs';
const require = createRequire('E:/MC/probe/package.json');
fix1206PotionProtocol(require);
const mineflayer = require('mineflayer'), Vec3 = require('vec3');
const root = 'E:/MC/ops/repairs/goddess-gift-safety-20261006';
const configFile = 'E:/MC/staging/life-buildings-20261003/plugins/AgentFriend/goddess-gifts.yml';
const ledgerFile = 'E:/MC/staging/life-buildings-20261003/plugins/AgentFriend/goddess-gifts.jsonl';
const mode = process.argv[2] ?? 'before';
assert.ok(['before', 'after'].includes(mode));
const receipts = [];
const send = async text => {
  const started = Date.now();
  const result = await rcon(text, 10000, { properties: 'E:/MC/staging/life-buildings-20261003/server.properties', port: 25587 });
  receipts.push({ command: text, result, elapsedMs: Date.now() - started });
  return result;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const nonce = () => randomBytes(8).toString('hex');
const clients = [];
async function connect(name) {
  const bot = mineflayer.createBot({ host:'127.0.0.1',port:25567,username:name,auth:'offline',version:'1.20.6' });
  clients.push(bot); bot.on('error', error => console.error(error.message));
  await new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error('stage client spawn timeout')),20000);
    bot.once('spawn',()=>{clearTimeout(timer);resolve();}); bot.once('error',reject);
  });
  await sleep(1200); return bot;
}
const count = (bot,name) => bot.inventory.items().filter(i=>i.name===name).reduce((sum,i)=>sum+i.count,0);
const itemPath = (bot,name) => {
  const item = bot.inventory.items().find(i=>i.name===name); assert.ok(item);
  return `Inventory[{Slot:${item.slot >= 36 ? item.slot-36 : item.slot}b}]`;
};
let passed = false, originalConfig;
try {
  const bot = await connect('GiftAudit');
  if (mode === 'after') {
    const manifest = JSON.parse(readFileSync(`${root}/manifest.json`,'utf8'));
    const before = count(bot,'enchanted_book');
    const duplicate = await deliverGift('GiftAudit',{decision:'approve',gift:'mending_book',amount:2},manifest.book,send);
    assert.equal(duplicate.ok,true); assert.equal(duplicate.duplicate,true);
    await sleep(300); assert.equal(count(bot,'enchanted_book'),before,'restart must not allow repeat delivery');
    const uncertain = await deliverGift('GiftAudit',{decision:'approve',gift:'mending_book',amount:2},manifest.pending,send);
    assert.equal(uncertain.reason,'uncertain'); assert.equal(count(bot,'enchanted_book'),before);
    const mismatch = await deliverGift('GiftAudit',{decision:'approve',gift:'mending_book',amount:3},manifest.book,send);
    assert.equal(mismatch.reason,'duplicate-mismatch'); assert.equal(count(bot,'enchanted_book'),before);
    passed = true; console.log(JSON.stringify({passed,mode,replayAfterRestart:'no extra items',preparedReceipt:'blocked',changedAmount:'blocked'}));
  } else {
    const catalog = await giftCatalog(send); assert.equal(Object.keys(catalog.gifts).length,12);
    const bookHash = catalog.gifts.mending_book.hash;
    originalConfig = readFileSync(configFile,'utf8');
    await send('minecraft:clear GiftAudit');
    assert.match(await send('mycli admin gift '+nonce()+' GiftAudit minecraft:enchanted_book 1'),/recipe-required/);
    assert.match(await send('mycli admin gift '+nonce()+' GiftAudit minecraft:potion 1'),/recipe-required/);
    assert.match(await send('mycli admin gift '+nonce()+' GiftAudit gift:mending_book 2 '+ '0'.repeat(64)),/recipe-changed/);
    for (const command of [
      'minecraft:give GiftAudit minecraft:enchanted_book[enchantments={levels:{"minecraft:mending":1}}] 1',
      'minecraft:give GiftAudit minecraft:potion 1',
      'minecraft:execute as GiftAudit run minecraft:give GiftAudit minecraft:enchanted_book[stored_enchantments={levels:{"minecraft:mending":1}}] 1',
    ]) assert.match(await send(command),/受校验/);
    assert.equal(count(bot,'enchanted_book'),0); assert.equal(count(bot,'potion'),0);
    const manifest = { book:nonce(),potion:nonce(),pending:nonce() };
    const book = await deliverGift('GiftAudit',{decision:'approve',gift:'mending_book',amount:2},manifest.book,send);
    assert.equal(book.ok,true); assert.equal(book.receipt.after-book.receipt.before,2);
    await sleep(300); assert.equal(count(bot,'enchanted_book'),2);
    assert.match(await send(`minecraft:data get entity GiftAudit ${itemPath(bot,'enchanted_book')}.components."minecraft:stored_enchantments"`),/"minecraft:mending": 1/);
    assert.match(await send(`minecraft:data get entity GiftAudit ${itemPath(bot,'enchanted_book')}.components."minecraft:enchantments"`),/Found no elements/);
    const potion = await deliverGift('GiftAudit',{decision:'approve',gift:'strength_potion',amount:2},manifest.potion,send);
    assert.equal(potion.ok,true); await sleep(300); assert.equal(count(bot,'potion'),2);
    assert.match(await send(`minecraft:data get entity GiftAudit ${itemPath(bot,'potion')}.components."minecraft:potion_contents"`),/minecraft:strength/);
    const dupe = await deliverGift('GiftAudit',{decision:'approve',gift:'mending_book',amount:2},manifest.book,send);
    assert.equal(dupe.duplicate,true); assert.equal(count(bot,'enchanted_book'),2);
    for(const bad of [
      originalConfig.replace('minecraft:mending: 1','minecraft:mending: 99'),
      originalConfig.replace('potion: minecraft:strength','potion: minecraft:made_up'),
      originalConfig.replace('max-amount: 4','max-amount: 4\n    nbt: anything'),
      originalConfig.replace('enchantments: {minecraft:mending: 1}','enchantments: {minecraft:mending: 1, minecraft:infinity: 1}'),
    ]) {
      writeFileSync(configFile,bad);
      assert.match(await send('mycli admin giftcatalog reload'),/"ready":false/);
      await assert.rejects(deliverGift('GiftAudit',{decision:'approve',gift:'mending_book',amount:1},nonce(),send));
      assert.equal(count(bot,'enchanted_book'),2);
    }
    writeFileSync(configFile,originalConfig); assert.match(await send('mycli admin giftcatalog reload'),/"ready":true/);
    const full = await connect('GiftFull');
    for(const group of [['hotbar',9],['inventory',27]]) for(let i=0;i<group[1];i++)
      await send(`minecraft:item replace entity GiftFull ${group[0]}.${i} with minecraft:stone 64`);
    await sleep(200);
    assert.equal(full.inventory.items().length,36);
    assert.equal((await deliverGift('GiftFull',{decision:'approve',gift:'mending_book',amount:2},nonce(),send)).reason,'inventory');
    await send('minecraft:item replace entity GiftFull inventory.10 with minecraft:air');
    await send('minecraft:item replace entity GiftFull inventory.11 with minecraft:air');
    assert.equal((await deliverGift('GiftFull',{decision:'approve',gift:'mending_book',amount:3},nonce(),send)).reason,'inventory');
    await sleep(200); assert.equal(count(full,'enchanted_book'),0,'no partial delivery or drops');
    assert.equal((await deliverGift('GiftFull',{decision:'approve',gift:'mending_book',amount:2},nonce(),send)).ok,true);
    const goddess = await connect('Goddess'); await send('minecraft:op Goddess');
    const bookCount = count(bot,'enchanted_book');
    goddess.chat('/minecraft:give GiftAudit minecraft:enchanted_book[stored_enchantments={levels:{"minecraft:mending":1}}] 1');
    await sleep(350); assert.equal(count(bot,'enchanted_book'),bookCount,'Goddess direct give must be blocked');
    await send('minecraft:gamemode spectator GiftAudit'); await send('minecraft:tp GiftAudit 9000.5 301 9000.5');
    await bot.waitForChunksToLoad();
    await send('minecraft:fill 8999 300 8999 9002 300 9002 minecraft:stone');
    await send('minecraft:setblock 9001 301 9000 minecraft:anvil');
    await send('minecraft:gamemode survival GiftAudit'); await send('minecraft:experience set GiftAudit 30 levels');
    await send('minecraft:item replace entity GiftAudit hotbar.8 with minecraft:diamond_sword 1');
    bot.setQuickBarSlot(8); await sleep(300);
    const window = await bot.openBlock(bot.blockAt(new Vec3(9001,301,9000))); assert.equal(window.type,'minecraft:anvil');
    for (const [name,slot] of [['diamond_sword',0],['enchanted_book',1]]) {
      const item = window.slots.find((i,index)=>index>=window.inventoryStart&&i?.name===name); assert.ok(item);
      await bot.clickWindow(item.slot,0,0); await bot.clickWindow(slot,0,0);
    }
    bot._client.write('name_item',{name:''}); await sleep(500); assert.equal(window.slots[2]?.name,'diamond_sword');
    await bot.putAway(2); window.close(); await sleep(300);
    assert.match(await send('minecraft:data get entity GiftAudit Inventory[{id:"minecraft:diamond_sword"}].components."minecraft:enchantments"'),/"minecraft:mending": 1/);
    assert.equal(count(bot,'enchanted_book'),1); assert.ok(bot.experience.level<30);
    const drink = bot.inventory.items().find(i=>i.name==='potion'); await bot.equip(drink,'hand'); await bot.consume(); await sleep(350);
    assert.equal(count(bot,'potion'),1); assert.match(await send('minecraft:data get entity GiftAudit active_effects'),/minecraft:strength/);
    await send('minecraft:save-all flush');
    const pending = {...book.receipt,request:manifest.pending,phase:'prepared'}; delete pending.ok; delete pending.duplicate; delete pending.after;
    appendFileSync(ledgerFile,JSON.stringify(pending)+'\n');
    writeFileSync(`${root}/manifest.json`,JSON.stringify(manifest,null,2));
    passed = true; console.log(JSON.stringify({passed,mode,presets:12,book:'anvil crafted Mending sword',potion:'consumed with Strength effect',overlevel:'blocked',unknownPotion:'blocked',extraFields:'blocked',conflictingEnchants:'blocked',fullInventory:'no partial grant',duplicate:'no extra items',rawGive:'blocked',xpRemaining:bot.experience.level}));
  }
} finally {
  if(originalConfig!==undefined)writeFileSync(configFile,originalConfig);
  for(const client of clients)client.quit();
  writeFileSync(`${root}/stage-${mode}.json`,JSON.stringify({passed,receipts},null,2));
  await sleep(500);
}
