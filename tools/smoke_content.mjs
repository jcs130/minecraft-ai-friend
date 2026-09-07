// Run inside the project's world image with /checks mounted read-only.
import {open, readFile, unlink} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {Rcon} from '/app/src/rcon.ts';
import {parseNbtPosition} from '/app/src/mc-nbt.ts';
const QA = 'QDContentProbe', DATA = '/app/data';
const report = {project: 'qiandengji', startedAt: new Date().toISOString(), ok: false, checks: [], cleanup: {}};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => {if (!condition) throw new Error(message);};
let rcon, bot, lock, secret = '', slotOwned = false, timer, mode;
const restoredAdvancements = [];
const command = async text => rcon.send(text, 8000);
const check = (name, detail = {}) => report.checks.push({name, ok: true, ...detail});
try {
  assert(process.env.SMOKE_EXECUTE === 'qiandengji' && process.env.SMOKE_PROJECT === 'qiandengji', 'Missing project execution guards');
  assert((await readFile(`${DATA}/.qiandengji-smoke`, 'utf8')).trim() === 'qiandengji', 'Missing project marker');
  lock = await open(`${DATA}/.qiandengji-smoke.lock`, 'wx');
  await lock.writeFile(JSON.stringify({player: QA, at: report.startedAt}));
  secret = (await readFile(`${DATA}/rcon-secret.txt`, 'utf8')).trim();
  rcon = new Rcon('mc', 25575, secret); await rcon.connect(6000);
  assert(!(await command('list')).includes(QA), 'QA player already online');
  assert((await command('datapack list enabled')).includes('file/qiandeng_fixes'), 'Content fixes not enabled');
  check('content-datapack-enabled');
  const require = createRequire('/app/package.json');
  bot = require('mineflayer').createBot({host: 'mc', port: 25599, username: QA, version: '1.21.1', auth: 'offline', hideErrors: true});
  bot.on('error', () => {});
  await new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('QA login timeout')), 25000);
    bot.once('spawn', resolve); bot.once('error', reject);
  });
  clearTimeout(timer); await pause(1200); check('mineflayer-login');
  const rawPosition = await command(`data get entity ${QA} Pos`);
  const position = parseNbtPosition(rawPosition);
  assert(position && position.every(Number.isFinite), 'Actual player NBT position cannot be parsed for exploration');
  check('exploration-position-parser', {position, doubleSuffixObserved: /\d[dD]/.test(rawPosition)});
  const oldMode = (await command(`data get entity ${QA} playerGameType`)).match(/entity data: (\d+)/);
  assert(oldMode, 'Cannot preserve QA game mode'); mode = Number(oldMode[1]);
  await command(`gamemode creative ${QA}`);
  assert(/Found no elements/.test(await command(`data get entity ${QA} Inventory[{Slot:8b}]`)), 'QA hotbar 8 must be empty');
  slotOwned = true;
  let anthillItem;
  for (let attempt = 0; attempt < 12; attempt++) {
    await command(`loot replace entity ${QA} hotbar.8 1 loot spawn:archaeology/anthill`);
    const data = await command(`data get entity ${QA} Inventory[{Slot:8b}].id`);
    anthillItem = data.match(/entity data: "([a-z0-9_:]+)"/)?.[1];
    if (anthillItem) break;
  }
  assert(['minecraft:string', 'minecraft:leather', 'spawn:fallen_leaves', 'minecraft:clay', 'minecraft:red_mushroom', 'minecraft:brown_mushroom', 'spawn:ant_pupa'].includes(anthillItem), 'Anthill table did not produce a supported item');
  check('anthill-loot-generated', {item: anthillItem});
  await command(`item replace entity ${QA} hotbar.8 with minecraft:air`);
  await command(`loot replace entity ${QA} hotbar.8 1 loot touhou_little_maid_spell:entities/shadow_assassin`);
  const rapier = await command(`data get entity ${QA} Inventory[{Slot:8b}]`);
  assert(rapier.includes('irons_spellbooks:amethyst_rapier'), 'Assassin table did not produce its rapier');
  assert(rapier.includes('minecraft:sharpness') && rapier.includes('irons_spellbooks:shadow_slash'), 'Existing rapier enchantment or spell was lost');
  assert(!rapier.includes('farmersdelight:backstabbing'), 'Missing optional enchantment was retained');
  check('assassin-loot-generated', {item: 'irons_spellbooks:amethyst_rapier', sharpnessAndShadowSlashRetained: true});
  for (const name of ['find_thornborn_towers', 'find_fishing_hut']) {
    const id = `dungeons_arise:${name}`;
    const state = await command(`execute if entity @a[name=${QA},advancements={${id}=true}]`);
    if (/Test passed/.test(state)) {
      check(`advancement:${name}`, {alreadyPresent: true});
      continue;
    }
    const reply = await command(`advancement grant ${QA} only ${id}`);
    assert(/Granted/.test(reply), `Advancement unavailable: ${id}`);
    restoredAdvancements.push(id);
    assert(/Test passed/.test(await command(`execute if entity @a[name=${QA},advancements={${id}=true}]`)), 'Grant did not persist on QA');
    check(`advancement:${name}`);
  }
  report.ok = true;
} catch (error) {
  report.error = String(error?.message || error).replaceAll(secret || '\0', '[redacted]').slice(0, 500);
} finally {
  clearTimeout(timer);
  if (rcon?.isConnected()) {
    try {
      if (slotOwned) {await command(`item replace entity ${QA} hotbar.8 with minecraft:air`); report.cleanup.testLootRemoved = true;}
      for (const id of restoredAdvancements) await command(`advancement revoke ${QA} only ${id}`);
      report.cleanup.testAdvancementsRevoked = restoredAdvancements;
      if (mode !== undefined) await command(`gamemode ${['survival', 'creative', 'adventure', 'spectator'][mode]} ${QA}`);
    } catch (error) {report.ok = false; report.cleanup.error = String(error.message);}
  } else if (slotOwned || restoredAdvancements.length || mode !== undefined) {
    report.ok = false;
    report.cleanup.incomplete = 'RCON disconnected before reserved QA state could be restored';
  }
  if (bot) {bot.quit('Content verification complete'); await pause(300); bot._client?.end();}
  if (rcon?.isConnected()) {
    try {report.cleanup.probeDisconnected = !(await command('list')).includes(QA); if (!report.cleanup.probeDisconnected) report.ok = false;}
    catch {report.ok = false;}
  }
  rcon?.close();
  if (lock) {await lock.close(); await unlink(`${DATA}/.qiandengji-smoke.lock`);}
  report.finishedAt = new Date().toISOString();
  report.scope = 'Actual server loot generation and registered advancement grants on a reserved QA player; no natural monster kill or structure visit claimed';
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
process.exit(report.ok ? 0 : 1);
