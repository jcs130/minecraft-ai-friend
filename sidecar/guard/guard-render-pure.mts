/**
 * guard-render-pure.mts —— 守卫之眼·纯 JS 快图（替代 chromium 3D 截图，2026-08-24）
 *
 * 背景：旧 guard-render.mts 用 mineflayer 临时 bot + socket.io + playwright 无头 chromium
 * 截图 prismarine-viewer 3D 页，出图 ~20s（浏览器启动 + 两页 wait），且 3D 截图有
 * 大气/村民不可见/高空全天空等干扰。参考 MindCraft 的思路：不用浏览器，直接读
 * bot.world 的块数据出图——但 MindCraft 的 node-canvas-webgl 因 native 依赖（headless-gl+
 * node-canvas）在本机 windows 装不上（无 node-v127 prebuilt + 缺 cairo.h），故放弃 WebGL，
 * 改为**纯 JS 块颜色映射 + pngjs 编码 PNG**：零 native、免浏览器、极快（<5s）。
 *
 * 输出：正俯视块地图（雷达图）。块颜色清晰（无大气/村民缺失干扰），对 qwen3.8 视觉最友好；
 * 中心标记守卫位置 + 朝向箭头。
 *
 * 用法（由守卫桥 / MCP render_view 低频调用）：
 *   RCON_PW=<pw> node tsx guard-render-pure.mts <x> <y> <z> <out.png> [yaw_deg] [radius格] [px每格]
 * 依赖：B 仓 node_modules（mineflayer / pngjs / vec3）。RCON 25575 密码 env 读，不落盘。
 */
import mineflayer from 'mineflayer'
import { Vec3 } from 'vec3'
import { PNG } from 'pngjs'
import net from 'node:net'

const [, , xS, yS, zS, outPng, yawS, pitchS, radiusS, pxS] = process.argv
const X = Number(xS), Y = Number(yS), Z = Number(zS)
const YAW = yawS !== undefined && yawS !== '' ? Number(yawS) : null
const RADIUS = radiusS !== undefined && radiusS !== '' ? Number(radiusS) : 16
const PX = pxS !== undefined && pxS !== '' ? Math.max(2, Number(pxS)) : 6
const RCON_PW = process.env.RCON_PW ?? ''
const MC_PORT = Number(process.env.MC_PORT ?? 25599)
const RCON_PORT = Number(process.env.RCON_PORT ?? 25575)
const BOT_NAME = process.env.GUARD_RENDER_NAME ?? 'RenderBot'
const log = (m: string) => console.log(`[render-pure] ${m}`)

if (!Number.isFinite(X) || !Number.isFinite(Y) || !Number.isFinite(Z) || !outPng || !RCON_PW) {
  console.error('usage: RCON_PW=<pw> node tsx guard-render-pure.mts <x> <y> <z> <out.png> [yaw_deg] [radius] [px]')
  process.exit(2)
}

// ---- 极简 RCON（移植自 guard-render.mts） ----
function rconCmd(pw: string, port: number, cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const pkt = (type: number, id: number, body: Buffer): Buffer => {
      const len = 4 + 4 + body.length + 2
      const b = Buffer.alloc(4 + len)
      b.writeInt32LE(len, 0)
      b.writeInt32LE(id, 4)
      b.writeInt32LE(type, 8)
      body.copy(b, 12)
      b.writeInt16LE(0, 12 + body.length)
      return b
    }
    const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
      sock.write(pkt(3, 1, Buffer.from(pw, 'utf8')))
    })
    let stage = 0
    let acc = Buffer.alloc(0)
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('rcon timeout')) }, 6000)
    const sendCmd = () => sock.write(pkt(2, 2, Buffer.from(cmd, 'utf8')))
    sock.on('data', (chunk) => {
      acc = Buffer.concat([acc, chunk])
      while (acc.length >= 4) {
        const len = acc.readInt32LE(0)
        if (len < 10 || acc.length < 4 + len) return
        const body = acc.subarray(4, 4 + len)
        acc = acc.subarray(4 + len)
        if (stage === 0) { stage = 1; sendCmd() }
        else {
          clearTimeout(timer); sock.destroy()
          resolve(body.subarray(8).toString('utf8').replace(/\u0000+$/g, ''))
        }
      }
    })
    sock.on('error', (e) => { clearTimeout(timer); reject(e) })
  })
}

// ---- 块色表（常用方块 → RGB；精简，其余默认浅灰） ----
const COLORS: Record<string, [number, number, number]> = {
  grass_block: [106, 170, 64], dirt: [134, 96, 67], stone: [125, 125, 125],
  cobblestone: [110, 110, 110], bedrock: [74, 74, 74], deepslate: [80, 80, 90],
  sand: [220, 212, 160], gravel: [140, 128, 126], sandstone: [216, 199, 140],
  water: [55, 100, 220], lava: [200, 60, 0],
  oak_log: [102, 76, 40], oak_leaves: [60, 120, 40], birch_log: [190, 190, 180],
  birch_leaves: [110, 150, 70], spruce_log: [60, 50, 30], spruce_leaves: [40, 80, 50],
  dark_oak_log: [50, 40, 25], dark_oak_leaves: [45, 70, 40],
  acacia_log: [120, 70, 50], acacia_leaves: [90, 110, 60],
  jungle_log: [70, 55, 40], jungle_leaves: [50, 100, 50],
  oak_planks: [162, 130, 78], spruce_planks: [107, 84, 50], birch_planks: [186, 170, 125],
  stone_bricks: [120, 120, 120], mossy_cobblestone: [90, 120, 70],
  coal_ore: [80, 80, 80], iron_ore: [140, 120, 110], gold_ore: [170, 150, 60],
  diamond_ore: [90, 150, 150], emerald_ore: [60, 160, 100], redstone_ore: [160, 50, 50],
  snow_block: [240, 245, 250], ice: [150, 180, 220], packed_ice: [130, 160, 210],
  pumpkin: [200, 130, 30], melon: [120, 170, 60], wheat: [190, 180, 90],
  tall_grass: [120, 150, 70], grass: [130, 160, 80], fern: [90, 130, 70],
  poppy: [180, 60, 60], dandelion: [220, 220, 80], rose_bush: [160, 60, 60],
  torch: [230, 170, 60], lantern: [230, 170, 60], glowstone: [220, 190, 110],
  chest: [140, 100, 50], crafting_table: [120, 90, 50], furnace: [90, 90, 90],
  bookshelf: [140, 110, 70], bed: [200, 60, 60], flower_pot: [130, 80, 60],
  path: [180, 160, 120], farmland: [110, 70, 40], podzol: [90, 60, 30],
  clay: [160, 170, 180], terracotta: [150, 100, 80], concrete: [120, 120, 120],
  bamboo: [100, 140, 60], sugar_cane: [140, 180, 100], cactus: [80, 140, 60],
  lily_pad: [50, 130, 80], seagrass: [60, 120, 90], kelp: [40, 110, 70],
  air: [0, 0, 0], // never drawn (skip)
}

function colorFor(name: string): [number, number, number] {
  // 取主名（去掉 _block/post 等常见后缀前先查精确，再回退前缀）
  if (COLORS[name]) return COLORS[name]
  for (const key of Object.keys(COLORS)) {
    if (name === key) return COLORS[key]
  }
  // 简单回退：按关键名词干
  const n = name || ''
  if (n.startsWith('oak_leaves') || n.startsWith('spruce_leaves') || n.startsWith('dark_oak')) return [50, 90, 45]
  if (n.includes('leaves')) return [60, 110, 45]
  if (n.includes('log') || n.includes('wood')) return [110, 80, 45]
  if (n.includes('planks')) return [160, 128, 78]
  if (n.includes('ore')) return [90, 90, 90]
  if (n.includes('cobblestone') || n.includes('stone')) return [118, 118, 118]
  if (n.includes('water') || n.includes('kelp')) return [70, 110, 210]
  if (n.includes('sand')) return [216, 208, 160]
  if (n.includes('glass')) return [170, 190, 200]
  if (n.includes('flower') || n.includes('poppy') || n.includes('tulip')) return [170, 70, 70]
  if (n.includes('grass')) return [106, 170, 64]
  return [127, 127, 127] as [number, number, number]
}

// ---- 读列顶层块（跳过空气/洞穴空气/虚空空气） ----
function topBlockAt(world: any, bx: number, bz: number, yTop: number, yBottom: number) {
  for (let y = yTop; y >= yBottom; y--) {
    const b = world.getBlock(new Vec3(bx, y, bz))
    if (b && b.name && !['air', 'cave_air', 'void_air'].includes(b.name)) return b
  }
  return null
}

async function main(): Promise<void> {
  const bot = mineflayer.createBot({
    host: 'localhost', port: MC_PORT, username: BOT_NAME, version: '1.21.1',
  })
  await new Promise<void>((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('spawn timeout')), 30_000)
    bot.once('spawn', () => { clearTimeout(to); resolve() })
    bot.once('error', (e) => { clearTimeout(to); reject(e) })
    bot.once('end', (r) => { clearTimeout(to); reject(new Error(`bot end: ${r}`)) })
  })
  log(`spawned, tp to (${X}, ${Y}, ${Z})`)
  try {
    await rconCmd(RCON_PW, RCON_PORT, `gamemode spectator ${BOT_NAME}`)
    await rconCmd(RCON_PW, RCON_PORT, `tp ${BOT_NAME} ${X} ${Y} ${Z}`)
  } catch (e) {
    log(`rcon warn: ${(e as Error).message}`)
  }
  await new Promise((r) => setTimeout(r, 5000)) // 等区块加载

  const size = RADIUS * 2 + 1
  const imgW = size * PX, imgH = size * PX
  const png = new PNG({ width: imgW, height: imgH })
  const YTOP = Math.floor(Y) + 56
  const YBOT = Math.max(0, Math.floor(Y) - 48)
  const t0 = Date.now()
  for (let dz = -RADIUS; dz <= RADIUS; dz++) {
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      const bx = Math.round(X) + dx, bz = Math.round(Z) + dz
      const b = topBlockAt(bot.world, bx, bz, YTOP, YBOT)
      const col = b ? colorFor(b.name) : [40, 40, 40]
      // 填 PX×PX 像素块
      const px0 = (dx + RADIUS) * PX, py0 = (dz + RADIUS) * PX
      for (let py = py0; py < py0 + PX; py++) {
        for (let px = px0; px < px0 + PX; px++) {
          const idx = (imgW * py + px) << 2
          png.data[idx] = col[0]
          png.data[idx + 1] = col[1]
          png.data[idx + 2] = col[2]
          png.data[idx + 3] = 255
        }
      }
    }
  }
  log(`read ${size}x${size} blocks in ${Date.now() - t0}ms`)

  // 中心标记守卫位置（红点，十字放大）+ 朝向箭头（白三角，指向 yaw 方向）
  const cx = RADIUS * PX, cy = RADIUS * PX
  function setPx(px: number, py: number, r: number, g: number, b: number) {
    if (px < 0 || py < 0 || px >= imgW || py >= imgH) return
    const idx = (imgW * py + px) << 2
    png.data[idx] = r; png.data[idx + 1] = g; png.data[idx + 2] = b; png.data[idx + 3] = 255
  }
  // 红点（半径 PX 半格）
  const rr = Math.max(2, Math.floor(PX * 0.6))
  for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
    if (dx * dx + dy * dy <= rr * rr) setPx(cx + dx, cy + dy, 255, 40, 40)
  }
  // 朝向箭头（yaw：MC yaw 0=南(+Z) 90=西(-X) 180=北(-Z) 270=东(+X)，需换算 canvas y 轴向下）
  if (YAW !== null) {
    const ang = (YAW * Math.PI) / 180   // MC 正角 = 顺时针（从北看），canvas 需反转
    // MC yaw: 0 => +Z(南/下), 90 => -X(西/左), 180 => -Z(北/上), 270 => +X(东/右)
    // canvas 坐标: x 右、y 下。dir x=sin(yaw), y=cos(yaw)（南=+y）
    const dirX = Math.sin(ang), dirY = Math.cos(ang)
    const tip = { x: cx + dirX * rr * 3, y: cy + dirY * rr * 3 }
    const perp = { x: -dirY, y: dirX }
    const wing = rr * 1.6
    for (let t = 0; t <= 1.0; t += 0.05) {
      const bx2 = cx + dirX * rr * 2.2 * t
      const by2 = cy + dirY * rr * 2.2 * t
      const w = wing * (1 - t) * 0.6
      setPx(Math.round(bx2 + perp.x * w), Math.round(by2 + perp.y * w), 255, 255, 255)
      setPx(Math.round(bx2 - perp.x * w), Math.round(by2 - perp.y * w), 255, 255, 255)
    }
    setPx(Math.round(tip.x), Math.round(tip.y), 255, 255, 255)
  }

  const buf = PNG.sync.write(png)
  // Node 22: fs.writeFileSync 更稳
  const fs = await import('node:fs')
  fs.writeFileSync(outPng, buf)
  const kb = (buf.length / 1024).toFixed(0)
  log(`saved ${outPng} (${imgW}x${imgH}, ${kb}KB, ${Date.now() - t0}ms)`)
  bot.end()
  process.exit(0)
}

main().catch((e) => {
  console.error(`[render-pure] FAIL: ${(e as Error).message}`)
  process.exit(1)
})
