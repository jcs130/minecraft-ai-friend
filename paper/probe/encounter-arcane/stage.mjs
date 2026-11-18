import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { command } from '../../ops/rcon-client.mjs';

const stage = await realpath(process.env.ENCOUNTER_ARCANE_STAGE);
const properties = path.join(stage, 'server.properties');
assert.equal((await readFile(path.join(stage, '.encounter-arcane-qa'), 'utf8')).trim(),
  'SYNTHETIC_ENCOUNTER_ARCANE_ONLY');
const props = (await readFile(properties, 'utf8')).split(/\r?\n/);
for (const rule of ['server-ip=127.0.0.1', 'server-port=26924', 'rcon.port=26925', 'online-mode=false'])
  assert(props.includes(rule), rule);
const rcon = text => command(text, 7_000, { port: 26925, properties });
const require = createRequire(path.resolve(process.env.MINEFLAYER_PACKAGE));
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const usernames = { weapon: 'RuneArcaneQA', crypt: 'RuneCryptQA', tower: 'RuneTowerQA' };

async function until(test, label, timeout = 12_000) {
  for (const deadline = Date.now() + timeout; Date.now() < deadline;) {
    const value = await test();
    if (value) return value;
    await sleep(100);
  }
  throw Error('Timeout: ' + label);
}

const mode = process.argv[2];
assert(Object.hasOwn(usernames, mode), 'Use weapon, crypt or tower');
const dodge = process.argv.includes('--dodge');
const name = usernames[mode];
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 26924, version: '1.21.1',
  username: name, auth: 'offline', hideErrors: true });
const lines = [], cues = [], swings = [], states = [], warnings = [], effects = [];
let lastCommand = 0;
bot.on('messagestr', line => lines.push(line));
bot._client.on('set_title_subtitle', packet => cues.push(JSON.stringify(packet)));
bot._client.on('world_particles', packet => {
  if (packet.particle?.type === 'dust') warnings.push(packet);
});
bot._client.on('animation', packet => swings.push(packet));
bot._client.on('entity_effect', packet => effects.push(packet));
bot._client.on('custom_payload', packet => {
  if (packet.channel === 'mcagent:state') states.push(JSON.parse(Buffer.from(packet.data).toString('utf8')));
});
bot.on('kicked', reason => console.error('Kicked: ' + JSON.stringify(reason)));
bot.on('error', error => console.error(error.message));

async function ask(text, prefix) {
  await sleep(Math.max(0, 560 - (Date.now() - lastCommand)));
  const before = lines.length;
  bot.chat(text);
  lastCommand = Date.now();
  if (!prefix) return;
  return await until(() => lines.slice(before).find(line => line.startsWith(prefix)), text + ' ' + prefix, 6_000);
}

async function move(x, y, z) {
  await rcon('minecraft:tp ' + [name, x, y, z].join(' '));
  await until(() => bot.entity.position.distanceTo(new Vec3(x, y, z)) < 0.32, 'test position');
}

async function weapon() {
  await rcon('minecraft:forceload add 24 24');
  assert.match(await rcon('minecraft:fill 22 149 22 31 149 31 minecraft:stone'), /filled|填充|未填充|No blocks/i);
  await rcon('minecraft:setblock 25 150 25 minecraft:enchanting_table');
  await move(26.5, 150, 25.5);
  await rcon('minecraft:clear ' + name);
  await rcon('minecraft:give ' + name + ' minecraft:diamond_sword');
  await rcon('minecraft:give ' + name + ' minecraft:lapis_lazuli 12');
  await rcon('minecraft:experience set ' + name + ' 45 levels');
  const sword = await until(() => bot.inventory.items().find(item => item.name === 'diamond_sword'), 'native sword');
  await bot.equip(sword, 'hand');
  const prefix = 'MC_WEAPON_ENGRAVING preset=arcane_edge ';
  const triggerPattern = /weaponHit=(\w+) weaponUse=(\w+) weaponSneakUse=(\w+)/;
  const run = async (level, lapis) => {
    const receipt = await ask('/mycli imprint weapon arcane_edge', prefix);
    const match = triggerPattern.exec(receipt);
    assert(match, receipt);
    const [, hit, right, sneak] = match;
    assert(['selfheal', 'food', 'night'].includes(hit), receipt);
    assert(['echoing_strikes', 'starbolt', 'frostnova'].includes(right), receipt);
    assert(['counterspell', 'blink', 'frostnova', 'feather'].includes(sneak), receipt);
    assert(right === 'echoing_strikes' || sneak === 'counterspell', receipt);
    assert.equal(new Set([hit, right, sneak]).size, 3);
    await until(() => bot.experience.level === level && bot.inventory.count(bot.registry.itemsByName.lapis_lazuli.id) === lapis,
      'one exact charge and inventory sync');
    console.log('PASS ' + receipt + ' XP=' + level + ' lapis=' + lapis);
    return match[0];
  };
  const first = await run(30, 6);
  const second = await run(15, 0);
  assert.notEqual(second, first, 'paid reroll changes the combination');
  const mark = lines.length;
  await ask('/mycli imprint weapon arcane_edge');
  await until(() => lines.slice(mark).some(line => line.includes('武器刻印需要')), 'short of lapis');
  assert.equal(bot.experience.level, 15);
  assert(!lines.slice(mark).some(line => line.startsWith(prefix)));
  console.log('PASS insufficient lapis keeps the paid reroll and the remaining XP');
}

async function gear() {
  for (const [slot, item] of Object.entries({
    'armor.head': 'iron_helmet', 'armor.chest': 'iron_chestplate', 'armor.legs': 'iron_leggings',
    'armor.feet': 'iron_boots', 'weapon.mainhand': 'diamond_sword'
  })) await rcon('minecraft:item replace entity ' + name + ' ' + slot + ' with minecraft:' + item);
  await rcon('minecraft:give ' + name + ' minecraft:bow');
  await rcon('minecraft:give ' + name + ' minecraft:arrow 32');
}

const isCrypt = mode === 'crypt';
const auditCommand = isCrypt ? 'mycli admin dungeons audit' : 'mycli admin dungeonaudit';
async function wave(stageNumber) {
  return await until(async () => {
    const audit = await rcon(auditCommand);
    if (isCrypt && !audit.includes('stage=' + stageNumber + ' phase=fighting')) return;
    const prefix = isCrypt ? 'MC_SITE_DUNGEON_MOB site=undead_crypt ' : 'MC_DUNGEON_MOB floor=' + stageNumber + ' ';
    const members = [...audit.matchAll(new RegExp(prefix + 'id=([0-9a-f-]+) type=(\\w+)', 'g'))];
    return members.length ? members.map(([, id, type]) => ({ id, type })) : undefined;
  }, 'wave ' + stageNumber, 55_000);
}

async function watchMove(actor, moveId, label, shape) {
  const status = isCrypt ? '/mycli dungeon status undead_crypt --json' : '/mycli arena status --json';
  const prefix = isCrypt ? 'MC_SITE_DUNGEON_STATE ' : 'MC_TRIAL_STATE ';
  const sample = async () => JSON.parse((await ask(status, prefix)).slice(prefix.length));
  const matches = move => move.id === moveId && move.phase === 'windup'
    && move.sourceUuid === actor.id && move.remainingTicks >= 14;
  const warn = after => until(() => states.slice(after).flatMap(state => state.enemyMoves ?? [])
    .find(matches), label + ' private windup', 25_000);
  const entity = await until(() => Object.values(bot.entities).find(value => value.uuid === actor.id),
    'visible original body');
  await rcon('minecraft:effect clear ' + name);
  const health = bot.health;
  const swing = swings.length;
  const effectsBefore = effects.length;
  const windup = await warn(states.length);
  assert.equal(windup.shape, shape);
  assert(windup.response);
  assert(cues.some(text => text.includes(label)), 'native subtitle before impact');
  assert(warnings.length > 0, 'native outline packets before impact');
  const explicit = await sample();
  assert(explicit.enemyMoves?.some(move => move.id === moveId && move.sourceUuid === actor.id),
    'CLI and private state report the same active move');
  if (dodge) {
    const [x, y, z] = windup.origin;
    const [dx, dz] = windup.direction;
    const behind = [1.8, .8, .5].map(distance => new Vec3(x - dx * distance, y, z - dz * distance))
      .find(point => bot.blockAt(point)?.boundingBox === 'empty'
        && bot.blockAt(point.offset(0, 1, 0))?.boundingBox === 'empty'
        && bot.blockAt(point.offset(0, -1, 0))?.boundingBox === 'block');
    assert(behind, 'safe staging point behind the marked attack');
    await move(behind.x, behind.y, behind.z);
  }
  await until(() => swings.slice(swing).some(packet => packet.entityId === entity.id && packet.animation === 0),
    label + ' native swing');
  if (dodge) {
    await sleep(300);
    assert.equal(bot.health, health, 'outside danger at impact');
    console.log('PASS ' + label + ' safe behind the frozen facing');
  } else {
    await until(() => bot.health < health, label + ' normal damage pipeline');
    if (!isCrypt) {
      const slow = bot.registry.effectsByName.Slowness.id;
      const effect = await until(() => effects.slice(effectsBefore).find(packet => packet.entityId === bot.entity.id
        && packet.effectId === slow && packet.duration === 50), 'native 50-tick slowness', 3_000);
      assert.equal(effect.amplifier, 0);
      assert.equal(effect.duration, 50);
      console.log('PASS ' + label + ' Slowness I for 50 ticks');
    }
    console.log('PASS ' + label + ' visible warning, own UUID, geometry, native swing and impact ' + health + ' -> ' + bot.health);
  }

  await rcon('minecraft:kill ' + actor.id);
  await until(async () => !(await sample()).enemyMoves?.length, 'cleared move state');
  console.log('PASS defeated body has no active move');
}

async function encounter() {
  await rcon('minecraft:gamemode survival ' + name);
  await gear();
  // Isolate the authored attack from ordinary wave damage during fixture setup.
  await rcon('minecraft:effect give ' + name + ' minecraft:resistance 600 4 true');
  await rcon('minecraft:effect give ' + name + ' minecraft:instant_health 1 3 true');
  await until(() => bot.health >= 19, 'healthy synthetic participant');
  const rooms = [[-424.5, 4, 677.5], [-419.5, 4, 649.5], [-424.5, 0, 663.5]];
  const audit = await rcon(auditCommand);
  const room = isCrypt
    ? /id=undead_crypt rooms=3 active=true stage=([1-3]) phase=(?:moving|fighting)/.exec(audit)
    : /MC_DUNGEON_AUDIT floor=([1-3]) active=true/.exec(audit);
  const first = room ? Number(room[1]) : 1;
  if (isCrypt) {
    if (!room) {
      await move(...rooms[0]);
      const prefix = 'MC_SITE_DUNGEON_RESULT ';
      const request = async action => JSON.parse((await ask('/mycli dungeon ' + action + ' --json', prefix)).slice(prefix.length));
      let result = await request('start undead_crypt normal');
      if (result.reason === 'claim_previous_reward_first') {
        assert.equal((await request('claim undead_crypt')).success, true);
        result = await request('start undead_crypt normal');
      }
      assert.equal(result.success, true, result.reason);
    }
  } else if (!room) {
    await move(-593.5, 91, -312.5);
    await ask('/mycli arena difficulty adventure', 'MC_DUNGEON_DIFFICULTY ');
    const prefix = 'MC_TRIAL_STATE ';
    const readiness = JSON.parse((await ask('/mycli arena status --json', prefix)).slice(prefix.length));
    if (readiness.retryAfterMs > 0) await sleep(readiness.retryAfterMs + 500);
    await ask('/mycli arena start', 'MC_DUNGEON_START ');
  }
  if (!isCrypt) await rcon('minecraft:gamemode creative ' + name);
  for (let number = first; number <= 3; number++) {
    if (isCrypt && (room || number > 1)) await move(...rooms[number - 1]);
    const members = await wave(number);
    const actor = number === 3 ? members.find(member => member.type === 'VINDICATOR') : undefined;
    if (actor) {
      const tag = isCrypt ? 'afu_site_undead_crypt' : 'afu_dungeon_mob';
      await rcon('minecraft:execute as @e[tag=' + tag + '] run minecraft:data merge entity @s {NoAI:1b}');
    }
    for (const member of members) if (member !== actor) await rcon('minecraft:kill ' + member.id);
    if (number < 3) {
      if (isCrypt) await until(() => lines.some(line => line.includes('步行前往下一室：' + ['霜骨侧殿', '封印主墓'][number - 1])),
        'walk to next room');
      continue;
    }
    assert(actor, 'original authored Vindicator');
    const entity = await until(() => Object.values(bot.entities).find(value => value.uuid === actor.id), 'original Vindicator');
    const facing = bot.entity.position.minus(entity.position).normalize();
    await rcon('minecraft:data merge entity ' + actor.id + ' {NoAI:1b}');
    assert.match(await rcon('minecraft:data get entity ' + actor.id + ' NoAI'), /1b\b/);
    await rcon('minecraft:attribute ' + actor.id + ' minecraft:generic.attack_damage base set 0');
    await rcon('minecraft:item replace entity ' + actor.id + ' weapon.mainhand with minecraft:air');
    const reach = isCrypt ? 2.4 : 3.5;
    await move(entity.position.x + facing.x * reach, entity.position.y, entity.position.z + facing.z * reach);
    for (const type of ['arrow', 'potion', 'area_effect_cloud']) {
      await rcon('minecraft:execute at ' + name + ' run minecraft:kill @e[type=minecraft:' + type + ',distance=..24]');
    }
    if (!isCrypt) await rcon('minecraft:gamemode survival ' + name);
    await rcon('minecraft:effect give ' + name + ' minecraft:instant_health 1 3 true');
    await watchMove(actor, isCrypt ? 'grave_cleave' : 'frost_line', isCrypt ? '封印重劈' : '霜痕直劈', isCrypt ? 'arc' : 'line');
  }
}

try {
  await until(() => bot.entity?.position && bot.world.getColumnAt(bot.entity.position), 'login', 35_000);
  bot._client.write('custom_payload', { channel: 'minecraft:register', data: Buffer.from('mcagent:state') });
  await sleep(1_200);
  if (mode === 'weapon') await weapon();
  else await encounter();
} catch (error) {
  console.error(lines.filter(line => !line.startsWith('MC_')).slice(-8));
  throw error;
} finally {
  bot.quit();
}
