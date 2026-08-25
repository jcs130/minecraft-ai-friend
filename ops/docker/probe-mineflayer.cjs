// probe-mineflayer.cjs — 冒烟探针：mineflayer（纯原版协议）能否接入 Docker 新服
// 用法：node ops/docker/probe-mineflayer.cjs [port]
const mineflayer = require('mineflayer')
const port = Number(process.argv[2] || 25699)
console.log('probe → 127.0.0.1:' + port + ' (version 1.21.1, offline)')
const bot = mineflayer.createBot({
  host: '127.0.0.1',
  port,
  username: 'NumenProbe',
  version: '1.21.1',
  auth: 'offline',
})
bot.on('login', () => console.log('LOGIN OK（握手通过）'))
bot.on('spawn', () => {
  console.log('SPAWN OK pos=', bot.entity.position.toString())
  bot.quit()
  setTimeout(() => process.exit(0), 500)
})
bot.on('kicked', (r) => { console.log('KICKED:', JSON.stringify(r)); process.exit(1) })
bot.on('error', (e) => console.log('ERROR:', e.message))
bot.on('end', (r) => console.log('END:', r))
setTimeout(() => { console.log('TIMEOUT: 20s 内未 spawn'); process.exit(2) }, 20000)
