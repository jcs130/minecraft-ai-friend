import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { command } from '../../../ops/rcon-client.mjs';
import { installRecipePacketBypass } from '../../../ops/mineflayer-client-compat.mjs';

const stage = process.env.LOST_BEACON_STAGE;
const phase = process.env.QA_PHASE;
assert(stage && ['seed', 'camp', 'resume', 'settle', 'vault', 'legacy'].includes(phase));
assert.equal(await readFile(stage + '/.lost-beacon-qa', 'utf8'), 'SYNTHETIC_LOST_BEACON_ONLY');
const props = (await readFile(stage + '/server.properties', 'utf8')).split(/\r?\n/);
for (const line of ['server-ip=127.0.0.1','server-port=26471','rcon.port=26472']) assert(props.includes(line));
const require = createRequire(process.env.MINEFLAYER_PACKAGE);
const { createBot } = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const report = { phase, synthetic: true, checks: [], walks: [], stageReceipts: [] };
const clients = [];
const STATUS = '/mycli dungeon status aincrad_01 --json';
const MENU = '/mycli dungeon menu aincrad_01';
const STATE = 'MC_SITE_DUNGEON_STATE ';
const RESULT = 'MC_SITE_DUNGEON_RESULT ';
const rc = text => command(text, 15000, { port: 26472, properties: stage + '/server.properties' });

function check(what, condition) {
  report.checks.push({ what, passed: Boolean(condition) });
  console.log(condition ? 'PASS' : 'FAIL', what);
  assert(condition, what);
}

async function until(read, timeout, description) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await delay(300);
  }
  throw new Error('Timeout: ' + description);
}

async function capture(bot, request, prefix) {
  await delay(Math.max(0, (bot.lastCommandAt ?? 0) + 1250 - Date.now()));
  const start = bot.lines.length;
  bot.lastCommandAt = Date.now();
  bot.chat(request);
  const line = await until(() => bot.lines.slice(start).find(l => l.startsWith(prefix)), 8000, request);
  return JSON.parse(line.slice(prefix.length));
}

const state = bot => capture(bot, STATUS, STATE);
async function awaitState(bot, predicate, label, timeout = 16000) {
  const result = await until(async () => {
    const current = await state(bot);
    return predicate(current) ? current : null;
  }, timeout, label);
  report.stageReceipts.push({ label, run: result.run, phase: result.phase, chapter: result.chapter?.node });
  return result;
}

async function qa(cmd = 'status') {
  const output = await rc('beaconqa ' + cmd);
  const match = output.match(/BEACON_QA (\{[^\r\n]*\})/u);
  assert(match, output);
  return JSON.parse(match[1]);
}

async function connect(username) {
  const bot = createBot({ host: '127.0.0.1', port: 26471, username, auth: 'offline', version: '1.21.1', hideErrors: true });
  clients.push(bot);
  bot.lines = [];
  bot.on('messagestr', line => bot.lines.push(line));
  bot.on('error', e => { bot.lastError = String(e); });
  bot.on('kicked', reason => { bot.lastError = String(reason); });
  bot.loadPlugin(pathfinder);
  installRecipePacketBypass(bot._client);
  await until(() => bot.entity && bot.player?.uuid || bot.lastError && Promise.reject(Error(bot.lastError)), 30000, username);
  return bot;
}

async function place(bot, [x, y, z], world = 'aincrad') {
  assert((await qa(`move ${bot.username} ${world} ${x + 0.5} ${y} ${z + 0.5}`)).moved);
  await until(() => bot.entity.position.distanceTo(new Vec3(x + 0.5, y, z + 0.5)) < 1.2, 8000, 'fixture arrival');
  await bot.waitForChunksToLoad();
}

async function walk(bot, [x, y, z], radius = 1) {
  const start = bot.entity.position.clone();
  const moves = new Movements(bot);
  moves.canDig = false;
  moves.allow1by1towers = false;
  moves.allowParkour = false;
  moves.scafoldingBlocks = [];
  moves.maxDropDown = 2;
  bot.pathfinder.thinkTimeout = 4000;
  bot.pathfinder.setMovements(moves);
  const goal = new goals.GoalNear(x, y, z, radius);
  const timeout = setTimeout(() => bot.pathfinder.setGoal(null), 52000);
  try { await bot.pathfinder.goto(goal); }
  finally { clearTimeout(timeout); }
  const finish = bot.entity.position.clone();
  const distance = Math.hypot(finish.x - (x + .5), finish.y - y, finish.z - (z + .5));
  report.walks.push({ start, target: [x,y,z], finish });
  check('walk without digging ' + [x,y,z].join(','), distance < radius + 2);
}

async function choice(bot, id, expected = true) {
  const current = await state(bot);
  const offered = current.chapter?.options.find(choice => choice.id === id);
  assert(offered, JSON.stringify({id, current}));
  assert.equal(offered.available, expected, offered.reason);
  return { offered, result: await capture(bot, offered.command, RESULT) };
}

async function onMenu(bot, slot, item) {
  await delay(Math.max(0, (bot.lastCommandAt ?? 0) + 1250 - Date.now()));
  bot.lastCommandAt = Date.now();
  bot.chat(MENU);
  await until(() => bot.currentWindow?.slots[slot]?.name === item, 7000, 'chapter menu slot ' + slot);
  await bot.clickWindow(slot, 0, 0);
  await delay(350);
  if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
}

async function prepare(bot) {
  const profile = () => capture(bot, '/mycli profession status --json', 'MC_RPG ');
  const ready = await until(async () => {
    const value = await profile();
    return typeof value.class === 'string' && value;
  }, 18000, 'Vortex profile loaded');
  if (ready.class === 'none') {
    const result = await capture(bot, '/mycli profession choose knight --json', 'MC_RPG ');
    assert.notEqual(result.success, false, JSON.stringify(result));
  }
  await until(async () => (await profile()).class === 'knight', 10000, 'actual Vortex class');
  await qa('equip ' + bot.username);
}

async function begin(bot) {
  const start = await capture(bot, '/mycli dungeon start aincrad_01 normal --json', RESULT);
  check('start accepted by actual profession and equipment rules', start.success);
  return awaitState(bot, s => s.chapter?.node === 'briefing' && s.chapter.options.length === 5,
    'briefing after muster', 22000);
}

try {
  const host = await connect('BeaconHostQA');
  if (phase === 'seed') {
    await prepare(host);
    await place(host, [856,69,-1144]);
    const intro = await begin(host);
    check('seven-node chapter and explicit route options available', intro.chapter.nodes === 7 && intro.chapter.options.some(o => o.id === 'scout'));
    await onMenu(host, 36, 'amethyst_shard');
    check('native inventory click applies personal blessing', (await state(host)).chapter.boon?.id === 'edge');
    const other = intro.chapter.options.find(o => o.id === 'gate');
    const scout = await choice(host, 'scout');
    check('scout route saved', scout.result.success && scout.result.changed && scout.result.chapter.opening === 'scout');
    const repeat = await capture(host, scout.offered.command, RESULT);
    check('same token is read back without applying again', repeat.success && !repeat.changed && repeat.reason === 'already_applied');
    check('conflicting old option rejected', !(await capture(host, other.command, RESULT)).success);
    const remote = await choice(host, 'survey_west', false);
    check('cannot scout from briefing', !remote.result.success && remote.result.reason === 'go_to_beacon_room');
    await walk(host, [844,69,-1210], 2);
    await walk(host, [804,69,-1210]);
    const west = await choice(host, 'survey_west');
    check('first mark alone cannot finish scouting', west.result.chapter.surveyMarks === 1 && west.result.chapter.node === 'scout');
    await walk(host, [812,69,-1210]);
    const east = await choice(host, 'survey_east');
    check('both surveyed markers advance to rescue', east.result.chapter.surveyMarks === 2 && east.result.chapter.node === 'rescue');
    await walk(host, [774,69,-1165]);
    const releaseBlock = host.blockAt(new Vec3(774,68,-1165));
    assert(releaseBlock && releaseBlock.name !== 'air');
    await host.activateBlock(releaseBlock);
    await awaitState(host, s => s.chapter?.rescue === 'escorting', 'native block interaction starts escort');
    const startActor = await until(async () => (await qa()).actors.find(e => e.role === 'escort'), 8500, 'loaded escort body');
    check('real escort is alive at start', startActor.type === 'VILLAGER' && startActor.health > 0);
    const moving = until(async () => {
      const actor = (await qa()).actors.find(e => e.id === startActor.id);
      return actor && actor.health > 0
        && Math.hypot(actor.position[0] - startActor.position[0], actor.position[2] - startActor.position[2]) > 1 ? actor : null;
    }, 20000, 'same NPC moves on foot');
    const [moved] = await Promise.all([moving, walk(host, [777,69,-1160], 1)]);
    check('same living escort moved through the passage', moved.health > 0);
    const camp = await awaitState(host, s => s.chapter?.node === 'camp', 'safe escort arrival', 26000);
    check('rescue progress requires the entity to reach safety', camp.chapter.rescue === 'safe');
    await saveAtCamp(host, intro.run);
  } else if (phase === 'camp') {
    const camp = await awaitState(host, s => s.participant && !s.paused && s.chapter?.node === 'camp', 'rejoin camp');
    check('same run resumes with real completed escort after disconnect', camp.chapter.rescue === 'safe');
    await saveAtCamp(host, camp.run);
  } else if (phase === 'resume') {
    const expected = JSON.parse(await readFile(stage+'/beacon-restart-expected.json', 'utf8'));
    const resumed = await awaitState(host, s => s.participant && !s.paused, 'present original synthetic member');
    check('same run and route continue through a normal restart', resumed.run === expected.run
      && resumed.chapter.opening === 'scout' && resumed.chapter.finale === 'altar' && resumed.chapter.boon?.id === 'ward');
    await walk(host, [862,69,-1119], 2);
    await walk(host, [789,78,-1117], 2);
    const first = resumed.chapter.options.find(o => o.id === 'seal_north');
    await walk(host, first.target);
    const north = await choice(host, 'seal_north');
    check('a single seal cannot disarm the boss', !north.result.chapter.altarDisabled);
    const second = north.result.chapter.options.find(o => o.id === 'seal_south');
    await walk(host, second.target);
    const south = await choice(host, 'seal_south');
    check('both elevated seals disable shockwave', south.result.chapter.altarDisabled && south.result.chapter.node === 'boss');
    await walk(host, [825,72,-1120], 1);
    await walk(host, [826,70,-1128], 1);
    await walk(host, [826,69,-1160], 2);
    await qa('steady '+host.username+' true');
    await awaitState(host, s => s.phase === 'fighting' && s.remainingMobs === 3, 'native boss and two guards');
    await delay(7800);
    check('disarmed boss has no shockwave intent in actual combat', !(await state(host)).chapter.intent);
    const mob = () => Object.values(host.entities).find(e => e.name === 'vindicator' && e.position.distanceTo(host.entity.position) < 3);
    const target = await until(mob, 10000, 'boss approaches the player');
    const before = (await qa()).actors.find(e => e.type === 'VINDICATOR').health;
    await host.lookAt(target.position.offset(0,1,0), true);
    host.attack(target);
    await delay(900);
    check('ordinary Java protocol attack changes real boss health', (await qa()).actors.find(e => e.type === 'VINDICATOR').health < before);
    check('remaining real mob deaths finalize the room', (await qa('damage '+host.username)).killed === 3);
    await finish(host, 4);
  } else if (phase === 'settle') {
    await finish(host, 4);
    await rc('stop');
  } else if (phase === 'vault') {
    const mate = await connect('BeaconMateQA');
    const visitor = await connect('BeaconVisitorQA');
    await prepare(host);
    await prepare(mate);
    await qa('equip '+visitor.username);
    await place(host, [856,69,-1144]);
    await place(mate, [858,69,-1144]);
    const start = await begin(host);
    check('second eligible player joins same real chapter automatically', (await state(mate)).run === start.run && (await state(mate)).participant);
    await choice(host, 'gate');
    await place(host, [844,69,-1210]);
    await place(mate, [844,69,-1211]);
    await awaitState(host, s => s.phase === 'fighting' && s.remainingMobs === 3, 'gate three enemies');
    await qa('damage '+host.username);
    await awaitState(host, s => s.chapter?.node === 'rescue', 'gate clear');
    await place(host, [774,69,-1165]);
    await choice(host, 'release');
    await until(async () => (await qa()).actors.some(e => e.role === 'escort'), 8000, 'released escort');
    check('synthetic escort death injected once', (await qa('escort-fail')).terminated === 1);
    await awaitState(host, s => s.chapter?.rescue === 'stranded', 'fallback recovery');
    check('fallback proceeds only after actual marked interaction', (await choice(host,'salvage')).result.chapter.rescue === 'beacon_recovered');
    await place(host, [824,69,-1118]);
    await place(mate, [823,69,-1118]);
    await choice(host, 'vault');
    await walk(host, [850,69,-1123], 2);
    await place(mate, [850,69,-1122]);
    await awaitState(host, s => s.phase === 'fighting' && s.remainingMobs === 3, 'vault elite and guards');
    await qa('damage '+host.username);
    await awaitState(host, s => s.chapter?.node === 'boss', 'vault clear');
    await place(host, [826,69,-1160]);
    await place(mate, [825,69,-1160]);
    await qa('steady '+host.username+' true');
    await qa('steady '+mate.username+' true');
    await awaitState(host, s => s.phase === 'fighting' && s.remainingMobs === 3, 'vault boss combat');
    const enemies = (await qa()).actors.filter(e => e.role === 'enemy');
    const boss = enemies.find(e => e.type === 'VINDICATOR');
    assert(boss && enemies.length === 3);
    for (const enemy of enemies) {
      assert.match(enemy.id, /^[a-f0-9-]{36}$/);
      await rc('minecraft:data merge entity ' + enemy.id + ' {NoAI:1b}');
    }
    await place(host, boss.position.map(Math.floor));
    await place(mate, [boss.position[0] < 826 ? 832 : 820,69,-1160]);
    const affected = await qa('steady '+host.username+' false');
    const unaffected = await qa('steady '+mate.username+' false');
    const intent = await awaitState(host, s => s.chapter?.intent?.id === 'shockwave', 'actual shockwave tell', 18000);
    check('vault keeps boss shockwave with real center and radius', !intent.chapter.altarDisabled && intent.chapter.intent.radius === 4);
    await delay(Math.max(0, intent.chapter.intent.resolvesAt - Date.now()) + 1350);
    const impact = (await qa()).players;
    check('shockwave damages only the player inside the announced circle',
      impact.find(p => p.name === host.username).health < affected.health
      && impact.find(p => p.name === mate.username).health === unaffected.health);
    const visitorMove = await qa(`move ${visitor.username} aincrad 826.5 69 -1160.5`);
    check('unqualified visitor cannot enter active boss room', !visitorMove.moved);
    await qa('damage '+host.username);
    await finish(host, 6);
    const team = (await qa()).players.find(p => p.name === mate.username);
    check('real second participant receives same chapter receipt and returns', team.rewardCount === 6
      && Math.hypot(team.position[0]-856.5, team.position[2]+1143.5) < 4);
  } else {
    const outsider = await connect('BeaconVisitorQA');
    await prepare(host);
    await place(host, [856,69,-1144]);
    const old = await state(host);
    check('new chapter leaves the original run signature and two rooms intact',
      old.active && !old.chapter && old.stage === 3 && old.paused && old.fault === 'data_unavailable');
    const denied = await capture(outsider, '/mycli dungeon resume --json', RESULT);
    check('old storage checkpoint unavailable to anyone outside original attendance', !denied.success);
    const rejoined = await capture(host, '/mycli dungeon resume --json', RESULT);
    check('recorded original member can recover old checkpoint', rejoined.success && rejoined.run === old.run);
    const now = await awaitState(host, s => !s.paused && s.participant, 'legacy restored');
    check('recovery keeps exact identity and old cleared room count',
      now.run === old.run && now.stage === 3 && now.attendance === 2 && !now.chapter);
  }

  async function finish(bot, count) {
    const ended = await awaitState(bot, s => !s.active && s.outcomeKnown, 'durable settlement', 18000);
    check('chapter recorded as completed with a bounded reward', ended.lastOutcome?.reason === 'completed'
      && ended.lastOutcome?.chapter?.version === 'lost_beacon_v1');
    const returned = await until(async () => {
      const actor = (await qa()).players.find(p => p.name === bot.username);
      return Math.hypot(actor.position[0]-856.5, actor.position[2]+1143.5) < 4 && actor;
    }, 16000, 'actual automatic return');
    check('server returned player to pre-existing safe landing', returned.rewardCount === count);
    const first = await capture(bot, '/mycli dungeon claim aincrad_01 --json', RESULT);
    const second = await capture(bot, '/mycli dungeon claim aincrad_01 --json', RESULT);
    const saved = (await qa()).players.find(p => p.name === bot.username);
    check('reward receipt claimed exactly once', first.success && !second.success && saved.claimedRun === returned.rewardRun && saved.rewardCount === 0);
    await delay(Math.max(0, (bot.lastCommandAt ?? 0) + 1250 - Date.now()));
    bot.lastCommandAt = Date.now();
    bot.chat('/mycli arena stash');
    const window = await until(() => bot.currentWindow?.inventoryStart === 54 && bot.currentWindow, 10000, 'real personal chest');
    await delay(400);
    const items = window.slots.slice(0, 54).filter(Boolean);
    const total = name => items.filter(i => i.name === name).reduce((sum, item) => sum + item.count, 0);
    check('actual personal chest contains the bounded material and emerald award', total('iron_ingot') === count && total('emerald') === 12);
    bot.closeWindow(window);
  }

  async function saveAtCamp(bot, run) {
    await walk(bot, [824,69,-1118], 1);
    const ward = await choice(bot, 'ward');
    check('rescue lets camp upgrade one personal blessing', ward.result.chapter.boon?.id === 'ward' && ward.result.chapter.boon.strength === 3);
    const altar = await choice(bot, 'altar');
    check('camp route and blessing are persisted together', altar.result.chapter.finale === 'altar' && altar.result.chapter.boon.id === 'ward');
    await writeFile(stage + '/beacon-restart-expected.json', JSON.stringify({ run, progress: altar.result.chapter }));
    await rc('stop');
  }
} catch (error) {
  report.error = String(error);
  report.playerStates = clients.map(bot => ({ name: bot.username, error: bot.lastError,
    lines: bot.lines.slice(-8), position: bot.entity?.position }));
  throw error;
} finally {
  for (const bot of clients) bot.quit();
  await writeFile(stage + '/beacon-' + phase + '.json', JSON.stringify(report, null, 2));
}
