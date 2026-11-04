import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, openSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { command } from '../../ops/rcon-client.mjs';
import { installRecipePacketBypass } from '../../ops/mineflayer-client-compat.mjs';

const [directory, java, clientManifest] = process.argv.slice(2);
assert(directory && java && clientManifest, 'Usage: node activity-run-attribution.mjs <fresh stage> <java> <mineflayer package.json>');
const root = await fs.realpath(directory), properties = path.join(root, 'server.properties');
assert.equal((await fs.readFile(path.join(root, '.activity-run-qa'), 'utf8')).trim(), 'activity-run-attribution-loopback');
const props = await fs.readFile(properties, 'utf8');
for (const rule of [/^server-ip=127\.0\.0\.1\r?$/m, /^server-port=25976\r?$/m, /^rcon\.port=25977\r?$/m, /^online-mode=false\r?$/m])
  assert.match(props, rule);
const { createBot } = createRequire(path.resolve(clientManifest))('mineflayer');
const game = 25976, rcon = text => command(text, 18000, { properties, port: 25977 });
const bots = new Set(), checks = [], samples = {};
let server, exited;
function check(value, description) {
  assert(value, description); checks.push(description); console.log('PASS ' + description);
}
async function until(probe, label, timeout = 20000) {
  const end = Date.now() + timeout;
  do { const value = await probe(); if (value) return value; await delay(150); } while (Date.now() < end);
  throw Error('Timed out: ' + label);
}
const listening = port => new Promise(resolve => {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});
async function boot() {
  assert(!(await listening(game)) && !(await listening(25977)));
  const log = openSync(path.join(root, 'activity-operator.log'), 'a');
  server = spawn(java, ['-Xms512m','-Xmx2g','-XX:ActiveProcessorCount=2','-Dterminal.jline=false',
    '-Dterminal.ansi=false','-jar','server.jar','nogui'], { cwd: root, stdio: ['pipe', log, log], windowsHide: true });
  closeSync(log); exited = once(server, 'exit');
  await until(async () => {
    if (server.exitCode !== null) throw Error('Isolated server exited: ' + server.exitCode);
    try { return /ActivityRunFixture/.test(await rcon('plugins')); } catch { return false; }
  }, 'isolated server ready', 120000);
}
async function stop() {
  for (const bot of bots) bot.quit();
  bots.clear();
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  server.stdin.write('stop\n');
  await Promise.race([exited, delay(25000, null, { ref: false })]);
  assert.equal(server.exitCode, 0, 'isolated server stopped cleanly');
}
async function connect(suffix) {
  const bot = createBot({ host: '127.0.0.1', port: game, username: 'ag_Attr' + suffix, version: '1.21.1',
    auth: 'offline', physicsEnabled: false, hideErrors: true });
  installRecipePacketBypass(bot);
  bots.add(bot); bot.lines = []; bot.lastSend = 0;
  bot.on('messagestr', text => bot.lines.push(text));
  bot.on('error', error => console.log('QA client: ' + error.message));
  await Promise.race([once(bot, 'spawn'), once(bot, 'kicked').then(([why]) => { throw Error('Fixture kicked: ' + why); }),
    delay(20000, null, { ref: false }).then(() => { throw Error('Spawn timeout ' + suffix); })]);
  return bot;
}
async function fixture(text) {
  const reply = await rcon('qd_attr_fixture ' + text);
  assert.match(reply, /^ATTR_(?:OK|REVISION) /, text + ': ' + reply);
  return reply;
}
async function position(bot, verb) {
  await fixture(verb + ' ' + bot.username);
  const x = verb === 'out' ? 4250 : bot.username.endsWith('Bob') ? 4203 : 4200;
  await until(() => Math.floor(bot.entity.position.x) === x, 'teleport ' + bot.username);
}
async function ask(bot, line, prefix) {
  await delay(Math.max(0, 1250 - (Date.now() - bot.lastSend)));
  const offset = bot.lines.length;
  bot.lastSend = Date.now(); bot.chat('/mycli ' + line);
  return until(() => bot.lines.slice(offset).find(row => row.startsWith(prefix + ' ')), bot.username + ': ' + line);
}
const json = line => JSON.parse(line.slice(line.indexOf(' ') + 1));
const kv = line => Object.fromEntries(line.match(/\b\w+=[^\s]+/g).map(part => part.split('=')));
const trial = async bot => {
  const state = json(await ask(bot, 'arena status --json', 'MC_TRIAL_STATE'));
  assert.equal(state.schemaVersion, 1, 'MC_TRIAL_STATE schema version');
  return state;
};
const site = 'qa_attribution', siteState = async bot => json(await ask(bot, 'dungeon status ' + site + ' --json', 'MC_SITE_DUNGEON_STATE'));
const action = async (bot, verb) => {
  const id = ['resume','leave'].includes(verb) ? '' : ' ' + site;
  return json(await ask(bot, 'dungeon ' + verb + id + ' --json', 'MC_SITE_DUNGEON_RESULT'));
};
const explain = data => JSON.stringify(Object.fromEntries(['action','id','recipient','run','success','reason'].map(key => [key, data[key]])));
const sameAction = (data, bot, verb, run) =>
  data.success && data.action === verb && data.id === site && data.recipient === bot.username && data.run === run;
const runId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
try {
  await boot();
  let alice = await connect('Alice'), bob = await connect('Bob');
  const eye = await connect('Eye');
  await fixture('setup');
  const idle = await trial(alice);
  check(idle.recipient === alice.username && !idle.active && !idle.participant && idle.lifecycle === 'none' && !('run' in idle) && !('revision' in idle), 'idle reports own recipient with no instance');
  await fixture('trial_ready ' + alice.username);
  const startedLine = await ask(alice, 'arena start', 'MC_DUNGEON_START'), started = kv(startedLine);
  check(started.recipient === alice.username && runId.test(started.run) && started.revision === '1' && started.floor === '1' && started.partySize === '1', 'trial start retains old fields and reports durable own run');
  const first = await trial(alice), repeat = await trial(alice);
  check(first.participant && first.lifecycle === 'active' && first.run === started.run && first.revision === 1
    && repeat.revision === first.revision && (await fixture('trial_revision')).trim() === 'ATTR_REVISION 1', 'repeat reads leave the persisted revision unchanged');
  const observed = await trial(eye);
  check(observed.active && !observed.participant && observed.recipient === eye.username && !('run' in observed) && !('revision' in observed), 'bystander sees site occupancy without current instance');
  await until(async () => (await trial(alice)).remainingMobs > 0, 'native trial wave');
  const rewardOffset = alice.lines.length;
  await fixture('trial_kill');
  const rewardLine = await until(() => alice.lines.slice(rewardOffset).find(s => s.startsWith('MC_DUNGEON_LOOT ')), 'settled trial loot');
  const reward = kv(rewardLine);
  check(reward.run === started.run && reward.recipient === alice.username && reward.floor === '1' && !!reward.category
    && Number(reward.revision) > first.revision && Number(reward.revision) <= Number((await fixture('trial_revision')).split(' ')[1]), 'trial reward names the committed clear without claiming tower completion');
  await fixture('trial_timeout');
  const result = json(await until(() => alice.lines.find(s => s.startsWith('MC_TRIAL_RESULT ')), 'private trial outcome'));
  check(result.schemaVersion === 1 && result.run === started.run && result.recipient === alice.username && result.status === 'cancelled'
    && result.reason === 'timeout' && result.revision > Number(reward.revision), 'terminal trial result has a later durable revision');
  check(!eye.lines.some(line => line.startsWith('MC_TRIAL_RESULT ') || line.startsWith('MC_DUNGEON_LOOT ')), 'observer receives neither private loot nor private trial outcome');
  await position(alice, 'out');

  await position(alice, 'site_in');
  const startSite = await action(alice, 'start');
  check(runId.test(startSite.run) && sameAction(startSite, alice, 'start', startSite.run), 'site start explicitly attributes its own run (' + startSite.reason + ')');
  await position(bob, 'site_in');
  await until(async () => {
    const state = await siteState(bob);
    return state.participant && state.participantRun === startSite.run;
  }, 'site auto-enrolls Bob before explicit join');
  const join = await action(bob, 'join');
  check(sameAction(join, bob, 'join', startSite.run), 'site join after automatic enrollment refers to the shared instance: ' + explain(join));
  const leave = await action(bob, 'leave');
  check(sameAction(leave, bob, 'leave', startSite.run), 'site leave keeps attribution after membership removal');
  await position(bob, 'out');
  const failed = await action(eye, 'resume');
  check(!failed.success && !('run' in failed), 'failed site action does not attach a foreign run');
  await fixture('site_fault');
  const resume = await action(alice, 'resume');
  check(sameAction(resume, alice, 'resume', startSite.run), 'site resume names the original faulted instance: ' + explain(resume));
  const ownSite = await siteState(alice);
  check(ownSite.participant && ownSite.run === startSite.run && ownSite.participantRun === startSite.run && ownSite.lifecycle === 'active', 'site participant fields remain compatible');
  await until(() => alice.lines.some(line => line.includes('本室第') && line.includes('个标记敌人')), 'native site wave');
  await fixture('site_kill');
  const pending = await until(async () => {
    const state = await siteState(alice);
    return state.pendingRewardDetails?.some(item => item.run === startSite.run) && state;
  }, 'site completion persists a real receipt');
  await position(alice, 'out');
  await fixture('site_ready');
  await position(bob, 'site_in');
  const otherSite = await action(bob, 'start');
  check(otherSite.success && runId.test(otherSite.run) && otherSite.run !== startSite.run, 'new party at same site receives different run');
  const otherView = await siteState(alice);
  check(!otherView.participant && otherView.run === otherSite.run && !otherView.participantRun
    && otherView.pendingRewardDetails?.some(item => item.run === startSite.run), 'old personal reward remains separate from current foreign party');
  const claim = await action(alice, 'claim');
  check(sameAction(claim, alice, 'claim', startSite.run), 'claim returns consumed historical run while another party is active');
  const duplicate = await action(alice, 'claim');
  check(!duplicate.success && duplicate.reason === 'no_pending_reward' && !('run' in duplicate), 'duplicate claim cannot attribute or grant a second reward');
  await action(bob, 'leave');
  await position(bob, 'out');

  await fixture('trial_ready ' + bob.username);
  const nextLine = await ask(bob, 'arena start', 'MC_DUNGEON_START'), next = kv(nextLine);
  check(runId.test(next.run) && next.run !== started.run && next.revision === '1', 'a new trial starts at revision one with its own ID');
  const history = await trial(alice);
  check(history.active && !history.participant && !('run' in history) && history.lastOutcome?.run === result.run
    && history.lastOutcome?.revision === result.revision, 'former participant sees only own historical outcome during new trial');
  await stop();
  await boot();
  alice = await connect('Alice'); bob = await connect('Bob');
  const recovered = await until(async () => {
    const value = await trial(bob); return value.participant && value.run && value;
  }, 'current run restored after normal restart');
  const historyCold = await trial(alice);
  check(recovered.run === next.run && recovered.revision > Number(next.revision) && recovered.floor === 1,
    'normal shutdown and restart preserve run ID and advance revision across pause');
  check(historyCold.lastOutcome?.run === result.run && historyCold.lastOutcome?.revision === result.revision
    && !('run' in historyCold), 'prior terminal outcome survives restart without becoming current');
  const persisted = Number((await fixture('trial_revision')).split(' ')[1]), again = await trial(bob);
  check(again.revision >= recovered.revision && again.revision === persisted, 'cold query matches the durable checkpoint revision');
  Object.assign(samples, { idle, trialStart: startedLine, first, observed, trialReward: rewardLine, result, startSite,
    join, leave, resume, ownSite, pending, otherView, claim, duplicate, history, recovered, historyCold });
  await fs.writeFile(path.join(root, 'activity-attribution-report.json'), JSON.stringify({ passed: checks.length, checks, samples }, null, 2));
} finally {
  await stop();
}
