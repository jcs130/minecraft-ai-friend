/**
 * test-appraise.mts —— 鉴定技能单测（零命令原子 + 动态报告纯函数）。
 * 用法：..\node_modules\.bin\tsx.CMD test-appraise.mts
 */
import { readFileSync } from 'node:fs'
import { buildAppraisalReport, type AtomSummary } from './src/mc-magic.ts'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`) }
  else { fail++; console.log(`FAIL  ${name} ${extra}`) }
}

// ── 1. 原子配置：appraise 在 magic-atoms.json 里且形态正确 ──────────────
console.log('== 原子配置 ==')
const raw = JSON.parse(readFileSync('./data/magic-atoms.json', 'utf-8')) as { atoms: Record<string, unknown>[] }
const atomsJson = raw.atoms ?? (raw as unknown as Record<string, unknown>[])
const appraise = atomsJson.find((a) => a.id === 'appraise') as Record<string, any> | undefined
check('atoms 含 appraise', !!appraise)
if (appraise) {
  check('words 含「鉴定」', Array.isArray(appraise.words) && appraise.words.includes('鉴定'))
  check('requiredLevel = 1（人人可用）', appraise.requiredLevel === 1)
  check('commands 为空（零命令，动态报告）', Array.isArray(appraise.commands) && appraise.commands.length === 0)
  check('cost.mana = 2（轻耗）', appraise.cost?.mana === 2)
  check('不含 hp/food 消耗', appraise.cost?.hp === 0 && appraise.cost?.food === 0)
}

// ── 1b. 逆转化原子：形态 + 汇率防永动（燃血/炼食换魔） ──────────────────
console.log('== 逆转化：燃血/炼食 ==')
const byId = (id: string) => atomsJson.find((a) => a.id === id) as Record<string, any> | undefined
const blood = byId('blood_mana')
const foodB = byId('food_mana')
const heal = byId('heal')
const feed = byId('feed')
check('燃血术在册', !!blood)
check('炼食术在册', !!foodB)
if (blood && foodB) {
  check('燃血 = 负魔力成本（逆转化）', blood.cost.mana < 0 && blood.cost.hp > 0)
  check('炼食 = 负魔力成本（逆转化）', foodB.cost.mana < 0 && foodB.cost.food > 0)
  check('逆转化零命令（纯结算原子）', blood.commands.length === 0 && foodB.commands.length === 0)
  // 防永动：燃血换来的魔，再经圣愈回血必须亏本才安全。
  // 圣愈 30 mana → instant_health II = 8 HP ⇒ 效率 3.75 mana/HP。
  // 燃血 6 HP → 15 mana：回本需 6×3.75=22.5 > 15，亏 7.5，安全余量充足。
  const healEff = heal ? heal.cost.mana / 8 : 3.75
  const bloodLoopProfit = -blood.cost.mana - blood.cost.hp * healEff
  check('燃血↔圣愈无永动（亏本）', bloodLoopProfit < -1, `profit=${bloodLoopProfit}`)
  // 饱食赐福 20 mana → 补满 ≈20 food ⇒ 1.0 mana/food。炼食 8 food → 6 mana：亏 2。
  const feedEff = feed ? feed.cost.mana / 20 : 1.0
  const foodLoopProfit = -foodB.cost.mana - foodB.cost.food * feedEff
  check('炼食↔饱食无永动（亏本）', foodLoopProfit < -1, `profit=${foodLoopProfit}`)
}

// ── 1c. 被动定义：血线触发效果（血怒/铁壁/求生本能）────────────────────
console.log('== 被动引擎配置 ==')
const seJson = JSON.parse(readFileSync('./data/skill-events.json', 'utf-8'))
const passives = (Array.isArray(seJson) ? seJson : seJson.passives) as Array<Record<string, any>>
const MC_EFFECT_WHITELIST = ['minecraft:strength', 'minecraft:resistance', 'minecraft:speed',
  'minecraft:regeneration', 'minecraft:fire_resistance', 'minecraft:absorption']
const pById = (id: string) => passives.find((p) => p.id === id)
check('被动 ≥ 4 项（坚毅+血怒+铁壁+求生）', passives.length >= 4, `got ${passives.length}`)
for (const p of passives) {
  check(`[${p.id}] trigger.metric 合法`, ['hpRatio', 'foodRatio'].includes(p.trigger.metric))
  check(`[${p.id}] trigger.op 合法`, ['<', '<=', '>', '>='].includes(p.trigger.op))
  check(`[${p.id}] accumulateSec > 0`, p.trigger.accumulateSec > 0)
  if (p.effect?.kind === 'mc_effect') {
    check(`[${p.id}] 效果在白名单`, MC_EFFECT_WHITELIST.includes(p.effect.mcId))
    check(`[${p.id}] durationSec ≥ 25（> 20s 轮询间隔，无缝续杯）`, p.effect.durationSec >= 25)
    check(`[${p.id}] when 条件合法`, ['<', '<=', '>', '>='].includes(p.effect.when?.op))
  }
}
check('血怒 = 力量（血线→攻击）', pById('bloodrage')?.effect?.mcId === 'minecraft:strength')
check('铁壁 = 抗性（血线→防御）', pById('bulwark')?.effect?.mcId === 'minecraft:resistance')
check('求生 = 移速（饥饿→移速）', pById('survival')?.effect?.mcId === 'minecraft:speed')
check('坚毅仍是回蓝倍率型（非 mc_effect）', pById('fortitude')?.effect?.kind === 'regen_multiplier')

// ── 2. 报告纯函数：满数据 ─────────────────────────────────────────────
console.log('== buildAppraisalReport：满数据 ==')
const A = (id: string, name: string, requiredLevel: number): AtomSummary =>
  ({ id, name, words: [name], cost: { mana: 1, food: 0, hp: 0 }, requiredLevel })
const atoms: AtomSummary[] = [
  A('appraise', '鉴定', 1),
  A('home', '归乡', 2),
  A('heal', '圣愈', 5),
  A('tp', '空间传送', 5),
  A('sky', '晴空', 8),
  A('iron', '铁骨', 8),
  A('str', '蛮力', 8),
  A('wind', '御风', 8),
  A('water', '唤水', 8),
  A('meteor', '陨星', 25),
]
const full = buildAppraisalReport(
  {
    player: 'Kirito', level: 7, xpProgress: 0.45,
    mana: 116.7, maxMana: 172, maxManaBonus: 30,
    innateName: '陨星', passiveNames: ['坚毅'],
    health: 16, food: 18, armor: 15,
  },
  atoms,
  'meteor',
)
console.log(full.panel)
check('panel 含玩家名与标题', full.panel.includes('✦ 鉴定 · Kirito ✦'))
check('panel 含 Lv.7 与进度 45%', full.panel.includes('修为层级：Lv.7（下一层 45%）'))
check('panel 魔力取整 116/172', full.panel.includes('魔力：116/172（含加持 +30）'))
check('panel 生命/饱食/护甲', full.panel.includes('生命：16/20 ｜ 饱食：18/20 ｜ 护甲：15'))
check('panel 出生天赋', full.panel.includes('出生天赋：陨星'))
check('panel 稀有被动', full.panel.includes('稀有被动：坚毅'))
check('已掌握 = 天赋(豁免25级) + ≤7级，天赋排最前', full.panel.includes('已掌握（5/10）：陨星、鉴定、归乡、圣愈、空间传送'))
check('下一批 Lv.8 组（同级按文件序，≤4 名 + 等）', full.panel.includes('Lv.8 晴空、铁骨、蛮力、御风、等'))
check('第二组 Lv.25 陨星', full.panel.includes('Lv.25 陨星'))
check('summary 含 Lv 与魔力', full.summary.includes('Lv.7（45%）') && full.summary.includes('魔力 116/172（含加持 +30）'))
check('summary 含天赋与计数（解锁数=全量）', full.summary.includes('天赋「陨星」') && full.summary.includes('秘法 5/10（Lv.8 解锁 5 项）'))

// ── 3. 边界：零加成 / null 生命体征 / 无被动无天赋 / 全解锁 ────────────
console.log('== 边界 ==')
const lean = buildAppraisalReport(
  {
    player: 'Newbie', level: 1, xpProgress: null,
    mana: 98.9, maxMana: 100, maxManaBonus: 0,
    innateName: null, passiveNames: [],
    health: null, food: null, armor: null,
  },
  atoms,
  null,
)
console.log(lean.panel)
check('bonus=0 无加持段', !lean.panel.includes('加持'))
check('xpProgress null 无进度段', lean.panel.includes('修为层级：Lv.1\n'))
check('null 生命体征 → 未探明', lean.panel.includes('生命：未探明 ｜ 饱食：未探明 ｜ 护甲：未探明'))
check('无天赋行不出现', !lean.panel.includes('出生天赋'))
check('无被动行不出现', !lean.panel.includes('稀有被动'))
check('新手只掌握鉴定 1/10', lean.panel.includes('已掌握（1/10）：鉴定'))

const master = buildAppraisalReport(
  {
    player: 'GodKing', level: 30, xpProgress: 0.7,
    mana: 380, maxMana: 448, maxManaBonus: 0,
    innateName: null, passiveNames: [],
    health: 20, food: 20, armor: 20,
  },
  atoms,
  null,
)
check('全解锁 → 已臻化境', master.panel.includes('已臻化境，万法皆通'))
check('全解锁 summary 无下一批段', !master.summary.includes('解锁'))

console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
