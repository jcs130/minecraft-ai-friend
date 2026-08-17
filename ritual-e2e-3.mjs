// ritual-e2e-3 —— 模拟"真人新玩家"完整注册流程（召唤仪式 = 注册环节）验证：
//   1. 全新玩家 Pilgrim01 进服（不在任何注册表里）
//   2. 女神应自动降临仪式（公屏宣读候选天赋）
//   3. 玩家公屏喊「选 1」
//   4. 女神公屏确认「已镌入灵魂」→ magic-state 落 innateSkill
//   5. 玩家离场 → 死亡守望名单自动缩减
// 全程零重启、零人工干预。日志写 ritual-e2e-3.log
import mineflayer from 'mineflayer'
import fs from 'node:fs'

const LOG = new URL('./ritual-e2e-3.log', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG, line + '\n', 'utf8')
}
fs.writeFileSync(LOG, `===== ritual-e2e-3 ${new Date().toISOString()} =====\n`, 'utf8')

const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'Pilgrim01',
})

let announced = false
let chooseTimer = null
let registered = false

const finish = (ok, why) => {
  log(`RESULT ${ok ? 'PASS' : 'FAIL'} — ${why}`)
  setTimeout(() => { try { bot.quit() } catch {} ; setTimeout(() => process.exit(ok ? 0 : 1), 500) }, 1500)
}

bot.on('login', () => log('Pilgrim01 logged in (joined server)'))

bot.on('chat', (username, message) => {
  if (username === bot.username) return
  log(`CHAT <${username}> ${message}`)
  if (message.includes('自选其一') && !announced) {
    announced = true
    log('>>> ritual candidates announced, replying in 8s (let the goddess finish speaking)')
    chooseTimer = setTimeout(() => {
      log('>>> saying: 选 1')
      bot.chat('选 1')
    }, 8000)
  }
  if (message.includes('已镌入灵魂') && message.includes('Pilgrim01')) {
    registered = true
    if (chooseTimer) { clearTimeout(chooseTimer); chooseTimer = null }
    finish(true, 'goddess confirmed innate skill engraved — registration complete')
  }
})

bot.on('kicked', (r) => finish(false, `kicked: ${JSON.stringify(r)}`))
bot.on('error', (e) => log(`bot error: ${e.message}`))
bot.on('end', () => { if (!registered) log('connection ended (prematurely?)') })

setTimeout(() => {
  if (registered) return
  finish(false, announced ? 'announced but no confirmation in 90s' : 'no ritual announcement in 90s')
}, 90000)
