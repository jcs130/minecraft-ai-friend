import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { command } from '../../ops/rcon-client.mjs';
import { installRecipePacketBypass } from '../../ops/mineflayer-client-compat.mjs';
import { observeQiandengji } from '../../integrations/agent-portal/skill/assets/runtime/qiandengji/protocol.mjs';

const stage = await realpath(process.env.HEALING_CIRCLE_STAGE);
assert.equal((await readFile(path.join(stage, '.healing-circle-qa'), 'utf8')).trim(), 'SYNTHETIC_HEALING_CIRCLE_ONLY');
const properties = path.join(stage, 'server.properties');
const props = (await readFile(properties, 'utf8')).split(/\r?\n/);
for (const rule of ['server-ip=127.0.0.1', 'server-port=26914', 'rcon.port=26915', 'online-mode=false'])
  assert(props.includes(rule), rule);
const rc = (text, timeout = 5000) => command(text, timeout, { port: 26915, properties });
const mf = createRequire(path.resolve(process.env.MINEFLAYER_PACKAGE))('mineflayer');
const bots = [];
const checks = [];
const check = (label, value) => {
  assert(value, label);
  checks.push(label);
  console.log('PASS ' + label);
};
async function until(predicate, label, timeout = 9000) {
  for (const limit = Date.now() + timeout; Date.now() < limit;) {
    const result = await predicate();
    if (result) return result;
    await sleep(80);
  }
  throw Error('Timeout: ' + label);
}
async function connect(id) {
  const bot = mf.createBot({ host: '127.0.0.1', port: 26914, username: 'CircleQA' + id,
    version: '1.21.1', auth: 'offline', hideErrors: true });
  bots.push(bot);
  bot.lines = [];
  bot.on('messagestr', text => bot.lines.push(text));
  bot.on('actionBar', text => bot.lines.push(text.toString()));
  bot._client.on('action_bar', packet => {
    const line = JSON.stringify(packet);
    if(line.includes('毒藤将在黄圈内蔓延'))bot.lines.push(line);
  });
  bot.on('error', error => console.error(error.message));
  installRecipePacketBypass(bot._client);
  await until(() => bot.entity?.position && bot.world.getColumnAt(bot.entity.position), 'login', 35_000);
  await until(async () => (await rc('circleqa read ' + bot.username)).includes('"available":true'), 'Vortex profile');
  return bot;
}
async function chat(bot, text) {
  const mark = bot.lines.length;
  bot.chat(text);
  await sleep(180);
  return mark;
}
async function json(bot, text) {
  const mark = await chat(bot, text + ' --json');
  const line = await until(() => bot.lines.slice(mark).find(s => s.startsWith('MC_RPG ')), text);
  return JSON.parse(line.slice('MC_RPG '.length));
}
async function read(bot) {
  const text = await rc('circleqa read ' + bot.username);
  const start = text.indexOf('{');
  assert(start >= 0, text);
  return JSON.parse(text.slice(start));
}
async function qa(action, bot, value = '') {
  const result = await rc(('circleqa ' + action + ' ' + bot.username + ' ' + value).trim());
  assert.match(result, /CIRCLE_QA_OK/);
}
async function role(bot, role) {
  if ((await read(bot)).combat === role) return;
  await chat(bot, '/mycli profession choose ' + role);
  await until(async () => (await read(bot)).combat === role, 'select ' + role);
}
async function position(bot, x, y, z) {
  await rc(`minecraft:tp ${bot.username} ${x} ${y} ${z}`);
  await until(() => bot.entity.position.distanceTo({ x, y, z }) < 0.1, 'teleport');
}
async function inAltar(bot, point) {
  await rc(`minecraft:execute in minecraft:aincrad run minecraft:tp ${bot.username} ${point.join(' ')}`);
  await until(() => bot.entity.position.distanceTo({ x: point[0], y: point[1], z: point[2] }) < 0.15, 'altar room');
}

async function altar() {
  assert.match(await rc('circleqa world', 40_000), /CIRCLE_QA_WORLD/);
  const audit = await rc('mycli admin dungeons audit');
  if (!audit.includes('ready=true sites=1')) assert.match(await rc('mycli admin dungeons reload'), /ready=true sites=1/);
  const full = process.argv.includes('--full');
  const priest = await connect(full ? 5 : 4);
  const mage = process.argv.includes('--counter') ? await connect(7) : null;
  if (mage) {
    await role(mage, 'mage');
    await qa('train', mage);
    await qa('gear', mage);
    check('mage uses the original profession learning path for counterspell',
      (await json(mage, '/mycli skills learn counterspell')).success === true
      || (await read(mage)).abilities.some(a => a.id === 'mycli:counterspell' && a.source === 'profession'));
  }
  await role(priest, 'cleric');
  const initial = await read(priest);
  check('the new altar starts with neither entitlement nor learned skill',
    !initial.altarProof && !initial.healingCircle.learned);
  await qa('gear', priest);
  await qa(full ? 'full-wheel' : 'empty-slot', priest);
  const points = initial.skillPoints;
  const rooms = [[8212.5, 80, 8717.5], [8222.5, 80, 8747.5], [8205.5, 81, 8736.5]];
  const active = /active=true stage=(\d+)/.exec(audit);
  const from = active ? Number(active[1])-1 : 0;
  await inAltar(priest, rooms[from]);
  if (!active) await chat(priest, '/mycli dungeon start jungle_covenant normal');
  const defeated = () => rc('minecraft:execute in minecraft:aincrad run minecraft:kill @e[tag=afu_site_jungle_covenant]');
  for (let i = from; i < rooms.length; i++) {
    if (i > from) await inAltar(priest, rooms[i]);
    if (i === 2 && mage) await inAltar(mage, [rooms[i][0]+2, rooms[i][1], rooms[i][2]]);
    await until(() => Object.values(priest.entities).some(e => e.name === 'witch' || e.name === 'spider'
      || e.name === 'zombie' || e.name === 'skeleton'), 'new room mobs', 25_000);
    // Focus this probe on a real combat state and loot transaction rather than long boss damage tuning.
    if (i === 2 && !full) {
      const adds = await rc('mycli admin dungeons audit');
      const disposable = [...adds.matchAll(/MC_SITE_DUNGEON_MOB site=jungle_covenant id=([0-9a-f-]+) type=(WITCH|SPIDER) health=([\d.]+)/g)]
        .filter(row => Number(row[3]) < 100);
      for (const [, id] of disposable) await rc('minecraft:execute in minecraft:aincrad run minecraft:kill ' + id);
      await qa('health', priest, '1000');
      const cue = priest.lines.length;
      await until(() => priest.lines.slice(cue).some(message => message.includes('毒藤将在黄圈内蔓延')),
        'visible poison warning', 24_000);
      check('poison telegraphs in the final room before the first pulse', !((await read(priest)).altarProof));
      if (mage) {
        const ready = await read(mage);
        check('a caster with range and visibility sees a current interrupt opportunity', ready.interruptOpportunity?.ready);
        check('counterspell interrupts the live boss cast', (await json(mage, '/mycli cast counterspell')).success === true);
        const stopped = await read(mage);
        check('same successful counter reports the real interruption and clears the opportunity',
          stopped.lastTechniqueEffect?.phase === 'interrupted' && !stopped.interruptOpportunity);
      }
    }
    await sleep(1500);
    const cleared = priest.lines.length;
    assert.doesNotMatch(await defeated(), /错误|未找到实体|No entity/);
    await until(() => priest.lines.slice(cleared).some(line => line.includes(i === 2 ? '全场通关' : '步行前往下一室：')),
      'room advance', 12_000);
  }
  const reward = await until(async () => {
    const state = await read(priest);
    return state.altarProof && state.lootPending && state;
  }, 'personal loot and learning proof');
  check('altar writes a free learning proof and the normal loot receipt', reward.altarProof && reward.lootPending);
  if (!priest.currentWindow) await chat(priest, '/mycli dungeon menu jungle_covenant');
  await until(() => priest.currentWindow?.slots[33]?.name === 'glistering_melon_slice', 'one-click learn button');
  await priest.clickWindow(33, 0, 0);
  await until(async () => (await read(priest)).healingCircle.learned, 'reward learning committed');
  const saved = await read(priest);
  check('free learning charges zero points and leaves the ordinary receipt alone',
    saved.skillPoints === points && saved.lootPending && saved.altarProof);
  if (full) {
    await until(() => priest.currentWindow?.slots[19], 'replacement menu');
    check('a full wheel has no implicit replacement', saved.wheel[7] === 'feather' && !saved.wheel.includes('healing_circle'));
    await priest.clickWindow(19, 0, 0);
  }
  await until(async () => (await read(priest)).wheel?.[7] === 'healing_circle', 'binding saved');
  check('the first empty or explicitly chosen slot is persisted', (await read(priest)).wheel[7] === 'healing_circle');
  if (priest.currentWindow) priest.closeWindow(priest.currentWindow);
  await chat(priest, '/mycli dungeon claim jungle_covenant');
  await until(async () => (await read(priest)).lootClaimed, 'ordinary loot claimed');
  await chat(priest, '/mycli dungeon claim jungle_covenant');
  check('repeating the ordinary claim keeps the same free unlock', !(await read(priest)).lootPending
    && (await read(priest)).healingCircle.learned && (await read(priest)).skillPoints === points);
}

async function spell() {
  const priest = await connect(1);
  const ally = await connect(2);
  const stranger = await connect(3);
  await role(priest, 'cleric');
  await role(ally, 'knight');
  await role(stranger, 'mage');
  check('cleric sees the ground healing skill and training condition',
    (await json(priest, '/mycli skills info healing_circle')).skill?.requiredLevel === 3);
  check('other classes cannot cast', (await json(stranger, '/mycli cast healing_circle')).success === false);
  if (!process.argv.includes('--resume')) {
    check('unlearned cleric cannot cast', (await json(priest, '/mycli cast healing_circle')).success === false);
    await qa('train', priest);
    const points = (await read(priest)).skillPoints;
    check('ordinary Vortex learning succeeds', (await json(priest, '/mycli skills learn healing_circle')).success === true);
    check('one learning point spent', (await read(priest)).skillPoints === points - 1);
    check('repeat learning preserves points', (await json(priest, '/mycli skills learn healing_circle')).success === false
      && (await read(priest)).skillPoints === points - 1);
  }
  await rc('minecraft:gamerule naturalRegeneration false');
  await rc('minecraft:gamerule doMobSpawning false');
  await rc('minecraft:fill 20 119 20 38 119 38 minecraft:stone');
  await position(priest, 26.5, 120, 25.5);
  await position(ally, 26.5, 120, 28.5);
  await position(stranger, 28.5, 120, 28.5);
  await qa('health', priest, 10000);
  await qa('health', ally, 6);
  await qa('health', stranger, 6);
  await chat(priest, '/mycli guild party disband');
  check('full group context is required for the suggested cast', !(await read(priest)).healingCircle.suggestion);
  await chat(priest, '/mycli guild party create');
  await chat(priest, '/mycli guild party invite ' + ally.username);
  await chat(ally, '/mycli guild party accept');
  const observed = await until(async () => (await read(priest)).healingCircle.suggestion, 'authoritative support candidate');
  check('the observed candidate contains a legal ground, skill, and original action route',
    observed.id === 'healing_circle' && observed.ground.world === 'world' && observed.injuredAllies === 1);
  const observer = observeQiandengji(priest);
  const network = await until(() => observer.snapshot().states['mcagent:state']?.value, 'private native RPG packet');
  check('the game client observes the same legal spell and route',
    network.profession?.healingCircle?.suggestion?.invocation === observed.invocation
    && network.abilities.some(row => row.id === 'mycli:healing_circle' && row.manaCost === 10));
  const previousEffects = (await read(priest)).healingCircle.effects.length;
  await rc('minecraft:fill 24 120 27 28 123 27 minecraft:stone');
  check('a wall blocks tactical placement', !(await read(priest)).healingCircle.suggestion);
  const blocked = await json(priest, observed.invocation.replace(/ --json$/, ''));
  check('blocked action changes no placement or cooldown', blocked.success === false && blocked.changed === false
    && (await read(priest)).healingCircle.effects.length === previousEffects);
  await rc('minecraft:fill 24 120 27 28 123 27 minecraft:air');
  await qa('mana', priest, 0);
  check('insufficient mana hides the ready suggestion', !(await read(priest)).healingCircle.suggestion);
  await qa('mana', priest, 20);
  const before = await read(priest);
  const used = await json(priest, observed.invocation.replace(/ --json$/, ''));
  check('native ability receipt confirms the ground and starts the same operation',
    used.success && used.placed && used.phase === 'placed' && used.healing === 0 && used.requestId);
  check('Vortex charges ten mana for the original cast', used.resourceSpent === 10 && (await read(priest)).mana.current < before.mana.current - 8);
  const after = await until(async () => {
    const detail = (await read(priest)).healingCircle.effects.find(e => e.requestId === used.requestId);
    return detail?.phase === 'finished' && detail;
  }, 'six healing pulses', 13_000);
  const allyHealth = (await read(ally)).health;
  assert.deepEqual({ actualHealing: after.healedActors.find(actor => actor.uuid === ally.player.uuid)?.healing, allyHealth },
    { actualHealing: 6, allyHealth: 12 });
  check('six actual pulses recover six health on the same request', true);
  check('a nearby nonparty player receives zero healing', (await read(stranger)).health === 6);
  check('Vortex cooldown remains active after the field expires',
    (await read(priest)).abilities.find(a => a.id === 'mycli:healing_circle').cooldownRemainingMs > 0);
}

async function weapon() {
  const mage = await connect(3);
  await role(mage, 'mage');
  await qa('train', mage);
  await qa('gear', mage);
  await rc('minecraft:fill 20 119 20 38 119 38 minecraft:stone');
  await position(mage, 26.5, 120, 25.5);
  await rc('minecraft:setblock 25 120 25 minecraft:enchanting_table');
  await rc(`minecraft:experience set ${mage.username} 30 levels`);
  await rc(`minecraft:give ${mage.username} minecraft:lapis_lazuli 10`);
  mage.setQuickBarSlot(0);
  check('an off-class learner cannot permanently learn echo',
    (await json(mage, '/mycli skills learn echoing_strikes')).success === false);
  check('off-class ability is absent before a real engraving',
    !(await read(mage)).abilities.some(a => a.id === 'mycli:echoing_strikes'));
  const mark = await chat(mage, '/mycli imprint weapon arcane_edge');
  await until(() => mage.lines.slice(mark).some(line => line.includes('已镌刻魔剑')), 'real engraving transaction');
  const equipped = (await read(mage)).abilities.find(a => a.id === 'mycli:echoing_strikes');
  check('the engraved blade grants the canonical skill without permanent learning',
    equipped && equipped.manaCost === 8 && equipped.cooldownMs === 22_000 && equipped.source === 'weapon' && !equipped.learned);
  mage.setQuickBarSlot(1);
  await until(async () => !(await read(mage)).abilities.some(a => a.id === 'mycli:echoing_strikes'), 'unequip hides skill');
  check('unequipping rejects the same cast through CLI', (await json(mage, '/mycli cast echoing_strikes')).success === false);
  mage.setQuickBarSlot(0);
  await until(async () => (await read(mage)).abilities.some(a => a.id === 'mycli:echoing_strikes'), 'equipped technique');
  await qa('mana', mage, 20);
  check('an interrupt attempt without a real windup is rejected',
    (await json(mage, '/mycli cast counterspell')).reason === 'no_interruptible_cast');
  check('failed counterspell is refunded and has no cooldown',
    (await read(mage)).mana.current >= 19 &&
    (await read(mage)).abilities.find(a => a.id === 'mycli:counterspell').cooldownRemainingMs === 0);
  await rc('minecraft:time set night');
  await rc('minecraft:summon minecraft:zombie 26.5 120 27.5 {NoAI:1b,Silent:1b,PersistenceRequired:1b,Tags:["circle_echo_fixture"]}');
  const zombie = await until(() => Object.values(mage.entities).find(entity => entity.name === 'zombie'
    && mage.entity.position.distanceTo(entity.position) < 4), 'isolated zombie entity');
  check('equipped echo can be armed via the ordinary cast path',
    (await json(mage, '/mycli cast echoing_strikes')).success === true);
  const armed = (await read(mage)).lastTechniqueEffect;
  check('arming reports no damage before a melee hit', armed.phase === 'armed' && armed.damage === 0);
  await mage.lookAt(zombie.position.offset(0, 1, 0), true);
  mage.attack(zombie);
  const hit = await until(async () => {
    const effect = (await read(mage)).lastTechniqueEffect;
    return effect?.phase === 'hit' && effect;
  }, 'physical echo hit');
  check('a real melee hit produces bounded damage on the original cast', hit.damage > 0 && hit.damage <= 4
    && hit.operationId === armed.operationId);
  mage.setQuickBarSlot(1);
  await sleep(180);
  mage.setQuickBarSlot(0);
  check('reequipping does not bypass the existing skill cooldown',
    (await json(mage, '/mycli cast echoing_strikes')).reason === 'cooldown');
  await rc('minecraft:kill @e[tag=circle_echo_fixture]');
}

async function ranged() {
  const ranger = await connect(process.argv.includes('--fresh') ? 8 : 6);
  await role(ranger, 'ranger');
  const details = (await json(ranger, '/mycli skills info pinning_shot')).skill;
  check('ranger sees the level four and one-point learning gate', details?.requiredLevel === 4 && details.cost === 1);
  if (!(await read(ranger)).abilities.some(row => row.id === 'mycli:pinning_shot')) {
    check('a low-level ranger cannot learn the shot', (await json(ranger, '/mycli skills learn pinning_shot')).success === false);
    await qa('train', ranger);
    const before = await read(ranger);
    check('ranger learns the shot for one skill point', (await json(ranger, '/mycli skills learn pinning_shot')).success === true
      && (await read(ranger)).skillPoints === before.skillPoints-1);
  }
  await qa('gear', ranger);
  await rc('minecraft:fill 20 119 20 38 119 38 minecraft:stone');
  await position(ranger, 28.5, 120, 26.5);
  ranger.setQuickBarSlot(0);
  await qa('mana', ranger, 20);
  check('the shot requires a bow and refunds an invalid attempt', (await json(ranger, '/mycli cast pinning_shot')).reason === 'ranged_weapon_required'
    && (await read(ranger)).mana.current >= 20);
  ranger.setQuickBarSlot(1);
  await sleep(200);
  await rc('minecraft:time set night');
  await rc('minecraft:kill @e[tag=circle_pin_fixture]');
  await rc('minecraft:summon minecraft:zombie 28.5 120 33.5 {NoAI:1b,Silent:1b,PersistenceRequired:1b,Tags:["circle_pin_fixture"]}');
  const zombie = await until(() => Object.values(ranger.entities).find(e => e.name === 'zombie'
    && e.position.z >= 32 && ranger.entity.position.distanceTo(e.position) < 10), 'ranged test target');
  check('pinning shot arms for seven mana', (await json(ranger, '/mycli cast pinning_shot')).success === true
    && (await read(ranger)).abilities.find(a => a.id === 'mycli:pinning_shot')?.manaCost === 7);
  const armed = (await read(ranger)).lastTechniqueEffect;
  await ranger.lookAt(zombie.position.offset(0, 1.35, 0), true);
  ranger.activateItem();
  await sleep(1050);
  ranger.deactivateItem();
  const effect = await until(async () => {
    const row = (await read(ranger)).lastTechniqueEffect;
    return row?.phase === 'hit' && row;
  }, 'actual arrow slows its hit target', 5000);
  const amplifier = await rc('minecraft:data get entity ' + effect.targetUuid + ' active_effects[{id:"minecraft:slowness"}].amplifier');
  assert.match(amplifier, /(?:[:：]\s*)1b?\b/, JSON.stringify({ effect, amplifier }));
  check('the same arrow operation produces real Slowness II on the enemy', effect.operationId === armed.operationId
    && effect.slowTicks === 60);
  await rc('minecraft:kill ' + effect.targetUuid);
  if (process.argv.includes('--miss')) {
    await until(async () => (await read(ranger)).abilities.find(a => a.id === 'mycli:pinning_shot')?.cooldownRemainingMs === 0,
      'next active shot', 24_000);
    check('a second valid cast arms after the ordinary cooldown', (await json(ranger, '/mycli cast pinning_shot')).success === true);
    const next = (await read(ranger)).lastTechniqueEffect.operationId;
    await ranger.look(0, Math.PI/2-0.15, true);
    ranger.activateItem();await sleep(650);ranger.deactivateItem();
    await until(async () => {
      const state = (await read(ranger)).lastTechniqueEffect;
      return state?.operationId === next && state.phase === 'ended';
    }, 'miss is closed without a status effect', 7000);
    check('a missed arrow never reports a control effect', !(await read(ranger)).lastTechniqueEffect.slowTicks);
  }
}

async function manual() {
  const priest = await connect(4);
  await rc('minecraft:fill 20 119 20 38 119 38 minecraft:stone');
  await position(priest, 28.5, 120, 27.5);
  await qa('mana', priest, 20);
  await priest.lookAt(priest.entity.position.offset(0, 0, 2), true);
  await sleep(300);
  await chat(priest, '/mycli menu wheel');
  await until(() => priest.currentWindow?.slots[19]?.name === 'glistering_melon_slice', 'healing on the saved wheel');
  await priest.clickWindow(19, 0, 0);
  const effect = await until(async () => (await read(priest)).healingCircle.effects.at(-1), 'manual aimed placement');
  check('the original inventory wheel casts at the opening aim without a chat command', effect.phase === 'placed'
    && effect.resourceSpent === 10 && effect.ground.z >= 28 && effect.ground.z <= 31);
}

try {
  if (process.argv.includes('--altar')) await altar();
  else if (process.argv.includes('--weapon')) await weapon();
  else if (process.argv.includes('--ranged')) await ranged();
  else if (process.argv.includes('--manual')) await manual();
  else if (process.argv.includes('--restart')) {
    const priest = await connect(process.argv.includes('--full') ? 5 : 4);
    const state = await read(priest);
    check('restart preserves role, learned ability, slot, proof and completed loot', state.combat === 'cleric'
      && state.healingCircle.learned && state.wheel[7] === 'healing_circle' && state.altarProof && state.lootClaimed);
    check('restart does not replay any short-lived ground effect', state.healingCircle.effects.length === 0);
  } else await spell();
  console.log(JSON.stringify({ checks, failures: 0 }));
} catch (error) {
  for (const bot of bots) console.error(bot.username, bot.lines.slice(-14).join('\n'));
  throw error;
} finally {
  for (const bot of bots) bot.quit();
}
