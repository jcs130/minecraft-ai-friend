/**
 * test-growth.mts —— 成长体系单测（路线 A：原生等级驱动/魔力推导/坚毅被动/法则匹配）。
 * 用法：..\node_modules\.bin\tsx.CMD test-growth.mts
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MagicStateStore } from './src/mc-magic.ts'
import { matchLaw, LAW_WHITELIST } from './src/mc-god.ts'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`) }
  else { fail++; console.log(`FAIL  ${name} ${extra}`) }
}

const tmp = mkdtempSync(join(tmpdir(), 'mc-growth-'))
const store = new MagicStateStore(join(tmp, 'state.json'), 100, 2.0)

console.log('== 路线 A：魔力上限推导 maxMana = 100 + 12 × (XpLevel − 1) ==')
check('lv1 = 100', store.maxManaFor(1) === 100, `got ${store.maxManaFor(1)}`)
check('lv2 = 112', store.maxManaFor(2) === 112)
check('lv5 = 148', store.maxManaFor(5) === 148)
check('lv25 = 388（meteor/time_day 门槛）', store.maxManaFor(25) === 388, `got ${store.maxManaFor(25)}`)
check('lv0 容错（= lv1 基线 100）', store.maxManaFor(0) === 100, `got ${store.maxManaFor(0)}`)

console.log('== setLevel 同步（tick 读 XpLevel 后写入）==')
store.get('Alice')
store.setLevel('Alice', 7)
check('同步 lv7', store.get('Alice').level === 7)
check('maxMana 联动 172', store.get('Alice').maxMana === 172, `got ${store.get('Alice').maxMana}`)
store.setLevel('Alice', null)
check('null = 离线保留旧值', store.get('Alice').level === 7)
store.setLevel('Alice', 3)
check('降级同样跟随原生（真源唯一）', store.get('Alice').level === 3 && store.get('Alice').maxMana === 124)

console.log('== 旧状态文件兼容：exp 字段已废弃，读到的旧值被忽略 ==')
const tmp2 = mkdtempSync(join(tmpdir(), 'mc-growth2-'))
const path2 = join(tmp2, 'state.json')
writeFileSync(path2, JSON.stringify({
  version: 1,
  players: { Legacy: { mana: 50, maxMana: 999, learned: [], lastUpdate: Date.now(), innateSkill: null, backstory: null, level: 4, exp: 777, hpRatio: null, passives: [], passiveProgress: {} } },
}), 'utf-8')
const store2 = new MagicStateStore(path2, 100, 2.0)
check('旧 level 4 保留（待世界侧迁移 xp set）', store2.get('Legacy').level === 4)
check('旧文件无 maxManaBonus → 0，maxMana = 基础公式 136', store2.get('Legacy').maxMana === 136 && store2.get('Legacy').maxManaBonus === 0, `got ${store2.get('Legacy').maxMana}`)
rmSync(tmp2, { recursive: true, force: true })

console.log('== 魔力 = 体系自有属性：基础公式 + 自有加成（与等级解耦）==')
store.get('Dave')
store.setLevel('Dave', 3)
check('lv3 基础上限 124', store.get('Dave').maxMana === 124)
check('加成通道 +30 → 154', store.addMaxManaBonus('Dave', 30) === 154)
check('加成后再升级（lv5）：148 + 30 = 178', (store.setLevel('Dave', 5), store.get('Dave').maxMana === 178), `got ${store.get('Dave').maxMana}`)
check('加成累计 +20 → 198', store.addMaxManaBonus('Dave', 20) === 198)
check('加成不落负（-999 把加成钳到 0，上限回落基础 148）', store.addMaxManaBonus('Dave', -999) === 148)
check('加成通道可再加：+50 → 198', store.addMaxManaBonus('Dave', 50) === 198)
check('回蓝 clamp 到含加成的新上限', (store.spendMana('Dave', 999), store.get('Dave', Date.now() + 100_000).mana === 198))

console.log('== 坚毅被动：条件累积（只累不清零）+ 回蓝倍率 ==')
store.get('Bob')
check('初始无被动', !store.hasPassive('Bob', 'fortitude'))
check('累积 600s', store.addPassiveProgress('Bob', 'fortitude', 600) === 600)
check('解锁', store.unlockPassive('Bob', 'fortitude') === true)
check('幂等：重复解锁返回 false', store.unlockPassive('Bob', 'fortitude') === false)
check('进度保留（不清零）', store.getPassiveProgress('Bob', 'fortitude') === 600)

// 回蓝倍率：Bob 濒死（hpRatio 0.25）→ 2 点/s × 2 = 4 点/s；满血 → 2 点/s
// （注意 store.get 返回活引用，diff 前先快照标量）
store.spendMana('Bob', 60) // mana=40（get 用真实时钟）
store.setVitals('Bob', 0.25)
const b1 = store.get('Bob')
const b1m = b1.mana, b1t = b1.lastUpdate
const p1 = store.get('Bob', b1t + 10_000)
const gained1 = p1.mana - b1m
check('濒死+坚毅：10s 回 ~40 点（×2 倍率）', gained1 > 38 && gained1 < 42, `got ${gained1.toFixed(1)}`)
store.spendMana('Bob', 60, b1t + 10_000)
store.setVitals('Bob', 0.8) // 脱离濒死
const b2 = store.get('Bob')
const b2m = b2.mana, b2t = b2.lastUpdate
const p2 = store.get('Bob', b2t + 10_000)
const gained2 = p2.mana - b2m
check('满血+坚毅：回蓝回落 2 点/s', Math.abs(gained2 - 20) < 3, `got ${gained2.toFixed(1)}`)

console.log('== 无坚毅者：濒死也不加速 ==')
store.get('Carol')
store.spendMana('Carol', 60)
store.setVitals('Carol', 0.1)
const b3 = store.get('Carol')
const b3m = b3.mana, b3t = b3.lastUpdate
const p3 = store.get('Carol', b3t + 10_000)
const gained3 = p3.mana - b3m
check('濒死无被动：仍 2 点/s', Math.abs(gained3 - 20) < 3, `got ${gained3.toFixed(1)}`)

console.log('== 服主法则匹配 ==')
check('精确语法', matchLaw('法则 keep_inventory true')?.rule === 'keep_inventory')
check('精确语法 false', matchLaw('法则 do_daylight_cycle false')?.value === false)
check('白名单外拒绝（空规则信号）', matchLaw('法则 random_tick_speed true')?.rule === '')
check('自然语言：死亡不失行囊', matchLaw('女神，愿死亡不失行囊')?.rule === 'keep_inventory' && matchLaw('女神，愿死亡不失行囊')?.value === true)
check('自然语言：死亡不掉落装备', matchLaw('请让死亡不掉落装备')?.value === true)
check('自然语言：夺回死亡的代价', matchLaw('夺回死亡的代价')?.value === false)
check('自然语言：时间停驻', matchLaw('时间停驻')?.rule === 'do_daylight_cycle' && matchLaw('时间停驻')?.value === false)
check('自然语言：怪物不得毁坏世界', matchLaw('怪物不得毁坏世界')?.rule === 'mob_griefing')
check('普通祈愿不误触发', matchLaw('我想回家') === null)
check('普通聊天不误触发', matchLaw('今天天气不错') === null)
check('白名单共 8 项', Object.keys(LAW_WHITELIST).length === 8)

console.log('== 逆转化：spendMana 负值增益且双向钳制（燃血/炼食换魔） ==')
store.get('Eve') // mana=100/100
store.spendMana('Eve', 80)
check('先扣到 20', Math.abs(store.get('Eve').mana - 20) < 0.1)
store.spendMana('Eve', -15) // 燃血换魔：+15
check('负值扣费 = 增益 15（20 → 35）', Math.abs(store.get('Eve').mana - 35) < 0.1)
store.spendMana('Eve', -999) // 炼食超额：钳在上限
check('增益钳制上限 100（不溢出）', Math.abs(store.get('Eve').mana - 100) < 0.1)
store.spendMana('Eve', 200) // 正常扣费不透支到负
check('扣费钳制下限 0', Math.abs(store.get('Eve').mana - 0) < 0.1)
store.spendMana('Eve', -15)
check('空魔燃血回到 15', Math.abs(store.get('Eve').mana - 15) < 0.1)

console.log('== 生命体征：hpRatio/foodRatio 双缓存（饥饿被动触发用） ==')
store.setVitals('Frank', 0.5, 0.1)
const fk = store.get('Frank')
check('hpRatio 写入', fk.hpRatio === 0.5)
check('foodRatio 写入', fk.foodRatio === 0.1)
store.setVitals('Frank', 0.9) // 只更 hp，food 保留
check('foodRatio 省略时保留旧值', store.get('Frank').foodRatio === 0.1)
store.setVitals('Frank', null, null)
check('双 null 清空（离线）', store.get('Frank').hpRatio === null && store.get('Frank').foodRatio === null)
rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
