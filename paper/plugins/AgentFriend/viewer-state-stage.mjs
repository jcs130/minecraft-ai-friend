import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const suffix = String(Date.now()).slice(-6);
const stagePort = Number(process.env.MC_STAGE_PORT ?? 25566);
const stageRcon = process.env.MC_STAGE_RCON ?? 'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs';
assert.notEqual(stagePort, 25565, 'This test must not run against the live server');
const cases = [
  { name: `VSNew${suffix}`, channels: ['mcviewer:state'] },
  { name: `VSOld${suffix}`, channels: ['corti:viewer_state'] },
  { name: `VSBoth${suffix}`, channels: ['mcviewer:state', 'corti:viewer_state'] },
];
const captures = new Map(cases.map(({ name }) => [name, []]));
const errors = [];
const chatLeaks = [];
const bots = cases.map(({ name }) => mineflayer.createBot({
  host: '127.0.0.1', port: stagePort, username: name, auth: 'offline', version: '1.20.6',
}));

for (const bot of bots) {
  bot.on('error', (error) => errors.push(`${bot.username}: ${error.message}`));
  bot.on('kicked', (reason) => errors.push(`${bot.username} kicked: ${JSON.stringify(reason)}`));
  bot.on('messagestr', (message) => {
    if (message.includes('schemaVersion') || message.includes('requiredXp')) chatLeaks.push(bot.username);
  });
  bot._client.on('custom_payload', (packet) => {
    if (packet.channel !== 'mcviewer:state' && packet.channel !== 'corti:viewer_state') return;
    const raw = Buffer.from(packet.data);
    assert.equal(raw[0], 0x7b, 'payload must be raw UTF-8 JSON without a length prefix');
    assert.ok(raw.length <= 16384, `payload too large: ${raw.length}`);
    const state = JSON.parse(raw.toString('utf8'));
    assert.equal(state.schemaVersion, 1);
    assert.ok(state.mana === null || (Number.isFinite(state.mana.current) && Number.isFinite(state.mana.max)));
    assert.ok(Array.isArray(state.skills) && state.skills.length <= 24);
    assert.ok(Array.isArray(state.abilities) && state.abilities.length <= 24);
    for (const entry of state.skills) {
      assert.match(entry.id, /^[a-z0-9_:.-]+$/);
      assert.ok(Number.isFinite(entry.level) && Number.isFinite(entry.xp) && Number.isFinite(entry.requiredXp));
    }
    for (const entry of state.abilities) {
      assert.match(entry.id, /^[a-z0-9_:.-]+$/);
      assert.ok(Number.isFinite(entry.level));
      assert.ok(entry.cooldownMs === null || Number.isFinite(entry.cooldownMs));
    }
    captures.get(bot.username).push({ at: Date.now(), channel: packet.channel, bytes: raw.length, state });
  });
}

try {
  await Promise.all(bots.map((bot) => new Promise((resolve, reject) => {
    if (bot.entity) return resolve();
    bot.once('spawn', resolve);
    bot.once('error', reject);
  })));
  for (let i = 0; i < bots.length; i++) bots[i]._client.write('custom_payload', {
    channel: 'minecraft:register', data: Buffer.from(cases[i].channels.join('\0')),
  });
  await sleep(1800);
  const latest = (name, channel = 'mcviewer:state') => captures.get(name).filter((p) => p.channel === channel).at(-1);
  for (const { name, channels } of cases) {
    const ownChannel = channels[0];
    assert.ok(latest(name, ownChannel), `${name} did not receive ${ownChannel}`);
    assert.ok(latest(name, ownChannel).state.mana && latest(name, ownChannel).state.skills.length,
      `${name} has no loaded personal state`);
  }
  // Paper only delivers channels registered by the client. An old-only client
  // receives the alias; clients with both subscriptions receive one copy.
  assert.ok(latest(cases[1].name, 'corti:viewer_state'), 'legacy-only client did not receive compatibility copy');
  assert.equal(captures.get(cases[0].name).filter((p) => p.channel === 'corti:viewer_state').length, 0);
  assert.equal(captures.get(cases[2].name).filter((p) => p.channel === 'corti:viewer_state').length, 0);

  const initial = cases.map(({ name, channels }) => latest(name, channels[0]).state);
  const firstFarming = initial[0].skills.find((skill) => skill.id.endsWith(':farming'));
  assert.ok(firstFarming, 'AuraSkills farming is absent');
  const xpReply = execFileSync('node', [
    stageRcon,
    `skills xp add ${cases[0].name} farming 5 silent`,
  ], { encoding: 'utf8' });
  assert.ok(!xpReply.includes('Error') && !xpReply.includes('Unknown'), xpReply);
  await sleep(900);
  const farmingAfter = latest(cases[0].name).state.skills.find((skill) => skill.id === firstFarming.id);
  assert.ok(farmingAfter.xp !== firstFarming.xp || farmingAfter.level !== firstFarming.level,
    'skill XP change did not trigger a full state update');
  for (const i of [1, 2]) {
    const other = latest(cases[i].name, cases[i].channels[0]).state.skills.find((skill) => skill.id === firstFarming.id);
    assert.deepEqual(other, initial[i].skills.find((skill) => skill.id === firstFarming.id),
      'skill XP leaked to another player');
  }
  const oldMana = initial[1].mana.current;
  bots[1].chat('/mycli cast leap');
  await sleep(1200);
  assert.ok(captures.get(cases[1].name).some((p) => p.channel === 'corti:viewer_state'
    && p.state.mana?.current < oldMana), 'legacy-only client did not receive its mana change');
  assert.ok(captures.get(cases[1].name).some((p) => p.state.abilities.some((ability) =>
    ability.id === 'mycli:leap' && ability.cooldownMs > 0)),
  'legacy-only client did not receive its cooldown change');
  for (const i of [0, 2]) {
    assert.ok(captures.get(cases[i].name).filter((p) => p.channel === 'mcviewer:state')
      .every((p) => p.state.mana?.current === initial[i].mana.current), 'another player received the caster mana');
  }
  await sleep(5400);
  for (const i of [0, 2]) {
    const own = captures.get(cases[i].name).filter((p) => p.channel === 'mcviewer:state');
    assert.ok(own.some((p) => p.at - own[0].at >= 4500), `${cases[i].name} missed the 5s heartbeat`);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(chatLeaks, []);
  console.log(JSON.stringify({ verdict: 'PASS', recipients: cases.map(({ name }) => ({
    name, channels: [...new Set(captures.get(name).map((p) => p.channel))],
    packets: captures.get(name).length, maxBytes: Math.max(...captures.get(name).map((p) => p.bytes)),
  })), independentState: true, heartbeat: true, chatLeaks: 0 }, null, 2));
} finally {
  for (const bot of bots) bot.quit();
  await sleep(200);
}
