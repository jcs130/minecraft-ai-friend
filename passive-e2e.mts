// Passive E2E test: pin Kirito HP in [4,8] (≈35%±) for 160s via hunger drain + damage/heal pinning,
// then report. Bloodrage: hpRatio<=0.4 accumulate 120s -> unlock -> strength effect while <0.4.
import { readFileSync } from 'node:fs'
import { exit } from 'node:process'
import { Rcon } from './src/rcon.ts'

const rcon = new Rcon('127.0.0.1', 25575, readFileSync('./data/rcon-secret.txt', 'utf-8').trim())
await rcon.connect()

// 1) hunger amp 39 = ~1 food/s: 先耗饱和度再掉饱食，food<18 后自然回血彻底停止
console.log(await rcon.send('effect give Kirito minecraft:hunger 220 39 true'))

const t0 = Date.now()
let dmg = 0, heal = 0
while (Date.now() - t0 < 160_000) {
  const out = await rcon.send('data get entity Kirito Health')
  const m = out.match(/([\d.]+)f/)
  const hp = m ? parseFloat(m[1]) : 20
  if (hp > 8) {
    await rcon.send(`damage Kirito ${Math.ceil(hp - 7)} minecraft:magic`); dmg++
  } else if (hp < 4) {
    await rcon.send('effect give Kirito minecraft:instant_health 1 1 true'); heal++
  }
  await new Promise((r) => setTimeout(r, 2000))
}
const food = await rcon.send('data get entity Kirito foodLevel')
console.log(`pin done: dmg-cycles=${dmg} heal-cycles=${heal}`)
console.log(food)
rcon.close()
exit(0)
