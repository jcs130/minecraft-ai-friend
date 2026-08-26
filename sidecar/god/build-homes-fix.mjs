/**
 * build-homes-fix.mjs —— 新居坊·续建：为跳过选址的村民补屋（落差≤3 的合格新址）
 * 用法: RCON_PW=<pw> node sidecar/god/build-homes-fix.mjs <village_map.txt>
 */
import mineflayer from 'mineflayer'
import net from 'node:net'
import fs from 'node:fs'

const mapPath = process.argv[2]
const CX = -544, CZ = 864, R = 48
const PW = process.env.RCON_PW ?? ''
if (!mapPath || !PW) { console.error('usage: RCON_PW=<pw> node build-homes-fix.mjs <map>'); process.exit(2) }

const plan = JSON.parse(fs.readFileSync('data/homes-plan.json', 'utf-8'))
const villagers = JSON.parse(fs.readFileSync('ops/docker/shadow/mcdata/village/villagers.json', 'utf-8')).villagers
const PENDING = ['吟游诗人·风临', '渔夫·浪伯', '老农·禾叔']
const todo = PENDING.map(dn => villagers.find(v => v.display === dn)).filter(Boolean)
if (todo.length !== PENDING.length) { console.error('名单不全'); process.exit(1) }

const grid = fs.readFileSync(mapPath, 'utf-8').split(/\r?\n/).filter(l => l.length > 50)
const at = (dx, dz) => grid[dz + R]?.[dx + R] ?? '?'
const OK = new Set(['G', ','])
const SKIP = [[-525, 847], [-530, 890], [-578, 847]] // 落差弃址
const nearAny = (x, z, pts, d) => pts.some(p => Math.hypot(p[0] - x, p[1] - z) < d)
const builtPts = plan.homes.map(h => [h.x, h.z])

function rconCmd(cmd) {
  return new Promise((resolve, reject) => {
    const pkt = (type, id, body) => { const len = 4 + 4 + body.length + 2, b = Buffer.alloc(4 + len); b.writeInt32LE(len, 0); b.writeInt32LE(id, 4); b.writeInt32LE(type, 8); body.copy(b, 12); b.writeInt16LE(0, 12 + body.length); return b }
    const sock = net.createConnection({ host: '127.0.0.1', port: Number(process.env.RCON_PORT ?? 25575) }, () => sock.write(pkt(3, 1, Buffer.from(PW, 'utf8'))))
    let stage = 0, acc = Buffer.alloc(0)
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('rcon timeout')) }, 8000)
    sock.on('data', (chunk) => {
      acc = Buffer.concat([acc, chunk])
      if (stage === 0) { stage = 1; sock.write(pkt(2, 2, Buffer.from(cmd, 'utf8'))) }
      else { clearTimeout(timer); sock.destroy(); resolve(acc.subarray(14).toString('utf-8').trim()) }
    })
    sock.on('error', reject)
  })
}
const JOB = { weaponsmith: 'grindstone', armorer: 'blast_furnace', toolsmith: 'smithing_table', librarian: 'lectern', farmer: 'composter', shepherd: 'loom', fisherman: 'barrel', cleric: 'brewing_stand', mason: 'stonecutter', cartographer: 'cartography_table', nitwit: null }

const bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(process.env.MC_PORT ?? 25599), username: 'RenderBot', auth: 'offline' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
bot.once('spawn', async () => {
  const { Vec3: V } = await import('vec3')
  try {
    await rconCmd('gamemode spectator RenderBot')
    await rconCmd(`tp RenderBot ${CX} 90 ${CZ}`)
    await sleep(1500)
    const topY = async (x, z) => { for (let y = 90; y > 40; y--) { const b = bot.world.getBlock(new V(x, y, z)); if (b && b.name !== 'air') return y } return -1 }
    // 全域候选 → 逐个探高（距现居最近优先）
    const cands = []
    for (let dz = -44; dz <= 44; dz++) for (let dx = -44; dx <= 44; dx++) {
      const d = Math.hypot(dx, dz); if (d < 20 || d > 42) continue
      let bad = false
      for (let z = dz - 3; z <= dz + 3 && !bad; z++) for (let x = dx - 3; x <= dx + 3; x++) if (!OK.has(at(x, z))) { bad = true; break }
      if (!bad) cands.push({ dx, dz })
    }
    for (const v of todo) {
      let done = false
      cands.sort((a, b) => Math.hypot(CX + a.dx - v.spawn[0], CZ + a.dz - v.spawn[2]) - Math.hypot(CX + b.dx - v.spawn[0], CZ + b.dz - v.spawn[2]))
      for (const c of cands) {
        if (done) break
        const x = CX + c.dx, z = CZ + c.dz
        if (nearAny(x, z, builtPts, 9) || nearAny(x, z, SKIP, 5)) continue
        const hs = []
        for (const [px, pz] of [[x - 2, z - 2], [x + 2, z - 2], [x - 2, z + 2], [x + 2, z + 2], [x, z]]) hs.push(await topY(px, pz))
        if (Math.max(...hs) - Math.min(...hs) > 3) { SKIP.push([x, z]); continue }
        const g = Math.max(...hs) + 1
        const south = c.dz <= 0, fz = south ? z + 2 : z - 2, F = south ? 'south' : 'north'
        const headZ = south ? z - 1 : z + 1, footZ = z, bedF = south ? 'north' : 'south'
        const cmds = [
          `fill ${x - 3} ${g + 1} ${z - 3} ${x + 3} ${g + 7} ${z + 3} air`,
          `fill ${x - 2} ${g - 3} ${z - 2} ${x + 2} ${g - 1} ${z - 2} cobblestone replace air`,
          `fill ${x - 2} ${g - 3} ${z + 2} ${x + 2} ${g - 1} ${z + 2} cobblestone replace air`,
          `fill ${x - 2} ${g - 3} ${z - 1} ${x + 2} ${g - 1} ${z + 1} cobblestone replace air`,
          `fill ${x - 2} ${g} ${z - 2} ${x + 2} ${g} ${z + 2} cobblestone`,
          `fill ${x - 1} ${g} ${z - 1} ${x + 1} ${g} ${z + 1} oak_planks`,
          `fill ${x - 2} ${g + 1} ${z - 2} ${x + 2} ${g + 3} ${z - 2} oak_planks`,
          `fill ${x - 2} ${g + 1} ${z + 2} ${x + 2} ${g + 3} ${z + 2} oak_planks`,
          `fill ${x - 2} ${g + 1} ${z - 1} ${x - 2} ${g + 3} ${z + 1} oak_planks`,
          `fill ${x + 2} ${g + 1} ${z - 1} ${x + 2} ${g + 3} ${z + 1} oak_planks`,
          `fill ${x - 2} ${g + 1} ${z - 2} oak_log`, `fill ${x + 2} ${g + 1} ${z - 2} oak_log`,
          `fill ${x - 2} ${g + 1} ${z + 2} oak_log`, `fill ${x + 2} ${g + 1} ${z + 2} oak_log`,
          `fill ${x - 2} ${g + 2} ${z - 2} oak_log`, `fill ${x + 2} ${g + 2} ${z - 2} oak_log`,
          `fill ${x - 2} ${g + 2} ${z + 2} oak_log`, `fill ${x + 2} ${g + 2} ${z + 2} oak_log`,
          `fill ${x - 2} ${g + 3} ${z - 2} oak_log`, `fill ${x + 2} ${g + 3} ${z - 2} oak_log`,
          `fill ${x - 2} ${g + 3} ${z + 2} oak_log`, `fill ${x + 2} ${g + 3} ${z + 2} oak_log`,
          `fill ${x - 2} ${g + 4} ${z - 2} ${x - 2} ${g + 4} ${z + 2} oak_stairs[east]`,
          `fill ${x + 2} ${g + 4} ${z - 2} ${x + 2} ${g + 4} ${z + 2} oak_stairs[west]`,
          `fill ${x - 1} ${g + 4} ${z - 2} ${x + 1} ${g + 4} ${z + 2} oak_planks`,
          `fill ${x - 1} ${g + 5} ${z - 2} ${x - 1} ${g + 5} ${z + 2} oak_stairs[east]`,
          `fill ${x + 1} ${g + 5} ${z - 2} ${x + 1} ${g + 5} ${z + 2} oak_stairs[west]`,
          `fill ${x} ${g + 5} ${z - 2} ${x} ${g + 5} ${z + 2} oak_planks`,
          `fill ${x} ${g + 6} ${z - 2} ${x} ${g + 6} ${z + 2} oak_planks`,
          `setblock ${x} ${g + 1} ${fz} oak_door[half=lower,facing=${F},hinge=left]`,
          `setblock ${x} ${g + 2} ${fz} oak_door[half=upper,facing=${F},hinge=left]`,
          `setblock ${x - 2} ${g + 2} ${z} glass_pane`,
          `setblock ${x + 2} ${g + 2} ${z} glass_pane`,
          `setblock ${x} ${g + 2} ${south ? z - 2 : z + 2} glass_pane`,
          `setblock ${x - 1} ${g + 1} ${footZ} red_bed[part=foot,facing=${bedF}]`,
          `setblock ${x - 1} ${g + 1} ${headZ} red_bed[part=head,facing=${bedF}]`,
          `setblock ${x + 1} ${g + 2} ${z} wall_torch[facing=west]`,
          `setblock ${x + 1} ${g + 3} ${fz + (south ? 1 : -1)} wall_torch[facing=${south ? 'north' : 'south'}]`,
          `fill ${x} ${g} ${fz + (south ? 1 : -1)} ${x} ${g} ${fz + (south ? 3 : -3)} gravel`,
        ]
        for (const c2 of cmds) await rconCmd(c2)
        const job = JOB[v.profession] ?? null
        if (job) await rconCmd(`setblock ${x + 1} ${g + 1} ${headZ} ${job}`)
        builtPts.push([x, z])
        plan.homes.push({ n: plan.homes.length + 1, x, z, g, south, doorF: F, key: v.key, display: v.display, profession: v.profession, job, tag: v.tag, spawn: [x + 0.5, g + 1, z + 0.5], bed: [x - 1, g + 1, headZ] })
        console.log(`补建 ${v.display} @ ${x},${g},${z} 生计=${job}`)
        done = true
      }
      if (!done) console.error(`!! ${v.display} 找不到合格新址`)
    }
    fs.writeFileSync('data/homes-plan.json', JSON.stringify(plan, null, 1))
    console.log(`homes total ${plan.homes.length}`)
  } catch (e) { console.error('fix fail:', e.message) } finally { bot.quit(); process.exit(0) }
})
