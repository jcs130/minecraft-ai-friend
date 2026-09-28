import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire('E:/Cortico/package.json');
const mineflayer = require('mineflayer');
const node = 'C:/Users/lzl19/AppData/Local/hermes/node/node.exe';
const bot = mineflayer.createBot({ host: '192.168.3.163', port: 25565, username: 'AfuGoddessProbe', auth: 'offline', version: '1.20.6' });
const seen = [];
const timeout = setTimeout(() => { bot.quit(); process.exitCode = 2; }, 30000);
bot.on('messagestr', message => seen.push(message));
bot.once('spawn', async () => {
  try {
    bot.chat('/mycli goddess skills'); await sleep(500);
    bot.chat('/mycli cast feather'); await sleep(500);
    bot.chat('/mycli cast starlight'); await sleep(500);
    bot.chat('/mycli goddess learn feather'); await sleep(500);
    execFileSync(node, ['E:/MC/probe/rcon.mjs', 'experience add AfuGoddessProbe 5 levels'], { encoding: 'utf8' });
    await sleep(400);
    bot.chat('/mycli goddess learn feather'); await sleep(500);
    bot.chat('/mycli cast feather'); await sleep(500);
    execFileSync(node, ['E:/MC/probe/rcon.mjs', 'mycli admin teach AfuGoddessProbe night'], { encoding: 'utf8' });
    await sleep(400);
    bot.chat('/mycli cast night'); await sleep(700);
    const checks = {
      catalog: seen.some(x => x.includes('可学习：羽落')),
      locked: seen.some(x => x.includes('还没学会这项女神技艺')),
      starlight: seen.some(x => x.includes('星尘术：')),
      levelGate: seen.some(x => x.includes('需要 5 级经验')),
      learned: seen.some(x => x.includes('已学会 feather')),
      feather: seen.some(x => x.includes('羽落术生效')),
      taught: seen.some(x => x.includes('女神传授了 night')),
      night: seen.some(x => x.includes('夜视术生效')),
    };
    console.log(JSON.stringify(checks));
    if (Object.values(checks).some(x => !x)) throw new Error('Goddess spell smoke failed');
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally { clearTimeout(timeout); bot.quit(); }
});
bot.once('error', error => { console.error(error.stack); clearTimeout(timeout); process.exitCode = 1; });
