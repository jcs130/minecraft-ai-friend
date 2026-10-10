// Disposable Paper/Mineflayer integration: automatic cameras, live switching and real UI lifetime.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync } from 'node:fs';
import { command } from 'file:///E:/MC/ops/rcon-client.mjs';
import { fix1206PotionProtocol } from 'file:///E:/MC/ops/minecraft-1206-potion.mjs';
import { createViewerObserverBridge } from 'file:///E:/mc-visual-console/packages/modern-viewer/renderer-src/host/viewer-observer.mjs';
import { EventEmitter } from 'node:events';
const root = process.env.OBS_QA_ROOT ?? 'E:/MC/ops/repairs/obs-eye-overlay-20261011';
const stage = process.env.OBS_QA_STAGE ?? 'E:/MC/staging/obs-eye-overlay-20261011';
assert.ok(stage.startsWith('E:/MC/staging/')); assert.notEqual(stage, 'E:/MC/server');
const require = createRequire('E:/Cortico/package.json'); fix1206PotionProtocol(require);
// Disposable client only: minecraft-data 3.112 also carries a later food field into protocol 766.
// The actual 1.20.6 FoodProperties codec has no usingConvertsTo; production Agent clients stay untouched.
const data = createRequire(require.resolve('mineflayer'))('minecraft-data')('1.20.6');
const food = data.protocol.types.SlotComponent[1].find(f => f.name === 'data').type[1].fields.food[1];
const laterFood = food.findIndex(f => f.name === 'usingConvertsTo');
if (laterFood >= 0) { assert.equal(food[laterFood].type, 'Slot'); food.splice(laterFood, 1); }
const mf = require('mineflayer'), sleep = ms => new Promise(r => setTimeout(r, ms));
const rc = q => command(q, 15000, { port: 25641, properties: stage + '/server.properties' });
const report = { at: new Date().toISOString(), passed: false, checks: [], errors: [] }, bots = [];
const check = (name, value) => { assert.ok(value, name); report.checks.push(name); console.log('PASS', name); };
async function until(fn, label, timeout = 16000) { const end = Date.now() + timeout; while (Date.now() < end) {
  if (await fn()) return; await sleep(100); } throw Error('Timeout: ' + label); }
async function join(username) {
  const bot = mf.createBot({ host: '127.0.0.1', port: 25640, username, auth: 'offline', version: '1.20.6', viewDistance: 'short' });
  bots.push(bot); bot.cameras = []; bot.states = []; bot.messages = [];
  bot.on('error', e => report.errors.push(username + ':' + e.message)); bot.on('messagestr', s => bot.messages.push(s));
  bot._client.on('camera', p => bot.cameras.push(p.cameraId));
  bot._client.on('custom_payload', p => { if (p.channel === 'mcviewer:state') bot.states.push(JSON.parse(p.data)); });
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
    setTimeout(() => reject(Error('spawn timeout ' + username)), 20000).unref(); });
  bot.physicsEnabled = false;
  const parse = bot._client.deserializer.parsePacketBuffer;
  bot._client.deserializer.parsePacketBuffer = function(buffer) {
    try { return parse.call(this, buffer); } catch (error) {
      report.errors.push(username + ': native packet parse failed: ' + error.message);
      writeFileSync(root + '/parse-' + username + '.bin', buffer); throw error;
    }
  };
  bot._client.write('custom_payload', { channel: 'minecraft:register', data: Buffer.from('mcviewer:state') });
  return bot;
}
const items = bot => bot.inventory.slots.map(i => i ? [i.name, i.count, i.components] : null);
try {
  check('accepted two plugin versions loaded', (await rc('version AgentFriend')).includes('0.4.14')
    && (await rc('version CortiEyeMirror')).includes('0.1.11'));
  const a = await join('OverlayA'), ae = await join('OverlayAeye'), b = await join('OverlayB'), be = await join('OverlayB_eye');
  const live = await join('live'), stranger = await join('EyeStranger');
  for (const bot of [a, b]) { await rc('minecraft:clear ' + bot.username); await rc('minecraft:gamemode survival ' + bot.username); }
  await rc('minecraft:fill -542 124 -432 -534 124 -428 minecraft:stone');
  await rc('minecraft:tp OverlayA -540.5 125 -430.5'); await rc('minecraft:tp OverlayB -536.5 125 -430.5');
  await rc('minecraft:give OverlayA minecraft:diamond_sword[minecraft:custom_name=\'{"text":"QA Sword"}\',minecraft:enchantments={levels:{"minecraft:sharpness":3}}] 1');
  await rc('minecraft:give OverlayA minecraft:stone 7'); await rc('minecraft:give OverlayB minecraft:emerald 11');
  await until(() => ae.cameras.at(-1) === a.entity.id && be.cameras.at(-1) === b.entity.id, 'automatic exact suffix attach');
  check('both eye and _eye attach without registry rows', ae.game.gameMode === 'spectator' && be.game.gameMode === 'spectator');
  await until(() => JSON.stringify(items(ae)) === JSON.stringify(items(a)), 'native A inventory and components');
  await until(() => JSON.stringify(items(be)) === JSON.stringify(items(b)), 'native B inventory');
  check('native inventory includes original name/enchant components', JSON.stringify(items(ae)) === JSON.stringify(items(a)));
  check('other pair receives only its own items', be.inventory.items().some(i => i.name === 'emerald' && i.count === 11)
    && !be.inventory.items().some(i => i.name === 'diamond_sword'));
  await until(() => ae.states.at(-1)?.viewerSession?.playerUuid === a.player.uuid, 'Eye target skill/vitals subject');
  check('Eye private viewer state names actual source UUID', ae.states.at(-1).viewerSession.playerUuid === a.player.uuid);
  check('free live is spectator without forced initial target', live.game.gameMode === 'spectator' && live.cameras.at(-1) !== a.entity.id);
  const bridge = createViewerObserverBridge(live), socket = new EventEmitter(); live.bridge = bridge; live.ui = [];
  const emit = socket.emit.bind(socket); socket.emit = (event, value) => { live.ui.push([event, value]); return emit(event, value); };
  bridge.subscribeSocket(socket);
  await rc('minecraft:spectate OverlayA live');
  await until(() => bridge.snapshot()?.viewerSession.playerUuid === a.player.uuid, 'live A state');
  await until(() => JSON.stringify(items(live)) === JSON.stringify(items(a)), 'live A native inventory');
  check('live follows actual selected A with A data', live.cameras.at(-1) === a.entity.id);
  await rc('minecraft:tellraw OverlayA {"text":"OBS_A_PRIVATE"}'); await sleep(700);
  check('A private message only A Eye and live', ae.messages.filter(s => s.includes('OBS_A_PRIVATE')).length === 1
    && live.messages.filter(s => s.includes('OBS_A_PRIVATE')).length === 1
    && !be.messages.some(s => s.includes('OBS_A_PRIVATE')) && !stranger.messages.some(s => s.includes('OBS_A_PRIVATE')));
  await rc('minecraft:spectate OverlayB live');
  await until(() => bridge.snapshot()?.viewerSession.playerUuid === b.player.uuid, 'live B state');
  await until(() => JSON.stringify(items(live)) === JSON.stringify(items(b)), 'live B inventory');
  check('live switch replaces old subject and original inventory', !live.inventory.items().some(i => i.name === 'diamond_sword'));
  await rc('minecraft:tellraw OverlayA {"text":"OBS_OLD_PRIVATE"}'); await rc('minecraft:tellraw OverlayB {"text":"OBS_NEW_PRIVATE"}'); await sleep(700);
  check('live immediately stops previous private audience', !live.messages.some(s => s.includes('OBS_OLD_PRIVATE'))
    && live.messages.filter(s => s.includes('OBS_NEW_PRIVATE')).length === 1);
  await rc('minecraft:execute as live run minecraft:spectate');
  await until(() => bridge.snapshot()?.viewerSession.attached === false || bridge.snapshot() === null, 'live detach clears');
  check('live detachment clears copied container and subject', live.ui.some(([event, value]) => event === 'containerState' && value === null));
  await rc('minecraft:summon minecraft:villager -539.5 125 -430.5 {Tags:["obs_qa"],NoAI:1b,Invulnerable:1b,VillagerData:{profession:"minecraft:farmer",level:2,type:"minecraft:plains"},Offers:{Recipes:[{buy:{id:"minecraft:carrot",count:1},sell:{id:"minecraft:emerald",count:1},maxUses:64}]}}');
  await until(() => Object.values(a.entities).some(e => e.name === 'villager' && e.position.distanceTo(a.entity.position) < 3), 'real trader');
  const trader = Object.values(a.entities).find(e => e.name === 'villager' && e.position.distanceTo(a.entity.position) < 3);
  const trade = await a.openVillager(trader); await sleep(500);
  check('real merchant UI opens', a.currentWindow?.type === 'minecraft:merchant');
  await a.look(1, 0, true); await sleep(400); check('look-only keeps valid merchant window', a.currentWindow != null);
  await rc('minecraft:tp OverlayA -540.0 125 -430.5');
  await until(() => a.currentWindow == null, 'moving closes actual merchant');
  check('walking/teleport closes actual server merchant and target UI', a.currentWindow == null);
  await until(() => ae.states.at(-1)?.viewerSession.windowOpen === false, 'authoritative closed state reaches Eye');
  check('Eye receives authoritative merchant close even if local close is missed', ae.states.at(-1).viewerSession.windowOpen === false);
  await a.openVillager(trader);
  await rc('minecraft:spectate OverlayA live');
  await until(() => live.currentWindow != null, 'live attaches to already-open merchant');
  await sleep(1100);
  check('live preserves already-open copied merchant after subject switch', live.currentWindow != null);
  a._client.write('position', {x:a.entity.position.x + 0.4,y:a.entity.position.y,z:a.entity.position.z,onGround:true});
  await until(() => a.currentWindow == null, 'real native movement closes merchant');
  check('native walking packet closes actual merchant', a.currentWindow == null);
  await rc('minecraft:tp OverlayA -540.5 125 -430.5');
  await a.openVillager(trader);
  await rc('minecraft:tp ' + trader.uuid + ' -530.5 125 -430.5');
  await until(() => a.currentWindow == null, 'moving NPC out of use range closes merchant');
  check('stationary player loses merchant UI when trader leaves 6.5 block range', a.currentWindow == null);
  await rc('minecraft:spectate OverlayB live'); await sleep(500);
  await rc('minecraft:execute in minecraft:the_nether run minecraft:tp OverlayB 0 110 0');
  await until(() => live.game.dimension === b.game.dimension && live.cameras.at(-1) === b.entity.id, 'live dimension follows');
  check('live and named Eye follow target across dimension', live.game.dimension === b.game.dimension && be.game.dimension === b.game.dimension);
  check('unrecognized substring Eye never receives privileges', stranger.game.gameMode !== 'spectator');
  report.passed = report.errors.length === 0;
} catch (e) { report.errors.push(String(e.stack ?? e)); console.error(e); }
finally {
  await rc('minecraft:kill @e[tag=obs_qa]').catch(() => {});
  for (const bot of bots) { bot.bridge?.dispose(); bot.quit('isolated overlay QA complete'); }
  writeFileSync(root + '/stage-initial.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, errors: report.errors }));
  if (!report.passed) process.exitCode = 1;
}
