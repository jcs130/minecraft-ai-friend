// 对拍探针:数 packet name->id 映射,重点找 update_time 的 wire id
// 用法: TP_HOST=x node idprobe.cjs <port> [label]
'use strict'
const mineflayer = require('mineflayer')
const [port = '25565', label = 'direct'] = process.argv.slice(2)
const host = process.env.TP_HOST || 'host.docker.internal'
const username = 'IdProbe' + Math.floor(Math.random() * 999)
const bot = mineflayer.createBot({ host, port: Number(port), username, version: '1.21.1', auth: 'offline' })
const seen = {} // name -> {id, count}
bot._client.on('packet', (params, meta) => {
  const e = seen[meta.name] || (seen[meta.name] = { id: meta.id, count: 0 })
  e.count++
  if (e.id !== meta.id) e.multi = true
})
bot.on('login', () => console.log(`LOGIN ${label}@${port}`))
setTimeout(() => {
  const rows = Object.entries(seen).map(([n, e]) => ({ n, id: e.id, c: e.c, multi: e.multi }))
    .sort((a, b) => a.id - b.id)
  console.log(`=== ${label} name->id census ===`)
  for (const r of rows) if (/time|update/.test(r.n) || r.c <= 40) console.log(`id=${r.id} ${r.n} count=${r.c}${r.multi ? ' MULTI!' : ''}`)
  console.log(`total distinct names=${rows.length}, ids range ${rows[0]?.id}-${rows[rows.length - 1]?.id}`)
  const ut = seen.update_time
  console.log(`update_time: ${ut ? 'id=' + ut.id + ' count=' + ut.count : 'NOT SEEN'}`)
  bot.quit(); process.exit(0)
}, 30000)
