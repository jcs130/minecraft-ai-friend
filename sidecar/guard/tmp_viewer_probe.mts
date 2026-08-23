// 探测 prismarine-viewer 页面是否暴露 window.viewer（决定能否在浏览器端改 fov/俯视）
import mineflayer from 'mineflayer'
import { chromium } from 'playwright-core'
import net from 'node:net'

const RCON_PW = process.env.RCON_PW ?? ''
const log = (m) => console.log(`[probe] ${m}`)

const bot = mineflayer.createBot({ host: 'localhost', port: 25599, username: 'ProbeBot', version: '1.21.1' })
await new Promise((res, rej) => { bot.once('spawn', res); bot.once('error', rej); bot.once('end', rej) })
log('spawned')
// spectator
const pkt = (type, id, body) => { const len = 4 + 4 + body.length + 2; const b = Buffer.alloc(4 + len); b.writeInt32LE(len, 0); b.writeInt32LE(id, 4); b.writeInt32LE(type, 8); body.copy(b, 12); b.writeInt16LE(0, 12 + body.length); return b }
await new Promise((resolve, reject) => {
  const s = net.createConnection({ host: '127.0.0.1', port: 25575 }, () => s.write(pkt(3, 1, Buffer.from(RCON_PW))))
  let acc = Buffer.alloc(0), stage = 0
  const to = setTimeout(() => { s.destroy(); reject(new Error('timeout')) }, 6000)
  s.on('data', (c) => {
    acc = Buffer.concat([acc, c])
    while (acc.length >= 4) {
      const len = acc.readInt32LE(0)
      if (len < 10 || acc.length < 4 + len) return
      acc = acc.subarray(4 + len)
      if (stage === 0) { stage = 1; s.write(pkt(2, 2, Buffer.from('gamemode spectator ProbeBot'))) }
      else { clearTimeout(to); s.destroy(); resolve() }
    }
  })
  s.on('error', reject)
})
log('spectator ok')
const pv = await import('prismarine-viewer')
pv.default.mineflayer(bot, { port: 3054, firstPerson: true })
await new Promise(r => setTimeout(r, 1500))
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' })
const page = await browser.newPage({ viewport: { width: 640, height: 480 } })
await page.goto('http://127.0.0.1:3054', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas', { timeout: 15000 })
await new Promise(r => setTimeout(r, 3000))
const keys = await page.evaluate(() => Object.keys(window).filter(k => /viewer|mineflayer|bot/i.test(k)))
log('window keys:', JSON.stringify(keys))
// 尝试探测 canvas 相关对象
const canvasInfo = await page.evaluate(() => {
  const cv = document.querySelector('canvas')
  return cv ? { w: cv.width, h: cv.height, id: cv.id, cls: cv.className } : null
})
log('canvas:', JSON.stringify(canvasInfo))
const viewerGlobal = await page.evaluate(() => {
  const v = window.viewer
  return v ? { hasCamera: !!v.camera, hasSetFirstPerson: typeof v.setFirstPersonCamera, fov: v.camera?.fov } : null
})
log('window.viewer:', JSON.stringify(viewerGlobal))
await browser.close()
bot.end()
process.exit(0)
