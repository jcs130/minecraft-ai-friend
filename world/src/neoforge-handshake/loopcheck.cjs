// 双向闭环：ag_ bot 经外门 placeBlock 放错位号方块(书架/床/黑曜石) → 服务器 if block 确认真放了原版方块
const mineflayer = require('D:/copaw-workspaces/mc-god/scratch/mc-agent-neko/node_modules/mineflayer')
const V = require('D:/copaw-workspaces/mc-god/scratch/mc-agent-neko/node_modules/vec3')
const { spawnSync } = require('child_process')
const rcon = c => (spawnSync('python', ['-c',
  'import sys;sys.path.insert(0,r"D:\\copaw-workspaces\\mc-god\\scratch");import god_rcon;print(god_rcon.rcon(sys.argv[1]))', c],
  { encoding: 'utf-8', timeout: 30000 }).stdout || '').trim()
const P = { x: -536, y: 66, z: 864 }
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25702, username: 'ag_loop', auth: 'offline', version: '1.21.1', checkTimeoutInterval: 120000 })
bot.once('spawn', async () => {
  rcon('gamemode creative ag_loop')
  await new Promise(r => setTimeout(r, 1500))
  rcon('clear ag_loop')
  rcon(`give ag_loop minecraft:bookshelf 3`)
  rcon(`setblock ${P.x} ${P.y - 1} ${P.z} minecraft:glass`)
  await new Promise(r => setTimeout(r, 2500))
  const sup = bot.blockAt(new V(P.x, P.y - 1, P.z))
  console.log('bot 视角支撑块:', sup && sup.name)
  const item = bot.inventory.findInventoryItem('bookshelf')
  console.log('背包书架:', item ? item.name + ' x' + item.count : '无')
  bot.setQuickBarHotbarSlot ? null : null
  await bot._client.write ? null : null
  await new Promise(r => setTimeout(r, 400))
  try { await bot.equip(item, 'hand') } catch (e) { console.log('equip err', e.message) }
  try {
    await bot.placeBlock(sup, new V(0, 1, 0))
    console.log('placeBlock 调用完成 ✓')
  } catch (e) { console.log('placeBlock err:', e.message) }
  await new Promise(r => setTimeout(r, 2500))
  const chk = rcon(`execute if block ${P.x} ${P.y} ${P.z} minecraft:bookshelf run say LOOP_OK`)
  console.log('服务器端 if bookshelf:', chk || '(无输出=失败)')
  // 再看 bot 自己回读(经翻译出站)
  const back = bot.blockAt(new V(P.x, P.y, P.z))
  console.log('bot 回读该格:', back && back.name)
  rcon('setblock ' + P.x + ' ' + P.y + ' ' + P.z + ' minecraft:air')
  rcon('setblock ' + P.x + ' ' + (P.y - 1) + ' ' + P.z + ' minecraft:air')
  rcon('gamemode survival ag_loop')
  bot.quit(); setTimeout(() => process.exit(0), 300)
})
bot.on('error', e => { console.log('ERR', e.message); process.exit(1) })
