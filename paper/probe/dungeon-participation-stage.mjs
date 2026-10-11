// Real clients against a strictly named loopback laboratory; never a live-world repair.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, rmdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fix1206PotionProtocol } from '../ops/minecraft-1206-potion.mjs';
const stage = resolve(process.env.MC_STAGE ?? 'E:/MC/staging/dungeon-participation-20261011');
const properties = readFileSync(`${stage}/server.properties`, 'utf8');
assert.match(properties, /^server-ip=127\.0\.0\.1\r?$/m);
assert.match(properties, /^server-port=25567\r?$/m);
assert.match(properties, /^motd=Dungeon participation isolated check\r?$/m);
const require = createRequire('E:/MC/probe/package.json');
fix1206PotionProtocol(require);
const { createBot } = require('mineflayer');
const yaml = createRequire('E:/MC/ops/yaml-check/package.json')('js-yaml');
const { command } = await import('file:///E:/MC/ops/rcon-client.mjs');
const rcon = cmd => command(cmd, 15000, { properties: `${stage}/server.properties`, port: 25587 });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { at: new Date().toISOString(), checks: [], errors: [], fixture: 'Console builds test floor, freezes enemies, accelerates timers; healing hook and a real flying arrow are triggered by disclosed Bukkit fixtures.' };
const bots = []; let expectedStop = false;
const save = () => yaml.load(readFileSync(`${stage}/plugins/AgentFriend/config.yml`, 'utf8'));
function check(name, ok, detail) { report.checks.push({ name, pass: !!ok, detail }); assert.ok(ok, name); }
async function until(fn, label, ms = 12000) {
  const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return; await sleep(100); }
  throw Error(`timeout: ${label}`);
}
async function connect(username) {
  const bot = createBot({ username, host: '127.0.0.1', port: 25567, version: '1.20.6', auth: 'offline', physicsEnabled: false });
  bot.lines = []; bot.actionbars = []; bots.push(bot);
  bot.on('messagestr', text => bot.lines.push(text));
  bot.on('actionBar', text => bot.actionbars.push(text.toString()));
  // Mineflayer's chat plugin omits the dedicated 1.20.6 action_bar packet.
  bot._client.on('action_bar', data => bot.actionbars.push(JSON.stringify(data)));
  bot.on('error', err => { if(!expectedStop)report.errors.push(`${username}: ${err.message}`); });
  bot.on('kicked', reason => { if(!expectedStop)report.errors.push(`${username}: ${JSON.stringify(reason)}`); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('login timeout')), 20000);
    bot.once('spawn', () => { clearTimeout(timeout); bot.physicsEnabled = false; resolve(); });
    bot.once('error', reject); bot.once('kicked', reason => reject(Error(JSON.stringify(reason))));
  });
  await sleep(1700); // Finish the delayed initial position acknowledgement before fixture teleports.
  return bot;
}
async function cli(bot, action, prefix = 'MC_SITE_DUNGEON_RESULT') {
  const from = bot.lines.length; bot.chat('/mycli dungeon ' + action);
  await until(() => bot.lines.slice(from).some(x => x.startsWith(prefix + ' ')), action);
  return JSON.parse(bot.lines.slice(from).find(x => x.startsWith(prefix + ' ')).slice(prefix.length + 1));
}
const state = bot => cli(bot, 'status audit_rooms', 'MC_SITE_DUNGEON_STATE');
async function tp(bot, x, z = 100.5, yaw = 0) {
  await rcon(`minecraft:tp ${bot.username} ${x} 101 ${z} ${yaw} 0`); await sleep(130);
}
async function qa(args) { const text = await rcon('dungeonqa ' + args); assert.match(text, /DUNGEON_QA_OK/); }
function mobs(bot) { return Object.values(bot.entities).filter(e => e.name === 'zombie' && e.position.y > 99); }
async function wave(bot, count = 2) {
  await until(() => mobs(bot).length === count, 'marked wave visible'); await qa('freeze');
  return mobs(bot).map(e => e.uuid);
}
async function strike(bot, uuid) {
  await until(() => Object.values(bot.entities).some(e => e.uuid === uuid), 'target entity');
  const entity = Object.values(bot.entities).find(e => e.uuid === uuid);
  await tp(bot, entity.position.x, entity.position.z + 1.2);
  bot.attack(entity);
  await until(() => !Object.values(bot.entities).some(e => e.uuid === uuid), 'real attack kills marked enemy');
}
async function start(bot, party = []) {
  await qa('cooldown'); await tp(bot, 100.5);
  for (const mate of party) await tp(mate, 101.5);
  check('start success', (await cli(bot, 'start audit_rooms normal')).success);
  for (const mate of party) check('join success ' + mate.username, (await cli(mate, 'join audit_rooms')).success);
  await qa('muster'); return wave(bot);
}
async function checkRestart(a, b, c) {
  const sa = await cli(a,'status','MC_SITE_DUNGEON_STATE'), sb = await cli(b,'status','MC_SITE_DUNGEON_STATE');
  check('latest outcome and previous claimed proof survive restart', !sa.active && sa.lastOutcome.reason === 'party_left' && !!save()['site-dungeons']['claimed-runs'][a.player.uuid].audit_rooms, sa.lastOutcome);
  check('unclaimed receipt survives restart', sb.pendingRewards.includes('audit_rooms'), sb.pendingRewards);
  check('end reason survives restart', save()['site-dungeons'].outcomes[c.player.uuid].audit_rooms.reason === 'return_grace_expired');
  check('repeat claim after restart stays rejected', (await cli(a, 'claim audit_rooms')).reason === 'no_pending_reward');
}
async function prepareCheckpoint(c) {
  let ids=await start(c); for(const id of ids)await strike(c,id);
  await until(()=>save()['site-dungeons'].runs.audit_rooms.stage===1,'first room checkpoint');
  await tp(c,120.5); ids=await wave(c); for(const id of ids)await strike(c,id);
  await until(()=>save()['site-dungeons'].runs.audit_rooms.stage===2,'second room checkpoint');
  await tp(c,140.5); await wave(c);
  const saved=save()['site-dungeons'].runs.audit_rooms;
  check('pre-restart active checkpoint has both cleared room records',saved.phase==='fighting'&&saved.attendance[c.player.uuid]===2&&Object.keys(saved.roomAttendance).length===2,saved);
  report.preRestart=saved; expectedStop=true; await rcon('stop');
}
async function verifyCheckpoint(c) {
  const restored=await state(c);
  check('cold restart retains cleared attendance and room detail',restored.attendance===2&&restored.missingRooms.length===0&&restored.unverifiedRooms.length===0,restored);
  check('cold restart explains unfinished room replay',restored.lastResetReason==='server_restart'&&restored.resets>=1,restored);
  await tp(c,140.5); const ids=await wave(c); for(const id of ids)await strike(c,id);
  await until(()=>save()['site-dungeons'].runs.audit_rooms.phase==='returning','resumed last room clear');
  await tp(c,100.5); await until(()=>!save()['site-dungeons'].runs?.audit_rooms,'resumed run completed');
  check('resumed complete run has one reward receipt',(await state(c)).lastOutcome.rewardStatus==='ready');
  check('resumed reward claim succeeds once',(await cli(c,'claim audit_rooms')).success);
  check('resumed duplicate claim rejected',(await cli(c,'claim audit_rooms')).reason==='no_pending_reward');
}
async function windowChecks(a) {
    // Actual native windows, including the remote Minepacks backpack and attached Eye.
    const eye = await connect('RoomQA_eye');
    eye._client.write('custom_payload', { channel: 'minecraft:register', data: Buffer.from('spectatorplus:screen_sync') });
    await sleep(1800);
    check('Eye attaches', (await rcon('cortieye')).includes('attached=true'));
    await tp(a, 169.5);
    const chest = a.blockAt(new (require('vec3').Vec3)(170,101,100));
    const window = await a.openContainer(chest); await sleep(500);
    await until(() => !!eye.currentWindow, 'Eye native chest screen');
    check('native chest opens for action player and Eye', !!a.currentWindow && !!eye.currentWindow);
    await a.look(1,0,true); await sleep(400);
    check('looking around keeps chest open', !!a.currentWindow);
    await tp(a, 169.95);
    await until(() => !a.currentWindow && !eye.currentWindow, 'moving closes both windows');
    check('moving closes native and mirrored chest', !a.currentWindow && !eye.currentWindow);
    await tp(a, 173.5);
    const merchant = Object.values(a.entities).find(e => e.name === 'villager');
    await a.openVillager(merchant); await sleep(300);
    check('native trade opens', !!a.currentWindow);
    await rcon(`minecraft:tp ${merchant.uuid} 183.5 101 100.5`);
    await until(() => !a.currentWindow, 'merchant moves out of range');
    check('merchant leaving range closes trade without player movement', !a.currentWindow);
    await qa('permit RoomQA'); a.chat('/backpack');
    await until(() => !!a.currentWindow, 'Minepacks backpack opens');
    check('actual Minepacks storage opens', !!a.currentWindow);
    await tp(a, 174.1); await until(() => !a.currentWindow, 'moving closes Minepacks');
    check('moving closes actual Minepacks backpack', !a.currentWindow);
    check('clients stay non OP', JSON.parse(readFileSync(`${stage}/ops.json`, 'utf8')).length === 0);
}
try {
  check('candidate 0.4.21', (await rcon('version AgentFriend')).includes('0.4.21'));
  const a = await connect('RoomQA'), b = await connect('RoomQAB'), c = await connect('RoomQAC');
  if (process.argv.includes('--verify-restart')) { await checkRestart(a, b, c); }
  else if (process.argv.includes('--windows-only')) { await windowChecks(a); }
  else if (process.argv.includes('--prepare-checkpoint')) { await prepareCheckpoint(c); }
  else if (process.argv.includes('--prepare-checkpoint-retry')) {
    await tp(c,140.5); await wave(c); const saved=save()['site-dungeons'].runs.audit_rooms;
    check('repeated cold test starts from intact fighting checkpoint',saved.phase==='fighting'&&saved.stage===2&&saved.attendance[c.player.uuid]===2,saved);
    report.preRestart=saved; expectedStop=true; await rcon('stop');
  }
  else if (process.argv.includes('--verify-checkpoint')) { await checkRestart(a,b,c); await verifyCheckpoint(c); }
  else {
    const d = await connect('RoomQAD'); await qa('fixtures');
    for (const bot of [a,b,c,d]) {
      await rcon(`minecraft:gamemode survival ${bot.username}`);
      await rcon(`minecraft:effect give ${bot.username} minecraft:strength 100000 50 true`);
      await rcon(`minecraft:effect give ${bot.username} minecraft:resistance 100000 5 true`);
    }
    let ids = await start(a, [b,c,d]);
    await strike(a, ids[0]); await tp(a, 110.5); await strike(b, ids[1]);
    await sleep(700);
    check('earlier room presence survives leaving before final kill', (await state(a)).attendance === 1);
    for (const bot of [b,c,d]) await tp(bot, 110.5);
    await tp(a, 120.5); ids = await wave(a);
    await qa(`arrowhit ${b.username} ${ids[0]}`);
    check('checkpoint retains run identity, phase and attendance', save()['site-dungeons'].runs.audit_rooms.phase === 'fighting' && !!save()['site-dungeons'].runs.audit_rooms.id);
    await sleep(900); // Let the real projectile travel and collide, rather than calling synthetic damage().
    await qa(`heal ${d.username} ${a.username}`);
    const ranged = await state(b), support = await state(d);
    check('ranged hit from outside room records participation', ranged.currentRoomParticipated, ranged);
    check('actual healing hook from outside room records support', support.currentRoomParticipated, support);
    check('absent member is not passively credited', !(await state(c)).currentRoomParticipated);
    for (const id of ids) await strike(a, id);
    await sleep(700);
    const absent = await state(c);
    check('missing room reported by name', absent.attendance === 1 && absent.missingRooms.includes('2·第二战斗室'), absent);
    for (const bot of [a,b,c,d]) await tp(bot, 140.5);
    ids = await wave(a); for (const id of ids) await strike(a, id); await sleep(700);
    check('all rooms cleared enters return phase', (await state(a)).phase === 'returning');
    for (const bot of [a,b,c,d]) await tp(bot, 100.5);
    await sleep(800);
    const ended = await state(a), missed = await state(c);
    check('qualified player gets receipt', !ended.active && ended.lastOutcome.reason === 'completed' && ended.lastOutcome.rewardStatus === 'ready', ended);
    check('missing participation prevents reward with explicit reason', missed.lastOutcome.rewardStatus === 'missing_participation' && !missed.pendingRewards.includes('audit_rooms'), missed);
    check('claim without proof includes actionable error', (await cli(c, 'claim audit_rooms')).reason === 'no_pending_reward');
    await until(() => c.actionbars.some(text => text.includes('操作未完成')), 'native error actionbar');
    check('errors show a short native actionbar', c.actionbars.some(text => text.includes('操作未完成')));
    await qa('rewardfull RoomQA');
    check('full reward queue rejects safely', (await cli(a, 'claim audit_rooms')).reason === 'personal_reward_queue_full');
    check('full queue retains receipt', (await state(a)).pendingRewards.includes('audit_rooms'));
    await qa('rewardreset RoomQA');
    const lock = `${stage}/plugins/AgentFriend/config.yml.site-dungeon.tmp`;
    mkdirSync(lock);
    try { check('write failure rejects reward commit', (await cli(a, 'claim audit_rooms')).reason === 'data_unavailable'); }
    finally { rmdirSync(lock); } // Only the known empty fixture directory.
    check('write failure retains receipt', (await state(a)).pendingRewards.includes('audit_rooms'));
    const rewardBefore = {...save()['dungeon-rewards']?.[a.player.uuid]};
    check('claim succeeds after storage recovers', (await cli(a, 'claim audit_rooms')).success);
    check('repeat claim cannot duplicate', (await cli(a, 'claim audit_rooms')).reason === 'no_pending_reward');
    const rewardAfter = save()['dungeon-rewards'][a.player.uuid];
    check('exactly one configured reward committed',rewardAfter.emerald===(rewardBefore.emerald??0)+8&&rewardAfter.iron_ingot===(rewardBefore.iron_ingot??0)+4,{before:rewardBefore,after:rewardAfter});
    check('claimed status and valid next commands', (await state(a)).lastOutcome.rewardStatus === 'claimed' && (await state(a)).lastOutcome.nextCommands.includes('/mycli arena stash'));
    // New attempt forgets unfinished attendance, and replaces enemies explicitly.
    ids = await start(c); await tp(c, 190.5);
    await sleep(700); const paused = await state(c);
    check('all outside pauses and explains reset', paused.paused && paused.pauseReason === 'all_outside_site' && paused.resets === 1, paused);
    await tp(c, 110.5); await sleep(600);
    check('unfinished attempt participation cleared', !(await state(c)).currentRoomParticipated);
    await tp(c, 100.5); const replay = await wave(c);
    check('replay uses new enemies and attempt number', replay.every(id => !ids.includes(id)) && (await state(c)).attempt === 2);
    check('leave success', (await cli(c, 'leave')).success);
    check('last member leaving saved', (await state(c)).lastOutcome.reason === 'party_left');
    ids = await start(c, [a]);
    await cli(c, 'leave');
    const left=await state(c);
    check('one member leaving has private durable result',left.active&&!left.participant&&left.lastOutcome.reason==='member_left');
    check('another active team cannot hide own prior result',left.lastOutcome.run===save()['site-dungeons'].outcomes[c.player.uuid].audit_rooms.run);
    await cli(a, 'leave');
    ids = await start(c); await qa(`remove ${ids[0]}`);
    await until(() => !save()['site-dungeons'].runs?.audit_rooms, 'invalid enemy outcome committed');
    check('vanished enemy cannot award clear and records reason', (await state(c)).lastOutcome.reason === 'missing_or_unloaded_enemy_retry_required');
    await start(c); await qa('expire time');
    await until(() => !save()['site-dungeons'].runs?.audit_rooms, 'timeout outcome committed');
    check('time limit records end reason', (await state(c)).lastOutcome.reason === 'time_limit');
    await start(c); await tp(c, 190.5);
    await until(() => save()['site-dungeons'].runs?.audit_rooms?.pausedAt>0, 'all outside checkpoint');
    await qa('expire grace'); await until(() => !save()['site-dungeons'].runs?.audit_rooms, 'grace outcome committed');
    check('grace expiration records end reason', (await state(c)).lastOutcome.reason === 'return_grace_expired');
    await windowChecks(a);
    report.savedState = save()['site-dungeons'];
  }
  check('no protocol errors', !report.errors.length, report.errors); report.messageSamples = a.lines.slice(-100); report.pass = true;
} catch (error) { report.pass = false; report.failure = error.stack; process.exitCode = 1; }
finally {
  for (const bot of bots) { if (bot.currentWindow) bot.closeWindow(bot.currentWindow); bot.quit('dungeon participation verification complete'); }
  if (process.env.MC_PROBE_REPORT) writeFileSync(process.env.MC_PROBE_REPORT, JSON.stringify(report,null,2));
  console.log(JSON.stringify({ pass: report.pass, checks: report.checks.length, failure: report.failure }));
}
