// 降临仪式离线单测：候选排序 + 选择解析 + 状态库落库（不依赖 MC server）。
import { rankCandidates, resolveChoice } from './src/mc-ritual.ts'
import { MagicStateStore } from './src/mc-magic.ts'
import { existsSync, rmSync } from 'node:fs'

// 与 data/magic-atoms.json 一致的法术摘要
const atoms = [
  { id: 'home', name: '归乡', words: ['归乡', '回家', '回基地', '归途', '回巢'], cost: { mana: 20, food: 0, hp: 0 }, requiredLevel: 1 },
  { id: 'tp', name: '空间传送', words: ['传送', '瞬移', '闪现', '撕裂虚空', '空间跳跃', '跃迁'], cost: { mana: 20, food: 0, hp: 0 }, requiredLevel: 1 },
  { id: 'heal', name: '圣愈术', words: ['圣愈', '治愈', '治疗', '疗伤', '回血', '痊愈'], cost: { mana: 30, food: 0, hp: 0 }, requiredLevel: 1 },
  { id: 'feed', name: '饱食赐福', words: ['饱食', '充饥', '饱腹', '不饿', '充能'], cost: { mana: 20, food: 0, hp: 0 }, requiredLevel: 1 },
  { id: 'give', name: '造物术', words: ['造物', '赐予', '给予', '赐下', '给我', '变出'], cost: { mana: 20, food: 0, hp: 0 }, requiredLevel: 1 },
  { id: 'light', name: '照明术', words: ['照明', '点火', '火把', '光亮', '照亮', '驱暗'], cost: { mana: 5, food: 0, hp: 0 }, requiredLevel: 1 },
  { id: 'time_day', name: '破晓术', words: ['破晓', '天明', '白昼', '天亮', '日出', '驱夜'], cost: { mana: 60, food: 0, hp: 0 }, requiredLevel: 1 },
  { id: 'weather_clear', name: '驱云术', words: ['驱云', '放晴', '晴空', '雨停', '云散'], cost: { mana: 35, food: 0, hp: 0 }, requiredLevel: 1 },
  { id: 'terraform', name: '大地塑形', words: ['塑形', '裂地', '掘土', '开辟', '平整', '挖地'], cost: { mana: 30, food: 6, hp: 0 }, requiredLevel: 1 },
  { id: 'meteor', name: '陨石术', words: ['陨石', '天罚', '星陨', '神雷', '天雷', '雷击'], cost: { mana: 80, food: 0, hp: 15 }, requiredLevel: 1 },
]

let pass = 0
let fail = 0
function assert(cond: boolean, label: string) {
  if (cond) {
    pass++
    console.log(`  PASS ${label}`)
  } else {
    fail++
    console.error(`  FAIL ${label}`)
  }
}

console.log('== rankCandidates ==')
const ranked = rankCandidates(atoms, ['meteor', 'tp', 'give'])
assert(ranked[0].id === 'meteor', '桐人偏好：meteor 排第一')
assert(ranked[1].id === 'tp', '桐人偏好：tp 排第二')
assert(ranked[2].id === 'give', '桐人偏好：give 排第三')
assert(ranked.length === 8, '封顶 8：偏好 3 个置顶 + 表序补 5 个（生产为防 29 原子刷屏截断）')
assert(ranked[3].id === 'home', '截断后表序首位 home 补入第 4 位')
assert(!ranked.some((a) => a.id === 'terraform' || a.id === 'weather_clear'), '越界候选被截掉')
const noPref = rankCandidates(atoms, [])
assert(noPref[0].id === 'home', '无偏好时保持法术表原顺序')

console.log('== resolveChoice ==')
assert(resolveChoice('选1', ranked) === 'meteor', '选1 → meteor')
assert(resolveChoice('选3', ranked) === 'give', '选3 → give')
assert(resolveChoice('我要选2', ranked) === 'tp', '我要选2 → tp')
assert(resolveChoice('第2个', ranked) === 'tp', '第2个 → tp')
assert(resolveChoice('3', ranked) === 'give', '纯数字 3 → give')
assert(resolveChoice('归乡', ranked) === 'home', '归乡 → home')
assert(resolveChoice('我要回家', ranked) === 'home', '我要回家 → home（咒语词匹配）')
assert(resolveChoice('我选圣愈', ranked) === 'heal', '我选圣愈 → heal')
assert(resolveChoice('随便来一个', ranked) === null, '无法解析 → null')

console.log('== MagicStateStore 落库 ==')
const statePath = './data/ritual-test-state.json'
if (existsSync(statePath)) rmSync(statePath)
const store = new MagicStateStore(statePath, 100, 2.0)
assert(store.getInnate('Kirito') === null, '初始 innateSkill 为 null')
store.setInnate('Kirito', 'meteor')
assert(store.getInnate('Kirito') === 'meteor', 'setInnate 后 innateSkill = meteor')
const p = store.get('Kirito')
assert(p.innateSkill === 'meteor', '状态库 innateSkill 字段正确')
assert(p.learned.includes('meteor'), '初始技能预置为已学会（learned 含 meteor）')
assert(p.mana === 100, '初始满蓝 100')
store.setBackstory('Kirito', '桐谷和人，SAO 封测玩家')
assert(store.get('Kirito').backstory === '桐谷和人，SAO 封测玩家', 'backstory 落库')
// 幂等：再 setInnate 不会重复 push learned
store.setInnate('Kirito', 'meteor')
assert(store.get('Kirito').learned.filter((x) => x === 'meteor').length === 1, 'setInnate 幂等，learned 不重复')

if (existsSync(statePath)) rmSync(statePath)

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
