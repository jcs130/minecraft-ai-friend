/** Controlled clients on an existing, hash-locked loopback fixture. Never starts a server or model. */
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {preflight, validateMembership} from './four-party-preflight.mjs';

const [mode, stage, output, manifest, dependencies, ...extra] = process.argv.slice(2);
if (mode === '--help') {
  console.log('node four-party-stage.mjs --preflight|--run-isolated ABS_STAGE ABS_NEW_REPORT ABS_CURRENT_MANIFEST ABS_NODE_CONSUMER');
  process.exit(0);
}
if (!['--preflight', '--run-isolated'].includes(mode) || extra.length) throw Error('Use --help; legacy implicit execution is disabled');
const local = preflight(stage, output, manifest, dependencies);
if (mode === '--preflight') {
  console.log(JSON.stringify(local, null, 2));
  process.exit(0); // No dependency loading, sockets, fixture changes or output file.
}
const {command} = await import('../../../ops/rcon-client.mjs');
const {installRecipePacketBypass} = await import('../../../ops/mineflayer-client-compat.mjs');
const require = createRequire(local.packagePath), bots = [];
const report = {schema: 'party4-controlled-clients/v2', passed: false, evidenceKind: 'controlled-game-clients',
  productionChanged: false, modelCalled: false, actualHostAcceptance: false, preflight: local,
  checks: [], errors: [], membership: [], received: [], commands: []};
const rc = q => command(q, 15000, {properties: stage + '/server.properties', port: 29398});
const check = (ok, name) => { if (!ok) throw Error(name); report.checks.push(name); };
async function until(fn, label, ms = 18000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await sleep(90); }
  throw Error('TIMEOUT ' + label);
}
async function json(bot, line) {
  await sleep(350);
  const start = bot.lines.length, at = new Date().toISOString();
  bot.chat('/mycli guild party ' + line + ' --json');
  const value = await until(() => {
    for (const {text} of bot.lines.slice(start)) if (text.startsWith('MC_RPG ')) {
      let data; try { data = JSON.parse(text.slice(7)); } catch { continue; }
      if (data.type === (line.startsWith('plan ') ? 'partyPlan' : 'party') || (data.type === 'party' && data.success === false)) return data;
    }
  }, line);
  report.commands.push({account: bot.username, at, command: line, value});
  return value;
}
async function fixture(bot, action = 'state', reference = null) {
  const text = await rc('coopqa ' + action + ' ' + bot.username + (reference ? ' ' + reference.username : ''));
  if (text.includes('COOP_QA loading')) return null;
  const match = text.match(/COOP_QA (\{[^\r\n]+\})/);
  if (!match) throw Error('Own fixture unavailable');
  return JSON.parse(match[1]);
}
async function join(index) {
  const bot = require('mineflayer').createBot({host: '127.0.0.1', port: 29397, version: '1.21.1',
    username: 'ag_CP' + randomBytes(4).toString('hex') + index, auth: 'offline'});
  bots.push(bot); bot.lines = [];
  bot.on('messagestr', text => bot.lines.push({text, at: new Date().toISOString()}));
  bot.on('error', e => report.errors.push({account: bot.username, error: e.name}));
  installRecipePacketBypass(bot._client, {enabled: true});
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('SPAWN_TIMEOUT')), 40000);
    bot.once('spawn', () => {clearTimeout(timer); resolve();});
    bot.once('error', e => {clearTimeout(timer); reject(e);});
  });
  await until(() => fixture(bot), 'native profile');
  const fresh = await json(bot, 'status');
  check(fresh.inParty === false && fresh.selfUuid === bot.player.uuid && fresh.pendingInvite == null,
    'fresh QA actor has matching UUID and no inherited party/invite ' + index);
  await fixture(bot, 'setup');
  return bot;
}
async function probe(sender, recipients, absent = []) {
  const mark = 'party4-transport-' + randomBytes(10).toString('hex'), before = bots.map(b => b.lines.length);
  sender.chat(mark); // Deliberate transport probe, never model dialogue.
  for (const recipient of recipients) {
    const index = bots.indexOf(recipient);
    const line = await until(() => recipient.lines.slice(before[index]).find(item => item.text.includes(mark)), 'recipient native message');
    report.received.push({sender: sender.username, senderUuid: sender.player.uuid, recipient: recipient.username,
      recipientUuid: recipient.player.uuid, at: line.at, marker: mark, renderedText: line.text, identityEvidence: 'controlled-sender-and-client-receive'});
  }
  await sleep(1200);
  for (const recipient of absent) check(!recipient.lines.slice(before[bots.indexOf(recipient)]).some(item => item.text.includes(mark)),
    'no nearby receive in bounded observation: ' + recipient.username);
}
try {
  // Prove the running fixture is reading THIS staging directory before logging in any actor.
  const identityText = await rc('coopqa identify');
  const identityMatch = identityText.match(/COOP_QA_ID (\{[^\r\n]+\})/);
  const identity = identityMatch && JSON.parse(identityMatch[1]);
  check(identity?.root === local.root.replaceAll('\\', '/') && identity?.port === 29397
    && identity?.protocol === 'party4-fixture/v2', 'running fixture matches the explicit local stage');
  check(Object.entries(local.artifacts).every(([key, artifact]) => identity.artifactSha256?.[key] === artifact.sha256),
    'stage plugin inputs at fixture startup match local locked bytes');
  check(identity.normalWorlds >= 2, 'same-dimension different-world fixture available');
  report.fixtureIdentity = identity;
  for (let i = 0; i < 4; i++) await join(i);
  const [leader, b, c, d] = bots, names = bots.map(bot => bot.username).join(' '), plan = bot => json(bot, 'plan ' + names);
  check((await plan(leader)).nextAction === 'create', 'one initiator creates');
  for (const peer of [b, c, d]) check((await plan(peer)).nextAction === 'wait', 'peers await one team');
  check((await json(leader, 'create')).success, 'native party created');
  for (const peer of [b, c, d]) {
    check((await plan(leader)).nextCommand === '/mycli guild party invite ' + peer.username, 'one missing member offered');
    check((await json(leader, 'invite ' + peer.username)).success, 'native invitation sent');
    check((await json(peer, 'status')).inParty === false, 'invitation alone is not membership');
    check((await plan(peer)).nextAction === 'accept', 'recipient has matching invite');
    check((await json(peer, 'accept')).success, 'recipient accepts for itself');
  }
  const statuses = [];
  for (const bot of bots) statuses.push(await json(bot, 'status'));
  check(validateMembership(statuses, bots.map(b => b.player.uuid)), 'four exact UUID sets and one native party ID; fifth slot free');
  report.membership = statuses;
  for (const bot of bots) check((await plan(bot)).membershipConfirmed === true, 'plan agrees with native membership');
  for (const sender of bots) await probe(sender, bots.filter(b => b !== sender));
  check(report.received.length === 12, 'all twelve directed nearby receive relations');
  await fixture(c, 'boundary48', leader);
  await probe(leader, [b, c, d]);
  await fixture(c, 'beyond48', leader);
  await probe(leader, [b, d], [c]);
  await fixture(c, 'otherworld');
  check((await json(c, 'status')).phase === 'assembling', 'cross-world member is not gathered');
  check((await plan(c)).membershipConfirmed === true, 'cross-world membership retained');
  await probe(leader, [b, d], [c]);
  d.quit('Own offline-membership check');
  await until(async () => {const value = await json(leader, 'status'); return value.memberCount === 4 && value.members.some(m => m.uuid === statuses[3].selfUuid && m.online === false);}, 'offline member retained');
  check((await plan(leader)).reason === 'player_offline', 'offline member causes wait');
  report.passed = report.errors.length === 0;
  report.partyId = statuses[0].partyId;
  // No disband/leave/kick, including on failures. Preserve evidence and fixture team state.
} catch (error) {report.error = String(error.message); process.exitCode = 1;}
finally {
  for (const bot of bots) bot.quit('Own four-party fixture complete');
  await sleep(300);
  if (!report.passed) process.exitCode = 1;
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
}
