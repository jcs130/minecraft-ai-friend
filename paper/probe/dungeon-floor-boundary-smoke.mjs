// Live Paper 1.20.6 staging regression for recessed floor hazards and status.
// Requires the isolated arena server on port 25566 and its loopback RCON helper.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = command => execFileSync('node', [
  'E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command,
], { encoding: 'utf8' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const name = 'ChallengeQA';
const bot = mineflayer.createBot({
  host: '127.0.0.1', port: 25566, username: name, auth: 'offline', version: '1.20.6',
});
let lines = [];
bot.on('messagestr', message => {
  lines.push(message);
  if (lines.length > 500) lines.shift();
});
const waitLine = async (pattern, limitMs = 18000) => {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    const line = lines.find(value => pattern.test(value));
    if (line) return line;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${pattern}; last=${lines.slice(-10).join('|')}`);
};
const ask = async command => {
  lines = [];
  bot.chat(command);
  await sleep(700);
  return lines.join('\n');
};
const waitStatus = async (pattern, limitMs = 15000) => {
  const until = Date.now() + limitMs;
  let status = '';
  while (Date.now() < until) {
    status = await ask('/mycli arena status');
    if (pattern.test(status)) return status;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for status ${pattern}; last=${status}`);
};

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    bot.once('kicked', reason => reject(new Error(JSON.stringify(reason))));
    setTimeout(() => reject(new Error('spawn timeout')), 30000);
  });
  rcon(`gamemode creative ${name}`);
  await sleep(1500);
  let initial = await ask('/mycli arena status');
  let firstFloor = 1;
  if (/participant=true.*globalActive=true/.test(initial)) {
    firstFloor = Number(initial.match(/globalFloor=(\d+)/)?.[1]);
  } else {
    rcon(`tp ${name} -596 92 -313`);
    await sleep(700);
    assert.match(await ask('/mycli arena start'), /15 层试炼开始/);
  }

  for (let floor = firstFloor; floor <= 12; floor++) {
    if (floor === 7) {
      assert.match(await ask('/mycli arena status'), /globalFloor=7/);
      lines = [];
      bot.chat('/mycli arena next');
      await waitLine(/第 8\/15 层/);
      continue;
    }
    let fighting = '';
    for (let attempt = 0; attempt < 12; attempt++) {
      await sleep(800);
      fighting = await ask('/mycli arena status');
      if (new RegExp(`globalFloor=${floor}.*globalState=fighting|globalState=fighting.*globalFloor=${floor}`).test(fighting)) break;
    }
    assert.match(fighting, new RegExp(`globalFloor=${floor}.*remainingMobs=[1-9]`));
    lines = [];
    rcon('minecraft:kill @e[tag=afu_dungeon_mob]');
    await waitLine(new RegExp(`第 ${floor}\\/15 层已通关`));
    if (floor < 12) {
      lines = [];
      await waitLine(new RegExp(`第 ${floor + 1}\\/15 层`));
    }
  }
  if (firstFloor <= 12) {
    lines = [];
    await waitLine(/第 13\/15 层/);
  }
  const active = await waitStatus(/globalState=fighting.*globalFloor=13.*remainingMobs=7/);
  assert.match(active, /participant=true.*globalActive=true.*globalState=fighting.*globalFloor=13.*remainingMobs=7.*anomaly=none.*searchAdvice=search_remaining_mobs/);
  const audit = rcon('mycli admin dungeonaudit');
  assert.equal((audit.match(/MC_DUNGEON_MOB floor=13/g) ?? []).length, 7);
  assert.match(audit, /MC_DUNGEON_MOB floor=13 id=.* x=.* y=.* z=.* inFloor=true/);

  // The real failure was triggered when the player entered this one-block-deep lava channel.
  rcon(`tp ${name} -355 -16 -311`);
  await sleep(1800);
  const hazard = await ask('/mycli arena status');
  assert.match(hazard, /participant=true.*globalActive=true.*globalFloor=13.*selfFloor=13.*remainingMobs=7.*anomaly=none/);
  await sleep(16000);
  assert.match(await ask('/mycli arena status'), /globalActive=true.*globalFloor=13.*remainingMobs=7/);
  console.log('PASS floor 13 lava trench retains seven tracked live mobs and participant status');

  lines = [];
  rcon('minecraft:kill @e[tag=afu_dungeon_mob]');
  await waitLine(/第 13\/15 层已通关/);
  lines = [];
  await waitLine(/第 14\/15 层/);
  await waitStatus(/globalState=fighting.*globalFloor=14/);
  rcon(`tp ${name} -350 -3 -260`);
  await sleep(2200);
  assert.match(await ask('/mycli arena status'), /globalActive=true.*globalFloor=14.*selfFloor=0.*anomaly=participant_outside_floor.*searchAdvice=return_to_floor/);
  rcon(`tp ${name} -350 -3 -305`);
  await sleep(1700);
  assert.match(await ask('/mycli arena status'), /globalActive=true.*globalFloor=14.*selfFloor=14.*anomaly=none/);
  rcon(`tp ${name} -350 -3 -260`);
  await sleep(17500);
  const ended = await ask('/mycli arena status');
  assert.match(ended, /globalActive=false.*globalState=idle.*globalFloor=0.*remainingMobs=0.*searchAdvice=stop_no_active_run.*lastOutcome=failed.*lastFloor=14.*lastReason=party_outside_floor.*lastRunParticipant=true/);
  console.log('PASS outside-floor grace, recovery, final notice, and machine-readable terminal status');
} finally {
  bot.quit();
}
