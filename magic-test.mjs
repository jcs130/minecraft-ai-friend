// 离线验证 mc-magic 核心纯函数（不依赖 cordis/MC）。node magic-test.mjs
const CN_DIGITS = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 }
function parseCnNumber(s) {
  let total = 0, acc = 0
  for (const ch of s) {
    if (ch === '十') { total += (acc || 1) * 10; acc = 0 }
    else if (ch === '百') { total += (acc || 1) * 100; acc = 0 }
    else if (CN_DIGITS[ch] !== undefined) { acc = CN_DIGITS[ch] }
  }
  return total + acc
}
function extractNumber(s) {
  const a = s.match(/(\d+)/)
  if (a) return parseInt(a[1], 10)
  const c = s.match(/[零一二两三四五六七八九十百]+/)
  if (c) return parseCnNumber(c[0])
  return null
}
const DIR = { '东': [1, 0], '南': [0, 1], '西': [-1, 0], '北': [0, -1] }
function extractDirection(s) { for (const d of Object.keys(DIR)) if (s.includes(d)) return d; return null }

const ATOMS = [
  { id: 'tp', words: ['传送', '瞬移', '闪现', '撕裂虚空', '空间跳跃', '跃迁'], cost: { mana: 20, food: 0, hp: 0 }, paramCosts: { distance: { mana: 5 } }, params: { distance: { type: 'number', default: 5, max: 30 }, direction: { type: 'direction', default: '东' } }, commands: ['tp {target} {tx} {ty} {tz}'] },
  { id: 'home', words: ['归乡', '回家', '回基地'], cost: { mana: 20, food: 0, hp: 0 }, commands: ['tp {target} {bx} {by} {bz}'] },
  { id: 'terraform', words: ['塑形', '裂地', '掘土', '挖地'], cost: { mana: 30, food: 6, hp: 0 }, commands: ['fill {px} {py-1} {pz} {px} {py-1} {pz} minecraft:air'] },
]

function match(chant) { for (const a of ATOMS) if (a.words.some(w => chant.includes(w))) return a; return null }
function params(atom, chant) {
  const p = {}
  for (const [k, spec] of Object.entries(atom.params || {})) {
    if (spec.type === 'number') { const n = extractNumber(chant); p[k] = n !== null ? Math.min(spec.max ?? n, n) : spec.default }
    else if (spec.type === 'direction') p[k] = extractDirection(chant) ?? spec.default
  }
  return p
}
function cost(atom, p) {
  const c = { ...atom.cost }
  for (const [k, pc] of Object.entries(atom.paramCosts || {})) { const v = typeof p[k] === 'number' ? p[k] : 0; if (pc.mana) c.mana += pc.mana * v }
  return c
}
function render(cmd, vars) {
  return cmd.replace(/\{([a-z]+)([+-]\d+)?\}/g, (_m, key, off) => {
    const b = vars[key]; if (typeof b === 'number') return String(Math.round(b + (off ? parseInt(off, 10) : 0))); return String(b ?? '')
  })
}

let fails = 0
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) { fails++; console.log(`✗ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`) }
  else console.log(`✓ ${name}: ${JSON.stringify(got)}`)
}

// 中文数字
eq('parseCn 十', parseCnNumber('十'), 10)
eq('parseCn 二十五', parseCnNumber('二十五'), 25)
eq('parseCn 一百', parseCnNumber('一百'), 100)
eq('parseCn 三', parseCnNumber('三'), 3)
// 数字提取
eq('extractNum 传送十格', extractNumber('传送十格'), 10)
eq('extractNum 传送10格', extractNumber('传送10格'), 10)
eq('extractNum 传送25格', extractNumber('传送二十五格'), 25)
eq('extractNum 无数字', extractNumber('撕裂虚空'), null)
// 匹配
eq('match tp', match('撕裂虚空，传送十格东')?.id, 'tp')
eq('match home', match('我要回基地')?.id, 'home')
eq('match terraform', match('裂地！')?.id, 'terraform')
eq('match none', match('今天天气不错')?.id, undefined)
// 参数 + 消耗
const tpAtom = ATOMS[0]
eq('tp params distance', params(tpAtom, '传送十格东').distance, 10)
eq('tp params direction', params(tpAtom, '传送十格东').direction, '东')
eq('tp params default', params(tpAtom, '传送'), { distance: 5, direction: '东' })
eq('tp cost 10格', cost(tpAtom, { distance: 10 }), { mana: 70, food: 0, hp: 0 })
eq('tp cost 30格(封顶)', cost(tpAtom, { distance: 30 }), { mana: 170, food: 0, hp: 0 })
// 命令渲染
const vars = { target: 'HarnessBot', bx: 1, by: 2, bz: 3, px: 100, py: 64, pz: -50, tx: 110, ty: 64, tz: -50 }
eq('render tp', render('tp {target} {tx} {ty} {tz}', vars), 'tp HarnessBot 110 64 -50')
eq('render fill py-1', render('fill {px} {py-1} {pz} {px} {py-1} {pz} minecraft:air', vars), 'fill 100 63 -50 100 63 -50 minecraft:air')
eq('render home', render('tp {target} {bx} {by} {bz}', vars), 'tp HarnessBot 1 2 3')
// 视觉渲染（particle 模板 / 大字标题占位符）
eq('vfx particle tp', render('minecraft:end_rod {tx} {ty+1} {tz} 0.4 0.4 0.4 0.05 60', vars), 'minecraft:end_rod 110 65 -50 0.4 0.4 0.4 0.05 60')
eq('vfx particle home', render('minecraft:portal {bx} {by+1} {bz} 0.5 0.5 0.5 0.3 80', vars), 'minecraft:portal 1 3 3 0.5 0.5 0.5 0.3 80')
eq('vfx title tp', render('向{direction}跃迁 {distance} 格', { direction: '东', distance: 10 }), '向东跃迁 10 格')

console.log(fails === 0 ? '\n全部通过 ✅' : `\n${fails} 项失败 ❌`)
process.exit(fails === 0 ? 0 : 1)
