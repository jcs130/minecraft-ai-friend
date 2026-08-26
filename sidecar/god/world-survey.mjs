/**
 * world-survey.mjs —— 天使之眼·文本测绘（天神用，2026-08-26）
 * 用法: RCON_PW=<pw> node sidecar/god/world-survey.mjs <x> <z> [radius=48] [maxAirY=90]
 * 输出: 每格一个字符的俯视图（地表方块分类）+ 高度图。给无视觉的模型做规划用。
 */
import mineflayer from 'mineflayer'
import net from 'node:net'

const [, , xS, zS, rS, maxY] = process.argv
const CX = Number(xS), CZ = Number(zS), R = Number(rS ?? 48), MAXY = Number(maxY ?? 90)
const PW = process.env.RCON_PW ?? ''
const PORT = Number(process.env.MC_PORT ?? 25599)
const RPORT = Number(process.env.RCON_PORT ?? 25575)
if (!Number.isFinite(CX) || !Number.isFinite(CZ) || !PW) { console.error('usage: RCON_PW=<pw> node world-survey.mjs <x> <z> [radius] [maxY]'); process.exit(2) }

function rconCmd(cmd) {
  return new Promise((resolve, reject) => {
    const pkt = (type, id, body) => { const len = 4 + 4 + body.length + 2, b = Buffer.alloc(4 + len); b.writeInt32LE(len, 0); b.writeInt32LE(id, 4); b.writeInt32LE(type, 8); body.copy(b, 12); b.writeInt16LE(0, 12 + body.length); return b }
    const sock = net.createConnection({ host: '127.0.0.1', port: RPORT }, () => sock.write(pkt(3, 1, Buffer.from(PW, 'utf8'))))
    let stage = 0, acc = Buffer.alloc(0)
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('rcon timeout')) }, 8000)
    sock.on('data', (chunk) => {
      acc = Buffer.concat([acc, chunk])
      if (stage === 0) { stage = 1; sock.write(pkt(2, 2, Buffer.from(cmd, 'utf8'))) }
      else { clearTimeout(timer); sock.destroy(); resolve(acc.subarray(14).toString('utf8').trim()) }
    })
    sock.on('error', reject)
  })
}

const cls = (name) => {
  if (!name || name === 'air') return '?'
  if (/grass_block|podzol|dirt_path$/.test(name)) return name === 'dirt_path' ? 'p' : 'G'
  if (/tall_grass|grass$|poppy|dandelion|flower|fern|sweet_berry|wheat|carrots|potatoes|beetroots/.test(name)) return name.includes('wheat') || name.includes('carrot') || name.includes('potato') || name.includes('beetroot') ? 'a' : ','
  if (/farmland|dirt_path/.test(name)) return 'a'
  if (/water/.test(name)) return 'W'
  if (/bed$/.test(name)) return 'B'
  if (/cobble|stone_bricks|bricks$/.test(name)) return 'C'
  if (/planks|stairs|slab|fence|door|glass|barrel|chest|crafting|furnace|blast|smoker|loom|cartography|fletching|grindstone|lectern|composter|bell|bookshelf|hay/.test(name)) return 'O'
  if (/oak_log|spruce_log|log$/.test(name)) return 'L'
  if (/leaves/.test(name)) return 'V'
  if (/gravel|path/.test(name)) return 'p'
  if (/sand|sandstone/.test(name)) return 'S'
  if (/dirt$/.test(name)) return 'D'
  if (/torch|lantern/.test(name)) return 't'
  if (/stone$|andesite|diorite|granite|deepslate/.test(name)) return 'R'
  if (/snow|ice/.test(name)) return 'I'
  if (/lantern/.test(name)) return 't'
  return '#'
}

const bot = mineflayer.createBot({ host: '127.0.0.1', port: PORT, username: 'RenderBot', auth: 'offline' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
bot.once('spawn', async () => {
  const { Vec3: V } = await import('vec3')
  try {
    await rconCmd('gamemode spectator RenderBot')
    await rconCmd(`tp RenderBot ${CX} 90 ${CZ}`)
    await sleep(1500)
    for (let dz = -R; dz <= R; dz++) {
      let row = ''
      for (let dx = -R; dx <= R; dx++) {
        let ch = '?'
        // 逐列找顶块
        for (let y = MAXY; y > 40; y--) {
          const blk = bot.world.getBlock(new V(CX + dx, y, CZ + dz))
          if (blk && blk.name !== 'air') { ch = cls(blk.name); break }
        }
        row += ch
      }
      console.log(row)
    }
  } catch (e) { console.error('survey fail:', e.message) } finally { bot.quit(); process.exit(0) }
})
