/**
 * build-homes.mjs —— 新居坊：为 16 位具名村民各建一座平原风小屋（天神营造，2026-08-26）
 * 用法: RCON_PW=<pw> node sidecar/god/build-homes.mjs <village_map.txt> [--dry]
 * 流程: 读测绘图 → 纯草地选 16 址（互相隔开、成环）→ RenderBot 探地基 → RCON 营造 → 落 homes.json
 * 小屋 5x5：碎石地基 + 橡木板墙/原木角柱 + 三级坡顶 + 玻璃窗 + 橡木门(朝村心) + 红床 + 职业生计方块 + 火把 + 门前碎石径
 */
import mineflayer from 'mineflayer'
import net from 'node:net'
import fs from 'node:fs'

const mapPath = process.argv[2]
const villagersPath = process.argv[3] ?? 'ops/docker/shadow/mcdata/village/villagers.json'
const DRY = process.argv.includes('--dry')
const CX = -544, CZ = 864, R = 48
const PW = process.env.RCON_PW ?? ''
const PORT = Number(process.env.MC_PORT ?? 25599)
const RPORT = Number(process.env.RCON_PORT ?? 25575)
if (!mapPath || !PW) { console.error('usage: RCON_PW=<pw> node build-homes.mjs <village_map.txt> [--dry]'); process.exit(2) }

const grid = fs.readFileSync(mapPath, 'utf-8').split(/\r?\n/).filter(l => l.length > 50)
if (grid.length !== 2 * R + 1) { console.error(`map rows ${grid.length} != ${2 * R + 1}`); process.exit(2) }
const at = (dx, dz) => { const c = dx + R, r = dz + R; return (grid[r]?.[c]) ?? '?' }

// ---- 选址：7x7 全为草地/草花，且不含 '?'，距村心 24..42 ----
const OK = new Set(['G', ','])
const cands = []
for (let dz = -44; dz <= 44; dz++) for (let dx = -44; dx <= 44; dx++) {
  const d = Math.hypot(dx, dz); if (d < 24 || d > 42) continue
  let bad = false
  for (let z = dz - 3; z <= dz + 3 && !bad; z++) for (let x = dx - 3; x <= dx + 3; x++) if (!OK.has(at(x, z))) { bad = true; break }
  if (!bad) cands.push({ dx, dz, d })
}
cands.sort((a, b) => a.d - b.d)
// 最大最小距离分散（含距村心权重），互距 >= 8
const homes = []
const minD = (p) => homes.length ? Math.min(...homes.map(h => Math.hypot(h.dx - p.dx, h.dz - p.dz))) : 999
while (homes.length < 16 && cands.length) {
  let best = -1, bi = -1
  for (let i = 0; i < cands.length; i++) { const score = Math.min(minD(cands[i]), 10) * 2 + (42 - cands[i].d) * 0.1; if (score > best) { best = score; bi = i } }
  const c = cands.splice(bi, 1)[0]
  if (minD(c) < 8) continue
  homes.push(c)
}
console.log(`选址 ${homes.length}/16：` + homes.map(h => `(${h.dx},${h.dz})`).join(' '))
if (homes.length < 16) { console.error('空地不足，中止'); process.exit(1) }
if (DRY) { homes.forEach(h => console.log(`home @ ${CX + h.dx},${CZ + h.dz}`)); process.exit(0) }

// ---- RCON ----
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

const JOB = { weaponsmith: 'grindstone', armorer: 'blast_furnace', toolsmith: 'smithing_table', librarian: 'lectern', farmer: 'composter', shepherd: 'loom', fisherman: 'barrel', cleric: 'brewing_stand', mason: 'stonecutter', cartographer: 'cartography_table', nitwit: null }

// ---- 村民配房：按现居最近贪心 ----
const villagers = JSON.parse(fs.readFileSync(villagersPath, 'utf-8')).villagers
if (villagers.length < homes.length) { console.error(`villagers ${villagers.length} < homes`); process.exit(1) }
const remaining = villagers.map(v => ({ ...v }))
const assign = homes.map(h => {
  let bi = -1, bd = 1e9
  for (let i = 0; i < remaining.length; i++) { const dd = Math.hypot(remaining[i].spawn[0] - CX - h.dx, remaining[i].spawn[2] - CZ - h.dz); if (dd < bd) { bd = dd; bi = i } }
  const v = remaining.splice(bi, 1)[0]
  return { home: h, villager: v }
})
assign.forEach((a, i) => console.log(`#${i + 1} ${a.villager.display}(${a.villager.profession}) -> (${CX + a.home.dx},${CZ + a.home.dz})`))

const bot = mineflayer.createBot({ host: '127.0.0.1', port: PORT, username: 'RenderBot', auth: 'offline' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
bot.once('spawn', async () => {
  const { Vec3: V } = await import('vec3')
  try {
    await rconCmd('gamemode spectator RenderBot')
    await rconCmd(`tp RenderBot ${CX} 90 ${CZ}`)
    await sleep(1500)
    const topY = async (x, z) => { for (let y = 90; y > 40; y--) { const b = bot.world.getBlock(new V(x, y, z)); if (b && b.name !== 'air') return y } return -1 }
    const out = []
    let n = 0
    for (const a of assign) {
      const h = a.home, v = a.villager
      const x = CX + h.dx, z = CZ + h.dz
      const corners = [[x - 2, z - 2], [x + 2, z - 2], [x - 2, z + 2], [x + 2, z + 2], [x, z]]
      const hs = []
      for (const [px, pz] of corners) hs.push(await topY(px, pz))
      const g = Math.max(...hs) + 1            // 地基顶面 = 最高角+1
      if (Math.max(...hs) - Math.min(...hs) > 3) { console.log(`skip (${x},${z}) 落差过大 ${Math.max(...hs)}-${Math.min(...hs)}`); continue }
      const south = h.dz <= 0                   // 村北 → 门朝南
      const fz = south ? z + 2 : z - 2, bz = south ? z - 2 : z + 2
      const F = south ? 'south' : 'north'
      const cmds = [
        // 清表 + 地基
        `fill ${x - 3} ${g + 1} ${z - 3} ${x + 3} ${g + 7} ${z + 3} air`,
        `fill ${x - 2} ${g - 3} ${z - 2} ${x + 2} ${g - 1} ${z - 2} cobblestone replace air`,
        `fill ${x - 2} ${g - 3} ${z + 2} ${x + 2} ${g - 1} ${z + 2} cobblestone replace air`,
        `fill ${x - 2} ${g - 3} ${z - 1} ${x + 2} ${g - 1} ${z + 1} cobblestone replace air`,
        `fill ${x - 2} ${g} ${z - 2} ${x + 2} ${g} ${z + 2} cobblestone`,
        `fill ${x - 1} ${g} ${z - 1} ${x + 1} ${g} ${z + 1} oak_planks`,
        // 墙体（角柱原木 + 板墙）+ 门洞
        `fill ${x - 2} ${g + 1} ${z - 2} ${x + 2} ${g + 3} ${z - 2} oak_planks`,
        `fill ${x - 2} ${g + 1} ${z + 2} ${x + 2} ${g + 3} ${z + 2} oak_planks`,
        `fill ${x - 2} ${g + 1} ${z - 1} ${x - 2} ${g + 3} ${z + 1} oak_planks`,
        `fill ${x + 2} ${g + 1} ${z - 1} ${x + 2} ${g + 3} ${z + 1} oak_planks`,
        `fill ${x - 2} ${g + 1} ${z - 2} oak_log`,
        `fill ${x + 2} ${g + 1} ${z - 2} oak_log`,
        `fill ${x - 2} ${g + 1} ${z + 2} oak_log`,
        `fill ${x + 2} ${g + 1} ${z + 2} oak_log`,
        `fill ${x - 2} ${g + 2} ${z - 2} oak_log`,
        `fill ${x + 2} ${g + 2} ${z - 2} oak_log`,
        `fill ${x - 2} ${g + 2} ${z + 2} oak_log`,
        `fill ${x + 2} ${g + 2} ${z + 2} oak_log`,
        `fill ${x - 2} ${g + 3} ${z - 2} oak_log`,
        `fill ${x + 2} ${g + 3} ${z - 2} oak_log`,
        `fill ${x - 2} ${g + 3} ${z + 2} oak_log`,
        `fill ${x + 2} ${g + 3} ${z + 2} oak_log`,
        // 三级坡顶
        `fill ${x - 2} ${g + 4} ${z - 2} ${x - 2} ${g + 4} ${z + 2} oak_stairs[east]`,
        `fill ${x + 2} ${g + 4} ${z - 2} ${x + 2} ${g + 4} ${z + 2} oak_stairs[west]`,
        `fill ${x - 1} ${g + 4} ${z - 2} ${x + 1} ${g + 4} ${z + 2} oak_planks`,
        `fill ${x - 1} ${g + 5} ${z - 2} ${x - 1} ${g + 5} ${z + 2} oak_stairs[east]`,
        `fill ${x + 1} ${g + 5} ${z - 2} ${x + 1} ${g + 5} ${z + 2} oak_stairs[west]`,
        `fill ${x} ${g + 5} ${z - 2} ${x} ${g + 5} ${z + 2} oak_planks`,
        `fill ${x} ${g + 6} ${z - 2} ${x} ${g + 6} ${z + 2} oak_planks`,
        // 门 + 窗
        `setblock ${x} ${g + 1} ${fz} oak_door[half=lower,facing=${F},hinge=left]`,
        `setblock ${x} ${g + 2} ${fz} oak_door[half=upper,facing=${F},hinge=left]`,
        `setblock ${x - 2} ${g + 2} ${z} glass_pane`,
        `setblock ${x + 2} ${g + 2} ${z} glass_pane`,
        `setblock ${x} ${g + 2} ${bz} glass_pane`,
      ]
      for (const c of cmds) await rconCmd(c)
      // 床（靠后墙内侧，头朝后墙）
      const headZ = south ? z - 1 : z + 1, footZ = z
      const bedF = south ? 'north' : 'south'
      await rconCmd(`setblock ${x - 1} ${g + 1} ${footZ} red_bed[part=foot,facing=${bedF}]`)
      await rconCmd(`setblock ${x - 1} ${g + 1} ${headZ} red_bed[part=head,facing=${bedF}]`)
      // 生计方块（后墙东北角，村民白天上工用）+ 屋内壁挂火把（东墙）
      const job = JOB[v.profession] ?? null
      if (job) await rconCmd(`setblock ${x + 1} ${g + 1} ${headZ} ${job}`)
      await rconCmd(`setblock ${x + 1} ${g + 2} ${z} wall_torch[facing=west]`)
      // 门楣火把 + 门前碎石径（朝村心）
      await rconCmd(`setblock ${x + 1} ${g + 3} ${fz + (south ? 1 : -1)} wall_torch[facing=${south ? 'north' : 'south'}]`)
      await rconCmd(`fill ${x} ${g} ${fz + (south ? 1 : -1)} ${x} ${g} ${fz + (south ? 3 : -3)} gravel`)
      out.push({ n: ++n, x, z, g, south, doorF: F, key: v.key, display: v.display, profession: v.profession, job, tag: v.tag, spawn: [x + 0.5, g + 1, z + 0.5], bed: [x - 1, g + 1, headZ] })
      console.log(`home#${n} ${v.display} @ ${x},${g},${z} 门${F} 生计=${job ?? '无'}`)
    }
    fs.writeFileSync('data/homes-plan.json', JSON.stringify({ cx: CX, cz: CZ, homes: out }, null, 1))
    console.log(`done ${out.length} homes -> data/homes-plan.json`)
  } catch (e) { console.error('build fail:', e.message) } finally { bot.quit(); process.exit(0) }
})
