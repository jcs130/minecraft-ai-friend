/**
 * test-balance.mts —— 天平引擎单测（女神动态平衡：matchBalance 解析 + 回蓝热调）。
 * 用法：..\node_modules\.bin\tsx.CMD test-balance.mts
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MagicStateStore, BALANCE_FIELD_ALIASES, balanceFieldLabel } from './src/mc-magic.ts'
import { matchBalance, formatBulletin } from './src/mc-god.ts'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`) }
  else { fail++; console.log(`FAIL  ${name} ${extra}`) }
}

console.log('== matchBalance：命令解析（公屏/私聊共用入口）==')
const show = matchBalance('平衡')
check('「平衡」→ show', show?.kind === 'show', JSON.stringify(show))
check('「天平一览」→ show', matchBalance('天平一览')?.kind === 'show')
check('带空格 「 平衡 」命中', matchBalance('  平衡  ')?.kind === 'show')

const g = matchBalance('平衡 回蓝 3')
check('「平衡 回蓝 3」→ 全局补丁 regenPerSec=3', g?.kind === 'patch' && g.field === 'regenPerSec' && g.value === 3, JSON.stringify(g))
const g2 = matchBalance('平衡 回蓝速度 2.5')
check('「平衡 回蓝速度 2.5」→ 2.5（0.1 步进）', g2?.kind === 'patch' && g2?.value === 2.5, JSON.stringify(g2))

const p = matchBalance('平衡 陨石术 魔力 90')
check('「平衡 陨石术 魔力 90」→ patch meteor cost.mana=90', p?.kind === 'patch' && p.atom === '陨石术' && p.field === 'cost.mana' && p.value === 90, JSON.stringify(p))
const p2 = matchBalance('平衡 空间传送 门槛 5')
check('门槛别名 → requiredLevel', p2?.field === 'requiredLevel' && p2?.value === 5, JSON.stringify(p2))
const p3 = matchBalance('平衡 圣愈术 血量 2')
check('血量别名 → cost.hp', p3?.field === 'cost.hp', JSON.stringify(p3))

const r = matchBalance('重置平衡')
check('「重置平衡」→ 全清', r?.kind === 'reset' && r.atom === undefined, JSON.stringify(r))
const r2 = matchBalance('重置平衡 陨石术')
check('「重置平衡 陨石术」→ 单法术', r2?.kind === 'reset' && r2?.atom === '陨石术', JSON.stringify(r2))

check('普通聊天不误触', matchBalance('女神我想学陨石术') === null)
check('「平衡 陨石术 魔力 90 吧」多余尾巴 → 不认（防误触）', matchBalance('平衡 陨石术 魔力 90 吧') === null)
check('「平衡 回蓝 回蓝 3」字段名不合法 → null', matchBalance('平衡 回蓝 回蓝 3') === null)
check('平衡+x 非法数值 → null', matchBalance('平衡 陨石术 魔力 abc') === null)
check('「平衡法」不触发', matchBalance('平衡法') === null)

console.log('== 字段白名单 + 中文标签 ==')
check('别名表：魔力/饱食/生命/血量/等级/门槛/回蓝', ['魔力', '饱食', '生命', '血量', '等级', '门槛', '回蓝', '回蓝速度'].every((k) => k in BALANCE_FIELD_ALIASES))
check('balanceFieldLabel(cost.mana) = 魔力', balanceFieldLabel('cost.mana') === '魔力')
check('balanceFieldLabel(未知) 原样返回', balanceFieldLabel('what') === 'what')

console.log('== 回蓝热调：setRegenPerSec 立即影响惰性结算 ==')
const tmp = mkdtempSync(join(tmpdir(), 'mc-balance-'))
const store = new MagicStateStore(join(tmp, 'state.json'), 100, 2.0)
const t0 = Date.now()
store.get('Regen', t0)
store.spendMana('Regen', 100, t0) // 清空魔力
check('清空后 mana=0', store.get('Regen', t0).mana === 0)
store.get('Regen', t0 + 100_000) // 100s @ 2/s → 满蓝
check('默认 2 点/秒：100s 回满 100', store.get('Regen', t0 + 100_000).mana === 100)
store.spendMana('Regen', 100, t0 + 200_000)
store.setRegenPerSec(4)
store.get('Regen', t0 + 220_000) // 20s @ 4/s = 80
check('热调 4 点/秒：20s 回 80', Math.round(store.get('Regen', t0 + 220_000).mana) === 80)
check('getRegenPerSec 读回 4', store.getRegenPerSec() === 4)
rmSync(tmp, { recursive: true, force: true })

console.log('== 天平公告攒批：formatBulletin ==')
check('空队列 → 空串', formatBulletin([]) === '')
const b1 = formatBulletin([
  { at: 1, text: '「陨石术」魔力 80 → 90', by: 'MengMeng' },
  { at: 2, text: '回蓝速率 2 → 3 点/秒', by: 'MengMeng' },
  { at: 3, text: '天平复位——「陨石术」回归基准法则（撤 1 道）', by: 'MengMeng' },
])
check('3 条合并：标题计数 + 逐条列表', b1.startsWith('本轮法度调整 3 条：\n') && b1.includes('· 「陨石术」魔力 80 → 90（MengMeng）') && b1.includes('· 回蓝速率 2 → 3 点/秒（MengMeng）') && b1.includes('· 天平复位——「陨石术」回归基准法则（撤 1 道）（MengMeng）'), b1)
const b2 = formatBulletin([{ at: 1, text: '回蓝速率 2 → 2.5 点/秒', by: 'ProbeBot' }])
check('单条也带条目符与执秤者', b2 === '本轮法度调整 1 条：\n· 回蓝速率 2 → 2.5 点/秒（ProbeBot）', b2)

console.log(fail === 0 ? `\nALL PASS (${pass})` : `\n${fail} FAILED, ${pass} passed`)
process.exit(fail === 0 ? 0 : 1)
