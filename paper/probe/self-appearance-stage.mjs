// Independent lab only: no production identities, password changes, or public chat.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [labDirectory, reportFile, rconModule, dependencyPackage, mode = 'apply'] = process.argv.slice(2);
assert.ok(['apply','readback'].includes(mode));
assert.ok([labDirectory, reportFile, rconModule, dependencyPackage].every(x => x && path.isAbsolute(x)), 'Provide four absolute paths for the isolated lab, report, RCON module and Mineflayer package');
const properties = await readFile(path.join(labDirectory, 'paper/server.properties'), 'utf8');
assert.match(properties, /^server-port=29120$/m, 'Never point this fixture at production');
const { command } = await import(pathToFileURL(rconModule)), mf = createRequire(dependencyPackage)('mineflayer');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { scope: 'isolated real Paper 1.21.1 / native YSM 2.4.1 / vanilla-protocol Agent; no modded renderer pixel acceptance', checks: [], started: new Date().toISOString() };
const bots = [];
const suffix = process.env.APPEARANCE_TEST_SUFFIX || '';
assert.match(suffix, /^[a-z0-9]{0,2}$/);
function check(name, condition) { assert.ok(condition, name); report.checks.push(name); console.log('PASS', name); }
async function until(predicate, label, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await delay(100); }
  throw Error(label + ' timed out');
}
async function connect(username) {
  const bot = mf.createBot({ host: '127.0.0.1', port: 29122, username, auth: 'offline', version: '1.21.1', hideErrors: true });
  bots.push(bot); bot.messages = []; bot.appearances = []; bot.profiles = []; bot.assets = [];
  bot.on('error', error => { bot.lastError = error.message; }); bot.on('end', () => { bot.ended = true; });
  bot.on('kicked', reason => { bot.kickReason = String(reason); });
  bot.on('message', message => bot.messages.push(message.toString()));
  bot._client.on('packet', (data, meta) => { if (meta.name.startsWith('player_info')) bot.profiles.push(JSON.stringify(data)); });
  bot._client.on('custom_payload', packet => {
    if (packet.channel === 'mcagent:appearance') { try { bot.appearances.push(JSON.parse(packet.data)); } catch {} }
    if (packet.channel === 'mcagent:ysm_asset') { try { bot.assets.push(JSON.parse(packet.data)); } catch {} }
  });
  await until(() => bot.entity || bot.ended, username + ' spawn'); assert.ok(!bot.ended, bot.kickReason || bot.lastError);
  bot._client.write('custom_payload', { channel: 'minecraft:register', data: Buffer.from('mcagent:appearance\0mcagent:ysm_asset') });
  return bot;
}
try {
  await until(async () => { try { return (await command('minecraft:list', 3000, { port: 29121, properties: path.join(labDirectory, 'paper/server.properties') })).includes('players online'); } catch { return false; } }, 'Paper ready', 90_000);
  const owner = await connect('ag_SelfYsm26' + suffix), witness = await connect('ag_SeeYsm26' + suffix);
  await delay(2000);
  if (mode === 'readback') {
    owner.chat('/appearance status');
    await until(() => owner.appearances.some(s => s.playerName === owner.username && s.available && s.modelId === 'qiandengji_naruto'), 'saved native model restored');
    const saved = owner.appearances.findLast(s => s.playerName === owner.username && s.available);
    check('original UUID native model survives normal cold restart', saved.playerUuid === owner._client.uuid && saved.texture === 'skin');
    check('restored original model resource is Web/camera renderable', saved.webAvailable && saved.assetBytes > 0);
    const binding = JSON.parse(await readFile(path.join(labDirectory, 'paper/plugins/SkinsRestorer/players', owner._client.uuid + '.player'), 'utf8'));
    check('signed vanilla skin binding survives cold restart', binding.skinIdentifier.identifier === 'afu_naruto');
    const signed = JSON.parse(await readFile(path.join(labDirectory, 'paper/plugins/SkinsRestorer/skins/afu_naruto.customskin'), 'utf8'));
    await until(() => witness.profiles.some(text => text.includes(signed.value)), 'saved signed skin delivery');
    check('standard peer receives same signed skin after reconnect', true);
    check('restart does not replay or falsely confirm an old selection command', !owner.messages.some(m => m.includes('换装已提交') || m.includes('YSM已应用：')));
    report.success = true;
  } else {
  owner.chat('/appearance list');
  await until(() => owner.messages.some(m => m.includes('MC_APPEARANCE_CATALOG') && m.includes('qiandengji_naruto')), 'public catalog');
  check('existing catalog command retained for an ordinary Agent', true);
  owner.chat('/appearance set qiandengji_naruto skin');
  await until(() => owner.messages.some(m => m.includes('换装已提交')), 'self command acknowledgment');
  check('unmodified non-OP Agent submits own catalog model', true);
  owner.chat('/appearance set qiandengji_naruto skin');
  await until(() => owner.messages.some(m => m.includes('未重复提交') || m.includes('换装冷却')), 'duplicate suppression');
  check('repeated command does not dispatch again', true);
  await until(() => owner.messages.some(m => m.includes('YSM已应用：qiandengji_naruto / skin')), 'actual native confirmation');
  check('success waits for actual Worker model readback', true);
  await until(() => witness.appearances.some(s => s.playerName === owner.username && s.modelId === 'qiandengji_naruto' && s.texture === 'skin' && s.webAvailable === true), 'peer appearance projection');
  const state = witness.appearances.findLast(s => s.playerName === owner.username && s.modelId === 'qiandengji_naruto');
  check('Web and camera metadata use same UUID and actual gameplay entity', state.playerUuid === owner._client.uuid && state.entityId === owner.entity.id);
  check('only requested body changes', !witness.appearances.some(s => s.playerName === witness.username && s.modelId === 'qiandengji_naruto'));
  witness._client.write('custom_payload', { channel: 'mcagent:ysm_asset', data: Buffer.from(JSON.stringify({ type: 'get', modelId: state.modelId, sha256: state.assetSha256, requestId: '00112233445566778899aabbccddeeff' })) });
  await until(() => witness.assets.some(p => p.type === 'chunk'), 'original model asset transfer');
  check('existing game-connection original model transfer retained', true);
  const before = witness.messages.length;
  owner.chat(`/appearance set ${witness.username} qiandengji_naruto skin`);
  await until(() => owner.messages.some(m => m.includes('只能修改本人')), 'foreign target refusal');
  owner.chat(`/appearance admin set ${witness.username} qiandengji_naruto skin`);
  await until(() => owner.messages.some(m => m.includes('仅服务器控制台')), 'admin command refusal');
  check('no command can assign another body', true);
  check('tool receipts do not enter other players chat', witness.messages.slice(before).every(m => !/外观|换装|控制台/.test(m)));
  owner.chat('/skin help');
  await until(() => owner.messages.some(m => /skin (set|url|clear|search)/.test(m)), 'normal skin help');
  check('ordinary vanilla skin commands discoverable without operator grant', true);
  owner.chat('/skin set afu_naruto');
  const binding = path.join(labDirectory, 'paper/plugins/SkinsRestorer/players', owner._client.uuid + '.player');
  await until(async () => { try { return JSON.parse(await readFile(binding, 'utf8')).skinIdentifier?.identifier === 'afu_naruto'; } catch { return false; } }, 'normal skin UUID binding');
  check('ordinary Agent changes its own signed vanilla skin using existing plugin', true);
  const signed = JSON.parse(await readFile(path.join(labDirectory, 'paper/plugins/SkinsRestorer/skins/afu_naruto.customskin'), 'utf8'));
  await until(() => witness.profiles.some(text => text.includes(signed.value)), 'real skin profile delivery');
  check('another standard client receives real signed skin texture', true);
  const ops = JSON.parse(await readFile(path.join(labDirectory, 'paper/ops.json'), 'utf8'));
  check('no operator permissions used or granted', ops.length === 0);
  report.success = true;
  }
} catch (error) { report.success = false; report.error = error.stack; report.clients = bots.map(b => ({ name: b.username, error: b.lastError, kicked: b.kickReason, messages: b.messages.slice(-18), appearance: b.appearances.slice(-3) })); process.exitCode = 1; }
finally { for (const bot of bots) if (!bot.ended) bot.quit(); await delay(400); report.finished = new Date().toISOString(); await writeFile(reportFile, JSON.stringify(report, null, 2)); }
