import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const rcon = command => execFileSync('node',
  ['E:/MC/staging/arena-dungeon-20260928/rcon-stage.mjs', command], {encoding: 'utf8'});
const bot = mineflayer.createBot({host: '127.0.0.1', port: 25566,
  username: 'CortiLan', auth: 'offline', version: '1.20.6'});
const summary = raw => {
  const m = raw.match(/MC_ARENA_PRUNE_BAG player=CortiLan apply=(true|false) count=(\d+) credited=(\d+) bagUsedBefore=(\d+) bagUsedAfter=(\d+) balanceBefore=(\d+) balanceAfter=(\d+)/);
  assert.ok(m, raw);
  return {apply:m[1]==='true',count:+m[2],credited:+m[3],before:+m[4],
    after:+m[5],balanceBefore:+m[6],balanceAfter:+m[7]};
};
try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reject);
  });
  const before = summary(rcon('mycli admin prunetrialbag CortiLan'));
  assert.ok(before.count >= 1, JSON.stringify(before));
  assert.ok(before.credited > 0 && before.after === before.before - before.count);
  const appliedRaw = rcon('mycli admin prunetrialbag CortiLan apply');
  const applied = summary(appliedRaw);
  assert.deepEqual(applied, {...before,apply:true});
  assert.match(appliedRaw,/MC_ARENA_PRUNE_BAG success=true/);
  const again = summary(rcon('mycli admin prunetrialbag CortiLan'));
  assert.equal(again.count,0);
  assert.equal(again.before,before.after);
  assert.equal(again.balanceBefore,before.balanceAfter);
  console.log(JSON.stringify({verdict:'PASS',removed:applied.count,
    bagBefore:applied.before,bagAfter:applied.after,credited:applied.credited,
    balanceAfter:applied.balanceAfter}));
} finally { bot.quit(); }
