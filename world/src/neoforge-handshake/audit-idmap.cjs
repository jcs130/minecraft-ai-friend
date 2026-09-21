// 翻译层体检：① 覆盖率对账 ② 双向往返无损性 ③ chunk 段模式分布（direct 段是否漏翻）
const fs = require('fs')
const path = require('path')
const B = __dirname
const d = JSON.parse(fs.readFileSync(path.join(B, 'idmap.json'), 'utf8'))
const R = 'D:\\copaw-workspaces\\mc-god\\scratch'
const { spawnSync } = require('child_process')
const rcon = c => {
  const r = spawnSync('python', ['-c',
    'import sys;sys.path.insert(0,r"' + R + '");import god_rcon;print(god_rcon.rcon(sys.argv[1]))', c],
    { encoding: 'utf-8', timeout: 40000 })
  return ((r.stdout || '') + (r.stderr || '')).replace(/[\x00-\x09]/g, '').trim()
}

console.log('===== ① 覆盖率对账（号表 vs 服务端注册表全量）=====')
const blocksTsv = fs.readFileSync(path.join(B, 'idmap-dump', 'blocks.tsv'), 'utf8').split('\n').filter(Boolean)
const itemsTsv = fs.readFileSync(path.join(B, 'idmap-dump', 'items.tsv'), 'utf8').split('\n').filter(Boolean)
let stateTotal = 0
for (const l of blocksTsv) { const p = l.split('\t'); stateTotal += Number(p[3]) }
console.log('  blocks.tsv 声明 state 总数 =', stateTotal, ' idmap.states =', Object.keys(d.states).length,
  stateTotal === Object.keys(d.states).length ? '✓ 一致' : '✗ 不一致')
console.log('  items.tsv 行数 =', itemsTsv.length, ' idmap.items =', Object.keys(d.items).length,
  itemsTsv.length === Object.keys(d.items).length ? '✓ 一致' : '✗ 不一致')
// 服务端在线核对：注册表大小（用 /botgate dumpids 的计数回执不便取，退而用 data get 探一个高位号）
console.log('  探最高段号是否存在:', rcon('data get block -541 67 856').slice(0, 40) || '（无回执）')

console.log('\n===== ② 双向往返无损性（原版号必须原样回来）=====')
const R2 = require('./idmap-remap.cjs')
process.env.GATE_REMAP !== '0' && R2.load()
const mf = require('D:/copaw-workspaces/mc-god/scratch/mc-agent-neko/node_modules/mineflayer')
let okI = 0, badI = [], okS = 0, badS = []
const probe = mf
;(async () => {
  // 取若干"确认存在"的原版物品 id，验证 vanilla→neo→vanilla 恒等
  const checks = ['diamond_sword', 'stone', 'bread', 'obsidian', 'bookshelf', 'red_bed', 'blaze_rod', 'glowstone']
  const itemsTsvMap = {}
  for (const l of itemsTsv) { const [n, id] = l.split('\t'); itemsTsvMap[n] = Number(id) }
  for (const c of checks) {
    const neo = itemsTsvMap['minecraft:' + c]
    if (neo == null) { console.log('   ?', c, '不在 dump 里'); continue }
    const v = R2.remapOut('noop', { itemId: neo }).itemId      // 出站：neo→vanilla
    const back = R2.remapIn('noop', { itemId: v }).itemId      // 入站：vanilla→neo
    if (back === neo) okI++; else { badI.push(`${c}: ${neo}→${v}→${back}`) }
  }
  console.log(`  物品往返 ${okI}/${checks.length} 恒等复原`, badI.length ? ('✗ 失配: ' + badI.join(' | ')) : '✓ 全对')
  const schecks = ['obsidian', 'diamond_block', 'packed_ice', 'glowstone', 'bookshelf', 'sticky_piston']
  let n2 = 0
  for (const c of schecks) {
    // 用 blocks.tsv 的 base 号（线上号）
    const row = blocksTsv.find(l => l.split('\t')[0] === 'minecraft:' + c)
    if (!row) continue
    const neo = Number(row.split('\t')[2])
    const v = Number(d.states[String(neo)] ?? neo)
    const back = Number(d.states[String(neo)] ?? neo)
    if (v === back && d.states[String(neo)] != null) n2++
    else badS.push(c)
  }
  console.log('  方块号出站命中（有映射可回）:', n2 + '/' + schecks.length, badS.length ? '✗ ' + badS.join(',') : '✓')

  console.log('\n===== ③ chunk 段模式分布（direct/无调色板段是否会漏翻）=====')
  const PC = require('D:/copaw-workspaces/mc-god/scratch/mc-agent-neko/node_modules/prismarine-chunk')('1.21.1')
  const bot = mf.createBot({ host: '127.0.0.1', port: 25701, username: 'QDAudit', version: '1.21.1',
    auth: 'offline', checkTimeoutInterval: 120000 })
  const kinds = { palette: 0, singleValue: 0, direct: 0, other: 0, empty: 0 }
  const shapes = new Set()
  let chunks = 0
  bot._client.on('packet', (p, meta) => {
    if (!meta || meta.name !== 'map_chunk' || !Buffer.isBuffer(p.chunkData)) return
    chunks++
    if (chunks > 60) return
    try {
      const c = new PC(); c.load(p.chunkData)
      for (const s of c.sections) {
        if (!s || !s.data) { kinds.empty++; continue }
        const dsc = s.data
        shapes.add(Object.keys(dsc).sort().join(','))
        if (Array.isArray(dsc.palette)) kinds.palette++
        else if (typeof dsc.value === 'number') kinds.singleValue++
        else if (dsc.blockLayer || dsc.bitsPerBlock) kinds.direct++
        else kinds.other++
      }
    } catch (e) { kinds.other++ }
  })
  bot.once('spawn', async () => {
    await new Promise(r => setTimeout(r, 16000))
    console.log('  采样 chunk 数 =', chunks, ' 段模式分布 =', JSON.stringify(kinds))
    console.log('  见过的 data 字段形状:', [...shapes].slice(0, 6).map(s => '{' + s + '}').join(' '))
    const total = kinds.palette + kinds.singleValue + kinds.direct + kinds.other + kinds.empty
    const risk = kinds.direct + kinds.other
    console.log('  >>> 会被我代码"暂不碰"分支漏掉的段占比 =', total ? (100 * risk / total).toFixed(2) : '?', '%',
      risk === 0 ? '✓ 无漏翻风险' : '⚠ 有漏翻风险，需补 direct 段翻译')
    rcon('tp QDAudit 0 200 0')
    bot.quit(); setTimeout(() => process.exit(0), 300)
  })
  bot.on('error', e => { console.log('ERR', e.message); process.exit(1) })
})()
