
const mineflayer = require('D:/copaw-workspaces/mc-god/scratch/mc-agent-neko/node_modules/mineflayer')
const Vec3 = require('D:/copaw-workspaces/mc-god/scratch/mc-agent-neko/node_modules/vec3')
const { spawnSync } = require('child_process')
const rcon = c => (spawnSync('python', ['-c',
  'import sys;sys.path.insert(0,r"D:\\copaw-workspaces\\mc-god\\scratch");import god_rcon;print(god_rcon.rcon(sys.argv[1]))', c],
  { encoding: 'utf-8', timeout: 30000 }).stdout || '').trim()
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25701, username: 'QDVerify',
  version: '1.21.1', auth: 'offline', checkTimeoutInterval: 120000 })
bot.on('error', e => { console.log('ERR', e.message); process.exit(1) })
bot.once('spawn', async () => {
  await new Promise(r => setTimeout(r, 4000))
  rcon('tp QDVerify -536 64 862')
  await new Promise(r => setTimeout(r, 9000))
  const T = [[-538, 64, 861, 'red_bed'], [-538, 64, 860, 'red_bed'], [-536, 64, 864, 'stone']]
  let okN = 0
  for (const [x, y, z, want] of T) {
    const b = bot.blockAt(new Vec3(x + 0.5, y + 0.5, z + 0.5))
    const got = b ? b.name.replace('minecraft:', '') : 'null'
    const ok = got === want
    okN += ok
    console.log(`(${x},${y},${z}) 期望=${want} 实读=${got} ${ok ? '✓' : '✗'}`)
  }
  // 再现场验三块历史重灾区
  for (const [nm] of [['torch'], ['obsidian'], ['bookshelf']]) {
    rcon(`setblock -536 65 866 minecraft:${nm}`); await new Promise(r => setTimeout(r, 1500))
    const b = bot.blockAt(new Vec3(-535.5, 65.5, 866.5))
    const got = b ? b.name.replace('minecraft:', '') : 'null'
    console.log(`现场放 ${nm} → 经门读成 ${got} ${got === nm ? '✓✓' : '✗'}`)
    rcon(`setblock -536 65 866 air`)
  }
  console.log('床样本通过', okN, '/3')
  bot.quit(); process.exit(0)
})
