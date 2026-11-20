import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';

const fixture = JSON.parse(fs.readFileSync(process.env.CHARACTER_QA_FIXTURE, 'utf8'));
const lab = path.resolve(fixture.lab);
assert.equal(fixture.synthetic, true);
assert.equal(fs.readFileSync(path.join(lab, '.native-body-qa'), 'utf8').trim(), 'SYNTHETIC_NATIVE_BODY_ONLY');
const properties = path.join(lab, 'server.properties');
const props = fs.readFileSync(properties, 'utf8');
for (const [key, value] of [['server-ip', '127.0.0.1'], ['server-port', fixture.gamePort], ['rcon.port', fixture.rconPort]]) {
  assert(props.split(/\r?\n/).includes(key + '=' + value));
}
const mineflayer = createRequire(process.env.MINEFLAYER_ANCHOR)('mineflayer');
const {command} = await import(pathToFileURL(process.env.RCON_CLIENT));
const rc = cmd => command(cmd, 20000, {properties, port: fixture.rconPort});
const clients = [], checks = [], receipts = [];
function check(description, value) { assert(value, description); checks.push(description); }
async function waitFor(read, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await delay(100);
  }
  throw Error('Timeout: ' + label);
}
async function connect(username) {
  const bot = mineflayer.createBot({host: '127.0.0.1', port: fixture.gamePort, username, auth: 'offline', version: '1.21.1', hideErrors: true});
  clients.push(bot);
  bot.lines = [];
  bot.on('messagestr', line => bot.lines.push(line));
  let spawned = false;
  let failure;
  bot.once('spawn', () => { spawned = true; });
  bot.once('kicked', reason => { failure = JSON.stringify(reason); });
  bot.once('error', error => { failure = error.message; });
  await waitFor(() => { if (failure) throw Error(username + ' login: ' + failure); return spawned; }, username + ' spawn');
  return bot;
}
async function query(bot, command, prefix = 'MC_LOCATE') {
  await delay(Math.max(0, 1150 - (Date.now() - (bot.lastCommand || 0))));
  const offset = bot.lines.length;
  bot.lastCommand = Date.now();
  bot.chat(command);
  const line = await waitFor(() => bot.lines.slice(offset).find(line => line.startsWith(prefix + ' ')), command);
  const result = JSON.parse(line.slice(prefix.length + 1));
  receipts.push({command, result});
  return result;
}
async function position(name) {
  const raw = await rc('minecraft:data get entity ' + name + ' Pos');
  const match = raw.match(/\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/);
  assert(match, raw);
  return match.slice(1).map(Number);
}
async function platform(world, name) {
  const prefix = 'minecraft:execute in minecraft:' + world + ' run ';
  await rc(prefix + 'forceload add 530 530 540 540');
  await rc(prefix + 'fill 530 99 530 540 99 540 minecraft:stone');
  await rc(prefix + 'fill 530 100 530 540 104 540 minecraft:air');
  await rc('minecraft:gamemode survival ' + name);
  await rc('minecraft:effect give ' + name + ' minecraft:resistance 600 4 true');
  await rc(prefix + 'minecraft:teleport ' + name + ' 535.5 100 535.5');
}
try {
  const actor = await connect('GuideActorQA'), peer = await connect('GuidePeerQA');
  await platform('overworld', actor.username);
  await platform('the_nether', peer.username);
  await delay(800);
  const before = await position(actor.username);
  const list = await query(actor, '/mycli locate list --json');
  const row = list.characters.find(person => person.name === peer.username);
  check('page one includes visible peer in another dimension', list.ok && list.page === 1 && row?.live && row.dimension === 'minecraft:the_nether' && !row.sameWorld);
  check('cross-world row supplies exact next command and omits meaningless distance', row.teleportCommand.includes(row.uuid) && !Object.hasOwn(row, 'distance'));
  const info = await query(actor, '/mycli locate info ' + peer.username + ' --json');
  check('exact name and UUID agree with observed block position', info.character.uuid === row.uuid && info.character.x === 535.5 && info.character.z === 535.5);
  const infoId = await query(actor, row.lookupCommand);
  check('UUID lookup stable across new read', infoId.character.name === peer.username && infoId.actorUuid === list.actorUuid);
  const invalidPage = await query(actor, '/mycli locate list 999 --json');
  check('unavailable page returns usable directory command', !invalidPage.ok && invalidPage.reason === 'page_out_of_range' && invalidPage.nextCommand === '/mycli locate list --json');
  const missing = await query(actor, '/mycli locate info 00000000-0000-4000-8000-000000000000 --json');
  check('unavailable body has no current coordinates', !missing.ok && missing.reason === 'unknown_or_hidden' && !missing.character);
  for (const [phrase, expected] of [[peer.username + '在哪', 'locate info'], ['传送到' + peer.username + '身边', 'locate tp'], ['整理背包', 'inventory']]) {
    const help = await query(actor, '/mycli help find ' + phrase + ' --json', 'MC_CLI_SEARCH');
    check('read-only search: ' + phrase, help.success && help.found && help.readOnly && !help.changed && !help.autoExecute && help.playerUuid === list.actorUuid && JSON.stringify(help.suggestions).includes(expected));
    if (process.env.CHARACTER_QA_CROWD === '1' && expected === 'locate tp')
      check('teleport suggestion can be copied as a structured command', help.nextCommand === '/mycli locate tp ' + peer.username + ' --json');
  }
  if (process.env.CHARACTER_QA_CROWD === '1') {
    const walk = await query(actor, '/mycli help find 走到' + peer.username + '身边 --json', 'MC_CLI_SEARCH');
    check('walking intent offers free coordinates before any spell', walk.readOnly && walk.nextCommand === '/mycli locate info ' + peer.username + ' --json');
    const spell = await query(actor, '/mycli skills info team --json', 'MC_RPG');
    check('existing skill card explains the same lookup, spell cost and cooldown', spell.id === 'team' && spell.queryOnly && spell.tip.includes('/mycli locate info') && spell.tip.includes('同维') && spell.command.includes('UUID') && spell.mana === 8 && spell.cooldownMs === 20000);
    await delay(1150);
    const start = actor.lines.length;
    actor.chat('/mycli skills info team');
    actor.lastCommand = Date.now();
    const readable = await waitFor(() => actor.lines.slice(start).find(line => line.includes('队友传送术') && line.includes('用法')), 'readable skill text');
    check('player skill details cover position lookup, walking, cross-world travel and a UUID target', readable.includes('/mycli locate info') && readable.includes('走过去') && readable.includes('跨维度') && readable.includes('UUID'));
  }
  check('directory, info and three searches leave the character in place', JSON.stringify(await position(actor.username)) === JSON.stringify(before) && actor.game.dimension.endsWith('overworld'));
  await rc('minecraft:effect give ' + peer.username + ' minecraft:invisibility 60 0 true');
  const hidden = await query(actor, row.lookupCommand);
  const hiddenTp = await query(actor, row.teleportCommand);
  check('now-hidden targets disappear and cached UUID cannot teleport', hidden.reason === 'unknown_or_hidden' && hiddenTp.reason === 'unknown_or_hidden' && !hiddenTp.arrivalConfirmed && hiddenTp.targetUuid === row.uuid);
  await rc('minecraft:effect clear ' + peer.username + ' minecraft:invisibility');
  if (!/^rpg-backend:\s*vortex\s*$/m.test(fs.readFileSync(path.join(lab, 'plugins/AgentFriend/config.yml'), 'utf8'))) {
    actor.chat('/mycli skills learn travel');
    await delay(500);
  }
  const arrive = await query(actor, row.teleportCommand);
  check('teleport binds both identities and reports physical arrival', arrive.actorUuid === list.actorUuid && arrive.targetUuid === row.uuid && arrive.ok && arrive.status === 'arrived' && arrive.arrivalConfirmed);
  await waitFor(() => actor.game.dimension.endsWith('the_nether'), 'actual client dimension change');
  const pos = await position(actor.username);
  check('server position and arrival receipt match opposite-dimension target', arrive.actualPosition.dimension === row.dimension && arrive.targetPosition.dimension === row.dimension && pos.every((v,i) => Math.abs(v - arrive.actualPosition[['x','y','z'][i]]) < 0.1) && Math.hypot(pos[0]-row.x,pos[1]-row.y,pos[2]-row.z) < 4);
  await waitFor(() => actor.lines.some(line => /MC_TRAVEL id=team mana=8\b/.test(line)), 'one successful spell charge');
  check('one successful spell charges the established eight mana', actor.lines.filter(line => /MC_TRAVEL id=team mana=8\b/.test(line)).length === 1);
  const again = await query(actor, row.teleportCommand);
  check('immediate duplicate gets cooldown with a read-only follow-up', again.status === 'refused' && again.reason === 'cooldown' && again.retryAfterSeconds > 0 && again.nextCommand === row.lookupCommand && !again.arrivalConfirmed);
  check('duplicate and searches produce no second charge', actor.lines.filter(line => /MC_TRAVEL id=team mana=8\b/.test(line)).length === 1);
  if (process.env.CHARACTER_QA_CROWD === '1') {
    const twin = await connect('GuideTwinQA');
    await platform('overworld', twin.username);
    twin.chat('/mycli locate');
    const compass = await waitFor(() => twin.currentWindow, 'ordinary skill compass target list');
    const pearl = compass.slots.slice(0,27).findIndex(s => s?.name === 'ender_pearl' && JSON.stringify(s.components ?? s).includes(peer.username));
    check('vanilla inventory contains the matching peer teleport button', pearl >= 0);
    await twin.clickWindow(pearl, 0, 0);
    await waitFor(() => twin.lines.some(line => line.includes('已安全抵达')) && twin.game.dimension.endsWith('the_nether'), 'compass-only cross-world teleport');
    const arrivedByCompass = await position(twin.username);
    check('clicking the vanilla compass button reaches the same physical target', Math.hypot(arrivedByCompass[0]-row.x,arrivedByCompass[1]-row.y,arrivedByCompass[2]-row.z) < 4);
    const alias = await query(actor, '/mycli locate info 指路小伙伴 --json');
    check('configured public alias resolves the original player body', alias.character.uuid === row.uuid);
    const shared = await query(actor, '/mycli locate info 测路同伴 --json');
    check('shared alias returns both distinct UUIDs for a deliberate choice', shared.reason === 'ambiguous_name' && shared.matchCount === 2 && new Set(shared.candidates.map(c => c.uuid)).size === 2);
    const identity = await query(actor, row.lookupCommand);
    check('UUID remains authoritative when another visible body uses it as an alias', identity.character.uuid === row.uuid);
    await rc('minecraft:effect give ' + peer.username + ' minecraft:invisibility 60 0 true');
    const absent = await query(actor, row.lookupCommand);
    check('UUID of a newly hidden body cannot resolve to an alias impersonating it', !absent.ok && absent.reason === 'unknown_or_hidden' && !absent.character);
    await rc('minecraft:effect clear ' + peer.username + ' minecraft:invisibility');
    const double = await query(actor, '/mycli locate tp 测路同伴 --json');
    check('ambiguous teleport does not spend or move', double.status === 'refused' && !double.arrivalConfirmed && double.reason === 'ambiguous_name' && !double.targetUuid);
    twin.quit();
    // Enough quiet test bodies to put ZedGuide15 beyond the first two pages.
    for (let i = 0; i < 16; i += 2) {
      await Promise.all([i, i + 1].map(n => connect('ZedGuide' + String(n).padStart(2, '0'))));
    }
    const first = await query(actor, '/mycli locate list --json');
    const second = await query(actor, first.nextCommand);
    const third = await query(actor, second.nextCommand);
    const all = [...first.characters, ...second.characters, ...third.characters];
    const last = all.find(c => c.name === 'ZedGuide15');
    check('directory pages after the first sixteen entries remain reachable', first.totalPages >= 3 && first.characters.length === 8 && second.characters.length === 8 && third.characters.some(c => c.uuid === last?.uuid));
    check('consecutive pages are disjoint and cover the advertised count', new Set(all.map(c => c.uuid)).size === first.totalCount && all.length === first.totalCount);
    const byName = await query(actor, '/mycli locate info ZedGuide15 --json');
    check('a character on page three is directly discoverable by name', byName.character.uuid === last.uuid);
  }
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  if (process.env.CHARACTER_QA_REPORT) fs.writeFileSync(process.env.CHARACTER_QA_REPORT, JSON.stringify({passed: !process.exitCode, checks, receipts}, null, 2));
  for (const bot of clients) bot.quit();
  console.log(JSON.stringify({passed: !process.exitCode, checks}));
}
