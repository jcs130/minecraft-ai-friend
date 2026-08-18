/**
 * mc-camera — 方案 C：进程内无头第一人称相机（node-canvas-webgl + three）。
 * 移植自 Mindcraft camera.js，适配本插件：
 *   - 懒初始化：首次截图时才建相机；bot 重连（实例更换/掉线）自动重建
 *   - capture() 返回 JPEG Buffer，同时落盘 data/screenshots/<username>/
 *   - 仅供 mc_see / mc-loop 使用；渲染按需触发，不常驻渲染循环
 */
import { mkdir, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { Vec3 } from 'vec3'
import type { Bot } from 'mineflayer'

// ⚠️ 3D 渲染栈（three / node-canvas-webgl / prismarine-viewer viewer）必须懒加载：
// node-canvas-webgl 与 canvas 全家桶不在 package.json（Windows 裸机是从 Mindcraft
// node_modules robocopy 来的预编译），无头容器（docker --omit=optional）里根本不存在。
// 顶层静态 import 会在模块加载期直接崩掉整个 bot 进程——改成首次截图时动态加载，
// 加载失败置 visionError，相机功能优雅降级（mc_see 回落 playwright 或报「不可用」）。
type Vision = {
  THREE: any
  createCanvas: any
  Viewer: any
  WorldView: any
}
let vision: Vision | null = null
let visionTried = false
let visionError = ''
async function loadVision(): Promise<Vision | null> {
  if (visionTried) return vision
  visionTried = true
  try {
    const [threeMod, canvasMod, viewerMod, worldViewMod] = await Promise.all([
      import('three'),
      import('node-canvas-webgl/lib/index.js'),
      import('prismarine-viewer/viewer/lib/viewer.js'),
      import('prismarine-viewer/viewer/lib/worldView.js'),
    ])
    const THREE = (threeMod as any).default
    // prismarine-viewer 的 WorldView 依赖浏览器 Worker API，node 下用 worker_threads 顶替
    // 其 viewer/lib 内部还有裸用全局 THREE / window 的浏览器假设，一并补上
    // @ts-expect-error -- global polyfill
    global.Worker = Worker
    ;(global as any).THREE = THREE
    vision = {
      THREE,
      createCanvas: (canvasMod as any).createCanvas,
      Viewer: (viewerMod as any).Viewer,
      WorldView: (worldViewMod as any).WorldView,
    }
    console.log('[mc-camera] vision stack loaded (three + node-canvas-webgl + prismarine-viewer)')
  } catch (err) {
    visionError = err instanceof Error ? err.message : String(err)
    console.warn(`[mc-camera] vision stack unavailable (headless deployment?) — mc_see degraded: ${visionError}`)
  }
  return vision
}

const WIDTH = 800
const HEIGHT = 512
// 竖直 FOV（three.js 语义）。800x512 (aspect 1.5625) 下水平视野 = 2*atan(tan(FOV/2)*1.5625)：
//   75 -> ~100°（原默认）；90 -> ~114°（宽视野）；再大会边缘畸变、远处物体过小，不利 VLM 识别
const FOV = Number(process.env.MC_EYES_FOV || 90)
// 视距（chunk）。无头渲染没有客户端开销，加大只影响首轮网格化时长与内存
const VIEW_DISTANCE = Number(process.env.MC_EYES_VIEW || 10)
const KEEP_SHOTS = 40

export interface Shot {
  buffer: Buffer
  file: string | null // 相对 shots 根的路径（成功落盘时），供面板引用
}

interface CameraState {
  bot: Bot
  renderer: any
  canvas: any
  viewer: any
  worldView: any
  ready: Promise<void>
}

let current: CameraState | null = null
let building: Promise<CameraState> | null = null

function isAlive(c: CameraState | null): c is CameraState {
  return !!c && c.bot.entity != null && c.bot.world != null
}

/** 3D 渲染栈是否可用（无头部署返回 false；不触发加载）。 */
export function visionAvailable(): boolean {
  return vision !== null
}

async function build(bot: Bot): Promise<CameraState> {
  const v = await loadVision()
  if (!v) throw new Error(`camera unavailable (vision stack not loadable: ${visionError})`)
  const canvas = v.createCanvas(WIDTH, HEIGHT)
  const renderer = new v.THREE.WebGLRenderer({ canvas })
  const viewer = new v.Viewer(renderer)
  // 宽视野：Viewer 默认 75，这里按环境变量覆盖（懒初始化后首次截图生效）
  viewer.camera.fov = FOV
  viewer.camera.updateProjectionMatrix()
  console.log(`[mc-camera] camera built: fov=${FOV} (v), view=${VIEW_DISTANCE} chunks, ${WIDTH}x${HEIGHT}`)
  const botPos = bot.entity!.position
  const center = new Vec3(botPos.x, botPos.y + bot.entity!.height, botPos.z)
  viewer.setVersion(bot.version)
  const worldView = new v.WorldView(bot.world as never, VIEW_DISTANCE, center)
  viewer.listen(worldView)
  worldView.listenToBot(bot)
  const state: CameraState = { bot, renderer, canvas, viewer, worldView, ready: Promise.resolve() }
  await worldView.init(center)
  return state
}

function getCamera(bot: Bot): Promise<CameraState> {
  if (isAlive(current) && current!.bot === bot) return Promise.resolve(current!)
  if (isAlive(current) && current!.bot !== bot) {
    // bot 实例换了（重连）：旧 worldView 已随旧 bot 失效，直接弃用
    current = null
  }
  if (!building) {
    if (!bot.entity || !bot.world) throw new Error('camera: bot not spawned yet')
    building = build(bot)
      .then((c) => {
        current = c
        return c
      })
      .finally(() => {
        building = null
      })
  }
  return building
}

async function pruneOld(dir: string): Promise<void> {
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.jpg'))
    if (files.length <= KEEP_SHOTS) return
    // 文件名带时间戳，字典序即时间序
    const sorted = files.sort()
    for (const f of sorted.slice(0, sorted.length - KEEP_SHOTS)) {
      await unlink(join(dir, f)).catch(() => { /* already gone */ })
    }
  } catch { /* best effort */ }
}

/** 等 mesher 追平（懒初始化后的首轮网格化需要几秒；之后 outstanding 常态为 0）。 */
async function waitForMesher(cam: CameraState): Promise<void> {
  const wr = (cam.viewer as unknown as { world?: { sectionsOutstanding: Set<string>; renderUpdateEmitter: { on(e: string, cb: () => void): void; off(e: string, cb: () => void): void } } }).world
  if (!wr || wr.sectionsOutstanding.size === 0) return
  const world = wr
  const emitter = wr.renderUpdateEmitter
  await new Promise<void>((resolve) => {
    const t = setTimeout(done, 15_000) // 上限 15s，超时也硬拍
    function done() {
      clearTimeout(t)
      emitter.off('update', onDone)
      resolve()
    }
    function onDone() {
      if (world.sectionsOutstanding.size === 0) done()
    }
    emitter.on('update', onDone)
  })
}

/**
 * 以指定 yaw/pitch 渲染一帧并出 JPEG。
 * suffix 仅用于落盘文件名区分（如 "-right"），单张传 ''。
 */
async function renderOne(cam: CameraState, bot: Bot, yaw: number, pitch: number, shotsRoot: string | null, suffix: string): Promise<Shot> {
  const e = bot.entity!
  // 保险：若 fov 被外部路径重置，按 FOV 常量纠正
  if (cam.viewer.camera.fov !== FOV) {
    cam.viewer.camera.fov = FOV
    cam.viewer.camera.updateProjectionMatrix()
  }
  const center = new Vec3(e.position.x, e.position.y + e.height, e.position.z)
  cam.viewer.camera.position.set(center.x, center.y, center.z)
  await cam.worldView.updatePosition(center)
  cam.viewer.setFirstPersonCamera(e.position, yaw, pitch)
  cam.viewer.update()
  cam.renderer.render(cam.viewer.scene, cam.viewer.camera)

  // 走 node-canvas-webgl 的 JPEG 流（Mindcraft camera.js 同款路径，toBuffer 在该库上不可靠）
  const { getBufferFromStream } = await import('prismarine-viewer/viewer/lib/simpleUtils.js')
  const imageStream = cam.canvas.createJPEGStream({ bufsize: 4096, quality: 88, progressive: false })
  const buffer = (await getBufferFromStream(imageStream)) as unknown as Buffer

  let file: string | null = null
  if (shotsRoot) {
    const dir = join(shotsRoot, bot.username || 'unknown')
    await mkdir(dir, { recursive: true })
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}${suffix}.jpg`
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, name), buffer)
    file = `${bot.username || 'unknown'}/${name}`
    void pruneOld(dir)
  }
  return { buffer, file }
}

/**
 * 截取 bot 当前第一人称画面。
 * @param shotsRoot 截图根目录（如 ./data/screenshots）；传 null 则不落盘
 */
export async function captureFirstPerson(bot: Bot, shotsRoot: string | null): Promise<Shot> {
  const cam = await getCamera(bot)
  await waitForMesher(cam)
  const e = bot.entity!
  return await renderOne(cam, bot, e.yaw, e.pitch, shotsRoot, '')
}

export interface LookaroundShot extends Shot {
  label: string // 中文方向标签（前方/右方/后方/左方），随图喂给 VLM
  key: string // ASCII 后缀（front/right/back/left），用于文件名
}

/**
 * 环顾四周：原地不动，按 前→右→后→左 拍四张（yaw 每次顺时针 +90°）。
 * 俯仰收平到 ±0.3 rad，避免原视角在盯着天/地时四张全是天空或脚底。
 */
export async function captureLookaround(bot: Bot, shotsRoot: string | null): Promise<LookaroundShot[]> {
  const cam = await getCamera(bot)
  await waitForMesher(cam)
  const e = bot.entity!
  const baseYaw = e.yaw
  const pitch = Math.max(-0.3, Math.min(0.3, e.pitch))
  // mineflayer yaw：0=南(+Z)，+π/2=西；yaw 增大 = 游戏内向右转
  const dirs: Array<{ label: string; key: string; dy: number }> = [
    { label: '前方', key: 'front', dy: 0 },
    { label: '右方', key: 'right', dy: Math.PI / 2 },
    { label: '后方', key: 'back', dy: Math.PI },
    { label: '左方', key: 'left', dy: -Math.PI / 2 },
  ]
  const shots: LookaroundShot[] = []
  for (const d of dirs) {
    const shot = await renderOne(cam, bot, baseYaw + d.dy, pitch, shotsRoot, `-${d.key}`)
    shots.push({ ...shot, label: d.label, key: d.key })
  }
  return shots
}

/** 相机是否已就绪（不触发初始化）。 */
export function cameraReady(): boolean {
  return isAlive(current)
}

/** 仪表信息（测试/诊断用）：viewer 已加载 chunk 数、已建网格数、待处理 section 数。 */
export function __debugState(_bot: Bot): { viewerChunks: number; meshes: number; outstanding: number } | null {
  if (!current) return null
  const w = (current.viewer as unknown as { world?: { loadedChunks: Record<string, unknown>; sectionMeshs: Record<string, unknown>; sectionsOutstanding: Set<unknown> } }).world
  if (!w) return null
  return {
    viewerChunks: Object.keys(w.loadedChunks ?? {}).length,
    meshes: Object.keys(w.sectionMeshs ?? {}).length,
    outstanding: (w.sectionsOutstanding ?? new Set()).size,
  }
}
