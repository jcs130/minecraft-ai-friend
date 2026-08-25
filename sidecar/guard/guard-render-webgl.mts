/**
 * guard-render-webgl.mts —— 守卫之眼·MindCraft 式 headless 渲染（node-canvas-webgl + prismarine-viewer）
 * 2026-08-24：用户确认 MindCraft 在 Windows 可跑（其 package.json "overrides": {canvas^3, gl^8}
 * 让 canvas@3/gl@8 走 prebuilt 秒装，无需 cairo 编译）。据此搭建真实 3D 第一人称渲染，
 * 带透视深度（比纯 JS 俯视色块更精确）。与 guard-render-pure.mts（俯视雷达）互为补充。
 *
 * 用法：RCON_PW=<pw> node tsx guard-render-webgl.mts <x> <y> <z> <out.jpg> [yaw_deg] [pitch_deg] [view_dist]
 * 视角：第一人称（真实视野，带深度）。top 俯视请用 guard-render-pure.mts。
 */
import mineflayer from 'mineflayer'
import { Vec3 } from 'vec3'
import { Viewer } from 'prismarine-viewer/viewer/lib/viewer.js'
import { WorldView } from 'prismarine-viewer/viewer/lib/worldView.js'
import { getBufferFromStream } from 'prismarine-viewer/viewer/lib/simpleUtils.js'
import THREE from 'three'
import { createCanvas } from 'node-canvas-webgl/lib/index.js'
import worker_threads from 'worker_threads'
import fs from 'node:fs'
import net from 'node:net'

// prismarine-viewer 的 entity/Entity.js 引用**全局** THREE（new THREE.Object3D()），node ESM 需注入全局
;(globalThis as any).THREE = THREE
global.Worker = worker_threads.Worker

const [, , xS, yS, zS, outPng, yawS, pitchS, vdS] = process.argv
const X = Number(xS), Y = Number(yS), Z = Number(zS)
const YAW = yawS !== undefined && yawS !== '' ? Number(yawS) : 0
const PITCH = pitchS !== undefined && pitchS !== '' ? Number(pitchS) : 0
const VIEW_DIST = vdS !== undefined && vdS !== '' ? Number(vdS) : 12
// MC 实体 Rotation 是【度】（yaw 0=南），three camera.rotation 用【弧度】——换算
const YAW_RAD = YAW * Math.PI / 180
const PITCH_RAD = PITCH * Math.PI / 180
const RCON_PW = process.env.RCON_PW ?? ''
const MC_PORT = Number(process.env.MC_PORT ?? 25599)
const RCON_PORT = Number(process.env.RCON_PORT ?? 25575)
const BOT_NAME = process.env.GUARD_RENDER_NAME ?? 'RenderBot'
const W = 800, H = 512
const log = (m: string) => console.log(`[render-webgl] ${m}`)

if (!Number.isFinite(X) || !Number.isFinite(Y) || !Number.isFinite(Z) || !outPng || !RCON_PW) {
  console.error('usage: RCON_PW=<pw> node tsx guard-render-webgl.mts <x> <y> <z> <out.jpg> [yaw] [pitch] [vd]')
  process.exit(2)
}

// ---- 极简 RCON ----
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
    const sock = net.createConnection({ host: '127.0.0.1', port }, () => sock.write(pkt(3, 1, Buffer.from(pw, 'utf8'))))
    let stage = 0, acc = Buffer.alloc(0)
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('rcon timeout')) }, 6000)
    const sendCmd = () => sock.write(pkt(2, 2, Buffer.from(cmd, 'utf8')))
    sock.on('data', (chunk) => {
      acc = Buffer.concat([acc, chunk])
      while (acc.length >= 4) {
        const len = acc.readInt32LE(0)
        if (len < 10 || acc.length < 4 + len) return
        const body = acc.subarray(4, 4 + len)
        acc = acc.subarray(4 + len)
        if (stage === 0) { stage = 1; sendCmd() } else {
          clearTimeout(timer); sock.destroy()
          resolve(body.subarray(8).toString('utf8').replace(/\u0000+$/g, ''))
        }
      }
    })
    sock.on('error', (e) => { clearTimeout(timer); reject(e) })
  })
}

async function main(): Promise<void> {
  const bot = mineflayer.createBot({ host: 'localhost', port: MC_PORT, username: BOT_NAME, version: '1.21.1' })
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
  } catch (e) { log(`rcon warn: ${(e as Error).message}`) }
  await new Promise((r) => setTimeout(r, 4000)) // 等区块

  // 轮询等待 center 附近 chunk 数据（bot.world 收到块才算数）
  const near = await (async () => {
    for (let i = 0; i < 40; i++) {
      const b = bot.world.getBlock(new Vec3(Math.floor(X), Math.floor(Y), Math.floor(Z)))
      if (b && b.name !== 'air') return b.name
      await new Promise((r) => setTimeout(r, 500))
    }
    return null
  })()
  log(`near block=${near}  (null/air=区块未加载，需排查 chunk 源)`)
  const t0 = Date.now()
  try {
    const canvas = createCanvas(W, H) as any
    const renderer = new THREE.WebGLRenderer({ canvas })
    const viewer = new Viewer(renderer) as any
    viewer.setVersion(bot.version)
    const center = new Vec3(X, Y + 0.5, Z)
    const worldView = new WorldView(bot.world, VIEW_DIST, center) as any
    viewer.listen(worldView)
    worldView.listenToBot(bot)
    await worldView.init(center)
    // camera.js 关键一步：updatePosition 触发 WorldView 重读 center 范围块进 scene
    await worldView.updatePosition(center)
    // 第一人称（带透视深度）：一次性渲染不等 TWEEN(50ms 未完成)——直接设 camera 位置+姿态
    const cam = viewer.camera as any
    cam.position.set(bot.entity.position.x, bot.entity.position.y + 1.6, bot.entity.position.z)
    cam.rotation.set(PITCH_RAD, YAW_RAD, 0, 'ZYX')
    viewer.update()
    // 关键：worker 生成几何是异步 setInterval(50ms)，一次性渲染必须等高几何生成完再 render
    await Promise.race([
      (viewer as any).waitForChunksToRender(),
      new Promise((r) => setTimeout(r, 20000))
    ])
    renderer.render(viewer.scene, viewer.camera)
    const stream = canvas.createJPEGStream({ bufsize: 4096, quality: 100, progressive: false }) as any
    const buf = await getBufferFromStream(stream)
    fs.writeFileSync(outPng, buf)
    log(`saved ${outPng} (${(buf.length / 1024).toFixed(0)}KB, ${Date.now() - t0}ms) fps=${YAW} pitch=${PITCH}`)
  } catch (e) {
    const anyE = e as any
    // 防御未知实体（MindCraft patch：Entity getMesh 未知实体 return 不抛）
    if (String(anyE?.message).includes('Unknown entity')) {
      console.error('[render-webgl] 未知实体（mod 实体）需按 MindCraft patch 防御：' + anyE.message)
    }
    throw e
  }
  bot.end()
  process.exit(0)
}

main().catch((e) => { console.error(`[render-webgl] FAIL: ${(e as Error).message}`); process.exit(1) })
