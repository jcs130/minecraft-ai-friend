/**
 * guard-render.mts —— 守卫的「眼」：在守卫位置渲染守卫所见/周围全景（2026-08-23/24）
 *
 * 背景：亲卫（qwen3.8-27b-uncensored）经实测支持视觉输入（能精确回答图像 RGB），
 * 守卫桥（guard_drive.py）把截图经 console/chat image block 喂给它。本脚本生成截图：
 * mineflayer 临时 bot（RenderBot，旁观者）连入 → RCON 切 spectator + tp 到守卫坐标 →
 * 自建 express+socket.io 推送世界数据 → playwright 无头 chromium 打开自定义渲染页
 * （sidecar/guard/viewer-dist/，fov/mode 由 URL 参数控制）→ 截图。
 *
 * 一次运行渲染两张图（同一 bot 连接）：
 *   1. 第一人称广角（fov=105，跟随守卫朝向）→ <out>.fp.png
 *   2. 正俯视全景（top，守卫上方 h=40 格）→ <out>.top.png
 *
 * 用法（由守卫桥低频调用）：
 *   RCON_PW=<密码> node tsx guard-render.mts <x> <y> <z> <out.png> [yaw_deg] [pitch_deg]
 * 依赖：B 仓 node_modules（mineflayer / prismarine-viewer / express / socket.io /
 *       playwright-core / esbuild 产物 viewer-dist）。RCON 25575 密码从 env 读，不落盘。
 */
import mineflayer from 'mineflayer'
import { chromium } from 'playwright-core'
import net from 'node:net'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const [, , xS, yS, zS, outPng, yawS, pitchS] = process.argv
const X = Number(xS), Y = Number(yS), Z = Number(zS)
const YAW = yawS !== undefined && yawS !== '' ? Number(yawS) : null
const PITCH = pitchS !== undefined && pitchS !== '' ? Number(pitchS) : null
const RCON_PW = process.env.RCON_PW ?? ''
const MC_PORT = Number(process.env.MC_PORT ?? 25565)
const RCON_PORT = Number(process.env.RCON_PORT ?? 25575)
const VIEWER_PORT = Number(process.env.GUARD_VIEWER_PORT ?? 3053)
const BOT_NAME = process.env.GUARD_RENDER_NAME ?? 'RenderBot'
const log = (m: string) => console.log(`[guard-render] ${m}`)

if (!Number.isFinite(X) || !Number.isFinite(Y) || !Number.isFinite(Z) || !outPng || !RCON_PW) {
  console.error('usage: RCON_PW=<pw> node tsx guard-render.mts <x> <y> <z> <out.png> [yaw_deg] [pitch_deg]')
  process.exit(2)
}

// ---- 极简 RCON 客户端（两阶段：认证 → 命令，移植自 guard_drive.py） ----
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
      sock.write(pkt(3, 1, Buffer.from(pw, 'utf8'))) // login
    })
    let stage = 0 // 0=认证 1=命令
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
        if (stage === 0) {
          stage = 1
          sendCmd()
        } else {
          clearTimeout(timer)
          sock.destroy()
          resolve(body.subarray(8).toString('utf8').replace(/\u0000+$/g, ''))
        }
      }
    })
    sock.on('error', (e) => { clearTimeout(timer); reject(e) })
  })
}

// ---- 自建 viewer 服务端（express 静态 + socket.io 推送，照抄 prismarine-viewer mineflayer.js） ----
function startViewerServer(bot: any, port: number): Promise<{ close: () => void }> {
  return new Promise((resolve, reject) => {
    try {
      const express = require('express')
      const { Server } = require('socket.io')
      const { WorldView } = require('prismarine-viewer/viewer')
      const app = express()
      const pvPublic = path.resolve(require.resolve('prismarine-viewer/package.json'), '../public')
      const myDist = path.join(__dirname, 'viewer-dist')
      app.use(express.static(myDist))
      app.use(express.static(pvPublic)) // textures/ blocksStates/ 资源
      const http = require('node:http').createServer(app)
      const io = new Server(http, { path: '/socket.io' })
      const sockets: any[] = []
      io.on('connection', (socket: any) => {
        socket.emit('version', bot.version)
        sockets.push(socket)
        const worldView = new WorldView(bot.world, 6, bot.entity.position, socket)
        worldView.init(bot.entity.position)
        for (const id in (bot as any).viewer?.primitives ?? {}) { /* primitives 可选 */ }
        const botPosition = () => {
          socket.emit('position', {
            pos: bot.entity.position, yaw: bot.entity.yaw, pitch: bot.entity.pitch, addMesh: true,
          })
          worldView.updatePosition(bot.entity.position)
        }
        botPosition() // 新连接立即推一次当前位置（mineflayer.js 只推 move，静止时页面收不到）
        bot.on('move', botPosition)
        worldView.listenToBot(bot)
        socket.on('disconnect', () => {
          bot.removeListener('move', botPosition)
          worldView.removeListenersFromBot(bot)
          sockets.splice(sockets.indexOf(socket), 1)
        })
      })
      http.listen(port, () => {
        log(`viewer server on *:${port}`)
        resolve({ close: () => { io.close(); http.close() } })
      })
    } catch (e) {
      reject(e)
    }
  })
}

async function screenshot(browser: any, port: number, qs: string, out: string, settleMs: number): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } })
  page.on('console', (msg: any) => { if (process.env.GUARD_DEBUG_POS) log(`page[${qs}] console: ${msg.text()}`) })
  page.on('pageerror', (e: any) => log(`page[${qs}] error: ${e.message}`))
  await page.goto(`http://127.0.0.1:${port}/?${qs}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('canvas', { timeout: 15_000 })
  await new Promise((r) => setTimeout(r, settleMs))
  if (process.env.GUARD_DEBUG_POS) {
    const cam = await page.evaluate(() => {
      const v = (window as any).viewer
      if (!v || !v.camera) return 'no viewer'
      const c = v.camera
      return `pos=(${c.position.x.toFixed(1)},${c.position.y.toFixed(1)},${c.position.z.toFixed(1)}) rot=(${c.rotation.x.toFixed(2)},${c.rotation.y.toFixed(2)},${c.rotation.z.toFixed(2)}) fov=${c.fov}`
    })
    log(`camera[${qs}]: ${cam}`)
  }
  await page.screenshot({ path: out })
  await page.close()
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
  if (YAW !== null) {
    bot.look((YAW * Math.PI) / 180, ((PITCH ?? 0) * Math.PI) / 180)
    await new Promise((r) => setTimeout(r, 500))
  }
  const server = await startViewerServer(bot, VIEWER_PORT)
  await new Promise((r) => setTimeout(r, 1000))
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' })
  try {
    const base = outPng.replace(/\.png$/i, '')
    // 2026-08-24 用户反馈：第一人称（fp）在高处全是天空看不懂；默认改为
    // top3 高空斜视全景（立体地形，守卫可见）+ top 正俯视（雷达图）。
    // fp 保留：GUARD_RENDER_FP=1 时额外出一张。
    await screenshot(browser, VIEWER_PORT, `mode=top3&h=30&d=35&fov=80`, `${base}.top3.png`, 6000)
    await screenshot(browser, VIEWER_PORT, `mode=top&h=40`, `${base}.top.png`, 5000)
    if (process.env.GUARD_RENDER_FP === '1') {
      await screenshot(browser, VIEWER_PORT, `fov=110&mode=fp`, `${base}.fp.png`, 5000)
    }
    log(`saved ${base}.top3.png + ${base}.top.png${process.env.GUARD_RENDER_FP === '1' ? ' + fp' : ''}`)
  } finally {
    await browser.close().catch(() => {})
    server.close()
  }
  bot.end()
  process.exit(0)
}

main().catch((e) => {
  console.error(`[guard-render] FAIL: ${(e as Error).message}`)
  process.exit(1)
})
