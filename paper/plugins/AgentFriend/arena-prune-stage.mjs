import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = command => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], {encoding: 'utf8'});
const bot = mineflayer.createBot({host: '127.0.0.1', port: 25566,
  username: 'CortiLan', auth: 'offline', version: '1.20.6'});
const lines = [];
bot.on('messagestr', line => lines.push(line));
const summary = raw => {
  const m = raw.match(/MC_ARENA_PRUNE player=CortiLan apply=(true|false) count=(\d+) credited=(\d+) chestUsedBefore=(\d+) chestUsedAfter=(\d+) balanceBefore=(\d+) balanceAfter=(\d+)/);
  assert.ok(m, raw);
  return {apply: m[1] === 'true', count: +m[2], credited: +m[3],
    before: +m[4], after: +m[5], balanceBefore: +m[6], balanceAfter: +m[7]};
};
try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  bot.chat('/mycli admin prunetrial CortiLan apply');
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.ok(lines.some(line => line.includes('只允许服务器控制台整理试炼箱')),
    'player should not execute maintenance');
  const preview = summary(rcon('mycli admin prunetrial CortiLan'));
  if (process.argv.includes('--persist')) {
    assert.equal(preview.count, 0, 'duplicates should remain recycled after restart');
    assert.equal(preview.balanceBefore, 60, 'wallet should remain credited after restart');
    console.log(JSON.stringify({verdict: 'PASS', restarted: true,
      chestUsed: preview.before, balance: preview.balanceBefore}));
    process.exit(0);
  }
  assert.ok(preview.count >= 1 && preview.before >= 10, JSON.stringify(preview));
  assert.ok(preview.credited > 0 && preview.after === preview.before - preview.count);
  const appliedRaw = rcon('mycli admin prunetrial CortiLan apply');
  const applied = summary(appliedRaw);
  assert.deepEqual(applied, {...preview, apply: true});
  assert.match(appliedRaw, /MC_ARENA_PRUNE success=true/);
  const repeat = summary(rcon('mycli admin prunetrial CortiLan'));
  assert.equal(repeat.count, 0, 'second call is idempotent');
  assert.equal(repeat.before, preview.after);
  assert.equal(repeat.balanceBefore, preview.balanceAfter);
  console.log(JSON.stringify({verdict: 'PASS', removed: applied.count,
    chestBefore: applied.before, chestAfter: applied.after, credited: applied.credited,
    balanceAfter: applied.balanceAfter}));
} finally { bot.quit(); }
