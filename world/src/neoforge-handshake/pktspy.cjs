// 看 setblock 瞬间前端收到什么包(名+字段) → 定位 block_changed_value 真名
const mineflayer = require('D:/copaw-workspaces/mc-god/scratch/mc-agent-neko/node_modules/mineflayer')
const { spawnSync } = require('child_process')
const rcon = c => (spawnSync('python', ['-c',
  'import sys;sys.path.insert(0,r"D:\\copaw-workspaces\\mc-god\\scratch");import god_rcon;print(god_rcon.rcon(sys.argv[1]))', c],
  { encoding: 'utf-8', timeout: 30000 }).stdout || '').trim()
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25701, username: 'QDPkt3', auth: 'offline', version: '1.21.1', checkTimeoutInterval: 120000 })
const rx = []
bot._client.on('packet', (d, meta) => {
  const n = (meta && meta.name) || ''
  if (!bot._armed) return
  if (/block/.test(n) || n === 'unload_chunk' || n === 'set_disabled_features') {
    rx.push(n + ' :: ' + String(JSON.stringify(d) || '').slice(0, 220))
  }
})
bot.once('spawn', async () => {
  rcon('tp QDPkt3 -536 65 866')          // 先传送到村庄区块内,不然什么都收不到 ✓
  await new Promise(r => setTimeout(r, 5000))
  bot._armed = true
  rcon('setblock -536 66 864 minecraft:obsidian')
  await new Promise(r => setTimeout(r, 2500))
  rcon('setblock -536 66 864 minecraft:diamond_block')
  await new Promise(r => setTimeout(r, 2500))
  for (const l of rx.slice(0, 14)) console.log(l)
  bot.quit(); setTimeout(() => process.exit(0), 300)
})
bot.on('error', e => { console.log('ERR', e.message); process.exit(1) })
