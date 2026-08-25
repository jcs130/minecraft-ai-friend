// scratch raw-probe：裸 minecraft-protocol 客户端叩神社之门，隔离门/mineflayer 问题
'use strict'
const mc = require('minecraft-protocol')
const client = mc.createClient({
  host: '127.0.0.1',
  port: Number(process.argv[2] || 25700),
  username: 'RawProbe',
  version: '1.21.1',
  auth: 'offline'
})
const t0 = Date.now()
const log = (s) => console.log(`[+${Date.now() - t0}ms] ${s}`)
client.on('state', (n, o) => log(`state: ${o} -> ${n}`))
client.on('success', (p) => log('LOGIN_SUCCESS ' + p.username))
client.on('login', (p) => log('JOIN_GAME entityId=' + p.entityId))
client.on('spawn', () => log('SPAWN'))
client.on('disconnect', (p) => log('DISCONNECT ' + JSON.stringify(p.reason).slice(0, 200)))
client.on('kick_disconnect', (p) => log('KICK ' + JSON.stringify(p.reason).slice(0, 200)))
client.on('error', (e) => log('ERROR ' + e.message))
client.on('end', (r) => { log('END ' + r); process.exit(0) })
setTimeout(() => { log('TIMEOUT 15s'); process.exit(2) }, 15000)
