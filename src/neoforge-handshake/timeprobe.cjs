// update_time 探针:连指定端口 30s,数 update_time 包 + 打印 time 值
// 用法:node timeprobe.cjs <port> [username]
'use strict'
const mineflayer = require('mineflayer')
const [port = '25700', username = 'TimeProbe' + Math.floor(Math.random() * 999)] = process.argv.slice(2)
const host = process.env.TP_HOST || '127.0.0.1'

const bot = mineflayer.createBot({
  host, port: Number(port), username, version: '1.21.1', auth: 'offline'
})
let n = 0
const t0 = Date.now()
bot.on('update_time', (p) => {
  n++
  if (n <= 3 || n % 10 === 0) console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] update_time #${n}: ${JSON.stringify(p).slice(0, 100)}`)
})
bot.on('login', () => console.log(`LOGIN ok (${username}@${port})`))
bot.on('kicked', (r) => { console.log('KICKED:', String(r).slice(0, 200)); process.exit(1) })
bot.on('error', (e) => { console.log('ERROR:', e.message); process.exit(1) })
setTimeout(() => {
  console.log(`RESULT port=${port} update_time_packets=${n} bot.time=${bot.time ? JSON.stringify({ time: bot.time.time, age: bot.time.age }) : 'NULL'}`)
  bot.quit()
  process.exit(0)
}, 30000)
