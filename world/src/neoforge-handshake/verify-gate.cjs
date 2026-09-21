// verify-gate.cjs — 门的常驻冒烟测试（改完翻译层/重启门后跑这个）
// 用法：node verify-gate.cjs [host=127.0.0.1] [port=25701]
// 覆盖：chunk 批量 / 单块实时 / fill 批量 / 物品号 —— 全部在 bot 脚边做，无距离变量
const mf = require('D:/copaw-workspaces/mc-god/scratch/mc-agent-neko/node_modules/mineflayer')
const V = require('D:/copaw-workspaces/mc-god/scratch/mc-agent-neko/node_modules/vec3')
const { spawnSync } = require('child_process')
const R = 'D:\\copaw-workspaces\\mc-god\\scratch'
const HOST = process.argv[2] || '127.0.0.1'
const PORT = Number(process.argv[3] || 25701)
const NAME = 'QDVerify' + Math.floor(Math.random() * 900 + 100)
const rcon = c => {
  const r = spawnSync('python', ['-c',
    'import sys;sys.path.insert(0,r"' + R + '");import god_rcon;print(god_rcon.rcon(sys.argv[1]))', c],
    { encoding: 'utf-8', timeout: 40000 })
  return ((r.stdout || '') + (r.stderr || '')).replace(/[\x00-\x09]/g, '').trim()
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const clean = []

async function readUntil (bot, pos, want, tries = 10) {
  // 注意：mineflayer 的 block.name **不带** minecraft: 前缀（实测 diamond_block ✓）
  const w = String(want).replace(/^minecraft:/, '')
  for (let i = 0; i < tries; i++) {
    const b = bot.blockAt(new V(pos.x, pos.y, pos.z))
    if (b && String(b.name).replace(/^minecraft:/, '') === w) return true
    await sleep(1000)
  }
  return false
}

;(async () => {
  const bot = mf.createBot({ host: HOST, port: PORT, username: NAME,
    version: '1.21.1', auth: 'offline', checkTimeoutInterval: 120000 })
  let pass = 0, fail = 0
  const t = (label, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`) }
  bot.once('spawn', async () => {
    await sleep(6000)
    const p = bot.entity.position
    const base = { x: Math.floor(p.x) + 2, y: Math.floor(p.y) + 1, z: Math.floor(p.z) }
    const at = k => ({ x: base.x, y: base.y, z: base.z + k })
    console.log(`门冒烟测试 ${NAME} @ ${HOST}:${PORT}（基准 ${base.x},${base.y},${base.z}）`)

    // 1) 单块实时变更
    rcon(`setblock ${base.x} ${base.y} ${base.z} minecraft:diamond_block replace`); clean.push(at(0))
    t('单块 block_change 已翻译并应用', await readUntil(bot, at(0), 'minecraft:diamond_block'))

    // 2) fill 批量变更（multi_block_change）
    rcon(`fill ${base.x} ${base.y} ${base.z + 1} ${base.x} ${base.y} ${base.z + 3} minecraft:gold_block replace`)
    clean.push(at(1), at(2), at(3))
    let all = true
    for (const k of [1, 2, 3]) if (!await readUntil(bot, at(k), 'minecraft:gold_block', 6)) all = false
    t('批量 multi_block_change 已翻译并应用', all)

    // 3) 历史上错位最狠的几个号（逐个单块）
    const cases = [['obsidian', 'minecraft:obsidian'], ['chiseled_bookshelf', 'minecraft:chiseled_bookshelf'],
      ['sticky_piston', 'minecraft:sticky_piston'], ['packed_ice', 'minecraft:packed_ice']]
    for (let i = 0; i < cases.length; i++) {
      const pos = at(10 + i)
      rcon(`setblock ${pos.x} ${pos.y} ${pos.z} minecraft:${cases[i][0]} replace`); clean.push(pos)
      t(`高位号 ${cases[i][0]}`, await readUntil(bot, pos, cases[i][1], 6))
    }

    // 4) 物品号
    rcon(`give ${NAME} minecraft:blaze_rod`)
    await sleep(2500)
    t('物品号翻译（give blaze_rod 背包可见）', bot.inventory.items().some(i => /blaze_rod/.test(i.name)))

    // 5) **方块状态**保真（只比名字测不出"状态被压平"，2026-09-21 note_block 塌平教训）
    //    注意：本文件用 t() 记测试结果，循环变量绝不能再叫 t（会遮蔽函数）
    const STATE_CASES = [
      ['oak_stairs[facing=north,half=top]', { facing: 'north', half: 'top' }],
      ['oak_slab[type=bottom]', { type: 'bottom' }],
      ['chest[facing=east]', { facing: 'east' }],
      ['furnace[facing=south,lit=true]', { facing: 'south', lit: 'true' }],
    ]
    for (let i = 0; i < STATE_CASES.length; i++) {
      const spec = STATE_CASES[i][0]
      const want = STATE_CASES[i][1]
      const baseName = spec.split('[')[0]
      const pos = at(20 + i)
      rcon(`setblock ${pos.x} ${pos.y} ${pos.z} minecraft:${spec} replace`)
      clean.push(pos)
      const agreed = /Test passed/i.test(rcon(`execute if block ${pos.x} ${pos.y} ${pos.z} minecraft:${spec}`))
      let b = null
      for (let round = 0; round < 6; round++) {
        b = bot.blockAt(new V(pos.x, pos.y, pos.z))
        if (b && b.name === baseName) break
        await sleep(1000)
      }
      // prismarine-block 把状态属性放在 getProperties()/_properties，没有 .properties 字段（实测）
      let props = {}
      try { props = (b && typeof b.getProperties === 'function') ? (b.getProperties() || {}) : ((b && b._properties) || {}) } catch (e) { props = {} }
      const missing = Object.keys(want).filter(k => String(props[k]) !== want[k])
      const got = JSON.stringify(Object.keys(want).reduce((o, k) => { o[k] = props[k]; return o }, {}))
      t('状态保真 ' + baseName + ' ' + JSON.stringify(want), agreed && missing.length === 0,
        (agreed ? '' : '服务端不认可该状态 ') + (missing.length ? '读到 ' + got : ''))
    }

    console.log('\n清理…')
    for (const c of clean) rcon(`setblock ${c.x} ${c.y} ${c.z} minecraft:air replace`)
    console.log(`\n结果 ${pass} 通过 / ${fail} 失败`)
    bot.quit(); await sleep(400); process.exit(fail ? 1 : 0)
  })
  bot.on('error', e => { console.log('ERR', e.message); process.exit(1) })
})()
