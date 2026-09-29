// Isolated Paper 1.20.6 smoke: one-use casting and caster-only ore outline.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const rcon = (command) => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], { encoding: 'utf8' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const id = String(Date.now()).slice(-8);
const names = [`Focus${id}`, `Watch${id}`];
const bots = names.map((username) => mineflayer.createBot({
  host: '127.0.0.1', port: 25566, username, auth: 'offline', version: '1.20.6',
}));
const packets = bots.map(() => ({ spawns: [], metadata: [], destroyed: [], particles: [], bars: [], errors: [], chats: [] }));
for (let index = 0; index < bots.length; index++) {
  const bot = bots[index], log = packets[index];
  bot.on('messagestr', (line) => log.chats.push(line));
  bot.on('error', (error) => log.errors.push(error.message));
  bot.on('kicked', (reason) => log.errors.push(`kicked: ${JSON.stringify(reason)}`));
  bot._client.on('packet', (packet, meta) => {
    if (meta.name === 'spawn_entity') log.spawns.push(packet);
    if (meta.name === 'entity_metadata') log.metadata.push(packet);
    if (meta.name === 'entity_destroy') log.destroyed.push(packet);
    if (meta.name === 'world_particles') log.particles.push(packet);
    if (meta.name === 'boss_bar') log.bars.push(packet);
  });
}

try {
  await Promise.all(bots.map((bot) => new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
  })));
  rcon('minecraft:forceload add 300 0 330 32');
  rcon('minecraft:fill 314 112 14 320 118 20 minecraft:stone');
  rcon('minecraft:setblock 317 115 17 minecraft:diamond_ore');
  rcon('minecraft:tp ' + names[0] + ' 317.5 119 17.5 180 0');
  rcon('minecraft:tp ' + names[1] + ' 318.5 119 17.5 180 0');
  await sleep(2400);
  const caster = bots[0], spectator = bots[1];
  assert.equal(caster.blockAt(new Vec3(317, 115, 17))?.name, 'stone',
    'Anti-xray should still hide a sealed ore in the raw client chunk');
  const focus = caster.inventory.items().find((item) => item.name === 'blaze_rod');
  assert.ok(focus, `Joining player should receive a focus: ${caster.inventory.items().map((item) => item.displayName)}`);
  await caster.equip(focus, 'hand');
  const menuOpened = new Promise((resolve) => caster.once('windowOpen', resolve));
  caster.setControlState('sneak', true);
  caster.activateItem();
  const menu = await Promise.race([menuOpened, sleep(3000).then(() => { throw new Error('Sneak-use did not open focus binding menu'); })]);
  caster.setControlState('sneak', false);
  assert.equal(menu.slots[12]?.name, 'diamond', 'Controller binding menu should include diamond prospecting');
  await caster.clickWindow(12, 0, 0);
  await sleep(250);
  assert.ok(packets[0].chats.some((line) => line.includes('法杖已绑定 探钻石')),
    `Binding click should select diamond: ${packets[0].chats}`);
  assert.equal(packets[1].bars.length, 0, 'Bystander must not receive the caster bossbar');
  const casterSpawnBefore = packets[0].spawns.length;
  const otherSpawnBefore = packets[1].spawns.length;
  caster.activateItem();
  await sleep(1000);
  assert.ok(packets[0].chats.some((line) => line.includes('探矿术找到钻石矿')),
    `One use should cast the bound skill: ${packets[0].chats}`);
  assert.ok(packets[0].bars.some((bar) => JSON.stringify(bar).includes('钻石矿')),
    'Caster should receive ore type and direction on bossbar');
  assert.equal(packets[1].bars.length, 0, 'Bystander should not see ore bossbar');
  const newSpawns = packets[0].spawns.slice(casterSpawnBefore);
  const bystanderSpawns = packets[1].spawns.slice(otherSpawnBefore);
  const oreMarker = (packet) => Math.abs(packet.x - 317) < 0.1
    && Math.abs(packet.y - 115) < 0.1 && Math.abs(packet.z - 17) < 0.1;
  assert.ok(newSpawns.some(oreMarker), `Only caster should receive outline entity: ${JSON.stringify(newSpawns)}`);
  assert.ok(!bystanderSpawns.some(oreMarker), `Outline leaked to bystander: ${JSON.stringify(bystanderSpawns)}`);
  assert.ok(packets[0].particles.length >= 8, 'Caster should receive a projected surface frame');
  assert.equal(packets[1].particles.length, 0, 'Bystander should not receive caster particles');
  assert.equal(packets[0].errors.length + packets[1].errors.length, 0,
    `Client errors: ${JSON.stringify(packets.map((entry) => entry.errors))}`);
  const marker = newSpawns.find(oreMarker);
  assert.ok(packets[0].metadata.some((entry) => entry.entityId === marker.entityId
    && entry.metadata.some((value) => value.key === 0 && (value.value & 64) !== 0)),
  'Ore display must carry the Java glowing flag');
  caster.chat('/mycli focus bind selfheal');
  await sleep(450);
  assert.ok(packets[0].chats.some((line) => line.includes('法杖已绑定 治疗自己')),
    'Binding another skill should update the held wand');
  rcon(`minecraft:damage ${names[0]} 8`);
  await sleep(200);
  const beforeHeal = caster.health;
  assert.ok(beforeHeal < 20, `Damage fixture should lower health: ${beforeHeal}`);
  caster.activateItem();
  await sleep(600);
  assert.ok(caster.health > beforeHeal + 1, `One use should cast selfheal: ${beforeHeal} -> ${caster.health}`);
  rcon('minecraft:setblock 317 115 17 minecraft:air');
  await sleep(650);
  assert.ok(packets[0].destroyed.some((entry) => entry.entityIds?.includes(marker.entityId)),
    `Outline should be removed when target ore disappears: ${JSON.stringify(packets[0].destroyed)}`);
  console.log(JSON.stringify({ verdict: 'PASS', focus: focus.displayName,
    outlineSpawns: newSpawns.filter(oreMarker).length, bystanderOutlineSpawns: bystanderSpawns.filter(oreMarker).length,
    casterParticles: packets[0].particles.length, bystanderParticles: packets[1].particles.length,
    glowFlag: true, health: { before: beforeHeal, after: caster.health }, outlineRemoved: true }));
} finally {
  bots.forEach((bot) => bot.quit());
}
