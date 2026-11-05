// Opt-in connected acceptance. Use ONLY a disposable, loopback, offline-mode
// Java 1.21.1 server with creative mode, a flat safe floor and two free slots.
// No server commands, production credentials or existing player data are used.
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import '../dist/runtime/core/dependency-patches.js';
import mineflayer from 'mineflayer';
import pathfinder from 'mineflayer-pathfinder';
import { installNativeBodyReadiness } from '../dist/runtime/core/body-readiness.js';
import { flightState, watchFlightAbilities } from '../dist/runtime/core/flight.js';
import { Executor } from '../dist/runtime/core/executor.js';
import { installMineflayerFixes } from '../dist/runtime/core/mineflayer-fixes.js';

const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
assert(process.argv.includes('--port') && Number.isInteger(port) && port > 0 && port <= 65535,
  'Usage: node scripts/accept-flight-body-readiness.mjs --port <disposable-loopback-server-port>');
const log = { info() {}, warn() {}, debug() {}, error() {} };
const clients = [];
const emit = (check, data) => console.log(JSON.stringify({ check, ...data }));
async function until(predicate, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert(Date.now() < deadline, `Timed out: ${label}`);
    await sleep(25);
  }
}
function connect(username) {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port, username, auth: 'offline', version: '1.21.1', respawn: false });
  clients.push(bot);
  bot.loadPlugin(b => installMineflayerFixes(b, log));
  bot.on('error', error => emit('transport-error', { username, error: error.message }));
  bot.on('kicked', reason => emit('kicked', { username, reason }));
  return bot;
}

let exec, readiness, unwatch;
try {
  const bot = connect('Body1QA');
  readiness = installNativeBodyReadiness(bot);
  unwatch = watchFlightAbilities(bot);
  bot.loadPlugin(pathfinder.pathfinder);
  await until(() => readiness.read().phase === 'ready' && bot.entity?.onGround, 'native body ready', 30000);
  assert.equal(bot.game.gameMode, 'creative', 'Use an isolated creative-mode fixture');
  assert.equal(flightState(bot).allowed, true);
  const observer = connect('Body1Observer');
  await until(() => observer.entity && observer.entities[bot.entity.id], 'independent observer sees test body', 30000);
  const reports = [];
  let id = 0;
  exec = new Executor({ getBot: () => bot, report: report => reports.push(report), log, nextId: () => ++id });
  async function run(call, expected = 'done') {
    const taskId = id + 1;
    exec.submit([call], 'append');
    await until(() => reports.some(report => report.taskId === taskId
      && ['done', 'blocked', 'failed', 'cancelled'].includes(report.kind)), `task ${taskId}`);
    const report = reports.find(report => report.taskId === taskId
      && ['done', 'blocked', 'failed', 'cancelled'].includes(report.kind));
    emit('task', { call, report });
    assert.equal(report.kind, expected, report.text);
    return report;
  }
  const floor = bot.entity.position.clone(), gravity = bot.physics.gravity;
  const at = y => [Math.floor(floor.x), y, Math.floor(floor.z)];
  async function serverY(y) {
    await until(() => Math.abs((observer.entities[bot.entity.id]?.position.y ?? Infinity) - y) < .1,
      `independent server position at y=${y}`);
    emit('server-position', { position: observer.entities[bot.entity.id].position });
  }
  async function landed() {
    await serverY(floor.y);
    assert.equal(bot.physicsEnabled, true);
    assert.equal(bot.physics.gravity, gravity);
    assert.equal(bot.entity.onGround, true);
    assert.equal(flightState(bot).controlActive, false);
    assert.equal(readiness.read().phase, 'ready');
  }

  await run({ skill: 'flight', at: at(floor.y + 2), land: false });
  const physicsAt = readiness.read().physicsAt;
  await sleep(6100);
  assert.equal(readiness.read().physicsAt, physicsAt);
  assert.equal(readiness.read().phase, 'controlled-flight');
  assert(readiness.read().movementAt > physicsAt);
  await serverY(floor.y + 2);
  emit('hover', { readiness: readiness.read(), flight: flightState(bot) });
  await run({ skill: 'land' }); await landed();

  await run({ skill: 'flight', at: at(floor.y + 2), land: false });
  await run({ skill: 'flight', at: at(floor.y + 14), land: false });
  const rejected = await run({ skill: 'land' }, 'blocked');
  assert.match(rejected.text, /没有已加载的安全落点/);
  assert.equal(flightState(bot).mode, 'hover');
  assert.equal(bot.physicsEnabled, false);
  await serverY(floor.y + 14);
  await run({ skill: 'flight', at: at(floor.y + 2), land: false });
  await run({ skill: 'land' }); await landed();
  emit('acceptance', { passed: true, tasks: reports.length, version: bot.version,
    scope: 'isolated loopback server; real protocol, native physics, executor and independent observer; no LLM or production' });
} finally {
  exec?.shutdown();
  for (const bot of clients) bot.quit('isolated flight acceptance complete');
  unwatch?.(); readiness?.dispose();
}
