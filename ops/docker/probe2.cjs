// 探针：监听 configuration 阶段的所有 custom_payload 通道
const mineflayer = require('mineflayer');
const port = parseInt(process.argv[2] || '25599', 10);

const bot = mineflayer.createBot({
  host: '127.0.0.1',
  port,
  username: 'NumenProbe2',
  version: '1.21.1',
  hideErrors: false,
});

const chans = [];
bot._client.on('custom_payload', (p) => {
  const name = p.name || (p.channel) || 'unknown';
  chans.push(name);
  console.log('CUSTOM_PAYLOAD:', name, 'len', (p.data && p.data.length) || 0);
});
bot._client.on('ping', (p) => console.log('PING id=', p.id));
bot.on('login', () => console.log('LOGIN OK'));
bot.on('spawn', () => { console.log('SPAWN OK — vanilla gate PASS; chans seen:', chans.length); bot.quit(); process.exit(0); });
bot.on('kicked', (r) => { console.log('KICKED:', JSON.stringify(r).slice(0, 300)); process.exit(2); });
bot.on('error', (e) => { console.log('ERR:', String(e).slice(0, 200)); });
setTimeout(() => { console.log('TIMEOUT 25s. chans captured:', JSON.stringify(chans)); process.exit(3); }, 25000);
