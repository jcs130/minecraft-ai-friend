// Full ten-floor personal-loot contract against isolated Paper 25566.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';

const require = createRequire('E:/Cortico/package.json');
const {FullPacketParser} = require('E:/Cortico/node_modules/.pnpm/protodef@1.19.0/node_modules/protodef/src/serializer.js');
const parsePacket = FullPacketParser.prototype.parsePacketBuffer;
const badPackets = [];
let currentFloor = 0;
const unknownPackets = () => badPackets.filter(packet =>
  !(packet.packetId === 0x5b && [6, 9].includes(packet.floor) && packet.hex.includes('e607')));
FullPacketParser.prototype.parsePacketBuffer = function (buffer) {
  try { return parsePacket.call(this, buffer); }
  catch (error) {
    if (error.partialReadError) badPackets.push({floor: currentFloor,
      packetId: buffer[0], length: buffer.length, hex: buffer.subarray(0, 80).toString('hex')});
    throw error;
  }
};
const mineflayer = require('mineflayer');
const rcon = command => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], {encoding: 'utf8'});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const name = process.argv[2] ?? `Loot${String(Date.now()).slice(-8)}`;
const cycle = Number(process.argv[3] ?? 0);
assert.ok(Number.isInteger(cycle) && cycle >= 0 && cycle <= 1);
const bot = mineflayer.createBot({host: '127.0.0.1', port: 25566,
  username: name, auth: 'offline', version: '1.20.6'});
const lines = [];
const errors = [];
bot.on('messagestr', line => lines.push(line));
bot.on('error', error => errors.push(error.stack ?? String(error)));
bot.on('kicked', reason => errors.push(`kicked: ${reason}`));
const until = async (test, label, timeout = 25000) => {
  for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
    if (errors.length) throw new Error(errors.join('\n'));
    if (unknownPackets().length) throw new Error(`protocol parser dropped packets: ${JSON.stringify(unknownPackets())}`);
    const result = test();
    if (result) return result;
    await sleep(100);
  }
  throw new Error(`timeout: ${label}; ${lines.slice(-6).join(' | ')}`);
};
const y = [69, 57, 45, 33, 21, 9, -3, -15, -27, -39];
const gear = new Map([[4, 'iron_helmet'], [5, 'iron_chestplate'],
  [6, cycle === 0 ? 'diamond_helmet' : 'diamond_leggings'],
  [8, 'iron_leggings'], [9, 'iron_boots'],
  [10, cycle === 0 ? 'diamond_chestplate' : 'diamond_boots']]);
const supplies = new Map([[1, ['iron_ingot', 'torch']],
  [2, ['golden_apple', 'glistering_melon_slice', 'arrow']], [3, ['pufferfish', 'bow']]]);

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  rcon(`minecraft:effect give ${name} minecraft:resistance 900 4 true`);
  rcon(`minecraft:effect give ${name} minecraft:saturation 900 4 true`);
  rcon(`minecraft:tp ${name} -589.5 91 -304.5`);
  await until(() => Math.abs(bot.entity.position.x + 589.5) < 1, 'lobby arrival');
  bot.chat('/mycli arena start');
  for (let floor = 1; floor <= 10; floor++) {
    currentFloor = floor;
    await until(() => Math.abs(bot.entity.position.y - y[floor - 1]) < 2,
      `floor ${floor} arrival`, 30000);
    if (floor === 7) {
      bot.chat('/mycli arena next');
      continue;
    }
    await until(() => lines.some(line => line.includes(`第 ${floor}/10 层：`)
      && line.includes('只怪物')), `floor ${floor} mob wave`, 12000);
    rcon('minecraft:kill @e[tag=afu_dungeon_mob]');
    await until(() => lines.some(line => line.includes(`第 ${floor}/10 层已通关`)),
      `floor ${floor} cleared`);
    if (gear.has(floor)) {
      const receipt = lines.find(line => line.startsWith(`MC_DUNGEON_LOOT floor=${floor} category=milestone`));
      assert.ok(receipt, `missing milestone floor ${floor}`);
      assert.ok(receipt.includes(`item=minecraft:${gear.get(floor)}`), receipt);
    }
    if (supplies.has(floor)) {
      const receipts = lines.filter(line => line.startsWith(`MC_DUNGEON_LOOT floor=${floor} category=supply`));
      assert.equal(receipts.length, supplies.get(floor).length, `floor ${floor} supply count`);
      for (const type of supplies.get(floor)) assert.ok(receipts.some(line =>
        line.includes(`item=minecraft:${type}`)), `floor ${floor} missing ${type}`);
      const random = lines.find(line => new RegExp(`^MC_DUNGEON_LOOT floor=${floor} category=(extra|rare) `).test(line));
      assert.ok(random, `floor ${floor} random receipt missing`);
      assert.match(random, /item=minecraft:(arrow|iron_ingot|lapis_lazuli|experience_bottle|golden_apple|torch|diamond)(\s|$)/,
        'early floors should favor materials and consumables');
    }
  }
  await until(() => lines.some(line => line.startsWith('MC_DUNGEON_LOOT floor=10 category=boss')),
    'boss cache');
  const opening = new Promise(resolve => bot.once('windowOpen', resolve));
  bot.chat('/mycli arena rewards');
  const chest = await Promise.race([opening, sleep(15000).then(() => { throw new Error('chest timeout'); })]);
  const contents = chest.slots.slice(0, 54).filter(Boolean);
  for (const type of gear.values()) assert.ok(contents.some(item => item.name === type),
    `missing ${type} in personal chest`);
  assert.ok(contents.some(item => item.name === 'bow'), 'plain bow supply missing');
  assert.ok(contents.some(item => item.name === 'golden_apple'), 'recovery supply missing');
  assert.ok(contents.some(item => item.name === 'pufferfish'), 'water-breathing brewing supply missing');
  assert.ok(contents.some(item => item.name === (cycle === 0 ? 'diamond_sword' : 'totem_of_undying')),
    'boss cache missing');
  assert.ok(contents.some(item => item.name === 'iron_boots'));
  assert.ok(contents.some(item => item.name === 'diamond_helmet'
    && item.components?.some(component => component.type === 'enchantments')),
  'named enchanted diamond helmet component missing');
  bot.chat('/mycli arena loot');
  const progress = await until(() => lines.find(line => line.startsWith('MC_DUNGEON_SET ')),
    'set progress');
  assert.match(progress, new RegExp(`diamondIndex=${2 * (cycle + 1)}`));
  assert.match(progress, new RegExp(`next=minecraft:${cycle === 0 ? 'diamond_leggings' : 'diamond_helmet'}`));
  assert.deepEqual(errors, []);
  assert.deepEqual(unknownPackets(), [], `unexpected protocol parser errors: ${JSON.stringify(badPackets)}`);
  console.log(JSON.stringify({verdict: 'PASS', player: name, pieces: [...gear.values()],
    slotsUsed: contents.length, progress, cycle,
    knownWitchPotionPacketDrops: badPackets.length}));
  bot.closeWindow(chest);
} finally {
  bot.quit();
}
